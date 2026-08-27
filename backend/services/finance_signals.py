"""Follow-up escalation + finance-action signal engine (Epic 8 Sprint 4 --
from server.py).

run_followup escalates overdue tasks (reminder->owner alert) and kicks the
finance engine; run_finance_actions turns overdue receivables + due supplier
bills into accountable, idempotent tasks. Money-remaining + currency format
helpers live here too. Cross-domain: sweep_expired_temp_grants (routers.access)
and _finance_role_key (captures, server) are imported deferred.
"""
import os
from datetime import datetime, timezone, timedelta

from core import db, logger, new_id, now_iso, tenant_role_keys
from services.notifications import push_notification, dispatch_owner_alert, _owner_ids
from services.voice import pick_least_loaded_member


_followup_last_run: dict = {}


async def run_followup(tenant_id: str):
    now = datetime.now(timezone.utc)
    # Throttle: this scan runs on every notifications poll — cap it to once per 60s per tenant.
    last = _followup_last_run.get(tenant_id)
    if last and (now - last).total_seconds() < 60:
        return
    _followup_last_run[tenant_id] = now
    # RBAC-27 (2026-08-15): sweep expired temp perms so contractor
    # grants auto-revoke without a separate cron. Cheap query -- only
    # touches memberships that HAVE a temp_grants entry past expiry.
    try:
        from routers.access import sweep_expired_temp_grants
        revoked = await sweep_expired_temp_grants(tenant_id)
        if revoked:
            logger.info(f"[rbac-27] auto-revoked {revoked} expired temp grant(s) in tenant {tenant_id[:8]}...")
    except Exception as e:
        logger.warning(f"[rbac-27] temp-grant sweep failed: {e}")
    tasks = await db.tasks.find(
        {"tenant_id": tenant_id, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$ne": None, "$lt": now.isoformat()}},
        {"_id": 0}
    ).to_list(500)
    owners = await _owner_ids(tenant_id)
    for t in tasks:
        try:
            due = datetime.fromisoformat(t["due_date"])
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        days = (now - due).days
        target = 1 if days < 1 else 2 if days < 2 else 3 if days < 3 else 4
        if target <= t.get("escalation_level", 0):
            continue
        if t.get("assignee_id"):
            recipients = [t["assignee_id"]]
        elif t.get("assignee_role"):
            recipients = [u["id"] for u in await db.users.find({"tenant_id": tenant_id, "role": t["assignee_role"]}, {"_id": 0, "id": 1}).to_list(50)]
        else:
            recipients = owners
        msg = f"Task '{t['title']}' is overdue by {days} day(s)."
        if target in (1, 2):
            await push_notification(tenant_id, recipients, target, msg, "task", t["id"])
        elif target == 3:
            await push_notification(tenant_id, owners, 3, f"[Manager escalation] {msg}", "task", t["id"])
        else:
            await push_notification(tenant_id, owners, 4, f"[OWNER ALERT] {msg}", "task", t["id"])
            await dispatch_owner_alert(tenant_id, msg)
        await db.tasks.update_one({"id": t["id"]}, {"$set": {"escalation_level": target, "last_escalated": now_iso()}})
    try:
        await run_finance_actions(tenant_id)
    except Exception as e:
        logger.warning(f"[finance-actions] tenant {tenant_id} failed: {e}")


FINANCE_CHASE_DAYS = int(os.environ.get("FINANCE_CHASE_DAYS", "7"))          # chase a receivable once 7+ days overdue


FINANCE_BILL_DUE_SOON_DAYS = int(os.environ.get("FINANCE_BILL_DUE_SOON_DAYS", "3"))  # act on a bill due within 3 days or overdue


_CUR_SYM = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED ", "AUD": "A$", "CAD": "C$"}


def _inv_remaining(inv: dict) -> float:
    return round(float(inv.get("amount") or 0) - float(inv.get("amount_paid") or 0), 2)


def _pay_remaining_amt(p: dict) -> float:
    return round(float(p.get("amount") or 0) - float(p.get("applied") or 0), 2)


def _fmt_amt(a, cur="INR") -> str:
    sym = _CUR_SYM.get(str(cur or "INR").upper(), "")
    return f"{sym}{float(a or 0):,.0f}"


async def _overdue_receivables(tenant_id: str) -> list:
    """Sales invoices unpaid and overdue by at least FINANCE_CHASE_DAYS days."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=FINANCE_CHASE_DAYS)).strftime("%Y-%m-%d")
    rows = await db.invoices.find(
        {"tenant_id": tenant_id, "type": "sales_invoice", "status": {"$ne": "paid"}}, {"_id": 0}).to_list(3000)
    out = []
    for r in rows:
        if _inv_remaining(r) <= 0.01:
            continue
        due = str(r.get("due_date") or "")[:10]
        if due and due <= cutoff:
            out.append(r)
    return out


async def _bills_due_or_overdue(tenant_id: str) -> list:
    """Purchase bills unpaid and due within FINANCE_BILL_DUE_SOON_DAYS days (or already overdue)."""
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(days=FINANCE_BILL_DUE_SOON_DAYS)).strftime("%Y-%m-%d")
    rows = await db.invoices.find(
        {"tenant_id": tenant_id, "type": "purchase_bill", "status": {"$ne": "paid"}}, {"_id": 0}).to_list(3000)
    out = []
    for r in rows:
        if _inv_remaining(r) <= 0.01:
            continue
        due = str(r.get("due_date") or "")[:10]
        if due and due <= soon:
            out.append(r)
    return out


async def _unmatched_payments(tenant_id: str) -> list:
    """Payments that couldn't be auto-linked to an invoice/bill and still have an unallocated balance."""
    rows = await db.payments.find(
        {"tenant_id": tenant_id, "match_status": {"$in": ["unmatched", "partial"]}}, {"_id": 0}).to_list(3000)
    return [p for p in rows if _pay_remaining_amt(p) > 0.01 and p.get("match_status") != "standalone"]


async def _finance_assignee(tenant_id: str):
    """Route finance action tasks to the Finance/Accounts department; if none exists, to the owner."""
    from services.captures import _finance_role_key
    troles = await tenant_role_keys(tenant_id)
    fin_role = await _finance_role_key(tenant_id, troles)
    if fin_role:
        return await pick_least_loaded_member(tenant_id, fin_role), fin_role
    owners = await _owner_ids(tenant_id)
    return (owners[0] if owners else None), "owner"


async def run_finance_actions(tenant_id: str):
    """A: turn overdue receivables + due/overdue supplier bills into accountable, idempotent tasks."""
    assignee_id, assignee_role = await _finance_assignee(tenant_id)
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    async def _spawn(inv, title, desc, priority, due):
        tid = new_id()
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id, "title": title, "description": desc,
            "assignee_role": assignee_role, "assignee_id": assignee_id, "priority": priority,
            "status": "todo", "due_date": due, "decision_id": None,
            "source": "finance", "task_type": "finance", "op_category": None,
            "finance_ref": {"invoice_id": inv["id"], "invoice_type": inv.get("type")},
            "progress": 0, "created_by": "system", "created_at": now_iso(),
            "updated_at": now_iso(), "last_action": "Auto-created from Finance",
        })
        await db.invoices.update_one({"id": inv["id"], "tenant_id": tenant_id},
                                     {"$set": {"action_task_id": tid}})
        if assignee_id:
            await push_notification(tenant_id, [assignee_id], 2, title, "task", tid,
                                    ntype="assigned", title=title, sender="Finance")

    # A1: chase overdue customer invoices (7+ days overdue)
    for inv in await _overdue_receivables(tenant_id):
        if inv.get("action_task_id"):
            continue
        cust = (inv.get("contact_name") or "the customer").strip()
        num = str(inv.get("number") or "").strip()
        rem = _inv_remaining(inv)
        amt = _fmt_amt(rem, inv.get("currency"))
        due = str(inv.get("due_date") or "")[:10]
        title = f"Chase {cust} for {amt}" + (f" (Invoice {num})" if num else "")
        desc = (f"Invoice {num or '(no number)'} for {amt} to {cust} is overdue"
                + (f" since {due}" if due else "") + ". Follow up and collect payment.")
        await _spawn(inv, title, desc, "high", now_iso())

    # A2: approve & pay supplier bills due within 3 days or overdue
    for inv in await _bills_due_or_overdue(tenant_id):
        if inv.get("action_task_id"):
            continue
        vend = (inv.get("contact_name") or "the supplier").strip()
        num = str(inv.get("number") or "").strip()
        rem = _inv_remaining(inv)
        amt = _fmt_amt(rem, inv.get("currency"))
        due = str(inv.get("due_date") or "")[:10]
        overdue = bool(due and due < today)
        title = f"Approve & pay {vend} {amt}" + (f" by {due}" if due else "")
        desc = (f"Supplier bill {num or '(no number)'} for {amt} from {vend} is "
                + ("overdue" if overdue else f"due by {due}") + ". Approve and schedule payment.")
        await _spawn(inv, title, desc, "high" if overdue else "medium", due and f"{due}T09:00:00" or now_iso())

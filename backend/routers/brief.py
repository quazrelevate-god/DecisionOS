"""Brief + notifications router — extracted from `server.py` in Phase B step 7.

Owns:
  • GET  /api/brief                       — role-scoped dashboard counters (owner sees all;
                                             non-owners see their own delayed/todo/in_progress/etc.)
  • GET  /api/brief/details               — drill-down items behind a counter block
  • GET  /api/notifications               — user's notifications + unread count
  • POST /api/notifications/{nid}/read    — mark one read
  • POST /api/notifications/read-all      — mark all read

E2-63 (2026-08-15): POST /brief/send-digest was retired. The digest
emailed a snapshot of today's brief to the owner -- superseded by
Sprint 6 which merged the Brief into the Decision Desk itself. The
Desk is live, one-click actionable, and doesn't require SMTP setup
(a real barrier for India SMEs). If we ever want push-to-phone we'll
build it on WhatsApp outbound templates, not email.

Server-level helpers deferred-imported inside handlers:
  `run_followup`, `_overdue_receivables`, `_bills_due_or_overdue`,
  `_unmatched_payments`, `_inv_remaining`, `_pay_remaining_amt`,
  `enrich_decisions`.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, require_role, new_id
from services.tasks import enrich_tasks


router = APIRouter(prefix="/api")


# E2-56 fix: server runs in UTC; date-only comparisons (attendance.date,
# leaves.from_date/to_date) need to roll at IST-midnight so India tenants
# don't see yesterday's "on leave" list from 00:00-05:29 IST.
_IST_OFFSET = timedelta(hours=5, minutes=30)


def _today_ist() -> str:
    return (datetime.now(timezone.utc) + _IST_OFFSET).date().isoformat()


# ---------------------------------------------------------------------------
# Notifications
# ---------------------------------------------------------------------------
@router.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    from server import run_followup  # deferred
    await run_followup(user["tenant_id"])
    items = await db.notifications.find(
        {"tenant_id": user["tenant_id"], "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return {"notifications": items, "unread": sum(1 for n in items if not n.get("read"))}


@router.post("/notifications/{nid}/read")
async def read_notification(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one(
        {"id": nid, "tenant_id": user["tenant_id"], "user_id": user["id"]},
        {"$set": {"read": True}},
    )
    return {"ok": True}


@router.post("/notifications/read-all")
async def read_all_notifications(user: dict = Depends(get_current_user)):
    await db.notifications.update_many(
        {"tenant_id": user["tenant_id"], "user_id": user["id"], "read": False},
        {"$set": {"read": True}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Brief (dashboard counters)
# ---------------------------------------------------------------------------
@router.get("/brief")
async def ceo_brief(period: str = "morning", user: dict = Depends(get_current_user)):
    from server import (  # deferred
        run_followup, _overdue_receivables, _bills_due_or_overdue,
        _unmatched_payments, _inv_remaining, _pay_remaining_amt,
    )
    tid = user["tenant_id"]
    await run_followup(tid)
    now = datetime.now(timezone.utc)
    today = _today_ist()  # E2-56: IST date so India tenants roll at IST-midnight
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "weekly":
        start_iso = (now - timedelta(days=7)).isoformat()
    elif period == "monthly":
        start_iso = (now - timedelta(days=30)).isoformat()
    else:
        start_iso = midnight.isoformat()
    is_owner = user["role"] == "owner"
    greet = "Good morning" if period in ("morning", "weekly", "monthly") else "Good evening"

    if period == "morning":
        y_start = (midnight - timedelta(days=1)).isoformat()
        completed_range = {"$gte": y_start, "$lt": midnight.isoformat()}
        completed_label = "completed yesterday"
    else:
        completed_range = {"$gte": start_iso}
        completed_label = f"completed ({period})"

    if is_owner:
        delayed = await db.tasks.count_documents({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now.isoformat(), "$ne": None}})
        completed = await db.activity.count_documents({"tenant_id": tid, "kind": "task_done", "created_at": completed_range})
        pending_dec = await db.decisions.count_documents({"tenant_id": tid, "status": "pending_approval"})
        # FIX-001-A: resolve the tenant's actual procurement pipeline dynamically instead of the textile 'purchase_payment' hardcode.
        from services.workflows import tenant_procurement_pipeline, procurement_initial_stage, procurement_penultimate_stage
        _proc = await tenant_procurement_pipeline(tid)
        _proc_init = procurement_initial_stage(_proc) if _proc else None
        _proc_pen = procurement_penultimate_stage(_proc) if _proc else None
        pending_pur = await db.workflows.count_documents({"tenant_id": tid, "type": _proc["key"], "stage": _proc_init}) if (_proc and _proc_init) else 0
        absent = await db.attendance.count_documents({"tenant_id": tid, "date": today, "status": "absent"})
        complaints = await db.complaints.count_documents({"tenant_id": tid, "status": "open"})
        payment_overdue = await db.workflows.count_documents({"tenant_id": tid, "type": _proc["key"], "stage": _proc_pen}) if (_proc and _proc_pen) else 0
        fires = await db.tasks.count_documents({"tenant_id": tid, "source": "escalation", "status": {"$ne": "done"}})
        on_leave = await db.leaves.count_documents({"tenant_id": tid, "status": "approved", "from_date": {"$lte": today}, "to_date": {"$gte": today}})
        recv = await _overdue_receivables(tid)
        bills = await _bills_due_or_overdue(tid)
        unmatched = await _unmatched_payments(tid)
        counters = {"delayed": delayed, "completed": completed, "awaiting_approval": pending_dec + pending_pur,
                    "absent": absent, "complaints": complaints, "payment_overdue": payment_overdue, "fires": fires,
                    "on_leave": on_leave,
                    "receivables_overdue": len(recv), "bills_due": len(bills), "unmatched_payments": len(unmatched)}
        finance_amounts = {
            "receivables_overdue": round(sum(_inv_remaining(r) for r in recv), 2),
            "bills_due": round(sum(_inv_remaining(r) for r in bills), 2),
            "unmatched_payments": round(sum(_pay_remaining_amt(p) for p in unmatched), 2),
        }
    else:
        mine = {"$or": [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]}

        def mq(extra):
            return {"tenant_id": tid, **mine, **extra}
        delayed = await db.tasks.count_documents(mq({"status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now.isoformat(), "$ne": None}}))
        todo = await db.tasks.count_documents(mq({"status": "todo"}))
        in_progress = await db.tasks.count_documents(mq({"status": "in_progress"}))
        completed = await db.activity.count_documents({"tenant_id": tid, "kind": "task_done", "actor": user["id"], "created_at": completed_range})
        escalations = await db.tasks.count_documents(mq({"source": "escalation", "status": {"$ne": "done"}}))
        handoffs = await db.tasks.count_documents(mq({"source": "handoff", "status": {"$ne": "done"}}))
        counters = {"delayed": delayed, "todo": todo, "in_progress": in_progress,
                    "completed": completed, "escalations": escalations, "handoffs": handoffs}
        finance_amounts = {}

    return {
        "period": period,
        "role": user["role"],
        "greeting": f"{greet}, {user['name'].split(' ')[0]}",
        "completed_label": completed_label,
        "counters": counters,
        "finance_amounts": finance_amounts,
    }


@router.get("/brief/details")
async def brief_details(key: str, period: str = "morning", user: dict = Depends(get_current_user)):
    """Drill-down items behind a CEO Brief counter block."""
    from server import (  # deferred
        _overdue_receivables, _bills_due_or_overdue, _unmatched_payments,
        _inv_remaining, _pay_remaining_amt, enrich_decisions,
    )
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = _today_ist()  # E2-56: IST-today for date-only comparisons
    if period == "weekly":
        start_iso = (now - timedelta(days=7)).isoformat()
    elif period == "monthly":
        start_iso = (now - timedelta(days=30)).isoformat()
    else:
        start_iso = midnight.isoformat()

    items: list = []
    actionable = False
    is_owner = user["role"] == "owner"
    mine = None if is_owner else {"$or": [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]}

    def scope(q):
        return q if not mine else {**q, **mine}

    if key in {"awaiting_approval", "absent", "complaints", "payment_overdue", "fires", "on_leave",
               "receivables_overdue", "bills_due", "unmatched_payments"} and not is_owner:
        return {"key": key, "actionable": False, "items": []}

    if key == "on_leave":
        lvs = await db.leaves.find({"tenant_id": tid, "status": "approved", "from_date": {"$lte": today}, "to_date": {"$gte": today}}, {"_id": 0}).to_list(200)
        for lv in lvs:
            portion = " · half day" if lv.get("day_portion") == "half" else ""
            items.append({"id": lv["id"], "title": lv.get("user_name"),
                          "subtitle": f"{(lv.get('leave_type') or 'leave').title()} until {lv.get('to_date')}{portion}",
                          "meta": lv.get("user_role"), "kind": "leave"})
        return {"key": key, "actionable": False, "items": items}

    if key == "delayed":
        tasks = await db.tasks.find(
            scope({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now.isoformat(), "$ne": None}}),
            {"_id": 0}).sort("due_date", 1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            items.append({"id": t["id"], "title": t["title"],
                          "subtitle": t.get("assignee_name") or t.get("assignee_role") or "unassigned",
                          "meta": t.get("priority"), "kind": "task", "due_date": t.get("due_date")})

    elif key in ("todo", "in_progress"):
        tasks = await db.tasks.find(scope({"tenant_id": tid, "status": key}), {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            items.append({"id": t["id"], "title": t["title"],
                          "subtitle": t.get("assignee_name") or t.get("assignee_role") or "unassigned",
                          "meta": t.get("priority"), "kind": "task"})

    elif key in ("escalations", "handoffs"):
        src = "escalation" if key == "escalations" else "handoff"
        tasks = await db.tasks.find(scope({"tenant_id": tid, "source": src, "status": {"$ne": "done"}}), {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            sub = f"Raised by {t['raised_by_name']}" if t.get("raised_by_name") else (t.get("assignee_name") or "")
            items.append({"id": t["id"], "title": t["title"], "subtitle": sub, "meta": t.get("priority"), "kind": "task"})

    elif key == "completed":
        if period == "morning":
            y_start = (midnight - timedelta(days=1)).isoformat()
            trange = {"$gte": y_start, "$lt": midnight.isoformat()}
        else:
            trange = {"$gte": start_iso}
        aq = {"tenant_id": tid, "kind": "task_done", "created_at": trange}
        if not is_owner:
            aq["actor"] = user["id"]
        acts = await db.activity.find(aq, {"_id": 0}).sort("created_at", -1).to_list(200)
        tids = [a.get("entity_id") for a in acts if a.get("entity_id")]
        tmap: dict = {}
        if tids:
            for tk in await db.tasks.find({"tenant_id": tid, "id": {"$in": tids}},
                                          {"_id": 0, "id": 1, "attachments": 1, "assignee_id": 1}).to_list(300):
                tmap[tk["id"]] = tk
        aids = list({tk.get("assignee_id") for tk in tmap.values() if tk.get("assignee_id")})
        umap: dict = {}
        if aids:
            for u in await db.users.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "name": 1}).to_list(300):
                umap[u["id"]] = u["name"]
        for a in acts:
            tk = tmap.get(a.get("entity_id"))
            proof = [{"kind": at.get("kind"), "url": at.get("url")} for at in ((tk or {}).get("attachments") or [])]
            sub = umap.get((tk or {}).get("assignee_id")) or ""
            items.append({"id": a.get("entity_id") or a["id"], "title": a.get("message"),
                          "subtitle": sub, "kind": "task" if tk else "activity", "proof": proof})

    elif key == "awaiting_approval":
        actionable = True
        decisions = await db.decisions.find({"tenant_id": tid, "status": "pending_approval"}, {"_id": 0}).to_list(50)
        # FIX-003-B (S2-05): explicit tenant_id for defense-in-depth.
        decisions = await enrich_decisions(decisions, tenant_id=tid)
        for d in decisions:
            items.append({"id": d["id"], "title": d["title"], "subtitle": d.get("summary") or "",
                          "meta": f"{len(d.get('tasks', []))} task(s) blocked", "kind": "decision"})
        # FIX-001-A: dynamic procurement pipeline resolution.
        from services.workflows import tenant_procurement_pipeline, procurement_initial_stage
        _proc = await tenant_procurement_pipeline(tid)
        _init = procurement_initial_stage(_proc) if _proc else None
        purchases = await db.workflows.find({"tenant_id": tid, "type": _proc["key"], "stage": _init}, {"_id": 0}).to_list(50) if (_proc and _init) else []
        for w in purchases:
            items.append({"id": w["id"], "title": w.get("title"), "subtitle": w.get("counterparty") or "",
                          "meta": w.get("amount"), "kind": "purchase", "wf_type": w.get("type")})

    elif key == "absent":
        recs = await db.attendance.find({"tenant_id": tid, "date": today, "status": "absent"}, {"_id": 0}).to_list(200)
        uids = [r["user_id"] for r in recs if r.get("user_id")]
        umap = {}
        if uids:
            for u in await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200):
                umap[u["id"]] = u
        for r in recs:
            u = umap.get(r.get("user_id"), {})
            items.append({"id": r.get("user_id") or new_id(), "title": u.get("name", "Unknown"), "subtitle": u.get("role", ""), "kind": "absent"})

    elif key == "complaints":
        actionable = True
        recs = await db.complaints.find({"tenant_id": tid, "status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(200)
        for c in recs:
            items.append({"id": c["id"], "title": c.get("text"), "subtitle": c.get("customer_name") or "Unknown",
                          "meta": c.get("severity"), "kind": "complaint", "customer_id": c.get("customer_id")})

    elif key == "payment_overdue":
        # FIX-001-A: dynamic procurement pipeline resolution; penultimate stage
        # is the convention for "awaiting payment" across AI-designed pipelines.
        from services.workflows import tenant_procurement_pipeline, procurement_penultimate_stage
        _proc = await tenant_procurement_pipeline(tid)
        _pen = procurement_penultimate_stage(_proc) if _proc else None
        recs = await db.workflows.find({"tenant_id": tid, "type": _proc["key"], "stage": _pen}, {"_id": 0}).to_list(200) if (_proc and _pen) else []
        for w in recs:
            items.append({"id": w["id"], "title": w.get("title"), "subtitle": w.get("counterparty") or "",
                          "meta": w.get("amount"), "kind": "payment", "wf_type": w.get("type")})

    elif key == "fires":
        tasks = await db.tasks.find({"tenant_id": tid, "source": "escalation", "status": {"$ne": "done"}}, {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            sub = f"Raised by {t['raised_by_name']}" if t.get("raised_by_name") else (t.get("assignee_name") or "")
            items.append({"id": t["id"], "title": t["title"], "subtitle": sub, "meta": t.get("priority"), "kind": "escalation"})

    elif key == "receivables_overdue":
        for inv in sorted(await _overdue_receivables(tid), key=lambda r: str(r.get("due_date") or "")):
            num = str(inv.get("number") or "").strip()
            due = str(inv.get("due_date") or "")[:10]
            items.append({"id": inv["id"], "kind": "receivable",
                          "title": f"{inv.get('contact_name') or 'Customer'}" + (f" · {num}" if num else ""),
                          "subtitle": f"Overdue since {due}" if due else "Overdue",
                          "meta": _inv_remaining(inv)})

    elif key == "bills_due":
        for inv in sorted(await _bills_due_or_overdue(tid), key=lambda r: str(r.get("due_date") or "")):
            num = str(inv.get("number") or "").strip()
            due = str(inv.get("due_date") or "")[:10]
            overdue = bool(due and due < today)
            items.append({"id": inv["id"], "kind": "bill",
                          "title": f"{inv.get('contact_name') or 'Supplier'}" + (f" · {num}" if num else ""),
                          "subtitle": (f"Overdue since {due}" if overdue else (f"Due {due}" if due else "Due soon")),
                          "meta": _inv_remaining(inv)})

    elif key == "unmatched_payments":
        for p in sorted(await _unmatched_payments(tid), key=lambda x: str(x.get("date") or ""), reverse=True):
            arrow = "Received" if p.get("direction") == "in" else "Paid out"
            party = (p.get("contact_name") or "").strip() or "Unidentified party"
            dt = str(p.get("date") or "")[:10]
            items.append({"id": p["id"], "kind": "unmatched", "direction": p.get("direction"),
                          "title": f"{arrow} · {party}",
                          "subtitle": (f"{dt} · needs matching" if dt else "Needs matching"),
                          "meta": _pay_remaining_amt(p)})

    return {"key": key, "actionable": actionable, "items": items}


# E2-63 (2026-08-15): send-digest endpoint deleted -- see module
# docstring for rationale. If bringing back, use WhatsApp outbound,
# not email.

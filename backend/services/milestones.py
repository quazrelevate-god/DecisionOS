"""The first time a company reached each step (2026-10-23, admin console v2 P1).

"Did this customer get value?" had to be re-derived from a dozen collections
every time anyone asked, so nobody asked. Each first now lands once on the
company as `tenants.milestones.<key>` (an ISO time), from the activity log as
it happens, and from the collections themselves for companies that existed
before (`backfill_tenant`).

Activation (founder, 2026-10-23, the recommended definition): a decision
approved AND a teammate invited, both within 14 days of signing up. Recorded
as `milestones.activated_at` (the later of the two) the moment both are true.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db as _db, logger

ACTIVATION_WINDOW = timedelta(days=14)

# activity kind -> milestone. A kind not listed here costs one dict lookup.
KIND_TO_MILESTONE = {
    "decision_extracted": "first_decision_at", "decision_approved": "first_decision_approved_at",
    "task_created": "first_task_at", "task_done": "first_task_done_at",
    "employees_invited": "first_invite_at", "user_added": "first_invite_at",
    "data_ingested": "first_capture_at", "meeting_processed": "first_voice_at",
    "invoice_created": "first_finance_at", "invoice_auto_drafted": "first_finance_at",
    "payment_recorded": "first_finance_at", "expense_added": "first_finance_at", "income_added": "first_finance_at",
    "request_raised": "first_request_at", "workflow_created": "first_workflow_at",
    "contact_added": "first_contact_at", "plan_upgraded": "first_payment_at",
}
# An approved decision is also a decision.
ALSO = {"first_decision_approved_at": "first_decision_at"}
MILESTONE_LABELS = {
    "first_decision_at": "First decision", "first_decision_approved_at": "First decision approved",
    "first_task_at": "First task", "first_task_done_at": "First task done",
    "first_invite_at": "Invited a teammate", "first_capture_at": "First document captured",
    "first_voice_at": "First voice note", "first_finance_at": "First finance entry",
    "first_request_at": "First request", "first_workflow_at": "First workflow",
    "first_contact_at": "First contact", "first_whatsapp_at": "WhatsApp connected",
    "first_brain_doc_at": "First Brain document", "first_payment_at": "First payment",
    "activated_at": "Activated",
}

_set_once: set = set()   # (tenant, key) already written by this process


def _parse(iso) -> Optional[datetime]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def activation_time(created_at, milestones: dict) -> Optional[str]:
    """When the company activated, or None (see the module docstring)."""
    a, b = milestones.get("first_decision_approved_at"), milestones.get("first_invite_at")
    start, ta, tb = _parse(created_at), _parse(a), _parse(b)
    if not (ta and tb):
        return None
    later = max(ta, tb)
    if start and later - start > ACTIVATION_WINDOW:
        return None
    return a if ta >= tb else b


async def _set_if_missing(database, tenant_id: str, key: str, at: str) -> bool:
    res = await database.tenants.update_one(
        {"id": tenant_id, f"milestones.{key}": {"$exists": False}}, {"$set": {f"milestones.{key}": at}})
    return bool(getattr(res, "modified_count", 0))


async def _maybe_activate(database, tenant_id: str) -> None:
    t = await database.tenants.find_one({"id": tenant_id}, {"_id": 0, "created_at": 1, "milestones": 1})
    if not t or (t.get("milestones") or {}).get("activated_at"):
        return
    at = activation_time(t.get("created_at"), t.get("milestones") or {})
    if at:
        await _set_if_missing(database, tenant_id, "activated_at", at)


async def note(tenant_id: str, kind: str, at: str, database=None) -> None:
    """Called from core.log_activity for every activity row."""
    key = KIND_TO_MILESTONE.get(kind)
    if not key or not tenant_id or (tenant_id, key) in _set_once:
        return
    database = database if database is not None else _db
    try:
        for k in (key, ALSO.get(key)):
            if k and (tenant_id, k) not in _set_once:
                await _set_if_missing(database, tenant_id, k, at)
                _set_once.add((tenant_id, k))
        if key in ("first_decision_approved_at", "first_invite_at"):
            await _maybe_activate(database, tenant_id)
    except Exception as e:
        logger.warning(f"[milestones] {kind} for {str(tenant_id)[:8]} failed: {e}")


# Where each first is read from for companies that existed before milestones
# were recorded: (milestone, collection, time field, extra match).
SOURCES = [
    ("first_decision_at", "decisions", "created_at", None),
    ("first_decision_approved_at", "decisions", "decided_at", {"status": "approved"}),
    ("first_task_at", "tasks", "created_at", None),
    ("first_task_done_at", "tasks", "completed_at", None),
    ("first_invite_at", "memberships", "invited_at", {"role": {"$ne": "owner"}}),
    ("first_capture_at", "capture_drafts", "created_at", None),
    ("first_voice_at", "voice_notes", "created_at", None),
    ("first_request_at", "requests", "created_at", None),
    ("first_workflow_at", "workflows", "created_at", None),
    ("first_contact_at", "contacts", "created_at", None),
    ("first_whatsapp_at", "wa_events", "created_at", None),
    ("first_brain_doc_at", "brain_documents", "created_at", None),
    ("first_payment_at", "billing_events", "created_at",
     {"event": {"$in": ["payment.captured", "subscription.charged"]}}),
    ("first_finance_at", "invoices", "created_at", None),
    ("first_finance_at", "expenses", "created_at", None),
    ("first_finance_at", "payments", "created_at", None),
]


async def _firsts(database, tenant_ids: Optional[list] = None) -> dict:
    """{tenant: {milestone: earliest time}} -- ONE grouped question per
    source for every company at once (per company it was fourteen hundred
    round trips to the hosted database for a hundred companies)."""
    out: dict = {}
    for key, coll, field, match in SOURCES:
        m = {field: {"$exists": True, "$ne": None}, **(match or {})}
        if tenant_ids is not None:
            m["tenant_id"] = {"$in": list(tenant_ids)}
        cur = await database[coll].aggregate([
            {"$match": m}, {"$group": {"_id": "$tenant_id", "m": {"$min": f"${field}"}}}])
        for r in await cur.to_list(100000):
            if not r.get("_id") or not r.get("m"):
                continue
            at = str(r["m"])
            cur_at = out.setdefault(r["_id"], {}).get(key)
            if cur_at is None or at < cur_at:
                out[r["_id"]][key] = at
    return out


async def backfill_all(database=None, tenant_ids: Optional[list] = None) -> dict:
    """Fill the milestones companies reached before they were recorded, and
    activation. Never overwrites one already set. Returns {tenant: written}."""
    database = database if database is not None else _db
    q = {"id": {"$in": list(tenant_ids)}} if tenant_ids is not None else {}
    tenants = await database.tenants.find(q, {"_id": 0, "id": 1, "created_at": 1, "milestones": 1}).to_list(10000)
    found = await _firsts(database, tenant_ids)
    written_all = {}
    for t in tenants:
        have = dict(t.get("milestones") or {})
        new = {k: v for k, v in (found.get(t["id"]) or {}).items() if k not in have}
        merged = {**have, **new}
        if "activated_at" not in merged:
            act = activation_time(t.get("created_at"), merged)
            if act:
                new["activated_at"] = act
        # Only keys still missing are written, so a first recorded since the
        # read above is never overwritten.
        for k, v in new.items():
            await _set_if_missing(database, t["id"], k, v)
        if new:
            written_all[t["id"]] = new
    return written_all


async def backfill_tenant(tenant_id: str, database=None) -> dict:
    """The backfill for one company."""
    return (await backfill_all(database=database, tenant_ids=[tenant_id])).get(tenant_id, {})

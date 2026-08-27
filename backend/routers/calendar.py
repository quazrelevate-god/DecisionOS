"""Business calendar + leave-approver-map endpoints (Epic 8 Sprint 3 -- from server.py).

The unified upcoming-events calendar (payments/tasks/deliveries/complaints/
birthdays/meetings) and the tenant leave-approver mapping. Leave-creation
helpers (_resolve_leave_approver, _create_leave) stay in server.
"""
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends

from core import db, get_current_user, require_perm, tenant_role_keys, user_perms

router = APIRouter(prefix="/api")




# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.calendar import (
    LeaveApproverMapInput,
)


@router.patch("/tenant/leave-approvers")
async def update_leave_approvers(inp: LeaveApproverMapInput, user: dict = Depends(require_perm("team_manage"))):
    role_keys = await tenant_role_keys(user["tenant_id"])
    clean = {}
    for role, aid in (inp.approvers or {}).items():
        if role not in role_keys or not aid:
            continue
        m = await db.users.find_one({"id": aid, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
        if m:
            clean[role] = aid
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"leave_approvers": clean}})
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@router.get("/calendar")
async def business_calendar(days: int = 45, user: dict = Depends(get_current_user)):
    """Unified business calendar: upcoming payments due, task deadlines, deliveries, complaints, birthdays."""
    tid = user["tenant_id"]
    can_finance = user.get("role") == "owner" or "finance" in user_perms(user)
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=14)).date().isoformat()
    end = (now + timedelta(days=days)).date().isoformat()
    events = []

    def add(date, etype, title, subtitle="", contact_id=None, entity_id=None, amount=None):
        d = (date or "")[:10]
        if not d:
            return
        events.append({"date": d, "type": etype, "title": title, "subtitle": subtitle,
                       "contact_id": contact_id, "entity_id": entity_id, "amount": amount,
                       "overdue": d < now.date().isoformat()})

    # Payments due (unpaid sales invoices) — finance only
    if can_finance:
        invs = await db.invoices.find(
            {"tenant_id": tid, "type": "sales_invoice", "status": {"$ne": "paid"}, "due_date": {"$ne": None}},
            {"_id": 0}).to_list(500)
        for i in invs:
            add(i.get("due_date"), "payment_due",
                f"Payment due: {i.get('contact_name') or 'Customer'}",
                f"{i.get('currency') or ''} {i.get('amount')}", i.get("contact_id"), i.get("id"), i.get("amount"))

    # Task deadlines (open)
    tasks = await db.tasks.find(
        {"tenant_id": tid, "status": {"$in": ["todo", "in_progress", "blocked"]}, "due_date": {"$ne": None}},
        {"_id": 0}).to_list(500)
    for t in tasks:
        add(t.get("due_date"), "task", t.get("title", "Task"),
            (t.get("assignee_role") or "team"), None, t.get("id"))

    # Deliveries (open distribution workflows; includes legacy sales_dispatch cards)
    # FIX-001-F: dynamic terminal stages (leave the type hardcode as a
    # follow-up: needs a tenant_sales_pipeline resolver similar to the one
    # tenant_procurement_pipeline provides — logged separately).
    from services.workflows import tenant_terminal_stages as _tts
    _cal_term = await _tts(tid)
    wfs = await db.workflows.find(
        {"tenant_id": tid, "type": {"$in": ["distribution", "sales_dispatch"]}, "stage": {"$nin": _cal_term}},
        {"_id": 0}).to_list(300)
    for w in wfs:
        dt = w.get("expected_date") or w.get("due_date")
        if dt:
            add(dt, "delivery", f"Delivery: {w.get('title') or w.get('counterparty') or 'Order'}",
                (w.get("stage") or "").replace("_", " "), w.get("contact_id"), w.get("id"))

    # Complaints (recent)
    comps = await db.complaints.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for c in comps:
        add(c.get("created_at"), "complaint", f"Complaint: {(c.get('text') or '')[:50]}",
            c.get("severity") or "", c.get("customer_id"), c.get("id"))

    # Birthdays (this year, from contact.birthday MM-DD or YYYY-MM-DD)
    contacts = await db.contacts.find({"tenant_id": tid, "birthday": {"$nin": [None, ""]}},
                                      {"_id": 0, "id": 1, "name": 1, "birthday": 1}).to_list(500)
    for c in contacts:
        b = (c.get("birthday") or "").strip()
        md = b[-5:] if len(b) >= 5 else ""
        if len(md) == 5 and "-" in md:
            add(f"{now.year}-{md}", "birthday", f"Birthday: {c.get('name')}", "", c.get("id"))

    # Meetings scheduled from directives
    mevs = await db.calendar_events.find({"tenant_id": tid}, {"_id": 0}).to_list(300)
    for ev in mevs:
        add(ev.get("date"), "meeting", ev.get("title", "Meeting"), ev.get("when_text", ""), None, ev.get("id"))

    # Approved leaves (team availability)
    lvs = await db.leaves.find({"tenant_id": tid, "status": "approved"}, {"_id": 0}).to_list(300)
    for lv in lvs:
        fd, td = (lv.get("from_date") or "")[:10], (lv.get("to_date") or "")[:10]
        if not fd:
            continue
        portion = " (half day)" if lv.get("day_portion") == "half" else ""
        sub = f"{(lv.get('leave_type') or 'leave').title()}{portion}"
        add(fd, "leave", f"On leave: {lv.get('user_name')}", sub, None, lv.get("id"))
        if td and td != fd:
            add(td, "leave", f"Leave ends: {lv.get('user_name')}", sub, None, lv.get("id"))

    events = [e for e in events if start <= e["date"] <= end]
    for e in events:
        if e["type"] in ("birthday", "leave"):
            e["overdue"] = False
    events.sort(key=lambda e: e["date"])
    days_map = {}
    for e in events:
        days_map.setdefault(e["date"], []).append(e)
    grouped = [{"date": d, "events": evs} for d, evs in sorted(days_map.items())]
    counts = {}
    for e in events:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    return {"days": grouped, "counts": counts, "total": len(events)}

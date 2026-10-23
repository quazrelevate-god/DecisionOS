"""Admin console -- support desk & tickets (Epic 10 Sprint 3).

A ticket inbox tied to tenants: super-admins triage, thread, and resolve support
requests (raised by owners via /api/support or created here on a tenant's behalf),
and can jump straight to impersonation for the ticket's workspace. Every mutation
is audited. Tenant-facing submission lives in routers/support.py.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core import db, get_platform_admin, new_id, now_iso
from routers.admin import log_admin_action

router = APIRouter(prefix="/api/admin")

STATUSES = ("open", "pending", "resolved", "closed")
PRIORITIES = ("low", "normal", "high", "urgent")
# First-reply targets by priority (admin console v2 P4, 2026-10-23). The clock
# runs from when the ticket was raised until our first reply.
SLA_HOURS = {"urgent": 4, "high": 8, "normal": 24, "low": 72}
DUE_SOON = 0.25  # the last quarter of the window reads as "due soon"


def _parse(iso):
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def sla_of(t: dict, now: Optional[datetime] = None) -> dict:
    """Where a ticket stands against its first-reply target.

    state: met (replied in time) | late (replied, but after the target) |
    breached (no reply, past the target) | due_soon | waiting | none (raised by
    us, or closed before anyone replied)."""
    now = now or datetime.now(timezone.utc)
    hours = SLA_HOURS.get(t.get("priority") or "normal", 24)
    created = _parse(t.get("created_at"))
    if not created:
        return {"state": "none", "target_hours": hours}
    due = created + timedelta(hours=hours)
    out = {"target_hours": hours, "due_at": due.isoformat()}
    first = _parse(t.get("first_response_at"))
    if t.get("created_by_type") == "admin":
        return {**out, "state": "none"}
    if first:
        took = (first - created).total_seconds() / 3600
        return {**out, "state": "met" if first <= due else "late", "took_hours": round(took, 1)}
    if t.get("status") in ("resolved", "closed"):
        return {**out, "state": "none"}
    left = (due - now).total_seconds() / 3600
    if left < 0:
        return {**out, "state": "breached", "over_hours": round(-left, 1)}
    return {**out, "state": "due_soon" if left <= hours * DUE_SOON else "waiting", "left_hours": round(left, 1)}


class TicketCreateInput(BaseModel):
    tenant_id: str
    subject: str
    body: str = ""
    priority: str = "normal"


class TicketReplyInput(BaseModel):
    body: str


class TicketPatchInput(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_admin: Optional[str] = None


def _pub(t: dict) -> dict:
    t.pop("_id", None)
    return t


async def _tenant_name(tid: str) -> str:
    t = await db.tenants.find_one({"id": tid}, {"_id": 0, "name": 1, "company_name": 1})
    return (t or {}).get("company_name") or (t or {}).get("name") or tid if t else "(deleted workspace)"


@router.get("/tickets")
async def admin_tickets(admin: dict = Depends(get_platform_admin),
                        status: Optional[str] = None, priority: Optional[str] = None,
                        tenant_id: Optional[str] = None,
                        limit: int = Query(100, ge=1, le=500)):
    q = {}
    if status:
        q["status"] = status
    if priority:
        q["priority"] = priority
    if tenant_id:
        q["tenant_id"] = tenant_id
    rows = await db.support_tickets.find(q, {"_id": 0, "messages": 0}).sort("updated_at", -1).to_list(limit)
    # Asked together, not one after another (2026-10-03): four round trips
    # to the hosted database cost four times the wait for the same answer.
    ns = await asyncio.gather(*(db.support_tickets.count_documents({"status": s}) for s in STATUSES))
    counts = dict(zip(STATUSES, ns))
    now = datetime.now(timezone.utc)
    for r in rows:
        r["sla"] = sla_of(r, now)
    return {"tickets": rows, "counts": counts, "sla": await _sla_summary(now)}


async def _sla_summary(now: datetime) -> dict:
    """Open tickets past their first-reply target, and how we did on the last
    30 days of tickets: share replied in time and the median first reply."""
    since = (now - timedelta(days=30)).isoformat()
    live = await db.support_tickets.find(
        {"status": {"$in": ["open", "pending"]}, "first_response_at": {"$in": [None]}},
        {"_id": 0, "priority": 1, "created_at": 1, "created_by_type": 1, "status": 1}).to_list(2000)
    recent = await db.support_tickets.find(
        {"created_at": {"$gte": since}, "created_by_type": {"$ne": "admin"}},
        {"_id": 0, "priority": 1, "created_at": 1, "first_response_at": 1,
         "created_by_type": 1, "status": 1}).to_list(5000)
    states = [sla_of(t, now)["state"] for t in live]
    answered = [s for s in (sla_of(t, now) for t in recent) if s["state"] in ("met", "late")]
    took = sorted(s["took_hours"] for s in answered)
    return {
        "breached": states.count("breached"), "due_soon": states.count("due_soon"),
        "met_pct": round(100 * sum(1 for s in answered if s["state"] == "met") / len(answered)) if answered else None,
        "median_first_reply_hours": took[len(took) // 2] if took else None,
        "answered_30d": len(answered), "targets": SLA_HOURS,
    }


@router.post("/tickets")
async def admin_create_ticket(payload: TicketCreateInput, admin: dict = Depends(get_platform_admin)):
    if not payload.subject.strip():
        raise HTTPException(status_code=422, detail="Subject is required")
    if not await db.tenants.find_one({"id": payload.tenant_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Workspace not found")
    prio = payload.priority if payload.priority in PRIORITIES else "normal"
    tid = new_id()
    now = now_iso()
    doc = {
        "id": tid, "tenant_id": payload.tenant_id, "tenant_name": await _tenant_name(payload.tenant_id),
        "subject": payload.subject.strip()[:200], "status": "open", "priority": prio,
        "created_by": admin.get("email"), "created_by_type": "admin",
        "assigned_admin": admin.get("email"), "created_at": now, "updated_at": now,
        "first_response_at": now if payload.body.strip() else None,
        "messages": ([{"author": admin.get("email"), "author_type": "admin",
                       "body": payload.body.strip(), "created_at": now}] if payload.body.strip() else []),
    }
    await db.support_tickets.insert_one(dict(doc))
    await log_admin_action(admin, "ticket_create", f"Opened ticket '{doc['subject']}' for {doc['tenant_name']}",
                           "ticket", tid)
    return _pub(doc)


@router.get("/tickets/{ticket_id}")
async def admin_ticket_detail(ticket_id: str, admin: dict = Depends(get_platform_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    t["sla"] = sla_of(t)
    return t


@router.post("/tickets/{ticket_id}/reply")
async def admin_ticket_reply(ticket_id: str, payload: TicketReplyInput,
                             admin: dict = Depends(get_platform_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id},
                                          {"_id": 0, "id": 1, "tenant_name": 1, "first_response_at": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Message is required")
    now = now_iso()
    msg = {"author": admin.get("email"), "author_type": "admin", "body": body[:4000], "created_at": now}
    sets = {"updated_at": now, "status": "pending"}
    if not t.get("first_response_at"):
        sets["first_response_at"] = now  # the SLA clock stops on our first reply
    await db.support_tickets.update_one(
        {"id": ticket_id}, {"$push": {"messages": msg}, "$set": sets, "$unset": {"resolved_at": ""}})
    await log_admin_action(admin, "ticket_reply", f"Replied to ticket {ticket_id} ({t.get('tenant_name')})",
                           "ticket", ticket_id)
    return {"status": "ok", "message": msg}


@router.patch("/tickets/{ticket_id}")
async def admin_ticket_patch(ticket_id: str, payload: TicketPatchInput,
                             admin: dict = Depends(get_platform_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "tenant_name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    sets = {"updated_at": now_iso()}
    changes = []
    unsets = {}
    if payload.status and payload.status in STATUSES:
        sets["status"] = payload.status
        changes.append(f"status={payload.status}")
        if payload.status in ("resolved", "closed"):
            sets["resolved_at"] = sets["updated_at"]
        else:
            unsets["resolved_at"] = ""
    if payload.priority and payload.priority in PRIORITIES:
        sets["priority"] = payload.priority
        changes.append(f"priority={payload.priority}")
    if payload.assigned_admin is not None:
        sets["assigned_admin"] = payload.assigned_admin.strip() or None
        changes.append("reassigned")
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": sets, **({"$unset": unsets} if unsets else {})})
    await log_admin_action(admin, "ticket_update",
                           f"Updated ticket {ticket_id} ({', '.join(changes) or 'no change'})",
                           "ticket", ticket_id)
    return {"status": "ok", **{k: v for k, v in sets.items() if k not in ("updated_at", "resolved_at")}}

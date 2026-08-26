"""Admin console -- support desk & tickets (Epic 10 Sprint 3).

A ticket inbox tied to tenants: super-admins triage, thread, and resolve support
requests (raised by owners via /api/support or created here on a tenant's behalf),
and can jump straight to impersonation for the ticket's workspace. Every mutation
is audited. Tenant-facing submission lives in routers/support.py.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core import db, get_platform_admin, new_id, now_iso
from routers.admin import log_admin_action

router = APIRouter(prefix="/api/admin")

STATUSES = ("open", "pending", "resolved", "closed")
PRIORITIES = ("low", "normal", "high", "urgent")


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
    counts = {}
    for s in STATUSES:
        counts[s] = await db.support_tickets.count_documents({"status": s})
    return {"tickets": rows, "counts": counts}


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
    return t


@router.post("/tickets/{ticket_id}/reply")
async def admin_ticket_reply(ticket_id: str, payload: TicketReplyInput,
                             admin: dict = Depends(get_platform_admin)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0, "id": 1, "tenant_name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Message is required")
    now = now_iso()
    msg = {"author": admin.get("email"), "author_type": "admin", "body": body[:4000], "created_at": now}
    await db.support_tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": msg}, "$set": {"updated_at": now, "status": "pending"}})
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
    if payload.status and payload.status in STATUSES:
        sets["status"] = payload.status
        changes.append(f"status={payload.status}")
    if payload.priority and payload.priority in PRIORITIES:
        sets["priority"] = payload.priority
        changes.append(f"priority={payload.priority}")
    if payload.assigned_admin is not None:
        sets["assigned_admin"] = payload.assigned_admin.strip() or None
        changes.append("reassigned")
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": sets})
    await log_admin_action(admin, "ticket_update",
                           f"Updated ticket {ticket_id} ({', '.join(changes) or 'no change'})",
                           "ticket", ticket_id)
    return {"status": "ok", **{k: v for k, v in sets.items() if k != "updated_at"}}

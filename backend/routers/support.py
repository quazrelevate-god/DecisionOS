"""Tenant-facing support tickets (Epic 10 Sprint 3).

Lets a workspace owner/member raise a support request and follow the thread. The
ticket lands in the super-admin Support desk (routers/admin_support.py). Writes are
naturally blocked under read-only impersonation (core/deps enforces it).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_current_user, new_id, now_iso

router = APIRouter(prefix="/api/support")

PRIORITIES = ("low", "normal", "high", "urgent")


class SupportTicketInput(BaseModel):
    subject: str
    body: str = ""
    priority: str = "normal"


class SupportReplyInput(BaseModel):
    body: str


@router.get("/tickets")
async def my_tickets(user: dict = Depends(get_current_user)):
    rows = await db.support_tickets.find(
        {"tenant_id": user["tenant_id"]}, {"_id": 0, "messages": 0}
    ).sort("updated_at", -1).to_list(100)
    return {"tickets": rows}


@router.post("/tickets")
async def raise_ticket(payload: SupportTicketInput, user: dict = Depends(get_current_user)):
    if not payload.subject.strip():
        raise HTTPException(status_code=422, detail="Please add a subject")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1, "company_name": 1})
    prio = payload.priority if payload.priority in PRIORITIES else "normal"
    now = now_iso()
    tid = new_id()
    doc = {
        "id": tid, "tenant_id": user["tenant_id"],
        "tenant_name": (tenant or {}).get("company_name") or (tenant or {}).get("name") or user["tenant_id"],
        "subject": payload.subject.strip()[:200], "status": "open", "priority": prio,
        "created_by": user["id"], "created_by_type": "tenant", "created_by_name": user.get("name"),
        "assigned_admin": None, "created_at": now, "updated_at": now,
        "messages": ([{"author": user.get("name") or user["id"], "author_type": "tenant",
                       "body": payload.body.strip()[:4000], "created_at": now}] if payload.body.strip() else []),
    }
    await db.support_tickets.insert_one(dict(doc))
    doc.pop("_id", None)
    return {"status": "ok", "ticket": {k: doc[k] for k in ("id", "subject", "status", "priority", "created_at")}}


@router.get("/tickets/{ticket_id}")
async def my_ticket_detail(ticket_id: str, user: dict = Depends(get_current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


@router.post("/tickets/{ticket_id}/reply")
async def reply_ticket(ticket_id: str, payload: SupportReplyInput, user: dict = Depends(get_current_user)):
    t = await db.support_tickets.find_one(
        {"id": ticket_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    body = (payload.body or "").strip()
    if not body:
        raise HTTPException(status_code=422, detail="Message is required")
    now = now_iso()
    msg = {"author": user.get("name") or user["id"], "author_type": "tenant", "body": body[:4000], "created_at": now}
    await db.support_tickets.update_one(
        {"id": ticket_id}, {"$push": {"messages": msg}, "$set": {"updated_at": now, "status": "open"}})
    return {"status": "ok", "message": msg}

"""Complaints + shared-memory endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Customer complaints (log / list / resolve, with a brain_context resolution
row) and the tenant shared-memory facts the AI later cites. add_inbox_item
stays in server for now.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (db, new_id, now_iso, log_activity, get_current_user, require_role,
                  require_perm, crm_types, may_see_contact)
from services.ai import brain_context
from services.inbox import add_inbox_item
from services.finance_signals import run_followup

router = APIRouter(prefix="/api")






# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.complaints import (
    ComplaintInput,
    MemoryInput,
)


@router.post("/complaints")
async def create_complaint(inp: ComplaintInput, user: dict = Depends(get_current_user)):
    """J14-05 (JOURNEY-1) — COMPLAINING ABOUT A CUSTOMER NEEDS THE CUSTOMER.

    This asked for `people`, which is access to BOTH sides of the address book.
    A salesperson holds crm_buyers only, so the audit watched her open Ashok
    Pumps on her phone, write "two brackets bent on the last lot", press Log
    complaint — and get a 403. The screen she was given had the button on it.

    The rule that fits the job: you may log a complaint about a contact you are
    allowed to see. Suppliers still need supplier access, customers customer
    access, and somebody with no CRM at all still gets nothing. A complaint with
    no contact attached (a general one) falls back to needing either side, since
    there is no contact to judge it by.
    """
    name = None
    if inp.customer_id:
        c = await db.contacts.find_one({"id": inp.customer_id, "tenant_id": user["tenant_id"]},
                                       {"_id": 0, "name": 1, "company": 1, "type": 1})
        if not c:
            raise HTTPException(status_code=404, detail="That contact isn't in this workspace.")
        if not may_see_contact(user, c.get("type")):
            raise HTTPException(status_code=403, detail="You don't have access to this contact.")
        name = c.get("company") or c.get("name")
    elif not crm_types(user):
        raise HTTPException(status_code=403, detail="You don't have access to contacts.")
    cid = new_id()
    doc = {"id": cid, "tenant_id": user["tenant_id"], "customer_id": inp.customer_id, "customer_name": name,
           "text": inp.text, "severity": inp.severity or "medium", "status": "open",
           "created_by": user["id"], "created_at": now_iso()}
    await db.complaints.insert_one(doc)
    await add_inbox_item(user["tenant_id"], user["id"], "manual", "complaint",
                         f"Complaint: {(name or 'customer')}", inp.text[:180],
                         "complaint", cid, contact_id=inp.customer_id, status="open")
    await log_activity(user["tenant_id"], user["id"], "complaint_logged", f"Complaint logged: {inp.text[:60]}", "complaint", cid)
    doc.pop("_id", None)
    return doc


@router.get("/complaints")
async def list_complaints(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    return await db.complaints.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.patch("/complaints/{cid}/resolve")
async def resolve_complaint(cid: str, user: dict = Depends(get_current_user)):
    """J14-05 — closing a complaint follows the same rule as raising one: the
    contact it is about decides, not access to the whole address book."""
    c = await db.complaints.find_one({"id": cid, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if c and c.get("customer_id"):
        who = await db.contacts.find_one({"id": c["customer_id"], "tenant_id": user["tenant_id"]},
                                         {"_id": 0, "type": 1})
        if who and not may_see_contact(user, who.get("type")):
            raise HTTPException(status_code=403, detail="You don't have access to this contact.")
    elif not crm_types(user):
        raise HTTPException(status_code=403, detail="You don't have access to contacts.")
    res = await db.complaints.update_one({"id": cid, "tenant_id": user["tenant_id"]}, {"$set": {"status": "resolved", "resolved_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    if c:
        await brain_context.record_context(
            tenant_id=user["tenant_id"], kind="resolution",
            title=f"Resolved complaint: {(c.get('text') or '')[:120]}",
            outcome="resolved", why=c.get("text") or "",
            tags=["complaint"], source_type="complaint", source_id=cid,
            actor_id=user["id"], actor_name=user.get("name") or "",
            department=user.get("role") or "", visibility="public",
        )
    return {"ok": True}


@router.get("/memory")
async def list_memory(user: dict = Depends(get_current_user)):
    return await db.memory.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.post("/memory")
async def add_memory(inp: MemoryInput, user: dict = Depends(require_perm("brain"))):
    # FIX-004-C (RBAC-11): writing to shared tenant memory (persistent
    # facts the AI later cites) is a brain-permission action, not a
    # read anyone can do. Read of memory stays open via /memory GET
    # (no perm), only WRITE is gated.
    mid = new_id()
    doc = {"id": mid, "tenant_id": user["tenant_id"], "text": inp.text, "tag": inp.tag or "note",
           "created_by": user["id"], "created_at": now_iso()}
    await db.memory.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/follow-up/run")
async def followup_run(user: dict = Depends(require_perm("team_manage"))):
    # FIX-004-C (RBAC-06): manual follow-up sweep runs the full tenant-
    # wide overdue-task chase (LLM cost + notification spam potential).
    # Restrict to team_manage (owner + designated team admins). Was
    # auth-only which meant any employee could trigger it on-demand.
    await run_followup(user["tenant_id"])
    return {"ok": True}

"""Capture review-queue endpoints (Epic 8 Sprint 3 -- extracted from server.py).

The pending-review queue for WhatsApp/voice captures: list, edit, reassign,
reject, clarify, approve. Approving runs execute_capture (the capture engine,
still in server.py until Sprint 4); _norm_phone + send_wa_reply are also
server-side for now.
"""

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, require_perm, user_perms, now_iso
from services.whatsapp import _norm_phone, send_wa_reply
from services.captures import execute_capture

router = APIRouter(prefix="/api")






async def _get_draft(cid, user):
    d = await db.capture_drafts.find_one({"id": cid, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Capture not found")
    if user["role"] != "owner" and d["reviewer_role"] != user["role"]:
        raise HTTPException(status_code=403, detail="Not your review queue")
    return d


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.captures import (
    CaptureEditInput,
    CaptureActionInput,
)


@router.get("/captures")
async def list_captures(status: str = "pending_review", user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status and status != "all":
        q["status"] = status
    if user["role"] != "owner":
        q["$or"] = [{"reviewer_role": user["role"]}, {"reviewer_perm": {"$in": list(user_perms(user))}}]
    rows = await db.capture_drafts.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    ids = [r["assignee_id"] for r in rows if r.get("assignee_id")]
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(100):
            umap[u["id"]] = u["name"]

    # Resolve the WhatsApp sender phone to a known employee (or contact) in this workspace,
    # so the review queue shows a name + role instead of a raw number.
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    role_labels = {"owner": "Owner"}
    for r in (tenant or {}).get("roles", []) or []:
        role_labels[r.get("key")] = r.get("label") or (r.get("key") or "").title()
    phone_index = {}
    for u in await db.users.find({"tenant_id": user["tenant_id"], "phone": {"$exists": True, "$ne": ""}},
                                 {"_id": 0, "name": 1, "role": 1, "phone": 1}).to_list(2000):
        key = _norm_phone(u.get("phone", ""))
        if key:
            phone_index[key] = {"name": u.get("name"), "role": u.get("role"),
                                "role_label": role_labels.get(u.get("role"), (u.get("role") or "").title()),
                                "kind": "employee"}
    contact_index = {}
    for ct in await db.contacts.find({"tenant_id": user["tenant_id"], "phone": {"$exists": True, "$ne": ""}},
                                     {"_id": 0, "name": 1, "company": 1, "type": 1, "phone": 1}).to_list(2000):
        key = _norm_phone(ct.get("phone", ""))
        if key:
            contact_index[key] = {"name": ct.get("name") or ct.get("company"),
                                  "role_label": (ct.get("type") or "contact").title(), "kind": "contact"}

    for r in rows:
        r["assignee_name"] = umap.get(r.get("assignee_id"))
        wa = r.get("wa_from")
        if wa:
            k = _norm_phone(wa)
            sender = phone_index.get(k) or contact_index.get(k)
            if sender:
                r["sender_name"] = sender["name"]
                r["sender_role"] = sender.get("role_label")
                r["sender_kind"] = sender["kind"]
    return rows


@router.get("/captures/pending-count")
async def captures_pending_count(user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"], "status": {"$in": ["pending_review", "needs_attention"]}}
    if user["role"] != "owner":
        q["$or"] = [{"reviewer_role": user["role"]}, {"reviewer_perm": {"$in": list(user_perms(user))}}]
    return {"count": await db.capture_drafts.count_documents(q)}


@router.patch("/captures/{cid}")
async def edit_capture(cid: str, inp: CaptureEditInput, user: dict = Depends(get_current_user)):
    await _get_draft(cid, user)
    updates = {k: v for k, v in inp.dict().items() if v is not None}
    if updates:
        await db.capture_drafts.update_one({"id": cid}, {"$set": updates})
    return await db.capture_drafts.find_one({"id": cid}, {"_id": 0})


@router.post("/captures/{cid}/reassign")
async def reassign_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): reassigning a captured draft rewrites the
    # target person on a real record about to be committed. Only users
    # with the approvals permission (owner + designated approvers)
    # should do this — was auth-only, which meant any employee could
    # steer an approval flow's target.
    await _get_draft(cid, user)
    updates = {}
    if inp.reviewer_role:
        updates["reviewer_role"] = inp.reviewer_role
    if inp.assignee_id is not None:
        updates["assignee_id"] = inp.assignee_id or None
    if updates:
        await db.capture_drafts.update_one({"id": cid}, {"$set": updates})
    return {"ok": True}


@router.post("/captures/{cid}/reject")
async def reject_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): same rationale as reassign — approvals perm gate.
    await _get_draft(cid, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "rejected", "review_action": "rejected", "reviewed_by": user["id"],
        "reviewed_at": now_iso(), "clarification_note": inp.reason or "",
    }})
    return {"ok": True}


@router.post("/captures/{cid}/clarify")
async def clarify_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): approvals perm gate — clarify shapes what
    # the approver will see, same authority tier as approve/reject.
    d = await _get_draft(cid, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "clarification_requested", "review_action": "clarify",
        "reviewed_by": user["id"], "reviewed_at": now_iso(), "clarification_note": inp.note or "",
    }})
    if d.get("wa_from") and inp.note:
        await send_wa_reply(d["wa_from"], f"❓ Clarification needed on your message: {inp.note}")
    return {"ok": True}


@router.post("/captures/{cid}/approve")
async def approve_capture(cid: str, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): approving a capture creates real workflow /
    # task / decision records. Explicit approvals-permission gate;
    # was auth-only which let any employee commit captured drafts.
    d = await _get_draft(cid, user)
    if d["status"] not in ("pending_review", "clarification_requested", "needs_attention"):
        raise HTTPException(status_code=400, detail="Already processed")
    if d.get("needs_owner") and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="This item requires Owner approval")
    result = await execute_capture(d, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "executed", "review_action": "approved", "reviewed_by": user["id"],
        "reviewed_at": now_iso(), "result_ref": result,
    }})
    if d.get("wa_from"):
        await send_wa_reply(d["wa_from"], "✅ Approved and actioned in DecisionOS.")
    return {"ok": True, "result": result}

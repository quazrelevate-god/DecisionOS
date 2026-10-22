"""Accepting an admin invite (2026-10-22) — the two PUBLIC doors.

Deliberately outside /api/admin: everything under that prefix sits behind the
platform-admin gate (tests/test_admin_parity), and the person opening an invite
is not an admin yet. What protects these is the link itself — a 256-bit token,
stored only as a hash, single use, expiring after a week.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import db, hash_password, new_id, now_iso
from services.admin_invites import find_invited

router = APIRouter(prefix="/api/invites")


class AcceptInput(BaseModel):
    password: str


@router.get("/admin/{token}")
async def view_admin_invite(token: str):
    a = await find_invited(token)
    if not a:
        return {"valid": False}
    return {"valid": True, "email": a.get("email"), "name": a.get("name"), "role": a.get("role")}


@router.post("/admin/{token}/accept")
async def accept_admin_invite(token: str, payload: AcceptInput):
    a = await find_invited(token)
    if not a:
        raise HTTPException(status_code=410, detail="This invite link has expired or was already used. Ask for a new one.")
    if len(payload.password or "") < 10:
        raise HTTPException(status_code=422, detail="Use at least 10 characters")
    res = await db.platform_admins.update_one(
        {"id": a["id"], "password_hash": {"$exists": False}},
        {"$set": {"password_hash": hash_password(payload.password), "invite_accepted_at": now_iso()},
         "$unset": {"invite": ""}})
    if not getattr(res, "modified_count", 0):
        raise HTTPException(status_code=410, detail="This invite link was already used.")
    await db.platform_audit.insert_one({
        "id": new_id(), "admin_id": a["id"], "admin_email": a.get("email"),
        "action": "admin_invite_accepted", "message": f"{a.get('email')} accepted their invite and set a password",
        "target_type": "admin", "target_id": a["id"], "created_at": now_iso(),
    })
    return {"status": "ok", "email": a.get("email")}

"""Admin console -- admin RBAC & security (Epic 10 Sprint 7).

Platform-admin accounts get roles (super_admin / support / billing / read_only,
enforced by get_platform_admin + require_admin_role) plus TOTP 2FA. super_admins
manage admin accounts; every admin can enrol their own 2FA. All writes audited.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_platform_admin, require_admin_role, ADMIN_ROLES, new_id, now_iso, hash_password
from services.auth import totp
from routers.admin import log_admin_action

router = APIRouter(prefix="/api/admin")


class AdminCreateInput(BaseModel):
    email: str
    name: str = ""
    role: str = "support"
    password: str


class AdminPatchInput(BaseModel):
    role: Optional[str] = None
    active: Optional[bool] = None


class CodeInput(BaseModel):
    code: str


def _pub(a: dict) -> dict:
    return {"id": a["id"], "email": a.get("email"), "name": a.get("name"),
            "role": a.get("role") or "super_admin", "active": a.get("active", True),
            "last_login": a.get("last_login"), "two_factor": bool((a.get("two_factor") or {}).get("enabled_secret")),
            "created_at": a.get("created_at")}


# --- Admin account management (super_admin only) ----------------------------
@router.get("/admins")
async def list_admins(admin: dict = Depends(require_admin_role("super_admin"))):
    rows = await db.platform_admins.find({}, {"_id": 0}).sort("created_at", 1).to_list(200)
    return {"admins": [_pub(a) for a in rows], "roles": list(ADMIN_ROLES)}


@router.post("/admins")
async def create_admin(payload: AdminCreateInput, admin: dict = Depends(require_admin_role("super_admin"))):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Valid email required")
    if payload.role not in ADMIN_ROLES:
        raise HTTPException(status_code=422, detail=f"role must be one of {list(ADMIN_ROLES)}")
    if len(payload.password or "") < 10:
        raise HTTPException(status_code=422, detail="Password must be at least 10 characters")
    if await db.platform_admins.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=409, detail="An admin with this email already exists")
    doc = {"id": new_id(), "email": email, "name": payload.name.strip() or email,
           "role": payload.role, "active": True, "password_hash": hash_password(payload.password),
           "created_at": now_iso(), "created_by": admin.get("email")}
    await db.platform_admins.insert_one(dict(doc))
    await log_admin_action(admin, "admin_create", f"Created admin {email} (role={payload.role})", "admin", doc["id"])
    return _pub(doc)


@router.patch("/admins/{admin_id}")
async def patch_admin(admin_id: str, payload: AdminPatchInput,
                      admin: dict = Depends(require_admin_role("super_admin"))):
    target = await db.platform_admins.find_one({"id": admin_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")
    if admin_id == admin.get("id") and (payload.role and payload.role != "super_admin" or payload.active is False):
        raise HTTPException(status_code=422, detail="You can't demote or deactivate your own account")
    sets = {}
    if payload.role is not None:
        if payload.role not in ADMIN_ROLES:
            raise HTTPException(status_code=422, detail=f"role must be one of {list(ADMIN_ROLES)}")
        sets["role"] = payload.role
    if payload.active is not None:
        sets["active"] = bool(payload.active)
    if not sets:
        raise HTTPException(status_code=422, detail="Nothing to change")
    await db.platform_admins.update_one({"id": admin_id}, {"$set": sets})
    await log_admin_action(admin, "admin_update", f"Updated admin {target.get('email')}: {sets}", "admin", admin_id)
    return {"status": "ok", **sets}


# --- Self-service 2FA (any admin) -------------------------------------------
@router.get("/2fa/status")
async def twofa_status(admin: dict = Depends(get_platform_admin)):
    return {"enabled": totp.is_enabled(admin)}


@router.post("/2fa/enroll")
async def twofa_enroll(admin: dict = Depends(get_platform_admin)):
    if totp.is_enabled(admin):
        raise HTTPException(status_code=409, detail="2FA already enabled")
    enrollment = totp.begin_enrollment(admin, "DecisionOS Admin")
    await db.platform_admins.update_one(
        {"id": admin["id"]}, {"$set": {"two_factor.pending_secret": enrollment["secret"]}})
    return {"secret": enrollment["secret"], "provisioning_uri": enrollment["provisioning_uri"]}


@router.post("/2fa/confirm")
async def twofa_confirm(payload: CodeInput, admin: dict = Depends(get_platform_admin)):
    fresh = await db.platform_admins.find_one({"id": admin["id"]}, {"_id": 0})
    pending = (fresh.get("two_factor") or {}).get("pending_secret")
    if not pending:
        raise HTTPException(status_code=409, detail="Start enrollment first")
    if not totp.verify_totp({"two_factor": {"enabled_secret": pending}}, payload.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    backup = totp._generate_backup_codes()
    hashed = [totp._hash_code(c) for c in backup]
    await db.platform_admins.update_one(
        {"id": admin["id"]},
        {"$set": {"two_factor.enabled_secret": pending, "two_factor.backup_codes": hashed,
                  "two_factor.enabled_at": now_iso()},
         "$unset": {"two_factor.pending_secret": ""}})
    await log_admin_action(admin, "admin_2fa_enable", "Enabled 2FA", "admin", admin["id"])
    return {"status": "ok", "backup_codes": backup}


@router.post("/2fa/disable")
async def twofa_disable(payload: CodeInput, admin: dict = Depends(get_platform_admin)):
    fresh = await db.platform_admins.find_one({"id": admin["id"]}, {"_id": 0})
    if not totp.is_enabled(fresh):
        return {"status": "ok", "enabled": False}
    if not totp.verify_totp(fresh, payload.code):
        raise HTTPException(status_code=400, detail="Invalid code")
    await db.platform_admins.update_one({"id": admin["id"]}, {"$unset": {"two_factor": ""}})
    await log_admin_action(admin, "admin_2fa_disable", "Disabled 2FA", "admin", admin["id"])
    return {"status": "ok", "enabled": False}

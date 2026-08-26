"""Admin console -- support impersonation (Epic 10 Sprint 2).

Secure, time-boxed, audited, READ-FIRST 'view as tenant' for support. A super-admin
mints a short-lived impersonation token bound to an impersonation_sessions record;
get_current_user (core/deps) verifies the session is live and blocks writes when
read_only. Every grant + revoke is written to the platform audit log.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_platform_admin, new_id, now_iso, create_impersonation_token
from routers.admin import log_admin_action

router = APIRouter(prefix="/api/admin")

_MAX_MINUTES = 240
_DEFAULT_MINUTES = 30


class ImpersonateInput(BaseModel):
    reason: str = ""
    target_user_id: Optional[str] = None   # defaults to the tenant owner
    minutes: int = _DEFAULT_MINUTES
    read_only: bool = True


def _tname(t: dict) -> str:
    return t.get("company_name") or t.get("name") or t.get("id")


@router.post("/tenants/{tenant_id}/impersonate")
async def admin_impersonate(tenant_id: str, payload: ImpersonateInput,
                            admin: dict = Depends(get_platform_admin)):
    """Start a time-boxed impersonation session and return the token to use."""
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "company_name": 1})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Resolve the target user: an explicit member, else the workspace owner.
    if payload.target_user_id:
        target = await db.users.find_one(
            {"id": payload.target_user_id, "tenant_id": tenant_id},
            {"_id": 0, "id": 1, "name": 1, "role": 1})
        if not target:
            raise HTTPException(status_code=404, detail="Target user not in this workspace")
    else:
        target = await db.users.find_one(
            {"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1, "name": 1, "role": 1})
        if not target:
            raise HTTPException(status_code=422, detail="No owner to impersonate; pass target_user_id")

    minutes = max(1, min(int(payload.minutes or _DEFAULT_MINUTES), _MAX_MINUTES))
    session_id = new_id()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    session = {
        "id": session_id, "admin_email": admin.get("email"), "tenant_id": tenant_id,
        "tenant_name": _tname(tenant), "target_user_id": target["id"],
        "target_name": target.get("name"), "target_role": target.get("role"),
        "read_only": bool(payload.read_only), "reason": (payload.reason or "").strip()[:300],
        "granted_at": now_iso(), "expires_at": expires_at, "revoked": False,
    }
    await db.impersonation_sessions.insert_one(dict(session))
    token = create_impersonation_token(
        target_user_id=target["id"], tenant_id=tenant_id, role=target.get("role") or "owner",
        admin_email=admin.get("email"), session_id=session_id,
        read_only=bool(payload.read_only), minutes=minutes)
    await log_admin_action(
        admin, "impersonate_start",
        f"Started {'read-only ' if payload.read_only else ''}impersonation of {target.get('name')} "
        f"@ {_tname(tenant)} ({minutes}m). Reason: {session['reason'] or '—'}",
        "tenant", tenant_id)
    session.pop("_id", None)
    return {"token": token, "session": session, "expires_at": expires_at}


@router.get("/impersonation")
async def admin_impersonation_list(admin: dict = Depends(get_platform_admin), limit: int = 100):
    """Recent impersonation sessions (newest first) with a live/expired/revoked status."""
    rows = await db.impersonation_sessions.find({}, {"_id": 0}).sort("granted_at", -1).to_list(min(limit, 500))
    now = now_iso()
    for r in rows:
        r["status"] = ("revoked" if r.get("revoked")
                       else "expired" if (r.get("expires_at") or "") < now
                       else "live")
    return {"sessions": rows,
            "active": sum(1 for r in rows if r["status"] == "live")}


@router.post("/impersonation/{session_id}/revoke")
async def admin_impersonation_revoke(session_id: str, admin: dict = Depends(get_platform_admin)):
    """End an impersonation session immediately (the token stops working on next request)."""
    sess = await db.impersonation_sessions.find_one({"id": session_id}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.impersonation_sessions.update_one(
        {"id": session_id}, {"$set": {"revoked": True, "revoked_at": now_iso()}})
    await log_admin_action(
        admin, "impersonate_end",
        f"Ended impersonation of {sess.get('target_name')} @ {sess.get('tenant_name')}",
        "tenant", sess.get("tenant_id"))
    return {"status": "ok", "revoked": True}

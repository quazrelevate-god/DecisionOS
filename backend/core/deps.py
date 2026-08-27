"""Request dependencies: the FastAPI auth/permission Depends() callables.

Extracted from core.py (Epic 8 Sprint 2). get_current_user resolves the JWT
(cookie or bearer) into the tenant-scoped user dict -- revocation check,
session touch, membership projection, permission maps; require_role /
require_perm gate endpoints; tenant_role_keys lists a tenant's role keys.
core re-exports all four.
"""
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import Request, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from database import db
from config import AUTH_COOKIE_NAME, JWT_SECRET, JWT_ALGORITHM
from core.security import bearer_scheme
from core.permissions import user_perms
from core.usage import set_usage_tenant


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    # Prefer HttpOnly cookie; fall back to Bearer token for backward compatibility.
    token = request.cookies.get(AUTH_COOKIE_NAME) or (creds.credentials if creds else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    # Support impersonation (Epic 10 S2): an impersonation token carries an `imp`
    # claim. Verify the impersonation_sessions record is still live and enforce
    # read-only by blocking any mutating request. Session-based revocation replaces
    # the jti check below (the `and not _imp` guard).
    _imp = payload.get("imp")
    if _imp:
        _sess = await db.impersonation_sessions.find_one({"id": _imp.get("session_id")})
        _now = datetime.now(timezone.utc).isoformat()
        if (not _sess) or _sess.get("revoked") or (_sess.get("expires_at") or "") < _now:
            raise HTTPException(status_code=401, detail="Impersonation session has ended")
        if _imp.get("read_only", True) and request.method not in ("GET", "HEAD", "OPTIONS"):
            raise HTTPException(
                status_code=403,
                detail="Read-only impersonation: writes are blocked. End impersonation to act as an admin.",
            )
    # FIX-003-C (S2-06): revocation check. A user who hit /logout
    # invalidated their jti; the token is still cryptographically
    # valid until `exp`, but we must refuse to honor it. Deferred
    # import breaks the core.py <-> services cycle. See
    # services/session_revocation.py for the fail-open contract.
    jti = payload.get("jti")
    if jti and not _imp:
        from services.auth.session_revocation import is_revoked as _is_revoked
        if await _is_revoked(db, jti):
            raise HTTPException(status_code=401, detail="Session ended, please log in again")
        # FIX-004-G (RBAC-21): bump last_seen_at so /me/sessions
        # shows accurate "active X minutes ago". Best-effort — a
        # failed touch never fails the request.
        from services.auth.session_tracking import touch_session as _touch
        try:
            await _touch(db, jti)
        except Exception:
            pass
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("suspended") or user.get("tenant_suspended"):
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact your administrator.")
    # Impersonation flags survive project_membership_onto_user (it copies the dict),
    # so /me + audit + the app banner can see them on every downstream call site.
    if _imp:
        user["_impersonated_by"] = _imp.get("admin")
        user["_impersonation_session"] = _imp.get("session_id")
        user["_read_only"] = bool(_imp.get("read_only", True))
    # FIX-004-B (RBAC-13): resolve the current-tenant membership. The
    # JWT carries a `tenant_id` claim chosen at login (or via
    # /me/switch-workspace); we look up the corresponding membership
    # and project its role + permissions onto the user dict so ~430
    # downstream call sites keep reading `user["role"]` /
    # `user["permissions"]` unchanged. If the user has NO membership
    # in the claimed tenant (removed by admin between login + this
    # request), refuse the token.
    from services.auth.membership import (
        find_membership as _find_membership,
        project_membership_onto_user as _project,
        LIVE_STATUSES as _LIVE_STATUSES,
    )
    claimed_tenant = payload.get("tenant_id")
    if not claimed_tenant:
        # Legacy token issued before FIX-004-B (no tenant_id claim
        # possible — the field has always been present). Fail closed.
        raise HTTPException(status_code=401, detail="Invalid token — please log in again")
    membership = await _find_membership(
        db, user["id"], claimed_tenant, statuses=_LIVE_STATUSES,
    )
    if not membership:
        # Compat: existing users still have the legacy tenant_id/role
        # fields on the user doc until the backfill migration runs.
        # If those exist AND match the JWT claim, trust them as a
        # fallback so a mid-migration boot doesn't lock everyone out.
        if user.get("tenant_id") == claimed_tenant and user.get("role"):
            set_usage_tenant(user.get("tenant_id"))
            return user
        raise HTTPException(
            status_code=403,
            detail="You no longer have access to this workspace. Please log in again.",
        )
    user = _project(user, membership)
    # FIX-004-D (RBAC-14 + RBAC-15): fetch tenant's role permission
    # overrides + owner exclusions so user_perms() can honor them
    # WITHOUT another DB round-trip. Kept on the user dict as
    # underscore-prefixed keys (private convention) so no existing
    # code reads them by accident.
    _tenant = await db.tenants.find_one(
        {"id": claimed_tenant},
        {"_id": 0, "roles": 1, "owner_exclusions": 1},
    )
    if _tenant:
        _role_perms_map = {}
        for _r in (_tenant.get("roles") or []):
            _k = _r.get("key")
            _perms = _r.get("permissions")
            if _k and isinstance(_perms, list) and _perms:
                _role_perms_map[_k] = list(_perms)
        user["_role_perms_map"] = _role_perms_map
        user["_owner_exclusions"] = list(_tenant.get("owner_exclusions") or [])
    # RBAC-27 (2026-08-15): non-expired temp grants merged in by user_perms().
    # membership.temp_grants[] = [{perm, granted_by, expires_at, reason}]
    user["_temp_grants"] = list(membership.get("temp_grants") or [])
    # RBAC-26 (2026-08-15): acting_as delegation. When active (today
    # between from and to), any approval intended for THIS user
    # auto-routes to the delegate. Approval-routing sites (_can_approve_*,
    # push_notification of pending approvals) read user['_acting_as'].
    user["_acting_as"] = user.get("acting_as") or {}
    set_usage_tenant(user.get("tenant_id"))
    return user


def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You don't have permission for this action")
        return user
    return checker


def require_perm(perm):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if perm not in user_perms(user):
            raise HTTPException(status_code=403, detail="You don't have access to this feature")
        return user
    return checker


async def tenant_role_keys(tenant_id: str) -> set:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    keys = {r.get("key") for r in ((t.get("roles") if t else None) or [])}
    keys.discard(None)
    keys.add("owner")
    return keys

"""Access control router — RBAC-26 + RBAC-27.

RBAC-26 (acting-as delegation):
  * POST /api/me/acting-as   -- set my delegate for approvals
  * DELETE /api/me/acting-as -- clear delegation
  * GET  /api/me/acting-as   -- read current delegation
  When active, sites that route approvals (leave decisions, task
  approvals) look up user._acting_as and forward to delegate_user_id
  if now is between `from` and `to`.

RBAC-27 (time-bounded elevated permissions):
  * POST   /api/users/{uid}/temp-grant   -- owner or team_manage grants a
                                            perm to `uid` with expires_at
                                            + reason
  * DELETE /api/users/{uid}/temp-grant/{perm} -- revoke early
  * GET    /api/users/{uid}/temp-grants  -- list active grants for user
  Merged into user_perms() by core.py -- perms auto-apply while
  non-expired. TTL sweep in run_followup revokes on expiry with an
  audit trail.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config import PERMISSION_KEYS
from core import (
    db,
    get_current_user,
    log_activity,
    now_iso,
    require_perm,
    require_role,
)


router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# RBAC-26 — acting_as (approval delegation)
# ---------------------------------------------------------------------------
class ActingAsInput(BaseModel):
    delegate_user_id: str
    from_date: str = Field(..., description="ISO date, YYYY-MM-DD or ISO datetime")
    to_date: str
    reason: Optional[str] = ""


def _is_active_now(from_iso: str, to_iso: str) -> bool:
    """Inclusive window check. Empty ends mean 'no bound on that side'."""
    now = datetime.now(timezone.utc).isoformat()
    if from_iso and now < from_iso:
        return False
    if to_iso and now > to_iso + "T23:59:59+00:00":
        return False
    return True


async def resolve_delegate(tenant_id: str, user_id: str) -> Optional[str]:
    """If `user_id` has an ACTIVE acting_as delegation, return the
    delegate's user id. Otherwise None. Approval-routing sites call
    this before hitting the intended approver."""
    u = await db.users.find_one(
        {"id": user_id, "tenant_id": tenant_id},
        {"_id": 0, "acting_as": 1},
    )
    ac = (u or {}).get("acting_as") or {}
    if not ac.get("delegate_user_id"):
        return None
    if not _is_active_now(ac.get("from") or "", ac.get("to") or ""):
        return None
    # Verify the delegate is still a live user in this tenant
    d = await db.users.find_one(
        {"id": ac["delegate_user_id"], "tenant_id": tenant_id},
        {"_id": 0, "id": 1},
    )
    return ac["delegate_user_id"] if d else None


@router.get("/me/acting-as")
async def get_my_acting_as(user: dict = Depends(get_current_user)):
    return {"acting_as": user.get("acting_as") or None,
            "active_now": _is_active_now(
                (user.get("acting_as") or {}).get("from") or "",
                (user.get("acting_as") or {}).get("to") or "")
            if (user.get("acting_as") or {}).get("delegate_user_id") else False}


@router.post("/me/acting-as")
async def set_my_acting_as(inp: ActingAsInput,
                           user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    if inp.delegate_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="You can't delegate to yourself.")
    delegate = await db.users.find_one(
        {"id": inp.delegate_user_id, "tenant_id": tid},
        {"_id": 0, "id": 1, "name": 1},
    )
    if not delegate:
        raise HTTPException(status_code=404, detail="Delegate not found in this workspace.")
    ac = {
        "delegate_user_id": inp.delegate_user_id,
        "delegate_name": delegate.get("name") or "",
        "from": inp.from_date, "to": inp.to_date,
        "reason": (inp.reason or "").strip()[:200],
        "set_at": now_iso(),
    }
    await db.users.update_one(
        {"id": user["id"], "tenant_id": tid},
        {"$set": {"acting_as": ac}},
    )
    await log_activity(tid, user["id"], "acting_as_set",
                       f"Set {delegate.get('name')} as approval delegate "
                       f"({inp.from_date} -> {inp.to_date})",
                       "user", user["id"])
    return {"ok": True, "acting_as": ac}


@router.delete("/me/acting-as")
async def clear_my_acting_as(user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"id": user["id"], "tenant_id": user["tenant_id"]},
        {"$unset": {"acting_as": ""}},
    )
    await log_activity(user["tenant_id"], user["id"], "acting_as_cleared",
                       "Cleared approval delegation", "user", user["id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# RBAC-27 — temp_grants (time-bounded elevated permissions)
# ---------------------------------------------------------------------------
class TempGrantInput(BaseModel):
    perm: str
    expires_at: str = Field(..., description="ISO datetime, e.g. 2026-09-15T00:00:00+00:00")
    reason: Optional[str] = ""


@router.post("/users/{uid}/temp-grant")
async def grant_temp_perm(uid: str, inp: TempGrantInput,
                          user: dict = Depends(require_perm("team_manage"))):
    if inp.perm not in PERMISSION_KEYS:
        raise HTTPException(status_code=400, detail=(
            f"Invalid perm '{inp.perm}'. Use one of: {sorted(PERMISSION_KEYS)}"))
    tid = user["tenant_id"]
    target = await db.users.find_one({"id": uid, "tenant_id": tid},
                                      {"_id": 0, "id": 1, "name": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    from services.auth.membership import find_membership, update_membership
    m = await find_membership(db, uid, tid)
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
    grants = list(m.get("temp_grants") or [])
    # Remove any existing grant for the same perm (idempotent replace).
    grants = [g for g in grants if g.get("perm") != inp.perm]
    grant = {
        "perm": inp.perm,
        "granted_by": user["id"],
        "granted_by_name": user.get("name") or "",
        "granted_at": now_iso(),
        "expires_at": inp.expires_at,
        "reason": (inp.reason or "").strip()[:200],
    }
    grants.append(grant)
    await update_membership(db, user_id=uid, tenant_id=tid,
                            updates={"temp_grants": grants})
    await log_activity(tid, user["id"], "temp_grant_added",
                       f"Granted '{inp.perm}' to {target.get('name')} "
                       f"until {inp.expires_at[:10]}"
                       + (f" -- {inp.reason}" if inp.reason else ""),
                       "user", uid)
    return {"ok": True, "grant": grant}


@router.delete("/users/{uid}/temp-grant/{perm}")
async def revoke_temp_perm(uid: str, perm: str,
                           user: dict = Depends(require_perm("team_manage"))):
    tid = user["tenant_id"]
    from services.auth.membership import find_membership, update_membership
    m = await find_membership(db, uid, tid)
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
    grants = list(m.get("temp_grants") or [])
    if not any(g.get("perm") == perm for g in grants):
        raise HTTPException(status_code=404, detail=f"No active grant for '{perm}'")
    grants = [g for g in grants if g.get("perm") != perm]
    await update_membership(db, user_id=uid, tenant_id=tid,
                            updates={"temp_grants": grants})
    await log_activity(tid, user["id"], "temp_grant_revoked",
                       f"Revoked '{perm}' for {uid[:8]}...", "user", uid)
    return {"ok": True}


@router.get("/users/{uid}/temp-grants")
async def list_temp_grants(uid: str,
                           user: dict = Depends(get_current_user)):
    """Read is more permissive than write -- any teammate can inspect
    another user's active grants (for transparency), but only
    team_manage / owner can grant/revoke."""
    tid = user["tenant_id"]
    from services.auth.membership import find_membership
    m = await find_membership(db, uid, tid)
    if not m:
        raise HTTPException(status_code=404, detail="Membership not found")
    now = datetime.now(timezone.utc).isoformat()
    grants = list(m.get("temp_grants") or [])
    active = [g for g in grants if str(g.get("expires_at") or "") > now]
    return {"grants": active, "expired_count": len(grants) - len(active)}


# ---------------------------------------------------------------------------
# RBAC-27 TTL sweep — called from run_followup so it piggybacks the
# existing distributed leader lock and 5-min cadence.
# ---------------------------------------------------------------------------
async def sweep_expired_temp_grants(tenant_id: str) -> int:
    """Revoke every temp_grants entry whose expires_at is in the past.
    Writes an audit-log entry per revoke. Returns number revoked."""
    now = datetime.now(timezone.utc).isoformat()
    revoked = 0
    async for m in db.memberships.find(
        {"tenant_id": tenant_id, "temp_grants.expires_at": {"$lt": now}},
        {"_id": 0, "user_id": 1, "temp_grants": 1},
    ):
        keep = [g for g in (m.get("temp_grants") or [])
                if str(g.get("expires_at") or "") >= now]
        expired = [g for g in (m.get("temp_grants") or [])
                   if str(g.get("expires_at") or "") < now]
        if not expired:
            continue
        from services.auth.membership import update_membership
        await update_membership(db, user_id=m["user_id"], tenant_id=tenant_id,
                                updates={"temp_grants": keep})
        for g in expired:
            await log_activity(
                tenant_id, "system", "temp_grant_expired",
                f"Auto-revoked expired '{g.get('perm')}' grant for {m['user_id'][:8]}... "
                f"(was until {str(g.get('expires_at') or '')[:10]})",
                "user", m["user_id"],
            )
            revoked += 1
    return revoked

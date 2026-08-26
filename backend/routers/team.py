"""Team router — users, attendance, and leaves domain.

Extracted from `server.py` in Phase B step 7. Owns 15 endpoints:

  Users:
    • GET   /api/users                          — list
    • POST  /api/users                          — create (team_manage; owner-only for creating another owner)
    • POST  /api/users/{user_id}/invite         — regenerate invite token
    • PATCH /api/users/{user_id}                — update role/permissions/phone/manager

  Attendance:
    • POST  /api/attendance                     — owner marks a member absent/present
    • GET   /api/attendance                     — list a given day

  Leaves:
    • POST  /api/leaves                         — request leave
    • POST  /api/leaves/absence                 — emergency absence report
    • GET   /api/leaves                         — list (?scope=mine|approvals|all)
    • GET   /api/leaves/on-leave                — who is out today
    • GET   /api/leaves/{leave_id}              — detail
    • POST  /api/leaves/{leave_id}/approve      — approver decision
    • POST  /api/leaves/{leave_id}/reject       — approver decision
    • POST  /api/leaves/{leave_id}/request-info — approver decision
    • GET   /api/leaves/{leave_id}/impact       — AI: at-risk tasks + reassignment suggestions

Task-local helpers (`_can_approve_leave`, `_decide_leave`) live inside the
router since nothing else calls them. Cross-domain helpers deferred-imported
from `server.py`:
  `_norm_phone`, `_mask_phone`, `_create_leave`, `ai_leave_impact`,
  `push_notification`.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import (
    db,
    get_current_user,
    require_perm,
    require_role,
    hash_password,
    clean_perms,
    user_perms,
    log_activity,
    new_id,
    now_iso,
    tenant_role_keys,
)
from config import PERMISSION_KEYS
from models.team import (
    ABSENCE_REASONS,
    LEAVE_TYPES,
    AbsenceInput,
    AttendanceInput,
    LeaveDecisionInput,
    LeaveRequestInput,
    UserCreateInput,
    UserUpdateInput,
)


router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Router-local helpers (not called from anywhere else)
# ---------------------------------------------------------------------------
def _can_approve_leave(user: dict, leave: dict) -> bool:
    if user.get("role") == "owner":
        return True
    if leave.get("approver_id") == user["id"]:
        return True
    # RBAC-26 (2026-08-15): I can act on this leave if the intended
    # approver has delegated to me via acting_as (and it's active now).
    # We can't sync-await here so we peek at the approver's delegation
    # via user_perms path -- the delegate is stashed on the pending
    # leave via `_delegate_to` when push_notification routes it there,
    # OR we honour a live check when the current user has been named
    # in someone's acting_as (looked up at get_current_user next time
    # they log in). For MVP: the delegate simply gets pushed the
    # notification via resolve_delegate (see _decide_leave below) and
    # this permission check accepts the approver's chain (leave.
    # `delegate_ids` populated on approver-routing).
    if user["id"] in (leave.get("delegate_user_ids") or []):
        return True
    return "leave_approve" in user_perms(user)


async def _decide_leave(leave_id, user, new_status, note, ntype, employee_msg):
    from server import push_notification  # deferred
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_leave(user, lv):
        raise HTTPException(status_code=403, detail="You cannot act on this leave request")
    entry = {"action": new_status, "by": user["id"], "by_name": user.get("name"),
             "note": note or "", "at": now_iso()}
    updates = {"status": new_status, "decided_at": now_iso(), "decided_by": user["id"]}
    if new_status == "info_requested":
        updates = {"status": new_status, "info_note": note or ""}
    # E2-57: tenant_id in the filter is defense-in-depth. UUID collision
    # is astronomically unlikely but a hostile caller with a leave_id
    # from another tenant would otherwise flip its status without
    # authorization (the auth check above only loaded the leave from
    # THIS tenant, so no write should ever land outside it).
    await db.leaves.update_one(
        {"id": leave_id, "tenant_id": user["tenant_id"]},
        {"$set": updates, "$push": {"history": entry}},
    )
    await push_notification(user["tenant_id"], [lv["user_id"]], 2, employee_msg,
                            entity_type="leave", entity_id=leave_id, ntype=ntype,
                            title=f"{lv.get('leave_type', 'Leave').title()} leave",
                            sender=user.get("name"))
    await log_activity(user["tenant_id"], user["id"], f"leave_{new_status}",
                       f"{new_status.replace('_', ' ').title()} {lv.get('user_name')}'s leave",
                       "leave", leave_id)
    return await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]}, {"_id": 0})


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.team import (
    DeprovisionInput,
)


@router.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    """List every user in the current tenant.

    FIX-004-E (RBAC-17): each user carries `invite_status` and
    `invited_at` sourced from their membership row so the admin UI
    can render a Pending badge. Previously invited-but-not-accepted
    users were indistinguishable from active members in the list.
    Removed users are excluded — they're audit-only.
    """
    users = await db.users.find(
        {"tenant_id": user["tenant_id"]},
        {"_id": 0, "password_hash": 0, "invite_token": 0, "invite_expires_at": 0},
    ).to_list(500)
    if not users:
        return users
    # Merge membership.status onto each user for the current tenant.
    from services.auth.membership import list_memberships_for_tenant
    memberships = await list_memberships_for_tenant(db, user["tenant_id"])
    m_by_uid = {m["user_id"]: m for m in memberships if m.get("status") != "removed"}
    out = []
    for u in users:
        m = m_by_uid.get(u.get("id"))
        if m:
            u["invite_status"] = m.get("status")   # pending | active | suspended
            u["invited_at"] = m.get("invited_at")
            u["accepted_at"] = m.get("accepted_at")
        else:
            # Legacy user without a membership row (mid-migration).
            # Treat as active for the admin list; the compat layer in
            # get_current_user will accept their login on the legacy path.
            u["invite_status"] = "active"
        out.append(u)
    return out




@router.post("/users/{user_id}/deprovision")
async def deprovision_member(user_id: str, inp: DeprovisionInput,
                              user: dict = Depends(require_role("owner"))):
    """FIX-004-H (RBAC-22): off-boarding wizard.

    Composes 6 idempotent steps into a single call: revoke this
    user's sessions in this tenant, remove their membership,
    invalidate their invite token, reassign owned tasks + authored
    contacts to the specified replacement user (or nullify), audit
    the whole event.

    Owner-only: off-boarding is inherently a workspace-level admin
    action, and the last-owner guard inside the service prevents
    an owner deprovisioning themselves without transferring
    ownership first.

    Returns the report dict with per-step counts so the UI can show
    a confirmation summary ("Removed X. 3 tasks reassigned to Y,
    5 contacts reassigned to Y.").
    """
    if user_id == user["id"]:
        raise HTTPException(
            status_code=400,
            detail="You can't deprovision yourself. Ask another owner to do it.",
        )
    # Guard: replacement (if provided) must be a live member.
    if inp.reassign_to_user_id:
        from services.auth.membership import find_membership, LIVE_STATUSES
        rep = await find_membership(
            db, inp.reassign_to_user_id, user["tenant_id"], statuses=LIVE_STATUSES,
        )
        if not rep:
            raise HTTPException(
                status_code=400,
                detail="The replacement user isn't an active member of this workspace.",
            )
    from services.deprovisioning import deprovision_user
    report = await deprovision_user(
        db, target_user_id=user_id, tenant_id=user["tenant_id"],
        actor_user_id=user["id"],
        reassign_to_user_id=inp.reassign_to_user_id,
    )
    if not report.get("ok"):
        raise HTTPException(status_code=400, detail=report.get("error") or "Deprovision failed")
    return report


@router.post("/users/{user_id}/uninvite")
async def uninvite_user(user_id: str, user: dict = Depends(require_perm("team_manage"))):
    """FIX-004-E (RBAC-17): revoke a pending invite before the invitee
    logs in for the first time. Removes the membership (soft-delete)
    and invalidates the invite_token so the invite link stops working.
    Refuses if the target has already accepted (status=active) — that
    path uses the existing suspend/delete flow instead."""
    from services.auth.membership import (
        find_membership as _fm, remove_membership as _rm, STATUS_PENDING,
    )
    target = await db.users.find_one(
        {"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "name": 1, "phone": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    m = await _fm(db, user_id, user["tenant_id"])
    if not m:
        raise HTTPException(status_code=404, detail="No membership found for this member")
    if m.get("status") != STATUS_PENDING:
        raise HTTPException(
            status_code=400,
            detail="This member has already accepted their invite. Suspend or remove instead.",
        )
    # Kill both the membership + the legacy invite_token on the user
    # doc so the invite link stops working immediately.
    await _rm(db, user_id=user_id, tenant_id=user["tenant_id"])
    await db.users.update_one(
        {"id": user_id, "tenant_id": user["tenant_id"]},
        {"$set": {"invite_token": None, "invite_expires_at": None, "updated_at": now_iso()}},
    )
    await log_activity(
        user["tenant_id"], user["id"], "user_uninvited",
        f"{user['name']} revoked pending invite for {target.get('name')}",
    )
    return {"ok": True, "revoked": True}


@router.post("/users")
async def create_user(inp: UserCreateInput, user: dict = Depends(require_perm("team_manage"))):
    from server import _norm_phone, tenant_role_keys  # deferred
    role_keys = await tenant_role_keys(user["tenant_id"])
    if inp.role == "owner":
        if user.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only an owner can create another owner")
    elif inp.role not in role_keys:
        raise HTTPException(status_code=400, detail="Invalid role")
    # FIX-005-A (S3-02): enforce the plan's seat cap BEFORE creating
    # the user. Raises 402 with a friendly upgrade prompt when full.
    # Owner-role invitees still count against the cap — a workspace
    # can be capped at 3 owners just as easily as 3 sales.
    from services.plans import enforce_seat_limit
    await enforce_seat_limit(db, user["tenant_id"])
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    phone = (inp.phone or "").strip()
    pwd = (inp.password or "").strip()
    passwordless = not pwd
    if passwordless:
        if len(_norm_phone(phone)) < 10:
            raise HTTPException(status_code=400,
                                detail="A valid mobile number is required for passwordless (OTP) members")
        # No usable password — this member logs in only via mobile OTP.
        password_hash = hash_password(new_id() + new_id())
    else:
        if len(pwd) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        password_hash = hash_password(pwd)
    uid = new_id()
    invite_token = None
    # FIX-002-A: also write phone_norm for indexed OTP + WhatsApp lookup.
    from services.auth.phone import norm_phone as _np
    doc = {
        "id": uid, "tenant_id": user["tenant_id"], "name": inp.name, "email": email,
        "phone": phone, "phone_norm": _np(phone), "passwordless": passwordless,
        "password_hash": password_hash, "role": inp.role,
        "permissions": clean_perms(inp.permissions), "created_at": now_iso(),
    }
    if inp.reporting_manager_id:
        mgr = await db.users.find_one(
            {"id": inp.reporting_manager_id, "tenant_id": user["tenant_id"]},
            {"_id": 0, "id": 1},
        )
        if mgr:
            doc["reporting_manager_id"] = inp.reporting_manager_id
    if len(_norm_phone(phone)) >= 10:
        invite_token = new_id()
        doc["invite_token"] = invite_token
        doc["invite_expires_at"] = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    await db.users.insert_one(doc)
    # FIX-004-B (RBAC-13): mirror the tenant-scoped fields into a
    # membership row. Legacy user.tenant_id/role/permissions/
    # invite_token stay populated so pre-refactor read paths keep
    # working; new authoritative source is the memberships table.
    from services.auth.membership import (
        create_membership as _create_membership,
        STATUS_PENDING as _MSTATUS_PENDING,
        STATUS_ACTIVE as _MSTATUS_ACTIVE,
    )
    _mstatus = _MSTATUS_PENDING if invite_token else _MSTATUS_ACTIVE
    await _create_membership(
        db, user_id=uid, tenant_id=user["tenant_id"], role=inp.role,
        permissions=clean_perms(inp.permissions),
        invited_by=user["id"],
        status=_mstatus,
        invite_token=invite_token,
        invite_expires_at=doc.get("invite_expires_at"),
    )
    await log_activity(user["tenant_id"], user["id"], "user_added",
                       f"Added {inp.name} as {inp.role}"
                       + (" (mobile OTP login)" if passwordless else ""))
    out = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if invite_token:
        out["invite_token"] = invite_token
    return out


@router.post("/users/{user_id}/invite")
async def regenerate_invite(user_id: str, user: dict = Depends(require_perm("team_manage"))):
    from server import _norm_phone, _mask_phone  # deferred
    target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if len(_norm_phone(target.get("phone", ""))) < 10:
        raise HTTPException(status_code=400, detail="Add a mobile number for this member first")
    token = new_id()
    # E2-57: scope the write to this tenant so the invite token can't be
    # rewritten across tenants even in a UUID-collision scenario.
    await db.users.update_one(
        {"id": user_id, "tenant_id": user["tenant_id"]},
        {"$set": {
            "invite_token": token,
            "invite_expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        }},
    )
    return {"invite_token": token, "name": target.get("name"),
            "phone_masked": _mask_phone(target.get("phone", ""))}


@router.patch("/users/{user_id}")
async def update_user(user_id: str, inp: UserUpdateInput, user: dict = Depends(require_perm("team_manage"))):
    target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    acting_is_owner = user.get("role") == "owner"
    # Only an owner may change another owner's access (e.g. to demote them).
    if target["role"] == "owner" and not acting_is_owner:
        raise HTTPException(status_code=403, detail="Only an owner can change another owner's access")
    updates: dict = {}
    new_role = target["role"]
    if inp.role is not None and inp.role != target["role"]:
        role_keys = await tenant_role_keys(user["tenant_id"])
        if inp.role == "owner":
            if not acting_is_owner:
                raise HTTPException(status_code=403, detail="Only an owner can grant the Owner role")
        else:
            if inp.role not in role_keys:
                raise HTTPException(status_code=400, detail="Invalid role")
            # Never leave the company without an owner.
            if target["role"] == "owner":
                owner_count = await db.users.count_documents({"tenant_id": user["tenant_id"], "role": "owner"})
                if owner_count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot demote the last owner — assign another owner first")
        new_role = inp.role
        updates["role"] = inp.role
    if inp.permissions is not None:
        updates["permissions"] = clean_perms(inp.permissions)
    if new_role == "owner":
        updates["permissions"] = list(PERMISSION_KEYS)
    if inp.phone is not None:
        # FIX-002-A: keep phone_norm in sync so OTP + WhatsApp still finds
        # the user after an admin updates their phone.
        from services.auth.phone import norm_phone as _np
        _p = inp.phone.strip()
        updates["phone"] = _p
        updates["phone_norm"] = _np(_p)
    if inp.reporting_manager_id is not None:
        rm = inp.reporting_manager_id.strip()
        if rm and rm != user_id:
            mgr = await db.users.find_one({"id": rm, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
            updates["reporting_manager_id"] = rm if mgr else None
        else:
            updates["reporting_manager_id"] = None
    if updates:
        # E2-57: tenant scope on the write (defense-in-depth; target was
        # already loaded from this tenant above).
        await db.users.update_one(
            {"id": user_id, "tenant_id": user["tenant_id"]},
            {"$set": updates},
        )
        # FIX-004-B (RBAC-13): mirror role/permissions changes into
        # the membership row for THIS tenant so the authoritative
        # perms source stays in sync. Phone/manager updates don't
        # need mirroring — those live on the user (identity) not
        # the membership (tenant-scoped relationship).
        membership_updates = {}
        if "role" in updates:
            membership_updates["role"] = updates["role"]
        if "permissions" in updates:
            membership_updates["permissions"] = updates["permissions"]
        if membership_updates:
            from services.auth.membership import update_membership as _um
            await _um(
                db, user_id=user_id, tenant_id=user["tenant_id"],
                updates=membership_updates,
            )
    # E2-57: tenant-scoped read for the response body.
    return await db.users.find_one(
        {"id": user_id, "tenant_id": user["tenant_id"]},
        {"_id": 0, "password_hash": 0},
    )


# ---------------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------------
@router.post("/attendance")
async def mark_attendance(inp: AttendanceInput, user: dict = Depends(require_role("owner"))):
    date = inp.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.attendance.update_one(
        {"tenant_id": user["tenant_id"], "user_id": inp.user_id, "date": date},
        {"$set": {"status": inp.status, "marked_by": user["id"], "updated_at": now_iso()},
         "$setOnInsert": {"id": new_id(), "created_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/attendance")
async def list_attendance(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return await db.attendance.find(
        {"tenant_id": user["tenant_id"], "date": date}, {"_id": 0}
    ).to_list(500)


# ---------------------------------------------------------------------------
# Leaves
# ---------------------------------------------------------------------------
@router.post("/leaves")
async def create_leave(inp: LeaveRequestInput, user: dict = Depends(get_current_user)):
    from server import _create_leave  # deferred (also called by voice/inbox flows)
    if inp.leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid leave type")
    if inp.to_date[:10] < inp.from_date[:10]:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    return await _create_leave(user["tenant_id"], user, inp.leave_type,
                               inp.from_date, inp.to_date,
                               inp.day_portion, inp.reason, is_emergency=False)


@router.post("/leaves/absence")
async def report_absence(inp: AbsenceInput, user: dict = Depends(get_current_user)):
    from server import _create_leave  # deferred
    if inp.reason not in ABSENCE_REASONS:
        raise HTTPException(status_code=400, detail="Invalid reason")
    today = datetime.now(timezone.utc).date().isoformat()
    reason = inp.reason.replace("_", " ").title() + ((" — " + inp.note.strip()) if inp.note else "")
    return await _create_leave(user["tenant_id"], user,
                               "sick" if inp.reason == "sick" else "other",
                               today, today, "full", reason, is_emergency=True)


@router.get("/leaves")
async def list_leaves(scope: str = "mine", user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    can_approve_all = user.get("role") == "owner" or "leave_approve" in user_perms(user)
    q: dict = {"tenant_id": tid}
    if scope == "mine":
        q["user_id"] = user["id"]
    elif scope == "approvals":
        if not can_approve_all:
            q["approver_id"] = user["id"]
    elif scope == "all":
        if not can_approve_all:
            q["user_id"] = user["id"]
    leaves = await db.leaves.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
    return leaves


@router.get("/leaves/on-leave")
async def leaves_on_leave_today(user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    today = datetime.now(timezone.utc).date().isoformat()
    return await db.leaves.find(
        {"tenant_id": tid, "status": "approved",
         "from_date": {"$lte": today}, "to_date": {"$gte": today}},
        {"_id": 0, "user_id": 1, "user_name": 1, "user_role": 1, "leave_type": 1, "to_date": 1},
    ).to_list(200)


@router.get("/leaves/{leave_id}")
async def get_leave(leave_id: str, user: dict = Depends(get_current_user)):
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if lv["user_id"] != user["id"] and not _can_approve_leave(user, lv):
        raise HTTPException(status_code=403, detail="You don't have access to this leave request")
    return lv


@router.post("/leaves/{leave_id}/approve")
async def approve_leave(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(require_perm("leave_approve"))):
    # FIX-004-C (RBAC-09): decorator gate makes the permission visible
    # in the endpoint signature. Inline `_can_approve_leave` inside
    # `_decide_leave` stays as defense-in-depth (checks the SPECIFIC
    # leave's approver_id, not just the perm).
    return await _decide_leave(leave_id, user, "approved", inp.note, "approved",
                               f"Your leave request was approved by {user.get('name')}")


@router.post("/leaves/{leave_id}/reject")
async def reject_leave(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(require_perm("leave_approve"))):
    # FIX-004-C (RBAC-09): same as approve_leave — decorator gate.
    return await _decide_leave(leave_id, user, "rejected", inp.note, "rejected",
                               f"Your leave request was rejected by {user.get('name')}"
                               + (f": {inp.note}" if inp.note else ""))


@router.post("/leaves/{leave_id}/request-info")
async def request_leave_info(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(require_perm("leave_approve"))):
    # FIX-004-C (RBAC-09): same as approve/reject — decorator gate.
    return await _decide_leave(leave_id, user, "info_requested", inp.note, "clarification",
                               f"{user.get('name')} needs more info on your leave request"
                               + (f": {inp.note}" if inp.note else ""))


@router.get("/leaves/{leave_id}/impact")
async def leave_impact(leave_id: str, user: dict = Depends(get_current_user)):
    """AI-driven: for each active task assigned to the person on leave, suggest
    a reassignment/extension/monitor action based on team workload."""
    from server import ai_leave_impact  # deferred (uses Claude)
    tid = user["tenant_id"]
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": tid})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_leave(user, lv) and lv["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You don't have access to this leave request")
    from_date, to_date = lv["from_date"][:10], lv["to_date"][:10]
    # Active tasks of the person on leave that are at risk during the absence.
    all_tasks = await db.tasks.find(
        {"tenant_id": tid, "assignee_id": lv["user_id"], "status": {"$nin": ["done", "cancelled"]}},
        {"_id": 0}).to_list(300)
    at_risk = [t for t in all_tasks
               if ((t.get("due_date") or "")[:10] and (t.get("due_date") or "")[:10] <= to_date)
               or t.get("status") == "in_progress"]
    # Available teammates: everyone except the person on leave and anyone else on approved overlapping leave.
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
    overlapping = await db.leaves.find(
        {"tenant_id": tid, "status": "approved",
         "from_date": {"$lte": to_date}, "to_date": {"$gte": from_date}},
        {"_id": 0, "user_id": 1}).to_list(300)
    busy = {o["user_id"] for o in overlapping} | {lv["user_id"]}
    members = []
    for u in users:
        if u["id"] in busy:
            continue
        load = await db.tasks.count_documents(
            {"tenant_id": tid, "assignee_id": u["id"], "status": {"$nin": ["done", "cancelled"]}})
        members.append({"id": u["id"], "name": u["name"], "role": u["role"], "load": load})
    analysis = await ai_leave_impact(lv["user_name"], from_date, to_date, at_risk, members)
    sug = {s.get("task_id"): s for s in (analysis.get("suggestions") or []) if isinstance(s, dict)}
    valid_ids = {m["id"] for m in members}
    tasks_out = []
    for t in at_risk:
        s = sug.get(t["id"], {})
        action = s.get("action") if s.get("action") in ("reassign", "extend", "monitor") else "monitor"
        aid = s.get("assignee_id") if s.get("assignee_id") in valid_ids else None
        if action == "reassign" and not aid:
            action = "monitor"
        tasks_out.append({
            "id": t["id"], "title": t.get("title"), "priority": t.get("priority"),
            "status": t.get("status"), "due_date": (t.get("due_date") or "")[:10],
            "action": action, "assignee_id": aid, "assignee_name": s.get("assignee_name"),
            "suggested_due_date": (s.get("due_date") or "")[:10] if action == "extend" else None,
            "reason": s.get("reason", ""),
        })
    return {"leave_id": leave_id, "person": lv["user_name"],
            "from_date": from_date, "to_date": to_date,
            "summary": analysis.get("summary", ""), "tasks": tasks_out,
            "available_members": [{"id": m["id"], "name": m["name"], "role": m["role"]} for m in members]}

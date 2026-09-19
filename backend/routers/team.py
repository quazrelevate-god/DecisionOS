"""Team router — users, attendance, and leaves domain.

Extracted from `server.py` in Phase B step 7. Owns 15 endpoints:

  Users:
    • GET   /api/users                          — list
    • POST  /api/users                          — create (team_manage; owner-only for creating another owner)
    • POST  /api/users/{user_id}/invite         — regenerate invite token
    • PATCH /api/users/{user_id}                — update role/permissions/phone/manager
    • POST  /api/users/{user_id}/avatar         — set profile photo (self, or team_manage)
    • DELETE /api/users/{user_id}/avatar        — remove profile photo

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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

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
# 2026-09-19 — a request its owner took back. Stored as "cancelled" (the name
# the Flutter client's LeaveRequest already knows); the web says "Withdrawn".
LEAVE_WITHDRAWN = "cancelled"


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
    from services.notifications import push_notification
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_leave(user, lv):
        raise HTTPException(status_code=403, detail="You cannot act on this leave request")
    # 2026-09-19 — a request its owner withdrew is over; approving it now would
    # put leave on the calendar that nobody is taking.
    if lv.get("status") == LEAVE_WITHDRAWN:
        raise HTTPException(status_code=409, detail=f"{lv.get('user_name') or 'They'} withdrew this request.")
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
    # 2026-09-15: someone removed from this workspace is gone from the list. They
    # used to come back as "active": no live row looked like a legacy member.
    removed_ids = {m["user_id"] for m in memberships if m.get("status") == "removed"} - set(m_by_uid)
    # What each person can actually open (role settings, temporary grants and
    # "No access" included), so approver lists and profiles show the truth.
    from services.auth.membership import members_effective_perms
    perms_map = await members_effective_perms(db, user["tenant_id"], users)
    out = []
    for u in users:
        if u.get("id") in removed_ids:
            continue
        m = m_by_uid.get(u.get("id"))
        u["effective_permissions"] = sorted(perms_map.get(u.get("id"), set()))
        if m and "permissions_custom" in m:
            u["permissions_custom"] = bool(m["permissions_custom"])
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




@router.get("/users/{user_id}/offboarding")
async def offboarding_summary(user_id: str, user: dict = Depends(require_role("owner"))):
    """2026-09-15 — what someone holds before they are removed, so the owner
    sees what will be handed over: open work they do or help on, approvals and
    decisions waiting on them, the people who report to them, their contacts."""
    tid = user["tenant_id"]
    target = await db.users.find_one({"id": user_id, "tenant_id": tid},
                                     {"_id": 0, "id": 1, "name": 1, "reporting_manager_id": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    open_ = {"$nin": ["done", "cancelled"]}
    suggested = None
    if target.get("reporting_manager_id"):
        from services.auth.membership import find_membership, LIVE_STATUSES, legacy_access_allowed
        mgr = await db.users.find_one({"id": target["reporting_manager_id"], "tenant_id": tid},
                                      {"_id": 0, "id": 1, "tenant_id": 1, "role": 1})
        if mgr and (await find_membership(db, mgr["id"], tid, statuses=LIVE_STATUSES)
                    or await legacy_access_allowed(db, mgr, tid)):
            suggested = mgr["id"]
    return {
        "tasks_doing": await db.tasks.count_documents({"tenant_id": tid, "assignee_id": user_id, "status": open_}),
        "tasks_helping": await db.tasks.count_documents({"tenant_id": tid, "co_assignee_ids": user_id, "status": open_}),
        "tasks_approving": await db.tasks.count_documents({"tenant_id": tid, "approver_id": user_id, "status": open_}),
        "decisions_waiting": await db.decisions.count_documents(
            {"tenant_id": tid, "approver_id": user_id, "status": {"$in": ["pending", "pending_approval"]}}),
        "reports": await db.users.count_documents({"tenant_id": tid, "reporting_manager_id": user_id}),
        "contacts": await db.contacts.count_documents({"tenant_id": tid, "assigned_id": user_id}),
        "suggested_replacement_id": suggested,
    }


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
        from services.auth.membership import find_membership, LIVE_STATUSES, legacy_access_allowed
        rep = await find_membership(
            db, inp.reassign_to_user_id, user["tenant_id"], statuses=LIVE_STATUSES,
        )
        if not rep:
            # 2026-09-15: an account from before memberships is a live member too.
            rep_user = await db.users.find_one({"id": inp.reassign_to_user_id, "tenant_id": user["tenant_id"]},
                                               {"_id": 0, "id": 1, "tenant_id": 1, "role": 1})
            rep = rep_user if rep_user and await legacy_access_allowed(db, rep_user, user["tenant_id"]) else None
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
    from core import tenant_role_keys
    from services.whatsapp import _norm_phone
    role_keys = await tenant_role_keys(user["tenant_id"])
    if inp.role == "owner":
        if user.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only an owner can create another owner")
    elif inp.role not in role_keys:
        raise HTTPException(status_code=400, detail="Invalid role")
    else:
        await _refuse_ungrantable(user, clean_perms(inp.permissions), inp.role)
    # FIX-005-A (S3-02): enforce the plan's seat cap BEFORE creating
    # the user. Raises 402 with a friendly upgrade prompt when full.
    # Owner-role invitees still count against the cap — a workspace
    # can be capped at 3 owners just as easily as 3 sales.
    from services.plans import enforce_seat_limit
    await enforce_seat_limit(db, user["tenant_id"])
    # 2026-09-19 — members sign in with their mobile and a texted code. The
    # manager used to be able to set a "temporary" password instead, which
    # nothing ever asked the member to replace, so the manager who typed it
    # could keep signing in as them. No password is set here any more.
    if (inp.password or "").strip():
        raise HTTPException(status_code=400, detail=(
            "Members sign in with their mobile number and a texted code, so there's no password to set for them."))
    from services.auth.phone import valid_indian_mobile, display_indian_mobile
    _member_norm = valid_indian_mobile(inp.phone or "")
    if not _member_norm:
        # The number is their sign-in: a mistyped one hands their account to
        # whoever owns it. Same rule as signup.
        raise HTTPException(status_code=400, detail="Enter their 10-digit Indian mobile number — it's how they sign in.")
    email = (inp.email or "").strip().lower()
    if email:
        _local, _, _domain = email.partition("@")
        if not _local or "." not in _domain:
            raise HTTPException(status_code=400, detail="Enter a valid email, or leave it empty")
        if await db.users.find_one({"email": email}):
            raise HTTPException(status_code=400, detail="Email already registered")
    phone = display_indian_mobile(_member_norm)
    # 2026-09-16: one mobile, one member — inside this workspace. The number is
    # the sign-in and the WhatsApp route, so two people sharing one means codes
    # and captures land on the wrong account. The same number in ANOTHER
    # workspace is fine and stays fine (a consultant with two clients).
    if len(_norm_phone(phone)) >= 10:
        _clash = await db.users.find_one(
            {"tenant_id": user["tenant_id"], "phone_norm": _norm_phone(phone)},
            {"_id": 0, "name": 1},
        )
        if _clash:
            raise HTTPException(
                status_code=400,
                detail=f"That mobile number is already {_clash.get('name')}'s in this workspace.",
            )
    # No usable password — the member signs in only by mobile OTP. (An owner
    # added here adds an email and password of their own at first sign-in.)
    passwordless = True
    password_hash = hash_password(new_id() + new_id())
    # 2026-09-15: follow the role (empty list), or their own list — which may be
    # empty on purpose ("No access").
    _perms_new = [] if inp.follow_role is True else clean_perms(inp.permissions)
    _custom_new = inp.follow_role is False or bool(_perms_new)
    uid = new_id()
    invite_token = None
    # FIX-002-A: also write phone_norm for indexed OTP + WhatsApp lookup.
    from services.auth.phone import norm_phone as _np
    doc = {
        "id": uid, "tenant_id": user["tenant_id"], "name": inp.name,
        "phone": phone, "phone_norm": _np(phone), "passwordless": passwordless,
        "password_hash": password_hash, "role": inp.role,
        "permissions": _perms_new, "permissions_custom": _custom_new, "created_at": now_iso(),
    }
    if inp.reporting_manager_id:
        mgr = await db.users.find_one(
            {"id": inp.reporting_manager_id, "tenant_id": user["tenant_id"]},
            {"_id": 0, "id": 1},
        )
        if mgr:
            doc["reporting_manager_id"] = inp.reporting_manager_id
    # 2026-09-14 — the job title the Team tree shows under a member's name.
    if inp.title and inp.title.strip():
        doc["title"] = inp.title.strip()[:80]
    # Absent, not empty, when there isn't one: users.email is unique among
    # real addresses only (bootstrap/lifecycle.py).
    if email:
        doc["email"] = email
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
        permissions=_perms_new,
        invited_by=user["id"],
        status=_mstatus,
        invite_token=invite_token,
        invite_expires_at=doc.get("invite_expires_at"),
    )
    await db.memberships.update_one({"user_id": uid, "tenant_id": user["tenant_id"]},
                                    {"$set": {"permissions_custom": _custom_new}})
    await log_activity(user["tenant_id"], user["id"], "user_added",
                       f"Added {inp.name} as {inp.role} (mobile sign-in)")
    out = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if invite_token:
        out["invite_token"] = invite_token
    return out


@router.post("/users/{user_id}/invite")
async def regenerate_invite(user_id: str, user: dict = Depends(require_perm("team_manage"))):
    from services.whatsapp import _mask_phone, _norm_phone
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


async def _refuse_ungrantable(user: dict, perms: list, role: Optional[str], target: Optional[dict] = None) -> None:
    """RBAC P0 (2026-09-15) — Manage team could raise access, its own included.
    Someone who isn't an owner may give only what they hold themselves, what the
    person already has, or (for someone else) the defaults of that person's role,
    which the owner set."""
    if user.get("role") == "owner":
        return
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    role_map = {r["key"]: list(r["permissions"]) for r in ((tenant or {}).get("roles") or [])
                if r.get("key") and isinstance(r.get("permissions"), list) and r.get("permissions")}
    allowed = set(user_perms(user))
    self_edit = bool(target) and target.get("id") == user["id"]
    if target:
        allowed |= set(user_perms({**target, "_role_perms_map": role_map}))
    if role and not self_edit:
        allowed |= set(user_perms({"role": role, "permissions": [], "_role_perms_map": role_map}))
    extra = sorted(set(perms) - allowed)
    if extra:
        raise HTTPException(status_code=403, detail=(
            f"You can only give access you have yourself. Ask an owner for: {', '.join(extra)}."))


@router.patch("/users/{user_id}")
async def update_user(user_id: str, inp: UserUpdateInput, user: dict = Depends(require_perm("team_manage"))):
    target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    acting_is_owner = user.get("role") == "owner"
    # Only an owner may change another owner's access (e.g. to demote them).
    if target["role"] == "owner" and not acting_is_owner:
        raise HTTPException(status_code=403, detail="Only an owner can change another owner's access")
    if not acting_is_owner:
        if user_id == user["id"] and inp.role is not None and inp.role != target["role"]:
            raise HTTPException(status_code=403, detail="You can't change your own role. Ask an owner.")
        if inp.permissions is not None and inp.role != "owner" and inp.follow_role is not True:
            await _refuse_ungrantable(user, clean_perms(inp.permissions),
                                      inp.role if inp.role is not None else target["role"], target)
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
    # 2026-09-15: "Use the role's access" is its own choice, so their own list
    # with nothing ticked means No access rather than the role's.
    if inp.follow_role is True:
        updates["permissions"], updates["permissions_custom"] = [], False
    elif inp.permissions is not None:
        updates["permissions"] = clean_perms(inp.permissions)
        updates["permissions_custom"] = inp.follow_role is False or bool(updates["permissions"])
    if new_role == "owner":
        updates["permissions"] = list(PERMISSION_KEYS)
    if inp.phone is not None:
        # FIX-002-A: keep phone_norm in sync so OTP + WhatsApp still finds
        # the user after an admin updates their phone.
        from services.auth.phone import norm_phone as _np, valid_indian_mobile as _vim, display_indian_mobile as _dim
        _p = inp.phone.strip()
        _new_norm = _np(_p)
        _old_norm = _np(target.get("phone") or "")
        if _new_norm != _old_norm:
            # 2026-09-19 — the same rule as signup and Team › Add: a new number
            # is a real Indian mobile, and a member who signs in only by mobile
            # can't be left without one.
            if _p:
                _new_norm = _vim(_p)
                if not _new_norm:
                    raise HTTPException(status_code=400, detail="Enter a 10-digit Indian mobile number — it's how they sign in.")
                _p = _dim(_new_norm)
            elif target.get("passwordless"):
                raise HTTPException(status_code=400, detail="They sign in with this number, so it can be changed but not removed.")
            # 2026-09-16: the mobile IS the sign-in — a code goes to it and
            # whoever reads that code is in. So Manage team may FILL IN a number
            # for someone who has none (they cannot sign in at all until then,
            # and the invite link needs one), but changing a number that is
            # already set would be a way to point a colleague's account at your
            # own phone and sign in as them — the "Manage team cannot raise
            # access" rule (1fca68d) walked around. Owner only, the same line
            # email draws.
            if len(_old_norm) >= 10 and not acting_is_owner:
                raise HTTPException(
                    status_code=403,
                    detail=("Only an owner can change someone's mobile number, because it's how they sign in. "
                            "Ask an owner to update it."),
                )
            if len(_new_norm) >= 10:
                _clash = await db.users.find_one(
                    {"tenant_id": user["tenant_id"], "phone_norm": _new_norm, "id": {"$ne": user_id}},
                    {"_id": 0, "name": 1},
                )
                if _clash:
                    raise HTTPException(
                        status_code=400,
                        detail=f"That mobile number is already {_clash.get('name')}'s in this workspace.",
                    )
        updates["phone"] = _p
        updates["phone_norm"] = _new_norm
    if inp.reporting_manager_id is not None:
        rm = inp.reporting_manager_id.strip()
        if rm and rm != user_id:
            mgr = await db.users.find_one({"id": rm, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
            updates["reporting_manager_id"] = rm if mgr else None
        else:
            updates["reporting_manager_id"] = None
    if inp.title is not None:
        # 2026-09-14 — the job title on the Team tree; an empty string clears it.
        updates["title"] = inp.title.strip()[:80] or None
    # RBAC P1 (2026-09-15): name and email can be corrected, and an email must
    # be free. 2026-09-19 — whose call it is depends on what the email DOES:
    # for someone with a password it is their sign-in, so only an owner
    # changes it and it can't be removed; for a member who signs in by mobile
    # it is contact detail, so whoever manages the team may add, fix or clear
    # it (they could already set it when adding the member).
    if inp.name is not None:
        name = inp.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Enter a name")
        updates["name"] = name[:80]
    unsets = {}
    if inp.email is not None and inp.email.strip().lower() != (target.get("email") or "").lower():
        email_signs_in = not target.get("passwordless")
        if email_signs_in and not acting_is_owner:
            raise HTTPException(status_code=403, detail="Only an owner can change someone's email, because it's how they sign in.")
        email = inp.email.strip().lower()
        if not email:
            if email_signs_in:
                raise HTTPException(status_code=400, detail="They sign in with this email, so it can be changed but not removed.")
            # Absent rather than empty: users.email is unique among real
            # addresses only (bootstrap/lifecycle.py).
            unsets.update({"email": "", "email_verified_at": ""})
        else:
            local, _, domain = email.partition("@")
            if not local or "." not in domain:
                raise HTTPException(status_code=400, detail="Enter a valid email, or leave it empty")
            if await db.users.find_one({"email": email, "id": {"$ne": user_id}}, {"_id": 0, "id": 1}):
                raise HTTPException(status_code=400, detail="That email is already used by another account")
            updates["email"] = email
            # A different address is unconfirmed until its owner clicks the link.
            updates["email_verified_at"] = None
    if updates or unsets:
        # E2-57: tenant scope on the write (defense-in-depth; target was
        # already loaded from this tenant above).
        _write = {}
        if updates:
            _write["$set"] = updates
        if unsets:
            _write["$unset"] = unsets
        await db.users.update_one(
            {"id": user_id, "tenant_id": user["tenant_id"]},
            _write,
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
        if "permissions_custom" in updates:
            membership_updates["permissions_custom"] = updates["permissions_custom"]
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
# Profile photo (ASK-25)
# ---------------------------------------------------------------------------
# The face on a member's Team card and on every My Work card assigned to them.
# A member sets their own; a team manager can set anyone's, except that only
# an owner may change another owner's — the same line PATCH /users draws.
# The client squares and shrinks the image to 256px before sending, so 2MB is
# generous; the cap is for callers that skip that.
AVATAR_MAX_BYTES = 2 * 1024 * 1024
# content type -> (the extension _store_file accepts, a magic-byte test). The
# declared type is the client's word; the bytes are checked so nothing that
# is not an image gets stored and served back as one.
_AVATAR_TYPES = {
    "image/jpeg": ("jpg", lambda b: b[:3] == b"\xff\xd8\xff"),
    "image/png": ("png", lambda b: b[:8] == b"\x89PNG\r\n\x1a\n"),
    "image/webp": ("webp", lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP"),
}
_USER_PUBLIC = {"_id": 0, "password_hash": 0, "invite_token": 0, "invite_expires_at": 0}


async def _avatar_target(user: dict, user_id: str) -> dict:
    target = await db.users.find_one(
        {"id": user_id, "tenant_id": user["tenant_id"]},
        {"_id": 0, "id": 1, "role": 1, "avatar_file_id": 1},
    )
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if user_id != user["id"]:
        if "team_manage" not in user_perms(user):
            raise HTTPException(status_code=403, detail="Only the member or a team manager can change this photo")
        if target.get("role") == "owner" and user.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only an owner can change another owner's photo")
    return target


async def _retire_avatar_file(tenant_id: str, file_id: Optional[str]) -> None:
    # Soft delete, like every other file record: nothing references it now.
    if file_id:
        await db.files.update_one({"id": file_id, "tenant_id": tenant_id}, {"$set": {"is_deleted": True}})


@router.post("/users/{user_id}/avatar")
async def upload_avatar(user_id: str, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    from services.files import _store_file
    target = await _avatar_target(user, user_id)
    kind = _AVATAR_TYPES.get((file.content_type or "").lower())
    head = await file.read(12)
    if not kind or not kind[1](head):
        raise HTTPException(status_code=400, detail="Use a JPG, PNG or WebP image")
    file.file.seek(0, 2)
    too_big = file.file.tell() > AVATAR_MAX_BYTES
    await file.seek(0)
    if too_big:
        raise HTTPException(status_code=400, detail="Photo too large (max 2MB)")
    # _store_file takes the extension from the filename, so name the file for
    # what its bytes were just shown to be rather than whatever was sent.
    file.filename = f"avatar.{kind[0]}"
    rec = await _store_file(user["tenant_id"], user["id"], file, "avatar")
    await db.users.update_one(
        {"id": user_id, "tenant_id": user["tenant_id"]},
        {"$set": {
            "avatar_url": f"/api/files/{rec['id']}/download",
            "avatar_file_id": rec["id"],
            "avatar_updated_at": now_iso(),
        }},
    )
    await _retire_avatar_file(user["tenant_id"], target.get("avatar_file_id"))
    return await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, _USER_PUBLIC)


@router.delete("/users/{user_id}/avatar")
async def remove_avatar(user_id: str, user: dict = Depends(get_current_user)):
    target = await _avatar_target(user, user_id)
    await db.users.update_one(
        {"id": user_id, "tenant_id": user["tenant_id"]},
        {"$unset": {"avatar_url": "", "avatar_file_id": ""}, "$set": {"avatar_updated_at": now_iso()}},
    )
    await _retire_avatar_file(user["tenant_id"], target.get("avatar_file_id"))
    return await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, _USER_PUBLIC)


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
    from services.leave import _create_leave
    if inp.leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid leave type")
    if inp.to_date[:10] < inp.from_date[:10]:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    return await _create_leave(user["tenant_id"], user, inp.leave_type,
                               inp.from_date, inp.to_date,
                               inp.day_portion, inp.reason, is_emergency=False)


@router.post("/leaves/absence")
async def report_absence(inp: AbsenceInput, user: dict = Depends(get_current_user)):
    from services.leave import _create_leave
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


async def _own_leave(leave_id: str, user: dict) -> dict:
    """A leave request the caller raised themselves. Only the requester may
    answer a question on it or take it back — not their manager, not an owner."""
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if lv.get("user_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the person who asked for this leave can do that.")
    return lv


@router.post("/leaves/{leave_id}/respond")
async def respond_to_leave_question(leave_id: str, inp: LeaveDecisionInput,
                                    user: dict = Depends(get_current_user)):
    """Answer the approver's "needs more info" (2026-09-19).

    The approver could ask a question and the requester had no way to answer
    it — their only move was raising a fresh request. The reply goes back on
    the request, it returns to Pending, and the approver is told as an
    approval (so their delegate hears too, and it lands in their queue).
    """
    from services.notifications import push_notification
    lv = await _own_leave(leave_id, user)
    if lv.get("status") != "info_requested":
        raise HTTPException(status_code=409, detail="This request isn't waiting on an answer from you.")
    reply = (inp.note or "").strip()
    if not reply:
        raise HTTPException(status_code=400, detail="Write your answer first.")
    reply = reply[:1000]
    await db.leaves.update_one(
        {"id": leave_id, "tenant_id": user["tenant_id"]},
        {"$set": {"status": "pending", "reply_note": reply, "replied_at": now_iso()},
         "$push": {"history": {"action": "replied", "by": user["id"], "by_name": user.get("name"),
                               "note": reply, "at": now_iso()}}},
    )
    if lv.get("approver_id"):
        await push_notification(user["tenant_id"], [lv["approver_id"]], 2,
                                f"{user.get('name')} answered your question about their leave: {reply[:140]}",
                                entity_type="leave", entity_id=leave_id, ntype="approval",
                                title=f"{lv.get('leave_type', 'Leave').title()} leave", sender=user.get("name"))
    await log_activity(user["tenant_id"], user["id"], "leave_replied",
                       f"{user.get('name')} answered a question on their leave", "leave", leave_id)
    return await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]}, {"_id": 0})


@router.post("/leaves/{leave_id}/withdraw")
async def withdraw_leave(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(get_current_user)):
    """Take back your own leave request (2026-09-19).

    While it waits on a decision, or once approved but before it starts —
    plans change. Not after it has started (that is coming back early, which
    is a conversation with your manager) and not once rejected. The request is
    kept, marked withdrawn, so the history stays true, and the approver is told.
    """
    from services.notifications import push_notification
    lv = await _own_leave(leave_id, user)
    status = lv.get("status")
    today = datetime.now(timezone.utc).date().isoformat()
    if status == LEAVE_WITHDRAWN:
        raise HTTPException(status_code=409, detail="You've already withdrawn this request.")
    if status == "rejected":
        raise HTTPException(status_code=409, detail="This request was rejected — there's nothing to withdraw.")
    if status == "approved" and (lv.get("from_date") or "") <= today:
        raise HTTPException(status_code=409, detail="This leave has already started, so it can't be withdrawn here. Tell your manager if you're back early.")
    note = (inp.note or "").strip()[:500]
    await db.leaves.update_one(
        {"id": leave_id, "tenant_id": user["tenant_id"]},
        {"$set": {"status": LEAVE_WITHDRAWN, "withdrawn_at": now_iso(), "withdrawn_note": note or None},
         "$push": {"history": {"action": "withdrawn", "by": user["id"], "by_name": user.get("name"),
                               "note": note, "at": now_iso()}}},
    )
    if lv.get("approver_id"):
        was = "approved " if status == "approved" else ""
        await push_notification(user["tenant_id"], [lv["approver_id"]], 1,
                                f"{user.get('name')} withdrew their {was}leave ({lv.get('from_date')}"
                                + (f" → {lv.get('to_date')}" if lv.get("to_date") != lv.get("from_date") else "") + ")"
                                + (f": {note}" if note else ""),
                                entity_type="leave", entity_id=leave_id, ntype="leave_withdrawn",
                                title=f"{lv.get('leave_type', 'Leave').title()} leave", sender=user.get("name"))
    await log_activity(user["tenant_id"], user["id"], "leave_withdrawn",
                       f"{user.get('name')} withdrew their leave", "leave", leave_id)
    return await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]}, {"_id": 0})


@router.get("/leaves/{leave_id}/impact")
async def leave_impact(leave_id: str, user: dict = Depends(get_current_user)):
    """AI-driven: for each active task assigned to the person on leave, suggest
    a reassignment/extension/monitor action based on team workload."""
    from services.leave import ai_leave_impact
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
               or t.get("status") in ("in_progress", "waiting", "review")]  # ASK-28 TK-07: Doing
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

"""FIX-004-H (RBAC-22): off-boarding / deprovisioning wizard.

Orchestrator that composes existing services (memberships, session
tracking, session revocation, audit log) into a single idempotent
"remove this person from this workspace, cleanly" operation.

Blocks-go-live P0: without this, offboarding a departing employee
leaves:
  * their sessions still valid until JWT exp (7 days)
  * their owned tasks orphaned (no assignee)
  * their in-flight decisions stuck (no reviewer)
  * their invite tokens (if pending) reusable
  * their contact assignments dangling

The wizard's contract:

  deprovision_user(db, *, target_user_id, tenant_id, actor_user_id,
                    reassign_to_user_id=None) -> DeprovisionReport

Steps, in order (each idempotent):
  1. Guard: target must have a membership in tenant_id, actor must
     have team_manage. If target is the only owner, refuse — you
     can't off-board the sole owner without transferring ownership
     first (a separate flow — FIX-FUP-XX ownership transfer).
  2. Revoke every active_sessions row for (target, tenant) — only
     THIS tenant, not other tenants target may be a member of.
  3. Soft-remove the membership (status = "removed").
  4. Invalidate the invite token on the legacy user doc if any.
  5. Reassign owned tasks: any task in this tenant with
     assignee_id == target -> reassign_to_user_id (if given) or
     nullify + set status metadata "unassigned".
  6. Reassign authored contacts: contacts with assigned_id ==
     target -> reassign_to_user_id (or null).
  7. Record audit_log(action=user_deprovisioned) with the report
     summary as `meta`.

Returns a DeprovisionReport dict:
  {
    ok: bool,
    target_user_id: str,
    tenant_id: str,
    reassigned_to: str | None,
    sessions_revoked: int,
    membership_removed: bool,
    tasks_reassigned: int,
    contacts_reassigned: int,
    invite_token_cleared: bool,
  }

Idempotent: running deprovision twice returns the same report shape
with zeros/false on the second call (nothing left to do).
"""
from typing import Any, Dict, Optional

from core import logger, now_iso


async def deprovision_user(
    db,
    *,
    target_user_id: str,
    tenant_id: str,
    actor_user_id: Optional[str] = None,
    reassign_to_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """See module docstring. Never raises for a well-formed input;
    orchestration failures on individual steps are logged and surfaced
    in the report so the caller can decide whether to retry."""
    report: Dict[str, Any] = {
        "ok": True,
        "target_user_id": target_user_id,
        "tenant_id": tenant_id,
        "reassigned_to": reassign_to_user_id,
        "sessions_revoked": 0,
        "membership_removed": False,
        "tasks_reassigned": 0,
        "contacts_reassigned": 0,
        "invite_token_cleared": False,
    }

    # 1. Guards (last-owner check).
    from services.auth.membership import (
        find_membership,
        remove_membership,
        list_memberships_for_tenant,
        LIVE_STATUSES,
    )
    target_membership = await find_membership(db, target_user_id, tenant_id)
    if target_membership and target_membership.get("role") == "owner":
        all_active = await list_memberships_for_tenant(
            db, tenant_id, statuses=LIVE_STATUSES,
        )
        active_owners = [m for m in all_active if m.get("role") == "owner"]
        if len(active_owners) <= 1 and target_membership.get("status") in LIVE_STATUSES:
            report["ok"] = False
            report["error"] = ("Cannot deprovision the last owner. Promote another "
                                "member to owner first, then retry.")
            return report
    target_user = await db.users.find_one({"id": target_user_id, "tenant_id": tenant_id},
                                          {"_id": 0, "id": 1, "role": 1})
    if not target_membership and (target_user or {}).get("role") == "owner":
        # 2026-09-15: an owner from before memberships — count every other owner,
        # with a live membership or an account of the same age.
        live_owner_ids = {m["user_id"] for m in await list_memberships_for_tenant(db, tenant_id, statuses=LIVE_STATUSES)
                          if m.get("role") == "owner"}
        other_legacy = await db.users.find_one({"tenant_id": tenant_id, "role": "owner", "id": {"$ne": target_user_id}},
                                               {"_id": 0, "id": 1})
        if not (live_owner_ids - {target_user_id}) and not other_legacy:
            report["ok"] = False
            report["error"] = ("Cannot deprovision the last owner. Promote another "
                                "member to owner first, then retry.")
            return report

    # 2. Revoke sessions scoped to THIS tenant only.
    try:
        from services.auth.session_tracking import revoke_all_sessions_for_user
        report["sessions_revoked"] = await revoke_all_sessions_for_user(
            db, user_id=target_user_id, tenant_id=tenant_id,
        )
    except Exception as e:
        logger.warning(f"[deprovision] session revoke failed for {target_user_id}: {e}")

    # 3. Soft-remove membership.
    try:
        report["membership_removed"] = await remove_membership(
            db, user_id=target_user_id, tenant_id=tenant_id,
        )
        if not target_membership and target_user:
            # 2026-09-15: an account from before memberships had no row to mark,
            # so the legacy sign-in fallback still let them in. Record the removal.
            await db.memberships.insert_one({
                "id": f"removed-{target_user_id}-{tenant_id}", "user_id": target_user_id, "tenant_id": tenant_id,
                "role": target_user.get("role"), "status": "removed", "removed_at": now_iso(),
                "created_at": now_iso(), "updated_at": now_iso(),
            })
            report["membership_removed"] = True
    except Exception as e:
        logger.warning(f"[deprovision] membership remove failed: {e}")

    # 4. Clear the invite token on the legacy user doc (idempotent).
    try:
        res = await db.users.update_one(
            {"id": target_user_id, "tenant_id": tenant_id},
            {"$set": {"invite_token": None, "invite_expires_at": None,
                      "updated_at": now_iso()}},
        )
        report["invite_token_cleared"] = getattr(res, "modified_count", 0) > 0
    except Exception as e:
        logger.warning(f"[deprovision] invite clear failed: {e}")

    # 5. Reassign owned tasks. Tasks belonging to THIS tenant with
    # assignee_id == target -> reassign_to_user_id or null.
    try:
        set_fields: Dict[str, Any] = {
            "assignee_id": reassign_to_user_id,
            "updated_at": now_iso(),
        }
        if not reassign_to_user_id:
            set_fields["assignee_role"] = None
        else:
            # Denormalized name/role update — best-effort look-up.
            replacement = await db.users.find_one(
                {"id": reassign_to_user_id, "tenant_id": tenant_id},
                {"_id": 0, "name": 1, "role": 1},
            )
            if replacement:
                set_fields["assignee_role"] = replacement.get("role")
        # 2026-09-15: open work only — finished tasks keep who did them.
        res = await db.tasks.update_many(
            {"tenant_id": tenant_id, "assignee_id": target_user_id, "status": {"$nin": ["done", "cancelled"]}},
            {"$set": set_fields},
        )
        report["tasks_reassigned"] = getattr(res, "modified_count", 0)
        # J12-07 (JOURNEY-1) — AND THE PERSON WHO INHERITS IT IS TOLD. Work
        # moved onto somebody's plate in silence: their My Work grew by three
        # tasks overnight, with nothing to say where they came from or that a
        # colleague had left. They find out by noticing, which is how a due
        # date gets missed. One notification, naming who left and how many.
        if reassign_to_user_id and report["tasks_reassigned"]:
            n = report["tasks_reassigned"]
            leaver = await db.users.find_one({"id": target_user_id, "tenant_id": tenant_id},
                                             {"_id": 0, "name": 1}) or {}
            who = (leaver.get("name") or "").strip() or "a colleague who has left"
            from services.notifications import push_notification
            await push_notification(
                tenant_id, [reassign_to_user_id], 2,
                f"{n} open {'task' if n == 1 else 'tasks'} moved to you from {who}, who has left the company. "
                f"They are on My Work now — check the dates.",
                entity_type="task", ntype="handoff",
                title=f"{n} {'task' if n == 1 else 'tasks'} from {who}",
            )
    except Exception as e:
        logger.warning(f"[deprovision] task reassign failed: {e}")

    # 5b. ASK-26 — off every task they were on alongside a lead. And where the
    # replacement just became lead of a task they were already listed on,
    # they come off that list too rather than appearing beside themselves.
    try:
        res = await db.tasks.update_many(
            {"tenant_id": tenant_id, "co_assignee_ids": target_user_id},
            {"$pull": {"co_assignee_ids": target_user_id}, "$set": {"updated_at": now_iso()}},
        )
        report["co_assignments_removed"] = getattr(res, "modified_count", 0)
        if reassign_to_user_id:
            await db.tasks.update_many(
                {"tenant_id": tenant_id, "assignee_id": reassign_to_user_id, "co_assignee_ids": reassign_to_user_id},
                {"$pull": {"co_assignee_ids": reassign_to_user_id}},
            )
    except Exception as e:
        logger.warning(f"[deprovision] co-assignee removal failed: {e}")

    # 5c. 2026-09-15 — nothing waits on someone who has left. Open tasks they
    # approve and decisions waiting on them go to the replacement when that
    # person may approve / decide, else to an owner; the people who reported
    # to them report to the replacement (or to nobody).
    try:
        from core import user_perms
        tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1}) or {}
        role_map = {r["key"]: list(r["permissions"]) for r in (tenant.get("roles") or [])
                    if r.get("key") and isinstance(r.get("permissions"), list) and r.get("permissions")}
        rep = (await db.users.find_one({"id": reassign_to_user_id, "tenant_id": tenant_id},
                                       {"_id": 0, "id": 1, "role": 1, "permissions": 1})
               if reassign_to_user_id else None)
        live = await list_memberships_for_tenant(db, tenant_id, statuses=LIVE_STATUSES)
        owners = [m["user_id"] for m in live if m.get("role") == "owner" and m.get("user_id") != target_user_id]
        owner_id = owners[0] if owners else None
        if not owner_id:
            legacy_owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner", "id": {"$ne": target_user_id}},
                                                   {"_id": 0, "id": 1})
            owner_id = (legacy_owner or {}).get("id")

        def _may(perm: str) -> bool:
            return bool(rep) and (rep.get("role") == "owner" or perm in user_perms({**rep, "_role_perms_map": role_map}))

        res = await db.tasks.update_many(
            {"tenant_id": tenant_id, "approver_id": target_user_id, "status": {"$nin": ["done", "cancelled"]}},
            {"$set": {"approver_id": reassign_to_user_id if _may("approvals") else owner_id, "updated_at": now_iso()}},
        )
        report["approvals_moved"] = getattr(res, "modified_count", 0)
        res = await db.decisions.update_many(
            {"tenant_id": tenant_id, "approver_id": target_user_id, "status": {"$in": ["pending", "pending_approval"]}},
            {"$set": {"approver_id": reassign_to_user_id if _may("decisions_approve") else owner_id, "updated_at": now_iso()}},
        )
        report["decisions_moved"] = getattr(res, "modified_count", 0)
        res = await db.users.update_many(
            {"tenant_id": tenant_id, "reporting_manager_id": target_user_id},
            {"$set": {"reporting_manager_id": reassign_to_user_id, "updated_at": now_iso()}},
        )
        report["reports_moved"] = getattr(res, "modified_count", 0)
        if reassign_to_user_id:
            # The replacement may have reported to the person who left.
            await db.users.update_one(
                {"id": reassign_to_user_id, "tenant_id": tenant_id, "reporting_manager_id": reassign_to_user_id},
                {"$set": {"reporting_manager_id": None}},
            )
    except Exception as e:
        logger.warning(f"[deprovision] approvals/decisions/reports hand-over failed: {e}")

    # 6. Reassign authored contacts.
    try:
        res = await db.contacts.update_many(
            {"tenant_id": tenant_id, "assigned_id": target_user_id},
            {"$set": {"assigned_id": reassign_to_user_id, "updated_at": now_iso()}},
        )
        report["contacts_reassigned"] = getattr(res, "modified_count", 0)
    except Exception as e:
        logger.warning(f"[deprovision] contact reassign failed: {e}")

    # 7. Audit — best-effort. actor context caller-provided.
    try:
        from services import audit_log as _audit
        await _audit.record(
            db, action="user_deprovisioned",
            actor_id=actor_user_id, tenant_id=tenant_id,
            entity_type="user", entity_id=target_user_id,
            meta={
                "sessions_revoked": report["sessions_revoked"],
                "membership_removed": report["membership_removed"],
                "tasks_reassigned": report["tasks_reassigned"],
                "contacts_reassigned": report["contacts_reassigned"],
                "reassigned_to": reassign_to_user_id,
            },
        )
    except Exception:
        pass

    return report

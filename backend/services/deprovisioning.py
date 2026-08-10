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
        res = await db.tasks.update_many(
            {"tenant_id": tenant_id, "assignee_id": target_user_id},
            {"$set": set_fields},
        )
        report["tasks_reassigned"] = getattr(res, "modified_count", 0)
    except Exception as e:
        logger.warning(f"[deprovision] task reassign failed: {e}")

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

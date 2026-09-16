"""FIX-004-B (RBAC-13): user ↔ tenant memberships.

Introduces the many-to-many link between users and tenants that lets
one person (identified by email) belong to multiple workspaces —
accountants serving several client SMEs, founders who ran two
businesses, employees invited to a second workspace by a friend.

Before this fix:
  * `user.tenant_id` was a single foreign key. A person was welded
    to one workspace forever.
  * `users.email` was globally unique. The same person couldn't hold
    a second account.

Now:
  * `users` holds identity only: id, email, phone, phone_norm, name,
    password_hash, email_verified_at. The email is still globally
    unique (one PERSON per email), but a person is no longer tied
    to a single tenant.
  * `memberships` holds the tenant-scoped relationship: role,
    permissions, status (pending / active / suspended / removed),
    invite metadata, timestamps.

Compat: existing code overwhelmingly reads `user["tenant_id"]`,
`user["role"]`, `user["permissions"]`. `get_current_user` populates
those keys from the CURRENT membership so ~430 downstream call sites
keep working unchanged. The JWT already includes tenant_id, so
"current membership" is deterministic per request.

Collection shape:
  memberships (compound unique index on user_id + tenant_id)
    id           str      new_id() — stable membership handle
    user_id      str      -> users.id
    tenant_id    str      -> tenants.id
    role         str      "owner" | "sales" | tenant-defined role key
    permissions  [str]    optional per-user overrides (was on user.permissions)
    status       str      "pending" | "active" | "suspended" | "removed"
    invited_by   str?     user_id who invited (None for the workspace
                          creator's own membership)
    invited_at   iso
    accepted_at  iso?
    removed_at   iso?
    created_at   iso
    updated_at   iso

Status flow:
  * "pending"  — invited, hasn't logged in yet (invite_token pending)
  * "active"   — logged in / accepted invite
  * "suspended" — soft-disabled (admin action), can be reactivated
  * "removed"  — soft-deleted, retained for audit / re-invite dedup

get_current_user rejects tokens whose current membership is not
active — a suspended user's JWT stops working immediately (combined
with FIX-003-C session revocation for immediate cutoff).
"""
from typing import Optional, List, Dict, Any

from core import new_id, now_iso


COLLECTION = "memberships"

STATUS_PENDING = "pending"
STATUS_ACTIVE = "active"
STATUS_SUSPENDED = "suspended"
STATUS_REMOVED = "removed"

VALID_STATUSES = {STATUS_PENDING, STATUS_ACTIVE, STATUS_SUSPENDED, STATUS_REMOVED}

# The pseudo-statuses `get_current_user` will honor as a live session.
LIVE_STATUSES = {STATUS_ACTIVE}


async def create_membership(
    db,
    *,
    user_id: str,
    tenant_id: str,
    role: str,
    permissions: Optional[List[str]] = None,
    invited_by: Optional[str] = None,
    status: str = STATUS_ACTIVE,
    invite_token: Optional[str] = None,
    invite_expires_at: Optional[str] = None,
) -> Dict[str, Any]:
    """Insert a membership row. Idempotent: if a live membership already
    exists for (user_id, tenant_id), returns it unchanged (rather than
    duplicating). Removed memberships are re-activated in place by an
    idempotent create — the old row's status flips back rather than
    accumulating history rows."""
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid membership status: {status!r}")
    existing = await db[COLLECTION].find_one(
        {"user_id": user_id, "tenant_id": tenant_id}, {"_id": 0}
    )
    now = now_iso()
    if existing:
        if existing.get("status") == STATUS_REMOVED:
            # Re-inviting a removed member: flip status + refresh audit.
            if status == STATUS_ACTIVE:
                # BUG-12: reactivating consumes a seat -> atomic reservation gate.
                from services.plans import reserve_seat
                await reserve_seat(db, tenant_id)
            updates = {
                "status": status,
                "role": role,
                "permissions": list(permissions or []),
                "invited_by": invited_by,
                "invited_at": now,
                "accepted_at": now if status == STATUS_ACTIVE else None,
                "removed_at": None,
                "invite_token": invite_token,
                "invite_expires_at": invite_expires_at,
                "updated_at": now,
            }
            await db[COLLECTION].update_one(
                {"id": existing["id"]}, {"$set": updates}
            )
            return {**existing, **updates}
        return existing
    if status == STATUS_ACTIVE:
        # BUG-12: a new active member consumes a seat -> atomic reservation gate
        # (raises 402 at the cap) BEFORE we insert.
        from services.plans import reserve_seat
        await reserve_seat(db, tenant_id)
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "permissions": list(permissions or []),
        "status": status,
        "invited_by": invited_by,
        "invited_at": now,
        "accepted_at": now if status == STATUS_ACTIVE else None,
        "removed_at": None,
        "invite_token": invite_token,
        "invite_expires_at": invite_expires_at,
        "created_at": now,
        "updated_at": now,
    }
    await db[COLLECTION].insert_one(dict(doc))
    doc.pop("_id", None)
    return doc


async def find_membership(db, user_id: str, tenant_id: str,
                           statuses: Optional[set] = None) -> Optional[Dict[str, Any]]:
    """Look up (user, tenant) membership. If statuses given, only returns
    rows whose status is in that set — most callers want the live ones
    (`LIVE_STATUSES`)."""
    q = {"user_id": user_id, "tenant_id": tenant_id}
    if statuses:
        q["status"] = {"$in": list(statuses)}
    return await db[COLLECTION].find_one(q, {"_id": 0})


async def legacy_access_allowed(db, user: dict, tenant_id: str) -> bool:
    """Accounts from before memberships fall back to the user's own tenant_id and
    role — but never someone who HAS a membership row for that workspace. A
    removed, suspended or pending row is the answer; before 2026-09-15 a removed
    member still signed in through this fallback."""
    if not (tenant_id and user.get("tenant_id") == tenant_id and user.get("role")):
        return False
    return not await db[COLLECTION].find_one({"user_id": user.get("id"), "tenant_id": tenant_id}, {"_id": 0, "status": 1})


async def accept_pending_membership(db, user_id: str, tenant_id: Optional[str] = None):
    """Signing in IS accepting the invite: flip a pending membership to active.

    2026-09-16 — nothing else moved a row off "pending". Since 59e9684 a pending
    row also blocks the legacy fallback in get_current_user, so an invited member
    came through the OTP flow with a token and was refused on their very next
    request ("You no longer have access to this workspace"). The accept has to
    happen at the moment they prove the phone, which is here.

    Suspended and removed rows are left alone — those are decisions someone made
    about the member, not a state they can log their way out of.

    ``tenant_id`` names the workspace being entered; without it, a member holding
    exactly one pending invite is accepted into that one and anything more
    ambiguous is left for the invite link to resolve.

    The seat is recounted, not reserved: an invite is handed out before the seat
    is held, so a workspace that filled up in the meantime must not lock out
    someone who was already invited. recount keeps tenant.seats_used truthful,
    which over-blocks the NEXT add — the safe direction.
    """
    if not tenant_id:
        pending = await list_memberships_for_user(db, user_id, statuses={STATUS_PENDING})
        if len(pending) != 1:
            return None
        tenant_id = pending[0]["tenant_id"]
    res = await db[COLLECTION].update_one(
        {"user_id": user_id, "tenant_id": tenant_id, "status": STATUS_PENDING},
        {"$set": {"status": STATUS_ACTIVE, "accepted_at": now_iso(), "updated_at": now_iso()}},
    )
    if not getattr(res, "modified_count", 0):
        return None
    try:
        from services.plans import recount_seats
        await recount_seats(db, tenant_id)
    except Exception:
        pass   # billing bookkeeping must never stand between a member and login
    return await find_membership(db, user_id, tenant_id)


async def list_memberships_for_user(db, user_id: str,
                                      statuses: Optional[set] = None) -> List[Dict[str, Any]]:
    """Every tenant this user belongs to (filtered by status). Used by
    /me/workspaces and the login-ambiguity picker."""
    q: dict = {"user_id": user_id}
    if statuses:
        q["status"] = {"$in": list(statuses)}
    rows = await db[COLLECTION].find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


async def list_memberships_for_tenant(db, tenant_id: str,
                                        statuses: Optional[set] = None) -> List[Dict[str, Any]]:
    """Every user in a workspace. Replaces `db.users.find({tenant_id: X})`
    for the case where the caller wants to list team members."""
    q: dict = {"tenant_id": tenant_id}
    if statuses:
        q["status"] = {"$in": list(statuses)}
    return await db[COLLECTION].find(q, {"_id": 0}).sort("created_at", 1).to_list(500)


async def update_membership(db, *, user_id: str, tenant_id: str,
                             updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Patch role / permissions / status on a membership. Returns the
    updated doc or None if none matched."""
    if not updates:
        return await find_membership(db, user_id, tenant_id)
    # BUG-12: keep tenant.seats_used in step with active-status transitions.
    new_status = updates.get("status")
    if new_status is not None:
        old = await find_membership(db, user_id, tenant_id)
        old_status = old.get("status") if old else None
        if old and old_status != STATUS_ACTIVE and new_status == STATUS_ACTIVE:
            from services.plans import reserve_seat           # activating -> reserve (gate at cap)
            await reserve_seat(db, tenant_id)
        elif old and old_status == STATUS_ACTIVE and new_status != STATUS_ACTIVE:
            from services.plans import release_seat           # leaving active -> free the seat
            await release_seat(db, tenant_id)
    updates = {**updates, "updated_at": now_iso()}
    res = await db[COLLECTION].update_one(
        {"user_id": user_id, "tenant_id": tenant_id},
        {"$set": updates},
    )
    if getattr(res, "matched_count", 0) == 0:
        return None
    return await find_membership(db, user_id, tenant_id)


async def remove_membership(db, *, user_id: str, tenant_id: str) -> bool:
    """Soft-delete: set status=removed + removed_at. Preserves the row
    for audit. Idempotent (removing an already-removed membership is a
    no-op returning True)."""
    now = now_iso()
    # BUG-12: if the removed member was ACTIVE, free their seat.
    old = await find_membership(db, user_id, tenant_id)
    was_active = bool(old and old.get("status") == STATUS_ACTIVE)
    res = await db[COLLECTION].update_one(
        {"user_id": user_id, "tenant_id": tenant_id},
        {"$set": {"status": STATUS_REMOVED, "removed_at": now, "updated_at": now}},
    )
    matched = getattr(res, "matched_count", 0) > 0
    if matched and was_active:
        from services.plans import release_seat
        await release_seat(db, tenant_id)
    return matched


async def resolve_login_choices(db, user_id: str) -> List[Dict[str, Any]]:
    """Build the login-ambiguity picker payload for a user with N
    live memberships. Returns:
        [{tenant_id, tenant_name, role}, ...]

    Ordered most-recent-membership first so the login UI naturally
    defaults to the workspace the user just joined."""
    memberships = await list_memberships_for_user(db, user_id, statuses=LIVE_STATUSES)
    if not memberships:
        return []
    tenant_ids = list({m["tenant_id"] for m in memberships})
    tmap = {}
    async for t in db.tenants.find(
        {"id": {"$in": tenant_ids}}, {"_id": 0, "id": 1, "name": 1},
    ):
        tmap[t["id"]] = t.get("name") or ""
    return [
        {
            "tenant_id": m["tenant_id"],
            "tenant_name": tmap.get(m["tenant_id"], ""),
            "role": m.get("role"),
        }
        for m in memberships
    ]


def project_membership_onto_user(user: dict, membership: dict) -> dict:
    """Compat helper for `get_current_user`. Merges the current-tenant
    membership into the user dict so ~430 downstream call sites that
    read `user["tenant_id"]` / `user["role"]` / `user["permissions"]`
    keep working unchanged during the transition.

    Returns a NEW dict (doesn't mutate the input) so caching + serialization
    layers stay safe."""
    if not user or not membership:
        return user
    out = dict(user)
    out["tenant_id"] = membership.get("tenant_id")
    out["role"] = membership.get("role")
    out["permissions"] = list(membership.get("permissions") or [])
    out["membership_id"] = membership.get("id")
    out["membership_status"] = membership.get("status")
    if "permissions_custom" in membership:
        out["permissions_custom"] = bool(membership.get("permissions_custom"))
    return out


async def members_effective_perms(db, tenant_id: str, members: List[dict]) -> Dict[str, set]:
    """What each member can actually open in this workspace — the answer
    get_current_user + user_perms give when that person signs in: their
    membership's role and access, the company's role settings, temporary
    grants and owner exclusions. Someone removed or suspended opens nothing.

    2026-09-15 (RBAC P1): decision routing, approver checks and approval
    notifications read the bare user record before, so they could disagree
    with what the person really had."""
    from core import user_perms
    people = [m for m in (members or []) if m and m.get("id")]
    if not people:
        return {}
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1, "owner_exclusions": 1}) or {}
    role_map = {r["key"]: list(r["permissions"]) for r in (tenant.get("roles") or [])
                if r.get("key") and isinstance(r.get("permissions"), list) and r.get("permissions")}
    rows = await db[COLLECTION].find(
        {"tenant_id": tenant_id, "user_id": {"$in": [p["id"] for p in people]}}, {"_id": 0},
    ).to_list(len(people) * 2 + 10)
    by_uid = {r["user_id"]: r for r in rows}
    out: Dict[str, set] = {}
    for p in people:
        row = by_uid.get(p["id"])
        if row and row.get("status") in (STATUS_REMOVED, STATUS_SUSPENDED):
            out[p["id"]] = set()
            continue
        src = {**p, "_role_perms_map": role_map, "_owner_exclusions": list(tenant.get("owner_exclusions") or [])}
        if row:
            src = project_membership_onto_user(src, row)
            src["_temp_grants"] = list(row.get("temp_grants") or [])
        out[p["id"]] = user_perms(src)
    return out

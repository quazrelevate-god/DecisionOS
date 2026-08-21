"""RBAC permission resolution (Epic 8 Sprint 2).

Pure functions extracted from core.py: resolve a user's effective permission
set (user_perms) and sanitize a permission list (clean_perms), plus the
_BASE_PERMS / ROLE_DEFAULT_PERMS defaults. No db, no auth wrappers -- those
(require_perm / require_role / tenant_role_keys) stay in core alongside the
request dependencies. core re-exports these names.
"""
from config import PERMISSION_KEYS  # noqa: F401


# --- Module-level access permissions ---------------------------------------
# PERMISSION_KEYS + DEFAULT_ROLES come from `config.py` (re-exported above).
# FIX-FUP-51 (2026-08-13): "people" (contacts list — customer +
# supplier + vendor) moved OUT of _BASE_PERMS. Was granting the
# full contact list to every default role (production, HR, custom).
# Vendor + supplier lists frequently contain price agreements,
# payment terms, and personal contact numbers; the founder wants
# them opt-in even for finance and sales — those roles now need
# the perm granted explicitly via Settings > Roles (or per-user
# via membership.permissions). Owner still passes via the
# "owner -> all PERMISSION_KEYS" branch in user_perms().
_BASE_PERMS = {"inbox", "data_input", "workflows", "tasks", "brain", "ask"}
ROLE_DEFAULT_PERMS = {
    "sales": _BASE_PERMS,
    "finance": _BASE_PERMS | {"finance", "ledger"},
}


def user_perms(user: dict) -> set:
    """Resolve the effective permission set for a user.

    Order of precedence (most-specific wins):
      1. Owner role -> ALL PERMISSION_KEYS, minus any owner_exclusions
         the tenant configured (FIX-004-D / RBAC-15). Lets a tenant
         opt an owner OUT of specific perms — e.g. "co-founder with
         everything EXCEPT finance visibility."
      2. Explicit per-user override (membership.permissions[] projected
         onto user.permissions[]) — replaces role defaults.
      3. Tenant-level role permissions (FIX-004-D / RBAC-14).
         tenant.roles[i].permissions[] set by an admin via
         PATCH /tenant/roles/{key}/permissions. Applies to every
         member holding that role in the tenant.
      4. Global ROLE_DEFAULT_PERMS map (baked into core.py for
         legacy roles like sales/finance).
      5. _BASE_PERMS fallback for custom roles with no explicit
         config anywhere.

    All the tenant-level bits (tenant_role_perms_map, owner_exclusions)
    are stashed on the user dict by get_current_user under
    underscore-prefixed keys so this function stays synchronous.
    """
    role = user.get("role")
    if role == "owner":
        excluded = set(user.get("_owner_exclusions") or [])
        base = set(PERMISSION_KEYS) - excluded
    else:
        # 2. Explicit per-user override wins over any role default.
        p = user.get("permissions")
        if isinstance(p, list) and len(p) > 0:
            base = {k for k in p if k in PERMISSION_KEYS}
        else:
            # 3. Tenant-level role permissions.
            role_map = user.get("_role_perms_map") or {}
            if role and role in role_map:
                base = {k for k in role_map[role] if k in PERMISSION_KEYS}
            else:
                # 4. Global ROLE_DEFAULT_PERMS, then 5. _BASE_PERMS fallback.
                base = set(ROLE_DEFAULT_PERMS.get(role, _BASE_PERMS))
    # RBAC-27 (2026-08-15): non-expired temp grants get merged in on top.
    # Format: user._temp_grants = [{perm, granted_by, expires_at, reason}]
    # populated by get_current_user from the membership doc. Stays a
    # simple union — no priority conflict since these ADD perms, never
    # remove them.
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    for g in (user.get("_temp_grants") or []):
        perm = g.get("perm")
        exp = str(g.get("expires_at") or "")
        if perm in PERMISSION_KEYS and (not exp or exp > now):
            base.add(perm)
    return base


def clean_perms(perms) -> list:
    if not isinstance(perms, list):
        return []
    seen, out = set(), []
    for k in perms:
        if k in PERMISSION_KEYS and k not in seen:
            seen.add(k)
            out.append(k)
    return out

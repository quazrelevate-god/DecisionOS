"""FIX-004-D (Wave 3 sub-batch B) tests: RBAC-14/15/16 — role model.

RBAC-14 — per-role permission editor:
  * user_perms() honors tenant-level role permission map.
  * PATCH /tenant/roles/{key}/permissions endpoint exists, requires
    team_manage, refuses 'owner' key.

RBAC-15 — owner exclusion list:
  * user_perms() returns all-perms MINUS owner_exclusions for owner.
  * PUT /tenant/owner-exclusions endpoint exists, is owner-only.
  * Empty exclusions = classic all-perms owner (backward compat).

RBAC-16 — production -> operations canonical rename:
  * config.ROLES uses 'operations' (matches config.DEFAULT_ROLES).
  * Bootstrap migration rewrites tenant.roles, users.role,
    memberships.role.
"""
import inspect
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# RBAC-14 — per-role permission editor
# ---------------------------------------------------------------------------
class TestPerRolePermissions:
    def test_role_map_wins_over_role_default(self):
        """A tenant that gave 'warehouse_manager' the finance perm
        gets finance in user_perms — replaces the _BASE_PERMS fallback."""
        from core import user_perms
        p = user_perms({
            "role": "warehouse_manager",
            "_role_perms_map": {
                "warehouse_manager": ["finance", "ledger", "tasks"],
            },
        })
        assert p == {"finance", "ledger", "tasks"}, (
            f"tenant role permissions must replace role defaults; got {p}"
        )

    def test_explicit_user_permissions_beat_role_map(self):
        """Order of precedence: user.permissions > tenant role map."""
        from core import user_perms
        p = user_perms({
            "role": "warehouse_manager",
            "permissions": ["ask"],   # explicit user override
            "_role_perms_map": {
                "warehouse_manager": ["finance", "ledger"],
            },
        })
        assert p == {"ask"}, (
            "explicit user permissions must beat tenant role permissions"
        )

    def test_empty_role_map_falls_back_to_defaults(self):
        """No entry in _role_perms_map = classic ROLE_DEFAULT_PERMS
        behavior (backward compat)."""
        from core import user_perms
        p = user_perms({"role": "sales", "_role_perms_map": {}})
        assert "inbox" in p
        assert "workflows" in p
        assert "finance" not in p

    def test_role_map_perms_filtered_to_known_keys(self):
        """Unknown/typo permission keys silently dropped so a corrupt
        tenant.roles doc can't grant nonexistent perms."""
        from core import user_perms
        p = user_perms({
            "role": "warehouse_manager",
            "_role_perms_map": {
                "warehouse_manager": ["finance", "nonexistent_perm", "tasks"],
            },
        })
        assert "finance" in p
        assert "tasks" in p
        assert "nonexistent_perm" not in p

    def test_endpoint_exists_and_is_gated(self):
        from server import update_role_permissions
        sig = inspect.signature(update_role_permissions)
        # Requires team_manage — visible in source.
        src = inspect.getsource(update_role_permissions)
        assert 'require_perm("team_manage")' in src

    def test_endpoint_refuses_owner_role(self):
        """Owner perms are managed via owner_exclusions, not per-role."""
        from server import update_role_permissions
        src = inspect.getsource(update_role_permissions)
        assert 'key == "owner"' in src
        assert 'status_code=400' in src

    def test_endpoint_refuses_unknown_role(self):
        from server import update_role_permissions
        src = inspect.getsource(update_role_permissions)
        assert '"Role not found"' in src
        assert 'status_code=404' in src

    def test_endpoint_filters_unknown_perms(self):
        """clean_perms drops keys not in PERMISSION_KEYS."""
        from server import update_role_permissions
        src = inspect.getsource(update_role_permissions)
        assert "clean_perms(inp.permissions)" in src


# ---------------------------------------------------------------------------
# RBAC-15 — owner exclusion list
# ---------------------------------------------------------------------------
class TestOwnerExclusions:
    def test_owner_still_gets_all_when_empty_exclusions(self):
        """Backward compat: no exclusions = classic all-perms owner."""
        from core import user_perms, PERMISSION_KEYS
        p = user_perms({"role": "owner", "_owner_exclusions": []})
        for k in PERMISSION_KEYS:
            assert k in p

    def test_owner_excluded_from_specific_perm(self):
        """Owner with finance in exclusions gets everything BUT finance."""
        from core import user_perms
        p = user_perms({"role": "owner", "_owner_exclusions": ["finance", "ledger"]})
        assert "finance" not in p
        assert "ledger" not in p
        # Other perms intact
        assert "team_manage" in p
        assert "workflows" in p

    def test_owner_exclusions_field_missing_treated_as_empty(self):
        """Doc without the field must still work — backward compat."""
        from core import user_perms, PERMISSION_KEYS
        p = user_perms({"role": "owner"})
        for k in PERMISSION_KEYS:
            assert k in p

    def test_owner_exclusions_endpoint_is_owner_only(self):
        from server import update_owner_exclusions
        src = inspect.getsource(update_owner_exclusions)
        # Owner-only: only an owner can restrict what owners can see.
        assert 'require_role("owner")' in src
        # PUT semantic (REPLACE the list). Route verification via
        # the FastAPI app's registered routes — cheaper than
        # inspect.getsource on the entire ~6k-line server module.
        from server import app
        routes = [(r.path, tuple(sorted(r.methods)))
                  for r in app.routes
                  if hasattr(r, "path") and r.path.endswith("/tenant/owner-exclusions")]
        assert routes, "no /tenant/owner-exclusions route registered"
        assert any("PUT" in methods for _, methods in routes), (
            "owner-exclusions must be PUT (replace semantics), not PATCH"
        )

    def test_owner_exclusions_endpoint_filters_unknown_perms(self):
        from server import update_owner_exclusions
        src = inspect.getsource(update_owner_exclusions)
        assert "clean_perms(inp.exclusions)" in src


# ---------------------------------------------------------------------------
# RBAC-16 — production -> operations canonical rename
# ---------------------------------------------------------------------------
class TestCanonicalRoleName:
    def test_roles_uses_operations_not_production(self):
        """config.ROLES must match config.DEFAULT_ROLES on the
        canonical role list. Previously ROLES had 'production' and
        DEFAULT_ROLES had 'operations' — silent inconsistency."""
        from config import ROLES, DEFAULT_ROLES
        assert "operations" in ROLES
        assert "production" not in ROLES
        # And DEFAULT_ROLES keys are all in ROLES.
        default_keys = {r["key"] for r in DEFAULT_ROLES}
        for k in default_keys:
            assert k in ROLES, f"DEFAULT_ROLES key {k!r} missing from ROLES"

    def test_rename_migration_registered_in_bootstrap(self):
        """The rename runs via the migration ledger so old tenants
        with 'production' roles get canonicalized on next boot."""
        import server
        src = inspect.getsource(server._bootstrap)
        assert "rename_production_role_v1" in src
        # Rewrites the 3 places 'production' can appear.
        assert "tenants.update_one" in src
        assert "users.update_many" in src
        assert "memberships.update_many" in src


# ---------------------------------------------------------------------------
# get_current_user must fetch tenant.roles + owner_exclusions
# ---------------------------------------------------------------------------
class TestGetCurrentUserEnrichment:
    def test_source_populates_role_perms_map(self):
        import core
        src = inspect.getsource(core.get_current_user)
        assert '_role_perms_map' in src
        assert '_owner_exclusions' in src
        # Both are fetched from the tenant doc in a single query.
        assert 'db.tenants.find_one' in src

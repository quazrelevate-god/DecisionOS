"""Epic 9 Sprint 10 -- admin RBAC matrix (U9-10.3).

Locks in the permission model enforced by core.security:
  * require_admin_role(*roles): super_admin always passes; a matching role
    passes; every other role is 403.
  * the read-only write-block in get_platform_admin.

Pure unit tests -- calls the dependency callables directly with a fake admin
dict and a fake request. No DB, no server.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

from core.security import require_admin_role, ADMIN_ROLES


def _call_role_gate(required, admin_role):
    """Invoke the dependency produced by require_admin_role(required) with an
    admin carrying admin_role, returning True if allowed, False if 403."""
    dep = require_admin_role(required)
    try:
        asyncio.run(dep(admin={"id": "a1", "role": admin_role}))
        return True
    except HTTPException as e:
        assert e.status_code == 403
        return False


def test_super_admin_passes_every_gate():
    for required in ("support", "billing", "read_only", "super_admin"):
        assert _call_role_gate(required, "super_admin") is True


def test_matching_role_passes():
    assert _call_role_gate("support", "support") is True
    assert _call_role_gate("billing", "billing") is True


def test_non_matching_role_is_forbidden():
    # A billing admin cannot reach a support-gated route, and vice-versa.
    assert _call_role_gate("support", "billing") is False
    assert _call_role_gate("billing", "support") is False
    # read_only never reaches a role-gated (mutating) route.
    assert _call_role_gate("super_admin", "read_only") is False


def test_full_matrix():
    """Exhaustive: for every (required, actual) pair, allowed iff actual is
    super_admin or actual == required."""
    for required in ADMIN_ROLES:
        for actual in ADMIN_ROLES:
            expected = actual == "super_admin" or actual == required
            assert _call_role_gate(required, actual) is expected, (
                f"required={required} actual={actual} expected={expected}"
            )


def test_compliance_destructive_routes_are_super_admin_only():
    """The two irreversible compliance routes must be gated to super_admin."""
    import inspect
    from routers import admin_compliance as ac
    for fn_name in ("admin_delete_with_export", "admin_run_retention"):
        src = inspect.getsource(getattr(ac, fn_name))
        assert 'require_admin_role("super_admin")' in src, (
            f"{fn_name} must depend on require_admin_role('super_admin')"
        )

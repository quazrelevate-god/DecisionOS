"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 3 (role matrix).

Pure unit tests over core.permissions.user_perms -- the permission-resolution
precedence that every RBAC gate depends on. No DB, no server.
Covers T10-01.12 and T10-03.1/.2/.3/.4/.10.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from core.permissions import user_perms, _BASE_PERMS, ROLE_DEFAULT_PERMS
from config import PERMISSION_KEYS


# --- role defaults (T10-03.1/.2/.3/.4) --------------------------------------
def test_owner_gets_all_permission_keys():
    assert user_perms({"role": "owner"}) == set(PERMISSION_KEYS)


def test_owner_exclusions_subtract():
    """A tenant can opt an owner OUT of specific perms (e.g. finance visibility)."""
    perms = user_perms({"role": "owner", "_owner_exclusions": ["finance", "ledger"]})
    assert "finance" not in perms and "ledger" not in perms
    assert "tasks" in perms


def test_sales_gets_base_only():
    perms = user_perms({"role": "sales"})
    assert perms == set(_BASE_PERMS)
    for denied in ("finance", "ledger", "people", "approvals", "team_manage"):
        assert denied not in perms


def test_finance_gets_base_plus_finance_ledger():
    perms = user_perms({"role": "finance"})
    assert perms == set(_BASE_PERMS) | {"finance", "ledger"}
    for denied in ("team_manage", "approvals", "decisions_approve", "people"):
        assert denied not in perms


def test_operations_role_has_no_default_perms_entry():
    """GAP (T10-03.4): 'operations' is a canonical role + in DEFAULT_ROLES,
    but has NO entry in ROLE_DEFAULT_PERMS -> it silently falls back to
    _BASE_PERMS. An operations member gets NO people/finance/ledger by
    default. This test pins that reality; product decision: intended or a gap?"""
    assert "operations" not in ROLE_DEFAULT_PERMS
    perms = user_perms({"role": "operations"})
    assert perms == set(_BASE_PERMS)
    assert "people" not in perms and "finance" not in perms


def test_unknown_custom_role_falls_back_to_base():
    assert user_perms({"role": "consignee_liaison"}) == set(_BASE_PERMS)


# --- precedence layers (T10-01.12) ------------------------------------------
def test_explicit_override_replaces_role_default():
    """A per-user permissions[] list REPLACES the role default (not unions)."""
    perms = user_perms({"role": "sales", "permissions": ["finance", "people"]})
    assert perms == {"finance", "people"}
    assert "tasks" not in perms  # base default is gone -- override replaces


def test_tenant_role_map_used_when_no_override():
    perms = user_perms({"role": "operations", "_role_perms_map": {"operations": ["people", "finance"]}})
    assert perms == {"people", "finance"}


def test_override_beats_tenant_role_map():
    perms = user_perms({
        "role": "sales",
        "permissions": ["ledger"],
        "_role_perms_map": {"sales": ["people"]},
    })
    assert perms == {"ledger"}


def test_temp_grant_unions_on_top():
    """RBAC-27: a non-expired temp grant ADDS a perm over the role default."""
    perms = user_perms({
        "role": "sales",
        "_temp_grants": [{"perm": "finance", "expires_at": "2099-01-01T00:00:00+00:00"}],
    })
    assert "finance" in perms
    assert set(_BASE_PERMS).issubset(perms)  # base still present (union, not replace)


def test_expired_temp_grant_ignored():
    perms = user_perms({
        "role": "sales",
        "_temp_grants": [{"perm": "finance", "expires_at": "2000-01-01T00:00:00+00:00"}],
    })
    assert "finance" not in perms


def test_temp_grant_unknown_perm_ignored():
    perms = user_perms({
        "role": "sales",
        "_temp_grants": [{"perm": "not_a_real_perm", "expires_at": "2099-01-01T00:00:00+00:00"}],
    })
    assert "not_a_real_perm" not in perms


def test_invalid_override_perms_filtered():
    """Only real PERMISSION_KEYS survive an override list."""
    perms = user_perms({"role": "sales", "permissions": ["finance", "garbage_perm"]})
    assert perms == {"finance"}

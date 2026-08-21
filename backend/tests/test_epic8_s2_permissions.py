"""Epic 8 Sprint 2 — unit tests for core/permissions.py (user_perms / clean_perms).

Pure RBAC resolution, no db/HTTP. Pins the precedence order:
owner(+exclusions) > explicit per-user perms > tenant role map > role defaults >
_BASE_PERMS, plus non-expired temp-grant merging.
"""
from config import PERMISSION_KEYS
from core.permissions import user_perms, clean_perms, _BASE_PERMS, ROLE_DEFAULT_PERMS

ALL = set(PERMISSION_KEYS)


def test_owner_gets_all_permissions():
    assert user_perms({"role": "owner"}) == ALL


def test_owner_exclusions_subtracted():
    out = user_perms({"role": "owner", "_owner_exclusions": ["finance"]})
    assert out == ALL - {"finance"}
    assert "finance" not in out


def test_explicit_user_perms_override_and_filter_unknown():
    out = user_perms({"role": "sales", "permissions": ["tasks", "not_a_perm"]})
    assert out == {"tasks"}                      # unknown filtered out


def test_explicit_perms_win_over_role_map():
    out = user_perms({
        "role": "ops",
        "permissions": ["tasks"],
        "_role_perms_map": {"ops": ["brain", "workflows"]},
    })
    assert out == {"tasks"}                       # explicit beats tenant role map


def test_tenant_role_map_when_no_explicit_perms():
    out = user_perms({
        "role": "ops",
        "_role_perms_map": {"ops": ["brain", "tasks", "not_a_perm"]},
    })
    assert out == {"brain", "tasks"}


def test_role_defaults_sales_and_finance():
    assert user_perms({"role": "sales"}) == set(ROLE_DEFAULT_PERMS["sales"])
    assert user_perms({"role": "finance"}) == set(_BASE_PERMS) | {"finance", "ledger"}


def test_unknown_custom_role_falls_back_to_base():
    assert user_perms({"role": "some_custom_role"}) == set(_BASE_PERMS)


def test_temp_grant_added_when_not_expired():
    out = user_perms({
        "role": "sales",
        "_temp_grants": [{"perm": "finance", "expires_at": "2999-01-01T00:00:00"}],
    })
    assert out == set(_BASE_PERMS) | {"finance"}


def test_temp_grant_ignored_when_expired():
    out = user_perms({
        "role": "sales",
        "_temp_grants": [{"perm": "finance", "expires_at": "2000-01-01T00:00:00"}],
    })
    assert "finance" not in out
    assert out == set(_BASE_PERMS)


def test_temp_grant_no_expiry_treated_as_active():
    out = user_perms({"role": "sales", "_temp_grants": [{"perm": "finance"}]})
    assert "finance" in out


# --- clean_perms -----------------------------------------------------------
def test_clean_perms_dedup_filter_preserve_order():
    assert clean_perms(["tasks", "tasks", "not_a_perm", "brain"]) == ["tasks", "brain"]


def test_clean_perms_non_list_returns_empty():
    assert clean_perms("tasks") == []
    assert clean_perms(None) == []
    assert clean_perms([]) == []

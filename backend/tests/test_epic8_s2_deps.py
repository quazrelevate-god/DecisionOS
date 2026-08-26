"""Epic 8 Sprint 2 — unit tests for core/deps.py (request dependencies).

require_role / require_perm are Depends() factories: they return an async
`checker(user)` we can call directly with a user dict (bypassing FastAPI).
get_current_user / tenant_role_keys are db-bound and covered by the live
login smoke, not here.
"""
import asyncio

import pytest
from fastapi import HTTPException

from core.deps import require_role, require_perm


def run(coro):
    return asyncio.run(coro)


# --- require_role ----------------------------------------------------------
def test_require_role_allows_matching():
    checker = require_role("owner", "sales")
    user = {"role": "owner"}
    assert run(checker(user=user)) is user


def test_require_role_denies_non_matching():
    checker = require_role("owner")
    with pytest.raises(HTTPException) as ei:
        run(checker(user={"role": "sales"}))
    assert ei.value.status_code == 403


def test_require_role_no_roles_allows_any():
    checker = require_role()
    u = {"role": "whatever"}
    assert run(checker(user=u)) is u


# --- require_perm ----------------------------------------------------------
def test_require_perm_owner_passes_any():
    checker = require_perm("finance")
    u = {"role": "owner"}
    assert run(checker(user=u)) is u          # owner -> all perms


def test_require_perm_allows_base_perm_for_sales():
    checker = require_perm("tasks")            # tasks is in _BASE_PERMS
    assert run(checker(user={"role": "sales"}))["role"] == "sales"


def test_require_perm_denies_missing_perm():
    checker = require_perm("finance")          # not granted to a bare sales user
    with pytest.raises(HTTPException) as ei:
        run(checker(user={"role": "sales"}))
    assert ei.value.status_code == 403


def test_require_perm_honors_explicit_grant():
    checker = require_perm("finance")
    u = {"role": "sales", "permissions": ["finance"]}
    assert run(checker(user=u)) is u


# --- core re-export contract ----------------------------------------------
def test_core_reexports_deps():
    import core
    import core.deps as cd
    for n in ("get_current_user", "require_role", "require_perm", "tenant_role_keys"):
        assert getattr(core, n) is getattr(cd, n)

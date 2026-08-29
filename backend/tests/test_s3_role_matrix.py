"""Epic 10 Testing -- Sprint 3 (role / RBAC matrix) completion.

Pure unit tier: exercises the permission primitives (user_perms / require_role /
require_perm / require_ledger) and a static gate-coverage contract over the live
FastAPI app. No DB, no network -- the RBAC decision layer is all synchronous
functions on the user dict, which is exactly why it can be pinned this cheaply.

  T10-03.5   every WRITE endpoint is auth-gated (or a known public route)
  T10-03.6   money is finance-gated; the _can_finance predicate is role-correct
  T10-03.7   owner-only gate denies EVERY non-owner role, allows owner
  T10-03.8   brain_export is owner-only-by-omission (not in defaults, not in UI)
  T10-03.9   holding team_manage does NOT satisfy an owner-only gate
  T10-03.10  temp grants UNION on top of role perms, then drop on expiry
"""
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException

from config import PERMISSION_KEYS
from core.permissions import user_perms, _BASE_PERMS, ROLE_DEFAULT_PERMS
from core.deps import require_role, require_perm
from routers.ledger import require_ledger
from routers.brain import _can_finance

_FRONTEND_PERMS = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "lib" / "perms.js"
NON_OWNER_ROLES = ("sales", "finance", "operations")


def _run(coro):
    return asyncio.run(coro)   # gates are pure async (no db/client) -> fresh loop is safe


def _u(role, **over):
    u = {"role": role, "tenant_id": "t1", "id": "u1"}
    u.update(over)
    return u


def _denied(checker, user) -> bool:
    try:
        _run(checker(user=user))
        return False
    except HTTPException as e:
        return e.status_code == 403


def _allowed(checker, user) -> bool:
    try:
        return _run(checker(user=user)) is user
    except HTTPException:
        return False


def _future():
    return (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()


def _past():
    return (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()


# ---------------------------------------------------------------------------
# T10-03.7 -- owner-only gate denies every non-owner, allows owner.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("role", NON_OWNER_ROLES + ("custom_liaison",))
def test_owner_gate_denies_non_owner(role):
    assert _denied(require_role("owner"), _u(role))


def test_owner_gate_allows_owner():
    assert _allowed(require_role("owner"), _u("owner"))


# ---------------------------------------------------------------------------
# T10-03.6 -- money is finance-gated; _can_finance is role-correct.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("role", ["sales", "operations", "custom_liaison"])
def test_non_finance_blocked_from_ledger(role):
    assert _denied(require_ledger, _u(role))


def test_finance_and_owner_reach_ledger():
    assert _allowed(require_ledger, _u("finance"))
    assert _allowed(require_ledger, _u("owner"))


def test_can_finance_predicate_matches_roles():
    assert _can_finance(_u("finance")) and _can_finance(_u("owner"))
    assert not _can_finance(_u("sales")) and not _can_finance(_u("operations"))
    # an explicit finance grant flips a non-finance role on
    assert _can_finance(_u("sales", permissions=["finance"]))


# ---------------------------------------------------------------------------
# T10-03.8 -- brain_export is owner-only-by-omission.
# ---------------------------------------------------------------------------
def test_brain_export_owner_only_by_omission():
    assert "brain_export" in PERMISSION_KEYS, "backend must still know the key"
    assert "brain_export" not in _BASE_PERMS
    assert all("brain_export" not in set(v) for v in ROLE_DEFAULT_PERMS.values())
    for role in NON_OWNER_ROLES:
        assert "brain_export" not in user_perms(_u(role))
    assert "brain_export" in user_perms(_u("owner"))   # owner gets ALL keys


def test_brain_export_absent_from_frontend_permissions_ui():
    """No UI checkbox -> a tenant admin can't grant it; only the owner (who has
    every key) or a direct API override can. Documents the by-omission design."""
    if not _FRONTEND_PERMS.exists():
        pytest.skip("frontend/src/lib/perms.js not present in this checkout")
    assert "brain_export" not in _FRONTEND_PERMS.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# T10-03.9 -- team_manage perm does NOT satisfy an owner-only gate.
# ---------------------------------------------------------------------------
def test_team_manage_does_not_satisfy_owner_gate():
    u = _u("sales", permissions=["team_manage"])   # explicit override grants the perm
    assert "team_manage" in user_perms(u)          # they DO hold team_manage
    assert _denied(require_role("owner"), u)        # ...but the owner gate is role-based


# ---------------------------------------------------------------------------
# T10-03.10 -- temp grants union on top of role perms, then expire.
# ---------------------------------------------------------------------------
def test_temp_grant_unions_then_expires():
    assert "finance" not in user_perms(_u("sales"))                       # baseline: no finance
    active = _u("sales", _temp_grants=[{"perm": "finance", "expires_at": _future()}])
    assert "finance" in user_perms(active)                               # granted -> unioned in
    expired = _u("sales", _temp_grants=[{"perm": "finance", "expires_at": _past()}])
    assert "finance" not in user_perms(expired)                         # expired -> gone
    bogus = _u("sales", _temp_grants=[{"perm": "not_a_real_perm", "expires_at": _future()}])
    assert "not_a_real_perm" not in user_perms(bogus)                   # unknown key ignored
    # a temp grant never REMOVES a base perm, only adds.
    assert _BASE_PERMS <= user_perms(active)


# ---------------------------------------------------------------------------
# T10-03.5 -- the core deny matrix: no WRITE endpoint is accidentally ungated.
# ---------------------------------------------------------------------------
_AUTH_DEPS = {"require_perm", "require_role", "require_ledger", "get_current_user",
              "checker", "get_platform_admin", "get_current_admin"}
# Deliberately public write routes (pre-auth signup/login/onboarding + signed webhooks).
_PUBLIC_PREFIXES = ("/api/onboarding/", "/api/signup/", "/api/webhooks/")
_PUBLIC_EXACT = {
    "/api/admin/login", "/api/billing/webhook",
    "/api/auth/register", "/api/auth/login", "/api/auth/logout",
    "/api/auth/password/forgot", "/api/auth/password/reset", "/api/auth/2fa/verify-login",
    "/api/auth/otp/request", "/api/auth/otp/verify", "/api/auth/invite/{token}/start",
}


def _dep_call_names(dependant) -> set:
    names = set()

    def walk(d):
        call = getattr(d, "call", None)
        if call is not None:
            names.add(getattr(call, "__name__", str(call)))
        for sub in getattr(d, "dependencies", []):
            walk(sub)
    walk(dependant)
    return names


def test_every_write_endpoint_is_gated_or_explicitly_public():
    from server import app
    from fastapi.routing import APIRoute

    ungated = []
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        writes = r.methods - {"GET", "HEAD", "OPTIONS"}
        if not writes:
            continue
        if _dep_call_names(r.dependant) & _AUTH_DEPS:
            continue
        if r.path in _PUBLIC_EXACT or any(r.path.startswith(p) for p in _PUBLIC_PREFIXES):
            continue
        ungated.append((sorted(writes), r.path))

    assert not ungated, (
        "WRITE endpoints with NO auth gate and not on the public allow-list "
        "(each is either a missing require_perm/require_role, or a genuinely "
        f"public route that must be added to the allow-list):\n" +
        "\n".join(f"  {m} {p}" for m, p in ungated))

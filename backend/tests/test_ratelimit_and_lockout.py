"""FIX-006-D (Sprint 0 batch D): rate-limit unauth AI + login lockout.

Covers:
  S0-06  New shared guard_unauth_ai_endpoint() in services/rate_limit
         gates unauthenticated AI endpoints with hourly + burst rate
         limits and CAPTCHA verification. Applied to the two
         previously-unguarded /api/onboarding/* endpoints that were
         burning Claude credit for anyone who could POST to the URL.

  S0-07  Tenant /api/auth/login now has a 5-attempt / 15-minute
         lockout (parity with admin login). Uses db.user_login_attempts
         keyed by (IP, email). Locks BEFORE the DB lookup so an
         attacker can't measure timing to enumerate valid emails.
"""
import asyncio
import inspect
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Small async fakes (patterned after the other test files in this repo).
# ---------------------------------------------------------------------------
class _Col:
    def __init__(self):
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                if "$inc" in u:
                    for k, v in u["$inc"].items():
                        d[k] = d.get(k, 0) + v
                return SimpleNamespace(matched_count=1, modified_count=1)
        if upsert:
            new = dict()
            for k, v in q.items():
                if not isinstance(v, dict):
                    new[k] = v
            if "$set" in u:
                new.update(u["$set"])
            if "$inc" in u:
                for k, v in u["$inc"].items():
                    new[k] = new.get(k, 0) + v
            self.docs.append(new)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id="x")
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if self._match(d, q):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    def _match(self, d, q):
        for k, v in q.items():
            if d.get(k) != v:
                return False
        return True


class _FakeDB:
    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _fake_request(*, host="1.2.3.4", xff=None, headers=None):
    hdrs = dict(headers or {})
    if xff:
        hdrs["X-Forwarded-For"] = xff
    client = SimpleNamespace(host=host)
    return SimpleNamespace(client=client, headers=hdrs)


# ===========================================================================
# S0-06: shared guard for unauth AI endpoints
# ===========================================================================
class TestGuardUnauthAiEndpoint:
    def setup_method(self):
        from services import rate_limit
        _run(rate_limit.reset_for_test())

    def test_first_hit_allowed_returns_ip(self, monkeypatch):
        """Under the quota + no captcha configured → returns caller IP."""
        # No CAPTCHA secret in env → captcha service returns (True, "disabled").
        monkeypatch.delenv("CAPTCHA_REQUIRED", raising=False)
        monkeypatch.delenv("TURNSTILE_SECRET", raising=False)
        monkeypatch.delenv("HCAPTCHA_SECRET", raising=False)
        from services.rate_limit import guard_unauth_ai_endpoint
        ip = _run(guard_unauth_ai_endpoint(
            _fake_request(host="10.0.0.1"),
            service="onboarding", kind="suggest",
        ))
        assert ip == "10.0.0.1"

    def test_hourly_quota_returns_429(self, monkeypatch):
        """Custom low hourly quota; 3rd hit trips the check."""
        monkeypatch.delenv("CAPTCHA_REQUIRED", raising=False)
        from fastapi import HTTPException
        from services.rate_limit import guard_unauth_ai_endpoint
        req = _fake_request(host="10.0.0.2")
        for _ in range(2):
            _run(guard_unauth_ai_endpoint(
                req, service="onb", kind="suggest",
                hourly=(2, 3600), burst=(99, 10),
            ))
        with pytest.raises(HTTPException) as exc:
            _run(guard_unauth_ai_endpoint(
                req, service="onb", kind="suggest",
                hourly=(2, 3600), burst=(99, 10),
            ))
        assert exc.value.status_code == 429
        assert "Retry-After" in exc.value.headers

    def test_burst_quota_returns_429(self, monkeypatch):
        """Small burst; 3rd fast hit trips even though hourly is huge."""
        monkeypatch.delenv("CAPTCHA_REQUIRED", raising=False)
        from fastapi import HTTPException
        from services.rate_limit import guard_unauth_ai_endpoint
        req = _fake_request(host="10.0.0.3")
        for _ in range(2):
            _run(guard_unauth_ai_endpoint(
                req, service="onb", kind="suggest",
                hourly=(9999, 3600), burst=(2, 10),
            ))
        with pytest.raises(HTTPException) as exc:
            _run(guard_unauth_ai_endpoint(
                req, service="onb", kind="suggest",
                hourly=(9999, 3600), burst=(2, 10),
            ))
        assert exc.value.status_code == 429

    def test_captcha_required_missing_returns_400(self, monkeypatch):
        monkeypatch.setenv("CAPTCHA_REQUIRED", "1")
        monkeypatch.setenv("TURNSTILE_SECRET", "test-secret")
        from fastapi import HTTPException
        from services.rate_limit import guard_unauth_ai_endpoint
        with pytest.raises(HTTPException) as exc:
            _run(guard_unauth_ai_endpoint(
                _fake_request(host="10.0.0.4"),
                service="onb", kind="suggest",
            ))
        assert exc.value.status_code == 400

    def test_different_services_get_different_buckets(self, monkeypatch):
        """Signup burning 30 hits/hr must not block onboarding's 30/hr —
        they're on different `service` namespaces."""
        monkeypatch.delenv("CAPTCHA_REQUIRED", raising=False)
        from services.rate_limit import guard_unauth_ai_endpoint
        req = _fake_request(host="10.0.0.5")
        # Drain signup:suggest bucket.
        for _ in range(2):
            _run(guard_unauth_ai_endpoint(
                req, service="signup", kind="suggest",
                hourly=(2, 3600), burst=(99, 10),
            ))
        # onboarding:suggest must still work.
        _run(guard_unauth_ai_endpoint(
            req, service="onboarding", kind="suggest",
            hourly=(2, 3600), burst=(99, 10),
        ))

    def test_different_kinds_get_different_buckets(self, monkeypatch):
        """suggest and os_blueprint on the same service must not share."""
        monkeypatch.delenv("CAPTCHA_REQUIRED", raising=False)
        from services.rate_limit import guard_unauth_ai_endpoint
        req = _fake_request(host="10.0.0.6")
        for _ in range(2):
            _run(guard_unauth_ai_endpoint(
                req, service="onboarding", kind="suggest",
                hourly=(2, 3600), burst=(99, 10),
            ))
        # os_blueprint on same IP + service must still work.
        _run(guard_unauth_ai_endpoint(
            req, service="onboarding", kind="os_blueprint",
            hourly=(2, 3600), burst=(99, 10),
        ))

    def test_captcha_can_be_skipped_by_arg(self, monkeypatch):
        """Some future endpoint that legitimately can't render captcha."""
        monkeypatch.setenv("CAPTCHA_REQUIRED", "1")
        monkeypatch.setenv("TURNSTILE_SECRET", "test-secret")
        from services.rate_limit import guard_unauth_ai_endpoint
        # Should pass because we disabled the captcha check.
        ip = _run(guard_unauth_ai_endpoint(
            _fake_request(host="10.0.0.7"),
            service="onb", kind="suggest",
            require_captcha=False,
        ))
        assert ip == "10.0.0.7"


class TestOnboardingEndpointsUseTheGuard:
    """Source-inspection guard: nobody accidentally strips these."""

    def test_onboarding_suggest_calls_guard(self):
        from routers import onboarding
        src = inspect.getsource(onboarding.onboarding_suggest)
        assert "guard_unauth_ai_endpoint" in src
        assert 'service="onboarding"' in src
        assert 'kind="suggest"' in src

    def test_onboarding_os_blueprint_calls_guard(self):
        from routers import onboarding
        src = inspect.getsource(onboarding.onboarding_os_blueprint)
        assert "guard_unauth_ai_endpoint" in src
        assert 'kind="os_blueprint"' in src

    def test_onboarding_router_imports_the_shared_helper(self):
        """Regression guard: the helper name must be imported at
        module top so someone deleting the imports doesn't silently
        break the guard by leaving stale endpoint calls."""
        import routers.onboarding as onboarding
        assert hasattr(onboarding, "guard_unauth_ai_endpoint")


# ===========================================================================
# S0-07: tenant login lockout
# ===========================================================================
class TestTenantLoginLockout:
    def _wire(self, monkeypatch):
        """Swap routers.auth.db for a fake so we can exercise the helpers
        without touching real Mongo."""
        import routers.auth as a
        db = _FakeDB()
        monkeypatch.setattr(a, "db", db)
        return a, db

    def test_ident_shape_ip_plus_email(self):
        from routers import auth as a
        req = _fake_request(host="203.0.113.9")
        assert a._login_ident(req, "alice@example.com") == "203.0.113.9:alice@example.com"

    def test_ident_prefers_xff_over_socket(self):
        """Behind a proxy, socket-peer is always the proxy — the real
        client IP is in X-Forwarded-For."""
        from routers import auth as a
        req = _fake_request(host="10.0.0.1", xff="198.51.100.7, 10.0.0.1")
        assert a._login_ident(req, "b@x.com") == "198.51.100.7:b@x.com"

    def test_not_locked_when_below_threshold(self, monkeypatch):
        a, db = self._wire(monkeypatch)
        db.user_login_attempts.docs.append({
            "identifier": "1.1.1.1:u@x.com",
            "count": 4,   # one shy of MAX
            "last": datetime.now(timezone.utc).isoformat(),
        })
        locked, retry = _run(a._login_locked_out("1.1.1.1:u@x.com"))
        assert not locked and retry == 0

    def test_locked_at_max_within_window(self, monkeypatch):
        a, db = self._wire(monkeypatch)
        db.user_login_attempts.docs.append({
            "identifier": "1.1.1.1:u@x.com",
            "count": a.LOGIN_MAX_ATTEMPTS,
            "last": datetime.now(timezone.utc).isoformat(),
        })
        locked, retry = _run(a._login_locked_out("1.1.1.1:u@x.com"))
        assert locked
        # Retry-after is at most the full window, in seconds.
        assert 0 < retry <= a.LOGIN_LOCKOUT_MIN * 60

    def test_lock_expires_after_window(self, monkeypatch):
        """Cool-down elapsed → row cleared, request proceeds fresh."""
        a, db = self._wire(monkeypatch)
        long_ago = (datetime.now(timezone.utc)
                    - timedelta(minutes=a.LOGIN_LOCKOUT_MIN + 1))
        db.user_login_attempts.docs.append({
            "identifier": "1.1.1.1:u@x.com",
            "count": a.LOGIN_MAX_ATTEMPTS,
            "last": long_ago.isoformat(),
        })
        locked, retry = _run(a._login_locked_out("1.1.1.1:u@x.com"))
        assert not locked
        # Row was reset — future call starts from zero.
        assert db.user_login_attempts.docs == []

    def test_record_failure_increments_and_upserts(self, monkeypatch):
        a, db = self._wire(monkeypatch)
        _run(a._login_record_failure("2.2.2.2:x@y.com"))
        _run(a._login_record_failure("2.2.2.2:x@y.com"))
        rows = [d for d in db.user_login_attempts.docs
                if d["identifier"] == "2.2.2.2:x@y.com"]
        assert len(rows) == 1
        assert rows[0]["count"] == 2

    def test_clear_attempts_wipes_row(self, monkeypatch):
        a, db = self._wire(monkeypatch)
        db.user_login_attempts.docs.append({
            "identifier": "3.3.3.3:z@w.com", "count": 3, "last": now_iso_str(),
        })
        _run(a._login_clear_attempts("3.3.3.3:z@w.com"))
        assert not any(d["identifier"] == "3.3.3.3:z@w.com"
                       for d in db.user_login_attempts.docs)

    def test_bad_last_iso_treated_as_not_locked(self, monkeypatch):
        """A malformed timestamp shouldn't perma-lock a user — fall
        through to a fresh state and let them try again."""
        a, db = self._wire(monkeypatch)
        db.user_login_attempts.docs.append({
            "identifier": "1.1.1.1:u@x.com",
            "count": a.LOGIN_MAX_ATTEMPTS,
            "last": "not-a-date",
        })
        locked, retry = _run(a._login_locked_out("1.1.1.1:u@x.com"))
        assert not locked and retry == 0


class TestLoginEndpointWiresLockout:
    """Source-inspection: the /login endpoint routes through the
    lockout helpers. Regression backstop for anyone editing the
    login body and forgetting the checks."""

    def test_login_source_checks_before_password(self):
        from routers import auth
        src = inspect.getsource(auth.login)
        # Lock check happens before the DB find_one for the user.
        idx_locked = src.find("_login_locked_out")
        idx_find = src.find("db.users.find_one")
        assert idx_locked >= 0 and idx_find >= 0
        assert idx_locked < idx_find, (
            "S0-07 regression: _login_locked_out must run BEFORE the "
            "user find_one — otherwise timing signal enumerates emails"
        )

    def test_login_source_records_on_failure(self):
        from routers import auth
        src = inspect.getsource(auth.login)
        assert "_login_record_failure" in src

    def test_login_source_clears_on_success(self):
        from routers import auth
        src = inspect.getsource(auth.login)
        assert "_login_clear_attempts" in src

    def test_locked_out_raises_429_not_401(self):
        """Ensures the lock branch returns 429 (throttling) not 401
        (auth), so clients don't retry with the same body immediately."""
        from routers import auth
        src = inspect.getsource(auth.login)
        # The lock branch has status_code=429.
        # Find the block starting from "if locked".
        i = src.find("if locked")
        assert i >= 0
        block = src[i:i + 800]
        assert "status_code=429" in block

    def test_matches_admin_login_numbers(self):
        """Parity with admin: 5 attempts / 15 minutes."""
        from routers import auth, admin
        assert auth.LOGIN_MAX_ATTEMPTS == admin.MAX_ATTEMPTS == 5
        assert auth.LOGIN_LOCKOUT_MIN == admin.LOCKOUT_MIN == 15


# Small helper used in one lockout test.
def now_iso_str() -> str:
    return datetime.now(timezone.utc).isoformat()

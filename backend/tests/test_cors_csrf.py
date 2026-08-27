"""FIX-006-B (S0-02): CORS + CSRF hardening tests.

Split into three parts:

  * TestCorsAllowList — env-driven allow-list parsing + prod boot refusal
  * TestCsrfCookieMint — every auth-cookie set path also mints dos_csrf
  * TestCsrfMiddleware — the request-level check: safe verbs pass,
                          exempt paths pass, bearer auth passes, cookie
                          + matching header passes, everything else fails
  * TestCsrfEnforcementToggle — CSRF_ENFORCE=False = shadow-log,
                                 CSRF_ENFORCE=True = 403 on mismatch
"""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# Deliberately NO config reloads in this file — that pollutes module
# state for other tests on the same xdist worker. We test the parser
# function directly with monkeypatched env instead. See TestCorsAllowList.


# ===========================================================================
# CORS allow-list
# ===========================================================================
def _call_parse(monkeypatch, env, cors):
    """Call config._parse_cors_origins() with a specific ENV + CORS_ORIGINS
    env pair. Uses monkeypatch on the config module's `_ENV` binding
    directly + patches os.environ for CORS_ORIGINS — no module reload,
    so no cross-test config pollution."""
    import config
    monkeypatch.setattr(config, "_ENV", env)
    monkeypatch.setenv("CORS_ORIGINS", "" if cors is None else cors)
    return config._parse_cors_origins()


class TestCorsAllowList:
    """Test the pure parser function — no config-module reloads so we
    don't pollute config state for other test files sharing this
    xdist worker.
    """

    def test_prod_refuses_empty_list(self, monkeypatch):
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            _call_parse(monkeypatch, "prod", None)

    def test_prod_refuses_wildcard(self, monkeypatch):
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            _call_parse(monkeypatch, "prod", "*")

    def test_prod_refuses_wildcard_mixed_in(self, monkeypatch):
        with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
            _call_parse(monkeypatch, "prod", "https://app.decisionos.com,*")

    def test_prod_accepts_explicit_origin_list(self, monkeypatch):
        origins = _call_parse(
            monkeypatch, "prod",
            "https://app.decisionos.com,https://admin.decisionos.com",
        )
        assert origins == [
            "https://app.decisionos.com",
            "https://admin.decisionos.com",
        ]

    def test_prod_strips_whitespace_and_empty(self, monkeypatch):
        origins = _call_parse(
            monkeypatch, "prod",
            " https://a.com ,, https://b.com ,",
        )
        assert origins == ["https://a.com", "https://b.com"]

    def test_dev_defaults_to_local_frontends(self, monkeypatch):
        origins = _call_parse(monkeypatch, "dev", None)
        assert "http://localhost:3000" in origins
        assert "http://localhost:5173" in origins
        assert len(origins) >= 3

    def test_dev_explicit_overrides_fallback(self, monkeypatch):
        origins = _call_parse(monkeypatch, "dev",
                                "https://staging.decisionos.com")
        assert origins == ["https://staging.decisionos.com"]


# ===========================================================================
# CSRF cookie minting — set_auth_cookie / set_admin_cookie plumb it
# ===========================================================================
class _FakeResponse:
    """Just enough Response shape to record what set_cookie / delete_cookie
    was called with. set_cookie kwargs are surfaced for assertions."""
    def __init__(self):
        self.cookies_set = []      # list of (name, value, kwargs)
        self.cookies_deleted = []  # list of (name, kwargs)

    def set_cookie(self, key, value, **kwargs):
        self.cookies_set.append((key, value, kwargs))

    def delete_cookie(self, key, **kwargs):
        self.cookies_deleted.append((key, kwargs))


class TestCsrfCookieMint:
    """Verify set_auth_cookie / set_admin_cookie also mint the CSRF cookie.
    No config reload needed — we exercise core's helpers directly."""

    def test_set_auth_cookie_also_mints_dos_csrf(self):
        import core
        r = _FakeResponse()
        core.set_auth_cookie(r, "auth.jwt.value")
        names = [c[0] for c in r.cookies_set]
        assert "dos_token" in names
        assert "dos_csrf" in names, "set_auth_cookie must mint the CSRF cookie"
        # CSRF cookie must NOT be HttpOnly (frontend JS needs to read it).
        csrf = next(c for c in r.cookies_set if c[0] == "dos_csrf")
        assert csrf[2]["httponly"] is False, (
            "dos_csrf must not be HttpOnly — the double-submit pattern "
            "requires JS to read the value and echo it as X-CSRF-Token"
        )
        # And it MUST be secure — never send CSRF token over plain HTTP.
        assert csrf[2]["secure"] is True
        # Token must be non-trivial (secrets.token_urlsafe(32) → ~43 chars).
        assert len(csrf[1]) >= 30

    def test_set_admin_cookie_also_mints_dos_csrf(self):
        import core
        r = _FakeResponse()
        core.set_admin_cookie(r, "admin.jwt.value")
        assert "dos_admin_token" in [c[0] for c in r.cookies_set]
        assert "dos_csrf" in [c[0] for c in r.cookies_set]

    def test_each_call_mints_a_fresh_token(self):
        import core
        r1, r2 = _FakeResponse(), _FakeResponse()
        core.set_auth_cookie(r1, "T")
        core.set_auth_cookie(r2, "T")
        t1 = next(c for c in r1.cookies_set if c[0] == "dos_csrf")[1]
        t2 = next(c for c in r2.cookies_set if c[0] == "dos_csrf")[1]
        assert t1 != t2, "each login should get a fresh unpredictable token"

    def test_clear_auth_cookie_also_clears_dos_csrf(self):
        import core
        r = _FakeResponse()
        core.clear_auth_cookie(r)
        names = [c[0] for c in r.cookies_deleted]
        assert "dos_token" in names
        assert "dos_csrf" in names

    def test_clear_admin_cookie_also_clears_dos_csrf(self):
        import core
        r = _FakeResponse()
        core.clear_admin_cookie(r)
        names = [c[0] for c in r.cookies_deleted]
        assert "dos_admin_token" in names
        assert "dos_csrf" in names

    def test_set_csrf_cookie_accepts_explicit_token(self):
        """Rare but useful: caller can pass its own token (e.g. for a
        deterministic test). Returned value must match the cookie set."""
        import core
        r = _FakeResponse()
        returned = core.set_csrf_cookie(r, token="pinned-token-abc")
        assert returned == "pinned-token-abc"
        csrf = next(c for c in r.cookies_set if c[0] == "dos_csrf")
        assert csrf[1] == "pinned-token-abc"


# ===========================================================================
# CSRF middleware _check() — the request-level contract
# ===========================================================================
def _fake_request(method="POST", path="/api/decisions/abc/approve",
                    cookies=None, headers=None):
    """Minimal request stub for services.csrf._check() — it only reads
    .method, .url.path, .cookies, .headers."""
    return SimpleNamespace(
        method=method,
        url=SimpleNamespace(path=path),
        cookies=dict(cookies or {}),
        headers=dict(headers or {}),
    )


class TestCsrfCheck:
    """The _check() function is the pure logic; test it end-to-end without
    spinning up an ASGI app."""

    def setup_method(self):
        from services import csrf
        csrf.reset_metrics()

    def test_safe_verbs_always_pass(self):
        from services.csrf import _check
        for verb in ("GET", "HEAD", "OPTIONS"):
            ok, reason = _check(_fake_request(method=verb))
            assert ok
            assert reason == "safe_verb"

    def test_exempt_paths_pass_even_on_post(self):
        from services.csrf import _check
        # Webhook is HMAC-authed by the caller; login runs before cookie exists.
        for path in ("/api/webhooks/whatsapp", "/api/auth/login",
                      "/api/auth/register", "/api/admin/login"):
            ok, reason = _check(_fake_request(method="POST", path=path))
            assert ok, f"{path} should be exempt"
            assert reason == "exempt_path"

    def test_bearer_or_unauth_request_passes(self):
        """No dos_token cookie present → this is either bearer-authed
        (safe by definition) or unauth (no session to hijack)."""
        from services.csrf import _check
        ok, reason = _check(_fake_request(
            method="POST", path="/api/decisions/x/approve",
            headers={"Authorization": "Bearer xyz"},
        ))
        assert ok
        assert reason == "bearer_or_unauth"

    def test_cookie_authed_missing_csrf_cookie_fails(self):
        from services.csrf import _check
        ok, reason = _check(_fake_request(
            method="POST", path="/api/decisions/x/approve",
            cookies={"dos_token": "session-jwt"},
        ))
        assert not ok
        assert reason == "missing_cookie"

    def test_cookie_authed_missing_header_fails(self):
        from services.csrf import _check
        ok, reason = _check(_fake_request(
            method="POST", path="/api/decisions/x/approve",
            cookies={"dos_token": "session-jwt", "dos_csrf": "TOK123"},
        ))
        assert not ok
        assert reason == "missing_header"

    def test_cookie_authed_header_mismatch_fails(self):
        from services.csrf import _check
        ok, reason = _check(_fake_request(
            method="POST", path="/api/decisions/x/approve",
            cookies={"dos_token": "session-jwt", "dos_csrf": "TOK123"},
            headers={"X-CSRF-Token": "TOK456"},
        ))
        assert not ok
        assert reason == "value_mismatch"

    def test_cookie_authed_matching_header_passes(self):
        from services.csrf import _check
        ok, reason = _check(_fake_request(
            method="POST", path="/api/decisions/x/approve",
            cookies={"dos_token": "session-jwt", "dos_csrf": "TOK-abc-123"},
            headers={"X-CSRF-Token": "TOK-abc-123"},
        ))
        assert ok
        assert reason == "match"

    def test_admin_cookie_treated_same_as_tenant(self):
        """Both dos_token and dos_admin_token count as cookie-authed —
        admin console flows are equally CSRF-vulnerable."""
        from services.csrf import _check
        ok, reason = _check(_fake_request(
            method="POST", path="/api/admin/tenants/t1/suspend",
            cookies={"dos_admin_token": "admin-jwt", "dos_csrf": "T"},
            headers={"X-CSRF-Token": "T"},
        ))
        assert ok
        assert reason == "match"
        # And missing header on admin flow also fails:
        ok, reason = _check(_fake_request(
            method="POST", path="/api/admin/tenants/t1/suspend",
            cookies={"dos_admin_token": "admin-jwt", "dos_csrf": "T"},
        ))
        assert not ok
        assert reason == "missing_header"


class TestCsrfMetrics:
    def test_counters_advance(self):
        from services import csrf
        csrf.reset_metrics()
        # 1 safe verb
        csrf._check(_fake_request(method="GET"))
        # 1 exempt path
        csrf._check(_fake_request(method="POST", path="/api/webhooks/whatsapp"))
        # 1 bearer
        csrf._check(_fake_request(method="POST",
                                    path="/api/decisions/x/approve",
                                    headers={"Authorization": "Bearer x"}))
        # 1 match
        csrf._check(_fake_request(method="POST",
                                    path="/api/decisions/x/approve",
                                    cookies={"dos_token": "j", "dos_csrf": "T"},
                                    headers={"X-CSRF-Token": "T"}))
        # 1 missing header
        csrf._check(_fake_request(method="POST",
                                    path="/api/decisions/x/approve",
                                    cookies={"dos_token": "j", "dos_csrf": "T"}))
        m = csrf.metrics_snapshot()
        assert m["skipped_safe_verb"] == 1
        assert m["skipped_exempt_path"] == 1
        assert m["skipped_bearer_auth"] == 1
        assert m["match"] == 1
        assert m["mismatch_missing_header"] == 1

    def test_reset_metrics_zeros_everything(self):
        from services import csrf
        csrf._check(_fake_request(method="GET"))
        csrf.reset_metrics()
        assert all(v == 0 for v in csrf.metrics_snapshot().values())

    def test_metrics_snapshot_returns_copy(self):
        """Mutating the returned dict must not corrupt the module state."""
        from services import csrf
        csrf.reset_metrics()
        snap = csrf.metrics_snapshot()
        snap["match"] = 9999
        assert csrf.metrics_snapshot()["match"] == 0


# ===========================================================================
# Enforcement toggle — the shadow-mode → enforce rollout switch
# ===========================================================================
class TestCsrfEnforceToggle:
    """CSRF_ENFORCE is parsed as `env.lower() in ('1','true','yes','on')`,
    default False. Reproduce that inline instead of reloading config
    (which would pollute other tests on this xdist worker)."""

    def _parse(self, val: str) -> bool:
        return (val or "").strip().lower() in ("1", "true", "yes", "on")

    def test_enforce_false_by_default(self):
        assert self._parse("") is False
        assert self._parse(None) is False

    def test_explicit_truthy(self):
        for v in ("1", "true", "TRUE", "yes", "on"):
            assert self._parse(v) is True, f"{v!r} should enforce"

    def test_explicit_falsy(self):
        for v in ("0", "false", "no", "off", ""):
            assert self._parse(v) is False, f"{v!r} should not enforce"

    def test_prod_does_not_auto_enforce(self):
        """Deliberate design choice — the parser is env-only, not
        env-and-ENV-derived, so prod defaults off just like everything
        else. Ops flips CSRF_ENFORCE=1 in a follow-up push once
        staging confirms 100% match rate."""
        # This is really testing the design decision; the parser
        # rejects everything except explicit truthy strings.
        assert self._parse("") is False  # prod default with no env
        assert self._parse("prod") is False  # unrelated string
        # And an already-loaded module reflects the current process env:
        import config
        assert isinstance(config.CSRF_ENFORCE, bool)


# ===========================================================================
# Middleware dispatch — shadow mode passes, enforce mode 403s
# ===========================================================================
class TestCsrfMiddlewareDispatch:
    """Test CSRFMiddleware.dispatch() directly without spinning up a
    TestClient. TestClient creates and closes an asyncio loop as a
    side-effect, which pollutes any subsequent test using the shared
    event loop — a shared-worker landmine we won't step on here.
    """

    def _dispatch(self, enforce, method, path, cookies, headers):
        """Drive the middleware with a fake Request; return the
        Response's status_code + body dict (best-effort)."""
        import asyncio
        import json
        from services.csrf import CSRFMiddleware
        import services.csrf as _csrf
        original_enforce = _csrf.CSRF_ENFORCE
        _csrf.CSRF_ENFORCE = enforce
        try:
            req = _fake_request(method=method, path=path,
                                 cookies=cookies, headers=headers)

            async def call_next(_):
                # Sentinel: whatever we return means "middleware passed".
                # A dict is enough for our assertions.
                return SimpleNamespace(status_code=200, body=b'{"ok":true}')

            mw = CSRFMiddleware(app=None)
            loop = asyncio.new_event_loop()  # fresh loop → no pollution
            try:
                resp = loop.run_until_complete(mw.dispatch(req, call_next))
            finally:
                loop.close()
            return resp
        finally:
            _csrf.CSRF_ENFORCE = original_enforce

    def test_shadow_mode_lets_mismatch_through(self):
        r = self._dispatch(
            enforce=False, method="POST",
            path="/api/decisions/x/approve",
            cookies={"dos_token": "j", "dos_csrf": "T"},
            headers={},  # no X-CSRF-Token — mismatch, but shadow mode
        )
        assert r.status_code == 200

    def test_enforce_mode_403s_mismatch(self):
        r = self._dispatch(
            enforce=True, method="POST",
            path="/api/decisions/x/approve",
            cookies={"dos_token": "j", "dos_csrf": "T"},
            headers={},
        )
        assert r.status_code == 403
        # Body is a JSONResponse — parse it.
        import json
        body = json.loads(r.body)
        assert body["detail"] == "CSRF check failed"
        assert body["reason"] == "missing_header"

    def test_enforce_mode_matching_header_passes(self):
        r = self._dispatch(
            enforce=True, method="POST",
            path="/api/decisions/x/approve",
            cookies={"dos_token": "j", "dos_csrf": "MATCHING"},
            headers={"X-CSRF-Token": "MATCHING"},
        )
        assert r.status_code == 200

    def test_enforce_mode_bearer_auth_bypasses(self):
        """Even with enforce on, bearer-auth (no dos_token cookie) passes."""
        r = self._dispatch(
            enforce=True, method="POST",
            path="/api/decisions/x/approve",
            cookies={},
            headers={"Authorization": "Bearer xyz"},
        )
        assert r.status_code == 200

    def test_enforce_mode_exempt_path_bypasses(self):
        """Webhook / login paths pass even with enforce on + a cookie."""
        r = self._dispatch(
            enforce=True, method="POST",
            path="/api/webhooks/whatsapp",
            cookies={"dos_token": "j"},
            headers={},
        )
        assert r.status_code == 200

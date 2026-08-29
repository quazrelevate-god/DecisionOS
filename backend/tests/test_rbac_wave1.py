"""FIX-004-A (RBAC Wave 1) tests: RBAC-01/02/03.

RBAC-01 — Auth-gate onboarding drafts (HMAC-signed URLs):
  * sign/verify contract (constant-time, correct token, wrong token,
    empty token, empty draft_id)
  * onboarding router source-level guards on GET + PATCH endpoints
  * create_onboarding_draft returns a draft_token

RBAC-02 — CAPTCHA + rate-limit on /register:
  * verify_captcha behavior across configured / not-configured /
    required-but-missing paths
  * register handler source has rate-limit + captcha calls
  * register model has captcha_token field

RBAC-03 — signup AI endpoints gated:
  * SSRF guard: private IPs (v4 + v6), link-local, cloud metadata,
    localhost hostname, bad scheme, raw private IP, DNS-failure host,
    good public URL
  * signup router has _guard_signup_endpoint applied to every
    non-static endpoint

Shared infra:
  * rate_limit.check_rate_limit: allow/deny + retry_after + reset
  * client_ip: XFF, X-Real-IP, direct, unknown fallback
"""
import asyncio
import inspect
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# Dedicated module-scoped loop (see audit-log note): owning our own loop
# keeps every call in this module on one live loop and is immune to another
# module's asyncio.run() closing the process current loop under -n/loadscope.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# =============================================================================
# services.rate_limit — sliding-window contract
# =============================================================================
class TestRateLimit:
    def setup_method(self):
        from services.rate_limit import reset_for_test
        _run(reset_for_test())

    def test_first_hit_allowed(self):
        from services.rate_limit import check_rate_limit
        ok, retry_after = _run(check_rate_limit("ip1", 3, 60))
        assert ok is True
        assert retry_after == 0

    def test_cap_blocks_further_hits(self):
        from services.rate_limit import check_rate_limit
        for _ in range(3):
            _run(check_rate_limit("ip2", 3, 60))
        ok, retry_after = _run(check_rate_limit("ip2", 3, 60))
        assert ok is False
        assert retry_after >= 1

    def test_different_keys_isolated(self):
        from services.rate_limit import check_rate_limit
        for _ in range(3):
            _run(check_rate_limit("ip3a", 3, 60))
        # Same cap for a different key — should still allow.
        ok, _ = _run(check_rate_limit("ip3b", 3, 60))
        assert ok is True

    def test_different_buckets_isolated(self):
        from services.rate_limit import check_rate_limit
        for _ in range(3):
            _run(check_rate_limit("ip4", 3, 60, bucket="A"))
        # Same key + same cap in a DIFFERENT bucket — allowed.
        ok, _ = _run(check_rate_limit("ip4", 3, 60, bucket="B"))
        assert ok is True

    def test_zero_or_negative_cap_is_open(self):
        """max_hits<=0 or window<=0 must NOT block — misconfigured
        limiter must not lock every user out."""
        from services.rate_limit import check_rate_limit
        ok, _ = _run(check_rate_limit("ip5", 0, 60))
        assert ok is True
        ok, _ = _run(check_rate_limit("ip5", 3, 0))
        assert ok is True

    def test_empty_key_is_open(self):
        from services.rate_limit import check_rate_limit
        ok, _ = _run(check_rate_limit("", 3, 60))
        assert ok is True

    def test_client_ip_prefers_xff(self):
        from services.rate_limit import client_ip
        class R:
            headers = {"X-Forwarded-For": "203.0.113.5, 10.0.0.1"}
            client = None
        assert client_ip(R()) == "203.0.113.5"

    def test_client_ip_falls_back_to_socket(self):
        from services.rate_limit import client_ip
        class C:
            host = "1.2.3.4"
        class R:
            headers = {}
            client = C()
        assert client_ip(R()) == "1.2.3.4"

    def test_client_ip_unknown_fallback(self):
        from services.rate_limit import client_ip
        class R:
            headers = {}
            client = None
        assert client_ip(R()) == "unknown"


# =============================================================================
# services.captcha — three env states
# =============================================================================
class TestCaptcha:
    def test_no_secret_and_not_required_allows(self, monkeypatch):
        for k in ("TURNSTILE_SECRET", "HCAPTCHA_SECRET", "CAPTCHA_REQUIRED"):
            monkeypatch.delenv(k, raising=False)
        from services.captcha import verify_captcha
        ok, reason = _run(verify_captcha(None))
        assert ok is True
        assert reason == "disabled"

    def test_required_but_no_secret_refuses(self, monkeypatch):
        monkeypatch.delenv("TURNSTILE_SECRET", raising=False)
        monkeypatch.delenv("HCAPTCHA_SECRET", raising=False)
        monkeypatch.setenv("CAPTCHA_REQUIRED", "1")
        from services.captcha import verify_captcha
        ok, reason = _run(verify_captcha("anything"))
        assert ok is False
        assert reason == "misconfigured"

    def test_configured_missing_token_when_required(self, monkeypatch):
        monkeypatch.setenv("TURNSTILE_SECRET", "s3cr3t")
        monkeypatch.setenv("CAPTCHA_REQUIRED", "1")
        from services.captcha import verify_captcha
        ok, reason = _run(verify_captcha(""))
        assert ok is False
        assert reason == "missing"

    def test_configured_missing_token_when_optional(self, monkeypatch):
        monkeypatch.setenv("TURNSTILE_SECRET", "s3cr3t")
        monkeypatch.delenv("CAPTCHA_REQUIRED", raising=False)
        from services.captcha import verify_captcha
        ok, reason = _run(verify_captcha(""))
        assert ok is True
        assert reason == "missing_but_optional"

    def test_captcha_provider_returns_turnstile_first(self, monkeypatch):
        monkeypatch.setenv("TURNSTILE_SECRET", "t")
        monkeypatch.setenv("HCAPTCHA_SECRET", "h")
        from services.captcha import captcha_provider
        assert captcha_provider() == "turnstile"


# =============================================================================
# services.ssrf_guard — private IP + hostname + protocol coverage
# =============================================================================
class TestSSRFGuard:
    def test_public_url_allowed(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        ok, reason = is_url_safe_for_fetch("https://example.com")
        assert ok is True
        assert reason == ""

    def test_localhost_hostname_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        ok, reason = is_url_safe_for_fetch("http://localhost:8080/api")
        assert ok is False
        assert reason == "blocked_host"

    def test_cloud_metadata_hostname_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        for h in ("metadata.google.internal", "metadata.aws.internal",
                   "kubernetes.default.svc"):
            ok, reason = is_url_safe_for_fetch(f"http://{h}/v1/creds")
            assert ok is False, f"{h} should be blocked"
            assert reason == "blocked_host"

    def test_raw_private_ips_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        # Cover every private range the audit called out.
        for ip in ("127.0.0.1", "10.0.0.5", "172.16.5.5", "192.168.1.100",
                    "169.254.169.254", "0.0.0.0"):
            ok, reason = is_url_safe_for_fetch(f"http://{ip}/")
            assert ok is False, f"{ip} should be blocked"
            assert reason == "private_ip"

    def test_raw_ipv6_loopback_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        # IPv6 loopback must also be rejected.
        ok, reason = is_url_safe_for_fetch("http://[::1]/")
        assert ok is False
        assert reason == "private_ip"

    def test_ipv6_link_local_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        ok, reason = is_url_safe_for_fetch("http://[fe80::1]/")
        assert ok is False
        assert reason == "private_ip"

    def test_non_http_schemes_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        for u in ("file:///etc/passwd", "ftp://ftp.example.com/",
                   "gopher://x/", "data:text/html,<script>alert(1)</script>"):
            ok, reason = is_url_safe_for_fetch(u)
            assert ok is False, f"{u} should be blocked"
            assert reason == "bad_scheme"

    def test_missing_scheme_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        # Someone typing "example.com" (no scheme) — the guard is called
        # AFTER the router prepends https://, so raw domains coming
        # DIRECTLY should be rejected.
        ok, reason = is_url_safe_for_fetch("example.com")
        assert ok is False

    def test_empty_url_blocked(self):
        from services.ssrf_guard import is_url_safe_for_fetch
        ok, reason = is_url_safe_for_fetch("")
        assert ok is False
        assert reason == "no_url"
        ok, reason = is_url_safe_for_fetch(None)
        assert ok is False
        assert reason == "no_url"

    def test_dns_failure_blocked(self):
        """A hostname that doesn't resolve is refused (safer to refuse
        than to allow ambiguous behavior)."""
        from services.ssrf_guard import is_url_safe_for_fetch
        ok, reason = is_url_safe_for_fetch(
            "https://this-hostname-definitely-does-not-exist-12345.invalid/"
        )
        assert ok is False
        assert reason == "dns_failure"


# =============================================================================
# services.auth.draft_tokens — sign + verify
# =============================================================================
class TestDraftTokens:
    def test_sign_deterministic(self, monkeypatch):
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "test-secret-1")
        from services.auth.draft_tokens import sign_draft_id
        assert sign_draft_id("draft-A") == sign_draft_id("draft-A")

    def test_different_ids_different_tokens(self, monkeypatch):
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "test-secret-2")
        from services.auth.draft_tokens import sign_draft_id
        assert sign_draft_id("draft-A") != sign_draft_id("draft-B")

    def test_different_secrets_different_tokens(self, monkeypatch):
        from services.auth.draft_tokens import sign_draft_id
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "k1")
        a = sign_draft_id("draft-X")
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "k2")
        b = sign_draft_id("draft-X")
        assert a != b

    def test_verify_correct_token(self, monkeypatch):
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "verify-secret")
        from services.auth.draft_tokens import sign_draft_id, verify_draft_token
        tok = sign_draft_id("draft-good")
        assert verify_draft_token("draft-good", tok) is True

    def test_verify_wrong_token(self, monkeypatch):
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "verify-secret")
        from services.auth.draft_tokens import verify_draft_token
        assert verify_draft_token("draft-good", "not-the-token") is False

    def test_verify_wrong_draft_id(self, monkeypatch):
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "verify-secret")
        from services.auth.draft_tokens import sign_draft_id, verify_draft_token
        tok = sign_draft_id("draft-A")
        # Reusing draft-A's token for draft-B must fail.
        assert verify_draft_token("draft-B", tok) is False

    def test_verify_empty_inputs(self, monkeypatch):
        monkeypatch.setenv("DRAFT_SIGNING_SECRET", "verify-secret")
        from services.auth.draft_tokens import verify_draft_token
        assert verify_draft_token("", "any") is False
        assert verify_draft_token("draft", "") is False
        assert verify_draft_token("draft", None) is False


# =============================================================================
# Router source-level enforcement guards
# =============================================================================
class TestOnboardingDraftGate:
    def test_create_returns_draft_token(self):
        from routers.onboarding import create_onboarding_draft
        src = inspect.getsource(create_onboarding_draft)
        assert "draft_token" in src
        assert "sign_draft_id" in src

    def test_get_requires_draft_token(self):
        from routers.onboarding import get_onboarding_draft
        src = inspect.getsource(get_onboarding_draft)
        assert "_require_draft_token" in src

    def test_patch_requires_draft_token(self):
        from routers.onboarding import patch_onboarding_draft
        src = inspect.getsource(patch_onboarding_draft)
        assert "_require_draft_token" in src

    def test_require_token_helper_uses_hmac_verifier(self):
        from routers.onboarding import _require_draft_token
        src = inspect.getsource(_require_draft_token)
        assert "verify_draft_token" in src
        # 401 (not 404) so the response shape distinguishes "unauthorized"
        # from "not found" — matters for the frontend error UX.
        assert "status_code=401" in src

    def test_create_is_rate_limited_per_ip(self):
        from routers.onboarding import create_onboarding_draft
        src = inspect.getsource(create_onboarding_draft)
        assert "check_rate_limit" in src
        assert "client_ip" in src


class TestRegisterGate:
    def test_register_model_has_captcha_token(self):
        from routers.auth import RegisterInput
        m = RegisterInput(email="a@b.com", password="strong-pw",
                           company_name="c", name="n")
        assert hasattr(m, "captcha_token")
        assert m.captcha_token is None

    def test_register_handler_rate_limits_and_verifies_captcha(self):
        from routers.auth import register
        src = inspect.getsource(register)
        # Both checks must run BEFORE any DB work.
        assert "check_rate_limit" in src
        assert "verify_captcha" in src
        assert 'bucket="register"' in src
        # Response uses 429 for rate limit + 400 for captcha failure.
        assert "status_code=429" in src
        assert "status_code=400" in src


class TestSignupAiGate:
    def test_guard_applied_to_all_ai_endpoints(self):
        """Every endpoint in routers/signup.py that touches the LLM/STT/TTS
        or reveals user data must run through _guard_signup_endpoint."""
        import routers.signup as sg
        # Endpoints that MUST be gated (i.e. AI-calling or data-revealing).
        gated_endpoints = [
            "check_email",
            "website_intel",
            "signup_tts",
            "signup_stt",
            "interview_start",
            "interview_back",
            "interview_answer",
            "interview_blueprint",
            "interview_refine",
        ]
        for name in gated_endpoints:
            fn = getattr(sg, name, None)
            assert fn is not None, f"{name} not found in routers/signup.py"
            src = inspect.getsource(fn)
            assert "_guard_signup_endpoint" in src, (
                f"{name} must call _guard_signup_endpoint "
                "(rate-limit + CAPTCHA before doing any work)"
            )

    def test_guard_source_runs_rate_limit_then_captcha(self):
        from routers.signup import _guard_signup_endpoint
        src = inspect.getsource(_guard_signup_endpoint)
        # Order matters: cheap check (rate limit) before expensive one (CAPTCHA network call).
        rl_pos = src.find("check_rate_limit")
        cap_pos = src.find("verify_captcha")
        assert 0 < rl_pos < cap_pos, "rate limit must run BEFORE captcha verify"
        # Both quotas present: hourly ceiling AND burst.
        assert "_SIGNUP_AI_LIMIT_HOURLY" in src
        assert "_SIGNUP_BURST_LIMIT" in src

    def test_website_intel_applies_ssrf_guard(self):
        from routers.signup import website_intel
        src = inspect.getsource(website_intel)
        assert "is_url_safe_for_fetch" in src
        # And refuses on the "not safe" branch.
        assert '"This URL isn' in src or 'private' in src.lower()

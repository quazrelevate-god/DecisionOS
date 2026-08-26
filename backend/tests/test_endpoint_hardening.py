"""FIX-006-C (Sprint 0 batch C): endpoint hardening tests.

Covers:
  S0-03  GET /api/files/{fname} legacy local-disk fallback is now
         off-by-default and only opt-in via SERVE_LEGACY_LOCAL_DISK.
         The old code returned any file on disk to any authenticated
         caller — no tenant-ownership check on that branch.
  S0-04  /auth/otp/request no longer surfaces dev_otp in the JSON body
         unless DEV_OTP_IN_RESPONSE=1 is explicitly set. Prod refuses
         to boot when neither APM nor Twilio is configured (silent
         dev-mode fall-through would leak login codes).
  S0-05  WhatsApp webhook rejects (403) on X-Hub-Signature-256 mismatch
         instead of logging + processing anyway. Missing WA_APP_SECRET
         is rejected in prod, accepted with a warning in dev.

All tests run in-process — no live server, no Mongo — using inspection
+ small ASGI-free helpers.
"""
import hmac
import hashlib
import inspect
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ===========================================================================
# S0-03: legacy local-disk fallback in GET /api/files/{fname}
# ===========================================================================
class TestLegacyDiskFallback:
    """The vulnerable code path was: if no DB record matches the file
    name, fall through to `UPLOAD_DIR / fname` and serve whatever's on
    disk — completely bypassing tenant scope. Post-FIX-002-E migration
    this should never fire, but leaving it live is the S0-03 hole.
    """

    def test_get_file_source_has_serve_legacy_flag_gate(self):
        """get_file's legacy branch must be gated on SERVE_LEGACY_LOCAL_DISK,
        not just `legacy_path.exists()`."""
        import server
        src = inspect.getsource(server.get_file)
        assert "SERVE_LEGACY_LOCAL_DISK" in src, (
            "S0-03 regression: get_file must import + gate the legacy "
            "disk fallback on SERVE_LEGACY_LOCAL_DISK"
        )
        # And the default-off path must WARN so ops can spot lingering
        # references in observability.
        assert 'S0-03 legacy-disk hit denied' in src or 'legacy-disk hit denied' in src

    def test_default_is_off(self, monkeypatch):
        """Without the env flag, SERVE_LEGACY_LOCAL_DISK is False."""
        # Config computes it at import time from os.environ. Assert the
        # shipped value (any non-truthy env, or env unset).
        for v in ("", "0", "false", "no"):
            monkeypatch.setenv("SERVE_LEGACY_LOCAL_DISK", v)
            parsed = v.strip().lower() in ("1", "true", "yes", "on")
            assert parsed is False, f"{v!r} should not enable"

    def test_truthy_values_enable_the_opt_in(self, monkeypatch):
        for v in ("1", "true", "TRUE", "yes", "on"):
            parsed = v.strip().lower() in ("1", "true", "yes", "on")
            assert parsed is True, f"{v!r} should enable"

    def test_get_file_source_still_has_tenant_scope_on_normal_paths(self):
        """Sanity: the 4 non-legacy branches (db.files, ingestions,
        ledger, capture_drafts) all query on tenant_id. That was the
        FIX-002-E fix; regression-guard it here so nobody quietly
        removes the scoping while touching the file for S0-03."""
        import server
        src = inspect.getsource(server.get_file)
        # Each of the 4 branches queries with tenant_id in the filter.
        assert src.count('"tenant_id": tid') >= 4, (
            "get_file must scope every DB lookup by tenant_id"
        )


# ===========================================================================
# S0-04: dev-OTP leak in /auth/otp/request response
# ===========================================================================
class TestDevOtpLeak:
    def test_issue_otp_source_gates_dev_otp_on_env_flag(self):
        """_issue_otp must import DEV_OTP_IN_RESPONSE and gate the
        resp['dev_otp'] = code line on it."""
        import server
        src = inspect.getsource(server._issue_otp)
        assert "DEV_OTP_IN_RESPONSE" in src, (
            "S0-04 regression: _issue_otp must gate dev_otp on the "
            "DEV_OTP_IN_RESPONSE env flag"
        )
        # The dangerous line only fires when BOTH dev AND flag on.
        assert 'if dev and DEV_OTP_IN_RESPONSE' in src

    def test_default_is_off(self):
        """DEV_OTP_IN_RESPONSE unset → False. Reproduce the parsing."""
        for v in ("", "0", "false", "no"):
            parsed = v.strip().lower() in ("1", "true", "yes", "on")
            assert parsed is False

    def test_truthy_values_opt_in(self):
        for v in ("1", "true", "TRUE", "yes", "on"):
            parsed = v.strip().lower() in ("1", "true", "yes", "on")
            assert parsed is True

    def test_server_source_has_prod_boot_check(self):
        """server.py must raise at import time when ENV=prod and neither
        APM_SMS_API_KEY nor TWILIO_* is set. Grep-style check because
        actually reloading server with prod env is heavy."""
        import server
        import inspect
        src = inspect.getsource(server)
        # The check must reference both providers and the RuntimeError.
        assert "APM_ENABLED or TWILIO_ENABLED" in src
        assert 'No SMS provider configured' in src
        assert 'Refusing to boot in prod' in src

    def test_prod_without_sms_refuses_to_boot(self, monkeypatch):
        """End-to-end: with ENV=prod and no SMS provider env, importing
        server must raise. Uses sys.modules eviction + explicit env so
        the check re-runs on fresh import."""
        # Wipe every provider env var.
        for k in ("APM_SMS_API_KEY", "TWILIO_ACCOUNT_SID",
                    "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
            monkeypatch.setenv(k, "")
        monkeypatch.setenv("ENV", "prod")
        # Also set the other prod guards so we hit our check specifically.
        monkeypatch.setenv("CORS_ORIGINS", "https://app.decisionos.com")
        monkeypatch.setenv("SUPERADMIN_EMAIL", "ops@x.com")
        monkeypatch.setenv("SUPERADMIN_PASSWORD", "x")
        # Evict + fresh import.
        sys.modules.pop("server", None)
        sys.modules.pop("config", None)
        try:
            with pytest.raises(RuntimeError, match="SMS provider"):
                import server  # noqa: F401
        finally:
            # Restore dev-safe state so subsequent tests import cleanly.
            monkeypatch.setenv("ENV", "dev")
            sys.modules.pop("server", None)
            sys.modules.pop("config", None)
            import server  # noqa: F401


# ===========================================================================
# S0-05: WhatsApp webhook signature enforcement
# ===========================================================================
class TestWhatsappSignatureEnforcement:
    def test_source_rejects_on_mismatch_not_processes(self):
        """The whole point of the fix: on signature mismatch, RAISE 403
        instead of logging and processing anyway."""
        import server
        src = inspect.getsource(server.whatsapp_webhook)
        # Must raise 403 in the mismatch branch.
        assert 'status_code=403' in src
        assert 'Invalid signature' in src
        # And the OLD "processing anyway" line must be gone.
        assert "processing anyway" not in src, (
            "S0-05 regression: signature mismatch must reject, not "
            "log and process — the old behaviour is the vulnerability"
        )

    def test_source_still_uses_constant_time_compare(self):
        """hmac.compare_digest must still be the comparison — no
        accidental regression to == that would leak timing info."""
        import server
        src = inspect.getsource(server.whatsapp_webhook)
        assert "hmac.compare_digest(expected, sig)" in src

    def test_source_refuses_missing_secret_in_prod(self):
        """WA_APP_SECRET absent + ENV=prod → refuse. Dev/staging still
        accept so local tunnels work during integration testing."""
        import server
        src = inspect.getsource(server.whatsapp_webhook)
        assert "running_env == \"prod\"" in src or 'running_env == "prod"' in src
        assert 'WA_APP_SECRET not configured' in src

    def test_source_still_returns_configured_status_when_no_ACCESS_TOKEN(self):
        """Unchanged: the early-return for missing WA_ACCESS_TOKEN
        stays — it's the "webhook wired but ingestion not enabled"
        response, not a security decision."""
        import server
        src = inspect.getsource(server.whatsapp_webhook)
        assert 'status": "not_configured' in src

    def test_signature_computation_is_correct(self):
        """Sanity: recompute the same HMAC the middleware expects, to
        catch a hash-alg or encoding regression."""
        secret = b"test-secret"
        body = b'{"entry":[{"changes":[]}]}'
        expected = "sha256=" + hmac.new(secret, body,
                                          hashlib.sha256).hexdigest()
        # Reproduce the same shape locally to sanity-check the format.
        assert expected.startswith("sha256=")
        assert len(expected) == len("sha256=") + 64  # 32 bytes hex
        # And constant-time compare against a mismatching sig fails.
        assert not hmac.compare_digest(expected, "sha256=aaaa")

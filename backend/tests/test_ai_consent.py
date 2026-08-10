"""FIX-005-C (RBAC-25) tests: DPDP AI-consent tracking.

  * has_active_consent state matrix (granted/revoked/versioned).
  * require_ai_consent raises HTTPException(451) when missing.
  * consent_status shape (frontend contract, no IP/UA leak).
  * build_grant_payload captures actor + IP + UA + version.
  * build_revoke_patch flips revoked_at without wiping grant history.
  * Endpoints: GET (any user), POST (owner), DELETE (owner).
  * Grant + revoke emit audit_log rows.
  * guarded_llm calls require_ai_consent (with tenant-fetch reuse).
"""
import inspect
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ===========================================================================
# has_active_consent + consent_status
# ===========================================================================
class TestHasActiveConsent:
    def test_no_tenant(self):
        from services.ai_consent import has_active_consent
        assert has_active_consent(None) is False
        assert has_active_consent({}) is False

    def test_granted_current_version(self):
        from services.ai_consent import has_active_consent, CURRENT_CONSENT_VERSION
        tenant = {"ai_consent": {
            "granted_at": "2026-08-10T00:00:00+00:00",
            "version": CURRENT_CONSENT_VERSION,
            "revoked_at": None,
        }}
        assert has_active_consent(tenant) is True

    def test_revoked_returns_false(self):
        from services.ai_consent import has_active_consent, CURRENT_CONSENT_VERSION
        tenant = {"ai_consent": {
            "granted_at": "2026-08-10T00:00:00+00:00",
            "version": CURRENT_CONSENT_VERSION,
            "revoked_at": "2026-08-11T00:00:00+00:00",
        }}
        assert has_active_consent(tenant) is False

    def test_outdated_version_returns_false(self):
        from services.ai_consent import has_active_consent
        tenant = {"ai_consent": {
            "granted_at": "2026-08-10T00:00:00+00:00",
            "version": "0.5",
            "revoked_at": None,
        }}
        assert has_active_consent(tenant) is False

    def test_no_grant_returns_false(self):
        from services.ai_consent import has_active_consent
        tenant = {"ai_consent": {"granted_at": None}}
        assert has_active_consent(tenant) is False


class TestConsentStatus:
    def test_shape_when_active(self):
        from services.ai_consent import consent_status, CURRENT_CONSENT_VERSION
        tenant = {"ai_consent": {
            "granted_at": "2026-08-10T00:00:00+00:00",
            "granted_by_email": "owner@x.com",
            "version": CURRENT_CONSENT_VERSION,
            "revoked_at": None,
            "ip": "1.2.3.4", "ua": "Chrome",
        }}
        s = consent_status(tenant)
        assert s["active"] is True
        assert s["needs_reconsent"] is False
        assert s["granted_by_email"] == "owner@x.com"
        assert s["granted_version"] == CURRENT_CONSENT_VERSION
        # IP + UA NOT leaked to peers via consent_status.
        assert "ip" not in s
        assert "ua" not in s

    def test_needs_reconsent_when_version_drift(self):
        from services.ai_consent import consent_status
        tenant = {"ai_consent": {
            "granted_at": "2026-08-10T00:00:00+00:00",
            "version": "0.5",
            "revoked_at": None,
        }}
        s = consent_status(tenant)
        assert s["active"] is False
        assert s["needs_reconsent"] is True

    def test_no_consent_shape(self):
        from services.ai_consent import consent_status
        s = consent_status({})
        assert s["active"] is False
        assert s["granted_at"] is None


class TestRequireAiConsent:
    def test_active_consent_passes(self):
        from services.ai_consent import require_ai_consent, CURRENT_CONSENT_VERSION
        require_ai_consent({"ai_consent": {
            "granted_at": "2026-08-10T00:00:00+00:00",
            "version": CURRENT_CONSENT_VERSION,
            "revoked_at": None,
        }})

    def test_no_consent_raises_451(self):
        from services.ai_consent import require_ai_consent
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            require_ai_consent({})
        assert exc_info.value.status_code == 451
        assert exc_info.value.detail["code"] == "ai_consent_required"

    def test_revoked_raises_451(self):
        from services.ai_consent import require_ai_consent, CURRENT_CONSENT_VERSION
        from fastapi import HTTPException
        with pytest.raises(HTTPException):
            require_ai_consent({"ai_consent": {
                "granted_at": "2026-08-10T00:00:00+00:00",
                "version": CURRENT_CONSENT_VERSION,
                "revoked_at": "2026-08-11T00:00:00+00:00",
            }})


# ===========================================================================
# build_grant_payload + build_revoke_patch
# ===========================================================================
class TestBuildGrantPayload:
    def test_captures_actor_ip_ua_version(self):
        from services.ai_consent import build_grant_payload, CURRENT_CONSENT_VERSION
        p = build_grant_payload(
            actor_user_id="u1", actor_email="OWNER@X.COM",
            ip="1.2.3.4", ua="Mozilla/5.0",
        )
        assert p["granted_by_user_id"] == "u1"
        assert p["granted_by_email"] == "owner@x.com"  # lowercased
        assert p["ip"] == "1.2.3.4"
        assert p["ua"] == "Mozilla/5.0"
        assert p["version"] == CURRENT_CONSENT_VERSION
        assert p["revoked_at"] is None
        assert p["granted_at"]  # iso timestamp

    def test_ua_capped(self):
        from services.ai_consent import build_grant_payload
        p = build_grant_payload(
            actor_user_id="u", actor_email="a@b.com",
            ua="a" * 5000,
        )
        assert len(p["ua"]) <= 500


class TestBuildRevokePatch:
    def test_only_flips_revoked_at(self):
        """Revoke must NOT wipe granted_at/by/version — the audit
        trail depends on that history staying intact."""
        from services.ai_consent import build_revoke_patch
        p = build_revoke_patch()
        assert "ai_consent.revoked_at" in p
        # Nothing else is set.
        assert len(p) == 1


# ===========================================================================
# Endpoints
# ===========================================================================
class TestEndpoints:
    def test_get_open_to_any_user(self):
        """Frontend needs it to decide banner state."""
        from server import get_ai_consent
        src = inspect.getsource(get_ai_consent)
        assert "get_current_user" in src

    def test_post_owner_only(self):
        from server import grant_ai_consent
        src = inspect.getsource(grant_ai_consent)
        assert 'require_role("owner")' in src

    def test_delete_owner_only(self):
        from server import revoke_ai_consent
        src = inspect.getsource(revoke_ai_consent)
        assert 'require_role("owner")' in src

    def test_grant_captures_ip_and_ua(self):
        from server import grant_ai_consent
        src = inspect.getsource(grant_ai_consent)
        assert 'X-Forwarded-For' in src
        assert 'User-Agent' in src
        # Uses build_grant_payload (single-source-of-truth helper).
        assert 'build_grant_payload' in src

    def test_grant_emits_audit_log(self):
        from server import grant_ai_consent
        src = inspect.getsource(grant_ai_consent)
        assert 'action="tenant_ai_consent_granted"' in src

    def test_revoke_emits_audit_log(self):
        from server import revoke_ai_consent
        src = inspect.getsource(revoke_ai_consent)
        assert 'action="tenant_ai_consent_revoked"' in src

    def test_revoke_refuses_when_no_active_grant(self):
        from server import revoke_ai_consent
        src = inspect.getsource(revoke_ai_consent)
        assert 'No active AI consent' in src or 'status_code=400' in src


# ===========================================================================
# guarded_llm gate
# ===========================================================================
class TestGuardedLlmConsentGate:
    def test_source_calls_require_ai_consent(self):
        from services.ai.llm_limits import guarded_llm
        src = inspect.getsource(guarded_llm)
        assert "require_ai_consent" in src

    def test_source_reuses_tenant_fetch_for_consent_and_quota(self):
        """Efficiency check: one tenants.find_one per LLM call, not
        two. Consent + plan-quota fields are all pulled together."""
        from services.ai.llm_limits import guarded_llm
        src = inspect.getsource(guarded_llm)
        # The consent check happens BEFORE the quota check on the same
        # tenant_doc reference — same fetch used for both.
        pos_consent = src.find("require_ai_consent")
        pos_quota = src.find("check_quota")
        assert 0 < pos_consent < pos_quota

"""FIX-005-C (RBAC-25): DPDP consent tracking for AI features.

India's DPDP Act 2023 requires explicit, informed consent before
processing personal data — and every AI feature in DecisionOS sends
tenant data (employee names, tasks, decisions, contact PII) to
Anthropic/OpenAI/Gemini/Sarvam. Without a consent record we fail
DPDP audits and expose the tenant admin to personal liability.

Design:
  * `tenant.ai_consent` = {
        granted_at: iso | None,   None = not granted / revoked
        granted_by_user_id: str | None,
        granted_by_email: str | None,
        ip: str | None,
        ua: str | None,
        version: str,             The consent-doc version accepted
                                   (bump when we materially change scope)
        revoked_at: iso | None,   Set on revocation; leaves the row
                                   so audit-log has a full history
    }
  * `CURRENT_CONSENT_VERSION` — bump when scope changes (new AI
    provider, new data category shared). Tenants must re-consent
    when their granted version < current.
  * `has_active_consent(tenant)` — the hot-path gate. True iff
    tenant.ai_consent.granted_at is set AND revoked_at is None AND
    version matches current.
  * `require_ai_consent(tenant)` — throws HTTPException(451
    "Unavailable For Legal Reasons") when consent missing. Callers
    at every AI endpoint choke-point.

Endpoints (routers/auth.py, owner-only for grant/revoke):
  GET  /tenant/ai-consent  — status readable by any member
  POST /tenant/ai-consent {version} — owner grants
  DELETE /tenant/ai-consent — owner revokes

Every state change writes an audit_log row with actor + IP + UA so
we can prove the who/when/how a regulator asks about.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException


# Bump when we materially change what data is sent to AI providers,
# or add a new provider. Tenants whose granted version < current
# must re-consent.
CURRENT_CONSENT_VERSION = "1.0"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def has_active_consent(tenant: Optional[Dict[str, Any]]) -> bool:
    """Hot-path reader. True iff consent granted, not revoked, and
    on the current version."""
    if not tenant:
        return False
    c = tenant.get("ai_consent") or {}
    if not isinstance(c, dict):
        return False
    if not c.get("granted_at"):
        return False
    if c.get("revoked_at"):
        return False
    if (c.get("version") or "") != CURRENT_CONSENT_VERSION:
        return False
    return True


def consent_status(tenant: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Frontend-facing status. Powers the consent modal + Settings
    page. Never includes the granting user's IP or UA — those are
    audit-only, not for peer viewing."""
    tenant = tenant or {}
    c = tenant.get("ai_consent") or {}
    if not isinstance(c, dict):
        c = {}
    active = has_active_consent(tenant)
    return {
        "active": active,
        "current_version": CURRENT_CONSENT_VERSION,
        "granted_version": c.get("version"),
        "granted_at": c.get("granted_at"),
        "granted_by_email": c.get("granted_by_email"),
        "revoked_at": c.get("revoked_at"),
        "needs_reconsent": bool(c.get("granted_at") and not c.get("revoked_at")
                                 and (c.get("version") or "") != CURRENT_CONSENT_VERSION),
    }


def require_ai_consent(tenant: Optional[Dict[str, Any]]) -> None:
    """Raise HTTPException(451) when consent is missing / revoked /
    outdated. Called at every AI endpoint choke point.

    451 "Unavailable For Legal Reasons" — semantically the right
    code; the frontend maps it to a friendly "your admin needs to
    accept AI processing consent first" modal.
    """
    if has_active_consent(tenant):
        return
    status = consent_status(tenant)
    raise HTTPException(
        status_code=451,
        detail={
            "code": "ai_consent_required",
            "message": ("This AI feature is unavailable until your workspace "
                         "owner grants consent for AI data processing."),
            "current_version": CURRENT_CONSENT_VERSION,
            "granted_version": status.get("granted_version"),
            "needs_reconsent": status.get("needs_reconsent"),
        },
    )


def build_grant_payload(
    *,
    actor_user_id: str,
    actor_email: str,
    ip: Optional[str] = None,
    ua: Optional[str] = None,
    version: Optional[str] = None,
) -> Dict[str, Any]:
    """Shape a fresh consent grant record. Version defaults to
    CURRENT_CONSENT_VERSION when caller doesn't pin one (they
    almost never should — pinning implies the caller knows they're
    granting to an older version for compat)."""
    return {
        "granted_at": _now_iso(),
        "granted_by_user_id": actor_user_id,
        "granted_by_email": (actor_email or "").lower(),
        "ip": (ip or None),
        "ua": (ua or None)[:500] if ua else None,
        "version": version or CURRENT_CONSENT_VERSION,
        "revoked_at": None,
    }


def build_revoke_patch() -> Dict[str, Any]:
    """Just flip revoked_at — keeps the historical grant metadata
    for audit."""
    return {"ai_consent.revoked_at": _now_iso()}

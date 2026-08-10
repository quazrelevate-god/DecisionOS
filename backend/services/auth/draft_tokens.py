"""FIX-004-A (RBAC-01): HMAC-signed onboarding-draft tokens.

The problem this closes: `GET/PATCH /onboarding/draft/{draft_id}` was
public — a leaked or guessed UUID gave the world read/write access to
another founder's onboarding data (company name, phone, description,
generated OS blueprint).

Fix: `POST /onboarding/draft` returns `{draft_id, draft_token}`. The
token is a URL-safe HMAC-SHA256 of the draft_id, keyed by
`DRAFT_SIGNING_SECRET` (falls back to JWT_SECRET so no new env var is
required). Every subsequent GET/PATCH must present the token in the
`X-Draft-Token` header (or as a query param for GET convenience).

Why HMAC (not a random token stored in the DB):
  * Stateless — no DB round-trip to check the token.
  * Bound to the draft_id — a token from draft A can't be reused for
    draft B even if the attacker steals both.
  * Constant-time compare via `hmac.compare_digest`.

The token is NOT a session — it doesn't expire on its own. Draft
lifetime is already governed by the TTL on the drafts collection
(30 days per docstring on services.auth.onboarding_drafts). If the
draft is gone, verify_draft_token returns True but subsequent reads
of the draft doc 404 as before — no privilege leak.
"""
import hmac
import hashlib
import os
from typing import Optional


def _secret() -> bytes:
    """The HMAC key. Prefer DRAFT_SIGNING_SECRET; fall back to
    JWT_SECRET so no new env var is required for the initial deploy.
    In prod, ops should rotate DRAFT_SIGNING_SECRET independently of
    JWT_SECRET so revoking one doesn't invalidate the other."""
    return (os.environ.get("DRAFT_SIGNING_SECRET")
            or os.environ.get("JWT_SECRET")
            or "dev-only-draft-signing-key-change-me").encode("utf-8")


def sign_draft_id(draft_id: str) -> str:
    """Return a URL-safe HMAC over the draft_id. Never raises."""
    if not draft_id:
        return ""
    mac = hmac.new(_secret(), draft_id.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def verify_draft_token(draft_id: str, token: Optional[str]) -> bool:
    """Constant-time verify. Returns False on missing / mismatched token."""
    if not draft_id or not token or not isinstance(token, str):
        return False
    expected = sign_draft_id(draft_id)
    # hmac.compare_digest is constant-time even for different-length
    # inputs; safe against timing side-channels.
    return hmac.compare_digest(expected, token.strip())

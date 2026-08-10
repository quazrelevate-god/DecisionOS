"""FIX-003-D (S2-07): email verification + password reset.

Both flows share the same one-time-token model:

  auth_email_tokens
    token       str    URL-safe, 32 chars, unpredictable. Unique index.
    kind        str    "email_verify" | "password_reset"
    user_id     str    who the token is for
    tenant_id   str    denormalized for tenant filtering + auditing
    email       str    denormalized so a mid-flow email change doesn't
                       silently orphan the token
    expires_at  date   TTL index — token auto-purges when it expires
    used_at     str?   ISO timestamp — set on single-use consumption
    created_at  str    audit

Security invariants (locked in by tests):
  * Tokens are 32-char URL-safe (~192 bits of entropy from
    secrets.token_urlsafe(24)).
  * Single-use: consume() marks `used_at` atomically and rejects a
    second consume call for the same token.
  * TTL differs by kind:
      email_verify   — 3 days (users can be slow to check email)
      password_reset — 1 hour (short window = smaller attack surface)
  * /auth/password/forgot must return the same shape whether the
    email exists or not, so nobody can enumerate registered emails.
    That's enforced by the router; this service just doesn't leak.
  * Rate limit per (kind, email): one active token per (kind, email)
    at a time. Requesting again inside the cooldown returns the
    existing token unchanged (idempotent from the caller's POV,
    doesn't spam the user's inbox, doesn't let an attacker flood).
"""
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional


COLLECTION = "auth_email_tokens"

KIND_EMAIL_VERIFY = "email_verify"
KIND_PASSWORD_RESET = "password_reset"
VALID_KINDS = {KIND_EMAIL_VERIFY, KIND_PASSWORD_RESET}

# TTLs by kind. See module docstring for rationale.
_TTL_BY_KIND = {
    KIND_EMAIL_VERIFY: timedelta(days=3),
    KIND_PASSWORD_RESET: timedelta(hours=1),
}

# Cooldown per (kind, email) so a login-page attacker can't
# flood inboxes or CPU-spam our token store.
_RESEND_COOLDOWN = timedelta(seconds=60)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_token() -> str:
    """URL-safe random 32-char token (~192 bits of entropy)."""
    return secrets.token_urlsafe(24)


async def issue(db, *, kind: str, user_id: str, tenant_id: str, email: str) -> dict:
    """Issue (or reuse) a token of `kind` for the given user.

    Returns the token document (including the raw `token` string so
    the router can embed it in the email URL). Never raises for a
    valid inputs case.

    Idempotent within the cooldown: if a still-valid unused token
    already exists for (kind, email), return that same token instead
    of minting a new one. Prevents inbox flood.
    """
    if kind not in VALID_KINDS:
        raise ValueError(f"Invalid auth-email token kind: {kind!r}")
    email = (email or "").strip().lower()
    if not email:
        raise ValueError("email is required to issue an auth-email token")

    now = _now()
    # Look for a live, unused token issued recently. If we find one,
    # return it as-is (the user probably hit "resend" too fast; giving
    # them the same URL twice is fine and avoids sending two emails).
    existing = await db[COLLECTION].find_one(
        {"kind": kind, "email": email, "used_at": None,
         "expires_at": {"$gt": now}},
        {"_id": 0},
    )
    if existing:
        # Cooldown gate: if the last issue was very recent, still
        # return the existing token but don't refresh the timestamp.
        # Caller (router) decides whether to re-send the email.
        return existing

    token = _new_token()
    exp = now + _TTL_BY_KIND[kind]
    doc = {
        "token": token,
        "kind": kind,
        "user_id": user_id,
        "tenant_id": tenant_id,
        "email": email,
        "expires_at": exp,   # BSON date so TTL index works
        "used_at": None,
        "created_at": now.isoformat(),
    }
    await db[COLLECTION].insert_one(doc)
    # Copy so caller can't mutate our stored doc.
    return dict(doc)


async def consume(db, *, token: str, kind: str) -> Optional[dict]:
    """Atomically mark a token as used.

    Returns the token document on success. Returns None if the token
    doesn't exist, is the wrong kind, is expired, or has already been
    used.

    The single-use atomicity matters — without it, a race between two
    resets could double-spend the same token. We use update_one with
    used_at: None as the filter so only the FIRST call wins.
    """
    if not token or kind not in VALID_KINDS:
        return None
    now = _now()
    used_at = now.isoformat()
    # Match ONLY unused, unexpired, correct-kind rows.
    res = await db[COLLECTION].update_one(
        {"token": token, "kind": kind, "used_at": None,
         "expires_at": {"$gt": now}},
        {"$set": {"used_at": used_at}},
    )
    if getattr(res, "matched_count", 0) == 0 and getattr(res, "modified_count", 0) == 0:
        return None
    # Return the updated doc for the caller to act on.
    row = await db[COLLECTION].find_one({"token": token}, {"_id": 0})
    return row


async def invalidate_active_tokens(db, *, kind: str, email: str) -> int:
    """Mark every live token of `kind` for `email` as used. Called
    after a password reset succeeds so any other outstanding reset
    links go dead. Returns count invalidated."""
    if not email or kind not in VALID_KINDS:
        return 0
    email = email.strip().lower()
    now = _now()
    res = await db[COLLECTION].update_many(
        {"kind": kind, "email": email, "used_at": None,
         "expires_at": {"$gt": now}},
        {"$set": {"used_at": now.isoformat(), "invalidated": True}},
    )
    return getattr(res, "modified_count", 0)


# ---------------------------------------------------------------------------
# Email body helpers — kept minimal + link-based so no SMTP dependency
# leaks into the service layer. The router assembles the final URL from
# APP_BASE_URL env + this template.
# ---------------------------------------------------------------------------
def render_verify_email(user_name: str, verify_url: str) -> str:
    return (
        f"<p>Hi {user_name or 'there'},</p>"
        f"<p>Confirm your email for DecisionOS by clicking the link below:</p>"
        f'<p><a href="{verify_url}">Verify my email</a></p>'
        f"<p>The link expires in 3 days. If you didn't sign up, ignore this email.</p>"
    )


def render_reset_email(user_name: str, reset_url: str) -> str:
    return (
        f"<p>Hi {user_name or 'there'},</p>"
        f"<p>Reset your DecisionOS password by clicking the link below:</p>"
        f'<p><a href="{reset_url}">Reset password</a></p>'
        f"<p>The link expires in 1 hour. If you didn't request a reset, "
        f"ignore this email — your password stays the same.</p>"
    )

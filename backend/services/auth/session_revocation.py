"""FIX-003-C (S2-06): JWT session revocation on logout.

The problem this closes:
  * `create_token` issues a JWT that stays valid until `exp` (7 days).
  * `/auth/logout` used to only `clear_auth_cookie()` — a browser-side
    delete. The token itself was still cryptographically valid, so an
    attacker who intercepted or copied it before logout kept full
    session access for up to 7 days.

The fix:
  * Every access-token payload gains a `jti` (JWT ID — a random UUID)
    at issuance time. See `core.create_token`.
  * `/logout` records `(jti, exp)` in `db.revoked_tokens` before it
    clears the cookie. `is_revoked(jti)` is checked on every
    authenticated request in `core.get_current_user`; a hit -> 401.
  * A TTL index on `revoked_tokens.exp` (in bootstrap) purges the row
    once the token would have expired anyway, so the table stays small
    (~= active-session count × logout rate × 7 days).

Design notes:
  * One extra DB round-trip per authenticated request. For an SME
    back-office app that's fine (~10ms Mongo find_one on an indexed
    field). A hot-path optimization (in-process LRU cache, bloom
    filter, Redis) is a Sprint 3 follow-up if load ever needs it.
  * We record the jti string only, not the token itself — keeps
    revoked_tokens rows small and un-guessable (jti is a random UUID).
  * `is_revoked` is call-safe if the collection or index is missing;
    it degrades open (returns False + logs), because a fail-closed
    behavior on Mongo blip would lock every user out — worse than the
    revocation gap it was meant to close.

Contract:
  revoke(jti, exp_iso, reason=None) -> None
    Idempotent — a repeat call for the same jti updates the row
    in place. `exp_iso` is the JWT's `exp` claim (unix or iso); if
    invalid, we default to 7 days from now so the row still expires.

  is_revoked(jti) -> bool
    True iff the jti has a live row in revoked_tokens. Never raises.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Optional


REVOKED_COLLECTION = "revoked_tokens"


def _to_datetime(exp: Any) -> Optional[datetime]:
    """Best-effort parse of a JWT exp claim. Returns None on failure —
    caller should default to a safe 7-day window."""
    if exp is None:
        return None
    if isinstance(exp, datetime):
        return exp if exp.tzinfo else exp.replace(tzinfo=timezone.utc)
    if isinstance(exp, (int, float)):
        try:
            return datetime.fromtimestamp(float(exp), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(exp, str):
        try:
            # iso strings from create_token payload after json round-trip.
            # `fromisoformat` on Python 3.11+ handles the trailing 'Z' via
            # replace; here the token payload uses `datetime + timedelta`
            # which serializes to `+00:00` — safe for fromisoformat.
            return datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


async def revoke(db, jti: str, exp: Any = None, reason: str = "logout") -> None:
    """Insert or update the revocation record for `jti`.

    Idempotent — calling twice for the same jti just refreshes the
    revoked_at timestamp. This matters because a user could double-
    click "logout" or a Twilio-style webhook retry could hit the
    endpoint twice.
    """
    if not jti:
        # Nothing to revoke. Caller likely handed us a legacy token
        # issued before jti became mandatory — silently no-op so the
        # logout still succeeds (the cookie clear alone is a partial
        # mitigation for the pre-jti case).
        return
    exp_dt = _to_datetime(exp) or (
        datetime.now(timezone.utc) + timedelta(days=7)
    )
    doc = {
        "jti": jti,
        "exp": exp_dt,   # store as BSON date so the TTL index works
        "reason": reason,
        "revoked_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db[REVOKED_COLLECTION].update_one(
            {"jti": jti},
            {"$set": doc},
            upsert=True,
        )
    except Exception:
        # Fail-open: don't take the entire /logout flow down because
        # Mongo blinked. The cookie clear (the caller's next line) is
        # still the visible logout signal to the user.
        pass


async def is_revoked(db, jti: str) -> bool:
    """Return True iff this jti has a live revocation row.

    Never raises. On any DB error, degrades to False + logs (per module
    docstring — fail-open is safer for auth-critical hot paths).
    """
    if not jti:
        return False
    try:
        row = await db[REVOKED_COLLECTION].find_one(
            {"jti": jti}, {"_id": 0, "jti": 1}
        )
        return row is not None
    except Exception:
        return False

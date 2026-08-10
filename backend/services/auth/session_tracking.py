"""FIX-004-G (RBAC-21): active-session tracking + management.

Extends the FIX-003-C revocation infrastructure with device metadata
so users can see and manage the sessions currently signed into their
account: "I'm logged in on 3 devices, revoke the phone I lost."

Design:
  * New `active_sessions` collection. Row per JWT jti.
  * Fields: jti, user_id, tenant_id, ua, ip, created_at, last_seen_at,
    exp, revoked_at. TTL on `exp` auto-purges expired rows (rows
    where the JWT would no longer verify anyway).
  * Recorded on login + register + switch-workspace (any place a new
    token is issued via create_token).
  * Updated (last_seen_at) on every authenticated request via a
    cheap upsert. One extra Mongo write per authenticated request —
    acceptable for the low-QPS back-office surface we target.
  * `/me/sessions` reads this collection. Revoke by jti calls the
    FIX-003-C session_revocation.revoke() so the token stops
    validating on the next request.
  * We DELIBERATELY don't try to look up the user's current jti to
    filter it out of a bulk-revoke — that's the caller's job.
    The endpoints pass current_jti so they can preserve the caller's
    own session on revoke-all.

Contract:
  record_session(db, jti, user_id, tenant_id, exp, ua=None, ip=None)
    -> None (best-effort, never raises)
  touch_session(db, jti) -> None (updates last_seen_at)
  list_sessions(db, user_id) -> list of active sessions
  revoke_all_sessions_for_user(db, user_id, tenant_id=None,
                                 keep_jti=None) -> int (# revoked)
"""
from datetime import datetime, timezone, timedelta
from typing import Any, List, Optional

from core import logger


COLLECTION = "active_sessions"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _to_datetime(exp: Any) -> Optional[datetime]:
    """Best-effort parse of a JWT exp claim (mirrors session_revocation)."""
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
            return datetime.fromisoformat(exp.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


async def record_session(
    db,
    *,
    jti: str,
    user_id: str,
    tenant_id: str,
    exp: Any = None,
    ua: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    """Insert (or refresh) the active_sessions row for a newly-issued
    token. Idempotent — if called twice for the same jti, the second
    call refreshes last_seen_at.

    Best-effort: a Mongo hiccup here MUST NOT break login/register/
    switch-workspace flows. Fail-open + log.
    """
    if not jti or not user_id:
        return
    exp_dt = _to_datetime(exp) or (_now() + timedelta(days=7))
    now_dt = _now()
    # Cap UA at 500 chars — same rationale as audit_log.record.
    if ua and len(ua) > 500:
        ua = ua[:500]
    doc = {
        "jti": jti,
        "user_id": user_id,
        "tenant_id": tenant_id,
        "ua": ua or None,
        "ip": ip or None,
        "created_at": _now_iso(),
        "last_seen_at": _now_iso(),
        "exp": exp_dt,       # BSON date so the TTL index works
        "revoked_at": None,
    }
    try:
        await db[COLLECTION].update_one(
            {"jti": jti}, {"$set": doc}, upsert=True,
        )
    except Exception as e:
        logger.warning(f"[session_tracking] failed to record jti={jti!r}: {e}")


async def touch_session(db, jti: str) -> None:
    """Bump last_seen_at on every authenticated request. Best-effort +
    silent on missing row (a token whose session-record was purged by
    TTL is still valid until its JWT exp; we don't re-create the row
    here to avoid unbounded row-per-jti growth if TTL was misconfigured)."""
    if not jti:
        return
    try:
        await db[COLLECTION].update_one(
            {"jti": jti, "revoked_at": None},
            {"$set": {"last_seen_at": _now_iso()}},
        )
    except Exception as e:
        logger.warning(f"[session_tracking] touch failed for {jti!r}: {e}")


async def list_sessions(db, user_id: str,
                         tenant_id: Optional[str] = None) -> List[dict]:
    """Every non-revoked, non-expired session for the user.

    Optional tenant_id narrows to sessions in ONE workspace (for a
    per-workspace "sessions in this workspace" view). Omit to see
    all workspaces' sessions (the typical /me/sessions call, since a
    user with 2 memberships legitimately has sessions in both).

    Rows returned newest-first (by created_at). exp is returned as
    an iso string for JSON serialization.
    """
    q: dict = {"user_id": user_id, "revoked_at": None}
    if tenant_id:
        q["tenant_id"] = tenant_id
    q["exp"] = {"$gt": _now()}
    rows = await db[COLLECTION].find(
        q, {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    # Serialize datetime -> iso for JSON.
    out = []
    for r in rows:
        if isinstance(r.get("exp"), datetime):
            r["exp"] = r["exp"].isoformat()
        out.append(r)
    return out


async def revoke_all_sessions_for_user(
    db,
    *,
    user_id: str,
    tenant_id: Optional[str] = None,
    keep_jti: Optional[str] = None,
) -> int:
    """Mark every live session for a user as revoked. Returns the count.

    `tenant_id` narrows the sweep to sessions in ONE workspace (for
    off-boarding: revoke this user's sessions in this tenant, leave
    their sessions in OTHER tenants untouched).

    `keep_jti` preserves the caller's own session — used by /me/sessions
    DELETE all so the user doesn't log themselves out mid-flow.

    Also records revocation in the FIX-003-C revoked_tokens table so
    get_current_user rejects the token on the next request.
    """
    from services.auth.session_revocation import revoke as _revoke
    q: dict = {"user_id": user_id, "revoked_at": None}
    if tenant_id:
        q["tenant_id"] = tenant_id
    if keep_jti:
        q["jti"] = {"$ne": keep_jti}
    # Fetch first so we can iterate the jtis into the revocation table.
    rows = await db[COLLECTION].find(
        q, {"_id": 0, "jti": 1, "exp": 1},
    ).to_list(500)
    if not rows:
        return 0
    revoked_at = _now_iso()
    ids = [r["jti"] for r in rows]
    # Mark as revoked in active_sessions.
    try:
        await db[COLLECTION].update_many(
            {"jti": {"$in": ids}},
            {"$set": {"revoked_at": revoked_at}},
        )
    except Exception as e:
        logger.warning(f"[session_tracking] bulk revoke update failed: {e}")
    # Register each in revoked_tokens so get_current_user rejects on
    # next request. Sequential (per-jti) rather than bulk because the
    # revocation service is the durable choke-point.
    for r in rows:
        try:
            await _revoke(db, r["jti"], exp=r.get("exp"), reason="user_revoked")
        except Exception:
            pass  # fail-open — the active_sessions flip is the durable signal
    return len(rows)


async def revoke_one_session(db, *, jti: str, user_id: str) -> bool:
    """Revoke a SPECIFIC session by jti, guarding that it belongs to
    the caller. Returns True if a session was revoked. Prevents a
    user from revoking someone ELSE's session by guessing a jti."""
    from services.auth.session_revocation import revoke as _revoke
    row = await db[COLLECTION].find_one(
        {"jti": jti, "user_id": user_id, "revoked_at": None},
        {"_id": 0, "jti": 1, "exp": 1},
    )
    if not row:
        return False
    revoked_at = _now_iso()
    await db[COLLECTION].update_one(
        {"jti": jti}, {"$set": {"revoked_at": revoked_at}},
    )
    try:
        await _revoke(db, jti, exp=row.get("exp"), reason="user_revoked")
    except Exception:
        pass  # active_sessions flip is durable
    return True

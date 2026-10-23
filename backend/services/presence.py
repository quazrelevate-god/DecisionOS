"""Who signed in, and who was here (2026-10-23, admin console v2 P1).

The admin console could not answer "who used DecisionOS this month": the
phone-code sign-in (the way most people sign in) wrote nothing anywhere, and
the only "last seen" lived in active_sessions, whose rows expire with the
token after about a week. So nothing could draw daily, weekly or monthly
active people, or tell an operator that a customer went quiet.

This module keeps three small things:
  * `last_login_at` / `last_seen_at` on the person (users) and on their
    membership of each company, so the console can say "seen 2 h ago";
  * one `presence_days` row per person per company per IST day they were
    here (`_id` "<tenant>:<user>:<day>"), never purged -- daily / weekly /
    monthly active people are counted from it;
  * a sign-in count on that day's row.

Nothing here runs on an ordinary request: a request already refreshes its
session's last_seen_at (core/deps), and the scheduler turns those sessions
into presence days and last-seen stamps every few hours
(`sync_from_sessions`). The console reads the live session time in between
(`live_last_seen`). A sign-in writes its stamps at once. Everything is
best-effort -- a failed write never fails a sign-in.
"""
from datetime import datetime, timezone
from typing import Optional

from core import logger, now_iso
from shared.due import today_ist

PRESENCE_DAYS = "presence_days"


def _parse(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _mark_day(db, user_id: str, tenant_id: str, now: str, signed_in: bool) -> None:
    day = today_ist()
    update = {
        "$setOnInsert": {"tenant_id": tenant_id, "user_id": user_id, "day": day, "first_seen_at": now},
        "$set": {"last_seen_at": now},
    }
    if signed_in:
        update["$inc"] = {"sign_ins": 1}
    await db[PRESENCE_DAYS].update_one({"_id": f"{tenant_id}:{user_id}:{day}"}, update, upsert=True)


async def note_sign_in(db, *, user_id: str, tenant_id: Optional[str], method: str) -> None:
    """A person just signed in (password, phone code, 2FA, sign-up)."""
    if not user_id or not tenant_id:
        return
    now = now_iso()
    try:
        await db.users.update_one(
            {"id": user_id},
            {"$set": {"last_login_at": now, "last_seen_at": now, "last_login_method": method}})
        await db.memberships.update_one(
            {"user_id": user_id, "tenant_id": tenant_id},
            {"$set": {"last_login_at": now, "last_seen_at": now}})
        await _mark_day(db, user_id, tenant_id, now, signed_in=True)
    except Exception as e:
        logger.warning(f"[presence] sign-in note failed for {user_id[:8]}: {e}")


async def record_sign_in(db, request, *, user: dict, tenant_id: str, role: str, token: str, method: str) -> None:
    """Everything a completed sign-in leaves behind, in one place: the audit
    row (`login_success`), the session row (so /me/sessions lists it and the
    request path can keep it fresh) and the presence stamps. The phone-code
    sign-in left none of the three until 2026-10-23."""
    from services import audit_log as _audit
    try:
        ctx = _audit.context_from(request, {**user, "tenant_id": tenant_id})
        await _audit.record(db, action="login_success", entity_type="user", entity_id=user["id"],
                            meta={"tenant_id": tenant_id, "role": role, "method": method}, **ctx)
    except Exception as e:
        ctx = {}
        logger.warning(f"[presence] audit of sign-in failed: {e}")
    try:
        import jwt as _jwt
        from core import JWT_SECRET, JWT_ALGORITHM
        from services.auth.session_tracking import record_session
        payload = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        await record_session(db, jti=payload.get("jti"), user_id=user["id"], tenant_id=tenant_id,
                             exp=payload.get("exp"), ua=ctx.get("actor_ua"), ip=ctx.get("actor_ip"))
    except Exception as e:
        logger.warning(f"[presence] session record failed: {e}")
    await note_sign_in(db, user_id=user["id"], tenant_id=tenant_id, method=method)


async def sync_from_sessions(db, since_iso: str) -> int:
    """Turn the sessions used since `since_iso` into presence days and last-
    seen stamps. Runs from the scheduler, never on a request: an authenticated
    request already refreshes its session's `last_seen_at` (core/deps), and
    adding writes to that path cost ~200 ms a round trip on the hosted
    database (tests/test_u7_24_18_desk_load_latency). Re-running over the same
    window changes nothing."""
    latest: dict = {}
    async for s in db.active_sessions.find({"last_seen_at": {"$gte": since_iso}},
                                           {"_id": 0, "user_id": 1, "tenant_id": 1, "last_seen_at": 1}):
        if not s.get("user_id") or not s.get("tenant_id"):
            continue
        key = (s["user_id"], s["tenant_id"])
        if s["last_seen_at"] > latest.get(key, ""):
            latest[key] = s["last_seen_at"]
    for (user_id, tenant_id), seen in latest.items():
        try:
            day = today_ist(_parse(seen))
            await db[PRESENCE_DAYS].update_one(
                {"_id": f"{tenant_id}:{user_id}:{day}"},
                {"$setOnInsert": {"tenant_id": tenant_id, "user_id": user_id, "day": day, "first_seen_at": seen},
                 "$max": {"last_seen_at": seen}},
                upsert=True)
            await db.memberships.update_one({"user_id": user_id, "tenant_id": tenant_id},
                                            {"$max": {"last_seen_at": seen}})
            await db.users.update_one({"id": user_id}, {"$max": {"last_seen_at": seen}})
        except Exception as e:
            logger.warning(f"[presence] session sync failed for {user_id[:8]}: {e}")
    return len(latest)


async def live_last_seen(db, tenant_ids: list) -> dict:
    """{(user, tenant): latest last_seen_at} straight from the sessions -- what
    the console shows between scheduler runs."""
    out: dict = {}
    async for s in db.active_sessions.find({"tenant_id": {"$in": list(tenant_ids)}},
                                           {"_id": 0, "user_id": 1, "tenant_id": 1, "last_seen_at": 1}):
        key = (s.get("user_id"), s.get("tenant_id"))
        if s.get("last_seen_at") and s["last_seen_at"] > out.get(key, ""):
            out[key] = s["last_seen_at"]
    return out


async def active_people(db, tenant_id: Optional[str], since_day: str, until_day: Optional[str] = None) -> int:
    """Distinct people present on [since_day, until_day] (IST days, inclusive)."""
    q = {"day": {"$gte": since_day}}
    if until_day:
        q["day"]["$lte"] = until_day
    if tenant_id:
        q["tenant_id"] = tenant_id
    return len(await db[PRESENCE_DAYS].distinct("user_id", q))

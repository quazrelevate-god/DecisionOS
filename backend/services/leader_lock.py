"""Mongo-backed distributed leader lock for single-firing scheduled work
across multiple replicas.

Introduced by FIX-002-D to close the SaaS-readiness P0: the in-process
follow-up scheduler previously ran per-uvicorn-process, so 3 replicas =
3x duplicate escalation emails and platform alerts every 300s, and 0
replicas = the sweep never runs. With this helper, every replica keeps
its scheduler ticking but only the tick that WINS the lock does the
actual work.

How it works:
  * A single doc in `scheduler_locks` collection keyed by lock name:
      { _id: "followup_sweep", holder: "<pid+uuid>",
        acquired_at: "...", expires_at: "..." }
  * try_acquire(db, name, holder_id, lease_seconds) atomically:
      - If no doc for `name`: upsert one with the caller as holder.
      - If a doc exists AND expires_at < now: take it over.
      - If a doc exists AND still valid: fail (someone else is leader).
    Returns True iff the caller is now the leader.
  * release(db, name, holder_id) is best-effort — the natural expiry
    covers the "process crashed mid-work" case. Only useful for clean
    early release (tests, planned shutdown).
  * A TTL index on expires_at means Mongo auto-cleans expired docs
    (bootstrap adds it).

Lease sizing: pick lease_seconds > worst-case sweep duration. If the
sweep normally takes 20s and the tick interval is 300s, a 600s lease
gives 30x safety margin against a stuck sweep before another replica
takes over. A crashed leader's lock expires within 1 lease and the
next tick's winner picks it up cleanly.

Why not just an in-process asyncio.Lock? Different processes don't
share it. This helper solves the cross-process case. Within one
process the semaphore is still per-loop.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo.errors import DuplicateKeyError

from core import logger


LOCK_COLLECTION = "scheduler_locks"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def make_holder_id(prefix: str = "worker") -> str:
    """Stable-per-process identifier so multiple ticks from the SAME
    process can be recognized (idempotent re-acquire) while a different
    process is treated as a foreign holder. Callers should build this
    ONCE at process startup, not per-tick."""
    return f"{prefix}:pid-{os.getpid()}:{uuid.uuid4()}"


async def try_acquire(db, lock_name: str, holder_id: str,
                      lease_seconds: int = 600) -> bool:
    """Attempt to become the leader for `lock_name` for `lease_seconds`.

    Returns True iff the caller now holds the lock. False otherwise
    (someone else is the current leader with an unexpired lease).

    Semantics:
      * Fresh acquire: no doc exists → upsert creates one, we're leader.
      * Re-acquire by same holder: doc exists with our id → refresh lease.
      * Take over expired lock: doc exists but expires_at < now → CAS.
      * Contended (someone else's live lock): fail cleanly.
    """
    now_iso = _iso(_now())
    new_expires = _iso(_now() + timedelta(seconds=lease_seconds))
    update = {"$set": {
        "holder": holder_id,
        "acquired_at": now_iso,
        "expires_at": new_expires,
        "lease_seconds": lease_seconds,
    }}

    # Case A: doc exists AND (we already hold it OR it's expired)
    # Atomic CAS: matched_count == 1 means we successfully took/refreshed.
    result = await db[LOCK_COLLECTION].update_one(
        {"_id": lock_name, "$or": [
            {"holder": holder_id},                  # re-acquire our own
            {"expires_at": {"$lt": now_iso}},       # take an expired one
        ]},
        update,
    )
    if result.matched_count >= 1:
        return True

    # Case B: no doc yet → try to insert one. If another replica beats us
    # to the punch, DuplicateKeyError is caught and we return False.
    try:
        await db[LOCK_COLLECTION].insert_one({
            "_id": lock_name,
            "holder": holder_id,
            "acquired_at": now_iso,
            "expires_at": new_expires,
            "lease_seconds": lease_seconds,
        })
        return True
    except DuplicateKeyError:
        # Race: another replica inserted between our CAS and our insert.
        return False


async def release(db, lock_name: str, holder_id: str) -> bool:
    """Release the lock IF and only IF `holder_id` still holds it.

    Best-effort — if we're not the current holder (e.g. our lease
    already expired and someone else took it), returns False and
    does not delete the doc. Never raises.

    For crashed processes, natural TTL expiry (via bootstrap index)
    handles cleanup — this helper is only for clean early release.
    """
    try:
        result = await db[LOCK_COLLECTION].delete_one({
            "_id": lock_name, "holder": holder_id,
        })
        return result.deleted_count == 1
    except Exception as e:
        logger.warning(f"leader_lock.release({lock_name}, {holder_id[:24]}...) failed: {e}")
        return False


async def is_held_by(db, lock_name: str, holder_id: str) -> bool:
    """True if this holder currently holds an unexpired lease.
    Useful for the leader to double-check before starting long work."""
    doc = await db[LOCK_COLLECTION].find_one(
        {"_id": lock_name, "holder": holder_id},
        {"_id": 0, "holder": 1, "expires_at": 1},
    )
    if not doc:
        return False
    exp = doc.get("expires_at")
    if not exp:
        return True  # legacy row w/o expiry — treat as held
    return exp > _iso(_now())


async def current_lock(db, lock_name: str) -> Optional[dict]:
    """Return the current lock doc (for admin/debug endpoints) or None
    if no lock is held. Includes a `is_expired` derived flag."""
    doc = await db[LOCK_COLLECTION].find_one({"_id": lock_name}, {"_id": 0})
    if not doc:
        return None
    exp = doc.get("expires_at")
    doc["is_expired"] = bool(exp and exp < _iso(_now()))
    return doc

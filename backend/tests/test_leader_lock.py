"""FIX-002-D tests: Mongo-backed distributed leader lock.

The bug this closes: multi-replica in-process scheduler = duplicate
work (3 replicas -> 3x escalation emails). The lock ensures exactly
one replica wins each tick.

Cases covered here:
  Basics:
    - Fresh acquire on empty collection succeeds.
    - Same holder re-acquiring refreshes the lease (idempotent).
    - Different holder while lock held -> denied.
    - Different holder after expiry -> succeeds (take over).

  Contention:
    - Two concurrent try_acquire calls: exactly ONE wins.
    - 10 concurrent tries: only ONE wins.
    - Winner + release + next caller can take it immediately.

  Robustness:
    - release() only works for the current holder.
    - is_held_by() reflects current state accurately.
    - current_lock() returns None when no lock; includes is_expired flag.
    - Duplicate-key race in the fresh-insert path returns False cleanly.

Pure unit tests — mocks the Mongo collection. Simulates atomic upsert
and update_one behavior. No live DB.
"""
import asyncio
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services import leader_lock as ll


# ---------------------------------------------------------------------------
# Fake Mongo — with enough atomicity to model contention.
#
# Uses an asyncio.Lock internally to simulate MongoDB's per-document
# atomic operations. This is faithful for update_one + insert_one on
# the SAME _id (Mongo serializes these).
# ---------------------------------------------------------------------------
class _FakeColl:
    def __init__(self):
        self.docs = []  # list of doc dicts (each has _id, holder, expires_at, ...)
        self._lock = asyncio.Lock()

    async def find_one(self, filt, projection=None):
        async with self._lock:
            for d in self.docs:
                if all(d.get(k) == v for k, v in filt.items()):
                    return dict(d)
            return None

    def find(self, filt, projection=None):
        # Snapshot-then-return synchronously; adequate for admin endpoint tests.
        async def _snapshot():
            async with self._lock:
                return [dict(d) for d in self.docs
                        if all(d.get(k) == v for k, v in filt.items())]
        class _Cursor:
            def __init__(self, coro):
                self._coro = coro
            async def to_list(self, _n):
                return await self._coro
        return _Cursor(_snapshot())

    async def update_one(self, filt, update):
        async with self._lock:
            matched = 0
            for d in self.docs:
                if not self._doc_matches(d, filt):
                    continue
                sets = update.get("$set", {})
                d.update(sets)
                matched += 1
                break  # update_one semantics
            class _R:
                matched_count = matched
                upserted_id = None
            return _R()

    def _doc_matches(self, d, filt):
        """Recursively evaluate a Mongo filter dict against a doc. Supports
        the minimal set of operators used by leader_lock: plain equality,
        $lt on strings, and $or with sub-clauses."""
        for k, v in filt.items():
            if k == "$or":
                # v is a list of sub-clauses; ANY sub-clause matching = whole $or matches
                if not any(self._doc_matches(d, cond) for cond in v):
                    return False
            elif isinstance(v, dict):
                # operator dict, e.g. {"$lt": "..."}
                for op, val in v.items():
                    if op == "$lt":
                        actual = d.get(k)
                        if actual is None or not (actual < val):
                            return False
                    else:
                        return False  # unsupported operator = no match
            else:
                # plain equality
                if d.get(k) != v:
                    return False
        return True

    async def insert_one(self, doc):
        async with self._lock:
            _id = doc.get("_id")
            if _id is not None:
                for existing in self.docs:
                    if existing.get("_id") == _id:
                        # Simulate Mongo's DuplicateKeyError on unique _id
                        from pymongo.errors import DuplicateKeyError
                        raise DuplicateKeyError(f"E11000 duplicate key: _id={_id}")
            self.docs.append(dict(doc))

    async def delete_one(self, filt):
        async with self._lock:
            for i, d in enumerate(self.docs):
                if all(d.get(k) == v for k, v in filt.items()):
                    self.docs.pop(i)
                    class _R:
                        deleted_count = 1
                    return _R()
            class _R:
                deleted_count = 0
            return _R()

    async def count_documents(self, filt):
        async with self._lock:
            return sum(1 for d in self.docs
                       if all(d.get(k) == v for k, v in filt.items()))


class _FakeDB:
    def __init__(self):
        self._colls = {}
    def __getitem__(self, name):
        return self._colls.setdefault(name, _FakeColl())
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


# ---------------------------------------------------------------------------
# Basic contract
# ---------------------------------------------------------------------------
class TestBasics:
    def test_fresh_acquire_succeeds(self):
        db = _FakeDB()
        got = asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60))
        assert got is True
        # Lock doc exists
        lock = asyncio.run(ll.current_lock(db, "sweep"))
        assert lock["holder"] == "worker-A"
        assert lock["is_expired"] is False

    def test_reacquire_by_same_holder_refreshes(self):
        """A tick that runs while its previous tick's lock is still valid
        must refresh, not deadlock. Same holder = idempotent."""
        db = _FakeDB()
        asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60))
        first = asyncio.run(ll.current_lock(db, "sweep"))
        # Small sleep to guarantee a different acquired_at timestamp
        asyncio.run(asyncio.sleep(0.01))
        got_again = asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60))
        assert got_again is True
        second = asyncio.run(ll.current_lock(db, "sweep"))
        assert second["holder"] == "worker-A"
        # Refreshed: expires_at moved forward (or stayed >= first)
        assert second["expires_at"] >= first["expires_at"]

    def test_different_holder_denied_while_lock_valid(self):
        db = _FakeDB()
        assert asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60)) is True
        got_b = asyncio.run(ll.try_acquire(db, "sweep", "worker-B", lease_seconds=60))
        assert got_b is False
        # A still holds it
        lock = asyncio.run(ll.current_lock(db, "sweep"))
        assert lock["holder"] == "worker-A"

    def test_different_holder_succeeds_after_expiry(self):
        """The whole point: a crashed leader's lock naturally expires
        and the next tick's caller from a different replica takes over."""
        db = _FakeDB()
        # A grabs it with a lease already in the past (simulates expired)
        past = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        db["scheduler_locks"].docs.append({
            "_id": "sweep", "holder": "worker-A",
            "acquired_at": past, "expires_at": past,
        })
        # B tries and should succeed (takes over the expired lock)
        got = asyncio.run(ll.try_acquire(db, "sweep", "worker-B", lease_seconds=60))
        assert got is True
        lock = asyncio.run(ll.current_lock(db, "sweep"))
        assert lock["holder"] == "worker-B"
        assert lock["is_expired"] is False


# ---------------------------------------------------------------------------
# Contention — the crown-jewel tests
# ---------------------------------------------------------------------------
class TestContention:
    def test_two_concurrent_acquires_exactly_one_wins(self):
        """Simulate two replicas racing on a fresh lock. Exactly ONE
        must win. If both won -> the whole fix is a lie."""
        db = _FakeDB()
        async def race():
            r1, r2 = await asyncio.gather(
                ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60),
                ll.try_acquire(db, "sweep", "worker-B", lease_seconds=60),
            )
            return r1, r2
        r1, r2 = asyncio.run(race())
        winners = sum(1 for r in (r1, r2) if r)
        assert winners == 1, f"expected exactly 1 winner, got {winners} (r1={r1}, r2={r2})"

    def test_10_concurrent_acquires_only_one_wins(self):
        db = _FakeDB()
        async def race():
            return await asyncio.gather(
                *[ll.try_acquire(db, "sweep", f"worker-{i}", lease_seconds=60)
                  for i in range(10)]
            )
        results = asyncio.run(race())
        winners = sum(1 for r in results if r)
        assert winners == 1, f"expected exactly 1 winner out of 10, got {winners}"

    def test_release_then_next_caller_wins(self):
        db = _FakeDB()
        asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60))
        released = asyncio.run(ll.release(db, "sweep", "worker-A"))
        assert released is True
        # Now B can grab it cleanly
        got = asyncio.run(ll.try_acquire(db, "sweep", "worker-B", lease_seconds=60))
        assert got is True


# ---------------------------------------------------------------------------
# release() semantics
# ---------------------------------------------------------------------------
class TestRelease:
    def test_release_by_current_holder_deletes(self):
        db = _FakeDB()
        asyncio.run(ll.try_acquire(db, "sweep", "worker-A"))
        assert asyncio.run(ll.release(db, "sweep", "worker-A")) is True
        assert asyncio.run(ll.current_lock(db, "sweep")) is None

    def test_release_by_wrong_holder_no_op(self):
        """A stale process that lost its lease can't unlock the new holder."""
        db = _FakeDB()
        asyncio.run(ll.try_acquire(db, "sweep", "worker-A"))
        # B tries to release even though A holds it
        result = asyncio.run(ll.release(db, "sweep", "worker-B"))
        assert result is False
        # A still holds it
        lock = asyncio.run(ll.current_lock(db, "sweep"))
        assert lock["holder"] == "worker-A"

    def test_release_of_nonexistent_lock_no_op(self):
        db = _FakeDB()
        assert asyncio.run(ll.release(db, "never-existed", "worker-A")) is False


# ---------------------------------------------------------------------------
# Observability helpers
# ---------------------------------------------------------------------------
class TestObservability:
    def test_is_held_by_true_when_held(self):
        db = _FakeDB()
        asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60))
        assert asyncio.run(ll.is_held_by(db, "sweep", "worker-A")) is True

    def test_is_held_by_false_for_different_holder(self):
        db = _FakeDB()
        asyncio.run(ll.try_acquire(db, "sweep", "worker-A", lease_seconds=60))
        assert asyncio.run(ll.is_held_by(db, "sweep", "worker-B")) is False

    def test_is_held_by_false_after_expiry(self):
        db = _FakeDB()
        past = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        db["scheduler_locks"].docs.append({
            "_id": "sweep", "holder": "worker-A", "acquired_at": past, "expires_at": past,
        })
        assert asyncio.run(ll.is_held_by(db, "sweep", "worker-A")) is False

    def test_current_lock_none_when_absent(self):
        db = _FakeDB()
        assert asyncio.run(ll.current_lock(db, "nothing")) is None

    def test_current_lock_marks_expired(self):
        db = _FakeDB()
        past = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        db["scheduler_locks"].docs.append({
            "_id": "sweep", "holder": "worker-A", "acquired_at": past, "expires_at": past,
        })
        lock = asyncio.run(ll.current_lock(db, "sweep"))
        assert lock is not None
        assert lock["is_expired"] is True


class TestHolderId:
    def test_make_holder_id_unique_across_calls(self):
        """Each call produces a distinct id — otherwise a redeploy that
        reuses a process id might re-acquire someone else's lock."""
        ids = [ll.make_holder_id("test") for _ in range(20)]
        assert len(set(ids)) == 20

    def test_make_holder_id_carries_prefix(self):
        h = ll.make_holder_id("followup-scheduler")
        assert h.startswith("followup-scheduler:")

    def test_make_holder_id_includes_pid(self):
        import os
        h = ll.make_holder_id("worker")
        assert f"pid-{os.getpid()}" in h


# ---------------------------------------------------------------------------
# End-to-end scenario: simulate 3 replicas ticking against the same DB.
# Verify exactly one wins each tick and the other two skip.
# ---------------------------------------------------------------------------
class TestMultiReplicaScenario:
    def test_three_replicas_ticking_only_one_runs_per_tick(self):
        db = _FakeDB()
        winners_by_tick = []
        holders = ["replica-A", "replica-B", "replica-C"]

        async def tick():
            # All three try simultaneously; one wins, releases, next tick
            # runs again.
            for _tick in range(5):
                results = await asyncio.gather(
                    *[ll.try_acquire(db, "sweep", h, lease_seconds=60) for h in holders]
                )
                winners_this_tick = [h for h, r in zip(holders, results) if r]
                assert len(winners_this_tick) == 1, (
                    f"tick {_tick}: expected 1 winner, got {winners_this_tick}"
                )
                winners_by_tick.append(winners_this_tick[0])
                # Winner releases so next tick starts clean
                await ll.release(db, "sweep", winners_this_tick[0])

        asyncio.run(tick())
        # Over 5 ticks, we got exactly 5 winners.
        assert len(winners_by_tick) == 5

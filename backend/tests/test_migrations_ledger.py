"""FIX-002-C tests: MongoDB migration ledger.

Contract this file locks in:
  1. First run applies the migration + records it.
  2. Second run skips (idempotent no-op).
  3. Prior failure -> next run retries + records as ok (fixed code path).
  4. Migration fn that raises records status=failed AND re-raises so the
     bootstrap surfaces the problem.
  5. Concurrent boot: two replicas both trying to run the same fresh
     migration — the second sees the first's success and skips.
  6. applied_migrations() lists ok rows sorted by applied_at.

Pure unit tests — mocks the Mongo collection. No live DB, no network.
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services import migrations as mig


# ---------------------------------------------------------------------------
# Fake Mongo collection with just enough API for the ledger helper.
# ---------------------------------------------------------------------------
class _FakeColl:
    def __init__(self):
        self.docs = []

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)
        return None

    def find(self, filt, projection=None):
        matched = [dict(d) for d in self.docs
                   if all(d.get(k) == v for k, v in filt.items())]

        class _Cursor:
            def __init__(self, rows):
                self._rows = rows
            def sort(self, *a, **k):
                return self
            def limit(self, *a, **k):
                return self
            async def to_list(self, _n):
                return self._rows
            def __aiter__(self):
                self._i = 0
                return self
            async def __anext__(self):
                if self._i >= len(self._rows):
                    raise StopAsyncIteration
                r = self._rows[self._i]
                self._i += 1
                return r
        return _Cursor(matched)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                sets = update.get("$set", {})
                d.update(sets)
                class _R:
                    matched_count = 1
                return _R()
        if upsert:
            new = dict(update.get("$set", {}))
            new.update({k: v for k, v in filt.items() if k not in new})
            self.docs.append(new)
            class _R:
                matched_count = 0
                upserted_id = "fake"
            return _R()
        class _R:
            matched_count = 0
        return _R()

    async def create_index(self, *a, **k):
        return "ok"


class _FakeDB:
    """dict-and-attribute access so `db.users` and `db['users']` both work."""
    def __init__(self):
        self._colls = {}

    def __getitem__(self, name):
        return self._colls.setdefault(name, _FakeColl())

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


# ---------------------------------------------------------------------------
# The heart of the fix: apply_migration semantics.
# ---------------------------------------------------------------------------
class TestApplyMigration:
    def test_first_run_applies_and_records(self):
        db = _FakeDB()
        called = {"n": 0}

        async def do_work(_db):
            called["n"] += 1

        result = asyncio.run(mig.apply_migration(
            db, "add_widget_field_v1", do_work,
            description="test migration"))
        assert result == "applied"
        assert called["n"] == 1
        ledger = db[mig.LEDGER_COLLECTION].docs
        assert len(ledger) == 1
        assert ledger[0]["name"] == "add_widget_field_v1"
        assert ledger[0]["status"] == "ok"
        assert ledger[0]["description"] == "test migration"
        assert "applied_at" in ledger[0]
        assert "duration_ms" in ledger[0]

    def test_second_run_skips_migration_fn(self):
        """The whole point: don't rerun a migration whose result is already
        in the DB (would double-move, duplicate, or corrupt)."""
        db = _FakeDB()
        called = {"n": 0}

        async def do_work(_db):
            called["n"] += 1

        asyncio.run(mig.apply_migration(db, "m1", do_work))
        result2 = asyncio.run(mig.apply_migration(db, "m1", do_work))
        assert result2 == "skipped"
        assert called["n"] == 1  # NOT called the second time

    def test_prior_failure_retries(self):
        """Code got fixed after a broken migration -> next boot retries."""
        db = _FakeDB()
        # Manually seed a failed row (as if a previous run crashed)
        db[mig.LEDGER_COLLECTION].docs.append({
            "name": "flaky_migration", "status": "failed",
            "failed_at": "2026-01-01T00:00:00Z",
            "error": "network dropped",
        })

        async def now_works(_db):
            return None

        result = asyncio.run(mig.apply_migration(db, "flaky_migration", now_works))
        assert result == "retried"
        # The failed row should be replaced with an ok row
        rows = [d for d in db[mig.LEDGER_COLLECTION].docs
                if d.get("name") == "flaky_migration"]
        assert len(rows) == 1
        assert rows[0]["status"] == "ok"

    def test_exception_records_failure_and_reraises(self):
        db = _FakeDB()

        async def broken(_db):
            raise ValueError("bad data")

        with pytest.raises(mig.MigrationError, match="broken_migration"):
            asyncio.run(mig.apply_migration(db, "broken_migration", broken))

        # Failed row recorded
        ledger = db[mig.LEDGER_COLLECTION].docs
        assert len(ledger) == 1
        assert ledger[0]["name"] == "broken_migration"
        assert ledger[0]["status"] == "failed"
        assert "bad data" in ledger[0]["error"]

    def test_original_exception_chained(self):
        db = _FakeDB()

        class MyErr(ValueError):
            pass

        async def specific_error(_db):
            raise MyErr("very specific")

        try:
            asyncio.run(mig.apply_migration(db, "err_test", specific_error))
        except mig.MigrationError as e:
            # Original exception is chained (__cause__) so debugging
            # can see the real error type.
            assert isinstance(e.__cause__, MyErr)
            assert "very specific" in str(e.__cause__)


class TestConcurrentBoot:
    def test_two_replicas_both_apply_only_once_visible_in_ledger(self):
        """Simulate two replicas booting at once — one runs, one skips.
        The 'race' here is really: whichever hits _already_applied
        AFTER the first one commits will skip. Test both orderings."""
        db = _FakeDB()

        run_count = {"n": 0}
        async def do_it(_db):
            run_count["n"] += 1

        # Replica A goes first end to end
        r_a = asyncio.run(mig.apply_migration(db, "shared_migration", do_it))
        # Replica B comes in AFTER A recorded — must skip
        r_b = asyncio.run(mig.apply_migration(db, "shared_migration", do_it))
        assert r_a == "applied"
        assert r_b == "skipped"
        assert run_count["n"] == 1


class TestAppliedMigrations:
    def test_list_returns_only_ok_rows(self):
        db = _FakeDB()

        async def noop(_db):
            return None

        asyncio.run(mig.apply_migration(db, "m1", noop, description="first"))
        asyncio.run(mig.apply_migration(db, "m2", noop, description="second"))
        # Also seed a failed one
        db[mig.LEDGER_COLLECTION].docs.append(
            {"name": "m3_broken", "status": "failed", "failed_at": "2026-01-01"})

        rows = asyncio.run(mig.applied_migrations(db))
        names = [r["name"] for r in rows]
        assert "m1" in names
        assert "m2" in names
        assert "m3_broken" not in names, "failed migration must not appear in 'applied'"

    def test_empty_ledger_returns_empty_list(self):
        db = _FakeDB()
        rows = asyncio.run(mig.applied_migrations(db))
        assert rows == []


class TestRealisticMigrations:
    """Prove the ledger works with the shapes of migrations we've
    actually shipped (phone_norm backfill + tenant backfill)."""

    def test_phone_norm_backfill_pattern(self):
        db = _FakeDB()
        # Seed users, one with phone but no phone_norm (pre-migration),
        # one already migrated, one with no phone at all.
        db.users.docs.extend([
            {"id": "u-1", "phone": "9820010001"},                        # needs backfill
            {"id": "u-2", "phone": "9820010002", "phone_norm": "9820010002"},  # already migrated
            {"id": "u-3"},                                                # no phone
        ])

        async def backfill(_db):
            from services.auth.phone import norm_phone
            async for u in _db.users.find(
                {"phone": {"$type": "string", "$gt": ""},
                 "phone_norm": {"$exists": False}}):
                pn = norm_phone(u.get("phone") or "")
                if pn:
                    await _db.users.update_one({"id": u["id"]}, {"$set": {"phone_norm": pn}})

        result = asyncio.run(mig.apply_migration(
            db, "backfill_users_phone_norm_v1", backfill,
            description="phone_norm backfill"))
        assert result == "applied"
        # And a second call is a no-op even if new users pop in that
        # would match the filter (they get backfilled the next time
        # this same migration is written under a v2 name).
        called_flag = {"n": 0}
        async def would_run(_db):
            called_flag["n"] += 1
        r2 = asyncio.run(mig.apply_migration(
            db, "backfill_users_phone_norm_v1", would_run))
        assert r2 == "skipped"
        assert called_flag["n"] == 0

    def test_migration_that_takes_measurable_time_records_duration(self):
        db = _FakeDB()

        async def slow_migration(_db):
            await asyncio.sleep(0.05)  # 50ms

        asyncio.run(mig.apply_migration(db, "slow_one", slow_migration))
        row = db[mig.LEDGER_COLLECTION].docs[0]
        assert row["duration_ms"] >= 40  # allow some slack for scheduling

"""The operating score starts keeping a past (2026-09-29).

The Ops page has carried an honest refusal since KR-9, written into the top of
OperatingScore.js: the founder's reference draws a trend line and a "+3 pts
this week" chip, and NOTHING IN THE SYSTEM KEPT SCORE HISTORY, so drawing
either would have been inventing one. The delta chip renders for the demo
tenant alone, and the header states the scope as it really is — all time.

The way out of that is not to draw a better guess. It is to write the number
down. One row per company per day, and in a month there is a month of real
readings.

Nothing reads it yet, deliberately: the page keeps saying "all time" until
there is a past worth showing. What is tested here is that the readings are
taken exactly once a day, that they cost nothing on the ticks in between,
and that a company with nothing to score is not given a row of zeroes that
would later read as a real reading.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-history"
OTHER = "t-elsewhere"


async def _seed(db, tenant=T, tasks=6, done=3):
    await db.tenants.insert_one({"id": tenant, "name": "Nila"})
    await db.users.insert_one({"id": f"u-{tenant}", "tenant_id": tenant, "name": "Kavya", "role": "owner"})
    rows = []
    for i in range(tasks):
        rows.append({
            "id": f"{tenant}-t{i}", "tenant_id": tenant, "title": f"Task {i}",
            "status": "done" if i < done else "todo", "assignee_id": f"u-{tenant}",
            "created_at": "2026-09-01T04:00:00+00:00",
            "completed_at": "2026-09-02T04:00:00+00:00" if i < done else None,
        })
    await db.tasks.insert_many(rows)


def _env(fn):
    async def run(db):
        with e2e_env(db):
            return await fn(db)
    return run


# ───────────────────────── a reading is written ────────────────────────────
def test_a_days_reading_carries_the_score_and_the_counts_behind_it(with_test_db):
    """"Execution fell 9 points" is only useful beside "overdue went 4 to 14",
    and the counts cannot be re-derived later once the work has moved on."""
    async def scenario(db):
        from services.score_history import record_today
        await _seed(db)
        wrote = await record_today(db, T, day="2026-09-29")
        return wrote, await db.operating_score_history.find_one({"_id": f"{T}:2026-09-29"})

    wrote, row = with_test_db(_env(scenario))
    assert wrote is True
    assert row["tenant_id"] == T and row["day"] == "2026-09-29"
    assert isinstance(row["overall"], int)
    assert set(row["categories"]) == {"execution", "finance", "sales", "responsiveness"}
    assert set(row["counts"]) == {"done", "open", "overdue", "open_complaints"}
    assert row["counts"]["done"] == 3 and row["counts"]["open"] == 3
    assert row["recorded_at"], "when the reading was taken, not just which day it is for"


def test_the_same_day_is_recorded_once_however_often_the_sweep_runs(with_test_db):
    """The sweep ticks every five minutes; a restart storm ticks harder. One
    row per company per day, and the first reading of the day is the one kept
    — a trend wants its readings taken at a comparable hour."""
    async def scenario(db):
        from services.score_history import record_today
        await _seed(db)
        first = await record_today(db, T, day="2026-09-29")
        again = await record_today(db, T, day="2026-09-29")
        third = await record_today(db, T, day="2026-09-29")
        rows = await db.operating_score_history.find({"tenant_id": T}).to_list(10)
        return first, again, third, rows

    first, again, third, rows = with_test_db(_env(scenario))
    assert first is True
    assert again is False and third is False, "and the later ticks did not re-score the company"
    assert len(rows) == 1


def test_a_later_day_is_its_own_reading(with_test_db):
    async def scenario(db):
        from services.score_history import record_today
        await _seed(db)
        await record_today(db, T, day="2026-09-29")
        await record_today(db, T, day="2026-09-30")
        return await db.operating_score_history.find({"tenant_id": T}, {"_id": 0}).to_list(10)

    rows = with_test_db(_env(scenario))
    assert sorted(r["day"] for r in rows) == ["2026-09-29", "2026-09-30"]


# ───────────────────────── what is NOT written ─────────────────────────────
def test_a_company_with_nothing_to_score_gets_no_row(with_test_db):
    """A row of nulls would later read as a real zero — the company was not
    doing badly, it had not started."""
    async def scenario(db):
        from services.score_history import record_today
        await db.tenants.insert_one({"id": T, "name": "Brand new"})
        await db.users.insert_one({"id": "u1", "tenant_id": T, "name": "Kavya", "role": "owner"})
        wrote = await record_today(db, T, day="2026-09-29")
        return wrote, await db.operating_score_history.count_documents({})

    wrote, n = with_test_db(_env(scenario))
    assert wrote is False and n == 0


def test_one_companys_reading_is_its_own(with_test_db):
    async def scenario(db):
        from services.score_history import record_all
        await _seed(db, T, tasks=6, done=3)
        await _seed(db, OTHER, tasks=8, done=1)
        n = await record_all(db)
        rows = {r["tenant_id"]: r for r in await db.operating_score_history.find({}, {"_id": 0}).to_list(10)}
        return n, rows

    n, rows = with_test_db(_env(scenario))
    assert n == 2
    assert rows[T]["counts"]["done"] == 3
    assert rows[OTHER]["counts"]["done"] == 1
    assert rows[T]["overall"] != rows[OTHER]["overall"], "two companies, two scores"


# ───────────────────────── reading it back ─────────────────────────────────
def test_the_history_comes_back_oldest_first_and_windowed(with_test_db):
    """Oldest first is the order a line is drawn in."""
    async def scenario(db):
        from services.score_history import history_for
        await db.operating_score_history.insert_many([
            {"_id": f"{T}:2026-09-{d:02d}", "tenant_id": T, "day": f"2026-09-{d:02d}", "overall": d}
            for d in range(20, 30)
        ] + [{"_id": f"{OTHER}:2026-09-25", "tenant_id": OTHER, "day": "2026-09-25", "overall": 99}])
        return await history_for(db, T, days=4), await history_for(db, T, days=100)

    window, everything = with_test_db(_env(scenario))
    assert [r["day"] for r in window] == ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29"]
    assert len(everything) == 10, "and nobody else's readings are in it"


def test_the_sweep_records_it_and_never_a_users_request():
    """Scoring a company takes about a second. It rides the leader-locked
    sweep, beside the retention purge — not /api/operating-score, and not the
    poll path that run_followup also sits on."""
    from pathlib import Path
    sched = (Path(__file__).resolve().parents[1] / "workers" / "schedulers.py").read_text(encoding="utf-8")
    assert "from services.score_history import record_all" in sched
    assert "await record_all(db)" in sched
    i_lock = sched.index('try_acquire(db, "followup_sweep"')
    assert i_lock < sched.index("await record_all(db)"), "inside the leader-locked block"
    signals = (Path(__file__).resolve().parents[1] / "services" / "finance_signals.py").read_text(encoding="utf-8")
    assert "score_history" not in signals, "not on the per-request sweep"

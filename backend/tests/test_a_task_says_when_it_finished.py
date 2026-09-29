"""A task records WHEN it finished (2026-09-29).

Yokesh, after the Ops walk: "we can see individual person efficiency also
right". The page could say how MUCH each person had — done, open, overdue —
and nothing about how long any of it took. Two people both showing "5 done"
read identically whether one closes in two days or nine, and somebody who
finishes everything a week late looked perfect, because `overdue` only ever
counted work still OPEN.

Every one of those questions needs a field the task never carried. It had
`created_at` and `updated_at`, and `updated_at` moves on any edit — a task
done on Monday and renamed on Friday looked like five days of work.

Three things here: the stamp is written at the moment work crosses into done
(and withdrawn if it is reopened); the history already on disk is recovered
from the Journal rather than guessed, because a `task_done` event has been
written on every completion all along; and what the two numbers mean.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-timing"


# ───────────────────────── the stamp itself ────────────────────────────────
def test_crossing_into_done_writes_the_time():
    from services.tasks import completion_stamp
    assert completion_stamp({"status": "in_progress"}, {"status": "done"}, "NOW") == {"completed_at": "NOW"}


def test_an_ordinary_edit_leaves_it_alone():
    """Renaming a finished task must not re-date it — that was the whole
    reason `updated_at` could not be used."""
    from services.tasks import completion_stamp
    assert completion_stamp({"status": "done"}, {"title": "Renamed"}, "LATER") == {}
    assert completion_stamp({"status": "done"}, {"status": "done"}, "LATER") == {}, \
        "and re-saving done is not re-finishing"


def test_reopening_takes_the_time_back_off():
    """A task pulled back into work is not finished work, and must not be
    counted as a fast close. It is stamped afresh when it closes for real."""
    from services.tasks import completion_stamp
    assert completion_stamp({"status": "done"}, {"status": "in_progress"}, "LATER") == {"completed_at": None}


def test_cancelled_is_not_finished():
    from services.tasks import completion_stamp
    assert completion_stamp({"status": "todo"}, {"status": "cancelled"}, "NOW") == {}


# ───────────────────────── written where it is closed ──────────────────────
def _seed_one(db, status="in_progress"):
    return [
        db.tenants.insert_one({"id": T, "name": "Nila"}),
        db.users.insert_one({"id": "u1", "tenant_id": T, "name": "Priya", "role": "sales"}),
        db.tasks.insert_one({
            "id": "t1", "tenant_id": T, "title": "Buy pique fabric", "status": status,
            "assignee_id": "u1", "created_by": "u1", "created_at": "2026-09-21T04:00:00+00:00"}),
    ]


USER = {"id": "u1", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": []}


def test_marking_a_task_done_through_the_api_stamps_it(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        with e2e_env(db):
            for c in _seed_one(db):
                await c
            await rt.update_task("t1", TaskUpdateInput(status="done"), user=USER)
            return await db.tasks.find_one({"id": "t1"}, {"_id": 0})

    row = with_test_db(scenario)
    assert row["status"] == "done"
    assert row.get("completed_at"), "the moment it finished is on the task"
    assert row["completed_at"] >= row["created_at"]


def test_reopening_it_through_the_api_clears_the_stamp(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        with e2e_env(db):
            for c in _seed_one(db):
                await c
            await rt.update_task("t1", TaskUpdateInput(status="done"), user=USER)
            await rt.update_task("t1", TaskUpdateInput(status="in_progress"), user=USER)
            return await db.tasks.find_one({"id": "t1"}, {"_id": 0})

    assert with_test_db(scenario)["completed_at"] is None


# ───────────────────────── recovering what is already closed ───────────────
def test_the_backfill_dates_old_work_from_the_journal(with_test_db):
    """The Journal has written a `task_done` event on every completion all
    along, so this is recovery, not invention."""
    async def scenario(db):
        from services.task_timing import backfill_completed_at
        await db.tasks.insert_many([
            {"id": "t1", "tenant_id": T, "status": "done", "created_at": "2026-09-01T04:00:00+00:00",
             "updated_at": "2026-09-20T04:00:00+00:00"},          # renamed long after it closed
            {"id": "t2", "tenant_id": T, "status": "done", "created_at": "2026-09-02T04:00:00+00:00",
             "updated_at": "2026-09-03T04:00:00+00:00"},          # no event on record
            {"id": "t3", "tenant_id": T, "status": "todo", "created_at": "2026-09-02T04:00:00+00:00"},
        ])
        await db.activity.insert_many([
            {"id": "a1", "tenant_id": T, "kind": "task_done", "entity_id": "t1",
             "created_at": "2026-09-04T04:00:00+00:00"},
            # closed, reopened, closed again: the FIRST landing is the honest date
            {"id": "a2", "tenant_id": T, "kind": "task_done", "entity_id": "t1",
             "created_at": "2026-09-09T04:00:00+00:00"},
        ])
        await backfill_completed_at(db)
        return {r["id"]: r for r in await db.tasks.find({}, {"_id": 0}).to_list(10)}

    rows = with_test_db(scenario)
    assert rows["t1"]["completed_at"] == "2026-09-04T04:00:00+00:00", "from the journal, not updated_at"
    assert not rows["t1"].get("completed_at_inferred")
    assert rows["t2"]["completed_at"] == "2026-09-03T04:00:00+00:00", "no event: updated_at is the closest thing"
    assert rows["t2"]["completed_at_inferred"] is True, "and it says so, so nothing reads a guess as a measurement"
    assert "completed_at" not in rows["t3"], "open work is not finished work"


def test_the_backfill_can_be_run_twice(with_test_db):
    """A failed migration is retried, so it must not re-date what it already
    dated — and must not overwrite a real stamp with a guess."""
    async def scenario(db):
        from services.task_timing import backfill_completed_at
        await db.tasks.insert_one({"id": "t1", "tenant_id": T, "status": "done",
                                   "created_at": "2026-09-01T04:00:00+00:00",
                                   "updated_at": "2026-09-20T04:00:00+00:00"})
        await db.activity.insert_one({"id": "a1", "tenant_id": T, "kind": "task_done",
                                      "entity_id": "t1", "created_at": "2026-09-04T04:00:00+00:00"})
        await backfill_completed_at(db)
        await db.tasks.update_one({"id": "t1"}, {"$set": {"updated_at": "2026-09-30T04:00:00+00:00"}})
        await backfill_completed_at(db)
        return await db.tasks.find_one({"id": "t1"}, {"_id": 0})

    assert with_test_db(scenario)["completed_at"] == "2026-09-04T04:00:00+00:00"


# ───────────────────────── what the two numbers mean ───────────────────────
def _t(created, completed=None, due=None, status="done"):
    return {"status": status, "created_at": created, "completed_at": completed, "due_date": due}


def test_typical_days_is_the_median_not_the_average():
    """One task left open over a festival week would drag an average into
    nonsense and make a steady person look slow."""
    from services.task_timing import timing_of
    rows = [_t("2026-09-01", "2026-09-02"), _t("2026-09-01", "2026-09-02"),
            _t("2026-09-01", "2026-09-02"), _t("2026-09-01", "2026-11-01")]
    assert timing_of(rows, now="2026-11-02")["typical_days"] == 1


def test_sunday_is_not_counted_against_anybody():
    """Friday to Monday is two working days — the calendar the stage
    deadlines and the stuck alerts already count in."""
    from services.task_timing import timing_of
    # 2026-09-25 is a Friday; 2026-09-28 the Monday after.
    assert timing_of([_t("2026-09-25", "2026-09-28")], now="2026-09-29")["typical_days"] == 2


def test_on_time_counts_only_the_work_that_had_a_date():
    """A task nobody dated cannot be late. Counting it either way would be a
    verdict the data does not support."""
    from services.task_timing import timing_of
    rows = [
        _t("2026-09-01", "2026-09-03", due="2026-09-04"),   # early
        _t("2026-09-01", "2026-09-04", due="2026-09-04"),   # on the day itself
        _t("2026-09-01", "2026-09-08", due="2026-09-04"),   # late
        _t("2026-09-01", "2026-09-08"),                     # never dated
    ]
    out = timing_of(rows, now="2026-09-29")
    assert out["dated"] == 3 and out["closed"] == 4
    assert out["on_time_rate"] == 67


def test_nothing_to_measure_says_nothing():
    """None, never a flattering zero or a free 100."""
    from services.task_timing import timing_of
    out = timing_of([_t("2026-09-01", None, status="todo")], now="2026-09-29")
    assert out["typical_days"] is None and out["on_time_rate"] is None
    assert out["closed"] == 0 and out["dated"] == 0
    assert timing_of([], now="2026-09-29")["waiting_days"] is None


def test_the_oldest_open_thing_is_reported_because_a_rate_cannot_show_it():
    from services.task_timing import timing_of
    rows = [_t("2026-09-01", None, status="todo"), _t("2026-09-25", None, status="in_progress"),
            _t("2026-09-01", "2026-09-02")]
    # 2026-09-01 -> 2026-09-29: 28 days, minus four Sundays.
    assert timing_of(rows, now="2026-09-29")["waiting_days"] == 24

"""A due date can be moved (B2, 2026-09-21).

From the workflow/task audit: `TaskUpdateInput` had no due_date and no other
route set one, so a date given when a task was created was PERMANENT. The only
way to move a deadline was to delete the task and type it again, losing its
checklist, its notes, its proof and its whole timeline with it — and it is the
most ordinary act there is in running a company's work.

Moving a deadline belongs to the same people as changing the priority: a due
date is a promise made to somebody else, so whoever asked for the work, their
manager or the owner moves it. A doer who needs longer says so on the task.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-ops"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
ASKER = {"id": "u-asker", "tenant_id": TENANT, "role": "sales", "name": "Meena", "permissions": ["tasks"]}
DOER = {"id": "u-doer", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}
MANAGER = {"id": "u-mgr", "tenant_id": TENANT, "role": "sales", "name": "Suresh", "permissions": ["tasks"]}


def _seed(due="2026-10-02"):
    return {
        "id": "task1", "tenant_id": TENANT, "title": "Send the quote",
        "status": "todo", "priority": "medium", "progress": 0,
        "assignee_id": DOER["id"], "assignee_role": "sales", "co_assignee_ids": [],
        "created_by": ASKER["id"], "due_date": due,
        "created_at": "2026-09-01T09:00:00+00:00", "updated_at": "2026-09-01T09:00:00+00:00",
    }


async def _people(db):
    await db.users.insert_many([
        {"id": OWNER["id"], "tenant_id": TENANT, "name": "Rajesh", "role": "owner"},
        {"id": ASKER["id"], "tenant_id": TENANT, "name": "Meena", "role": "sales"},
        {"id": MANAGER["id"], "tenant_id": TENANT, "name": "Suresh", "role": "sales"},
        {"id": DOER["id"], "tenant_id": TENANT, "name": "Priya", "role": "sales",
         "reporting_manager_id": MANAGER["id"]},
    ])


async def _roles(tenant_id, *a, **k):
    return ["owner", "sales", "finance", "production"]


def _env(testdb):
    return e2e_env(testdb, stubs={"routers.tasks.tenant_role_keys": _roles})


def _patch(**kw):
    from models.tasks import TaskUpdateInput
    return TaskUpdateInput(**kw)


def _run(with_test_db, user, body, due="2026-10-02", task=None):
    """Seed one task, PATCH it, hand back (stored row, timeline lines)."""
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            await db.tasks.insert_one(task or _seed(due))
            try:
                await rt.update_task("task1", _patch(**body), user=user)
                refused = None
            except HTTPException as e:
                refused = (e.status_code, e.detail)
            row = await db.tasks.find_one({"id": "task1"}, {"_id": 0})
            trail = await db.activity.find(
                {"entity_id": "task1"}, {"_id": 0, "kind": 1, "detail": 1}).to_list(20)
            return row, trail, refused

    return with_test_db(scenario)


# ---------------------------------------------------------------------------
def test_a_due_date_can_be_moved(with_test_db):
    row, trail, refused = _run(with_test_db, OWNER, {"due_date": "2026-10-15"})
    assert refused is None
    assert row["due_date"] == "2026-10-15"
    moved = [e for e in trail if e["kind"] == "task_due"]
    assert len(moved) == 1, "a moved deadline is a fact about the work, not a silent edit"
    assert "2026-10-02" in moved[0]["detail"] and "2026-10-15" in moved[0]["detail"], \
        "and the line says what it moved FROM as well as to"


def test_a_date_can_be_given_to_a_task_that_never_had_one(with_test_db):
    row, trail, refused = _run(with_test_db, OWNER, {"due_date": "2026-10-15"}, due=None)
    assert refused is None and row["due_date"] == "2026-10-15"
    assert [e["detail"] for e in trail if e["kind"] == "task_due"] == ["Due 2026-10-15"]


def test_a_due_date_can_no_longer_be_taken_off(with_test_db):
    """B2 let an empty string remove a date. PILOT-1 C (2026-09-21) closed
    that: every task a person makes has a deadline, and a dateless task is
    invisible to Due today, Overdue and the score — so a date is moved, never
    taken off. (tests/test_pilot1_due_dates.py holds the rest of that rule.)"""
    row, _, refused = _run(with_test_db, OWNER, {"due_date": ""})
    assert refused and refused[0] == 400 and row["due_date"] == "2026-10-02"


def test_not_sending_the_field_leaves_the_date_where_it_was(with_test_db):
    row, trail, refused = _run(with_test_db, OWNER, {"priority": "high"})
    assert refused is None
    assert row["due_date"] == "2026-10-02" and row["priority"] == "high"
    assert not [e for e in trail if e["kind"] == "task_due"]


def test_an_explicit_null_is_not_read_as_a_clear(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_date": None})
    assert refused is None and row["due_date"] == "2026-10-02"


def test_the_hour_can_be_set_without_retyping_the_day(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_time": "17:30"})
    assert refused is None and row["due_date"] == "2026-10-02T17:30:00"


def test_the_day_can_be_moved_without_losing_the_hour(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_date": "2026-10-09"},
                           due="2026-10-02T17:30:00")
    assert refused is None and row["due_date"] == "2026-10-09T17:30:00"


def test_the_hour_can_be_dropped_keeping_the_day(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_time": ""}, due="2026-10-02T17:30:00")
    assert refused is None and row["due_date"] == "2026-10-02"


def test_an_hour_with_no_day_means_nothing_and_stores_nothing(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_time": "17:30"}, due=None)
    assert refused is None and row["due_date"] is None


def test_something_that_is_not_a_date_is_refused_and_nothing_moves(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_date": "next tuesday"})
    assert refused[0] == 400 and "YYYY-MM-DD" in refused[1]
    assert row["due_date"] == "2026-10-02"


def test_something_that_is_not_a_time_is_refused(with_test_db):
    row, _, refused = _run(with_test_db, OWNER, {"due_time": "half five"})
    assert refused[0] == 400 and "HH:MM" in refused[1]
    assert row["due_date"] == "2026-10-02"


def test_the_person_who_asked_for_the_work_can_move_it(with_test_db):
    row, _, refused = _run(with_test_db, ASKER, {"due_date": "2026-10-15"})
    assert refused is None and row["due_date"] == "2026-10-15"


def test_the_managers_of_the_people_on_it_can_move_it(with_test_db):
    row, _, refused = _run(with_test_db, MANAGER, {"due_date": "2026-10-15"})
    assert refused is None and row["due_date"] == "2026-10-15"


def test_the_doer_does_not_quietly_move_their_own_deadline(with_test_db):
    """They say they need longer — on the task, where the person who is
    waiting for it can read it — rather than moving the date themselves."""
    row, _, refused = _run(with_test_db, DOER, {"due_date": "2026-11-30"})
    assert refused[0] == 403 and "due date" in refused[1]
    assert row["due_date"] == "2026-10-02"


def test_a_task_in_another_workspace_is_not_found(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            await db.tasks.insert_one(_seed())
            try:
                await rt.update_task("task1", _patch(due_date="2026-10-15"),
                                     user={**OWNER, "tenant_id": "t-other"})
            except HTTPException as e:
                return e.status_code
            return None

    assert with_test_db(scenario) == 404


def test_resending_the_date_it_already_has_is_not_a_change(with_test_db):
    """Same rule as priority: a field sent with the value it already holds
    changes nothing and needs no right, so a doer whose screen echoes the
    current date back is not refused for touching it."""
    row, trail, refused = _run(with_test_db, DOER, {"due_date": "2026-10-02"})
    assert refused is None and row["due_date"] == "2026-10-02"
    assert not [e for e in trail if e["kind"] == "task_due"], "and nothing is written to the timeline"

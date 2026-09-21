"""Every task a person makes has a deadline, and "Due today" adds up (PILOT-1 C).

The pilot client: "Any task assigned should have deadline. Only then you can
show 'Due today' count in main screen." New Task opened on "No date", so most
tasks were made without one: never due today, never overdue, never pulling the
score down — invisible to every number that watches the work.

And the number itself was a different set from the list it opened. The Desk's
"Due today" counted only tasks SOMEONE ELSE was doing (for anyone but the owner,
only ones they had handed out), while the card links to
/my-work?filter=due_today, which lists the viewer's OWN work due today. The
client makes tasks for themselves, so their own work was never counted.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import BackgroundTasks, HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-due"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
DOER = {"id": "u-doer", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}
BUYER = {"id": "u-buy", "tenant_id": TENANT, "role": "production", "name": "Suresh", "permissions": ["tasks"]}
WATCHER = {"id": "u-see", "tenant_id": TENANT, "role": "finance", "name": "Anita",
           "permissions": ["tasks", "tasks_view_all"]}

IST = timezone(timedelta(hours=5, minutes=30))
TODAY = datetime.now(timezone.utc).astimezone(IST).date().isoformat()
TOMORROW = (datetime.now(timezone.utc).astimezone(IST).date() + timedelta(days=1)).isoformat()
YESTERDAY = (datetime.now(timezone.utc).astimezone(IST).date() - timedelta(days=1)).isoformat()


async def _people(db):
    await db.users.insert_many([
        {"id": u["id"], "tenant_id": TENANT, "name": u["name"], "role": u["role"],
         "permissions": u["permissions"]} for u in (OWNER, DOER, BUYER, WATCHER)
    ])


async def _roles(tenant_id, *a, **k):
    return ["owner", "sales", "finance", "production"]


def _env(db):
    return e2e_env(db, stubs={"routers.tasks.tenant_role_keys": _roles})


def _task(tid, **over):
    return {
        "id": tid, "tenant_id": TENANT, "title": f"Task {tid}", "status": "todo", "priority": "medium",
        "progress": 0, "assignee_id": DOER["id"], "assignee_role": "sales", "co_assignee_ids": [],
        "created_by": OWNER["id"], "due_date": TODAY,
        "created_at": "2026-09-01T09:00:00+00:00", "updated_at": "2026-09-01T09:00:00+00:00",
        **over,
    }


# ------------------------------------------------------ a task needs a date
def _create(with_test_db, user, **body):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskCreateInput
        with _env(db):
            await _people(db)
            try:
                made = await rt.create_task(TaskCreateInput(**body), BackgroundTasks(), user=user)
                return made, None, await db.tasks.count_documents({"tenant_id": TENANT})
            except HTTPException as e:
                return None, (e.status_code, e.detail), await db.tasks.count_documents({"tenant_id": TENANT})

    return with_test_db(scenario)


def test_a_task_made_by_hand_without_a_date_is_refused(with_test_db):
    made, refused, stored = _create(with_test_db, OWNER, title="Chase Anand Fabrics", assignee_id=DOER["id"])
    assert made is None
    assert refused and refused[0] == 400 and "due date" in refused[1]
    assert stored == 0, "and nothing was half-made"


def test_a_task_with_a_date_is_made(with_test_db):
    made, refused, _ = _create(with_test_db, OWNER, title="Chase Anand Fabrics",
                               assignee_id=DOER["id"], due_date=TOMORROW)
    assert refused is None and made["due_date"] == TOMORROW


def test_in_n_days_is_still_a_date(with_test_db):
    """The older way of saying when — "in 0 days" — still counts as a date."""
    made, refused, _ = _create(with_test_db, OWNER, title="Chase Anand Fabrics",
                               assignee_id=DOER["id"], due_in_days=0)
    assert refused is None and made["due_date"] == TODAY


def test_a_date_with_an_hour_is_made(with_test_db):
    made, refused, _ = _create(with_test_db, DOER, title="Call the transporter",
                               assignee_id=DOER["id"], due_date=TOMORROW, due_time="15:30")
    assert refused is None and made["due_date"] == f"{TOMORROW}T15:30:00"


# ---------------------------------------------- a date is moved, not removed
def _patch(with_test_db, body, task=None):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        with _env(db):
            await _people(db)
            await db.tasks.insert_one(task or _task("task1", due_date="2026-10-02"))
            try:
                await rt.update_task("task1", TaskUpdateInput(**body), user=OWNER)
                refused = None
            except HTTPException as e:
                refused = (e.status_code, e.detail)
            return await db.tasks.find_one({"id": "task1"}, {"_id": 0}), refused

    return with_test_db(scenario)


def test_a_due_date_can_no_longer_be_taken_off(with_test_db):
    row, refused = _patch(with_test_db, {"due_date": ""})
    assert refused and refused[0] == 400
    assert row["due_date"] == "2026-10-02"


def test_a_due_date_can_still_be_moved(with_test_db):
    row, refused = _patch(with_test_db, {"due_date": "2026-10-09"})
    assert refused is None and row["due_date"] == "2026-10-09"


def test_an_old_task_with_no_date_can_be_given_one(with_test_db):
    """Tasks made before this change: one tap to date them (My Work offers it)."""
    row, refused = _patch(with_test_db, {"due_date": TOMORROW}, task=_task("task1", due_date=None))
    assert refused is None and row["due_date"] == TOMORROW


def test_the_hour_can_still_be_cleared_keeping_the_day(with_test_db):
    row, refused = _patch(with_test_db, {"due_time": ""}, task=_task("task1", due_date="2026-10-02T15:30:00"))
    assert refused is None and row["due_date"] == "2026-10-02"


# ------------------------------------ "Due today" is the list it opens
SEEDED = [
    _task("own", assignee_id=OWNER["id"], assignee_role="owner"),          # the owner's own work
    _task("given", created_by=OWNER["id"]),                                  # Priya's, from the owner
    _task("timed", due_date=f"{TODAY}T15:30:00"),                            # today, with an hour
    _task("helping", assignee_id=BUYER["id"], assignee_role="production",
          co_assignee_ids=[DOER["id"]], created_by=BUYER["id"]),              # Priya helps on it
    _task("pool", assignee_id=None, assignee_role="sales", created_by=OWNER["id"]),  # unclaimed, sales pool
    _task("elsewhere", assignee_id=BUYER["id"], assignee_role="production", created_by=DOER["id"]),
    _task("done", status="done"),                                            # finished: not due
    _task("later", due_date=TOMORROW),                                       # not today
    _task("late", due_date=YESTERDAY),                                       # overdue: On fire, not Due today
    _task("undated", due_date=None),
]


def _due_today_and_list(with_test_db, user):
    """The Desk's number, and what My Work's Due today filter shows for the
    scope the Desk's link opens it in (All for the owner / See all tasks,
    My tasks for everyone else) — the frontend's isDueToday rule, applied to
    GET /tasks exactly as the page does."""
    async def scenario(db):
        import routers.desk as rd
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            await db.tasks.insert_many([dict(t) for t in SEEDED])
            counted = {c["id"] for c in await rd._cards_due_today(TENANT, user)}
            sees_all = user["role"] == "owner" or "tasks_view_all" in user["permissions"]
            rows = await rt.list_tasks(mine=not sees_all, user=user)
            listed = {t["id"] for t in rows
                      if t.get("status") not in ("done", "cancelled")
                      and str(t.get("due_date") or "")[:10] == TODAY}
            return counted, listed

    return with_test_db(scenario)


def test_the_owners_own_work_due_today_is_counted(with_test_db):
    counted, _ = _due_today_and_list(with_test_db, OWNER)
    assert "own" in counted, "the pilot client makes tasks for themselves — those are due today too"


def test_the_owners_number_is_the_list_it_opens(with_test_db):
    counted, listed = _due_today_and_list(with_test_db, OWNER)
    assert counted == listed
    assert counted == {"own", "given", "timed", "helping", "pool", "elsewhere"}


def test_a_team_members_number_is_their_own_list(with_test_db):
    """Not the tasks they handed to someone else — their own work: assigned,
    helping on, and their team's unclaimed pool."""
    counted, listed = _due_today_and_list(with_test_db, DOER)
    assert counted == listed
    assert counted == {"given", "timed", "helping", "pool"}
    assert "elsewhere" not in counted, "work they gave someone else is not due on THEIR list"


def test_see_all_tasks_counts_what_it_sees(with_test_db):
    counted, listed = _due_today_and_list(with_test_db, WATCHER)
    assert counted == listed == {"own", "given", "timed", "helping", "pool", "elsewhere"}


def test_a_time_on_the_date_is_still_that_day(with_test_db):
    counted, _ = _due_today_and_list(with_test_db, DOER)
    assert "timed" in counted


def test_overdue_finished_later_and_undated_are_not_due_today(with_test_db):
    counted, _ = _due_today_and_list(with_test_db, OWNER)
    assert not counted & {"done", "later", "late", "undated"}

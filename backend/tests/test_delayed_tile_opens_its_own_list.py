"""The Desk's Delayed tile counts the list it opens (FIX-1, 2026-10-21).

Found by the client on the Play release (1.0.8): Delayed showed a number, and
tapping it opened My Work's Overdue on "No tasks match these filters". The
Sharma demo was fine. Two differences between the number and the list, both
invisible in a small, fresh company:

1. GET /tasks brought back the 500 newest tasks of ANY status, and My Work
   filters that copy on the phone. A company with a few months of work has
   mostly finished tasks among its newest 500, so its oldest open work — the
   late work — never reached the phone. The Desk counted in the database.
2. The count took every late task in the company for the owner, while the
   list leaves out work waiting for the viewer's own sign-off (Approvals has
   it) — and for "See all tasks" it took only the person's own while the list
   shows the company.

Now the list brings back every open task, and the count is made with the
list's own filter (as PILOT-1 C did for Due today). Checked here against a
real database: for each kind of viewer, the number is the late work in the
list the tile opens.
"""
import os
from datetime import timedelta, date

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-delayed"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh"}
PRIYA = {"id": "u-priya", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}
ARUN = {"id": "u-arun", "tenant_id": TENANT, "role": "sales", "name": "Arun", "permissions": ["tasks"]}
# A manager given "See all tasks", and one who approves work.
MEERA = {"id": "u-meera", "tenant_id": TENANT, "role": "ops", "name": "Meera",
         "permissions": ["tasks", "tasks_view_all"]}
KAVI = {"id": "u-kavi", "tenant_id": TENANT, "role": "ops", "name": "Kavi",
        "permissions": ["tasks", "approvals"]}
PEOPLE = (OWNER, PRIYA, ARUN, MEERA, KAVI)


def _day(n):
    from shared.due import today_ist
    return (date.fromisoformat(today_ist()) + timedelta(days=n)).isoformat()


def _task(id, *, created, **kw):
    return {"id": id, "tenant_id": TENANT, "title": id, "status": "todo",
            "created_at": f"2026-{created}T09:00:00+00:00", **kw}


def _waiting(id, **kw):
    """Waiting for its go-ahead (ASK-28 TK-05: approval to start)."""
    return _task(id, approval_required=True, approval_stage="start",
                 approval_status="pending", status="blocked", **kw)


async def _seed(db, tasks):
    await db.users.insert_many([{k: v for k, v in p.items() if k != "permissions"} for p in PEOPLE])
    await db.tasks.insert_many(tasks)


async def _tile_and_list(viewer):
    """What the Delayed tile says, and the late work in the list it opens."""
    import routers.desk as rd
    import routers.tasks as rt
    from core.permissions import user_perms
    from services.tasks import can_see_all_tasks
    from shared.due import is_overdue
    # My Work opens /my-work?filter=overdue on All Tasks for whoever may see
    # them (pages/MyWork.js), on My Tasks for everyone else.
    see_all = can_see_all_tasks(viewer, user_perms(viewer))
    listed = await rt.list_tasks(status=None, mine=not see_all, view=None, user=viewer)
    late = sorted(t["id"] for t in listed
                  if t.get("status") not in ("done", "cancelled") and is_overdue(t.get("due_date")))
    return await rd._delayed_count(TENANT, viewer), late, listed


def test_late_work_behind_hundreds_of_finished_tasks_still_reaches_the_list(with_test_db):
    # Three late tasks from the company's first week, then 600 tasks made and
    # finished since: the old list stopped at the 500th newest.
    late = [_task(f"late-{i}", created=f"01-0{i + 1}", due_date=_day(-30), assignee_id=PRIYA["id"],
                  assignee_role="sales") for i in range(3)]
    finished = [_task(f"done-{i}", created=f"03-{1 + i % 28:02d}", status="done", due_date=_day(-20),
                      assignee_id=PRIYA["id"], assignee_role="sales") for i in range(600)]

    async def scenario(db):
        with e2e_env(db):
            await _seed(db, late + finished)
            return await _tile_and_list(OWNER)

    count, listed_late, listed = with_test_db(scenario)
    assert listed_late == ["late-0", "late-1", "late-2"]
    assert count == 3
    # Finished work is history: still the newest 500 of it. And the two halves
    # come back as the one query did, newest first.
    assert sum(1 for t in listed if t["status"] == "done") == 500
    made = [t["created_at"] for t in listed]
    assert made == sorted(made, reverse=True)


def test_every_viewer_counts_the_late_work_their_list_shows(with_test_db):
    tasks = [
        _task("priya-late", created="05-01", due_date=_day(-2), assignee_id=PRIYA["id"], assignee_role="sales"),
        _task("priya-helps", created="05-02", due_date=_day(-3), assignee_id=ARUN["id"],
              assignee_role="sales", co_assignee_ids=[PRIYA["id"]]),
        _task("sales-pool", created="05-03", due_date=_day(-1), assignee_id=None, assignee_role="sales"),
        _task("arun-late", created="05-04", due_date=_day(-4), assignee_id=ARUN["id"], assignee_role="sales"),
        _task("ops-late", created="05-05", due_date=_day(-2), assignee_id=MEERA["id"], assignee_role="ops"),
        _task("not-late", created="05-06", due_date=_day(3), assignee_id=PRIYA["id"], assignee_role="sales"),
        _task("finished", created="05-07", due_date=_day(-5), assignee_id=PRIYA["id"],
              assignee_role="sales", status="done"),
        # Late and waiting for a go-ahead: the owner may give any, Kavi
        # (approvals) the one that names nobody.
        _waiting("waits-on-anyone", created="05-08", due_date=_day(-2), assignee_id=ARUN["id"],
                 assignee_role="sales", approver_id=None),
        _waiting("waits-on-kavi", created="05-09", due_date=_day(-2), assignee_id=KAVI["id"],
                 assignee_role="ops", approver_id=None),
    ]

    async def scenario(db):
        with e2e_env(db):
            await _seed(db, tasks)
            return {p["id"]: (await _tile_and_list(p))[:2] for p in PEOPLE}

    seen = with_test_db(scenario)
    for who, (count, late) in seen.items():
        assert count == len(late), f"{who}: Delayed {count}, Overdue lists {late}"
    # And what each of them sees is theirs to see.
    assert seen["u-owner"][1] == ["arun-late", "ops-late", "priya-helps", "priya-late", "sales-pool"]
    assert seen["u-priya"][1] == ["priya-helps", "priya-late", "sales-pool"]
    assert seen["u-arun"][1] == ["arun-late", "priya-helps", "sales-pool", "waits-on-anyone"]
    assert seen["u-meera"][1] == ["arun-late", "ops-late", "priya-helps", "priya-late",
                                  "sales-pool", "waits-on-anyone", "waits-on-kavi"]
    # Kavi's own task waits on Kavi's own sign-off: it is in Approvals.
    assert seen["u-kavi"][1] == []


def test_late_work_waiting_for_my_go_ahead_is_in_approvals(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with e2e_env(db):
            await _seed(db, [_waiting("needs-go-ahead", created="06-01", due_date=_day(-2),
                                      assignee_id=PRIYA["id"], assignee_role="sales")])
            count, late, _ = await _tile_and_list(OWNER)
            approvals = await rt.list_tasks(status=None, mine=False, view="approvals", user=OWNER)
            return count, late, [t["id"] for t in approvals]

    count, late, approvals = with_test_db(scenario)
    assert (count, late) == (0, [])
    assert approvals == ["needs-go-ahead"]


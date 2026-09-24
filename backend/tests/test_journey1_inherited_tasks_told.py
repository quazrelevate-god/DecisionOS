"""The person who inherits a leaver's work is told (JOURNEY-1 J12-07).

Removing somebody moves their open tasks to a replacement. The replacement's
My Work simply grew, with nothing to say where the tasks came from or that a
colleague had left -- they find out by noticing, which is how a due date gets
missed.

The notification says who left and how many tasks came with them. It is sent
only when there is a replacement and something actually moved.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-inherit"
LEAVER, HEIR, OWNER = "u-amit", "u-priya", "u-rajesh"


def _task(i, assignee, status="in_progress"):
    return {"id": f"t{i}", "tenant_id": T, "title": f"Task {i}", "assignee_id": assignee,
            "status": status, "created_at": "2026-09-20T00:00:00+00:00"}


def _people():
    return [
        {"id": LEAVER, "tenant_id": T, "name": "Amit Verma", "role": "operations", "email": "amit@example.com"},
        {"id": HEIR, "tenant_id": T, "name": "Priya", "role": "sales", "email": "priya@example.com"},
        {"id": OWNER, "tenant_id": T, "name": "Rajesh", "role": "owner", "email": "rajesh@example.com"},
    ]


def _remove(with_test_db, tasks, reassign_to):
    async def scenario(db):
        from services.deprovisioning import deprovision_user
        # The notification is the point of this test, so keep the real writer
        # (e2e_env neutralises fire-and-forget writers by default).
        with e2e_env(db, keep={"services.notifications.push_notification"}):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles"})
            await db.users.insert_many(_people())
            await db.memberships.insert_many([
                {"id": f"m-{u['id']}", "user_id": u["id"], "tenant_id": T, "role": u["role"],
                 "status": "active", "created_at": "2026-09-01T00:00:00+00:00"} for u in _people()])
            if tasks:
                await db.tasks.insert_many([dict(t) for t in tasks])
            report = await deprovision_user(db, target_user_id=LEAVER, tenant_id=T,
                                            actor_user_id=OWNER, reassign_to_user_id=reassign_to)
            notes = await db.notifications.find({"tenant_id": T}, {"_id": 0}).to_list(50)
            return report, notes
    return with_test_db(scenario)


def test_the_heir_is_told_who_left_and_how_many(with_test_db):
    report, notes = _remove(with_test_db, [_task(1, LEAVER), _task(2, LEAVER)], HEIR)
    assert report["tasks_reassigned"] == 2
    mine = [n for n in notes if n["user_id"] == HEIR]
    assert len(mine) == 1, f"expected one notification, got {notes}"
    msg = mine[0]["message"]
    assert "2 open tasks" in msg and "Amit Verma" in msg and "left" in msg, msg


def test_one_task_is_not_called_tasks(with_test_db):
    _report, notes = _remove(with_test_db, [_task(1, LEAVER)], HEIR)
    msg = next(n for n in notes if n["user_id"] == HEIR)["message"]
    assert "1 open task moved" in msg, msg


def test_finished_work_is_not_inherited_and_not_counted(with_test_db):
    """Only open work moves, so only open work is announced."""
    report, notes = _remove(with_test_db, [_task(1, LEAVER, status="done"), _task(2, LEAVER)], HEIR)
    assert report["tasks_reassigned"] == 1
    assert "1 open task" in next(n for n in notes if n["user_id"] == HEIR)["message"]


def test_nothing_is_sent_when_nothing_moved(with_test_db):
    _report, notes = _remove(with_test_db, [_task(1, OWNER)], HEIR)
    assert [n for n in notes if n["user_id"] == HEIR] == []


def test_nothing_is_sent_when_there_is_no_replacement(with_test_db):
    """Tasks are orphaned rather than inherited; there is nobody to tell."""
    report, notes = _remove(with_test_db, [_task(1, LEAVER)], None)
    assert report["tasks_reassigned"] == 1
    assert notes == [] or all(n["user_id"] != HEIR for n in notes)

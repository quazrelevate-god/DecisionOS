"""How late a task was outlives closing it (BUG-04, XCODITS QA, 2026-10-21).

The testers: "A task closed after being overdue for 10 days does not show the
correct overdue duration. The system preserves the original due date and
calculates the overdue duration even after the task is completed."

What was behind it:
  * the screens never showed a number of days, and dropped "Overdue" the moment
    a task was finished;
  * finishing by ticking the last checklist step wrote no completed_at (and set
    off none of what closing sets off: the next run of a routine, the workflow
    advance, the work waiting on it);
  * the due date of a finished task could still be moved, rewriting how late it
    was;
  * a routine closed late brought its next run already late;
  * the Desk's "N days overdue" counted UTC days, one short before 05:30 IST.
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.test_work_that_keeps_running import DOER, OWNER, TENANT, _Bg, _create, _env, _people, _update

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)


def _plan(steps, done):
    from models.tasks import ExecPlanInput
    return ExecPlanInput(status="accepted",
                         steps=[{"id": f"s{i}", "text": s, "done": done} for i, s in enumerate(steps)])


def test_finishing_by_checklist_records_when_and_brings_the_next_run(with_test_db, monkeypatch):
    monkeypatch.setattr("shared.due.today_ist", lambda now=None: "2026-10-21")

    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            t = await rt.create_task(_create(title="Daily dispatch check", due_date="2026-10-11",
                                             repeat_every="day", assignee_id=DOER["id"]), _Bg(), user=OWNER)
            await rt.save_execution_plan(t["id"], _plan(["Count cartons", "Sign the sheet"], False), user=OWNER)
            await rt.save_execution_plan(t["id"], _plan(["Count cartons", "Sign the sheet"], True), user=OWNER)
            rows = await db.tasks.find({"tenant_id": TENANT}, {"_id": 0}).to_list(10)
            return t["id"], rows

    first_id, rows = with_test_db(scenario)
    first = next(r for r in rows if r["id"] == first_id)
    assert first["status"] == "done"
    assert first.get("completed_at"), "the checklist close says when, like every other close"
    assert first["due_date"] == "2026-10-11", "and the date it was due stays"
    nxt = [r for r in rows if r["id"] != first_id]
    assert [r["due_date"] for r in nxt] == ["2026-10-21"], \
        "the routine carries on — from today, not from ten days ago"


def test_a_finished_task_keeps_the_date_it_was_due(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            t = await rt.create_task(_create(title="Send the quotation", due_date="2026-10-01",
                                             assignee_id=DOER["id"]), _Bg(), user=OWNER)
            await rt.update_task(t["id"], _update(status="done"), user=OWNER)
            out = {}
            try:
                await rt.update_task(t["id"], _update(due_date="2026-10-20"), user=OWNER)
            except HTTPException as e:
                out["move_finished"] = (e.status_code, e.detail)
            # Reopened, it can be moved again — in the same request.
            reopened = await rt.update_task(t["id"], _update(status="todo", due_date="2026-10-25"), user=OWNER)
            out["reopened"] = (reopened["status"], reopened["due_date"])
            return out

    out = with_test_db(scenario)
    assert out["move_finished"] == (400, "This task is finished, so it keeps the date it was due. Reopen it to move the date.")
    assert out["reopened"] == ("todo", "2026-10-25")


def test_the_repair_dates_checklist_closes_that_were_never_stamped(with_test_db):
    async def scenario(db):
        from services.task_timing import backfill_completed_at
        await db.tasks.insert_many([
            {"id": "never", "tenant_id": TENANT, "status": "done"},                       # no field at all
            {"id": "reopened", "tenant_id": TENANT, "status": "done", "completed_at": None},  # cleared by a reopen
        ])
        await db.activity.insert_many([
            {"kind": "task_done", "entity_id": "never", "created_at": "2026-10-12T09:00:00+00:00"},
            {"kind": "task_done", "entity_id": "reopened", "created_at": "2026-10-15T09:00:00+00:00"},
        ])
        await backfill_completed_at(db)
        return {t["id"]: t.get("completed_at") async for t in db.tasks.find({}, {"_id": 0})}

    assert with_test_db(scenario) == {"never": "2026-10-12T09:00:00+00:00", "reopened": "2026-10-15T09:00:00+00:00"}


def test_the_next_run_of_a_routine_is_never_born_late():
    from services.recurrence import next_due_not_late
    assert next_due_not_late("2026-10-11", "day", 1, "2026-10-21") == "2026-10-21"
    assert next_due_not_late("2026-09-21", "week", 1, "2026-10-21") == "2026-10-26"     # still a Monday
    assert next_due_not_late("2026-01-31", "month", 1, "2026-04-02") == "2026-04-30"    # still month end
    assert next_due_not_late("2026-10-20", "day", 1, "2026-10-21") == "2026-10-21"
    assert next_due_not_late("2026-10-21T10:00:00", "week", 1, "2026-10-21") == "2026-10-28T10:00:00"


def test_the_desks_days_overdue_counts_indias_days(monkeypatch):
    import routers.desk as rd
    # 01:00 IST on 21 Oct is still 20 Oct in UTC.
    monkeypatch.setattr(rd, "today_ist", lambda now=None: "2026-10-21")
    assert rd._days_between("2026-10-20") == 1
    assert rd._days_between("2026-10-11") == 10
    # An instant with a zone is read on India's clock: 20 Oct 20:00 UTC is 21 Oct in India.
    assert rd._days_between("2026-10-20T20:00:00+00:00") == 0


FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def test_cards_and_the_drawer_say_how_late():
    my_work = (FE / "pages" / "MyWork.js").read_text(encoding="utf-8")
    assert "const lateness = (t) => {" in my_work
    assert '`Finished ${daysWord(l.days)} late`' in my_work and '"Finished on time"' in my_work
    assert "Overdue{late?.days > 0 ? ` · ${daysWord(late.days)}` : \"\"}" in my_work
    assert "{late?.finished && (" in my_work
    assert 'data-testid={`task-lateness-${task.id}`}' in my_work
    # A finished task's due date is read-only on screen too.
    assert len(re.findall(r"<DueLine t=\{t\} canMove=\{rights\.priority && !isTerminal\(t\)\}", my_work)) == 2

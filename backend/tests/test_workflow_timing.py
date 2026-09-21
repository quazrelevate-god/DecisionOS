"""Workflow timing (2026-09-22, Yokesh: "delay, overdue for the workflow,
setting up the timeline").

Before: the work a stage created had no due date, so nothing on a workflow
was ever due, overdue or escalated; "stuck" was a colour on the Desk nobody
was told about; a card had no deadline of its own. Now a stage takes N
working days, its work is dated from that, a quiet card is reported once, a
card may carry a target date with a forecast, and the card shows its
planned-vs-actual timeline.
"""
import os
from datetime import date

import pytest

from services.workflow_timing import (
    DEFAULT_STAGE_DAYS, card_timing, stage_days, stuck_days,
)
from shared.normalizers import normalize_operating_model
from shared.workdays import add_working_days, working_days_between

MON, TUE, SAT = date(2026, 9, 21), date(2026, 9, 22), date(2026, 9, 26)

PIPE = {"key": "orders", "label": "Orders", "stuck_after_days": 2, "stages": [
    {"key": "inquiry", "label": "Inquiry", "days": 2, "tasks": [{"title": "Log the inquiry", "role": "sales"}]},
    {"key": "sampling", "label": "Sampling", "days": 5, "tasks": [{"title": "Make the sample", "role": "sales"}]},
    {"key": "confirmed", "label": "Order Confirmed", "tasks": [{"title": "Raise the proforma", "role": "sales"}]},
    {"key": "shipped", "label": "Shipped", "tasks": []},
]}
STAGES = [s["key"] for s in PIPE["stages"]]


# ═══════════════════════════ working days (pure) ═══════════════════════════
def test_sunday_is_the_day_off():
    assert add_working_days(SAT, 1) == date(2026, 9, 28), "Saturday + 1 skips Sunday"
    assert add_working_days(MON, 3) == date(2026, 9, 24)
    assert working_days_between(SAT, date(2026, 9, 28)) == 1, "Sat -> Mon is one working day"
    assert working_days_between(TUE, MON) == 0


# ═══════════════════════════ the rules (pure) ══════════════════════════════
def test_a_stage_takes_its_own_days_else_the_default():
    assert stage_days(PIPE, "sampling") == 5
    assert stage_days(PIPE, "confirmed") == DEFAULT_STAGE_DAYS
    assert stuck_days(PIPE) == 2 and stuck_days({}) == 3


def _card(stage="sampling", **extra):
    return {"id": "wf1", "type": "orders", "title": "Bluewave", "stage": stage, "stages": list(STAGES),
            "created_at": "2026-09-14T04:00:00+00:00",
            "stage_events": [{"kind": "entered", "stage": "inquiry", "at": "2026-09-14T04:00:00+00:00"},
                             {"kind": "entered", "stage": "sampling", "at": "2026-09-17T04:00:00+00:00"}],
            **extra}


def test_the_card_clock_says_when_the_stage_is_due_and_how_late():
    tm = card_timing(_card(), PIPE, today=MON)
    # Entered Sampling Thu 17 Sep; 5 working days -> Wed 23 Sep. Not late on Mon 21.
    assert tm["stage_due"] == "2026-09-23" and tm["stage_late_days"] == 0
    late = card_timing(_card(), PIPE, today=date(2026, 9, 25))
    assert late["stage_late_days"] == 2


def test_the_forecast_adds_the_stages_still_to_come_and_flags_a_target_at_risk():
    tm = card_timing(_card(target_date="2026-09-25"), PIPE, today=MON)
    # Sampling due Wed 23; Order Confirmed takes 3 (default) -> Sat 26. Shipped is the finish.
    assert tm["forecast_date"] == "2026-09-26"
    assert tm["at_risk"] is True and tm["past_target"] is False
    safe = card_timing(_card(target_date="2026-10-01"), PIPE, today=MON)
    assert safe["at_risk"] is False


def test_the_timeline_is_planned_against_actual():
    tm = card_timing(_card(), PIPE, today=MON)
    rows = {r["key"]: r for r in tm["timeline"]}
    assert rows["inquiry"]["planned_days"] == 2 and rows["inquiry"]["actual_days"] == 3
    assert rows["inquiry"]["over"] is True and rows["inquiry"]["state"] == "done"
    assert rows["sampling"]["state"] == "current" and rows["sampling"]["actual_days"] == 3
    assert rows["confirmed"]["actual_days"] is None
    assert rows["shipped"]["planned_days"] is None, "the final stage is the finish, not a stage to plan"


def test_a_quiet_card_is_stuck_after_its_boards_days():
    tm = card_timing(_card(), PIPE, today=MON)
    assert tm["idle_days"] == 3 and tm["stuck"] is True     # Thu 17 -> Mon 21, board says 2
    busy = card_timing(_card(), PIPE, today=MON, last_activity="2026-09-21T03:00:00+00:00")
    assert busy["stuck"] is False, "work at the stage moving is the card moving"


def test_a_finished_card_has_no_clock_running():
    tm = card_timing(_card(stage="shipped"), PIPE, today=MON)
    assert tm["finished"] is True and tm["stage_due"] is None and tm["stuck"] is False


def test_the_operating_model_keeps_stage_days_and_stuck_days():
    om = normalize_operating_model({"pipelines": [PIPE]})
    p = om["pipelines"][0]
    assert p["stuck_after_days"] == 2
    assert [s.get("days") for s in p["stages"]] == [2, 5, None, None]
    bad = normalize_operating_model({"pipelines": [{**PIPE, "stuck_after_days": 500, "stages": [
        {**PIPE["stages"][0], "days": "abc"}, {**PIPE["stages"][1], "days": 2.5}]}]})
    assert "stuck_after_days" not in bad["pipelines"][0]
    assert all("days" not in s for s in bad["pipelines"][0]["stages"]), "nonsense is 'not set', not clamped"


# ═══════════════════════════ against a database ════════════════════════════
single = pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                            reason="rebinds module-level db globals - single-process only")
T = "t-tm"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}


async def _om(tenant_id, *a, **k):
    return {"pipelines": [PIPE], "task_categories": []}


async def _keys(tenant_id, *a, **k):
    return {"owner", "sales"}


_sent = []


async def _record(tenant_id, user_ids, level, message, *a, **k):
    _sent.append({"to": sorted(set(u for u in user_ids if u)), "message": message, "ntype": k.get("ntype")})


def _in_env(fn):
    async def run(db):
        from tests.e2e_harness import e2e_env
        _sent.clear()
        with e2e_env(db, stubs={
            "services.ai.generators.tenant_operating_model": _om,
            "services.workflow_engine.tenant_role_keys": _keys,
            "services.notifications.push_notification": _record,
        }):
            await db.tenants.insert_one({"id": T, "name": "Nila", "operating_model": {"pipelines": [PIPE]}})
            await db.users.insert_many([
                {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
                {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"}])
            return await fn(db)
    return run


@single
def test_entering_a_stage_dates_its_work(with_test_db):
    async def scenario(db):
        import routers.workflows as wr
        from models.workflows import WorkflowCreateInput
        card = await wr.create_workflow(WorkflowCreateInput(type="orders", title="Bluewave"), user=OWNER)
        task = await db.tasks.find_one({"workflow_id": card["id"]}, {"_id": 0})
        wf = await db.workflows.find_one({"id": card["id"]}, {"_id": 0})
        return task, wf

    task, wf = with_test_db(_in_env(scenario))
    assert task["title"] == "Log the inquiry"
    assert task["due_date"], "stage work is no longer created undated"
    assert task["due_date"] == wf["stage_due"]
    assert task.get("due_from_stage") is True


@single
def test_a_person_set_date_is_kept(with_test_db):
    async def scenario(db):
        from services.workflow_timing import date_stage_work
        await db.workflows.insert_one({**_card(stage="sampling"), "tenant_id": T})
        await db.tasks.insert_many([
            {"id": "a", "tenant_id": T, "workflow_id": "wf1", "stage_key": "sampling", "status": "todo", "due_date": "2026-12-01"},
            {"id": "b", "tenant_id": T, "workflow_id": "wf1", "stage_key": "sampling", "status": "todo", "due_date": None}])
        await date_stage_work(T, _card(), PIPE)
        return {t["id"]: t["due_date"] async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}

    dates = with_test_db(_in_env(scenario))
    assert dates["a"] == "2026-12-01" and dates["b"] == "2026-09-23"


@single
def test_the_board_and_the_card_carry_the_clock_and_a_target_can_be_set(with_test_db):
    async def scenario(db):
        import routers.workflows as wr
        from models.workflows import WorkflowCreateInput, WorkflowUpdateInput
        card = await wr.create_workflow(WorkflowCreateInput(type="orders", title="Bluewave", target_date="2027-01-15"), user=OWNER)
        await wr.update_workflow(card["id"], WorkflowUpdateInput(target_date="2027-02-01"), user=OWNER)
        board = await wr.list_workflows(with_tasks=True, user=OWNER)
        detail = await wr.get_workflow(card["id"], user=OWNER)
        try:
            await wr.update_workflow(card["id"], WorkflowUpdateInput(target_date="soon"), user=OWNER)
        except Exception as e:
            bad = getattr(e, "status_code", None)
        cleared = await wr.update_workflow(card["id"], WorkflowUpdateInput(target_date=""), user=OWNER)
        return board, detail, bad, cleared

    board, detail, bad, cleared = with_test_db(_in_env(scenario))
    tm = board[0]["timing"]
    assert tm["target_date"] == "2027-02-01" and tm["stage_due"] and "timeline" not in tm
    assert [r["key"] for r in detail["timing"]["timeline"]] == STAGES
    assert bad == 400
    assert cleared["target_date"] is None


@single
def test_a_stuck_card_is_reported_once_per_quiet_spell(with_test_db):
    async def scenario(db):
        from datetime import datetime, timezone
        from services.workflow_timing import warn_stuck_workflows
        await db.workflows.insert_one({**_card(), "tenant_id": T})
        await db.tasks.insert_one({"id": "k", "tenant_id": T, "workflow_id": "wf1", "stage_key": "sampling",
                                   "status": "todo", "assignee_id": "u-priya", "updated_at": "2026-09-17T04:00:00+00:00"})
        now = datetime(2026, 9, 21, 6, 0, tzinfo=timezone.utc)
        first = await warn_stuck_workflows(T, now)
        again = await warn_stuck_workflows(T, now)
        # Someone touches the work: a new spell; quiet again for 2 days -> told again.
        await db.tasks.update_one({"id": "k"}, {"$set": {"updated_at": "2026-09-22T04:00:00+00:00"}})
        later = await warn_stuck_workflows(T, datetime(2026, 9, 24, 6, 0, tzinfo=timezone.utc))
        return first, again, later, list(_sent)

    first, again, later, sent = with_test_db(_in_env(scenario))
    assert (first, again, later) == (1, 0, 1)
    assert sent[0]["to"] == ["u-owner", "u-priya"] and sent[0]["ntype"] == "workflow_stuck"
    assert "Sampling" in sent[0]["message"]


@single
def test_the_backfill_dates_old_work_without_making_it_overdue_overnight(with_test_db):
    async def scenario(db):
        from services.workflow_timing import backfill_stage_due_dates
        await db.workflows.insert_one({**_card(), "tenant_id": T})   # Sampling due 23 Sep: in the past by now
        await db.tasks.insert_many([
            {"id": "old", "tenant_id": T, "workflow_id": "wf1", "stage_key": "sampling", "status": "todo", "due_date": None},
            {"id": "left", "tenant_id": T, "workflow_id": "wf1", "stage_key": "inquiry", "status": "todo", "due_date": None},
            {"id": "shut", "tenant_id": T, "workflow_id": "wf1", "stage_key": "sampling", "status": "done", "due_date": None}])
        await backfill_stage_due_dates(db)
        return {t["id"]: t.get("due_date") async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}

    from shared.workdays import today_ist
    dates = with_test_db(_in_env(scenario))
    assert dates["old"] >= add_working_days(today_ist(), 1).isoformat(), "never overdue on the day it is switched on"
    assert dates["left"] is None, "work on a stage the card left is the leftover review's"
    assert dates["shut"] is None


# ═══════════════════════════ the New workflow form ═════════════════════════
def test_the_new_workflow_form_asks_for_a_target_date():
    """2026-09-22: the target could only be set from the card after creating it."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "Workflows.js").read_text(encoding="utf-8")
    assert 'data-testid="wf-target-input"' in src
    assert "target_date: form.target_date || null" in src
    i18n = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "i18n.js").read_text(encoding="utf-8")
    assert i18n.count("target_label:") == 3, "English, Hindi and Tamil"

"""Work left behind when a card leaves a stage (2026-09-21).

Yokesh, after a decision walked a card Inquiry -> Sampling -> Order Confirmed
and stranded five open tasks on stages it had left: "a review section where you
show these are three, four tasks left — which should be done, which shouldn't,
which should still be — and connect it with the loop that won't skip the stage
until the task is completed."

One rule for both roads a card can take:
  * the board's move: the gate still refuses a move over open work; the
    person answers for each task instead of typing an override;
  * a decision's move: the approver answers in the review; anything they did
    not choose for is kept and carried to where the card lands.
Stages a card only passes through create no work.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}
PIPE = {"key": "orders", "label": "Orders", "stages": [
    {"key": "inquiry", "label": "Inquiry", "role": "sales", "tasks": []},
    {"key": "sampling", "label": "Sampling", "role": "sales",
     "tasks": [{"title": "Make the sample", "role": "sales"}]},
    {"key": "confirmed", "label": "Order Confirmed", "role": "sales",
     "tasks": [{"title": "Raise the proforma", "role": "sales"}]},
    {"key": "production", "label": "In Production", "role": "sales", "tasks": []},
]}
STAGES = [s["key"] for s in PIPE["stages"]]


async def _om(tenant_id, *a, **k):
    return {"pipelines": [PIPE], "task_categories": []}


async def _keys(tenant_id, *a, **k):
    return ["owner", "sales"]


async def _nobody(*a, **k):
    return None


def _env(db):
    return e2e_env(db, stubs={
        "services.ai.generators.tenant_operating_model": _om,
        "services.workflow_engine.tenant_role_keys": _keys,
        "services.voice.pick_least_loaded_member": _nobody,
        "routers.tasks.tenant_role_keys": _keys,
    })


async def _seed(db, stage="inquiry"):
    await db.workflows.insert_one({"id": "wf1", "tenant_id": T, "type": "orders", "title": "Bluewave",
                                   "stage": stage, "stages": list(STAGES), "stage_version": 0,
                                   "history": [], "created_at": "2026-09-21T00:00:00+00:00"})
    await db.tasks.insert_many([
        {"id": f"k{i}", "tenant_id": T, "workflow_id": "wf1", "stage_key": stage, "title": title,
         "status": "todo", "assignee_id": None, "assignee_role": "sales", "created_at": f"2026-09-21T0{i}:00:00"}
        for i, title in enumerate(["Log the inquiry", "Send pricing", "Ask for the size set"])])


async def _tasks(db):
    return {t["id"]: t async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}


# ═════════════════════════════ the board's move ════════════════════════════
def test_the_gate_still_refuses_a_move_over_open_work(with_test_db):
    """The loop Yokesh named stays: nothing leaves a stage by accident."""
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowAdvanceInput
        with _env(db):
            await _seed(db)
            try:
                await wf.advance_workflow("wf1", WorkflowAdvanceInput(stage="sampling"), user=OWNER)
            except HTTPException as e:
                return e.status_code, e.detail
        return None, None

    status, detail = with_test_db(scenario)
    assert status == 409 and "3 task(s) still open" in detail


def test_saying_what_happens_to_each_task_moves_the_card_without_an_override(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowAdvanceInput
        with _env(db):
            await _seed(db)
            card = await wf.advance_workflow("wf1", WorkflowAdvanceInput(
                stage="sampling", resolutions={"k0": "done", "k1": "not_needed"}), user=OWNER)
            return card, await _tasks(db), await db.workflows.find_one({"id": "wf1"}, {"_id": 0})

    card, tasks, wf = with_test_db(scenario)
    assert card["stage"] == "sampling"
    assert tasks["k0"]["status"] == "done"
    assert tasks["k1"]["status"] == "cancelled" and "moved on" in tasks["k1"]["cancel_reason"]
    assert tasks["k2"]["status"] == "todo" and tasks["k2"]["stage_key"] == "sampling", \
        "a task nobody chose for is KEPT, and moves with the card — never stranded"
    assert not wf["history"][-1].get("override"), "answered, not overridden"


def test_kept_work_holds_the_next_stage_gate_like_any_other(with_test_db):
    """The loop continues on the new stage: carried work must be done there too."""
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowAdvanceInput
        from services.workflow_engine import check_stage_ready
        with _env(db):
            await _seed(db)
            await wf.advance_workflow("wf1", WorkflowAdvanceInput(
                stage="sampling", resolutions={"k0": "done", "k1": "done", "k2": "keep"}), user=OWNER)
            return await check_stage_ready(T, "wf1")

    ready = with_test_db(scenario)
    assert ready["ready"] is False and "k2" in ready["open_task_ids"]


def test_marking_it_done_here_releases_what_waited_on_it(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowAdvanceInput
        with _env(db):
            await _seed(db)
            await db.tasks.insert_one({"id": "after", "tenant_id": T, "title": "Pack", "status": "blocked",
                                       "depends_on": ["k1"], "assignee_id": None, "co_assignee_ids": []})
            await wf.advance_workflow("wf1", WorkflowAdvanceInput(
                stage="sampling", resolutions={"k0": "done", "k1": "done", "k2": "done"}), user=OWNER)
            return (await _tasks(db))["after"]

    assert with_test_db(scenario)["status"] == "todo"


def test_an_unknown_choice_is_read_as_keep(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowAdvanceInput
        with _env(db):
            await _seed(db)
            await wf.advance_workflow("wf1", WorkflowAdvanceInput(
                stage="sampling", resolutions={"k0": "delete-everything", "k1": "done", "k2": "done"}), user=OWNER)
            return (await _tasks(db))["k0"]

    t = with_test_db(scenario)
    assert t["status"] == "todo" and t["stage_key"] == "sampling"


def test_the_review_lists_the_open_work_with_who_holds_it(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await _seed(db)
            await db.users.insert_one({"id": "u-priya", "tenant_id": T, "name": "Priya"})
            await db.tasks.update_one({"id": "k1"}, {"$set": {"assignee_id": "u-priya"}})
            return await wf.workflow_leftover("wf1", user=OWNER)

    left = with_test_db(scenario)
    assert left["stage_label"] == "Inquiry"
    assert [t["title"] for t in left["tasks"]] == ["Log the inquiry", "Send pricing", "Ask for the size set"]
    assert left["tasks"][1]["assignee_name"] == "Priya"


# ═════════════════════════════ a decision's move ═══════════════════════════
def _decision(move_to="confirmed"):
    return {"id": "d1", "tenant_id": T, "title": "Bluewave confirmed",
            "proposal": {"workflows": [{"mode": "existing", "workflow_id": "wf1", "move_to": move_to}]}}


def test_a_decision_jump_carries_the_work_it_leaves_and_creates_none_on_the_way(with_test_db):
    """The case Yokesh saw: Inquiry -> Sampling -> Order Confirmed in one go."""
    async def scenario(db):
        from services.decision_flow import _run_workflow_moves
        with _env(db):
            await _seed(db)
            await db.decisions.insert_one(_decision())
            lines = await _run_workflow_moves(OWNER, _decision(), {"workflow_ids": []})
            return lines, await _tasks(db), await db.workflows.find_one({"id": "wf1"}, {"_id": 0})

    lines, tasks, wf = with_test_db(scenario)
    assert wf["stage"] == "confirmed" and "moved to Order Confirmed" in lines[0]
    assert all(tasks[k]["stage_key"] == "confirmed" and tasks[k]["status"] == "todo" for k in ("k0", "k1", "k2")), \
        "nobody chose, so nothing was closed — and nothing was left on Inquiry"
    titles = {t["title"] for t in tasks.values()}
    assert "Make the sample" not in titles, "Sampling was only passed through: no work created there"
    assert "Raise the proforma" in titles, "the landing stage gets its work"


def test_the_approvers_choices_are_applied(with_test_db):
    async def scenario(db):
        from services.decision_flow import _run_workflow_moves
        with _env(db):
            await _seed(db)
            await db.decisions.insert_one(_decision())
            await _run_workflow_moves(OWNER, _decision(), {"workflow_ids": []},
                                      {"k0": "done", "k1": "not_needed"})
            return await _tasks(db)

    tasks = with_test_db(scenario)
    assert tasks["k0"]["status"] == "done"
    assert tasks["k1"]["status"] == "cancelled"
    assert tasks["k2"]["stage_key"] == "confirmed" and tasks["k2"]["status"] == "todo"


def test_the_decision_review_shows_from_where_to_where_and_what_is_left(with_test_db):
    async def scenario(db):
        from services.decision_flow import moves_preview
        with _env(db):
            await _seed(db)
            await db.decisions.insert_one(_decision())
            return await moves_preview(OWNER, "d1")

    moves = with_test_db(scenario)
    assert len(moves) == 1
    m = moves[0]
    assert (m["from_label"], m["to_label"]) == ("Inquiry", "Order Confirmed")
    assert len(m["tasks"]) == 3


def test_a_decision_that_moves_nothing_has_nothing_to_review(with_test_db):
    async def scenario(db):
        from services.decision_flow import moves_preview
        with _env(db):
            await _seed(db)
            d = {"id": "d2", "tenant_id": T, "title": "x", "proposal": {"workflows": []}}
            await db.decisions.insert_one(d)
            return await moves_preview(OWNER, "d2")

    assert with_test_db(scenario) == []


def test_a_card_a_decision_creates_and_moves_straight_on_skips_its_first_stage_work(with_test_db):
    """A new card that approval moves at once never sat on its first stage."""
    async def scenario(db):
        from services.decision_flow import _run_workflow_moves
        with _env(db):
            await db.workflows.insert_one({"id": "wf1", "tenant_id": T, "type": "orders", "title": "New",
                                           "decision_id": "d1", "stage": "inquiry", "stages": list(STAGES),
                                           "stage_version": 0, "history": []})
            await db.decisions.insert_one(_decision(move_to="sampling"))
            await _run_workflow_moves(OWNER, _decision(move_to="sampling"), {"workflow_ids": ["wf1"]})
            return {t["title"] for t in (await _tasks(db)).values()}

    assert with_test_db(scenario) == {"Make the sample"}


def test_a_decisions_own_new_tasks_are_not_treated_as_left_behind(with_test_db):
    """Found in the browser: the decision's brand-new task was on the stage for
    a moment before the move and got a 'Carried to …' line it never earned."""
    async def scenario(db):
        from services.decision_flow import _run_workflow_moves
        with _env(db):
            await _seed(db)
            await db.decisions.insert_one(_decision())
            await db.tasks.insert_one({"id": "fresh", "tenant_id": T, "workflow_id": "wf1", "stage_key": "inquiry",
                                       "title": "The decision's own task", "status": "todo", "decision_id": "d1"})
            await _run_workflow_moves(OWNER, _decision(), {"workflow_ids": [], "task_ids": ["fresh"]})
            fresh = await db.tasks.find_one({"id": "fresh"}, {"_id": 0})
            trail = await db.activity.find({"entity_id": "fresh"}, {"_id": 0}).to_list(5)
            return fresh, trail

    fresh, trail = with_test_db(scenario)
    assert fresh.get("last_action") != "Carried to Order Confirmed"
    assert not trail, "no 'left behind' line on work that was never left"

"""A workflow card is not born hollow, and it can say what is going on.

Yokesh, 2026-09-21: "A person will definitely create a workflow, but couldn't
able to add the task to the workflow... When I see the workflow I have to know
what is going on in the company. That's the goal of the product."

Phase A of docs/WORKFLOW_OPERATIONS_PLAN.md — the four things that had to be
true before any of that could be built:

  A1  a card created from the board arrives with its first stage's work on it
  A2  one request answers "what is going on" for the whole card
  A3  the stage approval gate has a door, not only an owner's escape hatch
  A4  a card that is already running can be corrected
  A5  the loser of a two-person race is told, not congratulated
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
SALES = {"id": "u-sales", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["workflows"]}
FINANCE = {"id": "u-fin", "tenant_id": TENANT, "role": "finance", "name": "Anand", "permissions": ["workflows"]}

# One pipeline, shaped like a real operating model: template tasks on the first
# two stages, and an approval gate the FINANCE role owns on "checked".
PIPELINE = {
    "key": "orders",
    "label": "Orders",
    "stages": [
        {"key": "received", "label": "Received", "role": "sales",
         "tasks": [{"title": "Confirm the order with the customer", "role": "sales"},
                   {"title": "Check stock", "role": "sales"}]},
        {"key": "checked", "label": "Checked", "role": "finance",
         "tasks": [{"title": "Check the credit limit", "role": "finance"}],
         "approval": {"role": "finance", "required": True}},
        {"key": "packed", "label": "Packed", "role": "production"},
        {"key": "delivered", "label": "Delivered", "role": "sales"},
    ],
}
STAGE_KEYS = [s["key"] for s in PIPELINE["stages"]]


async def _fake_operating_model(tenant_id, *a, **k):
    return {"pipelines": [PIPELINE], "task_categories": []}


async def _fake_role_keys(tenant_id, *a, **k):
    return ["owner", "sales", "finance", "production"]


async def _no_auto_assign(tenant_id, role, *a, **k):
    """The least-loaded pick needs a member table; these tests care about the
    linkage, not who ends up holding it."""
    return None


def _env(testdb, **extra):
    stubs = {
        "services.ai.generators.tenant_operating_model": _fake_operating_model,
        "services.workflow_engine.tenant_role_keys": _fake_role_keys,
        "services.voice.pick_least_loaded_member": _no_auto_assign,
    }
    stubs.update(extra)
    return e2e_env(testdb, stubs=stubs)


def _card(stage="received", **over):
    wf = {"id": "wf1", "tenant_id": TENANT, "type": "orders", "title": "Kumar Fabrics order",
          "detail": "", "amount": 50000.0, "counterparty": "Kumar Fabrics", "contact_id": None,
          "stage": stage, "stages": list(STAGE_KEYS), "stage_version": 0,
          "history": [{"stage": STAGE_KEYS[0], "note": "Created", "by": OWNER["id"],
                       "at": "2026-09-01T09:00:00+00:00"}],
          "created_by": OWNER["id"], "created_at": "2026-09-01T09:00:00+00:00"}
    wf.update(over)
    return wf


def _task(tid, stage, status="todo", **over):
    t = {"id": tid, "tenant_id": TENANT, "workflow_id": "wf1", "stage_key": stage,
         "title": f"Task {tid}", "status": status, "priority": "medium",
         "assignee_id": SALES["id"], "assignee_role": "sales", "due_date": None,
         "source": "engine", "created_at": f"2026-09-01T10:0{tid[-1]}:00+00:00",
         "updated_at": "2026-09-01T10:00:00+00:00"}
    t.update(over)
    return t


# ---------------------------------------------------------------------------
# A1 — a card created from the board is not born hollow
# ---------------------------------------------------------------------------
def test_a_card_made_from_the_board_arrives_with_its_first_stage_of_work(with_test_db):
    """The decision path fired stage entry; this button never did. So every
    card a founder started by hand landed with nothing on it, and the tasks
    their own pipeline defines were never created."""
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowCreateInput
        with _env(db):
            card = await wf.create_workflow(
                WorkflowCreateInput(type="orders", title="Kumar Fabrics order", amount=50000),
                user=SALES)
            tasks = await db.tasks.find({"tenant_id": TENANT}, {"_id": 0}).to_list(50)
            return card, tasks

    card, tasks = with_test_db(scenario)
    assert card["stage"] == "received"
    assert {t["title"] for t in tasks} == {"Confirm the order with the customer", "Check stock"}
    assert all(t["workflow_id"] == card["id"] for t in tasks), "each one points back at the card"
    assert all(t["stage_key"] == "received" for t in tasks), "and at the stage that owns it"
    assert len(card["stage_tasks"]) == 2, "and the card comes back carrying them"
    assert len(card["spawned_task_ids"]) == 2


def test_the_first_stage_gate_stops_being_a_no_op(with_test_db):
    """The quiet half of the same bug: an empty stage satisfies "every task at
    this stage is done", so a hollow card could be advanced straight past a
    stage whose work had never been created."""
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowCreateInput
        from services.workflow_engine import check_stage_ready
        with _env(db):
            card = await wf.create_workflow(
                WorkflowCreateInput(type="orders", title="Kumar Fabrics order"), user=SALES)
            return await check_stage_ready(TENANT, card["id"])

    ready = with_test_db(scenario)
    assert ready["ready"] is False
    assert len(ready["open_task_ids"]) == 2
    assert "still open" in ready["reason"]


def test_automation_that_fails_never_loses_the_card(with_test_db):
    """The card is the founder's; the tasks are ours. A pipeline we cannot read
    must not turn "start this order" into an error."""
    async def boom(*a, **k):
        raise RuntimeError("pipeline unreadable")

    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowCreateInput
        with _env(db, **{"services.workflow_engine.on_stage_enter": boom}):
            card = await wf.create_workflow(
                WorkflowCreateInput(type="orders", title="Kumar Fabrics order"), user=SALES)
            return card, await db.workflows.count_documents({})

    card, n = with_test_db(scenario)
    assert n == 1 and card["stage_tasks"] == [] and card["spawned_task_ids"] == []


def test_an_unknown_pipeline_is_still_refused(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowCreateInput
        with _env(db):
            try:
                await wf.create_workflow(
                    WorkflowCreateInput(type="not_a_pipeline", title="x"), user=SALES)
            except HTTPException as e:
                return e.status_code, await db.workflows.count_documents({})
            return None, None

    assert with_test_db(scenario) == (400, 0)


# ---------------------------------------------------------------------------
# A2 — one request answers "what is going on"
# ---------------------------------------------------------------------------
def test_the_card_reports_every_stage_not_only_the_one_it_is_on(with_test_db):
    """The board's own list gives, at most, the OPEN tasks of the CURRENT
    stage. A founder asking "what happened on this order" got nothing."""
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked"))
            await db.users.insert_many([
                {"id": SALES["id"], "tenant_id": TENANT, "name": "Priya"},
                {"id": FINANCE["id"], "tenant_id": TENANT, "name": "Anand"},
            ])
            await db.tasks.insert_many([
                _task("t1", "received", status="done"),
                _task("t2", "received", status="done"),
                _task("t3", "checked", status="todo",
                      assignee_id=FINANCE["id"], assignee_role="finance", due_date="2026-09-30"),
            ])
            return await wf.get_workflow("wf1", user=OWNER)

    card = with_test_db(scenario)
    by_key = {s["key"]: s for s in card["stages_detail"]}
    assert [s["key"] for s in card["stages_detail"]] == STAGE_KEYS, "in pipeline order"
    assert by_key["received"]["state"] == "done"
    assert by_key["checked"]["state"] == "current"
    assert by_key["packed"]["state"] == "upcoming"
    assert (by_key["received"]["task_done"], by_key["received"]["task_total"]) == (2, 2), \
        "finished work at an earlier stage is still visible"
    assert (by_key["checked"]["task_done"], by_key["checked"]["task_total"]) == (0, 1)
    assert by_key["checked"]["tasks"][0]["assignee_name"] == "Anand", "with a name, not an id"
    assert by_key["checked"]["tasks"][0]["due_date"] == "2026-09-30"
    assert by_key["received"]["label"] == "Received" and by_key["checked"]["owner_role"] == "finance"
    assert by_key["received"]["entered_at"] == "2026-09-01T09:00:00+00:00", \
        "the card's creation IS the moment it entered stage one"


def test_a_stage_says_which_approval_it_waits_for_and_who_has_given_it(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked", approvals=[
                {"stage_key": "checked", "actor_id": FINANCE["id"], "actor_name": "Anand",
                 "actor_role": "finance", "recorded_at": "2026-09-05T10:00:00+00:00"}]))
            return await wf.get_workflow("wf1", user=OWNER)

    by_key = {s["key"]: s for s in with_test_db(scenario)["stages_detail"]}
    assert by_key["checked"]["approval"]["role"] == "finance"
    assert by_key["checked"]["approval"]["required"] is True
    assert by_key["checked"]["approval"]["given"][0]["actor_name"] == "Anand"
    assert by_key["received"]["approval"] is None, "a stage with no gate says so plainly"


def test_the_card_says_why_it_cannot_move_yet(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="received"))
            await db.tasks.insert_one(_task("t1", "received"))
            return await wf.get_workflow("wf1", user=OWNER)

    card = with_test_db(scenario)
    assert card["readiness"]["ready"] is False
    assert card["readiness"]["open_task_ids"] == ["t1"]


def test_a_task_linked_to_the_card_but_to_no_stage_is_not_lost(with_test_db):
    """Older rows, and anything linked before a stage was required. Showing
    them beats them existing where nobody can see them."""
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card())
            await db.tasks.insert_one(_task("t9", None))
            return await wf.get_workflow("wf1", user=OWNER)

    card = with_test_db(scenario)
    assert [t["id"] for t in card["unstaged_tasks"]] == ["t9"]


def test_a_card_in_another_workspace_is_not_found(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card())
            try:
                await wf.get_workflow("wf1", user={**OWNER, "tenant_id": "t-other"})
            except HTTPException as e:
                return e.status_code
            return None

    assert with_test_db(scenario) == 404


# ---------------------------------------------------------------------------
# A4 — a card that is already running can be corrected
# ---------------------------------------------------------------------------
def test_a_card_can_be_corrected(with_test_db):
    """There was no PATCH at all: a mistyped amount could only be fixed by
    deleting the card, taking its whole history with it."""
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowUpdateInput
        with _env(db):
            await db.workflows.insert_one(_card())
            out = await wf.update_workflow(
                "wf1", WorkflowUpdateInput(title="Kumar Fabrics order (revised)", amount=65000.0),
                user=SALES)
            return out

    card = with_test_db(scenario)
    assert card["title"] == "Kumar Fabrics order (revised)" and card["amount"] == 65000.0
    assert card["stage"] == "received", "and nothing about where it sits has changed"
    edit = [e for e in card["stage_events"] if e.get("kind") == "edited"][0]
    assert edit["by_name"] == "Priya" and "title" in edit["fields"] and "amount" in edit["fields"]


def test_the_stage_is_not_something_an_edit_can_touch(with_test_db):
    """workflow_engine.advance is the single writer of stage, and stages[] is
    the rails under a card that is already moving."""
    from models.workflows import WorkflowUpdateInput
    assert not hasattr(WorkflowUpdateInput(), "stage")
    assert "stage" not in WorkflowUpdateInput.model_fields
    assert "stages" not in WorkflowUpdateInput.model_fields

    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card())
            out = await wf.update_workflow("wf1", WorkflowUpdateInput(title="Renamed"), user=SALES)
            return out["stage"], out["stages"]

    assert with_test_db(scenario) == ("received", STAGE_KEYS)


def test_a_card_cannot_be_left_without_a_title(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowUpdateInput
        with _env(db):
            await db.workflows.insert_one(_card())
            try:
                await wf.update_workflow("wf1", WorkflowUpdateInput(title="   "), user=SALES)
            except HTTPException as e:
                kept = await db.workflows.find_one({"id": "wf1"}, {"_id": 0, "title": 1})
                return e.status_code, kept["title"]
            return None, None

    assert with_test_db(scenario) == (400, "Kumar Fabrics order")


def test_naming_a_contact_fills_in_the_party(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowUpdateInput
        with _env(db):
            await db.workflows.insert_one(_card(counterparty="", contact_id=None))
            await db.contacts.insert_one(
                {"id": "c1", "tenant_id": TENANT, "name": "Ravi", "company": "Kumar Fabrics"})
            named = await wf.update_workflow("wf1", WorkflowUpdateInput(contact_id="c1"), user=SALES)
            unknown = await wf.update_workflow(
                "wf1", WorkflowUpdateInput(contact_id="c-nope"), user=SALES)
            return named, unknown

    named, unknown = with_test_db(scenario)
    assert named["counterparty"] == "Kumar Fabrics" and named["contact_id"] == "c1"
    assert unknown["contact_id"] is None, "an id we don't know is dropped, not stored"


def test_an_edit_that_changes_nothing_is_not_written_to_the_timeline(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowUpdateInput
        with _env(db):
            await db.workflows.insert_one(_card())
            out = await wf.update_workflow("wf1", WorkflowUpdateInput(), user=SALES)
            return out.get("stage_events") or []

    assert with_test_db(scenario) == []


# ---------------------------------------------------------------------------
# A3 — the approval gate has a door
# ---------------------------------------------------------------------------
def test_the_named_role_can_approve_a_stage(with_test_db):
    """record_stage_approval has existed since the engine was written and had
    NO route: a gate an owner switched on in Settings could only be passed by
    that same owner overriding it."""
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked"))
            return await wf.approve_workflow_stage("wf1", user=FINANCE)

    out = with_test_db(scenario)
    assert out["ok"] is True and out["already_recorded"] is False
    assert out["entry"]["actor_name"] == "Anand" and out["entry"]["stage_key"] == "checked"
    assert out["readiness"]["ready"] is True, "and the gate is clear, so the card can move"


def test_the_owner_can_always_approve(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked"))
            return await wf.approve_workflow_stage("wf1", user=OWNER)

    assert with_test_db(scenario)["ok"] is True


def test_someone_outside_that_role_is_refused(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked"))
            try:
                await wf.approve_workflow_stage("wf1", user=SALES)
            except HTTPException as e:
                stored = await db.workflows.find_one({"id": "wf1"}, {"_id": 0, "approvals": 1})
                return e.status_code, e.detail, stored.get("approvals")
            return None, None, None

    status, detail, approvals = with_test_db(scenario)
    assert status == 403 and "finance" in detail and not approvals


def test_approving_twice_records_one_approval(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked"))
            first = await wf.approve_workflow_stage("wf1", user=FINANCE)
            second = await wf.approve_workflow_stage("wf1", user=FINANCE)
            stored = await db.workflows.find_one({"id": "wf1"}, {"_id": 0, "approvals": 1})
            return first, second, stored["approvals"]

    first, second, approvals = with_test_db(scenario)
    assert first["already_recorded"] is False and second["already_recorded"] is True
    assert len(approvals) == 1


def test_a_stage_with_no_gate_says_so_instead_of_pretending(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="received"))
            try:
                await wf.approve_workflow_stage("wf1", user=OWNER)
            except HTTPException as e:
                return e.status_code, e.detail
            return None, None

    status, detail = with_test_db(scenario)
    assert status == 400 and "doesn't need an approval" in detail


def test_an_approval_still_waits_for_the_stages_own_work(with_test_db):
    """Clearing the sign-off does not skip the tasks; both halves of the
    contract have to be satisfied."""
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            await db.workflows.insert_one(_card(stage="checked"))
            await db.tasks.insert_one(_task("t3", "checked"))
            return await wf.approve_workflow_stage("wf1", user=FINANCE)

    out = with_test_db(scenario)
    assert out["ok"] is True
    assert out["readiness"]["ready"] is False and out["readiness"]["open_task_ids"] == ["t3"]


def test_approving_a_card_that_is_not_there(with_test_db):
    async def scenario(db):
        import routers.workflows as wf
        with _env(db):
            try:
                await wf.approve_workflow_stage("nope", user=OWNER)
            except HTTPException as e:
                return e.status_code
            return None

    assert with_test_db(scenario) == 404


# ---------------------------------------------------------------------------
# A5 — the loser of a race is told, not congratulated
# ---------------------------------------------------------------------------
def test_the_person_who_lost_the_race_is_told_someone_else_moved_it(with_test_db):
    """The engine computes `already_advanced` for exactly this; the route
    dropped it and returned the card as though this press had done the moving,
    so the second person saw a success toast for a move they did not make."""
    async def already(*a, **k):
        return {"already_advanced": True, "workflow": _card(stage="checked")}

    async def scenario(db):
        import routers.workflows as wf
        import services.workflow_engine as engine
        from models.workflows import WorkflowAdvanceInput
        with _env(db, **{"services.workflow_engine.advance": already}):
            assert engine.advance is already
            return await wf.advance_workflow(
                "wf1", WorkflowAdvanceInput(stage="checked"), user=SALES)

    out = with_test_db(scenario)
    assert out["already_advanced"] is True and out["stage"] == "checked"


def test_a_move_this_caller_did_make_says_nothing_of_the_sort(with_test_db):
    async def moved(*a, **k):
        return {"already_advanced": False, "workflow": _card(stage="checked")}

    async def scenario(db):
        import routers.workflows as wf
        from models.workflows import WorkflowAdvanceInput
        with _env(db, **{"services.workflow_engine.advance": moved}):
            return await wf.advance_workflow(
                "wf1", WorkflowAdvanceInput(stage="checked"), user=SALES)

    assert "already_advanced" not in with_test_db(scenario)


# ---------------------------------------------------------------------------
# The screens — B1, C1, C2, C3, C4 (source assertions; the live run in
# scripts/ux_workflow_ops_0921.py drives them in a real browser)
# ---------------------------------------------------------------------------
from pathlib import Path  # noqa: E402

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return (FE.joinpath(*parts)).read_text(encoding="utf-8")


def test_a_person_can_finally_put_a_task_on_a_workflow():
    """B1, the headline gap. POST /tasks has taken workflow_id + stage_key
    since the engine was built, and no screen had ever sent them — so only the
    engine could put work on a card, which is exactly what Yokesh reported."""
    src = _fe("components", "workflow", "WorkflowDetail.js")
    form = src[src.index("const submit = async"):src.index("if (!open) {")]
    assert 'api.post("/tasks"' in form
    assert "workflow_id: workflowId" in form and "stage_key: stage.key" in form
    assert 'data-testid={`wf-add-task-${stage.key}`}' in src, "one opener per stage"


def test_the_card_opens_from_the_board():
    """C1 — and the title is a button, so a keyboard reaches a card too."""
    page = _fe("pages", "Workflows.js")
    assert "import WorkflowDetail from" in page
    assert 'data-testid={`open-workflow-${w.id}`}' in page
    assert "if (dragId) return;" in page, "dropping a card must not also open it"


def test_the_detail_view_shows_every_stage_not_only_the_current_one():
    src = _fe("components", "workflow", "WorkflowDetail.js")
    assert "stages_detail" in src
    assert 'data-testid={`wf-stage-${stage.key}`}' in src
    assert "{stage.task_done} of {stage.task_total} done" in src
    assert 'data-testid="wf-detail-history"' in src
    assert 'data-testid="wf-detail-status"' in src, "and why it cannot move"


def test_the_approval_a_stage_waits_for_has_a_button():
    """A3 — record_stage_approval had no route and no control anywhere; the
    only way past a configured gate was an owner override."""
    src = _fe("components", "workflow", "WorkflowDetail.js")
    assert 'api.post(`/workflows/${workflowId}/approve-stage`)' in src
    assert 'data-testid={`wf-approve-stage-${stage.key}`}' in src
    assert 'user?.role === "owner" || user?.role === gate?.role' in src, "the engine's own rule"


def test_a_card_can_be_corrected_from_the_drawer():
    src = _fe("components", "workflow", "WorkflowDetail.js")
    assert 'api.patch(`/workflows/${card.id}`' in src
    assert 'data-testid="wf-edit-save"' in src


def test_the_board_reads_the_same_attention_rules_as_the_desk():
    """C2 — workflowAttention says in its own header that the board should
    read it "so the two do not drift", and the board never imported it."""
    page = _fe("pages", "Workflows.js")
    assert 'from "./desk/workflowAttention"' in page
    assert "workflowAttention({" in page
    assert 'data-testid={`wf-attention-${w.id}`}' in page
    assert 'data-reason={read.reason}' in page


def test_the_board_says_how_far_through_a_stage_a_card_is():
    """C3 — "In production" read the same on the day a card arrived and the
    day it was one task from leaving."""
    page = _fe("pages", "Workflows.js")
    assert 'data-testid={`wf-card-stage-progress-${w.id}`}' in page
    assert "{w.stage_done} of {w.stage_total} done at this stage" in page


def test_the_board_answers_what_is_going_on_above_it():
    """C4 — how many are running, how many need attention, and who has them."""
    page = _fe("pages", "Workflows.js")
    assert 'data-testid="workflow-summary"' in page
    for t in ("running", "attention", "you", "stuck", "late"):
        assert f'data-testid="workflow-summary-{t}"' in page


def test_the_loser_of_a_race_is_told_on_screen_too():
    page = _fe("pages", "Workflows.js")
    assert "if (data?.already_advanced) toast.info(" in page


def test_a_due_date_can_be_moved_from_the_task():
    """B2 on screen. The rule matches the server's: whoever asked for the work,
    their manager or the owner."""
    src = _fe("pages", "MyWork.js")
    assert "function DueLine(" in src
    assert 'api.patch(`/tasks/${task.id}`, { due_date: value })' in src
    assert "<DueLine t={t} canMove={rights.priority}" in src


def test_blocked_work_looks_blocked_in_the_list():
    """B3 — the three on-screen stages fold `blocked` into "To do", so on the
    card FACE work that could not start read like work nobody had bothered
    with."""
    src = _fe("pages", "MyWork.js")
    assert 'data-testid={`blocked-pill-${t.id}`}' in src
    assert "Waiting for a decision" in src and "Waits for earlier work" in src


def test_a_task_can_be_made_to_repeat_and_says_so():
    """D1 on screen."""
    form = _fe("pages", "Tasks.js")
    # GlassSelect (the app's own list) takes testid and puts it on its trigger.
    assert 'testid="task-repeat-every"' in form
    assert "repeat_every: form.repeat_every || null" in form
    work = _fe("pages", "MyWork.js")
    assert "function repeatLabel(" in work
    assert 'data-testid={`repeat-pill-${t.id}`}' in work
    assert 'api.patch(`/tasks/${task.id}`, { stop_repeating: true })' in work


def test_the_warning_before_a_deadline_is_the_companys_to_set():
    """D2 on screen, next to the escalation days it belongs with."""
    settings = _fe("pages", "Settings.js")
    assert 'data-testid="due-soon-days"' in settings
    assert "due_soon_days: w" in settings


def test_work_can_be_told_to_wait_for_other_work():
    """D3 on screen — offered on a stage, which is where order matters."""
    src = _fe("components", "workflow", "WorkflowDetail.js")
    assert 'testid={`wf-add-task-after-${stage.key}`}' in src   # a GlassSelect prop
    assert "depends_on: after ? [after] : undefined" in src


def test_the_operating_model_is_asked_for_the_work_each_stage_needs():
    """The live run turned this up and nothing else would have.

    Stages have been ABLE to carry their own work since WE-03 — the normalizer
    keeps `tasks[]` per stage and the engine spawns them the moment a card
    lands — and the prompt that designs a tenant's operating model never asked
    for any. So every tenant's stages came back empty, on_stage_enter had
    nothing to create for anybody, and A1 above would have been a fix to a
    mechanism that never fired. Asking for them is what makes a card that
    arrives at a stage tell somebody to do something.
    """
    from prompts.generators import OPERATING_MODEL
    t = OPERATING_MODEL.template
    assert '"tasks": [{"title": str, "role": role_slug_or_empty}]' in t, \
        "the shape the normalizer already understands"
    assert "STAGE TASKS" in t and "1-3" in t
    assert "created automatically and assigned the moment a card reaches the stage" in t, \
        "and the model is told what they are FOR, so it writes instructions not stage names"
    assert OPERATING_MODEL.version == "1.1"

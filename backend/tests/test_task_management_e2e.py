"""ASK-28 — task management with REAL saves: the journeys the browser checks could
only run with writes blocked (the local database is production).

Each test drives the real routers.tasks handlers in sequence against an isolated
with_test_db Mongo (dropped at teardown) and asserts what was stored:
  TK-01  Asked by me: a non-owner creates a task for someone else and still sees it
  TK-02/05 approval before work starts: a non-owner named approver approves
  TK-05  approval before it's marked done: complete -> sign-off -> changes -> approve
  TK-03  My team: a manager sees and opens a report's task, and may only note
  4.3    a named approver must be able to approve

Notifications are kept REAL (written to the test database) so the sign-off
request can be asserted. Single-process, like the Sprint 12 journeys:

    .venv/Scripts/python -m pytest tests/test_task_management_e2e.py -o addopts="" -p no:xdist
"""
import os

import pytest
from fastapi import BackgroundTasks, HTTPException

from shared.ids import now_iso
from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="in-process E2E reaches shared Mongo clients -> run single-process, not under xdist")

import routers.tasks as tasks  # noqa: E402
from models.tasks import TaskCreateInput, TaskRejectInput, TaskUpdateInput, TaskUpdateNoteInput  # noqa: E402

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Owner"}
SALES = {"id": "u-sales", "tenant_id": T, "role": "sales", "name": "Priya (sales lead)"}
OPS = {"id": "u-ops", "tenant_id": T, "role": "operations", "name": "Amit (operations)",
       "reporting_manager_id": "u-sales"}
FIN = {"id": "u-fin", "tenant_id": T, "role": "finance", "name": "Sunita (finance)",
       "permissions": ["inbox", "data_input", "workflows", "tasks", "brain", "ask", "finance", "ledger", "approvals"]}
PROD = {"id": "u-prod", "tenant_id": T, "role": "production", "name": "Ravi (production)"}
PEOPLE = (OWNER, SALES, OPS, FIN, PROD)

# The workflow-link lookup lives in a module the harness does not rebind; no
# task here names a workflow, so answer "no link" without touching any database.


async def _no_link(*a, **k):
    return None, None

STUBS = {"services.workflows.derive_task_workflow_link": _no_link}
KEEP = {"services.notifications.push_notification"}


async def _seed(db):
    await db.tenants.insert_one({
        "id": T, "company_name": "Weave Co", "industry": "Textile Manufacturing", "plan": "business",
        "roles": [{"key": k, "label": k.title()} for k in ("sales", "finance", "operations", "production")],
        "created_at": now_iso()})
    for u in PEOPLE:
        await db.users.insert_one({**u, "email": f"{u['id']}@{T}.test", "created_at": now_iso()})


async def _create(user, **kw):
    return await tasks.create_task(TaskCreateInput(**kw), BackgroundTasks(), user=user)


async def _status(db, tid):
    t = await db.tasks.find_one({"id": tid}, {"_id": 0, "status": 1, "approval_status": 1, "progress": 1})
    return t["status"], t.get("approval_status"), t.get("progress")


def _ids(rows):
    return {r["id"] for r in rows}


async def _refused(coro, status=403):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


# ---------------------------------------------------------------------------
# TK-01 — Asked by me
# ---------------------------------------------------------------------------
def test_asked_by_me_non_owner_keeps_sight_of_work_they_hand_out(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Book the dyeing slot", assignee_id="u-ops")
            asked = await tasks.list_tasks(view="asked", user=SALES)
            mine = await tasks.list_tasks(mine=True, user=SALES)
            assert t["id"] in _ids(asked), "the person who asked lost sight of the task"
            assert t["id"] not in _ids(mine)
            assert t["id"] in _ids(await tasks.list_tasks(mine=True, user=OPS))

            # The asker can open it and leave a note, but not hand it off.
            assert (await tasks.get_task(t["id"], user=SALES))["id"] == t["id"]
            await tasks.add_task_update(t["id"], TaskUpdateNoteInput(text="Slot must be before Friday"), user=SALES)
            saved = await db.tasks.find_one({"id": t["id"]}, {"_id": 0, "updates": 1})
            assert [u["text"] for u in saved.get("updates") or []] == ["Slot must be before Friday"]
            await _refused(tasks.add_task_update(
                t["id"], TaskUpdateNoteInput(text="take it", action="handoff", to_id="u-prod"), user=SALES))
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# TK-02 / TK-05 — approval before work starts, by a NON-OWNER named approver
# ---------------------------------------------------------------------------
def test_before_start_named_non_owner_approver_approves(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Buy 40 cones of yarn", assignee_id="u-ops",
                              approval_required=True, approval_stage="start", approver_id="u-fin")
            assert await _status(db, t["id"]) == ("blocked", "pending", 0)
            told = await db.notifications.count_documents({"user_id": "u-fin", "entity_id": t["id"]})
            assert told == 1, f"the named approver should be told once, got {told}"

            # The doer is locked out until it is approved.
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS))

            # It waits on the named approver, and not on someone who cannot approve.
            assert t["id"] in _ids(await tasks.list_tasks(view="approvals", user=FIN))
            assert t["id"] not in _ids(await tasks.list_tasks(view="approvals", user=PROD))
            await _refused(tasks.approve_task(t["id"], user=PROD))

            await tasks.approve_task(t["id"], user=FIN)
            assert await _status(db, t["id"]) == ("todo", "approved", 0)
            assert t["id"] not in _ids(await tasks.list_tasks(view="approvals", user=FIN))
            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            assert (await _status(db, t["id"]))[0] == "in_progress"
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# TK-05 — approval before it's marked done
# ---------------------------------------------------------------------------
def test_before_done_complete_signoff_changes_then_approve(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Quality check the sample lot", assignee_id="u-ops",
                              approval_required=True, approval_stage="close", approver_id="u-fin")
            assert await _status(db, t["id"]) == ("todo", None, 0), "before-done must not lock the work"
            assert t["id"] not in _ids(await tasks.list_tasks(view="approvals", user=FIN))

            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress", progress=60), user=OPS)
            assert await _status(db, t["id"]) == ("in_progress", None, 60)

            # Complete -> sent for approval, and the approver is told.
            out = await tasks.update_task(t["id"], TaskUpdateInput(status="done"), user=OPS)
            assert (out["status"], out["approval_status"]) == ("review", "pending")
            assert await _status(db, t["id"]) == ("review", "pending", 100)
            assert await db.notifications.count_documents({"user_id": "u-fin", "entity_id": t["id"]}) == 1
            assert t["id"] in _ids(await tasks.list_tasks(view="approvals", user=FIN))
            # Completing again while it waits is refused.
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(status="done"), user=OPS), status=409)

            # Changes requested -> back to the doer with the reason.
            await tasks.reject_task(t["id"], TaskRejectInput(reason="Photo of the lot is blurry"), user=FIN)
            st = await db.tasks.find_one({"id": t["id"]}, {"_id": 0})
            assert (st["status"], st["approval_status"], st["rejection_reason"]) == \
                ("in_progress", "rejected", "Photo of the lot is blurry")
            assert t["id"] not in _ids(await tasks.list_tasks(view="approvals", user=FIN))

            # Fixed and completed again -> waits again -> approve closes it.
            await tasks.update_task(t["id"], TaskUpdateInput(status="done"), user=OPS)
            assert (await _status(db, t["id"]))[:2] == ("review", "pending")
            await tasks.approve_task(t["id"], user=FIN)
            assert await _status(db, t["id"]) == ("done", "approved", 100)
            kinds = [a["kind"] async for a in db.activity.find({"entity_id": t["id"]}, {"_id": 0, "kind": 1})]
            assert "task_signoff" in kinds and "task_approved" in kinds and "task_done" in kinds, kinds

            # Reopening a signed-off task needs signing off again.
            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            assert (await _status(db, t["id"]))[:2] == ("in_progress", None)
            return True
    assert with_test_db(scenario) is True


def test_before_done_approver_who_completes_closes_directly(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(OWNER, title="Sign the supplier contract", assignee_id="u-fin",
                              approval_required=True, approval_stage="close", approver_id="u-fin")
            out = await tasks.update_task(t["id"], TaskUpdateInput(status="done"), user=FIN)
            assert (out["status"], out["approval_status"]) == ("done", "approved")
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# Plan 4.3 — the named approver must be able to approve
# ---------------------------------------------------------------------------
def test_named_approver_without_approval_access_is_refused(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            detail = await _refused(_create(SALES, title="Pay the transporter", assignee_id="u-ops",
                                            approval_required=True, approver_id="u-prod"), status=400)
            assert "can't approve" in detail
            assert await db.tasks.count_documents({}) == 0, "a refused task must not be saved"

            # A role granted approvals in the company's role settings counts.
            await db.tenants.update_one({"id": T}, {"$set": {"roles.$[r].permissions": ["tasks", "approvals"]}},
                                        array_filters=[{"r.key": "production"}])
            ok = await _create(SALES, title="Pay the transporter", assignee_id="u-ops",
                               approval_required=True, approver_id="u-prod")
            assert (await db.tasks.find_one({"id": ok["id"]}))["approver_id"] == "u-prod"

            # The owner always counts; someone outside the company is dropped, not refused.
            assert (await _create(SALES, title="a", approval_required=True, approver_id="u-owner"))["approver_id"] == "u-owner"
            assert (await _create(SALES, title="b", approval_required=True, approver_id="u-nobody"))["approver_id"] is None
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# TK-06 — who is on a task
# ---------------------------------------------------------------------------
def test_supporting_employee_is_gone_and_old_apps_still_create(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            # An older app build still sends support_id: the task is created, the field is not kept.
            t = await tasks.create_task(TaskCreateInput.model_validate(
                {"title": "Pack the sample", "assignee_id": "u-ops", "support_id": "u-prod"}), BackgroundTasks(), user=SALES)
            saved = await db.tasks.find_one({"id": t["id"]}, {"_id": 0})
            assert "support_id" not in saved and "support_name" not in t
            # ...and it grants nothing: the would-be supporter cannot open the task.
            await _refused(tasks.get_task(t["id"], user=PROD))
            return True
    assert with_test_db(scenario) is True


def test_team_task_says_who_it_went_to_until_someone_reassigns(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Count the yarn cones", assignee_role="operations")
            assert (t["assignee_id"], t["auto_assigned"]) == ("u-ops", {"role": "operations", "rule": "fewest_open_tasks"})
            assert t["created_by_name"] == SALES["name"]
            # A person chooses the doer now -> the automatic note no longer holds.
            out = await tasks.update_task(t["id"], TaskUpdateInput(assignee_id="u-fin"), user=OWNER)
            assert out["assignee_id"] == "u-fin" and out.get("auto_assigned") is None
            # A task given to a named person was never picked automatically.
            named = await _create(SALES, title="Call the dyer", assignee_id="u-ops")
            assert named["auto_assigned"] is None
            return True
    assert with_test_db(scenario) is True


def test_helpers_hear_status_changes_and_overdue_reminders(with_test_db):
    async def scenario(db):
        await _seed(db)

        async def _zero(*a, **k):
            return 0
        stubs = {**STUBS, "services.finance_signals.db": db,
                 "routers.access.sweep_expired_temp_grants": _zero,
                 "services.finance_signals.run_finance_actions": _zero,
                 "services.finance_signals.dispatch_owner_alert": _zero}
        with e2e_env(db, stubs=stubs, keep=KEEP):
            import services.finance_signals as fs
            t = await _create(SALES, title="Dispatch the Kapoor order", assignee_id="u-ops", co_assignee_ids=["u-fin"])
            await db.notifications.delete_many({})

            # The lead moves it: the helper and the person who asked both hear.
            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            heard = {n["user_id"] async for n in db.notifications.find({"entity_id": t["id"]}, {"_id": 0, "user_id": 1})}
            assert {"u-fin", "u-sales"} <= heard and "u-ops" not in heard, heard

            # Overdue by half a day: the first reminder (days 0-1 go to the people
            # on the task; later levels alert the owner) reaches the helper too.
            from datetime import datetime, timedelta, timezone
            await db.notifications.delete_many({})
            half_day_ago = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
            await db.tasks.update_one({"id": t["id"]}, {"$set": {"due_date": half_day_ago, "escalation_level": 0}})
            fs._followup_last_run.pop(T, None)
            await fs.run_followup(T)
            reminded = {n["user_id"] async for n in db.notifications.find({"entity_id": t["id"]}, {"_id": 0, "user_id": 1})}
            assert {"u-ops", "u-fin"} <= reminded, reminded
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# TK-07 — stages and the Waiting on flag
# ---------------------------------------------------------------------------
def test_waiting_on_a_colleague_or_a_supplier(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Finish the Kapoor quote", assignee_id="u-ops")
            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            await db.notifications.delete_many({})

            # Waiting on a colleague: stored as waiting, with who and since when; they are told.
            out = await tasks.update_task(t["id"], TaskUpdateInput(waiting_on={"user_id": "u-fin"}), user=OPS)
            assert out["status"] == "waiting" and out["waiting_on"]["user_id"] == "u-fin"
            assert out["waiting_on"]["name"] == FIN["name"] and out["waiting_on"]["since"]
            assert await db.notifications.count_documents({"user_id": "u-fin", "entity_id": t["id"]}) == 1
            # ...they can open it and answer with a note, but not hand it off.
            assert (await tasks.get_task(t["id"], user=FIN))["id"] == t["id"]
            await tasks.add_task_update(t["id"], TaskUpdateNoteInput(text="Rates attached"), user=FIN)
            await _refused(tasks.add_task_update(
                t["id"], TaskUpdateNoteInput(text="x", action="handoff", to_id="u-prod"), user=FIN))

            # Switching to a supplier by name.
            out = await tasks.update_task(t["id"], TaskUpdateInput(waiting_on={"name": "Kumar Fabrics"}), user=OPS)
            assert out["status"] == "waiting" and out["waiting_on"]["name"] == "Kumar Fabrics" and out["waiting_on"]["user_id"] is None
            # The colleague no longer waited on loses that access.
            await _refused(tasks.get_task(t["id"], user=FIN))

            # Moving it along ends the wait.
            out = await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            assert out["status"] == "in_progress" and out.get("waiting_on") is None

            # Stop waiting from the flag itself -> back to Doing.
            await tasks.update_task(t["id"], TaskUpdateInput(waiting_on={"name": "Kumar Fabrics"}), user=OPS)
            out = await tasks.update_task(t["id"], TaskUpdateInput(waiting_on={}), user=OPS)
            assert out["status"] == "in_progress" and out.get("waiting_on") is None
            kinds = [a["kind"] async for a in db.activity.find({"entity_id": t["id"]}, {"_id": 0, "kind": 1})]
            assert kinds.count("task_waiting") >= 3, kinds

            # Nobody to wait on, or a finished task: refused with a reason.
            detail = await _refused(tasks.update_task(t["id"], TaskUpdateInput(waiting_on={"name": "  "}), user=OPS), status=400)
            assert "waiting on" in detail
            await tasks.update_task(t["id"], TaskUpdateInput(status="done"), user=OPS)
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(waiting_on={"name": "Kumar Fabrics"}), user=OPS), status=400)
            return True
    assert with_test_db(scenario) is True


def test_waiting_on_respects_the_start_approval_lock(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Buy the dye", assignee_id="u-ops",
                              approval_required=True, approval_stage="start", approver_id="u-fin")
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(waiting_on={"name": "Supplier"}), user=OPS))
            assert (await db.tasks.find_one({"id": t["id"]}))["status"] == "blocked"
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# TK-03 — My team
# ---------------------------------------------------------------------------
def test_my_team_manager_sees_opens_and_notes_on_reports_work(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            doing = await _create(OWNER, title="Count finished stock", assignee_id="u-ops")
            helping = await _create(OWNER, title="Dispatch plan", assignee_id="u-fin", co_assignee_ids=["u-ops"])
            other = await _create(OWNER, title="Fix loom 4", assignee_id="u-prod")

            team = _ids(await tasks.list_tasks(view="team", user=SALES))
            assert team == {doing["id"], helping["id"]}, team
            assert await tasks.list_tasks(view="team", user=PROD) == []

            # The manager opens a report's task and its timeline, and may note but not hand off.
            assert (await tasks.get_task(doing["id"], user=SALES))["id"] == doing["id"]
            assert isinstance(await tasks.task_activity(doing["id"], user=SALES), (list, dict))
            await tasks.add_task_update(doing["id"], TaskUpdateNoteInput(text="Need this by 5pm"), user=SALES)
            await _refused(tasks.add_task_update(
                doing["id"], TaskUpdateNoteInput(text="x", action="handoff", to_id="u-prod"), user=SALES))

            # Not their report: still refused.
            await _refused(tasks.get_task(other["id"], user=SALES))
            await _refused(tasks.task_activity(other["id"], user=SALES))
            return True
    assert with_test_db(scenario) is True

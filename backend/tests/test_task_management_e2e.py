"""ASK-28 — task management with REAL saves: the journeys the browser checks could
only run with writes blocked (the local database is production).

Each test drives the real routers.tasks handlers in sequence against an isolated
with_test_db Mongo (dropped at teardown) and asserts what was stored:
  TK-01  Asked by me: a non-owner creates a task for someone else and still sees it
  TK-02/05 approval before work starts: a non-owner named approver approves
  TK-05  approval before it's marked done: complete -> sign-off -> changes -> approve
  TK-03  My team: a manager sees and opens a report's task, and may only note
  4.3    a named approver must be able to approve
  6.7    who may change a task (item 7)
  7.x    stuck work: reminders, the manager step, the owner alert, Escalate, the Desk

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


def test_proof_stays_once_the_work_is_completed(with_test_db):
    """Yokesh 2026-09-15: proof can be removed while the work is open, never once
    it is sent for sign-off or done — not even by the owner. Reopening frees it;
    reference material is never locked."""
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await _create(SALES, title="Pay the dye supplier", assignee_id="u-ops",
                              approval_required=True, approval_stage="close", approver_id="u-fin")
            atts = [{"id": "p1", "kind": "photo", "by": "u-ops", "filename": "receipt-1.jpg", "url": "/f/p1"},
                    {"id": "p2", "kind": "file", "by": "u-ops", "filename": "receipt-2.pdf", "url": "/f/p2"},
                    {"id": "r1", "kind": "reference", "by": "u-sales", "filename": "quote.pdf", "url": "/f/r1"}]
            await db.tasks.update_one({"id": t["id"]}, {"$set": {"attachments": atts}})

            async def left():
                return [a["id"] for a in (await db.tasks.find_one({"id": t["id"]}))["attachments"]]

            # Open work: the doer removes their own proof.
            await tasks.delete_task_attachment(t["id"], "p1", user=OPS)
            assert await left() == ["p2", "r1"]

            # Sent for sign-off: nobody removes proof; reference material still goes.
            await tasks.update_task(t["id"], TaskUpdateInput(status="done"), user=OPS)
            assert (await _status(db, t["id"]))[:2] == ("review", "pending")
            assert "Reopen" in await _refused(tasks.delete_task_attachment(t["id"], "p2", user=OPS))
            await _refused(tasks.delete_task_attachment(t["id"], "p2", user=OWNER))
            await tasks.delete_task_attachment(t["id"], "r1", user=SALES)
            assert await left() == ["p2"]

            # Done: still locked, owner included.
            await tasks.approve_task(t["id"], user=FIN)
            assert (await _status(db, t["id"]))[0] == "done"
            await _refused(tasks.delete_task_attachment(t["id"], "p2", user=OWNER))
            await _refused(tasks.delete_task_attachment(t["id"], "p2", user=OPS))

            # Reopened: open work again, so the proof can change.
            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            await tasks.delete_task_attachment(t["id"], "p2", user=OPS)
            assert await left() == []
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
            # (the owner routes it: sales may route only to its own team since TK-08)
            t = await _create(OWNER, title="Count the yarn cones", assignee_role="operations")
            assert (t["assignee_id"], t["auto_assigned"]) == ("u-ops", {"role": "operations", "rule": "fewest_open_tasks"})
            assert t["created_by_name"] == OWNER["name"]
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
            # (the owner puts finance on it: sales may add only its own team or reports since TK-08)
            t = await _create(OWNER, title="Dispatch the Kapoor order", assignee_id="u-ops", co_assignee_ids=["u-fin"])
            await db.notifications.delete_many({})

            # The lead moves it: the helper and the person who asked both hear.
            await tasks.update_task(t["id"], TaskUpdateInput(status="in_progress"), user=OPS)
            heard = {n["user_id"] async for n in db.notifications.find({"entity_id": t["id"]}, {"_id": 0, "user_id": 1})}
            assert {"u-fin", "u-owner"} <= heard and "u-ops" not in heard, heard

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
# TK-08 — task access (plan Phase 6)
# ---------------------------------------------------------------------------
SALES2 = {"id": "u-sales2", "tenant_id": T, "role": "sales", "name": "Kiran (sales)"}
BASE_PERMS = ["inbox", "data_input", "workflows", "tasks", "brain", "ask"]


def test_who_may_give_work_to_whom(with_test_db):
    async def scenario(db):
        await _seed(db)
        await db.users.insert_one({**SALES2, "email": f"u-sales2@{T}.test", "created_at": now_iso()})
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            # Sales: themselves, their own team, their direct report (operations reports to sales).
            for who in ("u-sales", "u-sales2", "u-ops"):
                assert (await _create(SALES, title=f"for {who}", assignee_id=who))["assignee_id"] == who
            assert (await _create(SALES, title="to the sales team", assignee_role="sales"))["assignee_role"] == "sales"

            before = await db.tasks.count_documents({})
            detail = await _refused(_create(SALES, title="for production", assignee_id="u-prod"))
            assert "Ravi" in detail and "Assign tasks to anyone" in detail
            await _refused(_create(SALES, title="to production", assignee_role="production"))
            await _refused(_create(SALES, title="with a finance helper", assignee_id="u-sales2", co_assignee_ids=["u-fin"]))
            assert await db.tasks.count_documents({}) == before, "a refused task must not be saved"

            # Changing people later follows the same rule; taking someone off is free.
            t = await _create(SALES, title="Quote for Kapoor", assignee_id="u-sales2", co_assignee_ids=["u-ops"])
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(assignee_id="u-prod"), user=SALES))
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(co_assignee_ids=["u-ops", "u-fin"]), user=SALES))
            await _refused(tasks.update_task(t["id"], TaskUpdateInput(assignee_role="production"), user=SALES))
            out = await tasks.update_task(t["id"], TaskUpdateInput(co_assignee_ids=[]), user=SALES)
            assert out["co_assignee_ids"] == []
            from models.tasks import TaskReassignInput
            manager = {**SALES, "permissions": BASE_PERMS + ["team_manage"]}
            await _refused(tasks.reassign_task(t["id"], TaskReassignInput(assignee_id="u-prod"), user=manager))

            # "Assign tasks to anyone" lifts the limit; the owner always could.
            anyone = {**SALES, "permissions": BASE_PERMS + ["tasks_assign_any", "team_manage"]}
            assert (await _create(anyone, title="for production", assignee_id="u-prod"))["assignee_id"] == "u-prod"
            assert (await _create(anyone, title="to production", assignee_role="production"))["assignee_role"] == "production"
            out = await tasks.reassign_task(t["id"], TaskReassignInput(assignee_id="u-prod"), user=anyone)
            assert out["assignee_id"] == "u-prod"
            assert (await _create(OWNER, title="owner to finance", assignee_id="u-fin"))["assignee_id"] == "u-fin"
            return True
    assert with_test_db(scenario) is True


def test_creating_a_task_needs_the_tasks_permission(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            no_tasks = {**SALES, "permissions": ["inbox", "brain"]}
            detail = await _refused(_create(no_tasks, title="Nope", assignee_id="u-sales"))
            assert "create tasks" in detail
            assert await db.tasks.count_documents({}) == 0
            return True
    assert with_test_db(scenario) is True


def test_see_all_tasks_is_opt_in_and_finance_does_not_have_it(with_test_db):
    async def scenario(db):
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            prod_task = await _create(OWNER, title="Fix loom 4", assignee_id="u-prod")
            sales_task = await _create(OWNER, title="Call Kapoor", assignee_id="u-sales")

            # Finance (defaults, no grant): its own lane only, and the other task stays closed.
            fin_default = {k: v for k, v in FIN.items() if k != "permissions"}
            ids = _ids(await tasks.list_tasks(mine=False, user=fin_default))
            assert prod_task["id"] not in ids and sales_task["id"] not in ids
            await _refused(tasks.get_task(prod_task["id"], user=fin_default))

            # Sales without the grant: its lane.
            assert _ids(await tasks.list_tasks(mine=False, user=SALES)) == {sales_task["id"]}

            # Given "See all tasks": everything, and any task opens.
            seer = {**SALES, "permissions": BASE_PERMS + ["tasks_view_all"]}
            assert {prod_task["id"], sales_task["id"]} <= _ids(await tasks.list_tasks(mine=False, user=seer))
            assert (await tasks.get_task(prod_task["id"], user=seer))["id"] == prod_task["id"]
            # My Tasks stays theirs.
            assert _ids(await tasks.list_tasks(mine=True, user=seer)) == {sales_task["id"]}
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# Item 7 (plan 6.7) — who may change a task
# ---------------------------------------------------------------------------
def test_who_may_change_a_task(with_test_db):
    async def scenario(db):
        await _seed(db)
        await db.users.insert_one({**SALES2, "email": f"u-sales2@{T}.test", "created_at": now_iso()})
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            # Priya (sales) asks Kiran (sales), with Amit (her report) helping; proof needed.
            t = await _create(SALES, title="Pack the Kapoor samples", assignee_id="u-sales2", co_assignee_ids=["u-ops"])
            tid = t["id"]
            await db.tasks.update_one({"id": tid}, {"$set": {"evidence_required": True}})

            # Someone not on it changes nothing — not even a value it already has.
            detail = await _refused(tasks.update_task(tid, TaskUpdateInput(status="todo"), user=PROD))
            assert "leave a note" in detail
            assert await _status(db, tid) == ("todo", None, 0)

            # The helper moves the work, but does not finish, cancel or re-plan the task.
            await tasks.update_task(tid, TaskUpdateInput(status="in_progress", progress=40), user=OPS)
            assert await _status(db, tid) == ("in_progress", None, 40)
            assert "mark this task done" in await _refused(tasks.update_task(tid, TaskUpdateInput(status="done"), user=OPS))
            assert "cancel" in await _refused(tasks.update_task(tid, TaskUpdateInput(status="cancelled"), user=OPS))
            await _refused(tasks.update_task(tid, TaskUpdateInput(priority="high"), user=OPS))
            await _refused(tasks.update_task(tid, TaskUpdateInput(co_assignee_ids=[]), user=OPS))
            assert (await _status(db, tid))[0] == "in_progress"

            # The doer may not switch proof off, re-prioritise or change people.
            assert "proof" in await _refused(tasks.update_task(tid, TaskUpdateInput(evidence_required=False), user=SALES2))
            await _refused(tasks.update_task(tid, TaskUpdateInput(priority="high"), user=SALES2))
            await _refused(tasks.update_task(tid, TaskUpdateInput(co_assignee_ids=[]), user=SALES2))
            await _refused(tasks.update_task(tid, TaskUpdateInput(status="done"), user=SALES2), status=400)  # proof first

            # The person who asked switches proof off and raises the priority; the doer finishes.
            await tasks.update_task(tid, TaskUpdateInput(evidence_required=False, priority="high"), user=SALES)
            saved = await db.tasks.find_one({"id": tid}, {"_id": 0})
            assert saved["evidence_required"] is False and saved["priority"] == "high"
            await tasks.update_task(tid, TaskUpdateInput(status="done"), user=SALES2)
            assert (await _status(db, tid))[0] == "done"
            assert "reopen" in await _refused(tasks.update_task(tid, TaskUpdateInput(status="in_progress"), user=OPS))
            await tasks.update_task(tid, TaskUpdateInput(status="in_progress"), user=SALES)
            assert (await _status(db, tid))[0] == "in_progress"

            # See all tasks: opens it and leaves a note, changes nothing.
            seer = {**PROD, "permissions": BASE_PERMS + ["tasks_view_all"]}
            assert (await tasks.get_task(tid, user=seer))["id"] == tid
            await tasks.add_task_update(tid, TaskUpdateNoteInput(text="Customer called about this"), user=seer)
            await _refused(tasks.update_task(tid, TaskUpdateInput(status="todo"), user=seer))

            # Manage Team changes who is on it, but does not drive the work.
            admin = {**PROD, "permissions": BASE_PERMS + ["team_manage"]}
            await _refused(tasks.update_task(tid, TaskUpdateInput(progress=90), user=admin))
            out = await tasks.update_task(tid, TaskUpdateInput(co_assignee_ids=["u-ops", "u-prod"]), user=admin)
            assert set(out["co_assignee_ids"]) == {"u-ops", "u-prod"}

            # The named approver follows with notes (and the approval buttons), not edits.
            appr = await _create(OWNER, title="Dispatch the sample lot", assignee_id="u-ops",
                                 approval_required=True, approval_stage="close", approver_id="u-fin")
            await tasks.add_task_update(appr["id"], TaskUpdateNoteInput(text="Send the photos first"), user=FIN)
            await _refused(tasks.update_task(appr["id"], TaskUpdateInput(status="in_progress"), user=FIN))

            # The doer's manager runs the task — moves and finishes it — but proof stays with the asker.
            stock = await _create(OWNER, title="Count finished stock", assignee_id="u-ops")
            assert "proof" in await _refused(tasks.update_task(stock["id"], TaskUpdateInput(evidence_required=True), user=SALES))
            await tasks.update_task(stock["id"], TaskUpdateInput(status="done"), user=SALES)
            assert (await _status(db, stock["id"]))[0] == "done"
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


# ---------------------------------------------------------------------------
# Phase 7 (plan 7.1–7.3) — stuck work reaches the right person
# ---------------------------------------------------------------------------
def test_stuck_work_reaches_the_right_person(with_test_db):
    async def scenario(db):
        await _seed(db)
        alerts = []

        async def _zero(*a, **k):
            return 0

        async def _alert(tenant_id, msg):
            alerts.append(msg)
        stubs = {**STUBS, "services.finance_signals.db": db, "routers.desk.db": db,
                 "routers.access.sweep_expired_temp_grants": _zero,
                 "services.finance_signals.run_finance_actions": _zero,
                 "services.finance_signals.dispatch_owner_alert": _alert}
        with e2e_env(db, stubs=stubs, keep=KEEP):
            from datetime import datetime, timedelta, timezone
            import routers.desk as desk
            import services.finance_signals as fs
            now = datetime.now(timezone.utc)

            # Amit (operations) reports to Priya (sales); Ravi (production) has no manager.
            late = await _create(OWNER, title="Dye lot 7", assignee_id="u-ops", co_assignee_ids=["u-fin"])
            waiting = await _create(OWNER, title="Quote for Kapoor", assignee_id="u-ops")
            await tasks.update_task(waiting["id"], TaskUpdateInput(waiting_on={"user_id": "u-prod"}), user=OPS)
            approval = await _create(OWNER, title="Buy the dye", assignee_id="u-ops",
                                     approval_required=True, approval_stage="start", approver_id="u-fin")
            manager_step = await _create(OWNER, title="Ship the samples", assignee_id="u-ops")
            no_manager = await _create(OWNER, title="Fix loom 4", assignee_id="u-prod")
            owner_step = await _create(OWNER, title="Collect the Kapoor payment", assignee_id="u-ops")
            hours = {late["id"]: 1, waiting["id"]: 1, approval["id"]: 1,
                     manager_step["id"]: 60, no_manager["id"]: 60, owner_step["id"]: 100}
            for tid, h in hours.items():
                await db.tasks.update_one({"id": tid}, {"$set": {
                    "due_date": (now - timedelta(hours=h)).isoformat(), "escalation_level": 0}})
            await db.notifications.delete_many({})
            fs._followup_last_run.pop(T, None)
            await fs.run_followup(T)

            async def heard(tid):
                return {n["user_id"] async for n in db.notifications.find({"entity_id": tid}, {"_id": 0, "user_id": 1})}

            # Overdue: the people who can move it.
            assert await heard(late["id"]) == {"u-ops", "u-fin"}
            assert await heard(waiting["id"]) == {"u-ops", "u-prod"}, "the colleague it waits on hears too"
            assert await heard(approval["id"]) == {"u-fin"}, "waiting for approval: the approver, not the locked doer"
            # Two days: the doer's manager, not the owner — unless nobody manages the doer.
            assert await heard(manager_step["id"]) == {"u-sales"}
            assert await heard(no_manager["id"]) == {"u-owner"}
            # Four days: the owner, with the owner alert.
            assert await heard(owner_step["id"]) == {"u-owner"} and len(alerts) == 1
            levels = {t["id"]: t["escalation_level"] async for t in db.tasks.find({"id": {"$in": list(hours)}}, {"_id": 0})}
            assert levels == {late["id"]: 1, waiting["id"]: 1, approval["id"]: 1,
                              manager_step["id"]: 3, no_manager["id"]: 3, owner_step["id"]: 4}, levels

            # Escalate: Amit's goes to Priya (his manager); Priya has none, so hers goes to the owner.
            await tasks.add_task_update(late["id"], TaskUpdateNoteInput(text="Dye supplier is not answering",
                                                                        action="escalate"), user=OPS)
            follow = await db.tasks.find_one({"parent_task_id": late["id"], "source": "escalation"}, {"_id": 0})
            assert follow["assignee_id"] == "u-sales", follow
            mine = await _create(SALES, title="Book the courier", assignee_id="u-sales")
            await tasks.add_task_update(mine["id"], TaskUpdateNoteInput(text="Courier desk closed",
                                                                        action="escalate"), user=SALES)
            assert (await db.tasks.find_one({"parent_task_id": mine["id"]}, {"_id": 0}))["assignee_id"] == "u-owner"

            # Desk Slipping for Priya: the escalation to her, and her report's work from the
            # manager step (2+ days), not the task only an hour late.
            cards = {c["id"]: c for c in await desk._cards_on_fire(T, SALES)}
            assert cards[late["id"]]["kind"] == "task_escalation"
            assert "Escalated by Amit" in cards[late["id"]]["context_line"]
            assert cards[manager_step["id"]]["kind"] == "task_overdue"
            assert "Reports to you" in cards[manager_step["id"]]["context_line"]
            assert waiting["id"] not in cards and approval["id"] not in cards
            assert no_manager["id"] not in cards, "not her report"
            return True
    assert with_test_db(scenario) is True

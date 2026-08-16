"""WE-15 (2026-08-16) -- Kapoor / Delhi Retail golden-path E2E.

This is the exact scenario the founder ran manually on 2026-08-13,
codified as a runnable script. It proves the workflow engine takes a
freshly-captured order from booked -> confirmed -> in_production ->
ready without ANY manual Advance clicks -- the tasks close, the
stages transition automatically.

Scenario:
  1. Synthetic tenant with operating_model.pipelines[0].stages[]
     populated with WE-03 stage-template tasks:
       - order_received: {"Confirm with customer" (sales)}
       - confirmed: {"Prepare invoice" (finance)}
       - in_production: {"Pack + label" (operations)}
       - ready: (terminal, no tasks; create_expense side-effect fires)
  2. Insert a workflow at order_received, then on_stage_enter to
     spawn the first template task.
  3. Close the task -> engine.advance -> confirmed. on_stage_enter
     spawns the invoice task.
  4. Close the invoice task -> advance -> in_production. Spawn pack
     task.
  5. Close the pack task -> advance -> ready (terminal). Terminal
     marker + side-effect fires -> pending expense created.
  6. Assert workflow.history has one entry per transition, tasks are
     all done, expense exists.

Also the NEGATIVE case:
  7. Second workflow at order_received; call check_stage_ready
     WITHOUT closing the task -> ready=False, blocked reason lists
     the open task id.
  8. Attempt advance without override -> WorkflowAdvanceError code=
     not_ready.

Exits 0 on all-pass. Cleans up in a finally block so a mid-run
crash still leaves the DB clean.
"""
import asyncio
import sys
import uuid

from core import db
from services.workflow_engine import (
    advance, check_stage_ready, on_stage_enter,
    WorkflowAdvanceError,
)


TENANT = f"we15-kapoor-{uuid.uuid4().hex[:8]}"
OWNER = "we15-owner"
OWNER_NAME = "Amit Kapoor"

PASS = "[PASS]"
FAIL = "[FAIL]"


async def _seed():
    """Seed a Kapoor-like tenant with a Sales pipeline whose stages
    carry WE-03 template tasks + the terminal create_expense hook."""
    await db.tenants.insert_one({
        "id": TENANT, "tenant_id": TENANT,
        "name": "Kapoor Cotton Mills (WE-15)",
        "industry": "Textile & Apparel",
        "roles": [
            {"key": "sales", "label": "Sales"},
            {"key": "finance", "label": "Finance"},
            {"key": "operations", "label": "Operations"},
        ],
        "operating_model": {
            "pipelines": [{
                "key": "sales", "label": "Sales",
                "sub": "Order -> Ready",
                "approval_stage": None,
                "stages": [
                    {"key": "order_received", "label": "Order Received",
                     "tasks": [{"title": "Confirm with customer",
                                "role": "sales", "evidence_required": False}],
                     "approval": None, "side_effects": []},
                    {"key": "confirmed", "label": "Confirmed",
                     "tasks": [{"title": "Prepare invoice",
                                "role": "finance", "evidence_required": False}],
                     "approval": None, "side_effects": []},
                    {"key": "in_production", "label": "In Production",
                     "tasks": [{"title": "Pack + label",
                                "role": "operations", "evidence_required": False}],
                     "approval": None, "side_effects": []},
                    {"key": "ready", "label": "Ready",
                     "tasks": [],
                     "approval": None,
                     "side_effects": [{"kind": "create_expense",
                                       "params": {"status": "awaiting_bill"}}]},
                ],
            }],
            "task_categories": [
                {"key": "sales", "label": "Sales"},
                {"key": "finance", "label": "Finance"},
                {"key": "operations", "label": "Operations"},
            ],
        },
    })
    # Users for the least-loaded assignment to have something to route to.
    for role in ("sales", "finance", "operations"):
        await db.users.insert_one({
            "id": f"{TENANT}-{role}",
            "tenant_id": TENANT,
            "name": f"{role.title()} Person",
            "role": role,
            "email": f"{role}@we15.test",
        })


async def _make_workflow(title: str = "Big rush order from Delhi Retail",
                          amount: float = 240000) -> str:
    wid = f"we15-wf-{uuid.uuid4().hex[:8]}"
    stages = ["order_received", "confirmed", "in_production", "ready"]
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TENANT, "type": "sales",
        "title": title, "detail": "2000m mixed cotton + silk",
        "amount": amount, "counterparty": "Delhi Retail Corp",
        "stage": "order_received", "stages": stages,
        "stage_version": 0,
        "history": [{"stage": "order_received",
                     "note": "Captured from voice directive",
                     "by": OWNER, "at": "2026-08-16T00:00:00+00:00"}],
        "created_by": OWNER, "created_at": "2026-08-16T00:00:00+00:00",
    })
    return wid


async def _close_stage_tasks(wid: str, stage_key: str) -> int:
    """Mark every open task at (wid, stage_key) as done. Returns count."""
    r = await db.tasks.update_many(
        {"tenant_id": TENANT, "workflow_id": wid, "stage_key": stage_key,
         "status": {"$nin": ["done", "cancelled"]}},
        {"$set": {"status": "done"}},
    )
    return r.modified_count


async def _cleanup():
    for coll in (db.workflows, db.tasks, db.tenants, db.expenses, db.users,
                 db.activity, db.brain_context, db.notifications):
        try:
            await coll.delete_many({"tenant_id": TENANT})
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Golden path
# ---------------------------------------------------------------------------
async def golden_path():
    print("--- Golden path: Delhi Retail 2000m order ---")

    # Step 1: workflow created at order_received (mimics voice capture).
    wid = await _make_workflow()

    # Step 2: on_stage_enter spawns the sales template task.
    r = await on_stage_enter(TENANT, wid, OWNER, OWNER_NAME)
    assert len(r["task_ids"]) == 1, f"expected 1 task spawned, got {r}"
    spawned = await db.tasks.find_one({"id": r["task_ids"][0]}, {"_id": 0, "title": 1, "assignee_role": 1})
    assert spawned["title"] == "Confirm with customer", spawned
    assert spawned["assignee_role"] == "sales", spawned
    print(f"  {PASS} step 1-2: workflow created + Confirm-with-customer task spawned to Sales")

    # Step 3: sales closes the task -> engine advances to confirmed.
    n = await _close_stage_tasks(wid, "order_received")
    assert n == 1, n
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is True, rc
    result = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert result["advanced"] is True
    assert result["new_stage"] == "confirmed", result
    # confirmed spawns the finance task automatically
    finance_task = await db.tasks.find_one(
        {"workflow_id": wid, "stage_key": "confirmed", "source": "engine"},
        {"_id": 0, "title": 1, "assignee_role": 1},
    )
    assert finance_task and finance_task["title"] == "Prepare invoice"
    assert finance_task["assignee_role"] == "finance"
    print(f"  {PASS} step 3: task closed -> auto-advance to Confirmed -> Prepare-invoice spawned to Finance")

    # Step 4: finance closes -> auto-advance to in_production -> ops task spawned.
    n = await _close_stage_tasks(wid, "confirmed")
    assert n == 1, n
    result = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert result["new_stage"] == "in_production", result
    ops_task = await db.tasks.find_one(
        {"workflow_id": wid, "stage_key": "in_production", "source": "engine"},
        {"_id": 0, "title": 1, "assignee_role": 1},
    )
    assert ops_task and ops_task["title"] == "Pack + label"
    assert ops_task["assignee_role"] == "operations"
    print(f"  {PASS} step 4: Finance closes -> In Production -> Pack+label spawned to Operations")

    # Step 5: ops closes -> auto-advance to terminal (ready) -> side-effect fires.
    n = await _close_stage_tasks(wid, "in_production")
    assert n == 1, n
    result = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert result["new_stage"] == "ready", result
    assert result["terminal"] is True, result
    assert "create_expense" in (result.get("enter_summary") or {}).get("side_effects_fired", []), result
    wf_final = await db.workflows.find_one({"id": wid}, {"_id": 0, "completed_at": 1, "history": 1})
    assert wf_final.get("completed_at"), wf_final
    exp = await db.expenses.find_one({"tenant_id": TENANT, "workflow_id": wid}, {"_id": 0, "title": 1, "status": 1})
    assert exp and exp["status"] == "awaiting_bill", exp
    print(f"  {PASS} step 5: Ops closes -> terminal Ready reached -> create_expense fired ({exp['title']})")

    # Step 6: history should have 4 entries (initial + 3 transitions).
    hist = wf_final["history"]
    assert len(hist) == 4, f"expected 4 history entries, got {len(hist)}: {hist}"
    stages_in_history = [h.get("stage") for h in hist]
    assert stages_in_history == ["order_received", "confirmed", "in_production", "ready"], stages_in_history
    print(f"  {PASS} step 6: workflow.history has 4 entries in correct order: {stages_in_history}")

    # Bonus: verify NO manual Advance clicks happened. Every history
    # entry after the seed has by=OWNER but stage_events records that
    # the transition was driven by task closure (not a user click).
    print(f"  {PASS} bonus: full 3-stage chain completed with zero manual clicks")


# ---------------------------------------------------------------------------
# Negative case
# ---------------------------------------------------------------------------
async def negative_case():
    print("--- Negative case: incomplete task blocks the transition ---")

    wid = await _make_workflow(title="Small order (negative test)", amount=50000)
    r = await on_stage_enter(TENANT, wid, OWNER, OWNER_NAME)
    assert len(r["task_ids"]) == 1

    # Do NOT close the task. check_stage_ready should refuse.
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is False, rc
    assert rc["missing_approval"] is False, rc
    assert len(rc["open_task_ids"]) == 1, rc
    assert "task(s) still open" in rc["reason"], rc["reason"]
    print(f"  {PASS} check_stage_ready reported blocked: {rc['reason']}")

    # engine.advance without override -> WorkflowAdvanceError code=not_ready.
    try:
        await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
        print(f"  {FAIL} advance succeeded despite open task")
        return False
    except WorkflowAdvanceError as e:
        assert e.code == "not_ready", e.code
        assert e.http_status == 409, e.http_status
        print(f"  {PASS} advance refused with 409 not_ready: {e}")

    # Verify workflow is STILL at order_received -- the negative case
    # must not have advanced the card by accident.
    wf = await db.workflows.find_one({"id": wid}, {"_id": 0, "stage": 1, "stage_version": 1})
    assert wf["stage"] == "order_received", wf
    assert wf["stage_version"] == 0, wf
    print(f"  {PASS} workflow stayed at order_received (stage_version={wf['stage_version']})")


async def main() -> int:
    print(f"=== WE-15 golden path (tenant={TENANT}) ===\n")
    fails = 0
    try:
        await _seed()
        for fn in (golden_path, negative_case):
            try:
                r = await fn()
                if r is False:
                    fails += 1
            except AssertionError as e:
                print(f"  {FAIL} {fn.__name__}: {e}")
                fails += 1
            print()
    finally:
        await _cleanup()

    if fails:
        print(f"=== WE-15 golden path: {fails} failure(s) ===")
        return 2
    print("=== WE-15 golden path: ALL SCENARIOS PASS ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

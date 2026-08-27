"""WE-01.5 -- role-routed voice-task E2E (2026-08-16).

Simulates what process_voice_note does for 5 distinct decision types,
verifies each spawned task lands at its ROLE-OWNED stage, then walks
the full auto-advance chain by closing tasks one at a time and
confirming the engine advances the card to the next stage where the
next task is already waiting.

Scenarios:
  1. Kapoor sales order (3 tasks: sales/finance/ops) -> full chain
  2. Procurement with owner approval (3 tasks + approval gate)
  3. Ad-hoc single-task decision (1 task, stays put till close)
  4. Multi-role decision where one role has no matching stage
     (that task falls back to workflow's current stage)
  5. Two tasks share the same role -> both land at the same stage,
     both must close before advance

Every scenario uses a fresh synthetic tenant so real data is untouched.
Cleans up in a finally block.
"""
import asyncio
import sys
import uuid
from typing import Optional

from core import db
from services.workflows import stage_owned_by
from services.workflow_engine import (
    advance, check_stage_ready, record_stage_approval, WorkflowAdvanceError,
)


TENANT = f"we015-{uuid.uuid4().hex[:8]}"
OWNER = "we015-amit"
OWNER_NAME = "Amit"
PASS = "[PASS]"
FAIL = "[FAIL]"


async def _cleanup():
    for coll in (db.workflows, db.tasks, db.tenants, db.expenses,
                 db.notifications, db.activity, db.brain_context, db.users):
        try:
            await coll.delete_many({"tenant_id": TENANT})
        except Exception:
            pass


async def _seed_tenant():
    """Kapoor-style tenant with Sales + Procurement pipelines, each
    stage tagged with its owning role (mimics WE-01.5-aware AI output)."""
    await db.tenants.insert_one({
        "id": TENANT, "tenant_id": TENANT,
        "name": "WE-01.5 Verify Tenant",
        "industry": "Textile & Apparel",
        "roles": [
            {"key": "sales", "label": "Sales"},
            {"key": "finance", "label": "Finance"},
            {"key": "operations", "label": "Operations"},
        ],
        "operating_model": {
            "pipelines": [
                {
                    "key": "sales", "label": "Sales", "sub": "Order -> Ready",
                    "approval_stage": None,
                    "stages": [
                        {"key": "order_received", "label": "Order Received",
                         "role": "sales", "tasks": [], "approval": None, "side_effects": []},
                        {"key": "confirmed", "label": "Confirmed",
                         "role": "finance", "tasks": [], "approval": None, "side_effects": []},
                        {"key": "in_production", "label": "In Production",
                         "role": "operations", "tasks": [], "approval": None, "side_effects": []},
                        {"key": "ready", "label": "Ready",
                         "role": "operations", "tasks": [], "approval": None, "side_effects": []},
                    ],
                },
                {
                    "key": "procurement", "label": "Procurement",
                    "sub": "Requested -> Paid",
                    "approval_stage": "approved",
                    "stages": [
                        {"key": "requested", "label": "Requested",
                         "role": "operations", "tasks": [], "approval": None, "side_effects": []},
                        {"key": "approved", "label": "Approved",
                         "role": "owner", "tasks": [],
                         "approval": {"role": "owner", "required": True},
                         "side_effects": []},
                        {"key": "received", "label": "Received",
                         "role": "operations", "tasks": [], "approval": None, "side_effects": []},
                        {"key": "paid", "label": "Paid",
                         "role": "finance", "tasks": [], "approval": None,
                         "side_effects": [{"kind": "create_expense",
                                           "params": {"status": "awaiting_bill"}}]},
                    ],
                },
            ],
            "task_categories": [
                {"key": "sales", "label": "Sales"},
                {"key": "finance", "label": "Finance"},
                {"key": "operations", "label": "Operations"},
            ],
        },
    })
    # Seed a user per role for pick_least_loaded_member (used by engine
    # spawning) plus voice-capture assignment.
    for role in ("sales", "finance", "operations"):
        await db.users.insert_one({
            "id": f"{TENANT}-{role}", "tenant_id": TENANT,
            "name": f"{role.title()} Person", "role": role,
            "email": f"{role}-{TENANT}@we015.test",
        })


async def _make_wf(wf_type: str = "sales",
                    stages_list: Optional[list] = None,
                    start_stage: Optional[str] = None) -> str:
    """Simulate _create_workflows insert: workflow at initial stage."""
    if stages_list is None:
        stages_list = ["order_received", "confirmed", "in_production", "ready"] if wf_type == "sales" \
            else ["requested", "approved", "received", "paid"]
    if start_stage is None:
        start_stage = stages_list[0]
    wid = f"{TENANT}-wf-{uuid.uuid4().hex[:8]}"
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TENANT, "type": wf_type,
        "title": f"WE-01.5 {wf_type} order",
        "amount": 100000, "counterparty": "Test Corp",
        "stage": start_stage, "stages": stages_list,
        "stage_version": 0,
        "history": [{"stage": start_stage, "note": "seed", "by": OWNER,
                     "at": "2026-08-16T00:00:00+00:00"}],
        "created_by": OWNER, "created_at": "2026-08-16T00:00:00+00:00",
    })
    return wid


async def _make_tasks_and_route(wf_id: str, wf_type: str,
                                 tasks_spec: list) -> list:
    """Simulate _create_decision_tasks + WE-01.5 post-pass. tasks_spec
    is a list of {title, role} dicts. Each task is inserted with the
    role assigned, then the WE-01.5 routing logic assigns
    workflow_id + stage_key based on stage_owned_by(pipeline, role)."""
    tenant = await db.tenants.find_one({"id": TENANT}, {"_id": 0, "operating_model": 1})
    pipeline = next((p for p in (tenant.get("operating_model") or {}).get("pipelines") or []
                     if p.get("key") == wf_type), None)
    wf = await db.workflows.find_one({"id": wf_id}, {"_id": 0, "stage": 1})
    fallback_stage = wf.get("stage")

    task_ids = []
    for spec in tasks_spec:
        tid = f"{TENANT}-tk-{uuid.uuid4().hex[:8]}"
        assignee_id = f"{TENANT}-{spec['role']}" if spec.get("role") in ("sales", "finance", "operations") else None
        await db.tasks.insert_one({
            "id": tid, "tenant_id": TENANT,
            "title": spec["title"],
            "assignee_role": spec.get("role"),
            "assignee_id": assignee_id,
            "priority": "medium", "status": "todo",
            "decision_id": f"{TENANT}-dec-x",
            "source": "voice",
            "workflow_id": None, "stage_key": None,  # pre-route
            "created_by": OWNER, "created_at": "2026-08-16T00:00:00+00:00",
        })
        task_ids.append(tid)

    # The WE-01.5 routing logic (mirror of what process_voice_note does)
    for tid in task_ids:
        t = await db.tasks.find_one({"id": tid}, {"_id": 0, "assignee_role": 1})
        role = (t.get("assignee_role") or "").strip()
        stage_key = stage_owned_by(pipeline, role) or fallback_stage
        await db.tasks.update_one(
            {"id": tid, "tenant_id": TENANT},
            {"$set": {"workflow_id": wf_id, "stage_key": stage_key}},
        )
    return task_ids


async def _close_stage_tasks(wid: str, stage_key: str) -> int:
    r = await db.tasks.update_many(
        {"tenant_id": TENANT, "workflow_id": wid, "stage_key": stage_key,
         "status": {"$nin": ["done", "cancelled"]}},
        {"$set": {"status": "done"}},
    )
    return r.modified_count


# ---------------------------------------------------------------------------
# Scenario 1: Kapoor sales order (sales/finance/ops)
# ---------------------------------------------------------------------------
async def scenario_1_kapoor_sales_multi_role():
    print("--- Scenario 1: Kapoor sales order (3 tasks across 3 roles) ---")
    wid = await _make_wf("sales")
    task_ids = await _make_tasks_and_route(wid, "sales", [
        {"title": "Confirm with Delhi Retail", "role": "sales"},
        {"title": "Prepare invoice", "role": "finance"},
        {"title": "Pack + label 2000m bundle", "role": "operations"},
    ])
    # Verify routing: each task landed at its role's stage
    tasks = await db.tasks.find(
        {"id": {"$in": task_ids}}, {"_id": 0, "title": 1, "stage_key": 1, "assignee_role": 1},
    ).to_list(3)
    routing = {t["assignee_role"]: t["stage_key"] for t in tasks}
    assert routing == {
        "sales": "order_received",
        "finance": "confirmed",
        "operations": "in_production",
    }, routing
    print(f"  {PASS} routing: {routing}")

    # Now walk the chain
    await _close_stage_tasks(wid, "order_received")
    r1 = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r1["new_stage"] == "confirmed"
    print(f"  {PASS} sales closes -> auto-advance to Confirmed (finance task already waiting)")

    await _close_stage_tasks(wid, "confirmed")
    r2 = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r2["new_stage"] == "in_production"
    print(f"  {PASS} finance closes -> auto-advance to In Production (ops task already waiting)")

    await _close_stage_tasks(wid, "in_production")
    r3 = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r3["new_stage"] == "ready"
    assert r3["terminal"] is True
    print(f"  {PASS} ops closes -> auto-advance to Ready (terminal)")

    print(f"  {PASS} FULL CHAIN: order_received -> confirmed -> in_production -> ready with 3 task-closes\n")


# ---------------------------------------------------------------------------
# Scenario 2: Procurement with owner approval
# ---------------------------------------------------------------------------
async def scenario_2_procurement_with_approval():
    print("--- Scenario 2: Procurement with owner approval gate ---")
    wid = await _make_wf("procurement")
    task_ids = await _make_tasks_and_route(wid, "procurement", [
        {"title": "Request 500 spindles from Rajesh Traders", "role": "operations"},
        {"title": "Approve purchase (owner sign-off)", "role": "owner"},
        {"title": "Confirm receipt of goods", "role": "operations"},
        {"title": "Pay vendor invoice", "role": "finance"},
    ])
    tasks = await db.tasks.find(
        {"id": {"$in": task_ids}}, {"_id": 0, "assignee_role": 1, "stage_key": 1},
    ).to_list(4)
    routing = [(t["assignee_role"], t["stage_key"]) for t in tasks]
    print(f"  {PASS} routing (role, stage): {routing}")
    # ops -> requested (or received; there are two ops stages -- first one wins in the resolver)
    # owner -> approved
    # finance -> paid
    assert ("owner", "approved") in routing, routing
    assert ("finance", "paid") in routing, routing

    # Walk: close requested tasks -> advance to approved (owner-only gate,
    # but we ARE owner, so this succeeds). The stage.approval on
    # 'approved' gates advance OUT of approved, not INTO it.
    await _close_stage_tasks(wid, "requested")
    r = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r["new_stage"] == "approved", r
    print(f"  {PASS} requested closed -> owner advances to approved (owner-only gate passed)")

    # Try to advance OUT of approved without recording the stage approval.
    # There's an owner task at approved, close it first.
    await _close_stage_tasks(wid, "approved")
    try:
        await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
        print(f"  {FAIL} advance out of approved succeeded without approval record"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "not_ready", e.code
        assert "approval" in str(e).lower(), e
        print(f"  {PASS} approved -> received blocked (needs stage approval): {e}")

    # Record the approval AT the approved stage
    r_appr = await record_stage_approval(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r_appr["ok"] is True, r_appr
    r2 = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r2["new_stage"] == "received"
    print(f"  {PASS} approval recorded -> approved -> received")

    await _close_stage_tasks(wid, "received")
    r3 = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r3["new_stage"] == "paid" and r3["terminal"] is True
    print(f"  {PASS} received -> paid (terminal, create_expense side-effect fires)")

    exp = await db.expenses.find_one({"tenant_id": TENANT, "workflow_id": wid})
    assert exp is not None, "create_expense didn't fire at terminal"
    print(f"  {PASS} auto-expense created: '{exp.get('title')}'\n")


# ---------------------------------------------------------------------------
# Scenario 3: Ad-hoc single-task decision
# ---------------------------------------------------------------------------
async def scenario_3_single_task():
    print("--- Scenario 3: Single-task sales decision ---")
    wid = await _make_wf("sales")
    task_ids = await _make_tasks_and_route(wid, "sales", [
        {"title": "Call customer to update timeline", "role": "sales"},
    ])
    t = await db.tasks.find_one({"id": task_ids[0]}, {"_id": 0, "stage_key": 1})
    assert t["stage_key"] == "order_received"
    # Not closed yet: check_stage_ready must refuse
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is False
    print(f"  {PASS} single unclosed task blocks: {rc['reason']}")

    await _close_stage_tasks(wid, "order_received")
    r = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r["new_stage"] == "confirmed"
    # Now at confirmed with NO tasks. Ready true (nothing gating).
    # Card would auto-advance but only if someone calls advance again.
    rc2 = await check_stage_ready(TENANT, wid)
    assert rc2["ready"] is True
    print(f"  {PASS} single task closes -> advance to Confirmed (stalls there, no tasks to trigger next)\n")


# ---------------------------------------------------------------------------
# Scenario 4: Role has no matching stage -> fallback to current stage
# ---------------------------------------------------------------------------
async def scenario_4_role_no_match():
    print("--- Scenario 4: Task with role that has no matching stage ---")
    wid = await _make_wf("sales")
    # 'hr' is not a role owned by any Sales stage
    task_ids = await _make_tasks_and_route(wid, "sales", [
        {"title": "HR onboarding paperwork for new sales hire", "role": "hr"},
    ])
    t = await db.tasks.find_one({"id": task_ids[0]}, {"_id": 0, "stage_key": 1})
    # Falls back to the workflow's current stage (order_received)
    assert t["stage_key"] == "order_received", t
    print(f"  {PASS} unmatched role falls back to current stage: {t['stage_key']}\n")


# ---------------------------------------------------------------------------
# Scenario 5: Two tasks share the same role -> both at same stage
# ---------------------------------------------------------------------------
async def scenario_5_same_role_multiple_tasks():
    print("--- Scenario 5: Multiple tasks with the same role ---")
    wid = await _make_wf("sales")
    task_ids = await _make_tasks_and_route(wid, "sales", [
        {"title": "Call Delhi Retail to confirm", "role": "sales"},
        {"title": "Verify credit line with bank", "role": "sales"},
    ])
    tasks = await db.tasks.find(
        {"id": {"$in": task_ids}}, {"_id": 0, "stage_key": 1, "title": 1},
    ).to_list(2)
    stages = {t["stage_key"] for t in tasks}
    assert stages == {"order_received"}, stages
    print(f"  {PASS} both same-role tasks at order_received (as expected)")

    # Close only ONE -> stage still blocked
    await db.tasks.update_one({"id": task_ids[0]}, {"$set": {"status": "done"}})
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is False and len(rc["open_task_ids"]) == 1
    print(f"  {PASS} 1/2 closed -> stage still blocked: {rc['reason']}")

    # Close the second -> ready + advances
    await db.tasks.update_one({"id": task_ids[1]}, {"$set": {"status": "done"}})
    r = await advance(TENANT, wid, OWNER, OWNER_NAME, "owner")
    assert r["new_stage"] == "confirmed"
    print(f"  {PASS} 2/2 closed -> auto-advance to Confirmed\n")


# ---------------------------------------------------------------------------
# Bonus: pure-Python stage_owned_by resolver tests
# ---------------------------------------------------------------------------
async def scenario_0_resolver_unit_tests():
    print("--- Scenario 0: stage_owned_by resolver logic ---")
    pipeline = {
        "key": "test", "stages": [
            {"key": "a", "role": "sales", "tasks": []},
            {"key": "b", "role": "", "tasks": [{"title": "x", "role": "finance"}]},
            {"key": "c", "role": "operations", "tasks": []},
        ],
    }
    assert stage_owned_by(pipeline, "sales") == "a"        # explicit
    assert stage_owned_by(pipeline, "finance") == "b"       # derived from task
    assert stage_owned_by(pipeline, "operations") == "c"
    assert stage_owned_by(pipeline, "hr") is None           # no match
    assert stage_owned_by(pipeline, "") is None             # empty role
    assert stage_owned_by(None, "sales") is None            # no pipeline
    print(f"  {PASS} resolver: explicit / task-derived / no-match / empty / None-pipeline all correct\n")


async def main() -> int:
    print(f"=== WE-01.5 role-routing E2E (tenant={TENANT}) ===\n")
    fails = 0
    try:
        await _seed_tenant()
        for fn in (
            scenario_0_resolver_unit_tests,
            scenario_1_kapoor_sales_multi_role,
            scenario_2_procurement_with_approval,
            scenario_3_single_task,
            scenario_4_role_no_match,
            scenario_5_same_role_multiple_tasks,
        ):
            try:
                r = await fn()
                if r is False:
                    fails += 1
            except AssertionError as e:
                print(f"  {FAIL} {fn.__name__}: {e}")
                fails += 1
    finally:
        await _cleanup()

    if fails:
        print(f"=== WE-01.5 E2E: {fails} failure(s) ===")
        return 2
    print("=== WE-01.5 E2E: ALL SCENARIOS PASS ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

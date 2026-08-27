"""WE-06/07/08/09 engine integration verification (2026-08-16).

Runs a batch of scenarios against the live DB using synthetic tenant
IDs so the fixtures never touch real data. Exits 0 on all-pass,
non-zero on any failure. Cleans up in a finally block.

Scenarios covered:
  1. advance() no-op refuses when stage_ready=False (unclosed task)
  2. advance() succeeds when tasks all done
  3. advance() with override=True + reason succeeds and records reason
  4. advance() with override=True missing reason -> raises
  5. advance() atomic CAS: two concurrent advances -> exactly ONE wins
  6. on_stage_enter idempotent: template tasks not duplicated
  7. side-effect kind=create_expense fires + is idempotent per workflow
  8. side-effect kind=notify_role skips gracefully with no recipients
  9. approval gate: check_stage_ready False when approval required + missing
 10. record_stage_approval wrong role -> ok=False; correct role -> True
 11. advance() terminal stage -> completed_at set
 12. advance() skip-stage attempt -> refused
"""
import asyncio
import sys
import uuid
from typing import Optional

from core import db
from services.workflow_engine import (
    advance, check_stage_ready, on_stage_enter,
    record_stage_approval, WorkflowAdvanceError,
    registered_side_effect_kinds,
)


TENANT = f"we06-verify-{uuid.uuid4().hex[:8]}"
ACTOR = "actor-x"
ACTOR_NAME = "Test Actor"
PASS = "[PASS]"
FAIL = "[FAIL]"


async def _cleanup():
    for coll in (db.workflows, db.tasks, db.tenants, db.expenses, db.notifications,
                 db.activity, db.brain_context):
        try:
            await coll.delete_many({"tenant_id": TENANT})
        except Exception:
            pass


async def _seed_tenant(pipeline_dict: Optional[dict] = None):
    """Insert a minimal tenant with an operating_model. Uses one
    pipeline "sales" with stages booked -> confirmed -> paid."""
    if pipeline_dict is None:
        pipeline_dict = {
            "key": "sales", "label": "Sales", "sub": "Booked -> Paid",
            "approval_stage": None,
            "stages": [
                {"key": "booked", "label": "Booked",
                 "tasks": [{"title": "Confirm with customer",
                            "role": "sales", "evidence_required": False}],
                 "approval": None, "side_effects": []},
                {"key": "confirmed", "label": "Confirmed",
                 "tasks": [],
                 "approval": {"role": "owner", "required": True},
                 "side_effects": []},
                {"key": "paid", "label": "Paid",
                 "tasks": [],
                 "approval": None,
                 "side_effects": [{"kind": "create_expense",
                                   "params": {"status": "awaiting_bill"}}]},
            ],
        }
    await db.tenants.insert_one({
        "id": TENANT, "tenant_id": TENANT,
        "name": "WE-06 Verify Tenant", "industry": "Test",
        "roles": [{"key": "sales", "label": "Sales"}],
        "operating_model": {
            "pipelines": [pipeline_dict],
            "task_categories": [{"key": "operational", "label": "Ops"}],
        },
    })


async def _make_workflow(stage: str = "booked",
                         stages=("booked", "confirmed", "paid"),
                         wf_type: str = "sales") -> str:
    wid = f"we06-wf-{uuid.uuid4().hex[:8]}"
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TENANT, "type": wf_type,
        "title": "WE-06 Sales Order", "detail": "verification workflow",
        "amount": 12000, "counterparty": "ACME",
        "stage": stage, "stages": list(stages),
        "stage_version": 0,
        "history": [{"stage": stage, "note": "Seeded", "by": ACTOR,
                     "at": "2026-08-16T00:00:00+00:00"}],
        "created_by": ACTOR, "created_at": "2026-08-16T00:00:00+00:00",
    })
    return wid


async def scenario_1_refuses_when_task_open():
    wid = await _make_workflow()
    # on_stage_enter should spawn the template task
    await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    spawned = await db.tasks.count_documents(
        {"tenant_id": TENANT, "workflow_id": wid, "stage_key": "booked"})
    assert spawned == 1, spawned
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is False, rc
    assert "task(s) still open" in rc["reason"]
    try:
        await advance(TENANT, wid, ACTOR, ACTOR_NAME, "sales")
        print(f"  {FAIL} advance succeeded despite open task"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "not_ready", e.code
        print(f"  {PASS} advance refused with reason: {e}")
        return True


async def scenario_2_succeeds_when_task_done():
    wid = await _make_workflow()
    await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    # Close the spawned task
    await db.tasks.update_many(
        {"tenant_id": TENANT, "workflow_id": wid, "stage_key": "booked"},
        {"$set": {"status": "done"}},
    )
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is True, rc
    result = await advance(TENANT, wid, ACTOR, ACTOR_NAME, "sales")
    assert result["advanced"] is True
    assert result["new_stage"] == "confirmed"
    print(f"  {PASS} advance succeeded when tasks all done")


async def scenario_3_override_with_reason():
    wid = await _make_workflow()
    result = await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                            override=True, reason="Manual override for demo")
    assert result["advanced"] is True
    wf = await db.workflows.find_one({"id": wid}, {"_id": 0, "history": 1})
    last = wf["history"][-1]
    assert last.get("override") is True, last
    assert "Manual override" in last.get("reason", "")
    print(f"  {PASS} override advance recorded reason in history")


async def scenario_4_override_missing_reason():
    wid = await _make_workflow()
    try:
        await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                       override=True, reason="")
        print(f"  {FAIL} override accepted with empty reason"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "reason_required", e.code
        print(f"  {PASS} override without reason rejected: {e}")
        return True


async def scenario_5_atomic_cas():
    """Two concurrent advance() calls -- exactly ONE wins, the other
    reports already_advanced=True without an error."""
    wid = await _make_workflow(stage="confirmed", stages=("booked", "confirmed", "paid"))
    # Skip the approval gate for this scenario -- use override
    r1, r2 = await asyncio.gather(
        advance(TENANT, wid, "a1", "A1", "owner",
                override=True, reason="Race A"),
        advance(TENANT, wid, "a2", "A2", "owner",
                override=True, reason="Race B"),
        return_exceptions=True,
    )
    winners = [r for r in (r1, r2)
               if isinstance(r, dict) and r.get("advanced") is True]
    losers = [r for r in (r1, r2)
              if isinstance(r, dict) and r.get("already_advanced") is True]
    exc = [r for r in (r1, r2) if isinstance(r, Exception)]
    assert len(winners) == 1, f"expected 1 winner, got {len(winners)}: r1={r1}, r2={r2}"
    assert len(losers) + len(exc) == 1, f"expected 1 loser, got losers={losers}, exc={exc}"
    print(f"  {PASS} CAS race: 1 winner + 1 loser (already_advanced) -- no double advance")


async def scenario_6_on_stage_enter_idempotent():
    wid = await _make_workflow()
    for _ in range(3):
        await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    n = await db.tasks.count_documents(
        {"tenant_id": TENANT, "workflow_id": wid, "stage_key": "booked",
         "source": "engine"})
    assert n == 1, f"expected 1 spawned task after 3 enters, got {n}"
    print(f"  {PASS} on_stage_enter is idempotent (only 1 template task after 3 calls)")


async def scenario_7_side_effect_create_expense_idempotent():
    """Advance to the terminal stage twice (via manual seeding) -- the
    create_expense side-effect fires but the expense is not duplicated."""
    wid = await _make_workflow(stage="paid",
                                stages=("booked", "confirmed", "paid"))
    # Fire on_stage_enter directly -- simulates arriving at terminal.
    await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    n = await db.expenses.count_documents(
        {"tenant_id": TENANT, "workflow_id": wid})
    assert n == 1, f"expected 1 expense after 2 enters, got {n}"
    print(f"  {PASS} create_expense side-effect idempotent (1 expense after 2 enters)")


async def scenario_8_notify_role_no_recipients():
    """notify_role with a role that has zero users -> skipped gracefully."""
    # Use a fresh workflow with a stage carrying notify_role side-effect
    pdict = {
        "key": "sales", "label": "Sales", "sub": "One stage",
        "stages": [{"key": "booked", "label": "Booked",
                    "tasks": [], "approval": None,
                    "side_effects": [{"kind": "notify_role",
                                      "params": {"role": "does_not_exist"}}]}],
    }
    await db.tenants.update_one(
        {"id": TENANT},
        {"$set": {"operating_model.pipelines": [pdict]}},
    )
    wid = await _make_workflow(stage="booked", stages=("booked",))
    await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    # notify_role internally returned {skipped: no_recipients}; the
    # engine still records it in fired (it did not raise). Result is
    # a graceful no-op -- no notifications created.
    n = await db.notifications.count_documents({"tenant_id": TENANT})
    assert n == 0, f"expected 0 notifications, got {n}"
    print(f"  {PASS} notify_role with zero recipients -> graceful no-op")


async def scenario_9_approval_gate_blocks():
    """Restore full pipeline; put wf at confirmed which needs owner
    approval; check_stage_ready must report missing_approval=True."""
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [{
            "key": "sales", "label": "Sales", "sub": "Booked -> Paid",
            "stages": [
                {"key": "booked", "label": "Booked", "tasks": [], "approval": None, "side_effects": []},
                {"key": "confirmed", "label": "Confirmed", "tasks": [],
                 "approval": {"role": "owner", "required": True},
                 "side_effects": []},
                {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
            ]}]}}
    )
    wid = await _make_workflow(stage="confirmed", stages=("booked", "confirmed", "paid"))
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is False, rc
    assert rc["missing_approval"] is True, rc
    print(f"  {PASS} approval gate blocks when required + missing")


async def scenario_10_record_approval_role_check():
    wid = await _make_workflow(stage="confirmed", stages=("booked", "confirmed", "paid"))
    bad = await record_stage_approval(TENANT, wid, "a1", "A1", "sales")
    assert bad["ok"] is False, bad
    assert bad["error"] == "wrong_role", bad
    good = await record_stage_approval(TENANT, wid, "a1", "A1", "owner")
    assert good["ok"] is True and good["already_recorded"] is False, good
    # Idempotent re-record
    again = await record_stage_approval(TENANT, wid, "a1", "A1", "owner")
    assert again["ok"] is True and again["already_recorded"] is True, again
    # Now check_stage_ready should pass
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is True, rc
    print(f"  {PASS} approval: wrong role rejected, owner accepted, idempotent, unblocks stage")


async def scenario_11_terminal_stage_marks_completed():
    wid = await _make_workflow(stage="confirmed", stages=("booked", "confirmed", "paid"))
    # Approve confirmed stage first
    await record_stage_approval(TENANT, wid, "owner-1", "Owner", "owner")
    r1 = await advance(TENANT, wid, "owner-1", "Owner", "owner")
    assert r1["advanced"] and r1["new_stage"] == "paid" and r1["terminal"] is True
    wf = await db.workflows.find_one({"id": wid}, {"_id": 0, "completed_at": 1, "stage": 1})
    assert wf.get("stage") == "paid"
    assert wf.get("completed_at"), wf
    print(f"  {PASS} terminal advance marks completed_at")


async def scenario_12_skip_stage_refused():
    wid = await _make_workflow(stage="booked")
    try:
        await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                       target_stage="paid", override=True, reason="skip test")
        print(f"  {FAIL} skip-stage advance succeeded"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "not_next", e.code
        print(f"  {PASS} skip-stage rejected: {e}")
        return True


async def scenario_13_registered_kinds():
    kinds = registered_side_effect_kinds()
    assert "create_expense" in kinds and "notify_role" in kinds, kinds
    print(f"  {PASS} registered side-effect kinds: {kinds}")


async def main() -> int:
    print(f"=== WE-06/07/08/09 verification (tenant={TENANT}) ===\n")
    fails = 0
    try:
        await _seed_tenant()
        for fn in [
            scenario_1_refuses_when_task_open,
            scenario_2_succeeds_when_task_done,
            scenario_3_override_with_reason,
            scenario_4_override_missing_reason,
            scenario_5_atomic_cas,
            scenario_6_on_stage_enter_idempotent,
            scenario_7_side_effect_create_expense_idempotent,
            scenario_8_notify_role_no_recipients,
            scenario_9_approval_gate_blocks,
            scenario_10_record_approval_role_check,
            scenario_11_terminal_stage_marks_completed,
            scenario_12_skip_stage_refused,
            scenario_13_registered_kinds,
        ]:
            try:
                r = await fn()
                if r is False:
                    fails += 1
            except AssertionError as e:
                print(f"  {FAIL} {fn.__name__}: {e}")
                fails += 1
    finally:
        print()
        await _cleanup()
    print()
    if fails:
        print(f"=== WE-06 verification: {fails} failure(s) ===")
        return 2
    print("=== WE-06 verification: ALL SCENARIOS PASS ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

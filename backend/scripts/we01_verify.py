"""WE-01 (2026-08-16) — integration verification against the live DB.

Runs derive_task_workflow_link across every meaningful scenario
(cross-tenant refusal, invalid stage_key, decision-id shortcut,
ambiguous decision-id, ad-hoc, strict vs non-strict) using throwaway
synth-tenant docs so nothing tenant-visible is touched.

Also confirms the WE-01 migration has been applied and the compound
tasks(tenant_id, workflow_id, stage_key) index exists.

Usage (backend cwd):
    .venv/Scripts/python.exe scripts/we01_verify.py

Exits 0 on all-pass, non-zero on any failure. Cleans up synthetic
docs in a finally block so a mid-run crash still leaves the DB clean.
"""
import asyncio
import sys
import uuid

from core import db
from services.workflows import derive_task_workflow_link


TA = f"we01-tenant-a-{uuid.uuid4().hex[:8]}"
TB = f"we01-tenant-b-{uuid.uuid4().hex[:8]}"


def _wf_id() -> str:
    return f"we01-wf-{uuid.uuid4().hex[:8]}"


def _tk_id() -> str:
    return f"we01-tk-{uuid.uuid4().hex[:8]}"


async def _cleanup():
    r1 = await db.tasks.delete_many({"tenant_id": {"$in": [TA, TB]}})
    r2 = await db.workflows.delete_many({"tenant_id": {"$in": [TA, TB]}})
    print(f"  [cleanup] tasks deleted={r1.deleted_count} "
          f"workflows deleted={r2.deleted_count}")


PASS = "[PASS]"
FAIL = "[FAIL]"


async def scenario_1_resolve_workflow_id():
    """Happy path: workflow_id -> (id, current stage)."""
    wid = _wf_id()
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TA, "stage": "confirmed",
        "stages": [{"key": "booked", "label": "B"},
                   {"key": "confirmed", "label": "C"}],
    })
    got = await derive_task_workflow_link(TA, workflow_id=wid)
    assert got == (wid, "confirmed"), got
    print(f"  {PASS} resolve workflow_id -> current stage")


async def scenario_2_cross_tenant_refused():
    """Security: tenant A cannot link to tenant B's workflow."""
    wid = _wf_id()
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TB, "stage": "booked", "stages": []})
    try:
        await derive_task_workflow_link(TA, workflow_id=wid, strict=True)
        print(f"  {FAIL} cross-tenant workflow_id was accepted (should raise)")
        return False
    except ValueError as e:
        assert "not found in this workspace" in str(e), str(e)
        print(f"  {PASS} cross-tenant workflow_id rejected: {e}")
        return True


async def scenario_3_invalid_stage_key_rejected():
    """stage_key must be one of the workflow's declared stages."""
    wid = _wf_id()
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TA, "stage": "booked",
        "stages": [{"key": "booked", "label": "B"},
                   {"key": "confirmed", "label": "C"}],
    })
    try:
        await derive_task_workflow_link(
            TA, workflow_id=wid, stage_key="ghost", strict=True)
        print(f"  {FAIL} invalid stage_key was accepted")
        return False
    except ValueError as e:
        assert "not a stage of workflow" in str(e), str(e)
        print(f"  {PASS} invalid stage_key rejected: {e}")
        return True


async def scenario_4_stage_key_defaults_to_current():
    """No stage_key supplied -> we use the workflow's current stage."""
    wid = _wf_id()
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TA, "stage": "in_production",
        "stages": [{"key": "booked", "label": "B"},
                   {"key": "in_production", "label": "P"}],
    })
    got = await derive_task_workflow_link(TA, workflow_id=wid)
    assert got == (wid, "in_production"), got
    print(f"  {PASS} stage_key defaults to workflow's current stage")


async def scenario_5_decision_id_single_match():
    """One workflow for this decision -> linked."""
    dec = f"we01-dec-{uuid.uuid4().hex[:8]}"
    wid = _wf_id()
    await db.workflows.insert_one({
        "id": wid, "tenant_id": TA, "decision_id": dec,
        "stage": "booked", "stages": [{"key": "booked", "label": "B"}],
    })
    got = await derive_task_workflow_link(TA, decision_id=dec)
    assert got == (wid, "booked"), got
    print(f"  {PASS} decision_id single-match -> linked")


async def scenario_6_decision_id_ambiguous_unlinked():
    """Two workflows share a decision_id -> we refuse to guess."""
    dec = f"we01-dec-{uuid.uuid4().hex[:8]}"
    for _ in range(2):
        await db.workflows.insert_one({
            "id": _wf_id(), "tenant_id": TA, "decision_id": dec,
            "stage": "booked", "stages": [],
        })
    got = await derive_task_workflow_link(TA, decision_id=dec)
    assert got == (None, None), got
    print(f"  {PASS} decision_id ambiguous -> (None, None)")


async def scenario_7_stage_key_alone_rejected():
    """stage_key without workflow_id is semantically invalid."""
    try:
        await derive_task_workflow_link(TA, stage_key="booked", strict=True)
        print(f"  {FAIL} stage_key alone was accepted (should raise)")
        return False
    except ValueError as e:
        assert "stage_key was provided without workflow_id" in str(e), str(e)
        print(f"  {PASS} stage_key alone rejected: {e}")
        return True


async def scenario_8_strict_false_swallows_bad_ref():
    """Bulk paths (backfill, voice post-pass) use strict=False so one
    stale ref doesn't crash a 100-task batch."""
    got = await derive_task_workflow_link(
        TA, workflow_id="wf_does_not_exist", strict=False)
    assert got == (None, None), got
    print(f"  {PASS} strict=False silently drops bad workflow_id")


async def scenario_9_ad_hoc_returns_none():
    """No workflow_id, no decision_id, no stage_key -> ad-hoc."""
    got = await derive_task_workflow_link(TA)
    assert got == (None, None), got
    print(f"  {PASS} ad-hoc task -> (None, None)")


async def scenario_10_migration_applied():
    """Confirm the backfill migration and the compound index landed."""
    row = await db.migrations_applied.find_one(
        {"name": "backfill_task_workflow_link_v1"}, {"_id": 0})
    assert row and row.get("status") == "ok", row
    print(f"  {PASS} backfill_task_workflow_link_v1 in ledger: "
          f"applied={row.get('applied_at')} dur={row.get('duration_ms')}ms")

    info = await db.tasks.index_information()
    idx_name = "tasks_tenant_workflow_stage"
    assert idx_name in info, list(info.keys())
    idx = info[idx_name]
    assert "partialFilterExpression" in idx, idx
    print(f"  {PASS} compound index {idx_name} present, partial={idx['partialFilterExpression']}")


async def scenario_11_backfill_effect_on_real_tenants():
    """Sanity-check the backfill against real tenants: how many tasks
    now carry workflow_id? Should match the number of tasks whose
    decision_id maps 1:1 to a workflow."""
    linked = await db.tasks.count_documents(
        {"workflow_id": {"$type": "string"}})
    ad_hoc = await db.tasks.count_documents(
        {"$or": [{"workflow_id": {"$exists": False}},
                 {"workflow_id": {"$in": [None, ""]}}]})
    print(f"  [info] real tenants: {linked} tasks linked, {ad_hoc} tasks ad-hoc")


async def main() -> int:
    print("=== WE-01 integration verification ===\n")
    fails = 0
    try:
        await scenario_1_resolve_workflow_id()
        ok2 = await scenario_2_cross_tenant_refused(); fails += 0 if ok2 else 1
        ok3 = await scenario_3_invalid_stage_key_rejected(); fails += 0 if ok3 else 1
        await scenario_4_stage_key_defaults_to_current()
        await scenario_5_decision_id_single_match()
        await scenario_6_decision_id_ambiguous_unlinked()
        ok7 = await scenario_7_stage_key_alone_rejected(); fails += 0 if ok7 else 1
        await scenario_8_strict_false_swallows_bad_ref()
        await scenario_9_ad_hoc_returns_none()
        await scenario_10_migration_applied()
        await scenario_11_backfill_effect_on_real_tenants()
    except AssertionError as e:
        print(f"\n  {FAIL} assertion failed: {e}")
        fails += 1
    finally:
        print()
        await _cleanup()

    print()
    if fails:
        print(f"=== WE-01 verification: {fails} failure(s) ===")
        return 2
    print("=== WE-01 verification: ALL SCENARIOS PASS ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""Epic 5 -- extra edge-case pass (2026-08-16).

Covers cases the sprint verifiers didn't explicitly stress:

  1. workflow with ZERO stages -> graceful no-op, no crash
  2. wf.stage NOT in wf.stages (data corruption) -> corrupt_stage error
  3. wf.type has no matching pipeline -> engine treats as "no template"
  4. cancelled task counts as satisfied (doesn't block advance)
  5. multiple side-effects on same stage -> all fire in order
  6. side-effect handler THROWS -> transition still succeeds, exception logged
  7. unknown side-effect kind -> logged + skipped, doesn't crash
  8. create_expense with 0 amount -> still creates the expense
  9. notify_role skips self -> actor doesn't get pinged
 10. THREE-way CAS race -> exactly one winner
 11. stage_version corrupted to None -> engine coerces to 0 gracefully
 12. advance() called when already at terminal -> at_terminal error
 13. explicit target_stage that skips forward -> not_next error even with override
 14. cross-tenant read isolation -> engine returns workflow_not_found
 15. record_stage_approval on a stage with no approval gate -> ok=False
 16. on_stage_enter after operator DELETED a template task from settings
     -> spawned task is NOT recreated (idempotency is per-title, so
     dropped template titles don't respawn)

Cleans up throwaway docs in a finally block. Exits 0 on all-pass.
"""
import asyncio
import sys
import uuid

from core import db
from services.workflow_engine import (
    advance, check_stage_ready, on_stage_enter,
    record_stage_approval, WorkflowAdvanceError,
    _SIDE_EFFECT_REGISTRY,
)


TENANT = f"we-edge-{uuid.uuid4().hex[:8]}"
OTHER_TENANT = f"we-edge-other-{uuid.uuid4().hex[:8]}"
ACTOR = "edge-actor"
ACTOR_NAME = "Edge Actor"
PASS = "[PASS]"
FAIL = "[FAIL]"


async def _cleanup():
    for tid in (TENANT, OTHER_TENANT):
        for coll in (db.workflows, db.tasks, db.tenants, db.expenses,
                     db.notifications, db.activity, db.brain_context, db.users):
            try:
                await coll.delete_many({"tenant_id": tid})
            except Exception:
                pass


async def _seed_tenant(tid: str, pipeline: dict = None):
    if pipeline is None:
        pipeline = {
            "key": "sales", "label": "Sales", "sub": "s",
            "approval_stage": None,
            "stages": [
                {"key": "booked", "label": "Booked", "tasks": [], "approval": None, "side_effects": []},
                {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
            ],
        }
    await db.tenants.insert_one({
        "id": tid, "tenant_id": tid,
        "name": f"Tenant {tid}", "industry": "Test",
        "roles": [{"key": "sales", "label": "Sales"}, {"key": "finance", "label": "Finance"}],
        "operating_model": {"pipelines": [pipeline], "task_categories": []},
    })


async def _make_wf(tid: str, stages: list = None, wf_type: str = "sales",
                    stage_version: int = 0, start_stage: str = None) -> str:
    # Use `is None` (not `or`) so an explicit [] survives -- case_1 needs a
    # workflow with genuinely zero stages, and `[] or default` would replace.
    if stages is None:
        stages = ["booked", "paid"]
    start = start_stage if start_stage is not None else (stages[0] if stages else "unknown")
    wid = f"we-edge-wf-{uuid.uuid4().hex[:8]}"
    await db.workflows.insert_one({
        "id": wid, "tenant_id": tid, "type": wf_type,
        "title": f"Edge WF {wid[-4:]}",
        "stage": start, "stages": stages,
        "stage_version": stage_version,
        "history": [], "created_by": ACTOR,
        "created_at": "2026-08-16T00:00:00+00:00",
    })
    return wid


# ---------------------------------------------------------------------------
# 1. zero stages
# ---------------------------------------------------------------------------
async def case_1_zero_stages():
    wid = await _make_wf(TENANT, stages=[], start_stage="")
    r = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    assert r.get("error") == "no_stage", r
    print(f"  {PASS} zero-stages workflow: on_stage_enter -> {r.get('error')}")


# ---------------------------------------------------------------------------
# 2. wf.stage not in wf.stages -> corrupt_stage
# ---------------------------------------------------------------------------
async def case_2_corrupt_stage():
    wid = await _make_wf(TENANT, stages=["booked", "paid"], start_stage="ghost")
    try:
        await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                       override=True, reason="test")
        print(f"  {FAIL} corrupt_stage accepted"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "corrupt_stage", e.code
        assert e.http_status == 500
        print(f"  {PASS} corrupt wf.stage -> {e.code} / {e.http_status}: {e}")


# ---------------------------------------------------------------------------
# 3. wf.type has no matching pipeline
# ---------------------------------------------------------------------------
async def case_3_missing_pipeline():
    wid = await _make_wf(TENANT, wf_type="not_a_real_pipeline")
    # on_stage_enter should return no template tasks (pipeline is None)
    r = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    assert r.get("task_ids") == [], r
    assert r.get("side_effects_fired") == [], r
    print(f"  {PASS} wf.type without a matching pipeline: no tasks / no side-effects")


# ---------------------------------------------------------------------------
# 4. cancelled task counts as satisfied
# ---------------------------------------------------------------------------
async def case_4_cancelled_task_ok():
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked",
             "tasks": [{"title": "test task", "role": "sales", "evidence_required": False}],
             "approval": None, "side_effects": []},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    wid = await _make_wf(TENANT)
    await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    # Mark the spawned task as CANCELLED (not done)
    r = await db.tasks.update_many(
        {"workflow_id": wid, "stage_key": "booked"},
        {"$set": {"status": "cancelled"}})
    assert r.modified_count == 1
    rc = await check_stage_ready(TENANT, wid)
    assert rc["ready"] is True, rc
    print(f"  {PASS} cancelled task counts as satisfied -> stage ready")


# ---------------------------------------------------------------------------
# 5. multiple side-effects on same stage
# ---------------------------------------------------------------------------
async def case_5_multiple_side_effects():
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked", "tasks": [], "approval": None,
             "side_effects": [
                 {"kind": "create_expense", "params": {}},
                 {"kind": "notify_role", "params": {"role": "sales"}},
             ]},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    # Ensure at least one sales user for notify_role
    if not await db.users.find_one({"tenant_id": TENANT, "role": "sales"}):
        await db.users.insert_one({
            "id": f"{TENANT}-sales-recip", "tenant_id": TENANT,
            "name": "Sales Recipient", "role": "sales",
            "email": f"sales-recip-{TENANT}@edge.test",  # unique to avoid null-email dup key
        })
    wid = await _make_wf(TENANT)
    r = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    fired = r.get("side_effects_fired") or []
    assert "create_expense" in fired and "notify_role" in fired, fired
    print(f"  {PASS} multiple side-effects on stage: both fired -> {fired}")


# ---------------------------------------------------------------------------
# 6. side-effect handler THROWS -> transition still succeeds
# ---------------------------------------------------------------------------
async def case_6_side_effect_throws():
    # Register a temporary handler that throws.
    async def _boom(*a, **kw):
        raise RuntimeError("intentional test explosion")
    _SIDE_EFFECT_REGISTRY["_test_boom"] = _boom
    try:
        pipeline = {
            "key": "sales", "label": "Sales", "sub": "s",
            "stages": [
                {"key": "booked", "label": "Booked", "tasks": [], "approval": None,
                 "side_effects": [{"kind": "_test_boom", "params": {}}]},
                {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
            ],
        }
        await db.tenants.update_one(
            {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
        )
        wid = await _make_wf(TENANT)
        r = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
        # The throw was logged; transition still recorded as fired=[]
        # for the throwing kind. The workflow document itself is not
        # affected -- on_stage_enter doesn't reverse anything on side-
        # effect failure.
        assert "_test_boom" not in (r.get("side_effects_fired") or []), r
        # Advance should still work
        result = await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                                override=True, reason="post-boom test")
        assert result["advanced"] is True, result
        print(f"  {PASS} exploding side-effect: transition survives, "
              f"kind NOT in fired list ({r.get('side_effects_fired')})")
    finally:
        _SIDE_EFFECT_REGISTRY.pop("_test_boom", None)


# ---------------------------------------------------------------------------
# 7. unknown side-effect kind
# ---------------------------------------------------------------------------
async def case_7_unknown_kind():
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked", "tasks": [], "approval": None,
             "side_effects": [{"kind": "typo_kind_xyz", "params": {}}]},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    wid = await _make_wf(TENANT)
    r = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    assert r.get("side_effects_fired") == [], r
    print(f"  {PASS} unknown side-effect kind: skipped, side_effects_fired={r.get('side_effects_fired')}")


# ---------------------------------------------------------------------------
# 8. create_expense with 0 amount
# ---------------------------------------------------------------------------
async def case_8_create_expense_zero_amount():
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked", "tasks": [], "approval": None,
             "side_effects": [{"kind": "create_expense", "params": {}}]},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    wid = await _make_wf(TENANT)
    # Set amount to 0 explicitly
    await db.workflows.update_one({"id": wid}, {"$set": {"amount": 0}})
    r = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    assert "create_expense" in (r.get("side_effects_fired") or []), r
    exp = await db.expenses.find_one({"tenant_id": TENANT, "workflow_id": wid}, {"_id": 0, "amount": 1})
    assert exp is not None, exp
    print(f"  {PASS} create_expense with amount=0 still creates the expense ({exp})")


# ---------------------------------------------------------------------------
# 9. notify_role skips self (actor is a member of the same role)
# ---------------------------------------------------------------------------
async def case_9_notify_role_skips_self():
    # Actor is themselves a sales user
    self_id = f"{TENANT}-self-sales"
    await db.users.insert_one({
        "id": self_id, "tenant_id": TENANT,
        "name": "Actor Sales", "role": "sales",
        "email": f"self-sales-{TENANT}@edge.test",  # unique to avoid null-email dup key
    })
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked", "tasks": [], "approval": None,
             "side_effects": [{"kind": "notify_role", "params": {"role": "sales"}}]},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    wid = await _make_wf(TENANT)
    # Pre-count notifications for this actor id
    before = await db.notifications.count_documents({"tenant_id": TENANT, "user_id": self_id})
    await on_stage_enter(TENANT, wid, self_id, "Actor Sales")
    after = await db.notifications.count_documents({"tenant_id": TENANT, "user_id": self_id})
    assert after == before, (before, after)
    print(f"  {PASS} notify_role skips self: notifications to actor unchanged ({before} -> {after})")


# ---------------------------------------------------------------------------
# 10. THREE-way CAS race
# ---------------------------------------------------------------------------
async def case_10_three_way_cas():
    """Pin ALL three racers to the SAME target_stage so they compete
    for the same transition (not chained transitions). Without an
    explicit target, three unbounded advances on a 3-stage pipeline
    just chain naturally -- not a race."""
    wid = await _make_wf(TENANT, stages=["booked", "confirmed", "paid"])
    r1, r2, r3 = await asyncio.gather(
        advance(TENANT, wid, "a1", "A1", "owner",
                target_stage="confirmed", override=True, reason="race-1"),
        advance(TENANT, wid, "a2", "A2", "owner",
                target_stage="confirmed", override=True, reason="race-2"),
        advance(TENANT, wid, "a3", "A3", "owner",
                target_stage="confirmed", override=True, reason="race-3"),
        return_exceptions=True,
    )
    winners = [r for r in (r1, r2, r3) if isinstance(r, dict) and r.get("advanced")]
    losers = [r for r in (r1, r2, r3) if isinstance(r, dict) and r.get("already_advanced")]
    exc = [r for r in (r1, r2, r3) if isinstance(r, Exception)]
    # After all 3, we expect: exactly 1 CAS winner + up to 2 that
    # arrive after the winner and see current_stage=confirmed. The
    # arrivers-after-winner have target_stage=confirmed BUT current
    # stage IS confirmed -- so their "next stage" check refuses
    # (target must be current+1 => paid, not confirmed). That's a
    # WorkflowAdvanceError code=not_next OR already_advanced,
    # depending on whether they read pre- or post-CAS. Either
    # outcome is safe: NO double-advance to a stage past confirmed.
    assert len(winners) == 1, f"expected exactly 1 winner, got {len(winners)}: {r1}, {r2}, {r3}"
    non_winners = 3 - len(winners)
    safe_losers = len(losers) + sum(
        1 for e in exc
        if hasattr(e, "code") and e.code in ("already_advanced", "not_next")
    )
    assert safe_losers == non_winners, (safe_losers, non_winners, losers, exc)
    # Final invariant: workflow ended at confirmed, not past it
    wf = await db.workflows.find_one({"id": wid}, {"_id": 0, "stage": 1})
    assert wf["stage"] == "confirmed", wf
    print(f"  {PASS} 3-way CAS race on SAME target: 1 winner + "
          f"{safe_losers} safe losers (either already_advanced or not_next) -- "
          f"workflow ended at 'confirmed' as expected")


# ---------------------------------------------------------------------------
# 11. stage_version corrupted to None
# ---------------------------------------------------------------------------
async def case_11_stage_version_none():
    wid = await _make_wf(TENANT, stages=["booked", "paid"], stage_version=0)
    # Corrupt the field
    await db.workflows.update_one({"id": wid}, {"$set": {"stage_version": None}})
    # Engine's int(wf.get("stage_version") or 0) should coerce None -> 0
    result = await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                            override=True, reason="post-corrupt")
    assert result.get("advanced") is True, result
    wf = await db.workflows.find_one({"id": wid}, {"_id": 0, "stage_version": 1})
    assert wf.get("stage_version") == 1, wf
    print(f"  {PASS} stage_version=None coerced to 0, advance succeeded, now = 1")


# ---------------------------------------------------------------------------
# 12. advance at terminal
# ---------------------------------------------------------------------------
async def case_12_advance_at_terminal():
    wid = await _make_wf(TENANT, stages=["booked", "paid"], start_stage="paid")
    try:
        await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                       override=True, reason="past-end")
        print(f"  {FAIL} advance from terminal succeeded"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "at_terminal", e.code
        print(f"  {PASS} advance at terminal refused: {e}")


# ---------------------------------------------------------------------------
# 13. skip-stage via explicit target with override
# ---------------------------------------------------------------------------
async def case_13_target_skip_forward():
    wid = await _make_wf(TENANT, stages=["booked", "confirmed", "paid"])
    try:
        await advance(TENANT, wid, ACTOR, ACTOR_NAME, "owner",
                       target_stage="paid",
                       override=True, reason="attempt skip")
        print(f"  {FAIL} skip-stage target accepted with override"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "not_next", e.code
        print(f"  {PASS} target skip-stage even with override refused: {e}")


# ---------------------------------------------------------------------------
# 14. cross-tenant read isolation
# ---------------------------------------------------------------------------
async def case_14_cross_tenant_isolation():
    await _seed_tenant(OTHER_TENANT)
    other_wid = await _make_wf(OTHER_TENANT)
    # Try to advance the other tenant's workflow from OUR tenant context
    try:
        await advance(TENANT, other_wid, ACTOR, ACTOR_NAME, "owner",
                       override=True, reason="cross-tenant attack")
        print(f"  {FAIL} cross-tenant advance accepted"); return False
    except WorkflowAdvanceError as e:
        assert e.code == "not_found", e.code
        assert e.http_status == 404
        print(f"  {PASS} cross-tenant workflow: engine returns 404 not_found")


# ---------------------------------------------------------------------------
# 15. record_stage_approval on a stage with no approval gate
# ---------------------------------------------------------------------------
async def case_15_approval_on_gateless_stage():
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked", "tasks": [], "approval": None, "side_effects": []},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    wid = await _make_wf(TENANT)  # at booked, which has approval=None
    r = await record_stage_approval(TENANT, wid, ACTOR, ACTOR_NAME, "owner")
    assert r["ok"] is False, r
    assert r.get("error") == "stage_has_no_approval_gate", r
    print(f"  {PASS} record_stage_approval on gateless stage: ok=False, error={r['error']}")


# ---------------------------------------------------------------------------
# 16. on_stage_enter after operator DELETED a template task
# ---------------------------------------------------------------------------
async def case_16_template_deletion_no_respawn():
    # Set up: 2 template tasks on 'booked'
    pipeline = {
        "key": "sales", "label": "Sales", "sub": "s",
        "stages": [
            {"key": "booked", "label": "Booked",
             "tasks": [{"title": "Task A", "role": "sales", "evidence_required": False},
                       {"title": "Task B", "role": "sales", "evidence_required": False}],
             "approval": None, "side_effects": []},
            {"key": "paid", "label": "Paid", "tasks": [], "approval": None, "side_effects": []},
        ],
    }
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    wid = await _make_wf(TENANT)
    r1 = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    assert len(r1["task_ids"]) == 2, r1

    # Owner deletes template Task B via Settings
    pipeline["stages"][0]["tasks"] = [
        {"title": "Task A", "role": "sales", "evidence_required": False}
    ]
    await db.tenants.update_one(
        {"id": TENANT}, {"$set": {"operating_model.pipelines": [pipeline]}},
    )
    # Re-enter -> Task A already exists (idempotent), Task B is gone
    # from template so it's not respawned. Total spawned should stay 2.
    r2 = await on_stage_enter(TENANT, wid, ACTOR, ACTOR_NAME)
    assert len(r2["task_ids"]) == 0, r2
    total = await db.tasks.count_documents({"workflow_id": wid, "stage_key": "booked", "source": "engine"})
    assert total == 2, total  # A + B originally spawned, still both there
    print(f"  {PASS} template task deletion: existing tasks preserved, "
          f"no respawn (total still {total})")


async def main() -> int:
    print(f"=== Epic 5 edge case pass (tenant={TENANT}) ===\n")
    fails = 0
    try:
        await _seed_tenant(TENANT)
        cases = [
            case_1_zero_stages, case_2_corrupt_stage, case_3_missing_pipeline,
            case_4_cancelled_task_ok, case_5_multiple_side_effects,
            case_6_side_effect_throws, case_7_unknown_kind,
            case_8_create_expense_zero_amount, case_9_notify_role_skips_self,
            case_10_three_way_cas, case_11_stage_version_none,
            case_12_advance_at_terminal, case_13_target_skip_forward,
            case_14_cross_tenant_isolation, case_15_approval_on_gateless_stage,
            case_16_template_deletion_no_respawn,
        ]
        for fn in cases:
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
        print(f"=== Epic 5 edge cases: {fails} failure(s) ===")
        return 2
    print("=== Epic 5 edge cases: ALL SCENARIOS PASS ===")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

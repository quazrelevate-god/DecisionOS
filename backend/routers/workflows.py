"""Workflow board endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Pipeline cards + the thin advance wrapper over services/workflow_engine (the
single writer of workflows.stage). Cross-domain helper tenant_operating_model
is still deferred-imported from server until Sprint 4.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import (
    db, get_current_user, require_perm, require_role, new_id, now_iso, log_activity,
)

router = APIRouter(prefix="/api")


class WorkflowCreateInput(BaseModel):
    type: str  # sales_dispatch | purchase_payment
    title: str
    detail: Optional[str] = ""
    amount: Optional[float] = None
    counterparty: Optional[str] = None
    contact_id: Optional[str] = None


class WorkflowAdvanceInput(BaseModel):
    stage: str
    note: Optional[str] = ""
    # WE-07 / WE-13 (2026-08-16): audited override. When override=True
    # the engine skips check_stage_ready but demands a non-empty reason
    # (rejected as 400 otherwise). The reason lands in wf.history +
    # audit_log so "why was this advanced past its contract?" is never
    # invisible.
    override: Optional[bool] = False
    reason: Optional[str] = ""


@router.get("/workflows")
async def list_workflows(type: Optional[str] = None,
                         with_tasks: Optional[bool] = False,
                         user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if type:
        q["type"] = type
    wfs = await db.workflows.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # WE-12 (2026-08-16): when the client asks with_tasks=true, we
    # hydrate each card with the OPEN tasks at its current stage
    # (workflow_id + stage_key + status not-in done/cancelled), plus
    # each task's assignee_name for the avatar. One batch query for
    # all cards, then a single users query -- keeps the payload O(1)
    # network round trips regardless of card count.
    if with_tasks and wfs:
        wf_pairs = [(w.get("id"), w.get("stage")) for w in wfs if w.get("id") and w.get("stage")]
        if wf_pairs:
            # Mongo `$or` on (workflow_id, stage_key) pairs -- much
            # narrower than fetching all tasks and filtering client-side.
            or_clauses = [
                {"workflow_id": wid, "stage_key": sk}
                for wid, sk in wf_pairs
            ]
            task_rows = await db.tasks.find(
                {"tenant_id": user["tenant_id"],
                 "status": {"$nin": ["done", "cancelled"]},
                 "$or": or_clauses},
                {"_id": 0, "id": 1, "title": 1, "workflow_id": 1,
                 "stage_key": 1, "assignee_id": 1, "assignee_role": 1,
                 "priority": 1, "status": 1, "due_date": 1},
            ).to_list(1000)
            # Hydrate assignee_name in one query.
            assignee_ids = {t["assignee_id"] for t in task_rows if t.get("assignee_id")}
            umap = {}
            if assignee_ids:
                async for u in db.users.find(
                    {"id": {"$in": list(assignee_ids)}, "tenant_id": user["tenant_id"]},
                    {"_id": 0, "id": 1, "name": 1},
                ):
                    umap[u["id"]] = u.get("name")
            # Bucket tasks by workflow_id -> the current-stage lane.
            by_wf: dict = {}
            for t in task_rows:
                t["assignee_name"] = umap.get(t.get("assignee_id"))
                by_wf.setdefault(t["workflow_id"], []).append(t)
            for w in wfs:
                w["stage_tasks"] = by_wf.get(w.get("id")) or []
    return wfs


@router.post("/workflows")
async def create_workflow(inp: WorkflowCreateInput, user: dict = Depends(require_perm("workflows"))):
    # FIX-004-C (RBAC-04): symmetric with DELETE /workflows/{id} which
    # is role(owner). Previously ANY employee could create workflows
    # (auth-only) while only owner could delete them. Now creation
    # requires the same `workflows` permission a person needs to
    # interact with the workflow board at all.
    from server import tenant_operating_model  # deferred: helper still in server (Sprint 4)
    om = await tenant_operating_model(user["tenant_id"])
    pipeline = next((p for p in om["pipelines"] if p["key"] == inp.type), None)
    if not pipeline:
        raise HTTPException(status_code=400, detail="Invalid workflow type")
    wid = new_id()
    stages = [s["key"] for s in pipeline["stages"]]
    counterparty = inp.counterparty or ""
    contact_id = inp.contact_id
    if contact_id:
        contact = await db.contacts.find_one({"id": contact_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "name": 1, "company": 1})
        if contact:
            counterparty = counterparty or contact.get("company") or contact.get("name")
        else:
            contact_id = None
    wf = {
        "id": wid, "tenant_id": user["tenant_id"], "type": inp.type, "title": inp.title,
        "detail": inp.detail or "", "amount": inp.amount, "counterparty": counterparty, "contact_id": contact_id,
        "stage": stages[0], "stages": stages,
        "stage_version": 0,
        "history": [{"stage": stages[0], "note": "Created", "by": user["id"], "at": now_iso()}],
        "created_by": user["id"], "created_at": now_iso(),
    }
    await db.workflows.insert_one(wf)
    await log_activity(user["tenant_id"], user["id"], "workflow_created", f"Started {inp.type.replace('_', '→')} '{inp.title}'", "workflow", wid)
    wf.pop("_id", None)
    return wf


@router.patch("/workflows/{workflow_id}/advance")
async def advance_workflow(workflow_id: str, inp: WorkflowAdvanceInput,
                            user: dict = Depends(require_perm("workflows"))):
    """WE-07 (2026-08-16): this endpoint is now a THIN wrapper around
    services/workflow_engine.advance. The engine is the single writer
    of workflows.stage across the codebase (verified by
    tests/test_we07_single_writer.py). Manual advances from the UI
    still work exactly as before, plus:
      * inp.override + inp.reason enable the WE-13 audited-override
        path (owner can force a transition even when
        check_stage_ready returns False; reason is required and
        lands in wf.history + audit_log).
      * If check_stage_ready is True, the engine advances; if not,
        409 with the reason.

    The legacy FIX-001-B (procurement -> Finance handoff) has moved
    into the WE-08 side-effects registry (services/workflow_engine.py
    _side_effect_create_expense). Tenants who want the auto-expense
    now bind {kind: create_expense} to the terminal stage's
    side_effects[] in Settings > Operations. Existing tenants keep
    the legacy behaviour via a one-time backfill migration
    (see backfill_procurement_side_effects_v1 in _bootstrap).
    """
    from services.workflow_engine import advance as _engine_advance
    from services.workflow_engine import WorkflowAdvanceError
    try:
        result = await _engine_advance(
            user["tenant_id"], workflow_id,
            user["id"], user.get("name") or "", user.get("role") or "",
            target_stage=inp.stage,
            note=inp.note or "",
            override=bool(getattr(inp, "override", False)),
            reason=(getattr(inp, "reason", "") or ""),
        )
    except WorkflowAdvanceError as e:
        raise HTTPException(status_code=e.http_status, detail=str(e))
    if result.get("already_advanced"):
        # Concurrency guard fired: another writer got there first. That
        # is not an error -- return the (now-current) workflow so the
        # UI just picks up the new stage.
        return result.get("workflow")
    return result.get("workflow")


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str, user: dict = Depends(require_role("owner"))):
    wf = await db.workflows.find_one({"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "title": 1})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    await db.workflows.delete_one({"id": workflow_id, "tenant_id": user["tenant_id"]})
    await log_activity(user["tenant_id"], user["id"], "workflow_deleted", f"Deleted workflow '{wf.get('title', '')}'", "workflow", workflow_id)
    return {"ok": True}

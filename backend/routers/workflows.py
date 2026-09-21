"""Workflow board endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Pipeline cards + the thin advance wrapper over services/workflow_engine (the
single writer of workflows.stage). Cross-domain helper tenant_operating_model
is still deferred-imported from server until Sprint 4.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (
    db, get_current_user, require_perm, require_role, new_id, now_iso, log_activity,
    logger,
)

router = APIRouter(prefix="/api")






# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.workflows import (
    WorkflowCreateInput,
    WorkflowAdvanceInput,
    WorkflowUpdateInput,
)

# Fields a task contributes to a card view. Everything the detail view needs to
# say who holds a piece of work, when it is due and what is holding it up.
_TASK_VIEW = {
    "_id": 0, "id": 1, "title": 1, "status": 1, "priority": 1, "stage_key": 1,
    "assignee_id": 1, "assignee_role": 1, "co_assignee_ids": 1, "due_date": 1,
    "progress": 1, "evidence_required": 1, "approval_required": 1,
    "approval_status": 1, "approval_stage": 1, "waiting_on": 1, "source": 1,
    "depends_on": 1, "recurrence": 1,
    "created_at": 1, "updated_at": 1,
}
_TASK_CLOSED = {"done", "cancelled"}


async def _tasks_by_stage(tenant_id: str, workflow_id: str) -> dict:
    """Every task on this card, closed ones included, bucketed by stage_key.

    The board only ever asked for the CURRENT stage's OPEN tasks (see
    list_workflows), which is why nothing in the app could answer "what
    happened at this card's earlier stages" — the one question a founder
    looking at a board actually has. The detail view asks for all of them in a
    single query and one lookup for the names.
    """
    rows = await db.tasks.find(
        {"tenant_id": tenant_id, "workflow_id": workflow_id}, _TASK_VIEW,
    ).sort("created_at", 1).to_list(1000)
    ids = {t["assignee_id"] for t in rows if t.get("assignee_id")}
    umap = {}
    if ids:
        async for u in db.users.find(
            {"id": {"$in": list(ids)}, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1},
        ):
            umap[u["id"]] = u.get("name")
    out: dict = {}
    for t in rows:
        t["assignee_name"] = umap.get(t.get("assignee_id"))
        out.setdefault(t.get("stage_key") or "", []).append(t)
    return out


async def _resolve_counterparty(tenant_id: str, counterparty: str, contact_id):
    """A named contact fills in the party; an unknown id is dropped, not stored."""
    if not contact_id:
        return counterparty or "", None
    contact = await db.contacts.find_one(
        {"id": contact_id, "tenant_id": tenant_id}, {"_id": 0, "name": 1, "company": 1})
    if not contact:
        return counterparty or "", None
    return (counterparty or contact.get("company") or contact.get("name") or ""), contact_id


@router.get("/workflows/counts")
async def workflow_counts(user: dict = Depends(get_current_user)):
    """How many workflows each pipeline holds: {pipeline_key: n} (2026-09-19).

    The board loads one pipeline at a time (/workflows?type=…), and every
    pipeline's count used to be taken from that one list — so the pipeline on
    screen showed its number and every other one showed 0. One grouped count
    for all of them, the same set /workflows would list, is what the pills
    and the phone's pipeline menu read now. Same access as the board itself.
    """
    # The async client returns the cursor from an awaited aggregate() (see
    # routers/admin_billing.py) — not a cursor to call .to_list() on directly.
    cur = await db.workflows.aggregate([
        {"$match": {"tenant_id": user["tenant_id"]}},
        {"$group": {"_id": "$type", "n": {"$sum": 1}}},
    ])
    return {r["_id"]: r["n"] for r in await cur.to_list(200) if r.get("_id")}


@router.get("/workflows")
async def list_workflows(type: Optional[str] = None,
                         with_tasks: Optional[bool] = False,
                         user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if type:
        q["type"] = type
    wfs = await db.workflows.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # ASK-32 4.4 — the decision a card came from, for a link back.
    dec_ids = list({w["decision_id"] for w in wfs if w.get("decision_id")})
    if dec_ids:
        dmap = {x["id"]: x.get("title") async for x in db.decisions.find(
            {"id": {"$in": dec_ids}, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1, "title": 1})}
        for w in wfs:
            w["decision_title"] = dmap.get(w.get("decision_id"))
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
            # C3 (2026-09-21): FINISHED tasks come back too. The board could
            # only ever say WHERE a card was, never how far through the stage
            # it had got — "In production" reads the same on the day it
            # arrives and on the day it is one task from leaving. The open
            # ones still land in `stage_tasks` exactly as before (the card's
            # list, and what workflowAttention reads); the closed ones only
            # feed the count.
            task_rows = await db.tasks.find(
                {"tenant_id": user["tenant_id"],
                 "$or": or_clauses},
                # ASK-52: updated_at comes with them. A card is "stuck" when
                # neither its stage nor its tasks have moved for N working days
                # (the Desk's Workflows tile), and without this the client can
                # only see the stage move — so a card being actively worked
                # read as stuck.
                {"_id": 0, "id": 1, "title": 1, "workflow_id": 1,
                 "stage_key": 1, "assignee_id": 1, "assignee_role": 1,
                 "priority": 1, "status": 1, "due_date": 1, "updated_at": 1},
            ).to_list(1000)
            # Hydrate assignee_name in one query (only the open ones are
            # drawn, so only those need a name).
            assignee_ids = {t["assignee_id"] for t in task_rows
                            if t.get("assignee_id") and t.get("status") not in _TASK_CLOSED}
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
                at_stage = by_wf.get(w.get("id")) or []
                w["stage_tasks"] = [t for t in at_stage if t.get("status") not in _TASK_CLOSED]
                w["stage_total"] = len(at_stage)
                w["stage_done"] = sum(1 for t in at_stage if t.get("status") in _TASK_CLOSED)
    return wfs


@router.post("/workflows")
async def create_workflow(inp: WorkflowCreateInput, user: dict = Depends(require_perm("workflows"))):
    # FIX-004-C (RBAC-04): symmetric with DELETE /workflows/{id} which
    # is role(owner). Previously ANY employee could create workflows
    # (auth-only) while only owner could delete them. Now creation
    # requires the same `workflows` permission a person needs to
    # interact with the workflow board at all.
    from services.ai.generators import tenant_operating_model
    om = await tenant_operating_model(user["tenant_id"])
    pipeline = next((p for p in om["pipelines"] if p["key"] == inp.type), None)
    if not pipeline:
        raise HTTPException(status_code=400, detail="Invalid workflow type")
    wid = new_id()
    stages = [s["key"] for s in pipeline["stages"]]
    counterparty, contact_id = await _resolve_counterparty(
        user["tenant_id"], inp.counterparty or "", inp.contact_id)
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
    # A1 (2026-09-21): a card made from this button used to be born EMPTY.
    # Only the decision path fired stage entry (services/decision_flow), so a
    # board-created card got none of its first stage's template tasks — and,
    # because check_stage_ready reads "no open tasks at this stage" as
    # satisfied, its stage-1 gate passed instantly. The card looked alive and
    # was hollow. Same call, same guarantees (on_stage_enter is idempotent);
    # a failure is logged and never undoes the creation, exactly as the
    # decision path treats it.
    from services.workflow_engine import on_stage_enter
    try:
        fired = await on_stage_enter(user["tenant_id"], wid, user["id"], user.get("name") or "")
        wf["spawned_task_ids"] = fired.get("task_ids") or []
    except Exception as e:  # noqa: BLE001 — automation never undoes the card
        logger.warning(f"[A1] first-stage automation failed for workflow {wid}: {e}")
        wf["spawned_task_ids"] = []
    stage_tasks = (await _tasks_by_stage(user["tenant_id"], wid)).get(wf["stage"]) or []
    wf["stage_tasks"] = [t for t in stage_tasks if t.get("status") not in _TASK_CLOSED]
    return wf


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, user: dict = Depends(get_current_user)):
    """The whole card in one request (A2, 2026-09-21).

    Yokesh: "when I see the workflow I have to know what is going on." Until
    now nothing could answer that — GET /workflows returns a list of cards and,
    at most, the OPEN tasks of each card's CURRENT stage. A card's earlier
    stages, its finished work, which stage is waiting on whose approval and
    what is blocking the next move were all invisible.

    This returns, for every stage of this card: its label, the role that owns
    it, whether it is behind / current / ahead, every task on it with who holds
    it and when it is due, how many of them are done, the approval it needs and
    who has given it, and when the card entered it. Plus `readiness` — the
    engine's own answer to "can this move now, and if not why not".

    Same access as the board list it belongs to.
    """
    from services.workflow_engine import _load_pipeline, check_stage_ready
    wf = await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    if wf.get("decision_id"):
        d = await db.decisions.find_one(
            {"id": wf["decision_id"], "tenant_id": user["tenant_id"]}, {"_id": 0, "title": 1})
        wf["decision_title"] = (d or {}).get("title")

    pipeline = await _load_pipeline(user["tenant_id"], wf.get("type") or "")
    wf["pipeline_label"] = (pipeline or {}).get("label") or (wf.get("type") or "").replace("_", " ").title()
    stage_objs = {s.get("key"): s for s in ((pipeline or {}).get("stages") or [])
                  if isinstance(s, dict) and s.get("key")}
    # When the card entered each stage — the first 'entered' event wins, so a
    # replayed enter after a crash does not rewrite the date it arrived.
    entered: dict = {}
    for ev in (wf.get("stage_events") or []):
        key = (ev or {}).get("stage")
        if (ev or {}).get("kind") == "entered" and key and key not in entered:
            entered[key] = ev.get("at")
    # The card's creation is the moment it entered stage one.
    stages = wf.get("stages") or []
    if stages and stages[0] not in entered:
        entered[stages[0]] = wf.get("created_at")

    approvals = wf.get("approvals") or []
    by_stage = await _tasks_by_stage(user["tenant_id"], workflow_id)
    cur = stages.index(wf["stage"]) if wf.get("stage") in stages else -1
    detail = []
    for i, key in enumerate(stages):
        so = stage_objs.get(key) or {}
        tasks = by_stage.get(key) or []
        appr_spec = so.get("approval") or None
        detail.append({
            "key": key,
            "label": so.get("label") or key.replace("_", " ").title(),
            "owner_role": so.get("role") or None,
            "state": "done" if (0 <= i < cur) else ("current" if i == cur else "upcoming"),
            "entered_at": entered.get(key),
            "tasks": tasks,
            "task_total": len(tasks),
            "task_done": sum(1 for t in tasks if t.get("status") in _TASK_CLOSED),
            "approval": ({
                "role": appr_spec.get("role"),
                "required": bool(appr_spec.get("required")),
                "given": [a for a in approvals if (a or {}).get("stage_key") == key],
            } if appr_spec else None),
        })
    wf["stages_detail"] = detail
    # Tasks that point at this card but name no stage (older rows, and anything
    # linked before stage_key was required). Shown rather than silently lost.
    wf["unstaged_tasks"] = by_stage.get("") or []
    wf["readiness"] = await check_stage_ready(user["tenant_id"], workflow_id)
    return wf


@router.patch("/workflows/{workflow_id}")
async def update_workflow(workflow_id: str, inp: WorkflowUpdateInput,
                          user: dict = Depends(require_perm("workflows"))):
    """Correct a card that is already running (A4, 2026-09-21).

    There was no PATCH at all, so a mistyped amount or the wrong party's name
    could only be fixed by deleting the card — and with it the history of
    everything that had happened on it. Title, detail, amount, party and
    contact are editable; the stage is not, because the engine is the single
    writer of that, and the stage list is not, because it is the rails under a
    card that is already moving.
    """
    wf = await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": user["tenant_id"]},
        {"_id": 0, "id": 1, "title": 1, "counterparty": 1, "contact_id": 1})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    fields = inp.model_dump(exclude_unset=True)
    updates = {}
    if "title" in fields:
        title = (fields["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="A workflow needs a title.")
        updates["title"] = title
    if "detail" in fields:
        updates["detail"] = (fields["detail"] or "").strip()
    if "amount" in fields:
        updates["amount"] = fields["amount"]
    if "counterparty" in fields or "contact_id" in fields:
        party, contact_id = await _resolve_counterparty(
            user["tenant_id"],
            (fields.get("counterparty") if "counterparty" in fields else wf.get("counterparty")) or "",
            fields.get("contact_id") if "contact_id" in fields else wf.get("contact_id"),
        )
        updates["counterparty"] = (party or "").strip()
        updates["contact_id"] = contact_id
    if not updates:
        return await db.workflows.find_one(
            {"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    updates["updated_at"] = now_iso()
    await db.workflows.update_one(
        {"id": workflow_id, "tenant_id": user["tenant_id"]},
        {"$set": updates,
         # stage_events is the card's timeline; wf.history stays what it has
         # always been — the record of stage transitions only.
         "$push": {"stage_events": {
             "kind": "edited", "stage": None, "at": now_iso(),
             "by": user["id"], "by_name": user.get("name") or "",
             "fields": sorted(k for k in updates if k != "updated_at"),
         }}},
    )
    await log_activity(user["tenant_id"], user["id"], "workflow_edited",
                       f"Edited workflow '{updates.get('title') or wf.get('title') or ''}'",
                       "workflow", workflow_id)
    return await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0})


@router.get("/workflows/{workflow_id}/leftover")
async def workflow_leftover(workflow_id: str, user: dict = Depends(get_current_user)):
    """The open work on the card's current stage -- what the "work left
    behind" review lists when a move would leave it (2026-09-21)."""
    from services.workflow_engine import leftover_tasks
    wf = await db.workflows.find_one({"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    return await leftover_tasks(user["tenant_id"], workflow_id)


@router.post("/workflows/{workflow_id}/approve-stage")
async def approve_workflow_stage(workflow_id: str,
                                 user: dict = Depends(require_perm("workflows"))):
    """Give the approval a stage is waiting for (A3, 2026-09-21).

    Settings → Operations lets an owner put "approval required to leave this
    stage" on a pipeline, and check_stage_ready has always honoured it — but
    services/workflow_engine.record_stage_approval, which is the function that
    records one, had NO route and no button anywhere. Only verification scripts
    ever called it. So a configured approval gate could not be satisfied: the
    card's only exit was an owner override, which is the escape hatch, not the
    door. This is the door.

    The role check is the engine's own (the named role, or the owner). The
    approval does not move the card — it clears the gate, and `readiness` comes
    back so the caller can offer the move straight away.
    """
    from services.workflow_engine import check_stage_ready, record_stage_approval
    res = await record_stage_approval(
        user["tenant_id"], workflow_id,
        user["id"], user.get("name") or "", user.get("role") or "",
    )
    if not res.get("ok"):
        err = res.get("error")
        if err == "workflow_not_found":
            raise HTTPException(status_code=404, detail="Not found")
        if err == "stage_has_no_approval_gate":
            raise HTTPException(
                status_code=400,
                detail="This stage doesn't need an approval to move on.")
        if err == "wrong_role":
            raise HTTPException(
                status_code=403,
                detail=(f"Only {res.get('required') or 'the named role'} (or the owner) "
                        "can approve this stage."))
        raise HTTPException(status_code=400, detail=err or "Could not record the approval.")
    return {
        **res,
        "readiness": await check_stage_ready(user["tenant_id"], workflow_id),
        "workflow": await db.workflows.find_one(
            {"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0}),
    }


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
            resolutions=getattr(inp, "resolutions", None),
        )
    except WorkflowAdvanceError as e:
        raise HTTPException(status_code=e.http_status, detail=str(e))
    wf = result.get("workflow") or {}
    if result.get("already_advanced"):
        # Concurrency guard fired: another writer got there first. That is not
        # an error -- the card IS where this caller wanted it. But the route
        # used to drop the flag and return the card as though this press had
        # moved it, so the loser of the race saw a success toast for a move
        # they did not make (A5, 2026-09-21). The flag travels now; the board
        # says who actually moved it.
        return {**wf, "already_advanced": True}
    return wf


@router.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str, user: dict = Depends(require_role("owner"))):
    wf = await db.workflows.find_one({"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "title": 1})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    await db.workflows.delete_one({"id": workflow_id, "tenant_id": user["tenant_id"]})
    await log_activity(user["tenant_id"], user["id"], "workflow_deleted", f"Deleted workflow '{wf.get('title', '')}'", "workflow", workflow_id)
    return {"ok": True}

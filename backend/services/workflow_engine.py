"""Workflow engine -- WE-06 through WE-09 (Epic 5, Sprint 2, 2026-08-16).

The single writer for `workflows.stage`. Three public operations:

  * `on_stage_enter(tid, wf_id, actor_id, actor_name)` -- fires when a
    card lands at a new stage. Spawns the stage's template tasks
    (WE-03 `stage.tasks[]`), records a timeline entry, notifies the
    assignees. Idempotent -- if template tasks for this
    (workflow_id, stage_key) already exist and are open, they are NOT
    duplicated. This lets `advance` re-enter without side-effects.

  * `check_stage_ready(tid, wf_id)` -- returns True iff the current
    stage's satisfaction contract is met: every open task with
    `workflow_id == wf.id AND stage_key == wf.stage` is done, AND if
    the stage has an approval gate marked `required=True`, an
    approval row for that stage exists in `wf.approvals[]`.

  * `advance(tid, wf_id, actor_id, actor_name, actor_role,
    target_stage=None, override=False, reason=None)` -- the atomic
    transition. When `override=False` (the default), refuses to
    transition unless `check_stage_ready` returns True. When
    `override=True`, `reason` is REQUIRED and lands in the workflow
    history + audit_log so an override is never invisible (WE-07 +
    WE-13). Concurrency-safe via `find_one_and_update` on
    `stage_version` (WE-09) -- two closers racing at near-identical
    ms trigger EXACTLY ONE transition; the loser sees "already
    advanced" and exits cleanly. On terminal stage, marks the card
    done and fires exit-hook side-effects.

Side-effects registry (WE-08): each stage's `side_effects[]` list
declares hooks that fire on entry/exit. Built-in kinds:
  - `create_expense` -- port of FIX-001-B (procurement -> Finance
    handoff). Creates a pending expense keyed on workflow_id so
    re-entry is idempotent.
  - `notify_role` -- notifies every member of `params.role` with
    `params.message` (templated with workflow fields).
Adding a new kind is a matter of registering a coroutine in the
`_SIDE_EFFECT_REGISTRY` dict -- everything else routes automatically.

Import contract:
  * This module imports from `core` and `services/*` freely.
  * It MUST NOT import from `server.py` at module load -- that would
    create the same circular-import trap `services/workflows.py`
    documents. `push_notification` and friends are imported inside
    the functions that need them.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from core import db, log_activity, new_id, now_iso, tenant_role_keys


logger = logging.getLogger("decisionos.workflow_engine")


# ---------------------------------------------------------------------------
# Helpers -- pipeline / stage lookups
# ---------------------------------------------------------------------------
async def _load_pipeline(tenant_id: str, wf_type: str) -> Optional[dict]:
    """Return the tenant's pipeline definition for a workflow type, or None."""
    from server import tenant_operating_model  # deferred
    om = await tenant_operating_model(tenant_id)
    for p in (om or {}).get("pipelines") or []:
        if p.get("key") == wf_type:
            return p
    return None


def _stage_object(pipeline: dict, stage_key: str) -> Optional[dict]:
    """Find the {key,label,tasks,approval,side_effects} entry in
    pipeline.stages[] for the given key. Returns None if the pipeline
    doesn't know this stage -- can happen for legacy workflows whose
    stages array was frozen before an owner edited the operating
    model. Callers treat None as "no template" and no-op."""
    for s in (pipeline or {}).get("stages") or []:
        if isinstance(s, dict) and s.get("key") == stage_key:
            return s
        if isinstance(s, str) and s == stage_key:
            return {"key": stage_key, "label": stage_key,
                    "tasks": [], "approval": None, "side_effects": []}
    return None


def _stage_index(wf: dict, stage_key: str) -> int:
    """Position of stage_key in wf.stages[]. -1 if not present. wf.stages
    is stored as a flat list of strings on the workflow doc (denormalized
    at creation time) -- this is separate from the pipeline's structured
    stages[] which carries the WE-03 extensions."""
    for i, s in enumerate(wf.get("stages") or []):
        if s == stage_key:
            return i
    return -1


def _is_terminal(wf: dict, stage_key: str) -> bool:
    stages = wf.get("stages") or []
    return bool(stages) and stages[-1] == stage_key


# ---------------------------------------------------------------------------
# on_stage_enter -- spawn stage template tasks + timeline + notify
# ---------------------------------------------------------------------------
async def on_stage_enter(
    tenant_id: str, workflow_id: str,
    actor_id: str, actor_name: str = "",
) -> dict:
    """Fire the enter-side effects of the workflow's CURRENT stage.

    Idempotent: template-task creation checks for an existing
    (workflow_id, stage_key, source='engine') task before inserting,
    so re-calling this after a crash or re-entry does not duplicate.
    Side-effects (WE-08) route through the registry with their own
    idempotency guarantees per kind.

    Returns:
      {task_ids: [...], side_effects_fired: [kind, ...], stage_key: str}
    """
    from server import pick_least_loaded_member  # deferred
    wf = await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": tenant_id}, {"_id": 0})
    if not wf:
        return {"error": "workflow_not_found"}
    stage_key = wf.get("stage")
    if not stage_key:
        return {"error": "no_stage"}

    pipeline = await _load_pipeline(tenant_id, wf.get("type") or "")
    stage_obj = _stage_object(pipeline, stage_key) if pipeline else None
    template_tasks = (stage_obj or {}).get("tasks") or []
    side_effects = (stage_obj or {}).get("side_effects") or []

    # -----------------------------------------------------------------------
    # Spawn each template task if not already present. The idempotency
    # guard matches on (workflow_id, stage_key, source='engine',
    # title) so an owner-edited template that changes titles gets new
    # tasks correctly, but a plain re-enter does not duplicate.
    # -----------------------------------------------------------------------
    role_keys = await tenant_role_keys(tenant_id)
    created_task_ids: list[str] = []
    for tmpl in template_tasks:
        title = (tmpl.get("title") or "").strip()
        if not title:
            continue
        role = (tmpl.get("role") or "").strip()
        if role and role not in role_keys:
            role = ""  # tolerate role rename -- unassigned rather than blocked
        # Idempotency check.
        existing = await db.tasks.find_one(
            {"tenant_id": tenant_id, "workflow_id": workflow_id,
             "stage_key": stage_key, "source": "engine", "title": title},
            {"_id": 0, "id": 1},
        )
        if existing:
            continue
        assignee_id = None
        if role:
            assignee_id = await pick_least_loaded_member(tenant_id, role)
        tid = new_id()
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id,
            "title": title,
            "description": (
                f"Spawned by workflow '{wf.get('title') or ''}' entering "
                f"stage '{stage_obj.get('label') or stage_key}'."
            ),
            "assignee_role": role or None,
            "assignee_id": assignee_id,
            "priority": "medium", "status": "todo",
            "due_date": None,
            "decision_id": wf.get("decision_id"),
            # WE-01: linkage set at spawn -- WE-06 engine is the only
            # writer that can populate both fields at creation time.
            "workflow_id": workflow_id, "stage_key": stage_key,
            "evidence_required": bool(tmpl.get("evidence_required")),
            "source": "engine",  # sentinel for the idempotency check
            "created_by": actor_id, "created_at": now_iso(),
            "updated_at": now_iso(),
            "last_action": "Auto-spawned by workflow engine",
        })
        created_task_ids.append(tid)

    # -----------------------------------------------------------------------
    # Timeline entry -- separate from the wf.history advance record.
    # `on_stage_enter` may fire for the same stage twice (a crash between
    # advance and enter would replay); a dedicated `stage_events[]` array
    # keeps the record without polluting the transition history.
    # -----------------------------------------------------------------------
    await db.workflows.update_one(
        {"id": workflow_id, "tenant_id": tenant_id},
        {"$push": {"stage_events": {
            "kind": "entered", "stage": stage_key,
            "at": now_iso(),
            "by": actor_id, "by_name": actor_name or "",
            "task_ids": created_task_ids,
        }}},
    )

    # -----------------------------------------------------------------------
    # WE-08 side-effects. Registry lookup + call. Each hook is
    # coroutine(tenant_id, wf, stage_obj, params, actor_id) -> Optional[dict]
    # returning whatever they created (for logging / test hooks).
    # A missing kind is logged and skipped -- never crash the transition
    # over a typo in an operating_model side_effects entry.
    # -----------------------------------------------------------------------
    fired: list[str] = []
    for se in side_effects:
        kind = (se.get("kind") or "").strip()
        params = se.get("params") or {}
        handler = _SIDE_EFFECT_REGISTRY.get(kind)
        if not handler:
            logger.warning(
                f"[WE-08] unknown side-effect kind {kind!r} on "
                f"{wf.get('type')}.{stage_key} in tenant {tenant_id}; skipping"
            )
            continue
        try:
            await handler(tenant_id, wf, stage_obj, params, actor_id, actor_name)
            fired.append(kind)
        except Exception as e:
            # Side-effect failure MUST NOT roll back the transition.
            # The workflow moved; we just log the miss and let ops
            # investigate. The advance itself is durable.
            logger.exception(
                f"[WE-08] side-effect {kind!r} failed on "
                f"{wf.get('type')}.{stage_key} for {workflow_id}: {e}"
            )

    return {"task_ids": created_task_ids, "side_effects_fired": fired,
            "stage_key": stage_key}


# ---------------------------------------------------------------------------
# check_stage_ready -- ALL stage tasks done AND all required approvals present
# ---------------------------------------------------------------------------
async def check_stage_ready(tenant_id: str, workflow_id: str) -> dict:
    """Report whether the workflow's CURRENT stage's contract is
    satisfied.

    Returns:
      {ready: bool, reason: str, open_task_ids: [...], missing_approval: bool}
    """
    wf = await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": tenant_id}, {"_id": 0})
    if not wf:
        return {"ready": False, "reason": "workflow_not_found",
                "open_task_ids": [], "missing_approval": False}
    stage_key = wf.get("stage")

    # Tasks -- any open task tagged (workflow_id, stage_key) blocks.
    open_tasks = await db.tasks.find(
        {"tenant_id": tenant_id, "workflow_id": workflow_id,
         "stage_key": stage_key,
         "status": {"$nin": ["done", "cancelled"]}},
        {"_id": 0, "id": 1},
    ).to_list(500)
    open_ids = [t["id"] for t in open_tasks]
    if open_ids:
        return {"ready": False,
                "reason": f"{len(open_ids)} task(s) still open at this stage",
                "open_task_ids": open_ids, "missing_approval": False}

    # Approval gate -- WE-03 stage.approval = {role, required}.
    pipeline = await _load_pipeline(tenant_id, wf.get("type") or "")
    stage_obj = _stage_object(pipeline, stage_key) if pipeline else None
    appr_spec = (stage_obj or {}).get("approval") or None
    if appr_spec and appr_spec.get("required"):
        already = any(
            (a or {}).get("stage_key") == stage_key
            for a in (wf.get("approvals") or [])
        )
        if not already:
            return {"ready": False,
                    "reason": f"awaiting {appr_spec.get('role')} approval",
                    "open_task_ids": [], "missing_approval": True}

    return {"ready": True, "reason": "ok",
            "open_task_ids": [], "missing_approval": False}


# ---------------------------------------------------------------------------
# record_stage_approval -- explicit "I approve this stage" event
# ---------------------------------------------------------------------------
async def record_stage_approval(
    tenant_id: str, workflow_id: str,
    actor_id: str, actor_name: str, actor_role: str,
) -> dict:
    """Record an approval for the workflow's CURRENT stage.

    Enforces the stage.approval.role check -- only members of that role
    (or owner) may approve. Idempotent: a repeat approval for the same
    (stage_key, actor_id) does not duplicate the entry.
    """
    wf = await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": tenant_id},
        {"_id": 0, "id": 1, "stage": 1, "type": 1, "approvals": 1},
    )
    if not wf:
        return {"ok": False, "error": "workflow_not_found"}
    stage_key = wf.get("stage")
    pipeline = await _load_pipeline(tenant_id, wf.get("type") or "")
    stage_obj = _stage_object(pipeline, stage_key) if pipeline else None
    appr_spec = (stage_obj or {}).get("approval") or None
    if not appr_spec:
        return {"ok": False, "error": "stage_has_no_approval_gate"}
    required_role = appr_spec.get("role")
    if actor_role != "owner" and actor_role != required_role:
        return {"ok": False, "error": "wrong_role",
                "required": required_role, "actor": actor_role}
    # Idempotency
    for a in (wf.get("approvals") or []):
        if (a or {}).get("stage_key") == stage_key and (a or {}).get("actor_id") == actor_id:
            return {"ok": True, "already_recorded": True}
    entry = {
        "stage_key": stage_key,
        "actor_id": actor_id, "actor_name": actor_name or "",
        "actor_role": actor_role,
        "recorded_at": now_iso(),
    }
    await db.workflows.update_one(
        {"id": workflow_id, "tenant_id": tenant_id},
        {"$push": {"approvals": entry}},
    )
    await log_activity(
        tenant_id, actor_id, "workflow_stage_approved",
        f"Approved '{wf.get('title') or workflow_id}' at stage '{stage_key}'",
        "workflow", workflow_id,
    )
    return {"ok": True, "already_recorded": False, "entry": entry}


# ---------------------------------------------------------------------------
# advance -- the atomic transition (WE-06 + WE-07 + WE-09)
# ---------------------------------------------------------------------------
class WorkflowAdvanceError(Exception):
    """Raised for any refusal (contract failed, invalid stage, override
    missing reason, ...). Router translates to the appropriate HTTP
    status code."""
    def __init__(self, message: str, code: str = "invalid",
                 http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.http_status = http_status


async def advance(
    tenant_id: str, workflow_id: str,
    actor_id: str, actor_name: str, actor_role: str,
    *,
    target_stage: Optional[str] = None,
    note: str = "",
    override: bool = False,
    reason: str = "",
) -> dict:
    """Move a workflow forward one stage -- atomically.

    Contract:
      * target_stage MUST be exactly current+1. Skipping is disallowed.
        Callers may pass None to mean "the next stage" -- this makes
        engine-driven advances (task closer -> engine.advance) as
        simple as `advance(tid, wf_id, actor_id, actor_name, actor_role)`.
      * When override=False, check_stage_ready MUST return ready.
        Otherwise WorkflowAdvanceError is raised.
      * When override=True, reason MUST be non-empty (WE-13 UX
        guarantee) and lands in wf.history + audit_log.
      * The approval-stage owner-only gate is preserved from the
        legacy endpoint: only role=owner may advance INTO the
        pipeline's approval_stage.
      * find_one_and_update on (id, stage_version) is the atomicity
        primitive (WE-09). If a concurrent caller already advanced,
        the loser gets `already_advanced=True` without an error --
        the transition happened, just not by us.

    On success, returns the updated workflow doc + summary of enter
    side-effects (task ids, side-effects fired).
    """
    wf = await db.workflows.find_one(
        {"id": workflow_id, "tenant_id": tenant_id}, {"_id": 0})
    if not wf:
        raise WorkflowAdvanceError("Workflow not found", "not_found", 404)

    stages = wf.get("stages") or []
    current_stage = wf.get("stage")
    cur_idx = _stage_index(wf, current_stage)
    if cur_idx < 0:
        raise WorkflowAdvanceError(
            f"Current stage {current_stage!r} not in stages array",
            "corrupt_stage", 500,
        )

    if target_stage is None:
        if cur_idx + 1 >= len(stages):
            raise WorkflowAdvanceError(
                "Already at terminal stage -- cannot advance further",
                "at_terminal", 400,
            )
        target_stage = stages[cur_idx + 1]

    if target_stage not in stages:
        raise WorkflowAdvanceError(
            f"Invalid target stage {target_stage!r}", "invalid_stage", 400,
        )
    tgt_idx = _stage_index(wf, target_stage)
    if tgt_idx != cur_idx + 1:
        raise WorkflowAdvanceError(
            "Can only advance to the next stage", "not_next", 400,
        )

    # Owner-only gate for the pipeline's approval_stage (legacy
    # behaviour preserved for backward compat).
    pipeline = await _load_pipeline(tenant_id, wf.get("type") or "")
    appr_stage = None
    if pipeline:
        appr_stage = pipeline.get("approval_stage")
    if appr_stage and target_stage == appr_stage and actor_role != "owner":
        raise WorkflowAdvanceError(
            "Only the owner can approve this stage",
            "owner_only_approval", 403,
        )

    # Contract check unless the caller override'd.
    if not override:
        rc = await check_stage_ready(tenant_id, workflow_id)
        if not rc.get("ready"):
            raise WorkflowAdvanceError(
                f"Stage not ready: {rc.get('reason')}",
                "not_ready", 409,
            )
    else:
        if not (reason or "").strip():
            raise WorkflowAdvanceError(
                "override=True requires a non-empty reason",
                "reason_required", 400,
            )

    # WE-09: atomic transition via find_one_and_update on stage_version.
    # If the workflow was already advanced by another writer, the CAS
    # filter misses and we exit cleanly with already_advanced=True.
    #
    # Edge case (from we_epic5_edge_cases case_11): a legacy or
    # corrupted document may carry stage_version: None on disk. The
    # int(...) coercion below gives us 0 in Python, but a Mongo query
    # for {stage_version: 0} does NOT match {stage_version: null}.
    # So when prev_version resolves to 0, we widen the filter to
    # accept the field being 0, absent, or null -- three equivalent
    # states for "never advanced by the engine". Post-first-advance
    # the field is always a real integer.
    raw_version = wf.get("stage_version")
    prev_version = int(raw_version) if isinstance(raw_version, int) else 0
    if prev_version == 0:
        version_match = {"$in": [0, None]}
        # Note: {$in: [0, None]} matches missing OR null OR 0. Explicit
        # $exists:False is unnecessary -- Mongo's $in with null covers
        # absent fields too.
    else:
        version_match = prev_version
    hist_entry = {
        "stage": target_stage, "note": note or "",
        "by": actor_id, "by_name": actor_name or "",
        "at": now_iso(),
    }
    if override:
        hist_entry["override"] = True
        hist_entry["reason"] = reason.strip()
    updated = await db.workflows.find_one_and_update(
        {"id": workflow_id, "tenant_id": tenant_id,
         "stage_version": version_match, "stage": current_stage},
        {"$set": {"stage": target_stage, "stage_version": prev_version + 1,
                  "updated_at": now_iso()},
         "$push": {"history": hist_entry}},
        return_document=True,
        projection={"_id": 0},
    )
    if not updated:
        # CAS lost: someone else advanced this workflow. Re-read + report.
        latest = await db.workflows.find_one(
            {"id": workflow_id, "tenant_id": tenant_id}, {"_id": 0})
        return {
            "advanced": False, "already_advanced": True,
            "current_stage": latest.get("stage") if latest else None,
            "workflow": latest,
        }

    # Audit log (kept separate from workflow.history so the tenant's
    # audit_log collection stays the single source of truth for cross-
    # entity actions).
    await log_activity(
        tenant_id, actor_id, "workflow_advanced",
        f"'{wf.get('title')}' -> {target_stage}"
        + (f" [override: {reason.strip()}]" if override else ""),
        "workflow", workflow_id,
    )

    # WE-06: fire on_stage_enter for the new stage. If terminal, also
    # execute any exit hooks the stage carries.
    enter_summary = await on_stage_enter(
        tenant_id, workflow_id, actor_id, actor_name)

    # Terminal marker + terminal-only hook execution. The current
    # stage's own side_effects fire via on_stage_enter above; if the
    # tenant wants "on completion" hooks that only fire at the very
    # last stage, they can attach them to the terminal stage's
    # side_effects[]. No separate hook plane -- keeps the model flat.
    terminal = _is_terminal(updated, target_stage)
    if terminal:
        await db.workflows.update_one(
            {"id": workflow_id, "tenant_id": tenant_id},
            {"$set": {"completed_at": now_iso()}},
        )

    # Brain-context write -- preserved from the legacy endpoint (S4-10).
    # Fail-open: never let a Brain write break the advance.
    try:
        from services.ai import brain_context
        await brain_context.record_context(
            tenant_id=tenant_id, kind="workflow",
            title=f"{wf.get('title') or 'Workflow'} -> {target_stage}",
            outcome="completed" if terminal else "advanced",
            why=(note or ""),
            tags=[wf.get("type")] if wf.get("type") else [],
            source_type="workflow", source_id=workflow_id,
            decision_id=wf.get("decision_id"),
            related_ids={"workflow_type": wf.get("type"),
                          "counterparty": wf.get("counterparty")},
            actor_id=actor_id, actor_name=actor_name or "",
            department=actor_role or "", visibility="public",
        )
    except Exception as e:
        logger.warning(f"[WE-06] brain_context write skipped for {workflow_id}: {e}")

    return {
        "advanced": True, "already_advanced": False,
        "workflow": updated,
        "prev_stage": current_stage, "new_stage": target_stage,
        "terminal": terminal,
        "enter_summary": enter_summary,
    }


# ---------------------------------------------------------------------------
# WE-08 side-effects registry
# ---------------------------------------------------------------------------
async def _side_effect_create_expense(
    tenant_id: str, wf: dict, stage_obj: dict,
    params: dict, actor_id: str, actor_name: str,
) -> Optional[dict]:
    """WE-08 built-in: on stage entry (typically the terminal
    procurement stage), create a pending-bill expense keyed on
    workflow_id so re-entry after a manual back-and-forth does not
    duplicate. Port of FIX-001-B; behaviour preserved verbatim.

    Params (all optional):
      * status: expense status to write (default "awaiting_bill")
      * category: category slug to tag the expense with
    """
    workflow_id = wf.get("id")
    # Idempotency: match on tenant + workflow_id.
    existing = await db.expenses.find_one(
        {"tenant_id": tenant_id, "workflow_id": workflow_id},
        {"_id": 0, "id": 1},
    )
    if existing:
        return {"already_exists": True, "expense_id": existing["id"]}
    from routers.ledger import create_expense
    est_amt = wf.get("amount") if isinstance(wf.get("amount"), (int, float)) else 0.0
    exp = await create_expense(
        tenant_id, actor_id,
        {
            "title": wf.get("title") or "Procurement expense",
            "amount": est_amt,
            "vendor_name": wf.get("counterparty") or "",
            "status": params.get("status") or "awaiting_bill",
            "category": params.get("category") or None,
            "notes": (
                f"Auto-created from workflow '{wf.get('title')}' "
                f"entering stage '{stage_obj.get('label') or stage_obj.get('key')}'. "
                f"Estimated amount from the workflow card; upload the actual bill to reconcile."
            ),
            "workflow_id": workflow_id,
            "workflow_type": wf.get("type"),
        },
        source="workflow_engine", write_brain=True,
    )
    return {"expense_id": exp.get("id"), "amount": est_amt}


async def _side_effect_notify_role(
    tenant_id: str, wf: dict, stage_obj: dict,
    params: dict, actor_id: str, actor_name: str,
) -> Optional[dict]:
    """WE-08 built-in: push a notification to every user of a given
    role. Params: {role, message (optional template), level (default 2)}."""
    role = (params.get("role") or "").strip()
    if not role:
        return {"skipped": "no_role"}
    from server import push_notification  # deferred
    tenants_users = await db.users.find(
        {"tenant_id": tenant_id, "role": role},
        {"_id": 0, "id": 1},
    ).to_list(200)
    ids = [u["id"] for u in tenants_users if u.get("id") and u["id"] != actor_id]
    if not ids:
        return {"skipped": "no_recipients"}
    msg = (params.get("message") or
           f"'{wf.get('title')}' entered stage '{stage_obj.get('label') or stage_obj.get('key')}'")
    await push_notification(
        tenant_id, ids, int(params.get("level") or 2),
        msg, "workflow", wf.get("id"),
        ntype="stage_entered", title=wf.get("title"),
        sender=actor_name or "workflow",
    )
    return {"notified_user_ids": ids}


_SIDE_EFFECT_REGISTRY = {
    "create_expense": _side_effect_create_expense,
    "notify_role": _side_effect_notify_role,
}


def registered_side_effect_kinds() -> list:
    """Public helper -- Settings UI can call this to list valid kinds
    when the founder authors a stage.side_effects entry."""
    return sorted(_SIDE_EFFECT_REGISTRY.keys())

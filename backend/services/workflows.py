"""Workflow / pipeline helpers.

Kept in `services/` so both routers and server.py can share the logic
without pulling each other in as a dependency (server.py cannot be
imported from routers -- that's the historical circular-import rule).

Introduced in FIX-001-A to remove the textile-era `purchase_payment`
hardcode that was leaking into approval flows, the CEO dashboard, and the
morning brief. Every non-textile tenant (bakery, salon, boutique, clinic,
workshop) has an AI-designed operating model with pipeline keys like
`procurement` or `ingredient_purchase`; those tenants silently lost owner
sign-off + pending-approval counters before this helper existed.

Resolution rule (`tenant_procurement_pipeline`):
  1. Prefer the pipeline whose `approval_stage` is set -- that IS the
     product's definition of "the pipeline the owner needs to sign off on"
     (see `_design_operating_model` in server.py).
  2. Fall back to the legacy hardcoded `purchase_payment` key so demo
     tenants and any tenant not yet re-designed still work.
  3. Return None if neither exists -- callers treat that as "this tenant
     has no procurement pipeline" and skip the check, rather than
     defaulting to a wrong pipeline.
"""
from typing import Optional

# Deferred import inside the functions so this module has zero import-time
# cost and no circular-import risk with server.py (which itself imports
# from services/).


async def tenant_procurement_pipeline(tenant_id: str) -> Optional[dict]:
    """Return the tenant's procurement pipeline dict, or None if none.

    The returned dict is the pipeline entry from the tenant's operating
    model: `{key, label, sub?, stages: [{key,label}, ...], approval_stage}`.
    """
    from server import tenant_operating_model  # deferred: no import-time cycle
    om = await tenant_operating_model(tenant_id)
    pipelines = (om or {}).get("pipelines") or []
    for p in pipelines:
        if p.get("approval_stage"):
            return p
    # Legacy fallback: pre-dynamic tenants may still carry the hardcoded
    # textile key without an `approval_stage` field. Match by key.
    for p in pipelines:
        if p.get("key") == "purchase_payment":
            return p
    return None


def procurement_initial_stage(pipeline: dict) -> Optional[str]:
    """Return the key of a pipeline's first stage (the "just requested"
    state where a workflow card lands when auto-created). Returns None
    if the pipeline has no stages."""
    stages = (pipeline or {}).get("stages") or []
    if not stages:
        return None
    first = stages[0]
    return first.get("key") if isinstance(first, dict) else first


def procurement_terminal_stage(pipeline: dict) -> Optional[str]:
    """Return the key of a pipeline's last stage (typically the
    "paid" / "delivered" / "completed" state, whatever the tenant's
    AI-designed pipeline called it)."""
    stages = (pipeline or {}).get("stages") or []
    if not stages:
        return None
    last = stages[-1]
    return last.get("key") if isinstance(last, dict) else last


def procurement_penultimate_stage(pipeline: dict) -> Optional[str]:
    """Return the key of the stage just before the terminal one
    (the natural "awaiting payment / awaiting final action" stage for
    payment-overdue tracking). Returns None if the pipeline has fewer
    than 2 stages.

    Convention: for the textile default pipeline this is `payment_pending`
    (second-to-last of [requested, approved, ordered, received,
    payment_pending, paid]); for AI-designed pipelines it's whatever the
    AI named that role.
    """
    stages = (pipeline or {}).get("stages") or []
    if len(stages) < 2:
        return None
    pen = stages[-2]
    return pen.get("key") if isinstance(pen, dict) else pen


def all_terminal_stages(operating_model: dict,
                        *, include_legacy: bool = True) -> list:
    """Return the set of stage keys that mark a workflow as COMPLETE for
    this tenant. Used by dashboard counters + "pending deliveries" filters
    that need to know "which stages mean 'done, stop counting me as active'."

    Introduced by FIX-001-F to replace the textile-era hardcode
    `["delivered", "paid"]` that made every non-textile tenant's "active
    workflows" number climb forever (a salon's terminal stage might be
    'served', a bakery's 'settled', a boutique's 'dispatched').

    include_legacy=True (default) also includes 'delivered' and 'paid' so
    legacy workflow cards created under the old textile default still get
    excluded — otherwise a re-designed tenant's old cards would suddenly
    reappear in the active counter. This is a compatibility hedge, not a
    guess: those two stage names WILL be terminal for any pipeline whose
    stages actually contain them anyway; the include_legacy adds them
    unconditionally so pre-migration cards are covered.
    """
    out = []
    for p in (operating_model or {}).get("pipelines") or []:
        term = procurement_terminal_stage(p)
        if term and term not in out:
            out.append(term)
    if include_legacy:
        for legacy in ("delivered", "paid"):
            if legacy not in out:
                out.append(legacy)
    return out


async def tenant_terminal_stages(tenant_id: str,
                                 *, include_legacy: bool = True) -> list:
    """Same as `all_terminal_stages` but resolves the tenant's operating
    model from the DB first. The natural call-site helper for dashboard
    counters (`{"stage": {"$nin": await tenant_terminal_stages(tid)}}`)."""
    from server import tenant_operating_model  # deferred: avoid import cycle
    om = await tenant_operating_model(tenant_id)
    return all_terminal_stages(om, include_legacy=include_legacy)


async def derive_task_workflow_link(
    tenant_id: str,
    *,
    workflow_id: Optional[str] = None,
    stage_key: Optional[str] = None,
    decision_id: Optional[str] = None,
    strict: bool = True,
) -> tuple:
    """WE-01 (2026-08-16): resolve the (workflow_id, stage_key) pair for
    a task that is about to be written.

    Resolution rules (first match wins):

    1. `workflow_id` supplied — validate against tenant scope. Reject
       cross-tenant / nonexistent refs when `strict=True` (returns
       (None, None) with `strict=False` so bulk/backfill paths can
       skip silently). If `stage_key` is also given, it must be one of
       the workflow's declared stage keys; otherwise it's replaced by
       the workflow's current stage.

    2. `decision_id` supplied and exactly ONE workflow shares it — link
       to that workflow's current stage. Zero or multiple matches ->
       (None, None) since ambiguity is worse than "no link".

    3. Otherwise (None, None) — an ad-hoc task.

    Returns (workflow_id_or_None, stage_key_or_None). Guarantees the
    two are consistent: stage_key is never returned without a
    workflow_id. Callers store the tuple directly on the task doc.

    strict: when True (default, used by user-facing endpoints), an
    invalid workflow_id RAISES the caller-visible error the way the
    router expects. When False (backfill / voice post-pass), invalid
    refs are silently dropped to (None, None) so a single stale ref
    doesn't crash a batch of 100 tasks.
    """
    from core import db

    if workflow_id:
        wf = await db.workflows.find_one(
            {"id": workflow_id, "tenant_id": tenant_id},
            {"_id": 0, "id": 1, "stage": 1, "stages": 1},
        )
        if not wf:
            if strict:
                # Caller will translate this into 400/404. Raising here
                # centralises the "workflow not found" message so every
                # task-create endpoint says the same thing.
                raise ValueError(
                    f"workflow_id {workflow_id!r} not found in this workspace"
                )
            return (None, None)
        # Validate stage_key against the workflow's declared stages.
        valid_keys = set()
        for s in wf.get("stages") or []:
            valid_keys.add(s if isinstance(s, str) else s.get("key"))
        valid_keys.discard(None)
        if stage_key and stage_key not in valid_keys:
            if strict:
                raise ValueError(
                    f"stage_key {stage_key!r} is not a stage of workflow "
                    f"{workflow_id!r} (valid: {sorted(valid_keys)})"
                )
            stage_key = None
        # No stage_key supplied -> default to the workflow's current
        # stage so a task from the "Add task to this card" button lands
        # on the stage the user is looking at.
        if not stage_key:
            stage_key = wf.get("stage")
        return (wf["id"], stage_key)

    # stage_key without workflow_id is semantically invalid. Ad-hoc
    # tasks don't belong to any stage. Reject rather than silently
    # coerce; the caller either wanted linkage (and should supply the
    # workflow_id too) or didn't (and shouldn't have sent stage_key).
    if stage_key and not workflow_id:
        if strict:
            raise ValueError(
                "stage_key was provided without workflow_id -- "
                "ad-hoc tasks cannot have a stage"
            )
        return (None, None)

    if decision_id:
        wfs = await db.workflows.find(
            {"tenant_id": tenant_id, "decision_id": decision_id},
            {"_id": 0, "id": 1, "stage": 1},
        ).to_list(2)
        if len(wfs) == 1:
            return (wfs[0]["id"], wfs[0].get("stage"))
        # Zero: this decision didn't spawn a workflow. Multiple: rare
        # (one decision, two workflows) but disambiguation would need
        # extra caller-supplied signal we don't have -- leave unlinked
        # rather than pick wrong.

    return (None, None)


def stage_owned_by(pipeline: dict, role: str) -> Optional[str]:
    """WE-01.5 (2026-08-16): return the pipeline stage.key where the
    given role is the natural owner.

    Used by voice-capture to route each freshly-spawned task to the
    stage that role owns, so the engine can auto-advance the full
    chain instead of stalling after one transition. A Kapoor decision
    that spawns [sales task, finance task, ops task] now lands them
    at [order_received, confirmed, in_production] respectively --
    each task-close pushes the card to the next stage where the next
    task is already waiting.

    Resolution order:
      1. Explicit stage.role field matches -> return it.
      2. Any task template on the stage has this role -> return it.
      3. No match -> None (caller falls back to workflow's current
         stage, which preserves pre-WE-01.5 behaviour).

    Returns None (not empty string) when nothing matches, so callers
    can distinguish "unassigned" from a legitimately empty role.
    """
    if not (pipeline and role):
        return None
    role_s = role.strip().lower()
    if not role_s:
        return None
    # Pass 1: explicit stage.role
    for s in (pipeline.get("stages") or []):
        if not isinstance(s, dict):
            continue
        if (s.get("role") or "").strip().lower() == role_s:
            return s.get("key")
    # Pass 2: derive from stage.tasks[*].role
    for s in (pipeline.get("stages") or []):
        if not isinstance(s, dict):
            continue
        for t in (s.get("tasks") or []):
            if (t.get("role") or "").strip().lower() == role_s:
                return s.get("key")
    return None


def stage_key_for_backfill(workflow_doc: dict) -> Optional[str]:
    """WE-01: pick a safe stage_key value when back-linking a legacy
    task to a workflow that has since advanced past its origin stage.

    Uses the INITIAL stage (not current) because:
      * The task was spawned when the workflow was created, i.e. at
        stages[0]. That's the stage it originally "belonged to".
      * Setting stage_key to the current stage would falsely make the
        engine think this task is gating advance out of the current
        stage -- but the task was for the OLD stage. False block =
        bug.
      * Setting stage_key to the initial stage means engine's
        check_stage_ready(current_stage) doesn't see this task at
        all -- correct: legacy tasks don't gate anything.

    Returns None if the workflow has no stages array (defensive).
    """
    stages = (workflow_doc or {}).get("stages") or []
    if not stages:
        return None
    first = stages[0]
    return first if isinstance(first, str) else first.get("key")

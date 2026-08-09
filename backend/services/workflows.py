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

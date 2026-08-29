"""FIX-005-B (S3-04): tenant-scoped usage-quota enforcement.

Composes FIX-005-A plan model + existing usage_events log into a
hard cutoff. Without this, a tenant on any paid plan can run up
unlimited LLM/STT cost — usage.py tracks the estimate but nothing
stops the request.

Design:
  * Quotas are MONTHLY caps set by the tenant's plan (see
    services.plans.PLAN_DEFINITIONS). Overridable per-tenant via
    tenant.usage_quotas.
  * Aggregation window = current calendar month (UTC). A tenant's
    100k-token cap resets on the 1st.
  * check_quota(db, tenant_id, resource, cost=0) returns (ok,
    detail) where detail carries usage / cap / percent so a caller
    can turn a 402 into a friendly response with an upgrade CTA
    + soft-limit warning at 75/90/100% (rendered client-side).
  * Fail-open: a Mongo blip on the usage-aggregation side must not
    block user work. Log + allow.
  * Enforced at two choke points:
      1. services.llm_limits.guarded_llm before every LLM call
         (llm_tokens_total quota).
      2. services.uploads.store_upload before every upload
         (storage_bytes quota).
    STT-minute quota is enforced in the STT call sites (server.py
    voice-note + meeting endpoints).

Contract:
  check_quota(db, tenant_id, resource, cost=0) ->
    (ok, {resource, usage, cap, percent, remaining, over})
    ok=True when usage+cost <= cap; ok=False when cap breached.
    cap=None (unlimited) -> ok=True always.

  aggregate_usage(db, tenant_id, since_iso=None) -> {resource: total}
    Sums usage_events for the current month by default. Cheap read
    via the (tenant_id, created_at) index.

  quota_status(db, tenant, resource) -> {usage, cap, percent, over}
    For the frontend dashboard — no cost projection.
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

from core import logger


# Map "resource" (plan quota key) to the aggregation over usage_events.
# `field` is the usage_events column to sum; when None, `resource` is
# derived from the plan (storage_bytes for uploads, brain_docs for
# brain_documents count).
_RESOURCE_AGGREGATIONS = {
    "llm_tokens_total": {"field": "tokens_total"},
    "stt_minutes": {"field": "units", "unit_type": "minutes"},
    # storage_bytes + brain_docs are counted from other collections at
    # check_quota time; usage_events doesn't carry them.
}


def _month_start_iso() -> str:
    """First day of the current UTC month, at 00:00, as iso string."""
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


async def aggregate_usage(
    db,
    tenant_id: str,
    since_iso: Optional[str] = None,
) -> Dict[str, float]:
    """Sum usage_events for `tenant_id` from `since_iso` (default:
    start of current UTC month). Returns totals for every resource
    that lives in usage_events."""
    since = since_iso or _month_start_iso()
    out: Dict[str, float] = {"llm_tokens_total": 0, "stt_minutes": 0}
    try:
        # LLM tokens: sum tokens_total across all providers.
        # NB: AsyncMongoClient.aggregate() is a coroutine -> MUST be awaited
        # before iterating. Without the await the `async for` below raises
        # and the broad except silently fails open (BUG-14: the token/STT
        # quota never actually enforced).
        cursor = await db.usage_events.aggregate([
            {"$match": {"tenant_id": tenant_id, "created_at": {"$gte": since}}},
            {"$group": {
                "_id": None,
                "llm_tokens_total": {"$sum": "$tokens_total"},
                "stt_minutes": {
                    "$sum": {
                        "$cond": [
                            {"$eq": ["$unit_type", "minutes"]},
                            "$units",
                            0,
                        ],
                    },
                },
            }},
        ])
        async for row in cursor:
            out["llm_tokens_total"] = row.get("llm_tokens_total") or 0
            out["stt_minutes"] = row.get("stt_minutes") or 0
    except Exception as e:
        # Fail-open: return zeros so quota-check passes rather than
        # blocking every AI call on a Mongo blip.
        logger.warning(f"[quotas] aggregate_usage failed for {tenant_id!r}: {e}")
    return out


async def _storage_bytes(db, tenant_id: str) -> int:
    """Sum file sizes across the collections that hold uploads. Cheap
    aggregate since files are indexed by tenant_id."""
    total = 0
    try:
        # `files` collection holds attachments + uploads with a `size`
        # field written by services.uploads.
        # await: aggregate() is a coroutine on AsyncMongoClient (see BUG-14).
        async for row in await db.files.aggregate([
            {"$match": {"tenant_id": tenant_id}},
            {"$group": {"_id": None, "total": {"$sum": "$size"}}},
        ]):
            total += row.get("total") or 0
    except Exception as e:
        logger.warning(f"[quotas] storage_bytes failed for {tenant_id!r}: {e}")
    return total


async def _brain_docs_count(db, tenant_id: str) -> int:
    try:
        return await db.brain_documents.count_documents(
            {"tenant_id": tenant_id, "is_deleted": {"$ne": True}},
        )
    except Exception as e:
        logger.warning(f"[quotas] brain_docs count failed for {tenant_id!r}: {e}")
        return 0


async def _usage_for_resource(db, tenant_id: str, resource: str) -> float:
    """Look up current usage for one resource. Handles both
    usage_events-sourced (LLM tokens, STT minutes) and
    collection-count-sourced (storage bytes, brain docs) resources."""
    if resource in _RESOURCE_AGGREGATIONS:
        agg = await aggregate_usage(db, tenant_id)
        return agg.get(resource, 0)
    if resource == "storage_bytes":
        return await _storage_bytes(db, tenant_id)
    if resource == "brain_docs":
        return await _brain_docs_count(db, tenant_id)
    return 0


async def check_quota(
    db,
    tenant_id: str,
    resource: str,
    cost: float = 0,
) -> Tuple[bool, Dict[str, Any]]:
    """Return (ok, detail). `cost` is the projected increment for
    THIS call (e.g. estimated tokens the LLM call will consume) so
    the enforcer can pre-block a call that would go over the cap.

    Callers should raise HTTPException(402) with detail when ok=False.
    """
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    from services.plans import effective_plan
    ep = effective_plan(tenant or {})
    cap = (ep.get("quotas") or {}).get(resource)
    # Unlimited plans -> always OK.
    if cap is None:
        return True, {
            "resource": resource,
            "usage": 0,
            "cap": None,
            "percent": 0,
            "remaining": None,
            "over": False,
            "plan": ep.get("key"),
        }
    usage = await _usage_for_resource(db, tenant_id, resource)
    projected = usage + max(0, float(cost or 0))
    over = projected > cap
    percent = round((projected / cap) * 100, 1) if cap else 0
    return (not over), {
        "resource": resource,
        "usage": usage,
        "projected": projected,
        "cap": cap,
        "percent": percent,
        "remaining": max(0, cap - usage),
        "over": over,
        "plan": ep.get("key"),
    }


async def quota_status(
    db,
    tenant: Optional[Dict[str, Any]],
    resource: str,
) -> Dict[str, Any]:
    """Frontend-facing status for one resource — no projection."""
    from services.plans import effective_plan
    ep = effective_plan(tenant or {})
    cap = (ep.get("quotas") or {}).get(resource)
    if cap is None:
        return {"resource": resource, "usage": 0, "cap": None, "percent": 0, "over": False}
    tid = (tenant or {}).get("id")
    usage = await _usage_for_resource(db, tid, resource) if tid else 0
    percent = round((usage / cap) * 100, 1) if cap else 0
    return {
        "resource": resource,
        "usage": usage,
        "cap": cap,
        "percent": percent,
        "remaining": max(0, cap - usage),
        "over": usage > cap,
    }


async def quota_status_all(db, tenant: Optional[Dict[str, Any]]) -> list:
    """All quotas at once — powers the frontend usage dashboard."""
    from services.plans import effective_plan
    ep = effective_plan(tenant or {})
    out = []
    for k in (ep.get("quotas") or {}).keys():
        out.append(await quota_status(db, tenant, k))
    return out

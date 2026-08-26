"""Per-tenant AI cost budgets + graceful degradation (Epic 3 Sprint 8 -- E3-08.3).

DecisionOS already tracks a USD cost estimate per AI call (usage_events.cost_estimate)
and enforces a token-count quota in guarded_llm. This adds a complementary MONEY
budget: a tenant's month-to-date AI spend is capped so a runaway loop or an abusive
tenant can't rack up unbounded provider cost.

Design:
* Opt-in. AI_MONTHLY_BUDGET_USD defaults to 0 (unlimited) -> zero overhead and no
  behaviour change unless an operator sets a budget (env) or a tenant carries an
  ``ai_budget_usd`` override.
* Enforced at the single choke point (guarded_llm), which already has the tenant on
  the request context. Over budget -> HTTPException(402) with a clear message
  (callers that catch it degrade gracefully to non-AI defaults; direct AI endpoints
  surface the 402). Near budget (>=90%) -> warn, don't block.
* Spend is cached briefly per tenant so we don't run a Mongo aggregate on every call.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone

NEAR_RATIO = 0.9
AI_MONTHLY_BUDGET_USD = float(os.environ.get("AI_MONTHLY_BUDGET_USD", "0") or 0)  # 0 = unlimited
_CACHE_TTL = float(os.environ.get("AI_BUDGET_CACHE_TTL", "60") or 60)

_spend_cache: dict = {}  # tenant_id -> (checked_at_epoch, spend_usd)


class AIBudgetExceeded(Exception):
    """Raised (as an HTTPException in the gate) when a tenant is over its AI budget."""


def budget_state(spend: float, budget: float) -> str:
    """Pure: 'unlimited' (no budget set) | 'ok' | 'near' (>=90%) | 'over' (>=100%)."""
    if not budget or budget <= 0:
        return "unlimited"
    if spend >= budget:
        return "over"
    if spend >= budget * NEAR_RATIO:
        return "near"
    return "ok"


def tenant_budget_usd(tenant_doc: dict) -> float:
    """A tenant's monthly AI budget: its own ``ai_budget_usd`` override if positive,
    else the deployment default AI_MONTHLY_BUDGET_USD. 0 = unlimited."""
    v = (tenant_doc or {}).get("ai_budget_usd")
    try:
        v = float(v)
        if v > 0:
            return v
    except (TypeError, ValueError):
        pass
    return AI_MONTHLY_BUDGET_USD


def _month_start_iso() -> str:
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


async def tenant_ai_spend_usd(db, tenant_id: str, use_cache: bool = True) -> float:
    """Month-to-date AI spend (USD) for a tenant, summed from usage_events. Cached for
    _CACHE_TTL seconds. Never raises -> 0.0 on any error (fail-open)."""
    if use_cache:
        c = _spend_cache.get(tenant_id)
        if c and (time.time() - c[0]) < _CACHE_TTL:
            return c[1]
    try:
        # this driver's aggregate() returns a coroutine -> await it, then to_list
        cur = await db.usage_events.aggregate([
            {"$match": {"tenant_id": tenant_id, "created_at": {"$gte": _month_start_iso()}}},
            {"$group": {"_id": None, "cost": {"$sum": "$cost_estimate"}}},
        ])
        rows = await cur.to_list(1)
        spend = float(rows[0]["cost"]) if rows else 0.0
    except Exception:
        return 0.0
    _spend_cache[tenant_id] = (time.time(), spend)
    return spend


async def ai_budget_status(db, tenant_id: str, tenant_doc: dict | None = None) -> dict:
    """{spend_usd, budget_usd, ratio, state} for a tenant's current-month AI spend.
    Skips the spend query entirely when no budget is set (unlimited)."""
    if tenant_doc is None:
        tenant_doc = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "ai_budget_usd": 1}) or {}
    budget = tenant_budget_usd(tenant_doc)
    spend = await tenant_ai_spend_usd(db, tenant_id) if budget > 0 else 0.0
    return {"spend_usd": round(spend, 4), "budget_usd": budget,
            "ratio": round(spend / budget, 3) if budget > 0 else 0.0,
            "state": budget_state(spend, budget)}


def invalidate_budget_cache(tenant_id: str | None = None) -> None:
    """Drop cached spend (e.g. after a budget change or in tests)."""
    if tenant_id is None:
        _spend_cache.clear()
    else:
        _spend_cache.pop(tenant_id, None)

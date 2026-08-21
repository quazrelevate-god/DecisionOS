"""AI usage + cost telemetry and provider-outage alerts (Epic 8 Sprint 2).

Extracted from core.py; core re-exports every name. Uses the shared
"decisionos" logger via getLogger (same singleton core configures).
"""
import logging

from config import _PROVIDER_RATES, _COST_IN_PER_M, _COST_OUT_PER_M, LLM_MODEL
from database import db
from shared.ids import now_iso, new_id

logger = logging.getLogger("decisionos")


# --- Usage tracking + provider outage alerts (platform admin) ---------------
import contextvars  # noqa: E402
_ctx_tenant = contextvars.ContextVar("dos_tenant", default=None)


def set_usage_tenant(tenant_id):
    if tenant_id:
        _ctx_tenant.set(tenant_id)


def _est_tokens(text: str) -> int:
    return max(0, len(text or "") // 4)


def _est_cost(provider: str, tokens_in: int, tokens_out: int) -> float:
    ri, ro = _PROVIDER_RATES.get(provider, (_COST_IN_PER_M, _COST_OUT_PER_M))
    return tokens_in / 1e6 * ri + tokens_out / 1e6 * ro


async def log_usage(feature, provider, *, tenant_id=None, model=None,
                    tokens_in=0, tokens_out=0, units=0, unit_type=None, cost=None):
    """Record one AI usage event for any provider (Claude/OpenAI/Gemini). tenant_id
    defaults to the request-scoped context var. Never raises."""
    try:
        tid = tenant_id or _ctx_tenant.get()
        ti, to = int(tokens_in or 0), int(tokens_out or 0)
        if cost is None:
            cost = _est_cost(provider, ti, to)
        await db.usage_events.insert_one({
            "id": new_id(), "tenant_id": tid or None, "feature": feature,
            "provider": provider, "model": model,
            "tokens_in": ti, "tokens_out": to, "tokens_total": ti + to,
            "units": units or 0, "unit_type": unit_type,
            "cost_estimate": round(cost, 6), "created_at": now_iso(),
        })
    except Exception as e:  # never let logging break an AI call
        logger.debug(f"usage log failed: {e}")


async def _record_usage(tenant_id, session_id, provider, system, message, resp):
    feature = (session_id or "misc").split("-")[0]
    in_text = f"{system or ''} {getattr(message, 'text', '') or ''}"
    await log_usage(feature, provider, tenant_id=tenant_id, model=LLM_MODEL[1],
                    tokens_in=_est_tokens(in_text), tokens_out=_est_tokens(resp or ""))


async def _record_provider_alert(provider, message):
    try:
        m = (message or "").lower()
        status = "out_of_credits" if any(s in m for s in ("credit", "billing", "insufficient")) else "error"
        await db.platform_alerts.update_one(
            {"provider": provider, "resolved": False},
            {"$set": {"status": status, "message": (message or "")[:300], "last_seen": now_iso()},
             "$setOnInsert": {"id": new_id(), "provider": provider, "created_at": now_iso(),
                              "resolved": False, "notified": False}},
            upsert=True)
    except Exception as e:
        logger.debug(f"alert record failed: {e}")


async def _resolve_provider_alert(provider):
    try:
        await db.platform_alerts.update_many(
            {"provider": provider, "resolved": False},
            {"$set": {"resolved": True, "resolved_at": now_iso()}})
    except Exception:
        pass

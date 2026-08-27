"""Admin console -- observability & logs (Epic 10 Sprint 5).

Platform reliability from the telemetry we actually record: AI call reliability
(error rate, degraded/fallback rate, latency percentiles) broken down by provider
and task, a recent-errors viewer, and the AI-provider-outage timeline. All read-only,
gated by get_platform_admin.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, Query

from core import db, get_platform_admin

router = APIRouter(prefix="/api/admin")


def _cutoff_iso(rng: str):
    now = datetime.now(timezone.utc)
    dt = {"1h": now - timedelta(hours=1), "24h": now - timedelta(hours=24),
          "7d": now - timedelta(days=7), "30d": now - timedelta(days=30)}.get(rng)
    return dt.isoformat() if dt else None


def _pct(sorted_vals, p):
    if not sorted_vals:
        return 0
    return sorted_vals[min(len(sorted_vals) - 1, int(len(sorted_vals) * p))]


@router.get("/observability/reliability")
async def reliability(admin: dict = Depends(get_platform_admin), range: str = "24h"):
    """AI reliability over a window: error rate, degraded/fallback rate, latency
    p50/p95/max, and breakdowns by provider (engine) + task."""
    cutoff = _cutoff_iso(range)
    match = {} if cutoff is None else {"created_at": {"$gte": cutoff}}

    ocur = await db.ai_calls.aggregate([
        {"$match": match},
        {"$group": {"_id": None, "calls": {"$sum": 1},
                    "ok": {"$sum": {"$cond": ["$ok", 1, 0]}},
                    "degraded": {"$sum": {"$cond": ["$degraded", 1, 0]}},
                    "avg_latency": {"$avg": "$latency_ms"}, "max_latency": {"$max": "$latency_ms"}}}])
    o = (await ocur.to_list(1))
    o = o[0] if o else {"calls": 0, "ok": 0, "degraded": 0, "avg_latency": 0, "max_latency": 0}
    calls = o["calls"] or 0
    errors = calls - (o["ok"] or 0)

    lats = sorted(d.get("latency_ms", 0) for d in
                  await db.ai_calls.find(match, {"_id": 0, "latency_ms": 1}).to_list(8000))

    async def breakdown(field):
        c = await db.ai_calls.aggregate([
            {"$match": match},
            {"$group": {"_id": f"${field}", "calls": {"$sum": 1},
                        "errors": {"$sum": {"$cond": ["$ok", 0, 1]}},
                        "degraded": {"$sum": {"$cond": ["$degraded", 1, 0]}},
                        "avg_latency": {"$avg": "$latency_ms"}}},
            {"$sort": {"calls": -1}}])
        return [{"key": r["_id"] or "unknown", "calls": r["calls"], "errors": r["errors"],
                 "degraded": r["degraded"], "avg_latency_ms": int(r["avg_latency"] or 0)}
                for r in await c.to_list(50)]

    by_provider = await breakdown("engine")
    by_task = await breakdown("task")

    return {
        "range": range, "calls": calls, "errors": errors,
        "error_rate": round(errors / calls, 4) if calls else 0.0,
        "degraded": o["degraded"] or 0,
        "degraded_rate": round((o["degraded"] or 0) / calls, 4) if calls else 0.0,
        "latency_ms": {"avg": int(o["avg_latency"] or 0), "p50": _pct(lats, 0.5),
                       "p95": _pct(lats, 0.95), "max": o["max_latency"] or 0},
        "by_provider": by_provider, "by_task": by_task,
    }


@router.get("/observability/errors")
async def recent_errors(admin: dict = Depends(get_platform_admin),
                        limit: int = Query(50, ge=1, le=300), range: str = "7d"):
    """Recent failed AI calls (ok=False) -- the error-log viewer. Error text is
    already PII-redacted at record time (core.usage)."""
    cutoff = _cutoff_iso(range)
    q = {"ok": False}
    if cutoff:
        q["created_at"] = {"$gte": cutoff}
    rows = await db.ai_calls.find(
        q, {"_id": 0, "task": 1, "model": 1, "engine": 1, "error": 1, "degraded": 1,
            "latency_ms": 1, "tenant_id": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(limit)
    return {"errors": rows, "count": len(rows)}


@router.get("/observability/outages")
async def provider_outages(admin: dict = Depends(get_platform_admin), limit: int = Query(100, ge=1, le=500)):
    """AI-provider outage timeline (platform_alerts), active first then most recent."""
    rows = await db.platform_alerts.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    active = [r for r in rows if not r.get("resolved")]
    return {"outages": rows, "active": active, "active_count": len(active)}

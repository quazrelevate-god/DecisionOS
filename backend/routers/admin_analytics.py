"""Admin console -- the analytics foundations' own page (2026-10-23, v2 P1).

Reads what services/presence, services/rollups, services/lifecycle and
services/milestones keep, so an operator can see the foundations are being
filled before any chart is drawn on them:

  GET  /api/admin/analytics/status   when the roll-up last ran, how much is
                                     kept, the platform's last 30 days,
                                     activation so far
  POST /api/admin/analytics/rebuild  count back again (super admin); safe to
                                     repeat -- rows are upserted, milestones
                                     and events only added when missing
"""
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core import db, get_platform_admin, require_admin_role
from routers.admin import log_admin_action
from services import rollups
from services.admin_workspaces import is_test_tenant
from services.presence import PRESENCE_DAYS

router = APIRouter(prefix="/api/admin")


@router.get("/analytics/status")
async def analytics_status(include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    ops = {r["id"]: r for r in await db.platform_ops.find(
        {"id": {"$in": ["analytics_backfill", "daily_rollup"]}}, {"_id": 0}).to_list(5)}
    tenants = await db.tenants.find({}, {"_id": 0, "id": 1, "name": 1, "company_name": 1, "created_at": 1,
                                         "milestones": 1, "is_test": 1, "is_demo": 1, "demo": 1}).to_list(5000)
    counted = [t for t in tenants if include_test or not is_test_tenant(t)]
    ids = {t["id"] for t in counted}
    today = datetime.now(rollups.IST).date()
    d = lambda n: (today - timedelta(days=n)).isoformat()   # noqa: E731

    async def people(since):
        rows = await db[PRESENCE_DAYS].distinct("user_id", {"day": {"$gte": since}, "tenant_id": {"$in": list(ids)}})
        return len(rows)

    series = await rollups.series(days=30, database=db)
    # the platform series sums every company; recount without test ones
    if not include_test:
        rows = await db[rollups.COLLECTION].find({"day": {"$gte": d(29)}, "tenant_id": {"$in": list(ids)}},
                                                 {"_id": 0}).to_list(200000)
        by_day = {}
        for r in rows:
            x = by_day.setdefault(r["day"], {"day": r["day"], "active_workspaces": 0, "active_people": 0,
                                             "sign_ins": 0, "actions_total": 0, "ai_cost_usd": 0.0})
            x["active_workspaces"] += 1 if (r.get("active_people") or r.get("actions_total")) else 0
            for k in ("active_people", "sign_ins", "actions_total"):
                x[k] += r.get(k) or 0
            x["ai_cost_usd"] = round(x["ai_cost_usd"] + (r.get("ai_cost_usd") or 0), 6)
        series = [by_day[k] for k in sorted(by_day)]
    recent = [t for t in counted if str(t.get("created_at") or "") >= (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()]
    task = _running["task"]
    return {
        "include_test": include_test,
        "rebuilding": bool(task is not None and not task.done()),
        "backfill": ops.get("analytics_backfill"),
        "rollup": ops.get("daily_rollup"),
        "kept": {
            "daily_rows": await db[rollups.COLLECTION].count_documents({}),
            "presence_days": await db[PRESENCE_DAYS].count_documents({}),
            "lifecycle_events": await db.lifecycle_events.count_documents({}),
        },
        "active_people": {"today": await people(d(0)), "last_7_days": await people(d(6)),
                          "last_30_days": await people(d(29))},
        "activation": {
            "workspaces": len(counted),
            "activated": sum(1 for t in counted if (t.get("milestones") or {}).get("activated_at")),
            "signed_up_90_days": len(recent),
            "activated_of_those": sum(1 for t in recent if (t.get("milestones") or {}).get("activated_at")),
        },
        "series": series,
    }


_running = {"task": None}


async def _rebuild(database) -> dict:
    result = await rollups.backfill(days=180, database=database)
    await database.platform_ops.update_one(
        {"id": "analytics_backfill"},
        {"$set": {"last_run": datetime.now(timezone.utc).isoformat(), "last_result": result}}, upsert=True)
    return result


@router.post("/analytics/rebuild")
async def analytics_rebuild(admin: dict = Depends(require_admin_role("super_admin"))):
    """Starts the recount and returns at once: over a hundred companies and
    180 days it takes longer than a browser waits. The status says when it
    finished. One at a time."""
    task = _running["task"]
    if task is not None and not task.done():
        return {"started": False, "running": True}
    _running["task"] = asyncio.create_task(_rebuild(db))
    await log_admin_action(admin, "analytics_rebuild", "Started a recount of the daily roll-up and milestones",
                           "config", "analytics")
    return {"started": True, "running": True}

"""Admin console — the Overview, in one answer (2026-10-22, admin redesign).

The Overview was eight raw counts — workspaces, users, decisions, tasks — with
no trend and nothing that said what needed an operator. This is what it leads
with now:

  * needs attention: provider outages, support tickets waiting, reports to
    review, live view-as sessions, trials ending in 7 days, failed payments;
  * the last 7 days against the 7 before: active workspaces, new sign-ups,
    AI spend; and MRR (list price of the paying plans, customers only);
  * the most active workspaces this week, and the ones that went quiet.

Test workspaces (services/admin_workspaces) are left out unless asked for, so
the numbers are customers' numbers.
"""
import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core import db, get_platform_admin, now_iso
from services.admin_workspaces import is_test_tenant, workspace_name

router = APIRouter(prefix="/api/admin")

def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _delta(now: float, before: float) -> dict:
    return {"now": now, "before": before, "change": round(now - before, 4)}


async def _distinct_tenants(since: str, until: str, ids: set) -> set:
    rows = await db.activity.distinct("tenant_id", {"created_at": {"$gte": since, "$lt": until}})
    return {r for r in rows if r in ids}


async def _ai_cost(since: str, until: str, ids: set) -> float:
    cur = await db.usage_events.aggregate([
        {"$match": {"created_at": {"$gte": since, "$lt": until}, "tenant_id": {"$in": list(ids)}}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost_estimate"}}},
    ])
    r = await cur.to_list(1)
    return round(float(r[0]["cost"] or 0), 4) if r else 0.0


@router.get("/overview")
async def admin_overview(include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    from routers.admin_billing import _PAYING_PLANS, _rs
    from config import BILLING_PLAN_PRICES_INR_PAISE
    from services import platform_config as pc

    now = datetime.now(timezone.utc)
    t0, d7, d14 = _iso(now), _iso(now - timedelta(days=7)), _iso(now - timedelta(days=14))
    soon = _iso(now + timedelta(days=7))

    tenants = await db.tenants.find({}, {"_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1,
                                         "created_at": 1, "trial_ends_at": 1, "suspended": 1,
                                         "is_test": 1, "is_demo": 1, "demo": 1}).to_list(5000)
    counted = [t for t in tenants if include_test or not is_test_tenant(t)]
    ids = {t["id"] for t in counted if t.get("id")}
    names = {t["id"]: workspace_name(t) for t in counted if t.get("id")}

    (outages, tickets, reports, live_sessions, failed, active_now, active_before,
     ai_now, ai_before, usd_inr) = await asyncio.gather(
        db.platform_alerts.count_documents({"resolved": False}),
        db.support_tickets.count_documents({"status": {"$in": ["open", "pending"]}}),
        db.content_reports.count_documents({"status": {"$in": ["open", "reviewing"]}}),
        db.impersonation_sessions.count_documents({"revoked": {"$ne": True}, "expires_at": {"$gt": now_iso()}}),
        db.billing_events.count_documents({"event": {"$in": ["payment.failed", "subscription.halted"]},
                                           "created_at": {"$gte": _iso(now - timedelta(days=30))}}),
        _distinct_tenants(d7, t0, ids), _distinct_tenants(d14, d7, ids),
        _ai_cost(d7, t0, ids), _ai_cost(d14, d7, ids),
        pc.usd_inr_rate(),
    )
    trials = sorted(
        [{"id": t["id"], "name": names[t["id"]], "trial_ends_at": t.get("trial_ends_at")}
         for t in counted if t.get("plan") == "trial" and t.get("trial_ends_at")
         and t0 <= str(t["trial_ends_at"]) <= soon],
        key=lambda x: str(x["trial_ends_at"]))
    signups_now = sum(1 for t in counted if str(t.get("created_at") or "") >= d7)
    signups_before = sum(1 for t in counted if d14 <= str(t.get("created_at") or "") < d7)
    paying = [t for t in counted if t.get("plan") in _PAYING_PLANS and not t.get("suspended")]
    mrr_paise = sum(BILLING_PLAN_PRICES_INR_PAISE.get(t["plan"], 0) or 0 for t in paying)

    # Most active this week, and the ones that went quiet (active 14–60 days
    # ago, nothing since) — one grouped question each.
    cur = await db.activity.aggregate([
        {"$match": {"created_at": {"$gte": d7}, "tenant_id": {"$in": list(ids)}}},
        {"$group": {"_id": "$tenant_id", "n": {"$sum": 1}, "last": {"$max": "$created_at"}}},
        {"$sort": {"n": -1}}, {"$limit": 6},
    ])
    most_active = [{"id": r["_id"], "name": names.get(r["_id"], "—"), "actions": r["n"], "last_activity": r["last"]}
                   for r in await cur.to_list(6)]
    cur = await db.activity.aggregate([
        {"$match": {"tenant_id": {"$in": list(ids)}}},
        {"$group": {"_id": "$tenant_id", "last": {"$max": "$created_at"}}},
        {"$match": {"last": {"$lt": d14, "$gte": _iso(now - timedelta(days=60))}}},
        {"$sort": {"last": -1}}, {"$limit": 6},
    ])
    gone_quiet = [{"id": r["_id"], "name": names.get(r["_id"], "—"), "last_activity": r["last"]}
                  for r in await cur.to_list(6)]

    return {
        "include_test": include_test,
        "workspaces": {"total": len(counted), "test_hidden": 0 if include_test else len(tenants) - len(counted)},
        "needs_attention": {
            "outages": outages, "open_tickets": tickets, "open_reports": reports,
            "live_view_as": live_sessions, "trials_ending": len(trials), "failed_payments": failed,
        },
        "trials_ending": trials[:6],
        "last_7_days": {
            "active_workspaces": _delta(len(active_now), len(active_before)),
            "signups": _delta(signups_now, signups_before),
            "ai_cost_usd": _delta(ai_now, ai_before),
        },
        "mrr_inr": _rs(mrr_paise), "paying_workspaces": len(paying),
        "usd_inr": usd_inr,
        "most_active": most_active,
        "gone_quiet": gone_quiet,
    }

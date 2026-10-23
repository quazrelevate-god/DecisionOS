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
from services import analytics, rollups
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


# --- P3: the analytics pages and Home (2026-10-23) -----------------------------------------


@router.get("/analytics/growth")
async def analytics_growth(days: int = 90, include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    return await analytics.growth(max(14, min(days, 365)), include_test, database=db)


@router.get("/analytics/engagement")
async def analytics_engagement(days: int = 90, include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    return await analytics.engagement(max(7, min(days, 180)), include_test, database=db)


@router.get("/analytics/retention")
async def analytics_retention(weeks: int = 12, include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    return await analytics.retention(max(2, min(weeks, 26)), include_test, database=db)


@router.get("/analytics/revenue")
async def analytics_revenue(months: int = 6, include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    return await analytics.revenue(max(1, min(months, 24)), include_test, database=db)


@router.get("/analytics/ai")
async def analytics_ai(days: int = 30, include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    from services.platform_config import usd_inr_rate
    return await analytics.ai_economics(max(7, min(days, 180)), include_test, usd_inr=await usd_inr_rate(),
                                        database=db)


@router.get("/home")
async def admin_home(include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    """Home: what needs an operator today, ranked; the numbers that matter with
    their trend; and whose health moved most this week."""
    from services.customer_health import compute_all
    from services.platform_config import usd_inr_rate
    now = datetime.now(timezone.utc)
    today = datetime.now(rollups.IST).date()
    tenants = await db.tenants.find({}, {"_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1, "created_at": 1,
                                         "trial_ends_at": 1, "suspended": 1, "is_test": 1, "is_demo": 1, "demo": 1,
                                         "next_follow_up_at": 1, "seat_limit_override": 1}).to_list(10000)
    tenants = [t for t in tenants if include_test or not is_test_tenant(t)]
    names = {t["id"]: (t.get("company_name") or t.get("name") or "—") for t in tenants}
    ids = list(names)
    rate = await usd_inr_rate()
    computed, rev, eng, grow, ai = await asyncio.gather(
        compute_all(db, ids), analytics.revenue(6, include_test, database=db),
        analytics.engagement(35, include_test, database=db), analytics.growth(90, include_test, database=db),
        analytics.ai_economics(30, include_test, usd_inr=rate, database=db))

    needs = []

    def need(kind, severity, title, detail, to, tenant_id=None):
        needs.append({"kind": kind, "severity": severity, "title": title, "detail": detail, "to": to, "tenant_id": tenant_id})

    outages = await db.platform_alerts.count_documents({"resolved": False})
    if outages:
        need("outage", 0, f"{outages} AI provider problem{'s' if outages > 1 else ''}",
             "Customers may see AI features fail", "health")
    for c in rev["to_chase"]:
        need("payment_failed", 1, f"Payment failed · {c['name']}", f"On {c.get('plan') or 'their plan'}, not paid since",
             f"workspaces/{c['id']}/billing", c["id"])
    day_ago = (now - timedelta(hours=24)).isoformat()
    for tk in await db.support_tickets.find({"tenant_id": {"$in": ids}, "status": {"$in": ["open", "pending"]}},
                                            {"_id": 0, "id": 1, "subject": 1, "priority": 1, "tenant_id": 1,
                                             "updated_at": 1, "created_at": 1, "messages": 1}).to_list(2000):
        msgs = tk.get("messages") or []
        waiting = not msgs or msgs[-1].get("author_type") != "admin"
        since = (msgs[-1].get("created_at") if msgs else tk.get("created_at")) or ""
        if waiting and since and since < day_ago:
            hours = int((now - datetime.fromisoformat(since.replace("Z", "+00:00"))).total_seconds() // 3600) if "T" in since else None
            need("ticket", 1 if tk.get("priority") in ("urgent", "high") else 2,
                 f"Waiting on us · {tk.get('subject') or 'Ticket'}",
                 f"{names.get(tk.get('tenant_id'), '—')} · {hours} h without a reply" if hours else names.get(tk.get("tenant_id"), "—"),
                 f"support/{tk['id']}", tk.get("tenant_id"))
    soon = (now + timedelta(days=3)).isoformat()
    for t in tenants:
        c = computed.get(t["id"]) or {}
        h = (c.get("health") or {}).get("score")
        if t.get("plan") == "trial" and t.get("trial_ends_at") and now.isoformat() <= str(t["trial_ends_at"]) <= soon:
            need("trial_ending", 2 if (h or 0) >= 40 else 1, f"Trial ends soon · {names[t['id']]}",
                 f"Health {h}{' — not activated' if c.get('stage') == 'trial' else ''}", f"workspaces/{t['id']}", t["id"])
        if c.get("stage") in ("at_risk", "churned") and t.get("plan") in analytics.PAYING and not t.get("suspended"):
            gone = c.get("stage") == "churned"
            need("at_risk", 1, f"Paying customer {'gone quiet' if gone else 'at risk'} · {names[t['id']]}",
                 f"Health {h} · last seen {(c.get('last_seen_at') or '')[:10] or 'never'}", f"workspaces/{t['id']}", t["id"])
        if t.get("next_follow_up_at") and t["next_follow_up_at"] <= today.isoformat():
            need("follow_up", 2, f"Follow up · {names[t['id']]}", f"Due {t['next_follow_up_at']}", f"workspaces/{t['id']}/notes", t["id"])
    reports = await db.content_reports.count_documents({"status": "open"})
    if reports:
        need("reports", 2, f"{reports} report{'s' if reports > 1 else ''} to review", "Flagged from inside the app", "reports")
    needs.sort(key=lambda n: n["severity"])

    # KPIs with a trend
    wk_days = eng["series"]
    signups_weeks = grow["weeks"][-8:]
    kpis = {
        "mrr": {"value": rev["now"]["mrr"] if rev["now"] else 0, "series": [m["mrr"] for m in rev["months"]],
                "labels": [m["month"] for m in rev["months"]],
                "change": round(rev["months"][-1]["mrr"] - rev["months"][-2]["mrr"], 2) if len(rev["months"]) > 1 else None},
        "paying": {"value": rev["now"]["paying"] if rev["now"] else 0, "series": [m["paying"] for m in rev["months"]]},
        "wau": {"value": wk_days[-1]["wau"] if wk_days else 0, "series": [s["wau"] for s in wk_days[-28:]],
                "change": (wk_days[-1]["wau"] - wk_days[-8]["wau"]) if len(wk_days) >= 8 else None},
        "active_workspaces": {"value": wk_days[-1]["active_workspaces"] if wk_days else 0,
                              "series": [s["active_workspaces"] for s in wk_days[-28:]]},
        "signups": {"value": signups_weeks[-1]["signups"] if signups_weeks else 0, "series": [w["signups"] for w in signups_weeks],
                    "change": (signups_weeks[-1]["signups"] - signups_weeks[-2]["signups"]) if len(signups_weeks) > 1 else None},
        "activation": {"value": next((f["rate"] for f in grow["funnel"] if f["key"] == "activated"), 0),
                       "series": [w["activation_rate"] for w in grow["weeks"][-8:] if w["activation_rate"] is not None]},
        "ai_share": {"value": ai["share_of_revenue"], "cost_month_inr": ai["cost_month_inr"]},
    }
    # health movers from the daily snapshot
    week_ago = (today - timedelta(days=7)).isoformat()
    snaps = await db[rollups.COLLECTION].find({"tenant_id": {"$in": ids}, "day": {"$gte": week_ago}, "health": {"$exists": True}},
                                              {"_id": 0, "tenant_id": 1, "day": 1, "health": 1}).to_list(100000)
    first_seen, latest = {}, {}
    for r in sorted(snaps, key=lambda r: r["day"]):
        first_seen.setdefault(r["tenant_id"], r)
        latest[r["tenant_id"]] = r
    movers = []
    for tid, last in latest.items():
        start = first_seen[tid]
        if start["day"] < last["day"] and last.get("health") is not None and start.get("health") is not None:
            movers.append({"id": tid, "name": names.get(tid, "—"), "from": start["health"], "to": last["health"],
                           "change": last["health"] - start["health"], "since": start["day"]})
    movers.sort(key=lambda m: -abs(m["change"]))
    return {
        "include_test": include_test, "needs": needs[:40], "needs_total": len(needs), "kpis": kpis,
        "movers": {"up": [m for m in movers if m["change"] > 0][:5], "down": [m for m in movers if m["change"] < 0][:5],
                   "since_snapshots": min((r["day"] for r in snaps), default=None)},
        "stages": _stage_counts(computed), "customers": len(tenants),
    }


def _stage_counts(computed: dict) -> dict:
    out: dict = {}
    for c in computed.values():
        out[c.get("stage")] = out.get(c.get("stage"), 0) + 1
    return out

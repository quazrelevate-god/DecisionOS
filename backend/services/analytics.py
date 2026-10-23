"""The business, in numbers (2026-10-23, admin console v2 P3).

What the analytics pages and Home are drawn from. Built on what P1 keeps
(services/presence, rollups, lifecycle, milestones) and P2 computes
(services/customer_health); each function reads a few collections once,
for every company, and does the counting here.

  growth(days)       sign-ups per week, the activation funnel, trial -> paid,
                     days to activate
  engagement(days)   daily / weekly / monthly active people, active companies,
                     stickiness, product-area adoption by week, top companies
  retention(weeks)   weekly sign-up cohorts: share still active each week after
  revenue(months)    MRR month by month, its movement (new, expansion,
                     contraction, churn), ARPA, plan mix, payments to chase
  ai_economics(days) AI cost against revenue per company, by provider over time

History has limits, said where it is shown: activity and AI usage go back as
far as the daily roll-up was backfilled (180 days); plan changes and
suspensions were not recorded before 2026-10-23, so MRR before that date is
drawn from today's plans.

Test companies (services/admin_workspaces) are left out unless asked for.
"""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Optional

from config import BILLING_PLAN_PRICES_INR_PAISE
from core import db as _db
from services.admin_workspaces import is_test_tenant, workspace_name
from services.rollups import COLLECTION as DAILY, IST, ist_day

PAYING = ("starter", "business", "enterprise")
AREAS = ("tasks", "decisions", "requests", "workflows", "finance", "crm", "voice", "captures")
HISTORY_FROM = "2026-10-23"   # plan changes / suspensions recorded from here on


def price(plan: Optional[str]) -> float:
    return round((BILLING_PLAN_PRICES_INR_PAISE.get(plan, 0) or 0) / 100, 2) if plan in PAYING else 0.0


def _today() -> date:
    return datetime.now(IST).date()


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())    # Monday


def _d(iso) -> Optional[date]:
    if not iso:
        return None
    try:
        return date.fromisoformat(ist_day(iso))
    except (ValueError, TypeError):
        return None


async def _tenants(database, include_test: bool) -> list:
    rows = await database.tenants.find({}, {
        "_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1, "created_at": 1, "suspended": 1,
        "milestones": 1, "is_test": 1, "is_demo": 1, "demo": 1, "trial_ends_at": 1}).to_list(10000)
    return [t for t in rows if t.get("id") and (include_test or not is_test_tenant(t))]


async def _daily(database, ids: list, since: str) -> list:
    return await database[DAILY].find({"tenant_id": {"$in": ids}, "day": {"$gte": since}},
                                      {"_id": 0}).to_list(1000000)


# --- growth ---------------------------------------------------------------------------------
async def growth(days: int = 90, include_test: bool = False, database=None) -> dict:
    database = database if database is not None else _db
    tenants = await _tenants(database, include_test)
    today = _today()
    first = today - timedelta(days=days - 1)
    cohort = [t for t in tenants if (_d(t.get("created_at")) or date.min) >= first]
    ids = [t["id"] for t in cohort]
    daily = await _daily(database, ids, first.isoformat())
    active_days = defaultdict(set)
    for r in daily:
        if r.get("actions_total") or r.get("active_people"):
            active_days[r["tenant_id"]].add(r["day"])

    def active_in_week2(t) -> Optional[bool]:
        start = _d(t.get("created_at"))
        if not start or (today - start).days < 14:
            return None                                   # too new to know
        w2 = {(start + timedelta(days=i)).isoformat() for i in range(7, 14)}
        return len(active_days.get(t["id"], set()) & w2) >= 2

    def ms(t, k):
        return bool((t.get("milestones") or {}).get(k))

    steps = [
        ("signed_up", "Signed up", lambda t: True),
        ("first_decision", "Made a first decision", lambda t: ms(t, "first_decision_at")),
        ("invited", "Invited a teammate", lambda t: ms(t, "first_invite_at")),
        ("activated", "Activated", lambda t: ms(t, "activated_at")),
        ("week2", "Active in week 2", lambda t: bool(active_in_week2(t))),
        ("paying", "Paying", lambda t: t.get("plan") in PAYING or ms(t, "first_payment_at")),
    ]
    n = len(cohort)
    # A funnel: each step counts the companies that reached it AND every step
    # before it, so it can only narrow.
    funnel, still = [], list(cohort)
    for k, label, f in steps:
        still = [t for t in still if f(t)]
        funnel.append({"key": k, "label": label, "count": len(still), "rate": round(len(still) / n, 4) if n else 0.0,
                       "reached_alone": sum(1 for t in cohort if f(t))})

    weeks = defaultdict(lambda: {"signups": 0, "activated": 0})
    for t in cohort:
        w = _week_start(_d(t["created_at"])).isoformat()
        weeks[w]["signups"] += 1
        weeks[w]["activated"] += 1 if ms(t, "activated_at") else 0
    wk = []
    w = _week_start(first)
    while w <= today:
        x = weeks.get(w.isoformat(), {"signups": 0, "activated": 0})
        wk.append({"week": w.isoformat(), **x, "activation_rate": round(x["activated"] / x["signups"], 4) if x["signups"] else None})
        w += timedelta(days=7)

    to_activate = []
    for t in cohort:
        a, c = _d((t.get("milestones") or {}).get("activated_at")), _d(t.get("created_at"))
        if a and c:
            to_activate.append((a - c).days)
    ended = [t for t in cohort if _d(t.get("created_at")) and (today - _d(t["created_at"])).days >= 14]
    paid = sum(1 for t in ended if t.get("plan") in PAYING or ms(t, "first_payment_at"))
    return {
        "days": days, "signups": n, "funnel": funnel, "weeks": wk,
        "median_days_to_activate": median(to_activate) if to_activate else None,
        "trial_to_paid": {"trials_ended": len(ended), "paying": paid,
                          "rate": round(paid / len(ended), 4) if ended else None},
        "too_new_for_week2": sum(1 for t in cohort if active_in_week2(t) is None),
    }


# --- engagement --------------------------------------------------------------------------------
async def engagement(days: int = 90, include_test: bool = False, database=None) -> dict:
    database = database if database is not None else _db
    tenants = await _tenants(database, include_test)
    names = {t["id"]: workspace_name(t) for t in tenants}
    ids = list(names)
    today = _today()
    first = today - timedelta(days=days - 1)
    look = first - timedelta(days=29)                       # for the first month's MAU
    people_by_day = defaultdict(set)                        # day -> {(tenant, person)}
    since_iso = (datetime.combine(look, datetime.min.time(), IST)).astimezone(timezone.utc).isoformat()
    async for a in database.activity.find({"tenant_id": {"$in": ids}, "created_at": {"$gte": since_iso}},
                                          {"_id": 0, "tenant_id": 1, "actor": 1, "created_at": 1}):
        if a.get("actor") and a["actor"] != "system" and a.get("created_at"):
            people_by_day[ist_day(a["created_at"])].add((a["tenant_id"], a["actor"]))
    async for p in database.presence_days.find({"tenant_id": {"$in": ids}, "day": {"$gte": look.isoformat()}},
                                               {"_id": 0, "tenant_id": 1, "user_id": 1, "day": 1}):
        people_by_day[p["day"]].add((p["tenant_id"], p["user_id"]))
    daily = await _daily(database, ids, look.isoformat())
    ws_by_day = defaultdict(set)
    area_week = defaultdict(lambda: defaultdict(set))       # week -> area -> {tenant}
    active_week = defaultdict(set)                          # week -> {tenant}
    people_by_tenant = defaultdict(list)
    for r in daily:
        if r.get("actions_total") or r.get("active_people"):
            ws_by_day[r["day"]].add(r["tenant_id"])
        if r["day"] < first.isoformat():
            continue
        wk = _week_start(date.fromisoformat(r["day"])).isoformat()
        if r.get("actions_total") or r.get("active_people"):
            active_week[wk].add(r["tenant_id"])
        for a, n in (r.get("actions") or {}).items():
            if n and a in AREAS:
                area_week[wk][a].add(r["tenant_id"])
        if r["day"] >= (today - timedelta(days=6)).isoformat():
            people_by_tenant[r["tenant_id"]].append(r.get("active_people") or 0)

    series = []
    d = first
    while d <= today:
        def window(n):
            s = set()
            for i in range(n):
                s |= people_by_day.get((d - timedelta(days=i)).isoformat(), set())
            return len(s)
        dau, wau, mau = window(1), window(7), window(30)
        series.append({"day": d.isoformat(), "dau": dau, "wau": wau, "mau": mau,
                       "active_workspaces": len(ws_by_day.get(d.isoformat(), ()))})
        d += timedelta(days=1)
    last30 = series[-30:]
    stick = [s["dau"] / s["mau"] for s in last30 if s["mau"]]
    weeks = sorted(active_week)
    adoption = [{"week": w, "active_workspaces": len(active_week[w]),
                 "areas": {a: round(len(area_week[w][a]) / len(active_week[w]), 4) if active_week[w] else 0 for a in AREAS}}
                for w in weeks]
    top = sorted(((tid, max(v)) for tid, v in people_by_tenant.items() if v), key=lambda x: -x[1])[:10]
    return {
        "days": days, "series": series,
        "now": series[-1] if series else None,
        "stickiness": round(sum(stick) / len(stick), 4) if stick else None,
        "adoption": adoption, "areas": list(AREAS),
        "top": [{"id": tid, "name": names.get(tid, "—"), "active_people": n} for tid, n in top],
    }


# --- retention -------------------------------------------------------------------------------
async def retention(weeks: int = 12, include_test: bool = False, database=None) -> dict:
    database = database if database is not None else _db
    tenants = await _tenants(database, include_test)
    today = _today()
    first = _week_start(today) - timedelta(days=7 * (weeks - 1))
    cohort = [t for t in tenants if _d(t.get("created_at")) and _d(t["created_at"]) >= first]
    daily = await _daily(database, [t["id"] for t in cohort], first.isoformat())
    active = defaultdict(set)
    for r in daily:
        if r.get("actions_total") or r.get("active_people"):
            active[r["tenant_id"]].add(r["day"])
    rows = []
    for i in range(weeks):
        ws = first + timedelta(days=7 * i)
        members = [t for t in cohort if _week_start(_d(t["created_at"])) == ws]
        cells = []
        for k in range(weeks - i):
            if not members:
                cells.append(None)
                continue
            alive = 0
            for t in members:
                start = _d(t["created_at"]) + timedelta(days=7 * k)
                days_k = {(start + timedelta(days=j)).isoformat() for j in range(7)}
                alive += 1 if active.get(t["id"], set()) & days_k else 0
            cells.append(round(alive / len(members), 4))
        rows.append({"week": ws.isoformat(), "size": len(members), "cells": cells})
    return {"weeks": weeks, "cohorts": rows}


# --- revenue ---------------------------------------------------------------------------------
def _month_ends(months: int, today: date) -> list:
    out, y, m = [], today.year, today.month
    for _ in range(months):
        nxt = date(y + (m == 12), 1 if m == 12 else m + 1, 1)
        out.append(min(nxt - timedelta(days=1), today))
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return list(reversed(out))


async def revenue(months: int = 6, include_test: bool = False, database=None) -> dict:
    database = database if database is not None else _db
    tenants = await _tenants(database, include_test)
    ids = [t["id"] for t in tenants]
    events = defaultdict(list)
    for e in await database.lifecycle_events.find(
            {"tenant_id": {"$in": ids}, "kind": {"$in": ["plan_changed", "suspended", "reactivated",
                                                         "payment_failed", "payment_received"]}},
            {"_id": 0}).to_list(200000):
        events[e["tenant_id"]].append(e)
    for v in events.values():
        v.sort(key=lambda e: e.get("created_at") or "", reverse=True)

    def mrr_at(t, when: date) -> float:
        """The company's MRR at the end of `when`, walking back from today."""
        created = _d(t.get("created_at"))
        if created and created > when:
            return 0.0
        plan, suspended = t.get("plan"), bool(t.get("suspended"))
        for e in events.get(t["id"], []):
            at = _d(e.get("created_at"))
            if not at or at <= when:
                break
            if e["kind"] == "plan_changed":
                plan = (e.get("data") or {}).get("from")
            elif e["kind"] == "suspended":
                suspended = False
            elif e["kind"] == "reactivated":
                suspended = True
        return 0.0 if suspended else price(plan)

    today = _today()
    ends = _month_ends(months + 1, today)
    points, movements = [], []
    prev = {t["id"]: mrr_at(t, ends[0]) for t in tenants}
    for end in ends[1:]:
        cur = {t["id"]: mrr_at(t, end) for t in tenants}
        mv = {"new": 0.0, "expansion": 0.0, "contraction": 0.0, "churn": 0.0}
        for tid in cur:
            a, b = prev.get(tid, 0.0), cur[tid]
            if a == 0 and b > 0:
                mv["new"] += b
            elif a > 0 and b == 0:
                mv["churn"] -= a
            elif b > a:
                mv["expansion"] += b - a
            elif b < a:
                mv["contraction"] -= a - b
        paying = sum(1 for v in cur.values() if v > 0)
        total = round(sum(cur.values()), 2)
        points.append({"month": end.strftime("%Y-%m"), "mrr": total, "paying": paying,
                       "arpa": round(total / paying, 2) if paying else 0.0})
        movements.append({"month": end.strftime("%Y-%m"), **{k: round(v, 2) for k, v in mv.items()}})
        prev = cur
    mix = defaultdict(lambda: {"companies": 0, "mrr": 0.0})
    for t in tenants:
        p = t.get("plan") or "none"
        mix[p]["companies"] += 1
        mix[p]["mrr"] += 0.0 if t.get("suspended") else price(t.get("plan"))
    chase = []
    names = {t["id"]: workspace_name(t) for t in tenants}
    month_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    for tid, evs in events.items():
        latest_fail = next((e for e in evs if e["kind"] == "payment_failed"), None)
        latest_paid = next((e for e in evs if e["kind"] == "payment_received"), None)
        if latest_fail and (latest_fail.get("created_at") or "") >= month_ago and \
                (not latest_paid or (latest_paid.get("created_at") or "") < latest_fail["created_at"]):
            chase.append({"id": tid, "name": names.get(tid, "—"), "failed_at": latest_fail["created_at"],
                          "plan": (latest_fail.get("data") or {}).get("plan")})
    return {
        "months": points, "movement": movements, "now": points[-1] if points else None,
        "plan_mix": [{"plan": k, **{kk: round(vv, 2) if isinstance(vv, float) else vv for kk, vv in v.items()}}
                     for k, v in sorted(mix.items(), key=lambda kv: -kv[1]["mrr"])],
        "to_chase": sorted(chase, key=lambda c: c["failed_at"], reverse=True),
        "history_from": HISTORY_FROM, "prices_configured": bool(BILLING_PLAN_PRICES_INR_PAISE),
    }


# --- AI economics -------------------------------------------------------------------------------
async def ai_economics(days: int = 30, include_test: bool = False, usd_inr: float = 84.0, database=None) -> dict:
    database = database if database is not None else _db
    tenants = await _tenants(database, include_test)
    names = {t["id"]: workspace_name(t) for t in tenants}
    ids = list(names)
    today = _today()
    first = today - timedelta(days=days - 1)
    daily = await _daily(database, ids, first.isoformat())
    cost, people = defaultdict(float), defaultdict(int)
    for r in daily:
        cost[r["tenant_id"]] += float(r.get("ai_cost_usd") or 0)
        people[r["tenant_id"]] = max(people[r["tenant_id"]], r.get("active_people") or 0)
    rows = []
    for t in tenants:
        c_inr = round(cost.get(t["id"], 0.0) * usd_inr, 2)
        mrr = 0.0 if t.get("suspended") else price(t.get("plan"))
        monthly = round(c_inr * 30 / days, 2)
        rows.append({"id": t["id"], "name": names[t["id"]], "plan": t.get("plan"), "ai_cost_inr": c_inr,
                     "ai_cost_month_inr": monthly, "mrr_inr": mrr,
                     "share_of_revenue": round(monthly / mrr, 4) if mrr else None,
                     "flag": bool((mrr and monthly > 0.3 * mrr) or (not mrr and monthly >= 500)),
                     "active_people": people.get(t["id"], 0)})
    rows.sort(key=lambda r: -r["ai_cost_inr"])
    by_provider = defaultdict(lambda: defaultdict(float))
    since_iso = (datetime.combine(first - timedelta(days=first.weekday()), datetime.min.time(), IST)).astimezone(timezone.utc).isoformat()
    async for u in database.usage_events.find({"tenant_id": {"$in": ids}, "created_at": {"$gte": since_iso}},
                                              {"_id": 0, "provider": 1, "cost_estimate": 1, "created_at": 1}):
        wk = _week_start(date.fromisoformat(ist_day(u["created_at"]))).isoformat()
        by_provider[wk][u.get("provider") or "unknown"] += float(u.get("cost_estimate") or 0) * usd_inr
    total_cost = round(sum(r["ai_cost_inr"] for r in rows), 2)
    total_mrr = round(sum(r["mrr_inr"] for r in rows), 2)
    active = sum(r["active_people"] for r in rows)
    return {
        "days": days, "usd_inr": usd_inr, "customers": rows,
        "total_cost_inr": total_cost, "total_mrr_inr": total_mrr,
        "cost_month_inr": round(total_cost * 30 / days, 2),
        "share_of_revenue": round((total_cost * 30 / days) / total_mrr, 4) if total_mrr else None,
        "cost_per_active_person_inr": round(total_cost / active, 2) if active else None,
        "flagged": sum(1 for r in rows if r["flag"]),
        "by_provider": [{"week": w, **{p: round(v, 2) for p, v in by_provider[w].items()}} for w in sorted(by_provider)],
    }

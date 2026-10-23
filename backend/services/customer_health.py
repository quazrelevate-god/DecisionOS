"""Customer health and stage, for every company at once (2026-10-23, admin console v2 P2).

A health score nobody can explain is a score nobody trusts, so it is five
named parts that add up to 100, each shown on the customer page:

  activity   30  people here in the last 7 days, against the seats in use
  breadth    20  product areas used in the last 14 days (of 8)
  momentum   20  actions in the last 14 days against the 14 before
  setup      15  key milestones reached (of 6)
  friction   15  starts full; urgent/high open tickets, failed payments in
                 30 days and a bad week of AI errors take it down

Bands: 70+ healthy, 40-69 watch, under 40 at risk. The weights live in
runtime config (`health_weights`) so they can be tuned without a deploy.

Stage, in order (the first that fits):
  test        one of ours (services/admin_workspaces)
  suspended   suspended by an admin
  churned     nobody here for 30 days, or the subscription halted 14+ days ago
  at_risk     paying or activated, and health under 40 or quiet for 7 days
  paying      on a paying plan
  activated   reached activation (services/milestones)
  trial       anything else

Everything is read with a handful of grouped questions for all companies
(the daily roll-up, presence, memberships, tickets, lifecycle), never one per
company, so the customer list stays quick at a few hundred companies.
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db as _db
from services.admin_workspaces import is_test_tenant, workspace_name
from services.rollups import COLLECTION as DAILY, IST

DEFAULT_WEIGHTS = {"activity": 30, "breadth": 20, "momentum": 20, "setup": 15, "friction": 15}
AREAS = ("tasks", "decisions", "requests", "workflows", "finance", "crm", "voice", "captures")
KEY_MILESTONES = ("first_decision_at", "first_decision_approved_at", "first_invite_at",
                  "first_task_done_at", "first_finance_at", "first_whatsapp_at")
PAYING = ("starter", "business", "enterprise")
STAGES = ("trial", "activated", "paying", "at_risk", "churned", "suspended", "test")


def band(score: int) -> str:
    return "healthy" if score >= 70 else "watch" if score >= 40 else "at_risk"


def score_parts(*, weights: dict, active_7d: int, seats: int, areas_14d: int, actions_now: int,
                actions_before: int, milestones: dict, urgent_tickets: int, failed_payments: int,
                ai_error_rate: float) -> dict:
    """The five parts for one company (pure; tested on its own)."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    activity = w["activity"] * min(1.0, active_7d / max(1, seats))
    breadth = w["breadth"] * min(1.0, areas_14d / len(AREAS))
    if actions_now == 0:
        momentum = 0.0
    elif actions_before == 0:
        momentum = float(w["momentum"])
    else:
        momentum = w["momentum"] * min(1.25, actions_now / actions_before) / 1.25
    setup = w["setup"] * sum(1 for k in KEY_MILESTONES if milestones.get(k)) / len(KEY_MILESTONES)
    friction = w["friction"] - 4 * urgent_tickets - 7 * failed_payments - (3 if ai_error_rate > 0.05 else 0)
    friction = max(0.0, min(float(w["friction"]), friction))
    parts = {"activity": activity, "breadth": breadth, "momentum": momentum, "setup": setup, "friction": friction}
    parts = {k: round(v) for k, v in parts.items()}
    total = max(0, min(100, sum(parts.values())))
    return {"score": total, "band": band(total), "parts": parts, "weights": w}


def stage_of(*, tenant: dict, score: int, last_seen: Optional[str], halted_at: Optional[str],
             now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if is_test_tenant(tenant):
        return "test"
    if tenant.get("suspended"):
        return "suspended"
    created = str(tenant.get("created_at") or "")
    month_ago, week_ago = (now - timedelta(days=30)).isoformat(), (now - timedelta(days=7)).isoformat()
    quiet_month = (last_seen or "") < month_ago and created < month_ago
    if quiet_month or (halted_at and halted_at < (now - timedelta(days=14)).isoformat()):
        return "churned"
    paying = tenant.get("plan") in PAYING
    activated = bool((tenant.get("milestones") or {}).get("activated_at"))
    if (paying or activated) and (score < 40 or ((last_seen or "") < week_ago and created < week_ago)):
        return "at_risk"
    if paying:
        return "paying"
    if activated:
        return "activated"
    return "trial"


async def _weights(database) -> dict:
    row = await database.platform_config.find_one({"key": "runtime"}, {"_id": 0, "value": 1})
    w = ((row or {}).get("value") or {}).get("health_weights")
    return {**DEFAULT_WEIGHTS, **(w if isinstance(w, dict) else {})}


async def compute_all(database=None, tenant_ids: Optional[list] = None) -> dict:
    """{tenant: {health, stage, active_7d, seats, last_seen_at, ai_cost_30d_usd,
    actions_30d}} for every company (or the ones named)."""
    database = database if database is not None else _db
    now = datetime.now(timezone.utc)
    today = datetime.now(IST).date()
    day = lambda n: (today - timedelta(days=n)).isoformat()   # noqa: E731
    tq = {"id": {"$in": list(tenant_ids)}} if tenant_ids is not None else {}
    tenants = await database.tenants.find(tq, {"_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1,
                                               "created_at": 1, "suspended": 1, "milestones": 1, "is_test": 1,
                                               "is_demo": 1, "demo": 1}).to_list(10000)
    ids = [t["id"] for t in tenants]
    within = {"$in": ids}

    daily = defaultdict(list)
    for r in await database[DAILY].find({"tenant_id": within, "day": {"$gte": day(29)}},
                                        {"_id": 0, "tenant_id": 1, "day": 1, "actions": 1, "actions_total": 1,
                                         "ai_cost_usd": 1, "ai_calls": 1}).to_list(500000):
        daily[r["tenant_id"]].append(r)

    present = defaultdict(set)
    for p in await database.presence_days.find({"tenant_id": within, "day": {"$gte": day(6)}},
                                               {"_id": 0, "tenant_id": 1, "user_id": 1}).to_list(500000):
        present[p["tenant_id"]].add(p["user_id"])
    week_ago = (now - timedelta(days=7)).isoformat()
    async for a in database.activity.find({"tenant_id": within, "created_at": {"$gte": week_ago}},
                                          {"_id": 0, "tenant_id": 1, "actor": 1}):
        if a.get("actor") and a["actor"] != "system":
            present[a["tenant_id"]].add(a["actor"])

    seats, last_seen = defaultdict(int), {}
    for m in await database.memberships.find({"tenant_id": within, "status": "active"},
                                             {"_id": 0, "tenant_id": 1, "last_seen_at": 1}).to_list(500000):
        seats[m["tenant_id"]] += 1
        s = m.get("last_seen_at")
        if s and s > last_seen.get(m["tenant_id"], ""):
            last_seen[m["tenant_id"]] = s
    cur = await database.activity.aggregate([
        {"$match": {"tenant_id": within}}, {"$group": {"_id": "$tenant_id", "last": {"$max": "$created_at"}}}])
    for r in await cur.to_list(100000):
        if r.get("last") and r["last"] > last_seen.get(r["_id"], ""):
            last_seen[r["_id"]] = r["last"]

    urgent = defaultdict(int)
    for tk in await database.support_tickets.find({"tenant_id": within, "status": {"$in": ["open", "pending"]},
                                                   "priority": {"$in": ["urgent", "high"]}},
                                                  {"_id": 0, "tenant_id": 1}).to_list(100000):
        urgent[tk["tenant_id"]] += 1
    failed, halted = defaultdict(int), {}
    month_ago = (now - timedelta(days=30)).isoformat()
    for e in await database.lifecycle_events.find(
            {"tenant_id": within, "kind": {"$in": ["payment_failed", "subscription_halted", "payment_received"]}},
            {"_id": 0, "tenant_id": 1, "kind": 1, "created_at": 1}).to_list(100000):
        if e["kind"] == "payment_failed" and (e.get("created_at") or "") >= month_ago:
            failed[e["tenant_id"]] += 1
        if e["kind"] == "subscription_halted":
            halted[e["tenant_id"]] = max(halted.get(e["tenant_id"], ""), e.get("created_at") or "")
        if e["kind"] == "payment_received" and (e.get("created_at") or "") > halted.get(e["tenant_id"], ""):
            halted.pop(e["tenant_id"], None)   # paid again since: not halted
    errors, calls = defaultdict(int), defaultdict(int)
    async for c in database.ai_calls.find({"tenant_id": within, "created_at": {"$gte": week_ago}},
                                          {"_id": 0, "tenant_id": 1, "ok": 1}):
        calls[c["tenant_id"]] += 1
        if c.get("ok") is False:
            errors[c["tenant_id"]] += 1

    weights = await _weights(database)
    out = {}
    for t in tenants:
        tid = t["id"]
        rows = daily.get(tid, [])
        now14 = sum((r.get("actions_total") or 0) for r in rows if r["day"] >= day(13))
        before14 = sum((r.get("actions_total") or 0) for r in rows if day(27) <= r["day"] < day(13))
        areas = {a for r in rows if r["day"] >= day(13) for a, n in (r.get("actions") or {}).items() if n and a in AREAS}
        health = score_parts(
            weights=weights, active_7d=len(present.get(tid, ())), seats=seats.get(tid, 0), areas_14d=len(areas),
            actions_now=now14, actions_before=before14, milestones=t.get("milestones") or {},
            urgent_tickets=urgent.get(tid, 0), failed_payments=failed.get(tid, 0),
            ai_error_rate=(errors.get(tid, 0) / calls[tid]) if calls.get(tid) else 0.0)
        out[tid] = {
            "name": workspace_name(t), "health": health,
            "stage": stage_of(tenant=t, score=health["score"], last_seen=last_seen.get(tid), halted_at=halted.get(tid),
                              now=now),
            "active_7d": len(present.get(tid, ())), "seats": seats.get(tid, 0),
            "last_seen_at": last_seen.get(tid),
            "ai_cost_30d_usd": round(sum((r.get("ai_cost_usd") or 0) for r in rows), 6),
            "actions_30d": sum((r.get("actions_total") or 0) for r in rows),
            "areas_14d": sorted(areas),
        }
    return out

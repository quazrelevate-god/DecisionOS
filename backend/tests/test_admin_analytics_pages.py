"""Epic 11 Sprint 7 — admin console v2, P3: the analytics pages and Home (2026-10-23).

  * growth: sign-ups by week, the activation funnel (week-2 activity counted
    only for companies old enough), trial -> paid, days to activate;
  * engagement: daily / weekly / monthly active people, adoption by area;
  * retention: weekly sign-up cohorts;
  * revenue: MRR rebuilt month by month from plan-change events, movement,
    payments to chase;
  * AI economics: cost against revenue, the >30% flag;
  * Home: what needs an operator, ranked; health movers from the daily snapshot.

Pure unit tests over tests/fake_mongo — no server, no network.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest

from tests.fake_mongo import FakeDB

SUPER = {"id": "adm1", "email": "boss@decisionos.test", "role": "super_admin"}


def run(coro):
    return asyncio.run(coro)


def iso(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


def day(n=0):
    from services.rollups import IST
    return (datetime.now(IST).date() - timedelta(days=n)).isoformat()


@pytest.fixture
def d(monkeypatch):
    fake = FakeDB()
    import routers.admin_analytics as analytics_router
    import services.analytics as analytics
    import services.customer_health as health
    import services.platform_config as pc
    import services.rollups as rollups
    for mod, name in ((analytics_router, "db"), (analytics, "_db"), (health, "_db"), (pc, "db"), (rollups, "_db")):
        monkeypatch.setattr(mod, name, fake)
    monkeypatch.setattr(analytics, "BILLING_PLAN_PRICES_INR_PAISE", {"starter": 99900, "business": 249900})
    return fake


# --- growth ------------------------------------------------------------------------------
def test_the_activation_funnel(d):
    from services.analytics import growth
    d.tenants.docs += [
        {"id": "a", "company_name": "Activated Co", "created_at": iso(days=-20), "plan": "business",
         "milestones": {"first_decision_at": iso(days=-19), "first_invite_at": iso(days=-18), "activated_at": iso(days=-18)}},
        {"id": "b", "company_name": "Decided Co", "created_at": iso(days=-30), "milestones": {"first_decision_at": iso(days=-29)}},
        {"id": "c", "company_name": "New Co", "created_at": iso(days=-3)},
        {"id": "x", "company_name": "TEST_Co", "created_at": iso(days=-5)},
    ]
    start = date.fromisoformat(day(20))
    d.tenant_daily.docs += [{"tenant_id": "a", "day": (start + timedelta(days=k)).isoformat(), "actions_total": 3}
                            for k in (8, 9, 10)]
    g = run(growth(90))
    f = {s["key"]: s["count"] for s in g["funnel"]}
    assert f == {"signed_up": 3, "first_decision": 2, "invited": 1, "activated": 1, "week2": 1, "paying": 1}
    assert all(a["count"] >= b["count"] for a, b in zip(g["funnel"], g["funnel"][1:]))   # only narrows
    assert g["too_new_for_week2"] == 1 and g["median_days_to_activate"] == 2
    assert g["trial_to_paid"] == {"trials_ended": 2, "paying": 1, "rate": 0.5}
    assert sum(w["signups"] for w in g["weeks"]) == 3


# --- engagement ---------------------------------------------------------------------------
def test_active_people_by_day_week_and_month(d):
    from services.analytics import engagement
    d.tenants.docs += [{"id": "t1", "company_name": "One"}, {"id": "t2", "company_name": "Two"}]
    d.presence_days.docs += [{"tenant_id": "t1", "user_id": "u1", "day": day(0)},
                             {"tenant_id": "t1", "user_id": "u2", "day": day(3)},
                             {"tenant_id": "t2", "user_id": "u3", "day": day(20)}]
    # Today in India, whatever the hour: "an hour ago" was yesterday just after
    # midnight IST and the count came out one short (2026-10-30, 00:30 IST).
    today = f"{day(0)}T00:00:01+05:30"
    d.activity.docs.append({"tenant_id": "t2", "actor": "u4", "created_at": today})
    d.activity.docs.append({"tenant_id": "t2", "actor": "system", "created_at": today})
    d.tenant_daily.docs += [{"tenant_id": "t1", "day": day(0), "actions_total": 2, "actions": {"tasks": 2}, "active_people": 1},
                            {"tenant_id": "t2", "day": day(0), "actions_total": 1, "actions": {"finance": 1}, "active_people": 1}]
    e = run(engagement(30))
    now = e["now"]
    assert now["dau"] == 2 and now["wau"] == 3 and now["mau"] == 4 and now["active_workspaces"] == 2
    week = e["adoption"][-1]
    assert week["active_workspaces"] == 2 and week["areas"]["tasks"] == 0.5 and week["areas"]["finance"] == 0.5
    assert {t["name"] for t in e["top"]} == {"One", "Two"}


# --- retention ------------------------------------------------------------------------------
def test_weekly_cohorts(d):
    from services.analytics import retention, _week_start
    monday = _week_start(date.fromisoformat(day(0))) - timedelta(days=14)
    created = datetime.combine(monday, datetime.min.time(), timezone.utc).replace(hour=6).isoformat()
    d.tenants.docs += [{"id": "a", "created_at": created}, {"id": "b", "created_at": created}]
    d.tenant_daily.docs += [{"tenant_id": "a", "day": (monday + timedelta(days=1)).isoformat(), "actions_total": 1},
                            {"tenant_id": "b", "day": (monday + timedelta(days=2)).isoformat(), "actions_total": 1},
                            {"tenant_id": "a", "day": (monday + timedelta(days=8)).isoformat(), "actions_total": 1}]
    r = run(retention(4))
    row = next(c for c in r["cohorts"] if c["week"] == monday.isoformat())
    assert row["size"] == 2 and row["cells"][0] == 1.0 and row["cells"][1] == 0.5


# --- revenue -------------------------------------------------------------------------------
def test_mrr_is_rebuilt_from_plan_changes(d):
    from services.analytics import revenue
    d.tenants.docs += [
        {"id": "up", "company_name": "Upgraded", "plan": "business", "created_at": iso(days=-200)},
        {"id": "new", "company_name": "New payer", "plan": "starter", "created_at": iso(days=-200)},
        {"id": "gone", "company_name": "Churned", "plan": "trial", "created_at": iso(days=-200)},
        {"id": "trial", "company_name": "Still trying", "plan": "trial", "created_at": iso(days=-5)},
    ]
    d.lifecycle_events.docs += [
        {"tenant_id": "up", "kind": "plan_changed", "data": {"from": "starter", "to": "business"}, "created_at": iso(minutes=-5)},
        {"tenant_id": "new", "kind": "plan_changed", "data": {"from": "trial", "to": "starter"}, "created_at": iso(minutes=-5)},
        {"tenant_id": "gone", "kind": "plan_changed", "data": {"from": "starter", "to": "trial"}, "created_at": iso(minutes=-5)},
        {"tenant_id": "gone", "kind": "payment_failed", "data": {"plan": "starter"}, "created_at": iso(days=-3)},
    ]
    r = run(revenue(2))
    assert r["now"]["mrr"] == 2499.0 + 999.0 and r["now"]["paying"] == 2
    # at the end of last month: up was on starter, new on trial, gone on starter
    assert r["months"][-2]["mrr"] == 999.0 * 2
    mv = r["movement"][-1]
    assert mv["new"] == 999.0 and mv["expansion"] == 1500.0 and mv["churn"] == -999.0
    assert [c["id"] for c in r["to_chase"]] == ["gone"]


def test_a_suspended_payer_counts_nothing(d):
    from services.analytics import revenue
    d.tenants.docs.append({"id": "s", "plan": "business", "suspended": True, "created_at": iso(days=-90)})
    assert run(revenue(1))["now"]["mrr"] == 0


# --- AI economics -------------------------------------------------------------------------------
def test_ai_cost_against_revenue(d):
    from services.analytics import ai_economics
    d.tenants.docs += [{"id": "rich", "company_name": "Rich", "plan": "business"},
                       {"id": "costly", "company_name": "Costly", "plan": "starter"},
                       {"id": "free", "company_name": "Free", "plan": "trial"}]
    d.tenant_daily.docs += [{"tenant_id": "rich", "day": day(1), "ai_cost_usd": 1.0, "active_people": 4},
                            {"tenant_id": "costly", "day": day(1), "ai_cost_usd": 5.0, "active_people": 1},
                            {"tenant_id": "free", "day": day(1), "ai_cost_usd": 7.0}]
    a = run(ai_economics(30, usd_inr=100.0))
    rows = {r["id"]: r for r in a["customers"]}
    assert rows["rich"]["ai_cost_inr"] == 100.0 and rows["rich"]["flag"] is False
    assert rows["costly"]["share_of_revenue"] == round(500 / 999, 4) and rows["costly"]["flag"] is True
    assert rows["free"]["flag"] is True and rows["free"]["share_of_revenue"] is None   # ₹700 with no revenue
    assert a["flagged"] == 2 and a["cost_per_active_person_inr"] == 260.0


# --- Home -----------------------------------------------------------------------------------
def test_home_ranks_what_needs_an_operator(d):
    from routers.admin_analytics import admin_home
    d.tenants.docs += [
        {"id": "pay", "company_name": "Payer", "plan": "business", "created_at": iso(days=-90)},
        {"id": "tri", "company_name": "Trier", "plan": "trial", "created_at": iso(days=-12), "trial_ends_at": iso(days=2)},
        {"id": "fol", "company_name": "Follow", "plan": "trial", "created_at": iso(days=-40), "next_follow_up_at": day(0)},
    ]
    d.lifecycle_events.docs.append({"tenant_id": "pay", "kind": "payment_failed", "data": {"plan": "business"},
                                    "created_at": iso(days=-2)})
    d.support_tickets.docs.append({"tenant_id": "pay", "id": "k1", "subject": "Invoices", "status": "open", "priority": "urgent",
                                   "created_at": iso(days=-3), "messages": [{"author_type": "tenant", "created_at": iso(days=-2)}]})
    d.platform_alerts.docs.append({"resolved": False})
    h = run(admin_home(include_test=False, admin=SUPER))
    kinds = [n["kind"] for n in h["needs"]]
    assert kinds[0] == "outage"
    assert {"payment_failed", "ticket", "trial_ending", "follow_up", "at_risk"} <= set(kinds)
    assert next(n for n in h["needs"] if n["kind"] == "ticket")["to"] == "support/k1"
    assert h["kpis"]["mrr"]["value"] == 2499.0 and "series" in h["kpis"]["wau"]


def test_movers_come_from_the_daily_health_snapshot(d):
    from routers.admin_analytics import admin_home
    from services.rollups import snapshot_health
    d.tenants.docs += [{"id": "t1", "company_name": "Riser", "created_at": iso(days=-60)},
                       {"id": "t2", "company_name": "Faller", "created_at": iso(days=-60)}]
    d.tenant_daily.docs += [{"_id": f"t1:{day(6)}", "tenant_id": "t1", "day": day(6), "health": 20},
                            {"_id": f"t2:{day(6)}", "tenant_id": "t2", "day": day(6), "health": 80}]
    assert run(snapshot_health()) == 2
    today_rows = [r for r in d.tenant_daily.docs if r["day"] == day(0)]
    assert len(today_rows) == 2 and all("health" in r and r["stage"] for r in today_rows)
    m = run(admin_home(include_test=False, admin=SUPER))["movers"]
    assert m["down"][0]["name"] == "Faller" and m["down"][0]["from"] == 80
    assert m["up"] == [] or m["up"][0]["name"] == "Riser"

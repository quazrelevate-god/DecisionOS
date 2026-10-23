"""Epic 11 Sprint 7 — admin console v2, P1: the analytics foundations (2026-10-23).

  * presence: sign-in and "last seen" stamps, one row per person per day,
    written at most once an hour, and the phone-code sign-in recorded at last;
  * milestones: each first lands once; activation = a decision approved and a
    teammate invited within 14 days of signing up;
  * lifecycle: sign-up, plan changes, payments, suspend / reactivate as events;
  * the daily roll-up: counted by IST day from what each source kept, kept for
    good, backfilled, summed for the platform;
  * the console reads all of it (status, rebuild, the workspace page).

Pure unit tests over tests/fake_mongo — no server, no network.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from tests.fake_mongo import FakeDB

SUPER = {"id": "adm1", "email": "boss@decisionos.test", "role": "super_admin"}
BACKEND = Path(__file__).resolve().parents[1]


def run(coro):
    return asyncio.run(coro)


def iso(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


@pytest.fixture
def d(monkeypatch):
    fake = FakeDB()
    import core
    import routers.admin as admin
    import routers.admin_analytics as analytics
    import routers.admin_billing as admin_billing
    import routers.admin_tenant360 as t360
    import services.lifecycle as lifecycle
    import services.milestones as milestones
    import services.rollups as rollups
    for mod, name in ((core, "db"), (admin, "db"), (analytics, "db"), (admin_billing, "db"), (t360, "db"),
                      (lifecycle, "_db"), (milestones, "_db"), (rollups, "_db")):
        monkeypatch.setattr(mod, name, fake)
    monkeypatch.setattr(milestones, "_set_once", set())
    return fake


# --- presence ------------------------------------------------------------------------
def test_a_sign_in_stamps_the_person_and_the_day(d):
    from services.presence import note_sign_in, PRESENCE_DAYS
    d.users.docs.append({"id": "u1", "tenant_id": "t1"})
    d.memberships.docs.append({"user_id": "u1", "tenant_id": "t1", "status": "active"})
    run(note_sign_in(d, user_id="u1", tenant_id="t1", method="phone_code"))
    run(note_sign_in(d, user_id="u1", tenant_id="t1", method="phone_code"))
    u, m = d.users.docs[0], d.memberships.docs[0]
    assert u["last_login_at"] and u["last_seen_at"] and u["last_login_method"] == "phone_code"
    assert m["last_login_at"] and m["last_seen_at"]
    (row,) = d[PRESENCE_DAYS].docs
    assert row["tenant_id"] == "t1" and row["user_id"] == "u1" and row["sign_ins"] == 2 and row["day"]


def test_sessions_become_presence_without_touching_the_request_path(d):
    from services.presence import sync_from_sessions, PRESENCE_DAYS
    d.memberships.docs.append({"user_id": "u1", "tenant_id": "t1", "last_seen_at": "2026-10-20T10:00:00+00:00"})
    d.users.docs.append({"id": "u1"})
    d.active_sessions.docs += [
        {"user_id": "u1", "tenant_id": "t1", "last_seen_at": "2026-10-23T04:00:00+00:00"},
        {"user_id": "u1", "tenant_id": "t1", "last_seen_at": "2026-10-23T06:00:00+00:00"},
        {"user_id": "u2", "tenant_id": "t1", "last_seen_at": "2026-10-01T06:00:00+00:00"},   # before the window
    ]
    assert run(sync_from_sessions(d, "2026-10-22T00:00:00+00:00")) == 1
    run(sync_from_sessions(d, "2026-10-22T00:00:00+00:00"))          # again: nothing doubles
    (row,) = d[PRESENCE_DAYS].docs
    assert row["_id"] == "t1:u1:2026-10-23" and row["last_seen_at"] == "2026-10-23T06:00:00+00:00"
    assert d.memberships.docs[0]["last_seen_at"] == "2026-10-23T06:00:00+00:00"
    assert d.users.docs[0]["last_seen_at"] == "2026-10-23T06:00:00+00:00"


def test_the_phone_code_sign_in_now_leaves_a_trail(d):
    from services.presence import record_sign_in, PRESENCE_DAYS
    from core import create_token
    import services.audit_log as audit
    d.users.docs.append({"id": "u1", "tenant_id": "t1"})
    token = create_token("u1", "t1", "owner")
    run(record_sign_in(d, None, user={"id": "u1", "tenant_id": "t1"}, tenant_id="t1", role="owner",
                       token=token, method="phone_code"))
    (a,) = [r for r in d[audit.COLLECTION if hasattr(audit, "COLLECTION") else "audit_log"].docs]
    assert a["action"] == "login_success" and a["meta"]["method"] == "phone_code"
    assert len(d.active_sessions.docs) == 1 and d.active_sessions.docs[0]["user_id"] == "u1"
    assert d[PRESENCE_DAYS].docs[0]["sign_ins"] == 1
    src = (BACKEND / "routers" / "auth_otp.py").read_text(encoding="utf-8")
    assert 'method="phone_code"' in src and "record_sign_in(" in src


def test_every_sign_in_path_notes_presence_and_requests_stay_lean():
    auth = (BACKEND / "routers" / "auth.py").read_text(encoding="utf-8")
    for method in ('method="password"', 'method="two_factor"', 'method="signup"'):
        assert method in auth, method
    # a request costs what it did: presence is synced from sessions by the scheduler
    assert "presence" not in (BACKEND / "core" / "deps.py").read_text(encoding="utf-8")
    assert "sync_from_sessions(" in (BACKEND / "services" / "rollups.py").read_text(encoding="utf-8")


# --- milestones ------------------------------------------------------------------------
def test_a_first_lands_once_and_activation_follows(d):
    from services.milestones import note
    d.tenants.docs.append({"id": "t1", "created_at": iso(days=-3)})
    run(note("t1", "decision_approved", iso(days=-2)))
    ms = d.tenants.docs[0]["milestones"]
    assert ms["first_decision_approved_at"] and ms["first_decision_at"] == ms["first_decision_approved_at"]
    assert "activated_at" not in ms
    first = ms["first_decision_approved_at"]
    run(note("t1", "decision_approved", iso()))
    assert d.tenants.docs[0]["milestones"]["first_decision_approved_at"] == first
    run(note("t1", "employees_invited", iso(days=-1)))
    assert d.tenants.docs[0]["milestones"]["activated_at"] == d.tenants.docs[0]["milestones"]["first_invite_at"]


def test_activation_needs_both_within_fourteen_days():
    from services.milestones import activation_time
    signed = "2026-10-01T00:00:00+00:00"
    assert activation_time(signed, {"first_decision_approved_at": "2026-10-03T00:00:00+00:00"}) is None
    assert activation_time(signed, {"first_decision_approved_at": "2026-10-03T00:00:00+00:00",
                                    "first_invite_at": "2026-10-20T00:00:00+00:00"}) is None
    assert activation_time(signed, {"first_decision_approved_at": "2026-10-03T00:00:00+00:00",
                                    "first_invite_at": "2026-10-09T00:00:00+00:00"}) == "2026-10-09T00:00:00+00:00"


def test_logging_activity_feeds_the_milestones(d):
    from core import log_activity
    d.tenants.docs.append({"id": "t1", "created_at": iso(days=-1)})
    run(log_activity("t1", "u1", "task_created", "Made a task"))
    run(log_activity("t1", "u1", "something_else", "Not a milestone"))
    assert set(d.tenants.docs[0]["milestones"]) == {"first_task_at"}
    assert len(d.activity.docs) == 2


def test_backfill_reads_firsts_from_the_collections(d):
    from services.milestones import backfill_tenant
    d.tenants.docs.append({"id": "t1", "created_at": "2026-10-01T00:00:00+00:00",
                           "milestones": {"first_task_at": "2026-10-02T09:00:00+00:00"}})
    d.decisions.docs += [{"tenant_id": "t1", "created_at": "2026-10-03T00:00:00+00:00", "status": "approved",
                          "decided_at": "2026-10-04T00:00:00+00:00"},
                         {"tenant_id": "t1", "created_at": "2026-10-02T00:00:00+00:00", "status": "pending"}]
    d.tasks.docs.append({"tenant_id": "t1", "created_at": "2026-10-01T05:00:00+00:00"})
    d.memberships.docs += [{"tenant_id": "t1", "role": "owner", "invited_at": "2026-10-01T00:00:00+00:00"},
                           {"tenant_id": "t1", "role": "sales", "invited_at": "2026-10-05T00:00:00+00:00"}]
    d.invoices.docs.append({"tenant_id": "t1", "created_at": "2026-10-06T00:00:00+00:00"})
    written = run(backfill_tenant("t1"))
    ms = d.tenants.docs[0]["milestones"]
    assert ms["first_task_at"] == "2026-10-02T09:00:00+00:00"          # never overwritten
    assert "first_task_at" not in written
    assert ms["first_decision_at"] == "2026-10-02T00:00:00+00:00"
    assert ms["first_decision_approved_at"] == "2026-10-04T00:00:00+00:00"
    assert ms["first_invite_at"] == "2026-10-05T00:00:00+00:00"         # not the owner
    assert ms["first_finance_at"] == "2026-10-06T00:00:00+00:00"
    assert ms["activated_at"] == "2026-10-05T00:00:00+00:00"


# --- lifecycle --------------------------------------------------------------------------
def test_suspend_and_reactivate_keep_why_and_since_when(d):
    from routers.admin import admin_suspend_tenant, admin_reactivate_tenant, ReasonInput
    d.tenants.docs.append({"id": "t1", "company_name": "Acme"})
    run(admin_suspend_tenant("t1", ReasonInput(reason="Chargeback"), admin=SUPER))
    t = d.tenants.docs[0]
    assert t["suspended"] and t["suspended_at"] and t["suspended_reason"] == "Chargeback"
    assert t["suspended_by"] == SUPER["email"]
    run(admin_reactivate_tenant("t1", admin=SUPER))
    t = d.tenants.docs[0]
    assert t["suspended"] is False and "suspended_at" not in t and "suspended_reason" not in t
    kinds = [e["kind"] for e in d.lifecycle_events.docs]
    assert kinds == ["suspended", "reactivated"] and d.lifecycle_events.docs[0]["reason"] == "Chargeback"


def test_an_admin_plan_change_is_an_event(d):
    from routers.admin_billing import billing_set_plan, PlanOverrideInput
    d.tenants.docs.append({"id": "t1", "company_name": "Acme", "plan": "trial"})
    run(billing_set_plan("t1", PlanOverrideInput(plan="business", reason="Agreed on the call"), admin=SUPER))
    (e,) = d.lifecycle_events.docs
    assert e["kind"] == "plan_changed" and e["data"] == {"from": "trial", "to": "business"}
    assert e["source"] == "admin" and e["reason"] == "Agreed on the call"


def test_the_same_plan_is_not_a_change(d):
    from services.lifecycle import plan_changed
    run(plan_changed("t1", "business", "business", source="admin"))
    assert d.lifecycle_events.docs == []


def test_payments_and_signup_record_events_at_the_source():
    billing = (BACKEND / "routers" / "billing.py").read_text(encoding="utf-8")
    assert '"payment_received"' in billing and "_lifecycle.plan_changed(" in billing
    assert '"subscription_halted" if event == "subscription.halted" else "payment_failed"' in billing
    assert '"signed_up"' in (BACKEND / "routers" / "auth.py").read_text(encoding="utf-8")


# --- the daily roll-up -------------------------------------------------------------------
def test_kinds_fall_into_product_areas():
    from services.rollups import area_of
    assert area_of("task_done") == "tasks" and area_of("invoice_created") == "finance"
    assert area_of("request_raised") == "requests" and area_of("contact_added") == "crm"
    assert area_of("something_new") == "other"


def test_days_are_counted_on_the_indian_calendar():
    from services.rollups import ist_day, day_start_utc
    assert ist_day("2026-10-22T19:00:00+00:00") == "2026-10-23"      # 00:30 IST
    assert ist_day("2026-10-22T18:00:00+00:00") == "2026-10-22"
    assert day_start_utc("2026-10-23").startswith("2026-10-22T18:30")


def _seed_day(d, day_utc="2026-10-22T06:00:00+00:00"):
    d.activity.docs += [
        {"tenant_id": "t1", "actor": "u1", "kind": "task_created", "created_at": day_utc},
        {"tenant_id": "t1", "actor": "u2", "kind": "invoice_created", "created_at": day_utc},
        {"tenant_id": "t1", "actor": "system", "kind": "task_status", "created_at": day_utc},
        {"tenant_id": "t2", "actor": "u9", "kind": "decision_approved", "created_at": day_utc},
    ]
    d.presence_days.docs.append({"_id": "t1:u3:2026-10-22", "tenant_id": "t1", "user_id": "u3",
                                 "day": "2026-10-22", "sign_ins": 2})
    d.audit_log.docs.append({"action": "login_success", "tenant_id": "t1", "timestamp": day_utc})
    d.usage_events.docs += [{"tenant_id": "t1", "cost_estimate": 0.25, "created_at": day_utc},
                            {"tenant_id": "t1", "cost_estimate": 0.5, "created_at": day_utc}]
    d.voice_notes.docs.append({"tenant_id": "t1", "created_at": day_utc})


def test_a_day_is_counted_from_every_source(d):
    from services.rollups import count_window, _doc
    _seed_day(d)
    rows = run(count_window("2026-10-22", "2026-10-22"))
    r = _doc(rows[("t1", "2026-10-22")])
    assert r["active_people"] == 3                    # u1, u2 acting + u3 present; system is nobody
    assert r["sign_ins"] == 2                         # presence (2) beats the audit log (1)
    assert r["actions"] == {"tasks": 2, "finance": 1} and r["actions_total"] == 3
    assert r["ai_calls"] == 2 and r["ai_cost_usd"] == 0.75 and r["voice_notes"] == 1
    assert _doc(rows[("t2", "2026-10-22")])["actions"] == {"decisions": 1}


def test_writing_a_window_twice_keeps_one_row_per_company_day(d):
    from services.rollups import write_window, COLLECTION
    _seed_day(d)
    run(write_window("2026-10-22", "2026-10-22"))
    run(write_window("2026-10-22", "2026-10-22"))
    ids = sorted(r["_id"] for r in d[COLLECTION].docs)
    assert ids == ["t1:2026-10-22", "t2:2026-10-22"]


def test_backfill_counts_back_and_fills_milestones_and_signups(d):
    from services.rollups import backfill, COLLECTION
    d.tenants.docs.append({"id": "t1", "created_at": iso(days=-40)})
    d.tasks.docs.append({"tenant_id": "t1", "created_at": iso(days=-39)})
    d.activity.docs.append({"tenant_id": "t1", "actor": "u1", "kind": "task_created", "created_at": iso(days=-2)})
    out = run(backfill(days=30))
    assert out["tenants"] == 1 and out["rows"] >= 1 and len(d[COLLECTION].docs) >= 1
    assert d.tenants.docs[0]["milestones"]["first_task_at"]
    (e,) = d.lifecycle_events.docs
    assert e["kind"] == "signed_up" and e["source"] == "backfill"
    run(backfill(days=30))
    assert len(d.lifecycle_events.docs) == 1        # not twice


def test_the_platform_series_sums_companies_by_day(d):
    from services.rollups import series, COLLECTION, IST
    today = datetime.now(IST).date().isoformat()
    d[COLLECTION].docs += [
        {"tenant_id": "t1", "day": today, "active_people": 3, "sign_ins": 2, "actions_total": 5, "ai_cost_usd": 0.5},
        {"tenant_id": "t2", "day": today, "active_people": 0, "sign_ins": 0, "actions_total": 0, "ai_cost_usd": 0},
    ]
    (row,) = run(series(days=7))
    assert row == {"day": today, "active_workspaces": 1, "active_people": 3, "sign_ins": 2,
                   "actions_total": 5, "ai_cost_usd": 0.5}


def test_retention_never_purges_the_kept_history():
    from services.retention import RETENTION_ELIGIBLE
    for coll in ("tenant_daily", "presence_days", "lifecycle_events"):
        assert coll not in RETENTION_ELIGIBLE


def test_the_scheduler_rolls_up_and_backfills_once():
    src = (BACKEND / "workers" / "schedulers.py").read_text(encoding="utf-8")
    assert "await _maybe_run_rollups()" in src
    assert '"analytics_backfill"' in src and '"daily_rollup"' in src


# --- the console reads it ----------------------------------------------------------------
def test_status_reports_what_is_kept(d):
    from routers.admin_analytics import analytics_status
    from services.rollups import IST
    today = datetime.now(IST).date().isoformat()
    d.tenants.docs += [{"id": "t1", "company_name": "Tracole", "created_at": iso(days=-5),
                        "milestones": {"activated_at": iso(days=-1)}},
                       {"id": "x1", "company_name": "TEST_Co", "created_at": iso(days=-5)}]
    d.presence_days.docs += [{"tenant_id": "t1", "user_id": "u1", "day": today},
                             {"tenant_id": "x1", "user_id": "u9", "day": today}]
    d.tenant_daily.docs.append({"tenant_id": "t1", "day": today, "active_people": 1, "actions_total": 2})
    out = run(analytics_status(include_test=False, admin=SUPER))
    assert out["active_people"] == {"today": 1, "last_7_days": 1, "last_30_days": 1}
    assert out["activation"] == {"workspaces": 1, "activated": 1, "signed_up_90_days": 1, "activated_of_those": 1}
    assert out["series"][0]["active_workspaces"] == 1 and out["kept"]["presence_days"] == 2


def test_the_workspace_page_has_milestones_lifecycle_and_last_seen(d):
    from routers.admin_tenant360 import admin_tenant_360
    d.tenants.docs.append({"id": "t1", "company_name": "Tracole", "milestones": {"first_task_at": iso()}})
    d.users.docs.append({"id": "u1", "tenant_id": "t1", "name": "Asha", "created_at": iso(days=-3)})
    d.memberships.docs.append({"user_id": "u1", "tenant_id": "t1", "status": "active", "last_seen_at": iso(hours=-2)})
    d.lifecycle_events.docs.append({"tenant_id": "t1", "kind": "signed_up", "created_at": iso(days=-3)})
    out = run(admin_tenant_360("t1", admin=SUPER))
    assert out["members"][0]["last_seen_at"] and out["members"][0]["membership_status"] == "active"
    assert next(m for m in out["milestones"] if m["key"] == "first_task_at")["at"]
    assert out["lifecycle"][0]["kind"] == "signed_up" and out["daily"] == []


def test_only_a_super_admin_rebuilds():
    import inspect
    from fastapi import HTTPException
    from routers.admin_analytics import analytics_rebuild
    dep = inspect.signature(analytics_rebuild).parameters["admin"].default
    with pytest.raises(HTTPException):
        run(dep.dependency(admin={"id": "a", "role": "support"}))

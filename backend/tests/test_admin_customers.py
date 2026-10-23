"""Epic 11 Sprint 7 — admin console v2, P2: managing customers (2026-10-23).

  * health: five named parts that add to 100, bands, weights from config;
  * stage: test, suspended, churned, at risk, paying, activated, trial;
  * the customer list: health, stage, MRR, seats, active people, last seen,
    owner, tags, test workspaces hidden;
  * account fields, notes, bulk actions, saved views — each audited;
  * one company's timeline and its weekly usage.

Pure unit tests over tests/fake_mongo — no server, no network.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from tests.fake_mongo import FakeDB

SUPER = {"id": "adm1", "email": "boss@decisionos.test", "role": "super_admin"}


def run(coro):
    return asyncio.run(coro)


def iso(**delta):
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


def ist_day(n=0):
    from services.rollups import IST
    return (datetime.now(IST).date() - timedelta(days=n)).isoformat()


@pytest.fixture
def d(monkeypatch):
    fake = FakeDB()
    import routers.admin as admin
    import routers.admin_customers as customers
    import services.customer_health as health
    import services.lifecycle as lifecycle
    import services.platform_config as pc
    for mod, name in ((admin, "db"), (customers, "db"), (health, "_db"), (lifecycle, "_db"), (pc, "db")):
        monkeypatch.setattr(mod, name, fake)
    monkeypatch.setattr(customers, "BILLING_PLAN_PRICES_INR_PAISE", {"starter": 99900, "business": 249900})
    return fake


# --- health ------------------------------------------------------------------------------
def _parts(**kw):
    from services.customer_health import score_parts
    base = dict(weights={}, active_7d=0, seats=0, areas_14d=0, actions_now=0, actions_before=0,
                milestones={}, urgent_tickets=0, failed_payments=0, ai_error_rate=0.0)
    return score_parts(**{**base, **kw})


def test_a_busy_complete_customer_scores_full_marks():
    from services.customer_health import KEY_MILESTONES
    h = _parts(active_7d=5, seats=5, areas_14d=8, actions_now=60, actions_before=40,
               milestones={k: "x" for k in KEY_MILESTONES})
    assert h["score"] == 100 and h["band"] == "healthy"
    assert h["parts"] == {"activity": 30, "breadth": 20, "momentum": 20, "setup": 15, "friction": 15}


def test_an_empty_customer_keeps_only_friction():
    h = _parts()
    assert h["score"] == 15 and h["band"] == "at_risk" and h["parts"]["momentum"] == 0


def test_momentum_and_friction():
    assert _parts(actions_now=10, actions_before=0)["parts"]["momentum"] == 20     # from nothing to something
    assert _parts(actions_now=5, actions_before=10)["parts"]["momentum"] == 8      # halved: 20 * 0.5 / 1.25
    assert _parts(urgent_tickets=1, failed_payments=1)["parts"]["friction"] == 4  # 15 - 4 - 7
    assert _parts(failed_payments=3)["parts"]["friction"] == 0
    assert _parts(ai_error_rate=0.2)["parts"]["friction"] == 12


def test_weights_can_be_tuned():
    h = _parts(weights={"activity": 50, "friction": 0}, active_7d=2, seats=2)
    assert h["parts"]["activity"] == 50 and h["parts"]["friction"] == 0


# --- stage --------------------------------------------------------------------------------
def test_stages_in_order():
    from services.customer_health import stage_of
    old = iso(days=-90)
    s = lambda t, **kw: stage_of(tenant={"created_at": old, **t}, **{"score": 80, "last_seen": iso(), "halted_at": None, **kw})  # noqa: E731
    assert s({"company_name": "TEST_Co"}) == "test"
    assert s({"suspended": True}) == "suspended"
    assert s({}, last_seen=iso(days=-40)) == "churned"
    assert s({"plan": "business"}, halted_at=iso(days=-20)) == "churned"
    assert s({"plan": "business"}, score=30) == "at_risk"
    assert s({"plan": "business"}, last_seen=iso(days=-10)) == "at_risk"
    assert s({"plan": "business"}) == "paying"
    assert s({"milestones": {"activated_at": iso()}}) == "activated"
    assert s({"plan": "trial"}) == "trial"
    # a company signed up this week is not "quiet" yet
    assert stage_of(tenant={"created_at": iso(days=-2)}, score=10, last_seen=None, halted_at=None) == "trial"


def test_health_is_computed_for_every_company_at_once(d):
    from services.customer_health import compute_all
    d.tenants.docs += [{"id": "t1", "company_name": "Tracole", "plan": "business", "created_at": iso(days=-60),
                        "milestones": {"first_decision_at": iso(), "first_invite_at": iso()}},
                       {"id": "t2", "company_name": "Quiet Mills", "plan": "trial", "created_at": iso(days=-60)}]
    d.memberships.docs += [{"tenant_id": "t1", "user_id": "u1", "status": "active", "last_seen_at": iso(hours=-1)},
                           {"tenant_id": "t1", "user_id": "u2", "status": "active"},
                           {"tenant_id": "t2", "user_id": "u3", "status": "active"}]
    d.presence_days.docs.append({"tenant_id": "t1", "user_id": "u1", "day": ist_day(1)})
    d.activity.docs.append({"tenant_id": "t1", "actor": "u2", "kind": "task_done", "created_at": iso(days=-2)})
    d.tenant_daily.docs += [
        {"tenant_id": "t1", "day": ist_day(2), "actions": {"tasks": 6, "finance": 2}, "actions_total": 8, "ai_cost_usd": 0.5},
        {"tenant_id": "t1", "day": ist_day(20), "actions": {"tasks": 4}, "actions_total": 4, "ai_cost_usd": 0.25},
    ]
    d.support_tickets.docs.append({"tenant_id": "t1", "status": "open", "priority": "urgent"})
    out = run(compute_all(d))
    t1 = out["t1"]
    assert t1["active_7d"] == 2 and t1["seats"] == 2 and t1["stage"] == "paying"
    assert t1["health"]["parts"]["activity"] == 30 and t1["health"]["parts"]["friction"] == 11
    assert t1["areas_14d"] == ["finance", "tasks"] and t1["ai_cost_30d_usd"] == 0.75
    assert t1["health"]["parts"]["momentum"] == 20          # 8 now vs 4 before
    assert out["t2"]["stage"] == "churned" and out["t2"]["health"]["band"] == "at_risk"


# --- the list -----------------------------------------------------------------------------
def test_the_customer_list(d):
    from routers.admin_customers import customers
    d.tenants.docs += [{"id": "t1", "company_name": "Tracole", "plan": "business", "created_at": iso(days=-30),
                        "tags": ["textiles"], "owner_admin_id": "adm1"},
                       {"id": "x1", "company_name": "TEST_Co", "plan": "business"}]
    d.platform_admins.docs.append({"id": "adm1", "name": "Yogesh", "email": "y@x.test"})
    d.active_sessions.docs.append({"user_id": "u1", "tenant_id": "t1", "last_seen_at": iso(minutes=-5)})
    out = run(customers(include_test=False, admin=SUPER))
    (row,) = out["customers"]
    assert row["name"] == "Tracole" and row["mrr_inr"] == 2499.0 and row["owner_name"] == "Yogesh"
    assert row["tags"] == ["textiles"] and row["health"]["score"] >= 0 and row["stage"]
    assert row["last_seen_at"] and "seat_limit" in row and row["seats"] == 0
    assert len(run(customers(include_test=True, admin=SUPER))["customers"]) == 2


# --- account, notes, bulk, views ----------------------------------------------------------
def test_account_fields_are_cleaned_checked_and_audited(d):
    from routers.admin_customers import set_account, AccountInput
    d.tenants.docs.append({"id": "t1", "company_name": "Tracole"})
    d.platform_admins.docs += [{"id": "adm1", "email": "y@x.test"}, {"id": "gone", "email": "g@x.test", "active": False}]
    run(set_account("t1", AccountInput(tags=["  Textiles ", "textiles", "Big  Account"], owner_admin_id="adm1",
                                       next_follow_up_at="2026-10-28"), admin=SUPER))
    t = d.tenants.docs[0]
    assert t["tags"] == ["textiles", "big account"] and t["owner_admin_id"] == "adm1" and t["next_follow_up_at"] == "2026-10-28"
    assert d.platform_audit.docs[-1]["action"] == "customer_account"
    with pytest.raises(HTTPException):
        run(set_account("t1", AccountInput(owner_admin_id="gone"), admin=SUPER))
    with pytest.raises(HTTPException):
        run(set_account("t1", AccountInput(next_follow_up_at="soon"), admin=SUPER))
    run(set_account("t1", AccountInput(owner_admin_id="", next_follow_up_at=""), admin=SUPER))
    assert "owner_admin_id" not in d.tenants.docs[0] and "next_follow_up_at" not in d.tenants.docs[0]


def test_notes_pinned_first_then_newest(d):
    from routers.admin_customers import add_note, list_notes, edit_note, delete_note, NoteInput, NotePatch
    d.tenants.docs.append({"id": "t1", "company_name": "Tracole"})
    a = run(add_note("t1", NoteInput(text="Called the owner"), admin=SUPER))["note"]
    b = run(add_note("t1", NoteInput(text="Wants WhatsApp", pinned=True), admin=SUPER))["note"]
    c = run(add_note("t1", NoteInput(text="Sent the invoice"), admin=SUPER))["note"]
    d.customer_notes.docs[0]["created_at"] = iso(days=-2)
    d.customer_notes.docs[2]["created_at"] = iso(days=-1)
    assert [n["id"] for n in run(list_notes("t1", admin=SUPER))["notes"]] == [b["id"], c["id"], a["id"]]
    run(edit_note(a["id"], NotePatch(pinned=True), admin=SUPER))
    assert run(list_notes("t1", admin=SUPER))["notes"][1]["id"] == a["id"]
    run(delete_note(c["id"], admin=SUPER))
    assert len(d.customer_notes.docs) == 2
    with pytest.raises(HTTPException):
        run(add_note("t1", NoteInput(text="   "), admin=SUPER))


def test_bulk_actions(d):
    from routers.admin_customers import bulk, BulkInput
    d.tenants.docs += [{"id": "t1", "tags": ["vip"]}, {"id": "t2"}]
    d.platform_admins.docs.append({"id": "adm1", "email": "y@x.test"})
    assert run(bulk(BulkInput(tenant_ids=["t1", "t2"], action="tag", value="Textiles"), admin=SUPER))["changed"] == 2
    assert d.tenants.docs[0]["tags"] == ["vip", "textiles"] and d.tenants.docs[1]["tags"] == ["textiles"]
    run(bulk(BulkInput(tenant_ids=["t1"], action="untag", value="vip"), admin=SUPER))
    assert d.tenants.docs[0]["tags"] == ["textiles"]
    run(bulk(BulkInput(tenant_ids=["t1", "t2"], action="owner", value="adm1"), admin=SUPER))
    assert all(t["owner_admin_id"] == "adm1" for t in d.tenants.docs)
    run(bulk(BulkInput(tenant_ids=["t2"], action="test"), admin=SUPER))
    assert d.tenants.docs[1]["is_test"] is True
    with pytest.raises(HTTPException):
        run(bulk(BulkInput(tenant_ids=["t1"], action="delete"), admin=SUPER))
    assert d.platform_audit.docs[-1]["action"] == "customers_bulk"


def test_saved_views_are_shared(d):
    from routers.admin_customers import save_view, list_views, delete_view, ViewInput
    v = run(save_view(ViewInput(name="Paying and quiet", filters={"stage": "at_risk"}, columns=["health", "mrr"]),
                      admin=SUPER))["view"]
    assert run(list_views(admin={"id": "other", "role": "support"}))["views"][0]["name"] == "Paying and quiet"
    run(delete_view(v["id"], admin=SUPER))
    assert run(list_views(admin=SUPER))["views"] == []


# --- one company's story -------------------------------------------------------------------
def test_the_timeline_merges_every_source_newest_first(d):
    from routers.admin_customers import timeline
    d.tenants.docs.append({"id": "t1", "company_name": "Tracole"})
    d.lifecycle_events.docs.append({"tenant_id": "t1", "kind": "signed_up", "created_at": "2026-10-01T00:00:00+00:00"})
    d.activity.docs.append({"tenant_id": "t1", "kind": "task_done", "message": "Done", "created_at": "2026-10-05T00:00:00+00:00"})
    d.platform_audit.docs.append({"target_type": "tenant", "target_id": "t1", "action": "suspend_tenant",
                                  "message": "Suspended", "created_at": "2026-10-06T00:00:00+00:00"})
    d.support_tickets.docs.append({"tenant_id": "t1", "id": "k1", "subject": "Help", "status": "open",
                                   "created_at": "2026-10-04T00:00:00+00:00"})
    d.customer_notes.docs.append({"tenant_id": "t1", "text": "Called", "created_at": "2026-10-07T00:00:00+00:00"})
    d.users.docs.append({"id": "u2", "tenant_id": "t1", "name": "Ravi"})
    d.memberships.docs.append({"tenant_id": "t1", "user_id": "u2", "role": "sales",
                               "invited_at": "2026-10-02T00:00:00+00:00", "accepted_at": "2026-10-03T00:00:00+00:00"})
    d.billing_events.docs.append({"tenant_id": "t1", "event": "payment.captured", "amount_paise": 249900,
                                  "created_at": "2026-10-08T00:00:00+00:00"})
    items = run(timeline("t1", admin=SUPER))["items"]
    assert [i["kind"] for i in items] == ["payment", "note", "admin", "activity", "ticket", "member", "member", "lifecycle"]
    assert items[0]["amount_inr"] == 2499.0 and items[5]["text"] == "Ravi joined"


def test_usage_week_by_week(d):
    from routers.admin_customers import usage
    d.tenants.docs.append({"id": "t1"})
    d.tenant_daily.docs += [
        {"tenant_id": "t1", "day": ist_day(0), "actions": {"tasks": 3}, "active_people": 2, "sign_ins": 1, "ai_cost_usd": 0.1},
        {"tenant_id": "t1", "day": ist_day(1), "actions": {"tasks": 1, "finance": 2}, "active_people": 3, "sign_ins": 2},
        {"tenant_id": "t1", "day": ist_day(9), "actions": {"crm": 4}, "active_people": 1},
    ]
    weeks = run(usage("t1", weeks=2, admin=SUPER))["weeks"]
    assert len(weeks) == 2
    assert weeks[1]["areas"] == {"tasks": 4, "finance": 2} and weeks[1]["active_people_max"] == 3
    assert weeks[1]["sign_ins"] == 3 and weeks[0]["areas"] == {"crm": 4}

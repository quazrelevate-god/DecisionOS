"""Epic 11 Sprint 4 — the admin console redesign, backend half (2026-10-22).

  * which workspaces are ours (services/admin_workspaces) and the mark an
    admin sets by hand;
  * a reason travels into the audit log when a workspace or a person is
    suspended;
  * a deactivated admin is refused at sign-in, not after it;
  * the Overview: what needs an operator, the week against the one before,
    and customers' numbers only;
  * invite links: the inviter gets a link, the new admin sets their own
    password, once, within a week.

Pure unit tests over tests/fake_mongo — no server, no network.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response

from tests.fake_mongo import FakeDB

SUPER = {"id": "adm1", "email": "boss@decisionos.test", "role": "super_admin"}


def _iso(days=0):
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


@pytest.fixture
def d(monkeypatch):
    fake = FakeDB()
    import routers.admin as admin
    import routers.admin_invites as admin_invites
    import routers.admin_overview as admin_overview
    import routers.admin_rbac as admin_rbac
    import services.admin_invites as invites
    import services.platform_config as pc
    for mod in (admin, admin_invites, admin_overview, admin_rbac, invites, pc):
        monkeypatch.setattr(mod, "db", fake)
    return fake


def run(coro):
    return asyncio.run(coro)


# --- which workspaces are ours ---------------------------------------------------------
def test_test_workspaces_are_told_apart_from_customers():
    from services.admin_workspaces import is_test_tenant, test_reason
    assert is_test_tenant({"company_name": "TEST_Co_b4923a"})
    assert is_test_tenant({"name": "QA Owner's workspace"})
    assert is_test_tenant({"company_name": "Acme Sandbox"})
    assert is_test_tenant({"company_name": "Anything", "is_demo": True})
    assert not is_test_tenant({"company_name": "Tracole Technologies"})
    # "Contest", "Latest" and "Attestation" are words, not the word test.
    assert not is_test_tenant({"company_name": "Latest Attestation Contest Pvt Ltd"})
    assert test_reason({"company_name": "Tracole Technologies"}) == ""
    assert test_reason({"company_name": "TEST co"}) == "Name looks like a test"


def test_an_admins_mark_wins_over_the_name():
    from services.admin_workspaces import is_test_tenant, test_reason
    assert not is_test_tenant({"company_name": "Demo Foods", "is_test": False})
    assert is_test_tenant({"company_name": "Tracole Technologies", "is_test": True})
    assert test_reason({"company_name": "Demo Foods", "is_test": False}) == "Marked by an admin"


def test_example_addresses_are_test_people():
    from services.admin_workspaces import is_test_email
    assert is_test_email("owner@example.com")
    assert not is_test_email("owner@tracole.in")
    assert not is_test_email("")


def test_marking_a_workspace_is_saved_and_audited(d):
    from routers.admin import admin_mark_test_tenant, TestFlagInput
    d.tenants.docs.append({"id": "t1", "company_name": "Demo Foods"})
    out = run(admin_mark_test_tenant("t1", TestFlagInput(is_test=False), admin=SUPER))
    assert out == {"status": "ok", "is_test": False}
    assert d.tenants.docs[0]["is_test"] is False
    (row,) = d.platform_audit.docs
    assert row["action"] == "mark_customer_tenant" and row["target_id"] == "t1"
    with pytest.raises(HTTPException) as e:
        run(admin_mark_test_tenant("nope", TestFlagInput(is_test=True), admin=SUPER))
    assert e.value.status_code == 404


def test_the_workspace_list_carries_plan_and_test_mark(d):
    from routers.admin import admin_tenants
    d.tenants.docs += [{"id": "t1", "company_name": "Tracole Technologies", "plan": "business"},
                       {"id": "t2", "company_name": "TEST_Co_1", "plan": "trial"}]
    rows = {r["id"]: r for r in run(admin_tenants(admin=SUPER))["tenants"]}
    assert rows["t1"]["plan"] == "business" and rows["t1"]["is_test"] is False
    assert rows["t2"]["is_test"] is True and rows["t2"]["test_reason"] == "Name looks like a test"


# --- a reason goes into the audit log ----------------------------------------------------
def test_suspending_records_why(d):
    from routers.admin import admin_suspend_tenant, admin_suspend_user, ReasonInput
    d.tenants.docs.append({"id": "t1", "company_name": "Acme"})
    d.users.docs.append({"id": "u1", "tenant_id": "t1", "email": "a@acme.in"})
    run(admin_suspend_tenant("t1", ReasonInput(reason="  Chargeback on the last invoice "), admin=SUPER))
    run(admin_suspend_user("u1", ReasonInput(reason="Left the company"), admin=SUPER))
    msgs = [r["message"] for r in d.platform_audit.docs]
    assert any(m.endswith("— Chargeback on the last invoice") for m in msgs), msgs
    assert any(m.endswith("— Left the company") for m in msgs), msgs


def test_suspending_without_a_body_still_works(d):
    # Older clients post nothing; the reason is optional on the wire.
    from routers.admin import admin_suspend_tenant
    d.tenants.docs.append({"id": "t1", "company_name": "Acme"})
    run(admin_suspend_tenant("t1", None, admin=SUPER))
    assert d.platform_audit.docs[-1]["message"] == "Suspended workspace Acme"


# --- sign-in ------------------------------------------------------------------------------
class _Req:
    client = None


def _login(email, password, code=None):
    from routers.admin import admin_login
    from models.admin import AdminLoginInput
    return run(admin_login(AdminLoginInput(email=email, password=password, code=code), _Req(), Response()))


def test_a_deactivated_admin_is_refused_at_sign_in(d):
    from core import hash_password
    d.platform_admins.docs.append({"id": "a2", "email": "gone@decisionos.test", "active": False,
                                   "password_hash": hash_password("a long password 1")})
    with pytest.raises(HTTPException) as e:
        _login("gone@decisionos.test", "a long password 1")
    assert e.value.status_code == 403 and "deactivated" in e.value.detail


def test_a_wrong_password_on_a_deactivated_admin_says_nothing_more(d):
    # The deactivated message only shows to someone who knew the password.
    from core import hash_password
    d.platform_admins.docs.append({"id": "a2", "email": "gone@decisionos.test", "active": False,
                                   "password_hash": hash_password("a long password 1")})
    with pytest.raises(HTTPException) as e:
        _login("gone@decisionos.test", "guess")
    assert e.value.status_code == 401


def test_an_invited_admin_cannot_sign_in_before_setting_a_password(d):
    d.platform_admins.docs.append({"id": "a3", "email": "new@decisionos.test", "active": True,
                                   "invite": {"token_hash": "x", "expires_at": _iso(7)}})
    with pytest.raises(HTTPException) as e:
        _login("new@decisionos.test", "")
    assert e.value.status_code == 401


# --- the Overview --------------------------------------------------------------------------
def _seed_overview(d):
    d.tenants.docs += [
        {"id": "c1", "company_name": "Tracole Technologies", "plan": "business", "created_at": _iso(-3)},
        {"id": "c2", "company_name": "Sri Murugan Textiles", "plan": "trial", "created_at": _iso(-10),
         "trial_ends_at": _iso(3)},
        {"id": "c3", "company_name": "Old Mills", "plan": "starter", "created_at": _iso(-200)},
        {"id": "x1", "company_name": "TEST_Co_9", "plan": "business", "created_at": _iso(-1)},
    ]
    d.activity.docs += [
        {"tenant_id": "c1", "created_at": _iso(-1)}, {"tenant_id": "c1", "created_at": _iso(-2)},
        {"tenant_id": "c2", "created_at": _iso(-9)},
        {"tenant_id": "c3", "created_at": _iso(-30)},
        {"tenant_id": "x1", "created_at": _iso(-1)},
    ]
    d.usage_events.docs += [
        {"tenant_id": "c1", "created_at": _iso(-1), "cost_estimate": 0.5},
        {"tenant_id": "c2", "created_at": _iso(-8), "cost_estimate": 0.25},
        {"tenant_id": "x1", "created_at": _iso(-1), "cost_estimate": 9.0},
    ]
    d.support_tickets.docs += [{"status": "open"}, {"status": "closed"}]
    d.content_reports.docs += [{"status": "reviewing"}]
    d.platform_alerts.docs += [{"resolved": False}, {"resolved": True}]
    d.impersonation_sessions.docs += [{"expires_at": _iso(1)}, {"expires_at": _iso(1), "revoked": True},
                                      {"expires_at": _iso(-1)}]
    d.billing_events.docs += [{"event": "payment.failed", "created_at": _iso(-2)},
                              {"event": "payment.failed", "created_at": _iso(-60)}]


def test_the_overview_leads_with_what_needs_an_operator(d):
    from routers.admin_overview import admin_overview
    _seed_overview(d)
    o = run(admin_overview(include_test=False, admin=SUPER))
    assert o["needs_attention"] == {"outages": 1, "open_tickets": 1, "open_reports": 1,
                                    "live_view_as": 1, "trials_ending": 1, "failed_payments": 1}
    assert [t["name"] for t in o["trials_ending"]] == ["Sri Murugan Textiles"]


def test_the_overview_counts_customers_only(d):
    from routers.admin_overview import admin_overview
    _seed_overview(d)
    o = run(admin_overview(include_test=False, admin=SUPER))
    assert o["workspaces"] == {"total": 3, "test_hidden": 1}
    w = o["last_7_days"]
    assert w["active_workspaces"] == {"now": 1, "before": 1, "change": 0}
    assert w["signups"]["now"] == 1 and w["signups"]["before"] == 1
    assert w["ai_cost_usd"]["now"] == 0.5 and w["ai_cost_usd"]["before"] == 0.25   # not the test 9.0
    assert o["paying_workspaces"] == 2                                            # c1 + c3, not x1
    assert [m["name"] for m in o["most_active"]] == ["Tracole Technologies"]
    assert [q["name"] for q in o["gone_quiet"]] == ["Old Mills"]
    assert o["usd_inr"] == 84.0


def test_the_overview_can_include_test_workspaces_and_reads_the_rate(d):
    from routers.admin_overview import admin_overview
    _seed_overview(d)
    d.platform_config.docs.append({"key": "runtime", "value": {"usd_inr": 86.5}})
    o = run(admin_overview(include_test=True, admin=SUPER))
    assert o["workspaces"] == {"total": 4, "test_hidden": 0}
    assert o["last_7_days"]["ai_cost_usd"]["now"] == 9.5
    assert o["usd_inr"] == 86.5


# --- invite links ---------------------------------------------------------------------------
def _invite(email="new@decisionos.test", role="support"):
    from routers.admin_rbac import invite_admin, AdminInviteInput
    return run(invite_admin(AdminInviteInput(email=email, name="New Person", role=role), admin=SUPER))


def _token(out):
    return out["invite_path"].rsplit("/", 1)[1]


def test_an_invite_stores_only_the_hash_and_shows_as_pending(d):
    out = _invite()
    raw = _token(out)
    assert out["invite_path"] == f"/admin/invite/{raw}" and len(raw) >= 40
    assert out["admin"]["pending"] is True and out["admin"]["invite_expires_at"]
    (row,) = d.platform_admins.docs
    assert raw not in str(row) and "password_hash" not in row
    assert d.platform_audit.docs[-1]["action"] == "admin_invite"


def test_an_invite_refuses_duplicates_and_unknown_roles(d):
    _invite()
    with pytest.raises(HTTPException) as e:
        _invite()
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        _invite(email="other@decisionos.test", role="owner")
    assert e.value.status_code == 422


def test_opening_and_accepting_an_invite(d):
    from routers.admin_invites import view_admin_invite, accept_admin_invite, AcceptInput
    from core import verify_password
    raw = _token(_invite())
    seen = run(view_admin_invite(raw))
    assert seen == {"valid": True, "email": "new@decisionos.test", "name": "New Person", "role": "support"}
    with pytest.raises(HTTPException) as e:
        run(accept_admin_invite(raw, AcceptInput(password="short")))
    assert e.value.status_code == 422
    assert run(accept_admin_invite(raw, AcceptInput(password="a long password 1")))["status"] == "ok"
    (row,) = d.platform_admins.docs
    assert verify_password("a long password 1", row["password_hash"]) and "invite" not in row
    assert d.platform_audit.docs[-1]["action"] == "admin_invite_accepted"
    # The link works once.
    assert run(view_admin_invite(raw)) == {"valid": False}
    with pytest.raises(HTTPException) as e:
        run(accept_admin_invite(raw, AcceptInput(password="another long one 2")))
    assert e.value.status_code == 410
    # And now they can sign in.
    assert _login("new@decisionos.test", "a long password 1").get("requires_2fa") is not True


def test_an_expired_or_deactivated_invite_does_not_open(d):
    from routers.admin_invites import view_admin_invite
    raw = _token(_invite())
    d.platform_admins.docs[0]["invite"]["expires_at"] = _iso(-1)
    assert run(view_admin_invite(raw)) == {"valid": False}
    d.platform_admins.docs[0]["invite"]["expires_at"] = _iso(3)
    d.platform_admins.docs[0]["active"] = False
    assert run(view_admin_invite(raw)) == {"valid": False}
    assert run(view_admin_invite("too-short")) == {"valid": False}


def test_a_new_link_replaces_the_old_one(d):
    from routers.admin_invites import view_admin_invite
    from routers.admin_rbac import reissue_admin_invite
    out = _invite()
    old = _token(out)
    new = _token(run(reissue_admin_invite(out["admin"]["id"], admin=SUPER)))
    assert old != new
    assert run(view_admin_invite(old)) == {"valid": False}
    assert run(view_admin_invite(new))["valid"] is True


def test_no_new_link_once_a_password_is_set(d):
    from routers.admin_rbac import reissue_admin_invite
    d.platform_admins.docs.append({"id": "a9", "email": "set@decisionos.test", "password_hash": "h"})
    with pytest.raises(HTTPException) as e:
        run(reissue_admin_invite("a9", admin=SUPER))
    assert e.value.status_code == 409


# --- the rest of the console's reads ---------------------------------------------------------
def test_ai_usage_can_leave_test_workspaces_out(d, monkeypatch):
    from routers.admin import admin_usage
    d.tenants.docs += [{"id": "c1", "company_name": "Tracole Technologies"},
                       {"id": "x1", "company_name": "TEST_Co_9"}]
    d.usage_events.docs += [
        {"tenant_id": "c1", "provider": "anthropic", "created_at": _iso(-1), "cost_estimate": 0.5,
         "tokens_total": 100, "tokens_in": 60, "tokens_out": 40},
        {"tenant_id": "x1", "provider": "anthropic", "created_at": _iso(-1), "cost_estimate": 9.0,
         "tokens_total": 900, "tokens_in": 600, "tokens_out": 300},
    ]
    everything = run(admin_usage(admin=SUPER, range="30d", provider="all", include_test=True))
    customers = run(admin_usage(admin=SUPER, range="30d", provider="all", include_test=False))
    assert everything["totals"]["cost"] == 9.5
    assert customers["totals"]["cost"] == 0.5
    assert [w["tenant_name"] for w in customers["workspaces"]] == ["Tracole Technologies"]
    assert customers["by_provider"][0]["cost_estimate"] == 0.5
    assert customers["usd_inr"] == 84.0


def test_the_workspace_page_knows_a_test_workspace(d, monkeypatch):
    import routers.admin_tenant360 as t360
    monkeypatch.setattr(t360, "db", d)
    d.tenants.docs.append({"id": "x1", "company_name": "QA Owner's workspace", "plan": "trial",
                           "trial_ends_at": _iso(5)})
    out = run(t360.admin_tenant_360("x1", admin=SUPER))
    assert out["tenant"]["is_test"] is True and out["tenant"]["test_reason"] == "Name looks like a test"
    assert out["tenant"]["trial_ends_at"] and out["usd_inr"] == 84.0


def test_find_treats_what_is_typed_as_text(d, monkeypatch):
    import routers.admin_tenant360 as t360
    monkeypatch.setattr(t360, "db", d)
    d.tenants.docs += [{"id": "t1", "company_name": "A+B Traders"}, {"id": "t2", "company_name": "AAB Traders"}]
    out = run(t360.admin_search(q="A+B", admin=SUPER))
    assert [t["name"] for t in out["tenants"]] == ["A+B Traders"]
    assert run(t360.admin_search(q="((", admin=SUPER))["tenants"] == []


def test_only_a_super_admin_can_delete_a_workspace():
    import inspect
    from routers.admin import admin_delete_tenant
    dep = inspect.signature(admin_delete_tenant).parameters["admin"].default
    with pytest.raises(HTTPException) as e:
        run(dep.dependency(admin={"id": "a", "role": "support"}))
    assert e.value.status_code == 403


# --- backup codes for admins ------------------------------------------------------------------
def _admin_with_2fa(d):
    import pyotp
    from core import hash_password
    from services.auth import totp
    codes = ["ABCDE-FGHIJ", "KLMNO-PQRST"]
    secret = pyotp.random_base32()
    d.platform_admins.docs.append({
        "id": "a5", "email": "safe@decisionos.test", "active": True, "role": "support",
        "password_hash": hash_password("a long password 1"),
        "two_factor": {"enabled_secret": secret, "enabled_at": _iso(-1),
                       "backup_codes": [totp._hash_code(c) for c in codes]},
    })
    return secret, codes


def test_an_admin_can_sign_in_with_a_backup_code_once(d):
    _, codes = _admin_with_2fa(d)
    assert _login("safe@decisionos.test", "a long password 1") == {"requires_2fa": True}
    out = _login("safe@decisionos.test", "a long password 1", code=codes[0].lower())
    assert out.get("requires_2fa") is not True
    with pytest.raises(HTTPException) as e:
        _login("safe@decisionos.test", "a long password 1", code=codes[0])
    assert e.value.status_code == 401


def test_an_admin_can_turn_off_two_step_with_a_backup_code(d):
    from routers.admin_rbac import twofa_disable, CodeInput
    _, codes = _admin_with_2fa(d)
    me = {"id": "a5", "email": "safe@decisionos.test", "role": "support"}
    with pytest.raises(HTTPException) as e:
        run(twofa_disable(CodeInput(code="WRONG-CODE"), admin=me))
    assert e.value.status_code == 400
    assert run(twofa_disable(CodeInput(code=codes[1]), admin=me)) == {"status": "ok", "enabled": False}
    assert "two_factor" not in d.platform_admins.docs[0]

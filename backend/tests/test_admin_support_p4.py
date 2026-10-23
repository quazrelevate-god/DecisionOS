"""Epic 11 Sprint 7 — admin console v2, P4: support (2026-10-23).

  * the outbound message log: every email / SMS / WhatsApp / push we try to
    send is one row — channel, kind, company, masked recipient, sent / failed /
    skipped, never the body; OTP scopes are not companies;
  * support tickets carry a first-reply clock: stamped on our first reply,
    resolved_at on resolve, cleared when the ticket opens again; the inbox shows
    each ticket against its target and how many are past it;
  * the recommend card (NPS) is off until the global flag is on, waits for a
    workspace's first 14 days, asks once per 90 days; the console scores it.

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


@pytest.fixture
def d(monkeypatch):
    fake = FakeDB()
    import core.outbound as outbound
    import routers.admin as admin
    import routers.admin_support as admin_support
    import routers.support as support
    import routers.admin_messages as messages
    import routers.nps as nps
    import services.platform_config as pc
    for mod, name in ((outbound, "_core_db"), (admin, "db"), (admin_support, "db"), (support, "db"),
                      (messages, "db"), (nps, "db"), (pc, "db")):
        monkeypatch.setattr(mod, name, fake)
    monkeypatch.setattr(outbound, "_enabled", lambda: True)
    return fake


# --- the outbound log ---------------------------------------------------------------------
def test_recipients_are_masked_and_otp_scopes_are_not_companies():
    from core.outbound import mask, real_tenant
    assert mask("priya@acme.in") == "pr***@acme.in"
    assert mask("9876543210") == "******3210"
    assert mask("") == ""
    for scope in ("login:any", "__signup__", "profile:u1", None, ""):
        assert real_tenant(scope) is None
    assert real_tenant("t-123") == "t-123"


def test_logging_is_off_in_tests_unless_a_database_is_given(monkeypatch):
    import core.outbound as outbound
    fake = FakeDB()
    monkeypatch.setattr(outbound, "_core_db", fake)
    run(outbound.record("email", "invite", status="sent", to="a@b.co"))
    assert run(fake.outbound_messages.count_documents({})) == 0, "pytest never fills the shared database"
    run(outbound.record("email", "invite", status="sent", to=["a@b.co", "c@d.co"], tenant_id="t1", database=fake))
    row = run(fake.outbound_messages.find_one({}))
    assert row["to"] == "a***@b.co" and row["count"] == 2 and row["tenant_id"] == "t1"
    assert "html" not in row and "body" not in row and "subject" not in row, "never the message itself"


def test_an_email_with_no_provider_is_logged_as_skipped_with_its_kind(d, monkeypatch):
    import integrations.email as email
    monkeypatch.setattr(email, "mock_for", lambda *a: None)
    monkeypatch.setattr(email, "SMTP_ENABLED", False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    res = run(email.send_email("owner@acme.in", "You're invited", "<p>hi</p>", kind="invite",
                               tenant_id="t1", user_id="u1"))
    assert res["mocked"] is True
    row = run(d.outbound_messages.find_one({}))
    assert (row["channel"], row["kind"], row["status"], row["tenant_id"], row["user_id"]) == \
        ("email", "invite", "skipped", "t1", "u1")


def test_a_failed_smtp_send_is_logged_as_failed(d, monkeypatch):
    import integrations.email as email
    monkeypatch.setattr(email, "mock_for", lambda *a: None)
    monkeypatch.setattr(email, "SMTP_ENABLED", True)

    def boom(*a, **k):
        raise RuntimeError("down")
    monkeypatch.setattr(email, "with_retry", boom)
    res = run(email.send_email("x@y.in", "s", "<p/>", kind="password_reset"))
    assert res["sent"] is False
    row = run(d.outbound_messages.find_one({}))
    assert row["status"] == "failed" and row["error"] == "smtp_error" and row["kind"] == "password_reset"


def test_a_sign_in_code_logs_an_sms_and_drops_placeholder_scopes(d, monkeypatch):
    import services.otp as otp

    async def no_apm(norm):
        return None

    async def no_sms(phone, code):
        return False
    monkeypatch.setattr(otp, "db", d)
    monkeypatch.setattr(otp, "_apm_send_and_fetch_otp", no_apm)
    monkeypatch.setattr(otp, "_send_otp_sms", no_sms)
    monkeypatch.setattr(otp, "TWILIO_ENABLED", False)
    run(otp._issue_otp("9876543210", "98765 43210", "t1", enforce_cooldown=False))
    run(otp._issue_otp("9876500000", "98765 00000", "login:any", enforce_cooldown=False))
    rows = run(d.outbound_messages.find({}).to_list(10))
    assert {(r["channel"], r["kind"], r["status"]) for r in rows} == {("sms", "sign_in_code", "skipped")}
    assert sorted(str(r["tenant_id"]) for r in rows) == ["None", "t1"]
    assert all(r["to"].startswith("******") for r in rows)


def test_push_without_firebase_is_logged_as_skipped(d, monkeypatch):
    import services.push_fcm as push
    monkeypatch.setattr(push, "_init", lambda: False)
    run(push.send_push_to_users("t1", ["u1"], "Task assigned", "Do it", {"type": "task_assigned"}))
    row = run(d.outbound_messages.find_one({}))
    assert (row["channel"], row["kind"], row["status"], row["user_id"]) == ("push", "task_assigned", "skipped", "u1")


def test_the_console_lists_messages_with_names_and_a_week_tally(d):
    from routers.admin_messages import messages
    import core.outbound as outbound
    run(d.tenants.insert_one({"id": "t1", "name": "Acme"}))
    run(d.users.insert_one({"id": "u1", "name": "Priya", "tenant_id": "t1"}))
    run(outbound.record("email", "invite", status="sent", to="p@acme.in", tenant_id="t1", user_id="u1"))
    run(outbound.record("email", "invite", status="failed", to="q@acme.in", tenant_id="t1", error="smtp_error"))
    run(outbound.record("sms", "sign_in_code", status="sent", to="9876543210", tenant_id="t2"))
    out = run(messages(admin=SUPER, tenant_id="t1", channel=None, status=None, limit=100))
    assert len(out["messages"]) == 2 and out["messages"][0]["tenant_name"] == "Acme"
    assert {m.get("user_name") for m in out["messages"]} == {"Priya", None}
    assert out["week"]["email"] == {"sent": 1, "failed": 1, "skipped": 0}
    assert out["week"]["sms"]["sent"] == 0, "scoped to the company asked for"
    assert out["failing"] == [{"channel": "email", "kind": "invite", "count": 1}]
    only_failed = run(messages(admin=SUPER, tenant_id=None, channel="email", status="failed", limit=100))
    assert [m["to"] for m in only_failed["messages"]] == ["q***@acme.in"]


# --- the first-reply clock ---------------------------------------------------------------
def test_sla_states():
    from routers.admin_support import sla_of
    now = datetime.now(timezone.utc)
    t = lambda **kw: {"priority": "urgent", "status": "open", "created_by_type": "tenant", **kw}  # noqa: E731
    assert sla_of(t(created_at=iso(hours=-1)), now)["state"] == "waiting"
    assert sla_of(t(created_at=iso(hours=-3, minutes=-30)), now)["state"] == "due_soon"
    s = sla_of(t(created_at=iso(hours=-6)), now)
    assert s["state"] == "breached" and s["over_hours"] == pytest.approx(2, abs=0.1)
    assert sla_of(t(created_at=iso(hours=-6), first_response_at=iso(hours=-5)), now)["state"] == "met"
    assert sla_of(t(created_at=iso(hours=-9), first_response_at=iso(hours=-1)), now)["state"] == "late"
    assert sla_of(t(created_at=iso(hours=-9), created_by_type="admin"), now)["state"] == "none"
    assert sla_of(t(created_at=iso(hours=-9), status="closed"), now)["state"] == "none"
    assert sla_of(t(priority="low", created_at=iso(hours=-30)), now)["state"] == "waiting", "low gets 72h"


def _ticket(d, tid="k1", **kw):
    doc = {"id": tid, "tenant_id": "t1", "tenant_name": "Acme", "subject": "Help", "status": "open",
           "priority": "normal", "created_by_type": "tenant", "created_at": iso(hours=-30),
           "updated_at": iso(hours=-30), "messages": [], **kw}
    run(d.support_tickets.insert_one(doc))


def test_our_first_reply_stops_the_clock_once(d):
    from routers.admin_support import admin_ticket_reply, TicketReplyInput
    _ticket(d)
    run(admin_ticket_reply("k1", TicketReplyInput(body="On it"), admin=SUPER))
    first = run(d.support_tickets.find_one({"id": "k1"}))["first_response_at"]
    assert first
    run(admin_ticket_reply("k1", TicketReplyInput(body="Done?"), admin=SUPER))
    assert run(d.support_tickets.find_one({"id": "k1"}))["first_response_at"] == first, "only the first reply counts"


def test_resolving_stamps_resolved_at_and_reopening_clears_it(d):
    from routers.admin_support import admin_ticket_patch, TicketPatchInput
    from routers.support import reply_ticket, SupportReplyInput
    _ticket(d)
    run(admin_ticket_patch("k1", TicketPatchInput(status="resolved"), admin=SUPER))
    assert run(d.support_tickets.find_one({"id": "k1"})).get("resolved_at")
    run(reply_ticket("k1", SupportReplyInput(body="Still broken"), user={"id": "u1", "tenant_id": "t1", "name": "P"}))
    t = run(d.support_tickets.find_one({"id": "k1"}))
    assert t["status"] == "open" and not t.get("resolved_at"), "the customer replying opens it again"
    run(admin_ticket_patch("k1", TicketPatchInput(status="closed"), admin=SUPER))
    run(admin_ticket_patch("k1", TicketPatchInput(status="pending"), admin=SUPER))
    assert not run(d.support_tickets.find_one({"id": "k1"})).get("resolved_at")


def test_the_inbox_shows_the_clock_and_how_many_are_past_it(d):
    from routers.admin_support import admin_tickets
    _ticket(d, "late", priority="urgent", created_at=iso(hours=-10))
    _ticket(d, "fine", priority="low", created_at=iso(hours=-2))
    _ticket(d, "met", priority="high", created_at=iso(hours=-20), first_response_at=iso(hours=-19), status="pending")
    out = run(admin_tickets(admin=SUPER, status=None, priority=None, tenant_id=None, limit=100))
    by = {t["id"]: t["sla"]["state"] for t in out["tickets"]}
    assert by == {"late": "breached", "fine": "waiting", "met": "met"}
    assert out["sla"]["breached"] == 1 and out["sla"]["met_pct"] == 100
    assert out["sla"]["median_first_reply_hours"] == pytest.approx(1, abs=0.1)
    assert out["sla"]["targets"]["urgent"] == 4


# --- the recommend card -------------------------------------------------------------------
USER = {"id": "u1", "tenant_id": "t1", "role": "owner"}


def test_the_recommend_card_is_off_until_the_flag_is_on(d):
    from routers.nps import ask, answer, NpsInput
    run(d.tenants.insert_one({"id": "t1", "created_at": iso(days=-60)}))
    assert run(ask(user=USER)) == {"ask": False}
    with pytest.raises(HTTPException) as e:
        run(answer(NpsInput(score=9), user=USER))
    assert e.value.status_code == 404


def test_the_card_waits_two_weeks_and_asks_once_per_quarter(d):
    from routers.nps import ask, answer, NpsInput
    import services.platform_config as pc
    run(pc.set(pc.K_FLAGS, {"nps": True}))
    run(d.tenants.insert_one({"id": "t1", "created_at": iso(days=-5)}))
    assert run(ask(user=USER)) == {"ask": False}, "not in the first 14 days"
    run(d.tenants.update_one({"id": "t1"}, {"$set": {"created_at": iso(days=-60)}}))
    assert run(ask(user=USER)) == {"ask": True}
    with pytest.raises(HTTPException):
        run(answer(NpsInput(score=11), user=USER))
    run(answer(NpsInput(dismissed=True), user=USER))
    assert run(ask(user=USER)) == {"ask": False}, "a dismissal counts as an answer"


def test_the_console_scores_promoters_minus_detractors(d):
    from routers.admin_messages import nps
    import services.platform_config as pc
    run(pc.set(pc.K_FLAGS, {"nps": True}))
    run(d.tenants.insert_one({"id": "t1", "name": "Acme"}))
    for i, s in enumerate([10, 9, 8, 3]):
        run(d.nps_responses.insert_one({"id": f"n{i}", "tenant_id": "t1", "user_id": f"u{i}", "score": s,
                                        "comment": "Love it" if s == 10 else "", "dismissed": False,
                                        "created_at": iso(days=-i)}))
    run(d.nps_responses.insert_one({"id": "nx", "tenant_id": "t1", "user_id": "u9", "score": None,
                                    "dismissed": True, "created_at": iso(days=-1)}))
    out = run(nps(admin=SUPER, days=90))
    assert (out["promoters"], out["passives"], out["detractors"], out["responses"]) == (2, 1, 1, 4)
    assert out["score"] == 25 and out["dismissed"] == 1 and out["enabled"] is True
    assert [c["comment"] for c in out["comments"]] == ["Love it"] and out["comments"][0]["tenant_name"] == "Acme"

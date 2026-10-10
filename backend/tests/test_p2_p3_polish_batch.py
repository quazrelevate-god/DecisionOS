"""Audit 2026-10-09: the rest of P2 and all of P3.

P2  A-02 browser Back walks back through sign-up; A-15 the interview language is
    for the interview only -- the app opens in English (founder); C-07 a
    contact's trading terms (country, currency, payment terms, credit limit,
    people) and its money in its own currency; G-02 the Ops score does not
    punish a new company, "Sales" is "Decisions", and a low score names what to
    do first.
P3  A-05 a reserved-domain email is told so; A-06 "code" everywhere and tries
    left (in services.otp, tested in test_s6_invite_otp.py); A-07 the login
    footer is a promise, not our parts; A-13 department chips wrap; A-14 "Why we
    ask" speaks to the founder; A-17 no sample names on the Desk; B-11 "team",
    not "role", and no two teams with one name; C-03 Reports-to matches the
    tree, and the dots have a legend; C-04 an optional invite email, and whose
    email it is; C-08 the company's own words in CRM and a visible Delete; C-16
    note tags as words; C-19 a pending assignee is said, and the empty title;
    F-06 no AI brief over nothing, one ask box, plain digits, plurals.
A-04 (India-only mobile) is closed by the founder's call; B-07 stays with the
WhatsApp backlog; G-04 is next phase.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def run(c):
    return asyncio.run(c)


def fe(rel):
    return (FE / rel).read_text(encoding="utf-8")


def be(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


# ---- A-02 ---------------------------------------------------------------------
def test_browser_back_is_the_page_back():
    s = fe("pages/Signup.js")
    assert "window.addEventListener(\"popstate\", onPop);" in s
    assert "new Event(SIGNUP_BACK, { cancelable: true })" in s
    assert 'if (phase === "build") { return true; }' in s, "the finished review never loses the interview"
    assert "if (!window.history.state?.dosSignupStep) guard();" in s
    assert "useSignupBack(" in fe("pages/onboarding/BasicsFlow.js")
    assert "useSignupBack(" in fe("pages/onboarding/VoiceInterview.js")


# ---- A-15 ---------------------------------------------------------------------
def test_the_app_opens_in_english_whatever_the_interview_language():
    assert '"language": "en",' in be("routers/auth.py")
    assert "This is only for the interview. DecisionOS itself opens in English." in fe("pages/onboarding/VoiceInterview.js")


# ---- C-07 ---------------------------------------------------------------------
def test_trading_terms_are_cleaned():
    from routers.contacts import trading_terms
    out = trading_terms({"country": " United Kingdom ", "currency": "gbp", "payment_terms_days": 60,
                         "credit_limit": 5000.0,
                         "contact_people": [{"name": "Ann", "role": "Accounts"}, {"name": "  "}]})
    assert out == {"country": "United Kingdom", "currency": "GBP", "payment_terms_days": 60, "credit_limit": 5000.0,
                   "contact_people": [{"name": "Ann", "role": "Accounts", "phone": "", "email": ""}]}
    with pytest.raises(HTTPException):
        trading_terms({"currency": "pounds"})
    assert trading_terms({"country": "India"}, partial=True) == {"country": "India"}, "only what was sent"


def test_a_uk_buyers_page_is_in_pounds(monkeypatch):
    import routers.finance as fin
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "currency": "INR"})
    d.contacts.docs.append({"id": "c1", "tenant_id": "t1", "type": "customer", "name": "Northwind Apparel",
                            "currency": "GBP", "credit_limit": 1000})
    d.invoices.docs.append({"id": "i1", "tenant_id": "t1", "contact_id": "c1", "contact_name": "Northwind Apparel",
                            "type": "sales_invoice", "amount": 1500, "currency": "GBP", "fx_rate": 105,
                            "created_at": "1"})
    d.payments.docs.append({"id": "p1", "tenant_id": "t1", "contact_id": "c1", "amount": 200, "currency": "GBP",
                            "direction": "in", "created_at": "1"})
    monkeypatch.setattr(fin, "db", d)
    out = run(fin.contact_profile("c1", {"id": "o", "tenant_id": "t1", "role": "owner"}))
    s = out["summary"]
    assert (s["currency"], s["total_billed"], s["total_paid"], s["outstanding"]) == ("GBP", 1500, 200, 1300)
    assert s["over_credit_limit"] is True


def test_an_invoice_takes_the_buyers_currency_and_terms():
    src = be("routers/invoicing.py")
    assert 'currency = (inp.currency or (buyer or {}).get("currency") or tenant.get("currency") or "INR")' in src
    assert "buyer_terms if buyer_terms is not None else tenant.get(\"payment_terms_days\")" in src
    crm = fe("pages/CRM.js")
    for tid in ("crm-contact-country", "crm-contact-currency", "crm-contact-terms", "crm-contact-credit",
                "crm-contact-people", "crm-person-add"):
        assert tid in crm
    assert "const cur = summary?.currency || tenant?.currency" in fe("pages/ContactProfile.js")


# ---- G-02 ---------------------------------------------------------------------
def test_ops_scores_only_money_that_is_due_and_names_the_weakest():
    src = be("services/operating_score.py")
    assert "if can_finance and due_billed:" in src
    assert '"invoices": inv_count,' in src
    op = fe("pages/OperatingScore.js")
    assert '{ key: "sales", label: "Decisions"' in op
    assert "const hasInvoices = (stats?.invoices || 0) > 0;" in op
    ks = fe("lib/karmaScore.js")
    assert 'sales: { name: "Decisions", to: "/inbox"' in ks and "to: area.to," in ks


# ---- A-05 / A-07 / A-13 / A-14 ---------------------------------------------------
def test_sign_in_and_sign_up_wording():
    assert "That email address can't receive mail — use one you check." in fe("lib/api.js")
    login = fe("pages/Login.js")
    assert "Workflow as an engine · Decision Desk · Dex" not in login
    assert "Your team&rsquo;s work and decisions, in one place" in login
    assert '"Send OTP"' not in login and "Resend OTP" not in login and "> Mobile OTP" not in login
    assert '<div className="flex flex-wrap items-start gap-2">' in fe("pages/onboarding/BuildReveal.js")
    from prompts import render
    assert 'said TO the founder as "you"' in render("onboarding.interview", min_questions=3, max_questions=8)


# ---- A-17 ---------------------------------------------------------------------
def test_no_sample_people_on_the_desk():
    desk = fe("pages/Desk.js")
    assert "Tell Suresh to ship the indigo lot" not in desk
    assert "`Ask ${team} to send the revised quote by Friday`" in desk
    chips = fe("components/mobile/DexSheet.jsx")
    for name in ("Suresh", "Give Priya", "Anita's", "Krishna Garments"):
        assert name not in chips.split("const CHIPS = {")[1].split("export function chipsFor")[0]


# ---- B-11 ---------------------------------------------------------------------
def _teams_db():
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": [{"key": "production", "label": "Production"},
                                                 {"key": "sales", "label": "Sales"}]})
    return d


def test_team_names_are_unique_and_said_as_teams(monkeypatch):
    import routers.tenant_settings as ts
    from models.tenant import RoleLabelInput
    d = _teams_db()
    monkeypatch.setattr(ts, "db", d)

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(ts, "log_activity", _noop)
    owner = {"id": "o", "tenant_id": "t1", "role": "owner", "name": "Meera"}
    with pytest.raises(HTTPException) as e:
        run(ts.add_role(RoleLabelInput(label="production"), owner))
    assert e.value.detail == "There's already a Production team."
    with pytest.raises(HTTPException) as e:
        run(ts.rename_role("sales", RoleLabelInput(label="Production"), owner))
    assert e.value.detail == "There's already a Production team.", "rename is checked too"
    run(ts.rename_role("sales", RoleLabelInput(label="Sales & Exports"), owner))
    assert {r["label"] for r in d.tenants.docs[0]["roles"]} == {"Production", "Sales & Exports"}
    with pytest.raises(HTTPException) as e:
        run(ts.rename_role("gone", RoleLabelInput(label="X"), owner))
    assert e.value.detail == ts.TEAM_GONE
    assert "A role with this name" not in be("routers/tenant_settings.py")


# ---- C-03 / C-04 ----------------------------------------------------------------
def test_reports_to_and_the_dot_legend():
    team = fe("pages/Team.js")
    assert "`${ownerAbove.name} (owner) — no manager set`" in team
    assert 'data-testid="team-status-legend"' in team


def test_invite_email_and_whose_email(monkeypatch):
    from services.auth.auth_emails import render_invite_email
    html = render_invite_email("<Selvi>", "Audit Textiles", "Meera", "https://app/login?invite=x")
    assert "&lt;Selvi&gt;" in html and "Audit Textiles" in html and "https://app/login?invite=x" in html
    src = be("routers/team.py")
    assert "That email is already {_taken.get('name')}'s in this workspace." in src
    assert "if inp.email_invite and email:" in src
    assert 'data-testid="member-email-invite-toggle"' in fe("pages/Team.js")


# ---- C-08 / C-16 / C-19 -----------------------------------------------------------
def test_crm_words_note_tags_and_task_hints():
    prof = fe("pages/ContactProfile.js")
    assert "<Chip value={typeLabels[c.type] || typeLabel(c.type)}" in prof
    assert 'data-testid="profile-delete"' in prof
    assert "a {{customer}}, a partner or a {{vendor}}." in fe("i18n.js")
    assert "export function noteTag(tag)" in fe("lib/format.js")
    assert "sub: n.tag ? `About: ${noteTag(n.tag)}`" in fe("components/DecisionDialog.js")
    tasks = fe("pages/Tasks.js")
    assert 'data-testid="task-assignee-pending-hint"' in tasks and " · not joined yet" in tasks


# ---- F-06 ---------------------------------------------------------------------
def test_no_ai_brief_over_an_empty_company(monkeypatch):
    import routers.ledger as led
    called = []
    monkeypatch.setattr(led, "claude_chat", lambda *a, **k: called.append(1))
    ctx = {"currency": "INR", "today": "2026-10-09", "totals": {
        "expense_count": 0, "asset_count": 0, "inventory_count": 0, "sales_count": 0, "open_bill_count": 0,
        "revenue_billed": 0, "total_spend": 0}}
    out = run(led._generate_analysis("t1", "brief", ctx=ctx))
    assert out["empty"] is True and not called
    assert not led._no_finance_records({"totals": {"sales_count": 1}})


def test_finance_page_polish():
    assert "finance-ask" not in fe("pages/Ledger.js"), "one ask box: the AI panel's"
    ov = fe("pages/finance/FinanceOverview.jsx")
    assert "​" not in ov.lower() and "\\u200B" not in ov
    assert "<wbr />" in ov
    assert 'toast.success(said.length ? `Filed ${said.join(" · ")}` : "Filed");' in fe("pages/finance/ReviewPanel.js")


# G-02, run for real: an invoice not yet due is not scored; one past due is.
def _ops_with(invoice_due):
    from tests.e2e_harness import e2e_env
    T = "t-g02"
    owner = {"id": "u-o", "tenant_id": T, "role": "owner", "name": "Meera", "permissions": []}

    async def scenario(db):
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Kongu Knits", "currency": "INR"})
            await db.users.insert_one({"id": "u-o", "tenant_id": T, "name": "Meera", "role": "owner"})
            await db.invoices.insert_one({"id": "i1", "tenant_id": T, "type": "sales_invoice", "amount": 50000,
                                          "status": "unpaid", "due_date": invoice_due})
            import routers.operating_score as r
            return await r.operating_score(user_id=None, window=None, user=owner)
    return scenario


def test_g02_a_first_invoice_not_yet_due_is_not_a_zero(with_test_db):
    later = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    out = with_test_db(_ops_with(later))
    assert out["company"]["categories"]["finance"] is None
    assert out["company"]["unscored"]["finance"] == "no_data"
    assert out["stats"]["invoices"] == 1


def test_g02_money_past_due_and_not_in_is_scored(with_test_db):
    earlier = (datetime.now(timezone.utc) - timedelta(days=10)).date().isoformat()
    out = with_test_db(_ops_with(earlier))
    assert out["company"]["categories"]["finance"] == 0

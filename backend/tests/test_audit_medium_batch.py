"""Audit 2026-10-08, the medium batch (fixed 2026-10-09).

A-10  Reloading the sign-up at interview question 3 restarted the interview at
      question 1; the answers were on the server and nothing asked for them.
B-12  Invoices: no default payment terms, no default GST rate, no logo.
C-09  Moving a card took seconds and the button said nothing while it ran.
D-03  The invite link's start call returned the invitee's FULL number to
      whoever held the link (the link is forwarded on WhatsApp).
(A-03, C-05, C-06, C-13 and F-05 have their own files.)
Each was checked in the browser on the scratch database on 2026-10-09.
"""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def _src(rel):
    return (FE / rel).read_text(encoding="utf-8")


async def _noop(*a, **k):
    return None


class _Req:
    headers = {}


# ---- A-10 ---------------------------------------------------------------------
@pytest.fixture
def signup(monkeypatch):
    import routers.signup as su
    d = FakeDB()
    d.signup_sessions.docs.append({"id": "s-live", "qa": [{"q": "q1", "a": "a1"}, {"q": "q2", "a": "a2"}],
                                   "pending_q": "Who checks the cloth?", "pending_why": "quality",
                                   "language_code": "en-IN", "status": "active"})
    d.signup_sessions.docs.append({"id": "s-done", "qa": [{"q": "q", "a": "a"}] * 4, "pending_q": None,
                                   "language_code": "ta-IN", "status": "done"})
    monkeypatch.setattr(su, "db", d)
    monkeypatch.setattr(su, "_guard_signup_endpoint", _noop)
    return su


def test_an_interview_under_way_is_picked_up_at_its_question(signup):
    r = asyncio.run(signup.interview_state("s-live", _Req()))
    assert r == {"session_id": "s-live", "complete": False, "done": False, "question": "Who checks the cloth?",
                 "why": "quality", "index": 3, "max": signup.MAX_QUESTIONS, "language_code": "en-IN"}
    assert "qa" not in r, "the answers themselves are not handed back"


def test_a_finished_interview_says_so(signup):
    r = asyncio.run(signup.interview_state("s-done", _Req()))
    assert r["complete"] is True and r["language_code"] == "ta-IN"


def test_an_unknown_interview_is_a_404(signup):
    with pytest.raises(HTTPException) as e:
        asyncio.run(signup.interview_state("nope", _Req()))
    assert e.value.status_code == 404


def test_the_page_saves_the_interview_and_resumes_it():
    v = _src("pages/onboarding/VoiceInterview.js")
    assert "api.get(`/signup/interview/${resumeSession}`)" in v
    assert "onSession?.(data.session_id, code);" in v
    s = _src("pages/Signup.js")
    assert "resumeSession={sessionId}" in s
    assert 'saveStep("progress", { phase: "interview", session_id: sid' in s


# ---- B-12 ---------------------------------------------------------------------
def test_payment_terms_set_the_due_date():
    from routers.invoicing import _terms_due
    assert _terms_due("2026-10-08", 30) == "2026-11-07"
    assert _terms_due("2026-10-08", 0) == "2026-10-08"
    assert _terms_due("2026-10-08", None) == ""
    assert _terms_due("not a date", 30) == ""


def test_a_logo_must_be_a_real_png_or_jpg():
    import base64
    from routers.tenant_settings import _decode_logo
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 20
    assert _decode_logo("data:image/png;base64," + base64.b64encode(png).decode())[0] == "image/png"
    for bad in ("data:image/gif;base64,R0lGOD", "data:image/png;base64," + base64.b64encode(b"<svg/>").decode(),
                "data:image/png;base64," + base64.b64encode(b"\x89PNG" + b"0" * 260_000).decode()):
        with pytest.raises(HTTPException):
            _decode_logo(bad)


def test_the_invoice_pdf_draws_the_logo():
    import base64
    from services.invoicing import invoice_pdf
    # a 1x1 PNG
    px = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
    inv = {"number": "CT/26-27/001", "date": "2026-10-08", "contact_name": "Buyer", "amount": 1050,
           "line_items": [{"description": "Cloth", "qty": 1, "rate": 1000, "taxable": 1000, "gst_rate": 5,
                           "tax": 50, "amount": 1050}], "tax_total": 50, "cgst": 25, "sgst": 25}
    with_logo = invoice_pdf(inv, {"name": "Clickthrough Mills", "logo_bytes": px})
    without = invoice_pdf(inv, {"name": "Clickthrough Mills"})
    assert b"/Subtype /Image" in with_logo and b"/Subtype /Image" not in without


def test_the_builder_and_settings_use_the_defaults():
    m = _src("pages/finance/MoneyActions.jsx")
    assert "meta.payment_terms_days" in m and "meta?.default_gst_rate" in m
    c = _src("components/CompanyDetails.js")
    for tid in ("company-field-payment_terms_days", "company-field-default_gst_rate",
                "company-next-invoice-number", "company-invoice-logo-input"):
        assert tid in c


# ---- C-09 ---------------------------------------------------------------------
def test_a_moving_card_says_so():
    s = _src("pages/Workflows.js")
    assert "Moving to {labelOf(nextKey)}…" in s
    assert "advance-workflow-busy-${w.id}" in s


# ---- D-03 ---------------------------------------------------------------------
def test_the_invite_start_returns_only_the_masked_number():
    src = (ROOT / "routers" / "auth_otp.py").read_text(encoding="utf-8")
    start = src.split("async def invite_start")[1].split("@router")[0]
    assert 'resp.pop("phone", None)' in start and 'resp["phone_masked"] = _mask_phone(phone)' in start
    assert 'resp["phone"] = phone' not in start
    assert "start.data.phone_masked" in _src("pages/Login.js")

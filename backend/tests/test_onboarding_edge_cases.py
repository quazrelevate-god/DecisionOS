"""Onboarding edge cases, 2026-10-08 (found by walking them in the browser).

1. A correct code typed by hand was refused ("Incorrect OTP"):
   a. the sign-in page submitted on the sixth digit with the code from STATE,
      which had not caught up -- so it sent five digits;
   b. the six boxes rebuilt the code from a render-time copy, so a fast thumb
      lost digits, and an empty box closed up and shifted the rest.
2. A founder whose first press created the company (answer lost / tab closed)
   came back and was told "This email already has a workspace" -- the review
   screen's email pre-check stopped them before register, which would have
   signed them straight in. Now: no pre-check, and /signup/check-email tells
   the holder of the confirmed-mobile proof that the company is THEIRS.
3. "Sign in instead" / "Open" now land on a sign-in page with the number filled.
4. A sign-up left before the account existed: the sign-in page offers to finish
   it instead of "Start a new company".
5. The welcome screen's flag no longer survives sign-out.
"""
import asyncio
from pathlib import Path

import pytest

from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"


def _src(rel):
    return (FE / rel).read_text(encoding="utf-8")


def _run(c):
    return asyncio.run(c)


async def _noop(*a, **k):
    return None


class _Req:
    query_params = {}
    headers = {}


@pytest.fixture
def signup(monkeypatch):
    import routers.signup as su
    d = FakeDB()
    d.users.docs.append({"id": "u1", "email": "owner@lostpressknits.in", "phone_norm": "9000017321", "tenant_id": "t1"})
    d.tenants.docs.append({"id": "t1", "name": "Lost Press Knits"})
    monkeypatch.setattr(su, "db", d)
    monkeypatch.setattr(su, "_guard_signup_endpoint", _noop)
    return su


def test_check_email_says_the_company_is_yours_only_to_its_founder(signup, monkeypatch):
    from models.signup import EmailCheckInput
    import services.auth.phone_proof as pp
    monkeypatch.setattr(pp, "read_phone_proof", lambda tok: {"mine": "9000017321", "other": "9000099999"}.get(tok, ""))
    ask = lambda **k: _run(signup.check_email(EmailCheckInput(email="owner@lostpressknits.in", **k), _Req()))
    assert ask(phone_token="mine") == {"available": False, "yours": True, "company": "Lost Press Knits"}
    assert ask(phone_token="other") == {"available": False}          # someone else's number learns nothing more
    assert ask() == {"available": False}
    assert _run(signup.check_email(EmailCheckInput(email="new@x.in"), _Req())) == {"available": True}


def test_a_typed_code_is_submitted_as_typed():
    login = _src("pages/Login.js")
    assert "if (v.length === 6 && !busy) submitOtp(null, v);" in login
    assert 'const code = typeof typedCode === "string" ? typedCode : otpCode;' in login
    boxes = _src("components/auth/OtpBoxes.js")
    assert "const cellsRef = useRef(cells);" in boxes                 # every keystroke sees the latest digits
    assert "const cur = cellsRef.current;" in boxes
    assert r'replace(/\D/g, "").slice(0, 6));' not in boxes.split("const commit")[1]   # no gap-collapsing rebuild


def test_a_returning_founder_is_let_in_not_turned_away():
    reveal = _src("pages/onboarding/BuildReveal.js")
    body = reveal.split("const confirmAndRegister = async () => {")[1].split("onEnter();")[0]
    assert "/signup/check-email" not in body                          # register decides
    assert "if (data.yours) { setAlreadyMine(" in reveal and 'data-testid="build-already-created"' in reveal
    assert "phone_token: payload.phone_token" in reveal
    assert "`/login?phone=${encodeURIComponent(" in reveal              # "Sign in instead" carries the number


def test_an_unfinished_signup_is_offered_on_the_sign_in_page():
    login = _src("pages/Login.js")
    assert '{currentDraft() ? "Finish setting up your company" : "Start a new company with this number"}' in login
    assert 'data-testid="otp-unfinished-signup"' in login


def test_sign_out_takes_the_welcome_screen_with_it():
    assert 'localStorage.removeItem("dos_welcome")' in _src("context/AuthContext.js")

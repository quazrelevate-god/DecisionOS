"""Sign-in and sign-up, every control clicked, 2026-10-08 (second pass).

Walked in the browser against the scratch database; each test pins one thing
that pass found broken.

Sign-in
  1. Email & Password with an account that signed up by mobile (no password)
     crashed the server: KeyError 'password_hash' -> 500.
  2. "Change", then the same number again inside 30s: "Please wait 17s" and no
     boxes to type the code that had already arrived. (Sign-up's code step too.)
  3. Five wrong codes spend the code, but Resend stayed behind its countdown.
     (Sign-up's code step too.)
  4. 0000000000 or a foreign number: "No account" + "Start a new company with
     this number", which sign-up then refused.
  5. Sign out on the Terms screen (and the credentials screen, and the demo
     banner's Leave) left a blank page.
Sign-up
  6. The Terms ticked at sign-up were never sent to register, so the first
     screen inside the app asked for them again.
  7. Names were stored with the spaces typed around them.
  8. The sign-up agreement outlived the sign-up: the next person in the same
     tab skipped the consent step.
  9. Back from consent / website reopened at question one; a resumed sign-up
     with every answer reopened at question three.
 10. The interview's language screen had no Back; the website step forgot the
     industry when you came back to it.
 11. The review listed eight recurring tasks, so a ninth added with "Tell Dex"
     was counted and never shown.
 12. "Already have an account" panel: no Back, and Back then Continue skipped it.
 13. The taken-email message said "sign in instead" with no link.
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


class _Client:
    host = "127.0.0.1"


class _Req:
    client = _Client()
    headers = {}


async def _noop(*a, **k):
    return None


# 1 ───────────────────────────────────────────────────────────────────────────
def test_a_mobile_only_account_gets_a_wrong_password_not_a_crash(monkeypatch):
    import routers.auth as auth
    import services.audit_log as audit
    from models.auth import LoginInput
    d = FakeDB()
    d.users.docs.append({"id": "u1", "tenant_id": "t1", "email": "founder@mobileonly.in",
                         "passwordless": True, "role": "owner"})
    monkeypatch.setattr(auth, "db", d)
    monkeypatch.setattr(audit, "record", _noop)
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth.login(LoginInput(email="founder@mobileonly.in", password="whatever123"), _Req(), None))
    assert e.value.status_code == 401
    assert e.value.detail == "Invalid email or password"
    # ...and it counts toward the lockout like any wrong password
    assert d.user_login_attempts.docs[0]["count"] == 1


def test_the_password_tab_points_mobile_sign_ups_to_the_code():
    s = _src("pages/Login.js")
    assert 'data-testid="login-password-mobile-hint"' in s
    assert 'data-testid="login-use-mobile"' in s


# 2 / 3 / 4 ───────────────────────────────────────────────────────────────────
def test_a_code_already_on_its_way_opens_the_boxes():
    for rel in ("pages/Login.js", "pages/onboarding/BasicsFlow.js"):
        s = _src(rel)
        assert "please wait (\\d+)s" in s, rel
        assert "We sent you a code a moment ago" in s, rel


def test_a_spent_code_unlocks_resend_at_once():
    for rel in ("pages/Login.js", "pages/onboarding/BasicsFlow.js"):
        s = _src(rel)
        assert "request an otp first|request a new|expired" in s, rel
        assert "if (spent) setResendIn(0);" in s, rel


def test_a_number_that_cannot_be_an_account_is_not_offered_a_company():
    s = _src("pages/Login.js")
    assert 'import { normIndianMobile } from "../lib/phone";' in s
    assert "err.response?.status === 404 && !normIndianMobile(otpPhone)" in s


# 5 ───────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("rel,testid", [
    ("components/TermsGate.js", "terms-gate-signout"),
    ("components/auth/OwnerCredentialsGate.js", "owner-credentials-signout"),
])
def test_signing_out_from_a_gate_goes_to_sign_in(rel, testid):
    s = _src(rel)
    assert 'await logout(); navigate("/login", { replace: true });' in s
    assert f'onClick={{signOut}} data-testid="{testid}"' in s
    assert f'onClick={{logout}} data-testid="{testid}"' not in s


def test_leaving_the_demo_goes_to_sign_in():
    s = _src("components/DemoWorkspaceBanner.js")
    assert 'onClick={async () => { await logout(); navigate("/login", { replace: true }); }}' in s


# 6 / 7 ───────────────────────────────────────────────────────────────────────
def test_the_terms_ticked_at_sign_up_reach_register():
    s = _src("pages/onboarding/BuildReveal.js")
    assert "...(payload.terms_version ? { terms_version: payload.terms_version } : {})," in s


def test_register_trims_the_names():
    s = (ROOT / "routers" / "auth.py").read_text(encoding="utf-8")
    assert 'inp.company_name = (inp.company_name or "").strip()' in s
    assert 'inp.name = (inp.name or "").strip()' in s


# 8 ───────────────────────────────────────────────────────────────────────────
def test_the_sign_up_agreement_ends_with_the_sign_up():
    assert "export function clearSignupConsent()" in _src("lib/legal.js")
    assert "clearSignupConsent();" in _src("pages/Signup.js")
    assert "clearSignupConsent();" in _src("context/AuthContext.js")


# 9 / 10 ──────────────────────────────────────────────────────────────────────
def test_back_and_resume_land_on_the_last_question():
    s = _src("pages/Signup.js")
    assert 'setBasicsStart(firstGap || "team_size");' in s
    assert 'const backToBasics = () => { setBasicsStart("team_size");' in s
    assert "onBack={backToBasics}" in s
    assert 'onBack={() => goTo("basics")}' not in s


def test_the_language_screen_has_a_back_and_the_website_step_remembers():
    assert 'data-testid="lang-pick-back"' in _src("pages/onboarding/VoiceInterview.js")
    w = _src("pages/onboarding/WebsiteIntel.js")
    assert 'useState(saved?.industry || "")' in w
    assert "saved={world}" in _src("pages/Signup.js")


# 11 ──────────────────────────────────────────────────────────────────────────
def test_the_review_lists_every_recurring_task():
    s = _src("pages/onboarding/BuildReveal.js")
    assert ".map((t) => t.title).filter(Boolean).slice(0, 8)" not in s


# 12 / 13 ─────────────────────────────────────────────────────────────────────
def test_the_already_yours_panel_has_a_back_and_comes_back():
    s = _src("pages/onboarding/BasicsFlow.js")
    assert "{(idx > 0 || existing) && (" in s
    assert "if (seen && seen.whole.phone_verified_norm === norm) { setExisting(seen); return; }" in s


def test_a_taken_email_links_to_sign_in():
    s = _src("pages/onboarding/BasicsFlow.js")
    assert 'data-testid="signup-email-taken-signin"' in s

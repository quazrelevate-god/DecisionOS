"""Forgetting a password has a screen now (2026-09-17).

The backend half shipped with FIX-003-D and is covered by
test_email_verification_and_reset.py: tokens, TTLs, single use, sibling
invalidation, and a /auth/password/forgot that answers identically whether or
not the address is registered.

What was missing was every part a person touches. The sign-in page had no
"Forgot password?" link, `/reset-password` was not a route, and so the link in
every reset email we had ever sent landed on a 404. Someone who forgot their
password and had no mobile number on file could not get back in at all — the
gap the backend-not-wired audit opened with.

These tests guard the seam that broke: the URL the email carries has to be a
route the app serves, and the screens behind it have to keep the API's
no-enumeration promise instead of being more helpful for a real address.
"""
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# The link in the email has to land somewhere.
# ---------------------------------------------------------------------------
def test_the_reset_email_url_is_a_route_the_app_serves():
    """routers/auth.py emails {APP_BASE_URL}/reset-password?token=… — if that
    path is not in App.js the whole feature is a 404, which is exactly how it
    shipped."""
    import inspect

    from routers.auth import password_forgot

    src = inspect.getsource(password_forgot)
    m = re.search(r'f"\{_app_base_url\(\)\}(/[a-z-]+)\?token=', src)
    assert m, "the reset email still builds a link with a path"
    path = m.group(1)
    assert path == "/reset-password"

    app = _fe("App.js")
    assert f'path="{path}"' in app, f"{path} has no route; the email lands on a 404"
    assert 'path="/forgot-password"' in app, "and somewhere to ask for the link"


def test_the_sign_in_page_offers_the_way_out():
    login = _fe("pages", "Login.js")
    assert 'data-testid="login-forgot-password"' in login
    assert '/forgot-password' in login, "and it points at the request screen"


# ---------------------------------------------------------------------------
# Asking for a link.
# ---------------------------------------------------------------------------
def test_the_request_screen_calls_the_endpoint_that_exists():
    page = _fe("pages", "PasswordReset.js")
    assert '"/auth/password/forgot"' in page
    assert '"/auth/password/reset"' in page


def test_the_request_screen_keeps_the_no_enumeration_promise():
    """The API answers identically for an address it knows and one it does
    not. Copy that says "we've sent you a link" for one and "no such account"
    for the other hands the oracle back on the screen."""
    page = _fe("pages", "PasswordReset.js")
    sent = page[page.index("if (sent)"):page.index("forgot-password-done")]
    assert "If an account exists" in sent, "the confirmation is true either way"
    for leak in ("no account", "not registered", "We couldn't find", "isn't registered"):
        assert leak.lower() not in page.lower(), f"leaks existence: {leak!r}"


def test_a_mobile_only_member_is_pointed_at_the_door_that_opens():
    """password_reset refuses passwordless accounts — an OTP member has no
    password to reset, so the screen has to say where to go instead."""
    page = _fe("pages", "PasswordReset.js")
    assert 'data-testid="forgot-password-otp-hint"' in page
    assert "Mobile OTP" in page


# ---------------------------------------------------------------------------
# Spending the link.
# ---------------------------------------------------------------------------
def test_the_reset_screen_reads_the_token_the_email_carries():
    page = _fe("pages", "PasswordReset.js")
    assert 'params.get("token")' in page, "same query name the email uses"


def test_a_dead_link_offers_a_new_one_instead_of_a_form_that_keeps_failing():
    """Used, expired, half-copied, or for a mobile-only account: none of those
    can be rescued by retyping the password."""
    page = _fe("pages", "PasswordReset.js")
    # The shell takes the testid as a prop and renders it as data-testid.
    assert 'testid="reset-password-dead"' in page
    assert 'data-testid="reset-password-new-link"' in page
    assert 'setDead(!token)' in page or "useState(!token)" in page, \
        "a link with no token is dead on arrival"
    assert "/invalid|expired|mobile OTP/i" in page, \
        "and the API's refusals switch to the same escape"


def test_both_forms_write_their_own_error_line():
    """noValidate is deliberate: the browser's own bubble pre-empts submit and
    says it in Chrome's words, in Chrome's place. Every other step of this app
    puts the line under the field."""
    page = _fe("pages", "PasswordReset.js")
    assert page.count("<form ") == 2, "the two forms"
    assert page.count("noValidate className") == 2, "and neither hands over to the browser"
    assert 'data-testid="forgot-password-error"' in page
    assert 'data-testid="reset-password-error"' in page


def test_the_new_password_is_checked_before_the_round_trip():
    page = _fe("pages", "PasswordReset.js")
    body = page[page.index("export function ResetPassword"):]
    # 2026-09-19 — the rule is 8+ with a letter and a number, shared with the
    # server (lib/password.js / services/auth/passwords.py).
    assert "passwordProblem(pw)" in body, "the API's own rule, said early"
    assert "pw !== confirm" in body, "and the two fields have to agree"

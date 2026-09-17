"""Confirming an email has a screen now (2026-09-17) — U7-24.10.

The other half of the forgot-password find, and the same shape of fault.
Registration has emailed `{APP_BASE_URL}/verify-email?token=…` since
FIX-003-D; `App.js` had no such route, so the link in every welcome email this
product has ever sent landed on a 404. `POST /auth/email/send-verification`
(re-send) had no caller anywhere in the frontend, and nothing read
`email_verified_at`, so nobody was ever told the address was unconfirmed.

The token model is covered by test_email_verification_and_reset.py. These are
the parts a person touches, plus the two traps this screen has to keep clear:
the token is single-use and React StrictMode runs an effect twice, and the
"already confirmed" verdict depends on an answer that arrives after first
paint.
"""
import inspect
import re
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# The link in the email has to land somewhere.
# ---------------------------------------------------------------------------
def test_the_welcome_email_url_is_a_route_the_app_serves():
    """Both senders build the same link — registration and the re-send — and
    neither had a page at the other end."""
    from routers.auth import register, send_verification_email

    paths = set()
    for fn in (register, send_verification_email):
        src = inspect.getsource(fn)
        paths.update(re.findall(r'\{_(?:app_)?base(?:_url\(\))?\}(/[a-z-]+)\?token=', src))
    assert paths == {"/verify-email"}, f"unexpected verification link paths: {paths}"

    app = _fe("App.js")
    assert 'path="/verify-email"' in app, "the welcome email's link lands on a 404"
    assert "EmailVerify" in app, "and the screen behind it is wired"


def test_the_screen_calls_the_endpoint_that_exists():
    """The link carries ?token=… but the endpoint takes it in the path
    (GET /auth/email/verify/{token}) — an easy thing to get wrong from the
    URL alone."""
    page = _fe("pages", "EmailVerify.js")
    assert 'params.get("token")' in page, "read the token the email carries"
    assert "/auth/email/verify/" in page, "and spend it where the endpoint is"

    from routers.auth import router
    routes = {getattr(r, "path", "") for r in router.routes}
    assert "/api/auth/email/verify/{token}" in routes
    assert "/api/auth/email/send-verification" in routes


# ---------------------------------------------------------------------------
# The two traps.
# ---------------------------------------------------------------------------
def test_a_single_use_token_is_spent_once_per_visit():
    """StrictMode runs an effect twice in development. Without a guard the
    first run spends the link and the second reports it invalid — a good link,
    condemned by our own dev server."""
    assert "StrictMode" in _fe("index.js"), "if this ever goes away, the guard can too"
    page = _fe("pages", "EmailVerify.js")
    assert "spent.current" in page and "useRef(false)" in page


def test_the_verdict_waits_for_the_account_to_load():
    """The dead card's heading turns on whether this account's email is
    already confirmed, which arrives from /auth/me after first paint.
    Rendering early flashed "This link won't work" at someone whose email was
    fine."""
    page = _fe("pages", "EmailVerify.js")
    assert 'state === "working" || loading' in page


# ---------------------------------------------------------------------------
# What it offers when the link is no good.
# ---------------------------------------------------------------------------
def test_a_dead_link_offers_a_new_one_to_someone_signed_in():
    page = _fe("pages", "EmailVerify.js")
    assert 'testid="verify-email-dead"' in page
    assert 'data-testid="verify-email-resend"' in page
    assert '"/auth/email/send-verification"' in page


def test_signed_out_it_does_not_pretend_to_send_anything():
    """The endpoint needs the account: it emails the address on file rather
    than one typed into a page, and it must stay that way — an
    unauthenticated "send a link to this address" is a way to send mail from
    us to anyone."""
    page = _fe("pages", "EmailVerify.js")
    assert 'data-testid="verify-email-signin-first"' in page

    from routers.auth import send_verification_email
    sig = inspect.signature(send_verification_email)
    assert any(str(p.default).endswith("get_current_user)") for p in sig.parameters.values()), \
        "the re-send still requires a signed-in account"


def test_an_already_confirmed_email_is_not_an_error():
    page = _fe("pages", "EmailVerify.js")
    assert "Already confirmed" in page
    assert "email_verified_at" in page


# ---------------------------------------------------------------------------
# Settings: the state, and the way to fix it.
# ---------------------------------------------------------------------------
def test_settings_says_whether_the_sign_in_address_is_confirmed():
    profile = _fe("components", "ProfileDialog.js")
    assert "email_verified_at" in profile, "nothing in the app read this before"
    assert 'data-testid="profile-email-verified"' in profile
    assert 'data-testid="profile-email-unverified"' in profile


def test_settings_can_ask_for_another_link():
    profile = _fe("components", "ProfileDialog.js")
    assert '"/auth/email/send-verification"' in profile, "the endpoint finally has a caller"
    assert 'data-testid="profile-email-verify-send"' in profile
    assert "already_verified" in profile, "and asking for one it does not need is not an error"


def test_the_confirmed_line_is_about_the_saved_address_not_the_typed_one():
    """The email field is editable in place; a Confirmed tick next to a
    half-typed new address would be a lie."""
    profile = _fe("components", "ProfileDialog.js")
    assert "{!emailChanged && (user?.email_verified_at" in profile


# ---------------------------------------------------------------------------
# One card, both errands.
# ---------------------------------------------------------------------------
def test_both_inbox_errands_wear_the_sign_in_page_s_clothes():
    shell = _fe("components", "auth", "AuthShell.js")
    assert "login-stage" in shell, "KM-42: the neumorphic pane needs the stage behind it"
    for page in ("PasswordReset.js", "EmailVerify.js"):
        assert "components/auth/AuthShell" in _fe("pages", page), f"{page} uses the shared card"

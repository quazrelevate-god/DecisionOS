"""A session that ends under an open app signs that tab out (2026-09-21).

Found running several people on several browsers: when a session ended while
the app stayed open — signed out in another tab, expired, revoked — nothing
noticed. The Desk stayed on screen and its pollers kept asking every few
seconds, each answer a 401: 20 failed calls in 45 seconds per tab, forever,
while the person looked at a Desk that had silently stopped updating. One tab
left open overnight in the preview pane had fired more than 28,000 requests.

Live after the fix: 2 calls, then the sign-in screen. A single stray 401 on one
route (the session still fine) signs nobody out — /auth/me is asked first.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def test_the_client_raises_the_signal_on_a_401_from_an_ordinary_route():
    api = (FE / "lib" / "api.js").read_text(encoding="utf-8")
    assert 'export const SESSION_LOST_EVENT = "dos:session-lost";' in api
    assert "err?.response?.status === 401" in api
    assert 'const AUTH_PATHS = ["/auth/", "/signup/"];' in api, \
        "a wrong code or an expired invite is the form's 401, not a lost session"


def test_the_tab_is_signed_out_only_once_auth_me_agrees():
    ctx = (FE / "context" / "AuthContext.js").read_text(encoding="utf-8")
    block = ctx[ctx.index("window.addEventListener(SESSION_LOST_EVENT"[:30]) - 1400:]
    assert "window.addEventListener(SESSION_LOST_EVENT, onLost);" in ctx
    assert 'await api.get("/auth/me");' in block, "confirm before acting on one 401"
    assert "if (e?.response?.status === 401) {" in block
    assert "setUser(null);" in block, "clearing the user unmounts the shell and stops every poller"
    assert "if (checking) return;" in block, "a burst of 401s is one check"

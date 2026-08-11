"""FIX-006-B (S0-02): CSRF protection via double-submit cookie pattern.

Threat model
------------
Our auth cookie is `SameSite=None` (needed for cross-subdomain frontends
and preview envs). SameSite=None means the browser sends the auth
cookie on cross-site requests, so a hidden form on evil.com that POSTs
to `https://api.decisionos.com/api/decisions/{id}/approve` succeeds as
the logged-in user — the browser auto-attaches the cookie. The attacker
can't read the response (CORS still gates that) but the write already
happened. That's classic CSRF.

Defense: double-submit cookie
-----------------------------
On every path that mints an auth cookie, we ALSO set a non-HttpOnly
`dos_csrf` cookie carrying a random per-session token
(see `core.set_csrf_cookie`). The frontend reads it with JS and echoes
it back as `X-CSRF-Token` on every mutating request.

evil.com CAN cause the browser to SEND the `dos_csrf` cookie (SameSite
doesn't stop that) but CANNOT read its value — same-origin policy still
governs cookie READS regardless of SameSite. So evil.com cannot
construct the matching header, and the check fails.

Middleware behaviour
--------------------
For each incoming request:
  1. Safe verbs (GET/HEAD/OPTIONS) → pass through.
  2. Exempt paths (webhooks, login endpoints) → pass through. These are
     either signature-authenticated by the caller (Meta HMAC) or run
     BEFORE the CSRF cookie exists.
  3. Bearer-auth requests (no `dos_token` / `dos_admin_token` cookie
     present) → pass through. Native/mobile clients using
     `Authorization: Bearer` aren't CSRF-vulnerable by definition —
     the browser is the enemy here, and bearer auth is server-to-server.
  4. Cookie-authed mutating request:
     * cookie value present AND header value present AND they match
       (constant-time) → pass, tally to `match` metric.
     * anything else → tally to `mismatch` metric.
       - If `CSRF_ENFORCE=True`: return HTTP 403.
       - Else (default in this batch): log-only, so we can measure
         frontend adoption before flipping enforcement on.

Rollout
-------
Ship 1: middleware installed, cookie minted on every login,
        enforcement OFF by default. Tally match/mismatch.
Ship 2 (follow-up): frontend reads `dos_csrf`, sends X-CSRF-Token.
Ship 3: staging shows 100% match rate → flip CSRF_ENFORCE=1 in prod.
"""
from __future__ import annotations

import hmac
import logging
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import (
    AUTH_COOKIE_NAME,
    ADMIN_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
    CSRF_EXEMPT_PATHS,
    CSRF_ENFORCE,
)

logger = logging.getLogger("decisionos.csrf")

_SAFE_VERBS = frozenset({"GET", "HEAD", "OPTIONS"})


# In-process telemetry counters. Cheap ints — a follow-up will pipe them
# into Sentry / structured logs, but even the raw values are useful in
# an interactive debug session ("how many mismatches this hour?").
_metrics = {"match": 0, "mismatch_missing_cookie": 0,
            "mismatch_missing_header": 0, "mismatch_value": 0,
            "skipped_safe_verb": 0, "skipped_exempt_path": 0,
            "skipped_bearer_auth": 0}


def metrics_snapshot() -> dict:
    """Return the current counters (for tests + future observability
    endpoint). Callers must not mutate the returned dict."""
    return dict(_metrics)


def reset_metrics() -> None:
    """Test-only: zero the counters between tests."""
    for k in _metrics:
        _metrics[k] = 0


def _has_auth_cookie(request: Request) -> bool:
    """True if the request presents either the tenant or admin auth cookie.
    Only cookie-authed requests need CSRF; bearer-authed ones are safe."""
    return bool(request.cookies.get(AUTH_COOKIE_NAME)
                 or request.cookies.get(ADMIN_COOKIE_NAME))


def _check(request: Request) -> tuple[bool, str]:
    """Evaluate the CSRF contract for one request. Returns (ok, reason).

    Called by the middleware, but also exposed so unit tests can drive
    it without spinning up an ASGI app.
    """
    if request.method in _SAFE_VERBS:
        _metrics["skipped_safe_verb"] += 1
        return True, "safe_verb"
    if request.url.path in CSRF_EXEMPT_PATHS:
        _metrics["skipped_exempt_path"] += 1
        return True, "exempt_path"
    if not _has_auth_cookie(request):
        _metrics["skipped_bearer_auth"] += 1
        return True, "bearer_or_unauth"
    cookie_val = request.cookies.get(CSRF_COOKIE_NAME) or ""
    header_val = request.headers.get(CSRF_HEADER_NAME) or ""
    if not cookie_val:
        _metrics["mismatch_missing_cookie"] += 1
        return False, "missing_cookie"
    if not header_val:
        _metrics["mismatch_missing_header"] += 1
        return False, "missing_header"
    # Constant-time compare so we don't leak timing signal about the
    # first-differing byte to a network attacker who can measure RTT
    # (unlikely in practice for CSRF, but free to do right).
    if not hmac.compare_digest(cookie_val, header_val):
        _metrics["mismatch_value"] += 1
        return False, "value_mismatch"
    _metrics["match"] += 1
    return True, "match"


class CSRFMiddleware(BaseHTTPMiddleware):
    """Wire this in with `app.add_middleware(CSRFMiddleware)`.

    Reads request.cookies + request.headers only — never touches the
    request body, so it's safe with streaming uploads and doesn't
    trigger BaseHTTPMiddleware's body-buffering pitfall.
    """

    async def dispatch(self, request: Request,
                         call_next: Callable) -> Response:
        ok, reason = _check(request)
        if ok:
            return await call_next(request)
        # Not ok — log every failure regardless of enforcement so the
        # ops team can watch the mismatch rate drop as the frontend
        # rolls out. Log at warning level so it surfaces without being
        # noisy on match.
        logger.warning(
            "csrf_check_failed reason=%s path=%s method=%s enforce=%s",
            reason, request.url.path, request.method, CSRF_ENFORCE,
        )
        if CSRF_ENFORCE:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF check failed",
                         "reason": reason},
            )
        # Shadow mode: log-only, request passes through so the app
        # keeps working during the frontend rollout window.
        return await call_next(request)

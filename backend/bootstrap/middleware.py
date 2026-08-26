"""App-assembly: middleware registration.

Extracted verbatim from the tail of server.py in Epic 8 Sprint 1 (modular
foundation). No behaviour change: the same middleware are installed with the
same configuration in the same order.

Starlette applies middleware in *reverse* add-order (the last one added is
the outermost). server.py added CORS first and CSRF second, so the resulting
stack (outermost -> innermost) is [CSRF, CORS]. `register_middleware` keeps
that exact order.
"""
from starlette.middleware.cors import CORSMiddleware

from core import logger
from config import CORS_ORIGINS, CSRF_ENFORCE
from services.csrf import CSRFMiddleware


def register_middleware(app) -> None:
    """Install CORS then CSRF on ``app`` (order-preserving)."""
    # FIX-006-B (S0-02): strict CORS allow-list -- no more `allow_origin_regex=".*"`.
    # The old default of `*` combined with `allow_credentials=True` let any site
    # the user visited make credentialed cross-origin calls carrying their auth
    # cookie. Origins now come from CORS_ORIGINS env; in prod an unset or wildcard
    # list makes config.py refuse to boot.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        allow_headers=["*"],
        expose_headers=[],
        max_age=600,
    )
    logger.info(f"CORS allow-list ({len(CORS_ORIGINS)} origins): {CORS_ORIGINS}")

    # FIX-006-B (S0-02): CSRF double-submit cookie enforcement. Middleware is
    # always installed so we mint the cookie + log match/mismatch on every
    # mutating cookie-authed request; actual 403 enforcement is gated by the
    # CSRF_ENFORCE env flag.
    app.add_middleware(CSRFMiddleware)
    logger.info(f"CSRF middleware installed (enforce={CSRF_ENFORCE})")

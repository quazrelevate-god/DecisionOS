"""S5-03 -- observability: optional Sentry error tracking + structured JSON logs
+ request-id correlation.

Everything here is OPT-IN via environment variables and import-guarded, so the
app behaves identically when nothing is configured (and even if `sentry-sdk` is
not installed). Enable in production by setting the env vars below on the deploy
platform's secret store (see docs/runbooks/OBSERVABILITY.md):

  SENTRY_DSN                 -> turns on Sentry error + performance tracking
  SENTRY_TRACES_SAMPLE_RATE  -> perf sampling (default 0.0 = errors only)
  ENV                        -> environment tag (dev/staging/production)
  RELEASE                    -> release/version tag (e.g. the git sha)
  LOG_FORMAT=json            -> switch app logs to one JSON object per line
                                (for a log aggregator); default stays human-readable
"""
import json
import logging
import os
import uuid
from contextvars import ContextVar

logger = logging.getLogger("decisionos")

# Correlates every log line + Sentry event of a single request.
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def current_request_id() -> str:
    return _request_id.get()


class _RequestIdFilter(logging.Filter):
    def filter(self, record):  # noqa: A003
        record.request_id = _request_id.get()
        return True


class _JsonFormatter(logging.Formatter):
    """One JSON object per log line, safe for a log-aggregation pipeline."""
    def format(self, record):  # noqa: A003
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> bool:
    """Switch to structured JSON logs when LOG_FORMAT=json; otherwise leave the
    existing human-readable format untouched. Always safe / idempotent."""
    if os.environ.get("LOG_FORMAT", "").strip().lower() != "json":
        return False
    root = logging.getLogger()
    for h in root.handlers:
        h.addFilter(_RequestIdFilter())
        h.setFormatter(_JsonFormatter())
    return True


def init_sentry() -> bool:
    """Initialise Sentry iff SENTRY_DSN is set AND sentry-sdk is importable.
    Returns True when tracking is active, False (no-op) otherwise."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; error tracking disabled")
        return False
    try:
        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get("ENV", "dev"),
            release=os.environ.get("RELEASE") or None,
            traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.0") or 0.0),
            send_default_pii=False,   # never ship user PII to the error tracker
            max_request_body_size="small",
        )
        logger.info("Sentry error tracking initialised (env=%s)", os.environ.get("ENV", "dev"))
        return True
    except Exception as e:  # a misconfigured DSN must never crash boot
        logger.warning("Sentry init failed (%s); continuing without error tracking", e)
        return False


async def _request_id_middleware(request, call_next):
    rid = (request.headers.get("X-Request-ID") or "").strip() or uuid.uuid4().hex[:16]
    token = _request_id.set(rid)
    try:
        response = await call_next(request)
    finally:
        _request_id.reset(token)
    response.headers["X-Request-ID"] = rid
    return response


def init_observability(app) -> dict:
    """Wire Sentry + JSON logs + request-id correlation. Call once after the app
    is created. No-ops cleanly when nothing is configured."""
    state = {"sentry": init_sentry(), "json_logs": configure_logging()}
    app.middleware("http")(_request_id_middleware)
    return state

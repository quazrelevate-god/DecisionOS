"""LLM call timeout + concurrency guard.

Introduced by FIX-002-B to close the SaaS-readiness P1 finding: LLM calls
had no `asyncio.wait_for` timeout and no concurrency cap. One shared
Anthropic key across all tenants meant a burst of 50 concurrent voice-
capture requests would pile up on a single provider, contend for rate
limit, and cascade into 429s + unbounded request latency with no ceiling.

This module gives you two knobs and one entry point:

  LLM_TIMEOUT_SECONDS         (env: LLM_TIMEOUT_SECONDS, default 45s)
    Every wrapped LLM call must finish within this window. On timeout,
    the wrapper raises asyncio.TimeoutError which existing try/except
    blocks around send_message already catch (they degrade to safe
    defaults per FIX-001-D's ai_setup wrappers).

  LLM_MAX_CONCURRENT          (env: LLM_MAX_CONCURRENT, default 16)
    Maximum in-flight LLM calls PER PROCESS at any moment. The 17th
    caller blocks on the semaphore until a slot frees. Prevents
    unbounded pileup that would otherwise turn into a system-wide
    latency spike + rate-limit cascade.

  guarded_llm(coro, *, label="llm")
    The one entry point. Wrap any awaitable in this and it enforces
    both limits. Emits a warning log on timeout with the label so ops
    can see which call path is choking under load.

Per-process only: multiple uvicorn workers each get their own semaphore
(so total in-flight = workers × LLM_MAX_CONCURRENT). Cross-process rate
limiting would need a Redis-backed limiter — that's Sprint 3 territory
along with per-tenant AI keys.
"""
import asyncio
import os

from core import logger


def _read_int_env(name: str, default: int, minimum: int = 1) -> int:
    """Parse an int env var, fall back to default on any error. Enforces a
    minimum so a fat-fingered '0' or negative value can't disable the guard."""
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        v = int(raw)
        if v < minimum:
            logger.warning(
                f"{name}={raw} below minimum {minimum}; using {minimum}")
            return minimum
        return v
    except ValueError:
        logger.warning(f"{name}={raw!r} not an int; using default {default}")
        return default


LLM_TIMEOUT_SECONDS: int = _read_int_env("LLM_TIMEOUT_SECONDS", 45, minimum=5)
LLM_MAX_CONCURRENT: int = _read_int_env("LLM_MAX_CONCURRENT", 16, minimum=1)


# Lazy-initialized semaphore: creating an asyncio.Semaphore at import
# time can bind to the wrong event loop when tests or scripts spin their
# own loop up. Building it on first use pins it to whichever loop is
# actually running the request.
_semaphore: asyncio.Semaphore | None = None
_semaphore_lock = asyncio.Lock() if False else None  # placeholder; see _get_semaphore


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(LLM_MAX_CONCURRENT)
    return _semaphore


def _reset_for_test() -> None:
    """Test-only: reset the module-level semaphore so a fresh test can
    exercise a fresh limit + timeout config. Never call from prod code."""
    global _semaphore
    _semaphore = None


async def guarded_llm(coro, *, label: str = "llm",
                      timeout: int | None = None):
    """Execute an awaitable under the shared LLM concurrency semaphore
    with a per-call timeout. The `label` is used only for logging so ops
    can see which call path is choking under load.

    Usage:
        resp = await guarded_llm(chat.send_message(message), label="claude:extract")

    Optional per-call `timeout` override (seconds) for paths that need a
    tighter or looser bound than the default LLM_TIMEOUT_SECONDS (e.g.
    admin key-probe wants a fast 25s to surface bad-key errors quickly).

    On timeout raises asyncio.TimeoutError; callers should catch it the
    same way they catch other send_message failures (existing try/except
    blocks already handle this — see routers/onboarding.py::os_blueprint
    or services/ai_setup.py wrappers).
    """
    sem = _get_semaphore()
    effective_timeout = timeout if timeout is not None else LLM_TIMEOUT_SECONDS
    async with sem:
        try:
            return await asyncio.wait_for(coro, timeout=effective_timeout)
        except asyncio.TimeoutError:
            logger.warning(
                f"[{label}] LLM call timed out after {effective_timeout}s"
                f" (cap: {LLM_MAX_CONCURRENT} concurrent)")
            raise


def config_snapshot() -> dict:
    """Return the currently-active LLM limits (for health endpoints /
    admin dashboards). Read-only."""
    return {
        "llm_timeout_seconds": LLM_TIMEOUT_SECONDS,
        "llm_max_concurrent": LLM_MAX_CONCURRENT,
    }

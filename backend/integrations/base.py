"""Shared adapter base for external-provider integrations (Epic 8 Sprint 6).

Every provider adapter in this package (email, stt, gemini, whatsapp, razorpay,
storage, llm) calls one external service and nothing else. This module gives
them a common seam:

  * ``ProviderError`` — one structured error type carrying (provider, op, cause),
    so callers catch a single exception and logs/observability are uniform.
  * ``with_retry`` / ``arun`` — timeout + bounded exponential-backoff retry for
    the flaky network calls, sync (run in a thread) and async.
  * ``mock_for`` — a per-provider mock hook. Tests (or ``INTEGRATIONS_MOCK=1``
    dev runs) register a callable via ``register_mock(provider, op, fn)`` and the
    adapter returns it instead of hitting the network — the single place to stub
    a vendor.

Layering: adapters import only ``config`` / ``core`` / external SDKs + this base;
never ``services`` or ``server`` (keeps the dependency graph acyclic).
"""
import os
import time
import asyncio
import logging

logger = logging.getLogger("decisionos")

MOCK_ENABLED = os.environ.get("INTEGRATIONS_MOCK", "").lower() in ("1", "true", "yes")


class ProviderError(Exception):
    """Raised when an external provider call fails after retries.

    Carries the provider name and the operation so one ``except ProviderError``
    covers every adapter and the message reads the same everywhere.
    """

    def __init__(self, provider: str, op: str, cause: Exception | None = None, detail: str = ""):
        self.provider = provider
        self.op = op
        self.cause = cause
        self.detail = detail or (str(cause) if cause else "")
        super().__init__(f"[{provider}:{op}] {self.detail}")


# --- mock registry -----------------------------------------------------------
_MOCKS: dict[tuple[str, str], object] = {}


def register_mock(provider: str, op: str, fn) -> None:
    """Register a stub for (provider, op). Only consulted when mocks are enabled."""
    _MOCKS[(provider, op)] = fn


def clear_mocks() -> None:
    _MOCKS.clear()


def mock_for(provider: str, op: str):
    """Return the registered mock callable for (provider, op), or None.

    Returns None unless mocks are enabled (INTEGRATIONS_MOCK) AND a stub was
    registered — so production paths are never diverted.
    """
    if not MOCK_ENABLED:
        return None
    return _MOCKS.get((provider, op))


# --- retry / timeout ---------------------------------------------------------
def with_retry(fn, *, provider: str, op: str, retries: int = 2, backoff: float = 0.5,
               retry_on: tuple = (Exception,)):
    """Call a SYNC provider fn with bounded exponential-backoff retry.

    Raises ProviderError(provider, op) if every attempt fails. Use for the
    blocking SDK/HTTP calls that adapters run inside ``asyncio.to_thread``.
    """
    last = None
    for attempt in range(retries + 1):
        try:
            return fn()
        except retry_on as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                time.sleep(backoff * (2 ** attempt))
                logger.warning("[%s:%s] attempt %d failed (%s); retrying", provider, op, attempt + 1, e)
    raise ProviderError(provider, op, last)


async def arun(coro_factory, *, provider: str, op: str, timeout: float = 30.0,
               retries: int = 1, backoff: float = 0.5, retry_on: tuple = (Exception,)):
    """Await an ASYNC provider call (``coro_factory`` builds a fresh awaitable per
    attempt) with a per-attempt timeout + bounded retry. Raises ProviderError.
    """
    last = None
    for attempt in range(retries + 1):
        try:
            return await asyncio.wait_for(coro_factory(), timeout=timeout)
        except retry_on as e:  # noqa: BLE001
            last = e
            if attempt < retries:
                await asyncio.sleep(backoff * (2 ** attempt))
                logger.warning("[%s:%s] async attempt %d failed (%s); retrying", provider, op, attempt + 1, e)
    raise ProviderError(provider, op, last)

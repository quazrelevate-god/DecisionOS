"""FIX-004-A (RBAC Wave 1): sliding-window in-process rate limiter.

Enforces per-IP quotas on public endpoints that would otherwise let an
unauthenticated attacker burn AI credits, spin up tenants, or enumerate
draft IDs. Kept intentionally simple:

  * Sliding window (not fixed bucket) so a burst at second 59 + second 61
    can't slip through a 60-second window.
  * Per-worker in-process only. With multi-uvicorn workers, each worker
    holds its own counters — the effective limit is `N * cap`. Good
    enough for the low-volume unauth surface we're gating (register,
    website-intel, tts, stt). Cross-process limit is a FIX-FUP (Redis).
  * Fail-open: if the limiter itself raises (e.g. memory pressure),
    the request is allowed through and a warning is logged. Blocking
    a legitimate signup because the limiter blew up is worse than
    letting one extra request through.

Contract:
  check_rate_limit(key, max_hits, window_seconds) -> (allowed, retry_after)

    allowed         True if this request is under the cap.
    retry_after     Seconds until the next slot frees up (int, floored).
                    0 when allowed is True.

Callers should return HTTP 429 with the Retry-After header set to
`retry_after` when allowed is False.
"""
import asyncio
import time
from collections import defaultdict, deque
from typing import Tuple

from core import logger


# Bucket keyed by (bucket_name, key). Each entry is a deque of the
# monotonic timestamps of recent hits. Trimming happens on read.
_BUCKETS: "dict[tuple[str, str], deque]" = defaultdict(deque)
# One global lock is fine — check_rate_limit does O(1) work per call and
# the surface is public (low QPS by definition).
_LOCK = asyncio.Lock()


async def check_rate_limit(
    key: str,
    max_hits: int,
    window_seconds: float,
    bucket: str = "default",
) -> Tuple[bool, int]:
    """Register a hit for `key` in `bucket`. Return (allowed, retry_after)."""
    if not key or max_hits <= 0 or window_seconds <= 0:
        return True, 0
    now = time.monotonic()
    threshold = now - window_seconds
    try:
        async with _LOCK:
            q = _BUCKETS[(bucket, key)]
            # Drop entries outside the window.
            while q and q[0] <= threshold:
                q.popleft()
            if len(q) >= max_hits:
                # Retry-after = time until the oldest entry expires.
                retry_after = max(1, int(q[0] + window_seconds - now) + 1)
                return False, retry_after
            q.append(now)
            return True, 0
    except Exception as e:
        # Fail-open: never take down the request path for a limiter bug.
        logger.warning(f"rate_limit failed for {key!r}: {e}")
        return True, 0


async def reset_for_test(bucket: str = None) -> None:
    """Clear all buckets (or one) — test-only helper."""
    async with _LOCK:
        if bucket is None:
            _BUCKETS.clear()
        else:
            for k in list(_BUCKETS.keys()):
                if k[0] == bucket:
                    _BUCKETS.pop(k, None)


def client_ip(request) -> str:
    """Best-effort client-IP extraction.

    Trusts X-Forwarded-For / X-Real-IP because uvicorn is expected to run
    behind a proxy (nginx / Railway / Cloudflare). If neither header is
    present, falls back to the socket peer.

    Returns "unknown" if none of that works — the limiter treats
    "unknown" as a single shared bucket, which naturally rate-limits
    any pathological ingress (e.g. request without a Host header).
    """
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    xri = request.headers.get("X-Real-IP")
    if xri:
        return xri.strip()
    try:
        return request.client.host if request.client else "unknown"
    except Exception:
        return "unknown"

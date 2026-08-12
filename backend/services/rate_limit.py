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


# ---------------------------------------------------------------------------
# FIX-006-D (S0-06): shared guard for public AI endpoints.
#
# Extracted from signup.py's _guard_signup_endpoint so the same three
# checks (hourly quota → burst quota → captcha) can apply to any
# unauth endpoint that burns LLM credits — signup wizard, onboarding
# suggest, blueprint generation, and whatever public AI surface gets
# added next.
#
# Every unauth endpoint that calls claude_chat / any LLM MUST route
# through this. The RBAC-01/03 gap the tracker's S0-06 flagged was
# exactly two /api/onboarding/* endpoints that skipped it; making
# the guard a public shared function is the smallest fix that also
# stops the next such regression.
# ---------------------------------------------------------------------------

# Numbers calibrated to a realistic pre-auth funnel: a founder finishing
# the whole flow hits each surface a handful of times. 30/hr is well
# above legitimate use, well below what a bot needs to meaningfully
# drain LLM credit.
_UNAUTH_AI_LIMIT_HOURLY = (30, 3600)  # 30 hits per hour per IP per endpoint kind
_UNAUTH_AI_BURST = (5, 10)             # 5 hits per 10 seconds — kills scripted loops


async def guard_unauth_ai_endpoint(
    request,
    service: str,
    kind: str,
    *,
    hourly: tuple = _UNAUTH_AI_LIMIT_HOURLY,
    burst: tuple = _UNAUTH_AI_BURST,
    require_captcha: bool = True,
) -> str:
    """FIX-006-D (S0-06): three-check gate for public AI endpoints.

    Runs, in order:
      1. Sliding hourly quota per (IP, service:kind).  429 on breach.
      2. Sliding burst quota per (IP, service:kind).   429 on breach.
      3. CAPTCHA verification (via `X-Captcha-Token` header).  400 on
         breach.  Skipped in dev when no *_SECRET is configured
         (see services/captcha.py).

    Args:
      service: outer namespace ("signup", "onboarding", …) — keeps
        two endpoints on different services from sharing a bucket.
      kind:    per-endpoint suffix ("suggest", "os_blueprint", …).
      hourly / burst: override the defaults for a specific endpoint
        that has different traffic characteristics.
      require_captcha: turn off ONLY for endpoints that legitimately
        can't render one (rare).

    Returns:
      The caller's IP for downstream logging.

    Raises:
      HTTPException(429) or HTTPException(400) on any failure.
    """
    # Deferred imports so this module stays cheap to import.
    from fastapi import HTTPException
    from services.captcha import verify_captcha

    ip = client_ip(request)
    bucket_key = f"{service}:{kind}"
    ok, retry_after = await check_rate_limit(
        ip, hourly[0], hourly[1], bucket=f"unauth_ai_hour:{bucket_key}",
    )
    if not ok:
        raise HTTPException(
            status_code=429,
            detail=f"Too many {kind} requests from your network. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )
    ok, retry_after = await check_rate_limit(
        ip, burst[0], burst[1], bucket=f"unauth_ai_burst:{bucket_key}",
    )
    if not ok:
        raise HTTPException(
            status_code=429,
            detail="Too many requests, too fast. Slow down.",
            headers={"Retry-After": str(retry_after)},
        )
    if require_captcha:
        token = request.headers.get("X-Captcha-Token") or ""
        cap_ok, cap_reason = await verify_captcha(token, remote_ip=ip)
        if not cap_ok:
            raise HTTPException(
                status_code=400,
                detail={"code": f"captcha_{cap_reason}",
                         "message": "We couldn't verify you as human. Refresh the page and try again."},
            )
    return ip

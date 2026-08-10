"""FIX-004-A (RBAC Wave 1): Turnstile / hCaptcha token verification.

Cloudflare Turnstile is the default (free, no visible challenge for most
users, better UX than hCaptcha). hCaptcha is supported as a fallback for
tenants who already have a Cloudflare-incompatible integration.

Behavior:
  * If TURNSTILE_SECRET or HCAPTCHA_SECRET is set, the token in the
    request body is verified against the vendor's siteverify endpoint.
    A missing or invalid token returns (False, reason).
  * If NEITHER secret is set (typical dev/staging), CAPTCHA is
    considered disabled — verify_captcha returns (True, "disabled").
    Callers should treat this as OK for local dev but ops should
    flip an env flag to make it hard-required in production
    (CAPTCHA_REQUIRED=1).

  * If CAPTCHA_REQUIRED=1 AND no secret is configured, verify_captcha
    returns (False, "misconfigured") to prevent a silent bypass in a
    prod deploy where someone forgot to set the secret.

Callers:
  from services.captcha import verify_captcha
  ok, reason = await verify_captcha(token, remote_ip)
  if not ok:
      raise HTTPException(status_code=400, detail=f"captcha_{reason}")
"""
import os
from typing import Optional, Tuple

import httpx

from core import logger


TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
HCAPTCHA_URL = "https://hcaptcha.com/siteverify"


def _required() -> bool:
    return os.environ.get("CAPTCHA_REQUIRED", "").strip().lower() in ("1", "true", "yes")


def _turnstile_secret() -> str:
    return (os.environ.get("TURNSTILE_SECRET") or "").strip()


def _hcaptcha_secret() -> str:
    return (os.environ.get("HCAPTCHA_SECRET") or "").strip()


def captcha_provider() -> Optional[str]:
    """Return which provider is configured, or None if disabled."""
    if _turnstile_secret():
        return "turnstile"
    if _hcaptcha_secret():
        return "hcaptcha"
    return None


async def verify_captcha(token: Optional[str],
                          remote_ip: Optional[str] = None) -> Tuple[bool, str]:
    """Verify a CAPTCHA token. Returns (ok, reason_or_provider).

    reason values on failure:
      "missing"        — no token supplied and CAPTCHA is required
      "invalid"        — vendor rejected the token
      "network"        — couldn't reach vendor; ambiguous — fail-closed
                         when required, fail-open otherwise
      "misconfigured"  — CAPTCHA_REQUIRED=1 but no secret is set
    """
    provider = captcha_provider()
    required = _required()

    if not provider:
        if required:
            logger.error("CAPTCHA_REQUIRED=1 but no *_SECRET is set — refusing to allow")
            return False, "misconfigured"
        return True, "disabled"

    if not token or not str(token).strip():
        return (False, "missing") if required else (True, "missing_but_optional")

    url = TURNSTILE_URL if provider == "turnstile" else HCAPTCHA_URL
    secret = _turnstile_secret() if provider == "turnstile" else _hcaptcha_secret()
    data = {"secret": secret, "response": token.strip()}
    if remote_ip:
        data["remoteip"] = remote_ip
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(url, data=data)
            body = r.json() if r.status_code == 200 else {}
    except Exception as e:
        logger.warning(f"captcha vendor unreachable ({provider}): {e}")
        # Fail-closed if required, fail-open otherwise. Vendor blips
        # shouldn't lock every user out unless ops explicitly opted in.
        return (False, "network") if required else (True, "vendor_unreachable")

    if body.get("success") is True:
        return True, provider
    return False, "invalid"

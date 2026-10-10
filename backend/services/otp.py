"""Phone OTP issuance + delivery (Epic 8 Sprint 7 -- U8-07.5).

The login/registration OTP subsystem: TTL/attempt/cooldown policy, the prod
boot-time SMS-provider guard, the APM SMS gateway fetch, Twilio fallback
delivery, salted-hash storage, and the _issue_otp orchestrator. Extracted
verbatim from server.py; routers/auth_otp.py imports from here. server.py
re-exports the public names for compatibility.
"""

from __future__ import annotations

import os
import re  # noqa: F401  (used by _apm_send_and_fetch_otp)
import hashlib
import secrets
import logging  # noqa: F401  (used for provider warnings)

logger = logging.getLogger("decisionos")
from datetime import datetime, timezone, timedelta

import httpx  # noqa: F401  (APM gateway calls)
from fastapi import HTTPException

from core import db

# ---------------------------------------------------------------------------
# Mobile + OTP login (alternate auth). DEV mode returns OTP until Twilio keys added.
# ---------------------------------------------------------------------------
OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN = 30
TWILIO_ENABLED = bool(
    os.environ.get("TWILIO_ACCOUNT_SID")
    and os.environ.get("TWILIO_AUTH_TOKEN")
    and os.environ.get("TWILIO_FROM_NUMBER")
)
APM_SMS_API_KEY = os.environ.get("APM_SMS_API_KEY")
APM_OTP_ENDPOINT = os.environ.get("APM_OTP_ENDPOINT", "Registration")  # "Registration" or "ForgotPassword"
APM_ENABLED = bool(APM_SMS_API_KEY)

# FIX-006-C (S0-04): prod without an SMS provider is dev-mode-by-default,
# and dev-mode-by-default is account-takeover-by-default (the OTP was
# being returned in the JSON body). Refuse to boot in prod when neither
# APM nor Twilio is configured — better a loud "no SMS provider" boot
# failure than a silent "any /auth/otp/request returns a valid OTP"
# response.
if os.environ.get("ENV", "dev").strip().lower() == "prod" and not (APM_ENABLED or TWILIO_ENABLED):
    raise RuntimeError(
        "No SMS provider configured (APM_SMS_API_KEY or TWILIO_ACCOUNT_SID/"
        "AUTH_TOKEN/FROM_NUMBER). Refusing to boot in prod — without a real "
        "provider, /auth/otp/request would silently fall into dev mode and, "
        "with DEV_OTP_IN_RESPONSE=1, leak login codes to any caller."
    )


async def _apm_send_and_fetch_otp(norm_phone: str):
    """Call the APM gateway to SEND an OTP SMS and return the 6-digit code it generated.
    Returns None when APM is not configured (caller falls back to a self-generated code)."""
    if not APM_ENABLED:
        return None
    endpoint = APM_OTP_ENDPOINT if APM_OTP_ENDPOINT in ("Registration", "ForgotPassword") else "Registration"
    url = f"https://sms.apmtechnologies.in/api/Home/{endpoint}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, params={"ApiKey": APM_SMS_API_KEY, "PhoneNumber": norm_phone})
            r.raise_for_status()
            m = re.search(r"\b\d{6}\b", r.text or "")
            if m:
                return m.group(0)
            logging.error(f"APM OTP: no 6-digit code in response: {(r.text or '')[:300]}")
            raise HTTPException(status_code=502, detail="We couldn't send the code just now. Try again in a moment.")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"APM OTP gateway error: {e}")
        raise HTTPException(status_code=503, detail="SMS service is temporarily unavailable. Please try again.")


def _hash_otp(code: str, phone: str) -> str:
    return hashlib.sha256(f"{phone}:{code}:decisionos".encode()).hexdigest()


async def _send_otp_sms(phone: str, code: str) -> bool:
    """Send OTP via Twilio when configured; otherwise dev mode (no send)."""
    if not TWILIO_ENABLED:
        return False
    try:
        from twilio.rest import Client

        client = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
        client.messages.create(
            body=f"Your DecisionOS login code is {code}. Valid for 5 minutes.",
            from_=os.environ["TWILIO_FROM_NUMBER"],
            to=phone,
        )
        return True
    except Exception as e:
        logging.error(f"Twilio OTP send failed: {e}")
        return False


async def consume_otp(norm: str, tenant_id: str, code: str) -> None:
    """Check a code against the live OTP for (phone, tenant) and spend it.

    Raises the same HTTPExceptions the sign-in door does — no row (400), expired
    (400), too many tries (429), wrong code (401, and the attempt is counted).
    Returns None when the code was right; the row is deleted, so a code is good
    once. Extracted 2026-09-16 so a second place that has to prove "this really
    is you" — changing your own sign-in email when you have no password — asks
    the question exactly the way /auth/otp/verify does.
    """
    key = {"phone": norm, "tenant_id": tenant_id}
    rec = await db.otp_codes.find_one(key, {"_id": 0})
    try:
        _refuse_spent_or_wrong(rec)
    except HTTPException:
        if rec:
            await db.otp_codes.delete_one(key)      # spent or out of date: gone
        raise
    if _hash_otp((code or "").strip(), norm) != rec["code_hash"]:
        await db.otp_codes.update_one(key, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail=wrong_code(OTP_MAX_ATTEMPTS - rec.get("attempts", 0) - 1))
    await db.otp_codes.delete_one(key)


# Audit A-06 (2026-10-09) -- ONE WORD, AND HOW MANY TRIES ARE LEFT.
# The screens say "code"; these said "OTP" ("Incorrect OTP", "Request an OTP
# first"), and a wrong code never said how many more could be tried before the
# code was thrown away. The frontend recognises a spent code by "send yourself
# a" (pages/Login.js, onboarding/BasicsFlow.js).
NO_CODE = "Send yourself a code first."
EXPIRED = "That code has expired — send yourself a new one."
TOO_MANY = "Too many wrong tries — send yourself a new code."


def wrong_code(left: int) -> str:
    if left <= 0:
        return "That code isn't right, and that was the last try — send yourself a new code."
    return f"That code isn't right — {left} {'try' if left == 1 else 'tries'} left."


def _refuse_spent_or_wrong(rec) -> None:
    """The refusals before a code is compared: none sent, out of date, or too
    many wrong tries already. Shared with the no-account path below so the two
    can never answer differently."""
    if not rec:
        raise HTTPException(status_code=400, detail=NO_CODE)
    if datetime.now(timezone.utc) > datetime.fromisoformat(rec["expires_at"]):
        raise HTTPException(status_code=400, detail=EXPIRED)
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail=TOO_MANY)


# Audit A-03 + A-06 -- A NUMBER WITH NO ACCOUNT COUNTS DOWN TOO. "4 tries left"
# from a real number and a flat "wrong code" from an unknown one would tell a
# stranger which numbers have accounts, the very thing A-03 closed. So asking for
# a code for an unknown number starts a count here (nothing is texted, and
# nothing goes in otp_codes), and checking a code against it answers exactly as
# a wrong code for a real number does, try by try.
async def note_request_without_account(norm: str) -> None:
    await db.otp_misses.update_one(
        {"phone": norm},
        {"$set": {"attempts": 0, "expires_at": (datetime.now(timezone.utc)
                                                + timedelta(seconds=OTP_TTL_SECONDS)).isoformat()}},
        upsert=True)


async def refuse_without_account(norm: str) -> None:
    key = {"phone": norm}
    rec = await db.otp_misses.find_one(key, {"_id": 0})
    try:
        _refuse_spent_or_wrong(rec)
    except HTTPException:
        if rec:
            await db.otp_misses.delete_one(key)     # as a spent real code is deleted
        raise
    await db.otp_misses.update_one(key, {"$inc": {"attempts": 1}})
    raise HTTPException(status_code=401, detail=wrong_code(OTP_MAX_ATTEMPTS - rec.get("attempts", 0) - 1))


async def _issue_otp(norm: str, display_phone: str, tenant_id: str, enforce_cooldown: bool = True):
    """Generate + store a 6-digit OTP for a normalized phone (scoped to a
    tenant) and try to send it.

    FIX-003-A (S2-03): the ``otp_codes`` row is keyed by
    ``(phone, tenant_id)``, not by phone alone. Two tenants that share a
    phone can each hold their own live OTP without overwriting each
    other's code. The 30s resend cooldown is likewise scoped per tenant
    — hitting the cooldown for workspace A does NOT lock the user out
    of workspace B.
    """
    if not tenant_id:
        # Defensive: every caller in the flow (request/verify/invite)
        # resolves a concrete tenant_id before calling us. A missing
        # tenant here is a code bug, not user input, so surface it
        # loudly instead of silently writing an untethered OTP.
        logger.error("[otp] refusing to issue an OTP with no tenant scope -- every caller resolves one before calling _issue_otp; this is a code bug")
        raise HTTPException(status_code=500, detail="Internal Server Error")
    key = {"phone": norm, "tenant_id": tenant_id}
    if enforce_cooldown:
        existing = await db.otp_codes.find_one(key, {"_id": 0})
        if existing:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(existing["created_at"])).total_seconds()
            if age < OTP_RESEND_COOLDOWN:
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {int(OTP_RESEND_COOLDOWN - age)}s before requesting a new code",
                )
    code = f"{secrets.randbelow(1000000):06d}"  # cryptographically secure fallback OTP
    now = datetime.now(timezone.utc)
    # Prefer the APM gateway when configured: it sends the SMS AND returns the code it generated.
    apm_code = await _apm_send_and_fetch_otp(norm)
    if apm_code:
        code = apm_code
        sent = True
        dev = False
    else:
        # 2026-09-19 — Twilio needs E.164. This used to pass the number exactly
        # as it was typed, so "98765 43210" (how most people write it) was
        # refused by Twilio and nobody got a code. Every number that reaches
        # here is a 10-digit Indian mobile, the same key the APM path texts.
        sent = await _send_otp_sms(f"+91{norm}", code)
        dev = not TWILIO_ENABLED
    await db.otp_codes.update_one(
        key,
        {
            "$set": {
                "phone": norm,
                "tenant_id": tenant_id,
                "code_hash": _hash_otp(code, norm),
                "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
                "created_at": now.isoformat(),
                "attempts": 0,
            }
        },
        upsert=True,
    )
    resp = {"sent": sent, "dev_mode": dev, "tenant_id": tenant_id}
    # FIX-006-C (S0-04): dev_otp is a REAL, WORKING code — returning it
    # in a JSON body means anyone who can hit /auth/otp/request gets a
    # login OTP for the target phone. That's fine in dev with no SMS
    # provider; in prod it's account takeover as a feature. Now gated
    # by an explicit env flag (DEV_OTP_IN_RESPONSE=1), OFF by default.
    # server.py's boot check also refuses to start in prod when no SMS
    # provider is configured, so "silently in dev mode" is impossible.
    from config import DEV_OTP_IN_RESPONSE

    if dev and DEV_OTP_IN_RESPONSE:
        resp["dev_otp"] = code
    return resp

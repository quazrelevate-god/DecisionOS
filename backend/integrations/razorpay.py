"""Razorpay provider adapter (Epic 8 Sprint 6 -- from routers/billing.py).

We deliberately depend on ZERO razorpay-python SDK: payment happens on a hosted
Checkout / Payment Link, and Razorpay calls us back via webhook. So the only
provider surface is inbound webhook verification (HMAC-SHA256 of the raw body
with RAZORPAY_WEBHOOK_SECRET) plus the "is billing wired up?" check. India is
the primary market — Razorpay, not Stripe. Imports stdlib + config only.
"""
import hmac
import hashlib

from config import RAZORPAY_KEY_ID, RAZORPAY_WEBHOOK_SECRET  # noqa: F401  (re-exported)


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    """Standard Razorpay webhook verification -- HMAC-SHA256 of the raw request
    body using RAZORPAY_WEBHOOK_SECRET, constant-time compared."""
    if not (signature and RAZORPAY_WEBHOOK_SECRET):
        return False
    expected = hmac.new(
        RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def is_configured() -> bool:
    """True when the public key id is set (used to gate checkout handoff)."""
    return bool(RAZORPAY_KEY_ID)

"""Phone-number normalization.

Extracted from `server.py` (was the private `_norm_phone`) into its own
module by FIX-002-A so:
  1. Every user-write site can call it directly instead of the underscore-
     private function inside server.py (which couldn't be imported cleanly
     from routers without a circular import).
  2. The normalization rule lives in ONE place — any future change (e.g.
     preserving country code, E.164 formatting) is one edit.

Rule: strip every non-digit character, then take the last 10 digits.
This matches the Indian mobile-number convention the app is designed
around: "+91 98200 10001", "9820010001", and "(98200) 10001" all
normalize to the same "9820010001" so a login attempt can find the user
regardless of how they typed it.

Contract:
  - Empty / None input -> "" (never raises).
  - Input shorter than 10 digits -> returns the digits as-is (callers
    upstream check len() >= 10 before treating it as valid).
  - Non-string input -> "" (safe for accidental dict/None).
"""
import re


_NON_DIGITS = re.compile(r"\D")


def norm_phone(p) -> str:
    """Normalize a phone number to its last 10 digits. Never raises.

    Same behavior as the former `_norm_phone` in server.py; kept
    identical so existing hashed OTP records (which key on this
    normalized form) still verify correctly.
    """
    if not isinstance(p, str):
        return ""
    return _NON_DIGITS.sub("", p)[-10:]

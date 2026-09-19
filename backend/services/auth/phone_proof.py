"""Proof that a signup really holds the mobile number it typed (2026-09-19).

A founder's mobile is a SIGN-IN (Mobile OTP) and a ROUTE (WhatsApp messages
from that number land in the workspace as that person). Signup used to store
whatever was typed. A one-digit slip therefore locked the founder out of
Mobile OTP — and handed the stranger who owns the mistyped number an OTP
sign-in to the workspace as its owner, with their WhatsApp messages filed as
the owner's.

So the number is confirmed with a texted code at the step where it is typed,
and /signup/phone/verify hands back this token. /auth/register trusts a phone
only with a token for that exact number. The account does not exist yet when
the code is checked, so there is no user to mark — the proof has to travel with
the signup until the account is written.

The token is signed with a key DERIVED from JWT_SECRET rather than the secret
itself: a phone proof must never be mistakable for a session token, even
though a session decode would already refuse one (no tenant claim).
"""
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt

from config import JWT_SECRET, JWT_ALGORITHM

PURPOSE = "signup_phone"
# Long enough to finish the website scan, the interview and the build, and to
# come back the next morning to a resumed signup; short enough that a proof
# is about a number someone held recently.
TTL = timedelta(hours=24)

_KEY = hashlib.sha256(f"{JWT_SECRET}|{PURPOSE}".encode()).hexdigest()


def issue_phone_proof(norm: str) -> dict:
    """Sign "this browser received a code at `norm`". Returns the token and
    when it lapses, so the screen can ask again instead of failing at the end."""
    now = datetime.now(timezone.utc)
    exp = now + TTL
    token = jwt.encode({"sub": norm, "purpose": PURPOSE, "iat": now, "exp": exp},
                       _KEY, algorithm=JWT_ALGORITHM)
    return {"phone_token": token, "expires_at": exp.isoformat()}


def read_phone_proof(token: Optional[str]) -> str:
    """The number a live proof vouches for, or "" for anything else —
    missing, expired, tampered with, or minted for another purpose."""
    if not token or not isinstance(token, str):
        return ""
    try:
        payload = jwt.decode(token, _KEY, algorithms=[JWT_ALGORITHM])
    except Exception:
        return ""
    if payload.get("purpose") != PURPOSE:
        return ""
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else ""

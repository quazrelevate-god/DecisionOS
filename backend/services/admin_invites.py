"""Admin invite links (2026-10-22, admin console redesign).

Adding an admin used to mean the inviter typing a password for them, which
then travelled by chat. Now the inviter gets a link; the new admin opens it and
sets their own password. Only the token's hash is stored, the link works once,
and it expires (routers/admin_rbac.INVITE_DAYS).
"""
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Optional

from core import db


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


async def find_invited(raw: str) -> Optional[dict]:
    """The admin this link belongs to, if the link is still good."""
    if not raw or len(raw) < 20:
        return None
    a = await db.platform_admins.find_one({"invite.token_hash": token_hash(raw)}, {"_id": 0})
    if not a or a.get("password_hash") or a.get("active") is False:
        return None
    exp = (a.get("invite") or {}).get("expires_at") or ""
    if exp and exp < datetime.now(timezone.utc).isoformat():
        return None
    return a

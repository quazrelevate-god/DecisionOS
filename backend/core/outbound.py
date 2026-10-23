"""Outbound message log (Epic 11 Sprint 7, admin console v2 P4).

One row per email / SMS / WhatsApp / push the platform tried to send: channel,
kind, workspace, person, a masked recipient and what happened (sent, failed or
skipped because the channel is not set up). Never the message body. The admin
console reads it on a customer's Support tab ("did they get the invite?").

Lives in core so the provider adapters (integrations/*) can call it without
reaching up a layer. Best-effort: logging must never break a send.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from core import db as _core_db, logger

CHANNELS = ("email", "sms", "whatsapp", "push")
STATUSES = ("sent", "failed", "skipped")


def _enabled() -> bool:
    # Tests send through these adapters constantly; they must not fill the
    # shared database with rows. A test that wants the log patches this.
    return "PYTEST_CURRENT_TEST" not in os.environ


def mask(to: Optional[str]) -> str:
    """'priya@acme.in' -> 'pr***@acme.in'; '9876543210' -> '******3210'."""
    s = str(to or "").strip()
    if not s:
        return ""
    if "@" in s:
        name, _, dom = s.partition("@")
        return f"{name[:2]}***@{dom}"
    digits = "".join(c for c in s if c.isdigit())
    return ("*" * max(len(digits) - 4, 0)) + digits[-4:] if digits else s[:2] + "***"


def real_tenant(tenant_id: Optional[str]) -> Optional[str]:
    """OTP codes live under scopes like 'login:any', '__signup__' and
    'profile:<user>'; those are not workspaces."""
    t = str(tenant_id or "")
    if not t or ":" in t or t.startswith("__"):
        return None
    return t


async def record(channel: str, kind: str, *, status: str, to=None, tenant_id: Optional[str] = None,
                 user_id: Optional[str] = None, provider: Optional[str] = None,
                 error: Optional[str] = None, count: Optional[int] = None, database=None) -> None:
    """Write one row. `to` may be a string or a list (only the first is kept,
    plus a count). Never raises."""
    if database is None and not _enabled():
        return
    try:
        if tenant_id is None:
            from core.usage import _ctx_tenant  # the request's workspace, when set
            tenant_id = _ctx_tenant.get()
        first = to[0] if isinstance(to, (list, tuple)) and to else to
        n = count if count is not None else (len(to) if isinstance(to, (list, tuple)) else (1 if to else 0))
        now = datetime.now(timezone.utc)
        doc = {
            "id": str(uuid.uuid4()),
            "at": now.isoformat(),
            "created": now,  # TTL index (180 days)
            "channel": channel if channel in CHANNELS else "email",
            "kind": (kind or "other")[:40],
            "tenant_id": real_tenant(tenant_id),
            "user_id": user_id,
            "to": mask(first),
            "count": n,
            "status": status if status in STATUSES else "failed",
            "provider": provider,
            "error": (str(error)[:120] if error else None),
        }
        await (database if database is not None else _core_db).outbound_messages.insert_one(doc)
    except Exception as e:  # pragma: no cover - logging is best-effort
        logger.warning(f"[outbound] could not log a {channel} message: {e}")

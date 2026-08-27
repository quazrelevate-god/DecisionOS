"""Unified-inbox write helper (Epic 8 Sprint 7 -- U8-07.5).

add_inbox_item was the last inbox helper still living in server.py; moved here so
the finance/complaints routers and the capture/voice services depend on a service,
not the app module. server.py re-exports it for any deferred call sites.
"""

from __future__ import annotations

from core import db, new_id, now_iso
from models.inbox import INBOX_CLASSES


async def add_inbox_item(
    tenant_id,
    created_by,
    source,
    classification,
    title,
    preview="",
    ref_type=None,
    ref_id=None,
    contact_id=None,
    amount=None,
    status="open",
):
    doc = {
        "id": new_id(),
        "tenant_id": tenant_id,
        "created_by": created_by,
        "source": source,
        "classification": classification if classification in INBOX_CLASSES else "task",
        "title": title or "Untitled",
        "preview": preview or "",
        "ref_type": ref_type,
        "ref_id": ref_id,
        "contact_id": contact_id,
        "amount": amount,
        "status": status,
        "created_at": now_iso(),
    }
    await db.inbox.insert_one(doc)
    return doc["id"]

"""WhatsApp Cloud API (Meta Graph) provider adapter (Epic 8 Sprint 6 --
from services/whatsapp.py).

Token/phone-id accessors (runtime keys) + the two Graph API calls: download an
inbound media object, and send an outbound text reply. Raw transport only — the
sender->tenant routing, event log, and ingestion pipeline stay in
services/whatsapp.py. Imports stdlib + core + integrations.base + httpx.
"""
import os

import httpx

from core import logger, get_ai_key
from integrations.base import mock_for

GRAPH_API_VERSION = os.environ.get("GRAPH_API_VERSION", "v21.0")


def wa_token() -> str:
    return get_ai_key("wa_access_token")


def wa_phone_id() -> str:
    return get_ai_key("wa_phone_number_id")


async def download_wa_media(media_id: str) -> bytes:
    """Resolve a Graph media id to its temporary URL, then fetch the bytes."""
    token = wa_token()
    ver = os.environ.get("GRAPH_API_VERSION", "v21.0")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60) as c:
        meta = (await c.get(f"https://graph.facebook.com/{ver}/{media_id}", headers=headers)).json()
        url = meta.get("url")
        if not url:
            raise Exception("media url unavailable")
        return (await c.get(url, headers=headers)).content


async def send_wa_reply(to_phone: str, text: str):
    """Send a text message to a WhatsApp user. No-op if the number/token aren't
    configured; never raises (a failed reply must not break inbound handling)."""
    _mock = mock_for("whatsapp", "send")
    if _mock is not None:
        return _mock(to_phone, text)
    token = wa_token()
    pnid = wa_phone_id()
    ver = os.environ.get("GRAPH_API_VERSION", "v21.0")
    if not (token and pnid):
        return
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            await c.post(f"https://graph.facebook.com/{ver}/{pnid}/messages",
                         headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                         json={"messaging_product": "whatsapp", "to": to_phone, "type": "text", "text": {"body": text}})
    except Exception:
        logger.exception("WhatsApp reply failed")

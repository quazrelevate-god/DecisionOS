"""WhatsApp Cloud API webhook + status/logs (Epic 8 Sprint 3 -- from server.py).

Meta verification handshake, the HMAC-verified inbound webhook (queues
process_whatsapp_message), connection status, and the tenant event log.
WA infra helpers (log_wa_event, update_wa_event, process_whatsapp_message,
resolve_wa_tenant, _norm_phone, wa_token/wa_phone_id) stay in server.
"""
import os
import re
import json
import hmac
import hashlib

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, BackgroundTasks

from core import db, get_current_user, logger
from server import log_wa_event, process_whatsapp_message, wa_token, wa_phone_id  # cross-domain

router = APIRouter(prefix="/api")


@router.get("/webhooks/whatsapp")
async def whatsapp_verify(request: Request):
    # Meta webhook verification handshake
    params = request.query_params
    if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == os.environ.get("WA_VERIFY_TOKEN"):
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/webhooks/whatsapp")
async def whatsapp_webhook(request: Request, background: BackgroundTasks):
    """FIX-006-C (S0-05): the whole point of Meta's HMAC signature is
    that the recipient REJECTS mismatches. Old code logged and processed
    anyway — equivalent to shipping without a signature check at all,
    which meant anyone who could reach the public webhook URL could
    forge inbound WhatsApp messages (spoof any tenant's contact, inject
    fake orders / expenses via the AI ingestion pipeline).

    New behaviour:
      * WA_APP_SECRET set + signature matches → process (unchanged).
      * WA_APP_SECRET set + signature mismatch → 403, no processing.
      * WA_APP_SECRET absent → refuse the webhook entirely in prod
        (ENV=prod). Dev/staging accept with a stern WARN so local
        tunnels still work during integration testing.
    """
    if not os.environ.get("WA_ACCESS_TOKEN"):
        return {"status": "not_configured",
                "detail": "WhatsApp ingestion is ready but not connected. Add WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID / WA_VERIFY_TOKEN to enable."}
    raw = await request.body()
    app_secret = os.environ.get("WA_APP_SECRET")
    running_env = os.environ.get("ENV", "dev").strip().lower()
    if app_secret:
        sig = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            # Audit BEFORE the reject so ops can see the attack surface.
            await log_wa_event(
                "", "", "signature_mismatch",
                reason=("X-Hub-Signature-256 did not match — REJECTED. If a "
                        "proxy/ingress re-encodes bodies, disable that or "
                        "recompute WA_APP_SECRET after decoding."),
            )
            logger.warning("WhatsApp signature mismatch — rejecting (S0-05)")
            raise HTTPException(status_code=403, detail="Invalid signature")
    elif running_env == "prod":
        # No secret configured AND we're in prod — refuse. Anyone who
        # can reach the URL could otherwise post forged messages.
        logger.error(
            "S0-05: /webhooks/whatsapp rejected in prod — WA_APP_SECRET "
            "is not set. Configure it before re-enabling ingestion."
        )
        raise HTTPException(
            status_code=503,
            detail="WhatsApp webhook rejected: WA_APP_SECRET not configured.",
        )
    else:
        logger.warning(
            "S0-05: /webhooks/whatsapp accepted WITHOUT signature check "
            "(WA_APP_SECRET not set + ENV != prod). Local tunnel only — "
            "set WA_APP_SECRET before touching prod."
        )
    try:
        body = json.loads(raw)
    except Exception:
        return {"status": "ok"}
    for entry in body.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for message in value.get("messages", []):
                background.add_task(process_whatsapp_message, message)
    return {"status": "ok"}


@router.get("/whatsapp/status")
async def whatsapp_status(user: dict = Depends(get_current_user)):
    token = wa_token()
    pnid = wa_phone_id()
    out = {
        "configured": bool(token and pnid),
        "has_token": bool(token), "has_phone_id": bool(pnid),
        "has_verify_token": bool(os.environ.get("WA_VERIFY_TOKEN")),
        "has_app_secret": bool(os.environ.get("WA_APP_SECRET")),
        "has_fallback_tenant": bool(os.environ.get("WA_TENANT_ID")),
        "phone_number_id": pnid, "display_number": None, "wa_number": None,
        "verified_name": None, "token_error": None,
    }
    if token and pnid:
        try:
            ver = os.environ.get("GRAPH_API_VERSION", "v21.0")
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(f"https://graph.facebook.com/{ver}/{pnid}",
                                params={"fields": "display_phone_number,verified_name", "access_token": token})
                d = r.json()
            if d.get("error"):
                out["token_error"] = d["error"].get("message", "token error")
            dn = d.get("display_phone_number")
            if dn:
                out["display_number"] = dn
                out["wa_number"] = re.sub(r"\D", "", dn)
                out["verified_name"] = d.get("verified_name")
        except Exception as e:
            out["token_error"] = str(e)[:150]
    # Fallback so the QR/number still renders if the live Graph check fails or is misconfigured.
    if not out["wa_number"]:
        fb = os.environ.get("WA_DISPLAY_NUMBER")
        if fb:
            out["display_number"] = fb
            out["wa_number"] = re.sub(r"\D", "", fb)
    return out


@router.get("/whatsapp/logs")
async def whatsapp_logs(user: dict = Depends(get_current_user)):
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    tid = user["tenant_id"]
    # FIX-003-A / S2-04: strict tenant filter. The old code OR-included
    # events with tenant_id=None (received-but-unrouted messages) — that
    # leaked platform-wide unrouted traffic (senders, timestamps,
    # message types from OTHER tenants' potential customers) into every
    # tenant's log view. Unrouted events belong to platform ops, not
    # to any single tenant, so they're hidden from tenant-facing UI.
    rows = await db.wa_events.find(
        {"tenant_id": tid}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return rows

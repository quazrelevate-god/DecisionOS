"""WhatsApp Cloud API integration + inbound message pipeline (Epic 8 Sprint 4
-- from server.py).

Token/phone-id accessors, inbound event log, sender->tenant routing (with
cross-tenant collision safety), media download, outbound reply, and the
image/document/text/voice ingestion pipeline that triages -> capture draft ->
auto-file or review. Sits at the top of the service stack: pulls from captures,
ingestion, transcription, notifications; nothing imports it back.
"""
import os
import re

import httpx

from core import db, logger, new_id, now_iso, get_ai_key, set_usage_tenant, tenant_role_keys
from services.notifications import push_notification, _owner_ids
from services.transcription import transcribe_audio_full
from services.ingestion import (
    _tenant_currency, _tenant_name, ai_extract_document,
    _find_duplicate_invoice, _has_unclassified_purchase,
)
from services.captures import (
    _capture_settings, persist_capture_draft, execute_capture, ai_capture_triage,
    _needs_owner_review, _decide_processing_level, DOC_CLASS,
)


def wa_token() -> str:
    return get_ai_key("wa_access_token")


def wa_phone_id() -> str:
    return get_ai_key("wa_phone_number_id")


async def log_wa_event(from_phone: str, mtype: str, status: str, reason: str = "", tenant_id=None, summary: str = ""):
    ev_id = new_id()
    try:
        await db.wa_events.insert_one({
            "id": ev_id, "direction": "inbound", "from": from_phone or "", "mtype": mtype or "",
            "status": status, "reason": reason, "tenant_id": tenant_id, "summary": summary,
            "created_at": now_iso(),
        })
    except Exception:
        logger.exception("wa event log failed")
    return ev_id


async def update_wa_event(ev_id: str, **fields):
    if not ev_id:
        return
    try:
        await db.wa_events.update_one({"id": ev_id}, {"$set": {**fields, "updated_at": now_iso()}})
    except Exception:
        pass


def _norm_phone(p: str) -> str:
    return re.sub(r"\D", "", p or "")[-10:]


async def resolve_wa_tenant(sender: str):
    """Route an inbound WhatsApp sender's phone to a tenant workspace.

    Ordering:
      1. Sender phone matches exactly one tenant (across non-obsolete
         users) — route there. If that tenant has a within-tenant
         duplicate (same phone on 2+ users in the SAME workspace),
         resolve it by marking older duplicates obsolete inside that
         tenant only — that's a legitimate cleanup because the
         workspace itself has redundant records.
      2. Sender phone matches users in MULTIPLE tenants — a legitimate
         SME scenario (accountant/consultant serves multiple client
         workspaces on one phone). We CANNOT silently pick a winner:
         picking one and marking the other's user obsolete orphans
         that workspace's WhatsApp routing until an admin notices.
         Instead: log a warning, notify each affected tenant's owner
         so both know the collision exists, and fall through to the
         WA_TENANT_ID fallback (or drop if no fallback is set).
      3. Legacy: sender matches an invited_employees entry on a tenant
         doc that predates the users-first flow. Kept for back-compat
         with pre-v0.8 tenants.
      4. WA_TENANT_ID env fallback (or None → message is dropped).

    FIX-003-A (S2-03) changed step 2. The prior code silently promoted
    the newest user and marked ALL other cross-tenant users obsolete,
    which was a hard multi-tenant safety break: the "losing" tenant's
    WhatsApp routing was severed with no visible signal to their owner.
    """
    sp = _norm_phone(sender)
    if not sp:
        return os.environ.get("WA_TENANT_ID") or None
    # FIX-002-A: indexed exact-match lookup + exclude obsolete records at the
    # DB level. Was a full-collection scan of every user across every tenant
    # (silently capped at 5000, so user #5001+ never got matched).
    matches = await db.users.find(
        {"phone_norm": sp, "wa_phone_obsolete": {"$ne": True}},
        {"_id": 0, "id": 1, "tenant_id": 1, "phone": 1, "name": 1, "created_at": 1},
    ).to_list(50)
    if matches:
        distinct_tenants = {m["tenant_id"] for m in matches}
        if len(distinct_tenants) > 1:
            # FIX-003-A: cross-tenant collision. Alert BOTH tenants and
            # fall back to WA_TENANT_ID — never orphan any workspace's
            # WhatsApp routing implicitly.
            fallback = os.environ.get("WA_TENANT_ID") or None
            logger.warning(
                "[WHATSAPP] Sender %s matches users across %d tenants (%s); "
                "routing to WA_TENANT_ID=%s (fallback). No user was marked obsolete.",
                sender, len(distinct_tenants), sorted(distinct_tenants), fallback,
            )
            for tid in distinct_tenants:
                try:
                    await push_notification(
                        tid, await _owner_ids(tid), 2,
                        f"Incoming WhatsApp from {sender} could not be routed to your workspace unambiguously — "
                        f"this number is also registered in another workspace. Ask the sender to remove one "
                        f"registration, or configure a dedicated WhatsApp number per workspace.",
                        "whatsapp", None, ntype="reminder",
                        title="WhatsApp cross-workspace conflict", sender="System",
                    )
                except Exception:
                    # Notification failure must not break routing — the
                    # log line above is the durable record.
                    logger.exception("[WHATSAPP] cross-tenant collision notify failed for %s", tid)
            return fallback
        tenant_id = matches[0]["tenant_id"]
        # WITHIN-tenant duplicates: the same workspace has 2+ users on
        # this phone. That's a workspace-internal cleanup — the tenant
        # guard on update_many makes sure we CANNOT accidentally touch
        # another tenant's user rows.
        same_tenant = [m for m in matches if m["tenant_id"] == tenant_id]
        if len(same_tenant) > 1:
            same_tenant.sort(key=lambda u: u.get("created_at") or "", reverse=True)
            latest, older = same_tenant[0], same_tenant[1:]
            await db.users.update_many(
                # tenant_id filter is defensive: at this point all rows
                # share the same tenant, but if the query ever grows a
                # cross-tenant leak we want update_many to fail closed.
                {"id": {"$in": [u["id"] for u in older]}, "tenant_id": tenant_id},
                {"$set": {"wa_phone_obsolete": True, "updated_at": now_iso()}},
            )
            await push_notification(
                tenant_id, await _owner_ids(tenant_id), 2,
                f"WhatsApp number {sender} was linked to {len(same_tenant)} people in this workspace. "
                f"Routing to the most recent — {latest.get('name')}. {len(older)} older record(s) marked "
                f"obsolete; please review in People.",
                "user", latest["id"], ntype="reminder",
                title="Duplicate WhatsApp number resolved", sender="System")
        return tenant_id
    # Secondary: legacy invited_employees list on the tenant document.
    # Same cross-tenant concern applies — collect all matches first,
    # then decide. In practice this list is small (pre-v0.8 tenants).
    invited_hits = []
    async for t in db.tenants.find({"invited_employees.0": {"$exists": True}}, {"_id": 0, "id": 1, "invited_employees": 1}):
        for inv in t.get("invited_employees", []):
            if _norm_phone(inv.get("phone")) == sp:
                invited_hits.append(t["id"])
                break
    if len(invited_hits) == 1:
        return invited_hits[0]
    if len(invited_hits) > 1:
        logger.warning(
            "[WHATSAPP] Sender %s matches invited_employees entries in %d tenants (%s); "
            "falling back to WA_TENANT_ID.",
            sender, len(invited_hits), invited_hits,
        )
    return os.environ.get("WA_TENANT_ID") or None


async def download_wa_media(media_id: str) -> bytes:
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


WA_MIME_EXT = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def process_whatsapp_message(message: dict):
    sender = message.get("from", "")
    mtype = message.get("type")
    ev_id = await log_wa_event(sender, mtype, "received")
    try:
        tenant_id = await resolve_wa_tenant(sender)
        if not tenant_id:
            await update_wa_event(ev_id, status="ignored", reason="Sender not registered in any workspace and no fallback (WA_TENANT_ID) is set")
            logger.info(f"[WHATSAPP] no tenant for {sender}; ignoring")
            return
        await update_wa_event(ev_id, tenant_id=tenant_id)
        set_usage_tenant(tenant_id)
        owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1})
        owner_id = owner["id"] if owner else "whatsapp"
        troles = await tenant_role_keys(tenant_id)
        cap_threshold, _cap_signoff = await _capture_settings(tenant_id)

        if mtype in ("image", "document"):
            media = message[mtype]
            mime = media.get("mime_type", "application/pdf" if mtype == "document" else "image/jpeg").split(";")[0]
            if mime not in WA_MIME_EXT:
                await update_wa_event(ev_id, status="ignored", reason=f"Unsupported media type: {mime}")
                await send_wa_reply(sender, "Sorry, I can only read PDF or image invoices/receipts.")
                return
            ext = WA_MIME_EXT[mime]
            data = await download_wa_media(media["id"])
            ing_id = new_id()
            # FIX-002-E: obj_store with tenant prefix. `ai_extract_document`
            # accepts a local path; we materialize to a temp file for it
            # then clean up. Storage_path is saved in the capture draft so
            # the review UI can render it via the auth-gated /api/files
            # endpoint.
            from services.uploads import store_upload, download_to_temp
            import tempfile
            stored = await store_upload(tenant_id, "ingestions", data, ext,
                                         content_type=mime, file_id=ing_id)
            fname = f"ingest_{ing_id}.{ext}"  # kept for capture_draft display
            tmp_local = await download_to_temp(stored["storage_path"])
            currency = await _tenant_currency(tenant_id)
            company = await _tenant_name(tenant_id)
            try:
                result = await ai_extract_document(str(tmp_local), mime, f"ingest-{ing_id}", currency, company)
            finally:
                try:
                    os.unlink(tmp_local)
                except Exception:
                    pass
            recs = result.get("records", {})
            amt = 0
            for it in (recs.get("invoices", []) + recs.get("payments", [])):
                try:
                    amt = max(amt, float(it.get("amount") or 0))
                except Exception:
                    pass
            cls = DOC_CLASS.get(result.get("doc_type"), "invoice")
            dept = "finance" if cls in ("invoice", "payment") else ("purchase" if cls == "purchase" else "sales")
            confidence = float(result.get("confidence") or 0.7)
            policy = cls in ("approval", "decision")
            needs_owner = _needs_owner_review(cls, amt or None, policy, cap_threshold)
            has_records = bool(recs.get("invoices") or recs.get("payments"))
            dup = await _find_duplicate_invoice(tenant_id, recs)
            unknown_purchase = _has_unclassified_purchase(recs, result.get("doc_type", ""))
            level, reason = _decide_processing_level(cls, confidence, amt or None, needs_owner,
                                                     bool(dup), has_records, is_document=True,
                                                     has_unknown_purchase=unknown_purchase)
            tri = {"classification": cls, "intent": result.get("doc_type", "document"),
                   "summary": result.get("summary", ""), "department": dept,
                   "priority": "medium", "amount": amt or None}
            status = "needs_attention" if level == "attention" else "pending_review"
            did = await persist_capture_draft(
                tenant_id, sender, ("pdf" if ext == "pdf" else "image"),
                {"file_url": f"/api/files/{fname}", "filename": media.get("filename") or fname,
                 "storage_path": stored["storage_path"]},  # FIX-002-E: real obj_store key
                tri, troles, records=recs, status=status, confidence=confidence,
                processing_level=level, duplicate_of=(dup["id"] if dup else None), attention_reason=reason)
            summary = result.get("summary") or fname
            if level == "auto":
                draft = await db.capture_drafts.find_one({"id": did}, {"_id": 0})
                res = await execute_capture(draft, {"id": owner_id, "tenant_id": tenant_id, "role": "owner"})
                await db.capture_drafts.update_one({"id": did}, {"$set": {
                    "status": "executed", "review_action": "auto", "auto_processed": True,
                    "reviewed_at": now_iso(), "result_ref": res}})
                await update_wa_event(ev_id, status="filed", summary=summary)
                await send_wa_reply(sender, "✅ Filed automatically — high confidence, low risk. Reply here if anything looks off and the team will fix it.")
            elif level == "attention":
                await update_wa_event(ev_id, status="attention", summary=summary)
                await send_wa_reply(sender, "📎 Received — this one needs a quick check by the team before it's filed. We'll follow up if anything's unclear.")
            else:
                await update_wa_event(ev_id, status="draft", summary=summary)
                await send_wa_reply(sender, "📎 Received — your document is being reviewed by the right team before it's filed.")

        elif mtype == "text":
            # S5-05 audit fix (2026-08-16): guarded key access. WA
            # webhooks are public; a malformed text message (Meta bug,
            # deep-link handler, template response) would crash this
            # handler with KeyError -> 500 back to Meta -> they retry
            # -> we crash again. Missing body is treated as an empty
            # message and short-circuited to the "unrelated" path.
            text = ((message.get("text") or {}).get("body") or "").strip()
            if not text:
                await update_wa_event(ev_id, status="ignored", reason="Empty text body")
                return
            tri = await ai_capture_triage(text, sorted(troles))
            if tri.get("unrelated"):
                await update_wa_event(ev_id, status="ignored", reason="Unrelated / not a business instruction")
                await send_wa_reply(sender, "🤔 I couldn't tell what to do with this. If it's a task, invoice or a note for your team, send it again with a short instruction and I'll route it to the right department.")
                return
            confidence = tri.get("confidence", 0.7)
            amount = tri.get("amount") if isinstance(tri.get("amount"), (int, float)) else None
            cls = tri.get("classification", "other")
            needs_owner = _needs_owner_review(cls, amount, tri.get("policy_or_high_risk"), cap_threshold)
            level, reason = _decide_processing_level(cls, confidence, amount, needs_owner,
                                                     False, False, is_document=False)
            status = "needs_attention" if level == "attention" else "pending_review"
            did = await persist_capture_draft(tenant_id, sender, "text", {"text": text}, tri, troles,
                                              status=status, confidence=confidence,
                                              processing_level=level, attention_reason=reason)
            if level == "attention":
                await update_wa_event(ev_id, status="attention", summary=text[:140])
                await send_wa_reply(sender, "📎 Received — this needs a quick check by the team before we action it.")
            else:
                await update_wa_event(ev_id, status="draft", summary=text[:140])
                await send_wa_reply(sender, "✅ Received — your message is being reviewed by the right team before action.")
        elif mtype in ("audio", "voice"):
            media = message[mtype]
            data = await download_wa_media(media["id"])
            ext = (media.get("mime_type", "audio/ogg").split(";")[0].split("/")[-1]) or "ogg"
            # FIX-002-E: obj_store with tenant prefix. transcribe_audio_full
            # accepts obj_store keys directly (downloads to temp internally).
            from services.uploads import store_upload
            _wa_stored = await store_upload(tenant_id, "ingestions", data, ext,
                                             content_type=media.get("mime_type"))
            stt = await transcribe_audio_full(_wa_stored["storage_path"], "auto")
            text = (stt.get("transcript") or "").strip()
            lang_name = stt.get("language_name") or ""
            if not text:
                await update_wa_event(ev_id, status="ignored", reason="Voice note could not be transcribed")
                await send_wa_reply(sender, "🎙️ I couldn't make out your voice note. Please try again in a quieter spot or send it as text.")
                return
            tri = await ai_capture_triage(text, sorted(troles))
            if tri.get("unrelated"):
                await update_wa_event(ev_id, status="ignored", reason="Unrelated / not a business instruction")
                await send_wa_reply(sender, "🤔 I couldn't tell what to do with this voice note. Try again with a short instruction for your team.")
                return
            confidence = tri.get("confidence", 0.7)
            amount = tri.get("amount") if isinstance(tri.get("amount"), (int, float)) else None
            cls = tri.get("classification", "other")
            needs_owner = _needs_owner_review(cls, amount, tri.get("policy_or_high_risk"), cap_threshold)
            level, reason = _decide_processing_level(cls, confidence, amount, needs_owner,
                                                     False, False, is_document=False)
            status = "needs_attention" if level == "attention" else "pending_review"
            did = await persist_capture_draft(tenant_id, sender, "voice",
                                              {"text": text, "detected_language_name": lang_name, "stt_engine": stt.get("engine")},
                                              tri, troles, status=status, confidence=confidence,
                                              processing_level=level, attention_reason=reason)
            lang_tag = f" (heard in {lang_name})" if lang_name and lang_name != "English" else ""
            if level == "attention":
                await update_wa_event(ev_id, status="attention", summary=text[:140])
                await send_wa_reply(sender, f"🎙️ Voice note received{lang_tag} — this needs a quick check by the team before we action it.")
            else:
                await update_wa_event(ev_id, status="draft", summary=text[:140])
                await send_wa_reply(sender, f"🎙️ Voice note received{lang_tag} — your message is being reviewed by the right team before action.")
        else:
            await update_wa_event(ev_id, status="ignored", reason=f"Unsupported message type: {mtype}")
    except Exception as e:
        await update_wa_event(ev_id, status="error", reason=str(e)[:200])
        logger.exception("process_whatsapp_message failed")
        await send_wa_reply(sender, "Sorry, I couldn't process that. Please try again.")

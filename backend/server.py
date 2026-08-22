from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import json
import hmac
import asyncio
import smtplib
import ssl
import secrets
import hashlib
import logging
import httpx
from email.message import EmailMessage
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, BackgroundTasks, Response
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
from emergentintegrations.llm.openai import OpenAISpeechToText
from services import obj_store
from services.ai import brain_context

from core import (
    db, client, logger, DEFAULT_ROLES,
    EMERGENT_LLM_KEY, LLM_MODEL, VISION_MODEL,
    get_ai_key,
    claude_chat, set_usage_tenant, log_usage, _est_tokens, _OPENAI_STT_PER_MIN, _SARVAM_STT_PER_MIN,
    load_ai_keys_from_db,
    now_iso, new_id, _extract_json,
    hash_password, verify_password, create_token,
    set_auth_cookie, clear_auth_cookie, login_response,
    get_current_user, require_role, require_perm, user_perms, clean_perms,
    tenant_role_keys, log_activity, add_decision_event, normalize_os_blueprint,
    normalize_lexicon,
    normalize_operating_model, DEFAULT_OPERATING_MODEL,
    PERMISSION_KEYS,
)

# ---------------------------------------------------------------------------
# Config: foundation (db, auth, permissions, helpers) lives in core.py and is
# imported explicitly at the top of this module.
# ---------------------------------------------------------------------------
app = FastAPI(title="DecisionOS")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
# Request models consolidated into the models/ package (Epic 8 Sprint 5).
# Re-exported here so tests + server's own legacy helpers keep resolving
# `from server import <Model>`; routers now import from models/ directly.
# RegisterInput / LoginInput / UserCreateInput / UserUpdateInput / AttendanceInput
# were dead duplicates (routers/auth.py + models/team.py own the live versions)
# and were removed in Sprint 5.
from models.tenant import RoleItem, ProductItem, TenantUpdateInput, InviteInput  # noqa: F401
from models.auth import OtpRequestInput, OtpVerifyInput  # noqa: F401
from models.voice import TextNoteInput  # noqa: F401


TASK_TYPES = {"operational", "sales", "purchase", "production", "finance", "hr", "other"}
# Task status vocabulary now lives in `services/tasks.py` (Phase B step 4).
from services.tasks import TASK_STATUSES  # noqa: F401


# TaskCreateInput + TaskUpdateInput now live in `models/tasks.py` (Phase B).
from models.tasks import TaskCreateInput, TaskUpdateInput  # noqa: F401


from models.brain import AskInput  # noqa: F401  (Epic 8 S5; used by _ask_ai_legacy below)


CONTACT_TYPES = ("customer", "dealer", "vendor")
CONTACT_STATUS = ("lead", "active", "inactive")


# Epic 2 Sprint 1 (E2-03): relationship lifecycle stages. Enum differs
# by contact type -- customers have a sales-funnel journey, suppliers
# have a procurement journey. Backend accepts any value in the UNION so
# a single validator works regardless of type; the CRM frontend renders
# type-appropriate options. Empty string is allowed (means "unset").
CUSTOMER_STAGES = ["lead", "qualified", "active", "at_risk", "churned"]
SUPPLIER_STAGES = ["prospect", "active", "preferred", "on_hold", "retired"]
LIFECYCLE_STAGES = list({*CUSTOMER_STAGES, *SUPPLIER_STAGES}) + [""]


# ---------------------------------------------------------------------------
# Workflow definitions
# ---------------------------------------------------------------------------
WORKFLOW_STAGES = {
    "production": ["order_received", "confirmed", "in_production", "ready"],
    "distribution": ["ready_to_dispatch", "dispatched", "in_transit", "delivered"],
    "purchase_payment": ["requested", "approved", "ordered", "received", "payment_pending", "paid"],
    # legacy (kept so pre-split cards still render/advance); AI no longer creates these
    "sales_dispatch": ["order_received", "confirmed", "in_production", "ready", "dispatched", "delivered"],
}
WORKFLOW_OWNER_ROLE = {
    "production": {"order_received": "sales", "confirmed": "sales", "in_production": "production", "ready": "production"},
    "distribution": {"ready_to_dispatch": "production", "dispatched": "sales", "in_transit": "sales", "delivered": "sales"},
    "purchase_payment": {"requested": "production", "approved": "owner", "ordered": "production",
                         "received": "production", "payment_pending": "finance", "paid": "finance"},
    "sales_dispatch": {"order_received": "sales", "confirmed": "sales", "in_production": "production",
                        "ready": "production", "dispatched": "sales", "delivered": "sales"},
}


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Unified Inbox
# ---------------------------------------------------------------------------
# Inbox classifications live in `models/inbox.py` (Phase B step 6).
from models.inbox import INBOX_CLASSES  # noqa: F401


async def add_inbox_item(tenant_id, created_by, source, classification, title,
                         preview="", ref_type=None, ref_id=None, contact_id=None,
                         amount=None, status="open"):
    doc = {
        "id": new_id(), "tenant_id": tenant_id, "created_by": created_by,
        "source": source, "classification": classification if classification in INBOX_CLASSES else "task",
        "title": title or "Untitled", "preview": preview or "",
        "ref_type": ref_type, "ref_id": ref_id, "contact_id": contact_id,
        "amount": amount, "status": status, "created_at": now_iso(),
    }
    await db.inbox.insert_one(doc)
    return doc["id"]


# ---------------------------------------------------------------------------
# AI helpers
# ---------------------------------------------------------------------------
# AI text-extraction + scoring engines moved to services/ai/extraction.py
# (Epic 8 Sprint 4). Re-exported below so deferred `from server import ai_*`
# call sites keep resolving.
from services.ai.extraction import (  # noqa: E402
    ai_extract, ai_score_tasks, ai_score_contact,
    ai_meeting_notes, ai_execution_plan, ai_step_assist,
)


# Voice-note pipeline moved to services/voice.py (Epic 8 Sprint 4). Re-exported
# so deferred `from server import ...` call sites keep resolving.
from services.voice import (  # noqa: E402
    process_voice_note, match_member_by_name, pick_least_loaded_member,
    _resolve_meeting_date, _create_decision_tasks, _create_reminders_and_memory,
    _create_meetings, _create_workflows,
)

# STT/transcription moved to services/transcription.py and Gemini/vision to
# services/vision.py (Epic 8 Sprint 4). Re-exported so deferred + module-top
# `from server import ...` call sites keep resolving.
from services.transcription import (  # noqa: E402
    get_openai_stt_client, transcribe_audio, transcribe_audio_full,
    _transcribe_audio_full_local, _log_stt_usage, _stt_lang_prompt,
    _lang_name, _sarvam_mime, _sarvam_stt_sync, _sarvam_batch_sync,
    OPENAI_STT_MODEL, SARVAM_API_KEY, SARVAM_STT_MODEL,
)
from services.vision import (  # noqa: E402
    get_gemini_client, _gemini_doc_sync, _gemini_read_sync, ai_read_image_general,
)



# OpenAI STT + Gemini OCR clients are created lazily from the CURRENT runtime key
# (so a platform-admin key update takes effect without a restart).











































# ---------------------------------------------------------------------------
# Voice note processing pipeline
# ---------------------------------------------------------------------------
















# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
# Document ingestion (AI extract + purchase classify + commit engine) moved to
# services/ingestion.py (Epic 8 Sprint 4). Re-exported so deferred `from server
# import ...` call sites keep resolving.
from services.ingestion import (  # noqa: E402
    ai_extract_document, ai_map_spreadsheet, ai_classify_purchase,
    commit_ingestion_records, _classify_ingestion, _find_duplicate_invoice,
    _has_unclassified_purchase, _normalise_records, _norm_company,
    _tenant_currency, _tenant_name, _purchase_class_sys, DOC_MIME,
)
# WhatsApp infra + inbound pipeline moved to services/whatsapp.py (Epic 8
# Sprint 4). Re-exported so deferred `from server import ...` resolves
# (whatsapp router + team._norm_phone + captures/finance wa helpers).
from services.whatsapp import (  # noqa: E402
    wa_token, wa_phone_id, log_wa_event, update_wa_event, _norm_phone,
    resolve_wa_tenant, download_wa_media, send_wa_reply, process_whatsapp_message,
)


# AI generators (lexicon/operating-model/finance-cats) + lang_directive moved to
# services/ai/generators.py (Epic 8 Sprint 4). Re-exported so deferred + bare
# `from server import ...` call sites keep resolving.
from services.ai.generators import (  # noqa: E402
    lang_directive, LANG_NAMES, ai_generate_lexicon, ai_generate_operating_model,
    tenant_operating_model, normalize_finance_categories,
    ai_generate_finance_categories, backfill_operating_model,
)





















# ---------------------------------------------------------------------------
# Mobile + OTP login (alternate auth). DEV mode returns OTP until Twilio keys added.
# ---------------------------------------------------------------------------
OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN = 30
TWILIO_ENABLED = bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN") and os.environ.get("TWILIO_FROM_NUMBER"))
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
            raise HTTPException(status_code=502, detail="SMS provider returned an unexpected response")
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
            from_=os.environ["TWILIO_FROM_NUMBER"], to=phone,
        )
        return True
    except Exception as e:
        logging.error(f"Twilio OTP send failed: {e}")
        return False


async def _issue_otp(norm: str, display_phone: str, tenant_id: str,
                     enforce_cooldown: bool = True):
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
        raise HTTPException(status_code=500, detail="Internal error: OTP issued without tenant scope")
    key = {"phone": norm, "tenant_id": tenant_id}
    if enforce_cooldown:
        existing = await db.otp_codes.find_one(key, {"_id": 0})
        if existing:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(existing["created_at"])).total_seconds()
            if age < OTP_RESEND_COOLDOWN:
                raise HTTPException(status_code=429, detail=f"Please wait {int(OTP_RESEND_COOLDOWN - age)}s before requesting a new code")
    code = f"{secrets.randbelow(1000000):06d}"  # cryptographically secure fallback OTP
    now = datetime.now(timezone.utc)
    # Prefer the APM gateway when configured: it sends the SMS AND returns the code it generated.
    apm_code = await _apm_send_and_fetch_otp(norm)
    if apm_code:
        code = apm_code
        sent = True
        dev = False
    else:
        sent = await _send_otp_sms(display_phone, code)
        dev = not TWILIO_ENABLED
    await db.otp_codes.update_one(
        key,
        {"$set": {"phone": norm, "tenant_id": tenant_id,
                  "code_hash": _hash_otp(code, norm),
                  "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
                  "created_at": now.isoformat(), "attempts": 0}},
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


# enrich_contacts moved to services/enrich.py (Epic 8 Sprint 4); see the
# consolidated `from services.enrich import ...` re-export below.


# ---------------------------------------------------------------------------
# Voice notes / ingestion
# ---------------------------------------------------------------------------
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Meeting Notes
# ---------------------------------------------------------------------------
# process_meeting moved to services/meetings.py; operating-score/coach engine
# moved to services/operating_score.py (Epic 8 Sprint 4). Re-exported so
# deferred `from server import ...` call sites keep resolving.
from services.meetings import process_meeting  # noqa: E402
from services.operating_score import (  # noqa: E402
    _company_operating_view, _self_operating_view, compute_employee_stats,
    ai_work_coach, _resolve_coach_target, _score_execution, _score_sales,
    _score_employees, _clamp100, _is_open_task,
)


# ---------------------------------------------------------------------------
# Operating Score
# ---------------------------------------------------------------------------














# ---------------------------------------------------------------------------
# Personal AI Work Coach
# ---------------------------------------------------------------------------






# Decisions
# ---------------------------------------------------------------------------
# enrich_decision / enrich_decisions moved to services/enrich.py (Epic 8
# Sprint 4). Re-exported here (after services.tasks.enrich_tasks is imported
# below) so deferred + module-top `from server import enrich_*` keep resolving.


# Decisions endpoints moved to routers/decisions.py in Phase B step 3.
# The router is wired in via app.include_router(decisions_router) below.



# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
# Task enrichment + permission helpers now live in `services/tasks.py` (Phase B step 4).
# Re-exported here so the still-monolithic complex task/approval/reassign endpoints
# below (and other domains: brief, inbox, followups) keep working unchanged.
from services.tasks import (  # noqa: E402, F401
    _derive_task_type,
    _task_activity,
    enrich_task,
    enrich_tasks,
)


# All /api/tasks/* endpoints moved to routers/tasks.py in Phase B step 5.
# Task Pydantic inputs live in models/tasks.py; helpers in services/tasks.py.
# _tenant_industry, _attach_reference_ids re-exported here because a few
# non-task endpoints (POST /capture/*, decision-capture) still call them.
from services.tasks import _tenant_industry, _attach_reference_ids  # noqa: E402, F401


# Read-model enrichment moved to services/enrich.py (Epic 8 Sprint 4).
from services.enrich import enrich_contacts, enrich_decision, enrich_decisions  # noqa: E402, F401



# ---------------------------------------------------------------------------
# Ask AI  →  superseded by routers/brain.py (Company Brain Phase-1 pipeline).
# Kept un-registered (no route) for reference; /api/ask is now served by brain.py.
# ---------------------------------------------------------------------------
async def _ask_ai_legacy(inp: AskInput, user: dict):
    tid = user["tenant_id"]
    uid = user.get("id")
    urole = user.get("role")
    can_finance = _brain_can_finance(user)
    privileged = _brain_privileged(user)

    # Tasks: non-privileged users are limited to their own department (own / their role / created by them).
    task_q = {"tenant_id": tid}
    if not privileged:
        task_q["$or"] = [{"assignee_id": uid}, {"assignee_role": urole}, {"created_by": uid}]

    decisions = await db.decisions.find({"tenant_id": tid}, {"_id": 0, "title": 1, "summary": 1, "status": 1}).sort("created_at", -1).to_list(60)
    tasks = await db.tasks.find(task_q, {"_id": 0, "title": 1, "status": 1, "assignee_role": 1, "due_date": 1}).sort("created_at", -1).to_list(120)
    workflows = await db.workflows.find({"tenant_id": tid}, {"_id": 0, "title": 1, "type": 1, "stage": 1, "amount": 1, "counterparty": 1}).sort("created_at", -1).to_list(60)
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "name": 1, "role": 1}).to_list(60)
    contacts = await db.contacts.find({"tenant_id": tid}, {"_id": 0, "name": 1, "company": 1, "type": 1, "status": 1, "phone": 1, "email": 1}).sort("created_at", -1).to_list(100)
    memory = await db.memory.find({"tenant_id": tid}, {"_id": 0, "text": 1, "tag": 1}).sort("created_at", -1).to_list(100)

    # Hide workflow money figures from non-finance roles.
    if not can_finance:
        for w in workflows:
            w.pop("amount", None)

    def slim_d(d):
        return {"title": d["title"], "summary": d.get("summary"), "status": d.get("status")}

    def slim_t(t):
        return {"title": t["title"], "status": t.get("status"), "role": t.get("assignee_role"), "due": t.get("due_date")}

    def slim_w(w):
        return {"title": w["title"], "type": w["type"], "stage": w.get("stage"), "amount": w.get("amount"), "counterparty": w.get("counterparty")}

    context = {
        "decisions": [slim_d(d) for d in decisions],
        "tasks": [slim_t(t) for t in tasks],
        "workflows": [slim_w(w) for w in workflows],
        "team": users,
        "contacts": contacts,
        "company_memory": [m["text"] for m in memory],
        "today": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }
    money_access = can_finance
    if money_access:
        invs = await db.invoices.find({"tenant_id": tid}, {"_id": 0, "type": 1, "number": 1, "contact_name": 1, "amount": 1, "currency": 1, "status": 1, "date": 1, "due_date": 1, "line_items": 1}).sort("created_at", -1).to_list(300)
        pays = await db.payments.find({"tenant_id": tid}, {"_id": 0, "direction": 1, "amount": 1, "contact_name": 1, "date": 1, "method": 1, "invoice_number": 1}).sort("created_at", -1).to_list(300)
        outstanding = {}
        for i in invs:
            nm = i.get("contact_name") or "Unknown"
            outstanding[nm] = outstanding.get(nm, 0) + float(i.get("amount") or 0)
        for p in pays:
            nm = p.get("contact_name") or "Unknown"
            outstanding[nm] = outstanding.get(nm, 0) - float(p.get("amount") or 0)
        context["invoices"] = invs
        context["payments"] = pays
        context["outstanding_by_party"] = {k: round(v, 2) for k, v in outstanding.items() if round(v, 2) != 0}
        context["currency"] = await _tenant_currency(tid)
    system = (
        "You are the Ask AI assistant of DecisionOS. Answer questions ONLY using the provided company context JSON. "
        "Be concise and factual. If the answer isn't in the data, say you don't have that information yet. Do not invent data. "
        "The context includes today's date; use it for time questions like 'yesterday', 'today' or 'not paid in 30 days'. "
        + ("It also includes invoices, payments, per-party outstanding balances and the company currency; "
           "use these to answer money questions (who owes the most, overdue collections, supplier payments due, sales totals). "
           if money_access else
           "Financial data (invoices, payments, outstanding) is NOT available to this user's role; if asked about money, say it is restricted to Owner and Finance. ") +
        "Return ONLY valid JSON: {\"answer\": string (markdown allowed), "
        "\"citations\": [{\"type\": one of [decision,task,workflow,contact,invoice,payment], \"title\": string}]}. "
        "Citations MUST be the specific records you used to answer (empty array if none). "
        + lang_directive(user.get("language"))
    )
    prompt = f"Company context:\n{json.dumps(context)}\n\nQuestion: {inp.question}"
    chat = claude_chat(session_id=f"ask-{tid}", system_message=system).with_model(*LLM_MODEL)
    try:
        raw = await chat.send_message(UserMessage(text=prompt))
    except Exception:
        logger.exception("ask_ai failed")
        raise HTTPException(status_code=502, detail="AI service error")
    try:
        data = _extract_json(raw)
        answer = data.get("answer") or raw
        citations = data.get("citations") if isinstance(data.get("citations"), list) else []
    except Exception:
        answer, citations = raw, []
    clean_cites = [{"type": c.get("type"), "title": c.get("title")} for c in citations if isinstance(c, dict) and c.get("title")]
    return {"answer": answer, "citations": clean_cites[:8]}


# ---------------------------------------------------------------------------
# Dashboard / daily brief
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Email delivery moved to services/email.py (Epic 8 Sprint 4). Re-exported
# here so deferred `from server import send_email` call sites keep resolving.
# ---------------------------------------------------------------------------
from services.email import (  # noqa: E402
    send_email, _smtp_send_sync,
    SMTP_ENABLED, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM,
)


# E2-63 (2026-08-15): DIGEST_I18N deleted along with the send-digest
# endpoint that was its only consumer. Rationale in routers/brief.py.





# ---------------------------------------------------------------------------
# Follow-up engine, notifications, attendance, complaints, memory, CEO brief
# ---------------------------------------------------------------------------
# Notifications + audience resolution moved to services/notifications.py
# (Epic 8 Sprint 4). Re-exported so deferred `from server import ...` resolves.
from services.notifications import (  # noqa: E402
    NOTIF_LEVELS, push_notification, dispatch_owner_alert,
    _owner_ids, _approver_ids, _finance_user_ids,
)
# AttendanceInput removed in Epic 8 Sprint 5 — the live model is models/team.py
# (imported by routers/team.py); server's copy was a dead duplicate.






# --- Finance → operations signals (A: money becomes tasks, C: money in the CEO brief) ------



















# Follow-up + finance-action engine moved to services/finance_signals.py
# (Epic 8 Sprint 4). Re-exported so deferred `from server import ...` resolves
# (desk router + brief/dashboard/complaints + the scheduler loop below).
from services.finance_signals import (  # noqa: E402
    run_followup, run_finance_actions, _overdue_receivables, _bills_due_or_overdue,
    _unmatched_payments, _inv_remaining, _pay_remaining_amt, _fmt_amt, _finance_assignee,
)


# Background scheduler: run follow-up/escalation for EVERY tenant on a timer, so overdue
# escalations and owner alerts fire even when nobody is actively polling /notifications.
FOLLOWUP_INTERVAL_SECONDS = int(os.environ.get("FOLLOWUP_INTERVAL_SECONDS", "300") or "300")


async def _followup_scheduler_loop():
    # FIX-002-D: distributed leader lock. Every replica keeps ticking on
    # its own timer, but only the replica that acquires the Mongo lock
    # runs the sweep for a given tick. Prevents 3x duplicate escalation
    # emails / platform alerts under multi-replica deploys (and the
    # sweep still fires with only 1 replica — natural single-tenancy of
    # the lock). Lease of 2x the tick interval gives a comfortable
    # margin over normal sweep duration (~seconds); a crashed leader's
    # lock naturally expires on the next tick's attempt.
    from services.leader_lock import try_acquire, release, make_holder_id
    holder_id = make_holder_id("followup-scheduler")
    lease_seconds = max(FOLLOWUP_INTERVAL_SECONDS * 2, 120)
    # Small initial delay so startup/bootstrap finishes first.
    await asyncio.sleep(30)
    while True:
        got_lock = False
        try:
            got_lock = await try_acquire(db, "followup_sweep", holder_id, lease_seconds=lease_seconds)
            if not got_lock:
                logger.debug("[followup-scheduler] another replica is leader this tick; skipping")
                await asyncio.sleep(FOLLOWUP_INTERVAL_SECONDS)
                continue
            try:
                tenant_ids = await db.tenants.distinct("id")
                for tid in tenant_ids:
                    try:
                        # Bypass the per-tenant 60s poll throttle for the timer sweep.
                        _followup_last_run.pop(tid, None)
                        await run_followup(tid)
                    except Exception as e:
                        logger.warning(f"[followup-scheduler] tenant {tid} failed: {e}")
                logger.info(f"[followup-scheduler] leader swept {len(tenant_ids)} tenant(s); next in {FOLLOWUP_INTERVAL_SECONDS}s")
            except Exception as e:
                logger.warning(f"[followup-scheduler] sweep failed: {e}")
            try:
                await _notify_provider_outages()
            except Exception as e:
                logger.warning(f"[followup-scheduler] outage-alert check failed: {e}")
        except Exception as e:
            # Never let a lock or DB error stop the loop — next tick retries.
            logger.exception(f"[followup-scheduler] tick error: {e}")
        finally:
            if got_lock:
                # Clean release so a redeploy hands the lock over immediately
                # instead of waiting for lease expiry.
                try:
                    await release(db, "followup_sweep", holder_id)
                except Exception:
                    pass  # natural TTL expiry handles it
        await asyncio.sleep(FOLLOWUP_INTERVAL_SECONDS)


async def _notify_provider_outages():
    """Email the platform super-admin once per new AI-provider outage alert."""
    pending = await db.platform_alerts.find({"resolved": False, "notified": False}, {"_id": 0}).to_list(20)
    if not pending:
        return
    admin_email = os.environ.get("SUPERADMIN_EMAIL", "admin@decisionos.biz").strip()
    for a in pending:
        subject = f"[DecisionOS] AI provider alert: {a['provider']} — {a.get('status')}"
        html = (f"<h3>AI provider outage detected</h3>"
                f"<p><b>Provider:</b> {a['provider']}<br/>"
                f"<b>Status:</b> {a.get('status')}<br/>"
                f"<b>Detail:</b> {a.get('message','')}</p>"
                f"<p>Open the Admin Console → AI Keys to update the key or clear it so AI falls back to the Emergent universal key.</p>")
        res = await send_email(admin_email, subject, html)
        await db.platform_alerts.update_one({"id": a["id"]},
            {"$set": {"notified": True, "notified_at": now_iso(), "notify_result": res.get("provider") or ("sent" if res.get("sent") else "mock")}})
        logger.info(f"[outage-alert] notified admin about {a['provider']} ({a.get('status')})")




















INGEST_ROLES = ("owner", "sales", "finance")


# Reference-file storage/analysis moved to services/files.py and the leave
# engine to services/leave.py (Epic 8 Sprint 4). Re-exported so deferred
# `from server import ...` call sites keep resolving (files/tasks/team routers,
# voice._read_reference_text, services.tasks).
from services.files import (  # noqa: E402
    _store_file, _file_public, _analyze_reference_file, _read_reference_text,
    ATTACH_ALLOWED_EXT, ATTACH_MAX_BYTES,
)
from services.leave import _resolve_leave_approver, _create_leave, ai_leave_impact  # noqa: E402






























# ---------------------------------------------------------------------------
# Leave & Absence Management (Phase 1)
# ---------------------------------------------------------------------------
# Leave endpoints + task-local helpers (_can_approve_leave, _decide_leave, leave_impact)
# moved to routers/team.py in Phase B step 7. Constants + Pydantic inputs now live in
# models/team.py. Keep the following still-referenced-inline pieces in this module:
#   • LeaveApproverMapInput + PATCH /tenant/leave-approvers (settings surface)
#   • _resolve_leave_approver + _create_leave (called from voice / inbox / capture flows)
#   • ai_leave_impact (deferred-imported by routers/team.py:leave_impact)
from models.team import LEAVE_TYPES, ABSENCE_REASONS  # noqa: F401














# --- Leave & Absence Phase 2: AI Impact Analysis on approval ---




















# ---------------------------------------------------------------------------
# WhatsApp Smart Capture — AI triage → Capture Draft → role review → execute
# ---------------------------------------------------------------------------
# Classification → department "intent". invoice/payment are handled as money items (finance).
# operational_task/workflow/meeting/other fall back to the AI-suggested department.
# Hint substrings used to map a department intent to a tenant's ACTUAL role key
# (role names vary by industry, e.g. finance may be keyed 'accounts_and_admin').




# Confidence gating for the WhatsApp Smart Capture processing-level decision.

















# WhatsApp Smart-Capture triage + review engine moved to services/captures.py
# (Epic 8 Sprint 4). Re-exported so deferred `from server import ...` resolves
# (captures router + whatsapp + finance_signals._finance_role_key).
from services.captures import (  # noqa: E402
    ai_capture_triage, persist_capture_draft, execute_capture,
    _finance_role_key, _resolve_reviewer_role, _needs_owner_review,
    _capture_settings, _decide_processing_level, CAPTURE_THRESHOLD,
    CAPTURE_CLASSES, DOC_CLASS,
)


# ---------------------------------------------------------------------------
# Seed demo workspace
# ---------------------------------------------------------------------------
DEMO_EMAIL = os.environ.get("DEMO_EMAIL", "owner@sharma.com")
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "demo1234")


async def seed_demo():
    if await db.users.find_one({"email": DEMO_EMAIL}):
        return
    logger.info("Seeding Sharma demo workspace...")
    tid = new_id()
    await db.tenants.insert_one({
        "id": tid, "name": "Sharma Textiles Pvt Ltd", "created_at": now_iso(),
        "industry": "Textile Manufacturing", "company_size": "11-50", "region": "India", "currency": "INR",
        "roles": [{"key": "sales", "label": "Sales"}, {"key": "production", "label": "Production"},
                  {"key": "finance", "label": "Finance"}],
        "products": [{"name": "Cotton kurta sets", "description": "Festive apparel collection"},
                     {"name": "Silk dupattas", "description": "Premium woven accessories"},
                     {"name": "Bulk fabric rolls", "description": "Wholesale cotton & silk"}],
    })

    def mkuser(name, email, role, phone=""):
        uid = new_id()
        return uid, {"id": uid, "tenant_id": tid, "name": name, "email": email, "phone": phone,
                     "password_hash": hash_password(DEMO_PASSWORD), "role": role, "created_at": now_iso()}

    owner_id, owner = mkuser("Rajesh Sharma", DEMO_EMAIL, "owner", "+91 98200 10001")
    sales_id, sales = mkuser("Priya Nair", "sales@sharma.com", "sales", "+91 98200 10002")
    prod_id, prod = mkuser("Amit Verma", "production@sharma.com", "production", "+91 98200 10003")
    fin_id, fin = mkuser("Sunita Rao", "finance@sharma.com", "finance", "+91 98200 10004")
    await db.users.insert_many([owner, sales, prod, fin])

    # Decisions + tasks
    d1 = new_id()
    t1, t2 = new_id(), new_id()
    await db.tasks.insert_many([
        {"id": t1, "tenant_id": tid, "title": "Confirm cotton supplier rates for Q3", "description": "Negotiate bulk pricing with Gujarat mill.",
         "assignee_role": "production", "assignee_id": prod_id, "priority": "high", "status": "todo",
         "due_date": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(), "decision_id": d1, "source": "voice", "created_at": now_iso()},
        {"id": t2, "tenant_id": tid, "title": "Prepare revised quote for Delhi retailer", "description": "Include 8% festive discount.",
         "assignee_role": "sales", "assignee_id": sales_id, "priority": "medium", "status": "todo",
         "due_date": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "decision_id": d1, "source": "voice", "created_at": now_iso()},
    ])
    await db.decisions.insert_one({
        "id": d1, "tenant_id": tid, "voice_note_id": None,
        "title": "Push festive season stock and lock supplier rates",
        "summary": "Rajesh wants to prioritise festive inventory: lock cotton supplier rates for Q3 and send a discounted quote to the Delhi retailer this week.",
        "items": [{"title": "Lock Q3 cotton rates", "detail": "Avoid festive price spikes", "category": "procurement"},
                  {"title": "Discounted retailer quote", "detail": "8% festive discount for Delhi partner", "category": "sales"}],
        "workflow_events": [], "status": "approved", "created_by": owner_id, "created_at": now_iso(),
        "decided_at": now_iso(), "task_ids": [t1, t2],
    })

    d2 = new_id()
    t3 = new_id()
    await db.tasks.insert_one({"id": t3, "tenant_id": tid, "title": "Draft new hire JD for dispatch coordinator",
                               "description": "To handle rising dispatch volume.", "assignee_role": "owner", "assignee_id": owner_id,
                               "priority": "low", "status": "blocked", "due_date": None, "decision_id": d2, "source": "voice", "created_at": now_iso()})
    await db.decisions.insert_one({
        "id": d2, "tenant_id": tid, "voice_note_id": None, "title": "Hire a dispatch coordinator",
        "summary": "Dispatch volumes are up 30%. Rajesh is considering hiring a dedicated dispatch coordinator.",
        "items": [{"title": "Hire dispatch coordinator", "detail": "Handle 30% volume increase", "category": "hiring"}],
        "workflow_events": [], "status": "pending_approval", "created_by": owner_id, "created_at": now_iso(), "task_ids": [t3],
    })

    # Contacts (customers & vendors)
    c_kapoor, c_threads, c_gujarat, c_packwell = new_id(), new_id(), new_id(), new_id()
    await db.contacts.insert_many([
        {"id": c_kapoor, "tenant_id": tid, "type": "customer", "name": "Kapoor Retail", "company": "Kapoor Retail Pvt Ltd",
         "phone": "+91 98100 11223", "email": "orders@kapoorretail.in", "address": "Karol Bagh, New Delhi", "tax_id": "07AABCK1234M1Z5",
         "tags": ["wholesale", "festive"], "status": "active", "assigned_id": sales_id, "notes": "Largest festive-season buyer; prefers net-30 terms.",
         "created_by": owner_id, "created_at": now_iso()},
        {"id": c_threads, "tenant_id": tid, "type": "customer", "name": "Threads Boutique", "company": "Threads Boutique",
         "phone": "+91 98200 44556", "email": "hello@threadsboutique.in", "address": "Bandra, Mumbai", "tax_id": "27AAECT5678P1Z2",
         "tags": ["boutique", "premium"], "status": "active", "assigned_id": sales_id, "notes": "Small premium orders, quick payer.",
         "created_by": owner_id, "created_at": now_iso()},
        {"id": c_gujarat, "tenant_id": tid, "type": "vendor", "name": "Gujarat Cotton Mills", "company": "Gujarat Cotton Mills Ltd",
         "phone": "+91 79000 77889", "email": "sales@gujaratcotton.in", "address": "Ahmedabad, Gujarat", "tax_id": "24AAACG9012Q1Z8",
         "tags": ["raw-material", "cotton"], "status": "active", "assigned_id": prod_id, "notes": "Primary yarn supplier.",
         "created_by": owner_id, "created_at": now_iso()},
        {"id": c_packwell, "tenant_id": tid, "type": "vendor", "name": "PackWell Industries", "company": "PackWell Industries",
         "phone": "+91 22000 33445", "email": "accounts@packwell.in", "address": "Vasai, Maharashtra", "tax_id": "27AAFCP3456R1Z1",
         "tags": ["packaging"], "status": "active", "assigned_id": prod_id, "notes": "Branded boxes & packaging.",
         "created_by": owner_id, "created_at": now_iso()},
    ])

    # Workflows
    prod_stages = WORKFLOW_STAGES["production"]
    dist_stages = WORKFLOW_STAGES["distribution"]
    pp_stages = WORKFLOW_STAGES["purchase_payment"]
    await db.workflows.insert_many([
        {"id": new_id(), "tenant_id": tid, "type": "production", "title": "Order #4821 — Delhi Retailer (500 units)",
         "detail": "Cotton kurta sets, festive collection", "amount": 385000, "counterparty": "Kapoor Retail Pvt Ltd", "contact_id": c_kapoor,
         "stage": "in_production", "stages": prod_stages,
         "history": [{"stage": "order_received", "note": "PO received", "by": sales_id, "at": now_iso()},
                     {"stage": "confirmed", "note": "Advance paid", "by": sales_id, "at": now_iso()},
                     {"stage": "in_production", "note": "Batch started", "by": prod_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "distribution", "title": "Order #4822 — Mumbai Boutique (120 units)",
         "detail": "Silk dupattas", "amount": 96000, "counterparty": "Threads Boutique", "contact_id": c_threads,
         "stage": "dispatched", "stages": dist_stages,
         "history": [{"stage": "ready_to_dispatch", "note": "Packed", "by": prod_id, "at": now_iso()},
                     {"stage": "dispatched", "note": "Shipped via BlueDart", "by": sales_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "purchase_payment", "title": "PO #221 — Cotton yarn (2 tonnes)",
         "detail": "Q3 raw material stock", "amount": 240000, "counterparty": "Gujarat Cotton Mills Ltd", "contact_id": c_gujarat,
         "stage": "requested", "stages": pp_stages,
         "history": [{"stage": "requested", "note": "Awaiting owner approval", "by": prod_id, "at": now_iso()}],
         "created_by": prod_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "purchase_payment", "title": "PO #219 — Packaging boxes",
         "detail": "5000 branded boxes", "amount": 45000, "counterparty": "PackWell Industries", "contact_id": c_packwell,
         "stage": "payment_pending", "stages": pp_stages,
         "history": [{"stage": "requested", "note": "", "by": prod_id, "at": now_iso()},
                     {"stage": "approved", "note": "Approved by owner", "by": owner_id, "at": now_iso()},
                     {"stage": "received", "note": "Delivered", "by": prod_id, "at": now_iso()},
                     {"stage": "payment_pending", "note": "Invoice received", "by": fin_id, "at": now_iso()}],
         "created_by": prod_id, "created_at": now_iso()},
    ])

    await db.activity.insert_many([
        {"id": new_id(), "tenant_id": tid, "actor": owner_id, "kind": "decision_approved",
         "message": "Approved 'Push festive season stock and lock supplier rates'", "entity_type": "decision", "entity_id": d1, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "actor": sales_id, "kind": "workflow_advanced",
         "message": "'Order #4822' → dispatched", "entity_type": "workflow", "entity_id": None, "created_at": now_iso()},
    ])
    logger.info("Demo workspace seeded.")


async def write_test_credentials():
    content = f"""# Test Credentials

## Demo Workspace — Sharma Textiles Pvt Ltd
Owner:      {DEMO_EMAIL} / {DEMO_PASSWORD}  (role: owner)
Sales:      sales@sharma.com / {DEMO_PASSWORD}  (role: sales)
Production: production@sharma.com / {DEMO_PASSWORD}  (role: production)
Finance:    finance@sharma.com / {DEMO_PASSWORD}  (role: finance)

## Auth endpoints
POST /api/auth/register   {{company_name, name, email, password}}
POST /api/auth/login      {{email, password}}
GET  /api/auth/me         (Bearer token)

Auth: JWT Bearer token returned by login/register, send as `Authorization: Bearer <token>`.
"""
    creds_path = Path("/app/memory/test_credentials.md")
    creds_path.parent.mkdir(exist_ok=True)
    creds_path.write_text(content)


async def migrate_tenants():
    """Backfill onboarding fields for tenants created before industry-aware onboarding."""
    async for t in db.tenants.find({"roles": {"$exists": False}}):
        await db.tenants.update_one({"id": t["id"]}, {"$set": {
            "industry": t.get("industry", "General"),
            "company_size": t.get("company_size", ""),
            "region": t.get("region", ""),
            "currency": t.get("currency", "INR"),
            "roles": DEFAULT_ROLES,
            "products": t.get("products", []),
        }})


async def migrate_local_disk_uploads_to_obj_store(_db):
    """FIX-002-E: one-shot migration. Copy every legacy local-disk upload
    referenced by voice_notes/meetings/ingestions/expenses/assets to
    obj_store, rewrite the doc to point at the new storage_path, then
    delete the local file. Idempotent internally (skips docs whose path
    is already an obj_store key) AND wrapped in the ledger for exactly-
    once safety across restarts.

    This is the FIRST truly destructive migration in the codebase — it
    deletes source files after copy. The ledger protects against re-runs.
    Its own idempotency guard (skip already-migrated docs) protects
    within a single run if it crashes mid-way and the ledger records
    'failed' (next boot retries only what wasn't migrated).
    """
    from services.uploads import store_upload, is_legacy_path
    stats = {"scanned": 0, "migrated": 0, "skipped_absent": 0, "already_new": 0, "failed": 0}

    # Map: collection -> (path_field, category, tenant_extractor)
    plan = [
        ("voice_notes", "audio_path", "voice-notes"),
        ("meetings",    "audio_path", "meetings"),
        ("ingestions",  "storage_path", "ingestions"),  # storage_path may already be new
    ]

    for coll_name, path_field, category in plan:
        cursor = _db[coll_name].find(
            {path_field: {"$exists": True, "$ne": None, "$ne": ""}},
            {"_id": 0, "id": 1, "tenant_id": 1, path_field: 1},
        )
        async for doc in cursor:
            stats["scanned"] += 1
            path = doc.get(path_field)
            if not path:
                continue
            if not is_legacy_path(path):
                stats["already_new"] += 1
                continue
            tenant_id = doc.get("tenant_id")
            if not tenant_id:
                stats["failed"] += 1
                continue
            # Try to read the legacy file. If it doesn't exist on this
            # box (very common — the app moved to a new machine, files
            # left behind), skip and record.
            from pathlib import Path as _P
            legacy_p = _P(path) if _P(path).is_absolute() else UPLOAD_DIR / path
            if not legacy_p.exists():
                stats["skipped_absent"] += 1
                # Still rewrite the doc field to null so read paths stop
                # attempting the absent local file. Preserves the record.
                await _db[coll_name].update_one(
                    {"id": doc["id"]}, {"$set": {path_field: None, "_upload_missing": True}}
                )
                continue
            try:
                data = legacy_p.read_bytes()
                ext = legacy_p.suffix.lstrip(".") or "bin"
                stored = await store_upload(tenant_id, category, data, ext,
                                             file_id=doc["id"])
                await _db[coll_name].update_one(
                    {"id": doc["id"]},
                    {"$set": {path_field: stored["storage_path"]}},
                )
                # Only delete the local file AFTER the DB pointer moves.
                try:
                    legacy_p.unlink()
                except Exception as del_err:
                    logger.warning(f"legacy file delete failed for {legacy_p}: {del_err}")
                stats["migrated"] += 1
            except Exception as e:
                logger.warning(f"local-disk migration failed for {coll_name}/{doc['id']}: {e}")
                stats["failed"] += 1

    # Also handle ledger attachments (nested field: attachment.storage_path)
    for coll_name in ("expenses", "assets", "inventory"):
        cursor = _db[coll_name].find(
            {"attachment.url": {"$regex": "^/api/files/"},
             "attachment.storage_path": {"$exists": False}},
            {"_id": 0, "id": 1, "tenant_id": 1, "attachment": 1},
        )
        async for doc in cursor:
            stats["scanned"] += 1
            att = doc.get("attachment") or {}
            fname = (att.get("url") or "").split("/")[-1]
            if not fname:
                continue
            legacy_p = UPLOAD_DIR / fname
            if not legacy_p.exists():
                stats["skipped_absent"] += 1
                continue
            tenant_id = doc.get("tenant_id")
            if not tenant_id:
                stats["failed"] += 1
                continue
            try:
                data = legacy_p.read_bytes()
                ext = legacy_p.suffix.lstrip(".") or "bin"
                stored = await store_upload(tenant_id, "ledger", data, ext)
                new_att = {**att, "storage_path": stored["storage_path"]}
                await _db[coll_name].update_one(
                    {"id": doc["id"]}, {"$set": {"attachment": new_att}}
                )
                try:
                    legacy_p.unlink()
                except Exception:
                    pass
                stats["migrated"] += 1
            except Exception as e:
                logger.warning(f"ledger attachment migration failed for {coll_name}/{doc['id']}: {e}")
                stats["failed"] += 1

    logger.info(f"[migrate_local_disk_uploads] {stats}")


async def fixup_demo_tenant():
    """Ensure the seeded Sharma demo reflects its industry-aware profile + has contacts (idempotent)."""
    owner = await db.users.find_one({"email": DEMO_EMAIL}, {"_id": 0, "id": 1, "tenant_id": 1})
    if not owner:
        return
    tid = owner["tenant_id"]
    await db.tenants.update_one({"id": tid}, {"$set": {
        "industry": "Textile Manufacturing", "company_size": "11-50", "region": "India", "currency": "INR",
        "roles": [{"key": "sales", "label": "Sales"}, {"key": "production", "label": "Production"},
                  {"key": "finance", "label": "Finance"}],
        "products": [{"name": "Cotton kurta sets", "description": "Festive apparel collection"},
                     {"name": "Silk dupattas", "description": "Premium woven accessories"},
                     {"name": "Bulk fabric rolls", "description": "Wholesale cotton & silk"}],
    }})
    if await db.contacts.count_documents({"tenant_id": tid}) > 0:
        return
    sales = await db.users.find_one({"email": "sales@sharma.com"}, {"_id": 0, "id": 1})
    prod = await db.users.find_one({"email": "production@sharma.com"}, {"_id": 0, "id": 1})
    sales_id = sales["id"] if sales else owner["id"]
    prod_id = prod["id"] if prod else owner["id"]
    c_kapoor, c_threads, c_gujarat, c_packwell = new_id(), new_id(), new_id(), new_id()
    await db.contacts.insert_many([
        {"id": c_kapoor, "tenant_id": tid, "type": "customer", "name": "Kapoor Retail", "company": "Kapoor Retail Pvt Ltd",
         "phone": "+91 98100 11223", "email": "orders@kapoorretail.in", "address": "Karol Bagh, New Delhi", "tax_id": "07AABCK1234M1Z5",
         "tags": ["wholesale", "festive"], "status": "active", "assigned_id": sales_id, "notes": "Largest festive-season buyer; prefers net-30 terms.",
         "created_by": owner["id"], "created_at": now_iso()},
        {"id": c_threads, "tenant_id": tid, "type": "customer", "name": "Threads Boutique", "company": "Threads Boutique",
         "phone": "+91 98200 44556", "email": "hello@threadsboutique.in", "address": "Bandra, Mumbai", "tax_id": "27AAECT5678P1Z2",
         "tags": ["boutique", "premium"], "status": "active", "assigned_id": sales_id, "notes": "Small premium orders, quick payer.",
         "created_by": owner["id"], "created_at": now_iso()},
        {"id": c_gujarat, "tenant_id": tid, "type": "vendor", "name": "Gujarat Cotton Mills", "company": "Gujarat Cotton Mills Ltd",
         "phone": "+91 79000 77889", "email": "sales@gujaratcotton.in", "address": "Ahmedabad, Gujarat", "tax_id": "24AAACG9012Q1Z8",
         "tags": ["raw-material", "cotton"], "status": "active", "assigned_id": prod_id, "notes": "Primary yarn supplier.",
         "created_by": owner["id"], "created_at": now_iso()},
        {"id": c_packwell, "tenant_id": tid, "type": "vendor", "name": "PackWell Industries", "company": "PackWell Industries",
         "phone": "+91 22000 33445", "email": "accounts@packwell.in", "address": "Vasai, Maharashtra", "tax_id": "27AAFCP3456R1Z1",
         "tags": ["packaging"], "status": "active", "assigned_id": prod_id, "notes": "Branded boxes & packaging.",
         "created_by": owner["id"], "created_at": now_iso()},
    ])
    links = {
        "Order #4821": (c_kapoor, "Kapoor Retail Pvt Ltd"),
        "Order #4822": (c_threads, "Threads Boutique"),
        "PO #221": (c_gujarat, "Gujarat Cotton Mills Ltd"),
        "PO #219": (c_packwell, "PackWell Industries"),
    }
    for prefix, (cid, name) in links.items():
        await db.workflows.update_one(
            {"tenant_id": tid, "title": {"$regex": f"^{prefix}"}},
            {"$set": {"contact_id": cid, "counterparty": name}},
        )
    logger.info("Demo contacts seeded & linked.")


async def _bootstrap():
    """Idempotent bootstrap (indexes, migrations, demo seed). Runs in the background so it
    never blocks the app from becoming ready, and never crashes the process on failure."""
    # S5-05 audit fix (2026-08-16): hoist the migration ledger import
    # to function-top. Was previously imported at line 6365 (inside the
    # same function) which made `_apply_migration` an UnboundLocal for
    # every earlier reference (backfill_memberships_v1,
    # backfill_grandfathered_plans_v1, rename_production_role). The
    # try/except right after each call silently swallowed the
    # UnboundLocalError, so those 3 migrations have been failing at
    # every boot for weeks -- causing real DB drift: orphaned users
    # missing membership rows, tenants missing plan field, tenants
    # still holding the old 'production' role key.
    from services.migrations import apply_migration as _apply_migration  # noqa: F401
    try:
        # Core tenant-scoped indexes (P0 for multi-tenant scale — every read
        # of these collections filters by tenant_id, so unindexed = full scans).
        await db.users.create_index("email", unique=True)
        await db.users.create_index([("tenant_id", 1), ("role", 1)])
        # FIX-002-D: TTL index on scheduler_locks so expired leader locks
        # get auto-cleaned by Mongo (no separate GC job needed). Sorts by
        # expires_at with expireAfterSeconds=0 = "delete when expires_at
        # is in the past." Doesn't interfere with acquire logic; only
        # removes stale rows for hygiene.
        try:
            await db.scheduler_locks.create_index(
                "expires_at", expireAfterSeconds=0,
                name="scheduler_locks_expires_at_ttl",
            )
        except Exception as e:
            logger.warning(f"scheduler_locks TTL index: {e}")
        # FIX-004-F (RBAC-20): audit_log collection indexes.
        # Two hot read patterns: "everything in tenant X since Monday"
        # and "everything user Y did". Timestamp is a string (iso)
        # but sorts lexicographically the same as chrono order — no
        # BSON date conversion needed.
        try:
            await db.audit_log.create_index(
                [("tenant_id", 1), ("timestamp", -1)],
                name="audit_log_tenant_timestamp",
            )
            await db.audit_log.create_index(
                [("actor_id", 1), ("timestamp", -1)],
                name="audit_log_actor_timestamp",
            )
            # Bonus for the entity-scoped view ("everything that
            # happened to this decision") — cheap secondary index.
            await db.audit_log.create_index(
                [("tenant_id", 1), ("entity_type", 1), ("entity_id", 1)],
                name="audit_log_entity",
            )
        except Exception as e:
            logger.warning(f"audit_log indexes: {e}")
        # FIX-004-B (RBAC-13): memberships collection indexes.
        # Compound unique on (user_id, tenant_id) — one membership per
        # (person, workspace). Query indexes for the two hot paths:
        #   * list memberships for a user  (login-ambiguity picker,
        #     /me/workspaces)
        #   * list memberships for a tenant (GET /users, admin views)
        try:
            await db.memberships.create_index(
                [("user_id", 1), ("tenant_id", 1)], unique=True,
                name="memberships_user_tenant_unique",
            )
        except Exception as e:
            logger.warning(f"memberships unique index: {e}")
        try:
            await db.memberships.create_index(
                [("user_id", 1), ("status", 1)],
                name="memberships_user_status",
            )
            await db.memberships.create_index(
                [("tenant_id", 1), ("status", 1)],
                name="memberships_tenant_status",
            )
        except Exception as e:
            logger.warning(f"memberships query indexes: {e}")

        # S5-05 audit fix (2026-08-16): indexes for collections shipped
        # in the last 2 sessions that were queried WITHOUT indexes,
        # causing full-scan hot paths + one race-condition bug.
        try:
            # billing_events: UNIQUE on idempotency_key so a webhook
            # retry that races between find_one() and insert_one() in
            # routers/billing.py::razorpay_webhook can't insert a
            # duplicate + double-upgrade a plan. Belt (unique index)
            # AND braces (DuplicateKeyError catch at insert site).
            await db.billing_events.create_index(
                "idempotency_key", unique=True,
                name="billing_events_idempotency_key_unique",
            )
            # crm_activities: tenant+contact+created for the
            # ContactProfile timeline read; sorted DESC to match the
            # find(...).sort("created_at", -1) in routers/crm.py.
            await db.crm_activities.create_index(
                [("tenant_id", 1), ("contact_id", 1), ("created_at", -1)],
                name="crm_activities_tenant_contact_created",
            )
            # invoices.source_task_id: FUP-50 auto-invoice dedup key
            # in routers/tasks.py::_maybe_auto_invoice. Partial so
            # only auto-drafted rows contribute (~5% of invoices).
            await db.invoices.create_index(
                [("tenant_id", 1), ("source_task_id", 1)],
                partialFilterExpression={"source_task_id": {"$type": "string"}},
                name="invoices_source_task_id_partial",
            )
        except Exception as e:
            logger.warning(f"S5-05 pre-audit indexes: {e}")

        # Backfill: for every existing user with a tenant_id (the
        # legacy 1:1 model), synthesize the matching membership row.
        # Idempotent: skips users who already have a row for that
        # (user_id, tenant_id). Runs exactly once via the migration
        # ledger so subsequent boots skip cleanly.
        async def _backfill_memberships(_db):
            from services.auth.membership import (
                find_membership as _fm,
                create_membership as _cm,
                STATUS_ACTIVE as _ACTIVE,
                STATUS_SUSPENDED as _SUSP,
            )
            scanned = created = 0
            async for u in _db.users.find(
                {"tenant_id": {"$type": "string", "$gt": ""}},
                {"_id": 0, "id": 1, "tenant_id": 1, "role": 1,
                 "permissions": 1, "suspended": 1},
            ):
                scanned += 1
                if not u.get("id") or not u.get("tenant_id"):
                    continue
                if await _fm(_db, u["id"], u["tenant_id"]):
                    continue
                status = _SUSP if u.get("suspended") else _ACTIVE
                await _cm(
                    _db, user_id=u["id"], tenant_id=u["tenant_id"],
                    role=u.get("role") or "sales",
                    permissions=u.get("permissions") or [],
                    status=status,
                )
                created += 1
            logger.info(f"[FIX-004-B] backfill_memberships: scanned={scanned} created={created}")
        try:
            _mres = await _apply_migration(
                db, "backfill_memberships_v1", _backfill_memberships,
                description="FIX-004-B: create memberships rows for legacy user.tenant_id 1:1 model",
            )
            if _mres == "applied":
                logger.info("Migration applied: backfill_memberships_v1")
        except Exception as e:
            logger.exception(f"backfill_memberships migration: {e}")  # S5-05: surface tracebacks
        # FIX-005-A (S3-02): backfill plan fields on existing tenants
        # that predate the plan model. Every legacy tenant gets
        # plan=grandfathered (unlimited seats + quotas, feature-flag
        # defaults set) so nothing about their experience changes
        # until an admin explicitly repositions them. New tenants
        # created AFTER this migration get plan=trial via
        # routers/auth.register.
        async def _backfill_grandfathered_plans(_db):
            from services.plans import PLAN_GRANDFATHERED
            _res = await _db.tenants.update_many(
                {"plan": {"$exists": False}},
                {"$set": {"plan": PLAN_GRANDFATHERED,
                          "seat_limit_override": None,
                          "usage_quotas": {},
                          "feature_flags": {},
                          "updated_at": now_iso()}},
            )
            logger.info(
                f"[FIX-005-A] backfill_grandfathered_plans: "
                f"tenants marked={getattr(_res, 'modified_count', 0)}"
            )
        try:
            _pres = await _apply_migration(
                db, "backfill_grandfathered_plans_v1", _backfill_grandfathered_plans,
                description="FIX-005-A (S3-02): mark pre-plan tenants as grandfathered",
            )
            if _pres == "applied":
                logger.info("Migration applied: backfill_grandfathered_plans_v1")
        except Exception as e:
            logger.exception(f"backfill_grandfathered_plans migration: {e}")  # S5-05
        # FIX-004-D (RBAC-16): canonical role rename production -> operations.
        # Prior code had config.ROLES with 'production' but
        # config.DEFAULT_ROLES with 'operations' — silent inconsistency
        # that hid tenants using 'operations'. Canonical name is
        # 'operations'. Rewrites: tenant.roles[].key, users.role,
        # memberships.role. Idempotent (skips rows already migrated).
        async def _rename_production_to_operations(_db):
            renamed_tenants = renamed_users = renamed_memberships = 0
            # 1. Tenants: rewrite the tenant.roles[] array entries.
            async for _t in _db.tenants.find(
                {"roles.key": "production"}, {"_id": 0, "id": 1, "roles": 1},
            ):
                new_roles = []
                changed = False
                for _r in (_t.get("roles") or []):
                    if _r.get("key") == "production":
                        _r = {**_r, "key": "operations"}
                        changed = True
                    new_roles.append(_r)
                if changed:
                    await _db.tenants.update_one(
                        {"id": _t["id"]}, {"$set": {"roles": new_roles}},
                    )
                    renamed_tenants += 1
            # 2. Legacy users.role (compat until pre-membership sites migrated).
            _ures = await _db.users.update_many(
                {"role": "production"}, {"$set": {"role": "operations"}},
            )
            renamed_users = getattr(_ures, "modified_count", 0)
            # 3. Memberships — the authoritative source post-Wave-2.
            _mres = await _db.memberships.update_many(
                {"role": "production"}, {"$set": {"role": "operations"}},
            )
            renamed_memberships = getattr(_mres, "modified_count", 0)
            logger.info(
                f"[FIX-004-D] rename_production_to_operations: "
                f"tenants={renamed_tenants} users={renamed_users} memberships={renamed_memberships}"
            )
        try:
            _rres = await _apply_migration(
                db, "rename_production_role_v1", _rename_production_to_operations,
                description="FIX-004-D: canonicalize role key 'production' -> 'operations'",
            )
            if _rres == "applied":
                logger.info("Migration applied: rename_production_role_v1")
        except Exception as e:
            logger.exception(f"rename_production_role migration: {e}")  # S5-05
        # WE-03 (2026-08-16): stage objects extend. Existing tenant
        # operating_model.pipelines[].stages[] entries only carry
        # {key,label}. This migration re-runs normalize_operating_model
        # over every tenant so the three new fields (tasks[], approval,
        # side_effects[]) get defaulted in place. Empty defaults =
        # today's behaviour verbatim; WE-06 engine treats empty
        # tasks[] as "no auto-spawn on entry" and approval=None as
        # "no gate required". Backward-compatible by construction.
        async def _stage_objects_extend(_db):
            from core import normalize_operating_model
            scanned = touched = 0
            async for _t in _db.tenants.find(
                {"operating_model": {"$exists": True}},
                {"_id": 0, "id": 1, "operating_model": 1},
            ):
                scanned += 1
                om_in = _t.get("operating_model") or {}
                om_out = normalize_operating_model(om_in)
                # Cheap change-detect: only write if any stage is missing
                # one of the three new fields. Skips the write for
                # tenants who were already on the new shape.
                needs = False
                for _p in (om_in.get("pipelines") or []):
                    for _s in (_p.get("stages") or []):
                        if not isinstance(_s, dict):
                            needs = True; break
                        if "tasks" not in _s or "approval" not in _s or "side_effects" not in _s:
                            needs = True; break
                    if needs:
                        break
                if not needs:
                    continue
                await _db.tenants.update_one(
                    {"id": _t["id"]},
                    {"$set": {"operating_model": om_out, "updated_at": now_iso()}},
                )
                touched += 1
            logger.info(
                f"[WE-03] stage_objects_extend: scanned={scanned} touched={touched}"
            )
        try:
            _sres = await _apply_migration(
                db, "stage_objects_extend_v1", _stage_objects_extend,
                description="WE-03: add tasks[]/approval/side_effects[] to every pipeline stage (empty defaults preserve behaviour)",
            )
            if _sres == "applied":
                logger.info("Migration applied: stage_objects_extend_v1")
        except Exception as e:
            logger.exception(f"stage_objects_extend migration: {e}")  # WE-03
        # WE-01 (2026-08-16): task -> workflow linkage backfill.
        # Every task with a decision_id gets workflow_id set to the
        # matching workflow (looked up by shared decision_id, tenant-
        # scoped). stage_key is set to the workflow's INITIAL stage --
        # NOT current -- because the task was spawned when the card
        # was created; setting current would falsely gate advance out
        # of the current stage. Ambiguous matches (0 or >1 workflow
        # for a decision_id) leave both fields null. Idempotent: the
        # match filter excludes tasks that already have workflow_id.
        async def _backfill_task_workflow_link(_db):
            from services.workflows import stage_key_for_backfill
            scanned = matched = 0
            async for _tsk in _db.tasks.find(
                {"decision_id": {"$exists": True, "$nin": [None, ""]},
                 "$or": [{"workflow_id": {"$exists": False}},
                         {"workflow_id": {"$in": [None, ""]}}]},
                {"_id": 0, "id": 1, "tenant_id": 1, "decision_id": 1},
            ):
                scanned += 1
                _wfs = await _db.workflows.find(
                    {"tenant_id": _tsk["tenant_id"],
                     "decision_id": _tsk["decision_id"]},
                    {"_id": 0, "id": 1, "stages": 1},
                ).to_list(2)
                if len(_wfs) != 1:
                    continue  # ambiguous: leave unlinked
                _wf = _wfs[0]
                _stage_key = stage_key_for_backfill(_wf)
                await _db.tasks.update_one(
                    {"id": _tsk["id"]},
                    {"$set": {"workflow_id": _wf["id"],
                              "stage_key": _stage_key}},
                )
                matched += 1
            logger.info(
                f"[WE-01] backfill_task_workflow_link: "
                f"scanned={scanned} matched={matched}"
            )
        try:
            _bwlres = await _apply_migration(
                db, "backfill_task_workflow_link_v1", _backfill_task_workflow_link,
                description="WE-01: link tasks to workflows via shared decision_id (initial stage, tenant-scoped)",
            )
            if _bwlres == "applied":
                logger.info("Migration applied: backfill_task_workflow_link_v1")
        except Exception as e:
            logger.exception(f"backfill_task_workflow_link migration: {e}")  # WE-01
        # WE-02 (2026-08-16): drop the two ghost collections that
        # confused Settings ("three cards, three shapes, one concept").
        # Nothing reads workflow_templates now that /tenant/os-blueprint
        # ignores it and the Settings UI editor is gone; nothing reads
        # lexicon.workflows now that lex()'s workflows merge is gone.
        # $unset both fields on every tenant so exports + admin views
        # don't carry stale garbage. Idempotent (unset is a no-op when
        # the field is already absent).
        async def _drop_ghost_workflow_collections(_db):
            _r1 = await _db.tenants.update_many(
                {"workflow_templates": {"$exists": True}},
                {"$unset": {"workflow_templates": ""}},
            )
            _r2 = await _db.tenants.update_many(
                {"lexicon.workflows": {"$exists": True}},
                {"$unset": {"lexicon.workflows": ""}},
            )
            logger.info(
                f"[WE-02] drop_ghost_workflow_collections: "
                f"tenants.workflow_templates unset={getattr(_r1, 'modified_count', 0)} "
                f"tenants.lexicon.workflows unset={getattr(_r2, 'modified_count', 0)}"
            )
        try:
            _dres = await _apply_migration(
                db, "drop_ghost_workflow_collections_v1", _drop_ghost_workflow_collections,
                description="WE-02: $unset tenant.workflow_templates and tenant.lexicon.workflows (dead outputs)",
            )
            if _dres == "applied":
                logger.info("Migration applied: drop_ghost_workflow_collections_v1")
        except Exception as e:
            logger.exception(f"drop_ghost_workflow_collections migration: {e}")  # WE-02
        # WE-08 (2026-08-16): the FIX-001-B behaviour that used to be
        # hardcoded in the advance endpoint (procurement -> Finance
        # auto-expense) is now a `create_expense` side-effect bound to
        # the procurement pipeline's TERMINAL stage. This migration
        # walks every tenant whose operating_model has a procurement
        # pipeline (identified by approval_stage or the legacy
        # 'purchase_payment' key) and appends the side-effect to the
        # terminal stage if it is not already present. Idempotent:
        # skips stages already carrying it. Zero-behaviour-diff for
        # existing tenants -- the engine will call the same handler
        # with the same effect as the old inline block.
        async def _backfill_procurement_side_effect(_db):
            touched = scanned = 0
            async for _t in _db.tenants.find(
                {"operating_model.pipelines": {"$exists": True}},
                {"_id": 0, "id": 1, "operating_model": 1},
            ):
                scanned += 1
                om = _t.get("operating_model") or {}
                changed = False
                for _p in (om.get("pipelines") or []):
                    # Identify procurement: pipelines with an
                    # approval_stage, plus the legacy purchase_payment key.
                    if not (_p.get("approval_stage") or
                            _p.get("key") == "purchase_payment"):
                        continue
                    _stages = _p.get("stages") or []
                    if not _stages:
                        continue
                    _term = _stages[-1]
                    if not isinstance(_term, dict):
                        continue  # legacy string stage; WE-03 migration handles this pre-run
                    _ses = _term.setdefault("side_effects", [])
                    if any((_se or {}).get("kind") == "create_expense" for _se in _ses):
                        continue
                    _ses.append({
                        "kind": "create_expense",
                        "params": {"status": "awaiting_bill"},
                    })
                    changed = True
                if changed:
                    await _db.tenants.update_one(
                        {"id": _t["id"]},
                        {"$set": {"operating_model": om,
                                  "updated_at": now_iso()}},
                    )
                    touched += 1
            logger.info(
                f"[WE-08] backfill_procurement_side_effect: "
                f"scanned={scanned} touched={touched}"
            )
        try:
            _pres = await _apply_migration(
                db, "backfill_procurement_side_effect_v1",
                _backfill_procurement_side_effect,
                description="WE-08: bind create_expense side-effect to procurement terminal stage",
            )
            if _pres == "applied":
                logger.info("Migration applied: backfill_procurement_side_effect_v1")
        except Exception as e:
            logger.exception(f"backfill_procurement_side_effect migration: {e}")  # WE-08
        # WE-09 (2026-08-16): stage_version = optimistic-lock counter for
        # engine.advance's find_one_and_update CAS. Backfill every
        # existing workflow to stage_version=0 so the first engine
        # advance transitions to 1 cleanly.
        async def _backfill_stage_version(_db):
            _r = await _db.workflows.update_many(
                {"stage_version": {"$exists": False}},
                {"$set": {"stage_version": 0}},
            )
            logger.info(
                f"[WE-09] backfill_stage_version: "
                f"workflows initialised={getattr(_r, 'modified_count', 0)}"
            )
        try:
            _svres = await _apply_migration(
                db, "backfill_stage_version_v1", _backfill_stage_version,
                description="WE-09: initialise workflows.stage_version=0 for optimistic-lock CAS",
            )
            if _svres == "applied":
                logger.info("Migration applied: backfill_stage_version_v1")
        except Exception as e:
            logger.exception(f"backfill_stage_version migration: {e}")  # WE-09
        # WE-01.5 (2026-08-16): backfill stage.role for existing
        # tenants. The AI didn't emit it before, so we derive it from
        # (a) stage.tasks[0].role if a template task exists there, or
        # (b) the legacy WORKFLOW_OWNER_ROLE map for the well-known
        # pipeline types (production / distribution / purchase_payment
        # / sales_dispatch). Skip stages that already have role set.
        # Idempotent -- filter excludes tenants where every stage
        # already carries the field.
        async def _backfill_stage_role(_db):
            touched = scanned = 0
            async for _t in _db.tenants.find(
                {"operating_model.pipelines": {"$exists": True}},
                {"_id": 0, "id": 1, "operating_model": 1},
            ):
                scanned += 1
                om = _t.get("operating_model") or {}
                changed = False
                for _p in (om.get("pipelines") or []):
                    _p_key = _p.get("key")
                    _legacy = WORKFLOW_OWNER_ROLE.get(_p_key) or {}
                    for _s in (_p.get("stages") or []):
                        if not isinstance(_s, dict):
                            continue
                        if _s.get("role"):
                            continue
                        _stage_key = _s.get("key")
                        # (a) derive from first template task's role
                        _from_task = None
                        for _tk in (_s.get("tasks") or []):
                            if _tk.get("role"):
                                _from_task = _tk["role"]
                                break
                        # (b) legacy per-stage map
                        _from_legacy = _legacy.get(_stage_key)
                        _role = _from_task or _from_legacy or ""
                        if _role:
                            _s["role"] = _role
                            changed = True
                if changed:
                    await _db.tenants.update_one(
                        {"id": _t["id"]},
                        {"$set": {"operating_model": om,
                                  "updated_at": now_iso()}},
                    )
                    touched += 1
            logger.info(
                f"[WE-01.5] backfill_stage_role: scanned={scanned} touched={touched}"
            )
        try:
            _srres = await _apply_migration(
                db, "backfill_stage_role_v1", _backfill_stage_role,
                description="WE-01.5: derive stage.role from tasks[0].role or WORKFLOW_OWNER_ROLE legacy map",
            )
            if _srres == "applied":
                logger.info("Migration applied: backfill_stage_role_v1")
        except Exception as e:
            logger.exception(f"backfill_stage_role migration: {e}")  # WE-01.5
        # WE-01: indexes for the new query patterns unlocked by the
        # workflow linkage. Compound (tenant_id, workflow_id, stage_key)
        # supports both "all tasks for this card" (uses the tenant_id +
        # workflow_id prefix) and "all tasks in this specific stage of
        # this card" (uses the full compound). Partial filter on
        # workflow_id !=  null keeps the index small -- most ad-hoc
        # tasks won't have workflow_id and shouldn't bloat the index.
        try:
            await db.tasks.create_index(
                [("tenant_id", 1), ("workflow_id", 1), ("stage_key", 1)],
                name="tasks_tenant_workflow_stage",
                partialFilterExpression={
                    "workflow_id": {"$type": "string"}},
            )
        except Exception as e:
            logger.warning(f"WE-01 tasks_tenant_workflow_stage index: {e}")
        # FIX-003-D (S2-07): auth_email_tokens for email verification +
        # password reset. Unique index on the token string, TTL index on
        # expires_at so used/expired rows auto-purge. Kind + email combo
        # is queried on issue() to reuse an existing token within the
        # cooldown — add a compound index for that lookup too.
        try:
            await db.auth_email_tokens.create_index("token", unique=True,
                                                    name="auth_email_tokens_token_unique")
        except Exception as e:
            logger.warning(f"auth_email_tokens token index: {e}")
        try:
            await db.auth_email_tokens.create_index(
                "expires_at", expireAfterSeconds=0,
                name="auth_email_tokens_expires_at_ttl",
            )
        except Exception as e:
            logger.warning(f"auth_email_tokens TTL index: {e}")
        try:
            await db.auth_email_tokens.create_index(
                [("kind", 1), ("email", 1), ("used_at", 1)],
                name="auth_email_tokens_kind_email_used",
            )
        except Exception as e:
            logger.warning(f"auth_email_tokens compound index: {e}")
        # FIX-004-G (RBAC-21): active_sessions collection indexes.
        # Two hot patterns: /me/sessions (find by user_id) and revoke
        # (find by jti). TTL on `exp` cleans up expired-token rows.
        try:
            await db.active_sessions.create_index(
                "jti", unique=True, name="active_sessions_jti_unique",
            )
            await db.active_sessions.create_index(
                [("user_id", 1), ("created_at", -1)],
                name="active_sessions_user_created",
            )
            await db.active_sessions.create_index(
                "exp", expireAfterSeconds=0,
                name="active_sessions_exp_ttl",
            )
        except Exception as e:
            logger.warning(f"active_sessions indexes: {e}")
        # FIX-003-C (S2-06): revoked-token table for logout-invalidates-JWT.
        # `jti` is the lookup key on every authenticated request (see
        # core.get_current_user -> services.session_revocation.is_revoked),
        # and the TTL on `exp` purges rows when the underlying token would
        # have expired anyway — keeps the table bounded to (~= logouts
        # per 7-day window).
        try:
            await db.revoked_tokens.create_index("jti", unique=True,
                                                 name="revoked_tokens_jti_unique")
        except Exception as e:
            logger.warning(f"revoked_tokens jti index: {e}")
        try:
            await db.revoked_tokens.create_index(
                "exp", expireAfterSeconds=0,
                name="revoked_tokens_exp_ttl",
            )
        except Exception as e:
            logger.warning(f"revoked_tokens TTL index: {e}")
        # FIX-002-A: index the normalized 10-digit form so OTP login + WhatsApp
        # routing are exact-match lookups instead of full-collection scans.
        # Partial index — only users who actually have a phone contribute; keeps
        # the index small and skips users with phone_norm = None/"".
        await db.users.create_index(
            [("phone_norm", 1)],
            partialFilterExpression={"phone_norm": {"$type": "string", "$gt": ""}},
            name="users_phone_norm_partial",
        )
        # FIX-002-C: phone_norm backfill routed through the migration ledger.
        # Idempotent internally (only touches docs missing the field) AND
        # tracked in db.migrations_applied so subsequent boots skip cleanly.
        # (2026-08-16: import hoisted to _bootstrap top -- see comment there.)

        async def _backfill_phone_norm(_db):
            from services.auth.phone import norm_phone as _np
            async for _u in _db.users.find(
                {"phone": {"$type": "string", "$gt": ""}, "phone_norm": {"$exists": False}},
                {"_id": 0, "id": 1, "phone": 1},
            ):
                _pn = _np(_u.get("phone") or "")
                if _pn:
                    await _db.users.update_one({"id": _u["id"]}, {"$set": {"phone_norm": _pn}})

        try:
            _result = await _apply_migration(
                db, "backfill_users_phone_norm_v1", _backfill_phone_norm,
                description="FIX-002-A: compute phone_norm for pre-migration users",
            )
            if _result == "applied":
                logger.info("Migration applied: backfill_users_phone_norm_v1")
        except Exception as e:
            logger.exception(f"phone_norm backfill migration: {e}")  # S5-05
        # FIX-003-A (S2-03): otp_codes are keyed by (phone, tenant_id) so
        # two tenants that share a phone can each hold their own live
        # OTP. The migration ledger call:
        #   1) drops the old single-column {phone: 1} unique index
        #      (created implicitly by early code paths); leaving it in
        #      place would prevent the compound insert.
        #   2) deletes any pre-existing otp_codes rows that lack a
        #      tenant_id — they'd fail the new compound-unique index
        #      and they're TTL'd anyway (300s), so we're not losing
        #      anything a user needs.
        # After the migration runs once, we create the new compound
        # unique index. Both are idempotent — safe on every boot.
        async def _prepare_otp_codes_tenant_scope(_db):
            # Drop any index whose spec is exactly {"phone": 1} — that's
            # the old single-column index we need to replace.
            try:
                info = await _db.otp_codes.index_information()
                for idx_name, spec in info.items():
                    key = spec.get("key") or []
                    # spec['key'] is a list of (field, direction) tuples
                    if [(k, d) for k, d in key] == [("phone", 1)]:
                        try:
                            await _db.otp_codes.drop_index(idx_name)
                            logger.info(f"[FIX-003-A] dropped legacy otp_codes index {idx_name}")
                        except Exception as _e:
                            logger.warning(f"[FIX-003-A] could not drop {idx_name}: {_e}")
            except Exception as _e:
                logger.warning(f"[FIX-003-A] otp_codes index scan failed: {_e}")
            # Delete rows missing tenant_id — they're short-lived and
            # would fail the new compound-unique index.
            try:
                res = await _db.otp_codes.delete_many({"tenant_id": {"$in": [None, ""]}})
                if res.deleted_count:
                    logger.info(f"[FIX-003-A] cleared {res.deleted_count} pre-migration otp_codes rows")
            except Exception as _e:
                logger.warning(f"[FIX-003-A] otp_codes cleanup failed: {_e}")
            try:
                res2 = await _db.otp_codes.delete_many({"tenant_id": {"$exists": False}})
                if res2.deleted_count:
                    logger.info(f"[FIX-003-A] cleared {res2.deleted_count} tenant_id-less otp_codes rows")
            except Exception as _e:
                logger.warning(f"[FIX-003-A] otp_codes cleanup (missing field) failed: {_e}")

        try:
            _fix003_res = await _apply_migration(
                db, "otp_codes_tenant_scope_v1", _prepare_otp_codes_tenant_scope,
                description="FIX-003-A: drop legacy {phone:1} unique index and clear tenant-less otp_codes rows",
            )
            if _fix003_res == "applied":
                logger.info("Migration applied: otp_codes_tenant_scope_v1")
        except Exception as e:
            logger.exception(f"otp_codes tenant-scope migration: {e}")  # S5-05

        # FIX-007-A (S4-03): rename brain_contexts → brain_query_cache to
        # kill the name collision with brain_context (singular, decision-
        # provenance store). Mongo's renameCollection is atomic and only
        # works when the target doesn't already exist as a REAL collection
        # — this migration checks source has data and target is missing
        # before firing; on second boot, source is empty/absent and
        # target holds the data, so the guard skips (idempotent).
        async def _rename_brain_contexts_to_query_cache(_db):
            names = set(await _db.list_collection_names())
            has_src = "brain_contexts" in names
            has_dst = "brain_query_cache" in names
            if not has_src:
                logger.info("[S4-03] brain_contexts absent — rename no-op")
                return
            if has_dst:
                # Target already there — likely a fresh index create landed
                # first on a boot that lost the migration ledger. Check
                # counts; if target is empty we can safely drop+rename,
                # else we bail (destructive to merge) and leave both.
                dst_n = await _db.brain_query_cache.count_documents({})
                if dst_n == 0:
                    await _db.brain_query_cache.drop()
                    logger.info("[S4-03] dropped empty brain_query_cache before rename")
                else:
                    logger.warning(
                        "[S4-03] brain_query_cache already has data (%d rows); "
                        "leaving brain_contexts as-is. Manual merge needed.",
                        dst_n,
                    )
                    return
            # Motor exposes admin.command; renameCollection needs fully-
            # qualified namespaces.
            src_ns = f"{DB_NAME}.brain_contexts"
            dst_ns = f"{DB_NAME}.brain_query_cache"
            await client.admin.command(
                {"renameCollection": src_ns, "to": dst_ns, "dropTarget": False}
            )
            logger.info("[S4-03] renamed brain_contexts → brain_query_cache")
        try:
            _s403_res = await _apply_migration(
                db, "rename_brain_contexts_to_query_cache_v1",
                _rename_brain_contexts_to_query_cache,
                description="FIX-007-A (S4-03): kill brain_contexts/brain_context name collision",
            )
            if _s403_res == "applied":
                logger.info("Migration applied: rename_brain_contexts_to_query_cache_v1")
        except Exception as e:
            logger.exception(f"brain_contexts rename migration: {e}")  # S5-05

        # FIX-007-A (S4-01): drop text indexes that were created with
        # default_language="none" so the create_index calls below can
        # rebuild them with default_language="english" (Mongo doesn't
        # let you MUTATE default_language on an existing text index).
        # Only drops when the existing index spec says language:none —
        # if someone already switched to english, this is a no-op.
        async def _drop_none_language_text_indexes(_db):
            for coll_name, index_name in (
                ("brain_context", "brain_context_text_v1"),
                ("brain_documents", "brain_documents_text_v1"),
            ):
                try:
                    info = await _db[coll_name].index_information()
                    spec = info.get(index_name) or {}
                    if spec.get("default_language") == "none":
                        await _db[coll_name].drop_index(index_name)
                        logger.info(
                            "[S4-01] dropped %s.%s (default_language=none) — "
                            "will be recreated with english below",
                            coll_name, index_name,
                        )
                except Exception as _e:
                    logger.warning("[S4-01] %s.%s inspect/drop failed: %s",
                                    coll_name, index_name, _e)
        try:
            _s401_res = await _apply_migration(
                db, "drop_none_language_text_indexes_v1",
                _drop_none_language_text_indexes,
                description="FIX-007-A (S4-01): drop stale text indexes so english-stemmed ones can rebuild",
            )
            if _s401_res == "applied":
                logger.info("Migration applied: drop_none_language_text_indexes_v1")
        except Exception as e:
            logger.exception(f"drop-none-language text indexes migration: {e}")  # S5-05
        # New compound unique index — one live OTP per (phone, tenant).
        try:
            await db.otp_codes.create_index(
                [("phone", 1), ("tenant_id", 1)],
                unique=True,
                name="otp_codes_phone_tenant_unique",
            )
        except Exception as e:
            logger.warning(f"otp_codes compound unique index: {e}")
        await db.decisions.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.tasks.create_index([("tenant_id", 1), ("status", 1), ("due_date", 1)])
        await db.tasks.create_index([("tenant_id", 1), ("assignee_id", 1), ("status", 1)])
        await db.workflows.create_index("tenant_id")
        await db.platform_admins.create_index("email", unique=True)
        await db.usage_events.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.usage_events.create_index("created_at")
        await db.files.create_index([("tenant_id", 1), ("task_id", 1)])
        # High-volume collections — these were doing full scans pre-1.0.
        await db.activity.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.notifications.create_index([("tenant_id", 1), ("user_id", 1), ("read", 1), ("created_at", -1)])
        await db.inbox.create_index([("tenant_id", 1), ("status", 1), ("created_at", -1)])
        await db.inbox.create_index([("tenant_id", 1), ("classification", 1)])
        await db.voice_notes.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.memory.create_index([("tenant_id", 1), ("created_at", -1)])
        # FIX-007-A (S4-01): db.memory had NO text index — every knowledge
        # lookup fell back to case-insensitive regex, which is a collection
        # scan filtered by tenant_id only. Adding ranked full-text search
        # brings /ask + brain_router into parity with brain_context /
        # brain_documents (both of which have had text indexes for months).
        # default_language="english" enables stemming so "refund" also
        # matches "refunds" / "refunded" — the recall bug the tracker
        # called out ("refund != refunds").
        try:
            await db.memory.create_index(
                [("text", "text"), ("tag", "text")],
                weights={"text": 3, "tag": 1},
                name="memory_text_v1",
                default_language="english",
            )
        except Exception as e:
            logger.warning(f"memory text index: {e}")
        await db.brain_audit.create_index([("tenant_id", 1), ("created_at", -1)])
        # FIX-007-A (S4-03): brain_contexts (plural) renamed to
        # brain_query_cache — the singular/plural collision with the
        # decision-provenance store `brain_context` was a foot-gun that
        # produced silent data corruption on typo. Post-rename these
        # indexes live on the new collection; the migration below
        # renameCollections + skips the create if the rename already ran.
        await db.brain_query_cache.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.brain_query_cache.create_index("id")
        await db.leaves.create_index([("tenant_id", 1), ("status", 1), ("from_date", -1)])
        await db.contacts.create_index([("tenant_id", 1), ("name", 1)])
        # FIX-003-B (S2-08): the contacts collection field is `type`
        # (customer|vendor), NOT `kind`. Every read (see server.py
        # list_contacts + the enrich_contacts projection) uses `type`,
        # so the old {tenant_id: 1, kind: 1} index was dead — index
        # entries got created only for docs that happened to also
        # carry a legacy `kind` field (none of them, in practice),
        # and every `type=vendor` query fell back to a collection
        # scan filtered by tenant_id only. Drop the dead one and
        # replace with the real field.
        await db.contacts.create_index([("tenant_id", 1), ("type", 1)])
        try:
            _ci_info = await db.contacts.index_information()
            for _idx_name, _spec in _ci_info.items():
                _key = _spec.get("key") or []
                if [(k, d) for k, d in _key] == [("tenant_id", 1), ("kind", 1)]:
                    try:
                        await db.contacts.drop_index(_idx_name)
                        logger.info(f"[FIX-003-B] dropped dead contacts index {_idx_name}")
                    except Exception as _e:
                        logger.warning(f"[FIX-003-B] could not drop contacts kind index: {_e}")
        except Exception as _e:
            logger.warning(f"[FIX-003-B] contacts index inspection failed: {_e}")
        await db.invoices.create_index([("tenant_id", 1), ("status", 1), ("due_date", 1)])
        await db.invoices.create_index([("tenant_id", 1), ("contact_name", 1)])
        await db.payments.create_index([("tenant_id", 1), ("invoice_id", 1)])
        await db.expenses.create_index([("tenant_id", 1), ("date", -1)])
        await db.complaints.create_index([("tenant_id", 1), ("status", 1), ("created_at", -1)])
        await db.calendar_events.create_index([("tenant_id", 1), ("date", 1)])
        await db.meetings.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.platform_audit.create_index([("admin_id", 1), ("created_at", -1)])
        await db.signup_sessions.create_index("id")
        await db.tenants.create_index("id")
        # Company Brain — documents catalog (P1) indexes.
        await db.brain_documents.create_index([("tenant_id", 1), ("is_deleted", 1), ("created_at", -1)])
        await db.brain_documents.create_index([("tenant_id", 1), ("kind", 1)])
        await db.brain_documents.create_index([("tenant_id", 1), ("keywords", 1)])
        await db.brain_documents.create_index([("tenant_id", 1), ("tags", 1)])
        # Company Brain — decision/approval/resolution context (P2) indexes.
        await db.brain_context.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.brain_context.create_index([("tenant_id", 1), ("kind", 1), ("created_at", -1)])
        await db.brain_context.create_index([("tenant_id", 1), ("source_type", 1), ("source_id", 1)])
        # P5 — Mongo native full-text index so knowledge_lookup can rank by
        # relevance (not just regex hits). Wrapped in try/except because a
        # collection can only have ONE text index — this call is a no-op the
        # second time it's run with the same fields.
        # FIX-007-A (S4-01): default_language now "english" (was "none")
        # so Mongo's snowball stemmer kicks in — "refund" matches "refunds"
        # / "refunded", "invoice" matches "invoiced" / "invoicing".
        # Mongo doesn't let you MUTATE default_language on an existing
        # text index, so the migration below drops the old
        # brain_context_text_v1 / brain_documents_text_v1 indexes exactly
        # once; this create_index then rebuilds them with the new setting.
        try:
            await db.brain_context.create_index(
                [("title", "text"), ("why", "text"), ("tags", "text")],
                weights={"title": 6, "tags": 3, "why": 1},
                name="brain_context_text_v1",
                default_language="english",
            )
        except Exception as e:
            logger.warning(f"brain_context text index: {e}")
        try:
            await db.brain_documents.create_index(
                [("title", "text"), ("summary", "text"),
                 ("original_filename", "text"), ("keywords", "text"), ("tags", "text")],
                weights={"title": 8, "tags": 4, "keywords": 3, "summary": 2, "original_filename": 1},
                name="brain_documents_text_v1",
                default_language="english",
            )
        except Exception as e:
            logger.warning(f"brain_documents text index: {e}")
        try:
            await obj_store.init_storage()
        except Exception as e:
            logger.warning(f"Object storage init deferred (will retry on first upload): {e}")
        await load_ai_keys_from_db()
        await seed_platform_admin()
        await seed_demo()
        # FIX-002-C: route through the migration ledger so it runs exactly
        # once instead of scanning every tenant on every boot.
        try:
            _tres = await _apply_migration(
                db, "migrate_tenants_backfill_roles_v1",
                lambda _db: migrate_tenants(),
                description="Backfill industry/roles/products on pre-onboarding tenants",
            )
            if _tres == "applied":
                logger.info("Migration applied: migrate_tenants_backfill_roles_v1")
        except Exception as e:
            logger.exception(f"migrate_tenants migration: {e}")  # S5-05
        # FIX-002-E: copy any legacy local-disk uploads into obj_store and
        # rewrite the referring domain records to point at the new
        # storage_path. Runs exactly once via ledger; safe on second boot.
        try:
            _ures = await _apply_migration(
                db, "migrate_local_disk_uploads_to_obj_store_v1",
                migrate_local_disk_uploads_to_obj_store,
                description="FIX-002-E: move voice_notes/meetings/ingestions/ledger files to obj_store",
            )
            if _ures == "applied":
                logger.info("Migration applied: migrate_local_disk_uploads_to_obj_store_v1")
        except Exception as e:
            logger.exception(f"local-disk uploads migration: {e}")  # S5-05
        await fixup_demo_tenant()
        await write_test_credentials()
        logger.info("Bootstrap complete.")
    except Exception as e:
        logger.error(f"Bootstrap error (non-fatal, app stays up): {e}")


async def seed_platform_admin():
    """FIX-006-A (S0-01): platform super-admin seeder.

    Prior behaviour had two problems:
      1. Hardcoded default email + password (`admin@decisionos.biz` /
         `DecisionOS@2026`) shipped in the code — anyone who deployed
         without SUPERADMIN_* env vars set got a well-known admin
         account.
      2. On every restart, if the env password didn't match the DB
         hash, the DB was silently overwritten. That blocked
         credential rotation via the DB and meant anyone with env-var
         write access could re-take the account across the fleet.

    Now:
      * In prod (ENV=prod) we REFUSE to seed with the fallback defaults —
        raise a loud error so a misconfigured deploy fails fast instead
        of standing up a known-credentials admin.
      * We only INSERT when the admin doesn't exist. Overwriting an
        existing hash requires the explicit SUPERADMIN_ALLOW_HASH_REFRESH=1
        opt-in (one-off flag for the rare intended reset).
    """
    from config import PLATFORM_ADMIN_JWT_SECRET as _pjwt  # noqa: F401 (import triggers config warn)
    env_email = os.environ.get("SUPERADMIN_EMAIL", "").strip().lower()
    env_password = os.environ.get("SUPERADMIN_PASSWORD", "").strip()
    running_env = os.environ.get("ENV", "dev").strip().lower()
    if not env_email or not env_password:
        if running_env == "prod":
            raise RuntimeError(
                "SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD are REQUIRED when ENV=prod. "
                "Refusing to boot with hardcoded defaults."
            )
        # Non-prod fallback so local dev still gets a working admin login.
        # Log the fact loudly so nobody forgets to set the env in staging.
        email = env_email or "admin@decisionos.biz"
        password = env_password or "DecisionOS@2026"
        logger.warning(
            "Seeding platform super-admin with DEV FALLBACK credentials. "
            "Set SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD before touching prod."
        )
    else:
        email = env_email
        password = env_password
    existing = await db.platform_admins.find_one({"email": email})
    if not existing:
        await db.platform_admins.insert_one({
            "id": new_id(), "email": email, "name": "Platform Admin",
            "password_hash": hash_password(password), "created_at": now_iso(),
        })
        logger.info(f"Platform super-admin seeded: {email}")
        return
    # From here on: an admin doc already exists. We NEVER silently
    # replace its hash — that would let anyone with env-var access
    # overwrite the account on the next restart. Only refresh when the
    # deployer explicitly opts in via SUPERADMIN_ALLOW_HASH_REFRESH=1,
    # which they should then unset on the following deploy.
    from config import SUPERADMIN_ALLOW_HASH_REFRESH as _refresh_ok
    if _refresh_ok and not verify_password(password, existing.get("password_hash", "")):
        await db.platform_admins.update_one(
            {"id": existing["id"]},
            {"$set": {"password_hash": hash_password(password)}},
        )
        logger.warning(
            f"Platform super-admin hash REFRESHED from env (opt-in): {email}. "
            "Unset SUPERADMIN_ALLOW_HASH_REFRESH now to prevent silent future refreshes."
        )


@app.on_event("startup")
async def startup():
    # Fire-and-forget so uvicorn binds the port and answers /health immediately —
    # otherwise slow remote-Atlas seeding would block readiness and fail the deploy health check.
    asyncio.create_task(_bootstrap())
    # Timer-driven follow-up/escalation sweep (independent of user polling).
    asyncio.create_task(_followup_scheduler_loop())


@app.get("/health")
async def health():
    return {"status": "ok"}





# App assembly (Epic 8 Sprint 1): router + middleware wiring extracted to
# bootstrap/. server.py remains the entry (server:app). As of Sprint 3 the
# in-file `api` router is fully retired -- every endpoint lives in routers/.
from bootstrap.routing import register_api_routers  # noqa: E402
register_api_routers(app)

from bootstrap.middleware import register_middleware  # noqa: E402
register_middleware(app)


@app.on_event("shutdown")
async def shutdown_db_client():
    # PyMongo AsyncMongoClient.close() is a coroutine — must be awaited.
    await client.close()

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
# App bootstrap + lifespan moved to bootstrap/lifecycle.py (Epic 8 Sprint 7 --
# U8-07.4). _bootstrap re-exported for `from server import _bootstrap`.
from bootstrap.lifecycle import lifespan, _bootstrap  # noqa: E402,F401

app = FastAPI(title="DecisionOS", lifespan=lifespan)


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
# Stage maps moved to models/workflows.py (Epic 8 Sprint 7 -- U8-07.2) so the
# demo seeder in bootstrap/ and the AI workflow generator share them without
# importing server. Re-exported for `from server import WORKFLOW_STAGES`.
from models.workflows import WORKFLOW_STAGES, WORKFLOW_OWNER_ROLE  # noqa: E402,F401


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Unified Inbox
# ---------------------------------------------------------------------------
# Inbox classifications live in `models/inbox.py` (Phase B step 6).
from models.inbox import INBOX_CLASSES  # noqa: F401


# add_inbox_item moved to services/inbox.py (Epic 8 Sprint 7 -- U8-07.5).
from services.inbox import add_inbox_item  # noqa: E402,F401


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
# OTP login subsystem moved to services/otp.py (Epic 8 Sprint 7 -- U8-07.5).
# Re-exported so routers/auth_otp.py + deferred call sites resolve; importing
# services.otp also runs the prod SMS-provider boot guard.
from services.otp import (  # noqa: E402,F401
    _issue_otp, _hash_otp, _send_otp_sms, _apm_send_and_fetch_otp,
    OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN,
    TWILIO_ENABLED, APM_ENABLED, APM_SMS_API_KEY, APM_OTP_ENDPOINT,
)


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


# Background scheduler + provider-outage alerts moved to workers/schedulers.py
# (Epic 8 Sprint 7 -- U8-07.1). Re-exported so the lifespan wiring and any
# deferred `from server import ...` call sites keep resolving.
from workers.schedulers import (  # noqa: E402
    _followup_scheduler_loop, _notify_provider_outages, FOLLOWUP_INTERVAL_SECONDS,
)


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
# Demo seeding moved to bootstrap/seed.py (Epic 8 Sprint 7 -- U8-07.2).
# Re-exported so _bootstrap (below) and any `from server import` resolve.
from bootstrap.seed import (  # noqa: E402,F401
    seed_demo, write_test_credentials, fixup_demo_tenant, DEMO_EMAIL, DEMO_PASSWORD,
)


# Migrations + platform-admin seed moved to bootstrap/migrations.py
# (Epic 8 Sprint 7 -- U8-07.3). Re-exported so _bootstrap resolves them.
from bootstrap.migrations import (  # noqa: E402,F401
    migrate_tenants, migrate_local_disk_uploads_to_obj_store, seed_platform_admin,
)


# _bootstrap + startup/shutdown lifecycle moved to bootstrap/lifecycle.py
# (Epic 8 Sprint 7 -- U8-07.4); wired via FastAPI(lifespan=...) above.


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

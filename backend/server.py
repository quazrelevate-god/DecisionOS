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
from services import brain_context

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
api = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RoleItem(BaseModel):
    key: str
    label: str


class ProductItem(BaseModel):
    name: str
    description: Optional[str] = ""


class RegisterInput(BaseModel):
    company_name: str
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    phone: Optional[str] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    company_size: Optional[str] = None
    region: Optional[str] = None
    currency: Optional[str] = "INR"
    gst: Optional[str] = None
    branches: Optional[str] = None
    business_scale: Optional[dict] = None
    current_software: Optional[List[str]] = None
    roles: Optional[List[RoleItem]] = None
    products: Optional[List[ProductItem]] = None
    os_blueprint: Optional[dict] = None


class TenantUpdateInput(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    region: Optional[str] = None
    currency: Optional[str] = None
    gst: Optional[str] = None
    phone: Optional[str] = None
    branches: Optional[str] = None
    products: Optional[List[ProductItem]] = None


class InviteInput(BaseModel):
    phones: List[str]


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class OtpRequestInput(BaseModel):
    phone: str
    # FIX-003-A (S2-03): tenant hint. Optional so the single-tenant fast
    # path stays backward-compatible; required when the phone is
    # registered in more than one workspace (the request returns
    # {"ambiguous": true, "choices": [...]} in that case and the
    # frontend re-sends with tenant_id filled in).
    tenant_id: Optional[str] = None


class OtpVerifyInput(BaseModel):
    phone: str
    code: str
    # FIX-003-A (S2-03): tenant hint. Same rules as OtpRequestInput —
    # the OTP code is keyed by (phone, tenant_id) so verifying without
    # a tenant on a multi-tenant phone is a 409.
    tenant_id: Optional[str] = None


class UserCreateInput(BaseModel):
    name: str
    email: EmailStr
    password: Optional[str] = None  # optional — omit for passwordless (mobile OTP) members
    role: str
    phone: Optional[str] = None
    permissions: Optional[List[str]] = None
    reporting_manager_id: Optional[str] = None


class UserUpdateInput(BaseModel):
    role: Optional[str] = None
    phone: Optional[str] = None
    permissions: Optional[List[str]] = None
    reporting_manager_id: Optional[str] = None


class TextNoteInput(BaseModel):
    text: str
    title: Optional[str] = None
    language: Optional[str] = "auto"
    file_ids: Optional[List[str]] = None


TASK_TYPES = {"operational", "sales", "purchase", "production", "finance", "hr", "other"}
# Task status vocabulary now lives in `services/tasks.py` (Phase B step 4).
from services.tasks import TASK_STATUSES  # noqa: F401


# TaskCreateInput + TaskUpdateInput now live in `models/tasks.py` (Phase B).
from models.tasks import TaskCreateInput, TaskUpdateInput  # noqa: F401


class WorkflowCreateInput(BaseModel):
    type: str  # sales_dispatch | purchase_payment
    title: str
    detail: Optional[str] = ""
    amount: Optional[float] = None
    counterparty: Optional[str] = None
    contact_id: Optional[str] = None


class WorkflowAdvanceInput(BaseModel):
    stage: str
    note: Optional[str] = ""


class AskInput(BaseModel):
    question: str


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


class ContactInput(BaseModel):
    type: str = "customer"
    name: str
    company: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    tax_id: Optional[str] = ""
    tags: Optional[List[str]] = None
    status: Optional[str] = "lead"
    assigned_id: Optional[str] = None
    notes: Optional[str] = ""
    birthday: Optional[str] = ""
    lifecycle_stage: Optional[str] = ""  # E2-03


class ContactUpdateInput(BaseModel):
    type: Optional[str] = None
    name: Optional[str] = None
    company: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    tax_id: Optional[str] = None
    tags: Optional[List[str]] = None
    status: Optional[str] = None
    assigned_id: Optional[str] = None
    notes: Optional[str] = None
    birthday: Optional[str] = None
    lifecycle_stage: Optional[str] = None  # E2-03


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
async def ai_extract(transcript: str, session_id: str, allowed_roles: Optional[list] = None, members: Optional[list] = None,
                     pipelines: Optional[list] = None, task_categories: Optional[list] = None, extra_context: str = "") -> dict:
    roles = allowed_roles or ["owner", "sales", "operations", "finance"]
    roles_str = ",".join(roles)
    pipelines = pipelines or DEFAULT_OPERATING_MODEL["pipelines"]
    task_categories = task_categories or DEFAULT_OPERATING_MODEL["task_categories"]
    pipe_keys = [p["key"] for p in pipelines]
    pipe_keys_str = ",".join(pipe_keys)
    cat_keys_str = ",".join([c["key"] for c in task_categories])
    pipe_desc = " ".join(
        f"'{p['key']}' = the '{p['label']}' pipeline ({' → '.join(s['label'] for s in p['stages'])});"
        for p in pipelines
    )
    cat_desc = ", ".join(f"'{c['key']}' ({c['label']})" for c in task_categories)
    names = [m.get("name") for m in (members or []) if m.get("name")]
    members_line = (
        "Team members you can assign to by name: " + ", ".join(names) + ". "
        "If the directive explicitly names a person (e.g. 'tell Priya to...', 'ask Rajesh...'), set that task's "
        "\"assignee_name\" to the closest matching team member name above. Otherwise leave \"assignee_name\" empty "
        "and just pick a sensible \"assignee_role\". "
    ) if names else ""
    system = (
        "You are the extraction engine of DecisionOS, an operating brain for small businesses. "
        "Convert a founder's spoken/written directive into structured operational data. "
        "Return ONLY valid JSON, no prose. Schema: "
        "{\"summary\": string, \"confidence\": number between 0 and 1, "
        "\"decisions\": [{\"title\": string, \"detail\": string, \"category\": string, "
        "\"type\": one of [directive,approval,policy,observation]}], "
        "\"tasks\": [{\"title\": string, \"description\": string, \"assignee_role\": one of [" + roles_str + "], "
        "\"assignee_name\": string (a specific team member's name if one is explicitly mentioned, else empty), "
        "\"task_category\": one of [" + cat_keys_str + "] (the department this task belongs to), "
        "\"priority\": one of [low,medium,high], \"due_in_days\": integer or null}], "
        "\"workflow_events\": [{\"type\": one of [" + pipe_keys_str + "], \"title\": string, \"detail\": string, \"counterparty\": string, \"amount\": number or null}], "
        "\"reminders\": [{\"title\": string, \"due_in_days\": integer or null}], "
        "\"meeting_events\": [{\"title\": string, \"when\": string, \"due_in_days\": integer or null}], "
        "\"memory_notes\": [{\"text\": string, \"tag\": string}]}. "
        + members_line +
        "Use 'reminders' for simple personal follow-ups (e.g. 'call Kumar tomorrow', 'follow up with Toyota next Monday'). "
        "Use 'meeting_events' for meetings/reviews/calls to be scheduled (e.g. 'arrange a sales review on Friday', 'set up a vendor call Monday'). Keep meetings OUT of reminders. "
        "Use 'workflow_events' ONLY for concrete multi-step operational pipelines this business tracks on the board. "
        "Pick the \"type\" from the business's ACTUAL pipelines: " + pipe_desc + " "
        "Create a workflow_event only when the directive clearly starts/advances one of these pipelines; "
        "include the counterparty (customer/vendor name) and amount when mentioned. "
        "For every task, set \"task_category\" to the single best-fitting department from: " + cat_desc + ". "
        "IMPORTANT: Following up on, chasing, or collecting PAYMENT for an invoice (money a customer owes us) is NOT a workflow — create a TASK for it instead (assignee_role 'finance' or the named accountant if one exists), e.g. 'uploaded an invoice, ask the accountant to follow up on payment' -> a finance task titled 'Follow up on invoice payment' with the customer in the description. "
        "Do NOT put general rules/policies here — those belong in memory_notes. "
        "Use 'memory_notes' for lasting facts/policies the company should remember (e.g. 'don't purchase from XYZ again', 'salary increment for Arun from August'). "
        "The transcript may be in English, Tamil, or Tanglish (casual Tamil-English code-mix). Fully understand it regardless "
        "of language, and produce ALL output field values in clear English. "
        "TASK GRANULARITY (important): create exactly ONE task per distinct assignee (person or role). Do NOT split one "
        "person's single goal into several task cards — a directive like 'install and onboard all users using Ramesh's list' "
        "is ONE task for the responsible person, not one task per sub-step. The individual sub-steps (install, get the list, "
        "onboard each user, etc.) are handled later inside that task's AI execution guide, so keep them OUT of separate tasks. "
        "Only create multiple tasks when the work genuinely goes to DIFFERENT people/roles, or is a clearly separate deliverable "
        "for the same person that cannot be part of the same guided checklist. Put the fuller scope in the task's \"description\". "
        "Pick assignee_role ONLY from the provided role list. Infer sensible owners and due dates. If nothing applies, use empty arrays."
    )
    prompt = f"Founder directive transcript:\n\"\"\"\n{transcript}\n\"\"\"\n"
    if extra_context:
        prompt += (
            "\nThe founder also attached reference material (a photo/PDF/Word/Excel — e.g. a business card, "
            "a list, an order, a screenshot). Its full contents have already been read for you below. Use it "
            "TOGETHER with the directive: pull the concrete facts out of it (names, phone numbers, emails, "
            "company, addresses, dates, amounts, items) and put the relevant ones INTO the task description(s) so "
            "the assignee has everything they need. If the directive names a person (e.g. 'fix the appointment, "
            "Priya'), delegate the task to that person and include the attachment's details (e.g. the contact's "
            "name, phone and email from a business card) in that task's description. If the directive is empty, "
            "treat the attached document as the PRIMARY input and derive the decision and tasks from it.\n"
            f"ATTACHED REFERENCE CONTENT:\n\"\"\"\n{extra_context[:6000]}\n\"\"\"\n"
        )
    prompt += "Extract the structured JSON now."
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI extract parse error: {e} :: {resp[:400]}")
        data = {"summary": transcript[:200], "decisions": [], "tasks": [], "workflow_events": []}
    data.setdefault("summary", "")
    for k in ("decisions", "tasks", "workflow_events", "reminders", "meeting_events", "memory_notes"):
        if not isinstance(data.get(k), list):
            data[k] = []
    return data


async def ai_score_tasks(tasks: list, currency: str, session_id: str) -> dict:
    """Score open tasks on 4 axes (0-100) + a blended priority score. Returns {task_id: scores}."""
    if not tasks:
        return {}
    today = datetime.now(timezone.utc).date().isoformat()
    lines = []
    for t in tasks:
        lines.append({
            "id": t["id"], "title": t.get("title", ""), "description": (t.get("description") or "")[:200],
            "priority": t.get("priority", "medium"), "due_date": (t.get("due_date") or "")[:10],
            "assignee_role": t.get("assignee_role") or "unassigned", "status": t.get("status"),
        })
    system = (
        "You are the prioritization engine of DecisionOS, an operating brain for a small business. "
        f"Today is {today}. Currency is {currency}. "
        "For EACH task, rate 0-100 on four axes: "
        "business_impact (effect on operations/customers), revenue (direct money at stake / upside), "
        "risk (cost of NOT doing it — penalties, churn, compliance), and urgency (time pressure vs due date). "
        "Then give a blended priority_score 0-100 (higher = do sooner) and a one-line reason. "
        "Return ONLY valid JSON: {\"scores\":[{\"id\":string,\"business_impact\":int,\"revenue\":int,"
        "\"risk\":int,\"urgency\":int,\"priority_score\":int,\"reason\":string}]}. "
        "Include every task id exactly once."
    )
    prompt = "Tasks:\n" + json.dumps(lines, ensure_ascii=False) + "\nScore them now."
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    out = {}
    try:
        data = _extract_json(resp)
        for s in data.get("scores", []):
            tid = s.get("id")
            if not tid:
                continue
            def clamp(v):
                try:
                    return max(0, min(100, int(round(float(v)))))
                except Exception:
                    return 0
            out[tid] = {
                "business_impact": clamp(s.get("business_impact")),
                "revenue": clamp(s.get("revenue")),
                "risk": clamp(s.get("risk")),
                "urgency": clamp(s.get("urgency")),
                "priority_score": clamp(s.get("priority_score")),
                "reason": str(s.get("reason") or "")[:200],
            }
    except Exception as e:
        logger.error(f"AI score parse error: {e} :: {resp[:300]}")
    return out


async def ai_score_contact(contact: dict, metrics: dict, currency: str, session_id: str) -> dict:
    """Score a customer/supplier relationship. Returns {relationship_score, risk_score, reason, signals}."""
    ctype = contact.get("type") or "customer"
    payload = {
        "name": contact.get("name"), "type": ctype,
        "status": contact.get("status"), "tags": contact.get("tags"),
        "outstanding": metrics.get("outstanding"), "total_billed": metrics.get("total_billed"),
        "total_paid": metrics.get("total_paid"), "last_payment": metrics.get("last_payment"),
        "open_complaints": metrics.get("open_complaints"),
        "pending_deliveries": metrics.get("pending_deliveries"),
        "invoice_count": metrics.get("invoice_count"), "payment_count": metrics.get("payment_count"),
    }
    system = (
        "You are the relationship-intelligence engine of DecisionOS for a small business. "
        f"Currency is {currency}. Given a {ctype}'s financial & interaction history, rate two things 0-100: "
        "relationship_score (overall health/value of the relationship — high = strong, loyal, profitable), and "
        "risk_score (likelihood of a problem — non-payment, churn, complaints, supply risk; high = risky). "
        "Give a one-line reason and up to 3 short signal phrases. "
        "Return ONLY valid JSON: {\"relationship_score\":int,\"risk_score\":int,\"reason\":string,\"signals\":[string]}."
    )
    prompt = json.dumps(payload, ensure_ascii=False, default=str) + "\nScore this relationship now."
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    def clamp(v):
        try:
            return max(0, min(100, int(round(float(v)))))
        except Exception:
            return 0
    try:
        d = _extract_json(resp)
        return {
            "relationship_score": clamp(d.get("relationship_score")),
            "risk_score": clamp(d.get("risk_score")),
            "reason": str(d.get("reason") or "")[:200],
            "signals": [str(s)[:60] for s in (d.get("signals") or [])][:3],
        }
    except Exception as e:
        logger.error(f"AI contact score parse error: {e} :: {resp[:300]}")
        return {}


async def ai_meeting_notes(transcript: str, members: list, session_id: str) -> dict:
    """Turn a raw meeting transcript into structured minutes + action items."""
    names = [m.get("name") for m in (members or []) if m.get("name")]
    members_line = ("Team members you may assign action items to by name: " + ", ".join(names) + ". "
                    "Set action_items[].assignee_name to the closest matching name when a person is named, else empty. ") if names else ""
    system = (
        "You are the meeting-notes engine of DecisionOS for a small business. "
        "Convert a raw meeting transcript into concise, structured minutes. Return ONLY valid JSON: "
        "{\"title\": string (short meeting title), \"summary\": string (2-4 sentences), "
        "\"key_points\": [string], \"decisions\": [string], "
        "\"action_items\": [{\"title\": string, \"assignee_name\": string, \"due_in_days\": integer or null}]}. "
        + members_line +
        "ACTION-ITEM GRANULARITY (important): create exactly ONE action item per distinct assignee for a single goal. "
        "Do NOT split one person's task into several items — the sub-steps are handled inside that task's execution guide later. "
        "Only create multiple items when they go to DIFFERENT people or are clearly separate deliverables. "
        "The transcript may be English, Tamil or Tanglish — understand it and output all values in clear English."
    )
    prompt = f"Meeting transcript:\n\"\"\"\n{(transcript or '')[:40000]}\n\"\"\"\nExtract the structured minutes now."
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI meeting parse error: {e} :: {resp[:300]}")
        d = {}
    d.setdefault("title", "Meeting")
    d.setdefault("summary", (transcript or "")[:200])
    for k in ("key_points", "decisions", "action_items"):
        if not isinstance(d.get(k), list):
            d[k] = []
    return d


async def ai_execution_plan(task: dict, industry: str, currency: str, session_id: str) -> dict:
    """Generate a context-aware execution checklist for a task. Returns {task_type, steps:[str]}."""
    system = (
        "You are the execution-planning engine of DecisionOS for a small business. "
        f"Industry: {industry or 'general'}. Currency: {currency}. "
        "Given a task an employee must do, first classify it into one of "
        "[collection, quotation, complaint, supplier_payment, sales_followup, delivery, generic], "
        "then produce a concise, practical, ordered checklist of execution steps the employee should follow "
        "to complete it well. 5-9 short action steps, each a single imperative line (no numbering, no sub-bullets). "
        "Tailor steps to the specific task. Return ONLY valid JSON: "
        "{\"task_type\": string, \"steps\": [string]}."
    )
    prompt = (f"Task title: {task.get('title','')}\n"
              f"Description: {task.get('description','') or '(none)'}\n"
              f"Assigned role: {task.get('assignee_role') or 'team'}\n"
              f"Priority: {task.get('priority','medium')}\n"
              "Generate the execution checklist now.")
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI execution plan parse error: {e} :: {resp[:300]}")
        d = {}
    steps = [str(s).strip() for s in (d.get("steps") or []) if str(s).strip()][:12]
    if not steps:
        steps = ["Review the task details", "Do the work", "Upload proof / notes", "Close the task"]
    return {"task_type": d.get("task_type") or "generic", "steps": steps}


async def ai_step_assist(task: dict, step_text: str, industry: str, session_id: str) -> dict:
    """Suggest a script/guidance for a single execution step + likely objections and responses."""
    system = (
        "You are DecisionOS's execution assistant helping a small-business employee complete one step of a task. "
        f"Industry: {industry or 'general'}. "
        "Give a short, ready-to-use suggestion (a phone/message script or concrete guidance, 1-3 sentences) for the step, "
        "and 2-4 likely objections the other party may raise with a crisp suggested response for each. "
        "Be practical and polite. Return ONLY valid JSON: "
        "{\"suggestion\": string, \"objections\": [{\"objection\": string, \"response\": string}]}."
    )
    prompt = (f"Task: {task.get('title','')}\n"
              f"Context: {task.get('description','') or '(none)'}\n"
              f"Current step: {step_text}\n"
              "Give the suggestion and objection handling now.")
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI step assist parse error: {e} :: {resp[:300]}")
        d = {}
    objs = []
    for o in (d.get("objections") or [])[:4]:
        if isinstance(o, dict) and o.get("objection"):
            objs.append({"objection": str(o["objection"])[:160], "response": str(o.get("response") or "")[:280]})
    return {"suggestion": str(d.get("suggestion") or "")[:600], "objections": objs}








OPENAI_STT_MODEL = os.environ.get("OPENAI_STT_MODEL", "gpt-4o-transcribe").strip() or "gpt-4o-transcribe"
SARVAM_API_KEY = os.environ.get("SARVAM_API_KEY", "").strip()
SARVAM_STT_MODEL = os.environ.get("SARVAM_STT_MODEL", "saaras:v3").strip() or "saaras:v3"

# OpenAI STT + Gemini OCR clients are created lazily from the CURRENT runtime key
# (so a platform-admin key update takes effect without a restart).
_openai_stt_state = {"key": None, "client": None}
_gemini_state = {"key": None, "client": None}


def get_openai_stt_client():
    key = get_ai_key("openai")
    if not key:
        _openai_stt_state.update(key=None, client=None)
        return None
    if _openai_stt_state["key"] != key:
        try:
            from openai import AsyncOpenAI
            _openai_stt_state["client"] = AsyncOpenAI(api_key=key)
            _openai_stt_state["key"] = key
            logger.info(f"OpenAI transcription client ready (model '{OPENAI_STT_MODEL}').")
        except Exception as _e:
            logger.warning(f"Could not init OpenAI client, will fall back to Whisper (Emergent key): {_e}")
            _openai_stt_state.update(key=None, client=None)
    return _openai_stt_state["client"]


def get_gemini_client():
    key = get_ai_key("gemini")
    if not key:
        _gemini_state.update(key=None, client=None)
        return None
    if _gemini_state["key"] != key:
        try:
            from google import genai as _genai
            _gemini_state["client"] = _genai.Client(api_key=key)
            _gemini_state["key"] = key
            logger.info(f"Gemini document-OCR client ready (model '{VISION_MODEL[1]}').")
        except Exception as _e:
            logger.warning(f"Could not init Gemini client, will fall back to Emergent key: {_e}")
            _gemini_state.update(key=None, client=None)
    return _gemini_state["client"]


def wa_token() -> str:
    return get_ai_key("wa_access_token")


def wa_phone_id() -> str:
    return get_ai_key("wa_phone_number_id")


def _gemini_doc_sync(file_path: str, mime_type: str, system: str, user_text: str):
    """Returns (text, tokens_in, tokens_out) so callers can log usage."""
    import pathlib
    from google.genai import types as _gtypes
    resp = get_gemini_client().models.generate_content(
        model=VISION_MODEL[1],
        contents=[
            _gtypes.Part.from_bytes(data=pathlib.Path(file_path).read_bytes(), mime_type=mime_type),
            user_text,
        ],
        config=_gtypes.GenerateContentConfig(system_instruction=system, response_mime_type="application/json"),
    )
    um = getattr(resp, "usage_metadata", None)
    ti = getattr(um, "prompt_token_count", 0) or 0
    to = getattr(um, "candidates_token_count", 0) or 0
    return (resp.text or "", ti, to)



def _gemini_read_sync(file_path: str, mime_type: str, system: str, user_text: str):
    """General plain-text vision read (no JSON constraint). Returns (text, tokens_in, tokens_out)."""
    import pathlib
    from google.genai import types as _gtypes
    resp = get_gemini_client().models.generate_content(
        model=VISION_MODEL[1],
        contents=[
            _gtypes.Part.from_bytes(data=pathlib.Path(file_path).read_bytes(), mime_type=mime_type),
            user_text,
        ],
        config=_gtypes.GenerateContentConfig(system_instruction=system),
    )
    um = getattr(resp, "usage_metadata", None)
    ti = getattr(um, "prompt_token_count", 0) or 0
    to = getattr(um, "candidates_token_count", 0) or 0
    return (resp.text or "", ti, to)


_IMAGE_READ_SYSTEM = (
    "You are a vision reader. Look at the attached image or document and TRANSCRIBE and DESCRIBE everything "
    "a person would need, verbatim. Capture ALL readable content: names, job titles, company names, phone "
    "numbers, emails, websites, addresses, dates, amounts, line items, table rows, headings and any handwritten "
    "or printed text. If it is a business/visiting card, clearly list the person's name, title, company, phone(s), "
    "email, website and address. If it is a list or table, preserve the rows. Never invent anything not in the image. "
    "Return a concise PLAIN-TEXT extraction — no JSON, no commentary."
)


async def ai_read_image_general(file_path: str, mime_type: str, session_id: str) -> str:
    """Read ANY image/PDF into plain text (business cards, notes, lists, screenshots, documents)."""
    user_text = "Read this file and output all of its content as plain text."
    if get_gemini_client() is not None:
        try:
            text, ti, to = await asyncio.to_thread(_gemini_read_sync, file_path, mime_type, _IMAGE_READ_SYSTEM, user_text)
            await log_usage((session_id or "read").split("-")[0], "gemini", model=VISION_MODEL[1],
                            tokens_in=ti, tokens_out=to, units=1, unit_type="document")
            if (text or "").strip():
                return text.strip()
        except Exception as e:
            logger.warning(f"Gemini general-read (user key) failed; falling back: {e}")
    try:
        fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id or "read",
                       system_message=_IMAGE_READ_SYSTEM).with_model(*VISION_MODEL)
        # FIX-002-B: semaphore + timeout guard shared across all LLM calls.
        from services.llm_limits import guarded_llm
        resp = await guarded_llm(chat.send_message(UserMessage(text=user_text, file_contents=[fc])),
                                  label="gemini:doc-read")
        await log_usage((session_id or "read").split("-")[0], "gemini", model=VISION_MODEL[1],
                        tokens_in=_est_tokens(_IMAGE_READ_SYSTEM + user_text), tokens_out=_est_tokens(resp or ""),
                        units=1, unit_type="document")
        return (resp or "").strip()
    except Exception as e:
        logger.warning(f"general image read failed: {e}")
        return ""




def _stt_lang_prompt(language: str):
    lang, prompt = None, None
    if language == "en":
        lang = "en"
    elif language == "ta":
        lang = "ta"
    elif language == "tanglish":
        prompt = ("This is Tanglish — casual code-mixed Tamil and English speech from an Indian "
                  "small-business owner. Keep English words in English.")
    return lang, prompt


_LANG_NAMES = {
    "en-IN": "English", "en-US": "English", "hi-IN": "Hindi", "ta-IN": "Tamil",
    "te-IN": "Telugu", "kn-IN": "Kannada", "ml-IN": "Malayalam", "mr-IN": "Marathi",
    "gu-IN": "Gujarati", "bn-IN": "Bengali", "pa-IN": "Punjabi", "od-IN": "Odia",
    "or-IN": "Odia", "as-IN": "Assamese", "ur-IN": "Urdu", "unknown": "Unknown",
}


def _lang_name(code: str) -> str:
    if not code:
        return ""
    return _LANG_NAMES.get(code) or code.split("-")[0].upper()


def _sarvam_mime(path: str) -> str:
    ext = (path.rsplit(".", 1)[-1] if "." in path else "").lower()
    return {"webm": "audio/webm", "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg",
            "wav": "audio/wav", "mp3": "audio/mpeg", "m4a": "audio/mp4", "mp4": "audio/mp4",
            "aac": "audio/aac", "flac": "audio/flac"}.get(ext, "audio/webm")


def _sarvam_stt_sync(path: str) -> dict:
    """Sarvam REST speech-to-text (saaras:v3): auto-detect language + translate to English.
    REST handles audio under ~30s; raises on error so the caller can fall back to batch/OpenAI."""
    import requests
    with open(path, "rb") as f:
        r = requests.post(
            "https://api.sarvam.ai/speech-to-text",
            headers={"api-subscription-key": get_ai_key("sarvam")},
            files={"file": (os.path.basename(path), f, _sarvam_mime(path))},
            data={"model": SARVAM_STT_MODEL, "mode": "translate", "language_code": "unknown"},
            timeout=90,
        )
    r.raise_for_status()
    return r.json()


def _sarvam_batch_sync(path: str) -> dict:
    """Sarvam Batch STT (async job) for long recordings (>30s, up to 2h). Blocking — run in a thread."""
    import tempfile, glob, json as _json
    from sarvamai import SarvamAI
    client = SarvamAI(api_subscription_key=get_ai_key("sarvam"))
    job = client.speech_to_text_job.create_job(model=SARVAM_STT_MODEL, mode="translate", language_code="unknown")
    job.upload_files(file_paths=[path])
    job.start()
    job.wait_until_complete(poll_interval=5, timeout=1500)
    outdir = tempfile.mkdtemp(prefix="sarvam_batch_")
    job.download_outputs(output_dir=outdir)
    transcript, lang = "", ""
    for jf in glob.glob(os.path.join(outdir, "*.json")):
        try:
            with open(jf) as fh:
                d = _json.load(fh)
            transcript = (transcript + " " + (d.get("transcript") or "")).strip()
            lang = lang or (d.get("language_code") or "")
        except Exception:
            pass
    return {"transcript": transcript, "language_code": lang, "language_probability": None}


async def transcribe_audio_full(path: str, language: str = "auto") -> dict:
    """Returns {transcript, language_code, language_name, language_probability, engine}.
    Sarvam is primary (auto-detect + translate-to-English); batch handles long clips; OpenAI/Whisper backstop.

    FIX-002-E: `path` may now be either a legacy local filesystem path OR an
    obj_store key. If it's an obj_store key we download it to a temp file
    first so the STT libs (which expect a real path) work unchanged.
    """
    from services.uploads import is_legacy_path, download_to_temp
    _tmp_to_cleanup = None
    if not is_legacy_path(path):
        _tmp_to_cleanup = await download_to_temp(path)
        path = str(_tmp_to_cleanup)
    try:
        return await _transcribe_audio_full_local(path, language)
    finally:
        if _tmp_to_cleanup is not None:
            try:
                os.unlink(_tmp_to_cleanup)
            except Exception:
                pass


async def _transcribe_audio_full_local(path: str, language: str = "auto") -> dict:
    """Internal: expects `path` to be a local filesystem path. All STT
    engines are invoked from here. Split out from transcribe_audio_full
    so the obj_store-download wrapper can wrap the whole thing without
    duplicating engine-selection logic."""
    if get_ai_key("sarvam"):
        # 1) REST (fast, <30s)
        try:
            out = await asyncio.to_thread(_sarvam_stt_sync, path)
            transcript = (out.get("transcript") or "").strip()
            if transcript:
                code = out.get("language_code") or ""
                await _log_stt_usage(transcript, f"sarvam:{SARVAM_STT_MODEL}", provider="sarvam")
                return {"transcript": transcript, "language_code": code, "language_name": _lang_name(code),
                        "language_probability": out.get("language_probability"), "engine": "sarvam"}
        except Exception as e:
            logger.warning(f"Sarvam REST STT failed (likely >30s); trying Sarvam batch: {e}")
        # 2) Batch (long audio)
        try:
            out = await asyncio.to_thread(_sarvam_batch_sync, path)
            transcript = (out.get("transcript") or "").strip()
            if transcript:
                code = out.get("language_code") or ""
                await _log_stt_usage(transcript, f"sarvam-batch:{SARVAM_STT_MODEL}", provider="sarvam")
                return {"transcript": transcript, "language_code": code, "language_name": _lang_name(code),
                        "language_probability": None, "engine": "sarvam-batch"}
            logger.warning("Sarvam batch returned empty transcript; falling back to OpenAI.")
        except Exception as e:
            logger.warning(f"Sarvam batch STT failed; falling back to OpenAI: {e}")
    # 3) OpenAI gpt-4o-transcribe
    lang, prompt = _stt_lang_prompt(language)
    _openai_stt_client = get_openai_stt_client()
    if _openai_stt_client is not None:
        try:
            kwargs = {"model": OPENAI_STT_MODEL, "response_format": "json"}
            if lang:
                kwargs["language"] = lang
            if prompt:
                kwargs["prompt"] = prompt
            with open(path, "rb") as f:
                resp = await _openai_stt_client.audio.transcriptions.create(file=f, **kwargs)
            await _log_stt_usage(resp.text, OPENAI_STT_MODEL)
            return {"transcript": resp.text, "language_code": "", "language_name": "",
                    "language_probability": None, "engine": "openai"}
        except Exception as e:
            logger.warning(f"OpenAI STT ({OPENAI_STT_MODEL}) failed; falling back to Whisper (Emergent key): {e}")
    # 4) Whisper via Emergent key
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    kwargs = {"model": "whisper-1", "response_format": "json"}
    if lang:
        kwargs["language"] = lang
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        resp = await stt.transcribe(file=f, **kwargs)
    await _log_stt_usage(resp.text, "whisper-1")
    return {"transcript": resp.text, "language_code": "", "language_name": "",
            "language_probability": None, "engine": "whisper"}


async def transcribe_audio(path: str, language: str = "auto") -> str:
    return (await transcribe_audio_full(path, language)).get("transcript", "")


async def _log_stt_usage(transcript: str, model: str, provider: str = "openai"):
    # STT bills by audio duration; estimate ~15 chars/sec of speech from the transcript.
    secs = max(1, len(transcript or "") / 15)
    per_min = _SARVAM_STT_PER_MIN if provider == "sarvam" else _OPENAI_STT_PER_MIN
    await log_usage("transcribe", provider, model=model,
                    units=round(secs), unit_type="audio_sec",
                    cost=secs / 60 * per_min)


def match_member_by_name(members: list, name: str):
    n = re.sub(r"[^a-z ]", "", (name or "").lower()).strip()
    if not n or not members:
        return None
    for m in members:  # exact (case-insensitive) full-name match
        if (m.get("name") or "").lower().strip() == n:
            return m
    tokens = set(n.split())
    best = None
    for m in members:  # first-name / token overlap
        mtoks = set((m.get("name") or "").lower().split())
        if tokens & mtoks:
            best = m
            break
    return best


# ---------------------------------------------------------------------------
# Voice note processing pipeline
# ---------------------------------------------------------------------------
_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}


def _resolve_meeting_date(when: str, due_in_days) -> str:
    """Resolve a meeting's natural-language timing into an ISO date (YYYY-MM-DD).
    Explicit day references in `when` take priority over the LLM's due_in_days heuristic."""
    now = datetime.now(timezone.utc)
    w = (when or "").lower()
    if "today" in w:
        return now.date().isoformat()
    if "tomorrow" in w:
        return (now + timedelta(days=1)).date().isoformat()
    for name, idx in _WEEKDAYS.items():
        if name in w:
            ahead = (idx - now.weekday()) % 7 or 7  # next occurrence, not today
            if "next" in w:
                ahead += 7
            return (now + timedelta(days=ahead)).date().isoformat()
    if isinstance(due_in_days, int):
        return (now + timedelta(days=due_in_days)).date().isoformat()
    if "next week" in w:
        return (now + timedelta(days=7)).date().isoformat()
    return (now + timedelta(days=2)).date().isoformat()


async def pick_least_loaded_member(tenant_id: str, role: str) -> Optional[str]:
    """Smart assignment: return the id of the role member with the fewest open
    (not done/cancelled) tasks, or None if the role has no members."""
    if not role:
        return None
    members = await db.users.find({"tenant_id": tenant_id, "role": role}, {"_id": 0, "id": 1}).to_list(200)
    if not members:
        return None
    best_id, best_load = None, None
    for m in members:
        load = await db.tasks.count_documents({
            "tenant_id": tenant_id, "assignee_id": m["id"],
            "status": {"$nin": ["done", "cancelled"]},
        })
        if best_load is None or load < best_load:
            best_load, best_id = load, m["id"]
    return best_id


async def _create_decision_tasks(tenant_id, note, decision_id, extracted, troles, members, cat_keys=None):
    """Create the blocked tasks for a decision; returns (task_ids, assignee_keys)."""
    cat_keys = cat_keys or set()
    task_ids = []
    assignee_keys = set()
    for t in extracted.get("tasks", []):
        tid = new_id()
        due = None
        if isinstance(t.get("due_in_days"), int):
            due = (datetime.now(timezone.utc) + timedelta(days=t["due_in_days"])).isoformat()
        role = t.get("assignee_role") if t.get("assignee_role") in troles else None
        assignee_id = None
        member = match_member_by_name(members, t.get("assignee_name", ""))
        if member:
            assignee_id = member["id"]
            role = member["role"]
        elif role:
            # Smart assignment: distribute role-level tasks to the least-loaded member.
            assignee_id = await pick_least_loaded_member(tenant_id, role)
        if assignee_id:
            assignee_keys.add(f"u:{assignee_id}")
        elif role:
            assignee_keys.add(f"r:{role}")
        task_cat = t.get("task_category") if t.get("task_category") in cat_keys else None
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id, "title": t.get("title", "Untitled task"),
            "description": t.get("description", ""), "assignee_role": role, "assignee_id": assignee_id,
            "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high") else "medium",
            "status": "blocked", "due_date": due, "decision_id": decision_id,
            "task_type": task_cat,
            "source": "voice", "created_at": now_iso(),
            "updated_at": now_iso(), "last_action": "Created",
        })
        task_ids.append(tid)
    return task_ids, assignee_keys


async def _create_reminders_and_memory(tenant_id, note, extracted):
    """Voice shortcuts: lightweight personal reminders + lasting company memory."""
    for r in (extracted.get("reminders") or []):
        due = None
        if isinstance(r.get("due_in_days"), int):
            due = (datetime.now(timezone.utc) + timedelta(days=r["due_in_days"])).isoformat()
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "title": r.get("title", "Reminder"),
            "description": "", "assignee_role": None, "assignee_id": note["created_by"],
            "priority": "medium", "status": "todo", "due_date": due, "decision_id": None,
            "source": "reminder", "created_at": now_iso(),
        })
    for m in (extracted.get("memory_notes") or []):
        if m.get("text"):
            await db.memory.insert_one({
                "id": new_id(), "tenant_id": tenant_id, "text": m["text"],
                "tag": m.get("tag", "note"), "created_by": note["created_by"], "created_at": now_iso(),
            })


async def _create_meetings(tenant_id, note, decision_id, extracted):
    """Schedule a real calendar event + a lightweight to-do per detected meeting; returns the list."""
    meetings = extracted.get("meeting_events") or []
    for mt in meetings:
        when = (mt.get("when") or "").strip()
        title = (mt.get("title") or "Meeting").strip()
        mdate = _resolve_meeting_date(when, mt.get("due_in_days"))
        await db.calendar_events.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "date": mdate, "title": title,
            "when_text": when, "decision_id": decision_id, "source": "voice",
            "created_by": note["created_by"], "created_at": now_iso(),
        })
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id,
            "title": title + (f" ({when})" if when else ""),
            "description": "", "assignee_role": None, "assignee_id": note["created_by"],
            "priority": "medium", "status": "todo", "due_date": None, "decision_id": None,
            "source": "meeting", "created_at": now_iso(),
        })
    return meetings


async def _create_workflows(tenant_id, note, decision_id, extracted):
    """Materialize each detected workflow_event into a real board card; returns the created ids."""
    wf_ids = []
    om = await tenant_operating_model(tenant_id)
    pmap = {p["key"]: p for p in om["pipelines"]}
    for ev in (extracted.get("workflow_events") or []):
        wtype = ev.get("type")
        pipeline = pmap.get(wtype)
        if not pipeline:
            continue
        stages = [s["key"] for s in pipeline["stages"]]
        title = (ev.get("title") or ev.get("action") or pipeline["label"]).strip()
        cp = (ev.get("counterparty") or "").strip()
        contact_id = None
        if cp:
            c = await db.contacts.find_one({"tenant_id": tenant_id, "$or": [
                {"name": {"$regex": f"^{re.escape(cp)}$", "$options": "i"}},
                {"company": {"$regex": f"^{re.escape(cp)}$", "$options": "i"}}]}, {"_id": 0, "id": 1, "name": 1, "company": 1})
            if c:
                contact_id = c["id"]
                cp = cp or c.get("company") or c.get("name") or ""
        amount = ev.get("amount") if isinstance(ev.get("amount"), (int, float)) else None
        wid = new_id()
        await db.workflows.insert_one({
            "id": wid, "tenant_id": tenant_id, "type": wtype, "title": title,
            "detail": ev.get("detail", ""), "amount": amount, "counterparty": cp, "contact_id": contact_id,
            "stage": stages[0], "stages": stages,
            "history": [{"stage": stages[0], "note": "Auto-created from directive", "by": note["created_by"], "at": now_iso()}],
            "source": "voice", "decision_id": decision_id,
            "created_by": note["created_by"], "created_at": now_iso(),
        })
        wf_ids.append(wid)
    return wf_ids


async def process_voice_note(note_id: str):
    note = await db.voice_notes.find_one({"id": note_id})
    if not note:
        return
    tenant_id = note["tenant_id"]
    set_usage_tenant(tenant_id)
    try:
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "transcribing"}})
        transcript = note.get("transcript")
        detected_code = note.get("detected_language")
        detected_name = note.get("detected_language_name")
        if not transcript and note.get("audio_path"):
            stt = await transcribe_audio_full(note["audio_path"], note.get("language", "auto"))
            transcript = stt.get("transcript")
            detected_code = stt.get("language_code") or ""
            detected_name = stt.get("language_name") or ""
            await db.voice_notes.update_one({"id": note_id}, {"$set": {
                "transcript": transcript, "detected_language": detected_code,
                "detected_language_name": detected_name,
                "language_probability": stt.get("language_probability"), "stt_engine": stt.get("engine")}})

        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "structuring"}})
        troles = await tenant_role_keys(tenant_id)
        members = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        om = await tenant_operating_model(tenant_id)
        cat_keys = {c["key"] for c in om["task_categories"]}
        # Read any attached reference files so the AI factors them into the decision.
        ref_ids = note.get("reference_file_ids") or []
        extra_context = ""
        if ref_ids:
            chunks = []
            for fid in ref_ids:
                frec = await db.files.find_one({"id": fid, "tenant_id": tenant_id, "is_deleted": False}, {"_id": 0})
                if frec:
                    txt = await _read_reference_text(frec, tenant_id)
                    if txt:
                        chunks.append(txt)
            extra_context = "\n\n".join(chunks)
        extracted = await ai_extract(transcript or "", session_id=f"extract-{note_id}", allowed_roles=sorted(troles),
                                     members=members, pipelines=om["pipelines"], task_categories=om["task_categories"],
                                     extra_context=extra_context)

        decision_id = new_id()
        dlist = extracted.get("decisions", [])
        first = dlist[0] if dlist else {}
        dtype = first.get("type") if first.get("type") in ("directive", "approval", "policy", "observation") else "directive"
        conf = extracted.get("confidence", 0.8)
        conf = float(conf) if isinstance(conf, (int, float)) else 0.8
        decision = {
            "id": decision_id, "tenant_id": tenant_id, "voice_note_id": note_id,
            "title": (extracted.get("decisions") or [{}])[0].get("title") or (extracted.get("summary") or "New decision")[:80],
            "summary": extracted.get("summary", ""),
            "items": extracted.get("decisions", []),
            "workflow_events": extracted.get("workflow_events", []),
            "dtype": dtype, "confidence": round(max(0.0, min(1.0, conf)), 2),
            "status": "pending_approval",
            "created_by": note["created_by"], "created_at": now_iso(),
            "source": note.get("source") or ("voice" if note.get("kind") == "audio" else "text"),
            "wa_from": note.get("wa_from"), "raised_by_name": note.get("raised_by_name"),
            "detected_language": detected_code or None,
            "detected_language_name": detected_name or None,
            "task_ids": [],
        }
        task_ids, assignee_keys = await _create_decision_tasks(tenant_id, note, decision_id, extracted, troles, members, cat_keys)
        # Attach the uploaded reference file(s) to every task this directive produced (context for assignees).
        if ref_ids and task_ids:
            for tid in task_ids:
                await _attach_reference_ids(tenant_id, note["created_by"], tid, ref_ids)
        decision["task_ids"] = task_ids
        decision["timeline"] = [{"ts": now_iso(), "label": f"Decision captured via {note.get('source') or note.get('kind') or 'voice'}", "actor": note.get("raised_by_name") or "Owner", "kind": "created"}]
        await db.decisions.insert_one(decision)
        _icls = "approval" if dtype == "approval" else ("task" if task_ids else "reminder")
        await add_inbox_item(tenant_id, note["created_by"],
                             "voice" if note.get("kind") == "audio" else "text",
                             _icls, decision["title"], (decision.get("summary") or "")[:180],
                             "decision", decision_id, status="open")
        await _create_reminders_and_memory(tenant_id, note, extracted)
        meetings = await _create_meetings(tenant_id, note, decision_id, extracted)
        wf_ids = await _create_workflows(tenant_id, note, decision_id, extracted)
        # Execution summary — real counts of what this directive produced
        execution_summary = {
            "tasks": len(task_ids),
            "assignees": len(assignee_keys),
            "approvals": 1 if (task_ids and decision["status"] == "pending_approval") else 0,
            "workflows": len(wf_ids),
            "meetings": len(meetings),
            "reminders": len(extracted.get("reminders") or []),
        }
        await db.decisions.update_one({"id": decision_id}, {"$set": {"execution_summary": execution_summary, "workflow_ids": wf_ids}})
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "done", "decision_id": decision_id, "execution_summary": execution_summary, "processed_at": now_iso()}})
        await log_activity(tenant_id, note["created_by"], "decision_extracted",
                           f"Extracted decision '{decision['title']}' with {len(task_ids)} task(s)", "decision", decision_id)
    except Exception as e:
        logger.exception("process_voice_note failed")
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "failed", "error": str(e)}})


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
LANG_NAMES = {"en": "English", "hi": "Hindi", "ta": "Tamil"}


def lang_directive(lang: str) -> str:
    """Instruct an AI to write its human-readable answer in the user's language."""
    name = LANG_NAMES.get((lang or "en"))
    if not name or name == "English":
        return ""
    return (f"IMPORTANT: Write the human-readable text (the 'answer'/'summary'/message body) in {name}. "
            "Keep proper nouns, names, company/product names, numbers and JSON keys exactly as-is; only translate the prose.")



async def ai_generate_lexicon(industry: str, company_size: str = "", roles=None, description: str = "") -> dict:
    """AI-localize the app's fixed vocabulary to the tenant's industry."""
    role_labels = ", ".join([r.get("label") for r in (roles or []) if r.get("label")]) or "not specified"
    system = (
        "You localize the vocabulary of DecisionOS (a business operations app) to a specific industry. "
        "The app has fixed internal concepts; give the MOST NATURAL word a business in this industry actually uses for each. "
        "Return ONLY valid JSON, no prose, EXACTLY this shape: "
        "{\"customer_singular\": str, \"customer_plural\": str, \"vendor_singular\": str, \"vendor_plural\": str, "
        "\"workflows\": {\"production\": {\"label\": str, \"sub\": str}, \"distribution\": {\"label\": str, \"sub\": str}, "
        "\"purchase_payment\": {\"label\": str, \"sub\": str}}, "
        "\"task_types\": {\"operational\": str, \"sales\": str, \"purchase\": str, \"production\": str, \"finance\": str, \"hr\": str}}. "
        "Concept meanings: customer = the people/orgs who buy or receive your product/service "
        "(e.g. a coaching institute → 'Student'/'Students', a clinic → 'Patient'/'Patients'). "
        "vendor = who you buy/source from (e.g. 'Partner', 'Supplier', 'Publisher'). "
        "workflows.production = your CORE delivery/fulfilment pipeline (turning an order/enrollment into a delivered outcome, "
        "e.g. 'Enrollment', 'Course Delivery', 'Case'); "
        "workflows.distribution = handing over / dispatching the finished outcome to the customer "
        "(e.g. 'Onboarding', 'Handover', 'Delivery'); "
        "workflows.purchase_payment = procuring goods/services and paying vendors (e.g. 'Procurement'). "
        "task_types are the department buckets tasks fall into — keep them relevant to the industry. "
        "'sub' is a short 2-4 word arrow subtitle like 'Order → Ready'. Keep every label 1-2 words, Title Case. "
        "Use the industry's real terminology; never invent nonsense."
    )
    prompt = (
        f"Industry: {industry or 'general business'}\n"
        f"Company size: {company_size or 'unspecified'}\n"
        f"What the business actually does: {description.strip() or 'not specified'}\n"
        f"Departments: {role_labels}\n"
        "Localize the vocabulary now."
    )
    chat = claude_chat(session_id=f"lexicon-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"ai_generate_lexicon failed: {e}")
        data = {}
    return normalize_lexicon(data or {})


async def ai_generate_operating_model(industry: str, company_size: str = "", roles=None, description: str = "") -> dict:
    """AI-design the industry's operating model: workflow pipelines (with stages) + task categories."""
    role_labels = ", ".join([r.get("label") for r in (roles or []) if r.get("label")]) or "not specified"
    system = (
        "You design the OPERATING MODEL for a business inside DecisionOS. The model has two parts and MUST fit "
        "the specific industry — a salon has NO 'production' or 'dispatch'; it has a service/appointment flow. "
        "Return ONLY valid JSON, no prose, EXACTLY this shape: "
        "{\"pipelines\": [{\"key\": lowercase_snake_case, \"label\": str, \"sub\": short 'A → B' subtitle, "
        "\"stages\": [{\"key\": lowercase_snake_case, \"label\": str}], "
        "\"approval_stage\": key of the stage that needs owner sign-off or null}], "
        "\"task_categories\": [{\"key\": lowercase_snake_case, \"label\": str}]}. "
        "PIPELINES = the core multi-step operational flows this business tracks on a kanban board, from start to finish. "
        "Design 2-4 pipelines that genuinely match how THIS industry operates. Each pipeline has 3-6 ordered stages "
        "(the real steps work moves through). Examples: a SALON → 'Appointments' (Booked→Confirmed→In Service→Completed) "
        "and 'Procurement' (Requested→Approved→Received→Paid); a COACHING INSTITUTE → 'Enrollment' "
        "(Inquiry→Counselling→Enrolled→Onboarded) and 'Course Delivery' (Scheduled→Ongoing→Completed); a RESTAURANT → "
        "'Orders' and 'Procurement'. Set approval_stage only where an owner must sign off (e.g. procurement 'approved'), else null. "
        "TASK_CATEGORIES = 4-7 department buckets that a task in this business belongs to (e.g. salon → Front Desk, Service, "
        "Inventory, Finance, HR; coaching → Admissions, Academic, Operations, Finance, HR). Always keep the categories relevant to the industry. "
        "Keep every label 1-3 words, Title Case. Use the industry's real terminology; never force manufacturing terms onto a service business."
    )
    prompt = (
        f"Industry: {industry or 'general business'}\n"
        f"Company size: {company_size or 'unspecified'}\n"
        f"What the business actually does (use this to tailor precisely): {description.strip() or 'not specified'}\n"
        f"Departments: {role_labels}\n"
        "Design the operating model now."
    )
    chat = claude_chat(session_id=f"opmodel-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"ai_generate_operating_model failed: {e}")
        data = {}
    return normalize_operating_model(data or {})


async def tenant_operating_model(tenant_id: str) -> dict:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "operating_model": 1})
    om = (t or {}).get("operating_model")
    return om if om and om.get("pipelines") else DEFAULT_OPERATING_MODEL


def normalize_finance_categories(d: dict) -> dict:
    """Clean AI-generated finance categories: dedupe, cap, always end with 'Other'."""
    def clean(lst, cap):
        out = []
        for x in (lst or []):
            s = str(x).strip()
            if s and s.lower() != "other" and s.lower() not in [o.lower() for o in out]:
                out.append(s)
        return out[:cap] + ["Other"]
    from routers.ledger import EXPENSE_CATEGORIES, ASSET_CATEGORIES
    exp = clean((d or {}).get("expense"), 14)
    ast = clean((d or {}).get("asset"), 10)
    if len(exp) <= 1:
        exp = list(EXPENSE_CATEGORIES)
    if len(ast) <= 1:
        ast = list(ASSET_CATEGORIES)
    return {"expense": exp, "asset": ast}


async def ai_generate_finance_categories(industry: str, company_size: str = "", roles=None, description: str = "") -> dict:
    """AI-generate the finance bookkeeping categories (expense + fixed-asset) tailored to this business."""
    role_labels = ", ".join([r.get("label") for r in (roles or []) if r.get("label")]) or "not specified"
    system = (
        "You define the finance bookkeeping CATEGORIES a specific business uses to tag its money. "
        "Return ONLY valid JSON, no prose, EXACTLY: {\"expense\": [array of strings], \"asset\": [array of strings]}. "
        "expense = the recurring operating cost buckets THIS business actually incurs — be industry-specific "
        "(a salon → 'Salon Consumables','Stylist Commissions','Rent'; a restaurant → 'Ingredients','Kitchen Fuel','Delivery Fees'; "
        "a software firm → 'Cloud Hosting','Software Subscriptions','Contractor Fees'; a textile mill → 'Raw Cotton','Dyeing & Finishing','Power'). "
        "asset = the types of long-life capital items this business buys (e.g. 'Salon Equipment','Kitchen Equipment','Computers & IT','Vehicles','Machinery'). "
        "Give 8-12 expense and 5-8 asset categories. Keep each 1-3 words, Title Case, no duplicates. Do NOT include 'Other' (it is added automatically). "
        "Use the industry's real terminology; never invent nonsense."
    )
    prompt = (
        f"Industry: {industry or 'general business'}\n"
        f"Company size: {company_size or 'unspecified'}\n"
        f"What the business actually does: {(description or '').strip() or 'not specified'}\n"
        f"Departments: {role_labels}\n"
        "Generate the finance categories now."
    )
    data = {}
    try:
        chat = claude_chat(session_id=f"fincats-{new_id()}", system_message=system).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp) or {}
    except Exception as e:  # noqa: BLE001
        logger.error(f"ai_generate_finance_categories failed: {e}")
    return normalize_finance_categories(data)



LEGACY_WF_LABELS = {"production": "Production", "distribution": "Distribution", "purchase_payment": "Procurement", "sales_dispatch": "Sales & Dispatch"}


async def backfill_operating_model(tenant: dict) -> dict:
    """Generate the industry operating model for an existing tenant AND preserve any
    pipeline/category that already has data (non-destructive migration)."""
    tenant_id = tenant["id"]
    om = await ai_generate_operating_model(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")

    # Keep legacy pipelines that already have workflow cards, so nothing is orphaned.
    ai_keys = {p["key"] for p in om["pipelines"]}
    legacy_pipelines = []
    for wt in await db.workflows.distinct("type", {"tenant_id": tenant_id}):
        if not wt or wt in ai_keys:
            continue
        stages = WORKFLOW_STAGES.get(wt)
        if not stages:
            sample = await db.workflows.find_one({"tenant_id": tenant_id, "type": wt}, {"_id": 0, "stages": 1})
            stages = (sample or {}).get("stages") or []
        if not stages:
            continue
        appr = "approved" if (wt == "purchase_payment" and "approved" in stages) else None
        legacy_pipelines.append({
            "key": wt, "label": LEGACY_WF_LABELS.get(wt, wt.replace("_", " ").title()),
            "sub": f"{stages[0].replace('_', ' ').title()} → {stages[-1].replace('_', ' ').title()}",
            "approval_stage": appr,
            "stages": [{"key": s, "label": s.replace("_", " ").title()} for s in stages],
        })

    # Keep any task category already used by existing tasks.
    ai_cat_keys = {c["key"] for c in om["task_categories"]}
    legacy_cats = []
    for tt in await db.tasks.distinct("task_type", {"tenant_id": tenant_id}):
        if tt and tt != "other" and tt not in ai_cat_keys:
            legacy_cats.append({"key": tt, "label": tt.replace("_", " ").title()})

    # Legacy (data-bearing) items first so existing cards/tasks stay visible.
    return normalize_operating_model({
        "pipelines": legacy_pipelines + om["pipelines"],
        "task_categories": om["task_categories"] + legacy_cats,
    })



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


@api.post("/auth/otp/request")
async def request_otp(inp: OtpRequestInput):
    norm = _norm_phone(inp.phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    # FIX-003-A (S2-03): multi-tenant-safe resolution. Returns one
    # entry per DISTINCT tenant that has this phone on a non-obsolete
    # user. See services/phone.find_tenant_choices_for_phone for why
    # calling db.users.find_one({"phone_norm": ...}) directly is a bug.
    from services.phone import find_tenant_choices_for_phone
    choices = await find_tenant_choices_for_phone(db, norm)
    if not choices:
        raise HTTPException(status_code=404, detail="No account is registered with this mobile number")
    if inp.tenant_id:
        # Caller already knows which workspace to log into (either
        # single-tenant match on a prior attempt, or user picked from
        # the ambiguity picker). Only issue if the hint actually maps
        # to a real membership — never trust a client-supplied id.
        picked = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not picked:
            raise HTTPException(status_code=404, detail="This number is not registered in the selected workspace")
        return await _issue_otp(norm, inp.phone, tenant_id=picked["tenant_id"])
    if len(choices) == 1:
        # Single-tenant fast path: keeps backward compat with every
        # existing OTP client that doesn't know about tenant_id yet.
        return await _issue_otp(norm, inp.phone, tenant_id=choices[0]["tenant_id"])
    # Multi-tenant collision: the caller must disambiguate. We do NOT
    # send an OTP — sending one and picking a tenant at verify would
    # leak "you're registered in workspace X" (workspace_name is a
    # low-sensitivity leak but still avoidable) and would let the
    # attacker learn the workspace list of an arbitrary phone.
    # HTTP 200 with an ambiguity payload keeps the flow simple; the
    # frontend just re-POSTs with tenant_id filled in.
    return {
        "ambiguous": True,
        "detail": "This number is registered in multiple workspaces. Choose one to continue.",
        "choices": [
            {"tenant_id": c["tenant_id"], "tenant_name": c["tenant_name"],
             "user_name": c["user_name"]}
            for c in choices
        ],
    }


def _mask_phone(phone: str) -> str:
    d = re.sub(r"\D", "", phone or "")
    return ("•••• " + d[-4:]) if len(d) >= 4 else "••••"


@api.get("/auth/invite/{token}")
async def invite_info(token: str):
    """Public — resolve an invite link to a friendly welcome (no OTP sent yet)."""
    user = await db.users.find_one({"invite_token": token}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="This invite link is invalid or has already been used")
    exp = user.get("invite_expires_at")
    if exp and datetime.now(timezone.utc) > datetime.fromisoformat(exp):
        raise HTTPException(status_code=410, detail="This invite link has expired — ask your admin to resend")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "name": 1})
    return {"name": user.get("name"), "phone_masked": _mask_phone(user.get("phone", "")),
            "company": (tenant or {}).get("name", "your workspace")}


@api.post("/auth/invite/{token}/start")
async def invite_start(token: str):
    """Public — send the login OTP to the invited member's phone."""
    user = await db.users.find_one({"invite_token": token}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="This invite link is invalid or has already been used")
    exp = user.get("invite_expires_at")
    if exp and datetime.now(timezone.utc) > datetime.fromisoformat(exp):
        raise HTTPException(status_code=410, detail="This invite link has expired — ask your admin to resend")
    phone = user.get("phone", "")
    norm = _norm_phone(phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="No mobile number on file for this invite")
    # FIX-003-A: invite already carries the exact tenant we're joining;
    # no ambiguity to resolve, but the OTP row still needs the tenant
    # scope so /auth/otp/verify can find it.
    resp = await _issue_otp(norm, phone, tenant_id=user["tenant_id"],
                             enforce_cooldown=False)
    resp["phone"] = phone  # returned so the invitee's device can verify
    resp["name"] = user.get("name")
    return resp


@api.post("/auth/otp/verify")
async def verify_otp(inp: OtpVerifyInput, response: Response):
    norm = _norm_phone(inp.phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    # FIX-003-A (S2-03): resolve which tenant the OTP was issued for
    # BEFORE looking up the code — the same phone can hold live OTPs in
    # multiple tenants simultaneously and each is a distinct row keyed
    # by (phone, tenant_id).
    from services.phone import find_tenant_choices_for_phone
    choices = await find_tenant_choices_for_phone(db, norm)
    if not choices:
        raise HTTPException(status_code=404, detail="Account not found")
    if inp.tenant_id:
        target = next((c for c in choices if c["tenant_id"] == inp.tenant_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Account not found in the selected workspace")
    elif len(choices) == 1:
        target = choices[0]
    else:
        # Multi-tenant match with no tenant hint — same ambiguity as
        # /request, surface it the same way so the frontend can pick.
        # 409 (not 400) because the request was well-formed; the state
        # of the world is what forces disambiguation.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ambiguous_tenant",
                "message": "This number is registered in multiple workspaces. Include tenant_id in the request.",
                "choices": [
                    {"tenant_id": c["tenant_id"], "tenant_name": c["tenant_name"],
                     "user_name": c["user_name"]}
                    for c in choices
                ],
            },
        )
    tenant_id = target["tenant_id"]
    key = {"phone": norm, "tenant_id": tenant_id}
    rec = await db.otp_codes.find_one(key, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="Request an OTP first")
    if datetime.now(timezone.utc) > datetime.fromisoformat(rec["expires_at"]):
        await db.otp_codes.delete_one(key)
        raise HTTPException(status_code=400, detail="OTP expired. Request a new one")
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.otp_codes.delete_one(key)
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new OTP")
    if _hash_otp((inp.code or "").strip(), norm) != rec["code_hash"]:
        await db.otp_codes.update_one(key, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Incorrect OTP")

    await db.otp_codes.delete_one(key)
    # FIX-003-A: fetch the exact user in the chosen tenant. Even if
    # target["user_id"] is populated from the choices list, re-fetch
    # so we get the full user record (roles, name, avatar, etc.) and
    # avoid a stale copy from the choices projection.
    user = await db.users.find_one(
        {"tenant_id": tenant_id, "phone_norm": norm,
         "wa_phone_obsolete": {"$ne": True}},
        {"_id": 0},
    )
    if not user:
        # Should be unreachable given `choices` was just resolved, but
        # a concurrent user deletion between /request and /verify can
        # get here. Refuse rather than issue a token for a ghost.
        raise HTTPException(status_code=404, detail="Account not found")
    # FIX-006-A (S0-10): the OTP verify IS the "invite accepted" moment
    # for invited users. Once we're about to issue a session token,
    # invalidate the invite_token so:
    #   * the invite link stops resolving on /auth/invite/{token}
    #     (no more leaked name / masked phone to anyone with the URL)
    #   * a second /auth/invite/{token}/start no longer bombs the
    #     invitee's phone with SMS OTPs via a link that should be dead
    # Idempotent — no-op when the user was never invited.
    if user.get("invite_token"):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"invite_token": None,
                      "invite_expires_at": None,
                      "invite_consumed_at": now_iso(),
                      "updated_at": now_iso()}},
        )
        user.pop("invite_token", None)
        user.pop("invite_expires_at", None)
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    set_auth_cookie(response, token)
    # FIX-006-A (S0-08): cookie is source of truth; only surface the JWT
    # in the body when AUTH_RETURN_TOKEN is on (dev/test) so prod XSS
    # can't leak it.
    return login_response(token, user=user, tenant=tenant)





class LexiconInput(BaseModel):
    lexicon: dict


@api.patch("/tenant/lexicon")
async def update_lexicon(inp: LexiconInput, user: dict = Depends(require_perm("team_manage"))):
    """Owner-edit the industry vocabulary (customer/vendor words, workflow & task-type labels)."""
    lex = normalize_lexicon(inp.lexicon or {})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"lexicon": lex}})
    await log_activity(user["tenant_id"], user["id"], "lexicon_updated", f"{user['name']} updated the business vocabulary")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@api.post("/tenant/lexicon/regenerate")
async def regenerate_lexicon(user: dict = Depends(require_perm("team_manage"))):
    """Re-run AI to regenerate the industry vocabulary from the workspace's industry."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    lex = await ai_generate_lexicon(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"lexicon": lex}})
    await log_activity(user["tenant_id"], user["id"], "lexicon_regenerated", f"{user['name']} regenerated the business vocabulary")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


class OperatingModelInput(BaseModel):
    operating_model: dict


@api.patch("/tenant/operating-model")
async def update_operating_model(inp: OperatingModelInput, user: dict = Depends(require_perm("team_manage"))):
    """Owner-edit the operating model (workflow pipelines + stages + task categories)."""
    om = normalize_operating_model(inp.operating_model or {})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"operating_model": om}})
    await log_activity(user["tenant_id"], user["id"], "operating_model_updated", f"{user['name']} updated the operating model")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@api.post("/tenant/operating-model/regenerate")
async def regenerate_operating_model(user: dict = Depends(require_perm("team_manage"))):
    """Re-run AI to regenerate the operating model, preserving any pipeline/category with data."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # FIX-003-C (S2-11): track success/failure. Prior code called
    # backfill_operating_model directly, so a silent AI degradation
    # (timeout, malformed JSON, empty pipelines) left the tenant with
    # a defaulted operating model and no visible signal that anything
    # went wrong — the founder just saw "Regenerate" click, spinner,
    # and the same-looking board. Now we route through the status-
    # aware wrapper and update ai_setup_status.operating_model so the
    # frontend can surface "AI setup incomplete — click to retry."
    from services import ai_setup as ai_setup_svc
    om, om_status = await ai_setup_svc.ai_generate_operating_model_with_status(
        tenant.get("industry") or "General",
        tenant.get("company_size") or "",
        tenant.get("roles") or DEFAULT_ROLES,
        tenant.get("description") or "",
    )
    # Preserve any pipeline/category the tenant has already customized:
    # if the AI succeeded, prefer its output; otherwise keep the existing
    # operating_model rather than clobbering it with a default. That's
    # the exact behavior founders expect from a "Regenerate" button.
    updates: dict = {}
    if om_status == ai_setup_svc.STATUS_GENERATED:
        # Merge over the existing so pipelines the AI didn't touch survive.
        merged = await backfill_operating_model({**tenant, "operating_model": om})
        updates["operating_model"] = merged
    status_map = dict(tenant.get("ai_setup_status") or {})
    status_map["operating_model"] = om_status
    updates["ai_setup_status"] = status_map
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "operating_model_regenerated",
                       f"{user['name']} regenerated the operating model ({om_status})")
    out = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    # Surface the status so the frontend can prompt retry if needed
    # WITHOUT needing a second /me round-trip.
    out["ai_setup_status_summary"] = ai_setup_svc.summarize_ai_setup_status(status_map)
    return out


class FinanceCategoriesInput(BaseModel):
    finance_categories: dict


@api.patch("/tenant/finance-categories")
async def update_finance_categories(inp: FinanceCategoriesInput, user: dict = Depends(require_perm("team_manage"))):
    """Owner-edit the per-company finance categories (expense + fixed-asset buckets)."""
    fc = normalize_finance_categories(inp.finance_categories or {})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"finance_categories": fc}})
    await log_activity(user["tenant_id"], user["id"], "finance_categories_updated", f"{user['name']} updated the finance categories")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@api.post("/tenant/finance-categories/regenerate")
async def regenerate_finance_categories(user: dict = Depends(require_perm("team_manage"))):
    """Re-run AI to regenerate the finance categories from the workspace's industry."""
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    # FIX-003-C (S2-11): use the status-tracking wrapper so a defaulted
    # AI result updates ai_setup_status.finance_categories instead of
    # silently clobbering the existing categories with a default map.
    from services import ai_setup as ai_setup_svc
    fc, fc_status = await ai_setup_svc.ai_generate_finance_categories_with_status(
        tenant.get("industry") or "General",
        tenant.get("company_size") or "",
        tenant.get("roles") or DEFAULT_ROLES,
        tenant.get("description") or "",
    )
    updates: dict = {}
    if fc_status == ai_setup_svc.STATUS_GENERATED:
        updates["finance_categories"] = fc
    status_map = dict(tenant.get("ai_setup_status") or {})
    status_map["finance_categories"] = fc_status
    updates["ai_setup_status"] = status_map
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "finance_categories_regenerated",
                       f"{user['name']} regenerated the finance categories ({fc_status})")
    out = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    out["ai_setup_status_summary"] = ai_setup_svc.summarize_ai_setup_status(status_map)
    return out



class ProfileUpdateInput(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    language: Optional[str] = None


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)




@api.patch("/tenant")
async def update_tenant(inp: TenantUpdateInput, user: dict = Depends(require_perm("team_manage"))):
    updates = {}
    for f in ["name", "industry", "company_size", "region", "gst", "phone", "branches"]:
        v = getattr(inp, f)
        if v is not None:
            updates[f] = v.strip() if isinstance(v, str) else v
    if inp.currency is not None:
        updates["currency"] = inp.currency.strip().upper()
    if inp.products is not None:
        updates["products"] = [p.model_dump() for p in inp.products if (p.name or "").strip()]
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "company_updated", f"{user['name']} updated company details")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


class TenantSettingsInput(BaseModel):
    high_value_threshold: Optional[float] = None
    require_owner_signoff: Optional[bool] = None
    currency: Optional[str] = None


@api.patch("/tenant/settings")
async def update_tenant_settings(inp: TenantSettingsInput, user: dict = Depends(require_role("owner"))):
    updates = {}
    if inp.high_value_threshold is not None:
        if inp.high_value_threshold < 0:
            raise HTTPException(status_code=400, detail="Threshold must be a positive amount")
        updates["high_value_threshold"] = float(inp.high_value_threshold)
    if inp.require_owner_signoff is not None:
        updates["require_owner_signoff"] = bool(inp.require_owner_signoff)
    if inp.currency is not None:
        updates["currency"] = inp.currency.strip().upper()
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": updates})
    await log_activity(user["tenant_id"], user["id"], "settings_updated", f"{user['name']} updated workspace settings")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})



def _slug_role(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (label or "").strip().lower()).strip("_")


class RoleLabelInput(BaseModel):
    label: str


@api.post("/tenant/roles")
async def add_role(inp: RoleLabelInput, user: dict = Depends(require_perm("team_manage"))):
    label = (inp.label or "").strip()
    key = _slug_role(label)
    if not label or not key or key == "owner":
        raise HTTPException(status_code=400, detail="Enter a valid role name")
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=400, detail="A role with this name already exists")
    roles.append({"key": key, "label": label})
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": roles}})
    await log_activity(user["tenant_id"], user["id"], "role_added", f"{user['name']} added the role '{label}'")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@api.patch("/tenant/roles/{key}")
async def rename_role(key: str, inp: RoleLabelInput, user: dict = Depends(require_perm("team_manage"))):
    label = (inp.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Enter a valid role name")
    if key == "owner":
        raise HTTPException(status_code=400, detail="The Owner role can't be renamed")
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if not any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=404, detail="Role not found")
    for r in roles:
        if r.get("key") == key:
            r["label"] = label
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": roles}})
    await log_activity(user["tenant_id"], user["id"], "role_renamed", f"{user['name']} renamed a role to '{label}'")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


@api.delete("/tenant/roles/{key}")
async def delete_role(key: str, user: dict = Depends(require_perm("team_manage"))):
    if key == "owner":
        raise HTTPException(status_code=400, detail="The Owner role can't be deleted")
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if not any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=404, detail="Role not found")
    in_use = await db.users.count_documents({"tenant_id": user["tenant_id"], "role": key})
    if in_use:
        raise HTTPException(status_code=400, detail=f"This role has {in_use} member(s) assigned. Reassign them to another role before deleting.")
    new_roles = [r for r in roles if r.get("key") != key]
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": new_roles}})
    await log_activity(user["tenant_id"], user["id"], "role_deleted", f"{user['name']} deleted a role")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# FIX-004-D (RBAC-14): per-role permission editor. Tenant-level roles
# can now carry a permissions[] list — every member holding that role
# picks up those perms via user_perms(). Was previously impossible:
# creating a 'warehouse_manager' role gave every member _BASE_PERMS
# only, and the only way to add e.g. 'finance' was editing each user
# individually.
class RolePermissionsInput(BaseModel):
    permissions: List[str]


@api.patch("/tenant/roles/{key}/permissions")
async def update_role_permissions(key: str, inp: RolePermissionsInput,
                                    user: dict = Depends(require_perm("team_manage"))):
    """Set the permission list for a tenant-defined role. Unknown
    permission keys are silently dropped (clean_perms filters to
    PERMISSION_KEYS). Owner role is reserved — its perms come from the
    all-perms shortcut minus owner_exclusions."""
    if key == "owner":
        raise HTTPException(
            status_code=400,
            detail="The Owner role's permissions are managed via owner-exclusions, not per-role.",
        )
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    roles = (t or {}).get("roles") or []
    if not any(r.get("key") == key for r in roles):
        raise HTTPException(status_code=404, detail="Role not found")
    perms = clean_perms(inp.permissions)
    for r in roles:
        if r.get("key") == key:
            r["permissions"] = perms
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"roles": roles}})
    await log_activity(
        user["tenant_id"], user["id"], "role_permissions_updated",
        f"{user['name']} updated permissions on role '{key}' to {len(perms)} perm(s)",
    )
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# FIX-005-C (RBAC-25): DPDP AI-consent tracking endpoints.
class AiConsentGrantInput(BaseModel):
    version: Optional[str] = None
    # Optional acknowledgment fields — not persisted, just make the
    # frontend contract explicit that the user was shown the doc.
    acknowledged: Optional[bool] = None


@api.get("/tenant/ai-consent")
async def get_ai_consent(user: dict = Depends(get_current_user)):
    """Consent status readable by any member — the frontend needs it
    to decide whether to show the consent modal (owner) or a
    'consent pending' banner (non-owner)."""
    from services.ai_consent import consent_status
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    return consent_status(tenant or {})


@api.post("/tenant/ai-consent")
async def grant_ai_consent(inp: AiConsentGrantInput, request: Request,
                             user: dict = Depends(require_role("owner"))):
    """Grant DPDP AI-processing consent. Owner-only — non-owners can't
    obligate the workspace to AI processing on their behalf.

    Captures actor + IP + UA so a regulator can verify who granted
    when. Emits an audit_log row so the compliance timeline has an
    immutable record.
    """
    from services import ai_consent as _consent
    from services import audit_log as _audit
    ip = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip() or (
        request.headers.get("X-Real-IP") or "").strip() or (
        request.client.host if request.client else None)
    ua = request.headers.get("User-Agent") or None
    payload = _consent.build_grant_payload(
        actor_user_id=user["id"],
        actor_email=user.get("email") or "",
        ip=ip, ua=ua,
        version=inp.version or _consent.CURRENT_CONSENT_VERSION,
    )
    await db.tenants.update_one(
        {"id": user["tenant_id"]},
        {"$set": {"ai_consent": payload, "updated_at": now_iso()}},
    )
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="tenant_ai_consent_granted",
        entity_type="tenant", entity_id=user["tenant_id"],
        after={"version": payload["version"]},
        **_ctx,
    )
    await log_activity(
        user["tenant_id"], user["id"], "ai_consent_granted",
        f"{user['name']} granted AI-processing consent (v{payload['version']})",
    )
    return _consent.consent_status(
        await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    )


@api.delete("/tenant/ai-consent")
async def revoke_ai_consent(request: Request,
                              user: dict = Depends(require_role("owner"))):
    """Revoke previously-granted consent. Preserves the grant record
    (granted_at + granting user's identity) — just flips revoked_at
    so the audit trail stays intact.

    All AI features become 451 immediately for this tenant.
    """
    from services import ai_consent as _consent
    from services import audit_log as _audit
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    if not tenant or not (tenant.get("ai_consent") or {}).get("granted_at"):
        raise HTTPException(status_code=400, detail="No active AI consent to revoke")
    await db.tenants.update_one(
        {"id": user["tenant_id"]},
        {"$set": _consent.build_revoke_patch(), "updated_at": now_iso()},
    )
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="tenant_ai_consent_revoked",
        entity_type="tenant", entity_id=user["tenant_id"],
        before={"granted_at": (tenant.get("ai_consent") or {}).get("granted_at")},
        **_ctx,
    )
    await log_activity(
        user["tenant_id"], user["id"], "ai_consent_revoked",
        f"{user['name']} revoked AI-processing consent",
    )
    return _consent.consent_status(
        await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "ai_consent": 1})
    )


# FIX-005-B (S3-04): monthly usage dashboard read endpoint.
@api.get("/tenant/usage")
async def get_tenant_usage(user: dict = Depends(get_current_user)):
    """Return every quota resource with current usage + cap + percent.
    Powers the frontend usage panel — badges at 75%/90%/100%. Every
    logged-in member can read; hides no sensitive info.

    Aggregation window = current UTC calendar month. Resets on the 1st.
    """
    from services.quotas import quota_status_all
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"quotas": await quota_status_all(db, tenant or {"id": user["tenant_id"]})}


# FIX-005-A (S3-02): plan / entitlement read endpoint.
@api.get("/tenant/plan")
async def get_tenant_plan(user: dict = Depends(get_current_user)):
    """Return the tenant's current effective plan (base plan defaults
    merged with tenant-level overrides). Every logged-in member can
    read this — frontend uses it to decide whether to show upgrade
    prompts, disabled features, seat-count badges."""
    from services.plans import effective_plan
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    ep = effective_plan(tenant)
    # Include seats_used so the UI can render "X of Y seats used"
    # without a second round trip.
    from services.auth.membership import list_memberships_for_tenant, LIVE_STATUSES
    active = await list_memberships_for_tenant(
        db, user["tenant_id"], statuses=LIVE_STATUSES,
    )
    ep["seats_used"] = len(active)
    return ep


# FIX-005-A (S3-03): per-tenant AI key endpoints.
class TenantAIKeysInput(BaseModel):
    # Provider -> key. Empty / missing = fall back to platform pool.
    keys: dict


@api.get("/tenant/ai-keys")
async def get_tenant_ai_keys(user: dict = Depends(require_role("owner"))):
    """Owner-only: list all providers with tenant-key presence + a
    masked preview of the actual key. Never returns the full secret.
    Fallback to platform pool is indicated by source='platform'."""
    from services.tenant_ai_keys import summarize_tenant_ai_keys
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"providers": summarize_tenant_ai_keys(tenant)}


@api.put("/tenant/ai-keys")
async def put_tenant_ai_keys(inp: TenantAIKeysInput, request: Request,
                               user: dict = Depends(require_role("owner"))):
    """Owner-only: replace the tenant.ai_keys map wholesale. Unknown
    providers dropped by normalize_ai_key_map. Emits audit log for
    each provider whose key was added / rotated / removed."""
    from services.tenant_ai_keys import (
        normalize_ai_key_map, CUSTOMIZABLE_PROVIDERS,
    )
    from services import audit_log as _audit
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if not tenant:
        raise HTTPException(status_code=404, detail="Workspace not found")
    old_keys = tenant.get("ai_keys") or {}
    new_keys = normalize_ai_key_map(inp.keys)
    await db.tenants.update_one(
        {"id": user["tenant_id"]}, {"$set": {"ai_keys": new_keys,
                                              "updated_at": now_iso()}},
    )
    # Audit each provider whose presence changed. Never log the value.
    _ctx = _audit.context_from(request, user)
    for p in CUSTOMIZABLE_PROVIDERS:
        had_old = bool((old_keys.get(p) or "").strip()) if isinstance(old_keys.get(p), str) else False
        has_new = bool((new_keys.get(p) or "").strip())
        if had_old != has_new or (had_old and has_new and old_keys.get(p) != new_keys.get(p)):
            await _audit.record(
                db, action="ai_key_updated",
                entity_type="tenant", entity_id=user["tenant_id"],
                meta={"provider": p, "had_old": had_old, "has_new": has_new,
                       "was_rotated": had_old and has_new and old_keys.get(p) != new_keys.get(p)},
                **_ctx,
            )
    await log_activity(
        user["tenant_id"], user["id"], "ai_keys_updated",
        f"{user['name']} updated AI keys ({len(new_keys)} provider(s) set)",
    )
    from services.tenant_ai_keys import summarize_tenant_ai_keys
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"providers": summarize_tenant_ai_keys(tenant)}


@api.delete("/tenant/ai-keys/{provider}")
async def delete_tenant_ai_key(provider: str, request: Request,
                                 user: dict = Depends(require_role("owner"))):
    """Owner-only: revert one provider back to the platform shared
    pool by removing the tenant's own key for it."""
    from services.tenant_ai_keys import CUSTOMIZABLE_PROVIDERS
    from services import audit_log as _audit
    if provider not in CUSTOMIZABLE_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider {provider!r}")
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    keys = dict((tenant or {}).get("ai_keys") or {})
    had_it = bool((keys.get(provider) or "").strip()) if isinstance(keys.get(provider), str) else False
    keys.pop(provider, None)
    await db.tenants.update_one(
        {"id": user["tenant_id"]}, {"$set": {"ai_keys": keys, "updated_at": now_iso()}},
    )
    if had_it:
        _ctx = _audit.context_from(request, user)
        await _audit.record(
            db, action="ai_key_updated",
            entity_type="tenant", entity_id=user["tenant_id"],
            meta={"provider": provider, "removed": True},
            **_ctx,
        )
        await log_activity(
            user["tenant_id"], user["id"], "ai_keys_updated",
            f"{user['name']} removed the tenant-level {provider} key",
        )
    from services.tenant_ai_keys import summarize_tenant_ai_keys
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"providers": summarize_tenant_ai_keys(tenant)}


# FIX-004-D (RBAC-15): owner exclusion list. Lets a tenant opt an
# owner OUT of specific permissions. Solves the "co-founder with
# everything EXCEPT finance visibility" ask that early-stage founders
# make. Empty list = classic all-perms owner (backward compat).
class OwnerExclusionsInput(BaseModel):
    exclusions: List[str]


@api.put("/tenant/owner-exclusions")
async def update_owner_exclusions(inp: OwnerExclusionsInput, request: Request,
                                    user: dict = Depends(require_role("owner"))):
    """Set the list of permission keys owner(s) do NOT get. Owner-only:
    a non-owner cannot restrict what owners can see. `owner` role
    itself cannot be excluded — the exclusion applies to specific
    permissions, not the role."""
    from services import audit_log as _audit
    tenant_before = await db.tenants.find_one(
        {"id": user["tenant_id"]}, {"_id": 0, "owner_exclusions": 1},
    )
    excl = clean_perms(inp.exclusions)
    await db.tenants.update_one(
        {"id": user["tenant_id"]}, {"$set": {"owner_exclusions": excl}},
    )
    await log_activity(
        user["tenant_id"], user["id"], "owner_exclusions_updated",
        f"{user['name']} set owner exclusions to {excl}",
    )
    # FIX-004-F (RBAC-20): audit-log the change — owner-exclusion
    # edits are exactly the compliance events the audit table exists
    # for. before/after captures the exact permission-scope shift.
    _ctx = _audit.context_from(request, user)
    await _audit.record(
        db, action="owner_exclusions_updated",
        entity_type="tenant", entity_id=user["tenant_id"],
        before={"owner_exclusions": (tenant_before or {}).get("owner_exclusions") or []},
        after={"owner_exclusions": excl},
        **_ctx,
    )
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


# FIX-004-F (RBAC-20): owner-facing audit-log read endpoint.
# Read-only — this API deliberately does NOT expose update/delete
# on audit rows. Tampering the log requires DB-level access.
@api.get("/admin/audit-log")
async def read_audit_log(
    request: Request,
    action: Optional[str] = None,
    actor_id: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    since_ts: Optional[str] = None,
    before_ts: Optional[str] = None,
    limit: int = 100,
    user: dict = Depends(require_role("owner")),
):
    """Read the tenant's audit log. Owner-only.

    Query params act as filters — omit for the full recent-first list.
    `before_ts` pages older entries (pass the timestamp of the last row
    returned). `limit` capped at 500 by the service to keep responses
    bounded.
    """
    from services import audit_log as _audit
    filters = {}
    if action:
        filters["action"] = action
    if actor_id:
        filters["actor_id"] = actor_id
    if entity_type:
        filters["entity_type"] = entity_type
    if entity_id:
        filters["entity_id"] = entity_id
    if since_ts:
        filters["since_ts"] = since_ts
    rows = await _audit.query(
        db, tenant_id=user["tenant_id"],
        filters=filters, limit=limit, before_ts=before_ts,
    )
    return {"rows": rows, "count": len(rows)}


@api.get("/invites")
async def list_invites(user: dict = Depends(get_current_user)):
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "invited_employees": 1})
    return (t or {}).get("invited_employees", [])


@api.post("/invites")
async def add_invites(inp: InviteInput, user: dict = Depends(require_perm("team_manage"))):
    clean = []
    seen = set()
    for p in inp.phones:
        p = (p or "").strip()
        if p and p not in seen:
            seen.add(p)
            clean.append({"phone": p, "status": "pending", "invited_at": now_iso(), "invited_by": user["id"]})
    if clean:
        await db.tenants.update_one({"id": user["tenant_id"]}, {"$push": {"invited_employees": {"$each": clean}}})
        await log_activity(user["tenant_id"], user["id"], "employees_invited",
                           f"Invited {len(clean)} employee(s) — SMS pending", "tenant", user["tenant_id"])
    t = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "invited_employees": 1})
    # NOTE: real SMS delivery pending Twilio credentials; invites stored as 'pending'.
    return {"added": len(clean), "invited_employees": (t or {}).get("invited_employees", [])}


# ---------------------------------------------------------------------------
# Team / users
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Contacts (customers & vendors)
# ---------------------------------------------------------------------------
async def enrich_contacts(contacts: list) -> list:
    ids = list({c.get("assigned_id") for c in contacts if c.get("assigned_id")})
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            umap[u["id"]] = u["name"]
    for c in contacts:
        c["assigned_name"] = umap.get(c.get("assigned_id"))
    return contacts


@api.get("/contacts")
async def list_contacts(type: Optional[str] = None, status: Optional[str] = None, q: Optional[str] = None,
                        user: dict = Depends(require_perm("people"))):
    query = {"tenant_id": user["tenant_id"]}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    if q:
        rx = {"$regex": q, "$options": "i"}
        query["$or"] = [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}]
    contacts = await db.contacts.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await enrich_contacts(contacts)


@api.post("/contacts")
async def create_contact(inp: ContactInput, user: dict = Depends(require_role("owner", "sales"))):
    if inp.type not in CONTACT_TYPES:
        raise HTTPException(status_code=400, detail="Invalid contact type")
    status = inp.status if inp.status in CONTACT_STATUS else "lead"
    cid = new_id()
    # E2-03: accept lifecycle_stage from the union of customer +
    # supplier stages. Empty string means unset (unfamiliar contact).
    stage = (inp.lifecycle_stage or "").strip().lower()
    if stage and stage not in LIFECYCLE_STAGES:
        stage = ""
    doc = {
        "id": cid, "tenant_id": user["tenant_id"], "type": inp.type, "name": inp.name,
        "company": inp.company or "", "phone": inp.phone or "", "email": inp.email or "",
        "address": inp.address or "", "tax_id": inp.tax_id or "", "tags": inp.tags or [],
        "status": status, "assigned_id": inp.assigned_id, "notes": inp.notes or "",
        "birthday": inp.birthday or "", "lifecycle_stage": stage,
        "created_by": user["id"], "created_at": now_iso(),
    }
    await db.contacts.insert_one(doc)
    await log_activity(user["tenant_id"], user["id"], "contact_added", f"Added {inp.type} '{inp.name}'", "contact", cid)
    doc.pop("_id", None)
    return (await enrich_contacts([doc]))[0]


@api.patch("/contacts/{contact_id}")
async def update_contact(contact_id: str, inp: ContactUpdateInput, user: dict = Depends(require_role("owner", "sales"))):
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": user["tenant_id"]})
    if not c:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {k: v for k, v in inp.model_dump().items() if v is not None}
    if "type" in updates and updates["type"] not in CONTACT_TYPES:
        updates.pop("type")
    if "status" in updates and updates["status"] not in CONTACT_STATUS:
        updates.pop("status")
    # E2-03: normalise + validate lifecycle_stage against the union.
    # Empty string is a legit value (means "unset" / no stage yet).
    if "lifecycle_stage" in updates:
        s = (updates["lifecycle_stage"] or "").strip().lower()
        updates["lifecycle_stage"] = s if s in LIFECYCLE_STAGES else ""
    # FIX-003-C (S2-09): denormalized-name cascade. `contact_name` is
    # copied at write time into invoices, payments, and workflows
    # (workflows.counterparty). Without a cascade, renaming a contact
    # only updates the contacts collection — every existing invoice /
    # payment / workflow keeps the old name in its display column,
    # search index, and any exported report. Cascade on the rename to
    # keep the reads consistent.
    old_name = (c.get("name") or "").strip()
    new_name = str(updates.get("name") or "").strip()
    name_changed = ("name" in updates and new_name and new_name != old_name)
    if updates:
        await db.contacts.update_one({"id": contact_id}, {"$set": updates})
    if name_changed:
        tid = user["tenant_id"]
        # Match by contact_id where present (recent rows) and by exact
        # old_name where contact_id is missing (legacy rows written
        # before contact_id backfill). Every update is tenant-scoped
        # so nothing crosses workspaces.
        cascade_query_by_id = {"tenant_id": tid, "contact_id": contact_id}
        cascade_query_by_name = {"tenant_id": tid, "contact_id": {"$in": [None, ""]},
                                  "contact_name": old_name} if old_name else None
        for coll_name, name_field in (
            ("invoices", "contact_name"),
            ("payments", "contact_name"),
        ):
            try:
                await db[coll_name].update_many(cascade_query_by_id,
                                                {"$set": {name_field: new_name}})
                if cascade_query_by_name:
                    await db[coll_name].update_many(cascade_query_by_name,
                                                    {"$set": {name_field: new_name}})
            except Exception:
                logger.exception(f"[FIX-003-C] contact_name cascade failed on {coll_name}")
        # workflows.counterparty is the denormalized display for the
        # linked contact. Same match strategy.
        try:
            await db.workflows.update_many(
                {"tenant_id": tid, "contact_id": contact_id},
                {"$set": {"counterparty": new_name}},
            )
            if old_name:
                await db.workflows.update_many(
                    {"tenant_id": tid, "contact_id": {"$in": [None, ""]},
                     "counterparty": old_name},
                    {"$set": {"counterparty": new_name}},
                )
        except Exception:
            logger.exception("[FIX-003-C] counterparty cascade failed on workflows")
    c = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return (await enrich_contacts([c]))[0]


@api.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str, user: dict = Depends(require_role("owner", "sales"))):
    res = await db.contacts.delete_one({"id": contact_id, "tenant_id": user["tenant_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


# ---------------------------------------------------------------------------
# Voice notes / ingestion
# ---------------------------------------------------------------------------
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@api.post("/voice-notes")
async def create_voice_note(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), file_ids: str = Form(""), user: dict = Depends(require_perm("voice_capture"))):
    # FIX-002-E: uploads go to obj_store with a tenant-prefixed key so they
    # survive redeploys, work across replicas, and can be tenant-deleted
    # cleanly (see FIX-001-E). Was local disk under UPLOAD_DIR.
    from services.uploads import store_upload
    note_id = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    content = await file.read()
    result = await store_upload(user["tenant_id"], "voice-notes", content, ext,
                                 content_type=file.content_type, file_id=note_id)
    ref_ids = [x for x in (file_ids or "").split(",") if x.strip()]
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "audio", "audio_path": result["storage_path"],
        "transcript": None, "language": language,
        "reference_file_ids": ref_ids,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}


@api.post("/transcribe")
async def transcribe_only(file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(get_current_user)):
    """Dictation helper: transcribe a short audio clip to text (no note/decision is created).

    FIX-002-E: dictation is truly ephemeral (transcribe + return the text,
    never persisted). Writing to a system temp file (auto-cleaned on
    reboot) instead of the shared UPLOAD_DIR avoids polluting the
    tenant-scoped upload namespace with throwaway files.
    """
    import tempfile
    ext = (file.filename or "audio.webm").split(".")[-1]
    data = await file.read()
    fd, tmp_path = tempfile.mkstemp(suffix=f".{ext}", prefix="dictation-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        try:
            text = await transcribe_audio(tmp_path, language)
        except Exception as e:
            logger.error(f"transcribe_only failed: {e}")
            raise HTTPException(status_code=503, detail="Couldn't transcribe audio. Please try again.")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
    return {"text": (text or "").strip()}



@api.post("/voice-notes/text")
async def create_text_note(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_perm("voice_capture"))):
    note_id = new_id()
    ref_ids = [x for x in (inp.file_ids or []) if x]
    if not (inp.text or "").strip() and not ref_ids:
        raise HTTPException(status_code=400, detail="Provide a directive or attach a file")
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "text" if (inp.text or "").strip() else "file", "audio_path": None,
        "transcript": inp.text, "language": inp.language or "auto",
        "reference_file_ids": ref_ids,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}


class ClarifyInput(BaseModel):
    text: str


async def ai_clarify_directive(text: str, industry: str, session_id: str) -> dict:
    """Decide if an owner's directive has enough info to act on; if not, ask up to 4 short questions."""
    system = (
        "You are the intake assistant of DecisionOS for a small business. "
        f"Industry: {industry or 'general'}. "
        "The owner just gave a short instruction. Decide whether it contains enough information to create a clear, "
        "actionable task/decision. Critical details that are often missing: WHO (which customer/supplier/person), "
        "amounts, dates/deadlines, which invoice/order, and any specific instructions. "
        "If the instruction is already actionable, return complete=true with an empty questions list. "
        "If key details are missing, return complete=false and up to 4 SHORT clarifying questions "
        "(each with a tiny hint/example). Do NOT ask about things already stated. "
        "Return ONLY valid JSON: {\"complete\": boolean, \"questions\": [{\"id\": string, \"question\": string, \"hint\": string}]}."
    )
    prompt = f"Owner instruction: \"{text}\"\nAnalyze it now."
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI clarify parse error: {e} :: {resp[:300]}")
        return {"complete": True, "questions": []}
    qs = []
    for q in (d.get("questions") or [])[:4]:
        if isinstance(q, dict) and q.get("question"):
            qs.append({"id": q.get("id") or new_id(), "question": str(q["question"])[:160], "hint": str(q.get("hint") or "")[:120]})
    complete = bool(d.get("complete")) or len(qs) == 0
    return {"complete": complete, "questions": [] if complete else qs}


@api.post("/capture/clarify")
async def clarify_directive(inp: ClarifyInput, user: dict = Depends(require_perm("voice_capture"))):
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    industry = await _tenant_industry(user["tenant_id"])
    return await ai_clarify_directive(text, industry, session_id=f"clarify-{user['id']}")



@api.get("/voice-notes")
async def list_voice_notes(user: dict = Depends(get_current_user)):
    notes = await db.voice_notes.find(
        {"tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0}
    ).sort("created_at", -1).to_list(100)
    return notes


@api.get("/voice-notes/{note_id}")
async def get_voice_note(note_id: str, user: dict = Depends(get_current_user)):
    note = await db.voice_notes.find_one({"id": note_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Not found")
    return note


# ---------------------------------------------------------------------------
# Meeting Notes
# ---------------------------------------------------------------------------
async def process_meeting(meeting_id: str):
    m = await db.meetings.find_one({"id": meeting_id})
    if not m:
        return
    tid = m["tenant_id"]
    try:
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "transcribing"}})
        transcript = m.get("transcript")
        if not transcript and m.get("audio_path"):
            transcript = await transcribe_audio(m["audio_path"], m.get("language", "auto"))
            await db.meetings.update_one({"id": meeting_id}, {"$set": {"transcript": transcript}})
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "structuring"}})
        members = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        notes = await ai_meeting_notes(transcript or "", members, session_id=f"meeting-{meeting_id}")
        task_ids = []
        for a in notes.get("action_items", []):
            if not a.get("title"):
                continue
            due = None
            if isinstance(a.get("due_in_days"), int):
                due = (datetime.now(timezone.utc) + timedelta(days=a["due_in_days"])).isoformat()
            member = match_member_by_name(members, a.get("assignee_name", ""))
            tid_task = new_id()
            await db.tasks.insert_one({
                "id": tid_task, "tenant_id": tid, "title": a["title"], "description": "From meeting notes",
                "assignee_role": member["role"] if member else None, "assignee_id": member["id"] if member else None,
                "priority": "medium", "status": "todo", "due_date": due, "decision_id": None,
                "source": "meeting", "created_at": now_iso(),
            })
            task_ids.append(tid_task)
        await db.meetings.update_one({"id": meeting_id}, {"$set": {
            "title": notes.get("title"), "summary": notes.get("summary"),
            "key_points": notes.get("key_points", []), "decisions": notes.get("decisions", []),
            "action_items": notes.get("action_items", []), "task_ids": task_ids,
            "status": "done", "processed_at": now_iso(),
        }})
        await log_activity(tid, m["created_by"], "meeting_processed",
                           f"Meeting notes ready: '{notes.get('title')}' — {len(task_ids)} action item(s)", "meeting", meeting_id)
        # FIX-007-B (S4-10): every finalized meeting is now a queryable
        # Brain event — "what did we agree at the Sharma vendor call?"
        # used to be answerable only by scrolling meetings; now the
        # summary + decisions + action-item count land as one
        # brain_context row that /ask + brain_router can retrieve.
        try:
            _key_pts = notes.get("key_points") or []
            _decs = notes.get("decisions") or []
            _why_bits = []
            if _decs:
                _why_bits.append("Decisions: " + " | ".join(str(d) for d in _decs[:5]))
            if _key_pts:
                _why_bits.append("Key points: " + " | ".join(str(k) for k in _key_pts[:5]))
            await brain_context.record_context(
                tenant_id=tid, kind="meeting",
                title=notes.get("title") or "Meeting",
                outcome=f"{len(task_ids)} action item(s)" if task_ids else "notes",
                why=(notes.get("summary") or "\n".join(_why_bits))[:800],
                tags=["meeting"],
                source_type="meeting", source_id=meeting_id,
                related_ids={"task_ids_count": str(len(task_ids))},
                actor_id=m.get("created_by") or "",
                actor_name="",
                department="", visibility="public",
            )
        except Exception as _e:
            logger.warning(f"S4-10 meeting brain_context failed for {meeting_id}: {_e}")
    except Exception as e:
        logger.exception("process_meeting failed")
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "failed", "error": str(e)}})


@api.post("/meetings")
async def create_meeting(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(require_perm("voice_capture"))):
    # FIX-004-C (RBAC-08): meeting audio triggers STT (per-minute-
    # billed) + downstream LLM summarization. Same voice_capture perm
    # already gates /voice-notes; extending to meetings closes the
    # inconsistency that let perm-less employees burn STT credits
    # here.
    # FIX-002-E: obj_store with tenant prefix (was local UPLOAD_DIR).
    from services.uploads import store_upload
    mid = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    content = await file.read()
    result = await store_upload(user["tenant_id"], "meetings", content, ext,
                                 content_type=file.content_type, file_id=mid)
    await db.meetings.insert_one({
        "id": mid, "tenant_id": user["tenant_id"], "created_by": user["id"], "created_by_name": user.get("name"),
        "kind": "audio", "audio_path": result["storage_path"],
        "transcript": None, "language": language,
        "title": "Processing meeting…", "summary": "", "key_points": [], "decisions": [], "action_items": [],
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_meeting, mid)
    return {"id": mid, "status": "queued"}


@api.post("/meetings/text")
async def create_meeting_text(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_perm("voice_capture"))):
    # FIX-004-C (RBAC-08): parity with /meetings audio — same LLM
    # summarization path, same perm gate.
    mid = new_id()
    await db.meetings.insert_one({
        "id": mid, "tenant_id": user["tenant_id"], "created_by": user["id"], "created_by_name": user.get("name"),
        "kind": "text", "audio_path": None, "transcript": inp.text, "language": inp.language or "auto",
        "title": "Processing meeting…", "summary": "", "key_points": [], "decisions": [], "action_items": [],
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_meeting, mid)
    return {"id": mid, "status": "queued"}


@api.get("/meetings")
async def list_meetings(user: dict = Depends(get_current_user)):
    return await db.meetings.find({"tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0}).sort("created_at", -1).to_list(100)


@api.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, user: dict = Depends(get_current_user)):
    m = await db.meetings.find_one({"id": meeting_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    return m



# ---------------------------------------------------------------------------
# Operating Score
# ---------------------------------------------------------------------------
def _clamp100(v):
    return max(0, min(100, int(round(v))))


def _is_open_task(t):
    return t.get("status") in ("todo", "in_progress", "blocked")


def _score_execution(tasks, now):
    """Task-execution score; returns (execution, done, open_tasks, overdue, actionable)."""
    done = sum(1 for t in tasks if t.get("status") == "done")
    open_tasks = [t for t in tasks if _is_open_task(t)]
    overdue = sum(1 for t in open_tasks if t.get("due_date") and t["due_date"] < now)
    actionable = done + len(open_tasks)
    completion = (done / actionable) if actionable else 0.7
    overdue_ratio = (overdue / len(open_tasks)) if open_tasks else 0
    return _clamp100(completion * 100 - overdue_ratio * 40), done, open_tasks, overdue, actionable


def _score_sales(decisions):
    """Decision-approval score; returns (sales, total_dec, approved)."""
    total_dec = len(decisions)
    approved = sum(1 for d in decisions if d.get("status") == "approved")
    approved_rate = (approved / total_dec) if total_dec else 0.7
    return _clamp100(approved_rate * 100), total_dec, approved


def _score_employees(tasks, members, now):
    """Per-employee execution scores, sorted high to low."""
    employees = []
    for mbr in members:
        mine = [t for t in tasks if t.get("assignee_id") == mbr["id"] or (not t.get("assignee_id") and t.get("assignee_role") == mbr["role"])]
        m_done = sum(1 for t in mine if t.get("status") == "done")
        m_open = [t for t in mine if _is_open_task(t)]
        m_overdue = sum(1 for t in m_open if t.get("due_date") and t["due_date"] < now)
        m_action = m_done + len(m_open)
        m_comp = (m_done / m_action) if m_action else 0
        m_score = _clamp100(m_comp * 100 - (m_overdue / len(m_open) if m_open else 0) * 40) if m_action else None
        employees.append({"id": mbr["id"], "name": mbr["name"], "role": mbr["role"],
                          "score": m_score, "done": m_done, "open": len(m_open), "overdue": m_overdue})
    employees.sort(key=lambda e: (e["score"] if e["score"] is not None else -1), reverse=True)
    return employees


@api.get("/operating-score")
async def operating_score(user: dict = Depends(require_role("owner"))):
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    can_finance = user.get("role") == "owner" or "finance" in user_perms(user)

    tasks = await db.tasks.find({"tenant_id": tid}, {"_id": 0}).to_list(2000)
    decisions = await db.decisions.find({"tenant_id": tid}, {"_id": 0, "status": 1}).to_list(2000)
    complaints = await db.complaints.find({"tenant_id": tid}, {"_id": 0, "status": 1}).to_list(500)

    execution, done, open_tasks, overdue, actionable = _score_execution(tasks, now)

    total_billed = total_paid = 0.0
    overdue_inv = 0
    inv_count = 0
    if can_finance:
        invs = await db.invoices.find({"tenant_id": tid}, {"_id": 0, "amount": 1, "type": 1, "status": 1, "due_date": 1}).to_list(2000)
        pays = await db.payments.find({"tenant_id": tid}, {"_id": 0, "amount": 1}).to_list(2000)
        inv_count = len(invs)
        total_billed = sum(float(i.get("amount") or 0) for i in invs if i.get("type") == "sales_invoice")
        total_paid = sum(float(p.get("amount") or 0) for p in pays)
        overdue_inv = sum(1 for i in invs if i.get("type") == "sales_invoice" and i.get("status") != "paid" and i.get("due_date") and i["due_date"] < now)
    collected = (min(total_paid, total_billed) / total_billed) if total_billed else 0.7
    finance = _clamp100(collected * 100 - overdue_inv * 5) if can_finance else None

    sales, total_dec, approved = _score_sales(decisions)

    open_complaints = sum(1 for c in complaints if c.get("status") != "resolved")
    responsiveness = _clamp100(100 - open_complaints * 12 - overdue * 3)

    categories = {"execution": execution, "finance": finance, "sales": sales, "responsiveness": responsiveness}
    weights = {"execution": 0.35, "finance": 0.25, "sales": 0.2, "responsiveness": 0.2}
    avail = {k: v for k, v in categories.items() if v is not None}
    wsum = sum(weights[k] for k in avail) or 1
    overall = _clamp100(sum(avail[k] * weights[k] for k in avail) / wsum)

    # Gate: don't show a (misleading) score until there's meaningful activity.
    enough_data = actionable >= 3 or inv_count > 0

    members = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
    employees = _score_employees(tasks, members, now)

    return {
        "company": {"overall": overall if enough_data else None, "categories": categories, "enough_data": enough_data},
        "stats": {"done": done, "open": len(open_tasks), "overdue": overdue,
                  "total_decisions": total_dec, "approved": approved, "open_complaints": open_complaints,
                  "outstanding": round(total_billed - total_paid, 2) if can_finance else None},
        "employees": employees,
        "can_finance": can_finance,
    }


# ---------------------------------------------------------------------------
# Personal AI Work Coach
# ---------------------------------------------------------------------------
async def compute_employee_stats(tenant_id: str, target: dict) -> dict:
    uid, role = target["id"], target.get("role")
    now = datetime.now(timezone.utc).isoformat()
    tasks = await db.tasks.find(
        {"tenant_id": tenant_id, "$or": [{"assignee_id": uid}, {"assignee_id": None, "assignee_role": role}]},
        {"_id": 0}).to_list(3000)
    done = [t for t in tasks if t.get("status") == "done"]
    open_tasks = [t for t in tasks if t.get("status") in ("todo", "in_progress", "blocked")]
    overdue = [t for t in open_tasks if t.get("due_date") and t["due_date"] < now]
    actionable = len(done) + len(open_tasks)

    def has_attach(t, kind=None):
        atts = t.get("attachments") or []
        return any((kind is None or a.get("kind") == kind) for a in atts) if atts else False

    done_with_proof = sum(1 for t in done if has_attach(t))
    with_plan = sum(1 for t in tasks if (t.get("execution_plan") or {}).get("status") == "accepted")
    plans_completed = sum(1 for t in tasks if (t.get("execution_plan") or {}).get("progress") == 100)
    photos = sum(len([a for a in (t.get("attachments") or []) if a.get("kind") == "photo"]) for t in tasks)
    voices = sum(len([a for a in (t.get("attachments") or []) if a.get("kind") == "voice"]) for t in tasks)
    return {
        "completed": len(done),
        "open": len(open_tasks),
        "overdue": len(overdue),
        "actionable": actionable,
        "completion_rate": round(len(done) / actionable * 100) if actionable else 0,
        "proof_upload_rate": round(done_with_proof / len(done) * 100) if done else 0,
        "plans_used": with_plan,
        "plans_completed": plans_completed,
        "photos_uploaded": photos,
        "voice_updates": voices,
    }


async def ai_work_coach(target: dict, stats: dict, session_id: str) -> dict:
    system = (
        "You are a supportive but honest performance coach inside DecisionOS, an operating system for a small business. "
        "Given one employee's work statistics, write a short performance review. Be specific and reference the numbers. "
        "Return ONLY valid JSON: {\"headline\": string (one encouraging sentence), "
        "\"strengths\": [string] (2-4 concrete strengths), \"improvements\": [string] (1-3 gentle, actionable areas), "
        "\"recommendation\": string (one concrete habit to adopt next). Keep every item under 18 words.}"
    )
    prompt = (f"Employee: {target.get('name')} (role: {target.get('role')})\n"
              f"Stats: {json.dumps(stats)}\n"
              "Write the review now.")
    chat = claude_chat(session_id=session_id, system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI work coach parse error: {e} :: {resp[:300]}")
        d = {}
    return {
        "headline": str(d.get("headline") or "")[:200],
        "strengths": [str(s)[:120] for s in (d.get("strengths") or [])][:4],
        "improvements": [str(s)[:120] for s in (d.get("improvements") or [])][:3],
        "recommendation": str(d.get("recommendation") or "")[:240],
    }


async def _resolve_coach_target(user: dict, user_id: Optional[str]) -> dict:
    if user_id and user_id != user["id"]:
        if user.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only the owner can view others' coaching")
        target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Employee not found")
        return target
    return user


@api.get("/work-coach")
async def get_work_coach(user_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    target = await _resolve_coach_target(user, user_id)
    stats = await compute_employee_stats(user["tenant_id"], target)
    cached = target.get("coach_summary")
    return {"target": {"id": target["id"], "name": target.get("name"), "role": target.get("role")},
            "stats": stats, "summary": cached}


@api.post("/work-coach/refresh")
async def refresh_work_coach(user_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    target = await _resolve_coach_target(user, user_id)
    stats = await compute_employee_stats(user["tenant_id"], target)
    summary = await ai_work_coach(target, stats, session_id=f"coach-{target['id']}")
    summary["generated_at"] = now_iso()
    summary["stats_snapshot"] = stats
    await db.users.update_one({"id": target["id"]}, {"$set": {"coach_summary": summary}})
    return {"target": {"id": target["id"], "name": target.get("name"), "role": target.get("role")},
            "stats": stats, "summary": summary}




# Decisions
# ---------------------------------------------------------------------------
async def enrich_decision(d: dict, tenant_id: Optional[str] = None) -> dict:
    # FIX-003-B (S2-05): defense-in-depth tenant filter. In today's flow,
    # a decision's task_ids and created_by are always same-tenant (the
    # decision itself came from a tenant-scoped query), but the bare
    # {"id": {"$in": ...}} lookup would happily return cross-tenant
    # matches if any bug or corrupted document ever slipped a foreign
    # id into task_ids. Filter defensively.
    tid = tenant_id if tenant_id is not None else d.get("tenant_id")
    task_q = {"id": {"$in": d.get("task_ids", [])}}
    if tid:
        task_q["tenant_id"] = tid
    tasks = await db.tasks.find(task_q, {"_id": 0}).to_list(200)
    user_q = {"id": d.get("created_by")}
    if tid:
        user_q["tenant_id"] = tid
    creator = await db.users.find_one(user_q, {"_id": 0, "name": 1})
    d["tasks"] = await enrich_tasks(tasks)
    d["created_by_name"] = creator["name"] if creator else "Unknown"
    return d


async def enrich_decisions(decisions: list, tenant_id: Optional[str] = None) -> list:
    # FIX-003-B (S2-05): defense-in-depth tenant filter — see
    # enrich_decision above. Same tenancy invariant applies at the
    # batch level. The `tenant_id` argument is optional so existing
    # callers keep working; when supplied it filters the id-lookups.
    # If not supplied AND every decision has the same tenant_id, we
    # infer it (the common case for a per-tenant caller). Only when
    # the input mixes tenants (never happens in practice today, but a
    # future admin cross-tenant sweep might) do we skip the filter.
    task_ids = list({tid for d in decisions for tid in d.get("task_ids", [])})
    creator_ids = list({d.get("created_by") for d in decisions if d.get("created_by")})
    scope_tid = tenant_id
    if scope_tid is None:
        tids_in_batch = {d.get("tenant_id") for d in decisions if d.get("tenant_id")}
        if len(tids_in_batch) == 1:
            scope_tid = next(iter(tids_in_batch))
    tasks_map = {}
    if task_ids:
        task_q = {"id": {"$in": task_ids}}
        if scope_tid:
            task_q["tenant_id"] = scope_tid
        for t in await enrich_tasks(await db.tasks.find(task_q, {"_id": 0}).to_list(2000)):
            tasks_map[t["id"]] = t
    users_map = {}
    if creator_ids:
        user_q = {"id": {"$in": creator_ids}}
        if scope_tid:
            user_q["tenant_id"] = scope_tid
        for u in await db.users.find(user_q, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            users_map[u["id"]] = u["name"]
    for d in decisions:
        d["tasks"] = [tasks_map[t] for t in d.get("task_ids", []) if t in tasks_map]
        d["created_by_name"] = users_map.get(d.get("created_by"), "Unknown")
        d.setdefault("dtype", "directive")
        d.setdefault("confidence", None)
    return decisions


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



# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------
@api.get("/workflows")
async def list_workflows(type: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if type:
        q["type"] = type
    wfs = await db.workflows.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return wfs


@api.post("/workflows")
async def create_workflow(inp: WorkflowCreateInput, user: dict = Depends(require_perm("workflows"))):
    # FIX-004-C (RBAC-04): symmetric with DELETE /workflows/{id} which
    # is role(owner). Previously ANY employee could create workflows
    # (auth-only) while only owner could delete them. Now creation
    # requires the same `workflows` permission a person needs to
    # interact with the workflow board at all.
    om = await tenant_operating_model(user["tenant_id"])
    pipeline = next((p for p in om["pipelines"] if p["key"] == inp.type), None)
    if not pipeline:
        raise HTTPException(status_code=400, detail="Invalid workflow type")
    wid = new_id()
    stages = [s["key"] for s in pipeline["stages"]]
    counterparty = inp.counterparty or ""
    contact_id = inp.contact_id
    if contact_id:
        contact = await db.contacts.find_one({"id": contact_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "name": 1, "company": 1})
        if contact:
            counterparty = counterparty or contact.get("company") or contact.get("name")
        else:
            contact_id = None
    wf = {
        "id": wid, "tenant_id": user["tenant_id"], "type": inp.type, "title": inp.title,
        "detail": inp.detail or "", "amount": inp.amount, "counterparty": counterparty, "contact_id": contact_id,
        "stage": stages[0], "stages": stages,
        "history": [{"stage": stages[0], "note": "Created", "by": user["id"], "at": now_iso()}],
        "created_by": user["id"], "created_at": now_iso(),
    }
    await db.workflows.insert_one(wf)
    await log_activity(user["tenant_id"], user["id"], "workflow_created", f"Started {inp.type.replace('_', '→')} '{inp.title}'", "workflow", wid)
    wf.pop("_id", None)
    return wf


@api.patch("/workflows/{workflow_id}/advance")
async def advance_workflow(workflow_id: str, inp: WorkflowAdvanceInput, user: dict = Depends(require_perm("workflows"))):
    from services.tenancy import tenant_filter  # FIX-001-C carried over: writes below now tenant-scoped
    wf = await db.workflows.find_one({"id": workflow_id, "tenant_id": user["tenant_id"]})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    if inp.stage not in wf["stages"]:
        raise HTTPException(status_code=400, detail="Invalid stage")
    cur_idx = wf["stages"].index(wf["stage"])
    tgt_idx = wf["stages"].index(inp.stage)
    if tgt_idx != cur_idx + 1:
        raise HTTPException(status_code=400, detail="Can only advance to the next stage")
    # dynamic approval gate: only owner may advance to a pipeline's approval_stage
    om = await tenant_operating_model(user["tenant_id"])
    pipeline = next((p for p in om["pipelines"] if p["key"] == wf["type"]), None)
    appr_stage = pipeline.get("approval_stage") if pipeline else ("approved" if wf["type"] == "purchase_payment" else None)
    if appr_stage and inp.stage == appr_stage and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can approve this stage")
    entry = {"stage": inp.stage, "note": inp.note or "", "by": user["id"], "at": now_iso()}
    await db.workflows.update_one(
        tenant_filter(workflow_id, user["tenant_id"]),
        {"$set": {"stage": inp.stage}, "$push": {"history": entry}},
    )
    await log_activity(user["tenant_id"], user["id"], "workflow_advanced", f"'{wf['title']}' → {inp.stage}", "workflow", workflow_id)
    # FIX-007-B (S4-10): workflow-stage advances were invisible to the
    # Brain — "when did the Kapoor order actually ship?" queries came
    # back empty because the paid → dispatched → delivered chain never
    # got captured as a queryable outcome. Now every advance writes one
    # brain_context row keyed by (workflow_id, decision_id) so both
    # "downstream of decision X" and "history of workflow Y" queries
    # resolve. Terminal-stage advances get outcome="completed" so
    # retrieval can rank a completed workflow above one still in flight.
    try:
        _final_stage = wf["stages"][-1] if wf.get("stages") else None
        _is_terminal = _final_stage and inp.stage == _final_stage
        await brain_context.record_context(
            tenant_id=user["tenant_id"], kind="workflow",
            title=f"{wf.get('title') or 'Workflow'} → {inp.stage}",
            outcome="completed" if _is_terminal else "advanced",
            why=(inp.note or ""),
            tags=[wf.get("type")] if wf.get("type") else [],
            source_type="workflow", source_id=workflow_id,
            decision_id=wf.get("decision_id"),
            related_ids={"workflow_type": wf.get("type"),
                          "counterparty": wf.get("counterparty")},
            actor_id=user["id"], actor_name=user.get("name") or "",
            department=user.get("role") or "", visibility="public",
        )
    except Exception as _e:
        # Fail-open — never let a Brain write break the workflow advance.
        logger.warning(f"S4-10 workflow brain_context failed for {workflow_id}: {_e}")

    # FIX-001-B: workflow -> Finance handoff. When a procurement workflow
    # advances to its final stage ("paid" / "settled" / "invoice_paid" etc.,
    # whatever the tenant's AI-designed pipeline calls it), auto-create a
    # PENDING-BILL expense in Finance so the founder doesn't have to record
    # the same purchase twice. Idempotent: never double-creates for the
    # same workflow_id, so re-advancing (or later stage tweaks) don't
    # spawn duplicate expenses. All failures are best-effort try/except so
    # a Finance-side hiccup can't 500 the workflow advance itself.
    try:
        from services.workflows import tenant_procurement_pipeline, procurement_terminal_stage
        proc = await tenant_procurement_pipeline(user["tenant_id"])
        if proc and proc.get("key") == wf["type"]:
            term = procurement_terminal_stage(proc)
            if term and inp.stage == term:
                existing = await db.expenses.find_one(
                    {"tenant_id": user["tenant_id"], "workflow_id": workflow_id},
                    {"_id": 0, "id": 1},
                )
                if not existing:
                    from routers.ledger import create_expense
                    est_amt = wf.get("amount") if isinstance(wf.get("amount"), (int, float)) else 0.0
                    exp = await create_expense(
                        user["tenant_id"], user["id"],
                        {
                            "title": wf.get("title") or "Procurement expense",
                            "amount": est_amt,
                            "vendor_name": wf.get("counterparty") or "",
                            "status": "awaiting_bill",
                            "notes": f"Auto-created from procurement workflow: {wf.get('title')}. "
                                     f"Estimated amount from the workflow card; upload the actual bill to reconcile.",
                            "workflow_id": workflow_id,
                            "workflow_type": wf.get("type"),
                        },
                        source="workflow", write_brain=True,
                    )
                    # Notify Finance role so they know to upload the bill.
                    finance_ids = await _finance_user_ids(user["tenant_id"])
                    # Don't ping the person who just advanced the workflow if they
                    # ARE finance — they already know.
                    finance_ids = [u for u in finance_ids if u and u != user["id"]]
                    if finance_ids:
                        cur = await _tenant_currency(user["tenant_id"])
                        est_txt = f"{cur} {int(est_amt):,}" if est_amt else f"amount not on card"
                        await push_notification(
                            user["tenant_id"], finance_ids, 2,
                            f"Upload bill for '{wf.get('title')}' (est. {est_txt}) — auto-created from a completed workflow",
                            "expense", exp["id"],
                            ntype="bill_upload", title=wf.get("title"),
                            sender=user.get("name"),
                        )
    except Exception as e:
        # Fire-and-forget: never let the Finance handoff block the workflow advance.
        logger.warning(f"FIX-001-B: workflow->expense auto-create failed for {workflow_id}: {e}")

    return await db.workflows.find_one(tenant_filter(workflow_id, user["tenant_id"]), {"_id": 0})


@api.delete("/workflows/{workflow_id}")
async def delete_workflow(workflow_id: str, user: dict = Depends(require_role("owner"))):
    wf = await db.workflows.find_one({"id": workflow_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "title": 1})
    if not wf:
        raise HTTPException(status_code=404, detail="Not found")
    await db.workflows.delete_one({"id": workflow_id, "tenant_id": user["tenant_id"]})
    await log_activity(user["tenant_id"], user["id"], "workflow_deleted", f"Deleted workflow '{wf.get('title', '')}'", "workflow", workflow_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Company Brain search
# ---------------------------------------------------------------------------
def _brain_can_finance(user: dict) -> bool:
    """Whether a user may see financial records in Company Brain (Search + Ask)."""
    return bool({"finance", "ledger"} & user_perms(user))


def _brain_privileged(user: dict) -> bool:
    """Owners / team managers see all departments' operational records."""
    return user.get("role") == "owner" or "team_manage" in user_perms(user)


@api.get("/brain/search")
async def brain_search(q: str = "", user: dict = Depends(require_perm("brain"))):
    tid = user["tenant_id"]
    uid = user.get("id")
    urole = user.get("role")
    can_finance = _brain_can_finance(user)
    privileged = _brain_privileged(user)
    tokens = [re.escape(t) for t in q.split() if len(t) >= 2]
    rx = {"$regex": "|".join(tokens), "$options": "i"} if tokens else {"$exists": True}

    # Tasks: non-privileged users only see tasks in their own department (own / their role / created by them).
    task_q = {"tenant_id": tid, "$and": [{"$or": [{"title": rx}, {"description": rx}]}]}
    if not privileged:
        task_q["$and"].append({"$or": [{"assignee_id": uid}, {"assignee_role": urole}, {"created_by": uid}]})

    decisions = await db.decisions.find({"tenant_id": tid, "$or": [{"title": rx}, {"summary": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    tasks = await db.tasks.find(task_q, {"_id": 0}).sort("created_at", -1).to_list(50)
    workflows = await db.workflows.find({"tenant_id": tid, "$or": [{"title": rx}, {"detail": rx}, {"counterparty": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    contacts = await db.contacts.find({"tenant_id": tid, "$or": [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}, {"notes": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    memory = await db.memory.find({"tenant_id": tid, "text": rx}, {"_id": 0}).sort("created_at", -1).to_list(50)

    # Financial records: department-restricted to Owner / Finance / Ledger roles only.
    if can_finance:
        invoices = await db.invoices.find({"tenant_id": tid, "$or": [{"number": rx}, {"contact_name": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        expenses = await db.expenses.find({"tenant_id": tid, "$or": [{"title": rx}, {"vendor_name": rx}, {"category": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        assets = await db.assets.find({"tenant_id": tid, "$or": [{"name": rx}, {"vendor_name": rx}, {"category": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
        inventory = await db.inventory.find({"tenant_id": tid, "$or": [{"item": rx}, {"sku": rx}, {"vendor_name": rx}, {"category": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    else:
        invoices = expenses = assets = inventory = []
        # Hide the money figure on operational workflow cards from non-finance roles.
        for w in workflows:
            if "amount" in w:
                w["amount"] = None
    return {
        # FIX-003-B (S2-05): explicit tenant_id makes the tenant filter
        # unconditional (auto-inference in enrich_decisions works, but
        # explicit reads better and survives future refactors that may
        # widen the query).
        "decisions": await enrich_decisions(decisions, tenant_id=tid),
        "tasks": await enrich_tasks(tasks),
        "workflows": workflows,
        "contacts": await enrich_contacts(contacts),
        "memory": memory,
        "invoices": invoices,
        "expenses": expenses,
        "assets": assets,
        "inventory": inventory,
        "scope": {"finance_visible": can_finance, "all_departments": privileged},
    }


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
@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    await run_followup(tid)
    now = datetime.now(timezone.utc).isoformat()
    pending_decisions = await db.decisions.find({"tenant_id": tid, "status": "pending_approval"}, {"_id": 0}).to_list(50)
    # FIX-001-A: resolve the tenant's actual procurement pipeline instead of the textile 'purchase_payment' hardcode.
    from services.workflows import tenant_procurement_pipeline, procurement_initial_stage
    _proc = await tenant_procurement_pipeline(tid)
    if _proc and procurement_initial_stage(_proc):
        pending_purchases = await db.workflows.find(
            {"tenant_id": tid, "type": _proc["key"], "stage": procurement_initial_stage(_proc)}, {"_id": 0}
        ).to_list(50)
    else:
        pending_purchases = []
    overdue = await db.tasks.find({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now, "$ne": None}}, {"_id": 0}).to_list(50)
    open_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}})
    done_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": "done"})
    # FIX-001-F: exclude the tenant's actual terminal stages, not just the
    # textile ones. A salon's 'served' or a bakery's 'settled' now correctly
    # marks a workflow as done so the counter stops climbing forever.
    from services.workflows import tenant_terminal_stages
    _term_stages = await tenant_terminal_stages(tid)
    active_wf = await db.workflows.count_documents({"tenant_id": tid, "stage": {"$nin": _term_stages}})
    activity = await db.activity.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(15)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    wins = await db.activity.find(
        {"tenant_id": tid, "kind": {"$in": ["task_done", "decision_approved", "workflow_advanced"]}, "created_at": {"$gte": today_start}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    today_date = datetime.now(timezone.utc).date().isoformat()
    on_leave = await db.leaves.find(
        {"tenant_id": tid, "status": "approved", "from_date": {"$lte": today_date}, "to_date": {"$gte": today_date}},
        {"_id": 0, "user_id": 1, "user_name": 1, "user_role": 1, "leave_type": 1, "to_date": 1, "day_portion": 1}
    ).to_list(100)
    pending_leaves = await db.leaves.count_documents({"tenant_id": tid, "status": "pending"})
    return {
        # FIX-003-B (S2-05): explicit tenant_id (defense-in-depth).
        "pending_decisions": await enrich_decisions(pending_decisions, tenant_id=tid),
        "pending_purchases": pending_purchases,
        "overdue_tasks": await enrich_tasks(overdue),
        "stats": {"open_tasks": open_tasks, "done_tasks": done_tasks, "active_workflows": active_wf,
                  "pending_approvals": len(pending_decisions) + len(pending_purchases),
                  "on_leave_today": len(on_leave), "pending_leaves": pending_leaves},
        "on_leave": on_leave,
        "activity": activity,
        "wins": wins,
    }


# ---------------------------------------------------------------------------
# Email delivery — Gmail SMTP (primary), Resend (fallback), else mock.
# Sender/host/creds all come from .env so the account can be swapped anytime.
# ---------------------------------------------------------------------------
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465") or "465")
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM") or SMTP_USER
SMTP_ENABLED = bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD)


def _smtp_send_sync(to_list: list, subject: str, html: str) -> None:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(to_list)
    msg.set_content("This message requires an HTML-capable email client.")
    msg.add_alternative(html, subtype="html")
    ctx = ssl.create_default_context()
    if SMTP_PORT == 465:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=25) as s:
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=25) as s:
            s.starttls(context=ctx)
            s.login(SMTP_USER, SMTP_PASSWORD)
            s.send_message(msg)


async def send_email(to, subject: str, html: str) -> dict:
    """Send an HTML email. Returns {sent, provider|mocked, to, [error]}."""
    to_list = [to] if isinstance(to, str) else [t for t in to if t]
    if not to_list:
        return {"sent": False, "to": [], "error": "no recipients"}
    if SMTP_ENABLED:
        try:
            await asyncio.to_thread(_smtp_send_sync, to_list, subject, html)
            return {"sent": True, "provider": "gmail_smtp", "to": to_list}
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP auth failed (need a Gmail App Password?): {e}")
            return {"sent": False, "to": to_list, "error": "smtp_auth_failed"}
        except Exception as e:
            logger.error(f"SMTP send failed: {e}")
            return {"sent": False, "to": to_list, "error": "smtp_error"}
    resend_key = os.environ.get("RESEND_API_KEY", "")
    if resend_key:
        try:
            import resend
            resend.api_key = resend_key
            resend.Emails.send({
                "from": os.environ.get("RESEND_FROM_EMAIL", "DecisionOS <onboarding@resend.dev>"),
                "to": to_list, "subject": subject, "html": html,
            })
            return {"sent": True, "provider": "resend", "to": to_list}
        except Exception as e:
            logger.error(f"Resend send failed: {e}")
            return {"sent": False, "to": to_list, "error": "resend_error"}
    logger.info(f"[EMAIL MOCK] To {to_list}: {subject}")
    return {"sent": False, "mocked": True, "to": to_list}


# E2-63 (2026-08-15): DIGEST_I18N deleted along with the send-digest
# endpoint that was its only consumer. Rationale in routers/brief.py.





# ---------------------------------------------------------------------------
# Follow-up engine, notifications, attendance, complaints, memory, CEO brief
# ---------------------------------------------------------------------------
NOTIF_LEVELS = {1: "reminder", 2: "urgency", 3: "manager", 4: "owner"}


class AttendanceInput(BaseModel):
    user_id: str
    status: str = "absent"
    date: Optional[str] = None


class ComplaintInput(BaseModel):
    customer_id: Optional[str] = None
    text: str
    severity: Optional[str] = "medium"


class MemoryInput(BaseModel):
    text: str
    tag: Optional[str] = "note"


async def _owner_ids(tenant_id: str) -> list:
    return [u["id"] for u in await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1}).to_list(50)]


async def _approver_ids(tenant_id: str) -> list:
    """Owners plus any user granted the 'approvals' access — they can approve unassigned items."""
    ids = set(await _owner_ids(tenant_id))
    async for u in db.users.find({"tenant_id": tenant_id, "permissions": "approvals"}, {"_id": 0, "id": 1}):
        ids.add(u["id"])
    return list(ids)


async def _finance_user_ids(tenant_id: str) -> list:
    """Users who should be notified about a bill needing upload: owners, plus
    anyone with the 'finance' or 'ledger' module permission. Introduced by
    FIX-001-B for the workflow→Finance handoff on procurement completion."""
    ids = set(await _owner_ids(tenant_id))
    async for u in db.users.find(
        {"tenant_id": tenant_id, "permissions": {"$in": ["finance", "ledger"]}},
        {"_id": 0, "id": 1},
    ):
        ids.add(u["id"])
    return list(ids)


async def push_notification(tenant_id, user_ids, level, message, entity_type=None, entity_id=None,
                            ntype=None, title=None, sender=None):
    for uid in set(u for u in user_ids if u):
        await db.notifications.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "user_id": uid, "level": NOTIF_LEVELS.get(level, "reminder"),
            "message": message, "entity_type": entity_type, "entity_id": entity_id,
            "type": ntype or "reminder", "work_title": title, "sender_name": sender,
            "read": False, "created_at": now_iso(),
        })


async def dispatch_owner_alert(tenant_id, message):
    owners = await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "email": 1}).to_list(10)
    emails = [o["email"] for o in owners if o.get("email")]
    if emails:
        await send_email(emails, "DecisionOS — Owner Alert", f"<p>{message}</p>")
    # WhatsApp: ready-to-plug (requires WHATSAPP_API_KEY / provider)
    if not os.environ.get("WHATSAPP_API_KEY", ""):
        logger.info(f"[WHATSAPP MOCK] Owner alert: {message}")


_followup_last_run: dict = {}


async def run_followup(tenant_id: str):
    now = datetime.now(timezone.utc)
    # Throttle: this scan runs on every notifications poll — cap it to once per 60s per tenant.
    last = _followup_last_run.get(tenant_id)
    if last and (now - last).total_seconds() < 60:
        return
    _followup_last_run[tenant_id] = now
    # RBAC-27 (2026-08-15): sweep expired temp perms so contractor
    # grants auto-revoke without a separate cron. Cheap query -- only
    # touches memberships that HAVE a temp_grants entry past expiry.
    try:
        from routers.access import sweep_expired_temp_grants
        revoked = await sweep_expired_temp_grants(tenant_id)
        if revoked:
            logger.info(f"[rbac-27] auto-revoked {revoked} expired temp grant(s) in tenant {tenant_id[:8]}...")
    except Exception as e:
        logger.warning(f"[rbac-27] temp-grant sweep failed: {e}")
    tasks = await db.tasks.find(
        {"tenant_id": tenant_id, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$ne": None, "$lt": now.isoformat()}},
        {"_id": 0}
    ).to_list(500)
    owners = await _owner_ids(tenant_id)
    for t in tasks:
        try:
            due = datetime.fromisoformat(t["due_date"])
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        days = (now - due).days
        target = 1 if days < 1 else 2 if days < 2 else 3 if days < 3 else 4
        if target <= t.get("escalation_level", 0):
            continue
        if t.get("assignee_id"):
            recipients = [t["assignee_id"]]
        elif t.get("assignee_role"):
            recipients = [u["id"] for u in await db.users.find({"tenant_id": tenant_id, "role": t["assignee_role"]}, {"_id": 0, "id": 1}).to_list(50)]
        else:
            recipients = owners
        msg = f"Task '{t['title']}' is overdue by {days} day(s)."
        if target in (1, 2):
            await push_notification(tenant_id, recipients, target, msg, "task", t["id"])
        elif target == 3:
            await push_notification(tenant_id, owners, 3, f"[Manager escalation] {msg}", "task", t["id"])
        else:
            await push_notification(tenant_id, owners, 4, f"[OWNER ALERT] {msg}", "task", t["id"])
            await dispatch_owner_alert(tenant_id, msg)
        await db.tasks.update_one({"id": t["id"]}, {"$set": {"escalation_level": target, "last_escalated": now_iso()}})
    try:
        await run_finance_actions(tenant_id)
    except Exception as e:
        logger.warning(f"[finance-actions] tenant {tenant_id} failed: {e}")


# --- Finance → operations signals (A: money becomes tasks, C: money in the CEO brief) ------
FINANCE_CHASE_DAYS = int(os.environ.get("FINANCE_CHASE_DAYS", "7"))          # chase a receivable once 7+ days overdue
FINANCE_BILL_DUE_SOON_DAYS = int(os.environ.get("FINANCE_BILL_DUE_SOON_DAYS", "3"))  # act on a bill due within 3 days or overdue
_CUR_SYM = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED ", "AUD": "A$", "CAD": "C$"}


def _inv_remaining(inv: dict) -> float:
    return round(float(inv.get("amount") or 0) - float(inv.get("amount_paid") or 0), 2)


def _pay_remaining_amt(p: dict) -> float:
    return round(float(p.get("amount") or 0) - float(p.get("applied") or 0), 2)


def _fmt_amt(a, cur="INR") -> str:
    sym = _CUR_SYM.get(str(cur or "INR").upper(), "")
    return f"{sym}{float(a or 0):,.0f}"


async def _overdue_receivables(tenant_id: str) -> list:
    """Sales invoices unpaid and overdue by at least FINANCE_CHASE_DAYS days."""
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=FINANCE_CHASE_DAYS)).strftime("%Y-%m-%d")
    rows = await db.invoices.find(
        {"tenant_id": tenant_id, "type": "sales_invoice", "status": {"$ne": "paid"}}, {"_id": 0}).to_list(3000)
    out = []
    for r in rows:
        if _inv_remaining(r) <= 0.01:
            continue
        due = str(r.get("due_date") or "")[:10]
        if due and due <= cutoff:
            out.append(r)
    return out


async def _bills_due_or_overdue(tenant_id: str) -> list:
    """Purchase bills unpaid and due within FINANCE_BILL_DUE_SOON_DAYS days (or already overdue)."""
    now = datetime.now(timezone.utc)
    soon = (now + timedelta(days=FINANCE_BILL_DUE_SOON_DAYS)).strftime("%Y-%m-%d")
    rows = await db.invoices.find(
        {"tenant_id": tenant_id, "type": "purchase_bill", "status": {"$ne": "paid"}}, {"_id": 0}).to_list(3000)
    out = []
    for r in rows:
        if _inv_remaining(r) <= 0.01:
            continue
        due = str(r.get("due_date") or "")[:10]
        if due and due <= soon:
            out.append(r)
    return out


async def _unmatched_payments(tenant_id: str) -> list:
    """Payments that couldn't be auto-linked to an invoice/bill and still have an unallocated balance."""
    rows = await db.payments.find(
        {"tenant_id": tenant_id, "match_status": {"$in": ["unmatched", "partial"]}}, {"_id": 0}).to_list(3000)
    return [p for p in rows if _pay_remaining_amt(p) > 0.01 and p.get("match_status") != "standalone"]


async def _finance_assignee(tenant_id: str):
    """Route finance action tasks to the Finance/Accounts department; if none exists, to the owner."""
    troles = await tenant_role_keys(tenant_id)
    fin_role = await _finance_role_key(tenant_id, troles)
    if fin_role:
        return await pick_least_loaded_member(tenant_id, fin_role), fin_role
    owners = await _owner_ids(tenant_id)
    return (owners[0] if owners else None), "owner"


async def run_finance_actions(tenant_id: str):
    """A: turn overdue receivables + due/overdue supplier bills into accountable, idempotent tasks."""
    assignee_id, assignee_role = await _finance_assignee(tenant_id)
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")

    async def _spawn(inv, title, desc, priority, due):
        tid = new_id()
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id, "title": title, "description": desc,
            "assignee_role": assignee_role, "assignee_id": assignee_id, "priority": priority,
            "status": "todo", "due_date": due, "decision_id": None,
            "source": "finance", "task_type": "finance", "op_category": None,
            "finance_ref": {"invoice_id": inv["id"], "invoice_type": inv.get("type")},
            "progress": 0, "created_by": "system", "created_at": now_iso(),
            "updated_at": now_iso(), "last_action": "Auto-created from Finance",
        })
        await db.invoices.update_one({"id": inv["id"], "tenant_id": tenant_id},
                                     {"$set": {"action_task_id": tid}})
        if assignee_id:
            await push_notification(tenant_id, [assignee_id], 2, title, "task", tid,
                                    ntype="assigned", title=title, sender="Finance")

    # A1: chase overdue customer invoices (7+ days overdue)
    for inv in await _overdue_receivables(tenant_id):
        if inv.get("action_task_id"):
            continue
        cust = (inv.get("contact_name") or "the customer").strip()
        num = str(inv.get("number") or "").strip()
        rem = _inv_remaining(inv)
        amt = _fmt_amt(rem, inv.get("currency"))
        due = str(inv.get("due_date") or "")[:10]
        title = f"Chase {cust} for {amt}" + (f" (Invoice {num})" if num else "")
        desc = (f"Invoice {num or '(no number)'} for {amt} to {cust} is overdue"
                + (f" since {due}" if due else "") + ". Follow up and collect payment.")
        await _spawn(inv, title, desc, "high", now_iso())

    # A2: approve & pay supplier bills due within 3 days or overdue
    for inv in await _bills_due_or_overdue(tenant_id):
        if inv.get("action_task_id"):
            continue
        vend = (inv.get("contact_name") or "the supplier").strip()
        num = str(inv.get("number") or "").strip()
        rem = _inv_remaining(inv)
        amt = _fmt_amt(rem, inv.get("currency"))
        due = str(inv.get("due_date") or "")[:10]
        overdue = bool(due and due < today)
        title = f"Approve & pay {vend} {amt}" + (f" by {due}" if due else "")
        desc = (f"Supplier bill {num or '(no number)'} for {amt} from {vend} is "
                + ("overdue" if overdue else f"due by {due}") + ". Approve and schedule payment.")
        await _spawn(inv, title, desc, "high" if overdue else "medium", due and f"{due}T09:00:00" or now_iso())



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




@api.post("/follow-up/run")
async def followup_run(user: dict = Depends(require_perm("team_manage"))):
    # FIX-004-C (RBAC-06): manual follow-up sweep runs the full tenant-
    # wide overdue-task chase (LLM cost + notification spam potential).
    # Restrict to team_manage (owner + designated team admins). Was
    # auth-only which meant any employee could trigger it on-demand.
    await run_followup(user["tenant_id"])
    return {"ok": True}




@api.post("/complaints")
async def create_complaint(inp: ComplaintInput, user: dict = Depends(require_role("owner", "sales"))):
    name = None
    if inp.customer_id:
        c = await db.contacts.find_one({"id": inp.customer_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "name": 1, "company": 1})
        if c:
            name = c.get("company") or c.get("name")
    cid = new_id()
    doc = {"id": cid, "tenant_id": user["tenant_id"], "customer_id": inp.customer_id, "customer_name": name,
           "text": inp.text, "severity": inp.severity or "medium", "status": "open",
           "created_by": user["id"], "created_at": now_iso()}
    await db.complaints.insert_one(doc)
    await add_inbox_item(user["tenant_id"], user["id"], "manual", "complaint",
                         f"Complaint: {(name or 'customer')}", inp.text[:180],
                         "complaint", cid, contact_id=inp.customer_id, status="open")
    await log_activity(user["tenant_id"], user["id"], "complaint_logged", f"Complaint logged: {inp.text[:60]}", "complaint", cid)
    doc.pop("_id", None)
    return doc


@api.get("/complaints")
async def list_complaints(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    return await db.complaints.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.patch("/complaints/{cid}/resolve")
async def resolve_complaint(cid: str, user: dict = Depends(require_role("owner", "sales"))):
    c = await db.complaints.find_one({"id": cid, "tenant_id": user["tenant_id"]}, {"_id": 0})
    res = await db.complaints.update_one({"id": cid, "tenant_id": user["tenant_id"]}, {"$set": {"status": "resolved", "resolved_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    if c:
        await brain_context.record_context(
            tenant_id=user["tenant_id"], kind="resolution",
            title=f"Resolved complaint: {(c.get('text') or '')[:120]}",
            outcome="resolved", why=c.get("text") or "",
            tags=["complaint"], source_type="complaint", source_id=cid,
            actor_id=user["id"], actor_name=user.get("name") or "",
            department=user.get("role") or "", visibility="public",
        )
    return {"ok": True}


@api.get("/memory")
async def list_memory(user: dict = Depends(get_current_user)):
    return await db.memory.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/memory")
async def add_memory(inp: MemoryInput, user: dict = Depends(require_perm("brain"))):
    # FIX-004-C (RBAC-11): writing to shared tenant memory (persistent
    # facts the AI later cites) is a brain-permission action, not a
    # read anyone can do. Read of memory stays open via /memory GET
    # (no perm), only WRITE is gated.
    mid = new_id()
    doc = {"id": mid, "tenant_id": user["tenant_id"], "text": inp.text, "tag": inp.tag or "note",
           "created_by": user["id"], "created_at": now_iso()}
    await db.memory.insert_one(doc)
    doc.pop("_id", None)
    return doc






ATTACH_ALLOWED_EXT = {"jpg", "jpeg", "png", "gif", "webp", "heic", "pdf", "doc", "docx", "xls", "xlsx", "csv", "txt"}
ATTACH_MAX_BYTES = 25 * 1024 * 1024  # 25 MB


async def _store_file(tenant_id, user_id, upload, kind, task_id=None):
    """Persist an uploaded file to Object Storage + a `files` DB record. Returns the record."""
    ext = (upload.filename or "file.bin").rsplit(".", 1)[-1].lower() if "." in (upload.filename or "") else "bin"
    if ext not in ATTACH_ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"Unsupported file type .{ext}")
    data = await upload.read()
    if len(data) > ATTACH_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    fid = new_id()
    path = f"{obj_store.APP_NAME}/{tenant_id}/{fid}.{ext}"
    content_type = upload.content_type or obj_store.guess_mime(upload.filename)
    result = await obj_store.put_object(path, data, content_type)
    rec = {
        "id": fid, "tenant_id": tenant_id, "storage_path": result.get("path", path),
        "original_filename": upload.filename or f"{fid}.{ext}", "content_type": content_type,
        "size": result.get("size", len(data)), "kind": kind, "task_id": task_id,
        "uploaded_by": user_id, "is_deleted": False, "created_at": now_iso(),
    }
    await db.files.insert_one(dict(rec))
    rec.pop("_id", None)
    return rec


def _file_public(rec):
    return {"id": rec["id"], "kind": rec.get("kind"), "filename": rec.get("original_filename"),
            "content_type": rec.get("content_type"), "size": rec.get("size"),
            "url": f"/api/files/{rec['id']}/download", "at": rec.get("created_at"), "by": rec.get("uploaded_by")}


@api.post("/files")
async def upload_file(file: UploadFile = File(...), kind: str = Form("reference"),
                      user: dict = Depends(get_current_user)):
    """Generic upload (used to stage reference files before/at task creation)."""
    rec = await _store_file(user["tenant_id"], user["id"], file, kind if kind in ("reference", "evidence") else "reference")
    return _file_public(rec)


@api.get("/files/{file_id}/download")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    from fastapi.responses import Response
    rec = await db.files.find_one({"id": file_id, "tenant_id": user["tenant_id"], "is_deleted": False}, {"_id": 0})
    if not rec:
        # legacy local-disk fallback (older attachments stored a bare filename)
        raise HTTPException(status_code=404, detail="Not found")
    data, ctype = await obj_store.get_object(rec["storage_path"])
    fname = rec.get("original_filename", file_id)
    return Response(content=data, media_type=rec.get("content_type", ctype),
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


# Task attachment endpoint moved to routers/tasks.py in Phase B step 5.
# _attach_reference_ids helper moved to services/tasks.py (re-exported below).


async def _analyze_reference_file(tenant_id, task_id, rec):
    """AI-analyse an attached reference (image/PDF) and enrich the task with context."""
    try:
        ctype = rec.get("content_type", "")
        if not (ctype.startswith("image/") or ctype == "application/pdf"):
            return  # Phase 1: analyse images & PDFs only
        data, _ = await obj_store.get_object(rec["storage_path"])
        import tempfile, os as _os
        ext = rec.get("original_filename", "f.bin").rsplit(".", 1)[-1]
        tmp = _os.path.join(tempfile.gettempdir(), f"ref_{rec['id']}.{ext}")
        with open(tmp, "wb") as f:
            f.write(data)
        raw = await ai_read_image_general(tmp, ctype, session_id=f"ref-{task_id}")
        try:
            _os.remove(tmp)
        except OSError:
            pass
        text = (raw if isinstance(raw, str) else str(raw))[:4000]
        if not text.strip():
            return
        task = await db.tasks.find_one({"id": task_id}, {"_id": 0, "title": 1, "description": 1})
        if not task:
            return
        system = ("You help a team understand a reference file attached to a task. In 1-2 sentences, "
                  "explain what the file contains and how it informs the task. Then list up to 3 concrete "
                  'action points. Return JSON: {"summary": "...", "points": ["..."]}')
        prompt = f"TASK: {task.get('title')}\n\nREFERENCE FILE CONTENT:\n{text}"
        chat = claude_chat(session_id=f"ref-insight-{task_id}", system_message=system,
                           tenant_id=tenant_id).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=prompt))
        parsed = _extract_json(resp) or {}
        summary = (parsed.get("summary") or "").strip()
        points = [p for p in (parsed.get("points") or []) if p][:3]
        if not summary:
            return
        note = {"file_id": rec["id"], "filename": rec.get("original_filename"),
                "summary": summary, "points": points, "at": now_iso()}
        await db.tasks.update_one({"id": task_id}, {"$push": {"reference_insights": note},
                                  "$set": {"updated_at": now_iso()}})
        logger.info(f"[reference-ai] enriched task {task_id} from {rec.get('original_filename')}")
    except Exception as e:
        logger.warning(f"[reference-ai] analysis failed for task {task_id}: {e}")


async def _read_reference_text(rec: dict, tenant_id: str = "") -> str:
    """Read an attached reference file into plain text so the AI can factor it into a directive.
    Images/PDFs -> Gemini OCR summary; Excel/CSV -> parsed rows; Word/txt -> extracted text."""
    try:
        ctype = (rec.get("content_type") or "").lower()
        fname = rec.get("original_filename", "file")
        data, _ = await obj_store.get_object(rec["storage_path"])
    except Exception as e:
        logger.warning(f"[capture-ref] could not fetch {rec.get('id')}: {e}")
        return ""
    try:
        # Images & PDFs -> general vision reader (business cards, lists, notes, invoices — anything).
        if ctype.startswith("image/") or ctype == "application/pdf":
            import tempfile, os as _os
            ext = fname.rsplit(".", 1)[-1] if "." in fname else "bin"
            tmp = _os.path.join(tempfile.gettempdir(), f"capref_{rec['id']}.{ext}")
            with open(tmp, "wb") as f:
                f.write(data)
            try:
                text = await ai_read_image_general(tmp, ctype, session_id=f"capref-{tenant_id}")
            finally:
                try: _os.remove(tmp)
                except OSError: pass
            return f"[{fname}]\n" + (text or "")
        # Excel / CSV -> parse to a compact text table.
        if ctype in ("text/csv",) or fname.lower().endswith(".csv"):
            import pandas as pd, io as _io
            df = pd.read_csv(_io.BytesIO(data), nrows=200)
            return f"[{fname}]\n" + df.to_csv(index=False)[:6000]
        if fname.lower().endswith((".xlsx", ".xls")) or "spreadsheet" in ctype or "excel" in ctype:
            import pandas as pd, io as _io
            df = pd.read_excel(_io.BytesIO(data), nrows=200)
            return f"[{fname}]\n" + df.to_csv(index=False)[:6000]
        # Word.
        if fname.lower().endswith(".docx") or "wordprocessingml" in ctype:
            import docx, io as _io
            doc = docx.Document(_io.BytesIO(data))
            text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
            return f"[{fname}]\n" + text[:6000]
        # Plain text.
        if ctype.startswith("text/") or fname.lower().endswith(".txt"):
            return f"[{fname}]\n" + data.decode("utf-8", errors="ignore")[:6000]
    except Exception as e:
        logger.warning(f"[capture-ref] read failed for {fname}: {e}")
    return ""



@api.get("/files/{fname}")
async def get_file(fname: str, user: dict = Depends(get_current_user)):
    """FIX-002-E + FIX-001-E EC8: this endpoint used to serve ANY file
    from local disk by bare filename, unauthenticated. Now it:
      1. Requires auth (get_current_user).
      2. Looks up the file's storage_path in db.files, db.ingestions,
         db.expenses.attachment, db.assets.attachment, or db.capture_drafts
         — all tenant-scoped.
      3. Serves from obj_store.
    Local-disk legacy fallback stays until migrate_local_disk_uploads_
    to_obj_store_v1 has rewritten every reference (post-migration all
    paths resolve to obj_store keys).
    """
    if "/" in fname or ".." in fname or fname.startswith("."):
        raise HTTPException(status_code=404, detail="Not found")
    tid = user["tenant_id"]
    from fastapi.responses import Response, FileResponse
    from services.uploads import read_upload, is_legacy_path

    # 1) Try db.files (task attachments, generic uploads).
    rec = await db.files.find_one(
        {"tenant_id": tid, "$or": [
            {"storage_path": {"$regex": re.escape(fname) + "$"}},
            {"original_filename": fname},
        ], "is_deleted": {"$ne": True}},
        {"_id": 0, "storage_path": 1, "content_type": 1, "original_filename": 1},
    )
    storage_path = (rec or {}).get("storage_path")
    content_type = (rec or {}).get("content_type")

    # 2) Try ingestions (WhatsApp / upload doc captures).
    if not storage_path:
        ing = await db.ingestions.find_one(
            {"tenant_id": tid, "$or": [
                {"filename": fname}, {"file_url": f"/api/files/{fname}"},
            ]},
            {"_id": 0, "storage_path": 1, "kind": 1},
        )
        if ing:
            storage_path = ing.get("storage_path") or fname  # legacy fallback
            content_type = None

    # 3) Try ledger attachments (expenses/assets/inventory).
    if not storage_path:
        for coll in ("expenses", "assets", "inventory"):
            row = await db[coll].find_one(
                {"tenant_id": tid, "$or": [
                    {"attachment.filename": fname},
                    {"attachment.url": f"/api/files/{fname}"},
                ]},
                {"_id": 0, "attachment": 1},
            )
            if row and (row.get("attachment") or {}).get("storage_path"):
                storage_path = row["attachment"]["storage_path"]
                content_type = row["attachment"].get("mime")
                break

    # 4) Try capture_drafts (WA-review UI previews).
    if not storage_path:
        cd = await db.capture_drafts.find_one(
            {"tenant_id": tid, "file_url": f"/api/files/{fname}"},
            {"_id": 0, "storage_path": 1, "file_url": 1},
        )
        if cd:
            storage_path = cd.get("storage_path") or fname

    # 5) Legacy fallback: serve from local disk if the file exists.
    #    FIX-006-C (S0-03): the old code returned any authenticated
    #    caller's request for a bare filename — but nothing here checks
    #    that the file actually belongs to the caller's tenant. Post-
    #    FIX-002-E migration this branch is dead code (obj_store owns
    #    every real upload). Default is now 404 for everything; ops can
    #    opt in via SERVE_LEGACY_LOCAL_DISK=1 in dev only when
    #    investigating a stale-file complaint. We LOG the hit so a
    #    lingering legacy reference shows up in observability.
    if not storage_path:
        from config import SERVE_LEGACY_LOCAL_DISK
        legacy_path = UPLOAD_DIR / fname
        if legacy_path.exists() and SERVE_LEGACY_LOCAL_DISK:
            logger.warning(
                "S0-03 legacy-disk-fallback: served %s to tenant=%s (opt-in). "
                "This path has no tenant-ownership check — turn "
                "SERVE_LEGACY_LOCAL_DISK off in prod.",
                fname, tid,
            )
            return FileResponse(str(legacy_path))
        if legacy_path.exists():
            logger.warning(
                "S0-03 legacy-disk hit denied for %s (tenant=%s). "
                "File exists on local disk but no DB record ties it to "
                "this tenant. Run the local-disk → obj_store migration.",
                fname, tid,
            )
        raise HTTPException(status_code=404, detail="Not found")

    try:
        data, ctype = await read_upload(storage_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=data, media_type=content_type or ctype or "application/octet-stream")


@api.get("/brochure")
async def download_brochure():
    from fastapi.responses import FileResponse
    path = UPLOAD_DIR / "DecisionOS-Investor-Brochure.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename="DecisionOS-Investor-Brochure.pdf",
        headers={"Content-Disposition": 'attachment; filename="DecisionOS-Investor-Brochure.pdf"'},
    )


# ---------------------------------------------------------------------------
# Data ingestion: PDF/Image OCR + CSV/Excel import (WhatsApp-ready pipeline)
# ---------------------------------------------------------------------------
INGEST_ROLES = ("owner", "sales", "finance")

_DOC_SYSTEM = (
    "You are the document ingestion engine of DecisionOS, an operating brain for small businesses. "
    "Read the attached business document (a sales invoice, purchase bill, payment receipt, purchase order, "
    "or a photo/WhatsApp screenshot of one) and extract structured operational data. Return ONLY valid JSON, no prose. "
    "Schema: {"
    "\"summary\": string (one short line describing the document), "
    "\"doc_type\": one of [sales_invoice, purchase_bill, payment, purchase_order, other], "
    "\"confidence\": number between 0 and 1, "
    "\"contacts\": [{\"type\": one of [customer, vendor], \"name\": string, \"company\": string, \"phone\": string, \"email\": string, \"address\": string, \"tax_id\": string}], "
    "\"invoices\": [{\"type\": one of [sales_invoice, purchase_bill], \"purchase_type\": one of [expense, asset, inventory, unknown] (only for purchase_bill; else empty), \"asset_name\": string (for asset purchases), \"inventory_qty\": number, \"inventory_unit\": string, \"number\": string, \"contact_name\": string, \"date\": string, \"due_date\": string, \"amount\": number, \"currency\": string, \"line_items\": [{\"description\": string, \"qty\": number, \"rate\": number, \"amount\": number}]}], "
    "\"payments\": [{\"direction\": one of [in, out], \"amount\": number, \"date\": string, \"method\": string, \"reference\": string, \"contact_name\": string, \"invoice_number\": string}], "
    "\"tasks\": [{\"title\": string, \"priority\": one of [low,medium,high], \"due_in_days\": integer or null}]}. "
    "Rules: Our own company (the DecisionOS user filing this) is \"{company}\". "
    "NEVER create a contact for our own company — only ever extract the OTHER party (the counterparty). "
    "Decide direction by WHO ISSUED the document: if our company is the seller/issuer (the 'from'/'billed by' party), it is a sales_invoice and the counterparty is the buyer (type=customer); "
    "if our company is the buyer/recipient (the 'bill to'/'ship to' party), it is a purchase_bill and the counterparty is the issuer/seller (type=vendor). "
    "The contact_name on every invoice and payment MUST be the counterparty, never our own company. "
    "A sales invoice is money owed TO us by a customer (party type=customer). "
    "A purchase bill is money we owe a vendor/supplier (party type=vendor). "
    "For each purchase_bill, ALSO set purchase_type by WHAT was bought: "
    "\"asset\" for capital/fixed goods that last over a year (machinery, equipment, tools, vehicles, furniture, computers/IT hardware, buildings) — put the item in asset_name; "
    "\"inventory\" for stock, raw materials, trading goods or components bought to resell or consume in production — put quantity in inventory_qty and its unit (kg, pcs, box, litre) in inventory_unit; "
    "\"expense\" for everything else (rent, salaries, utilities, transport, services, consumables, subscriptions, taxes). When unsure, use \"expense\". "
    "sales_invoice must have purchase_type empty. "
    "For every unpaid invoice or bill, add ONE follow-up task (e.g. 'Collect payment for invoice #123 from Acme' or 'Pay vendor bill #45 to XYZ'). "
    "A payment 'in' reduces a customer receivable; 'out' settles a vendor bill. "
    "Dates as YYYY-MM-DD when readable else empty string. Amounts are plain numbers without currency symbols. "
    "Default currency to {currency}. Documents may be in English, Tamil or Tanglish — understand them and output all values in English. "
    "Use empty arrays where nothing applies."
)

_CSV_SYSTEM = (
    "You classify and map spreadsheet data for DecisionOS. Given the column headers and rows of a business spreadsheet, "
    "decide which entity it represents and map EVERY row to structured records. Return ONLY valid JSON, no prose. "
    "Schema: {\"entity\": one of [customers, vendors, invoices, payments], \"summary\": string, "
    "\"contacts\": [{\"type\": one of [customer, vendor], \"name\": string, \"company\": string, \"phone\": string, \"email\": string, \"address\": string, \"tax_id\": string}], "
    "\"invoices\": [{\"type\": one of [sales_invoice, purchase_bill], \"number\": string, \"contact_name\": string, \"date\": string, \"due_date\": string, \"amount\": number, \"currency\": string}], "
    "\"payments\": [{\"direction\": one of [in, out], \"amount\": number, \"date\": string, \"method\": string, \"reference\": string, \"contact_name\": string, \"invoice_number\": string}], "
    "\"tasks\": [{\"title\": string, \"priority\": one of [low,medium,high], \"due_in_days\": integer or null}]}. "
    "If the file is a customer/vendor list, fill 'contacts'. If it lists invoices/bills, fill 'invoices' (and add a follow-up task per unpaid row). "
    "Our own company is \"{company}\" — NEVER map our own company as a contact; only extract the other parties. "
    "If it lists payments/receipts, fill 'payments'. Map each spreadsheet row to exactly one record. Amounts are plain numbers. "
    "Default currency to {currency}. Use empty arrays for the entities that do not apply."
)


def _normalise_records(data: dict) -> dict:
    out = {}
    for k in ("contacts", "invoices", "payments", "tasks"):
        out[k] = data.get(k) if isinstance(data.get(k), list) else []
    return out


async def ai_extract_document(file_path: str, mime_type: str, session_id: str, currency: str = "INR", company: str = "") -> dict:
    system = _DOC_SYSTEM.replace("{currency}", currency).replace("{company}", company or "our company")
    user_text = "Extract the structured JSON from this document now."
    resp = None
    # Prefer the user's own Gemini key via the official google-genai SDK.
    if get_gemini_client() is not None:
        try:
            resp, _gti, _gto = await asyncio.to_thread(_gemini_doc_sync, file_path, mime_type, system, user_text)
            await log_usage((session_id or "ocr").split("-")[0], "gemini", model=VISION_MODEL[1],
                            tokens_in=_gti, tokens_out=_gto, units=1, unit_type="document")
        except Exception as e:
            logger.warning(f"Gemini OCR (user key) failed; falling back to Emergent key: {e}")
            resp = None
    # Fallback: Gemini via the Emergent universal key (keeps document capture working).
    if not resp:
        fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id,
                       system_message=system).with_model(*VISION_MODEL)
        # FIX-002-B: guard.
        from services.llm_limits import guarded_llm
        resp = await guarded_llm(chat.send_message(UserMessage(text=user_text, file_contents=[fc])),
                                  label="gemini:ocr-fallback")
        await log_usage((session_id or "ocr").split("-")[0], "gemini", model=VISION_MODEL[1],
                        tokens_in=_est_tokens(system + user_text), tokens_out=_est_tokens(resp or ""),
                        units=1, unit_type="document")
    data = _extract_json(resp)
    return {
        "summary": data.get("summary", ""),
        "doc_type": data.get("doc_type", "other"),
        "confidence": data.get("confidence", 0.7),
        "records": _normalise_records(data),
    }


async def ai_map_spreadsheet(headers: list, rows: list, session_id: str, currency: str = "INR", company: str = "") -> dict:
    payload = {"headers": headers, "rows": rows[:300]}
    system = _CSV_SYSTEM.replace("{currency}", currency).replace("{company}", company or "our company")
    chat = claude_chat(session_id=session_id,
                   system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=f"Spreadsheet data:\n{json.dumps(payload)}\n\nClassify and map to JSON now."))
    data = _extract_json(resp)
    return {
        "summary": data.get("summary", ""),
        "entity": data.get("entity", ""),
        "records": _normalise_records(data),
    }


async def _tenant_currency(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "currency": 1})
    return (t or {}).get("currency", "INR")


async def _tenant_name(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "name": 1})
    return (t or {}).get("name", "") or ""


_CO_SUFFIXES = ("private limited", "pvt ltd", "pvt. ltd.", "pvt", "private ltd", "limited",
                "ltd", "llp", "inc", "incorporated", "corporation", "corp", "co", "company",
                "technologies", "enterprises", "industries", "and sons", "traders")


def _norm_company(s: str) -> str:
    s = re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())
    tokens = [t for t in s.split() if t]
    while tokens and " ".join(tokens[-1:]) in _CO_SUFFIXES:
        tokens.pop()
    # also drop 2-word suffixes like "private limited"
    joined = " ".join(tokens)
    for suf in _CO_SUFFIXES:
        if joined.endswith(" " + suf):
            joined = joined[: -(len(suf) + 1)]
    return joined.strip()


def _purchase_class_sys(expense_cats=None, asset_cats=None) -> str:
    asset_list = ", ".join(asset_cats) if asset_cats else "Machinery, Equipment, Vehicle, Furniture, IT & Electronics, Building, Other"
    expense_list = ", ".join(expense_cats) if expense_cats else "Raw Material, Salary & Wages, Rent, Utilities, Logistics & Freight, Marketing, Professional Services, Asset Purchase, Maintenance & Repairs, Taxes & Duties, Office Supplies, Other"
    return (
        "You classify a single business PURCHASE (a bill we received from a supplier) into exactly one bucket. "
        "Return ONLY JSON: {\"purchase_type\": one of [expense, asset, inventory, unknown], "
        "\"asset_name\": string, \"inventory_qty\": number, \"inventory_unit\": string, "
        f"\"asset_category\": one of [{asset_list}], "
        f"\"expense_category\": one of [{expense_list}]}}. "
        "Rules: \"asset\" = capital/fixed goods that last over a year (machinery, equipment, tools, vehicles, "
        "furniture, computers/IT hardware/networking, buildings) — put the item in asset_name and pick the best asset_category "
        "from the allowed list (e.g. servers/switches/firewalls/CCTV/computers → an IT/electronics category); "
        "\"inventory\" = stock, raw materials, trading goods or components bought to resell or consume in production "
        "— put quantity in inventory_qty and its unit (kg, pcs, box, litre) in inventory_unit; "
        "\"expense\" = everything else (rent, salaries, utilities, transport, services, consumables, subscriptions, taxes) "
        "— pick the best expense_category from the allowed list. Categories MUST be chosen from the lists above. "
        "Use \"unknown\" ONLY when the description is too vague to tell which of the three it is — do NOT guess."
    )


async def ai_classify_purchase(text: str, expense_categories=None, asset_categories=None) -> dict:
    """Classify one purchase bill's WHAT-was-bought bucket from its text, using the company's own
    category lists when provided. Returns
    {purchase_type, asset_name, inventory_qty, inventory_unit, asset_category, expense_category}. Never raises."""
    text = (text or "").strip()
    if not text:
        return {"purchase_type": "unknown"}
    try:
        chat = claude_chat(session_id=f"purchase-class-{new_id()}",
                           system_message=_purchase_class_sys(expense_categories, asset_categories)).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=text[:1500]))
        d = _extract_json(resp) or {}
    except Exception as e:  # noqa: BLE001
        logger.warning(f"ai_classify_purchase failed: {e}")
        d = {}
    pt = (d.get("purchase_type") or "").strip().lower()
    if pt not in ("expense", "asset", "inventory", "unknown"):
        pt = "unknown"
    return {"purchase_type": pt, "asset_name": (d.get("asset_name") or "").strip(),
            "inventory_qty": d.get("inventory_qty"), "inventory_unit": (d.get("inventory_unit") or "").strip(),
            "asset_category": (d.get("asset_category") or "").strip(),
            "expense_category": (d.get("expense_category") or "").strip()}


def _has_unclassified_purchase(records: dict, doc_type: str = "") -> bool:
    """True if any purchase bill in the records lacks a confident expense/asset/inventory bucket."""
    for inv in (records or {}).get("invoices", []):
        itype = inv.get("type") or ("purchase_bill" if doc_type == "purchase_bill" else "")
        if itype == "purchase_bill":
            pt = (inv.get("purchase_type") or "").strip().lower()
            if pt not in ("expense", "asset", "inventory"):
                return True
    return False


async def commit_ingestion_records(tenant_id: str, user_id: str, records: dict, ingestion_id: str, source: str) -> dict:
    from routers.ledger import create_expense, create_asset, create_inventory, guess_asset_category
    # Validate BEFORE writing anything — an unclassified purchase must be classified first,
    # otherwise we'd leave orphaned contacts committed before the 400 fires.
    if _has_unclassified_purchase(records):
        raise HTTPException(
            status_code=400,
            detail="Please classify each purchase bill as Expense, Asset, or Inventory before filing.")
    created = {"contacts": 0, "invoices": 0, "payments": 0, "tasks": 0, "expenses": 0, "assets": 0, "inventory": 0}
    currency = await _tenant_currency(tenant_id)
    own_norm = _norm_company(await _tenant_name(tenant_id))
    troles = await tenant_role_keys(tenant_id)
    followup_role = "finance" if "finance" in troles else ("sales" if "sales" in troles else None)
    name_to_id = {}

    def _is_own(name: str) -> bool:
        n = _norm_company(name)
        return bool(own_norm) and bool(n) and (n == own_norm or n in own_norm or own_norm in n)

    async def resolve_contact(name: str, ctype: str = "customer"):
        name = (name or "").strip()
        if not name or _is_own(name):
            return None
        key = name.lower()
        if key in name_to_id:
            return name_to_id[key]
        existing = await db.contacts.find_one(
            {"tenant_id": tenant_id, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}},
            {"_id": 0, "id": 1})
        if existing:
            name_to_id[key] = existing["id"]
            return existing["id"]
        cid = new_id()
        ctype = ctype if ctype in CONTACT_TYPES else ("vendor" if ctype in ("vendor", "supplier") else "customer")
        await db.contacts.insert_one({
            "id": cid, "tenant_id": tenant_id, "type": ctype, "name": name,
            "company": "", "phone": "", "email": "", "address": "", "tax_id": "",
            "tags": ["imported"], "status": "active", "assigned_id": None, "notes": "",
            "created_by": user_id, "created_at": now_iso(), "source": source, "ingestion_id": ingestion_id,
        })
        name_to_id[key] = cid
        created["contacts"] += 1
        return cid

    for c in records.get("contacts", []):
        name = (c.get("name") or "").strip()
        if not name or _is_own(name):
            continue
        ctype = c.get("type") if c.get("type") in CONTACT_TYPES else ("vendor" if c.get("type") == "supplier" else "customer")
        key = name.lower()
        existing = await db.contacts.find_one(
            {"tenant_id": tenant_id, "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}, {"_id": 0, "id": 1})
        if existing:
            name_to_id[key] = existing["id"]
            continue
        cid = new_id()
        await db.contacts.insert_one({
            "id": cid, "tenant_id": tenant_id, "type": ctype, "name": name,
            "company": c.get("company", "") or "", "phone": c.get("phone", "") or "",
            "email": c.get("email", "") or "", "address": c.get("address", "") or "",
            "tax_id": c.get("tax_id", "") or "", "tags": ["imported"], "status": "active",
            "assigned_id": None, "notes": "", "created_by": user_id, "created_at": now_iso(),
            "source": source, "ingestion_id": ingestion_id,
        })
        name_to_id[key] = cid
        created["contacts"] += 1

    for inv in records.get("invoices", []):
        itype = inv.get("type") if inv.get("type") in ("sales_invoice", "purchase_bill") else "sales_invoice"
        ctype = "customer" if itype == "sales_invoice" else "vendor"
        cid = await resolve_contact(inv.get("contact_name"), ctype)
        try:
            amount = float(inv.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        inv_id = new_id()
        purchase_type = (inv.get("purchase_type") or "").strip().lower()
        if itype == "purchase_bill" and purchase_type not in ("expense", "asset", "inventory"):
            # No silent fallback: an unclassified purchase must be reviewed & classified by a human first.
            raise HTTPException(
                status_code=400,
                detail="Please classify this purchase bill as Expense, Asset, or Inventory before filing.")
        await db.invoices.insert_one({
            "id": inv_id, "tenant_id": tenant_id, "type": itype,
            "number": str(inv.get("number") or ""), "contact_id": cid,
            "contact_name": (inv.get("contact_name") or "").strip(),
            "date": inv.get("date", "") or "", "due_date": inv.get("due_date", "") or "",
            "amount": amount, "currency": inv.get("currency") or currency,
            "status": "unpaid", "line_items": inv.get("line_items") if isinstance(inv.get("line_items"), list) else [],
            "purchase_type": purchase_type if itype == "purchase_bill" else "",
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["invoices"] += 1
        # A purchase bill (money we OWE) is segregated by WHAT was bought: asset, inventory, or expense.
        if itype == "purchase_bill":
            vend = (inv.get("contact_name") or "Vendor").strip()
            li_text = " ".join(str(li.get("description", "")) for li in (inv.get("line_items") or []) if isinstance(li, dict))
            inv_cur = inv.get("currency") or currency
            if purchase_type == "asset":
                _aname = (inv.get("asset_name") or li_text[:60] or f"Asset from {vend}").strip()
                await create_asset(tenant_id, user_id, {
                    "name": _aname,
                    "category": inv.get("asset_category") or guess_asset_category(f"{_aname} {li_text}"),
                    "purchase_amount": amount, "currency": inv_cur,
                    "purchase_date": inv.get("date") or "", "vendor_name": vend,
                    "notes": f"From bill {inv.get('number') or ''} · {li_text[:150]}".strip(),
                }, source=source)
                created["assets"] = created.get("assets", 0) + 1
            elif purchase_type == "inventory":
                try:
                    qty = float(inv.get("inventory_qty") or 0) or 1
                except (TypeError, ValueError):
                    qty = 1
                await create_inventory(tenant_id, user_id, {
                    "item": (li_text[:60] or f"Stock from {vend}").strip(),
                    "quantity": qty, "unit": (inv.get("inventory_unit") or "unit").strip(),
                    "unit_cost": round(amount / qty, 2) if qty else amount,
                    "currency": inv_cur, "vendor_name": vend,
                    "notes": f"From bill {inv.get('number') or ''}".strip(),
                }, source=source)
                created["inventory"] = created.get("inventory", 0) + 1
            else:
                await create_expense(tenant_id, user_id, {
                    "title": f"{vend} — Bill {inv.get('number') or ''}".strip(),
                    "amount": amount, "currency": inv_cur,
                    "vendor_name": vend, "vendor_id": cid,
                    "date": inv.get("date") or "", "status": "unpaid",
                    "invoice_id": inv_id, "ingestion_id": ingestion_id, "notes": li_text[:200],
                }, source=source)
                created["expenses"] += 1

    for p in records.get("payments", []):
        _raw_dir = str(p.get("direction") or "").strip().lower()
        direction = "out" if _raw_dir in ("out", "outgoing", "outbound", "debit", "paid", "sent") else "in"
        ctype = "customer" if direction == "in" else "vendor"
        cid = await resolve_contact(p.get("contact_name"), ctype)
        try:
            amount = float(p.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        pay_id = new_id()
        await db.payments.insert_one({
            "id": pay_id, "tenant_id": tenant_id, "direction": direction, "amount": amount,
            "date": p.get("date", "") or "", "method": p.get("method", "") or "",
            "reference": p.get("reference", "") or "", "contact_id": cid,
            "contact_name": (p.get("contact_name") or "").strip(),
            "invoice_number": str(p.get("invoice_number") or ""), "currency": currency,
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["payments"] += 1
        pay_doc = {"id": pay_id, "direction": direction, "amount": amount, "applied": 0, "applications": [],
                   "date": p.get("date") or "", "contact_name": (p.get("contact_name") or "").strip(),
                   "invoice_number": str(p.get("invoice_number") or ""), "reference": p.get("reference") or ""}
        from routers.ledger import reconcile_payment
        # Auto-allocate against an open invoice/bill. Anything left unlinked (either direction)
        # waits in the Needs-matching queue — supplier payments no longer silently create an expense.
        await reconcile_payment(tenant_id, pay_doc, matched_by="auto")

    for t in records.get("tasks", []):
        title = (t.get("title") or "").strip()
        if not title:
            continue
        due = None
        if isinstance(t.get("due_in_days"), int):
            due = (datetime.now(timezone.utc) + timedelta(days=t["due_in_days"])).isoformat()
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "title": title, "description": "",
            "assignee_role": followup_role, "assignee_id": None,
            "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high") else "medium",
            "status": "todo", "due_date": due, "decision_id": None,
            "source": "ingest", "created_at": now_iso(),
        })
        created["tasks"] += 1

    return created


DOC_MIME = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
            "jpeg": "image/jpeg", "webp": "image/webp"}


def _classify_ingestion(doc: dict) -> str:
    dt = doc.get("doc_type")
    if dt in ("sales_invoice", "purchase_bill"):
        return "invoice"
    if dt == "payment":
        return "payment"
    if dt == "purchase_order":
        return "task"
    ent = doc.get("entity")
    if ent == "customers":
        return "customer"
    if ent == "vendors":
        return "supplier"
    if ent == "invoices":
        return "invoice"
    if ent == "payments":
        return "payment"
    recs = doc.get("records") or {}
    if recs.get("invoices"):
        return "invoice"
    if recs.get("payments"):
        return "payment"
    if recs.get("contacts"):
        return "customer"
    return "task"


@api.post("/ingest/document")
async def ingest_document(file: UploadFile = File(...), source: str = Form("upload"),
                          user: dict = Depends(require_perm("data_input"))):
    ext = (file.filename or "file.pdf").split(".")[-1].lower()
    if ext not in DOC_MIME:
        raise HTTPException(status_code=400, detail="Upload a PDF or image (PNG/JPG/WEBP)")
    # FIX-002-E: obj_store with tenant prefix.
    from services.uploads import store_upload, download_to_temp
    ing_id = new_id()
    fname = f"ingest_{ing_id}.{ext}"
    data = await file.read()
    stored = await store_upload(user["tenant_id"], "ingestions", data, ext,
                                 content_type=DOC_MIME[ext], file_id=ing_id)
    doc = {
        "id": ing_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "source": source if source in ("upload", "whatsapp") else "upload",
        "kind": "pdf" if ext == "pdf" else "image", "filename": file.filename or fname,
        "file_url": f"/api/files/{fname}",
        "storage_path": stored["storage_path"],  # FIX-002-E
        "status": "review", "created_at": now_iso(),
    }
    try:
        currency = await _tenant_currency(user["tenant_id"])
        company = await _tenant_name(user["tenant_id"])
        tmp_local = await download_to_temp(stored["storage_path"])
        try:
            result = await ai_extract_document(str(tmp_local), DOC_MIME[ext], f"ingest-{ing_id}", currency, company)
        finally:
            try:
                os.unlink(tmp_local)
            except Exception:
                pass
        doc.update({"summary": result["summary"], "doc_type": result["doc_type"],
                    "confidence": result["confidence"], "records": result["records"]})
    except Exception as e:
        logger.exception("ingest_document extraction failed")
        doc.update({"status": "failed", "error": str(e)[:300], "records": _normalise_records({})})
    await db.ingestions.insert_one(dict(doc))
    doc.pop("_id", None)
    inbox_id = await add_inbox_item(user["tenant_id"], user["id"], doc["source"],
                                    _classify_ingestion(doc), doc.get("summary") or doc["filename"],
                                    doc["filename"], "ingestion", ing_id,
                                    status="done" if doc["status"] == "failed" else "open")
    await db.ingestions.update_one({"id": ing_id}, {"$set": {"inbox_id": inbox_id}})
    doc["inbox_id"] = inbox_id
    return doc


@api.post("/ingest/csv")
async def ingest_csv(file: UploadFile = File(...), user: dict = Depends(require_perm("data_input"))):
    import pandas as pd
    ext = (file.filename or "file.csv").split(".")[-1].lower()
    if ext not in ("csv", "xlsx", "xls"):
        raise HTTPException(status_code=400, detail="Upload a CSV or Excel (.xlsx) file")
    ing_id = new_id()
    # FIX-002-E: obj_store with tenant prefix. pandas needs a filesystem
    # path so we materialize to temp for the read.
    from services.uploads import store_upload, download_to_temp
    fname = f"ingest_{ing_id}.{ext}"
    data = await file.read()
    stored = await store_upload(user["tenant_id"], "ingestions", data, ext,
                                 content_type=file.content_type, file_id=ing_id)
    tmp_local = await download_to_temp(stored["storage_path"])
    try:
        df = pd.read_excel(tmp_local) if ext in ("xlsx", "xls") else pd.read_csv(tmp_local)
        df = df.fillna("")
        headers = [str(c) for c in df.columns]
        rows = df.astype(str).values.tolist()
    except Exception as e:
        try:
            os.unlink(tmp_local)
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=f"Could not read the file: {str(e)[:150]}")
    finally:
        try:
            os.unlink(tmp_local)
        except Exception:
            pass
    doc = {
        "id": ing_id, "tenant_id": user["tenant_id"], "created_by": user["id"], "source": "csv",
        "kind": ext, "filename": file.filename or fname, "file_url": f"/api/files/{fname}",
        "storage_path": stored["storage_path"],  # FIX-002-E
        "status": "review", "row_count": len(rows), "created_at": now_iso(),
    }
    try:
        currency = await _tenant_currency(user["tenant_id"])
        company = await _tenant_name(user["tenant_id"])
        result = await ai_map_spreadsheet(headers, rows, f"ingest-{ing_id}", currency, company)
        doc.update({"summary": result["summary"], "entity": result["entity"], "records": result["records"]})
    except Exception as e:
        logger.exception("ingest_csv mapping failed")
        doc.update({"status": "failed", "error": str(e)[:300], "records": _normalise_records({})})
    await db.ingestions.insert_one(dict(doc))
    doc.pop("_id", None)
    inbox_id = await add_inbox_item(user["tenant_id"], user["id"], "csv",
                                    _classify_ingestion(doc), doc.get("summary") or doc["filename"],
                                    doc["filename"], "ingestion", ing_id,
                                    status="done" if doc["status"] == "failed" else "open")
    await db.ingestions.update_one({"id": ing_id}, {"$set": {"inbox_id": inbox_id}})
    doc["inbox_id"] = inbox_id
    return doc


class IngestCommitInput(BaseModel):
    records: dict


@api.post("/ingest/{ingestion_id}/commit")
async def commit_ingestion(ingestion_id: str, inp: IngestCommitInput,
                           user: dict = Depends(require_perm("data_input"))):
    ing = await db.ingestions.find_one({"id": ingestion_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Ingestion not found")
    if ing.get("status") == "filed":
        raise HTTPException(status_code=400, detail="This upload has already been filed")
    created = await commit_ingestion_records(user["tenant_id"], user["id"], _normalise_records(inp.records),
                                             ingestion_id, ing.get("source", "upload"))
    await db.ingestions.update_one({"id": ingestion_id},
                                   {"$set": {"status": "filed", "records": _normalise_records(inp.records),
                                             "created_counts": created, "filed_at": now_iso()}})
    if ing.get("inbox_id"):
        await db.inbox.update_one({"id": ing["inbox_id"]}, {"$set": {"status": "done"}})
    label = ing.get("filename", "document")
    await log_activity(user["tenant_id"], user["id"], "data_ingested",
                       f"Filed data from '{label}' — {created['contacts']} contacts, {created['invoices']} invoices, {created['payments']} payments, {created['tasks']} tasks",
                       "ingestion", ingestion_id)
    return {"filed": True, "created": created}


@api.get("/ingest")
async def list_ingestions(user: dict = Depends(get_current_user)):
    return await db.ingestions.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)


@api.get("/ingest/{ingestion_id}")
async def get_ingestion(ingestion_id: str, user: dict = Depends(get_current_user)):
    ing = await db.ingestions.find_one({"id": ingestion_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not ing:
        raise HTTPException(status_code=404, detail="Not found")
    return ing


@api.get("/invoices")
async def list_invoices(type: Optional[str] = None, user: dict = Depends(require_perm("finance"))):
    query = {"tenant_id": user["tenant_id"]}
    if type in ("sales_invoice", "purchase_bill"):
        query["type"] = type
    return await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)


@api.get("/payments")
async def list_payments(user: dict = Depends(require_perm("finance"))):
    return await db.payments.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)


# ---------------------------------------------------------------------------
# Unified Inbox feed
# ---------------------------------------------------------------------------
# Inbox endpoints moved to routers/inbox.py in Phase B step 6.
# `push_inbox()` (the writer) stays in this module — many domain workflows still call it inline.


# ---------------------------------------------------------------------------
# 360° Customer / Supplier profile  (Owner + Finance only)
# ---------------------------------------------------------------------------
@api.get("/contacts/{contact_id}/profile")
async def contact_profile(contact_id: str, user: dict = Depends(require_perm("finance"))):
    tid = user["tenant_id"]
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": tid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    name = c.get("name") or ""
    name_rx = {"$regex": f"^{re.escape(name)}$", "$options": "i"}
    loose_rx = {"$regex": re.escape(name), "$options": "i"} if name else {"$exists": False}
    match_party = {"tenant_id": tid, "$or": [{"contact_id": contact_id}, {"contact_name": name_rx}]}

    invoices = await db.invoices.find(match_party, {"_id": 0}).sort("created_at", -1).to_list(500)
    payments = await db.payments.find(match_party, {"_id": 0}).sort("created_at", -1).to_list(500)
    complaints = await db.complaints.find({"tenant_id": tid, "customer_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    workflows = await db.workflows.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
    tasks = await db.tasks.find({"tenant_id": tid, "title": loose_rx}, {"_id": 0}).sort("created_at", -1).to_list(200) if name else []
    decisions = await db.decisions.find(
        {"tenant_id": tid, "$or": [{"title": loose_rx}, {"summary": loose_rx}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100) if name else []

    total_billed = sum(float(i.get("amount") or 0) for i in invoices)
    total_paid = sum(float(p.get("amount") or 0) for p in payments)
    outstanding = round(total_billed - total_paid, 2)
    last_payment = payments[0].get("date") if payments else None

    # follow-ups = reminder tasks + open workflows
    follow_ups = [t for t in tasks if t.get("source") in ("reminder", "ingest")]
    # FIX-001-F: dynamic terminal stages per tenant (salon 'served', bakery 'settled', etc.).
    from services.workflows import tenant_terminal_stages
    _term_stages_360 = set(await tenant_terminal_stages(tid))
    pending_deliveries = [w for w in workflows if w.get("stage") not in _term_stages_360]

    # price history for suppliers, from purchase bill line items
    price_history = []
    if c.get("type") == "vendor":
        for inv in invoices:
            for li in (inv.get("line_items") or []):
                if li.get("description"):
                    price_history.append({"item": li.get("description"), "rate": li.get("rate"),
                                          "date": inv.get("date") or inv.get("created_at", "")[:10]})

    return {
        "contact": c,
        "summary": {"total_billed": round(total_billed, 2), "total_paid": round(total_paid, 2),
                    "outstanding": outstanding, "last_payment": last_payment,
                    "open_complaints": len([x for x in complaints if x.get("status") != "resolved"])},
        "invoices": invoices,
        "payments": payments,
        "complaints": complaints,
        "workflows": workflows,
        "pending_deliveries": pending_deliveries,
        "follow_ups": follow_ups,
        "tasks": await enrich_tasks(tasks),
        "decisions": decisions,
        "price_history": price_history,
        "ai_relationship": c.get("ai_relationship"),
    }


@api.post("/contacts/{contact_id}/rescore")
async def rescore_contact(contact_id: str, user: dict = Depends(require_perm("finance"))):
    tid = user["tenant_id"]
    c = await db.contacts.find_one({"id": contact_id, "tenant_id": tid}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Contact not found")
    name = c.get("name") or ""
    name_rx = {"$regex": f"^{re.escape(name)}$", "$options": "i"}
    match_party = {"tenant_id": tid, "$or": [{"contact_id": contact_id}, {"contact_name": name_rx}]}
    invoices = await db.invoices.find(match_party, {"_id": 0, "amount": 1}).to_list(500)
    payments = await db.payments.find(match_party, {"_id": 0, "amount": 1, "date": 1}).sort("created_at", -1).to_list(500)
    complaints = await db.complaints.find({"tenant_id": tid, "customer_id": contact_id}, {"_id": 0, "status": 1}).to_list(200)
    workflows = await db.workflows.find({"tenant_id": tid, "contact_id": contact_id}, {"_id": 0, "stage": 1}).to_list(200)
    total_billed = sum(float(i.get("amount") or 0) for i in invoices)
    total_paid = sum(float(p.get("amount") or 0) for p in payments)
    # FIX-001-F: dynamic terminal stages per tenant.
    from services.workflows import tenant_terminal_stages
    _term_stages_rs = set(await tenant_terminal_stages(tid))
    metrics = {
        "outstanding": round(total_billed - total_paid, 2), "total_billed": round(total_billed, 2),
        "total_paid": round(total_paid, 2), "last_payment": payments[0].get("date") if payments else None,
        "open_complaints": len([x for x in complaints if x.get("status") != "resolved"]),
        "pending_deliveries": len([w for w in workflows if w.get("stage") not in _term_stages_rs]),
        "invoice_count": len(invoices), "payment_count": len(payments),
    }
    currency = await _tenant_currency(tid)
    scores = await ai_score_contact(c, metrics, currency, session_id=f"contact-{contact_id}")
    if scores:
        scores["scored_at"] = now_iso()
        await db.contacts.update_one({"id": contact_id}, {"$set": {"ai_relationship": scores}})
    return {"ai_relationship": scores}


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




class LeaveApproverMapInput(BaseModel):
    approvers: dict  # { role_key: approver_user_id }




async def _resolve_leave_approver(tenant_id: str, requester: dict):
    """Approver priority: reporting manager → department/role mapping → owner."""
    rm = requester.get("reporting_manager_id")
    if rm:
        m = await db.users.find_one({"id": rm, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
        if m:
            return m["id"], m.get("name")
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "leave_approvers": 1})
    mapping = (t or {}).get("leave_approvers") or {}
    aid = mapping.get(requester.get("role"))
    if aid:
        m = await db.users.find_one({"id": aid, "tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1})
        if m:
            return m["id"], m.get("name")
    owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1, "name": 1})
    if owner:
        return owner["id"], owner.get("name")
    return None, None


@api.patch("/tenant/leave-approvers")
async def update_leave_approvers(inp: LeaveApproverMapInput, user: dict = Depends(require_perm("team_manage"))):
    role_keys = await tenant_role_keys(user["tenant_id"])
    clean = {}
    for role, aid in (inp.approvers or {}).items():
        if role not in role_keys or not aid:
            continue
        m = await db.users.find_one({"id": aid, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
        if m:
            clean[role] = aid
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"leave_approvers": clean}})
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


async def _create_leave(tenant_id, requester, leave_type, from_date, to_date, day_portion, reason, is_emergency):
    approver_id, approver_name = await _resolve_leave_approver(tenant_id, requester)
    lid = new_id()
    doc = {
        "id": lid, "tenant_id": tenant_id, "user_id": requester["id"],
        "user_name": requester.get("name"), "user_role": requester.get("role"),
        "leave_type": leave_type, "from_date": from_date[:10], "to_date": to_date[:10],
        "day_portion": day_portion if day_portion in ("full", "half") else "full",
        "reason": reason or "", "is_emergency": bool(is_emergency),
        "status": "pending", "approver_id": approver_id, "approver_name": approver_name,
        "info_note": None, "created_at": now_iso(), "decided_at": None, "decided_by": None,
        "history": [{"action": "submitted", "by": requester["id"], "by_name": requester.get("name"), "note": reason or "", "at": now_iso()}],
    }
    await db.leaves.insert_one(doc)
    label = "Emergency absence" if is_emergency else f"{leave_type.title()} leave"
    msg = f"{requester.get('name')} — {label} ({doc['from_date']}" + (f" → {doc['to_date']}" if doc['to_date'] != doc['from_date'] else "") + ")"
    await push_notification(tenant_id, [approver_id], 3 if is_emergency else 2, msg,
                            entity_type="leave", entity_id=lid, ntype="approval",
                            title=label, sender=requester.get("name"))
    await log_activity(tenant_id, requester["id"], "leave_requested", msg, "leave", lid)
    doc.pop("_id", None)
    return doc








# --- Leave & Absence Phase 2: AI Impact Analysis on approval ---
async def ai_leave_impact(person_name: str, from_date: str, to_date: str, tasks: list, members: list) -> dict:
    if not tasks:
        return {"summary": "No active tasks are affected by this leave.", "suggestions": []}
    system = (
        "You are an operations manager for an Indian SME. A team member is going on leave and their active tasks are "
        "at risk. For EACH task, recommend exactly ONE action to keep work on track:\n"
        "- 'reassign': hand it to an available teammate — prefer someone with the same or adjacent role and the LOWEST "
        "current workload (active_task_count). Only choose an assignee_id from the available_members list.\n"
        "- 'extend': push the due date to shortly AFTER the person returns (a day or two after leave_to), only when the "
        "task can safely wait and shouldn't move to someone else.\n"
        "- 'monitor': leave as-is (low priority, almost done, or nothing to do now).\n"
        "Return STRICT JSON: {\"summary\": string (one plain-English sentence), \"suggestions\": [{\"task_id\": string, "
        "\"action\": \"reassign\"|\"extend\"|\"monitor\", \"assignee_id\": string (required only if reassign, must be from "
        "available_members), \"assignee_name\": string, \"due_date\": \"YYYY-MM-DD\" (required only if extend), "
        "\"reason\": string (short)}]}. Every input task_id MUST appear exactly once. If there are no available_members, "
        "do not use 'reassign'."
    )
    payload = {
        "person_on_leave": person_name, "leave_from": from_date, "leave_to": to_date,
        "at_risk_tasks": [{"task_id": t["id"], "title": t.get("title"), "priority": t.get("priority"),
                           "status": t.get("status"), "due_date": (t.get("due_date") or "")[:10]} for t in tasks],
        "available_members": [{"id": m["id"], "name": m["name"], "role": m["role"],
                               "active_task_count": m["load"]} for m in members],
    }
    chat = claude_chat(session_id=f"leave-impact-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=json.dumps(payload)))
    data = _extract_json(resp)
    return data if isinstance(data, dict) else {"summary": "", "suggestions": []}




@api.get("/calendar")
async def business_calendar(days: int = 45, user: dict = Depends(get_current_user)):
    """Unified business calendar: upcoming payments due, task deadlines, deliveries, complaints, birthdays."""
    tid = user["tenant_id"]
    can_finance = user.get("role") == "owner" or "finance" in user_perms(user)
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=14)).date().isoformat()
    end = (now + timedelta(days=days)).date().isoformat()
    events = []

    def add(date, etype, title, subtitle="", contact_id=None, entity_id=None, amount=None):
        d = (date or "")[:10]
        if not d:
            return
        events.append({"date": d, "type": etype, "title": title, "subtitle": subtitle,
                       "contact_id": contact_id, "entity_id": entity_id, "amount": amount,
                       "overdue": d < now.date().isoformat()})

    # Payments due (unpaid sales invoices) — finance only
    if can_finance:
        invs = await db.invoices.find(
            {"tenant_id": tid, "type": "sales_invoice", "status": {"$ne": "paid"}, "due_date": {"$ne": None}},
            {"_id": 0}).to_list(500)
        for i in invs:
            add(i.get("due_date"), "payment_due",
                f"Payment due: {i.get('contact_name') or 'Customer'}",
                f"{i.get('currency') or ''} {i.get('amount')}", i.get("contact_id"), i.get("id"), i.get("amount"))

    # Task deadlines (open)
    tasks = await db.tasks.find(
        {"tenant_id": tid, "status": {"$in": ["todo", "in_progress", "blocked"]}, "due_date": {"$ne": None}},
        {"_id": 0}).to_list(500)
    for t in tasks:
        add(t.get("due_date"), "task", t.get("title", "Task"),
            (t.get("assignee_role") or "team"), None, t.get("id"))

    # Deliveries (open distribution workflows; includes legacy sales_dispatch cards)
    # FIX-001-F: dynamic terminal stages (leave the type hardcode as a
    # follow-up: needs a tenant_sales_pipeline resolver similar to the one
    # tenant_procurement_pipeline provides — logged separately).
    from services.workflows import tenant_terminal_stages as _tts
    _cal_term = await _tts(tid)
    wfs = await db.workflows.find(
        {"tenant_id": tid, "type": {"$in": ["distribution", "sales_dispatch"]}, "stage": {"$nin": _cal_term}},
        {"_id": 0}).to_list(300)
    for w in wfs:
        dt = w.get("expected_date") or w.get("due_date")
        if dt:
            add(dt, "delivery", f"Delivery: {w.get('title') or w.get('counterparty') or 'Order'}",
                (w.get("stage") or "").replace("_", " "), w.get("contact_id"), w.get("id"))

    # Complaints (recent)
    comps = await db.complaints.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for c in comps:
        add(c.get("created_at"), "complaint", f"Complaint: {(c.get('text') or '')[:50]}",
            c.get("severity") or "", c.get("customer_id"), c.get("id"))

    # Birthdays (this year, from contact.birthday MM-DD or YYYY-MM-DD)
    contacts = await db.contacts.find({"tenant_id": tid, "birthday": {"$nin": [None, ""]}},
                                      {"_id": 0, "id": 1, "name": 1, "birthday": 1}).to_list(500)
    for c in contacts:
        b = (c.get("birthday") or "").strip()
        md = b[-5:] if len(b) >= 5 else ""
        if len(md) == 5 and "-" in md:
            add(f"{now.year}-{md}", "birthday", f"Birthday: {c.get('name')}", "", c.get("id"))

    # Meetings scheduled from directives
    mevs = await db.calendar_events.find({"tenant_id": tid}, {"_id": 0}).to_list(300)
    for ev in mevs:
        add(ev.get("date"), "meeting", ev.get("title", "Meeting"), ev.get("when_text", ""), None, ev.get("id"))

    # Approved leaves (team availability)
    lvs = await db.leaves.find({"tenant_id": tid, "status": "approved"}, {"_id": 0}).to_list(300)
    for lv in lvs:
        fd, td = (lv.get("from_date") or "")[:10], (lv.get("to_date") or "")[:10]
        if not fd:
            continue
        portion = " (half day)" if lv.get("day_portion") == "half" else ""
        sub = f"{(lv.get('leave_type') or 'leave').title()}{portion}"
        add(fd, "leave", f"On leave: {lv.get('user_name')}", sub, None, lv.get("id"))
        if td and td != fd:
            add(td, "leave", f"Leave ends: {lv.get('user_name')}", sub, None, lv.get("id"))

    events = [e for e in events if start <= e["date"] <= end]
    for e in events:
        if e["type"] in ("birthday", "leave"):
            e["overdue"] = False
    events.sort(key=lambda e: e["date"])
    days_map = {}
    for e in events:
        days_map.setdefault(e["date"], []).append(e)
    grouped = [{"date": d, "events": evs} for d, evs in sorted(days_map.items())]
    counts = {}
    for e in events:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    return {"days": grouped, "counts": counts, "total": len(events)}




@api.get("/webhooks/whatsapp")
async def whatsapp_verify(request: Request):
    # Meta webhook verification handshake
    params = request.query_params
    if params.get("hub.mode") == "subscribe" and params.get("hub.verify_token") == os.environ.get("WA_VERIFY_TOKEN"):
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verification failed")


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


@api.post("/webhooks/whatsapp")
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


def _norm_phone(p: str) -> str:
    return re.sub(r"\D", "", p or "")[-10:]


@api.get("/whatsapp/status")
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


@api.get("/whatsapp/logs")
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
            text = message["text"]["body"]
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


# ---------------------------------------------------------------------------
# WhatsApp Smart Capture — AI triage → Capture Draft → role review → execute
# ---------------------------------------------------------------------------
CAPTURE_CLASSES = ["operational_task", "invoice", "payment", "purchase", "sales", "hr", "meeting", "decision", "approval", "workflow", "other"]
# Classification → department "intent". invoice/payment are handled as money items (finance).
# operational_task/workflow/meeting/other fall back to the AI-suggested department.
INTENT_BY_CLASS = {
    "sales": "sales", "purchase": "purchase", "hr": "hr",
}
# Hint substrings used to map a department intent to a tenant's ACTUAL role key
# (role names vary by industry, e.g. finance may be keyed 'accounts_and_admin').
DEPT_HINTS = {
    "finance": ("financ", "account", "accts", "treasur", "billing", "audit", "insurance"),
    "sales": ("sales", "estimat", "quotation", "quote", "business_development", "customer_relation", "boutique", "retail", "consultant", "customer"),
    "purchase": ("purchas", "procure", "buying", "supply_chain", "vendor", "inventory", "merchandis", "acquisition"),
    "hr": ("human_resource", "talent", "recruit", "payroll", "administrator"),
    "operations": ("operation", "logistics", "warehouse", "workshop", "fulfillment", "supply", "office_manager", "admin"),
    "marketing": ("marketing", "content", "communication", "events", "listings"),
    "production": ("production", "kitchen", "manufactur", "quality", "detailing", "technician", "back_of_house", "assembly"),
}
FINANCE_ROLE_HINTS = ("financ", "account", "accts", "treasur", "billing", "audit")


async def _finance_role_key(tenant_id: str, troles: set) -> Optional[str]:
    """Find the tenant's finance/accounts role key (role names vary by industry)."""
    if "finance" in troles:
        return "finance"
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    for r in ((t.get("roles") if t else None) or []):
        blob = f"{r.get('key', '')} {r.get('label', '')}".lower()
        if any(h in blob for h in FINANCE_ROLE_HINTS):
            return r.get("key")
    return None


async def _resolve_reviewer_role(tenant_id: str, troles: set, intent: Optional[str]) -> Optional[str]:
    """Map a department 'intent' (finance/sales/purchase/hr/operations/marketing/production, or a
    literal role name) to the tenant's ACTUAL role key. Returns None when nothing matches (so the
    caller can decide the fallback). This is what keeps departmental captures OUT of the owner queue."""
    intent = (intent or "").strip().lower()
    if not intent or intent == "owner":
        return None
    if intent in troles:
        return intent
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    roles = (t.get("roles") if t else None) or []
    for r in roles:  # exact key match first
        if r.get("key") == intent:
            return r.get("key")
    hints = DEPT_HINTS.get(intent, (intent,))
    for r in roles:  # then fuzzy hint match against key + label
        blob = f"{r.get('key', '')} {r.get('label', '')}".lower()
        if any(h in blob for h in hints):
            return r.get("key")
    return None
DOC_CLASS = {"sales_invoice": "invoice", "purchase_bill": "purchase", "payment": "payment",
             "purchase_order": "purchase", "quotation": "sales", "receipt": "payment"}
CAPTURE_THRESHOLD = float(os.environ.get("CAPTURE_OWNER_THRESHOLD", "50000"))
# Confidence gating for the WhatsApp Smart Capture processing-level decision.
AUTO_CONFIDENCE = float(os.environ.get("CAPTURE_AUTO_CONFIDENCE", "0.90"))
ATTENTION_CONFIDENCE = float(os.environ.get("CAPTURE_ATTENTION_CONFIDENCE", "0.60"))


def _needs_owner_review(cls: str, amount, policy: bool, threshold: float = CAPTURE_THRESHOLD) -> bool:
    return bool(policy) or cls in ("approval", "decision") or (amount is not None and amount >= threshold)


async def _capture_settings(tenant_id: str):
    """Owner-configurable capture settings: (high_value_threshold, require_owner_signoff)."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "high_value_threshold": 1, "require_owner_signoff": 1})
    thr = (t or {}).get("high_value_threshold")
    thr = float(thr) if isinstance(thr, (int, float)) and thr > 0 else CAPTURE_THRESHOLD
    return thr, bool((t or {}).get("require_owner_signoff"))


async def _find_duplicate_invoice(tenant_id: str, records: dict):
    """Return an already-filed invoice that looks like a duplicate of one in `records`, else None."""
    for inv in (records or {}).get("invoices", []):
        num = str(inv.get("number") or "").strip()
        if num:
            hit = await db.invoices.find_one(
                {"tenant_id": tenant_id, "number": {"$regex": f"^{re.escape(num)}$", "$options": "i"}},
                {"_id": 0, "id": 1, "number": 1})
            if hit:
                return hit
        try:
            amt = float(inv.get("amount") or 0)
        except (TypeError, ValueError):
            amt = 0.0
        cname = (inv.get("contact_name") or "").strip()
        if amt and cname:
            hit = await db.invoices.find_one(
                {"tenant_id": tenant_id, "amount": amt,
                 "contact_name": {"$regex": f"^{re.escape(cname)}$", "$options": "i"}},
                {"_id": 0, "id": 1, "number": 1})
            if hit:
                return hit
    return None


def _decide_processing_level(cls, confidence, amount, needs_owner, is_duplicate, has_records, is_document, has_unknown_purchase=False):
    """Map an AI-triaged capture to one of: auto | confirm | attention.
    Returns (level, reason)."""
    if is_duplicate:
        return "attention", "Possible duplicate of an already-filed invoice — please verify before saving."
    if has_unknown_purchase:
        return "attention", "AI couldn't confidently tell if this purchase is an expense, an asset, or inventory — please classify and approve."
    if confidence is not None and confidence < ATTENTION_CONFIDENCE:
        return "attention", "Low confidence extraction — please double-check the details."
    if is_document and not has_records:
        return "attention", "Couldn't read clear structured data from this document — please review."
    if needs_owner:
        return "confirm", ""
    if (is_document and confidence is not None and confidence >= AUTO_CONFIDENCE
            and amount is not None and 0 < amount < CAPTURE_THRESHOLD
            and cls in ("purchase", "sales")):
        return "auto", ""
    return "confirm", ""

_CAPTURE_SYS = (
    "You are an operations triage AI for a business that receives instructions on WhatsApp. "
    "Classify ONE incoming message and return ONLY JSON with keys: "
    "classification (one of [operational_task, invoice, payment, purchase, sales, hr, meeting, decision, approval, workflow, other]), "
    "intent (short phrase), summary (one clear sentence), "
    "department (one of [sales, finance, purchase, hr, operations, production, marketing, owner]) — pick the department that should OWN and act on this. "
    "Use 'owner' ONLY for company-wide policy changes, formal approvals/decisions, or big/high-value commitments; routine work (estimates, quotations, follow-ups, operational tasks) goes to the relevant department, NOT owner. "
    "priority (one of [low, medium, high]), due_in_days (integer or null), "
    "amount (number if a monetary value is mentioned, else null), "
    "confidence (number between 0 and 1 — how sure you are this is a genuine, clearly actionable business instruction), "
    "unrelated (boolean — true if this is NOT a business instruction, e.g. a greeting, spam, or personal chit-chat), "
    "policy_or_high_risk (boolean — true for policy changes, contracts, legal, layoffs, big commitments). "
    "Choose the department that should review this. Available team roles: {roles}."
)


async def ai_capture_triage(text: str, roles: list) -> dict:
    system = _CAPTURE_SYS.replace("{roles}", ", ".join(roles) or "owner")
    chat = claude_chat(session_id=f"capture-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    resp = await chat.send_message(UserMessage(text=(text or "")[:4000]))
    try:
        d = _extract_json(resp)
    except Exception:
        d = {}
    if d.get("classification") not in CAPTURE_CLASSES:
        d["classification"] = "other"
    d.setdefault("intent", "")
    d.setdefault("summary", (text or "")[:160])
    if d.get("priority") not in ("low", "medium", "high"):
        d["priority"] = "medium"
    d.setdefault("department", "owner")
    try:
        d["confidence"] = max(0.0, min(1.0, float(d.get("confidence"))))
    except (TypeError, ValueError):
        d["confidence"] = 0.7
    d["unrelated"] = bool(d.get("unrelated"))
    return d


async def persist_capture_draft(tenant_id, wa_from, kind, payload, tri, troles, records=None,
                                status="pending_review", confidence=None, processing_level="confirm",
                                duplicate_of=None, attention_reason=""):
    cls = tri.get("classification", "other")
    amount = tri.get("amount") if isinstance(tri.get("amount"), (int, float)) else None
    dept = tri.get("department")
    money_item = cls in ("invoice", "payment")
    reviewer_perm = "finance" if money_item else None
    threshold, require_signoff = await _capture_settings(tenant_id)
    high_value = amount is not None and amount >= threshold
    escalate_reason = ""
    needs_owner = False
    # Department intent: money items → finance; sales/purchase/hr fixed; everything else uses
    # the AI-suggested department. Resolved against the tenant's REAL role keys below.
    intent = INTENT_BY_CLASS.get(cls) or dept

    if money_item:
        # Invoice/payment always flow to finance directly — routed to the tenant's actual
        # finance/accounts role. reviewer_perm ensures anyone with the finance permission sees it.
        reviewer = await _finance_role_key(tenant_id, troles) or "owner"
        if high_value:
            escalate_reason = f"High value ({amount:,.0f}) — verify before approving"
            if require_signoff:
                # Owner sign-off required above the configured threshold.
                needs_owner = True
                reviewer = "owner"
                escalate_reason = f"High value ({amount:,.0f}) — owner sign-off required"
    elif cls in ("approval", "decision") or bool(tri.get("policy_or_high_risk")) or high_value:
        # Genuinely owner-level: formal approvals/decisions, policy/high-risk, or high-value commitments.
        needs_owner = True
        reviewer = "owner"
        if high_value:
            escalate_reason = f"High-value item ({amount:,.0f})"
        elif cls in ("approval", "decision"):
            escalate_reason = f"{cls.title()}-level item"
        else:
            escalate_reason = "Policy / high-risk"
    else:
        # Routine departmental work (tasks, sales, purchase, hr, meetings, workflows) → the
        # relevant department's Review Queue, NOT the owner. Owner still sees all captures.
        reviewer = await _resolve_reviewer_role(tenant_id, troles, intent) or "owner"
    if not reviewer:
        reviewer = "owner"
    due = None
    if isinstance(tri.get("due_in_days"), int):
        due = (datetime.now(timezone.utc) + timedelta(days=tri["due_in_days"])).isoformat()
    did = new_id()
    await db.capture_drafts.insert_one({
        "id": did, "tenant_id": tenant_id, "source": "whatsapp", "wa_from": wa_from, "kind": kind,
        "text": payload.get("text", ""), "file_url": payload.get("file_url"), "filename": payload.get("filename"),
        "classification": cls, "intent": tri.get("intent", ""), "summary": tri.get("summary", ""),
        "department": dept, "reviewer_role": reviewer, "reviewer_perm": reviewer_perm, "assignee_id": None,
        "priority": tri.get("priority", "medium"), "due_date": due, "amount": amount, "records": records,
        "needs_owner": needs_owner, "escalate_reason": escalate_reason,
        "confidence": confidence, "processing_level": processing_level,
        "duplicate_of": duplicate_of, "attention_reason": attention_reason, "auto_processed": False,
        "status": status, "review_action": None, "clarification_note": None,
        "created_at": now_iso(), "reviewed_by": None, "reviewed_at": None, "result_ref": None,
    })
    return did


async def execute_capture(d: dict, user: dict):
    tenant_id = d["tenant_id"]
    # Document-based drafts → file the extracted financial records.
    if d.get("records") and d.get("kind") in ("pdf", "image", "document"):
        ing_id = new_id()
        created = await commit_ingestion_records(tenant_id, user["id"], d["records"], ing_id, "whatsapp")
        doc = {
            "id": ing_id, "tenant_id": tenant_id, "created_by": user["id"], "source": "whatsapp",
            "kind": d.get("kind"), "filename": d.get("filename") or f"{ing_id}", "file_url": d.get("file_url"),
            "status": "filed", "created_at": now_iso(), "summary": d.get("summary", ""),
            "doc_type": d.get("classification"), "records": d["records"], "created_counts": created,
            "filed_at": now_iso(), "wa_from": d.get("wa_from"),
        }
        await db.ingestions.insert_one(dict(doc))
        inbox_id = await add_inbox_item(tenant_id, user["id"], "whatsapp", _classify_ingestion(doc),
                                        doc["summary"] or doc["filename"], doc["filename"], "ingestion", ing_id, status="done")
        await db.ingestions.update_one({"id": ing_id, "tenant_id": tenant_id}, {"$set": {"inbox_id": inbox_id}})  # FIX-001-C
        return {"type": "ingestion", "id": ing_id, "created": created}
    # Text / instruction drafts → run the structuring pipeline, then apply reviewer overrides + release.
    note_id = new_id()
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": tenant_id, "created_by": user["id"], "kind": "text",
        "audio_path": None, "transcript": d.get("text") or d.get("summary") or "", "language": "auto",
        "status": "queued", "source": "whatsapp", "wa_from": d.get("wa_from"),
        "raised_by_name": d.get("wa_from"), "created_at": now_iso(),
    })
    await process_voice_note(note_id)
    vn = await db.voice_notes.find_one({"id": note_id}, {"_id": 0, "decision_id": 1})
    decision_id = (vn or {}).get("decision_id")
    if decision_id:
        overrides = {}
        if d.get("assignee_id"):
            overrides["assignee_id"] = d["assignee_id"]
        if d.get("priority"):
            overrides["priority"] = d["priority"]
        if d.get("due_date"):
            overrides["due_date"] = d["due_date"]
        if overrides:
            overrides["updated_at"] = now_iso()
            overrides["last_action"] = "Set by reviewer"
            # FIX-001-C: all writes below scope by tenant_id so a leaked/guessed
            # decision_id can never touch another tenant's tasks or decision.
            await db.tasks.update_many({"tenant_id": tenant_id, "decision_id": decision_id}, {"$set": overrides})
        # Reviewer approved the capture → release the decision's blocked tasks.
        await db.decisions.update_one({"id": decision_id, "tenant_id": tenant_id}, {"$set": {"status": "approved"}})
        await db.tasks.update_many({"tenant_id": tenant_id, "decision_id": decision_id, "status": "blocked"},
                                   {"$set": {"status": "todo", "updated_at": now_iso(), "last_action": "Approved via capture"}})
    return {"type": "decision", "id": decision_id}


class CaptureEditInput(BaseModel):
    classification: Optional[str] = None
    reviewer_role: Optional[str] = None
    assignee_id: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None
    summary: Optional[str] = None
    text: Optional[str] = None
    records: Optional[dict] = None


class CaptureActionInput(BaseModel):
    note: Optional[str] = ""
    reason: Optional[str] = ""
    reviewer_role: Optional[str] = None
    assignee_id: Optional[str] = None


async def _get_draft(cid, user):
    d = await db.capture_drafts.find_one({"id": cid, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Capture not found")
    if user["role"] != "owner" and d["reviewer_role"] != user["role"]:
        raise HTTPException(status_code=403, detail="Not your review queue")
    return d


@api.get("/captures")
async def list_captures(status: str = "pending_review", user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status and status != "all":
        q["status"] = status
    if user["role"] != "owner":
        q["$or"] = [{"reviewer_role": user["role"]}, {"reviewer_perm": {"$in": list(user_perms(user))}}]
    rows = await db.capture_drafts.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    ids = [r["assignee_id"] for r in rows if r.get("assignee_id")]
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(100):
            umap[u["id"]] = u["name"]

    # Resolve the WhatsApp sender phone to a known employee (or contact) in this workspace,
    # so the review queue shows a name + role instead of a raw number.
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "roles": 1})
    role_labels = {"owner": "Owner"}
    for r in (tenant or {}).get("roles", []) or []:
        role_labels[r.get("key")] = r.get("label") or (r.get("key") or "").title()
    phone_index = {}
    for u in await db.users.find({"tenant_id": user["tenant_id"], "phone": {"$exists": True, "$ne": ""}},
                                 {"_id": 0, "name": 1, "role": 1, "phone": 1}).to_list(2000):
        key = _norm_phone(u.get("phone", ""))
        if key:
            phone_index[key] = {"name": u.get("name"), "role": u.get("role"),
                                "role_label": role_labels.get(u.get("role"), (u.get("role") or "").title()),
                                "kind": "employee"}
    contact_index = {}
    for ct in await db.contacts.find({"tenant_id": user["tenant_id"], "phone": {"$exists": True, "$ne": ""}},
                                     {"_id": 0, "name": 1, "company": 1, "type": 1, "phone": 1}).to_list(2000):
        key = _norm_phone(ct.get("phone", ""))
        if key:
            contact_index[key] = {"name": ct.get("name") or ct.get("company"),
                                  "role_label": (ct.get("type") or "contact").title(), "kind": "contact"}

    for r in rows:
        r["assignee_name"] = umap.get(r.get("assignee_id"))
        wa = r.get("wa_from")
        if wa:
            k = _norm_phone(wa)
            sender = phone_index.get(k) or contact_index.get(k)
            if sender:
                r["sender_name"] = sender["name"]
                r["sender_role"] = sender.get("role_label")
                r["sender_kind"] = sender["kind"]
    return rows


@api.get("/captures/pending-count")
async def captures_pending_count(user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"], "status": {"$in": ["pending_review", "needs_attention"]}}
    if user["role"] != "owner":
        q["$or"] = [{"reviewer_role": user["role"]}, {"reviewer_perm": {"$in": list(user_perms(user))}}]
    return {"count": await db.capture_drafts.count_documents(q)}


@api.patch("/captures/{cid}")
async def edit_capture(cid: str, inp: CaptureEditInput, user: dict = Depends(get_current_user)):
    await _get_draft(cid, user)
    updates = {k: v for k, v in inp.dict().items() if v is not None}
    if updates:
        await db.capture_drafts.update_one({"id": cid}, {"$set": updates})
    return await db.capture_drafts.find_one({"id": cid}, {"_id": 0})


@api.post("/captures/{cid}/reassign")
async def reassign_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): reassigning a captured draft rewrites the
    # target person on a real record about to be committed. Only users
    # with the approvals permission (owner + designated approvers)
    # should do this — was auth-only, which meant any employee could
    # steer an approval flow's target.
    await _get_draft(cid, user)
    updates = {}
    if inp.reviewer_role:
        updates["reviewer_role"] = inp.reviewer_role
    if inp.assignee_id is not None:
        updates["assignee_id"] = inp.assignee_id or None
    if updates:
        await db.capture_drafts.update_one({"id": cid}, {"$set": updates})
    return {"ok": True}


@api.post("/captures/{cid}/reject")
async def reject_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): same rationale as reassign — approvals perm gate.
    await _get_draft(cid, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "rejected", "review_action": "rejected", "reviewed_by": user["id"],
        "reviewed_at": now_iso(), "clarification_note": inp.reason or "",
    }})
    return {"ok": True}


@api.post("/captures/{cid}/clarify")
async def clarify_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): approvals perm gate — clarify shapes what
    # the approver will see, same authority tier as approve/reject.
    d = await _get_draft(cid, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "clarification_requested", "review_action": "clarify",
        "reviewed_by": user["id"], "reviewed_at": now_iso(), "clarification_note": inp.note or "",
    }})
    if d.get("wa_from") and inp.note:
        await send_wa_reply(d["wa_from"], f"❓ Clarification needed on your message: {inp.note}")
    return {"ok": True}


@api.post("/captures/{cid}/approve")
async def approve_capture(cid: str, user: dict = Depends(require_perm("approvals"))):
    # FIX-004-C (RBAC-05): approving a capture creates real workflow /
    # task / decision records. Explicit approvals-permission gate;
    # was auth-only which let any employee commit captured drafts.
    d = await _get_draft(cid, user)
    if d["status"] not in ("pending_review", "clarification_requested", "needs_attention"):
        raise HTTPException(status_code=400, detail="Already processed")
    if d.get("needs_owner") and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="This item requires Owner approval")
    result = await execute_capture(d, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "executed", "review_action": "approved", "reviewed_by": user["id"],
        "reviewed_at": now_iso(), "result_ref": result,
    }})
    if d.get("wa_from"):
        await send_wa_reply(d["wa_from"], "✅ Approved and actioned in DecisionOS.")
    return {"ok": True, "result": result}



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
            logger.warning(f"backfill_memberships migration: {e}")
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
            logger.warning(f"backfill_grandfathered_plans migration: {e}")
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
            logger.warning(f"rename_production_role migration: {e}")
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
        from services.migrations import apply_migration as _apply_migration

        async def _backfill_phone_norm(_db):
            from services.phone import norm_phone as _np
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
            logger.warning(f"phone_norm backfill migration: {e}")
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
            logger.warning(f"otp_codes tenant-scope migration: {e}")

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
            logger.warning(f"brain_contexts rename migration: {e}")

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
            logger.warning(f"drop-none-language text indexes migration: {e}")
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
            logger.warning(f"migrate_tenants migration: {e}")
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
            logger.warning(f"local-disk uploads migration: {e}")
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


@api.get("/health")
async def api_health():
    return {"status": "ok"}


@api.get("/")
async def root():
    return {"message": "DecisionOS API"}


app.include_router(api)
# Extracted route modules (import foundation from core; no circular dependency).
from routers.onboarding import router as onboarding_router  # noqa: E402
app.include_router(onboarding_router)
from routers.ledger import router as ledger_router  # noqa: E402
app.include_router(ledger_router)
from routers.admin import router as admin_router  # noqa: E402
app.include_router(admin_router)
from routers.brain import router as brain_router  # noqa: E402
app.include_router(brain_router)
from routers.brain_docs import router as brain_docs_router  # noqa: E402
app.include_router(brain_docs_router)
from routers.brain_context_api import router as brain_context_router  # noqa: E402
app.include_router(brain_context_router)
from routers.brain_router import router as brain_agent_router  # noqa: E402
app.include_router(brain_agent_router)
from routers.signup import router as signup_router  # noqa: E402
app.include_router(signup_router)
from routers.auth import router as auth_router  # noqa: E402
app.include_router(auth_router)
from routers.tasks import router as tasks_router  # noqa: E402
app.include_router(tasks_router)
from routers.decisions import router as decisions_router  # noqa: E402
app.include_router(decisions_router)
from routers.inbox import router as inbox_router  # noqa: E402
app.include_router(inbox_router)
# Epic 2 Sprint 2 (E2-17 / E2-22): Decision Desk aggregation + nudge action.
from routers.desk import router as desk_router  # noqa: E402
app.include_router(desk_router)
from routers.brief import router as brief_router  # noqa: E402
app.include_router(brief_router)
from routers.team import router as team_router  # noqa: E402
app.include_router(team_router)
# Epic 2 Sprint 8 (E2-67): per-contact outstanding aggregation for CRM pills.
from routers.crm import router as crm_router  # noqa: E402
app.include_router(crm_router)
# Epic 2 Sprint 5 (E2-35 + E2-41): Dex persona endpoints (in-flight
# capture count + unified capture proxy).
from routers.dex import router as dex_router  # noqa: E402
app.include_router(dex_router)
# Epic 1 Batch 2 (RBAC-26 + RBAC-27): acting-as delegation + time-
# bounded elevated permissions.
from routers.access import router as access_router  # noqa: E402
app.include_router(access_router)
# Epic 1 (S3-01, 2026-08-16): Razorpay billing module -- redirect to
# marketing landing page for the actual Checkout; webhook handler on
# our side upgrades tenant.plan on payment.captured.
from routers.billing import router as billing_router  # noqa: E402
app.include_router(billing_router)
# FIX-006-B (S0-02): strict CORS allow-list — no more `allow_origin_regex=".*"`.
# The old default of `*` combined with `allow_credentials=True` was echoed
# back per-origin via `allow_origin_regex='.*'`, which sidesteps the CORS
# spec's ban on wildcard-with-credentials and effectively lets any site
# the user visits make credentialed cross-origin calls carrying their
# auth cookie. Origins now come from CORS_ORIGINS env; in prod (ENV=prod)
# an unset or wildcard list makes config.py refuse to boot.
from config import CORS_ORIGINS as _cors_origins  # noqa: E402
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
    expose_headers=[],
    max_age=600,
)
logger.info(f"CORS allow-list ({len(_cors_origins)} origins): {_cors_origins}")

# FIX-006-B (S0-02): CSRF double-submit cookie enforcement. Middleware
# is always installed so we mint the cookie + log match/mismatch on
# every mutating cookie-authed request. Actual 403 enforcement is
# gated by CSRF_ENFORCE env — defaults OFF this batch so the frontend
# can adopt the X-CSRF-Token header before we start rejecting.
from services.csrf import CSRFMiddleware  # noqa: E402
app.add_middleware(CSRFMiddleware)
from config import CSRF_ENFORCE as _csrf_enforce  # noqa: E402
logger.info(f"CSRF middleware installed (enforce={_csrf_enforce})")


@app.on_event("shutdown")
async def shutdown_db_client():
    # PyMongo AsyncMongoClient.close() is a coroutine — must be awaited.
    await client.close()

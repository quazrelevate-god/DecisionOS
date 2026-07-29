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
import obj_store

from core import (
    db, client, logger, DEFAULT_ROLES,
    EMERGENT_LLM_KEY, CLAUDE_KEY, LLM_MODEL, VISION_MODEL,
    claude_key, get_ai_key, set_ai_keys, ai_key_source, mask_key,
    claude_chat, set_usage_tenant, log_usage, _est_tokens, _OPENAI_STT_PER_MIN,
    AI_KEY_PROVIDERS, load_ai_keys_from_db,
    now_iso, new_id, _extract_json,
    hash_password, verify_password, create_token,
    set_auth_cookie, clear_auth_cookie,
    get_current_user, require_role, require_perm, user_perms, clean_perms,
    tenant_role_keys, log_activity, add_decision_event, normalize_os_blueprint,
    normalize_lexicon, DEFAULT_LEXICON,
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


class OtpVerifyInput(BaseModel):
    phone: str
    code: str


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


TASK_TYPES = {"operational", "sales", "purchase", "production", "finance", "hr", "other"}
TASK_STATUSES = {"blocked", "todo", "in_progress", "waiting", "review", "done", "cancelled"}


class TaskCreateInput(BaseModel):
    title: str
    description: Optional[str] = ""
    assignee_role: Optional[str] = None
    assignee_id: Optional[str] = None
    priority: Optional[str] = "medium"
    due_in_days: Optional[int] = None
    # Operational-task fields (all optional; used by the My Work "New Task" form)
    task_type: Optional[str] = None
    op_category: Optional[str] = None
    support_id: Optional[str] = None
    due_date: Optional[str] = None   # ISO date e.g. "2026-06-15"
    due_time: Optional[str] = None   # "HH:MM"
    expected_output: Optional[str] = None
    approval_required: Optional[bool] = False
    approver_id: Optional[str] = None
    progress: Optional[int] = None
    evidence_required: Optional[bool] = False
    reference_file_ids: Optional[List[str]] = None


class TaskUpdateInput(BaseModel):
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None
    priority: Optional[str] = None
    progress: Optional[int] = None
    evidence_required: Optional[bool] = None


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
INBOX_CLASSES = ("customer", "supplier", "invoice", "payment", "complaint", "task", "approval", "reminder", "decision")


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
                     pipelines: Optional[list] = None, task_categories: Optional[list] = None) -> dict:
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
    prompt = f"Founder directive transcript:\n\"\"\"\n{transcript}\n\"\"\"\nExtract the structured JSON now."
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


async def transcribe_audio(path: str, language: str = "auto") -> str:
    lang, prompt = _stt_lang_prompt(language)
    # Prefer the user's own OpenAI key + newer transcription model (gpt-4o-transcribe).
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
            return resp.text
        except Exception as e:
            logger.warning(f"OpenAI STT ({OPENAI_STT_MODEL}) failed; falling back to Whisper (Emergent key): {e}")
    # Fallback: Whisper via the Emergent universal key (keeps voice capture working if the key is missing/invalid).
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    kwargs = {"model": "whisper-1", "response_format": "json"}
    if lang:
        kwargs["language"] = lang
    if prompt:
        kwargs["prompt"] = prompt
    with open(path, "rb") as f:
        resp = await stt.transcribe(file=f, **kwargs)
    await _log_stt_usage(resp.text, "whisper-1")
    return resp.text


async def _log_stt_usage(transcript: str, model: str):
    # STT bills by audio duration; estimate ~15 chars/sec of speech from the transcript.
    secs = max(1, len(transcript or "") / 15)
    await log_usage("transcribe", "openai", model=model,
                    units=round(secs), unit_type="audio_sec",
                    cost=secs / 60 * _OPENAI_STT_PER_MIN)


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
        if not transcript and note.get("audio_path"):
            transcript = await transcribe_audio(note["audio_path"], note.get("language", "auto"))
            await db.voice_notes.update_one({"id": note_id}, {"$set": {"transcript": transcript}})

        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "structuring"}})
        troles = await tenant_role_keys(tenant_id)
        members = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        om = await tenant_operating_model(tenant_id)
        cat_keys = {c["key"] for c in om["task_categories"]}
        extracted = await ai_extract(transcript or "", session_id=f"extract-{note_id}", allowed_roles=sorted(troles),
                                     members=members, pipelines=om["pipelines"], task_categories=om["task_categories"])

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
            "task_ids": [],
        }
        task_ids, assignee_keys = await _create_decision_tasks(tenant_id, note, decision_id, extracted, troles, members, cat_keys)
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


@api.post("/auth/register")
async def register(inp: RegisterInput, response: Response):
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    tenant_id = new_id()
    set_usage_tenant(tenant_id)
    bp = normalize_os_blueprint(inp.os_blueprint) if inp.os_blueprint else None
    # Departments from the generated OS become the tenant's roles (single source of truth for RBAC).
    provided_roles = [r.model_dump() for r in (inp.roles or [])]
    if not provided_roles and bp and bp["departments"]:
        provided_roles = bp["departments"]
    roles = provided_roles or DEFAULT_ROLES
    # de-dupe + drop any 'owner' role (implicit)
    seen, clean_roles = set(), []
    for r in roles:
        k = r.get("key")
        if k and k != "owner" and k not in seen:
            seen.add(k)
            clean_roles.append({"key": k, "label": r.get("label") or k.replace("_", " ").title()})
    tenant_doc = {
        "id": tenant_id, "name": inp.company_name,
        "industry": inp.industry or "General",
        "description": (inp.description or "").strip(),
        "company_size": inp.company_size or "",
        "region": inp.region or "",
        "currency": (inp.currency or "INR").upper(),
        "gst": inp.gst or "",
        "branches": inp.branches or "",
        "business_scale": inp.business_scale or {},
        "current_software": inp.current_software or [],
        "invited_employees": [],
        "roles": clean_roles or DEFAULT_ROLES,
        "products": [p.model_dump() for p in (inp.products or [])],
        "workflow_templates": bp["workflows"] if bp else [],
        "operational_task_templates": bp["operational_tasks"] if bp else [],
        "approval_rules": bp["approval_rules"] if bp else [],
        "lexicon": await ai_generate_lexicon(inp.industry, inp.company_size, clean_roles, inp.description or ""),
        "operating_model": await ai_generate_operating_model(inp.industry, inp.company_size, clean_roles, inp.description or ""),
        "created_at": now_iso(),
    }
    await db.tenants.insert_one(tenant_doc)
    user_id = new_id()
    await db.users.insert_one({
        "id": user_id, "tenant_id": tenant_id, "name": inp.name, "email": email,
        "phone": (inp.phone or "").strip(),
        "password_hash": hash_password(inp.password), "role": "owner", "created_at": now_iso(),
    })
    token = create_token(user_id, tenant_id, "owner")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    set_auth_cookie(response, token)
    os_summary = {
        "departments": len(clean_roles),
        "workflows": len(tenant_doc["workflow_templates"]),
        "operational_tasks": len(tenant_doc["operational_task_templates"]),
        "approval_rules": len(tenant_doc["approval_rules"]),
    }
    return {"token": token, "user": user, "tenant": tenant, "os_summary": os_summary}


@api.post("/auth/login")
async def login(inp: LoginInput, response: Response):
    email = inp.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(inp.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    set_auth_cookie(response, token)
    return {"token": token, "user": user, "tenant": tenant}


@api.post("/auth/logout")
async def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}


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


async def _issue_otp(norm: str, display_phone: str, enforce_cooldown: bool = True):
    """Generate + store a 6-digit OTP for a normalized phone and (try to) send it."""
    if enforce_cooldown:
        existing = await db.otp_codes.find_one({"phone": norm}, {"_id": 0})
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
        {"phone": norm},
        {"$set": {"phone": norm, "code_hash": _hash_otp(code, norm),
                  "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
                  "created_at": now.isoformat(), "attempts": 0}},
        upsert=True,
    )
    resp = {"sent": sent, "dev_mode": dev}
    if dev:
        resp["dev_otp"] = code  # DEV ONLY — omitted once real SMS (APM/Twilio) is live
    return resp


@api.post("/auth/otp/request")
async def request_otp(inp: OtpRequestInput):
    norm = _norm_phone(inp.phone)
    if len(norm) < 10:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    # Match a registered user by last-10-digit phone
    candidates = await db.users.find({"phone": {"$exists": True, "$ne": ""}}, {"_id": 0, "id": 1, "phone": 1}).to_list(2000)
    match = next((u for u in candidates if _norm_phone(u.get("phone", "")) == norm), None)
    if not match:
        raise HTTPException(status_code=404, detail="No account is registered with this mobile number")
    return await _issue_otp(norm, inp.phone)


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
    resp = await _issue_otp(norm, phone, enforce_cooldown=False)
    resp["phone"] = phone  # returned so the invitee's device can verify
    resp["name"] = user.get("name")
    return resp


@api.post("/auth/otp/verify")
async def verify_otp(inp: OtpVerifyInput, response: Response):
    norm = _norm_phone(inp.phone)
    rec = await db.otp_codes.find_one({"phone": norm}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=400, detail="Request an OTP first")
    if datetime.now(timezone.utc) > datetime.fromisoformat(rec["expires_at"]):
        await db.otp_codes.delete_one({"phone": norm})
        raise HTTPException(status_code=400, detail="OTP expired. Request a new one")
    if rec.get("attempts", 0) >= OTP_MAX_ATTEMPTS:
        await db.otp_codes.delete_one({"phone": norm})
        raise HTTPException(status_code=429, detail="Too many attempts. Request a new OTP")
    if _hash_otp((inp.code or "").strip(), norm) != rec["code_hash"]:
        await db.otp_codes.update_one({"phone": norm}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=401, detail="Incorrect OTP")

    await db.otp_codes.delete_one({"phone": norm})
    candidates = await db.users.find({"phone": {"$exists": True, "$ne": ""}}).to_list(2000)
    user = next((u for u in candidates if _norm_phone(u.get("phone", "")) == norm), None)
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    set_auth_cookie(response, token)
    return {"token": token, "user": user, "tenant": tenant}



@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    if tenant and not tenant.get("lexicon"):
        # Backfill industry vocabulary once for pre-existing workspaces.
        lex = await ai_generate_lexicon(tenant.get("industry"), tenant.get("company_size"), tenant.get("roles"), tenant.get("description") or "")
        await db.tenants.update_one({"id": tenant["id"]}, {"$set": {"lexicon": lex}})
        tenant["lexicon"] = lex
    if tenant and not (tenant.get("operating_model") or {}).get("pipelines"):
        # Backfill the industry operating model (pipelines + task categories) once,
        # preserving any pipeline/category that already has data (non-destructive).
        om = await backfill_operating_model(tenant)
        await db.tenants.update_one({"id": tenant["id"]}, {"$set": {"operating_model": om}})
        tenant["operating_model"] = om
    return {"user": user, "tenant": tenant}


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
    om = await backfill_operating_model(tenant)
    await db.tenants.update_one({"id": user["tenant_id"]}, {"$set": {"operating_model": om}})
    await log_activity(user["tenant_id"], user["id"], "operating_model_regenerated", f"{user['name']} regenerated the operating model")
    return await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})


class ProfileUpdateInput(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    language: Optional[str] = None


class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


@api.patch("/auth/profile")
async def update_profile(inp: ProfileUpdateInput, user: dict = Depends(get_current_user)):
    updates = {}
    if inp.name is not None and inp.name.strip():
        updates["name"] = inp.name.strip()
    if inp.phone is not None:
        # Changing your number should re-enable WhatsApp matching for it.
        updates["phone"] = inp.phone.strip()
        updates["wa_phone_obsolete"] = False
    if inp.language is not None and inp.language in ("en", "hi", "ta"):
        updates["language"] = inp.language
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = now_iso()
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0, "password": 0})
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"user": fresh, "tenant": tenant}


@api.post("/auth/change-password")
async def change_password(inp: ChangePasswordInput, user: dict = Depends(get_current_user)):
    if user.get("passwordless"):
        raise HTTPException(status_code=400, detail="Your account signs in with mobile OTP and has no password to change.")
    full = await db.users.find_one({"id": user["id"]})
    if not full or not verify_password(inp.current_password, full.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if inp.new_password == inp.current_password:
        raise HTTPException(status_code=400, detail="New password must be different from your current password")
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(inp.new_password), "updated_at": now_iso()}},
    )
    return {"ok": True}


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
@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    users = await db.users.find({"tenant_id": user["tenant_id"]}, {"_id": 0, "password_hash": 0, "invite_token": 0, "invite_expires_at": 0}).to_list(500)
    return users


@api.post("/users")
async def create_user(inp: UserCreateInput, user: dict = Depends(require_perm("team_manage"))):
    role_keys = await tenant_role_keys(user["tenant_id"])
    if inp.role == "owner":
        if user.get("role") != "owner":
            raise HTTPException(status_code=403, detail="Only an owner can create another owner")
    elif inp.role not in role_keys:
        raise HTTPException(status_code=400, detail="Invalid role")
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    phone = (inp.phone or "").strip()
    pwd = (inp.password or "").strip()
    passwordless = not pwd
    if passwordless:
        if len(_norm_phone(phone)) < 10:
            raise HTTPException(status_code=400, detail="A valid mobile number is required for passwordless (OTP) members")
        # No usable password — this member logs in only via mobile OTP.
        password_hash = hash_password(new_id() + new_id())
    else:
        if len(pwd) < 6:
            raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
        password_hash = hash_password(pwd)
    uid = new_id()
    invite_token = None
    doc = {
        "id": uid, "tenant_id": user["tenant_id"], "name": inp.name, "email": email,
        "phone": phone, "passwordless": passwordless,
        "password_hash": password_hash, "role": inp.role,
        "permissions": clean_perms(inp.permissions), "created_at": now_iso(),
    }
    if inp.reporting_manager_id:
        mgr = await db.users.find_one({"id": inp.reporting_manager_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
        if mgr:
            doc["reporting_manager_id"] = inp.reporting_manager_id
    if len(_norm_phone(phone)) >= 10:
        invite_token = new_id()
        doc["invite_token"] = invite_token
        doc["invite_expires_at"] = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    await db.users.insert_one(doc)
    await log_activity(user["tenant_id"], user["id"], "user_added",
                       f"Added {inp.name} as {inp.role}" + (" (mobile OTP login)" if passwordless else ""))
    out = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
    if invite_token:
        out["invite_token"] = invite_token
    return out


@api.post("/users/{user_id}/invite")
async def regenerate_invite(user_id: str, user: dict = Depends(require_perm("team_manage"))):
    target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    if len(_norm_phone(target.get("phone", ""))) < 10:
        raise HTTPException(status_code=400, detail="Add a mobile number for this member first")
    token = new_id()
    await db.users.update_one({"id": user_id}, {"$set": {
        "invite_token": token,
        "invite_expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    }})
    return {"invite_token": token, "name": target.get("name"), "phone_masked": _mask_phone(target.get("phone", ""))}


@api.patch("/users/{user_id}")
async def update_user(user_id: str, inp: UserUpdateInput, user: dict = Depends(require_perm("team_manage"))):
    target = await db.users.find_one({"id": user_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Member not found")
    acting_is_owner = user.get("role") == "owner"
    # Only an owner may change another owner's access (e.g. to demote them).
    if target["role"] == "owner" and not acting_is_owner:
        raise HTTPException(status_code=403, detail="Only an owner can change another owner's access")
    updates = {}
    new_role = target["role"]
    if inp.role is not None and inp.role != target["role"]:
        role_keys = await tenant_role_keys(user["tenant_id"])
        if inp.role == "owner":
            if not acting_is_owner:
                raise HTTPException(status_code=403, detail="Only an owner can grant the Owner role")
        else:
            if inp.role not in role_keys:
                raise HTTPException(status_code=400, detail="Invalid role")
            # Never leave the company without an owner.
            if target["role"] == "owner":
                owner_count = await db.users.count_documents({"tenant_id": user["tenant_id"], "role": "owner"})
                if owner_count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot demote the last owner — assign another owner first")
        new_role = inp.role
        updates["role"] = inp.role
    if inp.permissions is not None:
        updates["permissions"] = clean_perms(inp.permissions)
    if new_role == "owner":
        updates["permissions"] = list(PERMISSION_KEYS)
    if inp.phone is not None:
        updates["phone"] = inp.phone.strip()
    if inp.reporting_manager_id is not None:
        rm = inp.reporting_manager_id.strip()
        if rm and rm != user_id:
            mgr = await db.users.find_one({"id": rm, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
            updates["reporting_manager_id"] = rm if mgr else None
        else:
            updates["reporting_manager_id"] = None
    if updates:
        await db.users.update_one({"id": user_id}, {"$set": updates})
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


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
    doc = {
        "id": cid, "tenant_id": user["tenant_id"], "type": inp.type, "name": inp.name,
        "company": inp.company or "", "phone": inp.phone or "", "email": inp.email or "",
        "address": inp.address or "", "tax_id": inp.tax_id or "", "tags": inp.tags or [],
        "status": status, "assigned_id": inp.assigned_id, "notes": inp.notes or "",
        "birthday": inp.birthday or "",
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
    if updates:
        await db.contacts.update_one({"id": contact_id}, {"$set": updates})
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
async def create_voice_note(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(require_perm("voice_capture"))):
    note_id = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    path = UPLOAD_DIR / f"{note_id}.{ext}"
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "audio", "audio_path": str(path), "transcript": None, "language": language,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}


@api.post("/transcribe")
async def transcribe_only(file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(get_current_user)):
    """Dictation helper: transcribe a short audio clip to text (no note/decision is created)."""
    tmp_id = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    path = UPLOAD_DIR / f"dictation-{tmp_id}.{ext}"
    with open(path, "wb") as f:
        f.write(await file.read())
    try:
        text = await transcribe_audio(str(path), language)
    except Exception as e:
        logger.error(f"transcribe_only failed: {e}")
        raise HTTPException(status_code=503, detail="Couldn't transcribe audio. Please try again.")
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
    return {"text": (text or "").strip()}



@api.post("/voice-notes/text")
async def create_text_note(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_perm("voice_capture"))):
    note_id = new_id()
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "text", "audio_path": None, "transcript": inp.text, "language": inp.language or "auto",
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
    except Exception as e:
        logger.exception("process_meeting failed")
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "failed", "error": str(e)}})


@api.post("/meetings")
async def create_meeting(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(get_current_user)):
    mid = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    path = UPLOAD_DIR / f"meeting-{mid}.{ext}"
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    await db.meetings.insert_one({
        "id": mid, "tenant_id": user["tenant_id"], "created_by": user["id"], "created_by_name": user.get("name"),
        "kind": "audio", "audio_path": str(path), "transcript": None, "language": language,
        "title": "Processing meeting…", "summary": "", "key_points": [], "decisions": [], "action_items": [],
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_meeting, mid)
    return {"id": mid, "status": "queued"}


@api.post("/meetings/text")
async def create_meeting_text(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(get_current_user)):
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
async def enrich_decision(d: dict) -> dict:
    tasks = await db.tasks.find({"id": {"$in": d.get("task_ids", [])}}, {"_id": 0}).to_list(200)
    creator = await db.users.find_one({"id": d.get("created_by")}, {"_id": 0, "name": 1})
    d["tasks"] = await enrich_tasks(tasks)
    d["created_by_name"] = creator["name"] if creator else "Unknown"
    return d


async def enrich_decisions(decisions: list) -> list:
    task_ids = list({tid for d in decisions for tid in d.get("task_ids", [])})
    creator_ids = list({d.get("created_by") for d in decisions if d.get("created_by")})
    tasks_map = {}
    if task_ids:
        for t in await enrich_tasks(await db.tasks.find({"id": {"$in": task_ids}}, {"_id": 0}).to_list(2000)):
            tasks_map[t["id"]] = t
    users_map = {}
    if creator_ids:
        for u in await db.users.find({"id": {"$in": creator_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            users_map[u["id"]] = u["name"]
    for d in decisions:
        d["tasks"] = [tasks_map[t] for t in d.get("task_ids", []) if t in tasks_map]
        d["created_by_name"] = users_map.get(d.get("created_by"), "Unknown")
        d.setdefault("dtype", "directive")
        d.setdefault("confidence", None)
    return decisions


@api.get("/decisions")
async def list_decisions(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    decisions = await db.decisions.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return await enrich_decisions(decisions)


@api.get("/decisions/{decision_id}")
async def get_decision(decision_id: str, user: dict = Depends(get_current_user)):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if user["id"] not in await _decision_participants(user["tenant_id"], d):
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    return await enrich_decision(d)


@api.get("/decisions/{decision_id}/timeline")
async def decision_timeline(decision_id: str, user: dict = Depends(get_current_user)):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]},
                                    {"_id": 0, "id": 1, "title": 1, "status": 1, "timeline": 1, "created_by": 1})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if user["id"] not in await _decision_participants(user["tenant_id"], d):
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    tl = sorted(d.get("timeline", []), key=lambda e: e.get("ts", ""))
    return {"title": d.get("title"), "status": d.get("status"), "timeline": tl}


@api.get("/journal")
async def ceo_journal(q: str = "", user: dict = Depends(require_perm("brain"))):
    tid = user["tenant_id"]
    tokens = [re.escape(t) for t in q.split() if len(t) >= 2]
    rx = {"$regex": "|".join(tokens), "$options": "i"} if tokens else {"$exists": True}
    dfilter = {"tenant_id": tid, "$or": [{"title": rx}, {"summary": rx}]} if tokens else {"tenant_id": tid}
    decisions = await db.decisions.find(dfilter, {"_id": 0, "id": 1, "title": 1, "dtype": 1, "status": 1, "created_at": 1}).sort("created_at", -1).to_list(500)
    mfilter = {"tenant_id": tid, "text": rx} if tokens else {"tenant_id": tid}
    memory = await db.memory.find(mfilter, {"_id": 0, "id": 1, "text": 1, "tag": 1, "created_at": 1}).sort("created_at", -1).to_list(500)
    days = {}
    for d in decisions:
        day = (d.get("created_at") or "")[:10]
        days.setdefault(day, {"date": day, "decisions": [], "notes": []})["decisions"].append(d)
    for m in memory:
        day = (m.get("created_at") or "")[:10]
        days.setdefault(day, {"date": day, "decisions": [], "notes": []})["notes"].append(m)
    return {"days": sorted(days.values(), key=lambda x: x["date"], reverse=True)}




@api.post("/decisions/{decision_id}/tasks")
async def add_decision_task(decision_id: str, inp: TaskCreateInput, user: dict = Depends(require_perm("decisions_approve"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    troles = await tenant_role_keys(user["tenant_id"])
    assignee_id = inp.assignee_id
    role = inp.assignee_role if inp.assignee_role in troles else None
    if assignee_id:
        member = await db.users.find_one({"id": assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1, "name": 1})
        if not member:
            assignee_id = None
        else:
            role = member["role"]
    due = None
    if isinstance(inp.due_in_days, int):
        due = (datetime.now(timezone.utc) + timedelta(days=inp.due_in_days)).isoformat()
    # Blocked while the decision is still pending; unblocks on approval like the rest.
    status = "blocked" if d.get("status") == "pending_approval" else ("cancelled" if d.get("status") == "rejected" else "todo")
    tid = new_id()
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": role, "assignee_id": assignee_id, "priority": inp.priority or "medium",
        "status": status, "due_date": due, "decision_id": decision_id, "source": "manual", "created_at": now_iso(),
    })
    await db.decisions.update_one({"id": decision_id}, {"$push": {"task_ids": tid}})
    who = None
    if assignee_id:
        who = (member or {}).get("name")
    who = who or role or "team"
    await add_decision_event(decision_id, f"Task added for {who}: {inp.title}", user["name"], "assigned")
    await log_activity(user["tenant_id"], user["id"], "decision_task_added",
                       f"Added task '{inp.title}' to '{d['title']}' for {who}", "decision", decision_id)
    return await enrich_decision(await db.decisions.find_one({"id": decision_id}, {"_id": 0}))



@api.post("/decisions/{decision_id}/approve")
async def approve_decision(decision_id: str, user: dict = Depends(require_perm("decisions_approve"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "approved", "decided_at": now_iso()}})
    await db.tasks.update_many({"decision_id": decision_id, "status": "blocked"}, {"$set": {"status": "todo"}})
    await add_decision_event(decision_id, "Approved — tasks unblocked", user["name"], "approved")
    # Auto-advance any Procurement (purchase_payment) workflows spawned by this decision from requested → approved.
    wf_advanced = 0
    async for wf in db.workflows.find({"tenant_id": user["tenant_id"], "decision_id": decision_id, "type": "purchase_payment", "stage": "requested"}):
        entry = {"stage": "approved", "note": f"Auto-approved with decision by {user['name']}", "by": user["id"], "at": now_iso()}
        await db.workflows.update_one({"id": wf["id"]}, {"$set": {"stage": "approved"}, "$push": {"history": entry}})
        wf_advanced += 1
    if wf_advanced:
        await add_decision_event(decision_id, f"{wf_advanced} procurement workflow(s) advanced to Approved", user["name"], "workflow")
    for t in await db.tasks.find({"decision_id": decision_id}, {"_id": 0}).to_list(100):
        who = None
        if t.get("assignee_id"):
            m = await db.users.find_one({"id": t["assignee_id"]}, {"_id": 0, "name": 1})
            who = (m or {}).get("name")
        who = who or t.get("assignee_role") or "team"
        await add_decision_event(decision_id, f"Task assigned to {who}: {t['title']}", user["name"], "assigned")
    await log_activity(user["tenant_id"], user["id"], "decision_approved", f"Approved '{d['title']}' — tasks unblocked", "decision", decision_id)
    return await enrich_decision(await db.decisions.find_one({"id": decision_id}, {"_id": 0}))


@api.post("/decisions/{decision_id}/reject")
async def reject_decision(decision_id: str, user: dict = Depends(require_perm("decisions_approve"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "rejected", "decided_at": now_iso()}})
    # Remove everything this decision spawned so it disappears from all tasks & processes.
    tasks_del = await db.tasks.delete_many({"tenant_id": user["tenant_id"], "decision_id": decision_id})
    wf_del = await db.workflows.delete_many({"tenant_id": user["tenant_id"], "decision_id": decision_id})
    await db.calendar_events.delete_many({"tenant_id": user["tenant_id"], "decision_id": decision_id})
    await db.inbox.update_many({"tenant_id": user["tenant_id"], "ref_type": "decision", "ref_id": decision_id}, {"$set": {"status": "dismissed"}})
    await add_decision_event(decision_id, f"Rejected — removed {tasks_del.deleted_count} task(s), {wf_del.deleted_count} workflow(s)", user["name"], "rejected")
    await log_activity(user["tenant_id"], user["id"], "decision_rejected", f"Rejected '{d['title']}' — removed {tasks_del.deleted_count} task(s), {wf_del.deleted_count} workflow(s)", "decision", decision_id)
    return await enrich_decision(await db.decisions.find_one({"id": decision_id}, {"_id": 0}))


class DecisionCommentInput(BaseModel):
    text: str


async def _decision_participants(tenant_id: str, d: dict) -> set:
    """Everyone involved with a decision: creator, task assignees, and owners."""
    ids = set(await _owner_ids(tenant_id))
    if d.get("created_by"):
        ids.add(d["created_by"])
    async for t in db.tasks.find({"decision_id": d["id"]}, {"_id": 0, "assignee_id": 1}):
        if t.get("assignee_id"):
            ids.add(t["assignee_id"])
    return ids


@api.post("/decisions/{decision_id}/comment")
async def comment_decision(decision_id: str, inp: DecisionCommentInput, user: dict = Depends(get_current_user)):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    participants = await _decision_participants(user["tenant_id"], d)
    if user["id"] not in participants:
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    entry = {"ts": now_iso(), "label": text, "actor": user.get("name"), "actor_id": user["id"], "kind": "comment"}
    await db.decisions.update_one({"id": decision_id}, {"$push": {"timeline": entry}})
    recipients = [p for p in participants if p != user["id"]]
    if recipients:
        await push_notification(user["tenant_id"], recipients, 1,
                                f"New comment on '{d['title']}' from {user['name']}: {text[:100]}",
                                "decision", decision_id, ntype="comment", title=d["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "decision_comment", f"Commented on '{d['title']}'", "decision", decision_id)
    return await enrich_decision(await db.decisions.find_one({"id": decision_id}, {"_id": 0}))


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
def _derive_task_type(t: dict) -> str:
    # Any stored category key (dynamic per tenant) passes through; else fall back to role, else 'other'.
    if t.get("task_type"):
        return t["task_type"]
    r = t.get("assignee_role")
    if r in ("sales", "finance", "production", "purchase"):
        return r
    return "other"


def _task_activity(t: dict):
    """Return (updated_at_iso, human_label) — persisted values if present, else derived from history."""
    if t.get("updated_at") and t.get("last_action"):
        return t["updated_at"], t["last_action"]
    cand = []
    if t.get("created_at"):
        cand.append((t["created_at"], "Created"))
    for u in (t.get("updates") or []):
        lbl = {"note": "Note added", "handoff": "Handed off", "escalate": "Escalated"}.get(u.get("kind"), "Updated")
        if u.get("created_at"):
            cand.append((u["created_at"], lbl))
    ep = t.get("execution_plan") or {}
    if ep.get("updated_at"):
        cand.append((ep["updated_at"], "Execution plan updated"))
    for a in (t.get("attachments") or []):
        if a.get("at"):
            cand.append((a["at"], "Attachment added"))
    if t.get("approved_at"):
        cand.append((t["approved_at"], "Approved"))
    if t.get("rejected_at"):
        cand.append((t["rejected_at"], "Changes requested"))
    if not cand:
        return t.get("created_at"), "Created"
    cand.sort(key=lambda x: x[0])
    return cand[-1]


async def enrich_task(t: dict) -> dict:
    if not t:
        return t
    ids = list({t.get(k) for k in ("assignee_id", "support_id", "approver_id", "created_by") if t.get(k)})
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(50):
            umap[u["id"]] = u["name"]
    t["assignee_name"] = umap.get(t.get("assignee_id"))
    t["support_name"] = umap.get(t.get("support_id"))
    t["approver_name"] = umap.get(t.get("approver_id"))
    t["created_by_name"] = umap.get(t.get("created_by"))
    t["attachment_count"] = len(t.get("attachments") or [])
    t["task_type"] = _derive_task_type(t)
    at, action = _task_activity(t)
    t["updated_at"], t["last_action"] = at, action
    return t


async def enrich_tasks(tasks: list) -> list:
    ids = set()
    for t in tasks:
        for k in ("assignee_id", "support_id", "approver_id", "created_by"):
            if t.get(k):
                ids.add(t[k])
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            umap[u["id"]] = u["name"]
    for t in tasks:
        t["assignee_name"] = umap.get(t.get("assignee_id"))
        t["support_name"] = umap.get(t.get("support_id"))
        t["approver_name"] = umap.get(t.get("approver_id"))
        t["created_by_name"] = umap.get(t.get("created_by"))
        t["attachment_count"] = len(t.get("attachments") or [])
        t["task_type"] = _derive_task_type(t)
        at, action = _task_activity(t)
        t["updated_at"], t["last_action"] = at, action
    return tasks


@api.get("/tasks")
async def list_tasks(status: Optional[str] = None, mine: Optional[bool] = False, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    # ?mine=true (My Work / personal): only tasks assigned to ME + unclaimed role-pool tasks.
    #   Excludes tasks assigned to other specific members of my role.
    # Non-owner team board (mine=false): the whole role lane (any member of my role + role-level tasks).
    # Owner (mine=false): everything.
    if mine:
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_id": None, "assignee_role": user["role"]}]
    elif user["role"] != "owner":
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]
    tasks = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await enrich_tasks(tasks)


@api.post("/tasks")
async def create_task(inp: TaskCreateInput, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    tid = new_id()
    due = None
    if inp.due_date:
        due = f"{inp.due_date}T{inp.due_time}:00" if inp.due_time else inp.due_date
    elif isinstance(inp.due_in_days, int):
        due = (datetime.now(timezone.utc) + timedelta(days=inp.due_in_days)).isoformat()
    troles = await tenant_role_keys(user["tenant_id"])
    assignee_id = inp.assignee_id
    role = inp.assignee_role if inp.assignee_role in troles else None
    if assignee_id:
        member = await db.users.find_one({"id": assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1})
        if not member:
            assignee_id = None
        elif not role:
            role = member["role"]
    if not assignee_id and role:
        # Smart assignment: route a role-level task to the least-loaded member of that role.
        assignee_id = await pick_least_loaded_member(user["tenant_id"], role)
    task_type = (inp.task_type or "").strip() or None
    support_id = inp.support_id if inp.support_id and await db.users.find_one({"id": inp.support_id, "tenant_id": user["tenant_id"]}, {"_id": 0}) else None
    approver_id = inp.approver_id if inp.approver_id and await db.users.find_one({"id": inp.approver_id, "tenant_id": user["tenant_id"]}, {"_id": 0}) else None
    progress = max(0, min(100, inp.progress)) if isinstance(inp.progress, int) else 0
    needs_approval = bool(inp.approval_required)
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": role, "assignee_id": assignee_id, "priority": inp.priority or "medium",
        "status": "blocked" if needs_approval else "todo", "due_date": due, "decision_id": None,
        "source": "manual", "created_at": now_iso(),
        "task_type": task_type, "op_category": inp.op_category or None, "support_id": support_id,
        "expected_output": inp.expected_output or None, "approval_required": needs_approval,
        "approval_status": "pending" if needs_approval else None,
        "approver_id": approver_id, "progress": progress, "created_by": user["id"],
        "evidence_required": bool(inp.evidence_required),
        "updated_at": now_iso(), "last_action": "Created",
    })
    if inp.reference_file_ids:
        await _attach_reference_ids(user["tenant_id"], user["id"], tid, inp.reference_file_ids, background)
    if needs_approval:
        approvers = [approver_id] if approver_id else await _approver_ids(user["tenant_id"])
        await push_notification(user["tenant_id"], approvers, 2,
                                f"Approval needed before work starts: '{inp.title}'", "task", tid,
                                ntype="approval", title=inp.title, sender=user["name"])
    elif assignee_id and assignee_id != user["id"]:
        await push_notification(user["tenant_id"], [assignee_id], 1,
                                f"New work assigned: '{inp.title}'", "task", tid,
                                ntype="assigned", title=inp.title, sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_created", f"Created task '{inp.title}'", "task", tid)
    return await enrich_task(await db.tasks.find_one({"id": tid}, {"_id": 0}))


@api.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can delete tasks")
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    await db.tasks.delete_one({"id": task_id, "tenant_id": user["tenant_id"]})
    return {"ok": True, "deleted": task_id}


@api.patch("/tasks/{task_id}")
async def update_task(task_id: str, inp: TaskUpdateInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {k: v for k, v in inp.model_dump(exclude_unset=True).items() if v is not None}
    if "status" in updates and updates["status"] not in TASK_STATUSES:
        updates.pop("status")
    if "progress" in updates:
        updates["progress"] = max(0, min(100, int(updates["progress"])))
    if updates.get("status") == "done":
        updates["progress"] = 100
    # Completion-evidence gate: tasks flagged evidence_required need >=1 evidence file before "done".
    if updates.get("status") == "done" and t.get("evidence_required"):
        has_ev = any((a or {}).get("kind") == "evidence" for a in (t.get("attachments") or []))
        if not has_ev:
            raise HTTPException(status_code=400,
                                detail="This task requires completion evidence — attach at least one file before marking it done.")
    # Pre-execution approval gate: a task requiring approval is locked (status "blocked")
    # until the approver approves it. The assignee cannot change status/progress before then.
    if t.get("approval_required") and t.get("approval_status") != "approved":
        if any(k in updates for k in ("status", "progress")):
            raise HTTPException(status_code=403, detail="This task is awaiting approval before work can begin.")
    if "assignee_role" in updates and updates["assignee_role"] not in await tenant_role_keys(user["tenant_id"]):
        updates.pop("assignee_role")
    if updates.get("assignee_id"):
        member = await db.users.find_one({"id": updates["assignee_id"], "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1})
        if not member:
            updates.pop("assignee_id")
        else:
            updates["assignee_role"] = member["role"]
    if updates:
        if "status" in updates:
            updates["last_action"] = f"Status → {updates['status'].replace('_', ' ')}"
        elif updates.get("assignee_id"):
            updates["last_action"] = "Reassigned"
        elif "progress" in updates:
            updates["last_action"] = f"Progress {updates['progress']}%"
        else:
            updates["last_action"] = "Updated"
        updates["updated_at"] = now_iso()
        await db.tasks.update_one({"id": task_id}, {"$set": updates})
        if updates.get("assignee_id") and updates["assignee_id"] != user["id"]:
            await push_notification(user["tenant_id"], [updates["assignee_id"]], 1,
                                    f"Work assigned to you: '{t['title']}'", "task", task_id,
                                    ntype="assigned", title=t["title"], sender=user["name"])
        if updates.get("status") and updates["status"] != t.get("status"):
            watchers = [w for w in ([t.get("created_by")] + await _owner_ids(user["tenant_id"])) if w and w != user["id"]]
            await push_notification(user["tenant_id"], watchers, 1,
                                    f"Status update on '{t['title']}': {updates['status'].replace('_', ' ')}", "task", task_id,
                                    ntype="status", title=t["title"], sender=user["name"])
        if updates.get("status") and t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → {updates['status'].replace('_',' ')}", user["name"], "task")
        if updates.get("status") == "done":
            await log_activity(user["tenant_id"], user["id"], "task_done", f"Completed task '{t['title']}'", "task", task_id)
        elif updates.get("assignee_id"):
            member = await db.users.find_one({"id": updates["assignee_id"]}, {"_id": 0, "name": 1})
            await log_activity(user["tenant_id"], user["id"], "task_assigned",
                               f"Assigned '{t['title']}' to {(member or {}).get('name', 'a member')}", "task", task_id)
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


class TaskReassignInput(BaseModel):
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None


@api.post("/tasks/{task_id}/reassign")
async def reassign_task(task_id: str, inp: TaskReassignInput, user: dict = Depends(get_current_user)):
    """Change who a task is assigned to — a specific member or a whole role/team."""
    perms = user_perms(user)
    if not (user["role"] == "owner" or "team_manage" in perms or "decisions_approve" in perms):
        raise HTTPException(status_code=403, detail="You can't reassign this task")
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {"updated_at": now_iso(), "last_action": "Reassigned"}
    new_assignee_id = None
    if inp.assignee_id:
        member = await db.users.find_one({"id": inp.assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1, "name": 1})
        if not member:
            raise HTTPException(status_code=400, detail="Member not found")
        updates["assignee_id"] = inp.assignee_id
        updates["assignee_role"] = member["role"]
        new_assignee_id = inp.assignee_id
        who = member["name"]
    elif inp.assignee_role:
        if inp.assignee_role not in await tenant_role_keys(user["tenant_id"]):
            raise HTTPException(status_code=400, detail="Invalid role")
        updates["assignee_id"] = None
        updates["assignee_role"] = inp.assignee_role
        who = inp.assignee_role
    else:
        raise HTTPException(status_code=400, detail="Pick a member or a role")
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    if new_assignee_id and new_assignee_id != user["id"]:
        await push_notification(user["tenant_id"], [new_assignee_id], 1,
                                f"Work assigned to you: '{t['title']}'", "task", task_id,
                                ntype="assigned", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_assigned", f"Reassigned '{t['title']}' to {who}", "task", task_id)
    if t.get("decision_id"):
        await add_decision_event(t["decision_id"], f"{t['title']} reassigned to {who}", user["name"], "task")
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


class TaskRejectInput(BaseModel):
    reason: Optional[str] = ""


def _can_approve_task(user: dict, t: dict) -> bool:
    if user["role"] == "owner":
        return True
    if t.get("approver_id"):
        return user["id"] == t.get("approver_id")
    # No specific approver assigned → anyone granted the "approvals" access can approve.
    return "approvals" in user_perms(user)


@api.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("approval_required"):
        raise HTTPException(status_code=400, detail="This task doesn't require approval")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can approve this task")
    # Pre-execution approval: unlock the task so the assignee can start working on it.
    new_status = "todo" if t.get("status") == "blocked" else t.get("status")
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "status": new_status, "approval_status": "approved",
        "approved_by": user["id"], "approved_at": now_iso(),
        "updated_at": now_iso(), "last_action": "Approved — work can start",
    }})
    if t.get("assignee_id"):
        await push_notification(user["tenant_id"], [t["assignee_id"]], 1, f"Approved: you can start '{t['title']}'", "task", task_id,
                                ntype="approved", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_approved", f"Approved '{t['title']}'", "task", task_id)
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@api.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str, inp: TaskRejectInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("approval_required"):
        raise HTTPException(status_code=400, detail="This task doesn't require approval")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can reject this task")
    reason = (inp.reason or "").strip()
    # Keep the task locked (blocked) so work still cannot start until it's approved.
    await db.tasks.update_one({"id": task_id}, {"$set": {
        "status": "blocked", "approval_status": "rejected",
        "rejected_by": user["id"], "rejected_at": now_iso(), "rejection_reason": reason,
        "updated_at": now_iso(), "last_action": "Changes requested",
    }})
    msg = f"Changes requested on '{t['title']}' by {user['name']}" + (f": {reason}" if reason else "")
    if t.get("assignee_id"):
        await push_notification(user["tenant_id"], [t["assignee_id"]], 2, msg, "task", task_id,
                                ntype="rejected", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_rejected", f"Requested changes on '{t['title']}'", "task", task_id)
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@api.post("/tasks/{task_id}/clarify")
async def clarify_task(task_id: str, inp: TaskRejectInput, user: dict = Depends(get_current_user)):
    """Approver/owner asks the assignee a clarifying question; the task stays locked until approved."""
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can request clarification")
    note = (inp.reason or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="Add what you need clarified")
    await db.tasks.update_one({"id": task_id}, {"$set": {"updated_at": now_iso(), "last_action": "Clarification requested"}})
    await db.tasks.update_one({"id": task_id}, {"$push": {"updates": {
        "id": new_id(), "kind": "note", "text": f"Clarification requested: {note}",
        "step_id": None, "step_text": None, "author_id": user["id"], "author_name": user.get("name"),
        "to_id": t.get("assignee_id"), "to_role": None, "to_name": t.get("assignee_name"),
        "followup_task_id": None, "created_at": now_iso(),
    }}})
    if t.get("assignee_id"):
        await push_notification(user["tenant_id"], [t["assignee_id"]], 2,
                                f"Clarification needed on '{t['title']}': {note[:120]}", "task", task_id,
                                ntype="clarification", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_clarify", f"Requested clarification on '{t['title']}'", "task", task_id)
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@api.get("/tasks/{task_id}")
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = (user.get("role") == "owner" or _can_work_task(user, t)
               or t.get("approver_id") == user["id"] or t.get("created_by") == user["id"]
               or t.get("support_id") == user["id"])
    if not allowed:
        raise HTTPException(status_code=403, detail="You don't have access to this work")
    return await enrich_task(t)


# ---------------------------------------------------------------------------
# AI Execution Guide
# ---------------------------------------------------------------------------
class ExecStep(BaseModel):
    id: Optional[str] = None
    text: str
    done: Optional[bool] = False


class ExecPlanInput(BaseModel):
    steps: List[ExecStep]
    status: Optional[str] = None


class StepAskInput(BaseModel):
    step_text: str


def _can_work_task(user: dict, t: dict) -> bool:
    return (user.get("role") == "owner"
            or t.get("assignee_id") == user["id"]
            or (t.get("assignee_role") and t.get("assignee_role") == user.get("role")))


def _plan_progress(steps: list) -> int:
    if not steps:
        return 0
    done = sum(1 for s in steps if s.get("done"))
    return round(done / len(steps) * 100)


async def _tenant_industry(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "industry": 1})
    return (t or {}).get("industry") or "general"


@api.post("/tasks/{task_id}/execution-plan/generate")
async def generate_execution_plan(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can plan this task")
    if t.get("approval_required") and t.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="This task must be approved before you can plan it.")
    industry = await _tenant_industry(user["tenant_id"])
    currency = await _tenant_currency(user["tenant_id"])
    gen = await ai_execution_plan(t, industry, currency, session_id=f"exec-{task_id}")
    steps = [{"id": new_id(), "text": s, "done": False} for s in gen["steps"]]
    plan = {"status": "draft", "task_type": gen["task_type"], "steps": steps,
            "progress": 0, "generated_at": now_iso(), "updated_at": now_iso()}
    await db.tasks.update_one({"id": task_id}, {"$set": {"execution_plan": plan}})
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@api.patch("/tasks/{task_id}/execution-plan")
async def save_execution_plan(task_id: str, inp: ExecPlanInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can edit this plan")
    if t.get("approval_required") and t.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="This task must be approved before you can plan it.")
    steps = [{"id": s.id or new_id(), "text": s.text.strip(), "done": bool(s.done)}
             for s in inp.steps if s.text.strip()]
    existing = t.get("execution_plan") or {}
    plan = {
        "status": inp.status or existing.get("status") or "draft",
        "task_type": existing.get("task_type", "generic"),
        "steps": steps, "progress": _plan_progress(steps),
        "generated_at": existing.get("generated_at") or now_iso(), "updated_at": now_iso(),
    }
    updates = {"execution_plan": plan}
    # Keep the task board in sync: starting work moves a todo task into progress; finishing all steps can complete it.
    if plan["status"] == "accepted" and steps:
        if plan["progress"] == 100 and t.get("status") not in ("done", "blocked"):
            updates["status"] = "done"
        elif plan["progress"] > 0 and t.get("status") == "todo":
            updates["status"] = "in_progress"
    await db.tasks.update_one({"id": task_id}, {"$set": updates})
    if updates.get("status") == "done":
        await log_activity(user["tenant_id"], user["id"], "task_done", f"Completed task '{t['title']}'", "task", task_id)
        if t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → done", user["name"], "task")
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@api.delete("/tasks/{task_id}/execution-plan")
async def delete_execution_plan(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can clear this plan")
    await db.tasks.update_one({"id": task_id}, {"$unset": {"execution_plan": ""}, "$set": {"updated_at": now_iso()}})
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


@api.post("/tasks/{task_id}/steps/ask")
async def ask_step_ai(task_id: str, inp: StepAskInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can use this")
    industry = await _tenant_industry(user["tenant_id"])
    return await ai_step_assist(t, inp.step_text, industry, session_id=f"step-{task_id}")


class TaskUpdateNoteInput(BaseModel):
    text: str
    step_id: Optional[str] = None
    action: str = "note"  # "note" | "handoff" | "escalate"
    to_id: Optional[str] = None      # member id (handoff to a person)
    to_role: Optional[str] = None    # role key (handoff to a team)


async def _resolve_task_handoff(user, t, task_id, action, text, step_text, inp):
    """Resolve the target for a handoff/escalation and create the follow-up task."""
    tenant_id = user["tenant_id"]
    to_name = to_id = to_role = None
    notify_level, notify_prefix = 2, "[Handoff]"
    if action == "escalate":
        owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=400, detail="No owner to escalate to")
        to_id, to_name, to_role = owner["id"], owner.get("name"), "owner"
        notify_level, notify_prefix = 3, "[Escalation]"
    elif inp.to_id:
        member = await db.users.find_one({"id": inp.to_id, "tenant_id": tenant_id}, {"_id": 0})
        if not member:
            raise HTTPException(status_code=404, detail="Team member not found")
        to_id, to_name, to_role = member["id"], member.get("name"), member.get("role")
    elif inp.to_role:
        if inp.to_role not in await tenant_role_keys(tenant_id):
            raise HTTPException(status_code=400, detail="Invalid role")
        to_role, to_name = inp.to_role, inp.to_role
    else:
        raise HTTPException(status_code=400, detail="Choose a person or team to hand off to")

    followup_task_id = new_id()
    base = step_text or t.get("title", "task")
    await db.tasks.insert_one({
        "id": followup_task_id, "tenant_id": tenant_id,
        "title": f"Follow-up: {base}"[:180],
        "description": f"Handed off by {user['name']} on '{t.get('title')}'.\nContext: {text}",
        "assignee_id": to_id if inp.to_id or action == "escalate" else None,
        "assignee_role": to_role,
        "priority": "high" if action == "escalate" else (t.get("priority") or "medium"),
        "status": "todo", "due_date": t.get("due_date"),
        "decision_id": t.get("decision_id"), "parent_task_id": task_id,
        "raised_by": user["id"], "raised_by_name": user.get("name"),
        "raised_step_text": step_text, "raised_note": text,
        "source": "escalation" if action == "escalate" else "handoff", "created_at": now_iso(),
    })
    if to_id:
        notify_ids = [to_id]
    else:
        role_members = await db.users.find({"tenant_id": tenant_id, "role": to_role}, {"_id": 0, "id": 1}).to_list(50)
        notify_ids = [m["id"] for m in role_members]
    return {"followup_task_id": followup_task_id, "to_id": to_id, "to_name": to_name, "to_role": to_role,
            "notify_ids": notify_ids, "notify_level": notify_level, "notify_prefix": notify_prefix}


@api.post("/tasks/{task_id}/updates")
async def add_task_update(task_id: str, inp: TaskUpdateNoteInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can post updates")
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text is required")
    action = inp.action if inp.action in ("note", "handoff", "escalate") else "note"

    step_text = None
    if inp.step_id:
        for s in (t.get("execution_plan") or {}).get("steps", []):
            if s.get("id") == inp.step_id:
                step_text = s.get("text")
                break

    tenant_id = user["tenant_id"]
    followup_task_id = None
    to_name = to_id = to_role = None
    notify_ids, notify_level, notify_prefix = [], 2, "[Handoff]"

    if action in ("handoff", "escalate"):
        h = await _resolve_task_handoff(user, t, task_id, action, text, step_text, inp)
        followup_task_id, to_id, to_name, to_role = h["followup_task_id"], h["to_id"], h["to_name"], h["to_role"]
        notify_ids, notify_level, notify_prefix = h["notify_ids"], h["notify_level"], h["notify_prefix"]

    entry = {
        "id": new_id(), "kind": action, "text": text,
        "step_id": inp.step_id, "step_text": step_text,
        "author_id": user["id"], "author_name": user.get("name"),
        "to_id": to_id, "to_role": to_role, "to_name": to_name,
        "followup_task_id": followup_task_id, "created_at": now_iso(),
    }
    await db.tasks.update_one({"id": task_id}, {"$push": {"updates": entry}})

    if action == "note":
        await log_activity(tenant_id, user["id"], "task_note", f"Note on '{t.get('title')}': {text[:80]}", "task", task_id)
        # Notify the counterpart on this task (assignee <-> creator/approver), excluding the author.
        counterparts = [w for w in (t.get("assignee_id"), t.get("created_by"), t.get("approver_id"))
                        if w and w != user["id"]]
        if counterparts:
            await push_notification(tenant_id, counterparts, 1,
                                    f"New comment on '{t.get('title')}' from {user['name']}: {text[:100]}", "task", task_id,
                                    ntype="comment", title=t.get("title"), sender=user["name"])
    else:
        verb = "escalated to" if action == "escalate" else "handed off to"
        await log_activity(tenant_id, user["id"], f"task_{action}",
                           f"{t.get('title')} {verb} {to_name}", "task", task_id)
        await push_notification(tenant_id, notify_ids, notify_level,
                                f"{notify_prefix} {user['name']} needs you on: {(step_text or t.get('title'))[:90]} — “{text[:100]}”",
                                "task", followup_task_id)
        if t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t.get('title')} {verb} {to_name}", user["name"], "assigned")

    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


class RespondInput(BaseModel):
    text: str


@api.post("/tasks/{task_id}/respond")
async def respond_to_handoff(task_id: str, inp: RespondInput, user: dict = Depends(get_current_user)):
    """Reply to an escalation/handoff: sends feedback back to the person who raised it and resolves this follow-up."""
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("parent_task_id"):
        raise HTTPException(status_code=400, detail="This task is not an escalation/handoff you can respond to")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can respond")
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Response text is required")

    tenant_id = user["tenant_id"]
    parent_id = t["parent_task_id"]
    parent = await db.tasks.find_one({"id": parent_id}, {"_id": 0})
    # Route the reply back to whoever raised it; fall back to the original task's assignee for legacy items.
    raised_by = t.get("raised_by") or (parent or {}).get("assignee_id")
    raised_by_name = t.get("raised_by_name")
    if not raised_by_name and raised_by:
        ru = await db.users.find_one({"id": raised_by}, {"_id": 0, "name": 1})
        raised_by_name = (ru or {}).get("name")
    kind = "response" if t.get("source") == "escalation" else "handoff_reply"

    # Push the answer into the ORIGINAL task's trail so the person who raised it continues with context.
    entry = {
        "id": new_id(), "kind": kind, "text": text,
        "step_id": None, "step_text": t.get("raised_step_text"),
        "author_id": user["id"], "author_name": user.get("name"),
        "to_id": raised_by, "to_role": None, "to_name": raised_by_name,
        "followup_task_id": None, "created_at": now_iso(),
    }
    if parent_id:
        await db.tasks.update_one({"id": parent_id}, {"$push": {"updates": entry}})
    # Resolve this follow-up.
    await db.tasks.update_one({"id": task_id}, {"$set": {"status": "done", "resolved_at": now_iso()}})

    ptitle = (parent or {}).get("title", "your task")
    if raised_by:
        await push_notification(tenant_id, [raised_by], 2,
                                f"[Reply] {user['name']} responded on: {ptitle[:80]} — “{text[:100]}”",
                                "task", parent_id)
    await log_activity(tenant_id, user["id"], "handoff_resolved",
                       f"{user['name']} responded to {raised_by_name or 'the requester'} on '{ptitle}'", "task", parent_id)
    if parent and parent.get("decision_id"):
        await add_decision_event(parent["decision_id"], f"{user['name']} responded: {text[:80]}", user["name"], "event")
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))






@api.post("/tasks/prioritize")
async def prioritize_tasks(force: bool = False, limit: int = 25, user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    q = {"tenant_id": tid, "status": {"$in": ["todo", "in_progress", "blocked"]}}
    if user["role"] != "owner":
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]
    open_tasks = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    todo = [t for t in open_tasks if force or not t.get("ai_scores")]
    scored_n = 0
    if todo:
        currency = await _tenant_currency(tid)
        now = now_iso()
        for i in range(0, len(todo), 25):
            chunk = todo[i:i + 25]
            scores = await ai_score_tasks(chunk, currency, session_id=f"prioritize-{tid}-{i}")
            for t in open_tasks:
                s = scores.get(t["id"])
                if s:
                    t["ai_scores"] = s
                    t["scored_at"] = now
                    scored_n += 1
                    await db.tasks.update_one({"id": t["id"]}, {"$set": {"ai_scores": s, "scored_at": now}})
    open_tasks = await enrich_tasks(open_tasks)
    open_tasks.sort(key=lambda t: (t.get("ai_scores") or {}).get("priority_score", -1), reverse=True)
    return {"tasks": open_tasks, "scored": scored_n}



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
async def create_workflow(inp: WorkflowCreateInput, user: dict = Depends(get_current_user)):
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
    await db.workflows.update_one({"id": workflow_id}, {"$set": {"stage": inp.stage}, "$push": {"history": entry}})
    await log_activity(user["tenant_id"], user["id"], "workflow_advanced", f"'{wf['title']}' → {inp.stage}", "workflow", workflow_id)
    return await db.workflows.find_one({"id": workflow_id}, {"_id": 0})


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
        "decisions": await enrich_decisions(decisions),
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
# Ask AI
# ---------------------------------------------------------------------------
@api.post("/ask")
async def ask_ai(inp: AskInput, user: dict = Depends(require_perm("ask"))):
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
    pending_purchases = await db.workflows.find({"tenant_id": tid, "type": "purchase_payment", "stage": "requested"}, {"_id": 0}).to_list(50)
    overdue = await db.tasks.find({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now, "$ne": None}}, {"_id": 0}).to_list(50)
    open_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}})
    done_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": "done"})
    active_wf = await db.workflows.count_documents({"tenant_id": tid, "stage": {"$nin": ["delivered", "paid"]}})
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
        "pending_decisions": await enrich_decisions(pending_decisions),
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


DIGEST_I18N = {
    "en": {"brief": "Daily Brief", "pending": "pending approvals", "open": "open tasks", "overdue": "overdue",
           "active": "active workflows", "pending_h": "Pending Approvals", "overdue_h": "Overdue Tasks", "none": "None"},
    "hi": {"brief": "दैनिक ब्रीफ़", "pending": "लंबित स्वीकृतियाँ", "open": "खुले कार्य", "overdue": "अतिदेय",
           "active": "सक्रिय वर्कफ़्लो", "pending_h": "लंबित स्वीकृतियाँ", "overdue_h": "अतिदेय कार्य", "none": "कोई नहीं"},
    "ta": {"brief": "தினசரி சுருக்கம்", "pending": "நிலுவை ஒப்புதல்கள்", "open": "திறந்த பணிகள்", "overdue": "தாமதமானவை",
           "active": "செயலில் உள்ள பணிப்பாய்வுகள்", "pending_h": "நிலுவை ஒப்புதல்கள்", "overdue_h": "தாமதமான பணிகள்", "none": "எதுவுமில்லை"},
}



@api.post("/brief/send-digest")
async def send_digest(user: dict = Depends(require_role("owner"))):
    data = await dashboard(user)  # reuse
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    stats = data["stats"]
    L = DIGEST_I18N.get(user.get("language") or "en", DIGEST_I18N["en"])
    html = f"""
    <h2>DecisionOS {L['brief']} — {tenant['name']}</h2>
    <p>{stats['pending_approvals']} {L['pending']} · {stats['open_tasks']} {L['open']} · {len(data['overdue_tasks'])} {L['overdue']} · {stats['active_workflows']} {L['active']}</p>
    <h3>{L['pending_h']}</h3>
    <ul>{''.join(f"<li>{d['title']}</li>" for d in data['pending_decisions']) or f'<li>{L["none"]}</li>'}</ul>
    <h3>{L['overdue_h']}</h3>
    <ul>{''.join(f"<li>{t['title']}</li>" for t in data['overdue_tasks']) or f'<li>{L["none"]}</li>'}</ul>
    """
    result = await send_email(user["email"], f"DecisionOS {L['brief']} — {tenant['name']}", html)
    if result.get("sent"):
        return {"sent": True, "to": user["email"], "provider": result["provider"]}
    if result.get("error") == "smtp_auth_failed":
        raise HTTPException(status_code=400, detail="Gmail rejected the sender login. The account needs a 16-character Gmail App Password (enable 2-Step Verification, then create an App Password) — the normal account password won't work for sending.")
    if result.get("error"):
        raise HTTPException(status_code=400, detail="Couldn't send the email. Please check the sender email settings.")
    return {"sent": False, "mocked": True, "to": user["email"], "preview_html": html}


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


# Background scheduler: run follow-up/escalation for EVERY tenant on a timer, so overdue
# escalations and owner alerts fire even when nobody is actively polling /notifications.
FOLLOWUP_INTERVAL_SECONDS = int(os.environ.get("FOLLOWUP_INTERVAL_SECONDS", "300") or "300")


async def _followup_scheduler_loop():
    # Small initial delay so startup/bootstrap finishes first.
    await asyncio.sleep(30)
    while True:
        try:
            tenant_ids = await db.tenants.distinct("id")
            for tid in tenant_ids:
                try:
                    # Bypass the per-tenant 60s poll throttle for the timer sweep.
                    _followup_last_run.pop(tid, None)
                    await run_followup(tid)
                except Exception as e:
                    logger.warning(f"[followup-scheduler] tenant {tid} failed: {e}")
            logger.info(f"[followup-scheduler] swept {len(tenant_ids)} tenant(s); next in {FOLLOWUP_INTERVAL_SECONDS}s")
        except Exception as e:
            logger.warning(f"[followup-scheduler] sweep failed: {e}")
        try:
            await _notify_provider_outages()
        except Exception as e:
            logger.warning(f"[followup-scheduler] outage-alert check failed: {e}")
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


@api.get("/notifications")
async def list_notifications(user: dict = Depends(get_current_user)):
    await run_followup(user["tenant_id"])
    items = await db.notifications.find({"tenant_id": user["tenant_id"], "user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"notifications": items, "unread": sum(1 for n in items if not n.get("read"))}


@api.post("/notifications/{nid}/read")
async def read_notification(nid: str, user: dict = Depends(get_current_user)):
    await db.notifications.update_one({"id": nid, "tenant_id": user["tenant_id"], "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/notifications/read-all")
async def read_all_notifications(user: dict = Depends(get_current_user)):
    await db.notifications.update_many({"tenant_id": user["tenant_id"], "user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/follow-up/run")
async def followup_run(user: dict = Depends(get_current_user)):
    await run_followup(user["tenant_id"])
    return {"ok": True}


@api.post("/attendance")
async def mark_attendance(inp: AttendanceInput, user: dict = Depends(require_role("owner"))):
    date = inp.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.attendance.update_one(
        {"tenant_id": user["tenant_id"], "user_id": inp.user_id, "date": date},
        {"$set": {"status": inp.status, "marked_by": user["id"], "updated_at": now_iso()},
         "$setOnInsert": {"id": new_id(), "created_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api.get("/attendance")
async def list_attendance(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return await db.attendance.find({"tenant_id": user["tenant_id"], "date": date}, {"_id": 0}).to_list(500)


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
    res = await db.complaints.update_one({"id": cid, "tenant_id": user["tenant_id"]}, {"$set": {"status": "resolved", "resolved_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


@api.get("/memory")
async def list_memory(user: dict = Depends(get_current_user)):
    return await db.memory.find({"tenant_id": user["tenant_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/memory")
async def add_memory(inp: MemoryInput, user: dict = Depends(get_current_user)):
    mid = new_id()
    doc = {"id": mid, "tenant_id": user["tenant_id"], "text": inp.text, "tag": inp.tag or "note",
           "created_by": user["id"], "created_at": now_iso()}
    await db.memory.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api.get("/brief")
async def ceo_brief(period: str = "morning", user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    await run_followup(tid)
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "weekly":
        start_iso = (now - timedelta(days=7)).isoformat()
    elif period == "monthly":
        start_iso = (now - timedelta(days=30)).isoformat()
    else:
        start_iso = midnight.isoformat()
    is_owner = user["role"] == "owner"
    greet = "Good morning" if period in ("morning", "weekly", "monthly") else "Good evening"

    if period == "morning":
        y_start = (midnight - timedelta(days=1)).isoformat()
        completed_range = {"$gte": y_start, "$lt": midnight.isoformat()}
        completed_label = "completed yesterday"
    else:
        completed_range = {"$gte": start_iso}
        completed_label = f"completed ({period})"

    if is_owner:
        delayed = await db.tasks.count_documents({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now.isoformat(), "$ne": None}})
        completed = await db.activity.count_documents({"tenant_id": tid, "kind": "task_done", "created_at": completed_range})
        pending_dec = await db.decisions.count_documents({"tenant_id": tid, "status": "pending_approval"})
        pending_pur = await db.workflows.count_documents({"tenant_id": tid, "type": "purchase_payment", "stage": "requested"})
        absent = await db.attendance.count_documents({"tenant_id": tid, "date": today, "status": "absent"})
        complaints = await db.complaints.count_documents({"tenant_id": tid, "status": "open"})
        payment_overdue = await db.workflows.count_documents({"tenant_id": tid, "type": "purchase_payment", "stage": "payment_pending"})
        fires = await db.tasks.count_documents({"tenant_id": tid, "source": "escalation", "status": {"$ne": "done"}})
        on_leave = await db.leaves.count_documents({"tenant_id": tid, "status": "approved", "from_date": {"$lte": today}, "to_date": {"$gte": today}})
        counters = {"delayed": delayed, "completed": completed, "awaiting_approval": pending_dec + pending_pur,
                    "absent": absent, "complaints": complaints, "payment_overdue": payment_overdue, "fires": fires,
                    "on_leave": on_leave}
    else:
        mine = {"$or": [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]}

        def mq(extra):
            return {"tenant_id": tid, **mine, **extra}
        delayed = await db.tasks.count_documents(mq({"status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now.isoformat(), "$ne": None}}))
        todo = await db.tasks.count_documents(mq({"status": "todo"}))
        in_progress = await db.tasks.count_documents(mq({"status": "in_progress"}))
        completed = await db.activity.count_documents({"tenant_id": tid, "kind": "task_done", "actor": user["id"], "created_at": completed_range})
        escalations = await db.tasks.count_documents(mq({"source": "escalation", "status": {"$ne": "done"}}))
        handoffs = await db.tasks.count_documents(mq({"source": "handoff", "status": {"$ne": "done"}}))
        counters = {"delayed": delayed, "todo": todo, "in_progress": in_progress,
                    "completed": completed, "escalations": escalations, "handoffs": handoffs}

    return {
        "period": period,
        "role": user["role"],
        "greeting": f"{greet}, {user['name'].split(' ')[0]}",
        "completed_label": completed_label,
        "counters": counters,
    }


@api.get("/brief/details")
async def brief_details(key: str, period: str = "morning", user: dict = Depends(get_current_user)):
    """Drill-down items behind a CEO Brief counter block."""
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today = now.strftime("%Y-%m-%d")
    if period == "weekly":
        start_iso = (now - timedelta(days=7)).isoformat()
    elif period == "monthly":
        start_iso = (now - timedelta(days=30)).isoformat()
    else:
        start_iso = midnight.isoformat()

    items = []
    actionable = False
    is_owner = user["role"] == "owner"
    mine = None if is_owner else {"$or": [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]}

    def scope(q):
        return q if not mine else {**q, **mine}

    if key in {"awaiting_approval", "absent", "complaints", "payment_overdue", "fires", "on_leave"} and not is_owner:
        return {"key": key, "actionable": False, "items": []}

    if key == "on_leave":
        lvs = await db.leaves.find({"tenant_id": tid, "status": "approved", "from_date": {"$lte": today}, "to_date": {"$gte": today}}, {"_id": 0}).to_list(200)
        for lv in lvs:
            portion = " · half day" if lv.get("day_portion") == "half" else ""
            items.append({"id": lv["id"], "title": lv.get("user_name"),
                          "subtitle": f"{(lv.get('leave_type') or 'leave').title()} until {lv.get('to_date')}{portion}",
                          "meta": lv.get("user_role"), "kind": "leave"})
        return {"key": key, "actionable": False, "items": items}

    if key == "delayed":
        tasks = await db.tasks.find(
            scope({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now.isoformat(), "$ne": None}}),
            {"_id": 0}).sort("due_date", 1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            items.append({"id": t["id"], "title": t["title"],
                          "subtitle": t.get("assignee_name") or t.get("assignee_role") or "unassigned",
                          "meta": t.get("priority"), "kind": "task", "due_date": t.get("due_date")})

    elif key in ("todo", "in_progress"):
        tasks = await db.tasks.find(scope({"tenant_id": tid, "status": key}), {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            items.append({"id": t["id"], "title": t["title"],
                          "subtitle": t.get("assignee_name") or t.get("assignee_role") or "unassigned",
                          "meta": t.get("priority"), "kind": "task"})

    elif key in ("escalations", "handoffs"):
        src = "escalation" if key == "escalations" else "handoff"
        tasks = await db.tasks.find(scope({"tenant_id": tid, "source": src, "status": {"$ne": "done"}}), {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            sub = f"Raised by {t['raised_by_name']}" if t.get("raised_by_name") else (t.get("assignee_name") or "")
            items.append({"id": t["id"], "title": t["title"], "subtitle": sub, "meta": t.get("priority"), "kind": "task"})

    elif key == "completed":
        if period == "morning":
            y_start = (midnight - timedelta(days=1)).isoformat()
            trange = {"$gte": y_start, "$lt": midnight.isoformat()}
        else:
            trange = {"$gte": start_iso}
        aq = {"tenant_id": tid, "kind": "task_done", "created_at": trange}
        if not is_owner:
            aq["actor"] = user["id"]
        acts = await db.activity.find(aq, {"_id": 0}).sort("created_at", -1).to_list(200)
        tids = [a.get("entity_id") for a in acts if a.get("entity_id")]
        tmap = {}
        if tids:
            for tk in await db.tasks.find({"tenant_id": tid, "id": {"$in": tids}},
                                          {"_id": 0, "id": 1, "attachments": 1, "assignee_id": 1}).to_list(300):
                tmap[tk["id"]] = tk
        aids = list({tk.get("assignee_id") for tk in tmap.values() if tk.get("assignee_id")})
        umap = {}
        if aids:
            for u in await db.users.find({"id": {"$in": aids}}, {"_id": 0, "id": 1, "name": 1}).to_list(300):
                umap[u["id"]] = u["name"]
        for a in acts:
            tk = tmap.get(a.get("entity_id"))
            proof = [{"kind": at.get("kind"), "url": at.get("url")} for at in ((tk or {}).get("attachments") or [])]
            sub = umap.get((tk or {}).get("assignee_id")) or ""
            items.append({"id": a.get("entity_id") or a["id"], "title": a.get("message"),
                          "subtitle": sub, "kind": "task" if tk else "activity", "proof": proof})

    elif key == "awaiting_approval":
        actionable = True
        decisions = await db.decisions.find({"tenant_id": tid, "status": "pending_approval"}, {"_id": 0}).to_list(50)
        decisions = await enrich_decisions(decisions)
        for d in decisions:
            items.append({"id": d["id"], "title": d["title"], "subtitle": d.get("summary") or "",
                          "meta": f"{len(d.get('tasks', []))} task(s) blocked", "kind": "decision"})
        purchases = await db.workflows.find({"tenant_id": tid, "type": "purchase_payment", "stage": "requested"}, {"_id": 0}).to_list(50)
        for w in purchases:
            items.append({"id": w["id"], "title": w.get("title"), "subtitle": w.get("counterparty") or "",
                          "meta": w.get("amount"), "kind": "purchase", "wf_type": w.get("type")})

    elif key == "absent":
        recs = await db.attendance.find({"tenant_id": tid, "date": today, "status": "absent"}, {"_id": 0}).to_list(200)
        uids = [r["user_id"] for r in recs if r.get("user_id")]
        umap = {}
        if uids:
            for u in await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200):
                umap[u["id"]] = u
        for r in recs:
            u = umap.get(r.get("user_id"), {})
            items.append({"id": r.get("user_id") or new_id(), "title": u.get("name", "Unknown"), "subtitle": u.get("role", ""), "kind": "absent"})

    elif key == "complaints":
        actionable = True
        recs = await db.complaints.find({"tenant_id": tid, "status": "open"}, {"_id": 0}).sort("created_at", -1).to_list(200)
        for c in recs:
            items.append({"id": c["id"], "title": c.get("text"), "subtitle": c.get("customer_name") or "Unknown",
                          "meta": c.get("severity"), "kind": "complaint", "customer_id": c.get("customer_id")})

    elif key == "payment_overdue":
        recs = await db.workflows.find({"tenant_id": tid, "type": "purchase_payment", "stage": "payment_pending"}, {"_id": 0}).to_list(200)
        for w in recs:
            items.append({"id": w["id"], "title": w.get("title"), "subtitle": w.get("counterparty") or "",
                          "meta": w.get("amount"), "kind": "payment", "wf_type": w.get("type")})

    elif key == "fires":
        tasks = await db.tasks.find({"tenant_id": tid, "source": "escalation", "status": {"$ne": "done"}}, {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            sub = f"Raised by {t['raised_by_name']}" if t.get("raised_by_name") else (t.get("assignee_name") or "")
            items.append({"id": t["id"], "title": t["title"], "subtitle": sub, "meta": t.get("priority"), "kind": "escalation"})

    return {"key": key, "actionable": actionable, "items": items}




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


@api.post("/tasks/{task_id}/attachment")
async def upload_task_attachment(task_id: str, file: UploadFile = File(...), kind: str = Form("evidence"),
                                 background: BackgroundTasks = None, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    kind = kind if kind in ("reference", "evidence", "photo", "voice") else "evidence"
    rec = await _store_file(user["tenant_id"], user["id"], file, kind, task_id=task_id)
    att = _file_public(rec)
    await db.tasks.update_one({"id": task_id}, {"$push": {"attachments": att},
                              "$set": {"updated_at": now_iso(), "last_action": f"{kind.title()} attached"}})
    if kind == "reference" and background is not None:
        background.add_task(_analyze_reference_file, user["tenant_id"], task_id, rec)
    return att


async def _attach_reference_ids(tenant_id, user_id, task_id, file_ids, background=None):
    """Link previously-staged reference files (POST /files) to a task."""
    for fid in (file_ids or []):
        rec = await db.files.find_one({"id": fid, "tenant_id": tenant_id, "is_deleted": False}, {"_id": 0})
        if not rec:
            continue
        await db.files.update_one({"id": fid}, {"$set": {"task_id": task_id, "kind": "reference"}})
        rec["kind"] = "reference"
        await db.tasks.update_one({"id": task_id}, {"$push": {"attachments": _file_public(rec)}})
        if background is not None:
            background.add_task(_analyze_reference_file, tenant_id, task_id, rec)


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
        raw = await ai_extract_document(tmp, ctype, session_id=f"ref-{task_id}")
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


@api.get("/files/{fname}")
async def get_file(fname: str):
    from fastapi.responses import FileResponse
    path = UPLOAD_DIR / fname
    if not path.exists() or "/" in fname or ".." in fname:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path))


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
    "\"invoices\": [{\"type\": one of [sales_invoice, purchase_bill], \"number\": string, \"contact_name\": string, \"date\": string, \"due_date\": string, \"amount\": number, \"currency\": string, \"line_items\": [{\"description\": string, \"qty\": number, \"rate\": number, \"amount\": number}]}], "
    "\"payments\": [{\"direction\": one of [in, out], \"amount\": number, \"date\": string, \"method\": string, \"reference\": string, \"contact_name\": string, \"invoice_number\": string}], "
    "\"tasks\": [{\"title\": string, \"priority\": one of [low,medium,high], \"due_in_days\": integer or null}]}. "
    "Rules: Our own company (the DecisionOS user filing this) is \"{company}\". "
    "NEVER create a contact for our own company — only ever extract the OTHER party (the counterparty). "
    "Decide direction by WHO ISSUED the document: if our company is the seller/issuer (the 'from'/'billed by' party), it is a sales_invoice and the counterparty is the buyer (type=customer); "
    "if our company is the buyer/recipient (the 'bill to'/'ship to' party), it is a purchase_bill and the counterparty is the issuer/seller (type=vendor). "
    "The contact_name on every invoice and payment MUST be the counterparty, never our own company. "
    "A sales invoice is money owed TO us by a customer (party type=customer). "
    "A purchase bill is money we owe a vendor/supplier (party type=vendor). "
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
        resp = await chat.send_message(UserMessage(text=user_text, file_contents=[fc]))
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


async def commit_ingestion_records(tenant_id: str, user_id: str, records: dict, ingestion_id: str, source: str) -> dict:
    from routers.ledger import create_expense
    created = {"contacts": 0, "invoices": 0, "payments": 0, "tasks": 0, "expenses": 0}
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
        await db.invoices.insert_one({
            "id": inv_id, "tenant_id": tenant_id, "type": itype,
            "number": str(inv.get("number") or ""), "contact_id": cid,
            "contact_name": (inv.get("contact_name") or "").strip(),
            "date": inv.get("date", "") or "", "due_date": inv.get("due_date", "") or "",
            "amount": amount, "currency": inv.get("currency") or currency,
            "status": "unpaid", "line_items": inv.get("line_items") if isinstance(inv.get("line_items"), list) else [],
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["invoices"] += 1
        # Money we OWE a vendor (purchase bill) rolls up into the spend Ledger + Company Brain.
        if itype == "purchase_bill":
            li_text = " ".join(str(li.get("description", "")) for li in (inv.get("line_items") or []) if isinstance(li, dict))
            await create_expense(tenant_id, user_id, {
                "title": f"{(inv.get('contact_name') or 'Vendor').strip()} — Bill {inv.get('number') or ''}".strip(),
                "amount": amount, "currency": inv.get("currency") or currency,
                "vendor_name": (inv.get("contact_name") or "").strip(), "vendor_id": cid,
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
        # Money going OUT to a vendor rolls up into the spend Ledger (paid) + Company Brain.
        if direction == "out":
            await create_expense(tenant_id, user_id, {
                "title": f"Payment to {(p.get('contact_name') or 'Vendor').strip()}".strip(),
                "amount": amount, "currency": currency,
                "vendor_name": (p.get("contact_name") or "").strip(), "vendor_id": cid,
                "date": p.get("date") or "", "status": "paid",
                "payment_id": pay_id, "ingestion_id": ingestion_id, "notes": p.get("reference") or "",
            }, source=source)
            created["expenses"] += 1

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
    ing_id = new_id()
    fname = f"ingest_{ing_id}.{ext}"
    path = UPLOAD_DIR / fname
    with open(path, "wb") as f:
        f.write(await file.read())
    doc = {
        "id": ing_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "source": source if source in ("upload", "whatsapp") else "upload",
        "kind": "pdf" if ext == "pdf" else "image", "filename": file.filename or fname,
        "file_url": f"/api/files/{fname}", "status": "review", "created_at": now_iso(),
    }
    try:
        currency = await _tenant_currency(user["tenant_id"])
        company = await _tenant_name(user["tenant_id"])
        result = await ai_extract_document(str(path), DOC_MIME[ext], f"ingest-{ing_id}", currency, company)
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
    fname = f"ingest_{ing_id}.{ext}"
    path = UPLOAD_DIR / fname
    with open(path, "wb") as f:
        f.write(await file.read())
    try:
        df = pd.read_excel(path) if ext in ("xlsx", "xls") else pd.read_csv(path)
        df = df.fillna("")
        headers = [str(c) for c in df.columns]
        rows = df.astype(str).values.tolist()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {str(e)[:150]}")
    doc = {
        "id": ing_id, "tenant_id": user["tenant_id"], "created_by": user["id"], "source": "csv",
        "kind": ext, "filename": file.filename or fname, "file_url": f"/api/files/{fname}",
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
@api.get("/inbox")
async def list_inbox(classification: Optional[str] = None, status: Optional[str] = None,
                     user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    query = {"tenant_id": tid}
    if classification and classification in INBOX_CLASSES:
        query["classification"] = classification
    if status in ("open", "done", "dismissed"):
        query["status"] = status
    items = await db.inbox.find(query, {"_id": 0}).sort("created_at", -1).to_list(300)
    counts = {}
    async for row in db.inbox.aggregate([
        {"$match": {"tenant_id": tid, "status": "open"}},
        {"$group": {"_id": "$classification", "n": {"$sum": 1}}},
    ]):
        counts[row["_id"]] = row["n"]
    open_total = await db.inbox.count_documents({"tenant_id": tid, "status": "open"})
    return {"items": items, "counts": counts, "open_total": open_total}


class InboxStatusInput(BaseModel):
    status: str


@api.post("/inbox/{item_id}/status")
async def set_inbox_status(item_id: str, inp: InboxStatusInput, user: dict = Depends(get_current_user)):
    if inp.status not in ("open", "done", "dismissed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.inbox.update_one({"id": item_id, "tenant_id": user["tenant_id"]}, {"$set": {"status": inp.status}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "status": inp.status}


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
    pending_deliveries = [w for w in workflows if w.get("stage") not in ("delivered", "paid")]

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
    metrics = {
        "outstanding": round(total_billed - total_paid, 2), "total_billed": round(total_billed, 2),
        "total_paid": round(total_paid, 2), "last_payment": payments[0].get("date") if payments else None,
        "open_complaints": len([x for x in complaints if x.get("status") != "resolved"]),
        "pending_deliveries": len([w for w in workflows if w.get("stage") not in ("delivered", "paid")]),
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
LEAVE_TYPES = {"casual", "sick", "earned", "permission", "wfh", "other"}
ABSENCE_REASONS = {"sick", "family_emergency", "personal", "other"}


class LeaveRequestInput(BaseModel):
    leave_type: str
    from_date: str
    to_date: str
    day_portion: Optional[str] = "full"  # full | half
    reason: Optional[str] = ""


class AbsenceInput(BaseModel):
    reason: str
    note: Optional[str] = ""


class LeaveDecisionInput(BaseModel):
    note: Optional[str] = ""


class LeaveApproverMapInput(BaseModel):
    approvers: dict  # { role_key: approver_user_id }


def _can_approve_leave(user: dict, leave: dict) -> bool:
    return (user.get("role") == "owner"
            or user["id"] == leave.get("approver_id")
            or "leave_approve" in user_perms(user))


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


@api.post("/leaves")
async def create_leave(inp: LeaveRequestInput, user: dict = Depends(get_current_user)):
    if inp.leave_type not in LEAVE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid leave type")
    if inp.to_date[:10] < inp.from_date[:10]:
        raise HTTPException(status_code=400, detail="End date cannot be before start date")
    return await _create_leave(user["tenant_id"], user, inp.leave_type, inp.from_date, inp.to_date,
                               inp.day_portion, inp.reason, is_emergency=False)


@api.post("/leaves/absence")
async def report_absence(inp: AbsenceInput, user: dict = Depends(get_current_user)):
    if inp.reason not in ABSENCE_REASONS:
        raise HTTPException(status_code=400, detail="Invalid reason")
    today = datetime.now(timezone.utc).date().isoformat()
    reason = inp.reason.replace("_", " ").title() + ((" — " + inp.note.strip()) if inp.note else "")
    return await _create_leave(user["tenant_id"], user, "sick" if inp.reason == "sick" else "other",
                               today, today, "full", reason, is_emergency=True)


@api.get("/leaves")
async def list_leaves(scope: str = "mine", user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    can_approve_all = user.get("role") == "owner" or "leave_approve" in user_perms(user)
    q = {"tenant_id": tid}
    if scope == "mine":
        q["user_id"] = user["id"]
    elif scope == "approvals":
        if not can_approve_all:
            q["approver_id"] = user["id"]
    elif scope == "all":
        if not can_approve_all:
            q["user_id"] = user["id"]
    leaves = await db.leaves.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
    return leaves


@api.get("/leaves/on-leave")
async def leaves_on_leave_today(user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    today = datetime.now(timezone.utc).date().isoformat()
    docs = await db.leaves.find({"tenant_id": tid, "status": "approved",
                                 "from_date": {"$lte": today}, "to_date": {"$gte": today}},
                                {"_id": 0, "user_id": 1, "user_name": 1, "user_role": 1, "leave_type": 1, "to_date": 1}).to_list(200)
    return docs


@api.get("/leaves/{leave_id}")
async def get_leave(leave_id: str, user: dict = Depends(get_current_user)):
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if lv["user_id"] != user["id"] and not _can_approve_leave(user, lv):
        raise HTTPException(status_code=403, detail="You don't have access to this leave request")
    return lv


async def _decide_leave(leave_id, user, new_status, note, ntype, employee_msg):
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": user["tenant_id"]})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_leave(user, lv):
        raise HTTPException(status_code=403, detail="You cannot act on this leave request")
    entry = {"action": new_status, "by": user["id"], "by_name": user.get("name"), "note": note or "", "at": now_iso()}
    updates = {"status": new_status, "decided_at": now_iso(), "decided_by": user["id"]}
    if new_status == "info_requested":
        updates = {"status": new_status, "info_note": note or ""}
    await db.leaves.update_one({"id": leave_id}, {"$set": updates, "$push": {"history": entry}})
    await push_notification(user["tenant_id"], [lv["user_id"]], 2, employee_msg,
                            entity_type="leave", entity_id=leave_id, ntype=ntype,
                            title=f"{lv.get('leave_type', 'Leave').title()} leave", sender=user.get("name"))
    await log_activity(user["tenant_id"], user["id"], f"leave_{new_status}",
                       f"{new_status.replace('_', ' ').title()} {lv.get('user_name')}'s leave", "leave", leave_id)
    return await db.leaves.find_one({"id": leave_id}, {"_id": 0})


@api.post("/leaves/{leave_id}/approve")
async def approve_leave(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(get_current_user)):
    return await _decide_leave(leave_id, user, "approved", inp.note, "approved",
                               f"Your leave request was approved by {user.get('name')}")


@api.post("/leaves/{leave_id}/reject")
async def reject_leave(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(get_current_user)):
    return await _decide_leave(leave_id, user, "rejected", inp.note, "rejected",
                               f"Your leave request was rejected by {user.get('name')}" + (f": {inp.note}" if inp.note else ""))


@api.post("/leaves/{leave_id}/request-info")
async def request_leave_info(leave_id: str, inp: LeaveDecisionInput, user: dict = Depends(get_current_user)):
    return await _decide_leave(leave_id, user, "info_requested", inp.note, "clarification",
                               f"{user.get('name')} needs more info on your leave request" + (f": {inp.note}" if inp.note else ""))


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


@api.get("/leaves/{leave_id}/impact")
async def leave_impact(leave_id: str, user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    lv = await db.leaves.find_one({"id": leave_id, "tenant_id": tid})
    if not lv:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_leave(user, lv) and lv["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="You don't have access to this leave request")
    from_date, to_date = lv["from_date"][:10], lv["to_date"][:10]
    # Active tasks of the person on leave that are at risk during the absence.
    all_tasks = await db.tasks.find(
        {"tenant_id": tid, "assignee_id": lv["user_id"], "status": {"$nin": ["done", "cancelled"]}},
        {"_id": 0}).to_list(300)
    at_risk = [t for t in all_tasks
               if ((t.get("due_date") or "")[:10] and (t.get("due_date") or "")[:10] <= to_date)
               or t.get("status") == "in_progress"]
    # Available teammates: everyone except the person on leave and anyone else on approved overlapping leave.
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
    overlapping = await db.leaves.find(
        {"tenant_id": tid, "status": "approved", "from_date": {"$lte": to_date}, "to_date": {"$gte": from_date}},
        {"_id": 0, "user_id": 1}).to_list(300)
    busy = {o["user_id"] for o in overlapping} | {lv["user_id"]}
    members = []
    for u in users:
        if u["id"] in busy:
            continue
        load = await db.tasks.count_documents(
            {"tenant_id": tid, "assignee_id": u["id"], "status": {"$nin": ["done", "cancelled"]}})
        members.append({"id": u["id"], "name": u["name"], "role": u["role"], "load": load})
    analysis = await ai_leave_impact(lv["user_name"], from_date, to_date, at_risk, members)
    sug = {s.get("task_id"): s for s in (analysis.get("suggestions") or []) if isinstance(s, dict)}
    valid_ids = {m["id"] for m in members}
    tasks_out = []
    for t in at_risk:
        s = sug.get(t["id"], {})
        action = s.get("action") if s.get("action") in ("reassign", "extend", "monitor") else "monitor"
        aid = s.get("assignee_id") if s.get("assignee_id") in valid_ids else None
        if action == "reassign" and not aid:
            action = "monitor"
        tasks_out.append({
            "id": t["id"], "title": t.get("title"), "priority": t.get("priority"),
            "status": t.get("status"), "due_date": (t.get("due_date") or "")[:10],
            "action": action, "assignee_id": aid, "assignee_name": s.get("assignee_name"),
            "suggested_due_date": (s.get("due_date") or "")[:10] if action == "extend" else None,
            "reason": s.get("reason", ""),
        })
    return {"leave_id": leave_id, "person": lv["user_name"], "from_date": from_date, "to_date": to_date,
            "summary": analysis.get("summary", ""), "tasks": tasks_out,
            "available_members": [{"id": m["id"], "name": m["name"], "role": m["role"]} for m in members]}


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
    wfs = await db.workflows.find(
        {"tenant_id": tid, "type": {"$in": ["distribution", "sales_dispatch"]}, "stage": {"$nin": ["delivered", "paid"]}},
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
    if not os.environ.get("WA_ACCESS_TOKEN"):
        return {"status": "not_configured",
                "detail": "WhatsApp ingestion is ready but not connected. Add WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID / WA_VERIFY_TOKEN to enable."}
    raw = await request.body()
    app_secret = os.environ.get("WA_APP_SECRET")
    if app_secret:
        sig = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(app_secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, sig):
            # A proxy/ingress may re-encode the body, breaking Meta's HMAC. Log but DO NOT drop the message.
            await log_wa_event("", "", "signature_mismatch",
                               reason="X-Hub-Signature-256 did not match — processing anyway (a proxy may re-encode the body; verify WA_APP_SECRET if unexpected)")
            logger.warning("WhatsApp signature mismatch; processing anyway")
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
    rows = await db.wa_events.find(
        {"$or": [{"tenant_id": tid}, {"tenant_id": None}]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return rows


async def resolve_wa_tenant(sender: str):
    sp = _norm_phone(sender)
    if not sp:
        return os.environ.get("WA_TENANT_ID") or None
    # Primary: match a registered teammate by their phone (same normalization as OTP login).
    candidates = await db.users.find(
        {"phone": {"$exists": True, "$ne": ""}},
        {"_id": 0, "id": 1, "tenant_id": 1, "phone": 1, "name": 1, "created_at": 1, "wa_phone_obsolete": 1},
    ).to_list(5000)
    matches = [u for u in candidates if not u.get("wa_phone_obsolete") and _norm_phone(u.get("phone", "")) == sp]
    if matches:
        if len(matches) > 1:
            # Same number on multiple people: route to the most recently added, mark the
            # older records obsolete so they stop claiming the number, and alert the owner.
            matches.sort(key=lambda u: u.get("created_at") or "", reverse=True)
            latest, older = matches[0], matches[1:]
            await db.users.update_many({"id": {"$in": [u["id"] for u in older]}},
                                       {"$set": {"wa_phone_obsolete": True, "updated_at": now_iso()}})
            await push_notification(
                latest["tenant_id"], await _owner_ids(latest["tenant_id"]), 2,
                f"WhatsApp number {sender} was linked to {len(matches)} people. Routing to the latest — {latest.get('name')}. {len(older)} older record(s) marked obsolete; please review in People.",
                "user", latest["id"], ntype="reminder",
                title="Duplicate WhatsApp number resolved", sender="System")
            return latest["tenant_id"]
        return matches[0]["tenant_id"]
    # Secondary: legacy invited_employees list on the tenant document.
    async for t in db.tenants.find({"invited_employees.0": {"$exists": True}}, {"_id": 0, "id": 1, "invited_employees": 1}):
        for inv in t.get("invited_employees", []):
            if _norm_phone(inv.get("phone")) == sp:
                return t["id"]
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
            fname = f"ingest_{ing_id}.{ext}"
            with open(UPLOAD_DIR / fname, "wb") as f:
                f.write(data)
            currency = await _tenant_currency(tenant_id)
            company = await _tenant_name(tenant_id)
            result = await ai_extract_document(str(UPLOAD_DIR / fname), mime, f"ingest-{ing_id}", currency, company)
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
            level, reason = _decide_processing_level(cls, confidence, amt or None, needs_owner,
                                                     bool(dup), has_records, is_document=True)
            tri = {"classification": cls, "intent": result.get("doc_type", "document"),
                   "summary": result.get("summary", ""), "department": dept,
                   "priority": "medium", "amount": amt or None}
            status = "needs_attention" if level == "attention" else "pending_review"
            did = await persist_capture_draft(
                tenant_id, sender, ("pdf" if ext == "pdf" else "image"),
                {"file_url": f"/api/files/{fname}", "filename": media.get("filename") or fname},
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


def _decide_processing_level(cls, confidence, amount, needs_owner, is_duplicate, has_records, is_document):
    """Map an AI-triaged capture to one of: auto | confirm | attention.
    Returns (level, reason)."""
    if is_duplicate:
        return "attention", "Possible duplicate of an already-filed invoice — please verify before saving."
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
        await db.ingestions.update_one({"id": ing_id}, {"$set": {"inbox_id": inbox_id}})
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
            await db.tasks.update_many({"decision_id": decision_id}, {"$set": overrides})
        # Reviewer approved the capture → release the decision's blocked tasks.
        await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "approved"}})
        await db.tasks.update_many({"decision_id": decision_id, "status": "blocked"},
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
async def reassign_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(get_current_user)):
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
async def reject_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(get_current_user)):
    await _get_draft(cid, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "rejected", "review_action": "rejected", "reviewed_by": user["id"],
        "reviewed_at": now_iso(), "clarification_note": inp.reason or "",
    }})
    return {"ok": True}


@api.post("/captures/{cid}/clarify")
async def clarify_capture(cid: str, inp: CaptureActionInput, user: dict = Depends(get_current_user)):
    d = await _get_draft(cid, user)
    await db.capture_drafts.update_one({"id": cid}, {"$set": {
        "status": "clarification_requested", "review_action": "clarify",
        "reviewed_by": user["id"], "reviewed_at": now_iso(), "clarification_note": inp.note or "",
    }})
    if d.get("wa_from") and inp.note:
        await send_wa_reply(d["wa_from"], f"❓ Clarification needed on your message: {inp.note}")
    return {"ok": True}


@api.post("/captures/{cid}/approve")
async def approve_capture(cid: str, user: dict = Depends(get_current_user)):
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
        await db.users.create_index("email", unique=True)
        await db.decisions.create_index("tenant_id")
        await db.tasks.create_index("tenant_id")
        await db.workflows.create_index("tenant_id")
        await db.platform_admins.create_index("email", unique=True)
        await db.usage_events.create_index([("tenant_id", 1), ("created_at", -1)])
        await db.usage_events.create_index("created_at")
        await db.files.create_index([("tenant_id", 1), ("task_id", 1)])
        try:
            await obj_store.init_storage()
        except Exception as e:
            logger.warning(f"Object storage init deferred (will retry on first upload): {e}")
        await load_ai_keys_from_db()
        await seed_platform_admin()
        await seed_demo()
        await migrate_tenants()
        await fixup_demo_tenant()
        await write_test_credentials()
        logger.info("Bootstrap complete.")
    except Exception as e:
        logger.error(f"Bootstrap error (non-fatal, app stays up): {e}")


async def seed_platform_admin():
    """Create the platform super-admin from env, idempotently; refresh the hash if the env password changed."""
    email = os.environ.get("SUPERADMIN_EMAIL", "admin@decisionos.biz").strip().lower()
    password = os.environ.get("SUPERADMIN_PASSWORD", "DecisionOS@2026").strip()
    existing = await db.platform_admins.find_one({"email": email})
    if not existing:
        await db.platform_admins.insert_one({
            "id": new_id(), "email": email, "name": "Platform Admin",
            "password_hash": hash_password(password), "created_at": now_iso(),
        })
        logger.info(f"Platform super-admin seeded: {email}")
    elif not verify_password(password, existing.get("password_hash", "")):
        await db.platform_admins.update_one(
            {"id": existing["id"]}, {"$set": {"password_hash": hash_password(password)}})
        logger.info(f"Platform super-admin password refreshed from env: {email}")


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
_cors_env = os.environ.get('CORS_ORIGINS', '*').strip()
_cors_kwargs = dict(allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
if _cors_env == '*':
    # Reflect the request Origin (valid with credentials, unlike a literal '*').
    _cors_kwargs["allow_origin_regex"] = ".*"
else:
    _cors_kwargs["allow_origins"] = _cors_env.split(',')
app.add_middleware(CORSMiddleware, **_cors_kwargs)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

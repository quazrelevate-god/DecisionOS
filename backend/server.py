from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import uuid
import json
import hmac
import random
import secrets
import hashlib
import logging
import httpx
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, BackgroundTasks, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType
from emergentintegrations.llm.openai import OpenAISpeechToText

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
LLM_MODEL = ("anthropic", "claude-sonnet-4-6")
VISION_MODEL = ("gemini", "gemini-2.5-flash")

ROLES = ["owner", "sales", "production", "finance"]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("decisionos")

app = FastAPI(title="DecisionOS")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, tenant_id: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You don't have permission for this action")
        return user
    return checker


# ---------------------------------------------------------------------------
# Module-level access permissions
# ---------------------------------------------------------------------------
PERMISSION_KEYS = ["inbox", "data_input", "people", "finance", "workflows", "tasks", "brain", "ask", "team_manage"]
_BASE_PERMS = {"inbox", "data_input", "people", "workflows", "tasks", "brain", "ask"}
ROLE_DEFAULT_PERMS = {
    "sales": _BASE_PERMS,
    "finance": _BASE_PERMS | {"finance"},
}


def user_perms(user: dict) -> set:
    if user.get("role") == "owner":
        return set(PERMISSION_KEYS)
    p = user.get("permissions")
    if isinstance(p, list) and len(p) > 0:
        return {k for k in p if k in PERMISSION_KEYS}
    return set(ROLE_DEFAULT_PERMS.get(user.get("role"), _BASE_PERMS))


def clean_perms(perms) -> list:
    if not isinstance(perms, list):
        return []
    seen, out = set(), []
    for k in perms:
        if k in PERMISSION_KEYS and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def require_perm(perm):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if perm not in user_perms(user):
            raise HTTPException(status_code=403, detail="You don't have access to this feature")
        return user
    return checker


DEFAULT_ROLES = [
    {"key": "sales", "label": "Sales"},
    {"key": "operations", "label": "Operations"},
    {"key": "finance", "label": "Finance"},
]


async def tenant_role_keys(tenant_id: str) -> set:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    keys = {r.get("key") for r in ((t.get("roles") if t else None) or [])}
    keys.discard(None)
    keys.add("owner")
    return keys


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
    company_size: Optional[str] = None
    region: Optional[str] = None
    currency: Optional[str] = "INR"
    gst: Optional[str] = None
    branches: Optional[str] = None
    business_scale: Optional[dict] = None
    current_software: Optional[List[str]] = None
    roles: Optional[List[RoleItem]] = None
    products: Optional[List[ProductItem]] = None


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


class OnboardingSuggestInput(BaseModel):
    industry: str
    company_size: Optional[str] = None
    description: Optional[str] = None


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


class UserUpdateInput(BaseModel):
    role: Optional[str] = None
    phone: Optional[str] = None
    permissions: Optional[List[str]] = None


class TextNoteInput(BaseModel):
    text: str
    title: Optional[str] = None
    language: Optional[str] = "auto"


class TaskCreateInput(BaseModel):
    title: str
    description: Optional[str] = ""
    assignee_role: Optional[str] = None
    assignee_id: Optional[str] = None
    priority: Optional[str] = "medium"
    due_in_days: Optional[int] = None


class TaskUpdateInput(BaseModel):
    status: Optional[str] = None
    assignee_id: Optional[str] = None
    assignee_role: Optional[str] = None
    priority: Optional[str] = None


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
    "sales_dispatch": ["order_received", "confirmed", "in_production", "ready", "dispatched", "delivered"],
    "purchase_payment": ["requested", "approved", "ordered", "received", "payment_pending", "paid"],
}
WORKFLOW_OWNER_ROLE = {
    "sales_dispatch": {"order_received": "sales", "confirmed": "sales", "in_production": "production",
                        "ready": "production", "dispatched": "sales", "delivered": "sales"},
    "purchase_payment": {"requested": "production", "approved": "owner", "ordered": "production",
                         "received": "production", "payment_pending": "finance", "paid": "finance"},
}


# ---------------------------------------------------------------------------
# Activity log
# ---------------------------------------------------------------------------
async def log_activity(tenant_id: str, actor: str, kind: str, message: str, entity_type: str = None, entity_id: str = None):
    await db.activity.insert_one({
        "id": new_id(), "tenant_id": tenant_id, "actor": actor, "kind": kind,
        "message": message, "entity_type": entity_type, "entity_id": entity_id,
        "created_at": now_iso(),
    })


async def add_decision_event(decision_id: str, label: str, actor: str = "System", kind: str = "event"):
    await db.decisions.update_one(
        {"id": decision_id},
        {"$push": {"timeline": {"ts": now_iso(), "label": label, "actor": actor, "kind": kind}}})



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
def _extract_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text.strip("`")
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


async def ai_extract(transcript: str, session_id: str, allowed_roles: Optional[list] = None, members: Optional[list] = None) -> dict:
    roles = allowed_roles or ["owner", "sales", "operations", "finance"]
    roles_str = ",".join(roles)
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
        "\"priority\": one of [low,medium,high], \"due_in_days\": integer or null}], "
        "\"workflow_events\": [{\"type\": one of [sales_dispatch,purchase_payment], \"title\": string, \"detail\": string, \"counterparty\": string, \"amount\": number or null}], "
        "\"reminders\": [{\"title\": string, \"due_in_days\": integer or null}], "
        "\"meeting_events\": [{\"title\": string, \"when\": string, \"due_in_days\": integer or null}], "
        "\"memory_notes\": [{\"text\": string, \"tag\": string}]}. "
        + members_line +
        "Use 'reminders' for simple personal follow-ups (e.g. 'call Kumar tomorrow', 'follow up with Toyota next Monday'). "
        "Use 'meeting_events' for meetings/reviews/calls to be scheduled (e.g. 'arrange a sales review on Friday', 'set up a vendor call Monday'). Keep meetings OUT of reminders. "
        "Use 'workflow_events' ONLY for concrete order-fulfilment (sales_dispatch) or procurement (purchase_payment) items to track on the board — e.g. 'dispatch the Toyota order', 'raise a purchase for 50 spindles from Rajesh Traders'. Include the counterparty (customer/vendor name) and amount when mentioned. Do NOT put general rules/policies here — those belong in memory_notes. "
        "Use 'memory_notes' for lasting facts/policies the company should remember (e.g. 'don't purchase from XYZ again', 'salary increment for Arun from August'). "
        "The transcript may be in English, Tamil, or Tanglish (casual Tamil-English code-mix). Fully understand it regardless "
        "of language, and produce ALL output field values in clear English. "
        "Pick assignee_role ONLY from the provided role list. Infer sensible owners and due dates. If nothing applies, use empty arrays."
    )
    prompt = f"Founder directive transcript:\n\"\"\"\n{transcript}\n\"\"\"\nExtract the structured JSON now."
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
        "The transcript may be English, Tamil or Tanglish — understand it and output all values in clear English."
    )
    prompt = f"Meeting transcript:\n\"\"\"\n{(transcript or '')[:40000]}\n\"\"\"\nExtract the structured minutes now."
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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








async def transcribe_audio(path: str, language: str = "auto") -> str:
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    kwargs = {"model": "whisper-1", "response_format": "json"}
    if language == "en":
        kwargs["language"] = "en"
    elif language == "ta":
        kwargs["language"] = "ta"
    elif language == "tanglish":
        # Code-mixed Tamil-English: let Whisper auto-detect, bias with a prompt
        kwargs["prompt"] = ("This is Tanglish — casual code-mixed Tamil and English speech from an Indian "
                            "small-business owner. Keep English words in English.")
    with open(path, "rb") as f:
        resp = await stt.transcribe(file=f, **kwargs)
    return resp.text


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
    """Resolve a meeting's natural-language timing into an ISO date (YYYY-MM-DD)."""
    now = datetime.now(timezone.utc)
    if isinstance(due_in_days, int):
        return (now + timedelta(days=due_in_days)).date().isoformat()
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
    if "next week" in w:
        return (now + timedelta(days=7)).date().isoformat()
    return (now + timedelta(days=2)).date().isoformat()


async def process_voice_note(note_id: str):
    note = await db.voice_notes.find_one({"id": note_id})
    if not note:
        return
    tenant_id = note["tenant_id"]
    try:
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "transcribing"}})
        transcript = note.get("transcript")
        if not transcript and note.get("audio_path"):
            transcript = await transcribe_audio(note["audio_path"], note.get("language", "auto"))
            await db.voice_notes.update_one({"id": note_id}, {"$set": {"transcript": transcript}})

        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "structuring"}})
        troles = await tenant_role_keys(tenant_id)
        members = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        extracted = await ai_extract(transcript or "", session_id=f"extract-{note_id}", allowed_roles=sorted(troles), members=members)

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
            "task_ids": [],
        }
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
            if assignee_id:
                assignee_keys.add(f"u:{assignee_id}")
            elif role:
                assignee_keys.add(f"r:{role}")
            await db.tasks.insert_one({
                "id": tid, "tenant_id": tenant_id, "title": t.get("title", "Untitled task"),
                "description": t.get("description", ""), "assignee_role": role, "assignee_id": assignee_id,
                "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high") else "medium",
                "status": "blocked", "due_date": due, "decision_id": decision_id,
                "source": "voice", "created_at": now_iso(),
            })
            task_ids.append(tid)
        decision["task_ids"] = task_ids
        decision["timeline"] = [{"ts": now_iso(), "label": f"Decision captured from {note.get('kind') or 'voice'}", "actor": "Owner", "kind": "created"}]
        await db.decisions.insert_one(decision)
        _icls = "approval" if dtype == "approval" else ("task" if task_ids else "reminder")
        await add_inbox_item(tenant_id, note["created_by"],
                             "voice" if note.get("kind") == "audio" else "text",
                             _icls, decision["title"], (decision.get("summary") or "")[:180],
                             "decision", decision_id, status="open")
        # Voice shortcuts: lightweight reminders + company memory
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
        # Meetings: schedule a real calendar event + a lightweight (undated) to-do per detected meeting
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
        # Workflows: materialize each detected workflow_event into a real board card
        wf_ids = []
        for ev in (extracted.get("workflow_events") or []):
            wtype = ev.get("type")
            if wtype not in WORKFLOW_STAGES:
                continue
            stages = WORKFLOW_STAGES[wtype]
            title = (ev.get("title") or ev.get("action") or ("Order" if wtype == "sales_dispatch" else "Purchase")).strip()
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
@api.post("/onboarding/suggest")
async def onboarding_suggest(inp: OnboardingSuggestInput):
    system = (
        "You are an onboarding assistant for DecisionOS, a business operations app. "
        "Given an industry, propose the team roles/departments and example products or services a small business in that "
        "industry would have. Return ONLY valid JSON, no prose: "
        "{\"roles\": [{\"key\": lowercase_snake_case_slug, \"label\": Human Readable}], "
        "\"products\": [{\"name\": string, \"description\": short string}]}. "
        "Provide 3-6 roles (do NOT include 'owner' — it is implicit) and 3-5 example products/services. Keep it specific to the industry."
    )
    prompt = f"Industry: {inp.industry}\nCompany size: {inp.company_size or 'unspecified'}\nExtra notes: {inp.description or 'none'}\nSuggest roles and example products/services now."
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"onboard-{new_id()}", system_message=system).with_model(*LLM_MODEL)
    try:
        resp = await chat.send_message(UserMessage(text=prompt))
        data = _extract_json(resp)
    except Exception as e:
        logger.error(f"onboarding_suggest failed: {e}")
        data = {}
    roles = []
    for r in (data.get("roles") or []):
        label = (r.get("label") or r.get("key") or "").strip()
        key = (r.get("key") or label).strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")
        if key and key != "owner":
            roles.append({"key": key, "label": label or key.replace("_", " ").title()})
    products = []
    for p in (data.get("products") or []):
        name = (p.get("name") or "").strip()
        if name:
            products.append({"name": name, "description": (p.get("description") or "").strip()})
    if not roles:
        roles = DEFAULT_ROLES
    return {"roles": roles[:6], "products": products[:5]}


@api.post("/auth/register")
async def register(inp: RegisterInput):
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    tenant_id = new_id()
    roles = [r.model_dump() for r in (inp.roles or [])] or DEFAULT_ROLES
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
    return {"token": token, "user": user, "tenant": tenant}


@api.post("/auth/login")
async def login(inp: LoginInput):
    email = inp.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(inp.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["tenant_id"], user["role"])
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    user.pop("_id", None)
    user.pop("password_hash", None)
    return {"token": token, "user": user, "tenant": tenant}


# ---------------------------------------------------------------------------
# Mobile + OTP login (alternate auth). DEV mode returns OTP until Twilio keys added.
# ---------------------------------------------------------------------------
OTP_TTL_SECONDS = 300
OTP_MAX_ATTEMPTS = 5
OTP_RESEND_COOLDOWN = 30
TWILIO_ENABLED = bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN") and os.environ.get("TWILIO_FROM_NUMBER"))


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
    code = f"{secrets.randbelow(1000000):06d}"  # cryptographically secure OTP
    now = datetime.now(timezone.utc)
    await db.otp_codes.update_one(
        {"phone": norm},
        {"$set": {"phone": norm, "code_hash": _hash_otp(code, norm),
                  "expires_at": (now + timedelta(seconds=OTP_TTL_SECONDS)).isoformat(),
                  "created_at": now.isoformat(), "attempts": 0}},
        upsert=True,
    )
    sent = await _send_otp_sms(display_phone, code)
    resp = {"sent": sent, "dev_mode": not TWILIO_ENABLED}
    if not TWILIO_ENABLED:
        resp["dev_otp"] = code  # DEV ONLY — remove once real SMS is live
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
async def verify_otp(inp: OtpVerifyInput):
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
    return {"token": token, "user": user, "tenant": tenant}



@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"user": user, "tenant": tenant}


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
    if inp.role not in await tenant_role_keys(user["tenant_id"]):
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
    if target["role"] == "owner":
        raise HTTPException(status_code=400, detail="Owner access cannot be changed")
    updates = {}
    if inp.role is not None:
        if inp.role not in await tenant_role_keys(user["tenant_id"]) or inp.role == "owner":
            raise HTTPException(status_code=400, detail="Invalid role")
        updates["role"] = inp.role
    if inp.permissions is not None:
        updates["permissions"] = clean_perms(inp.permissions)
    if inp.phone is not None:
        updates["phone"] = inp.phone.strip()
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
async def create_voice_note(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(require_role("owner"))):
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


@api.post("/voice-notes/text")
async def create_text_note(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_role("owner"))):
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
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
async def clarify_directive(inp: ClarifyInput, user: dict = Depends(require_role("owner"))):
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


@api.get("/operating-score")
async def operating_score(user: dict = Depends(require_role("owner"))):
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    can_finance = user.get("role") == "owner" or "finance" in user_perms(user)

    tasks = await db.tasks.find({"tenant_id": tid}, {"_id": 0}).to_list(2000)
    decisions = await db.decisions.find({"tenant_id": tid}, {"_id": 0, "status": 1}).to_list(2000)
    complaints = await db.complaints.find({"tenant_id": tid}, {"_id": 0, "status": 1}).to_list(500)

    def is_open(t):
        return t.get("status") in ("todo", "in_progress", "blocked")
    done = sum(1 for t in tasks if t.get("status") == "done")
    open_tasks = [t for t in tasks if is_open(t)]
    overdue = sum(1 for t in open_tasks if t.get("due_date") and t["due_date"] < now)
    actionable = done + len(open_tasks)
    completion = (done / actionable) if actionable else 0.7
    overdue_ratio = (overdue / len(open_tasks)) if open_tasks else 0
    execution = _clamp100(completion * 100 - overdue_ratio * 40)

    total_billed = total_paid = 0.0
    overdue_inv = 0
    if can_finance:
        invs = await db.invoices.find({"tenant_id": tid}, {"_id": 0, "amount": 1, "type": 1, "status": 1, "due_date": 1}).to_list(2000)
        pays = await db.payments.find({"tenant_id": tid}, {"_id": 0, "amount": 1}).to_list(2000)
        total_billed = sum(float(i.get("amount") or 0) for i in invs if i.get("type") == "sales_invoice")
        total_paid = sum(float(p.get("amount") or 0) for p in pays)
        overdue_inv = sum(1 for i in invs if i.get("type") == "sales_invoice" and i.get("status") != "paid" and i.get("due_date") and i["due_date"] < now)
    collected = (min(total_paid, total_billed) / total_billed) if total_billed else 0.7
    finance = _clamp100(collected * 100 - overdue_inv * 5) if can_finance else None

    total_dec = len(decisions)
    approved = sum(1 for d in decisions if d.get("status") == "approved")
    approved_rate = (approved / total_dec) if total_dec else 0.7
    sales = _clamp100(approved_rate * 100)

    open_complaints = sum(1 for c in complaints if c.get("status") != "resolved")
    responsiveness = _clamp100(100 - open_complaints * 12 - overdue * 3)

    categories = {"execution": execution, "finance": finance, "sales": sales, "responsiveness": responsiveness}
    weights = {"execution": 0.35, "finance": 0.25, "sales": 0.2, "responsiveness": 0.2}
    avail = {k: v for k, v in categories.items() if v is not None}
    wsum = sum(weights[k] for k in avail) or 1
    overall = _clamp100(sum(avail[k] * weights[k] for k in avail) / wsum)

    # Per-employee execution
    members = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
    employees = []
    for mbr in members:
        mine = [t for t in tasks if t.get("assignee_id") == mbr["id"] or (not t.get("assignee_id") and t.get("assignee_role") == mbr["role"])]
        m_done = sum(1 for t in mine if t.get("status") == "done")
        m_open = [t for t in mine if is_open(t)]
        m_overdue = sum(1 for t in m_open if t.get("due_date") and t["due_date"] < now)
        m_action = m_done + len(m_open)
        m_comp = (m_done / m_action) if m_action else 0
        m_score = _clamp100(m_comp * 100 - (m_overdue / len(m_open) if m_open else 0) * 40) if m_action else None
        employees.append({"id": mbr["id"], "name": mbr["name"], "role": mbr["role"],
                          "score": m_score, "done": m_done, "open": len(m_open), "overdue": m_overdue})
    employees.sort(key=lambda e: (e["score"] if e["score"] is not None else -1), reverse=True)

    return {
        "company": {"overall": overall, "categories": categories},
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
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system).with_model(*LLM_MODEL)
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
    return await enrich_decision(d)


@api.get("/decisions/{decision_id}/timeline")
async def decision_timeline(decision_id: str, user: dict = Depends(get_current_user)):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]},
                                    {"_id": 0, "title": 1, "status": 1, "timeline": 1})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
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
async def add_decision_task(decision_id: str, inp: TaskCreateInput, user: dict = Depends(require_role("owner"))):
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
async def approve_decision(decision_id: str, user: dict = Depends(require_role("owner"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "approved", "decided_at": now_iso()}})
    await db.tasks.update_many({"decision_id": decision_id, "status": "blocked"}, {"$set": {"status": "todo"}})
    await add_decision_event(decision_id, "Approved — tasks unblocked", user["name"], "approved")
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
async def reject_decision(decision_id: str, user: dict = Depends(require_role("owner"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "rejected", "decided_at": now_iso()}})
    await db.tasks.update_many({"decision_id": decision_id}, {"$set": {"status": "cancelled"}})
    await add_decision_event(decision_id, "Rejected", user["name"], "rejected")
    await log_activity(user["tenant_id"], user["id"], "decision_rejected", f"Rejected '{d['title']}'", "decision", decision_id)
    return await enrich_decision(await db.decisions.find_one({"id": decision_id}, {"_id": 0}))


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------
async def enrich_task(t: dict) -> dict:
    if t.get("assignee_id"):
        u = await db.users.find_one({"id": t["assignee_id"]}, {"_id": 0, "name": 1})
        t["assignee_name"] = u["name"] if u else None
    return t


async def enrich_tasks(tasks: list) -> list:
    ids = list({t["assignee_id"] for t in tasks if t.get("assignee_id")})
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            umap[u["id"]] = u["name"]
    for t in tasks:
        if t.get("assignee_id"):
            t["assignee_name"] = umap.get(t["assignee_id"])
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
async def create_task(inp: TaskCreateInput, user: dict = Depends(get_current_user)):
    tid = new_id()
    due = None
    if isinstance(inp.due_in_days, int):
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
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": role, "assignee_id": assignee_id, "priority": inp.priority or "medium",
        "status": "todo", "due_date": due, "decision_id": None, "source": "manual", "created_at": now_iso(),
    })
    await log_activity(user["tenant_id"], user["id"], "task_created", f"Created task '{inp.title}'", "task", tid)
    return await enrich_task(await db.tasks.find_one({"id": tid}, {"_id": 0}))


@api.patch("/tasks/{task_id}")
async def update_task(task_id: str, inp: TaskUpdateInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {k: v for k, v in inp.model_dump(exclude_unset=True).items() if v is not None}
    if "assignee_role" in updates and updates["assignee_role"] not in await tenant_role_keys(user["tenant_id"]):
        updates.pop("assignee_role")
    if updates.get("assignee_id"):
        member = await db.users.find_one({"id": updates["assignee_id"], "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1})
        if not member:
            updates.pop("assignee_id")
        else:
            updates["assignee_role"] = member["role"]
    if updates:
        await db.tasks.update_one({"id": task_id}, {"$set": updates})
        if updates.get("status") and t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → {updates['status'].replace('_',' ')}", user["name"], "task")
        if updates.get("status") == "done":
            await log_activity(user["tenant_id"], user["id"], "task_done", f"Completed task '{t['title']}'", "task", task_id)
        elif updates.get("assignee_id"):
            member = await db.users.find_one({"id": updates["assignee_id"]}, {"_id": 0, "name": 1})
            await log_activity(user["tenant_id"], user["id"], "task_assigned",
                               f"Assigned '{t['title']}' to {(member or {}).get('name', 'a member')}", "task", task_id)
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


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
    if inp.type not in WORKFLOW_STAGES:
        raise HTTPException(status_code=400, detail="Invalid workflow type")
    wid = new_id()
    stages = WORKFLOW_STAGES[inp.type]
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
    # purchase approval gate: only owner may move to 'approved'
    if wf["type"] == "purchase_payment" and inp.stage == "approved" and user["role"] != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can approve purchases")
    entry = {"stage": inp.stage, "note": inp.note or "", "by": user["id"], "at": now_iso()}
    await db.workflows.update_one({"id": workflow_id}, {"$set": {"stage": inp.stage}, "$push": {"history": entry}})
    await log_activity(user["tenant_id"], user["id"], "workflow_advanced", f"'{wf['title']}' → {inp.stage}", "workflow", workflow_id)
    return await db.workflows.find_one({"id": workflow_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Company Brain search
# ---------------------------------------------------------------------------
@api.get("/brain/search")
async def brain_search(q: str = "", user: dict = Depends(require_perm("brain"))):
    tid = user["tenant_id"]
    tokens = [re.escape(t) for t in q.split() if len(t) >= 2]
    rx = {"$regex": "|".join(tokens), "$options": "i"} if tokens else {"$exists": True}
    decisions = await db.decisions.find({"tenant_id": tid, "$or": [{"title": rx}, {"summary": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    tasks = await db.tasks.find({"tenant_id": tid, "$or": [{"title": rx}, {"description": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    workflows = await db.workflows.find({"tenant_id": tid, "$or": [{"title": rx}, {"detail": rx}, {"counterparty": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    contacts = await db.contacts.find({"tenant_id": tid, "$or": [{"name": rx}, {"company": rx}, {"email": rx}, {"phone": rx}, {"notes": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    memory = await db.memory.find({"tenant_id": tid, "text": rx}, {"_id": 0}).sort("created_at", -1).to_list(50)
    invoices = await db.invoices.find({"tenant_id": tid, "$or": [{"number": rx}, {"contact_name": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {
        "decisions": await enrich_decisions(decisions),
        "tasks": await enrich_tasks(tasks),
        "workflows": workflows,
        "contacts": await enrich_contacts(contacts),
        "memory": memory,
        "invoices": invoices,
    }


# ---------------------------------------------------------------------------
# Ask AI
# ---------------------------------------------------------------------------
@api.post("/ask")
async def ask_ai(inp: AskInput, user: dict = Depends(require_perm("ask"))):
    tid = user["tenant_id"]
    decisions = await db.decisions.find({"tenant_id": tid}, {"_id": 0, "title": 1, "summary": 1, "status": 1}).sort("created_at", -1).to_list(60)
    tasks = await db.tasks.find({"tenant_id": tid}, {"_id": 0, "title": 1, "status": 1, "assignee_role": 1, "due_date": 1}).sort("created_at", -1).to_list(120)
    workflows = await db.workflows.find({"tenant_id": tid}, {"_id": 0, "title": 1, "type": 1, "stage": 1, "amount": 1, "counterparty": 1}).sort("created_at", -1).to_list(60)
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "name": 1, "role": 1}).to_list(60)
    contacts = await db.contacts.find({"tenant_id": tid}, {"_id": 0, "name": 1, "company": 1, "type": 1, "status": 1, "phone": 1, "email": 1}).sort("created_at", -1).to_list(100)
    memory = await db.memory.find({"tenant_id": tid}, {"_id": 0, "text": 1, "tag": 1}).sort("created_at", -1).to_list(100)

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
    money_access = "finance" in user_perms(user)
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
        "Citations MUST be the specific records you used to answer (empty array if none)."
    )
    prompt = f"Company context:\n{json.dumps(context)}\n\nQuestion: {inp.question}"
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"ask-{tid}", system_message=system).with_model(*LLM_MODEL)
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
    return {
        "pending_decisions": await enrich_decisions(pending_decisions),
        "pending_purchases": pending_purchases,
        "overdue_tasks": await enrich_tasks(overdue),
        "stats": {"open_tasks": open_tasks, "done_tasks": done_tasks, "active_workflows": active_wf,
                  "pending_approvals": len(pending_decisions) + len(pending_purchases)},
        "activity": activity,
        "wins": wins,
    }


@api.post("/brief/send-digest")
async def send_digest(user: dict = Depends(require_role("owner"))):
    data = await dashboard(user)  # reuse
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    stats = data["stats"]
    html = f"""
    <h2>DecisionOS Daily Brief — {tenant['name']}</h2>
    <p>{stats['pending_approvals']} pending approvals · {stats['open_tasks']} open tasks · {len(data['overdue_tasks'])} overdue · {stats['active_workflows']} active workflows</p>
    <h3>Pending Approvals</h3>
    <ul>{''.join(f"<li>{d['title']}</li>" for d in data['pending_decisions']) or '<li>None</li>'}</ul>
    <h3>Overdue Tasks</h3>
    <ul>{''.join(f"<li>{t['title']}</li>" for t in data['overdue_tasks']) or '<li>None</li>'}</ul>
    """
    resend_key = os.environ.get("RESEND_API_KEY", "")
    if resend_key:
        try:
            import resend
            resend.api_key = resend_key
            resend.Emails.send({
                "from": os.environ.get("RESEND_FROM_EMAIL", "DecisionOS <onboarding@resend.dev>"),
                "to": [user["email"]],
                "subject": f"DecisionOS Daily Brief — {tenant['name']}",
                "html": html,
            })
            return {"sent": True, "to": user["email"], "provider": "resend"}
        except Exception as e:
            logger.error(f"Resend send failed: {e}")
            raise HTTPException(status_code=502, detail="Email provider error")
    logger.info(f"[DIGEST MOCK] To {user['email']}:\n{html}")
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


async def push_notification(tenant_id, user_ids, level, message, entity_type=None, entity_id=None):
    for uid in set(u for u in user_ids if u):
        await db.notifications.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "user_id": uid, "level": NOTIF_LEVELS.get(level, "reminder"),
            "message": message, "entity_type": entity_type, "entity_id": entity_id, "read": False, "created_at": now_iso(),
        })


async def dispatch_owner_alert(tenant_id, message):
    owners = await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "email": 1}).to_list(10)
    resend_key = os.environ.get("RESEND_API_KEY", "")
    if resend_key and owners:
        try:
            import resend
            resend.api_key = resend_key
            resend.Emails.send({"from": os.environ.get("RESEND_FROM_EMAIL", "DecisionOS <onboarding@resend.dev>"),
                                "to": [o["email"] for o in owners], "subject": "DecisionOS — Owner Alert",
                                "html": f"<p>{message}</p>"})
        except Exception as e:
            logger.error(f"owner email alert failed: {e}")
    else:
        logger.info(f"[EMAIL MOCK] Owner alert: {message}")
    # WhatsApp: ready-to-plug (requires WHATSAPP_API_KEY / provider)
    if not os.environ.get("WHATSAPP_API_KEY", ""):
        logger.info(f"[WHATSAPP MOCK] Owner alert: {message}")


async def run_followup(tenant_id: str):
    now = datetime.now(timezone.utc)
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
        counters = {"delayed": delayed, "completed": completed, "awaiting_approval": pending_dec + pending_pur,
                    "absent": absent, "complaints": complaints, "payment_overdue": payment_overdue, "fires": fires}
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

    if key in {"awaiting_approval", "absent", "complaints", "payment_overdue", "fires"} and not is_owner:
        return {"key": key, "actionable": False, "items": []}

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
        for a in acts:
            items.append({"id": a["id"], "title": a.get("message"), "subtitle": "", "kind": "activity"})

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
                          "meta": w.get("amount"), "kind": "purchase"})

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
                          "meta": c.get("severity"), "kind": "complaint"})

    elif key == "payment_overdue":
        recs = await db.workflows.find({"tenant_id": tid, "type": "purchase_payment", "stage": "payment_pending"}, {"_id": 0}).to_list(200)
        for w in recs:
            items.append({"id": w["id"], "title": w.get("title"), "subtitle": w.get("counterparty") or "",
                          "meta": w.get("amount"), "kind": "payment"})

    elif key == "fires":
        tasks = await db.tasks.find({"tenant_id": tid, "source": "escalation", "status": {"$ne": "done"}}, {"_id": 0}).sort("created_at", -1).to_list(200)
        tasks = await enrich_tasks(tasks)
        for t in tasks:
            sub = f"Raised by {t['raised_by_name']}" if t.get("raised_by_name") else (t.get("assignee_name") or "")
            items.append({"id": t["id"], "title": t["title"], "subtitle": sub, "meta": t.get("priority"), "kind": "escalation"})

    return {"key": key, "actionable": actionable, "items": items}




@api.post("/tasks/{task_id}/attachment")
async def upload_task_attachment(task_id: str, file: UploadFile = File(...), kind: str = Form("photo"), user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    ext = (file.filename or "file.bin").split(".")[-1]
    fname = f"att_{task_id}_{new_id()}.{ext}"
    with open(UPLOAD_DIR / fname, "wb") as f:
        f.write(await file.read())
    att = {"kind": kind, "filename": fname, "url": f"/api/files/{fname}", "at": now_iso()}
    await db.tasks.update_one({"id": task_id}, {"$push": {"attachments": att}})
    return att


@api.get("/files/{fname}")
async def get_file(fname: str):
    from fastapi.responses import FileResponse
    path = UPLOAD_DIR / fname
    if not path.exists() or "/" in fname or ".." in fname:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(str(path))


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
    "Rules: A sales invoice is money owed TO the company by a customer (party type=customer). "
    "A purchase bill is money the company owes a vendor (party type=vendor). "
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
    "If it lists payments/receipts, fill 'payments'. Map each spreadsheet row to exactly one record. Amounts are plain numbers. "
    "Default currency to {currency}. Use empty arrays for the entities that do not apply."
)


def _normalise_records(data: dict) -> dict:
    out = {}
    for k in ("contacts", "invoices", "payments", "tasks"):
        out[k] = data.get(k) if isinstance(data.get(k), list) else []
    return out


async def ai_extract_document(file_path: str, mime_type: str, session_id: str, currency: str = "INR") -> dict:
    fc = FileContentWithMimeType(file_path=file_path, mime_type=mime_type)
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id,
                   system_message=_DOC_SYSTEM.replace("{currency}", currency)).with_model(*VISION_MODEL)
    resp = await chat.send_message(UserMessage(text="Extract the structured JSON from this document now.", file_contents=[fc]))
    data = _extract_json(resp)
    return {
        "summary": data.get("summary", ""),
        "doc_type": data.get("doc_type", "other"),
        "confidence": data.get("confidence", 0.7),
        "records": _normalise_records(data),
    }


async def ai_map_spreadsheet(headers: list, rows: list, session_id: str, currency: str = "INR") -> dict:
    payload = {"headers": headers, "rows": rows[:300]}
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id,
                   system_message=_CSV_SYSTEM.replace("{currency}", currency)).with_model(*LLM_MODEL)
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


async def commit_ingestion_records(tenant_id: str, user_id: str, records: dict, ingestion_id: str, source: str) -> dict:
    created = {"contacts": 0, "invoices": 0, "payments": 0, "tasks": 0}
    currency = await _tenant_currency(tenant_id)
    troles = await tenant_role_keys(tenant_id)
    followup_role = "finance" if "finance" in troles else ("sales" if "sales" in troles else None)
    name_to_id = {}

    async def resolve_contact(name: str, ctype: str = "customer"):
        name = (name or "").strip()
        if not name:
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
        if not name:
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
        await db.invoices.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "type": itype,
            "number": str(inv.get("number") or ""), "contact_id": cid,
            "contact_name": (inv.get("contact_name") or "").strip(),
            "date": inv.get("date", "") or "", "due_date": inv.get("due_date", "") or "",
            "amount": amount, "currency": inv.get("currency") or currency,
            "status": "unpaid", "line_items": inv.get("line_items") if isinstance(inv.get("line_items"), list) else [],
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["invoices"] += 1

    for p in records.get("payments", []):
        direction = p.get("direction") if p.get("direction") in ("in", "out") else "in"
        ctype = "customer" if direction == "in" else "vendor"
        cid = await resolve_contact(p.get("contact_name"), ctype)
        try:
            amount = float(p.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        await db.payments.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "direction": direction, "amount": amount,
            "date": p.get("date", "") or "", "method": p.get("method", "") or "",
            "reference": p.get("reference", "") or "", "contact_id": cid,
            "contact_name": (p.get("contact_name") or "").strip(),
            "invoice_number": str(p.get("invoice_number") or ""), "currency": currency,
            "source": source, "ingestion_id": ingestion_id, "created_by": user_id, "created_at": now_iso(),
        })
        created["payments"] += 1

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
        result = await ai_extract_document(str(path), DOC_MIME[ext], f"ingest-{ing_id}", currency)
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
        result = await ai_map_spreadsheet(headers, rows, f"ingest-{ing_id}", currency)
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

    # Deliveries (open sales workflows)
    wfs = await db.workflows.find(
        {"tenant_id": tid, "type": "sales_dispatch", "stage": {"$nin": ["delivered", "paid"]}},
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

    events = [e for e in events if start <= e["date"] <= end]
    for e in events:
        if e["type"] == "birthday":
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
            raise HTTPException(status_code=403, detail="Invalid signature")
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


async def resolve_wa_tenant(sender: str):
    sp = _norm_phone(sender)
    if sp:
        async for t in db.tenants.find({"invited_employees.0": {"$exists": True}}, {"_id": 0, "id": 1, "invited_employees": 1}):
            for inv in t.get("invited_employees", []):
                if _norm_phone(inv.get("phone")) == sp:
                    return t["id"]
    return os.environ.get("WA_TENANT_ID") or None


async def download_wa_media(media_id: str) -> bytes:
    token = os.environ.get("WA_ACCESS_TOKEN")
    ver = os.environ.get("GRAPH_API_VERSION", "v21.0")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=60) as c:
        meta = (await c.get(f"https://graph.facebook.com/{ver}/{media_id}", headers=headers)).json()
        url = meta.get("url")
        if not url:
            raise Exception("media url unavailable")
        return (await c.get(url, headers=headers)).content


async def send_wa_reply(to_phone: str, text: str):
    token = os.environ.get("WA_ACCESS_TOKEN")
    pnid = os.environ.get("WA_PHONE_NUMBER_ID")
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
    try:
        tenant_id = await resolve_wa_tenant(sender)
        if not tenant_id:
            logger.info(f"[WHATSAPP] no tenant for {sender}; ignoring")
            return
        owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1})
        owner_id = owner["id"] if owner else "whatsapp"

        if mtype in ("image", "document"):
            media = message[mtype]
            mime = media.get("mime_type", "application/pdf" if mtype == "document" else "image/jpeg").split(";")[0]
            if mime not in WA_MIME_EXT:
                await send_wa_reply(sender, "Sorry, I can only read PDF or image invoices/receipts.")
                return
            ext = WA_MIME_EXT[mime]
            data = await download_wa_media(media["id"])
            ing_id = new_id()
            fname = f"ingest_{ing_id}.{ext}"
            with open(UPLOAD_DIR / fname, "wb") as f:
                f.write(data)
            currency = await _tenant_currency(tenant_id)
            result = await ai_extract_document(str(UPLOAD_DIR / fname), mime, f"ingest-{ing_id}", currency)
            doc = {
                "id": ing_id, "tenant_id": tenant_id, "created_by": owner_id, "source": "whatsapp",
                "kind": "pdf" if ext == "pdf" else "image", "filename": media.get("filename") or fname,
                "file_url": f"/api/files/{fname}", "status": "review", "created_at": now_iso(),
                "summary": result["summary"], "doc_type": result["doc_type"],
                "confidence": result["confidence"], "records": result["records"],
                "wa_from": sender,
            }
            created = await commit_ingestion_records(tenant_id, owner_id, result["records"], ing_id, "whatsapp")
            doc.update({"status": "filed", "created_counts": created, "filed_at": now_iso()})
            await db.ingestions.insert_one(dict(doc))
            inbox_id = await add_inbox_item(tenant_id, owner_id, "whatsapp", _classify_ingestion(doc),
                                            doc["summary"] or doc["filename"], doc["filename"],
                                            "ingestion", ing_id, status="done")
            await db.ingestions.update_one({"id": ing_id}, {"$set": {"inbox_id": inbox_id}})
            await send_wa_reply(sender, f"✅ Filed to DecisionOS: {doc['summary'] or doc['filename']}\n"
                                        f"{created['invoices']} invoice(s), {created['payments']} payment(s), {created['contacts']} contact(s), {created['tasks']} task(s).")

        elif mtype == "text":
            text = message["text"]["body"]
            note_id = new_id()
            await db.voice_notes.insert_one({
                "id": note_id, "tenant_id": tenant_id, "created_by": owner_id, "kind": "text",
                "audio_path": None, "transcript": text, "language": "auto",
                "status": "queued", "source": "whatsapp", "created_at": now_iso(),
            })
            await process_voice_note(note_id)
            await send_wa_reply(sender, "✅ Got it — logged to DecisionOS and structured into your inbox.")
    except Exception:
        logger.exception("process_whatsapp_message failed")
        await send_wa_reply(sender, "Sorry, I couldn't process that. Please try again.")


# ---------------------------------------------------------------------------
# Seed demo workspace
# ---------------------------------------------------------------------------
DEMO_EMAIL = "owner@sharma.com"
DEMO_PASSWORD = "demo1234"


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
    sd_stages = WORKFLOW_STAGES["sales_dispatch"]
    pp_stages = WORKFLOW_STAGES["purchase_payment"]
    await db.workflows.insert_many([
        {"id": new_id(), "tenant_id": tid, "type": "sales_dispatch", "title": "Order #4821 — Delhi Retailer (500 units)",
         "detail": "Cotton kurta sets, festive collection", "amount": 385000, "counterparty": "Kapoor Retail Pvt Ltd", "contact_id": c_kapoor,
         "stage": "in_production", "stages": sd_stages,
         "history": [{"stage": "order_received", "note": "PO received", "by": sales_id, "at": now_iso()},
                     {"stage": "confirmed", "note": "Advance paid", "by": sales_id, "at": now_iso()},
                     {"stage": "in_production", "note": "Batch started", "by": prod_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "sales_dispatch", "title": "Order #4822 — Mumbai Boutique (120 units)",
         "detail": "Silk dupattas", "amount": 96000, "counterparty": "Threads Boutique", "contact_id": c_threads,
         "stage": "dispatched", "stages": sd_stages,
         "history": [{"stage": "order_received", "note": "", "by": sales_id, "at": now_iso()},
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


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.decisions.create_index("tenant_id")
    await db.tasks.create_index("tenant_id")
    await db.workflows.create_index("tenant_id")
    await seed_demo()
    await migrate_tenants()
    await fixup_demo_tenant()
    await write_test_credentials()


@api.get("/")
async def root():
    return {"message": "DecisionOS API"}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

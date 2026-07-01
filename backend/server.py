from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, UploadFile, File, Form, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from emergentintegrations.llm.chat import LlmChat, UserMessage
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
# Models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    company_name: str
    name: str
    email: EmailStr
    password: str = Field(min_length=6)


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class UserCreateInput(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    role: str


class TextNoteInput(BaseModel):
    text: str
    title: Optional[str] = None


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


class WorkflowAdvanceInput(BaseModel):
    stage: str
    note: Optional[str] = ""


class AskInput(BaseModel):
    question: str


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


async def ai_extract(transcript: str, session_id: str) -> dict:
    system = (
        "You are the extraction engine of DecisionOS, an operating brain for small businesses. "
        "Convert a founder's spoken/written directive into structured operational data. "
        "Return ONLY valid JSON, no prose. Schema: "
        "{\"summary\": string, \"decisions\": [{\"title\": string, \"detail\": string, \"category\": string}], "
        "\"tasks\": [{\"title\": string, \"description\": string, \"assignee_role\": one of [owner,sales,production,finance], "
        "\"priority\": one of [low,medium,high], \"due_in_days\": integer or null}], "
        "\"workflow_events\": [{\"type\": one of [sales_dispatch,purchase_payment], \"action\": string, \"detail\": string}]}. "
        "Infer sensible owners and due dates. If nothing applies, use empty arrays."
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
    for k in ("decisions", "tasks", "workflow_events"):
        if not isinstance(data.get(k), list):
            data[k] = []
    return data


async def transcribe_audio(path: str) -> str:
    stt = OpenAISpeechToText(api_key=EMERGENT_LLM_KEY)
    with open(path, "rb") as f:
        resp = await stt.transcribe(file=f, model="whisper-1", response_format="json")
    return resp.text


# ---------------------------------------------------------------------------
# Voice note processing pipeline
# ---------------------------------------------------------------------------
async def process_voice_note(note_id: str):
    note = await db.voice_notes.find_one({"id": note_id})
    if not note:
        return
    tenant_id = note["tenant_id"]
    try:
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "transcribing"}})
        transcript = note.get("transcript")
        if not transcript and note.get("audio_path"):
            transcript = await transcribe_audio(note["audio_path"])
            await db.voice_notes.update_one({"id": note_id}, {"$set": {"transcript": transcript}})

        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "structuring"}})
        extracted = await ai_extract(transcript or "", session_id=f"extract-{note_id}")

        decision_id = new_id()
        decision = {
            "id": decision_id, "tenant_id": tenant_id, "voice_note_id": note_id,
            "title": (extracted.get("decisions") or [{}])[0].get("title") or (extracted.get("summary") or "New decision")[:80],
            "summary": extracted.get("summary", ""),
            "items": extracted.get("decisions", []),
            "workflow_events": extracted.get("workflow_events", []),
            "status": "pending_approval",
            "created_by": note["created_by"], "created_at": now_iso(),
            "task_ids": [],
        }
        task_ids = []
        for t in extracted.get("tasks", []):
            tid = new_id()
            due = None
            if isinstance(t.get("due_in_days"), int):
                due = (datetime.now(timezone.utc) + timedelta(days=t["due_in_days"])).isoformat()
            role = t.get("assignee_role") if t.get("assignee_role") in ROLES else None
            await db.tasks.insert_one({
                "id": tid, "tenant_id": tenant_id, "title": t.get("title", "Untitled task"),
                "description": t.get("description", ""), "assignee_role": role, "assignee_id": None,
                "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high") else "medium",
                "status": "blocked", "due_date": due, "decision_id": decision_id,
                "source": "voice", "created_at": now_iso(),
            })
            task_ids.append(tid)
        decision["task_ids"] = task_ids
        await db.decisions.insert_one(decision)
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "done", "decision_id": decision_id, "processed_at": now_iso()}})
        await log_activity(tenant_id, note["created_by"], "decision_extracted",
                           f"Extracted decision '{decision['title']}' with {len(task_ids)} task(s)", "decision", decision_id)
    except Exception as e:
        logger.exception("process_voice_note failed")
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "failed", "error": str(e)}})


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api.post("/auth/register")
async def register(inp: RegisterInput):
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    tenant_id = new_id()
    await db.tenants.insert_one({"id": tenant_id, "name": inp.company_name, "created_at": now_iso()})
    user_id = new_id()
    await db.users.insert_one({
        "id": user_id, "tenant_id": tenant_id, "name": inp.name, "email": email,
        "password_hash": hash_password(inp.password), "role": "owner", "created_at": now_iso(),
    })
    token = create_token(user_id, tenant_id, "owner")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return {"token": token, "user": user, "tenant": {"id": tenant_id, "name": inp.company_name}}


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


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0})
    return {"user": user, "tenant": tenant}


# ---------------------------------------------------------------------------
# Team / users
# ---------------------------------------------------------------------------
@api.get("/users")
async def list_users(user: dict = Depends(get_current_user)):
    users = await db.users.find({"tenant_id": user["tenant_id"]}, {"_id": 0, "password_hash": 0}).to_list(500)
    return users


@api.post("/users")
async def create_user(inp: UserCreateInput, user: dict = Depends(require_role("owner"))):
    if inp.role not in ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    email = inp.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    uid = new_id()
    await db.users.insert_one({
        "id": uid, "tenant_id": user["tenant_id"], "name": inp.name, "email": email,
        "password_hash": hash_password(inp.password), "role": inp.role, "created_at": now_iso(),
    })
    await log_activity(user["tenant_id"], user["id"], "user_added", f"Added {inp.name} as {inp.role}")
    return await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})


# ---------------------------------------------------------------------------
# Voice notes / ingestion
# ---------------------------------------------------------------------------
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)


@api.post("/voice-notes")
async def create_voice_note(background: BackgroundTasks, file: UploadFile = File(...), user: dict = Depends(require_role("owner"))):
    note_id = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    path = UPLOAD_DIR / f"{note_id}.{ext}"
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "audio", "audio_path": str(path), "transcript": None,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}


@api.post("/voice-notes/text")
async def create_text_note(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_role("owner"))):
    note_id = new_id()
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "text", "audio_path": None, "transcript": inp.text,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}


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
# Decisions
# ---------------------------------------------------------------------------
async def enrich_decision(d: dict) -> dict:
    tasks = await db.tasks.find({"id": {"$in": d.get("task_ids", [])}}, {"_id": 0}).to_list(200)
    creator = await db.users.find_one({"id": d.get("created_by")}, {"_id": 0, "name": 1})
    d["tasks"] = tasks
    d["created_by_name"] = creator["name"] if creator else "Unknown"
    return d


@api.get("/decisions")
async def list_decisions(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    decisions = await db.decisions.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [await enrich_decision(d) for d in decisions]


@api.get("/decisions/{decision_id}")
async def get_decision(decision_id: str, user: dict = Depends(get_current_user)):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    return await enrich_decision(d)


@api.post("/decisions/{decision_id}/approve")
async def approve_decision(decision_id: str, user: dict = Depends(require_role("owner"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "approved", "decided_at": now_iso()}})
    await db.tasks.update_many({"decision_id": decision_id, "status": "blocked"}, {"$set": {"status": "todo"}})
    await log_activity(user["tenant_id"], user["id"], "decision_approved", f"Approved '{d['title']}' — tasks unblocked", "decision", decision_id)
    return await enrich_decision(await db.decisions.find_one({"id": decision_id}, {"_id": 0}))


@api.post("/decisions/{decision_id}/reject")
async def reject_decision(decision_id: str, user: dict = Depends(require_role("owner"))):
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    await db.decisions.update_one({"id": decision_id}, {"$set": {"status": "rejected", "decided_at": now_iso()}})
    await db.tasks.update_many({"decision_id": decision_id}, {"$set": {"status": "cancelled"}})
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


@api.get("/tasks")
async def list_tasks(status: Optional[str] = None, mine: Optional[bool] = False, user: dict = Depends(get_current_user)):
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    if mine:
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]
    tasks = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [await enrich_task(t) for t in tasks]


@api.post("/tasks")
async def create_task(inp: TaskCreateInput, user: dict = Depends(get_current_user)):
    tid = new_id()
    due = None
    if isinstance(inp.due_in_days, int):
        due = (datetime.now(timezone.utc) + timedelta(days=inp.due_in_days)).isoformat()
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": inp.assignee_role if inp.assignee_role in ROLES else None,
        "assignee_id": inp.assignee_id, "priority": inp.priority or "medium",
        "status": "todo", "due_date": due, "decision_id": None, "source": "manual", "created_at": now_iso(),
    })
    await log_activity(user["tenant_id"], user["id"], "task_created", f"Created task '{inp.title}'", "task", tid)
    return await enrich_task(await db.tasks.find_one({"id": tid}, {"_id": 0}))


@api.patch("/tasks/{task_id}")
async def update_task(task_id: str, inp: TaskUpdateInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {k: v for k, v in inp.model_dump().items() if v is not None}
    if "assignee_role" in updates and updates["assignee_role"] not in ROLES:
        updates.pop("assignee_role")
    if updates:
        await db.tasks.update_one({"id": task_id}, {"$set": updates})
        if updates.get("status") == "done":
            await log_activity(user["tenant_id"], user["id"], "task_done", f"Completed task '{t['title']}'", "task", task_id)
    return await enrich_task(await db.tasks.find_one({"id": task_id}, {"_id": 0}))


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
    wf = {
        "id": wid, "tenant_id": user["tenant_id"], "type": inp.type, "title": inp.title,
        "detail": inp.detail or "", "amount": inp.amount, "counterparty": inp.counterparty,
        "stage": stages[0], "stages": stages,
        "history": [{"stage": stages[0], "note": "Created", "by": user["id"], "at": now_iso()}],
        "created_by": user["id"], "created_at": now_iso(),
    }
    await db.workflows.insert_one(wf)
    await log_activity(user["tenant_id"], user["id"], "workflow_created", f"Started {inp.type.replace('_', '→')} '{inp.title}'", "workflow", wid)
    wf.pop("_id", None)
    return wf


@api.patch("/workflows/{workflow_id}/advance")
async def advance_workflow(workflow_id: str, inp: WorkflowAdvanceInput, user: dict = Depends(get_current_user)):
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
async def brain_search(q: str = "", user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    rx = {"$regex": q, "$options": "i"} if q else {"$exists": True}
    decisions = await db.decisions.find({"tenant_id": tid, "$or": [{"title": rx}, {"summary": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    tasks = await db.tasks.find({"tenant_id": tid, "$or": [{"title": rx}, {"description": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    workflows = await db.workflows.find({"tenant_id": tid, "$or": [{"title": rx}, {"detail": rx}]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return {
        "decisions": [await enrich_decision(d) for d in decisions],
        "tasks": [await enrich_task(t) for t in tasks],
        "workflows": workflows,
    }


# ---------------------------------------------------------------------------
# Ask AI
# ---------------------------------------------------------------------------
@api.post("/ask")
async def ask_ai(inp: AskInput, user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    decisions = await db.decisions.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(60)
    tasks = await db.tasks.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(120)
    workflows = await db.workflows.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(60)
    users = await db.users.find({"tenant_id": tid}, {"_id": 0, "name": 1, "role": 1}).to_list(60)

    def slim_d(d):
        return {"title": d["title"], "summary": d.get("summary"), "status": d.get("status")}

    def slim_t(t):
        return {"title": t["title"], "status": t.get("status"), "role": t.get("assignee_role"), "due": t.get("due_date")}

    def slim_w(w):
        return {"title": w["title"], "type": w["type"], "stage": w.get("stage"), "amount": w.get("amount")}

    context = {
        "decisions": [slim_d(d) for d in decisions],
        "tasks": [slim_t(t) for t in tasks],
        "workflows": [slim_w(w) for w in workflows],
        "team": users,
    }
    system = (
        "You are the Ask AI assistant of DecisionOS. Answer questions ONLY using the provided company context JSON. "
        "Be concise, factual, and reference specific decisions, tasks or workflows. If the answer isn't in the data, "
        "say you don't have that information yet. Do not invent data."
    )
    prompt = f"Company context:\n{json.dumps(context)}\n\nQuestion: {inp.question}"
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"ask-{tid}", system_message=system).with_model(*LLM_MODEL)
    try:
        answer = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.exception("ask_ai failed")
        raise HTTPException(status_code=502, detail="AI service error")
    return {"answer": answer}


# ---------------------------------------------------------------------------
# Dashboard / daily brief
# ---------------------------------------------------------------------------
@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    pending_decisions = await db.decisions.find({"tenant_id": tid, "status": "pending_approval"}, {"_id": 0}).to_list(50)
    pending_purchases = await db.workflows.find({"tenant_id": tid, "type": "purchase_payment", "stage": "requested"}, {"_id": 0}).to_list(50)
    overdue = await db.tasks.find({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now, "$ne": None}}, {"_id": 0}).to_list(50)
    open_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}})
    done_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": "done"})
    active_wf = await db.workflows.count_documents({"tenant_id": tid, "stage": {"$nin": ["delivered", "paid"]}})
    activity = await db.activity.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(15)
    return {
        "pending_decisions": [await enrich_decision(d) for d in pending_decisions],
        "pending_purchases": pending_purchases,
        "overdue_tasks": [await enrich_task(t) for t in overdue],
        "stats": {"open_tasks": open_tasks, "done_tasks": done_tasks, "active_workflows": active_wf,
                  "pending_approvals": len(pending_decisions) + len(pending_purchases)},
        "activity": activity,
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
# Seed demo workspace
# ---------------------------------------------------------------------------
DEMO_EMAIL = "owner@sharma.com"
DEMO_PASSWORD = "demo1234"


async def seed_demo():
    if await db.users.find_one({"email": DEMO_EMAIL}):
        return
    logger.info("Seeding Sharma demo workspace...")
    tid = new_id()
    await db.tenants.insert_one({"id": tid, "name": "Sharma Textiles Pvt Ltd", "created_at": now_iso()})

    def mkuser(name, email, role):
        uid = new_id()
        return uid, {"id": uid, "tenant_id": tid, "name": name, "email": email,
                     "password_hash": hash_password(DEMO_PASSWORD), "role": role, "created_at": now_iso()}

    owner_id, owner = mkuser("Rajesh Sharma", DEMO_EMAIL, "owner")
    sales_id, sales = mkuser("Priya Nair", "sales@sharma.com", "sales")
    prod_id, prod = mkuser("Amit Verma", "production@sharma.com", "production")
    fin_id, fin = mkuser("Sunita Rao", "finance@sharma.com", "finance")
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

    # Workflows
    sd_stages = WORKFLOW_STAGES["sales_dispatch"]
    pp_stages = WORKFLOW_STAGES["purchase_payment"]
    await db.workflows.insert_many([
        {"id": new_id(), "tenant_id": tid, "type": "sales_dispatch", "title": "Order #4821 — Delhi Retailer (500 units)",
         "detail": "Cotton kurta sets, festive collection", "amount": 385000, "counterparty": "Kapoor Retail, Delhi",
         "stage": "in_production", "stages": sd_stages,
         "history": [{"stage": "order_received", "note": "PO received", "by": sales_id, "at": now_iso()},
                     {"stage": "confirmed", "note": "Advance paid", "by": sales_id, "at": now_iso()},
                     {"stage": "in_production", "note": "Batch started", "by": prod_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "sales_dispatch", "title": "Order #4822 — Mumbai Boutique (120 units)",
         "detail": "Silk dupattas", "amount": 96000, "counterparty": "Threads Boutique, Mumbai",
         "stage": "dispatched", "stages": sd_stages,
         "history": [{"stage": "order_received", "note": "", "by": sales_id, "at": now_iso()},
                     {"stage": "dispatched", "note": "Shipped via BlueDart", "by": sales_id, "at": now_iso()}],
         "created_by": sales_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "purchase_payment", "title": "PO #221 — Cotton yarn (2 tonnes)",
         "detail": "Q3 raw material stock", "amount": 240000, "counterparty": "Gujarat Cotton Mills",
         "stage": "requested", "stages": pp_stages,
         "history": [{"stage": "requested", "note": "Awaiting owner approval", "by": prod_id, "at": now_iso()}],
         "created_by": prod_id, "created_at": now_iso()},
        {"id": new_id(), "tenant_id": tid, "type": "purchase_payment", "title": "PO #219 — Packaging boxes",
         "detail": "5000 branded boxes", "amount": 45000, "counterparty": "PackWell Industries",
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


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.decisions.create_index("tenant_id")
    await db.tasks.create_index("tenant_id")
    await db.workflows.create_index("tenant_id")
    await seed_demo()
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

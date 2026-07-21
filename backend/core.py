"""Foundation module: config, DB client, auth helpers, permissions and small
shared utilities. Imported by both server.py and the route modules under
routers/ so that no router needs to import from server.py (breaks the
circular dependency).
"""
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')

import os
import json
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient

# --- Config -----------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
# All Claude Sonnet 4.6 calls use the user's own Anthropic key when set, else the Emergent universal key.
CLAUDE_KEY = os.environ.get('ANTHROPIC_API_KEY', '').strip() or EMERGENT_LLM_KEY
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
LLM_MODEL = ("anthropic", "claude-sonnet-4-6")
VISION_MODEL = ("gemini", "gemini-2.5-flash")

ROLES = ["owner", "sales", "production", "finance"]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("decisionos")

security = HTTPBearer(auto_error=False)

AUTH_COOKIE_NAME = "dos_token"
AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days, matches token exp


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME, value=token, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True, secure=True, samesite="none", path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/", samesite="none", secure=True, httponly=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


# --- Auth helpers -----------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, tenant_id: str, role: str) -> str:
    payload = {
        "sub": user_id, "tenant_id": tenant_id, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    # Prefer HttpOnly cookie; fall back to Bearer token for backward compatibility.
    token = request.cookies.get(AUTH_COOKIE_NAME) or (creds.credentials if creds else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
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


# --- Module-level access permissions ---------------------------------------
PERMISSION_KEYS = ["inbox", "voice_capture", "data_input", "people", "finance", "ledger", "workflows", "tasks", "brain", "ask", "approvals", "decisions_approve", "leave_approve", "team_manage"]
_BASE_PERMS = {"inbox", "data_input", "people", "workflows", "tasks", "brain", "ask"}
ROLE_DEFAULT_PERMS = {
    "sales": _BASE_PERMS,
    "finance": _BASE_PERMS | {"finance", "ledger"},
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


# --- Shared small helpers ---------------------------------------------------
async def log_activity(tenant_id: str, actor: str, kind: str, message: str,
                       entity_type: Optional[str] = None, entity_id: Optional[str] = None) -> None:
    await db.activity.insert_one({
        "id": new_id(), "tenant_id": tenant_id, "actor": actor, "kind": kind,
        "message": message, "entity_type": entity_type, "entity_id": entity_id,
        "created_at": now_iso(),
    })


async def add_decision_event(decision_id: str, label: str, actor: str = "System", kind: str = "event") -> None:
    await db.decisions.update_one(
        {"id": decision_id},
        {"$push": {"timeline": {"ts": now_iso(), "label": label, "actor": actor, "kind": kind}}})


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


def _slugify_key(label: str) -> str:
    return (label or "").strip().lower().replace(" ", "_").replace("/", "_").replace("-", "_")


def _bp_departments(data: dict) -> list:
    departments, seen = [], set()
    for d in (data.get("departments") or []):
        label = (d if isinstance(d, str) else (d.get("label") or d.get("name") or "")).strip()
        key = _slugify_key(label)
        if key and key != "owner" and key not in seen:
            seen.add(key)
            departments.append({"key": key, "label": label})
    return departments[:12]


def _bp_workflows(data: dict) -> list:
    out = []
    for w in (data.get("workflows") or data.get("workflow_templates") or []):
        name = (w if isinstance(w, str) else (w.get("name") or w.get("title") or "")).strip()
        if name:
            out.append({"name": name})
    return out[:16]


def _bp_op_tasks(data: dict) -> list:
    out = []
    for t in (data.get("operational_tasks") or data.get("operational_task_templates") or []):
        if isinstance(t, str):
            title, cat = t.strip(), "Other"
        else:
            title = (t.get("title") or t.get("name") or "").strip()
            cat = (t.get("category") or "Other").strip() or "Other"
        if title:
            out.append({"title": title, "category": cat})
    return out[:20]


def _bp_rules(data: dict) -> list:
    out = []
    for r in (data.get("approval_rules") or []):
        if isinstance(r, str):
            name, desc = r.strip(), ""
        else:
            name = (r.get("name") or r.get("title") or "").strip()
            desc = (r.get("description") or "").strip()
        if name:
            out.append({"name": name, "description": desc})
    return out[:10]


def normalize_os_blueprint(data: dict) -> dict:
    """Coerce a raw (AI or user) blueprint into clean, editable lists."""
    return {
        "departments": _bp_departments(data),
        "workflows": _bp_workflows(data),
        "operational_tasks": _bp_op_tasks(data),
        "approval_rules": _bp_rules(data),
    }


# ---------------------------------------------------------------------------
# Business vocabulary (industry-tailored UI terminology)
# ---------------------------------------------------------------------------
DEFAULT_LEXICON = {
    "customer_singular": "Customer",
    "customer_plural": "Customers",
    "vendor_singular": "Supplier",
    "vendor_plural": "Suppliers",
    "workflows": {
        "production": {"label": "Production", "sub": "Order → Ready"},
        "distribution": {"label": "Distribution", "sub": "Dispatch → Deliver"},
        "purchase_payment": {"label": "Procurement", "sub": "Purchase → Payment"},
    },
    "task_types": {
        "operational": "Operational",
        "sales": "Sales",
        "purchase": "Purchase",
        "production": "Production",
        "finance": "Finance",
        "hr": "HR",
    },
}


def normalize_lexicon(data: dict) -> dict:
    """Merge a raw (AI or user) vocabulary over defaults, keeping only known keys."""
    d = data or {}

    def _s(v, fb):
        v = (str(v).strip() if v is not None else "")
        return v or fb

    base = DEFAULT_LEXICON
    out = {
        "customer_singular": _s(d.get("customer_singular"), base["customer_singular"]),
        "customer_plural": _s(d.get("customer_plural"), base["customer_plural"]),
        "vendor_singular": _s(d.get("vendor_singular"), base["vendor_singular"]),
        "vendor_plural": _s(d.get("vendor_plural"), base["vendor_plural"]),
        "workflows": {},
        "task_types": {},
    }
    wf_in = d.get("workflows") or {}
    for k, dv in base["workflows"].items():
        v = wf_in.get(k) or {}
        out["workflows"][k] = {"label": _s(v.get("label"), dv["label"]), "sub": _s(v.get("sub"), dv["sub"])}
    tt_in = d.get("task_types") or {}
    for k, dv in base["task_types"].items():
        out["task_types"][k] = _s(tt_in.get(k), dv)
    return out

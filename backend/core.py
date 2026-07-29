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

# --- Runtime AI provider keys (platform-admin updatable, DB-backed w/ env fallback) ---
# Effective keys live in memory; env provides the initial/fallback value and a DB
# doc (platform_settings id="ai_keys") can override them at runtime without a restart.
_AI_KEY_ENV = {
    "anthropic": os.environ.get('ANTHROPIC_API_KEY', '').strip(),
    "openai": os.environ.get('OPENAI_API_KEY', '').strip(),
    "gemini": os.environ.get('GEMINI_API_KEY', '').strip(),
    "sarvam": os.environ.get('SARVAM_API_KEY', '').strip(),
    "wa_access_token": os.environ.get('WA_ACCESS_TOKEN', '').strip(),
    "wa_phone_number_id": os.environ.get('WA_PHONE_NUMBER_ID', '').strip(),
}
AI_KEY_PROVIDERS = list(_AI_KEY_ENV.keys())
_ai_keys = dict(_AI_KEY_ENV)


async def load_ai_keys_from_db() -> None:
    doc = await db.platform_settings.find_one({"id": "ai_keys"}, {"_id": 0})
    if not doc:
        return
    for k in _AI_KEY_ENV:
        v = (doc.get(k) or "").strip()
        _ai_keys[k] = v or _AI_KEY_ENV[k]


def get_ai_key(provider: str) -> str:
    return _ai_keys.get(provider, "") or ""


def set_ai_keys(values: dict) -> None:
    """Update in-memory keys. An empty string reverts a provider to its env value."""
    for k in _AI_KEY_ENV:
        if k in values:
            v = (values.get(k) or "").strip()
            _ai_keys[k] = v or _AI_KEY_ENV[k]


def ai_key_source(provider: str) -> str:
    v = _ai_keys.get(provider, "")
    if not v:
        return "not_set"
    env_v = _AI_KEY_ENV.get(provider, "")
    return "env" if (env_v and v == env_v) else "custom"


def mask_key(v: str) -> str:
    v = v or ""
    if not v:
        return ""
    if len(v) <= 10:
        return v[:2] + "…"
    return f"{v[:6]}…{v[-4:]}"


def claude_key() -> str:
    """User's Anthropic key when set, else the Emergent universal key (never breaks)."""
    return _ai_keys.get("anthropic") or EMERGENT_LLM_KEY


# --- Usage tracking + provider outage alerts (platform admin) ---------------
import contextvars  # noqa: E402
_ctx_tenant = contextvars.ContextVar("dos_tenant", default=None)

# Rough per-provider rates ($/1M tokens: input, output) — estimates, not real billing.
_PROVIDER_RATES = {
    "anthropic": (3.0, 15.0),   # Claude Sonnet
    "emergent": (3.0, 15.0),    # Emergent proxies Claude Sonnet
    "gemini": (0.30, 2.50),     # Gemini 2.5 Flash
}
_OPENAI_STT_PER_MIN = 0.006     # transcription $/minute (approx)
_SARVAM_STT_PER_MIN = 0.0072    # Sarvam Saaras STT ~ Rs 0.60/min (approx, estimate)
_COST_IN_PER_M = 3.0
_COST_OUT_PER_M = 15.0


def set_usage_tenant(tenant_id):
    if tenant_id:
        _ctx_tenant.set(tenant_id)


def _est_tokens(text: str) -> int:
    return max(0, len(text or "") // 4)


def _est_cost(provider: str, tokens_in: int, tokens_out: int) -> float:
    ri, ro = _PROVIDER_RATES.get(provider, (_COST_IN_PER_M, _COST_OUT_PER_M))
    return tokens_in / 1e6 * ri + tokens_out / 1e6 * ro


async def log_usage(feature, provider, *, tenant_id=None, model=None,
                    tokens_in=0, tokens_out=0, units=0, unit_type=None, cost=None):
    """Record one AI usage event for any provider (Claude/OpenAI/Gemini). tenant_id
    defaults to the request-scoped context var. Never raises."""
    try:
        tid = tenant_id or _ctx_tenant.get()
        ti, to = int(tokens_in or 0), int(tokens_out or 0)
        if cost is None:
            cost = _est_cost(provider, ti, to)
        await db.usage_events.insert_one({
            "id": new_id(), "tenant_id": tid or None, "feature": feature,
            "provider": provider, "model": model,
            "tokens_in": ti, "tokens_out": to, "tokens_total": ti + to,
            "units": units or 0, "unit_type": unit_type,
            "cost_estimate": round(cost, 6), "created_at": now_iso(),
        })
    except Exception as e:  # never let logging break an AI call
        logger.debug(f"usage log failed: {e}")


async def _record_usage(tenant_id, session_id, provider, system, message, resp):
    feature = (session_id or "misc").split("-")[0]
    in_text = f"{system or ''} {getattr(message, 'text', '') or ''}"
    await log_usage(feature, provider, tenant_id=tenant_id, model=LLM_MODEL[1],
                    tokens_in=_est_tokens(in_text), tokens_out=_est_tokens(resp or ""))


async def _record_provider_alert(provider, message):
    try:
        m = (message or "").lower()
        status = "out_of_credits" if any(s in m for s in ("credit", "billing", "insufficient")) else "error"
        await db.platform_alerts.update_one(
            {"provider": provider, "resolved": False},
            {"$set": {"status": status, "message": (message or "")[:300], "last_seen": now_iso()},
             "$setOnInsert": {"id": new_id(), "provider": provider, "created_at": now_iso(),
                              "resolved": False, "notified": False}},
            upsert=True)
    except Exception as e:
        logger.debug(f"alert record failed: {e}")


async def _resolve_provider_alert(provider):
    try:
        await db.platform_alerts.update_many(
            {"provider": provider, "resolved": False},
            {"$set": {"resolved": True, "resolved_at": now_iso()}})
    except Exception:
        pass


class _ResilientChat:
    """Drop-in for LlmChat(api_key=claude_key(), ...) that tries the user's Anthropic
    key first and automatically falls back to the Emergent universal key if the call
    fails (e.g. Anthropic credit balance too low / invalid key), so AI never hard-breaks.
    Also records per-workspace usage and raises/clears provider outage alerts."""

    def __init__(self, session_id: str, system_message: str, tenant_id=None):
        self.session_id = session_id
        self.system_message = system_message
        self.tenant_id = tenant_id
        self.model = LLM_MODEL

    def with_model(self, *model):
        if model:
            self.model = model
        return self

    async def send_message(self, message):
        from emergentintegrations.llm.chat import LlmChat
        anthropic = get_ai_key("anthropic")
        keys, seen = [], set()
        for k in (anthropic, EMERGENT_LLM_KEY):
            if k and k not in seen:
                seen.add(k)
                keys.append(k)
        tenant_id = self.tenant_id or _ctx_tenant.get()
        last_err = None
        for i, key in enumerate(keys):
            try:
                chat = LlmChat(api_key=key, session_id=self.session_id,
                               system_message=self.system_message).with_model(*self.model)
                resp = await chat.send_message(message)
                provider = "anthropic" if (key == anthropic and anthropic) else "emergent"
                if provider == "anthropic":
                    await _resolve_provider_alert("anthropic")
                await _record_usage(tenant_id, self.session_id, provider, self.system_message, message, resp)
                return resp
            except Exception as e:
                last_err = e
                if i == 0 and key == anthropic and anthropic:
                    await _record_provider_alert("anthropic", str(e))
                using_fallback = i + 1 < len(keys)
                logger.warning(
                    f"Claude call failed on key {i + 1}/{len(keys)}"
                    f"{' — retrying with Emergent universal key' if using_fallback else ''}: {e}")
        raise last_err if last_err else RuntimeError("No LLM key configured")


def claude_chat(session_id: str = None, system_message: str = None, tenant_id=None, **_ignored) -> _ResilientChat:
    """Factory matching the old LlmChat(api_key=..., session_id=..., system_message=...) call shape."""
    return _ResilientChat(session_id, system_message, tenant_id=tenant_id)

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


# --- Platform super-admin auth (separate from tenant users) -----------------
ADMIN_COOKIE_NAME = "dos_admin_token"


def create_admin_token(admin_id: str) -> str:
    payload = {
        "sub": admin_id, "type": "platform_admin",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_admin_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ADMIN_COOKIE_NAME, value=token, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True, secure=True, samesite="none", path="/",
    )


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(key=ADMIN_COOKIE_NAME, path="/", samesite="none", secure=True, httponly=True)


async def get_platform_admin(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    token = request.cookies.get(ADMIN_COOKIE_NAME) or (creds.credentials if creds else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != "platform_admin":
        raise HTTPException(status_code=403, detail="Not a platform admin")
    admin = await db.platform_admins.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not admin:
        raise HTTPException(status_code=401, detail="Admin not found")
    return admin


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
    if user.get("suspended") or user.get("tenant_suspended"):
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact your administrator.")
    set_usage_tenant(user.get("tenant_id"))
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


# ---------------------------------------------------------------------------
# Operating Model: industry-specific pipelines + task categories.
# The board & My Work are driven by this per-tenant structure (not hardcoded).
# Defaults mirror the original manufacturing model so existing tenants backfill
# to exactly what they had before.
# ---------------------------------------------------------------------------
def _st(key, label):
    return {"key": key, "label": label}


DEFAULT_OPERATING_MODEL = {
    "pipelines": [
        {
            "key": "production", "label": "Production", "sub": "Order → Ready", "approval_stage": None,
            "stages": [_st("order_received", "Order Received"), _st("confirmed", "Confirmed"),
                       _st("in_production", "In Production"), _st("ready", "Ready")],
        },
        {
            "key": "distribution", "label": "Distribution", "sub": "Dispatch → Deliver", "approval_stage": None,
            "stages": [_st("ready_to_dispatch", "Ready To Dispatch"), _st("dispatched", "Dispatched"),
                       _st("in_transit", "In Transit"), _st("delivered", "Delivered")],
        },
        {
            "key": "purchase_payment", "label": "Procurement", "sub": "Purchase → Payment", "approval_stage": "approved",
            "stages": [_st("requested", "Requested"), _st("approved", "Approved"), _st("ordered", "Ordered"),
                       _st("received", "Received"), _st("payment_pending", "Payment Pending"), _st("paid", "Paid")],
        },
    ],
    "task_categories": [
        _st("operational", "Operational"), _st("sales", "Sales"), _st("purchase", "Purchase"),
        _st("production", "Production"), _st("finance", "Finance"), _st("hr", "HR"),
    ],
}


def _norm_stage(s, used):
    label = (s if isinstance(s, str) else (s.get("label") or s.get("name") or "")).strip()
    key = (s.get("key") if isinstance(s, dict) else "") or _slugify_key(label)
    key = _slugify_key(key)
    if not key or not label or key in used:
        return None
    used.add(key)
    return {"key": key, "label": label}


def normalize_operating_model(data: dict) -> dict:
    """Coerce a raw (AI or user) operating model into a clean, editable structure."""
    d = data or {}
    pipelines, seen_p = [], set()
    for p in (d.get("pipelines") or []):
        if not isinstance(p, dict):
            continue
        label = (p.get("label") or p.get("name") or "").strip()
        key = _slugify_key(p.get("key") or label)
        if not key or not label or key in seen_p:
            continue
        used_st = set()
        stages = []
        for s in (p.get("stages") or []):
            ns = _norm_stage(s, used_st)
            if ns:
                stages.append(ns)
            if len(stages) >= 8:
                break
        if not stages:
            continue
        stage_keys = {s["key"] for s in stages}
        appr = p.get("approval_stage")
        appr = appr if appr in stage_keys else None
        seen_p.add(key)
        pipelines.append({
            "key": key, "label": label,
            "sub": (p.get("sub") or "").strip() or f"{stages[0]['label']} → {stages[-1]['label']}",
            "stages": stages, "approval_stage": appr,
        })
        if len(pipelines) >= 6:
            break
    cats, seen_c = [], set()
    for c in (d.get("task_categories") or []):
        label = (c if isinstance(c, str) else (c.get("label") or c.get("name") or "")).strip()
        key = _slugify_key(c.get("key") if isinstance(c, dict) else label) or _slugify_key(label)
        if key and label and key not in seen_c:
            seen_c.add(key)
            cats.append({"key": key, "label": label})
        if len(cats) >= 10:
            break
    if not pipelines:
        pipelines = DEFAULT_OPERATING_MODEL["pipelines"]
    if not cats:
        cats = DEFAULT_OPERATING_MODEL["task_categories"]
    return {"pipelines": pipelines, "task_categories": cats}

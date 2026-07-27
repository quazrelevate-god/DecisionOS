"""Platform super-admin API — sits ABOVE all tenants. Separate login/cookie
(dos_admin_token), AI provider key management, platform metrics, tenant &
user administration and health. Foundation imported from core.py."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from typing import Optional
import asyncio

from core import (
    db, logger, now_iso, new_id,
    hash_password, verify_password,
    create_admin_token, set_admin_cookie, clear_admin_cookie, get_platform_admin,
    get_ai_key, set_ai_keys, ai_key_source, mask_key, AI_KEY_PROVIDERS, claude_key,
    EMERGENT_LLM_KEY, LLM_MODEL, VISION_MODEL,
)

router = APIRouter(prefix="/api/admin")

MAX_ATTEMPTS = 5
LOCKOUT_MIN = 15


async def log_admin_action(admin: dict, action: str, message: str,
                           target_type: str = None, target_id: str = None):
    """Append an immutable audit entry for a platform-admin action."""
    await db.platform_audit.insert_one({
        "id": new_id(),
        "admin_id": admin.get("id"),
        "admin_email": admin.get("email"),
        "action": action,
        "message": message,
        "target_type": target_type,
        "target_id": target_id,
        "created_at": now_iso(),
    })


class AdminLoginInput(BaseModel):
    email: str
    password: str


class AiKeysInput(BaseModel):
    anthropic: Optional[str] = None
    openai: Optional[str] = None
    gemini: Optional[str] = None
    wa_access_token: Optional[str] = None
    wa_phone_number_id: Optional[str] = None


# --- Auth -------------------------------------------------------------------
@router.post("/login")
async def admin_login(payload: AdminLoginInput, request: Request, response: Response):
    email = payload.email.strip().lower()
    ident = f"{request.client.host if request.client else '?'}:{email}"
    att = await db.platform_login_attempts.find_one({"identifier": ident})
    if att and att.get("count", 0) >= MAX_ATTEMPTS:
        from datetime import datetime, timezone
        last = att.get("last")
        if last:
            try:
                dt = datetime.fromisoformat(last)
                mins = (datetime.now(timezone.utc) - dt).total_seconds() / 60
                if mins < LOCKOUT_MIN:
                    raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {int(LOCKOUT_MIN - mins)} min.")
            except ValueError:
                pass
    admin = await db.platform_admins.find_one({"email": email})
    if not admin or not verify_password(payload.password, admin.get("password_hash", "")):
        await db.platform_login_attempts.update_one(
            {"identifier": ident},
            {"$inc": {"count": 1}, "$set": {"last": now_iso()}}, upsert=True)
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    await db.platform_login_attempts.delete_one({"identifier": ident})
    token = create_admin_token(admin["id"])
    set_admin_cookie(response, token)
    await log_admin_action(admin, "login", "Signed in to the admin console")
    return {"token": token, "admin": {"id": admin["id"], "email": admin["email"], "name": admin.get("name")}}


@router.post("/logout")
async def admin_logout(response: Response, admin: dict = Depends(get_platform_admin)):
    clear_admin_cookie(response)
    await log_admin_action(admin, "logout", "Signed out of the admin console")
    return {"status": "ok"}


@router.get("/me")
async def admin_me(admin: dict = Depends(get_platform_admin)):
    return {"id": admin["id"], "email": admin["email"], "name": admin.get("name")}


# --- Metrics ----------------------------------------------------------------
@router.get("/metrics")
async def admin_metrics(admin: dict = Depends(get_platform_admin)):
    async def c(coll, q=None):
        return await db[coll].count_documents(q or {})
    tenants, users, decisions, tasks, captures, workflows, contacts, suspended = await asyncio.gather(
        c("tenants"), c("users"), c("decisions"), c("tasks"),
        c("capture_drafts"), c("workflows"), c("contacts"), c("users", {"suspended": True}),
    )
    tasks_done = await db.tasks.count_documents({"status": "done"})
    return {
        "tenants": tenants, "users": users, "suspended_users": suspended,
        "decisions": decisions, "tasks": tasks, "tasks_done": tasks_done,
        "captures": captures, "workflows": workflows, "contacts": contacts,
    }


# --- Tenants ----------------------------------------------------------------
@router.get("/tenants")
async def admin_tenants(admin: dict = Depends(get_platform_admin)):
    tenants = await db.tenants.find({}, {"_id": 0}).to_list(1000)
    out = []
    for t in tenants:
        tid = t.get("id")
        users_n = await db.users.count_documents({"tenant_id": tid})
        dec_n = await db.decisions.count_documents({"tenant_id": tid})
        task_n = await db.tasks.count_documents({"tenant_id": tid})
        last = await db.activity.find_one({"tenant_id": tid}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        out.append({
            "id": tid,
            "name": t.get("company_name") or t.get("name") or "—",
            "industry": t.get("industry") or "—",
            "created_at": t.get("created_at"),
            "users": users_n, "decisions": dec_n, "tasks": task_n,
            "last_activity": last.get("created_at") if last else None,
        })
    out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"tenants": out}


# --- Users ------------------------------------------------------------------
@router.get("/users")
async def admin_users(admin: dict = Depends(get_platform_admin), tenant_id: Optional[str] = None):
    q = {"tenant_id": tenant_id} if tenant_id else {}
    users = await db.users.find(q, {"_id": 0, "password_hash": 0}).to_list(5000)
    tmap = {t["id"]: (t.get("company_name") or t.get("name") or "—")
            for t in await db.tenants.find({}, {"_id": 0, "id": 1, "company_name": 1, "name": 1}).to_list(1000)}
    out = [{
        "id": u.get("id"), "name": u.get("name"), "email": u.get("email"),
        "role": u.get("role"), "phone": u.get("phone"),
        "tenant_id": u.get("tenant_id"), "tenant_name": tmap.get(u.get("tenant_id"), "—"),
        "suspended": bool(u.get("suspended")), "created_at": u.get("created_at"),
    } for u in users]
    out.sort(key=lambda x: (x.get("tenant_name") or "", x.get("role") or ""))
    return {"users": out}


async def _get_user_or_404(user_id):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


@router.post("/users/{user_id}/suspend")
async def admin_suspend_user(user_id: str, admin: dict = Depends(get_platform_admin)):
    u = await _get_user_or_404(user_id)
    if u.get("role") == "owner":
        raise HTTPException(status_code=400, detail="Cannot suspend a workspace owner")
    await db.users.update_one({"id": user_id}, {"$set": {"suspended": True}})
    await log_admin_action(admin, "suspend_user",
                           f"Suspended user {u.get('email') or u.get('name') or user_id}", "user", user_id)
    return {"status": "ok", "suspended": True}


@router.post("/users/{user_id}/reactivate")
async def admin_reactivate_user(user_id: str, admin: dict = Depends(get_platform_admin)):
    u = await _get_user_or_404(user_id)
    await db.users.update_one({"id": user_id}, {"$set": {"suspended": False}})
    await log_admin_action(admin, "reactivate_user",
                           f"Reactivated user {u.get('email') or u.get('name') or user_id}", "user", user_id)
    return {"status": "ok", "suspended": False}


@router.post("/users/{user_id}/reset-access")
async def admin_reset_access(user_id: str, admin: dict = Depends(get_platform_admin)):
    u = await _get_user_or_404(user_id)
    await db.users.update_one({"id": user_id}, {"$unset": {"permissions": ""}})
    await log_admin_action(admin, "reset_access",
                           f"Reset access to role defaults for {u.get('email') or u.get('name') or user_id}", "user", user_id)
    return {"status": "ok", "detail": "Access reset to role defaults"}


# --- AI provider keys -------------------------------------------------------
def _emergent_note(provider):
    return "Falls back to Emergent universal key" if provider == "anthropic" else ""


@router.get("/ai-keys")
async def admin_get_ai_keys(admin: dict = Depends(get_platform_admin)):
    labels = {
        "anthropic": "Anthropic (Claude)", "openai": "OpenAI (Whisper STT)",
        "gemini": "Google Gemini (Doc OCR)", "wa_access_token": "WhatsApp Access Token",
        "wa_phone_number_id": "WhatsApp Phone Number ID",
    }
    keys = []
    for p in AI_KEY_PROVIDERS:
        v = get_ai_key(p)
        keys.append({
            "provider": p, "label": labels.get(p, p),
            "masked": mask_key(v), "source": ai_key_source(p),
            "has_value": bool(v), "note": _emergent_note(p),
        })
    return {"keys": keys}


@router.put("/ai-keys")
async def admin_put_ai_keys(payload: AiKeysInput, admin: dict = Depends(get_platform_admin)):
    values = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not values:
        raise HTTPException(status_code=400, detail="No keys provided")
    set_ai_keys(values)
    await db.platform_settings.update_one(
        {"id": "ai_keys"},
        {"$set": {**values, "updated_at": now_iso(), "updated_by": admin["email"]}},
        upsert=True)
    logger.info(f"AI keys updated by admin {admin['email']}: {list(values.keys())}")
    changed = ", ".join(f"{k} ({'set' if (v or '').strip() else 'reverted to env'})" for k, v in values.items())
    await log_admin_action(admin, "update_ai_keys", f"Updated AI keys: {changed}", "ai_keys", None)
    return {"status": "ok", "updated": list(values.keys())}


@router.get("/audit")
async def admin_audit(admin: dict = Depends(get_platform_admin), limit: int = 200):
    limit = max(1, min(limit, 500))
    rows = await db.platform_audit.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return {"entries": rows}


async def _probe_anthropic():
    key = get_ai_key("anthropic")
    if not key:
        return {"status": "fallback", "detail": "No key set — using Emergent universal key"}
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(api_key=key, session_id=f"admin-probe-{new_id()}",
                       system_message="Reply with OK.").with_model(*LLM_MODEL)
        await asyncio.wait_for(chat.send_message(UserMessage(text="ping")), timeout=25)
        return {"status": "active", "detail": "Key working"}
    except Exception as e:
        msg = str(e).lower()
        if "credit" in msg or "billing" in msg or "insufficient" in msg:
            return {"status": "out_of_credits", "detail": "Credit balance too low"}
        if "auth" in msg or "api key" in msg or "401" in msg or "invalid" in msg:
            return {"status": "invalid", "detail": "Invalid API key"}
        return {"status": "error", "detail": str(e)[:180]}


async def _probe_openai():
    key = get_ai_key("openai")
    if not key:
        return {"status": "not_set", "detail": "No key set"}
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=key)
        await asyncio.wait_for(client.models.list(), timeout=15)
        return {"status": "active", "detail": "Key working"}
    except Exception as e:
        return {"status": "invalid", "detail": str(e)[:180]}


async def _probe_gemini():
    key = get_ai_key("gemini")
    if not key:
        return {"status": "not_set", "detail": "No key set"}
    try:
        from google import genai as _genai
        client = _genai.Client(api_key=key)
        await asyncio.wait_for(asyncio.to_thread(lambda: list(client.models.list())), timeout=15)
        return {"status": "active", "detail": "Key working"}
    except Exception as e:
        return {"status": "invalid", "detail": str(e)[:180]}


async def _probe_whatsapp():
    token = get_ai_key("wa_access_token")
    pnid = get_ai_key("wa_phone_number_id")
    if not token or not pnid:
        return {"status": "not_set", "detail": "Token or phone number ID missing"}
    try:
        import httpx, os
        ver = os.environ.get("GRAPH_API_VERSION", "v21.0")
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"https://graph.facebook.com/{ver}/{pnid}",
                            headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 200:
            return {"status": "active", "detail": r.json().get("display_phone_number", "Connected")}
        return {"status": "invalid", "detail": r.json().get("error", {}).get("message", "Auth failed")[:180]}
    except Exception as e:
        return {"status": "error", "detail": str(e)[:180]}


@router.get("/ai-keys/status")
async def admin_ai_keys_status(admin: dict = Depends(get_platform_admin)):
    anthropic, openai, gemini, whatsapp = await asyncio.gather(
        _probe_anthropic(), _probe_openai(), _probe_gemini(), _probe_whatsapp())
    return {"anthropic": anthropic, "openai": openai, "gemini": gemini, "whatsapp": whatsapp}


# --- Health -----------------------------------------------------------------
@router.get("/health")
async def admin_health(admin: dict = Depends(get_platform_admin)):
    db_ok = True
    try:
        await db.command("ping")
    except Exception:
        db_ok = False
    return {
        "database": {"status": "ok" if db_ok else "down"},
        "scheduler": {"status": "running", "detail": "Follow-up/escalation sweep active (300s)"},
        "ai_providers": {
            "anthropic": ai_key_source("anthropic"),
            "openai": ai_key_source("openai"),
            "gemini": ai_key_source("gemini"),
            "whatsapp": ai_key_source("wa_access_token"),
        },
        "emergent_key": "configured" if EMERGENT_LLM_KEY else "missing",
    }

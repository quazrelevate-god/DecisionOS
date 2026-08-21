"""Platform super-admin API — sits ABOVE all tenants. Separate login/cookie
(dos_admin_token), AI provider key management, platform metrics, tenant &
user administration and health. Foundation imported from core.py."""
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import asyncio

from core import (
    db, logger, now_iso, new_id,
    hash_password, verify_password,
    create_admin_token, set_admin_cookie, clear_admin_cookie, get_platform_admin,
    get_ai_key, set_ai_keys, ai_key_source, mask_key, AI_KEY_PROVIDERS, claude_key,
    EMERGENT_LLM_KEY, LLM_MODEL, VISION_MODEL,
    login_response,
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
    sarvam: Optional[str] = None
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
    # FIX-006-A (S0-08): cookie is source of truth for admin auth too.
    return login_response(
        token,
        admin={"id": admin["id"], "email": admin["email"], "name": admin.get("name")},
    )


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
            "suspended": bool(t.get("suspended")),
        })
    out.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"tenants": out}


@router.post("/tenants/{tenant_id}/suspend")
async def admin_suspend_tenant(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "company_name": 1, "name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"suspended": True}})
    await db.users.update_many({"tenant_id": tenant_id}, {"$set": {"tenant_suspended": True}})
    name = t.get("company_name") or t.get("name") or tenant_id
    await log_admin_action(admin, "suspend_tenant", f"Suspended workspace {name}", "tenant", tenant_id)
    return {"status": "ok", "suspended": True}


@router.post("/tenants/{tenant_id}/reactivate")
async def admin_reactivate_tenant(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "company_name": 1, "name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"suspended": False}})
    await db.users.update_many({"tenant_id": tenant_id}, {"$unset": {"tenant_suspended": ""}})
    name = t.get("company_name") or t.get("name") or tenant_id
    await log_admin_action(admin, "reactivate_tenant", f"Reactivated workspace {name}", "tenant", tenant_id)
    return {"status": "ok", "suspended": False}


# All tenant-scoped collections — wiped when a workspace is permanently deleted.
#
# CRITICAL: this list is the single source of truth for tenant deletion. If a
# NEW collection is added anywhere in the codebase with a `tenant_id` field,
# it MUST be added here or the tenant's data survives a "delete" — which is a
# GDPR / India-DPDP-Act "right to erasure" violation.
#
# The coverage test at `tests/test_tenant_deletion.py` seeds a synthetic tenant
# with data in every listed collection, deletes them, and asserts zero rows
# remain. If someone adds a collection and forgets this list, that test fails
# loudly — that's the drift-detection layer.
#
# FIX-007-A (S4-03): renamed `brain_contexts` (plural, /ask query-plan
# cache) to `brain_query_cache` so the singular/plural collision with
# `brain_context` (decision-provenance store) stops being a foot-gun.
# Both are still tenant-scoped and both must be wiped. Backward-compat:
# `brain_contexts` stays in the list so any lingering pre-rename data
# on a staging tenant that predates the migration still gets cleaned
# up on tenant delete.
TENANT_COLLECTIONS = [
    # Core workspace records
    "users", "tasks", "decisions", "workflows", "contacts", "capture_drafts",
    # Finance / ledger
    "invoices", "payments", "expenses", "assets", "inventory", "ledger_ai",
    # HR
    "leaves", "attendance",
    # Communication + capture
    "meetings", "voice_notes", "inbox", "notifications", "ingestions",
    # Activity + memory
    "activity", "memory", "complaints", "calendar_events",
    # Company Brain — DECISION-PROVENANCE store (singular) — added by FIX-001-E
    "brain_context",
    # Company Brain — DOCUMENTS catalog — added by FIX-001-E
    "brain_documents",
    # /ask query plan cache — renamed FIX-007-A (S4-03) from brain_contexts
    "brain_query_cache",
    # Legacy name kept for wipe-list back-compat (pre-rename staging data)
    "brain_contexts",
    # Audit / ops
    "brain_audit", "usage_events", "wa_events", "files",
]


@router.delete("/tenants/{tenant_id}")
async def admin_delete_tenant(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    """Permanently delete a workspace and ALL its data. Irreversible.

    FIX-001-E: also deletes uploaded files from object storage (previously
    the DB rows were wiped but the files lingered in the shared bucket
    forever — a real DPDP / GDPR "right to erasure" gap).
    """
    from services import obj_store  # deferred: avoid circular / test-time import cost
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "id": 1, "company_name": 1, "name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    name = t.get("company_name") or t.get("name") or tenant_id

    # 1. Delete uploaded files from object storage FIRST (before wiping the
    #    `files` collection, since that's the manifest of what to delete).
    #    Best-effort per file — a single storage failure cannot block the
    #    DB wipe (compliance requires the records go regardless).
    files_deleted = 0
    files_failed = 0
    async for f in db.files.find({"tenant_id": tenant_id}, {"_id": 0, "storage_path": 1}):
        path = f.get("storage_path")
        if not path:
            continue
        if await obj_store.delete_object(path):
            files_deleted += 1
        else:
            files_failed += 1

    # 2. Wipe every tenant-scoped collection.
    removed = {}
    for coll in TENANT_COLLECTIONS:
        res = await db[coll].delete_many({"tenant_id": tenant_id})
        if res.deleted_count:
            removed[coll] = res.deleted_count

    # 3. Finally, delete the tenant document itself.
    await db.tenants.delete_one({"id": tenant_id})

    total = sum(removed.values())
    await log_admin_action(
        admin, "delete_tenant",
        f"Permanently deleted workspace {name} ({total} records wiped, "
        f"{files_deleted} files deleted, {files_failed} file failures)",
        "tenant", tenant_id,
    )
    return {
        "status": "ok", "deleted": True,
        "records_removed": removed, "total_removed": total,
        "files_deleted": files_deleted, "files_failed": files_failed,
    }


# --- AI usage / credit consumption per workspace ----------------------------
def _range_cutoff(rng: str):
    now = datetime.now(timezone.utc)
    if rng == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    if rng == "7d":
        return (now - timedelta(days=7)).isoformat()
    if rng == "30d":
        return (now - timedelta(days=30)).isoformat()
    return None  # all-time


@router.get("/usage")
async def admin_usage(admin: dict = Depends(get_platform_admin), range: str = "30d", provider: str = "all"):
    cutoff = _range_cutoff(range)
    base = {} if cutoff is None else {"created_at": {"$gte": cutoff}}

    # Per-provider breakdown (always across all providers in range)
    prov_rows = await db.usage_events.aggregate([
        {"$match": base},
        {"$group": {"_id": "$provider", "calls": {"$sum": 1},
                    "tokens_total": {"$sum": "$tokens_total"}, "cost": {"$sum": "$cost_estimate"}}},
    ]).to_list(50)
    by_provider = [{"provider": r["_id"] or "unknown", "calls": r["calls"],
                    "tokens_total": r["tokens_total"], "cost_estimate": round(r["cost"], 4)}
                   for r in prov_rows]
    by_provider.sort(key=lambda x: x["cost_estimate"], reverse=True)

    # Per-workspace rows (optionally filtered by provider)
    match = dict(base)
    if provider and provider != "all":
        match["provider"] = provider
    rows = await db.usage_events.aggregate([
        {"$match": match},
        {"$group": {"_id": "$tenant_id", "calls": {"$sum": 1},
                    "tokens_in": {"$sum": "$tokens_in"}, "tokens_out": {"$sum": "$tokens_out"},
                    "tokens_total": {"$sum": "$tokens_total"}, "cost": {"$sum": "$cost_estimate"}}},
    ]).to_list(2000)
    tmap = {t["id"]: (t.get("company_name") or t.get("name") or "—")
            for t in await db.tenants.find({}, {"_id": 0, "id": 1, "company_name": 1, "name": 1}).to_list(2000)}
    workspaces, totals = [], {"calls": 0, "tokens_total": 0, "cost": 0.0}
    for r in rows:
        tid = r["_id"]
        workspaces.append({
            "tenant_id": tid,
            "tenant_name": "System / Onboarding" if not tid else tmap.get(tid, "(deleted workspace)"),
            "calls": r["calls"], "tokens_in": r["tokens_in"], "tokens_out": r["tokens_out"],
            "tokens_total": r["tokens_total"], "cost_estimate": round(r["cost"], 4),
        })
        totals["calls"] += r["calls"]
        totals["tokens_total"] += r["tokens_total"]
        totals["cost"] += r["cost"]
    workspaces.sort(key=lambda x: x["cost_estimate"], reverse=True)
    totals["cost"] = round(totals["cost"], 4)
    return {"range": range, "provider": provider, "totals": totals,
            "by_provider": by_provider, "workspaces": workspaces}


@router.get("/alerts")
async def admin_alerts(admin: dict = Depends(get_platform_admin)):
    active = await db.platform_alerts.find({"resolved": False}, {"_id": 0}).sort("created_at", -1).to_list(50)
    recent = await db.platform_alerts.find({"resolved": True}, {"_id": 0}).sort("resolved_at", -1).to_list(20)
    return {"active": active, "recent": recent}


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
    if provider == "anthropic":
        return "Falls back to Emergent universal key"
    if provider == "sarvam":
        return "Falls back to OpenAI transcription if unset"
    return ""


@router.get("/ai-keys")
async def admin_get_ai_keys(admin: dict = Depends(get_platform_admin)):
    labels = {
        "anthropic": "Anthropic (Claude)", "openai": "OpenAI (Whisper STT)",
        "gemini": "Google Gemini (Doc OCR)", "sarvam": "Sarvam (Indic Voice STT)",
        "wa_access_token": "WhatsApp Access Token",
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
        from services.ai.llm_limits import guarded_llm  # FIX-002-B: share the semaphore
        chat = LlmChat(api_key=key, session_id=f"admin-probe-{new_id()}",
                       system_message="Reply with OK.").with_model(*LLM_MODEL)
        # Keep the tighter 25s probe timeout — a bad key should surface
        # fast, not sit for the default 45s. Semaphore still applies so a
        # spammy probe can't starve real user requests.
        # FIX-005-B (S3-04): skip tenant quota check on the admin
        # key-probe path — refusing a probe because of tenant quota
        # would be user-hostile (probe should always run).
        await guarded_llm(chat.send_message(UserMessage(text="ping")),
                          label="claude:admin-probe", timeout=25,
                          skip_quota_check=True)
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


async def _probe_sarvam():
    key = get_ai_key("sarvam")
    if not key:
        return {"status": "not_set", "detail": "No key set — voice uses OpenAI fallback"}
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post("https://api.sarvam.ai/text-lid",
                             headers={"api-subscription-key": key},
                             json={"input": "hello"})
        if r.status_code == 200:
            return {"status": "active", "detail": "Key working"}
        if r.status_code in (401, 403):
            return {"status": "invalid", "detail": "Invalid API key"}
        return {"status": "error", "detail": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"status": "error", "detail": str(e)[:180]}


@router.get("/ai-keys/status")
async def admin_ai_keys_status(admin: dict = Depends(get_platform_admin)):
    sarvam, anthropic, openai, gemini, whatsapp = await asyncio.gather(
        _probe_sarvam(), _probe_anthropic(), _probe_openai(), _probe_gemini(), _probe_whatsapp())
    return {"sarvam": sarvam, "anthropic": anthropic, "openai": openai, "gemini": gemini, "whatsapp": whatsapp}


# --- Bulk purchase re-classification (fix mis-booked historical bills) ------
async def _run_reclassify_all(job_id: str, admin_email: str):
    from routers.ledger import resync_finance
    tenants = await db.tenants.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(10000)
    totals = {"reviewed": 0, "to_asset": 0, "to_inventory": 0, "kept_expense": 0, "unknown": 0, "unchanged": 0,
              "expenses_recategorized": 0, "assets_recategorized": 0,
              "payments_matched": 0, "invoices_settled": 0, "invoices_partial": 0}
    done = 0
    for t in tenants:
        tid = t["id"]
        try:
            owner = await db.users.find_one({"tenant_id": tid, "role": "owner"}, {"_id": 0, "id": 1, "name": 1})
            if owner:
                s = await resync_finance(tid, owner["id"], owner.get("name") or "Owner")
                for k in totals:
                    totals[k] += s.get(k, 0)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"finance resync failed for tenant {tid}: {e}")
        done += 1
        await db.reclassify_jobs.update_one(
            {"id": job_id}, {"$set": {"processed": done, "total": len(tenants), "totals": totals}})
    await db.reclassify_jobs.update_one(
        {"id": job_id}, {"$set": {"status": "done", "finished_at": now_iso(), "totals": totals}})


@router.post("/reclassify-purchases")
async def admin_reclassify_purchases(admin: dict = Depends(get_platform_admin)):
    """Start a background job that re-syncs finance (reclassify + re-categorize + recompute
    outstanding) across ALL workspaces."""
    running = await db.reclassify_jobs.find_one({"status": "running"}, {"_id": 0})
    if running:
        return {"job_id": running["id"], "status": "running", "already_running": True}
    tenant_count = await db.tenants.count_documents({})
    job_id = new_id()
    await db.reclassify_jobs.insert_one({
        "id": job_id, "status": "running", "started_by": admin.get("email"),
        "started_at": now_iso(), "processed": 0, "total": tenant_count,
        "totals": {"reviewed": 0, "to_asset": 0, "to_inventory": 0, "kept_expense": 0, "unknown": 0, "unchanged": 0,
                   "expenses_recategorized": 0, "assets_recategorized": 0,
                   "payments_matched": 0, "invoices_settled": 0, "invoices_partial": 0},
    })
    await log_admin_action(admin, "reclassify_purchases",
                           f"Started bulk finance re-sync across {tenant_count} workspaces",
                           "ledger", job_id)
    asyncio.create_task(_run_reclassify_all(job_id, admin.get("email")))
    return {"job_id": job_id, "status": "running", "total": tenant_count}


@router.get("/reclassify-purchases/status")
async def admin_reclassify_status(admin: dict = Depends(get_platform_admin)):
    job = await db.reclassify_jobs.find_one({}, {"_id": 0}, sort=[("started_at", -1)])
    return job or {"status": "none"}


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


# FIX-002-C: expose the migration ledger so ops can see which migrations
# have run + when. Platform-admin only.
@router.get("/migrations")
async def admin_migrations(admin: dict = Depends(get_platform_admin)):
    """List every migration recorded in the ledger. Useful for verifying
    a deploy actually applied its migrations, or diagnosing 'why does
    tenant X still have old shape?'"""
    from services.migrations import applied_migrations
    rows = await applied_migrations(db)
    # Also include any failed rows so ops see the trail.
    failed = await db["migrations_applied"].find(
        {"status": "failed"}, {"_id": 0}).sort("failed_at", -1).to_list(100)
    return {"applied": rows, "failed": failed, "total_applied": len(rows)}


# FIX-002-D: expose the scheduler leader lock so ops can see WHICH
# replica is currently the leader (and confirm exactly one is). Useful
# for debugging "why isn't the follow-up sweep running?" or "why did
# I get duplicate emails?"
@router.get("/scheduler-locks")
async def admin_scheduler_locks(admin: dict = Depends(get_platform_admin)):
    """List every leader lock currently in scheduler_locks. Includes a
    derived is_expired flag so ops can spot stale locks that TTL hasn't
    cleaned yet (Mongo TTL sweep runs every ~60s)."""
    from services.leader_lock import LOCK_COLLECTION
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = await db[LOCK_COLLECTION].find({}, {"_id": 1, "holder": 1,
                                               "acquired_at": 1, "expires_at": 1,
                                               "lease_seconds": 1}).to_list(50)
    for r in rows:
        r["name"] = r.pop("_id")
        exp = r.get("expires_at")
        r["is_expired"] = bool(exp and exp < now_iso)
    return {"locks": rows, "total": len(rows)}

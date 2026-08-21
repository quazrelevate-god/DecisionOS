"""Foundation module: shared helpers, permissions and legacy re-exports.

Historical single-file config/DB/auth/LLM home. As of Phase A of the
modular refactor, the pure config and database wiring live in dedicated
files (`config.py`, `database.py`). This module still re-exports every
symbol so `from core import db, get_current_user, ...` keeps working
across the whole codebase — Phase B will migrate imports one router at
a time.
"""
from pathlib import Path

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

# --- Re-exported foundation -------------------------------------------------
# config.py owns all env-driven constants. Importing them here keeps the
# public surface of `core` unchanged for every existing consumer.
from config import (  # noqa: F401 — re-exports
    MONGO_URL, DB_NAME,
    JWT_SECRET, JWT_ALGORITHM,
    PLATFORM_ADMIN_JWT_SECRET, AUTH_RETURN_TOKEN, SUPERADMIN_ALLOW_HASH_REFRESH,
    AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, ADMIN_COOKIE_NAME,
    CORS_ORIGINS, CSRF_COOKIE_NAME, CSRF_HEADER_NAME,
    CSRF_EXEMPT_PATHS, CSRF_ENFORCE,
    EMERGENT_LLM_KEY, CLAUDE_KEY,
    LLM_MODEL, VISION_MODEL,
    ROLES, PERMISSION_KEYS, DEFAULT_ROLES,
    AI_KEY_PROVIDERS, _AI_KEY_ENV,
    _PROVIDER_RATES, _OPENAI_STT_PER_MIN, _SARVAM_STT_PER_MIN,
    _COST_IN_PER_M, _COST_OUT_PER_M,
)

# database.py owns the AsyncMongoClient + shared `db` handle.
from database import client, db  # noqa: F401 — re-exports

mongo_url = MONGO_URL  # legacy alias kept for anything reading `core.mongo_url`

# Generic pure helpers moved to shared/ (Epic 8 Sprint 2). Re-exported so every
# `from core import now_iso, new_id, _extract_json` keeps working.
from shared.ids import now_iso, new_id  # noqa: F401,E402
from shared.json_utils import _extract_json  # noqa: F401,E402

# --- Runtime AI provider keys (mutable at runtime by platform admin) --------
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
        # FIX-002-B: bound in-flight LLM calls + per-call timeout so a burst
        # of 50 concurrent voice captures can't pile up on the single shared
        # Anthropic key and cascade into 429s / unbounded latency.
        from services.llm_limits import guarded_llm
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
                # Guard the actual network call — chat construction is cheap and
                # local, no need to hold a semaphore slot for it.
                _prov_label = "anthropic" if (key == anthropic and anthropic) else "emergent"
                resp = await guarded_llm(chat.send_message(message),
                                          label=f"claude:{_prov_label}:{self.session_id[:24]}")
                provider = _prov_label
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


def _mint_csrf_token() -> str:
    """Random URL-safe token. Uses secrets.token_urlsafe for cryptographic
    strength — CSRF tokens must be unpredictable per session."""
    import secrets
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str = None) -> str:
    """FIX-006-B (S0-02): set the double-submit CSRF cookie.

    Called by set_auth_cookie / set_admin_cookie so every login,
    register, switch-workspace, 2fa-verify, and OTP-verify path mints
    a fresh token. NOT HttpOnly — the frontend needs JS access to
    read it and echo it back as X-CSRF-Token.

    Returns the token so callers can also embed it in the response
    body when they need to (e.g. for tests, or future native clients
    that never see cookies)."""
    tok = token or _mint_csrf_token()
    response.set_cookie(
        key=CSRF_COOKIE_NAME, value=tok, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=False, secure=True, samesite="none", path="/",
    )
    return tok


def clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(key=CSRF_COOKIE_NAME, path="/",
                             samesite="none", secure=True, httponly=False)


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME, value=token, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True, secure=True, samesite="none", path="/",
    )
    # FIX-006-B (S0-02): mint CSRF token alongside the auth token so
    # every cookie-authed browser session has a matching double-submit
    # token available. No extra call site to update — every set_auth_cookie
    # caller inherits this for free.
    set_csrf_cookie(response)


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/", samesite="none", secure=True, httponly=True)
    # FIX-006-B (S0-02): drop the CSRF cookie too so a stale one from a
    # previous session can't cross-contaminate the next login.
    clear_csrf_cookie(response)


def login_response(token: str, /, **body) -> dict:
    """FIX-006-A (S0-08): build a login/register/switch-workspace response
    body. The HttpOnly cookie is already the source of truth for auth;
    embedding the raw JWT in the JSON body means any XSS bypasses
    HttpOnly. In prod (`AUTH_RETURN_TOKEN=False`) we omit it entirely.
    Left on in dev/test so the ~50 legacy bearer-header integration
    tests keep working locally; explicit `AUTH_RETURN_TOKEN=1` in env
    also opts back in.

    Callers still call `set_auth_cookie(response, token)` themselves —
    this helper only shapes the JSON body.
    """
    if AUTH_RETURN_TOKEN:
        return {"token": token, **body}
    return dict(body)


# --- Platform super-admin auth (separate from tenant users) -----------------


def create_admin_token(admin_id: str) -> str:
    # FIX-006-A (S0-09): sign platform-admin tokens with a dedicated
    # secret so a leak of JWT_SECRET (tenant secret) can't forge admin
    # sessions. Falls back to JWT_SECRET when PLATFORM_ADMIN_JWT_SECRET
    # is unset — dev-friendly; prod must set both to distinct values.
    payload = {
        "sub": admin_id, "type": "platform_admin",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, PLATFORM_ADMIN_JWT_SECRET, algorithm=JWT_ALGORITHM)


def set_admin_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=ADMIN_COOKIE_NAME, value=token, max_age=AUTH_COOKIE_MAX_AGE,
        httponly=True, secure=True, samesite="none", path="/",
    )
    # FIX-006-B (S0-02): admin console needs CSRF too — mint the same
    # cookie so the admin frontend's mutating calls carry the header.
    set_csrf_cookie(response)


def clear_admin_cookie(response: Response) -> None:
    response.delete_cookie(key=ADMIN_COOKIE_NAME, path="/", samesite="none", secure=True, httponly=True)
    clear_csrf_cookie(response)


async def get_platform_admin(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    token = request.cookies.get(ADMIN_COOKIE_NAME) or (creds.credentials if creds else None)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # FIX-006-A (S0-09): verify with the admin-scoped secret. Falls back
    # to JWT_SECRET when unset so dev/test flows keep working; the
    # `type == platform_admin` claim remains as a second gate either way.
    try:
        payload = jwt.decode(token, PLATFORM_ADMIN_JWT_SECRET, algorithms=[JWT_ALGORITHM])
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


# --- Auth helpers -----------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, tenant_id: str, role: str) -> str:
    # FIX-003-C (S2-06): every token gets a random jti. On logout the
    # server records this jti in db.revoked_tokens; get_current_user
    # checks membership before honoring the token. Without a jti the
    # session-revocation table has no key to work on, so this is a
    # HARD requirement for the fix — do not remove the field.
    payload = {
        "sub": user_id, "tenant_id": tenant_id, "role": role,
        "jti": str(uuid.uuid4()),
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
    # FIX-003-C (S2-06): revocation check. A user who hit /logout
    # invalidated their jti; the token is still cryptographically
    # valid until `exp`, but we must refuse to honor it. Deferred
    # import breaks the core.py <-> services cycle. See
    # services/session_revocation.py for the fail-open contract.
    jti = payload.get("jti")
    if jti:
        from services.session_revocation import is_revoked as _is_revoked
        if await _is_revoked(db, jti):
            raise HTTPException(status_code=401, detail="Session ended, please log in again")
        # FIX-004-G (RBAC-21): bump last_seen_at so /me/sessions
        # shows accurate "active X minutes ago". Best-effort — a
        # failed touch never fails the request.
        from services.auth.session_tracking import touch_session as _touch
        try:
            await _touch(db, jti)
        except Exception:
            pass
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("suspended") or user.get("tenant_suspended"):
        raise HTTPException(status_code=403, detail="Your account has been suspended. Contact your administrator.")
    # FIX-004-B (RBAC-13): resolve the current-tenant membership. The
    # JWT carries a `tenant_id` claim chosen at login (or via
    # /me/switch-workspace); we look up the corresponding membership
    # and project its role + permissions onto the user dict so ~430
    # downstream call sites keep reading `user["role"]` /
    # `user["permissions"]` unchanged. If the user has NO membership
    # in the claimed tenant (removed by admin between login + this
    # request), refuse the token.
    from services.auth.membership import (
        find_membership as _find_membership,
        project_membership_onto_user as _project,
        LIVE_STATUSES as _LIVE_STATUSES,
    )
    claimed_tenant = payload.get("tenant_id")
    if not claimed_tenant:
        # Legacy token issued before FIX-004-B (no tenant_id claim
        # possible — the field has always been present). Fail closed.
        raise HTTPException(status_code=401, detail="Invalid token — please log in again")
    membership = await _find_membership(
        db, user["id"], claimed_tenant, statuses=_LIVE_STATUSES,
    )
    if not membership:
        # Compat: existing users still have the legacy tenant_id/role
        # fields on the user doc until the backfill migration runs.
        # If those exist AND match the JWT claim, trust them as a
        # fallback so a mid-migration boot doesn't lock everyone out.
        if user.get("tenant_id") == claimed_tenant and user.get("role"):
            set_usage_tenant(user.get("tenant_id"))
            return user
        raise HTTPException(
            status_code=403,
            detail="You no longer have access to this workspace. Please log in again.",
        )
    user = _project(user, membership)
    # FIX-004-D (RBAC-14 + RBAC-15): fetch tenant's role permission
    # overrides + owner exclusions so user_perms() can honor them
    # WITHOUT another DB round-trip. Kept on the user dict as
    # underscore-prefixed keys (private convention) so no existing
    # code reads them by accident.
    _tenant = await db.tenants.find_one(
        {"id": claimed_tenant},
        {"_id": 0, "roles": 1, "owner_exclusions": 1},
    )
    if _tenant:
        _role_perms_map = {}
        for _r in (_tenant.get("roles") or []):
            _k = _r.get("key")
            _perms = _r.get("permissions")
            if _k and isinstance(_perms, list) and _perms:
                _role_perms_map[_k] = list(_perms)
        user["_role_perms_map"] = _role_perms_map
        user["_owner_exclusions"] = list(_tenant.get("owner_exclusions") or [])
    # RBAC-27 (2026-08-15): non-expired temp grants merged in by user_perms().
    # membership.temp_grants[] = [{perm, granted_by, expires_at, reason}]
    user["_temp_grants"] = list(membership.get("temp_grants") or [])
    # RBAC-26 (2026-08-15): acting_as delegation. When active (today
    # between from and to), any approval intended for THIS user
    # auto-routes to the delegate. Approval-routing sites (_can_approve_*,
    # push_notification of pending approvals) read user['_acting_as'].
    user["_acting_as"] = user.get("acting_as") or {}
    set_usage_tenant(user.get("tenant_id"))
    return user


def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if roles and user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You don't have permission for this action")
        return user
    return checker


# --- Access permissions moved to core/permissions.py (Epic 8 Sprint 2) -----
# Pure resolution logic. Re-exported so require_perm (below) and external
# callers keep importing user_perms / clean_perms / _BASE_PERMS from core.
from core.permissions import (  # noqa: F401
    _BASE_PERMS, ROLE_DEFAULT_PERMS, user_perms, clean_perms,
)


def require_perm(perm):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if perm not in user_perms(user):
            raise HTTPException(status_code=403, detail="You don't have access to this feature")
        return user
    return checker


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


# --- Normalizers moved to shared/normalizers.py (Epic 8 Sprint 2) -----------
# Pure blueprint / lexicon / operating-model coercion. Re-exported so every
# existing "from core import normalize_* / DEFAULT_OPERATING_MODEL" keeps working.
from shared.normalizers import (  # noqa: F401,E402
    normalize_os_blueprint, normalize_lexicon, normalize_operating_model,
    DEFAULT_OPERATING_MODEL, DEFAULT_LEXICON, _slugify_key,
)

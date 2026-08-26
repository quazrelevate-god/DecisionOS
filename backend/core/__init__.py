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
    ROOT_DIR, UPLOAD_DIR,  # E8 S8: single source for the legacy upload path
    JWT_SECRET, JWT_ALGORITHM,
    PLATFORM_ADMIN_JWT_SECRET, AUTH_RETURN_TOKEN, SUPERADMIN_ALLOW_HASH_REFRESH,
    AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE, ADMIN_COOKIE_NAME,
    CORS_ORIGINS, CSRF_COOKIE_NAME, CSRF_HEADER_NAME,
    CSRF_EXEMPT_PATHS, CSRF_ENFORCE,
    EMERGENT_LLM_KEY, CLAUDE_KEY,
    LLM_MODEL, VISION_MODEL,
    MODELS, MODEL_ROUTES, model_for,  # E3-01.2 model routing
    MODEL_FALLBACKS, fallback_models,  # E3-08.4 model fallback chains
    EMBED_MODELS, DEFAULT_EMBED_MODEL, embed_model_for,  # E3-09.1 embedding routing
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

# --- AI keys / usage / LLM moved out (Epic 8 Sprint 2) ----------------------
# -> core.ai_keys, core.usage, integrations.llm. Re-exported so
# `from core import get_ai_key, log_usage, claude_chat, ...` keeps working.
from core.ai_keys import (  # noqa: F401,E402
    _ai_keys, load_ai_keys_from_db, get_ai_key, set_ai_keys,
    ai_key_source, mask_key, claude_key,
)
from core.usage import (  # noqa: F401,E402
    _ctx_tenant, set_usage_tenant, _est_tokens, _est_cost, log_usage,
    record_ai_call, ai_call_stats,  # E3-01.3 AI telemetry
    ai_quality_report,  # E3-10.5 AI quality dashboard
    _record_usage, _record_provider_alert, _resolve_provider_alert,
)
from integrations.llm import _ResilientChat, claude_chat  # noqa: F401,E402

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("decisionos")

# --- Auth primitives moved to core/security.py (Epic 8 Sprint 2) ------------
# Password hashing, JWT tokens, auth/CSRF/admin cookies + the platform-admin
# dependency. Re-exported so callers and get_current_user (below) keep
# importing them from core.
from core.security import (  # noqa: F401,E402
    bearer_scheme, _mint_csrf_token, set_csrf_cookie, clear_csrf_cookie,
    set_auth_cookie, clear_auth_cookie, login_response,
    create_admin_token, set_admin_cookie, clear_admin_cookie, get_platform_admin,
    hash_password, verify_password, create_token, create_impersonation_token,
)
# --- Access permissions moved to core/permissions.py (Epic 8 Sprint 2) -----
# Pure resolution logic. Re-exported so require_perm (below) and external
# callers keep importing user_perms / clean_perms / _BASE_PERMS from core.
from core.permissions import (  # noqa: F401
    _BASE_PERMS, ROLE_DEFAULT_PERMS, user_perms, clean_perms,
)


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

# --- Request dependencies moved to core/deps.py (Epic 8 Sprint 2) -----------
# get_current_user + require_role / require_perm / tenant_role_keys. Imported
# at the very end so core is fully initialized before core.deps pulls in
# set_usage_tenant from it.
from core.deps import (  # noqa: F401,E402
    get_current_user, require_role, require_perm, tenant_role_keys,
)

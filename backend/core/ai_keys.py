"""Runtime AI provider keys (Epic 8 Sprint 2).

Platform-admin-updatable, DB-backed with env fallback. Extracted from
core.py; core re-exports every name. No logging/LLM concerns here.
"""
from config import _AI_KEY_ENV, EMERGENT_LLM_KEY
from database import db


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

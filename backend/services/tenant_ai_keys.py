"""FIX-005-A (S3-03): per-tenant AI provider keys.

Kills the shared-pool risk: today every tenant hits the same
Anthropic / OpenAI / Gemini / Sarvam keys. One rate-limited or
leaked key breaks 100% of tenants (FIX-002-B was the concurrency
band-aid; this is the real fix).

Design:
  * `tenant.ai_keys` is a dict {provider: key} stored on the tenant
    doc. Empty / missing = fall through to platform shared pool
    (core._ai_keys). Callers use `resolve_ai_key(tenant, provider)`
    instead of `get_ai_key(provider)` when they have a tenant context.
  * Which key was actually used is captured on the usage event
    (`ai_keys_source`: "tenant" | "platform" | "not_set") so a
    tenant can see their spend on THEIR key vs the shared pool.
  * Providers supported = the same set as platform-level `_ai_keys`:
    anthropic, openai, gemini, sarvam, wa_access_token,
    wa_phone_number_id.
  * Keys are stored in plain text in Mongo for now. FIX-FUP-33
    tracks moving them to a real secrets manager.

Endpoints (server.py):
  GET  /tenant/ai-keys      — list providers + presence + mask (owner)
  PUT  /tenant/ai-keys      — bulk set the whole map (owner-only)
  DELETE /tenant/ai-keys/{provider}
                            — revert one provider to platform pool
"""
from typing import Any, Dict, Optional

from config import _AI_KEY_ENV
from core import get_ai_key, logger, mask_key


# Providers the tenant can customize. Same set as the platform pool.
CUSTOMIZABLE_PROVIDERS = tuple(sorted(_AI_KEY_ENV.keys()))


def resolve_ai_key(tenant: Optional[Dict[str, Any]], provider: str) -> str:
    """Return the API key to use for `provider` for THIS tenant.

    Precedence:
      1. `tenant.ai_keys[provider]` if non-empty (tenant's own key)
      2. platform shared pool (core.get_ai_key)
      3. "" (not configured anywhere)

    Never raises. Tenant=None falls through to the platform pool —
    that's the behavior for unauth AI calls (signup interview).
    """
    if provider not in CUSTOMIZABLE_PROVIDERS:
        return get_ai_key(provider)
    if tenant:
        keys = tenant.get("ai_keys") or {}
        if isinstance(keys, dict):
            v = (keys.get(provider) or "").strip()
            if v:
                return v
    return get_ai_key(provider)


def ai_key_source_for(tenant: Optional[Dict[str, Any]], provider: str) -> str:
    """"tenant" | "platform" | "not_set" — usage log annotation."""
    if provider not in CUSTOMIZABLE_PROVIDERS:
        return "platform" if get_ai_key(provider) else "not_set"
    if tenant:
        keys = tenant.get("ai_keys") or {}
        if isinstance(keys, dict) and (keys.get(provider) or "").strip():
            return "tenant"
    return "platform" if get_ai_key(provider) else "not_set"


def normalize_ai_key_map(raw: Any) -> Dict[str, str]:
    """Filter an incoming {provider: key} dict to known providers +
    stripped strings. Unknown providers dropped (fail-safe). Empty
    values dropped (they mean "use platform pool")."""
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, str] = {}
    for k, v in raw.items():
        if k not in CUSTOMIZABLE_PROVIDERS:
            continue
        s = (v or "").strip() if isinstance(v, str) else ""
        if s:
            out[k] = s
    return out


def summarize_tenant_ai_keys(tenant: Optional[Dict[str, Any]]) -> list:
    """Owner-facing listing: which providers have a tenant key, which
    fall back to the platform pool, all masked. Never reveals the
    full secret."""
    keys = (tenant or {}).get("ai_keys") or {}
    if not isinstance(keys, dict):
        keys = {}
    out = []
    for p in CUSTOMIZABLE_PROVIDERS:
        v = (keys.get(p) or "").strip() if isinstance(keys.get(p), str) else ""
        source = "tenant" if v else ("platform" if get_ai_key(p) else "not_set")
        out.append({
            "provider": p,
            "source": source,
            "masked": mask_key(v) if v else "",
            "has_tenant_key": bool(v),
        })
    return out

"""Resilient Claude chat wrapper (Epic 8 Sprint 2).

Tries the tenant's Anthropic key, falls back to the Emergent universal key,
records usage, and raises/clears provider-outage alerts. Extracted from
core.py into integrations/; core re-exports claude_chat + _ResilientChat.
"""
import logging

from config import LLM_MODEL, EMERGENT_LLM_KEY
from core.ai_keys import get_ai_key
from core.usage import (
    _ctx_tenant, _record_usage, _record_provider_alert, _resolve_provider_alert,
)

logger = logging.getLogger("decisionos")


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

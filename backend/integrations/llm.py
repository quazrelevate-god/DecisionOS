"""Resilient Claude chat wrapper (Epic 8 Sprint 2).

Tries the tenant's Anthropic key, falls back to the Emergent universal key,
records usage, and raises/clears provider-outage alerts. Extracted from
core.py into integrations/; core re-exports claude_chat + _ResilientChat.
"""
import time
import logging

from config import LLM_MODEL, EMERGENT_LLM_KEY
from core.ai_keys import get_ai_key
from core.usage import (
    _ctx_tenant, _est_tokens, record_ai_call,
    _record_usage, _record_provider_alert, _resolve_provider_alert,
)

logger = logging.getLogger("decisionos")


def _resolve_prompt_version(task):
    """Best-effort: pull the registered prompt's version so telemetry can attribute
    an output to the exact prompt that produced it. None if task isn't a prompt name."""
    if not task:
        return None
    try:
        from prompts import get
        return get(task).version
    except Exception:
        return None


class _ResilientChat:
    """Drop-in for LlmChat(api_key=claude_key(), ...) that tries the user's Anthropic
    key first and automatically falls back to the Emergent universal key if the call
    fails (e.g. Anthropic credit balance too low / invalid key), so AI never hard-breaks.
    Also records per-workspace usage, rich per-call AI telemetry (E3-01.3), and
    raises/clears provider outage alerts.

    ``task`` is the prompt-registry name (e.g. 'extraction.extract'); pass it via
    claude_chat(..., task=...) so telemetry can group calls by what they do."""

    def __init__(self, session_id: str, system_message: str, tenant_id=None,
                 task=None, prompt_version=None, record=True):
        self.session_id = session_id
        self.system_message = system_message
        self.tenant_id = tenant_id
        self.model = LLM_MODEL
        self.task = task
        self.prompt_version = prompt_version
        # record=False: the caller owns telemetry (e.g. to attach parse_ok after
        # it has parsed the response). We still stash the successful call's metrics
        # on self.last_call so the caller can record_ai_call(**last_call, parse_ok=..).
        # Failures are ALWAYS recorded regardless of this flag.
        self.record = record
        self.last_call = None

    def with_model(self, *model):
        if model:
            self.model = model
        return self

    async def send_message(self, message):
        from emergentintegrations.llm.chat import LlmChat
        # FIX-002-B: bound in-flight LLM calls + per-call timeout so a burst
        # of 50 concurrent voice captures can't pile up on the single shared
        # Anthropic key and cascade into 429s / unbounded latency.
        from services.ai.llm_limits import guarded_llm
        anthropic = get_ai_key("anthropic")
        keys, seen = [], set()
        for k in (anthropic, EMERGENT_LLM_KEY):
            if k and k not in seen:
                seen.add(k)
                keys.append(k)
        tenant_id = self.tenant_id or _ctx_tenant.get()
        model_id = self.model[1] if self.model and len(self.model) > 1 else None
        pv = self.prompt_version or _resolve_prompt_version(self.task)
        last_err = None
        _t0 = time.perf_counter()
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
                _in = f"{self.system_message or ''} {getattr(message, 'text', '') or ''}"
                tel = dict(task=self.task, model=model_id, engine=provider, prompt_version=pv,
                           tokens_in=_est_tokens(_in), tokens_out=_est_tokens(resp or ""),
                           latency_ms=(time.perf_counter() - _t0) * 1000,
                           tenant_id=tenant_id, session_id=self.session_id)
                self.last_call = {**tel, "ok": True}
                if self.record:
                    await record_ai_call(**tel, ok=True)
                return resp
            except Exception as e:
                last_err = e
                if i == 0 and key == anthropic and anthropic:
                    await _record_provider_alert("anthropic", str(e))
                using_fallback = i + 1 < len(keys)
                logger.warning(
                    f"Claude call failed on key {i + 1}/{len(keys)}"
                    f"{' — retrying with Emergent universal key' if using_fallback else ''}: {e}")
        # E3-08.4: the primary model failed on every key. Last-resort graceful degradation --
        # try each fallback MODEL on the Emergent universal key, and record that we degraded.
        from config import fallback_models
        for fb in (fallback_models(self.model) if EMERGENT_LLM_KEY else []):
            fb_id = fb[1] if fb and len(fb) > 1 else None
            try:
                fchat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=self.session_id,
                                system_message=self.system_message).with_model(*fb)
                resp = await guarded_llm(fchat.send_message(message),
                                          label=f"degraded:{fb_id}:{self.session_id[:24]}")
                logger.warning(f"AI degraded to fallback model {fb_id} for task {self.task} "
                               f"(primary {model_id} failed on all keys)")
                await _record_usage(tenant_id, self.session_id, "emergent", self.system_message, message, resp)
                _in = f"{self.system_message or ''} {getattr(message, 'text', '') or ''}"
                tel = dict(task=self.task, model=fb_id, engine="emergent", prompt_version=pv,
                           tokens_in=_est_tokens(_in), tokens_out=_est_tokens(resp or ""),
                           latency_ms=(time.perf_counter() - _t0) * 1000,
                           tenant_id=tenant_id, session_id=self.session_id, degraded=True)
                self.last_call = {**tel, "ok": True}
                if self.record:
                    await record_ai_call(**tel, ok=True)
                return resp
            except Exception as e:
                last_err = e
                logger.warning(f"Fallback model {fb_id} also failed: {e}")
        await record_ai_call(
            task=self.task, model=model_id, engine="none", prompt_version=pv,
            latency_ms=(time.perf_counter() - _t0) * 1000, ok=False, error=last_err,
            tenant_id=tenant_id, session_id=self.session_id, degraded=True)
        raise last_err if last_err else RuntimeError("No LLM key configured")


def claude_chat(session_id: str = None, system_message: str = None, tenant_id=None,
                task=None, prompt_version=None, record=True, **_ignored) -> _ResilientChat:
    """Factory matching the old LlmChat(api_key=..., session_id=..., system_message=...) call shape.
    Pass ``task`` (a prompt-registry name) so AI telemetry can group calls by purpose.
    Pass ``record=False`` to own telemetry yourself (e.g. to attach parse_ok) -- read
    the successful call's metrics from ``chat.last_call``; failures self-record regardless."""
    return _ResilientChat(session_id, system_message, tenant_id=tenant_id,
                          task=task, prompt_version=prompt_version, record=record)

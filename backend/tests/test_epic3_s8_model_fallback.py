"""Epic 3 Sprint 8 (E3-08.4): model fallback chains + graceful degradation.

Verifies fallback_models() resolves the right chain, and that _ResilientChat walks
to a fallback MODEL (recorded as degraded) when the primary fails on every key --
rather than the AI call hard-failing.
"""
import asyncio

import core  # noqa: F401 -- init the package first
from config import MODELS, fallback_models, DEFAULT_LLM_MODEL


# --- fallback_models (pure) -------------------------------------------------
def test_claude_falls_back_to_gemini():
    chain = fallback_models(MODELS["claude-sonnet"])
    assert MODELS["gemini-flash"] in chain


def test_vision_has_no_cross_model_fallback():
    assert fallback_models(MODELS["gemini-flash"]) == []


def test_unknown_model_no_fallback():
    assert fallback_models(("someprovider", "some-model")) == []
    assert fallback_models(None) == []


# --- _ResilientChat degradation walk ----------------------------------------
def test_degrades_to_fallback_model_when_primary_fails(monkeypatch):
    from integrations import llm

    calls = {"models": [], "recorded": []}

    class _FakeChat:
        def __init__(self, api_key=None, session_id=None, system_message=None):
            self._model = None

        def with_model(self, *m):
            self._model = m
            return self

        async def send_message(self, message):
            calls["models"].append(self._model[1] if self._model else None)
            # primary (claude) fails on every key; the gemini fallback succeeds
            if self._model and self._model[1] == "claude-sonnet-4-6":
                raise RuntimeError("provider outage")
            return '{"ok": true}'

    async def _fake_guarded(coro, label=""):
        return await coro

    async def _noop(*a, **k):
        return None

    async def _rec(**k):
        calls["recorded"].append(k)

    # send_message imports both LlmChat and guarded_llm LOCALLY -> patch at their source modules
    import emergentintegrations.llm.chat as _chatmod
    monkeypatch.setattr(_chatmod, "LlmChat", _FakeChat)
    import services.ai.llm_limits as _lim
    monkeypatch.setattr(_lim, "guarded_llm", _fake_guarded)
    monkeypatch.setattr(llm, "get_ai_key", lambda p: "user-key" if p == "anthropic" else None)
    monkeypatch.setattr(llm, "EMERGENT_LLM_KEY", "emergent-key")
    monkeypatch.setattr(llm, "record_ai_call", _rec)
    monkeypatch.setattr(llm, "_record_usage", _noop)
    monkeypatch.setattr(llm, "_record_provider_alert", _noop)
    monkeypatch.setattr(llm, "_resolve_provider_alert", _noop)

    from emergentintegrations.llm.chat import UserMessage
    chat = llm.claude_chat(task="extraction.extract", session_id="fb-test",
                           system_message="sys").with_model(*MODELS["claude-sonnet"])

    resp = asyncio.run(chat.send_message(UserMessage(text="hi")))

    assert resp == '{"ok": true}'                         # fallback served the response
    assert "gemini-2.5-flash" in calls["models"]          # it tried the fallback model
    assert chat.last_call["degraded"] is True             # marked degraded
    assert chat.last_call["model"] == "gemini-2.5-flash"

"""Epic 8 Sprint 2 — unit tests for core/ai_keys.py, core/usage.py, integrations/llm.py.

Pure parts only (key resolution, token/cost estimates, the resilient-chat factory).
The db/network parts (log_usage, _ResilientChat.send_message) are covered by the
live AI-endpoint smoke, not here.
"""
from config import _AI_KEY_ENV, EMERGENT_LLM_KEY, _COST_IN_PER_M, _COST_OUT_PER_M
from core import ai_keys as ak
from core import usage as us
from integrations.llm import claude_chat, _ResilientChat


# --- ai_keys ---------------------------------------------------------------
def test_mask_key():
    assert ak.mask_key("") == ""
    assert ak.mask_key("short") == "sh…"
    assert ak.mask_key("abcdefghijklmnop") == "abcdef…mnop"


def test_set_get_ai_key_with_env_revert():
    saved = dict(ak._ai_keys)
    try:
        ak.set_ai_keys({"anthropic": "custom-key"})
        assert ak.get_ai_key("anthropic") == "custom-key"
        assert ak.ai_key_source("anthropic") == "custom"
        ak.set_ai_keys({"anthropic": ""})               # empty reverts to env
        assert ak.get_ai_key("anthropic") == _AI_KEY_ENV["anthropic"]
    finally:
        ak._ai_keys.clear(); ak._ai_keys.update(saved)


def test_claude_key_prefers_anthropic_then_emergent():
    saved = ak._ai_keys.get("anthropic")
    try:
        ak._ai_keys["anthropic"] = "sk-ant-test"
        assert ak.claude_key() == "sk-ant-test"
        ak._ai_keys["anthropic"] = ""
        assert ak.claude_key() == EMERGENT_LLM_KEY
    finally:
        ak._ai_keys["anthropic"] = saved


# --- usage -----------------------------------------------------------------
def test_est_tokens():
    assert us._est_tokens("") == 0
    assert us._est_tokens(None) == 0
    assert us._est_tokens("a" * 40) == 10          # len // 4


def test_est_cost_unknown_provider_uses_defaults():
    # 1M in + 1M out at default rates
    assert us._est_cost("nope", 1_000_000, 1_000_000) == _COST_IN_PER_M + _COST_OUT_PER_M


def test_set_usage_tenant_sets_contextvar_only_when_truthy():
    us.set_usage_tenant("tenant-xyz")
    assert us._ctx_tenant.get() == "tenant-xyz"
    us.set_usage_tenant(None)                        # falsy -> unchanged
    assert us._ctx_tenant.get() == "tenant-xyz"


# --- resilient chat factory ------------------------------------------------
def test_claude_chat_factory_builds_resilient_chat():
    c = claude_chat("sess-1", "you are helpful", tenant_id="t1")
    assert isinstance(c, _ResilientChat)
    assert c.session_id == "sess-1"
    assert c.system_message == "you are helpful"
    assert c.tenant_id == "t1"


def test_with_model_overrides_model():
    c = claude_chat("s", "sys")
    ret = c.with_model("anthropic", "claude-x")
    assert ret is c                                  # chainable
    assert c.model == ("anthropic", "claude-x")


# --- core re-export contract ----------------------------------------------
def test_core_reexports_usage_llm():
    import core
    assert core.get_ai_key is ak.get_ai_key
    assert core.log_usage is us.log_usage
    assert core.set_usage_tenant is us.set_usage_tenant
    assert core.claude_chat is claude_chat
    assert core._ai_keys is ak._ai_keys

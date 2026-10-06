"""Dex desktop pass (2026-10-06).

Founder: "fix the UI of the desktop Dex section ... understand the UX as well".
Seen in the browser on a company over its monthly AI allowance: the page said
"AI service error. Please try again." while the server had answered with a
clear 402, and the backend spent three calls (second key, fallback model)
meeting the same refusal. The layout half — a docked composer, the opener
under it, answers that start where they begin, tables in words — is pinned
here by the source it lives in, the way the repo pins its other screens.
"""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

import core  # noqa: F401  -- load order: integrations.llm is imported through core

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def fe(rel):
    return (FE / rel).read_text(encoding="utf-8")


# --- backend: our own refusals are not retried ------------------------------------
@pytest.mark.parametrize("status", [402, 451])
def test_a_refusal_is_not_retried_on_another_key_or_model(monkeypatch, status):
    import integrations.llm as llm
    import services.ai.llm_limits as limits
    import emergentintegrations.llm.chat as em

    calls = []

    class FakeChat:
        def __init__(self, **k):
            pass

        def with_model(self, *m):
            return self

        async def send_message(self, message):     # never reached: refused first
            return "x"

    async def refuse(coro, **k):
        calls.append(k.get("label"))
        coro.close()
        raise HTTPException(status_code=status, detail={"code": "quota_exceeded"})

    monkeypatch.setattr(em, "LlmChat", FakeChat)
    monkeypatch.setattr(limits, "guarded_llm", refuse)
    monkeypatch.setattr(llm, "get_ai_key", lambda p: "sk-ant-tenant")
    monkeypatch.setattr(llm, "EMERGENT_LLM_KEY", "sk-emergent")

    chat = llm._ResilientChat("s1", "sys", tenant_id="t1", record=False)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(chat.send_message("hi"))
    assert ei.value.status_code == status
    assert len(calls) == 1, calls          # not key 2, not a fallback model


def test_a_provider_failure_still_falls_back():
    import integrations.llm as llm
    assert llm._our_refusal(HTTPException(status_code=402)) is True
    assert llm._our_refusal(HTTPException(status_code=451)) is True
    assert llm._our_refusal(RuntimeError("anthropic 529 overloaded")) is False
    assert llm._our_refusal(HTTPException(status_code=500)) is False


def test_a_refused_call_closes_its_coroutine():
    src = (Path(__file__).resolve().parents[1] / "services" / "ai" / "llm_limits.py").read_text(encoding="utf-8")
    at = src.index("if isinstance(_quota_err, HTTPException):")
    assert "coro.close()" in src[at:at + 300]


# --- frontend: the allowance is said in words --------------------------------------
def test_the_allowance_reads_the_flattened_detail():
    lim = fe("lib/aiLimit.js")
    # lib/api moves the {code, ...} object to detail_full; reading .detail alone
    # found a string and the page fell back to "AI service error".
    assert "data.detail_full || data.detail" in lim
    assert '"quota_exceeded", "ai_budget_exceeded"' in lim
    assert "Dex can answer again on" in lim
    brain = fe("pages/Brain.js")
    assert ": isAiLimitError(e) ? aiLimitMessage(e)" in brain
    assert 'resp: { type: "NOTICE", answer }' in brain


# --- frontend: the layout -------------------------------------------------------------
def test_the_composer_docks_and_the_page_is_full_width():
    brain = fe("pages/Brain.js")
    assert 'className="mx-auto flex w-full max-w-3xl flex-col' in brain
    assert "docked={hasThread}" in brain
    stage = fe("pages/brain/DexStage.jsx")
    assert 'docked && "md:sticky md:bottom-0' in stage
    assert "hsl(var(--nm-bg))" in stage          # the room's own ground, not --background
    assert '<div className={cn(compact && "md:hidden")}>' in stage


def test_the_opener_sits_under_the_composer():
    brain = fe("pages/Brain.js")
    assert "suggestions={!hasThread && canAsk ? (" in brain
    stage = fe("pages/brain/DexStage.jsx")
    assert stage.index("data-testid=\"dex-stage-composer\"") < stage.index("{suggestions &&")


def test_an_answer_lands_on_its_question():
    brain = fe("pages/Brain.js")
    assert 'if (last?.role === "ai") lastQRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });' in brain


def test_tables_and_sources_read_as_words():
    ask = fe("pages/AskAI.js")
    assert "<DexBadge" not in ask                  # the avatar says who is speaking
    assert "export function DexAvatar" in ask
    assert 'if (DEPT_KEYS.has(c.key)) return roleLabel(v, roles, "—");' in ask
    assert 'if (c.key === "status") return taskStatusLabel(v);' in ask
    assert 'if (c.type === "date") return dexDate(v);' in ask
    assert "const FIRST_ROWS = 8;" in ask and "const FIRST_SOURCES = 6;" in ask

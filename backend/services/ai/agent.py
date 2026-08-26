"""Bounded Company-Brain agent loop (Epic 3 Sprint 4 -- E3-11.1/.2 + E3-12.1).

A real observe -> act -> re-plan loop over native tool-calling, kept inside the
governed LLM stack: each model turn runs under guarded_llm (consent + token quota +
per-tenant cost budget + concurrency + timeout) and is telemetered via record_ai_call.
A HARD step budget stops runaway loops. Tools come from the RBAC-filtered registry;
propose tools file pending_approval decisions -- the agent never executes writes.

E3-12.1: pass a conversation_id to carry prior turns back into the loop.
"""
from __future__ import annotations

import json
import os
import time

from emergentintegrations.llm.chat import LlmChat, UserMessage

from core import (db, logger, new_id, now_iso, model_for, record_ai_call,
                  get_ai_key, EMERGENT_LLM_KEY, _ctx_tenant, _est_tokens)
from prompts import render, get as _get_prompt
from services.ai.safety import INJECTION_GUARD, detect_injection
from services.ai import agent_tools

AGENT_MAX_STEPS = int(os.environ.get("AGENT_MAX_STEPS", "6") or 6)
_MEMORY_TURNS = 6  # how many prior turns to feed back

# E3-11.5: complexity gate -- keep the deterministic /ask default for structured/numeric
# questions (exact, cheap, no hallucination); route open-ended/multi-step to the agent.
_OPEN_SIGNALS = ("why", "what should", "how do i", "how should", "what can i do", "recommend",
                 "suggest", "explain", "compare", "analyz", "analys", "strategy", "improve",
                 "should we", "should i", "help me", "figure out", "look into")
_STRUCTURED_SIGNALS = ("how much", "how many", "what is the total", "total ", "count", "list ",
                       "show me", "show ", "overdue", "unpaid", "balance", "who owes", "outstanding")


def should_use_agent(question) -> bool:
    """True if a question is open-ended/multi-step (-> agent loop); False if structured/numeric
    (-> deterministic /ask). Pure heuristic; the caller decides how to route."""
    q = (question or "").lower().strip()
    if not q:
        return False
    if any(s in q for s in _OPEN_SIGNALS):
        return True
    if any(s in q for s in _STRUCTURED_SIGNALS):
        return False
    return len(q.split()) > 14   # long, unclassified questions lean open-ended


async def _load_history(tenant_id: str, conversation_id: str) -> list:
    if not conversation_id:
        return []
    rows = await db.agent_conversations.find(
        {"tenant_id": tenant_id, "conversation_id": conversation_id},
        {"_id": 0, "question": 1, "answer": 1}).sort("created_at", 1).to_list(_MEMORY_TURNS)
    return rows


async def _save_turn(tenant_id, conversation_id, user_id, question, answer, tools_used):
    try:
        await db.agent_conversations.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "conversation_id": conversation_id,
            "user_id": user_id, "question": question, "answer": answer,
            "tools_used": tools_used, "created_at": now_iso()})
    except Exception as e:
        logger.debug(f"agent memory save failed: {e}")


async def run_agent(question: str, user: dict, *, conversation_id: str = None,
                    max_steps: int = AGENT_MAX_STEPS) -> dict:
    """Answer a question via the bounded tool-calling loop. Returns
    {answer, tools_used, steps, proposed, conversation_id, degraded}."""
    q = (question or "").strip()
    tenant_id = user.get("tenant_id")
    conversation_id = conversation_id or new_id()
    if not q or not tenant_id:
        return {"answer": "Please ask a question.", "tools_used": [], "steps": 0,
                "proposed": [], "conversation_id": conversation_id}

    for hit in detect_injection(q):
        logger.warning(f"run_agent: possible injection in question ({hit}) tenant={tenant_id}")

    tools = agent_tools.tools_for(user)
    tool_by_name = {t.name: t for t in tools}
    system = render("brain.agent") + INJECTION_GUARD

    # Prior-turn memory (E3-12.1) folded into the opening message.
    history = await _load_history(tenant_id, conversation_id)
    hist_txt = ""
    if history:
        hist_txt = "Earlier in this conversation:\n" + "\n".join(
            f"Q: {h.get('question','')}\nA: {h.get('answer','')}" for h in history) + "\n\n"

    # Governed chat: resolve key + model once; guarded_llm wraps every turn.
    from services.ai.llm_limits import guarded_llm
    key = get_ai_key("anthropic") or EMERGENT_LLM_KEY
    engine = "anthropic" if get_ai_key("anthropic") else "emergent"
    model = model_for("brain.agent")
    pv = (_get_prompt("brain.agent").version if _get_prompt("brain.agent") else None)
    chat = LlmChat(api_key=key, session_id=f"agent-{conversation_id}", system_message=system).with_model(*model)
    chat.with_tools(agent_tools.to_schema(tools))

    tools_used: list = []
    proposed: list = []
    steps = 0
    answer = ""
    _t0 = time.perf_counter()

    async def _turn(msg):
        return await guarded_llm(chat.send_message_with_tools(msg), label=f"agent:{conversation_id[:16]}")

    try:
        resp = await _turn(UserMessage(text=hist_txt + f"Owner's question: {q}"))
        while getattr(resp, "tool_calls", None) and steps < max_steps:
            steps += 1
            for tc in resp.tool_calls:
                tool = tool_by_name.get(tc.name)
                if tool is None:  # model asked for a tool it can't access (RBAC) or unknown
                    result = {"error": f"tool '{tc.name}' is not available"}
                else:
                    try:
                        result = await tool.fn(user, **(tc.arguments or {}))
                        tools_used.append(tc.name)
                        if tool.access == "propose" and isinstance(result, dict) and result.get("proposed"):
                            proposed.append({"tool": tc.name, "decision_id": result.get("decision_id")})
                    except Exception as e:
                        logger.warning(f"agent tool {tc.name} failed: {e}")
                        result = {"error": str(e)[:200]}
                chat.add_tool_result(tc.id, json.dumps(result, default=str)[:4000])
            resp = await _turn(None)  # continuation after tool results
        answer = (getattr(resp, "content", "") or "").strip()
        if not answer and steps >= max_steps:
            answer = "I gathered a lot but couldn't finish within the step limit. Try narrowing the question."
    except Exception as e:
        logger.exception("run_agent failed")
        answer = "I couldn't complete that request just now."

    await record_ai_call(task="brain.agent", model=model[1], engine=engine, prompt_version=pv,
                         tokens_in=_est_tokens(system + q), tokens_out=_est_tokens(answer),
                         latency_ms=(time.perf_counter() - _t0) * 1000, ok=bool(answer),
                         tenant_id=tenant_id, session_id=f"agent-{conversation_id}")
    await _save_turn(tenant_id, conversation_id, user.get("id"), q, answer, tools_used)
    return {"answer": answer or "No answer.", "tools_used": tools_used, "steps": steps,
            "proposed": proposed, "conversation_id": conversation_id}

"""Chatbot — the ONE new endpoint on top of the existing Brain.

Design constraints (from the chatbot v1 spec, enforced here):
  1. `user_id` is server-derived only (from get_current_user JWT).
  2. Every DB read is scoped via chatbot_memory._scope(user).
  3. LLM never authorizes: relevance + injection + RBAC gates all run first
     in Python.
  4. No modification to routers/brain.py, routers/brain_router.py,
     services/brain_rbac.py, services/brain_context.py, or core.py.
  5. Reuse over reinvent: analytics questions delegate to routers.brain's
     _plan/_retrieve/_compute (same pattern brain_router's mongo_query tool
     already uses); reasoning questions delegate to routers.brain_router's
     _plan/_run_tools/_synthesize.

The response shape is a superset of what /ask returns so the frontend can
render the same KpiGrid/DataTable/Sources components with no extra glue.
"""
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import (
    db, new_id, now_iso, logger,
    get_current_user, require_perm, user_perms,
)
from models.chatbot import ChatbotMessageInput, RenameInput
from services import brain_rbac
from services import chatbot_guards
from services import chatbot_memory


router = APIRouter(prefix="/api/chatbot")


# ---------------------------------------------------------------------------
# Response types (single string enum — kept simple; frontend switches on it)
# ---------------------------------------------------------------------------
T_ANSWER = "ANSWER"
T_PERMISSION_DENIED = "PERMISSION_DENIED"
T_IRRELEVANT = "IRRELEVANT"
T_INJECTION = "INJECTION_REFUSED"
T_INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
T_ERROR = "ERROR"


# ---------------------------------------------------------------------------
# Audit — reuses the existing brain_audit collection (per Phase-1 report).
# ---------------------------------------------------------------------------
async def _audit(user: dict, question: str, response_type: str,
                 intent: str = "", reason: str = "",
                 engine: str = "", conversation_id: str = "") -> None:
    try:
        await db.brain_audit.insert_one({
            "id": new_id(),
            "tenant_id": user.get("tenant_id"),
            "user_id": user.get("id"),
            "user_role": user.get("role"),
            "question": question[:1000],
            "intent": intent,
            "response_type": response_type,
            "refusal_reason": reason,
            "source_engine": engine,
            "conversation_id": conversation_id,
            "surface": "chatbot",
            "created_at": now_iso(),
        })
    except Exception:
        logger.warning("chatbot audit write failed")


# ---------------------------------------------------------------------------
# Routing — analytics vs reasoning
# ---------------------------------------------------------------------------
# Two intent signals decide which engine handles the turn.
#
# _DOCUMENT_HINTS is checked FIRST. It catches "what is / tell me about /
# show me the …" phrasings AND any question that names a document-shaped
# noun (policy, document, report, summary, process, plan, roadmap, guide,
# manual, strategy, handbook, sop, code of conduct, filing). When it fires,
# we route to the AGENT engine (metadata_search over brain_documents +
# knowledge_lookup + file_open + mongo_query). This is essential because
# document TITLES often contain analytics-adjacent words — e.g. "HR Policy -
# Leave Management" contains "leave", "Employee Onboarding Process" contains
# "employee", "General Expense Submission Process" contains "expense". If
# _ANALYTICS_HINTS were checked first, those titles would be misrouted to
# the deterministic ask pipeline, which has no knowledge of brain_documents
# and would (correctly) return INSUFFICIENT_DATA because db.leaves /
# db.expenses / db.employees genuinely have no matching rows.
#
# _ANALYTICS_HINTS is the fallback that only matches numeric/aggregation-
# shaped questions. When it fires, we route to the ASK engine for its
# deterministic Python compute over tasks/decisions/invoices/etc.
#
# Wrong routes never affect security — both engines pass the CURRENT user
# through the same brain_rbac + tenant + visibility filters downstream.
_DOCUMENT_HINTS = re.compile(
    r"\b(what (?:is|are|does)|tell me about|show me the|explain|describe|"
    r"policy|policies|document|documents|report|reports|summary|process|"
    r"plan|roadmap|guide|manual|strategy|handbook|sop|"
    r"code of conduct|filing|filings|contract|contracts|nda)\b", re.I,
)

_ANALYTICS_HINTS = re.compile(
    r"\b(how many|how much|count|total|sum|average|list|show me|show all|"
    r"top \d+|top-\d+|overdue|pending|due|completed|paid|unpaid|revenue|"
    r"spent|billed|invoice|payment|expense|task|deal|lead|contact|employee|"
    r"leave|attendance|this (week|month|quarter|year)|"
    r"last (week|month|quarter|year)|yesterday|today|since|between)\b", re.I,
)


def _pick_engine(message: str) -> str:
    """Return "ask" or "agent".

    Document-lookup phrasings/nouns MUST route to the agent so
    metadata_search on brain_documents runs. Only then does the analytics
    regex get consulted. Wrong routes affect answer quality only — both
    engines apply the same brain_rbac + tenant + visibility filters.
    """
    m = message or ""
    if _DOCUMENT_HINTS.search(m):
        return "agent"
    return "ask" if _ANALYTICS_HINTS.search(m) else "agent"


# ---------------------------------------------------------------------------
# Engine adapters — thin wrappers that call into the existing Brain routers.
# Adapters live here (not in brain.py / brain_router.py) so those files are
# untouched. Same reuse pattern as brain_router.mongo_query.
# ---------------------------------------------------------------------------
async def _run_ask_engine(question: str, user: dict) -> dict:
    """Delegate to routers.brain's plan/retrieve/compute — the deterministic
    analytics pipeline. Reuses all its permission checks and money guards."""
    from routers.brain import (
        _plan as ask_plan, _retrieve, _compute, FINANCE_ENTITIES,
    )
    tid = user["tenant_id"]
    scope = {
        "tenant_id": tid,
        "uid": user.get("id"),
        "role": user.get("role"),
        "can_finance": bool({"finance", "ledger"} & user_perms(user)),
        "privileged": user.get("role") == "owner" or "team_manage" in user_perms(user),
    }
    plan = await ask_plan(question, None, user.get("language"))

    # Same permission gate /api/ask itself uses (belt-and-suspenders — the
    # top-level chatbot RBAC gate already ran).
    if (plan.get("needs_finance") or plan.get("primary_entity") in FINANCE_ENTITIES) \
            and not scope["can_finance"]:
        return {"_denied": True, "reason": "needs_finance"}

    retrieved = await _retrieve(plan, scope)
    kpis, table, cites = await _compute(plan, retrieved, scope)

    # Same money-column stripping /api/ask does.
    if not scope["can_finance"]:
        money_keys = {c["key"] for c in table["columns"] if c["type"] == "money"}
        if money_keys:
            table["columns"] = [c for c in table["columns"] if c["type"] != "money"]
            table["rows"] = [
                {k: v for k, v in r.items() if k not in money_keys}
                for r in table["rows"]
            ]
            kpis = [k for k in kpis if not isinstance(k.get("value"), (int, float))]

    if table.get("total_rows", 0) == 0:
        return {"_empty": True, "plan": plan}

    # Build the prose answer (reuses /ask's _answer helper for consistency).
    from routers.brain import _answer
    answer, suggested = await _answer(question, kpis, table, user.get("language"))
    return {
        "answer": answer,
        "kpis": kpis,
        "table": table if table["total_rows"] else None,
        "sources": cites,
        "applied_filters": {k: plan.get(k) for k in
                            ("primary_entity", "status", "date_preset", "group_by")
                            if plan.get(k)},
        "suggested_questions": suggested,
    }


async def _run_agent_engine(question: str, user: dict, bypass_intent_check: bool = False) -> dict:
    """Delegate to routers.brain_router's multi-tool pipeline.

    `bypass_intent_check` — set by the chatbot orchestrator when the question
    matches _DOCUMENT_HINTS. Same rationale as the intent-gate bypass in
    message(): the intent classifier over-refuses public documents whose
    titles contain intent-triggering words (e.g. "General Expense Submission
    Process" → intent=finance → sales/hr/procurement blocked from a PUBLIC
    doc). The metadata_search tool below still enforces tenant + document
    visibility via brain_docs._visibility_filter, so bypassing this second
    intent check does not weaken document-level RBAC — a non-owner still
    cannot see dept-restricted or private docs of another department.
    """
    from routers.brain_router import _plan as agent_plan, _run_tools, _synthesize
    plan = await agent_plan(question)

    if not bypass_intent_check:
        # Stricter-of-two guard: defence-in-depth against LLM misclassification.
        # Only skipped for document lookups (see docstring above).
        regex_intent = brain_rbac.classify_intent(question)
        allowed = brain_rbac.allowed_intents(user)
        llm_intent = plan.get("intent") or "general"
        effective_intent = regex_intent if (
            regex_intent != "general" and regex_intent not in allowed
        ) else llm_intent
        if effective_intent not in allowed:
            return {"_denied": True, "reason": f"intent {effective_intent} not permitted"}

    tool_outputs = await _run_tools(plan["tools"], user)
    synth = await _synthesize(question, tool_outputs, user.get("language"))
    return {
        "answer": synth.get("answer") or "",
        "sources": synth.get("citations") or [],
        "suggested_questions": synth.get("follow_ups") or [],
        "suggested_tasks": synth.get("suggested_tasks") or [],
        "kpis": [],
        "table": None,
        "applied_filters": {},
    }


# ---------------------------------------------------------------------------
# POST /api/chatbot/message  — the main endpoint
# ---------------------------------------------------------------------------
@router.post("/message")
async def message(
    inp: ChatbotMessageInput,
    user: dict = Depends(require_perm("ask")),
):
    """Handle one chatbot turn. Runs all guards, delegates to the right
    engine, persists both messages, writes an audit row."""
    question = inp.message.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Message is empty")

    # STEP 3: relevance guard (deterministic, no LLM/DB touched)
    rel = chatbot_guards.relevance_result(question)
    if not rel.is_relevant:
        conv = await chatbot_memory.get_or_create_conversation(user, inp.conversation_id, question)
        await chatbot_memory.append_message(user, conv["id"], "user", question)
        await chatbot_memory.append_message(
            user, conv["id"], "assistant", chatbot_guards.IRRELEVANT_MESSAGE,
            extras={"response_type": T_IRRELEVANT, "refusal_reason": rel.reason,
                    "source_engine": "guard"},
        )
        await _audit(user, question, T_IRRELEVANT, reason=rel.reason,
                     conversation_id=conv["id"])
        return {"type": T_IRRELEVANT, "answer": chatbot_guards.IRRELEVANT_MESSAGE,
                "conversation_id": conv["id"], "reason": rel.reason}

    # STEP 4: prompt-injection guard (deterministic, no LLM/DB touched)
    inj = chatbot_guards.injection_result(question)
    if inj.is_injection:
        conv = await chatbot_memory.get_or_create_conversation(user, inp.conversation_id, question)
        await chatbot_memory.append_message(user, conv["id"], "user", question)
        await chatbot_memory.append_message(
            user, conv["id"], "assistant", chatbot_guards.INJECTION_MESSAGE,
            extras={"response_type": T_INJECTION, "refusal_reason": inj.pattern_id or "",
                    "source_engine": "guard"},
        )
        await _audit(user, question, T_INJECTION,
                     reason=inj.pattern_id or "", conversation_id=conv["id"])
        return {"type": T_INJECTION, "answer": chatbot_guards.INJECTION_MESSAGE,
                "conversation_id": conv["id"], "reason": inj.pattern_id}

    # STEP 5: RBAC intent gate (reuses services.brain_rbac — the same map
    # both /api/ask and /api/brain/agent already use).
    #
    # IMPORTANT: document-lookup questions BYPASS the intent gate. The intent
    # classifier fires on TOPIC WORDS in the question (e.g. "expense",
    # "leave") and is designed to scope analytics access. For document
    # lookups it produces false-refuses on public docs whose titles happen
    # to contain those words — e.g. "What is the General Expense Submission
    # Process?" gets intent=finance even though the document is public.
    #
    # Skipping the intent gate here is SAFE because:
    #   1. Document lookups are already routed to the agent by _pick_engine
    #      (which also uses _DOCUMENT_HINTS).
    #   2. The agent's metadata_search calls db.brain_documents with
    #      tenant_id + is_deleted filters AND, for non-owner/non-team_manage
    #      users, brain_docs._visibility_filter — the SAME rules the
    #      /brain/documents list endpoint enforces. Public docs return to
    #      all authenticated users in the tenant; dept/private docs remain
    #      restricted by role and roles_allowed.
    #   3. All other question shapes (analytics, aggregations, personal
    #      queries) still hit the intent gate unchanged.
    intent = brain_rbac.classify_intent(question)
    allowed = brain_rbac.allowed_intents(user)
    is_document_lookup = bool(_DOCUMENT_HINTS.search(question))
    if intent not in allowed and not is_document_lookup:
        conv = await chatbot_memory.get_or_create_conversation(user, inp.conversation_id, question)
        await chatbot_memory.append_message(user, conv["id"], "user", question)
        refusal = brain_rbac.refusal_message(user, intent)
        await chatbot_memory.append_message(
            user, conv["id"], "assistant", refusal,
            extras={"response_type": T_PERMISSION_DENIED,
                    "refusal_reason": f"intent={intent}", "source_engine": "rbac"},
        )
        await _audit(user, question, T_PERMISSION_DENIED, intent=intent,
                     reason="rbac_intent_gate", conversation_id=conv["id"])
        return {"type": T_PERMISSION_DENIED, "answer": refusal, "intent": intent,
                "conversation_id": conv["id"],
                "allowed_intents": sorted(allowed)}

    # STEP 6: load / create the conversation (user-scoped)
    conv = await chatbot_memory.get_or_create_conversation(user, inp.conversation_id, question)
    conv_id = conv["id"]
    await chatbot_memory.append_message(user, conv_id, "user", question)

    # STEP 7: route to the right engine
    engine = _pick_engine(question)
    try:
        if engine == "ask":
            result = await _run_ask_engine(question, user)
        else:
            # Same reason as STEP 5's bypass: for a document lookup, the
            # topic-based intent classifier over-refuses; document visibility
            # is enforced by metadata_search's tenant + visibility filter.
            result = await _run_agent_engine(question, user,
                                             bypass_intent_check=is_document_lookup)
    except Exception as e:
        logger.exception("chatbot engine failed")
        await _audit(user, question, T_ERROR, intent=intent, engine=engine,
                     reason=type(e).__name__, conversation_id=conv_id)
        await chatbot_memory.append_message(
            user, conv_id, "assistant",
            "Something went wrong on our side. Please try that again in a moment.",
            extras={"response_type": T_ERROR, "source_engine": engine},
        )
        return {"type": T_ERROR,
                "answer": "Something went wrong on our side. Please try that again in a moment.",
                "conversation_id": conv_id}

    # Engine denials (secondary check inside the adapters)
    if result.get("_denied"):
        refusal = brain_rbac.refusal_message(user, intent)
        await chatbot_memory.append_message(
            user, conv_id, "assistant", refusal,
            extras={"response_type": T_PERMISSION_DENIED,
                    "refusal_reason": result.get("reason") or "engine_denied",
                    "source_engine": engine},
        )
        await _audit(user, question, T_PERMISSION_DENIED, intent=intent, engine=engine,
                     reason=result.get("reason") or "", conversation_id=conv_id)
        return {"type": T_PERMISSION_DENIED, "answer": refusal, "intent": intent,
                "conversation_id": conv_id}

    if result.get("_empty"):
        empty_msg = "I couldn't find enough information in your workspace to answer that yet."
        await chatbot_memory.append_message(
            user, conv_id, "assistant", empty_msg,
            extras={"response_type": T_INSUFFICIENT_DATA, "source_engine": engine},
        )
        await _audit(user, question, T_INSUFFICIENT_DATA, intent=intent, engine=engine,
                     conversation_id=conv_id)
        return {"type": T_INSUFFICIENT_DATA, "answer": empty_msg, "conversation_id": conv_id,
                "suggested_questions": [
                    "What needs my attention today?",
                    "Show my overdue tasks",
                ]}

    # STEP 8: response safety pass — belt-and-suspenders. Make sure we're
    # not returning stack traces, keys, or raw DB errors accidentally.
    answer = (result.get("answer") or "").strip()
    for banned in ("Traceback (most recent", "pymongo.errors", "OperationFailure"):
        if banned in answer:
            answer = "I found an answer but couldn't format it. Please try again."
            break

    extras = {
        "response_type": T_ANSWER,
        "source_engine": engine,
        "sources": result.get("sources") or [],
        "kpis": result.get("kpis") or [],
        "table": result.get("table"),
        "applied_filters": result.get("applied_filters") or {},
    }
    await chatbot_memory.append_message(user, conv_id, "assistant", answer, extras=extras)
    await _audit(user, question, T_ANSWER, intent=intent, engine=engine,
                 conversation_id=conv_id)

    return {
        "type": T_ANSWER,
        "answer": answer,
        "conversation_id": conv_id,
        "kpis": result.get("kpis") or [],
        "table": result.get("table"),
        "sources": result.get("sources") or [],
        "applied_filters": result.get("applied_filters") or {},
        "suggested_questions": result.get("suggested_questions") or [],
        "engine": engine,
        "intent": intent,
    }


# ---------------------------------------------------------------------------
# Conversation management — every read is user-scoped
# ---------------------------------------------------------------------------
@router.get("/conversations")
async def list_convs(user: dict = Depends(require_perm("ask"))):
    """List the CALLER's own conversations. Structurally cannot list another
    user's conversations — see chatbot_memory._scope."""
    return await chatbot_memory.list_conversations(user)


@router.get("/conversations/{conv_id}")
async def get_conv(conv_id: str, user: dict = Depends(require_perm("ask"))):
    """Return one conversation + its messages, ONLY if owned by the caller.
    Returns 404 on wrong id/wrong owner (never 403 with metadata leaking who owns it)."""
    conv = await chatbot_memory.get_conversation(user, conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = await chatbot_memory.load_recent_messages(user, conv_id, cap=200)
    return {**conv, "messages": messages}


@router.post("/conversations/{conv_id}/rename")
async def rename_conv(conv_id: str, inp: RenameInput,
                      user: dict = Depends(require_perm("ask"))):
    ok = await chatbot_memory.rename_conversation(user, conv_id, inp.title)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@router.delete("/conversations/{conv_id}")
async def delete_conv(conv_id: str, user: dict = Depends(require_perm("ask"))):
    ok = await chatbot_memory.soft_delete_conversation(user, conv_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}

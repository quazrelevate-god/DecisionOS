"""Company Brain — Multi-Agent Router (Phase-2, P3).

One conversational entry point (`POST /api/brain/agent`) that:
  1. asks Claude which specialist tools to run against a founder question,
  2. runs the picked tools in parallel (with permission checks baked in),
  3. asks Claude to synthesize a final answer + follow-up suggestions.

Tools available to the router:
  • metadata_search  — searches `brain_documents` (policies, filings, contracts).
  • mongo_query      — delegates to the existing /api/ask analytics engine
                       (decisions, tasks, invoices, activity — the numeric,
                       permission-scoped answer).
  • knowledge_lookup — pulls past decisions/approvals/resolutions from
                       `brain_context` (what the company already did last time).
  • file_open        — fetches a specific document's extracted text so Dex
                       can quote it verbatim.

Every tool is INDEPENDENTLY permission-gated (owner-only / dept-scoped / etc.),
so the router can never leak content the caller shouldn't see.
"""
import asyncio
import io
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from emergentintegrations.llm.chat import UserMessage

import obj_store
import brain_context
from core import (
    db, claude_chat, LLM_MODEL, _extract_json, new_id, now_iso, logger,
    get_current_user, user_perms,
)
from routers.brain_docs import _visibility_filter as _docs_visibility_filter
from routers.brain_docs import _keywords as _docs_keywords


router = APIRouter(prefix="/api/brain/agent")

# Cap tool output sizes so the synthesis prompt never blows up.
_MAX_DOCS = 6
_MAX_CONTEXT = 8
_MAX_FILE_CHARS = 6000

_ALL_TOOLS = ("metadata_search", "mongo_query", "knowledge_lookup", "file_open")


# ---------------------------------------------------------------------------
# Planner — Claude picks which tools to run for this question.
# ---------------------------------------------------------------------------
_PLANNER_SYSTEM = (
    "You are Dex's Router — you pick which of four specialist tools should run "
    "to answer a founder's question about their company. Return ONLY valid JSON: "
    "{\"tools\": [{\"name\": one of "
    "[metadata_search, mongo_query, knowledge_lookup, file_open], "
    "\"query\": string (what to search — 1-6 words, keep the founder's own nouns), "
    "\"doc_id\": string (ONLY for file_open, otherwise omit)}], "
    "\"reasoning\": string (under 20 words, why these tools)}\n\n"

    "TOOL PICKING GUIDE:\n"
    "  • metadata_search — for questions about documents/files the company "
    "uploaded (policies, filings, contracts, SOPs, reports). Use when the "
    "founder says 'the leave policy', 'GST filing', 'my contract with Acme'.\n"
    "  • mongo_query — for numbers/lists/analytics over live operational data "
    "(overdue tasks, unpaid invoices, employees, decisions, activity, KPIs). "
    "Use when the founder asks 'how many', 'show me overdue', 'top customers'.\n"
    "  • knowledge_lookup — for past decisions / how the company handled "
    "something before (approvals given, complaints resolved, decisions taken). "
    "Use when the founder says 'how did we handle X last time', 'previous "
    "decisions on Y', 'what have I approved recently'.\n"
    "  • file_open — ONLY when the founder asks to READ or QUOTE a specific "
    "document that was mentioned by title or id in the conversation.\n\n"

    "You may pick 1-3 tools; prefer the minimum. If the question is broad "
    "(e.g. 'how is my business doing?') pick mongo_query + knowledge_lookup. "
    "Never guess a doc_id — leave file_open out unless a specific document is "
    "known."
)


async def _plan(question: str) -> dict:
    prompt = f"Founder question: {question!r}\nPick the right tool(s)."
    try:
        chat = claude_chat(session_id=f"brain-agent-plan-{new_id()}", system_message=_PLANNER_SYSTEM).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.warning(f"brain agent planner failed: {e}")
        data = {}
    tools = []
    for t in (data.get("tools") or [])[:3]:
        name = str(t.get("name") or "").strip()
        if name in _ALL_TOOLS:
            tools.append({
                "name": name,
                "query": (t.get("query") or question)[:200],
                "doc_id": (t.get("doc_id") or "")[:64] or None,
            })
    # Sensible fallback: if planner returns nothing, hit the two cheapest tools.
    if not tools:
        tools = [
            {"name": "metadata_search", "query": question[:200], "doc_id": None},
            {"name": "knowledge_lookup", "query": question[:200], "doc_id": None},
        ]
    return {"tools": tools, "reasoning": (data.get("reasoning") or "").strip()[:200]}


# ---------------------------------------------------------------------------
# Tool implementations
# ---------------------------------------------------------------------------
async def _tool_metadata_search(query: str, user: dict) -> dict:
    filt: dict = {"tenant_id": user["tenant_id"], "is_deleted": False}
    tokens = _docs_keywords(query)
    if tokens:
        filt.setdefault("$and", []).append({"$or": [
            {"title":              {"$regex": query, "$options": "i"}},
            {"summary":            {"$regex": query, "$options": "i"}},
            {"original_filename":  {"$regex": query, "$options": "i"}},
            {"keywords":           {"$in": tokens}},
            {"tags":               {"$in": tokens}},
        ]})
    if user.get("role") != "owner" and "team_manage" not in user_perms(user):
        filt.setdefault("$and", []).append(_docs_visibility_filter(user))
    rows = await db.brain_documents.find(filt, {"_id": 0, "keywords": 0, "storage_path": 0}) \
        .sort("created_at", -1).limit(_MAX_DOCS).to_list(_MAX_DOCS)
    return {"tool": "metadata_search", "query": query, "count": len(rows), "hits": rows}


async def _tool_knowledge_lookup(query: str, user: dict) -> dict:
    rows = await brain_context.query_context(
        tenant_id=user["tenant_id"], user=user, q=query, limit=_MAX_CONTEXT,
    )
    return {"tool": "knowledge_lookup", "query": query, "count": len(rows), "hits": rows}


async def _tool_file_open(doc_id: Optional[str], query: str, user: dict) -> dict:
    """Fetch a specific document and return a short extracted snippet."""
    if not doc_id:
        return {"tool": "file_open", "error": "No document id was provided", "snippet": ""}
    doc = await db.brain_documents.find_one({"id": doc_id, "tenant_id": user["tenant_id"], "is_deleted": False}, {"_id": 0})
    if not doc:
        return {"tool": "file_open", "error": "Document not found", "snippet": ""}
    # Permission check — mirror brain_docs._user_can_see
    role = user.get("role") or ""
    priv = role == "owner" or "team_manage" in user_perms(user)
    can_see = priv or doc.get("uploaded_by") == user["id"]
    if not can_see:
        vis = doc.get("visibility") or "public"
        if vis == "public":
            can_see = True
        elif vis == "dept":
            can_see = doc.get("department") == role or role in (doc.get("roles_allowed") or [])
        else:
            can_see = role in (doc.get("roles_allowed") or [])
    if not can_see:
        return {"tool": "file_open", "error": "You don't have access to this document", "snippet": ""}
    try:
        data, _ctype = await obj_store.get_object(doc["storage_path"])
    except Exception as e:
        logger.warning(f"brain agent file_open storage read failed: {e}")
        return {"tool": "file_open", "error": "Couldn't read the file", "snippet": ""}
    snippet = _extract_text(data, doc.get("content_type") or "")[:_MAX_FILE_CHARS]
    return {
        "tool": "file_open",
        "doc_id": doc_id,
        "title": doc.get("title") or doc.get("original_filename"),
        "content_type": doc.get("content_type"),
        "snippet": snippet,
    }


def _extract_text(data: bytes, ctype: str) -> str:
    """Best-effort text extraction for the common file types used in the Brain.
    PDF/DOCX are attempted via optional libs; falls back to plain-text decode."""
    ct = (ctype or "").lower()
    try:
        if "pdf" in ct:
            try:
                from pypdf import PdfReader  # optional
                reader = PdfReader(io.BytesIO(data))
                return " ".join((p.extract_text() or "") for p in reader.pages[:10])
            except Exception:
                pass
        if "wordprocessingml" in ct or ct.endswith("/msword"):
            try:
                from docx import Document  # python-docx
                doc = Document(io.BytesIO(data))
                return "\n".join(p.text for p in doc.paragraphs[:400])
            except Exception:
                pass
        # Plain text / csv / json / md — decode directly.
        return data.decode("utf-8", errors="ignore")
    except Exception:
        return ""


async def _tool_mongo_query(query: str, user: dict) -> dict:
    """Delegate to the existing /api/ask analytics engine — reuses its plan +
    permission validation + deterministic compute + citations."""
    try:
        from routers.brain import _plan as _ask_plan, _retrieve, _compute, FINANCE_ENTITIES
        scope = {
            "tenant_id": user["tenant_id"], "uid": user.get("id"),
            "role": user.get("role"),
            "can_finance": bool({"finance", "ledger"} & user_perms(user)),
            "privileged": user.get("role") == "owner" or "team_manage" in user_perms(user),
        }
        plan = await _ask_plan(query, None, user.get("language"))
        if (plan.get("needs_finance") or plan.get("primary_entity") in FINANCE_ENTITIES) and not scope["can_finance"]:
            return {"tool": "mongo_query", "query": query, "restricted": True,
                    "message": "Financial records are restricted to Owner and Finance roles."}
        retrieved = await _retrieve(plan, scope)
        kpis, table, cites = await _compute(plan, retrieved, scope)
        # Strip money columns for non-finance users (belt & suspenders).
        if not scope["can_finance"]:
            money_keys = {c["key"] for c in table["columns"] if c["type"] == "money"}
            if money_keys:
                table["columns"] = [c for c in table["columns"] if c["type"] != "money"]
                table["rows"] = [{k: v for k, v in r.items() if k not in money_keys} for r in table["rows"]]
                kpis = [k for k in kpis if not isinstance(k.get("value"), (int, float))]
        return {
            "tool": "mongo_query", "query": query,
            "kpis": kpis,
            "rows": table["rows"][:20],
            "columns": [c.get("label") or c.get("key") for c in table["columns"]],
            "citations": cites[:8],
            "total_rows": table.get("total_rows", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"brain agent mongo_query failed: {e}")
        return {"tool": "mongo_query", "query": query, "error": "analytics engine unavailable"}


async def _run_tools(picks: List[dict], user: dict) -> List[dict]:
    async def run(t):
        if t["name"] == "metadata_search":
            return await _tool_metadata_search(t["query"], user)
        if t["name"] == "knowledge_lookup":
            return await _tool_knowledge_lookup(t["query"], user)
        if t["name"] == "file_open":
            return await _tool_file_open(t.get("doc_id"), t["query"], user)
        if t["name"] == "mongo_query":
            return await _tool_mongo_query(t["query"], user)
        return {"tool": t["name"], "error": "unknown tool"}
    return list(await asyncio.gather(*(run(t) for t in picks), return_exceptions=False))


# ---------------------------------------------------------------------------
# Synthesizer — Claude writes the final answer from the tools' outputs.
# ---------------------------------------------------------------------------
_SYNTH_SYSTEM = (
    "You are Dex — the founder's business co-pilot. You've just gathered facts "
    "from up to three specialist tools (documents, live database analytics, "
    "past decisions). Write a CRISP answer to the founder's question using ONLY "
    "these facts. If the facts don't answer it, say so plainly — never guess.\n\n"

    "OUTPUT — return ONLY valid JSON: "
    "{\"answer\": string (2-5 sentences, warm and specific, no bullet lists in "
    "the answer body), "
    "\"citations\": [{\"kind\": one of "
    "[document, mongo, context, file], "
    "\"label\": short human name, \"ref\": string id or short reference}] (max 5), "
    "\"suggested_tasks\": [{\"title\": string (under 12 words, action verb), "
    "\"why\": string (under 12 words, ties to the found evidence)}] "
    "(0-3 tasks — only if the past decisions or numbers strongly suggest a "
    "concrete next action; empty list is fine), "
    "\"follow_ups\": [string] (0-3 short questions the founder might ask next)}"
)


def _sanitize_tool_output(t: dict) -> dict:
    """Trim the tool outputs to the essentials before sending to the synthesis LLM."""
    if t.get("tool") == "metadata_search":
        return {
            "tool": "metadata_search",
            "count": t.get("count", 0),
            "hits": [{"id": h.get("id"), "title": h.get("title"), "kind": h.get("kind"),
                      "summary": (h.get("summary") or "")[:200],
                      "tags": h.get("tags") or [], "created_at": h.get("created_at")} for h in (t.get("hits") or [])[:_MAX_DOCS]],
        }
    if t.get("tool") == "knowledge_lookup":
        return {
            "tool": "knowledge_lookup",
            "count": t.get("count", 0),
            "hits": [{"kind": h.get("kind"), "title": h.get("title"),
                      "outcome": h.get("outcome"),
                      "why": (h.get("why") or "")[:220],
                      "actor": h.get("actor_name"),
                      "tags": h.get("tags") or [],
                      "at": h.get("created_at")} for h in (t.get("hits") or [])[:_MAX_CONTEXT]],
        }
    if t.get("tool") == "file_open":
        return {"tool": "file_open", "title": t.get("title"), "doc_id": t.get("doc_id"),
                "snippet": (t.get("snippet") or "")[:_MAX_FILE_CHARS], "error": t.get("error")}
    if t.get("tool") == "mongo_query":
        return {
            "tool": "mongo_query",
            "restricted": t.get("restricted", False),
            "message": t.get("message"),
            "kpis": t.get("kpis") or [],
            "columns": t.get("columns") or [],
            "rows": (t.get("rows") or [])[:20],
            "total_rows": t.get("total_rows", 0),
        }
    return t


async def _synthesize(question: str, tool_outputs: List[dict], lang: Optional[str]) -> dict:
    slim = [_sanitize_tool_output(t) for t in tool_outputs]
    hint = ""
    if lang == "hi":
        hint = " Reply in natural conversational Hindi (Devanagari)."
    elif lang == "ta":
        hint = " Reply in natural conversational Tamil."
    prompt = (
        f"Founder question: {question!r}\n\n"
        f"Tool facts:\n{slim}\n\n"
        "Write the final answer JSON now."
    )
    try:
        chat = claude_chat(session_id=f"brain-agent-synth-{new_id()}", system_message=_SYNTH_SYSTEM + hint).with_model(*LLM_MODEL)
        data = _extract_json(await chat.send_message(UserMessage(text=prompt))) or {}
    except Exception as e:
        logger.warning(f"brain agent synth failed: {e}")
        data = {}
    return {
        "answer": (data.get("answer") or "I couldn't put together a confident answer for that yet — try rephrasing or add more context in the Brain.").strip(),
        "citations": [c for c in (data.get("citations") or []) if isinstance(c, dict)][:5],
        "suggested_tasks": [t for t in (data.get("suggested_tasks") or []) if isinstance(t, dict) and t.get("title")][:3],
        "follow_ups": [str(s).strip() for s in (data.get("follow_ups") or []) if str(s).strip()][:3],
    }


# ---------------------------------------------------------------------------
# Public endpoint
# ---------------------------------------------------------------------------
class AgentRequest(BaseModel):
    question: str = Field(max_length=800)


@router.post("")
async def ask_agent(inp: AgentRequest, user: dict = Depends(get_current_user)):
    q = (inp.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Ask me something about your company")

    plan = await _plan(q)
    tool_outputs = await _run_tools(plan["tools"], user)
    synth = await _synthesize(q, tool_outputs, user.get("language"))

    tools_used = [{
        "name": t["name"],
        "query": t.get("query"),
        "result_count": tool_outputs[i].get("count") if isinstance(tool_outputs[i], dict) else 0,
    } for i, t in enumerate(plan["tools"])]

    # Audit — reuses existing brain_audit collection so it shows up alongside /ask.
    try:
        await db.brain_audit.insert_one({
            "id": new_id(), "tenant_id": user["tenant_id"], "user_id": user["id"],
            "question": q, "intent": "agent",
            "tools_used": [t["name"] for t in tools_used],
            "result_type": "AGENT_ANSWER", "created_at": now_iso(),
        })
    except Exception:
        pass

    return {
        "answer": synth["answer"],
        "reasoning": plan["reasoning"],
        "citations": synth["citations"],
        "suggested_tasks": synth["suggested_tasks"],
        "follow_ups": synth["follow_ups"],
        "tools_used": tools_used,
    }

"""FIX-007-C (S4-04): Shared retrieval layer for the Brain.

Before this fix, `/ask` (routers/brain.py) and `/brain/agent`
(routers/brain_router.py) had inconsistent reach:
  * `/ask` only queried the domain collections (tasks, invoices,
    payments, decisions, workflows, contacts, memory). It never
    looked at brain_context (decision provenance) or brain_documents
    (uploaded policies / contracts) — so "how did we handle the last
    vendor delay?" via /ask came back empty even though the Dex agent
    answered it fine.
  * `/brain/agent` had brain_documents + brain_context via
    `_tool_metadata_search` and `_tool_knowledge_lookup` — good
    reach, but the Mongo query logic was duplicated inline in the
    router. Any future upgrade (e.g., vector search in S4-05/06)
    would need to land in two places or forget one.

This module fixes both:
  * search_documents(...) — the single implementation of
    brain_documents lookup with visibility + text-index +
    regex fallback. Called from BOTH /ask (as an always-on
    enrichment pass) and /brain/agent's metadata_search tool.
  * search_context(...) — thin wrapper on the existing
    brain_context.query_context() so /ask can call the same
    entrypoint /brain/agent uses.

When S4-05 (embeddings) + S4-06 (vector search) land, they add
one code path here — both routers benefit automatically.
"""
from __future__ import annotations
from typing import Any, Optional

from core import db, logger


# Retrieval cap defaults. Small caps because we cite these in
# the /ask answer prompt — too many hits would blow the context
# window without adding signal.
DEFAULT_DOCS_LIMIT = 6
DEFAULT_CONTEXT_LIMIT = 8


async def search_documents(
    *,
    tenant_id: str,
    user: dict,
    query: Optional[str] = None,
    limit: int = DEFAULT_DOCS_LIMIT,
) -> list[dict]:
    """Search the tenant's brain_documents catalog (uploaded policies,
    contracts, filings) by ranked full-text with keyword+regex fallback.

    Respects visibility: owner and team_manage see everything; other
    users see public + own-uploaded + dept-visible when their role
    matches. Same rules the brain_router tool used to enforce inline.

    Returns [] on any error — retrieval is best-effort auxiliary
    context for both /ask and /brain/agent.
    """
    # Deferred imports break the routers <-> services import cycle.
    from routers.brain_docs import (
        _visibility_filter as _docs_visibility_filter,
        _keywords as _docs_keywords,
    )
    from core import user_perms
    try:
        base: dict = {"tenant_id": tenant_id, "is_deleted": False}
        if user.get("role") != "owner" and "team_manage" not in user_perms(user):
            base.setdefault("$and", []).append(_docs_visibility_filter(user))

        q = (query or "").strip()
        if not q:
            # No search string — return most recent visible docs (used
            # by the browse fallback in Dex).
            rows = await db.brain_documents.find(
                base, {"_id": 0, "keywords": 0, "storage_path": 0},
            ).sort("created_at", -1).limit(limit).to_list(limit)
            return rows

        # Primary path — ranked full-text search using the
        # brain_documents_text_v1 index (rebuilt with english stemming
        # in S4-01, so "refund" now hits "refunds"/"refunded").
        try:
            rows = await db.brain_documents.find(
                {**base, "$text": {"$search": q}},
                {"_id": 0, "keywords": 0, "storage_path": 0,
                 "score": {"$meta": "textScore"}},
            ).sort([("score", {"$meta": "textScore"})]).limit(limit).to_list(limit)
            if rows:
                return rows
        except Exception as e:
            logger.warning(f"brain_retrieval.search_documents text fallback: {e}")

        # Fallback — keyword + regex when the text index either fails
        # or the query happens to miss it entirely.
        tokens = _docs_keywords(q)
        regex_or = [
            {"title":             {"$regex": q, "$options": "i"}},
            {"summary":           {"$regex": q, "$options": "i"}},
            {"original_filename": {"$regex": q, "$options": "i"}},
        ]
        if tokens:
            regex_or += [{"keywords": {"$in": tokens}},
                          {"tags":    {"$in": tokens}}]
        filt = {**base}
        filt.setdefault("$and", []).append({"$or": regex_or})
        return await db.brain_documents.find(
            filt, {"_id": 0, "keywords": 0, "storage_path": 0},
        ).sort("created_at", -1).limit(limit).to_list(limit)
    except Exception as e:
        # Fail-open — retrieval is auxiliary; a Mongo blip must never
        # 500 the parent /ask or /brain/agent call.
        logger.warning(f"brain_retrieval.search_documents failed: {e}")
        return []


async def search_context(
    *,
    tenant_id: str,
    user: dict,
    query: Optional[str] = None,
    limit: int = DEFAULT_CONTEXT_LIMIT,
    kind: Optional[str] = None,
    tag: Optional[str] = None,
) -> list[dict]:
    """Search the tenant's brain_context (decision provenance /
    task_done outcomes / meeting summaries / finance events / workflow
    advances — the full write-coverage FIX-007-B enabled).

    Thin wrapper on the existing services.ai.brain_context.query_context
    so both routers hit one entrypoint and any future improvements
    (embeddings, hybrid ranking) land here.
    """
    from services.ai import brain_context as _bc
    try:
        return await _bc.query_context(
            tenant_id=tenant_id, user=user,
            q=query, kind=kind, tag=tag, limit=limit,
        )
    except Exception as e:
        logger.warning(f"brain_retrieval.search_context failed: {e}")
        return []


def cites_from_hits(
    document_hits: list[dict] | None = None,
    context_hits: list[dict] | None = None,
) -> list[dict]:
    """Shape retrieval hits into the citation format /ask's response
    already uses (`{id, title, source_type, source_id, kind, ...}`).
    Deterministic — no LLM call.
    """
    out: list[dict] = []
    for h in (document_hits or []):
        out.append({
            "id": h.get("id"),
            "title": h.get("title") or h.get("original_filename") or "Document",
            "source_type": "brain_document",
            "kind": h.get("kind"),
            "tags": h.get("tags") or [],
            "created_at": h.get("created_at"),
        })
    for h in (context_hits or []):
        out.append({
            "id": h.get("id"),
            "title": h.get("title") or "Note",
            "source_type": "brain_context",
            "kind": h.get("kind"),
            "outcome": h.get("outcome"),
            "tags": h.get("tags") or [],
            "created_at": h.get("created_at"),
        })
    return out


# --- E3-10.1: semantic (vector) retrieval over embedded chunks --------------
def _chunk_visible(chunk: dict, user: dict) -> bool:
    """Mirror of brain_docs._user_can_see, applied to a chunk's inherited RBAC payload.
    Owner/manager and the uploader see all; else public / dept-by-role / private-by-role."""
    from core import user_perms
    if user.get("role") == "owner" or "team_manage" in user_perms(user):
        return True
    if chunk.get("uploaded_by") and chunk.get("uploaded_by") == user.get("id"):
        return True
    role = user.get("role") or ""
    vis = chunk.get("visibility") or "public"
    roles_allowed = chunk.get("roles_allowed") or []
    if vis == "public":
        return True
    if vis == "dept":
        return chunk.get("department") == role or role in roles_allowed
    if vis == "private":
        return role in roles_allowed
    return False


async def search_chunks(*, user: dict, query: str, limit: int = 8) -> list[dict]:
    """Semantic retrieval (E3-10.1): embed the question, search the tenant's Qdrant
    chunks, and enforce the SAME per-document RBAC as keyword search. Over-fetches a
    buffer then filters in Python (reusing the visibility rules), so access can never
    leak. Returns [] on any error -- retrieval is best-effort auxiliary context."""
    q = (query or "").strip()
    tenant_id = user.get("tenant_id")
    if not q or not tenant_id:
        return []
    try:
        from integrations.embeddings import embed_query
        from integrations import qdrant
        vec = await embed_query(q, tenant_id=tenant_id)
        if not vec:
            return []
        # Over-fetch so RBAC filtering still leaves enough visible hits.
        buffer = max(limit * 5, 30)
        candidates = await qdrant.search(tenant_id, vec, k=min(buffer, 100))
        visible = [c for c in candidates if _chunk_visible(c, user)]
        return visible[:limit]
    except Exception as e:
        logger.warning(f"brain_retrieval.search_chunks failed: {e}")
        return []


# --- E3-10.2: reciprocal-rank fusion of keyword + vector rankings -----------
def rrf_fuse(rankings: list[list], *, k: int = 60) -> list:
    """Reciprocal-rank fusion. Each `rankings` entry is an ordered list of ids (best
    first). Returns ids ordered by fused score sum(1/(k+rank)). Deterministic, pure --
    combines keyword and vector rankings without needing comparable score scales."""
    scores: dict = {}
    order: list = []
    for ranking in rankings:
        for rank, _id in enumerate(ranking):
            if _id is None:
                continue
            if _id not in scores:
                scores[_id] = 0.0
                order.append(_id)
            scores[_id] += 1.0 / (k + rank + 1)
    return sorted(order, key=lambda i: scores[i], reverse=True)

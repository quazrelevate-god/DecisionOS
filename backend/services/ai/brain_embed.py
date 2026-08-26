"""Embed-at-ingest for the Company Brain (Epic 3 Sprint 3 -- E3-09.3).

Ties the pieces together: when a document lands in brain_documents, read its body
text (bodies were metadata-only before), chunk it, embed the chunks (E3-09.1), and
upsert them to Qdrant (E3-09.2) with the document's RBAC fields on the payload so
retrieval (E3-10) can filter by tenant + visibility.

* ``chunk_text`` -- pure, testable chunker (~size chars, overlap, boundary-aware).
* ``index_document(doc)`` -- extract -> chunk -> embed -> re-upsert (idempotent).
* ``deindex_document`` -- drop a doc's chunks (on delete).
* ``backfill_documents`` -- index existing brain_documents (one-time migration).
"""
from __future__ import annotations

import logging

from core import db
from integrations.embeddings import embed_texts, embedding_dim
from integrations import qdrant

logger = logging.getLogger("decisionos")

# ~600 tokens ~= 2400 chars; ~100-token overlap ~= 400 chars. Char-based keeps it pure.
CHUNK_SIZE = 2400
CHUNK_OVERLAP = 400
RAG_MAX_CHARS = 60000  # how much of a document body we read for RAG (vs 6000 for voice attachments)


def chunk_text(text, *, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    """Split text into ~size-char chunks with overlap, preferring a paragraph/sentence
    boundary near the end of each window. Pure; returns a list of non-empty chunks."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    overlap = max(0, min(overlap, size - 1))
    chunks, start, n = [], 0, len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            window = text[start:end]
            brk = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if brk > size * 0.5:                 # only honour a boundary well into the window
                end = start + brk + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)    # guaranteed forward progress
    return chunks


def _doc_payload(doc: dict) -> dict:
    """The document's RBAC + display fields carried onto every chunk for retrieval-time filtering."""
    return {
        "visibility": doc.get("visibility") or "public",
        "department": doc.get("department") or "",
        "roles_allowed": doc.get("roles_allowed") or [],
        "title": doc.get("title") or doc.get("original_filename") or "",
    }


async def index_document(doc: dict) -> int:
    """Extract, chunk, embed, and (re)index one brain_documents record. Idempotent: clears
    the doc's existing chunks first, so an update re-indexes cleanly. Returns chunk count.
    Never raises -- indexing must not break the upload; failures are logged."""
    tenant_id, doc_id = doc.get("tenant_id"), doc.get("id")
    if not tenant_id or not doc_id:
        return 0
    try:
        from services.files import _read_reference_text
        text = await _read_reference_text(doc, tenant_id, max_chars=RAG_MAX_CHARS)
        pieces = chunk_text(text)
        # Always clear old chunks first (handles updates + shrinking docs).
        await qdrant.ensure_collection(embedding_dim())
        await qdrant.delete_by_doc(tenant_id, doc_id)
        if not pieces:
            logger.info(f"brain_embed: no body text for doc {doc_id}; keyword-only")
            return 0
        vectors = await embed_texts(pieces, input_type="document", task="brain_doc", tenant_id=tenant_id)
        payload = _doc_payload(doc)
        chunks = [{"chunk_idx": i, "text": p, "embedding": v, "payload": payload,
                   "visibility": payload["visibility"], "tags": doc.get("tags") or []}
                  for i, (p, v) in enumerate(zip(pieces, vectors))]
        n = await qdrant.upsert_chunks(tenant_id, doc_id, chunks)
        logger.info(f"brain_embed: indexed doc {doc_id} -> {n} chunks")
        return n
    except Exception as e:  # never break the caller
        logger.warning(f"brain_embed: index_document failed for {doc_id}: {e}")
        return 0


async def deindex_document(tenant_id: str, doc_id: str) -> None:
    """Remove a document's chunks (on delete). Never raises."""
    try:
        await qdrant.delete_by_doc(tenant_id, doc_id)
    except Exception as e:
        logger.warning(f"brain_embed: deindex failed for {doc_id}: {e}")


async def backfill_documents(tenant_id=None, limit: int = 5000) -> dict:
    """One-time migration: index existing (non-deleted) brain_documents. Scope to one tenant
    or all. Returns {docs, chunks}. Safe to re-run (idempotent per doc)."""
    q = {"is_deleted": {"$ne": True}}
    if tenant_id:
        q["tenant_id"] = tenant_id
    docs = await db.brain_documents.find(q, {"_id": 0}).to_list(limit)
    total_chunks = 0
    for doc in docs:
        total_chunks += await index_document(doc)
    logger.info(f"brain_embed: backfill indexed {len(docs)} docs -> {total_chunks} chunks")
    return {"docs": len(docs), "chunks": total_chunks}

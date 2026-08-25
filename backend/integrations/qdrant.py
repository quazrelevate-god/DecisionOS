"""Qdrant vector store for Company Brain chunks (Epic 3 Sprint 3 -- E3-09.2).

A dedicated vector DB holds the embedded document chunks; the Brain's structured
metrics still come from Mongo (deterministic, unchanged). Multi-tenancy is a single
``brain_chunks`` collection with a MANDATORY ``tenant_id`` payload filter on every
read -- a tenant can never retrieve another tenant's chunks. Point ids are
deterministic (uuid5 of tenant:doc:chunk) so re-embedding a document overwrites its
chunks cleanly instead of duplicating.

Connection: ``QDRANT_URL`` (+ optional ``QDRANT_API_KEY``) for the real server;
absent that, an in-memory client (``:memory:``) so dev + tests run with no infra.
The vector dimension is passed in by the caller (from embeddings.embedding_dim())
so the store stays decoupled from the embedding provider -- and so the OpenAI(1536)
-> Voyage(1024) swap just recreates the collection at the new dim (E3-09.5).
"""
from __future__ import annotations

import os
import uuid
import logging

logger = logging.getLogger("decisionos")

COLLECTION = os.environ.get("QDRANT_COLLECTION", "brain_chunks")
_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")  # fixed namespace for deterministic point ids
_client = None


def _new_client():
    from qdrant_client import AsyncQdrantClient
    url = os.environ.get("QDRANT_URL", "").strip()
    if url:
        return AsyncQdrantClient(url=url, api_key=(os.environ.get("QDRANT_API_KEY") or None))
    return AsyncQdrantClient(location=":memory:")  # dev / test: no server needed


def get_client():
    global _client
    if _client is None:
        _client = _new_client()
    return _client


def reset_client() -> None:
    """Drop the cached client (test helper: gives a fresh in-memory store)."""
    global _client
    _client = None


def _point_id(tenant_id: str, doc_id: str, chunk_idx: int) -> str:
    return str(uuid.uuid5(_NS, f"{tenant_id}:{doc_id}:{chunk_idx}"))


def _tenant_filter(tenant_id: str, visibility_allowed=None):
    from qdrant_client import models
    must = [models.FieldCondition(key="tenant_id", match=models.MatchValue(value=tenant_id))]
    if visibility_allowed:
        must.append(models.FieldCondition(
            key="visibility", match=models.MatchAny(any=list(visibility_allowed))))
    return models.Filter(must=must)


async def ensure_collection(dim: int, *, recreate: bool = False) -> str:
    """Create the brain_chunks collection (Cosine, size=dim) if absent + index tenant_id.
    recreate=True drops and rebuilds it (used when the embedding dim changes on a swap)."""
    from qdrant_client import models
    c = get_client()
    exists = await c.collection_exists(COLLECTION)
    if exists and recreate:
        await c.delete_collection(COLLECTION)
        exists = False
    if not exists:
        await c.create_collection(
            COLLECTION, vectors_config=models.VectorParams(size=dim, distance=models.Distance.COSINE))
        # Index tenant_id for fast multi-tenant filtering -- only meaningful on a real
        # server (local/in-memory mode ignores indexes and warns), so skip it there.
        if os.environ.get("QDRANT_URL", "").strip():
            try:
                await c.create_payload_index(
                    COLLECTION, field_name="tenant_id", field_schema=models.PayloadSchemaType.KEYWORD)
            except Exception as e:  # index is a perf optimization, not correctness
                logger.debug(f"qdrant tenant_id index: {e}")
    return COLLECTION


async def upsert_chunks(tenant_id: str, doc_id: str, chunks: list) -> int:
    """Upsert a document's chunks. chunks = [{chunk_idx, text, embedding, visibility?, tags?}].
    Deterministic ids -> re-embedding the same doc overwrites, never duplicates. Returns count."""
    from qdrant_client import models
    if not tenant_id or not doc_id or not chunks:
        return 0
    points = []
    for ch in chunks:
        idx = ch["chunk_idx"]
        points.append(models.PointStruct(
            id=_point_id(tenant_id, doc_id, idx),
            vector=list(ch["embedding"]),
            payload={"tenant_id": tenant_id, "doc_id": doc_id, "chunk_idx": idx,
                     "text": ch.get("text", ""), "visibility": ch.get("visibility", "tenant"),
                     "tags": ch.get("tags") or []},
        ))
    await get_client().upsert(COLLECTION, points=points)
    return len(points)


async def search(tenant_id: str, query_vector, k: int = 8, visibility_allowed=None) -> list:
    """Top-k similar chunks for a tenant. tenant_id is MANDATORY (empty -> no results,
    never a cross-tenant search). visibility_allowed (optional) restricts to those
    visibility values (RBAC). Returns [{score, tenant_id, doc_id, chunk_idx, text, ...}]."""
    if not tenant_id or not query_vector:
        return []
    res = await get_client().query_points(
        COLLECTION, query=list(query_vector), limit=k,
        query_filter=_tenant_filter(tenant_id, visibility_allowed), with_payload=True)
    return [{"score": p.score, **(p.payload or {})} for p in res.points]


async def delete_by_doc(tenant_id: str, doc_id: str) -> None:
    """Remove a document's chunks (before re-embedding an updated doc, or on doc delete)."""
    from qdrant_client import models
    if not tenant_id or not doc_id:
        return
    await get_client().delete(COLLECTION, points_selector=models.Filter(must=[
        models.FieldCondition(key="tenant_id", match=models.MatchValue(value=tenant_id)),
        models.FieldCondition(key="doc_id", match=models.MatchValue(value=doc_id))]))


async def delete_by_tenant(tenant_id: str) -> None:
    """Remove all of a tenant's chunks (tenant deprovisioning)."""
    if not tenant_id:
        return
    await get_client().delete(COLLECTION, points_selector=_tenant_filter(tenant_id))


async def count(tenant_id=None) -> int:
    flt = _tenant_filter(tenant_id) if tenant_id else None
    r = await get_client().count(COLLECTION, count_filter=flt, exact=True)
    return r.count

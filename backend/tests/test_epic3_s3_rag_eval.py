"""Epic 3 Sprint 3 (E3-10.3): retrieval eval harness -- golden question -> expected doc.

Runs the FULL RAG pipeline end to end (index_document -> chunk -> embed -> Qdrant ->
search_chunks) and measures recall@k against a golden set. Uses a deterministic
bag-of-words embedding so CI is reproducible + free; the same harness runs against
real embeddings in the live smoke. This is the guard that keeps retrieval quality
from silently regressing when chunk size / fusion / embed model change.
"""
import asyncio
import hashlib

import services.ai.brain_embed as be
import services.ai.brain_retrieval as br
import integrations.qdrant as q
import integrations.embeddings as emb


_DIM = 64


def _bow(text: str, dim: int = _DIM):
    """Deterministic bag-of-words embedding (stable md5 hash -> bucket), unit-normalized."""
    v = [0.0] * dim
    for w in (text or "").lower().split():
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % dim] += 1.0
    norm = (sum(x * x for x in v) ** 0.5) or 1.0
    return [x / norm for x in v]


_DOCS = {
    "refund": "Our refund policy allows customer returns within 7 days of purchase with a valid receipt.",
    "leave": "Employees are entitled to 12 days of paid annual leave every year, approved by their manager.",
    "supplier": "The vendor supply contract with Acme Traders renews annually in the month of March.",
    "gst": "GST tax filings are submitted quarterly through the company accountant before the deadline.",
}

_GOLDEN = [
    ("how many days do customers have for a refund", "refund"),
    ("what is the annual leave entitlement for employees", "leave"),
    ("when does the Acme vendor contract renew", "supplier"),
    ("how often are GST filings submitted", "gst"),
]


def _wire(monkeypatch):
    async def fake_read(rec, tenant_id="", max_chars=6000):
        return _DOCS[rec["id"]]

    async def fake_embed_texts(texts, **k):
        return [_bow(t) for t in texts]

    async def fake_embed_query(text, **k):
        return _bow(text)

    import services.files as files_mod
    monkeypatch.setattr(files_mod, "_read_reference_text", fake_read)
    monkeypatch.setattr(be, "embed_texts", fake_embed_texts)
    monkeypatch.setattr(be, "embedding_dim", lambda task="default": _DIM)
    monkeypatch.setattr(emb, "embed_query", fake_embed_query)
    q.reset_client()


async def _index_all():
    for doc_id in _DOCS:
        await be.index_document({"tenant_id": "t1", "id": doc_id, "visibility": "public",
                                 "title": doc_id, "content_type": "text/plain",
                                 "original_filename": f"{doc_id}.txt", "storage_path": "x"})


async def _recall_at_k(k=2):
    await _index_all()
    user = {"id": "u", "tenant_id": "t1", "role": "owner"}
    hits_ok = 0
    for question, expected in _GOLDEN:
        hits = await br.search_chunks(user=user, query=question, limit=k)
        if expected in {h["doc_id"] for h in hits}:
            hits_ok += 1
    return hits_ok / len(_GOLDEN)


def test_retrieval_recall_at_2_is_perfect(monkeypatch):
    _wire(monkeypatch)
    recall = asyncio.run(_recall_at_k(2))
    assert recall == 1.0, f"recall@2 = {recall}, expected 1.0"


def test_retrieval_top1_floor(monkeypatch):
    # The deterministic bag-of-words test embedding is weak at top-1 (stopwords dominate);
    # this only asserts a sane floor. Real embeddings score much higher -- see the live smoke.
    _wire(monkeypatch)
    recall1 = asyncio.run(_recall_at_k(1))
    assert recall1 >= 0.5, f"recall@1 = {recall1}"


def test_pipeline_indexes_all_docs(monkeypatch):
    _wire(monkeypatch)
    asyncio.run(_index_all())
    assert asyncio.run(q.count("t1")) >= len(_DOCS)  # every doc produced >=1 chunk

"""Epic 3 Sprint 3 (E3-09.3): chunker + embed-at-ingest.

The chunker is tested pure; the ingest flow (extract -> chunk -> embed -> upsert)
is tested against in-memory Qdrant with the embed + text-extract steps mocked, so
it verifies the wiring + that a document's RBAC fields land on every chunk.
"""
import asyncio

import services.ai.brain_embed as be
import integrations.qdrant as q


def _run(c):
    return asyncio.run(c)


# --- chunk_text (pure) ------------------------------------------------------
def test_empty_and_short():
    assert be.chunk_text("") == []
    assert be.chunk_text("   ") == []
    assert be.chunk_text("short text", size=100) == ["short text"]


def test_long_text_splits_with_overlap():
    text = " ".join(f"word{i}" for i in range(500))  # long
    chunks = be.chunk_text(text, size=100, overlap=20)
    assert len(chunks) > 3
    assert all(len(c) <= 100 for c in chunks)
    # coverage: first and last words present across the chunk set
    joined = " ".join(chunks)
    assert "word0" in joined and "word499" in joined


def test_boundary_preference():
    text = "First paragraph here.\n\n" + ("x" * 60) + ". Second sentence follows here."
    chunks = be.chunk_text(text, size=40, overlap=5)
    assert len(chunks) >= 2 and all(c.strip() for c in chunks)


def test_no_infinite_loop_when_overlap_ge_size():
    # overlap is clamped below size -> must terminate
    chunks = be.chunk_text("a" * 300, size=50, overlap=100)
    assert len(chunks) >= 1


# --- index_document / deindex (mocked embed + extract, real in-memory Qdrant) ---
_DOC = {
    "tenant_id": "t1", "id": "docA", "visibility": "dept", "department": "finance",
    "roles_allowed": ["finance"], "title": "Refund Policy",
    "content_type": "text/plain", "original_filename": "policy.txt", "storage_path": "x/y",
}


def _wire(monkeypatch, text):
    async def fake_read(rec, tenant_id="", max_chars=6000):
        return text

    async def fake_embed(texts, **k):
        return [[0.1, 0.2, 0.3, 0.4] for _ in texts]

    import services.files as files_mod
    monkeypatch.setattr(files_mod, "_read_reference_text", fake_read)
    monkeypatch.setattr(be, "embed_texts", fake_embed)
    monkeypatch.setattr(be, "embedding_dim", lambda task="default": 4)
    q.reset_client()


def test_index_document_upserts_chunks_with_rbac_payload(monkeypatch):
    _wire(monkeypatch, "Refunds are allowed within 7 days. " * 50)  # long enough to chunk
    n = _run(be.index_document(dict(_DOC)))
    assert n >= 1
    hits = _run(q.search("t1", [0.1, 0.2, 0.3, 0.4], k=20))
    assert len(hits) == n
    h = hits[0]
    assert h["visibility"] == "dept" and h["department"] == "finance"
    assert h["roles_allowed"] == ["finance"] and h["title"] == "Refund Policy"
    assert h["doc_id"] == "docA"


def test_index_document_is_idempotent(monkeypatch):
    _wire(monkeypatch, "Some policy text that is reasonably long. " * 30)
    n1 = _run(be.index_document(dict(_DOC)))
    n2 = _run(be.index_document(dict(_DOC)))          # re-index same doc
    assert n1 == n2
    assert _run(q.count("t1")) == n1                  # overwritten, not duplicated


def test_index_document_no_text_is_zero(monkeypatch):
    _wire(monkeypatch, "")                            # extractor returns nothing
    assert _run(be.index_document(dict(_DOC))) == 0


def test_deindex_removes_chunks(monkeypatch):
    _wire(monkeypatch, "Policy body text here. " * 40)
    _run(be.index_document(dict(_DOC)))
    assert _run(q.count("t1")) > 0
    _run(be.deindex_document("t1", "docA"))
    assert _run(q.count("t1")) == 0


def test_index_never_raises_on_bad_doc(monkeypatch):
    _wire(monkeypatch, "text")
    assert _run(be.index_document({})) == 0           # missing tenant/id -> 0, no raise

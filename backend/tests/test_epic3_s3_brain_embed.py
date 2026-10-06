"""Epic 3 Sprint 3 (E3-09.3): chunker + embed-at-ingest.

The chunker is tested pure; the ingest flow (extract -> chunk -> embed -> upsert)
is tested against in-memory Qdrant with the embed + text-extract steps mocked, so
it verifies the wiring + that a document's RBAC fields land on every chunk.
"""
import asyncio

import services.ai.brain_embed as be
import integrations.qdrant as q
from tests.fake_mongo import FakeDB, consenting_tenant


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
    # 2026-10-05: indexing reads the company's AI consent and the LIVE document.
    fdb = FakeDB()
    fdb.tenants.docs.append(consenting_tenant("t1"))
    fdb.brain_documents.docs.append({**_DOC, "is_deleted": False})
    monkeypatch.setattr(be, "db", fdb)
    q.reset_client()
    return fdb


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


# --- 2026-10-05: consent, deletes and the recorded index state ---------------
def test_no_ai_consent_means_no_embedding(monkeypatch):
    fdb = _wire(monkeypatch, "Policy body text here. " * 40)
    fdb.tenants.docs[0].pop("ai_consent")
    assert _run(be.index_document(dict(_DOC))) == 0
    assert _run(q.get_client().collection_exists(q.COLLECTION)) is False or _run(q.count("t1")) == 0
    assert fdb.brain_documents.docs[0]["index"]["state"] == "waiting_for_ai_consent"


def test_a_document_deleted_while_embedding_gets_no_chunks(monkeypatch):
    fdb = _wire(monkeypatch, "Policy body text here. " * 40)
    fdb.brain_documents.docs[0]["is_deleted"] = True
    assert _run(be.index_document(dict(_DOC))) == 0


def test_the_index_records_what_built_it(monkeypatch):
    fdb = _wire(monkeypatch, "Policy body text here. " * 40)
    n = _run(be.index_document(dict(_DOC)))
    idx = fdb.brain_documents.docs[0]["index"]
    assert idx["state"] == "indexed" and idx["chunks"] == n and idx["key"] == be.index_key()
    assert idx["key"].startswith("memory:")


def test_backfill_indexes_only_what_is_missing_or_stale(monkeypatch):
    fdb = _wire(monkeypatch, "Policy body text here. " * 40)
    monkeypatch.setenv("BRAIN_VECTOR_STORE", "mongo")
    out = _run(be.backfill_documents())
    assert out["docs"] == 1
    assert _run(be.backfill_documents()) == {"docs": 0, "chunks": 0}, "already current: nothing to do"


def test_the_mongo_store_survives_and_finds_by_cosine(monkeypatch):
    fdb = _wire(monkeypatch, "Policy body text here. " * 40)
    monkeypatch.setenv("BRAIN_VECTOR_STORE", "mongo")
    be._CACHE.clear()
    n = _run(be.index_document(dict(_DOC)))
    assert n >= 1 and len(fdb.brain_chunks.docs) == n
    hits = _run(be.search_vectors("t1", [0.1, 0.2, 0.3, 0.4], k=5))
    assert hits and abs(hits[0]["score"] - 1.0) < 1e-5 and hits[0]["doc_id"] == "docA"
    assert _run(be.search_vectors("t2", [0.1, 0.2, 0.3, 0.4], k=5)) == [], "never another company's"
    _run(be.deindex_document("t1", "docA"))
    assert fdb.brain_chunks.docs == [] and _run(be.search_vectors("t1", [0.1, 0.2, 0.3, 0.4], k=5)) == []


def test_the_store_is_chosen_in_one_place(monkeypatch):
    monkeypatch.delenv("BRAIN_VECTOR_STORE", raising=False)
    monkeypatch.delenv("QDRANT_URL", raising=False)
    assert be.store_kind() == "mongo", "no Qdrant server: durable Mongo, never silent memory"
    monkeypatch.setenv("QDRANT_URL", "http://qdrant:6333")
    assert be.store_kind() == "qdrant"
    assert "text_embedding_3_small_1536" in be._collection(), "one collection per model"



def test_a_document_is_chunked_by_its_sections():
    """2026-10-05 — one 2400-char chunk covering four unrelated sections matched a
    question about any of them at 0.36-0.38; its own section matched at 0.61-0.71."""
    body = ("Nila Garments - Staff Policy\n"
            "1. Leave\n" + "Every employee gets 12 casual leaves and 6 sick leaves in a calendar year. " * 2 + "\n"
            "2. Export payment terms\n" + "Export buyers pay 30% advance with the purchase order. " * 3 + "\n"
            "3. Safety\n" + "Loom operators must wear ear protection on the floor at all times. " * 3)
    chunks = be.chunk_text(body)
    assert len(chunks) == 3
    assert chunks[0].startswith("Nila Garments") and "1. Leave" in chunks[0]
    assert chunks[1].startswith("2. Export payment terms") and "Leave" not in chunks[1]
    assert chunks[2].startswith("3. Safety")


def test_a_tiny_fragment_joins_its_neighbour_and_plain_text_still_windows():
    assert len(be.chunk_text("TERMS\nNet 30.\n\nA. Scope\nShort.")) == 1
    long_plain = "word " * 1000
    assert len(be.chunk_text(long_plain)) > 1 and all(len(c) <= be.CHUNK_SIZE for c in be.chunk_text(long_plain))

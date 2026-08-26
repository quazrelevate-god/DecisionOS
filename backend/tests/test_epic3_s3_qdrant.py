"""Epic 3 Sprint 3 (E3-09.2): Qdrant vector store + brain_chunks schema.

Runs against an in-memory Qdrant (no server), so it exercises the real client API.
The headline guarantee under test: tenant isolation -- a search NEVER returns
another tenant's chunks. Also covers RBAC visibility filtering, deterministic
overwrite on re-embed, and delete paths.
"""
import asyncio

import integrations.qdrant as q


def _run(coro):
    return asyncio.run(coro)


def _fresh(dim=4):
    q.reset_client()
    _run(q.ensure_collection(dim))


def _chunks(texts, base=0, visibility="tenant"):
    # simple orthogonal-ish vectors so nearest-neighbour is predictable
    out = []
    for i, t in enumerate(texts):
        vec = [0.0, 0.0, 0.0, 0.0]
        vec[(base + i) % 4] = 1.0
        out.append({"chunk_idx": base + i, "text": t, "embedding": vec, "visibility": visibility})
    return out


def test_upsert_and_search_returns_chunk():
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["hello world"])))
    hits = _run(q.search("t1", [1.0, 0, 0, 0], k=5))
    assert len(hits) == 1 and hits[0]["text"] == "hello world" and hits[0]["doc_id"] == "docA"


def test_tenant_isolation():
    # THE critical guarantee: t2 must never see t1's chunk, even with an identical vector.
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["t1 secret"])))
    _run(q.upsert_chunks("t2", "docB", _chunks(["t2 secret"])))
    hits_t2 = _run(q.search("t2", [1.0, 0, 0, 0], k=10))
    assert all(h["tenant_id"] == "t2" for h in hits_t2)
    assert all(h["text"] != "t1 secret" for h in hits_t2)


def test_empty_tenant_returns_nothing():
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["x"])))
    assert _run(q.search("", [1.0, 0, 0, 0])) == []
    assert _run(q.search(None, [1.0, 0, 0, 0])) == []


def test_visibility_filter():
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["public note"], base=0, visibility="tenant")))
    _run(q.upsert_chunks("t1", "docB", _chunks(["finance only"], base=1, visibility="finance")))
    # a user who can only see 'tenant' visibility must not get the 'finance' chunk
    hits = _run(q.search("t1", [0, 1.0, 0, 0], k=10, visibility_allowed=["tenant"]))
    assert all(h["visibility"] == "tenant" for h in hits)
    assert all(h["text"] != "finance only" for h in hits)


def test_deterministic_overwrite_on_reembed():
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["v1"])))
    _run(q.upsert_chunks("t1", "docA", _chunks(["v2"])))  # same (tenant,doc,chunk_idx)
    assert _run(q.count("t1")) == 1  # overwritten, not duplicated
    hits = _run(q.search("t1", [1.0, 0, 0, 0], k=5))
    assert hits[0]["text"] == "v2"


def test_delete_by_doc():
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["a"], base=0)))
    _run(q.upsert_chunks("t1", "docB", _chunks(["b"], base=1)))
    _run(q.delete_by_doc("t1", "docA"))
    assert _run(q.count("t1")) == 1
    assert all(h["doc_id"] == "docB" for h in _run(q.search("t1", [0, 1.0, 0, 0], k=5)))


def test_delete_by_tenant():
    _fresh()
    _run(q.upsert_chunks("t1", "docA", _chunks(["a"])))
    _run(q.upsert_chunks("t2", "docB", _chunks(["b"])))
    _run(q.delete_by_tenant("t1"))
    assert _run(q.count("t1")) == 0 and _run(q.count("t2")) == 1


def test_point_id_deterministic():
    a = q._point_id("t1", "docA", 3)
    b = q._point_id("t1", "docA", 3)
    c = q._point_id("t1", "docA", 4)
    assert a == b and a != c

"""Epic 3 Sprint 3 (E3-10.1 + E3-10.2): vector retrieval RBAC + RRF fusion.

search_chunks must enforce the SAME per-document visibility as keyword search
(the headline: an employee can never retrieve a chunk they couldn't see as a
document). rrf_fuse is tested pure.
"""
import asyncio

import services.ai.brain_retrieval as br
import integrations.qdrant as q
import integrations.embeddings as emb


def _run(c):
    return asyncio.run(c)


# --- rrf_fuse (pure) --------------------------------------------------------
def test_rrf_empty():
    assert br.rrf_fuse([]) == []
    assert br.rrf_fuse([[], []]) == []


def test_rrf_single_ranking_preserves_order():
    assert br.rrf_fuse([["a", "b", "c"]]) == ["a", "b", "c"]


def test_rrf_rewards_agreement():
    # 'a' is high in both rankings -> should win; items in one list rank lower
    fused = br.rrf_fuse([["a", "b", "c"], ["a", "x", "y"]])
    assert fused[0] == "a"
    assert set(fused) == {"a", "b", "c", "x", "y"}


def test_rrf_ignores_none():
    assert br.rrf_fuse([[None, "a"], ["a", None]]) == ["a"]


# --- search_chunks RBAC -----------------------------------------------------
_V = [1.0, 0.0, 0.0, 0.0]


def _owner():
    return {"id": "owner1", "tenant_id": "t1", "role": "owner"}


def _emp(role):
    # explicit permissions override role defaults -> guaranteed non-manager
    return {"id": "emp1", "tenant_id": "t1", "role": role, "permissions": ["ask", "brain"]}


def _index():
    q.reset_client()
    _run(q.ensure_collection(4))
    _run(q.upsert_chunks("t1", "docPub", [{
        "chunk_idx": 0, "text": "public policy", "embedding": _V, "visibility": "public",
        "payload": {"visibility": "public", "title": "Pub"}}]))
    _run(q.upsert_chunks("t1", "docFin", [{
        "chunk_idx": 0, "text": "finance only", "embedding": _V, "visibility": "dept",
        "payload": {"visibility": "dept", "department": "finance", "roles_allowed": ["finance"], "title": "Fin"}}]))
    _run(q.upsert_chunks("t1", "docPriv", [{
        "chunk_idx": 0, "text": "secret", "embedding": _V, "visibility": "private",
        "payload": {"visibility": "private", "roles_allowed": ["ceo"], "uploaded_by": "owner1", "title": "Priv"}}]))


def _search(user, monkeypatch):
    async def fake_q(text, **k):
        return _V
    monkeypatch.setattr(emb, "embed_query", fake_q)
    return _run(br.search_chunks(user=user, query="anything", limit=10))


def test_owner_sees_all(monkeypatch):
    _index()
    docs = {h["doc_id"] for h in _search(_owner(), monkeypatch)}
    assert docs == {"docPub", "docFin", "docPriv"}


def test_finance_employee_sees_public_and_finance_only(monkeypatch):
    _index()
    docs = {h["doc_id"] for h in _search(_emp("finance"), monkeypatch)}
    assert docs == {"docPub", "docFin"}          # NOT docPriv (roles_allowed=[ceo])


def test_sales_employee_sees_only_public(monkeypatch):
    _index()
    docs = {h["doc_id"] for h in _search(_emp("sales"), monkeypatch)}
    assert docs == {"docPub"}                    # NOT finance (dept) or private


def test_empty_query_or_tenant_returns_nothing(monkeypatch):
    _index()
    async def fake_q(text, **k):
        return _V
    monkeypatch.setattr(emb, "embed_query", fake_q)
    assert _run(br.search_chunks(user=_owner(), query="   ", limit=5)) == []
    assert _run(br.search_chunks(user={"role": "owner"}, query="x", limit=5)) == []  # no tenant_id

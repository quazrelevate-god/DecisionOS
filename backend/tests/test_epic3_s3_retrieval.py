"""Epic 3 Sprint 3 (E3-10.1 + E3-10.2): vector retrieval RBAC + RRF fusion.

search_chunks must enforce the SAME per-document visibility as keyword search
(the headline: an employee can never retrieve a chunk they couldn't see as a
document). rrf_fuse is tested pure.
"""
import asyncio

import services.ai.brain_retrieval as br
import integrations.qdrant as q
import integrations.embeddings as emb
from tests.fake_mongo import FakeDB

# 2026-10-05: search_chunks re-checks every hit against the LIVE document.
_LIVE = FakeDB()
_LIVE.brain_documents.docs.extend([
    {"id": "docPub", "tenant_id": "t1", "visibility": "public", "title": "Pub", "is_deleted": False},
    {"id": "docFin", "tenant_id": "t1", "visibility": "dept", "department": "finance",
     "roles_allowed": ["finance"], "title": "Fin", "is_deleted": False},
    {"id": "docPriv", "tenant_id": "t1", "visibility": "private", "roles_allowed": ["ceo"],
     "uploaded_by": "owner1", "title": "Priv", "is_deleted": False},
])


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
    monkeypatch.setattr(br, "db", _LIVE)
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


# --- 2026-10-05: the live document decides ---------------------------------
def test_a_deleted_document_is_never_cited(monkeypatch):
    _index()
    _LIVE.brain_documents.docs[0]["is_deleted"] = True
    try:
        ids = {h["doc_id"] for h in _search(_owner(), monkeypatch)}
    finally:
        _LIVE.brain_documents.docs[0]["is_deleted"] = False
    assert "docPub" not in ids and {"docFin", "docPriv"} <= ids


def test_a_visibility_edit_applies_without_re_embedding(monkeypatch):
    _index()     # chunks were embedded while docPub was public
    _LIVE.brain_documents.docs[0].update({"visibility": "private", "roles_allowed": ["ceo"]})
    try:
        ids = {h["doc_id"] for h in _search(_emp("sales"), monkeypatch)}
    finally:
        _LIVE.brain_documents.docs[0].update({"visibility": "public", "roles_allowed": []})
    assert "docPub" not in ids, "the document's CURRENT visibility rules, not the indexed copy"


def test_weak_matches_are_not_evidence(monkeypatch):
    _index()

    async def far(text, **k):
        return [0.2, 1.0, 0.0, 0.0]        # cosine ~0.196 with every chunk
    monkeypatch.setattr(emb, "embed_query", far)
    monkeypatch.setattr(br, "db", _LIVE)
    assert _run(br.search_chunks(user=_owner(), query="weather in Chennai", limit=10)) == []

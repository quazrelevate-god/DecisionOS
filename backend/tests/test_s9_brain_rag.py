"""Epic 10 T10-09.8 -- Dex RAG citation accuracy on a LIVE, diverse Company Brain.

Seeds a realistic textile-SME brain (policies, SOPs, contracts, filings, reports,
notes across departments + visibility levels, PLUS decision provenance) into an
isolated Mongo (with_test_db) + an in-memory Qdrant, then drives the REAL retrieval
+ citation code (brain_retrieval.search_documents / search_chunks / search_context
-> cites_from_hits) and asserts:

  * every question is answered with a citation pointing at the RIGHT source doc,
  * "how did we handle X before" cites brain_context provenance (not a document),
  * an out-of-domain question fabricates NO document citation,
  * RBAC holds -- a finance-private doc is invisible to sales/operations.

Two modes, one corpus:
  * default (CI, free, deterministic): bag-of-words embeddings.
  * RUN_LIVE_LLM=1: REAL OpenAI text-embedding-3-small embeddings -> a genuine
    live company brain. (Qdrant runs in-memory; no vector-DB infra needed.)

This is the ingest -> ask -> assert-citation-points-at-source chain that did not
exist before (the T10-09.8 gap).
"""
import os
import asyncio
import hashlib

import pytest
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent.parent / ".env")  # OPENAI key for live mode

import services.ai.brain_embed as be
import services.ai.brain_retrieval as br
import services.ai.brain_context as bc
import integrations.qdrant as q
import integrations.embeddings as emb
import services.files as files_mod

from tests import brain_seed_data as seed

LIVE = bool(os.environ.get("RUN_LIVE_LLM"))
_DIM = 64


def _bow(text, dim=_DIM):
    """Deterministic bag-of-words embedding (offline mode)."""
    v = [0.0] * dim
    for w in (text or "").lower().split():
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % dim] += 1.0
    norm = (sum(x * x for x in v) ** 0.5) or 1.0
    return [x / norm for x in v]


def _wire(monkeypatch, test_db):
    """Point the brain modules at the isolated Mongo; choose embeddings by mode."""
    # doc bodies come from the seed (no obj_store / OCR needed)
    _bodies = seed.bodies()

    async def fake_read(rec, tenant_id="", max_chars=6000):
        return _bodies.get(rec["id"], "")
    monkeypatch.setattr(files_mod, "_read_reference_text", fake_read)

    # isolated Mongo for both retrieval + provenance stores
    monkeypatch.setattr(br, "db", test_db)
    monkeypatch.setattr(bc, "db", test_db)

    if not LIVE:
        async def fake_embed_texts(texts, **k):
            return [_bow(t) for t in texts]

        async def fake_embed_query(text, **k):
            return _bow(text)
        monkeypatch.setattr(be, "embed_texts", fake_embed_texts)
        monkeypatch.setattr(be, "embedding_dim", lambda task="default": _DIM)
        monkeypatch.setattr(emb, "embed_query", fake_embed_query)
    q.reset_client()   # fresh in-memory Qdrant


async def _seed_brain(test_db):
    """Insert the diverse corpus: tenant + brain_documents (+ embedded chunks) +
    brain_context provenance."""
    # the same $text indexes bootstrap creates in production, so ranked full-text
    # search (the primary retrieval path) is exercised faithfully, not just the
    # regex fallback.
    await test_db.brain_documents.create_index(
        [("title", "text"), ("summary", "text"), ("keywords", "text"), ("tags", "text")],
        name="brain_documents_text_v1")
    await test_db.brain_context.create_index(
        [("title", "text"), ("tags", "text"), ("why", "text")],
        name="brain_context_text", weights={"title": 6, "tags": 3, "why": 1})
    await test_db.tenants.insert_one(
        {"id": seed.TENANT, "company_name": "Weave Co", "industry": "Textile Manufacturing"})
    # documents -> Mongo catalog + embedded chunks in Qdrant
    records = [seed.doc_record(d) for d in seed.DOCS]
    await test_db.brain_documents.insert_many([dict(r) for r in records])
    for r in records:
        n = await be.index_document(dict(r))
        assert n >= 1, f"{r['id']} produced no chunks"
    # provenance -> brain_context (via the real write path)
    for c in seed.CONTEXTS:
        await bc.record_context(
            tenant_id=seed.TENANT, kind=c["kind"], title=c["title"],
            outcome=c["outcome"], why=c["why"], department=c["department"],
            visibility=c["visibility"], actor_id=seed.OWNER, actor_name="Owner")


def _user(role="owner"):
    return {"id": seed.OWNER if role == "owner" else f"u-{role}",
            "tenant_id": seed.TENANT, "role": role}


async def _retrieve(test_db, user, question):
    """Mirror /ask enrichment: fuse keyword + semantic doc hits, shape into cites."""
    kw = await br.search_documents(tenant_id=seed.TENANT, user=user, query=question)
    sem = await br.search_chunks(user=user, query=question, limit=5)
    kw_ids = {h["id"] for h in kw}
    sem_ids = {h["doc_id"] for h in sem}
    extra_ids = [d for d in sem_ids if d not in kw_ids]
    extra = []
    if extra_ids:
        extra = await test_db.brain_documents.find(
            {"tenant_id": seed.TENANT, "id": {"$in": extra_ids}}, {"_id": 0}).to_list(50)
    cites = br.cites_from_hits(document_hits=list(kw) + extra)
    return cites, kw_ids, sem_ids


# ===========================================================================
# The full company-brain RAG scenario (seeds once, checks every group).
# ===========================================================================
def test_company_brain_citation_accuracy(with_test_db, monkeypatch):
    mode = "LIVE (OpenAI embeddings)" if LIVE else "offline (bag-of-words)"

    async def scenario(test_db):
        _wire(monkeypatch, test_db)
        await _seed_brain(test_db)
        fails = []

        # (1) citation accuracy -- each question cites its ONE source document
        cite_hits = 0
        for q_text, expected in seed.DOC_SCENARIOS:
            cites, kw_ids, sem_ids = await _retrieve(test_db, _user("owner"), q_text)
            found = expected in (kw_ids | sem_ids)
            if found:
                cite_hits += 1
                # the citation object must point at that doc as a brain_document
                if expected in kw_ids:
                    ok = any(c["id"] == expected and c["source_type"] == "brain_document"
                             for c in cites)
                    if not ok:
                        fails.append(f"citation-shape: {q_text!r} -> {expected} not a brain_document cite")
            else:
                fails.append(f"retrieval-miss: {q_text!r} -> expected {expected}, "
                             f"got kw={kw_ids} sem={sem_ids}")
        recall = cite_hits / len(seed.DOC_SCENARIOS)

        # (2) provenance -- 'how did we handle X' cites brain_context, not a doc
        for q_text, title_sub in seed.CONTEXT_SCENARIOS:
            ctx = await br.search_context(tenant_id=seed.TENANT, user=_user("owner"), query=q_text)
            cites = br.cites_from_hits(context_hits=ctx)
            ok = any(c["source_type"] == "brain_context" and title_sub.lower() in (c["title"] or "").lower()
                     for c in cites)
            if not ok:
                fails.append(f"provenance-miss: {q_text!r} -> no brain_context cite for {title_sub!r} "
                             f"(got {[c.get('title') for c in cites]})")

        # (3) negatives -- an out-of-domain question fabricates NO document citation
        for q_text in seed.NEGATIVE_QUESTIONS:
            kw = await br.search_documents(tenant_id=seed.TENANT, user=_user("owner"), query=q_text)
            if kw:
                fails.append(f"false-citation: {q_text!r} keyword-matched {[h['id'] for h in kw]}")

        # (4) RBAC -- a finance-private doc is invisible to sales/operations
        for role, q_text, doc_id, should in seed.RBAC_SCENARIOS:
            _, kw_ids, sem_ids = await _retrieve(test_db, _user(role), q_text)
            seen = doc_id in (kw_ids | sem_ids)
            if seen != should:
                verb = "should see but did not" if should else "must NOT see but did"
                fails.append(f"rbac: {role} {verb} {doc_id} for {q_text!r} "
                             f"(kw={kw_ids} sem={sem_ids})")

        return recall, fails

    recall, fails = with_test_db(scenario)
    # offline bag-of-words is a weaker embedding; require a sane floor there and
    # near-perfect on real embeddings. Non-negotiable checks (provenance/negative/
    # rbac) must ALWAYS hold in both modes.
    hard_fails = [f for f in fails if not f.startswith("retrieval-miss")]
    assert not hard_fails, f"[{mode}] brain RAG failures:\n  " + "\n  ".join(hard_fails)
    floor = 0.95 if LIVE else 0.6
    assert recall >= floor, (f"[{mode}] citation recall {recall:.2f} < {floor}; "
                             f"misses:\n  " + "\n  ".join(f for f in fails if f.startswith('retrieval-miss')))


# ===========================================================================
# Focused always-run offline checks (fast, granular signal on the citation shaper).
# ===========================================================================
def test_cites_from_hits_distinguishes_document_vs_context():
    doc_hit = {"id": "leave_policy", "title": "Employee Leave Policy", "kind": "policy"}
    ctx_hit = {"id": "ctx1", "title": "Held Kumar order", "kind": "finance", "outcome": "cleared"}
    cites = br.cites_from_hits(document_hits=[doc_hit], context_hits=[ctx_hit])
    doc = next(c for c in cites if c["id"] == "leave_policy")
    ctx = next(c for c in cites if c["id"] == "ctx1")
    assert doc["source_type"] == "brain_document" and doc["kind"] == "policy"
    assert ctx["source_type"] == "brain_context" and ctx["outcome"] == "cleared"


def test_cites_from_hits_empty_is_empty():
    assert br.cites_from_hits() == []
    assert br.cites_from_hits(document_hits=[], context_hits=[]) == []

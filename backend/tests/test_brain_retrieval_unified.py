"""FIX-007-C (Sprint 4 batch C): retrieval unification tests.

Covers S4-04: /ask and /brain/agent now share ONE retrieval code path
via services.ai.brain_retrieval:
  * search_documents() — brain_documents with visibility + text +
    regex fallback, moved from routers/brain_router._tool_metadata_search
  * search_context() — thin wrapper on the existing brain_context.
    query_context() so /ask can hit the same entrypoint /brain/agent
    uses via _tool_knowledge_lookup
  * cites_from_hits() — deterministic shaping helper for /ask's
    citation list

/ask now enriches every answer with matching brain_context (past
provenance) + brain_documents (uploaded policies) hits — the reach
gap the tracker called out. INSUFFICIENT_DATA branch no longer
returns "no matches" when the Brain has extras.
"""
import asyncio
import inspect
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Fakes — same shape as the rest of the suite.
# ---------------------------------------------------------------------------
class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **k): return self
    def limit(self, *a, **k): return self

    async def to_list(self, n):
        return list(self._docs[:n])


class _Col:
    def __init__(self):
        self.docs = []
        self.raise_on_find = False

    def find(self, q=None, projection=None):
        if self.raise_on_find:
            raise RuntimeError("mongo down")
        # Very loose match filter for these tests — return everything.
        return _Cursor(self.docs)


class _FakeDB:
    def __init__(self):
        self.brain_documents = _Col()
        self.brain_context = _Col()


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _u(role="sales", perms=None, uid="u1"):
    return {"id": uid, "tenant_id": "t1", "role": role,
            "permissions": list(perms or [])}


# ===========================================================================
# services/ai/brain_retrieval — shared retrieval
# ===========================================================================
class TestSearchDocuments:
    def test_returns_hits_via_text_index_when_query_present(self, monkeypatch):
        from services.ai import brain_retrieval as br
        db = _FakeDB()
        db.brain_documents.docs = [
            {"id": "d1", "title": "Refund policy", "kind": "policy",
             "tags": ["finance"], "created_at": "2026-08-01T00:00:00Z"},
            {"id": "d2", "title": "Cancellation clause", "kind": "contract",
             "tags": ["legal"], "created_at": "2026-07-25T00:00:00Z"},
        ]
        monkeypatch.setattr(br, "db", db)
        hits = _run(br.search_documents(
            tenant_id="t1", user=_u(), query="refund", limit=5,
        ))
        assert hits and hits[0]["title"] == "Refund policy"

    def test_empty_query_returns_recent_docs(self, monkeypatch):
        from services.ai import brain_retrieval as br
        db = _FakeDB()
        db.brain_documents.docs = [{"id": "d1", "title": "x"}]
        monkeypatch.setattr(br, "db", db)
        hits = _run(br.search_documents(
            tenant_id="t1", user=_u(), query=None, limit=5,
        ))
        assert len(hits) == 1

    def test_fail_open_on_mongo_blip(self, monkeypatch):
        """A DB outage must not propagate — retrieval is auxiliary."""
        from services.ai import brain_retrieval as br
        db = _FakeDB()
        db.brain_documents.raise_on_find = True
        monkeypatch.setattr(br, "db", db)
        hits = _run(br.search_documents(
            tenant_id="t1", user=_u(), query="anything",
        ))
        assert hits == []

    def test_respects_owner_bypasses_visibility_filter(self, monkeypatch):
        """Owner sees everything — no dept/private gate applied."""
        from services.ai import brain_retrieval as br
        db = _FakeDB()
        db.brain_documents.docs = [{"id": "d1", "title": "internal only"}]
        monkeypatch.setattr(br, "db", db)
        hits = _run(br.search_documents(
            tenant_id="t1", user=_u(role="owner"), query="x", limit=5,
        ))
        assert hits and hits[0]["id"] == "d1"


class TestSearchContext:
    def test_delegates_to_query_context_with_same_args(self, monkeypatch):
        """Verify the wrapper passes tenant_id + user + q + limit
        through to services.ai.brain_context.query_context."""
        from services.ai import brain_retrieval as br
        from services.ai import brain_context as bc
        calls = []
        async def _fake_qc(*, tenant_id, user, q=None, kind=None, tag=None, limit=25):
            calls.append({"tenant_id": tenant_id, "user": user, "q": q,
                          "kind": kind, "tag": tag, "limit": limit})
            return [{"id": "c1", "title": "past decision", "kind": "decision"}]
        monkeypatch.setattr(bc, "query_context", _fake_qc)
        out = _run(br.search_context(
            tenant_id="t7", user=_u(uid="u9"), query="vendor delay", limit=4,
        ))
        assert out and out[0]["id"] == "c1"
        assert calls == [{"tenant_id": "t7", "user": _u(uid="u9"),
                          "q": "vendor delay", "kind": None, "tag": None,
                          "limit": 4}]

    def test_fail_open_on_query_context_error(self, monkeypatch):
        from services.ai import brain_retrieval as br
        from services.ai import brain_context as bc
        async def _boom(**k): raise RuntimeError("mongo down")
        monkeypatch.setattr(bc, "query_context", _boom)
        assert _run(br.search_context(
            tenant_id="t1", user=_u(), query="x"
        )) == []


class TestCitesFromHits:
    def test_shapes_document_hit(self):
        from services.ai.brain_retrieval import cites_from_hits
        cites = cites_from_hits(document_hits=[{
            "id": "d1", "title": "Vendor NDA",
            "kind": "contract", "tags": ["legal"],
            "created_at": "2026-08-01T00:00:00Z",
        }])
        assert cites == [{
            "id": "d1", "title": "Vendor NDA",
            "source_type": "brain_document",
            "kind": "contract", "tags": ["legal"],
            "created_at": "2026-08-01T00:00:00Z",
        }]

    def test_shapes_context_hit(self):
        from services.ai.brain_retrieval import cites_from_hits
        cites = cites_from_hits(context_hits=[{
            "id": "c1", "title": "Approved Sharma order",
            "kind": "decision", "outcome": "approved",
            "tags": ["procurement"],
            "created_at": "2026-08-02T00:00:00Z",
        }])
        assert cites[0]["source_type"] == "brain_context"
        assert cites[0]["outcome"] == "approved"

    def test_merges_both_lists_docs_first(self):
        """Documents first (harder facts), context second (softer signal)."""
        from services.ai.brain_retrieval import cites_from_hits
        cites = cites_from_hits(
            document_hits=[{"id": "d1", "title": "Policy"}],
            context_hits=[{"id": "c1", "title": "Past decision"}],
        )
        assert [c["id"] for c in cites] == ["d1", "c1"]

    def test_missing_title_falls_back_to_filename_then_default(self):
        from services.ai.brain_retrieval import cites_from_hits
        cites = cites_from_hits(document_hits=[
            {"id": "d1", "original_filename": "contract.pdf"},
            {"id": "d2"},
        ])
        assert cites[0]["title"] == "contract.pdf"
        assert cites[1]["title"] == "Document"


# ===========================================================================
# routers/brain — enrichment wiring
# ===========================================================================
class TestAskEnrichment:
    def test_enrich_with_brain_calls_both_stores(self, monkeypatch):
        """/ask's auxiliary pass fires BOTH search_documents +
        search_context and returns them under known keys."""
        from routers import brain as ab
        from services.ai import brain_retrieval as br
        calls = []
        async def _fake_docs(**k):
            calls.append(("docs", k)); return [{"id": "d1", "title": "policy"}]
        async def _fake_ctx(**k):
            calls.append(("ctx", k)); return [{"id": "c1", "title": "past"}]
        monkeypatch.setattr(br, "search_documents", _fake_docs)
        monkeypatch.setattr(br, "search_context", _fake_ctx)
        out = _run(ab._enrich_with_brain(
            plan={"keywords": "vendor delay"},
            scope={"tenant_id": "t1"},
            user=_u(),
        ))
        assert [c[0] for c in calls] == ["docs", "ctx"]
        assert out["document_hits"] == [{"id": "d1", "title": "policy"}]
        assert out["knowledge_hits"] == [{"id": "c1", "title": "past"}]

    def test_enrich_handles_keywords_list(self, monkeypatch):
        """Plans can produce keywords as either string or list."""
        from routers import brain as ab
        from services.ai import brain_retrieval as br
        received = []
        async def _capture(**k):
            received.append(k.get("query"))
            return []
        monkeypatch.setattr(br, "search_documents", _capture)
        monkeypatch.setattr(br, "search_context", _capture)
        _run(ab._enrich_with_brain(
            plan={"keywords": ["vendor", "delay", "urgent"]},
            scope={"tenant_id": "t1"}, user=_u(),
        ))
        # Both calls saw the joined string
        assert received == ["vendor delay urgent", "vendor delay urgent"]

    def test_retrieve_signature_still_backward_compat(self):
        """_tool_mongo_query in brain_router.py calls _retrieve(plan, scope)
        with 2 args — the user param must default to None so that call
        keeps working."""
        from routers import brain as ab
        sig = inspect.signature(ab._retrieve)
        params = sig.parameters
        assert "user" in params
        assert params["user"].default is None

    def test_answer_signature_accepts_hits(self):
        from routers import brain as ab
        sig = inspect.signature(ab._answer)
        assert "knowledge_hits" in sig.parameters
        assert "document_hits" in sig.parameters
        # Both must default to None so any legacy caller (or the
        # empty-Brain path) works unchanged.
        for name in ("knowledge_hits", "document_hits"):
            assert sig.parameters[name].default is None


# ===========================================================================
# routers/brain_router — tools delegate to the shared service
# ===========================================================================
class TestAgentToolsUseSharedService:
    def test_metadata_search_source_calls_shared_service(self):
        from routers import brain_router as ba
        src = inspect.getsource(ba._tool_metadata_search)
        assert "brain_retrieval.search_documents" in src, (
            "S4-04 regression: _tool_metadata_search must delegate "
            "to services.ai.brain_retrieval.search_documents"
        )
        # And the inline Mongo query it used to build must be gone.
        assert "db.brain_documents.find(" not in src, (
            "S4-04 regression: _tool_metadata_search must NOT hit "
            "db.brain_documents directly anymore — go through the "
            "shared service so future embedding upgrades land once"
        )

    def test_knowledge_lookup_source_calls_shared_service(self):
        from routers import brain_router as ba
        src = inspect.getsource(ba._tool_knowledge_lookup)
        assert "brain_retrieval.search_context" in src

    def test_metadata_search_runtime_shape_unchanged(self, monkeypatch):
        """The tool's public dict shape ({tool, query, count, hits})
        must not have drifted — Dex's synthesizer reads these keys."""
        from routers import brain_router as ba
        from services.ai import brain_retrieval as br
        async def _fake(**k):
            return [{"id": "d1", "title": "policy"}]
        monkeypatch.setattr(br, "search_documents", _fake)
        out = _run(ba._tool_metadata_search("refund", _u()))
        assert set(out.keys()) == {"tool", "query", "count", "hits"}
        assert out["tool"] == "metadata_search"
        assert out["query"] == "refund"
        assert out["count"] == 1
        assert out["hits"] == [{"id": "d1", "title": "policy"}]

    def test_knowledge_lookup_runtime_shape_unchanged(self, monkeypatch):
        from routers import brain_router as ba
        from services.ai import brain_retrieval as br
        async def _fake(**k):
            return [{"id": "c1", "title": "past"}]
        monkeypatch.setattr(br, "search_context", _fake)
        out = _run(ba._tool_knowledge_lookup("vendor", _u()))
        assert set(out.keys()) == {"tool", "query", "count", "hits"}
        assert out["tool"] == "knowledge_lookup"
        assert out["count"] == 1


# ===========================================================================
# End-to-end: /ask citation merge + INSUFFICIENT_DATA short-circuit
# ===========================================================================
class TestAskCitationMerge:
    def test_ask_source_extends_sources_with_brain_extras(self):
        """Grep-style guard: the /ask endpoint MUST merge extra_cites
        into the sources list. If someone refactors and forgets, the
        response shape silently regresses."""
        from routers import brain as ab
        src = inspect.getsource(ab.ask)
        # Enrichment call is present.
        assert "_enrich_with_brain(" in src, (
            "S4-04 regression: /ask must call _enrich_with_brain"
        )
        # Merged list is what gets returned.
        assert "merged_cites" in src, (
            "S4-04 regression: /ask must return the merged "
            "domain+Brain citations, not the raw cites list"
        )
        # cites_from_hits is used to shape the Brain rows.
        assert "cites_from_hits(" in src

    def test_insufficient_data_short_circuit_respects_brain_hits(self):
        """The old INSUFFICIENT_DATA branch fired when table was empty.
        Now it must ALSO check that no Brain extras exist — otherwise
        we'd tell the user 'no data' while sources[] has doc + context
        hits."""
        from routers import brain as ab
        src = inspect.getsource(ab.ask)
        # The empty-check now considers extra_cites too.
        assert 'if table["total_rows"] == 0 and not extra_cites' in src, (
            "S4-04 regression: INSUFFICIENT_DATA branch must guard "
            "on extra_cites too, or /ask returns 'no data' while "
            "the Brain has provenance/document matches"
        )

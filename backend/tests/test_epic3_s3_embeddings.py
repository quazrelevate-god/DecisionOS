"""Epic 3 Sprint 3 (E3-09.1): provider-abstracted embedding layer.

Tests the routing/resolution (pure) and the embed_texts contract (mocked provider),
so the OpenAI-now -> Voyage-later swap and the batching/empty-handling behaviour are
verified without a network call.
"""
import asyncio

import config
from config import embed_model_for, EMBED_MODELS
import integrations.embeddings as emb


# --- embed_model_for (routing) ----------------------------------------------
def test_default_is_openai_small():
    assert embed_model_for() == ("openai", "text-embedding-3-small", 1536)


def test_per_task_env_override(monkeypatch):
    monkeypatch.setenv("EMBED_ROUTE_DOCS", "voyage-4")
    assert embed_model_for("docs") == EMBED_MODELS["voyage-4"]


def test_default_swap_to_voyage(monkeypatch):
    # the one-line production swap: EMBED_MODEL=voyage-4
    monkeypatch.setattr(config, "DEFAULT_EMBED_MODEL", "voyage-4")
    assert embed_model_for() == ("voyage", "voyage-4", 1024)


def test_unknown_route_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("EMBED_ROUTE_X", "no-such-model")
    assert embed_model_for("x") == EMBED_MODELS[config.DEFAULT_EMBED_MODEL]


def test_embedding_dim():
    assert emb.embedding_dim() == 1536


# --- _clean (pure) ----------------------------------------------------------
def test_clean_replaces_empties_and_preserves_count():
    out = emb._clean(["hello", "", "  ", None, 42])
    assert len(out) == 5
    assert out[0] == "hello" and out[1] == " " and out[2] == " " and out[3] == " " and out[4] == "42"


# --- embed_texts contract (mocked provider) ---------------------------------
def test_embed_texts_shape_and_order(monkeypatch):
    async def fake_openai(texts, model_id):
        return [[float(i)] * 4 for i, _ in enumerate(texts)]

    async def _noop_record(**k):
        return None

    monkeypatch.setattr(emb, "_openai_embed", fake_openai)
    monkeypatch.setattr(emb, "record_ai_call", _noop_record)

    vecs = asyncio.run(emb.embed_texts(["a", "b", "c"]))
    assert len(vecs) == 3 and all(len(v) == 4 for v in vecs)
    assert vecs[0][0] == 0.0 and vecs[2][0] == 2.0  # order preserved


def test_embed_texts_empty_input():
    assert asyncio.run(emb.embed_texts([])) == []


def test_embed_texts_records_telemetry(monkeypatch):
    recorded = {}

    async def fake_openai(texts, model_id):
        return [[0.1] * 4 for _ in texts]

    async def _capture(**k):
        recorded.update(k)

    monkeypatch.setattr(emb, "_openai_embed", fake_openai)
    monkeypatch.setattr(emb, "record_ai_call", _capture)

    asyncio.run(emb.embed_texts(["hi"], task="chunk"))
    assert recorded["task"] == "embed.chunk" and recorded["engine"] == "openai"
    assert recorded["ok"] is True and recorded["model"] == "text-embedding-3-small"


def test_embed_texts_records_failure(monkeypatch):
    recorded = {}

    async def boom(texts, model_id):
        raise RuntimeError("provider down")

    async def _capture(**k):
        recorded.update(k)

    monkeypatch.setattr(emb, "_openai_embed", boom)
    monkeypatch.setattr(emb, "record_ai_call", _capture)

    try:
        asyncio.run(emb.embed_texts(["hi"]))
        assert False, "should have raised"
    except RuntimeError:
        pass
    assert recorded["ok"] is False  # failure telemetry recorded before re-raise

"""Provider-abstracted embedding layer (Epic 3 Sprint 3 -- E3-09.1).

The embeddings equivalent of the LLM routing (config.model_for): one entry point,
``embed_texts``, that resolves the configured embedding model, calls the right
provider, and records per-call telemetry. The provider is abstracted so that
OpenAI (used now to build + test the RAG workflow) -> Voyage voyage-4 (the
production target, once VOYAGE_API_KEY is set) is a config/env swap, not a code
change. There is no native Claude embedding; Voyage is Anthropic's recommendation.

* ``embed_texts(texts, input_type=...)`` -> list of vectors (same order).
* ``embed_query(text)`` -> a single vector (input_type='query').

input_type ('document' | 'query') is used by Voyage to improve retrieval; OpenAI
is symmetric and ignores it. Both providers batch, so a whole document's chunks
embed in a few calls. Never silently drops inputs -- empty strings are replaced
with a space (the APIs reject empty input) so vector count always matches input count.
"""
from __future__ import annotations

import asyncio
import os
import time
import logging

from config import embed_model_for
from core.ai_keys import get_ai_key
from core.usage import record_ai_call, _ctx_tenant, _est_tokens

logger = logging.getLogger("decisionos")

EMBED_TIMEOUT = int(os.environ.get("EMBED_TIMEOUT_SECONDS", "45") or 45)
_OPENAI_BATCH = 256   # OpenAI allows up to 2048 inputs/call; keep batches modest
_VOYAGE_BATCH = 128   # Voyage's per-request input cap


def _clean(texts: list) -> list:
    """Coerce to str and replace empty/whitespace with a single space (embedding APIs
    reject empty input), so the returned vector count always matches the input count."""
    out = []
    for t in texts:
        s = t if isinstance(t, str) else ("" if t is None else str(t))
        out.append(s if s.strip() else " ")
    return out


async def embed_texts(texts, *, input_type: str = "document", task: str = "default",
                      tenant_id=None) -> list:
    """Embed a list of texts -> list of vectors (same order + count). Routed provider,
    batched, timed, and telemetered (task='embed.<task>'). Raises on provider/config error."""
    if not texts:
        return []
    provider, model_id, _dim = embed_model_for(task)
    cleaned = _clean(list(texts))
    tid = tenant_id or _ctx_tenant.get()
    t0 = time.perf_counter()
    try:
        if provider == "openai":
            vectors = await _openai_embed(cleaned, model_id)
        elif provider == "voyage":
            vectors = await _voyage_embed(cleaned, model_id, input_type)
        else:
            raise RuntimeError(f"unknown embedding provider: {provider!r}")
    except Exception as e:
        await record_ai_call(task=f"embed.{task}", model=model_id, engine=provider,
                             tokens_in=sum(_est_tokens(t) for t in cleaned),
                             latency_ms=(time.perf_counter() - t0) * 1000, ok=False, error=e,
                             tenant_id=tid)
        raise
    await record_ai_call(task=f"embed.{task}", model=model_id, engine=provider,
                         tokens_in=sum(_est_tokens(t) for t in cleaned), tokens_out=0,
                         latency_ms=(time.perf_counter() - t0) * 1000, ok=True, tenant_id=tid)
    return vectors


async def embed_query(text, *, task: str = "default", tenant_id=None) -> list:
    """Embed a single query string -> one vector (input_type='query')."""
    v = await embed_texts([text], input_type="query", task=task, tenant_id=tenant_id)
    return v[0] if v else []


def embedding_dim(task: str = "default") -> int:
    """The vector dimension of the routed embedding model (for sizing the vector store)."""
    return embed_model_for(task)[2]


# --- providers --------------------------------------------------------------
async def _openai_embed(texts: list, model_id: str) -> list:
    from openai import AsyncOpenAI
    key = get_ai_key("openai")
    if not key:
        raise RuntimeError("no OpenAI API key configured for embeddings")
    client = AsyncOpenAI(api_key=key)
    out: list = []
    for i in range(0, len(texts), _OPENAI_BATCH):
        batch = texts[i:i + _OPENAI_BATCH]
        resp = await asyncio.wait_for(
            client.embeddings.create(model=model_id, input=batch), timeout=EMBED_TIMEOUT)
        out.extend(d.embedding for d in resp.data)  # SDK preserves input order
    return out


async def _voyage_embed(texts: list, model_id: str, input_type: str) -> list:
    """Voyage via HTTP (no extra SDK dependency). Dormant until VOYAGE_API_KEY is set."""
    import requests
    key = get_ai_key("voyage")
    if not key:
        raise RuntimeError("no Voyage API key configured for embeddings")

    def _call(batch):
        r = requests.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"input": batch, "model": model_id, "input_type": input_type},
            timeout=EMBED_TIMEOUT)
        r.raise_for_status()
        data = r.json().get("data", [])
        # sort by index so output order matches input order regardless of API ordering
        return [d["embedding"] for d in sorted(data, key=lambda x: x.get("index", 0))]

    out: list = []
    for i in range(0, len(texts), _VOYAGE_BATCH):
        batch = texts[i:i + _VOYAGE_BATCH]
        out.extend(await asyncio.wait_for(asyncio.to_thread(_call, batch), timeout=EMBED_TIMEOUT + 5))
    return out

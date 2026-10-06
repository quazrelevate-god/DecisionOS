"""Embed-at-ingest for the Company Brain (Epic 3 Sprint 3 -- E3-09.3; rebuilt 2026-10-05).

When a document lands in brain_documents its body text is read, chunked, embedded
and stored so Ask can find the passage that answers a question.

WHERE THE INDEX LIVES (2026-10-05, AI audit). It used to be Qdrant only, and with no
QDRANT_URL set the client silently ran IN MEMORY: every deploy wiped the index, and
each of the two uvicorn workers kept its own copy (a document indexed by one was
invisible to the other). Now one choice, made here (`store_kind`):

  qdrant  QDRANT_URL is set           -- the production vector DB (locked design);
                                          one collection PER EMBEDDING MODEL, so a
                                          model swap can never mix dimensions.
  mongo   no QDRANT_URL               -- durable and shared by every worker: chunks
                                          (text + float32 vector) in db.brain_chunks,
                                          searched by cosine in-process. Right-sized for
                                          an SME's documents; Qdrant takes over at scale.
  memory  BRAIN_VECTOR_STORE=memory   -- tests only (tests/conftest.py sets it).

Every indexed document records WHAT built its index (`index.key` = store + model),
so `backfill_documents` (run at startup) re-indexes exactly the documents that are
missing or were built for another store/model -- nothing is ever silently stale.

What the index does NOT decide: who may read a passage and whether its document
still exists. search_chunks checks both against the LIVE brain_documents row, so a
visibility edit needs no re-embedding and a deleted document is never cited.

Embedding sends the document's text to the embedding provider, so it waits for the
company's AI consent (DPDP): no consent -> the document stays keyword-searchable
and is indexed by the next backfill after consent is given.
"""
from __future__ import annotations

import logging
import os
import re
from collections import OrderedDict

from core import db, now_iso
from config import embed_model_for
from integrations.embeddings import embed_texts, embedding_dim
from integrations import qdrant

logger = logging.getLogger("decisionos")

# 2026-10-05 — chunks follow the document's SECTIONS, up to ~300 tokens. With
# 2400-char windows a short policy was ONE chunk covering leave, payment terms,
# inspection and safety: a question about any one of them matched it at
# 0.36-0.38 (text-embedding-3-small) against 0.61-0.71 for its own section,
# under the relevance floor -- the right document, unfindable.
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
MIN_SECTION = 150      # a real section stands alone; a smaller fragment joins its neighbour
_HEADING = re.compile(
    r"^\s*(?:\d+(?:\.\d+)*[.)]?\s+\S.{0,80}|#{1,6}\s+\S.{0,80}|[A-Z][A-Z0-9 &/,'()-]{2,60}:?)\s*$")
RAG_MAX_CHARS = 60000  # how much of a document body we read for RAG (vs 6000 for voice attachments)
CHUNKS = "brain_chunks"          # Mongo store: one row per chunk
META = "brain_index_meta"        # Mongo store: per-tenant write counter (search cache key)


def _window(text: str, size: int, overlap: int) -> list:
    """Fixed windows with overlap, preferring a paragraph/sentence boundary near each
    window's end. Used for unstructured text and for sections longer than `size`."""
    if len(text) <= size:
        return [text]
    overlap = max(0, min(overlap, size - 1))
    chunks, start, n = [], 0, len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            window = text[start:end]
            brk = max(window.rfind("\n\n"), window.rfind(". "), window.rfind("\n"))
            if brk > size * 0.5:                 # only honour a boundary well into the window
                end = start + brk + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)    # guaranteed forward progress
    return chunks


def _units(text: str) -> list:
    """(text, starts_with_heading) units: paragraphs, each heading glued to what follows."""
    blocks, cur = [], []
    for line in text.split("\n"):
        if not line.strip():
            if cur:
                blocks.append(("\n".join(cur), False))
                cur = []
        elif len(line.strip()) <= 90 and _HEADING.match(line):
            if cur:
                blocks.append(("\n".join(cur), False))
                cur = []
            blocks.append((line.strip(), True))
        else:
            cur.append(line)
    if cur:
        blocks.append(("\n".join(cur), False))
    units, pending = [], ""
    for body, is_heading in blocks:
        if is_heading:
            pending = (pending + "\n" + body).strip()
            continue
        units.append(((pending + "\n" + body).strip() if pending else body.strip(), bool(pending)))
        pending = ""
    if pending:
        units.append((pending, True))
    return [u for u in units if u[0]]


def chunk_text(text, *, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    """Split text into chunks along its sections: a heading and its text form one unit,
    a unit that is a real section (>= MIN_SECTION chars) starts a new chunk, small
    fragments join their neighbour, and anything longer than `size` is windowed with
    overlap. Text with no structure is windowed as before. Pure; non-empty chunks."""
    text = (text or "").strip()
    if not text:
        return []
    units = _units(text)
    if len(units) <= 1:
        return _window(text, size, overlap)
    chunks, cur = [], ""
    for body, headed in units:
        if len(body) > size:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.extend(_window(body, size, overlap))
            continue
        starts_section = headed and len(body) >= MIN_SECTION and len(cur) >= MIN_SECTION
        if cur and (len(cur) + 2 + len(body) > size or starts_section):
            chunks.append(cur)
            cur = body
        else:
            cur = (cur + "\n\n" + body) if cur else body
    if cur:
        chunks.append(cur)
    return [c.strip() for c in chunks if c.strip()]


def _doc_payload(doc: dict) -> dict:
    """The document's RBAC + display fields carried onto every chunk. Retrieval re-checks
    them against the LIVE document (search_chunks); these are a fallback only."""
    return {
        "visibility": doc.get("visibility") or "public",
        "department": doc.get("department") or "",
        "roles_allowed": doc.get("roles_allowed") or [],
        "uploaded_by": doc.get("uploaded_by") or "",
        "title": doc.get("title") or doc.get("original_filename") or "",
    }


# --- where the index lives ----------------------------------------------------
def store_kind() -> str:
    forced = (os.environ.get("BRAIN_VECTOR_STORE") or "").strip().lower()
    if forced in ("memory", "mongo", "qdrant"):
        return forced
    return "qdrant" if os.environ.get("QDRANT_URL", "").strip() else "mongo"


CHUNKER_VERSION = "sections-1"   # bump when chunking changes: every document re-chunks on the next backfill


def index_key() -> str:
    """What builds an index today: store + embedding model + dimension + chunker."""
    provider, model_id, dim = embed_model_for("brain_doc")
    return f"{store_kind()}:{provider}:{model_id}:{dim}:{CHUNKER_VERSION}"


def _collection() -> str:
    _p, model_id, dim = embed_model_for("brain_doc")
    return f"{qdrant.COLLECTION}_{re.sub(r'[^a-z0-9]+', '_', model_id.lower())}_{dim}"


async def _clear(tenant_id: str, doc_id: str) -> None:
    kind = store_kind()
    if kind == "mongo":
        await db[CHUNKS].delete_many({"tenant_id": tenant_id, "doc_id": doc_id})
        await _bump(tenant_id)
    else:
        name = _collection() if kind == "qdrant" else None
        try:
            if await qdrant.get_client().collection_exists(name or qdrant.COLLECTION):
                await qdrant.delete_by_doc(tenant_id, doc_id, collection=name)
        except Exception as e:
            logger.warning(f"brain_embed: clear failed for {doc_id}: {e}")


async def _bump(tenant_id: str) -> None:
    await db[META].update_one({"tenant_id": tenant_id}, {"$inc": {"version": 1}}, upsert=True)


async def _write(tenant_id: str, doc_id: str, chunks: list) -> int:
    kind = store_kind()
    if kind == "mongo":
        import numpy as np
        from bson.binary import Binary
        await _ensure_mongo_indexes()
        key = index_key()
        await db[CHUNKS].delete_many({"tenant_id": tenant_id, "doc_id": doc_id})
        rows = [{"id": qdrant._point_id(tenant_id, doc_id, c["chunk_idx"]), "tenant_id": tenant_id,
                 "doc_id": doc_id, "chunk_idx": c["chunk_idx"], "text": c["text"], "key": key,
                 "vec": Binary(np.asarray(c["embedding"], dtype=np.float32).tobytes()),
                 "created_at": now_iso()} for c in chunks]
        if rows:
            await db[CHUNKS].insert_many(rows)
        await _bump(tenant_id)
        return len(rows)
    name = _collection() if kind == "qdrant" else None
    await qdrant.ensure_collection(embedding_dim(), collection=name)
    await qdrant.delete_by_doc(tenant_id, doc_id, collection=name)
    return await qdrant.upsert_chunks(tenant_id, doc_id, chunks, collection=name)


# Mongo store search cache: (tenant, key) -> (version, metadata rows, unit-normalised matrix).
_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
_CACHE_MAX = 32


async def _mongo_search(tenant_id: str, vec, k: int) -> list:
    import numpy as np
    key = index_key()
    meta = await db[META].find_one({"tenant_id": tenant_id}, {"_id": 0, "version": 1})
    version = (meta or {}).get("version", 0)
    hit = _CACHE.get((tenant_id, key))
    if not hit or hit[0] != version:
        rows, mats = [], []
        async for r in db[CHUNKS].find({"tenant_id": tenant_id, "key": key},
                                       {"_id": 0, "doc_id": 1, "chunk_idx": 1, "text": 1, "vec": 1}):
            v = np.frombuffer(bytes(r.pop("vec")), dtype=np.float32)
            n = float(np.linalg.norm(v)) or 1.0
            mats.append(v / n)
            rows.append(r)
        matrix = np.vstack(mats) if mats else np.zeros((0, 1), dtype=np.float32)
        hit = (version, rows, matrix)
        _CACHE[(tenant_id, key)] = hit
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)
    _version, rows, matrix = hit
    _CACHE.move_to_end((tenant_id, key))
    if not rows:
        return []
    q = np.asarray(vec, dtype=np.float32)
    q = q / (float(np.linalg.norm(q)) or 1.0)
    scores = matrix @ q
    top = np.argsort(-scores)[:k]
    return [{"score": float(scores[i]), "tenant_id": tenant_id, **rows[i]} for i in top]


async def has_chunks(tenant_id: str) -> bool:
    """Does this company have anything indexed at all? Checked before a question is
    embedded: most companies have no documents, and each embedding is a paid call
    that sends the question to the provider."""
    if not tenant_id:
        return False
    kind = store_kind()
    try:
        if kind == "mongo":
            return await db[CHUNKS].find_one({"tenant_id": tenant_id, "key": index_key()}, {"_id": 1}) is not None
        name = _collection() if kind == "qdrant" else qdrant.COLLECTION
        if not await qdrant.get_client().collection_exists(name):
            return False
        return await qdrant.count(tenant_id, collection=name) > 0
    except Exception as e:
        logger.debug(f"brain_embed: has_chunks failed for {tenant_id}: {e}")
        return False


_INDEXES_READY = False


async def _ensure_mongo_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    try:
        await db[CHUNKS].create_index([("tenant_id", 1), ("key", 1)], name="brain_chunks_tenant_key")
        await db[CHUNKS].create_index([("tenant_id", 1), ("doc_id", 1)], name="brain_chunks_tenant_doc")
        await db[META].create_index([("tenant_id", 1)], name="brain_index_meta_tenant", unique=True)
        _INDEXES_READY = True
    except Exception as e:
        logger.debug(f"brain_embed: index creation: {e}")


async def search_vectors(tenant_id: str, vec, k: int = 30) -> list:
    """Top-k chunks of ONE tenant by cosine similarity, from whichever store is in use.
    Returns [{score, doc_id, chunk_idx, text, ...}]; the caller re-checks access."""
    if not tenant_id or not vec:
        return []
    kind = store_kind()
    if kind == "mongo":
        return await _mongo_search(tenant_id, vec, k)
    name = _collection() if kind == "qdrant" else None
    if not await qdrant.get_client().collection_exists(name or qdrant.COLLECTION):
        return []
    return await qdrant.search(tenant_id, vec, k=k, collection=name)


# --- indexing -------------------------------------------------------------------
async def _mark(doc: dict, state: str, *, chunks: int = 0, note: str = "") -> None:
    try:
        await db.brain_documents.update_one(
            {"id": doc["id"], "tenant_id": doc["tenant_id"]},
            {"$set": {"index": {"state": state, "chunks": chunks, "key": index_key(),
                                "note": note[:200], "at": now_iso()}}})
    except Exception as e:
        logger.debug(f"brain_embed: index mark failed for {doc.get('id')}: {e}")


async def _consented(tenant_id: str) -> bool:
    from services.ai_consent import has_active_consent
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "ai_consent": 1})
    return has_active_consent(t)


async def index_document(doc: dict) -> int:
    """Extract, chunk, embed and (re)index one brain_documents record. Idempotent: replaces
    the doc's existing chunks. Returns chunk count. Never raises -- indexing must not break
    the upload; failures are recorded on the document (`index.state`) and logged."""
    tenant_id, doc_id = doc.get("tenant_id"), doc.get("id")
    if not tenant_id or not doc_id:
        return 0
    try:
        if not await _consented(tenant_id):
            await _mark(doc, "waiting_for_ai_consent", note="AI is off for this company")
            return 0
        from services.files import _read_reference_text
        text = await _read_reference_text(doc, tenant_id, max_chars=RAG_MAX_CHARS)
        pieces = chunk_text(text)
        if not pieces:
            await _clear(tenant_id, doc_id)
            await _mark(doc, "no_text", note="No readable text in this file")
            logger.info(f"brain_embed: no body text for doc {doc_id}; keyword-only")
            return 0
        vectors = await embed_texts(pieces, input_type="document", task="brain_doc", tenant_id=tenant_id)
        # Deleted while we were reading/embedding (a slow OCR can outlast a delete):
        # write nothing -- the chunks would outlive their document.
        live = await db.brain_documents.find_one(
            {"id": doc_id, "tenant_id": tenant_id, "is_deleted": {"$ne": True}}, {"_id": 0, "id": 1})
        if not live:
            await _clear(tenant_id, doc_id)
            return 0
        payload = _doc_payload(doc)
        chunks = [{"chunk_idx": i, "text": p, "embedding": v, "payload": payload,
                   "visibility": payload["visibility"], "tags": doc.get("tags") or []}
                  for i, (p, v) in enumerate(zip(pieces, vectors))]
        n = await _write(tenant_id, doc_id, chunks)
        await _mark(doc, "indexed", chunks=n)
        logger.info(f"brain_embed: indexed doc {doc_id} -> {n} chunks ({store_kind()})")
        return n
    except Exception as e:  # never break the caller
        logger.warning(f"brain_embed: index_document failed for {doc_id}: {e}")
        await _mark(doc, "failed", note=str(e))
        return 0


async def deindex_document(tenant_id: str, doc_id: str) -> None:
    """Remove a document's chunks (on delete). Never raises."""
    try:
        await _clear(tenant_id, doc_id)
    except Exception as e:
        logger.warning(f"brain_embed: deindex failed for {doc_id}: {e}")


# --- Company Brain NOTES (2026-10-06) ------------------------------------------
# Notes live in db.memory and are indexed beside documents under the id
# "note:<id>", so a question finds a note by meaning, not only by its exact
# words. Who may read one is decided at search time from the LIVE note
# (services/record_access.memory_scope), exactly as for documents.
NOTE_PREFIX = "note:"


async def _mark_note(note: dict, state: str, *, chunks: int = 0, note_text: str = "") -> None:
    try:
        await db.memory.update_one(
            {"id": note["id"], "tenant_id": note["tenant_id"]},
            {"$set": {"index": {"state": state, "chunks": chunks, "key": index_key(),
                                "note": note_text[:200], "at": now_iso()}}})
    except Exception as e:
        logger.debug(f"brain_embed: note mark failed for {note.get('id')}: {e}")


async def index_note(note: dict) -> int:
    """Embed one Company Brain note. Same rules as documents: AI consent first,
    nothing written if the note was deleted meanwhile, never raises."""
    tenant_id, nid = note.get("tenant_id"), note.get("id")
    text = (note.get("text") or "").strip()
    if not tenant_id or not nid:
        return 0
    vid = NOTE_PREFIX + nid
    try:
        if not await _consented(tenant_id):
            await _mark_note(note, "waiting_for_ai_consent", note_text="AI is off for this company")
            return 0
        pieces = chunk_text(text)
        if not pieces:
            await _clear(tenant_id, vid)
            return 0
        vectors = await embed_texts(pieces, input_type="document", task="brain_doc", tenant_id=tenant_id)
        if not await db.memory.find_one({"id": nid, "tenant_id": tenant_id}, {"_id": 0, "id": 1}):
            await _clear(tenant_id, vid)
            return 0
        payload = {"source": "note", "title": text[:80], "visibility": note.get("visibility") or "public"}
        chunks = [{"chunk_idx": i, "text": p, "embedding": v, "payload": payload,
                   "visibility": payload["visibility"], "tags": [note.get("tag") or "note"]}
                  for i, (p, v) in enumerate(zip(pieces, vectors))]
        n = await _write(tenant_id, vid, chunks)
        await _mark_note(note, "indexed", chunks=n)
        return n
    except Exception as e:
        logger.warning(f"brain_embed: index_note failed for {nid}: {e}")
        await _mark_note(note, "failed", note_text=str(e))
        return 0


async def deindex_note(tenant_id: str, note_id: str) -> None:
    try:
        await _clear(tenant_id, NOTE_PREFIX + note_id)
    except Exception as e:
        logger.warning(f"brain_embed: note deindex failed for {note_id}: {e}")


def spawn(coro) -> None:
    """Run an index job in the background (callers are request handlers / captures)."""
    import asyncio
    try:
        t = asyncio.get_running_loop().create_task(coro)
        _BG.add(t)
        t.add_done_callback(_BG.discard)
    except RuntimeError:
        coro.close()


_BG: set = set()


async def purge_tenant(tenant_id: str) -> None:
    """Erase a company's whole index, wherever it lives (tenant deletion / DPDP)."""
    if not tenant_id:
        return
    try:
        await db[CHUNKS].delete_many({"tenant_id": tenant_id})
        await db[META].delete_many({"tenant_id": tenant_id})
    except Exception as e:
        logger.warning(f"brain_embed: purge (mongo) failed for {tenant_id}: {e}")
    if store_kind() in ("qdrant", "memory"):
        try:
            for name in await qdrant.list_collections():
                if name.startswith(qdrant.COLLECTION):
                    await qdrant.delete_by_tenant(tenant_id, collection=name)
        except Exception as e:
            logger.warning(f"brain_embed: purge (qdrant) failed for {tenant_id}: {e}")


async def backfill_documents(tenant_id=None, limit: int = 5000, *, only_stale: bool = True) -> dict:
    """Index existing (non-deleted) brain_documents. With only_stale (the default) only the
    ones whose index is missing or was built by another store/model -- so it is cheap to
    run at every startup. The in-memory store never survives a restart, so it re-indexes
    everything. Companies without AI consent are skipped. Returns {docs, chunks}."""
    q: dict = {"is_deleted": {"$ne": True}}
    if tenant_id:
        q["tenant_id"] = tenant_id
    if only_stale and store_kind() != "memory":
        q["index.key"] = {"$ne": index_key()}
    docs = await db.brain_documents.find(q, {"_id": 0}).to_list(limit)
    consent: dict = {}
    total_docs = total_chunks = 0
    for doc in docs:
        tid = doc.get("tenant_id")
        if tid not in consent:
            consent[tid] = await _consented(tid)
        if not consent[tid]:
            continue
        total_docs += 1
        total_chunks += await index_document(doc)
    # Company Brain notes, the same way (2026-10-06).
    nq: dict = {"text": {"$nin": [None, ""]}}
    if tenant_id:
        nq["tenant_id"] = tenant_id
    if only_stale and store_kind() != "memory":
        nq["index.key"] = {"$ne": index_key()}
    for note in await db.memory.find(nq, {"_id": 0}).to_list(limit):
        tid = note.get("tenant_id")
        if tid not in consent:
            consent[tid] = await _consented(tid)
        if not consent[tid]:
            continue
        total_docs += 1
        total_chunks += await index_note(note)
    if total_docs:
        logger.info(f"brain_embed: backfill indexed {total_docs} docs -> {total_chunks} chunks ({store_kind()})")
    return {"docs": total_docs, "chunks": total_chunks}


async def startup_backfill() -> None:
    """Run once at boot (bootstrap/lifecycle): bring every document's index up to the
    current store/model. Logs where the index lives, so 'in memory' is never silent."""
    kind = store_kind()
    if kind == "memory":
        logger.warning("Company Brain index is IN MEMORY (BRAIN_VECTOR_STORE=memory): it is lost on restart.")
    else:
        logger.info(f"Company Brain index store: {kind} ({index_key()})")
    # Production runs several workers; each would backfill (and pay to embed) every
    # document. One leader does it. The in-memory store is per-process: no lock.
    holder = None
    try:
        if kind != "memory":
            from services.leader_lock import try_acquire, make_holder_id
            holder = make_holder_id("brain-backfill")
            if not await try_acquire(db, "brain_backfill", holder, lease_seconds=1800):
                logger.info("Company Brain backfill: another worker is doing it.")
                return
        await backfill_documents()
    except Exception as e:
        logger.warning(f"brain_embed: startup backfill failed: {e}")
    finally:
        if holder:
            try:
                from services.leader_lock import release
                await release(db, "brain_backfill", holder)
            except Exception:
                pass

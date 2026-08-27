"""Unified file upload/download layer — all persistent files go to
object storage; local disk is a temp workspace only.

Introduced by FIX-002-E to close the SaaS-readiness P0 (SCALE-3): six
upload paths (voice notes, dictation, meetings, WhatsApp ingest,
WhatsApp voice, ledger bills) all wrote to a flat local UPLOAD_DIR
with no tenant prefix. That means:
  - Files were lost on every container restart (Emergent's disk is ephemeral)
  - Files never appeared on other replicas (per-process disk)
  - Anyone who guessed a UUID filename could download any tenant's file
    via the unauth `/api/files/{fname}` endpoint

This module provides:
  store_upload(tenant_id, category, data, ext, content_type=None)
      Persists file to obj_store with a tenant-prefixed key:
      "decisionos/{tenant_id}/{category}/{uuid}.{ext}"
      Returns a dict with storage_path + size.

  read_upload(storage_path) -> (bytes, content_type)
      Fetches from obj_store. Falls back to local disk if the path
      looks like a legacy UPLOAD_DIR entry (during the migration
      window; disappears once migrate_local_disk_uploads_to_obj_store
      runs).

  download_to_temp(storage_path) -> Path
      Materializes an obj_store object into a local temp file and
      returns the path. Used by consumers (Whisper/Sarvam STT, Gemini
      OCR) that need a filesystem path. Caller is responsible for
      cleanup — a `with tempfile.TemporaryDirectory():` around the call
      site is the idiomatic pattern.

  delete_upload(storage_path) -> bool
      Best-effort delete from obj_store (or local disk for legacy).
      Never raises. Returns True if gone (or already gone).

  is_legacy_path(storage_path) -> bool
      True if the path looks like a bare local filename (pre-migration
      shape). False for the new decisionos/... form. Callers rarely
      need this; the read/delete helpers handle it transparently.

Storage-path shape (post-migration):
    decisionos/{tenant_id}/{category}/{file_id}.{ext}

Categories (organizational, not enforced):
    voice-notes  — user voice captures
    meetings     — meeting recordings
    ingestions   — inbound documents (email/WhatsApp/upload)
    ledger       — finance bill/receipt uploads
    task-files   — task attachments (already migrated via _store_file)
"""
import asyncio
import os
import tempfile
from pathlib import Path
from typing import Optional, Tuple

from core import logger, new_id
from services import obj_store


async def awrite_bytes(path, data: bytes) -> None:
    """Write bytes to a local path off the event loop (S9 -- U8-09.3).

    Upload paths staged data to a temp file with a synchronous
    ``open(...).write(...)`` inside async handlers, blocking the loop for the
    duration of the disk write. Offloading to a thread keeps concurrent uploads
    from serializing on each other's I/O.
    """
    await asyncio.to_thread(Path(path).write_bytes, data)


# Legacy local-disk directory — kept as a read-only fallback during the
# migration window. Once migrate_local_disk_uploads_to_obj_store_v1 has
# rewritten every reference, nothing new should be written here.
LEGACY_UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"


def _mime_for_ext(ext: str, override: Optional[str] = None) -> str:
    """Prefer an explicit content_type; fall back to obj_store's guesser."""
    if override:
        return override
    return obj_store.guess_mime(f"x.{ext}")


def build_key(tenant_id: str, category: str, file_id: str, ext: str) -> str:
    """The canonical obj_store key format. Exposed so callers/tests can
    predict what path a store_upload will produce."""
    ext_clean = (ext or "bin").lstrip(".").lower()
    return f"{obj_store.APP_NAME}/{tenant_id}/{category}/{file_id}.{ext_clean}"


async def store_upload(tenant_id: str, category: str, data: bytes,
                       ext: str, *, content_type: Optional[str] = None,
                       file_id: Optional[str] = None) -> dict:
    """Persist bytes to obj_store under a tenant-prefixed key.
    Returns {storage_path, size, content_type, file_id, category}.
    Raises whatever obj_store.put_object raises (network / auth errors)."""
    if not tenant_id:
        raise ValueError("store_upload requires tenant_id")
    fid = file_id or new_id()
    key = build_key(tenant_id, category, fid, ext)
    ctype = _mime_for_ext(ext, content_type)
    result = await obj_store.put_object(key, data, ctype)
    return {
        "storage_path": result.get("path", key),
        "size": result.get("size", len(data)),
        "content_type": ctype,
        "file_id": fid,
        "category": category,
    }


def is_legacy_path(storage_path: str) -> bool:
    """A legacy path is a bare filename (no obj_store prefix) that was
    written to LEGACY_UPLOAD_DIR before FIX-002-E."""
    if not storage_path:
        return False
    # obj_store paths always start with the APP_NAME prefix + "/"
    if storage_path.startswith(f"{obj_store.APP_NAME}/"):
        return False
    # Legacy paths could be absolute local paths OR bare filenames
    return True


async def read_upload(storage_path: str) -> Tuple[bytes, str]:
    """Fetch bytes for a stored file. Handles both new (obj_store) and
    legacy (local disk) paths transparently."""
    if not storage_path:
        raise FileNotFoundError("empty storage_path")

    if is_legacy_path(storage_path):
        # Legacy: bare filename OR an absolute local path from an old write.
        p = Path(storage_path)
        if not p.is_absolute():
            p = LEGACY_UPLOAD_DIR / storage_path
        if not p.exists():
            raise FileNotFoundError(f"legacy upload missing on disk: {p}")
        data = p.read_bytes()
        ctype = obj_store.guess_mime(p.name)
        return data, ctype

    # New: obj_store key
    return await obj_store.get_object(storage_path)


async def download_to_temp(storage_path: str,
                           *, suffix: Optional[str] = None) -> Path:
    """Download an object to a fresh temp file, return its Path. Suffix
    defaults to the extension of the storage_path. Caller must delete
    the returned file (idiomatically via a temp-dir context manager)."""
    data, _ctype = await read_upload(storage_path)
    inferred_suffix = suffix
    if inferred_suffix is None:
        p = Path(storage_path)
        inferred_suffix = p.suffix or ".bin"
    fd, tmp_path = tempfile.mkstemp(suffix=inferred_suffix)
    os.close(fd)  # we write via awrite_bytes (off-thread), not this fd
    try:
        await awrite_bytes(tmp_path, data)
    except Exception:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise
    return Path(tmp_path)


async def delete_upload(storage_path: str) -> bool:
    """Best-effort delete. Never raises. Returns True if gone (or
    already absent), False if the deletion failed."""
    if not storage_path:
        return True
    try:
        if is_legacy_path(storage_path):
            p = Path(storage_path)
            if not p.is_absolute():
                p = LEGACY_UPLOAD_DIR / storage_path
            try:
                p.unlink()
            except FileNotFoundError:
                return True
            except Exception as e:
                logger.warning(f"delete_upload(legacy) failed for {p}: {e}")
                return False
            return True
        # obj_store path
        return await obj_store.delete_object(storage_path)
    except Exception as e:
        logger.warning(f"delete_upload({storage_path!r}) failed: {e}")
        return False

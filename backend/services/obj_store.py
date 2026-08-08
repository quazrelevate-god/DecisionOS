"""Emergent Object Storage helpers — persistent file storage (survives redeploys).
Uses EMERGENT_LLM_KEY. Files are addressed by a UUID path; DB is the source of truth."""
import os
import asyncio
import httpx
from core import logger

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "decisionos"

_storage_key = None
_lock = asyncio.Lock()

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif",
    "webp": "image/webp", "heic": "image/heic", "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv", "txt": "text/plain",
}


def guess_mime(filename: str) -> str:
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    return MIME_TYPES.get(ext, "application/octet-stream")


async def init_storage(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    async with _lock:
        if _storage_key and not force:
            return _storage_key
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY})
            r.raise_for_status()
            _storage_key = r.json()["storage_key"]
        logger.info("Object storage initialized.")
        return _storage_key


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = await init_storage()
    async with httpx.AsyncClient(timeout=120) as c:
        headers = {"X-Storage-Key": key, "Content-Type": content_type or "application/octet-stream"}
        r = await c.put(f"{STORAGE_URL}/objects/{path}", headers=headers, content=data)
        if r.status_code == 403:  # storage key expired -> refresh once
            key = await init_storage(force=True)
            headers["X-Storage-Key"] = key
            r = await c.put(f"{STORAGE_URL}/objects/{path}", headers=headers, content=data)
        r.raise_for_status()
        return r.json()


async def get_object(path: str):
    key = await init_storage()
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
        if r.status_code == 403:
            key = await init_storage(force=True)
            r = await c.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
        r.raise_for_status()
        return r.content, r.headers.get("Content-Type", "application/octet-stream")


async def delete_object(path: str) -> bool:
    """Delete an object from storage. Returns True if deleted or already
    absent, False if the deletion failed. Never raises — deletion is
    best-effort so a single missing/failed file cannot block tenant
    deletion (GDPR/DPDP compliance requires the DB rows go regardless).

    Added by FIX-001-E so `admin_delete_tenant` can wipe all uploaded
    files alongside the DB records — previously files lingered forever
    in the shared bucket after a tenant was deleted.
    """
    if not path:
        return True
    try:
        key = await init_storage()
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.delete(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
            if r.status_code == 403:  # storage key expired -> refresh once
                key = await init_storage(force=True)
                r = await c.delete(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key})
            # 200/204 = deleted; 404 = already gone (both are success from a
            # "make sure it's gone" perspective).
            if r.status_code in (200, 204, 404):
                return True
            logger.warning(f"obj_store.delete_object({path}) returned HTTP {r.status_code}")
            return False
    except Exception as e:
        logger.warning(f"obj_store.delete_object({path}) failed: {e}")
        return False

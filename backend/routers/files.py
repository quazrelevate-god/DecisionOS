"""File upload / download endpoints (Epic 8 Sprint 3 -- from server.py).

Generic reference-file upload, authenticated download by id, legacy serve-by-
name, and the public brochure. File-analysis helpers (_store_file, _file_public,
_analyze_reference_file, _read_reference_text) stay in server.
"""
import os
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from core import db, get_current_user, logger
from services import obj_store
from server import _store_file, _file_public  # cross-domain

router = APIRouter(prefix="/api")


@router.post("/files")
async def upload_file(file: UploadFile = File(...), kind: str = Form("reference"),
                      user: dict = Depends(get_current_user)):
    """Generic upload (used to stage reference files before/at task creation)."""
    rec = await _store_file(user["tenant_id"], user["id"], file, kind if kind in ("reference", "evidence") else "reference")
    return _file_public(rec)


@router.get("/files/{file_id}/download")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    from fastapi.responses import Response
    rec = await db.files.find_one({"id": file_id, "tenant_id": user["tenant_id"], "is_deleted": False}, {"_id": 0})
    if not rec:
        # legacy local-disk fallback (older attachments stored a bare filename)
        raise HTTPException(status_code=404, detail="Not found")
    data, ctype = await obj_store.get_object(rec["storage_path"])
    fname = rec.get("original_filename", file_id)
    return Response(content=data, media_type=rec.get("content_type", ctype),
                    headers={"Content-Disposition": f'inline; filename="{fname}"'})


@router.get("/files/{fname}")
async def get_file(fname: str, user: dict = Depends(get_current_user)):
    """FIX-002-E + FIX-001-E EC8: this endpoint used to serve ANY file
    from local disk by bare filename, unauthenticated. Now it:
      1. Requires auth (get_current_user).
      2. Looks up the file's storage_path in db.files, db.ingestions,
         db.expenses.attachment, db.assets.attachment, or db.capture_drafts
         — all tenant-scoped.
      3. Serves from obj_store.
    Local-disk legacy fallback stays until migrate_local_disk_uploads_
    to_obj_store_v1 has rewritten every reference (post-migration all
    paths resolve to obj_store keys).
    """
    if "/" in fname or ".." in fname or fname.startswith("."):
        raise HTTPException(status_code=404, detail="Not found")
    tid = user["tenant_id"]
    from fastapi.responses import Response, FileResponse
    from services.uploads import read_upload, is_legacy_path

    # 1) Try db.files (task attachments, generic uploads).
    rec = await db.files.find_one(
        {"tenant_id": tid, "$or": [
            {"storage_path": {"$regex": re.escape(fname) + "$"}},
            {"original_filename": fname},
        ], "is_deleted": {"$ne": True}},
        {"_id": 0, "storage_path": 1, "content_type": 1, "original_filename": 1},
    )
    storage_path = (rec or {}).get("storage_path")
    content_type = (rec or {}).get("content_type")

    # 2) Try ingestions (WhatsApp / upload doc captures).
    if not storage_path:
        ing = await db.ingestions.find_one(
            {"tenant_id": tid, "$or": [
                {"filename": fname}, {"file_url": f"/api/files/{fname}"},
            ]},
            {"_id": 0, "storage_path": 1, "kind": 1},
        )
        if ing:
            storage_path = ing.get("storage_path") or fname  # legacy fallback
            content_type = None

    # 3) Try ledger attachments (expenses/assets/inventory).
    if not storage_path:
        for coll in ("expenses", "assets", "inventory"):
            row = await db[coll].find_one(
                {"tenant_id": tid, "$or": [
                    {"attachment.filename": fname},
                    {"attachment.url": f"/api/files/{fname}"},
                ]},
                {"_id": 0, "attachment": 1},
            )
            if row and (row.get("attachment") or {}).get("storage_path"):
                storage_path = row["attachment"]["storage_path"]
                content_type = row["attachment"].get("mime")
                break

    # 4) Try capture_drafts (WA-review UI previews).
    if not storage_path:
        cd = await db.capture_drafts.find_one(
            {"tenant_id": tid, "file_url": f"/api/files/{fname}"},
            {"_id": 0, "storage_path": 1, "file_url": 1},
        )
        if cd:
            storage_path = cd.get("storage_path") or fname

    # 5) Legacy fallback: serve from local disk if the file exists.
    #    FIX-006-C (S0-03): the old code returned any authenticated
    #    caller's request for a bare filename — but nothing here checks
    #    that the file actually belongs to the caller's tenant. Post-
    #    FIX-002-E migration this branch is dead code (obj_store owns
    #    every real upload). Default is now 404 for everything; ops can
    #    opt in via SERVE_LEGACY_LOCAL_DISK=1 in dev only when
    #    investigating a stale-file complaint. We LOG the hit so a
    #    lingering legacy reference shows up in observability.
    if not storage_path:
        from config import SERVE_LEGACY_LOCAL_DISK
        legacy_path = UPLOAD_DIR / fname
        if legacy_path.exists() and SERVE_LEGACY_LOCAL_DISK:
            logger.warning(
                "S0-03 legacy-disk-fallback: served %s to tenant=%s (opt-in). "
                "This path has no tenant-ownership check — turn "
                "SERVE_LEGACY_LOCAL_DISK off in prod.",
                fname, tid,
            )
            return FileResponse(str(legacy_path))
        if legacy_path.exists():
            logger.warning(
                "S0-03 legacy-disk hit denied for %s (tenant=%s). "
                "File exists on local disk but no DB record ties it to "
                "this tenant. Run the local-disk → obj_store migration.",
                fname, tid,
            )
        raise HTTPException(status_code=404, detail="Not found")

    try:
        data, ctype = await read_upload(storage_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=data, media_type=content_type or ctype or "application/octet-stream")


@router.get("/brochure")
async def download_brochure():
    from fastapi.responses import FileResponse
    path = UPLOAD_DIR / "DecisionOS-Investor-Brochure.pdf"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename="DecisionOS-Investor-Brochure.pdf",
        headers={"Content-Disposition": 'attachment; filename="DecisionOS-Investor-Brochure.pdf"'},
    )

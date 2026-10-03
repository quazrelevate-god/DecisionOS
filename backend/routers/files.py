"""File upload / download endpoints (Epic 8 Sprint 3 -- from server.py).

Generic reference-file upload, authenticated download by id, legacy serve-by-
name, and the public brochure. File-analysis helpers (_store_file, _file_public,
_analyze_reference_file, _read_reference_text) stay in server.
"""
import re

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from core import db, get_current_user, logger, UPLOAD_DIR
from services import obj_store
from services.files import _store_file, _file_public

router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# 2026-10-03 RBAC (founder) — WHO MAY OPEN A FILE.
#
# A file was served to any member who had its id. Ids are random and only
# travel inside records a person may see, so this was never a door anyone
# could find -- but it meant the record's rule was not the file's rule: a task
# photo stayed readable after the task was reassigned away, a bill photo to
# someone without Finance. Each file now asks the question its record asks.
# ---------------------------------------------------------------------------
async def may_read_file(user: dict, rec: dict) -> bool:
    if rec.get("kind") == "avatar":
        return True                                   # faces are drawn on every card
    if user.get("role") == "owner" or rec.get("uploaded_by") == user["id"]:
        return True
    fid = rec.get("id")
    if rec.get("task_id"):
        from routers.tasks import may_read_task
        t = await db.tasks.find_one({"id": rec["task_id"], "tenant_id": user["tenant_id"]}, {"_id": 0})
        if t and await may_read_task(user, t):
            return True
    if fid:
        # A reference handed to Dex with a capture, or carried by a decision.
        note = await db.voice_notes.find_one(
            {"tenant_id": user["tenant_id"], "reference_file_ids": fid}, {"_id": 0, "audio_path": 0})
        if note:
            from routers.voice_notes import _may_read_note
            if await _may_read_note(user, note):
                return True
        d = await db.decisions.find_one({"tenant_id": user["tenant_id"], "reference_file_ids": fid}, {"_id": 0})
        if d:
            from routers.decisions import _decision_participants
            if user["id"] in await _decision_participants(user["tenant_id"], d):
                return True
    return False


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
    if not await may_read_file(user, rec):
        raise HTTPException(status_code=403, detail="You don't have access to this file")
    data, ctype = await obj_store.get_object(rec["storage_path"])
    fname = rec.get("original_filename", file_id)
    headers = {"Content-Disposition": f'inline; filename="{fname}"'}
    if rec.get("kind") == "avatar":
        # ASK-25: a My Work grid draws the same few faces on every card. Each
        # upload mints a new file id, so a changed photo is a new URL and this
        # one can never go stale — cache it rather than refetch per card.
        headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return Response(content=data, media_type=rec.get("content_type", ctype), headers=headers)


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
    from services.uploads import read_upload

    # 1) Try db.files (task attachments, generic uploads).
    rec = await db.files.find_one(
        {"tenant_id": tid, "$or": [
            {"storage_path": {"$regex": re.escape(fname) + "$"}},
            {"original_filename": fname},
        ], "is_deleted": {"$ne": True}},
        {"_id": 0},
    )
    from core import user_perms
    perms = user_perms(user)
    if rec and not await may_read_file(user, rec):          # 2026-10-03, as /download
        raise HTTPException(status_code=403, detail="You don't have access to this file")
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
            # 2026-10-03 — an uploaded bill opens for whoever opens the Finance inbox.
            if not ({"finance", "data_input"} & perms):
                raise HTTPException(status_code=403, detail="You don't have access to this file")
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
                if "finance" not in perms:                     # 2026-10-03: the ledger's own rule
                    raise HTTPException(status_code=403, detail="You don't have access to this file")
                storage_path = row["attachment"]["storage_path"]
                content_type = row["attachment"].get("mime")
                break

    # 4) Try capture_drafts (WA-review UI previews).
    if not storage_path:
        cd = await db.capture_drafts.find_one(
            {"tenant_id": tid, "file_url": f"/api/files/{fname}"},
            {"_id": 0, "storage_path": 1, "file_url": 1, "reviewer_role": 1, "reviewer_perm": 1},
        )
        if cd:
            # 2026-10-03 — the draft's review queue (routers/captures._get_draft).
            on_queue = cd.get("reviewer_role") == user.get("role") or cd.get("reviewer_perm") in perms
            if user.get("role") != "owner" and not on_queue:
                raise HTTPException(status_code=403, detail="You don't have access to this file")
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

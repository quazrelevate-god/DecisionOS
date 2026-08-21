"""Meeting capture endpoints (Epic 8 Sprint 3 -- extracted from server.py).

Audio + text meeting intake; both queue the background process_meeting
pipeline (STT -> LLM summary -> action-item tasks -> brain_context). The
pipeline helper process_meeting and the shared TextNoteInput model still
live in server.py until Sprints 4/5.
"""
from fastapi import (
    APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form,
)

from core import db, get_current_user, require_perm, new_id, now_iso
from server import TextNoteInput  # model still in server (S5)
from services.meetings import process_meeting

router = APIRouter(prefix="/api")


@router.post("/meetings")
async def create_meeting(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(require_perm("voice_capture"))):
    # FIX-004-C (RBAC-08): meeting audio triggers STT (per-minute-
    # billed) + downstream LLM summarization. Same voice_capture perm
    # already gates /voice-notes; extending to meetings closes the
    # inconsistency that let perm-less employees burn STT credits
    # here.
    # FIX-002-E: obj_store with tenant prefix (was local UPLOAD_DIR).
    from services.uploads import store_upload
    mid = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    content = await file.read()
    result = await store_upload(user["tenant_id"], "meetings", content, ext,
                                 content_type=file.content_type, file_id=mid)
    await db.meetings.insert_one({
        "id": mid, "tenant_id": user["tenant_id"], "created_by": user["id"], "created_by_name": user.get("name"),
        "kind": "audio", "audio_path": result["storage_path"],
        "transcript": None, "language": language,
        "title": "Processing meeting…", "summary": "", "key_points": [], "decisions": [], "action_items": [],
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_meeting, mid)
    return {"id": mid, "status": "queued"}


@router.post("/meetings/text")
async def create_meeting_text(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_perm("voice_capture"))):
    # FIX-004-C (RBAC-08): parity with /meetings audio — same LLM
    # summarization path, same perm gate.
    mid = new_id()
    await db.meetings.insert_one({
        "id": mid, "tenant_id": user["tenant_id"], "created_by": user["id"], "created_by_name": user.get("name"),
        "kind": "text", "audio_path": None, "transcript": inp.text, "language": inp.language or "auto",
        "title": "Processing meeting…", "summary": "", "key_points": [], "decisions": [], "action_items": [],
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_meeting, mid)
    return {"id": mid, "status": "queued"}


@router.get("/meetings")
async def list_meetings(user: dict = Depends(get_current_user)):
    return await db.meetings.find({"tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0}).sort("created_at", -1).to_list(100)


@router.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, user: dict = Depends(get_current_user)):
    m = await db.meetings.find_one({"id": meeting_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    return m

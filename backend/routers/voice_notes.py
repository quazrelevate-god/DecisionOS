"""Voice / dictation capture endpoints (Epic 8 Sprint 3 -- from server.py).

Audio + text voice-notes (queued to the process_voice_note pipeline), the
ephemeral /transcribe dictation helper, and the AI directive-clarifier.
process_voice_note / transcribe_audio / _tenant_industry stay in server.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form

from core import (
    db, get_current_user, require_perm, new_id, now_iso, logger,
    claude_chat, _extract_json,
)
from emergentintegrations.llm.chat import UserMessage
from models.voice import TextNoteInput
from core import model_for
from prompts import render
from services.ai.pii import redact_pii
from services.voice import process_voice_note
from services.transcription import transcribe_audio
from services.tasks import _tenant_industry

router = APIRouter(prefix="/api")


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.voice import (
    ClarifyInput,
)


@router.post("/voice-notes")
async def create_voice_note(background: BackgroundTasks, file: UploadFile = File(...), language: str = Form("auto"), file_ids: str = Form(""), user: dict = Depends(require_perm("voice_capture"))):
    # FIX-002-E: uploads go to obj_store with a tenant-prefixed key so they
    # survive redeploys, work across replicas, and can be tenant-deleted
    # cleanly (see FIX-001-E). Was local disk under UPLOAD_DIR.
    from services.uploads import store_upload
    note_id = new_id()
    ext = (file.filename or "audio.webm").split(".")[-1]
    content = await file.read()
    result = await store_upload(user["tenant_id"], "voice-notes", content, ext,
                                 content_type=file.content_type, file_id=note_id)
    ref_ids = [x for x in (file_ids or "").split(",") if x.strip()]
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "audio", "audio_path": result["storage_path"],
        "transcript": None, "language": language,
        "reference_file_ids": ref_ids,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}


@router.post("/transcribe")
async def transcribe_only(file: UploadFile = File(...), language: str = Form("auto"), user: dict = Depends(get_current_user)):
    """Dictation helper: transcribe a short audio clip to text (no note/decision is created).

    FIX-002-E: dictation is truly ephemeral (transcribe + return the text,
    never persisted). Writing to a system temp file (auto-cleaned on
    reboot) instead of the shared UPLOAD_DIR avoids polluting the
    tenant-scoped upload namespace with throwaway files.
    """
    import tempfile
    ext = (file.filename or "audio.webm").split(".")[-1]
    data = await file.read()
    fd, tmp_path = tempfile.mkstemp(suffix=f".{ext}", prefix="dictation-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        try:
            text = await transcribe_audio(tmp_path, language)
        except Exception as e:
            logger.error(f"transcribe_only failed: {e}")
            raise HTTPException(status_code=503, detail="Couldn't transcribe audio. Please try again.")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
    return {"text": (text or "").strip()}



@router.post("/voice-notes/text")
async def create_text_note(inp: TextNoteInput, background: BackgroundTasks, user: dict = Depends(require_perm("voice_capture"))):
    note_id = new_id()
    ref_ids = [x for x in (inp.file_ids or []) if x]
    if not (inp.text or "").strip() and not ref_ids:
        raise HTTPException(status_code=400, detail="Provide a directive or attach a file")
    await db.voice_notes.insert_one({
        "id": note_id, "tenant_id": user["tenant_id"], "created_by": user["id"],
        "kind": "text" if (inp.text or "").strip() else "file", "audio_path": None,
        "transcript": inp.text, "language": inp.language or "auto",
        "reference_file_ids": ref_ids,
        "status": "queued", "created_at": now_iso(),
    })
    background.add_task(process_voice_note, note_id)
    return {"id": note_id, "status": "queued"}




async def ai_clarify_directive(text: str, industry: str, session_id: str) -> dict:
    """Decide if an owner's directive has enough info to act on; if not, ask up to 4 short questions."""
    system = render("extraction.clarify", industry=industry or "general")
    prompt = f"Owner instruction: \"{text}\"\nAnalyze it now."
    chat = claude_chat(task="extraction.clarify", session_id=session_id, system_message=system).with_model(*model_for("extraction.clarify"))
    resp = await chat.send_message(UserMessage(text=prompt))
    try:
        d = _extract_json(resp)
    except Exception as e:
        logger.error(f"AI clarify parse error: {e} :: {redact_pii(resp)[:300]}")
        return {"complete": True, "questions": []}
    qs = []
    for q in (d.get("questions") or [])[:4]:
        if isinstance(q, dict) and q.get("question"):
            qs.append({"id": q.get("id") or new_id(), "question": str(q["question"])[:160], "hint": str(q.get("hint") or "")[:120]})
    complete = bool(d.get("complete")) or len(qs) == 0
    return {"complete": complete, "questions": [] if complete else qs}


@router.post("/capture/clarify")
async def clarify_directive(inp: ClarifyInput, user: dict = Depends(require_perm("voice_capture"))):
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    industry = await _tenant_industry(user["tenant_id"])
    return await ai_clarify_directive(text, industry, session_id=f"clarify-{user['id']}")



@router.get("/voice-notes")
async def list_voice_notes(user: dict = Depends(get_current_user)):
    notes = await db.voice_notes.find(
        {"tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0}
    ).sort("created_at", -1).to_list(100)
    return notes


@router.get("/voice-notes/{note_id}")
async def get_voice_note(note_id: str, user: dict = Depends(get_current_user)):
    note = await db.voice_notes.find_one({"id": note_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "audio_path": 0})
    if not note:
        raise HTTPException(status_code=404, detail="Not found")
    return note

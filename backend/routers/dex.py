"""Dex persona endpoints — Sprint 5.

Ships (Sprint 5 partial batch, 2026-08-15):
  * POST /api/dex/capture          -> E2-41: thin proxy that routes to
                                       /voice-notes/text (text input) or
                                       /voice-notes (audio blob upload).
                                       Gives us one persona-scoped entry
                                       point for observability + future
                                       per-tenant rate-limiting at the
                                       persona level.
  * GET  /api/dex/inflight-count   -> E2-35: how many captures for this
                                       user are still being structured
                                       (pending_review + needs_attention
                                       in capture_drafts). Frontend polls
                                       this to render the 'Dex is
                                       structuring N captures right now'
                                       badge on the Dex sub-tabs.
"""
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from core import db, get_current_user, user_perms


router = APIRouter(prefix="/api/dex")


@router.get("/inflight-count")
async def dex_inflight_count(user: dict = Depends(get_current_user)):
    """E2-35: captures for THIS user that Dex is still structuring.

    Different from /captures/pending-count -- that one is REVIEW queue
    (drafts waiting for a reviewer's attention). This is the front-half
    of the pipeline: what has the user just captured that Dex hasn't
    finished parsing yet. Same underlying collection (capture_drafts),
    but scoped to created_by=user and status still in the AI-processing
    lane.
    """
    tid = user["tenant_id"]
    uid = user["id"]
    # voice_notes goes through queued -> transcribing -> structuring
    # -> done (see server.py process_voice_note). We want the front-
    # half only. capture_drafts is downstream (already parsed, waiting
    # for reviewer) so it's NOT in-flight -- that's a REVIEW queue.
    q = {
        "tenant_id": tid,
        "created_by": uid,
        "status": {"$in": ["queued", "transcribing", "structuring"]},
    }
    n = await db.voice_notes.count_documents(q)
    return {"count": n}


@router.post("/capture")
async def dex_capture(
    background: BackgroundTasks,
    text: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    language: str = Form("auto"),
    file_ids: str = Form(""),
    user: dict = Depends(get_current_user),
):
    """E2-41: unified persona-scoped capture entry point.

    Routes based on input shape:
      * `text` set + no `file`  -> forward to voice_note_from_text
      * `file` set (audio mime) -> forward to create_voice_note
      * `file` set (other mime) -> forward to /files (attachment upload)

    Thin proxy -- no business logic here beyond routing. Kept in its
    own router so the persona-scoped observability endpoint (dex.usage
    .captures per tenant) has a natural home to expand into.
    """
    # Deferred imports to break the server.py <-> routers.dex cycle
    # (server.py mounts this router at the bottom).
    from server import (
        create_voice_note, create_text_note, upload_file,
        TextNoteInput,
    )

    if text and not file:
        # Text path: same as POST /voice-notes/text
        inp = TextNoteInput(text=text, language=language or "auto",
                            file_ids=[x for x in (file_ids or "").split(",") if x.strip()])
        return await create_text_note(inp, background, user)

    if not file:
        raise HTTPException(
            status_code=400,
            detail="Provide either `text` or `file`.",
        )

    ctype = (file.content_type or "").lower()
    if ctype.startswith("audio/") or ctype == "application/octet-stream":
        # Audio path: same as POST /voice-notes
        return await create_voice_note(background, file, language, file_ids, user)

    # Everything else (PDF, image, doc, etc.) -> attachment upload path.
    # Same as POST /files. upload_file signature: (file, kind, user).
    return await upload_file(file, "attachment", user)

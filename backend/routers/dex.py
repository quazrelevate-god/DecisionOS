"""Dex persona endpoints — Sprint 5.

Ships (Sprint 5 partial batch, 2026-08-15):
  * GET  /api/dex/inflight-count   -> E2-35: how many captures for this
                                       user are still being structured
                                       (pending_review + needs_attention
                                       in capture_drafts). Frontend polls
                                       this to render the 'Dex is
                                       structuring N captures right now'
                                       badge on the Dex sub-tabs.

2026-10-05 (AI audit) — POST /api/dex/capture is gone: a proxy to /voice-notes
that nothing in the app called, kept alive as one more door to the same work.
"""
from fastapi import APIRouter, Depends

from core import db, get_current_user


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


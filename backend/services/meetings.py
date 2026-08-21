"""Meeting-notes processing pipeline (Epic 8 Sprint 4 -- from server.py).

Transcribe (if needed) -> AI minutes -> action-item tasks -> Brain event.
match_member_by_name still lives in server (voice pipeline, U8-04.5) and is
imported deferred; everything else is core/services.
"""
from datetime import datetime, timezone, timedelta

from core import db, logger, new_id, now_iso, log_activity
from services.ai import brain_context
from services.ai.extraction import ai_meeting_notes
from services.transcription import transcribe_audio


async def process_meeting(meeting_id: str):
    m = await db.meetings.find_one({"id": meeting_id})
    if not m:
        return
    tid = m["tenant_id"]
    try:
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "transcribing"}})
        transcript = m.get("transcript")
        if not transcript and m.get("audio_path"):
            transcript = await transcribe_audio(m["audio_path"], m.get("language", "auto"))
            await db.meetings.update_one({"id": meeting_id}, {"$set": {"transcript": transcript}})
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "structuring"}})
        members = await db.users.find({"tenant_id": tid}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        notes = await ai_meeting_notes(transcript or "", members, session_id=f"meeting-{meeting_id}")
        task_ids = []
        from server import match_member_by_name  # cross-domain (voice pipeline); moves in U8-04.5
        for a in notes.get("action_items", []):
            if not a.get("title"):
                continue
            due = None
            if isinstance(a.get("due_in_days"), int):
                due = (datetime.now(timezone.utc) + timedelta(days=a["due_in_days"])).isoformat()
            member = match_member_by_name(members, a.get("assignee_name", ""))
            tid_task = new_id()
            await db.tasks.insert_one({
                "id": tid_task, "tenant_id": tid, "title": a["title"], "description": "From meeting notes",
                "assignee_role": member["role"] if member else None, "assignee_id": member["id"] if member else None,
                "priority": "medium", "status": "todo", "due_date": due, "decision_id": None,
                "source": "meeting", "created_at": now_iso(),
            })
            task_ids.append(tid_task)
        await db.meetings.update_one({"id": meeting_id}, {"$set": {
            "title": notes.get("title"), "summary": notes.get("summary"),
            "key_points": notes.get("key_points", []), "decisions": notes.get("decisions", []),
            "action_items": notes.get("action_items", []), "task_ids": task_ids,
            "status": "done", "processed_at": now_iso(),
        }})
        await log_activity(tid, m["created_by"], "meeting_processed",
                           f"Meeting notes ready: '{notes.get('title')}' — {len(task_ids)} action item(s)", "meeting", meeting_id)
        # FIX-007-B (S4-10): every finalized meeting is now a queryable
        # Brain event — "what did we agree at the Sharma vendor call?"
        # used to be answerable only by scrolling meetings; now the
        # summary + decisions + action-item count land as one
        # brain_context row that /ask + brain_router can retrieve.
        try:
            _key_pts = notes.get("key_points") or []
            _decs = notes.get("decisions") or []
            _why_bits = []
            if _decs:
                _why_bits.append("Decisions: " + " | ".join(str(d) for d in _decs[:5]))
            if _key_pts:
                _why_bits.append("Key points: " + " | ".join(str(k) for k in _key_pts[:5]))
            await brain_context.record_context(
                tenant_id=tid, kind="meeting",
                title=notes.get("title") or "Meeting",
                outcome=f"{len(task_ids)} action item(s)" if task_ids else "notes",
                why=(notes.get("summary") or "\n".join(_why_bits))[:800],
                tags=["meeting"],
                source_type="meeting", source_id=meeting_id,
                related_ids={"task_ids_count": str(len(task_ids))},
                actor_id=m.get("created_by") or "",
                actor_name="",
                department="", visibility="public",
            )
        except Exception as _e:
            logger.warning(f"S4-10 meeting brain_context failed for {meeting_id}: {_e}")
    except Exception as e:
        logger.exception("process_meeting failed")
        await db.meetings.update_one({"id": meeting_id}, {"$set": {"status": "failed", "error": str(e)}})

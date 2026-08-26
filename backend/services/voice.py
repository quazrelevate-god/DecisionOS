"""Voice-note / directive processing pipeline (Epic 8 Sprint 4 -- from server.py).

Transcribe -> AI-extract -> materialize decision + tasks + reminders + meetings
+ workflows, link tasks to their workflow stage, and file an inbox item.
Member-matching + smart-assignment helpers live here too (also used by
services.meetings). Cross-domain helpers still in server (tenant_operating_model,
_read_reference_text, add_inbox_item) are imported deferred to avoid a cycle.
"""
import re
from datetime import datetime, timezone, timedelta
from typing import Optional

from core import (
    db, logger, new_id, now_iso, set_usage_tenant, tenant_role_keys, log_activity,
)
from services.transcription import transcribe_audio_full
from services.ai.extraction import ai_extract
from services.tasks import _attach_reference_ids


def match_member_by_name(members: list, name: str):
    n = re.sub(r"[^a-z ]", "", (name or "").lower()).strip()
    if not n or not members:
        return None
    for m in members:  # exact (case-insensitive) full-name match
        if (m.get("name") or "").lower().strip() == n:
            return m
    tokens = set(n.split())
    best = None
    for m in members:  # first-name / token overlap
        mtoks = set((m.get("name") or "").lower().split())
        if tokens & mtoks:
            best = m
            break
    return best


_WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6}


def _resolve_meeting_date(when: str, due_in_days) -> str:
    """Resolve a meeting's natural-language timing into an ISO date (YYYY-MM-DD).
    Explicit day references in `when` take priority over the LLM's due_in_days heuristic."""
    now = datetime.now(timezone.utc)
    w = (when or "").lower()
    if "today" in w:
        return now.date().isoformat()
    if "tomorrow" in w:
        return (now + timedelta(days=1)).date().isoformat()
    for name, idx in _WEEKDAYS.items():
        if name in w:
            ahead = (idx - now.weekday()) % 7 or 7  # next occurrence, not today
            if "next" in w:
                ahead += 7
            return (now + timedelta(days=ahead)).date().isoformat()
    if isinstance(due_in_days, int):
        return (now + timedelta(days=due_in_days)).date().isoformat()
    if "next week" in w:
        return (now + timedelta(days=7)).date().isoformat()
    return (now + timedelta(days=2)).date().isoformat()


async def pick_least_loaded_member(tenant_id: str, role: str) -> Optional[str]:
    """Auto-assignment (E3-13): the ACTIVE role member with the fewest open (not
    done/cancelled) tasks, with a DETERMINISTIC tiebreak (by id) when loads are equal.
    Returns None when the role has no assignable member. Never raises."""
    if not role:
        return None
    try:
        members = await db.users.find({"tenant_id": tenant_id, "role": role}, {"_id": 0, "id": 1}).to_list(200)
        if not members:
            return None
        # Only auto-assign to ACTIVE members -- never to a suspended/removed/pending person.
        # Honor membership data strictly when it exists; fail open for legacy tenants without it.
        active_ids = {r.get("user_id") for r in await db.memberships.find(
            {"tenant_id": tenant_id, "status": "active"}, {"_id": 0, "user_id": 1}).to_list(1000)}
        if active_ids:
            members = [m for m in members if m["id"] in active_ids]
            if not members:
                return None
        if len(members) == 1:
            return members[0]["id"]
        loads = []
        for m in members:
            load = await db.tasks.count_documents({
                "tenant_id": tenant_id, "assignee_id": m["id"],
                "status": {"$nin": ["done", "cancelled"]},
            })
            loads.append((load, m["id"]))
        loads.sort()  # (load asc, id asc) -> least-loaded, deterministic on ties
        return loads[0][1]
    except Exception as e:
        logger.warning(f"pick_least_loaded_member failed: {e}")
        return None


async def resolve_assignee(tenant_id: str, *, role: str = None, assignee_name: str = None,
                           members: list = None) -> dict:
    """The single entry point for auto-assigning an AI-generated task to a PERSON (E3-13).
    Priority: an explicitly-named person -> the sole active member of the role -> the
    least-loaded active member -> unassigned (role only). Returns
    {assignee_id, role, how} where how is 'named' | 'load' | 'unassigned'. Never raises."""
    role = (role or "").strip().lower() or None
    try:
        if assignee_name:
            if members is None:
                members = await db.users.find(
                    {"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
            m = match_member_by_name(members, assignee_name)
            if m:
                return {"assignee_id": m["id"], "role": (m.get("role") or role), "how": "named"}
        if role:
            aid = await pick_least_loaded_member(tenant_id, role)
            if aid:
                return {"assignee_id": aid, "role": role, "how": "load"}
    except Exception as e:
        logger.warning(f"resolve_assignee failed: {e}")
    return {"assignee_id": None, "role": role, "how": "unassigned"}


async def _create_decision_tasks(tenant_id, note, decision_id, extracted, troles, members, cat_keys=None):
    """Create the blocked tasks for a decision; returns (task_ids, assignee_keys)."""
    cat_keys = cat_keys or set()
    task_ids = []
    assignee_keys = set()
    for t in extracted.get("tasks", []):
        tid = new_id()
        due = None
        if isinstance(t.get("due_in_days"), int):
            due = (datetime.now(timezone.utc) + timedelta(days=t["due_in_days"])).isoformat()
        role = t.get("assignee_role") if t.get("assignee_role") in troles else None
        assignee_id = None
        member = match_member_by_name(members, t.get("assignee_name", ""))
        if member:
            assignee_id = member["id"]
            role = member["role"]
        elif role:
            # Smart assignment: distribute role-level tasks to the least-loaded member.
            assignee_id = await pick_least_loaded_member(tenant_id, role)
        if assignee_id:
            assignee_keys.add(f"u:{assignee_id}")
        elif role:
            assignee_keys.add(f"r:{role}")
        task_cat = t.get("task_category") if t.get("task_category") in cat_keys else None
        await db.tasks.insert_one({
            "id": tid, "tenant_id": tenant_id, "title": t.get("title", "Untitled task"),
            "description": t.get("description", ""), "assignee_role": role, "assignee_id": assignee_id,
            "priority": t.get("priority", "medium") if t.get("priority") in ("low", "medium", "high") else "medium",
            "status": "blocked", "due_date": due, "decision_id": decision_id,
            "task_type": task_cat,
            "source": "voice", "created_at": now_iso(),
            # WE-01: null placeholders. The process_voice_note post-pass
            # fills these in AFTER _create_workflows runs, once we know
            # which workflow this decision spawned.
            "workflow_id": None, "stage_key": None,
            "updated_at": now_iso(), "last_action": "Created",
        })
        task_ids.append(tid)
    return task_ids, assignee_keys


async def _create_reminders_and_memory(tenant_id, note, extracted):
    """Voice shortcuts: lightweight personal reminders + lasting company memory."""
    for r in (extracted.get("reminders") or []):
        due = None
        if isinstance(r.get("due_in_days"), int):
            due = (datetime.now(timezone.utc) + timedelta(days=r["due_in_days"])).isoformat()
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "title": r.get("title", "Reminder"),
            "description": "", "assignee_role": None, "assignee_id": note["created_by"],
            "priority": "medium", "status": "todo", "due_date": due, "decision_id": None,
            "source": "reminder", "created_at": now_iso(),
        })
    for m in (extracted.get("memory_notes") or []):
        if m.get("text"):
            await db.memory.insert_one({
                "id": new_id(), "tenant_id": tenant_id, "text": m["text"],
                "tag": m.get("tag", "note"), "created_by": note["created_by"], "created_at": now_iso(),
            })


async def _create_meetings(tenant_id, note, decision_id, extracted):
    """Schedule a real calendar event + a lightweight to-do per detected meeting; returns the list."""
    meetings = extracted.get("meeting_events") or []
    for mt in meetings:
        when = (mt.get("when") or "").strip()
        title = (mt.get("title") or "Meeting").strip()
        mdate = _resolve_meeting_date(when, mt.get("due_in_days"))
        await db.calendar_events.insert_one({
            "id": new_id(), "tenant_id": tenant_id, "date": mdate, "title": title,
            "when_text": when, "decision_id": decision_id, "source": "voice",
            "created_by": note["created_by"], "created_at": now_iso(),
        })
        await db.tasks.insert_one({
            "id": new_id(), "tenant_id": tenant_id,
            "title": title + (f" ({when})" if when else ""),
            "description": "", "assignee_role": None, "assignee_id": note["created_by"],
            "priority": "medium", "status": "todo", "due_date": None, "decision_id": None,
            "source": "meeting", "created_at": now_iso(),
        })
    return meetings


async def _create_workflows(tenant_id, note, decision_id, extracted):
    """Materialize each detected workflow_event into a real board card; returns the created ids."""
    from server import tenant_operating_model  # cross-domain; moves in U8-04.12
    wf_ids = []
    om = await tenant_operating_model(tenant_id)
    pmap = {p["key"]: p for p in om["pipelines"]}
    for ev in (extracted.get("workflow_events") or []):
        wtype = ev.get("type")
        pipeline = pmap.get(wtype)
        if not pipeline:
            continue
        stages = [s["key"] for s in pipeline["stages"]]
        title = (ev.get("title") or ev.get("action") or pipeline["label"]).strip()
        cp = (ev.get("counterparty") or "").strip()
        contact_id = None
        if cp:
            c = await db.contacts.find_one({"tenant_id": tenant_id, "$or": [
                {"name": {"$regex": f"^{re.escape(cp)}$", "$options": "i"}},
                {"company": {"$regex": f"^{re.escape(cp)}$", "$options": "i"}}]}, {"_id": 0, "id": 1, "name": 1, "company": 1})
            if c:
                contact_id = c["id"]
                cp = cp or c.get("company") or c.get("name") or ""
        amount = ev.get("amount") if isinstance(ev.get("amount"), (int, float)) else None
        wid = new_id()
        await db.workflows.insert_one({
            "id": wid, "tenant_id": tenant_id, "type": wtype, "title": title,
            "detail": ev.get("detail", ""), "amount": amount, "counterparty": cp, "contact_id": contact_id,
            "stage": stages[0], "stages": stages,
            "stage_version": 0,
            "history": [{"stage": stages[0], "note": "Auto-created from directive", "by": note["created_by"], "at": now_iso()}],
            "source": "voice", "decision_id": decision_id,
            "created_by": note["created_by"], "created_at": now_iso(),
        })
        wf_ids.append(wid)
    return wf_ids


async def process_voice_note(note_id: str):
    note = await db.voice_notes.find_one({"id": note_id})
    if not note:
        return
    tenant_id = note["tenant_id"]
    set_usage_tenant(tenant_id)
    from server import tenant_operating_model, _read_reference_text, add_inbox_item  # cross-domain; move in U8-04.7/.12
    try:
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "transcribing"}})
        transcript = note.get("transcript")
        detected_code = note.get("detected_language")
        detected_name = note.get("detected_language_name")
        if not transcript and note.get("audio_path"):
            stt = await transcribe_audio_full(note["audio_path"], note.get("language", "auto"))
            transcript = stt.get("transcript")
            detected_code = stt.get("language_code") or ""
            detected_name = stt.get("language_name") or ""
            await db.voice_notes.update_one({"id": note_id}, {"$set": {
                "transcript": transcript, "detected_language": detected_code,
                "detected_language_name": detected_name,
                "language_probability": stt.get("language_probability"), "stt_engine": stt.get("engine")}})

        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "structuring"}})
        troles = await tenant_role_keys(tenant_id)
        members = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(200)
        om = await tenant_operating_model(tenant_id)
        cat_keys = {c["key"] for c in om["task_categories"]}
        # Read any attached reference files so the AI factors them into the decision.
        ref_ids = note.get("reference_file_ids") or []
        extra_context = ""
        if ref_ids:
            chunks = []
            for fid in ref_ids:
                frec = await db.files.find_one({"id": fid, "tenant_id": tenant_id, "is_deleted": False}, {"_id": 0})
                if frec:
                    txt = await _read_reference_text(frec, tenant_id)
                    if txt:
                        chunks.append(txt)
            extra_context = "\n\n".join(chunks)
        extracted = await ai_extract(transcript or "", session_id=f"extract-{note_id}", allowed_roles=sorted(troles),
                                     members=members, pipelines=om["pipelines"], task_categories=om["task_categories"],
                                     extra_context=extra_context)

        decision_id = new_id()
        dlist = extracted.get("decisions", [])
        first = dlist[0] if dlist else {}
        dtype = first.get("type") if first.get("type") in ("directive", "approval", "policy", "observation") else "directive"
        conf = extracted.get("confidence", 0.8)
        conf = float(conf) if isinstance(conf, (int, float)) else 0.8
        decision = {
            "id": decision_id, "tenant_id": tenant_id, "voice_note_id": note_id,
            "title": (extracted.get("decisions") or [{}])[0].get("title") or (extracted.get("summary") or "New decision")[:80],
            "summary": extracted.get("summary", ""),
            "items": extracted.get("decisions", []),
            "workflow_events": extracted.get("workflow_events", []),
            "dtype": dtype, "confidence": round(max(0.0, min(1.0, conf)), 2),
            # E3-02.2: calibrated confidence + review flag. The reviewer already
            # approves every decision; needs_review lets the queue surface the
            # shaky ones (repair needed / residual schema issues / nothing extracted).
            "confidence_raw": extracted.get("confidence_raw"),
            "needs_review": bool(extracted.get("needs_review")),
            "review_reasons": extracted.get("review_reasons") or [],
            "status": "pending_approval",
            "created_by": note["created_by"], "created_at": now_iso(),
            "source": note.get("source") or ("voice" if note.get("kind") == "audio" else "text"),
            "wa_from": note.get("wa_from"), "raised_by_name": note.get("raised_by_name"),
            "detected_language": detected_code or None,
            "detected_language_name": detected_name or None,
            "task_ids": [],
        }
        task_ids, assignee_keys = await _create_decision_tasks(tenant_id, note, decision_id, extracted, troles, members, cat_keys)
        # Attach the uploaded reference file(s) to every task this directive produced (context for assignees).
        if ref_ids and task_ids:
            for tid in task_ids:
                await _attach_reference_ids(tenant_id, note["created_by"], tid, ref_ids)
        decision["task_ids"] = task_ids
        decision["timeline"] = [{"ts": now_iso(), "label": f"Decision captured via {note.get('source') or note.get('kind') or 'voice'}", "actor": note.get("raised_by_name") or "Owner", "kind": "created"}]
        await db.decisions.insert_one(decision)
        _icls = "approval" if dtype == "approval" else ("task" if task_ids else "reminder")
        await add_inbox_item(tenant_id, note["created_by"],
                             "voice" if note.get("kind") == "audio" else "text",
                             _icls, decision["title"], (decision.get("summary") or "")[:180],
                             "decision", decision_id, status="open")
        await _create_reminders_and_memory(tenant_id, note, extracted)
        meetings = await _create_meetings(tenant_id, note, decision_id, extracted)
        wf_ids = await _create_workflows(tenant_id, note, decision_id, extracted)
        # WE-01 (2026-08-16): post-pass to link the decision's tasks to
        # their workflow.
        #
        # WE-01.5 (2026-08-16): each task is routed to the stage its
        # ROLE owns -- not the workflow's initial stage. A Kapoor
        # decision with sales/finance/ops tasks lands them at
        # order_received/confirmed/in_production respectively, so the
        # engine's auto-advance chain covers the full workflow instead
        # of stalling after the first stage.
        #
        # WE-01.5.1 (2026-08-16, live bug fix): the AI often generates
        # MULTIPLE workflows for one decision (e.g. Delhi Retail order
        # gets both a Production and a Distribution card). Original
        # guard len(wf_ids)==1 left every task unlinked in that case.
        # Now we iterate each workflow's pipeline and let the role
        # decide OWNERSHIP: each task is linked to the workflow whose
        # pipeline has a stage matching the task's role. Tasks whose
        # role doesn't match ANY workflow fall back to the first
        # workflow's current stage. Prevents the "all tasks stranded"
        # regression while keeping ambiguity-safe (we never pick a
        # workflow at random).
        if wf_ids and task_ids:
            from services.workflows import stage_owned_by  # WE-01.5
            # Batch-fetch tasks + all candidate workflows.
            _tk_rows = await db.tasks.find(
                {"id": {"$in": task_ids}, "tenant_id": tenant_id},
                {"_id": 0, "id": 1, "assignee_role": 1},
            ).to_list(len(task_ids))
            _wfs = await db.workflows.find(
                {"id": {"$in": wf_ids}, "tenant_id": tenant_id},
                {"_id": 0, "id": 1, "type": 1, "stage": 1},
            ).to_list(len(wf_ids))
            # Resolve the pipeline object per workflow (needed for
            # stage_owned_by).
            _om = await tenant_operating_model(tenant_id)
            _om_pipelines = {p.get("key"): p
                             for p in (_om or {}).get("pipelines") or []
                             if p.get("key")}
            _wf_map = []
            for _wf in _wfs:
                _wf_map.append({
                    "wf": _wf,
                    "pipeline": _om_pipelines.get(_wf.get("type") or ""),
                })

            # Fallback if a task doesn't match any pipeline's role stages
            _fallback_wf = _wf_map[0] if _wf_map else None

            for _tk in _tk_rows:
                _role = (_tk.get("assignee_role") or "").strip()
                _chosen_wf_id = None
                _chosen_stage = None
                # Pass 1: find the workflow whose pipeline owns this role
                for _entry in _wf_map:
                    _sk = stage_owned_by(_entry["pipeline"], _role) if _entry["pipeline"] else None
                    if _sk:
                        _chosen_wf_id = _entry["wf"]["id"]
                        _chosen_stage = _sk
                        break
                # Fallback: first workflow's current stage
                if not _chosen_wf_id and _fallback_wf:
                    _chosen_wf_id = _fallback_wf["wf"]["id"]
                    _chosen_stage = _fallback_wf["wf"].get("stage")
                if _chosen_wf_id:
                    await db.tasks.update_one(
                        {"id": _tk["id"], "tenant_id": tenant_id},
                        {"$set": {"workflow_id": _chosen_wf_id,
                                  "stage_key": _chosen_stage}},
                    )
        # Execution summary — real counts of what this directive produced
        execution_summary = {
            "tasks": len(task_ids),
            "assignees": len(assignee_keys),
            "approvals": 1 if (task_ids and decision["status"] == "pending_approval") else 0,
            "workflows": len(wf_ids),
            "meetings": len(meetings),
            "reminders": len(extracted.get("reminders") or []),
        }
        await db.decisions.update_one({"id": decision_id}, {"$set": {"execution_summary": execution_summary, "workflow_ids": wf_ids}})
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "done", "decision_id": decision_id, "execution_summary": execution_summary, "processed_at": now_iso()}})
        await log_activity(tenant_id, note["created_by"], "decision_extracted",
                           f"Extracted decision '{decision['title']}' with {len(task_ids)} task(s)", "decision", decision_id)
    except Exception as e:
        logger.exception("process_voice_note failed")
        await db.voice_notes.update_one({"id": note_id}, {"$set": {"status": "failed", "error": str(e)}})

"""Decisions router — extracted from `server.py` in Phase B step 3.

Owns:
  • GET    /api/decisions                       — list (?status filter)
  • GET    /api/decisions/{id}                  — detail
  • GET    /api/decisions/{id}/timeline         — audit trail
  • GET    /api/journal                         — search across decisions + memory
  • POST   /api/decisions/{id}/tasks            — add task to a decision
  • POST   /api/decisions/{id}/approve          — approve (unblock spawned work)
  • POST   /api/decisions/{id}/reject           — reject (cascade delete spawned work)
  • POST   /api/decisions/{id}/comment          — participant-only comment

Server-local helpers (`enrich_decision`, `enrich_decisions`, `_owner_ids`,
`add_decision_event`, `log_activity`, `push_notification`, `tenant_role_keys`)
and models (`TaskCreateInput`) are deferred-imported inside handlers to avoid
the `server.py ↔ routers/decisions.py` circular import — same pattern used by
`routers/auth.py` and `routers/tasks.py`.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, get_current_user, require_perm, new_id, now_iso
from models.tasks import TaskCreateInput
from services.ai import brain_context
from services.tenancy import ensure_owned, tenant_filter  # FIX-001-C


router = APIRouter(prefix="/api")




async def _decision_participants(tenant_id: str, d: dict) -> set:
    """Everyone involved with a decision: creator, task assignees, and owners."""
    from server import _owner_ids  # deferred
    ids = set(await _owner_ids(tenant_id))
    if d.get("created_by"):
        ids.add(d["created_by"])
    async for t in db.tasks.find({"decision_id": d["id"]}, {"_id": 0, "assignee_id": 1}):
        if t.get("assignee_id"):
            ids.add(t["assignee_id"])
    return ids


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.decisions import (
    DecisionCommentInput,
)


@router.get("/decisions")
async def list_decisions(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    from server import enrich_decisions  # deferred
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    decisions = await db.decisions.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # FIX-003-B (S2-05): explicit tenant_id makes the defense-in-depth
    # filter unconditional even in the (unlikely) case where a decision
    # doc lost its tenant_id field.
    return await enrich_decisions(decisions, tenant_id=user["tenant_id"])


@router.get("/decisions/{decision_id}")
async def get_decision(decision_id: str, user: dict = Depends(get_current_user)):
    from server import enrich_decision  # deferred
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if user["id"] not in await _decision_participants(user["tenant_id"], d):
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    return await enrich_decision(d, tenant_id=user["tenant_id"])


@router.get("/decisions/{decision_id}/timeline")
async def decision_timeline(decision_id: str, user: dict = Depends(get_current_user)):
    d = await db.decisions.find_one(
        {"id": decision_id, "tenant_id": user["tenant_id"]},
        {"_id": 0, "id": 1, "title": 1, "status": 1, "timeline": 1, "created_by": 1},
    )
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if user["id"] not in await _decision_participants(user["tenant_id"], d):
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    tl = sorted(d.get("timeline", []), key=lambda e: e.get("ts", ""))
    return {"title": d.get("title"), "status": d.get("status"), "timeline": tl}


@router.get("/journal")
async def ceo_journal(q: str = "", user: dict = Depends(require_perm("brain"))):
    tid = user["tenant_id"]
    tokens = [re.escape(t) for t in q.split() if len(t) >= 2]
    rx = {"$regex": "|".join(tokens), "$options": "i"} if tokens else {"$exists": True}
    dfilter = {"tenant_id": tid, "$or": [{"title": rx}, {"summary": rx}]} if tokens else {"tenant_id": tid}
    decisions = await db.decisions.find(
        dfilter,
        {"_id": 0, "id": 1, "title": 1, "dtype": 1, "status": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(500)
    mfilter = {"tenant_id": tid, "text": rx} if tokens else {"tenant_id": tid}
    memory = await db.memory.find(
        mfilter, {"_id": 0, "id": 1, "text": 1, "tag": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(500)
    days = {}
    for d in decisions:
        day = (d.get("created_at") or "")[:10]
        days.setdefault(day, {"date": day, "decisions": [], "notes": []})["decisions"].append(d)
    for m in memory:
        day = (m.get("created_at") or "")[:10]
        days.setdefault(day, {"date": day, "decisions": [], "notes": []})["notes"].append(m)
    return {"days": sorted(days.values(), key=lambda x: x["date"], reverse=True)}


@router.post("/decisions/{decision_id}/tasks")
async def add_decision_task(decision_id: str, inp: TaskCreateInput, user: dict = Depends(require_perm("decisions_approve"))):
    from server import (  # deferred
        tenant_role_keys,
        add_decision_event,
        log_activity,
        enrich_decision,
    )
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    troles = await tenant_role_keys(user["tenant_id"])
    assignee_id = inp.assignee_id
    role = inp.assignee_role if inp.assignee_role in troles else None
    member = None
    if assignee_id:
        member = await db.users.find_one(
            {"id": assignee_id, "tenant_id": user["tenant_id"]},
            {"_id": 0, "role": 1, "name": 1},
        )
        if not member:
            assignee_id = None
        else:
            role = member["role"]
    due = None
    if isinstance(inp.due_in_days, int):
        due = (datetime.now(timezone.utc) + timedelta(days=inp.due_in_days)).isoformat()
    # Blocked while the decision is still pending; unblocks on approval like the rest.
    status = "blocked" if d.get("status") == "pending_approval" else ("cancelled" if d.get("status") == "rejected" else "todo")
    tid = new_id()
    # WE-01: link to the decision's workflow if the caller supplied
    # workflow_id explicitly OR if the decision spawned exactly one
    # workflow (the common voice-capture case). derive_task_workflow_link
    # falls back to the decision_id lookup automatically.
    from services.workflows import derive_task_workflow_link
    try:
        link_wf, link_stage = await derive_task_workflow_link(
            user["tenant_id"],
            workflow_id=inp.workflow_id,
            stage_key=inp.stage_key,
            decision_id=decision_id,
            strict=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": role, "assignee_id": assignee_id, "priority": inp.priority or "medium",
        "status": status, "due_date": due, "decision_id": decision_id, "source": "manual", "created_at": now_iso(),
        "workflow_id": link_wf, "stage_key": link_stage,  # WE-01
    })
    # FIX-001-C: tenant-scoped write (was update_one({"id": ...}) alone).
    await db.decisions.update_one(tenant_filter(decision_id, user["tenant_id"]), {"$push": {"task_ids": tid}})
    who = None
    if assignee_id:
        who = (member or {}).get("name")
    who = who or role or "team"
    await add_decision_event(decision_id, f"Task added for {who}: {inp.title}", user["name"], "assigned")
    await log_activity(user["tenant_id"], user["id"], "decision_task_added",
                       f"Added task '{inp.title}' to '{d['title']}' for {who}", "decision", decision_id)
    # FIX-003-B (S2-05): explicit tenant_id for defense-in-depth.
    return await enrich_decision(
        await db.decisions.find_one(tenant_filter(decision_id, user["tenant_id"]), {"_id": 0}),
        tenant_id=user["tenant_id"],
    )


@router.post("/decisions/{decision_id}/approve")
async def approve_decision(decision_id: str, user: dict = Depends(require_perm("decisions_approve"))):
    from server import add_decision_event, log_activity, enrich_decision  # deferred
    # FIX-001-C: ensure_owned wraps the read + 404 in one call.
    d = await ensure_owned(db.decisions, decision_id, user["tenant_id"], projection=None)
    # FIX-001-C: all writes below now include tenant_id in the filter.
    await db.decisions.update_one(tenant_filter(decision_id, user["tenant_id"]),
                                  {"$set": {"status": "approved", "decided_at": now_iso()}})
    await db.tasks.update_many(
        {"tenant_id": user["tenant_id"], "decision_id": decision_id, "status": "blocked"},
        {"$set": {"status": "todo"}})
    await add_decision_event(decision_id, "Approved — tasks unblocked", user["name"], "approved")
    # Auto-advance any Procurement workflows spawned by this decision from their
    # initial "requested" stage to the pipeline's approval_stage.
    # WE-07 (2026-08-16): routed through services/workflow_engine.advance()
    # with override=True + a reason -- the decision-approval flow is
    # allowed to bypass check_stage_ready (the initial stage almost
    # never has template tasks to satisfy) but the override + reason
    # land in wf.history + audit_log so the "why did this workflow
    # advance without user input?" answer is one grep away.
    from services.workflows import tenant_procurement_pipeline, procurement_initial_stage
    from services.workflow_engine import advance as _engine_advance
    from services.workflow_engine import WorkflowAdvanceError
    proc = await tenant_procurement_pipeline(user["tenant_id"])
    wf_advanced = 0
    if proc and proc.get("approval_stage"):
        init_stage = procurement_initial_stage(proc)
        appr_stage = proc["approval_stage"]
        if init_stage and appr_stage != init_stage:
            _reason = f"Auto-advanced by decision approval ({user['name']})"
            async for wf in db.workflows.find({
                "tenant_id": user["tenant_id"], "decision_id": decision_id,
                "type": proc["key"], "stage": init_stage,
            }, {"_id": 0, "id": 1}):
                try:
                    await _engine_advance(
                        user["tenant_id"], wf["id"],
                        user["id"], user.get("name") or "",
                        user.get("role") or "",
                        target_stage=appr_stage,
                        note=_reason,
                        override=True, reason=_reason,
                    )
                    wf_advanced += 1
                except WorkflowAdvanceError as _e:
                    # Best-effort: never let a decision approval fail
                    # because one linked workflow could not advance.
                    from core import logger as _lg
                    _lg.warning(
                        f"[WE-07] decision-approve auto-advance skipped "
                        f"for workflow {wf.get('id')}: {_e}"
                    )
    if wf_advanced:
        await add_decision_event(decision_id, f"{wf_advanced} procurement workflow(s) advanced to {proc.get('approval_stage')}", user["name"], "workflow")
    # FIX-001-C: read spawned tasks with tenant filter too (defense-in-depth).
    for t in await db.tasks.find({"tenant_id": user["tenant_id"], "decision_id": decision_id}, {"_id": 0}).to_list(100):
        who = None
        if t.get("assignee_id"):
            m = await db.users.find_one({"id": t["assignee_id"], "tenant_id": user["tenant_id"]}, {"_id": 0, "name": 1})
            who = (m or {}).get("name")
        who = who or t.get("assignee_role") or "team"
        await add_decision_event(decision_id, f"Task assigned to {who}: {t['title']}", user["name"], "assigned")
    await log_activity(user["tenant_id"], user["id"], "decision_approved", f"Approved '{d['title']}' — tasks unblocked", "decision", decision_id)
    await brain_context.record_context(
        tenant_id=user["tenant_id"], kind="decision", title=d.get("title") or "Decision approved",
        outcome="approved", why=d.get("summary") or d.get("description") or "",
        tags=d.get("tags") or [], source_type="decision", source_id=decision_id,
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="public",
    )
    # FIX-003-B (S2-05): explicit tenant_id for defense-in-depth.
    return await enrich_decision(
        await db.decisions.find_one(tenant_filter(decision_id, user["tenant_id"]), {"_id": 0}),
        tenant_id=user["tenant_id"],
    )


@router.post("/decisions/{decision_id}/reject")
async def reject_decision(decision_id: str, user: dict = Depends(require_perm("decisions_approve"))):
    from server import add_decision_event, log_activity, enrich_decision  # deferred
    d = await ensure_owned(db.decisions, decision_id, user["tenant_id"], projection=None)
    await db.decisions.update_one(tenant_filter(decision_id, user["tenant_id"]),
                                  {"$set": {"status": "rejected", "decided_at": now_iso()}})
    # Remove everything this decision spawned so it disappears from all tasks & processes.
    tasks_del = await db.tasks.delete_many({"tenant_id": user["tenant_id"], "decision_id": decision_id})
    wf_del = await db.workflows.delete_many({"tenant_id": user["tenant_id"], "decision_id": decision_id})
    await db.calendar_events.delete_many({"tenant_id": user["tenant_id"], "decision_id": decision_id})
    await db.inbox.update_many({"tenant_id": user["tenant_id"], "ref_type": "decision", "ref_id": decision_id}, {"$set": {"status": "dismissed"}})
    await add_decision_event(decision_id, f"Rejected — removed {tasks_del.deleted_count} task(s), {wf_del.deleted_count} workflow(s)", user["name"], "rejected")
    await log_activity(user["tenant_id"], user["id"], "decision_rejected", f"Rejected '{d['title']}' — removed {tasks_del.deleted_count} task(s), {wf_del.deleted_count} workflow(s)", "decision", decision_id)
    await brain_context.record_context(
        tenant_id=user["tenant_id"], kind="decision", title=d.get("title") or "Decision rejected",
        outcome="rejected", why=d.get("summary") or d.get("description") or "",
        tags=d.get("tags") or [], source_type="decision", source_id=decision_id,
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="public",
    )
    # FIX-003-B (S2-05): explicit tenant_id for defense-in-depth.
    return await enrich_decision(
        await db.decisions.find_one(tenant_filter(decision_id, user["tenant_id"]), {"_id": 0}),
        tenant_id=user["tenant_id"],
    )


@router.post("/decisions/{decision_id}/comment")
async def comment_decision(decision_id: str, inp: DecisionCommentInput, user: dict = Depends(get_current_user)):
    from server import push_notification, log_activity, enrich_decision  # deferred
    d = await ensure_owned(db.decisions, decision_id, user["tenant_id"])
    participants = await _decision_participants(user["tenant_id"], d)
    if user["id"] not in participants:
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment can't be empty")
    entry = {"ts": now_iso(), "label": text, "actor": user.get("name"), "actor_id": user["id"], "kind": "comment"}
    await db.decisions.update_one(tenant_filter(decision_id, user["tenant_id"]), {"$push": {"timeline": entry}})
    recipients = [p for p in participants if p != user["id"]]
    if recipients:
        await push_notification(user["tenant_id"], recipients, 1,
                                f"New comment on '{d['title']}' from {user['name']}: {text[:100]}",
                                "decision", decision_id, ntype="comment", title=d["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "decision_comment", f"Commented on '{d['title']}'", "decision", decision_id)
    # FIX-003-B (S2-05): explicit tenant_id for defense-in-depth.
    return await enrich_decision(
        await db.decisions.find_one(tenant_filter(decision_id, user["tenant_id"]), {"_id": 0}),
        tenant_id=user["tenant_id"],
    )

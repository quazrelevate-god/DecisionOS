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

from core import db, get_current_user, require_perm, new_id, now_iso
from models.tasks import TaskCreateInput
from services.ai import brain_context
from services.tenancy import ensure_owned, tenant_filter  # FIX-001-C


from shared.due import due_day  # noqa: E402

router = APIRouter(prefix="/api")




async def _decision_participants(tenant_id: str, d: dict) -> set:
    """Everyone involved with a decision: creator, the named approver, task assignees, and owners."""
    from services.notifications import _owner_ids
    ids = set(await _owner_ids(tenant_id))
    if d.get("created_by"):
        ids.add(d["created_by"])
    if d.get("approver_id"):  # ASK-32: the person who has to decide can open it
        ids.add(d["approver_id"])
    async for t in db.tasks.find({"decision_id": d["id"]}, {"_id": 0, "assignee_id": 1, "co_assignee_ids": 1}):
        if t.get("assignee_id"):
            ids.add(t["assignee_id"])
        ids.update(t.get("co_assignee_ids") or [])  # 2026-09-15: helpers are on it too
    return ids


# Request models consolidated into models/ (Epic 8 Sprint 5).
from models.decisions import (
    DecisionApproveInput,
    DecisionApproverInput,
    DecisionCommentInput,
    DecisionProposalTaskInput,
)


@router.get("/decisions")
async def list_decisions(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    from services.enrich import enrich_decisions
    q = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    if user.get("role") != "owner":
        # RBAC P1 (2026-09-15): only decisions this person can open — the same
        # people get_decision lets in. Every title in the company was listed.
        mine = [t["decision_id"] async for t in db.tasks.find(
            {"tenant_id": user["tenant_id"], "decision_id": {"$nin": [None, ""]},
             "$or": [{"assignee_id": user["id"]}, {"co_assignee_ids": user["id"]}]},
            {"_id": 0, "decision_id": 1})]
        q["$or"] = [{"created_by": user["id"]}, {"approver_id": user["id"]}, {"id": {"$in": mine}}]
    decisions = await db.decisions.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    # FIX-003-B (S2-05): explicit tenant_id makes the defense-in-depth
    # filter unconditional even in the (unlikely) case where a decision
    # doc lost its tenant_id field.
    return await enrich_decisions(decisions, tenant_id=user["tenant_id"])


@router.get("/decisions/{decision_id}")
async def get_decision(decision_id: str, user: dict = Depends(get_current_user)):
    from services.enrich import enrich_decision
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
    from core import tenant_role_keys, add_decision_event, log_activity
    from services.enrich import enrich_decision
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    # RBAC P1 (2026-09-15): only someone on the decision, or who may decide it.
    from services.decision_flow import can_decide
    if user["id"] not in await _decision_participants(user["tenant_id"], d) and not can_decide(user, d):
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
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
    # RBAC P1 (2026-09-15): the same rule as New Task — work goes only to people
    # (or the team) this person may give work to.
    from routers.tasks import _check_assignable
    await _check_assignable(user, assignee_id, role if (role and not assignee_id) else None)
    due = None
    if isinstance(inp.due_in_days, int):
        due = due_day(inp.due_in_days)   # a day, not an instant (shared/due.py)
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


@router.get("/decisions/{decision_id}/moves")
async def decision_moves(decision_id: str, user: dict = Depends(get_current_user)):
    """The cards approving this decision will move, and the open work each
    would leave behind -- what the review asks about (2026-09-21)."""
    from services.decision_flow import moves_preview
    return await moves_preview(user, decision_id)


@router.post("/decisions/{decision_id}/approve")
async def approve_decision(decision_id: str, inp: Optional[DecisionApproveInput] = None,
                           user: dict = Depends(require_perm("decisions_approve"))):
    """ASK-32 Phase 1: only while pending, only by the named approver or an
    owner; creates what the decision proposed (services.decision_flow).
    2026-09-21: `resolutions` -- what happens to work a moved card leaves
    behind (task id -> done | not_needed | keep; unnamed tasks are kept)."""
    from services.decision_flow import approve_decision_flow
    from services.enrich import enrich_decision
    d = await approve_decision_flow(user, decision_id, resolutions=(inp.resolutions if inp else None))
    # FIX-003-B (S2-05): explicit tenant_id for defense-in-depth.
    return await enrich_decision(d, tenant_id=user["tenant_id"])


@router.post("/decisions/{decision_id}/reject")
async def reject_decision(decision_id: str, user: dict = Depends(require_perm("decisions_approve"))):
    """ASK-32 Phase 1: nothing proposed is created; work already under way on an
    older decision is never deleted (services.decision_flow)."""
    from services.decision_flow import reject_decision_flow
    from services.enrich import enrich_decision
    d = await reject_decision_flow(user, decision_id)
    return await enrich_decision(d, tenant_id=user["tenant_id"])


@router.patch("/decisions/{decision_id}/proposal/tasks/{key}")
async def edit_decision_proposal_task(decision_id: str, key: str, inp: DecisionProposalTaskInput,
                                      user: dict = Depends(get_current_user)):
    """ASK-32 Phase 3 — before approving: who does a proposed task, and when it is due.
    ASK-50 — and its priority, whether it needs proof, and whether and when it
    needs approving; applied when approval creates the task."""
    from services.decision_flow import edit_proposal_task
    from services.enrich import enrich_decision
    d = await edit_proposal_task(user, decision_id, key, assignee_id=inp.assignee_id, due_date=inp.due_date,
                                 priority=inp.priority, evidence_required=inp.evidence_required,
                                 approval_required=inp.approval_required, approval_stage=inp.approval_stage,
                                 approver_id=inp.approver_id)
    return await enrich_decision(d, tenant_id=user["tenant_id"])


@router.delete("/decisions/{decision_id}/proposal/{kind}/{key}")
async def remove_decision_proposal_item(decision_id: str, kind: str, key: str, user: dict = Depends(get_current_user)):
    """ASK-32 Phase 3 — before approving: drop a proposed task, workflow, meeting, reminder or note."""
    from services.decision_flow import remove_proposal_item
    from services.enrich import enrich_decision
    d = await remove_proposal_item(user, decision_id, kind, key)
    return await enrich_decision(d, tenant_id=user["tenant_id"])


@router.get("/decisions/{decision_id}/approvers")
async def decision_approvers(decision_id: str, user: dict = Depends(get_current_user)):
    """ASK-32 2.5 — the people this decision can be handed to (anyone who may decide)."""
    from services.decision_flow import decision_deciders
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1, "created_by": 1, "approver_id": 1})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if user["id"] not in await _decision_participants(user["tenant_id"], d):
        raise HTTPException(status_code=403, detail="You don't have access to this decision")
    return await decision_deciders(user["tenant_id"])


@router.post("/decisions/{decision_id}/approver")
async def change_decision_approver(decision_id: str, inp: DecisionApproverInput, user: dict = Depends(get_current_user)):
    """ASK-32 2.5 — an owner, or the person it waits on, hands it to someone else who may decide."""
    from services.decision_flow import change_approver_flow
    from services.enrich import enrich_decision
    d = await change_approver_flow(user, decision_id, inp.approver_id)
    return await enrich_decision(d, tenant_id=user["tenant_id"])


@router.post("/decisions/{decision_id}/comment")
async def comment_decision(decision_id: str, inp: DecisionCommentInput, user: dict = Depends(get_current_user)):
    from core import log_activity
    from services.enrich import enrich_decision
    from services.notifications import push_notification
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

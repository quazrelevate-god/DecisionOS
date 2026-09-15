"""Tasks router — the FULL task-lifecycle surface.

Owns 17 endpoints across the entire task lifecycle:
  Leaf reads/deletes:
    • GET     /api/tasks                                 — list (?status, ?mine)
    • GET     /api/tasks/{id}                            — detail
    • DELETE  /api/tasks/{id}                            — owner-only delete
  Create + patch:
    • POST    /api/tasks                                 — create (routes to a role member if unassigned)
    • PATCH   /api/tasks/{id}                            — update status/assignee/progress
  Assignment:
    • POST    /api/tasks/{id}/reassign                   — move to another member or role
  Approval loop (pre-execution):
    • POST    /api/tasks/{id}/approve                    — unblock work
    • POST    /api/tasks/{id}/reject                     — request changes (keeps blocked)
    • POST    /api/tasks/{id}/clarify                    — approver asks a question
  Execution plan (AI):
    • POST    /api/tasks/{id}/execution-plan/generate    — Claude generates steps
    • PATCH   /api/tasks/{id}/execution-plan             — save edited steps
    • DELETE  /api/tasks/{id}/execution-plan             — clear plan
    • POST    /api/tasks/{id}/steps/ask                  — AI help on a single step
  Collaboration:
    • POST    /api/tasks/{id}/updates                    — note / handoff / escalate
    • POST    /api/tasks/{id}/respond                    — reply to a handoff / escalation
  Ranking:
    • POST    /api/tasks/prioritize                      — score open tasks with Claude
  Files:
    • POST    /api/tasks/{id}/attachment                 — upload evidence / reference / photo / voice

Server-level helpers (defined in `server.py`, deferred-imported inside handlers
to avoid the server↔router import cycle):
  `pick_least_loaded_member`, `_owner_ids`, `_approver_ids`, `push_notification`,
  `_store_file`, `_file_public`, `_analyze_reference_file`, `_tenant_currency`,
  `ai_execution_plan`, `ai_step_assist`, `ai_score_tasks`.

Task-only helpers (defined here, since they're not called from anywhere else):
  `_can_approve_task`, `_tenant_industry`, `_resolve_task_handoff`,
  `_attach_reference_ids`.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile

from core import (
    db,
    get_current_user,
    new_id,
    now_iso,
    user_perms,
    tenant_role_keys,
    log_activity,
    add_decision_event,
    require_role,
    require_perm,
)
from models.tasks import (
    TaskCreateInput,
    TaskUpdateInput,
    TaskReassignInput,
    TaskRejectInput,
    ExecPlanInput,
    StepAskInput,
    TaskUpdateNoteInput,
    RespondInput,
)
from services.ai import brain_context
from services.tenancy import tenant_filter  # FIX-001-C
from services.tasks import (
    APPROVAL_STAGES,
    OPEN_STATUSES,
    TASK_STATUSES,
    approval_stage,
    assignee_ids_of,
    can_assign_person,
    can_assign_team,
    can_see_all_tasks,
    can_note_task,
    clean_co_assignees,
    completion_updates,
    edit_refusal,
    escalation_manager_id,
    is_start_locked,
    manages_task,
    reopen_updates,
    status_change_clears_waiting,
    task_edit_rights,
    task_list_query,
    waiting_updates,
    _attach_reference_ids,
    _can_work_task,
    _plan_progress,
    enrich_task,
    enrich_tasks,
)
# NB: _tenant_industry is defined locally below (identical logic); the services.tasks
# import was dead (immediately shadowed) -- removed in Epic 8 Sprint 8 (U8-08.2).


router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# FUP-50 (2026-08-15): auto-create a PENDING sales-invoice row when an
# invoice-raise task is marked done. Kills the 'INVOICES=0 / Brain says
# data gap' cash-flow blind spot without waiting on the WE-06 side-
# effects framework. Deliberately narrow trigger + minimal payload;
# founder/finance fill in HSN / GST rate / advance details from the
# Finance page.
# ---------------------------------------------------------------------------
_INVOICE_KEYWORDS = ("invoice", "gst bill", "raise bill", "issue bill",
                     "sales invoice", "billing", "raise gst")


def _looks_like_invoice_task(task: dict) -> bool:
    title = (task.get("title") or "").lower()
    if not any(k in title for k in _INVOICE_KEYWORDS):
        return False
    # Must have SOMETHING to seed the invoice with -- a contact link
    # or a numeric amount. Without either, we'd write a useless row.
    return bool(task.get("contact_id") or task.get("customer_id")
                or task.get("amount") or task.get("invoice_meta"))


async def _maybe_auto_invoice(tenant_id: str, actor_id: str,
                              task: dict, task_id: str) -> None:
    """Idempotent: if we've already created an invoice for this task,
    do nothing. Uses invoices.source_task_id as the dedup key."""
    if not _looks_like_invoice_task(task):
        return
    existing = await db.invoices.find_one(
        {"tenant_id": tenant_id, "source_task_id": task_id},
        {"_id": 0, "id": 1})
    if existing:
        return
    meta = task.get("invoice_meta") or {}
    contact_id = task.get("contact_id") or task.get("customer_id") or meta.get("contact_id")
    contact_name = task.get("contact_name") or meta.get("contact_name") or ""
    if contact_id and not contact_name:
        c = await db.contacts.find_one({"id": contact_id, "tenant_id": tenant_id},
                                        {"_id": 0, "name": 1, "company": 1})
        if c:
            contact_name = c.get("company") or c.get("name") or ""
    amount = float(task.get("amount") or meta.get("amount") or 0)
    today = datetime.now(timezone.utc).date().isoformat()
    doc = {
        "id": new_id(),
        "tenant_id": tenant_id,
        "type": "sales_invoice",
        "status": "draft",           # explicit -- founder must confirm in Finance
        "source": "auto_from_task",  # audit trail
        "source_task_id": task_id,
        "contact_id": contact_id,
        "contact_name": contact_name,
        "amount": amount,
        "amount_paid": 0,
        "date": today,
        "due_date": today,
        "number": "",                # user fills at review
        "notes": (
            f"Auto-drafted from completed task '{task.get('title', '')}'. "
            "Fill in invoice number, HSN, GST rate, and confirm amount "
            "before sending to the customer."),
        "created_by": actor_id,
        "created_at": now_iso(),
    }
    await db.invoices.insert_one(dict(doc))
    await log_activity(tenant_id, actor_id, "invoice_auto_drafted",
                       f"Auto-drafted invoice from task '{task.get('title', '')}'",
                       "invoice", doc["id"])


# ---------------------------------------------------------------------------
# Task-only helpers (called only by handlers in this router)
# ---------------------------------------------------------------------------
def _can_approve_task(user: dict, t: dict) -> bool:
    if user["role"] == "owner":
        return True
    if t.get("approver_id"):
        return user["id"] == t.get("approver_id")
    # No specific approver assigned → anyone granted the "approvals" access can approve.
    return "approvals" in user_perms(user)


async def _member_can_approve(tenant_id: str, member: dict) -> bool:
    """ASK-28 TK-05 / plan 4.3 — may this member approve tasks? The owner, or
    anyone whose effective permissions (own list, else the company's role
    settings, else the role default — the same order as get_current_user)
    include `approvals`."""
    if member.get("role") == "owner":
        return True
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    role_map = {r["key"]: list(r["permissions"]) for r in ((tenant or {}).get("roles") or [])
                if r.get("key") and isinstance(r.get("permissions"), list) and r.get("permissions")}
    return "approvals" in user_perms({**member, "_role_perms_map": role_map})


async def _team_ids(user: dict) -> list:
    """ASK-28 TK-03 — my direct reports: people whose Reporting Manager is me."""
    rows = await db.users.find({"tenant_id": user["tenant_id"], "reporting_manager_id": user["id"]},
                               {"_id": 0, "id": 1}).to_list(500)
    return [r["id"] for r in rows]


async def _check_assignable(user: dict, lead_id: Optional[str] = None, team_key: Optional[str] = None,
                            helper_ids=()) -> None:
    """ASK-28 TK-08 (plan 6.3, D1) — refuse work given to someone the person may
    not assign to: a doer, the team a task is routed to, or added helpers. The
    owner and holders of "Assign tasks to anyone" pass; everyone else may give
    work to themselves, their own team and their direct reports."""
    perms = user_perms(user)
    if user.get("role") == "owner" or "tasks_assign_any" in perms:
        return
    if team_key and not can_assign_team(user, team_key, perms):
        raise HTTPException(status_code=403, detail=(
            "You can hand tasks to your own team only. Ask someone with \"Assign tasks to anyone\" "
            "to give this to another team."))
    ids = [i for i in dict.fromkeys([lead_id, *(helper_ids or [])]) if i]
    if not ids:
        return
    team_ids = await _team_ids(user)
    people = {u["id"]: u for u in await db.users.find(
        {"tenant_id": user["tenant_id"], "id": {"$in": ids}}, {"_id": 0, "id": 1, "role": 1, "name": 1}).to_list(len(ids))}
    for i in ids:
        target = people.get(i)
        if target and not can_assign_person(user, target, team_ids, perms):
            raise HTTPException(status_code=403, detail=(
                f"You can give tasks to yourself, your own team or the people who report to you, not "
                f"{target.get('name') or 'that person'}. Ask someone with \"Assign tasks to anyone\"."))


async def _tenant_industry(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "industry": 1})
    return (t or {}).get("industry") or "general"


async def _resolve_task_handoff(user, t, task_id, action, text, step_text, inp):
    """Resolve the target for a handoff/escalation and create the follow-up task."""
    tenant_id = user["tenant_id"]
    to_name = to_id = to_role = None
    notify_level, notify_prefix = 2, "[Handoff]"
    if action == "escalate":
        # ASK-28 Phase 7 (plan 7.3): escalate to your reporting manager first;
        # the owner only when you have none — the automatic reminders climb the
        # same way (services/tasks.followup_level).
        me = await db.users.find_one({"id": user["id"], "tenant_id": tenant_id}, {"_id": 0, "id": 1, "reporting_manager_id": 1})
        mid = escalation_manager_id(me)
        target = await db.users.find_one({"id": mid, "tenant_id": tenant_id}, {"_id": 0}) if mid else None
        if not target:
            target = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0})
        if not target:
            raise HTTPException(status_code=400, detail="No manager or owner to escalate to")
        to_id, to_name, to_role = target["id"], target.get("name"), target.get("role")
        notify_level, notify_prefix = 3, "[Escalation]"
    elif inp.to_id:
        member = await db.users.find_one({"id": inp.to_id, "tenant_id": tenant_id}, {"_id": 0})
        if not member:
            raise HTTPException(status_code=404, detail="Team member not found")
        to_id, to_name, to_role = member["id"], member.get("name"), member.get("role")
    elif inp.to_role:
        if inp.to_role not in await tenant_role_keys(tenant_id):
            raise HTTPException(status_code=400, detail="Invalid role")
        to_role, to_name = inp.to_role, inp.to_role
    else:
        raise HTTPException(status_code=400, detail="Choose a person or team to hand off to")

    followup_task_id = new_id()
    base = step_text or t.get("title", "task")
    await db.tasks.insert_one({
        "id": followup_task_id, "tenant_id": tenant_id,
        "title": f"Follow-up: {base}"[:180],
        "description": f"Handed off by {user['name']} on '{t.get('title')}'.\nContext: {text}",
        "assignee_id": to_id if inp.to_id or action == "escalate" else None,
        "assignee_role": to_role,
        "priority": "high" if action == "escalate" else (t.get("priority") or "medium"),
        "status": "todo", "due_date": t.get("due_date"),
        "decision_id": t.get("decision_id"), "parent_task_id": task_id,
        # WE-01: a handoff/escalation follow-up inherits the parent
        # task's workflow linkage so the child appears on the same
        # stage of the same card. If parent was ad-hoc, child is too.
        "workflow_id": t.get("workflow_id"),
        "stage_key": t.get("stage_key"),
        "raised_by": user["id"], "raised_by_name": user.get("name"),
        "raised_step_text": step_text, "raised_note": text,
        "source": "escalation" if action == "escalate" else "handoff", "created_at": now_iso(),
    })
    if to_id:
        notify_ids = [to_id]
    else:
        role_members = await db.users.find({"tenant_id": tenant_id, "role": to_role}, {"_id": 0, "id": 1}).to_list(50)
        notify_ids = [m["id"] for m in role_members]
    return {"followup_task_id": followup_task_id, "to_id": to_id, "to_name": to_name, "to_role": to_role,
            "notify_ids": notify_ids, "notify_level": notify_level, "notify_prefix": notify_prefix}


# ---------------------------------------------------------------------------
# Leaf reads / deletes
# ---------------------------------------------------------------------------
@router.get("/tasks")
async def list_tasks(
    status: Optional[str] = None,
    mine: Optional[bool] = False,
    view: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    # ?mine=true (My Work / personal): only tasks assigned to ME + unclaimed role-pool tasks.
    #   Excludes tasks assigned to other specific members of my role.
    # Non-owner team board (mine=false): the whole role lane (any member of my role + role-level tasks).
    # Owner (mine=false): everything.
    # ASK-28 TK-01: ?view=asked — tasks I created for other people ("Asked by me").
    # ASK-28 TK-02: ?view=approvals — tasks waiting for MY approval.
    # ASK-28 TK-03: ?view=team — work my direct reports are doing or helping on.
    q = task_list_query(user, mine=bool(mine), view=view, status=status,
                        can_approve_any="approvals" in user_perms(user),
                        team_ids=await _team_ids(user) if view == "team" else None,
                        see_all=can_see_all_tasks(user, user_perms(user)))  # ASK-28 TK-08
    tasks = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await enrich_tasks(tasks)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = (user.get("role") == "owner" or "tasks_view_all" in user_perms(user)  # ASK-28 TK-08
               or _can_work_task(user, t)
               or t.get("approver_id") == user["id"] or t.get("created_by") == user["id"]
               or (t.get("waiting_on") or {}).get("user_id") == user["id"]  # ASK-28 TK-07: waited on
               or manages_task(t, await _team_ids(user)))  # ASK-28 TK-03: their manager
    if not allowed:
        raise HTTPException(status_code=403, detail="You don't have access to this work")
    return await enrich_task(t)


# ---------------------------------------------------------------------------
# ASK-29 — the task's activity timeline
# ---------------------------------------------------------------------------
# Every event on a task is written to db.activity (log_activity), and the
# drawer's Activity section reads them back as one timeline. `message` keeps
# the task title for the tenant-wide feeds (Dashboard, Brief); `detail` is the
# short line the task's own timeline shows, where repeating the title is noise.
_STATUS_WORDS = {
    "todo": "Not Started", "in_progress": "In Progress", "waiting": "Waiting",
    "review": "Under Review", "done": "Completed", "cancelled": "Cancelled",
    "blocked": "Pending Approval",
}
# Notes, hand-offs and escalations carry their full text (step, target) on the
# task's own `updates` trail, so the log's copy of them is skipped to avoid
# listing each one twice.
_TRAIL_LOG_KINDS = {"task_note", "task_handoff", "task_escalate", "handoff_resolved"}
_TRAIL_KIND = {"note": "task_note", "handoff": "task_handoff", "escalate": "task_escalate",
               "response": "task_reply", "handoff_reply": "task_reply"}


async def _log_task_event(user: dict, task_id: str, kind: str, message: str, detail: str) -> None:
    """log_activity, plus the short `detail` line for the task's timeline."""
    await db.activity.insert_one({
        "id": new_id(), "tenant_id": user["tenant_id"], "actor": user["id"], "kind": kind,
        "message": message, "detail": detail, "entity_type": "task", "entity_id": task_id,
        "created_at": now_iso(),
    })


def _timeline_text(row: dict) -> str:
    """The timeline line for a log row. Rows written before `detail` existed
    fall back to a fixed phrase per kind, so old tasks read cleanly too."""
    if row.get("detail"):
        return row["detail"]
    kind, msg = row.get("kind"), row.get("message") or ""
    fixed = {
        "task_created": "Created the task", "task_done": "Marked complete",
        "task_approved": "Approved — work can start", "task_rejected": "Requested changes",
        "task_clarify": "Asked for clarification", "task_people": "Updated who is on the task",
        "invoice_auto_drafted": "Drafted an invoice from this task",
    }
    if kind in fixed:
        return fixed[kind]
    if kind == "task_assigned" and " to " in msg:
        return ("Reassigned to " if msg.startswith("Reassigned") else "Assigned to ") + msg.rsplit(" to ", 1)[1]
    return msg


@router.get("/tasks/{task_id}/activity")
async def task_activity(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = (user.get("role") == "owner" or "tasks_view_all" in user_perms(user)  # ASK-28 TK-08
               or _can_work_task(user, t)
               or t.get("approver_id") == user["id"] or t.get("created_by") == user["id"]
               or (t.get("waiting_on") or {}).get("user_id") == user["id"]  # ASK-28 TK-07: waited on
               or manages_task(t, await _team_ids(user)))  # ASK-28 TK-03: their manager
    if not allowed:
        raise HTTPException(status_code=403, detail="You don't have access to this work")
    rows = await db.activity.find(
        {"tenant_id": user["tenant_id"], "entity_type": "task", "entity_id": task_id}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)
    rows = [r for r in rows if r.get("kind") not in _TRAIL_LOG_KINDS]
    actor_ids = list({r.get("actor") for r in rows if r.get("actor")})
    names = {}
    if actor_ids:
        for u in await db.users.find({"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(actor_ids)):
            names[u["id"]] = u.get("name")
    items = [{
        "id": r.get("id"), "kind": r.get("kind"), "text": _timeline_text(r),
        "actor_name": names.get(r.get("actor")), "created_at": r.get("created_at"),
    } for r in rows]
    for u in t.get("updates") or []:
        items.append({
            "id": u.get("id"), "kind": _TRAIL_KIND.get(u.get("kind"), f"task_{u.get('kind')}"),
            "text": u.get("text") or "", "actor_name": u.get("author_name"),
            "to_name": u.get("to_name"), "step_text": u.get("step_text"), "created_at": u.get("created_at"),
        })
    items.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return items


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(require_role("owner"))):
    # FIX-004-C (RBAC-07): decorator gate now matches the inline
    # `role != "owner"` check that already existed. Belt-and-braces —
    # the decorator is what a reviewer reading the endpoint list will
    # notice, so it's the authoritative signal.
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can delete tasks")
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    await db.tasks.delete_one({"id": task_id, "tenant_id": user["tenant_id"]})
    return {"ok": True, "deleted": task_id}


# ---------------------------------------------------------------------------
# Create + patch
# ---------------------------------------------------------------------------
@router.post("/tasks")
async def create_task(inp: TaskCreateInput, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    from services.notifications import _approver_ids, push_notification
    from services.voice import pick_least_loaded_member
    from services.workflows import derive_task_workflow_link  # WE-01
    # ASK-28 TK-08 (plan 6.2): creating a task needs the Tasks permission (on for
    # every role by default; the owner can switch it off for someone).
    if "tasks" not in user_perms(user):
        raise HTTPException(status_code=403, detail="You don't have access to create tasks.")
    tid = new_id()
    # WE-01: resolve workflow linkage BEFORE the DB write. If the user
    # supplied an invalid workflow_id or a cross-tenant one, this
    # raises ValueError and we translate to 400 so the client sees
    # the reason instead of the task landing silently unlinked.
    try:
        link_wf, link_stage = await derive_task_workflow_link(
            user["tenant_id"],
            workflow_id=inp.workflow_id,
            stage_key=inp.stage_key,
            strict=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    due = None
    if inp.due_date:
        due = f"{inp.due_date}T{inp.due_time}:00" if inp.due_time else inp.due_date
    elif isinstance(inp.due_in_days, int):
        due = (datetime.now(timezone.utc) + timedelta(days=inp.due_in_days)).isoformat()
    troles = await tenant_role_keys(user["tenant_id"])
    assignee_id = inp.assignee_id
    role = inp.assignee_role if inp.assignee_role in troles else None
    if assignee_id:
        member = await db.users.find_one({"id": assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1})
        if not member:
            assignee_id = None
        elif not role:
            role = member["role"]
    auto_assigned = None
    if not assignee_id and role:
        # Smart assignment: route a role-level task to the least-loaded member of that role.
        assignee_id = await pick_least_loaded_member(user["tenant_id"], role)
        # ASK-28 TK-06: say where it went and why, instead of a silent pick.
        if assignee_id:
            auto_assigned = {"role": role, "rule": "fewest_open_tasks"}
    # ASK-26: the people alongside the lead. With neither a lead nor a role to
    # route by, the first of them becomes the lead, so a task with people on
    # it always has someone accountable for it.
    co_ids = await clean_co_assignees(user["tenant_id"], inp.co_assignee_ids, assignee_id)
    if not assignee_id and not role and co_ids:
        assignee_id = co_ids.pop(0)
        lead = await db.users.find_one({"id": assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1})
        role = (lead or {}).get("role")
    task_type = (inp.task_type or "").strip() or None
    # ASK-28 TK-08 (plan 6.3): checked on what the person chose — a doer, a team
    # to route to, helpers — not the member the least-busy rule then picks.
    chosen_lead = assignee_id if (assignee_id and not auto_assigned) else None
    routed_team = role if (inp.assignee_role and role == inp.assignee_role and not chosen_lead) else None
    await _check_assignable(user, chosen_lead, routed_team, co_ids)
    # Plan 4.3: a named approver must be able to approve. Someone outside the
    # company is still dropped (anyone with approval access approves instead).
    approver_id = None
    if inp.approver_id:
        approver = await db.users.find_one({"id": inp.approver_id, "tenant_id": user["tenant_id"]},
                                           {"_id": 0, "id": 1, "name": 1, "role": 1, "permissions": 1})
        if approver:
            if not await _member_can_approve(user["tenant_id"], approver):
                raise HTTPException(status_code=400, detail=(
                    f"{approver.get('name') or 'That person'} can't approve tasks. Pick someone with approval "
                    "access, or leave it as anyone with approval access."))
            approver_id = approver["id"]
    progress = max(0, min(100, inp.progress)) if isinstance(inp.progress, int) else 0
    needs_approval = bool(inp.approval_required)
    # ASK-28 TK-05: approval before work starts locks the task now; approval
    # before closing leaves it open to work and asks only when it is completed.
    stage = (inp.approval_stage if inp.approval_stage in APPROVAL_STAGES else "start") if needs_approval else None
    lock_now = stage == "start"
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": role, "assignee_id": assignee_id, "priority": inp.priority or "medium",
        "co_assignee_ids": co_ids, "auto_assigned": auto_assigned,
        "status": "blocked" if lock_now else "todo", "due_date": due, "decision_id": None,
        "source": "manual", "created_at": now_iso(),
        "task_type": task_type, "op_category": inp.op_category or None,
        "expected_output": inp.expected_output or None, "approval_required": needs_approval,
        "approval_status": "pending" if lock_now else None, "approval_stage": stage,
        "approver_id": approver_id, "progress": progress, "created_by": user["id"],
        "evidence_required": bool(inp.evidence_required),
        # FUP-50: carry finance metadata forward so the FUP-50 auto-
        # invoice hook has something to seed the draft with.
        "contact_id": inp.contact_id,
        "contact_name": inp.contact_name or "",
        "amount": inp.amount,
        # WE-01: workflow linkage (both None for ad-hoc tasks).
        "workflow_id": link_wf,
        "stage_key": link_stage,
        "updated_at": now_iso(), "last_action": "Created",
    })
    if inp.reference_file_ids:
        await _attach_reference_ids(user["tenant_id"], user["id"], tid, inp.reference_file_ids, background)
    if lock_now:
        approvers = [approver_id] if approver_id else await _approver_ids(user["tenant_id"])
        await push_notification(user["tenant_id"], approvers, 2,
                                f"Approval needed before work starts: '{inp.title}'", "task", tid,
                                ntype="approval", title=inp.title, sender=user["name"])
    else:
        # ASK-26: everyone on the task hears about it, not only the lead.
        to_notify = [i for i in assignee_ids_of({"assignee_id": assignee_id, "co_assignee_ids": co_ids})
                     if i != user["id"]]
        if to_notify:
            await push_notification(user["tenant_id"], to_notify, 1,
                                    f"New work assigned: '{inp.title}'", "task", tid,
                                    ntype="assigned", title=inp.title, sender=user["name"])
    await _log_task_event(user, tid, "task_created", f"Created task '{inp.title}'", "Created the task")
    return await enrich_task(await db.tasks.find_one({"id": tid}, {"_id": 0}))


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, inp: TaskUpdateInput, user: dict = Depends(get_current_user)):
    from services.notifications import _owner_ids, push_notification
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {k: v for k, v in inp.model_dump(exclude_unset=True).items() if v is not None}
    # E2-59: reject invalid status instead of silent .pop() -- otherwise
    # client sees 200 with the task unchanged and thinks its edit stuck.
    if "status" in updates and updates["status"] not in TASK_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{updates['status']}'. Use one of: {sorted(TASK_STATUSES)}",
        )
    # ASK-28 item 7 (plan 6.7): changing a task is held to the people who run it
    # (services/tasks.task_edit_rights) — before, any member of the company could.
    if user.get("role") != "owner":
        refusal = edit_refusal(t, updates, task_edit_rights(user, t, await _team_ids(user), user_perms(user)))
        if refusal:
            raise HTTPException(status_code=403, detail=refusal)
    # ASK-28 TK-07: "Waiting on" a colleague or a name, and since when. It sets
    # the stored status to waiting; an empty waiting_on stops waiting (back to
    # Doing). Any other status change ends the wait. Both then pass the same
    # gates as a status change (the start-approval lock, approval to close).
    if "waiting_on" in updates:
        spec = updates.pop("waiting_on") or {}
        if t.get("status") in ("done", "cancelled"):
            raise HTTPException(status_code=400, detail="A finished task isn't waiting on anyone.")
        member = None
        if isinstance(spec, dict) and spec.get("user_id"):
            member = await db.users.find_one({"id": spec["user_id"], "tenant_id": user["tenant_id"]},
                                             {"_id": 0, "id": 1, "name": 1})
        if spec or t.get("status") == "waiting" or t.get("waiting_on"):
            try:
                updates.update(waiting_updates(spec if isinstance(spec, dict) else {}, member, user["id"], now_iso()))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
    elif "status" in updates:
        updates.update(status_change_clears_waiting(t, updates["status"]))
    if "progress" in updates:
        updates["progress"] = max(0, min(100, int(updates["progress"])))
        # ASK-28: a task with a checklist takes its progress from the list —
        # the drawer locks its % control to it — so a manual value (including
        # a reopen's progress:0) is replaced by the checklist's own number.
        # Completing the task still sets 100 just below.
        plan_steps = (t.get("execution_plan") or {}).get("steps") or []
        if plan_steps:
            updates["progress"] = _plan_progress(plan_steps)
    if updates.get("status") == "done":
        updates["progress"] = 100
    # Completion-evidence gate: tasks flagged evidence_required need >=1 evidence file before "done".
    if updates.get("status") == "done" and t.get("evidence_required"):
        # Any assignee-uploaded proof (photo/voice/evidence/file) satisfies the gate; reference material does not.
        has_ev = any((a or {}).get("kind") != "reference" for a in (t.get("attachments") or []))
        if not has_ev:
            raise HTTPException(status_code=400,
                                detail="This task requires completion evidence — attach at least one file before marking it done.")
    # Pre-execution approval gate: a task requiring approval before work starts is locked
    # (status "blocked") until the approver approves it. The assignee cannot change
    # status/progress before then. ASK-28 TK-05: approval before closing does not lock.
    if is_start_locked(t):
        if any(k in updates for k in ("status", "progress")):
            raise HTTPException(status_code=403, detail="This task is awaiting approval before work can begin.")
    # ASK-32 1.2 — a task an older decision created blocked waits for that
    # decision: nobody starts it before the decision is approved.
    if (t.get("status") == "blocked" and t.get("decision_id") and not t.get("approval_required")
            and any(k in updates for k in ("status", "progress"))):
        dec = await db.decisions.find_one({"id": t["decision_id"], "tenant_id": user["tenant_id"]},
                                          {"_id": 0, "status": 1, "title": 1})
        if dec and dec.get("status") in ("pending", "pending_approval"):
            raise HTTPException(status_code=403,
                                detail=f"This task starts when the decision “{dec.get('title') or 'it came from'}” is approved.")
    # ASK-28 TK-05: approval before closing — "done" from someone who can't approve
    # becomes a sign-off request (Under review, pending); from an approver it closes.
    signoff_requested = False
    if approval_stage(t) == "close" and "status" in updates:
        if updates["status"] == "done":
            if t.get("status") == "review" and t.get("approval_status") == "pending" and not _can_approve_task(user, t):
                raise HTTPException(status_code=409, detail="Already sent for approval — the approver will close it.")
            updates.update(completion_updates(t, _can_approve_task(user, t)))
            if updates["status"] == "done":
                updates.update({"approved_by": user["id"], "approved_at": now_iso()})
            else:
                signoff_requested = True
        else:
            updates.update(reopen_updates(t, updates["status"]))
    # E2-59: reject invalid role too instead of silent .pop().
    if "assignee_role" in updates:
        role_keys = await tenant_role_keys(user["tenant_id"])
        if updates["assignee_role"] not in role_keys:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid assignee_role '{updates['assignee_role']}'. Use one of: {sorted(role_keys)}",
            )
    if updates.get("assignee_id"):
        member = await db.users.find_one({"id": updates["assignee_id"], "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1})
        if not member:
            updates.pop("assignee_id")
        else:
            updates["assignee_role"] = member["role"]
            # ASK-28 TK-06: a person chose the doer now, so "picked automatically" no longer holds.
            if updates["assignee_id"] != t.get("assignee_id"):
                updates["auto_assigned"] = None
    # ASK-26: who is on the task. The list replaces the stored one. Who may
    # change it is checked above (item 7: the person who asked, the manager,
    # Manage Team, the owner).
    old_co = list(t.get("co_assignee_ids") or [])
    added_co: list = []
    lead_after = updates.get("assignee_id") or t.get("assignee_id")
    if "co_assignee_ids" in updates:
        updates["co_assignee_ids"] = await clean_co_assignees(user["tenant_id"], updates["co_assignee_ids"], lead_after)
        added_co = [i for i in updates["co_assignee_ids"] if i not in old_co]
    elif updates.get("assignee_id") and updates["assignee_id"] in old_co:
        # A co-assignee promoted to lead is not also listed beside themselves.
        updates["co_assignee_ids"] = [i for i in old_co if i != updates["assignee_id"]]
    # ASK-28 TK-08 (plan 6.3): a new doer, a team to route to, or added helpers
    # must be people this person may give work to. Taking someone off is free.
    new_lead = updates.get("assignee_id") if updates.get("assignee_id") and updates["assignee_id"] != t.get("assignee_id") else None
    new_team = updates.get("assignee_role") if ("assignee_role" in updates and not updates.get("assignee_id")
                                               and updates.get("assignee_role") != t.get("assignee_role")) else None
    if new_lead or new_team or added_co:
        await _check_assignable(user, new_lead, new_team, added_co)
    if updates:
        if signoff_requested:
            updates["last_action"] = "Sent for approval"
        elif updates.get("waiting_on"):
            updates["last_action"] = f"Waiting on {updates['waiting_on']['name']}"
        elif "status" in updates:
            updates["last_action"] = f"Status → {updates['status'].replace('_', ' ')}"
        elif updates.get("assignee_id"):
            updates["last_action"] = "Reassigned"
        elif "co_assignee_ids" in updates:
            updates["last_action"] = "People updated"
        elif "progress" in updates:
            updates["last_action"] = f"Progress {updates['progress']}%"
        else:
            updates["last_action"] = "Updated"
        updates["updated_at"] = now_iso()
        await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": updates})  # FIX-001-C
        if updates.get("assignee_id") and updates["assignee_id"] != user["id"]:
            await push_notification(user["tenant_id"], [updates["assignee_id"]], 1,
                                    f"Work assigned to you: '{t['title']}'", "task", task_id,
                                    ntype="assigned", title=t["title"], sender=user["name"])
        added_notify = [i for i in added_co if i != user["id"]]
        if added_notify:
            await push_notification(user["tenant_id"], added_notify, 1,
                                    f"You've been added to '{t['title']}'", "task", task_id,
                                    ntype="assigned", title=t["title"], sender=user["name"])
        if "co_assignee_ids" in inp.model_fields_set:
            # ASK-29: name who came on and who came off, for the timeline.
            removed_co = [i for i in old_co if i not in (updates.get("co_assignee_ids") or [])]
            who = {}
            if added_co or removed_co:
                for u in await db.users.find({"id": {"$in": added_co + removed_co}}, {"_id": 0, "id": 1, "name": 1}).to_list(50):
                    who[u["id"]] = u.get("name") or "a member"
            parts = []
            if added_co:
                parts.append("Added " + ", ".join(who.get(i, "a member") for i in added_co))
            if removed_co:
                parts.append("Removed " + ", ".join(who.get(i, "a member") for i in removed_co))
            await _log_task_event(user, task_id, "task_people", f"Updated who is on '{t['title']}'",
                                  " · ".join(parts) or "Updated who is on the task")
        if signoff_requested:
            from services.notifications import _approver_ids
            approvers = [t["approver_id"]] if t.get("approver_id") else await _approver_ids(user["tenant_id"])
            approvers = [a for a in approvers if a and a != user["id"]]
            if approvers:
                await push_notification(user["tenant_id"], approvers, 2,
                                        f"Approval needed to close: '{t['title']}'", "task", task_id,
                                        ntype="approval", title=t["title"], sender=user["name"])
            await _log_task_event(user, task_id, "task_signoff", f"Sent '{t['title']}' for approval",
                                  "Marked complete — sent for approval")
        elif updates.get("status") and updates["status"] != t.get("status"):
            # ASK-28 TK-06: everyone on the task hears a status change too (a
            # helper finishing tells the lead, and the other way round).
            watchers = [w for w in dict.fromkeys([t.get("created_by"), *assignee_ids_of(t),
                                                  *await _owner_ids(user["tenant_id"])])
                        if w and w != user["id"]]
            await push_notification(user["tenant_id"], watchers, 1,
                                    f"Status update on '{t['title']}': {updates['status'].replace('_', ' ')}", "task", task_id,
                                    ntype="status", title=t["title"], sender=user["name"])
        if updates.get("status") and t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → {updates['status'].replace('_',' ')}", user["name"], "task")
        # ASK-29: every status move lands on the task's timeline. It used to
        # show only as "last_action" under the drawer's title; "done" is its
        # own event just below, so it is not written twice.
        # ASK-28 TK-07: the wait itself goes on the timeline, and a colleague
        # being waited on is told (they can open the task and answer with a note).
        if "waiting_on" in updates:
            w = updates["waiting_on"]
            if w:
                await _log_task_event(user, task_id, "task_waiting", f"'{t['title']}' is waiting on {w['name']}",
                                      f"Waiting on {w['name']}")
                if w.get("user_id") and w["user_id"] != user["id"]:
                    await push_notification(user["tenant_id"], [w["user_id"]], 2,
                                            f"{user['name']} is waiting on you for '{t['title']}'", "task", task_id,
                                            ntype="waiting", title=t["title"], sender=user["name"])
            elif t.get("waiting_on") or t.get("status") == "waiting":
                gone = (t.get("waiting_on") or {}).get("name") or "someone"
                await _log_task_event(user, task_id, "task_waiting", f"'{t['title']}' is no longer waiting on {gone}",
                                      f"No longer waiting on {gone}")
        if (updates.get("status") and updates["status"] != t.get("status") and updates["status"] != "done"
                and not signoff_requested and "waiting_on" not in updates):
            word = _STATUS_WORDS.get(updates["status"], updates["status"])
            await _log_task_event(user, task_id, "task_status", f"'{t['title']}' status → {word}", f"Status → {word}")
        if "progress" in updates and "status" not in updates and updates["progress"] != t.get("progress"):
            await _log_task_event(user, task_id, "task_progress", f"'{t['title']}' progress {updates['progress']}%",
                                  f"Progress set to {updates['progress']}%")
        if updates.get("status") == "done":
            await _log_task_event(user, task_id, "task_done", f"Completed task '{t['title']}'",
                                  "Marked complete and approved" if updates.get("approval_status") == "approved" else "Marked complete")
            await _after_task_done(user, t, task_id)
        elif updates.get("assignee_id"):
            member = await db.users.find_one({"id": updates["assignee_id"]}, {"_id": 0, "name": 1})
            who_name = (member or {}).get("name", "a member")
            await _log_task_event(user, task_id, "task_assigned", f"Assigned '{t['title']}' to {who_name}", f"Assigned to {who_name}")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


async def _after_task_done(user: dict, t: dict, task_id: str) -> None:
    """What closing a task sets off: the workflow advance, the Brain record and
    the auto-drafted invoice. ASK-28 TK-05 moved it out of update_task so an
    approval that closes a task (approval before closing) sets off the same."""
    # WE-06.5 (2026-08-16, live-test surfaced): task-close hook.
    # If the task was linked to a workflow (WE-01 fields set) and
    # its stage_key matches the workflow's current stage, ask
    # the engine to try advancing. Engine's check_stage_ready
    # handles the "other tasks still open" case gracefully --
    # returns not_ready and we swallow. Never blocks the task
    # close itself; the advance is fire-and-forget best-effort.
    if t.get("workflow_id") and t.get("stage_key"):
        try:
            from services.workflow_engine import advance as _engine_advance
            from services.workflow_engine import WorkflowAdvanceError
            _wf_check = await db.workflows.find_one(
                {"id": t["workflow_id"], "tenant_id": user["tenant_id"]},
                {"_id": 0, "stage": 1})
            if _wf_check and _wf_check.get("stage") == t.get("stage_key"):
                try:
                    await _engine_advance(
                        user["tenant_id"], t["workflow_id"],
                        user["id"], user.get("name") or "",
                        user.get("role") or "",
                    )
                except WorkflowAdvanceError:
                    # Common: stage still has other open tasks.
                    # Not an error -- card just waits.
                    pass
        except Exception as e:
            # Fail-open: never let engine issue break the task close.
            from core import logger as _lg
            _lg.warning(f"[WE-06.5] task-close engine hook skipped for {task_id}: {e}")
    # FIX-007-B (S4-02): thread decision_id through so the
    # decision → task → outcome chain is reconstructable.
    await brain_context.record_context(
        tenant_id=user["tenant_id"], kind="task_done", title=t.get("title") or "Task completed",
        outcome="done", why=t.get("description") or "",
        tags=[t.get("category")] if t.get("category") else [],
        source_type="task", source_id=task_id,
        decision_id=t.get("decision_id"),
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="dept",
    )
    # FUP-50 (2026-08-15): if this task looks like an invoice-
    # raise action, create a PENDING sales invoice so the
    # finance page stops showing INVOICES=0 while the Brain
    # narrates 'this is a data gap'. Detection is deliberately
    # narrow -- title contains 'invoice' AND task has a
    # contact link OR an amount. Full AI extraction of HSN /
    # GST rate / advance-adjustment lives with the Workflow
    # Engine side-effects framework (WE-06) -- this MVP
    # unblocks the cash-flow blind spot without waiting.
    await _maybe_auto_invoice(user["tenant_id"], user["id"], t, task_id)


# ---------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/reassign")
async def reassign_task(task_id: str, inp: TaskReassignInput, user: dict = Depends(require_perm("team_manage"))):
    """Change who a task is assigned to — a specific member or a whole role/team.

    FIX-004-C (RBAC-07): decorator now requires team_manage permission.
    Previously any employee could reassign any task (auth-only), which
    let a disgruntled assignee dump their work back on the requester.
    """
    from services.notifications import push_notification
    perms = user_perms(user)
    if not (user["role"] == "owner" or "team_manage" in perms or "decisions_approve" in perms):
        raise HTTPException(status_code=403, detail="You can't reassign this task")
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    # ASK-28 TK-06: a person chose where it goes now, not the least-busy rule.
    updates = {"updated_at": now_iso(), "last_action": "Reassigned", "auto_assigned": None}
    new_assignee_id = None
    who: str
    if inp.assignee_id:
        member = await db.users.find_one({"id": inp.assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1, "name": 1})
        if not member:
            raise HTTPException(status_code=400, detail="Member not found")
        await _check_assignable(user, inp.assignee_id)  # ASK-28 TK-08
        updates["assignee_id"] = inp.assignee_id
        updates["assignee_role"] = member["role"]
        new_assignee_id = inp.assignee_id
        who = member["name"]
        # ASK-26: a co-assignee made lead leaves the list; everyone else stays on.
        if inp.assignee_id in (t.get("co_assignee_ids") or []):
            updates["co_assignee_ids"] = [i for i in t["co_assignee_ids"] if i != inp.assignee_id]
    elif inp.assignee_role:
        if inp.assignee_role not in await tenant_role_keys(user["tenant_id"]):
            raise HTTPException(status_code=400, detail="Invalid role")
        await _check_assignable(user, None, inp.assignee_role)  # ASK-28 TK-08
        updates["assignee_id"] = None
        updates["assignee_role"] = inp.assignee_role
        who = inp.assignee_role
    else:
        raise HTTPException(status_code=400, detail="Pick a member or a role")
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": updates})  # FIX-001-C
    if new_assignee_id and new_assignee_id != user["id"]:
        await push_notification(user["tenant_id"], [new_assignee_id], 1,
                                f"Work assigned to you: '{t['title']}'", "task", task_id,
                                ntype="assigned", title=t["title"], sender=user["name"])
    await _log_task_event(user, task_id, "task_assigned", f"Reassigned '{t['title']}' to {who}", f"Reassigned to {who}")
    if t.get("decision_id"):
        await add_decision_event(t["decision_id"], f"{t['title']} reassigned to {who}", user["name"], "task")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


# ---------------------------------------------------------------------------
# Approval loop (pre-execution)
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, user: dict = Depends(get_current_user)):
    from services.notifications import push_notification
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("approval_required"):
        raise HTTPException(status_code=400, detail="This task doesn't require approval")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can approve this task")
    closing = approval_stage(t) == "close"
    if closing and t.get("approval_status") != "pending":
        raise HTTPException(status_code=400, detail="Nothing to approve yet — this task has not been marked complete.")
    if closing:
        # ASK-28 TK-05: approval before closing — the doer finished; approving closes it.
        set_doc = {"status": "done", "progress": 100}
        said = "Approved — task closed"
        notify_msg = f"Approved and closed: '{t['title']}'"
    else:
        # Pre-execution approval: unlock the task so the assignee can start working on it.
        set_doc = {"status": "todo" if t.get("status") == "blocked" else t.get("status")}
        said = "Approved — work can start"
        notify_msg = f"Approved: you can start '{t['title']}'"
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {  # FIX-001-C
        **set_doc, "approval_status": "approved",
        "approved_by": user["id"], "approved_at": now_iso(),
        "updated_at": now_iso(), "last_action": said,
    }})
    to_notify = [i for i in assignee_ids_of(t) if i != user["id"]]
    if to_notify:  # ASK-26: everyone on the task hears it
        await push_notification(user["tenant_id"], to_notify, 1, notify_msg, "task", task_id,
                                ntype="approved", title=t["title"], sender=user["name"])
    await _log_task_event(user, task_id, "task_approved", f"Approved '{t['title']}'", said)
    if closing:
        await _log_task_event(user, task_id, "task_done", f"Completed task '{t['title']}'", "Closed on approval")
        if t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → done", user["name"], "task")
        await _after_task_done(user, t, task_id)
    # FIX-007-B (S4-02): pass decision_id when set.
    await brain_context.record_context(
        tenant_id=user["tenant_id"], kind="approval", title=t.get("title") or "Task approved",
        outcome="approved", why=t.get("description") or "",
        tags=[t.get("category")] if t.get("category") else [],
        source_type="task", source_id=task_id,
        decision_id=t.get("decision_id"),
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="dept",
    )
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.post("/tasks/{task_id}/reject")
async def reject_task(task_id: str, inp: TaskRejectInput, user: dict = Depends(get_current_user)):
    from services.notifications import push_notification
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("approval_required"):
        raise HTTPException(status_code=400, detail="This task doesn't require approval")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can reject this task")
    reason = (inp.reason or "").strip()
    closing = approval_stage(t) == "close"
    if closing and t.get("approval_status") != "pending":
        raise HTTPException(status_code=400, detail="Nothing to review yet — this task has not been marked complete.")
    # Approval before work starts: keep the task locked (blocked) until it's approved.
    # ASK-28 TK-05, approval before closing: back to In progress with the reason.
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {  # FIX-001-C
        "status": "in_progress" if closing else "blocked", "approval_status": "rejected",
        "rejected_by": user["id"], "rejected_at": now_iso(), "rejection_reason": reason,
        "updated_at": now_iso(), "last_action": "Changes requested",
    }})
    msg = f"Changes requested on '{t['title']}' by {user['name']}" + (f": {reason}" if reason else "")
    if assignee_ids_of(t):  # ASK-26
        await push_notification(user["tenant_id"], assignee_ids_of(t), 2, msg, "task", task_id,
                                ntype="rejected", title=t["title"], sender=user["name"])
    await _log_task_event(user, task_id, "task_rejected", f"Requested changes on '{t['title']}'",
                          "Requested changes" + (f": {reason[:140]}" if reason else ""))
    # FIX-007-B (S4-02): pass decision_id when set.
    await brain_context.record_context(
        tenant_id=user["tenant_id"], kind="approval", title=t.get("title") or "Task rejected",
        outcome="rejected", why=reason or t.get("description") or "",
        tags=[t.get("category")] if t.get("category") else [],
        source_type="task", source_id=task_id,
        decision_id=t.get("decision_id"),
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="dept",
    )
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.post("/tasks/{task_id}/clarify")
async def clarify_task(task_id: str, inp: TaskRejectInput, user: dict = Depends(get_current_user)):
    """Approver/owner asks the assignee a clarifying question; the task stays locked until approved."""
    from services.notifications import push_notification
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can request clarification")
    note = (inp.reason or "").strip()
    if not note:
        raise HTTPException(status_code=400, detail="Add what you need clarified")
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {"updated_at": now_iso(), "last_action": "Clarification requested"}})  # FIX-001-C
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$push": {"updates": {  # FIX-001-C
        "id": new_id(), "kind": "note", "text": f"Clarification requested: {note}",
        "step_id": None, "step_text": None, "author_id": user["id"], "author_name": user.get("name"),
        "to_id": t.get("assignee_id"), "to_role": None, "to_name": t.get("assignee_name"),
        "followup_task_id": None, "created_at": now_iso(),
    }}})
    if assignee_ids_of(t):  # ASK-26
        await push_notification(user["tenant_id"], assignee_ids_of(t), 2,
                                f"Clarification needed on '{t['title']}': {note[:120]}", "task", task_id,
                                ntype="clarification", title=t["title"], sender=user["name"])
    await _log_task_event(user, task_id, "task_clarify", f"Requested clarification on '{t['title']}'",
                          f"Asked for clarification: {note[:140]}")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


# ---------------------------------------------------------------------------
# Execution plan (AI-generated steps)
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/execution-plan/generate")
async def generate_execution_plan(task_id: str, user: dict = Depends(get_current_user)):
    from services.ai.extraction import ai_execution_plan
    from services.ingestion import _tenant_currency
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can plan this task")
    if is_start_locked(t):
        raise HTTPException(status_code=403, detail="This task must be approved before you can plan it.")
    industry = await _tenant_industry(user["tenant_id"])
    currency = await _tenant_currency(user["tenant_id"])
    gen = await ai_execution_plan(t, industry, currency, session_id=f"exec-{task_id}")
    steps = [{"id": new_id(), "text": s, "done": False} for s in gen["steps"]]
    plan = {"status": "draft", "task_type": gen["task_type"], "steps": steps,
            "progress": 0, "generated_at": now_iso(), "updated_at": now_iso()}
    # ASK-28: a fresh checklist starts at 0 ticked, and the task's progress now
    # follows it.
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {"execution_plan": plan, "progress": 0}})  # FIX-001-C
    await _log_task_event(user, task_id, "task_plan", f"Dex drafted a checklist for '{t['title']}'",
                          f"Dex drafted a checklist ({len(steps)} steps)")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.patch("/tasks/{task_id}/execution-plan")
async def save_execution_plan(task_id: str, inp: ExecPlanInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can edit this plan")
    if is_start_locked(t):
        raise HTTPException(status_code=403, detail="This task must be approved before you can plan it.")
    steps = [{"id": s.id or new_id(), "text": s.text.strip(), "done": bool(s.done)}
             for s in inp.steps if s.text.strip()]
    existing = t.get("execution_plan") or {}
    plan = {
        "status": inp.status or existing.get("status") or "draft",
        "task_type": existing.get("task_type", "generic"),
        "steps": steps, "progress": _plan_progress(steps),
        "generated_at": existing.get("generated_at") or now_iso(), "updated_at": now_iso(),
    }
    updates = {"execution_plan": plan}
    # ASK-28: with a checklist, the task's own progress IS the checklist's, so
    # cards, Desk and the drawer's locked % bar all read the same number.
    if steps:
        updates["progress"] = plan["progress"]
    # Keep the task board in sync: starting work moves a todo task into progress; finishing all steps can complete it.
    if plan["status"] == "accepted" and steps:
        if plan["progress"] == 100 and t.get("status") not in ("done", "blocked") and not (
                approval_stage(t) == "close" and t.get("approval_status") == "pending"):
            # ASK-28 TK-05: approval before closing turns this into a sign-off request.
            updates.update(completion_updates(t, _can_approve_task(user, t)))
            if updates.get("approval_status") == "pending":
                updates["last_action"] = "Sent for approval"
            elif updates.get("approval_status") == "approved":
                updates.update({"approved_by": user["id"], "approved_at": now_iso()})
        elif plan["progress"] > 0 and t.get("status") == "todo":
            updates["status"] = "in_progress"
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": updates})  # FIX-001-C
    # ASK-29: what changed in the checklist, for the task's timeline — each
    # step ticked or unticked, and accepting or editing the list itself.
    old_steps = existing.get("steps") or []
    old_done = {s.get("id"): bool(s.get("done")) for s in old_steps}
    for s in steps:
        if s["id"] in old_done and s["done"] != old_done[s["id"]]:
            verb = "Completed step" if s["done"] else "Reopened step"
            await _log_task_event(user, task_id, "task_step", f"{verb} on '{t['title']}': {s['text'][:80]}",
                                  f"{verb}: {s['text'][:140]}")
    shape_changed = ([(s.get("id"), (s.get("text") or "").strip()) for s in old_steps]
                     != [(s["id"], s["text"]) for s in steps])
    if existing.get("status") != "accepted" and plan["status"] == "accepted":
        await _log_task_event(user, task_id, "task_plan", f"Accepted the checklist on '{t['title']}'",
                              f"Accepted the checklist ({len(steps)} steps)")
    elif shape_changed:
        await _log_task_event(user, task_id, "task_plan", f"Edited the checklist on '{t['title']}'",
                              f"Edited the checklist ({len(steps)} steps)")
    if updates.get("approval_status") == "pending":
        from services.notifications import _approver_ids, push_notification
        approvers = [t["approver_id"]] if t.get("approver_id") else await _approver_ids(user["tenant_id"])
        approvers = [a for a in approvers if a and a != user["id"]]
        if approvers:
            await push_notification(user["tenant_id"], approvers, 2,
                                    f"Approval needed to close: '{t['title']}'", "task", task_id,
                                    ntype="approval", title=t["title"], sender=user["name"])
        await _log_task_event(user, task_id, "task_signoff", f"Sent '{t['title']}' for approval",
                              "Every checklist step is done — sent for approval")
    if updates.get("status") == "done":
        await _log_task_event(user, task_id, "task_done", f"Completed task '{t['title']}'",
                              "Completed — every checklist step is done")
        if t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → done", user["name"], "task")
        # FIX-007-B (S4-02): this endpoint was the ONE task-completion
        # path that skipped record_context — a task whose execution plan
        # ticked to 100% (via save_execution_plan) transitioned status
        # to "done" here but never wrote to brain_context, so downstream
        # "how did we handle X?" queries saw a mysterious silence for
        # every execution-plan-driven completion. Now parity with the
        # PATCH /tasks/{id} status=done path (see update_task above),
        # and decision_id is threaded through so decision → task →
        # outcome is reconstructable.
        await brain_context.record_context(
            tenant_id=user["tenant_id"], kind="task_done",
            title=t.get("title") or "Task completed",
            outcome="done", why=t.get("description") or "",
            tags=[t.get("category")] if t.get("category") else [],
            source_type="task", source_id=task_id,
            decision_id=t.get("decision_id"),
            actor_id=user["id"], actor_name=user.get("name") or "",
            department=user.get("role") or "", visibility="dept",
        )
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.delete("/tasks/{task_id}/execution-plan")
async def delete_execution_plan(task_id: str, user: dict = Depends(require_perm("team_manage"))):
    # FIX-004-C (RBAC-07): deleting the execution plan wipes AI-
    # generated steps that the assignee may be actively working
    # through. Team-manage permission gates the action so an unrelated
    # employee can't sabotage someone else's execution plan.
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can clear this plan")
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$unset": {"execution_plan": ""}, "$set": {"updated_at": now_iso()}})  # FIX-001-C
    await _log_task_event(user, task_id, "task_plan", f"Cleared the checklist on '{t['title']}'", "Cleared the checklist")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.post("/tasks/{task_id}/steps/ask")
async def ask_step_ai(task_id: str, inp: StepAskInput, user: dict = Depends(get_current_user)):
    from services.ai.extraction import ai_step_assist
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can use this")
    industry = await _tenant_industry(user["tenant_id"])
    return await ai_step_assist(t, inp.step_text, industry, session_id=f"step-{task_id}")


# ---------------------------------------------------------------------------
# Collaboration: notes, handoffs, escalations, responses
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/updates")
async def add_task_update(task_id: str, inp: TaskUpdateNoteInput, user: dict = Depends(get_current_user)):
    from services.notifications import push_notification
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    # ASK-28 TK-01: the person who asked for the task may leave a note on it;
    # hand-off and escalate stay with the people doing the work.
    requested = inp.action if inp.action in ("note", "handoff", "escalate") else "note"
    # ASK-28 TK-03: the manager of someone on the task may note too. Item 7: so
    # may the named approver and anyone with "See all tasks" — they follow the
    # work with notes rather than edits.
    if not (_can_work_task(user, t) or (requested == "note" and (
            can_note_task(user, t) or manages_task(t, await _team_ids(user))
            or t.get("approver_id") == user["id"] or can_see_all_tasks(user, user_perms(user))))):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can post updates")
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Note text is required")
    action = inp.action if inp.action in ("note", "handoff", "escalate") else "note"

    step_text = None
    if inp.step_id:
        for s in (t.get("execution_plan") or {}).get("steps", []):
            if s.get("id") == inp.step_id:
                step_text = s.get("text")
                break

    tenant_id = user["tenant_id"]
    followup_task_id = None
    to_name = to_id = to_role = None
    notify_ids, notify_level, notify_prefix = [], 2, "[Handoff]"

    if action in ("handoff", "escalate"):
        h = await _resolve_task_handoff(user, t, task_id, action, text, step_text, inp)
        followup_task_id, to_id, to_name, to_role = h["followup_task_id"], h["to_id"], h["to_name"], h["to_role"]
        notify_ids, notify_level, notify_prefix = h["notify_ids"], h["notify_level"], h["notify_prefix"]

    entry = {
        "id": new_id(), "kind": action, "text": text,
        "step_id": inp.step_id, "step_text": step_text,
        "author_id": user["id"], "author_name": user.get("name"),
        "to_id": to_id, "to_role": to_role, "to_name": to_name,
        "followup_task_id": followup_task_id, "created_at": now_iso(),
    }
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$push": {"updates": entry}})  # FIX-001-C

    if action == "note":
        await log_activity(tenant_id, user["id"], "task_note", f"Note on '{t.get('title')}': {text[:80]}", "task", task_id)
        # Notify the counterpart on this task (assignee <-> creator/approver), excluding the author.
        # ASK-26: everyone on the task, not only the lead.
        counterparts = [w for w in dict.fromkeys((*assignee_ids_of(t), t.get("created_by"), t.get("approver_id")))
                        if w and w != user["id"]]
        if counterparts:
            await push_notification(tenant_id, counterparts, 1,
                                    f"New comment on '{t.get('title')}' from {user['name']}: {text[:100]}", "task", task_id,
                                    ntype="comment", title=t.get("title"), sender=user["name"])
    else:
        verb = "escalated to" if action == "escalate" else "handed off to"
        await log_activity(tenant_id, user["id"], f"task_{action}",
                           f"{t.get('title')} {verb} {to_name}", "task", task_id)
        await push_notification(tenant_id, notify_ids, notify_level,
                                f"{notify_prefix} {user['name']} needs you on: {(step_text or t.get('title'))[:90]} — “{text[:100]}”",
                                "task", followup_task_id)
        if t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t.get('title')} {verb} {to_name}", user["name"], "assigned")

    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.post("/tasks/{task_id}/respond")
async def respond_to_handoff(task_id: str, inp: RespondInput, user: dict = Depends(get_current_user)):
    """Reply to an escalation/handoff: sends feedback back to the person who raised it and resolves this follow-up."""
    from services.notifications import push_notification
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("parent_task_id"):
        raise HTTPException(status_code=400, detail="This task is not an escalation/handoff you can respond to")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can respond")
    text = (inp.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Response text is required")

    tenant_id = user["tenant_id"]
    parent_id = t["parent_task_id"]
    parent = await db.tasks.find_one({"id": parent_id, "tenant_id": tenant_id}, {"_id": 0})  # FIX-001-C
    # Route the reply back to whoever raised it; fall back to the original task's assignee for legacy items.
    raised_by = t.get("raised_by") or (parent or {}).get("assignee_id")
    raised_by_name = t.get("raised_by_name")
    if not raised_by_name and raised_by:
        ru = await db.users.find_one({"id": raised_by}, {"_id": 0, "name": 1})
        raised_by_name = (ru or {}).get("name")
    kind = "response" if t.get("source") == "escalation" else "handoff_reply"

    # Push the answer into the ORIGINAL task's trail so the person who raised it continues with context.
    entry = {
        "id": new_id(), "kind": kind, "text": text,
        "step_id": None, "step_text": t.get("raised_step_text"),
        "author_id": user["id"], "author_name": user.get("name"),
        "to_id": raised_by, "to_role": None, "to_name": raised_by_name,
        "followup_task_id": None, "created_at": now_iso(),
    }
    if parent_id:
        await db.tasks.update_one(tenant_filter(parent_id, tenant_id), {"$push": {"updates": entry}})  # FIX-001-C
    # Resolve this follow-up.
    await db.tasks.update_one(tenant_filter(task_id, tenant_id), {"$set": {"status": "done", "resolved_at": now_iso()}})  # FIX-001-C

    ptitle = (parent or {}).get("title", "your task")
    if raised_by:
        await push_notification(tenant_id, [raised_by], 2,
                                f"[Reply] {user['name']} responded on: {ptitle[:80]} — “{text[:100]}”",
                                "task", parent_id)
    await log_activity(tenant_id, user["id"], "handoff_resolved",
                       f"{user['name']} responded to {raised_by_name or 'the requester'} on '{ptitle}'", "task", parent_id)
    if parent and parent.get("decision_id"):
        await add_decision_event(parent["decision_id"], f"{user['name']} responded: {text[:80]}", user["name"], "event")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------
@router.post("/tasks/prioritize")
async def prioritize_tasks(force: bool = False, limit: int = 25, user: dict = Depends(require_perm("team_manage"))):
    # FIX-004-C (RBAC-07): tenant-wide AI re-score of every open task.
    # Costs Claude tokens and rewrites priority ordering the whole
    # team sees — team-manage permission gates the action.
    from services.ai.extraction import ai_score_tasks
    from services.ingestion import _tenant_currency
    tid = user["tenant_id"]
    q = {"tenant_id": tid, "status": {"$in": list(OPEN_STATUSES)}}  # ASK-28 TK-07: every open stage
    if user["role"] != "owner":
        q["$or"] = [{"assignee_id": user["id"]}, {"co_assignee_ids": user["id"]}, {"assignee_role": user["role"]}]
    open_tasks = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    todo = [t for t in open_tasks if force or not t.get("ai_scores")]
    scored_n = 0
    if todo:
        currency = await _tenant_currency(tid)
        now = now_iso()
        for i in range(0, len(todo), 25):
            chunk = todo[i:i + 25]
            scores = await ai_score_tasks(chunk, currency, session_id=f"prioritize-{tid}-{i}")
            for t in open_tasks:
                s = scores.get(t["id"])
                if s:
                    t["ai_scores"] = s
                    t["scored_at"] = now
                    scored_n += 1
                    await db.tasks.update_one(tenant_filter(t["id"], tid), {"$set": {"ai_scores": s, "scored_at": now}})  # FIX-001-C
    open_tasks = await enrich_tasks(open_tasks)
    open_tasks.sort(key=lambda t: (t.get("ai_scores") or {}).get("priority_score", -1), reverse=True)
    return {"tasks": open_tasks, "scored": scored_n}


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/attachment")
async def upload_task_attachment(task_id: str, file: UploadFile = File(...), kind: str = Form("evidence"),
                                 background: BackgroundTasks = None, user: dict = Depends(get_current_user)):
    from services.files import _analyze_reference_file, _file_public, _store_file
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    kind = kind if kind in ("reference", "evidence", "photo", "voice") else "evidence"
    rec = await _store_file(user["tenant_id"], user["id"], file, kind, task_id=task_id)
    att = _file_public(rec)
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$push": {"attachments": att},  # FIX-001-C
                              "$set": {"updated_at": now_iso(), "last_action": f"{kind.title()} attached"}})
    what = {"photo": "Attached a photo", "voice": "Sent a voice note",
            "reference": "Added reference material"}.get(kind, "Attached a document")
    await _log_task_event(user, task_id, "task_attachment", f"{what} on '{t['title']}'",
                          f"{what}: {att.get('filename') or 'file'}" if kind != "voice" else what)
    if kind == "reference" and background is not None:
        background.add_task(_analyze_reference_file, user["tenant_id"], task_id, rec)
    return att


@router.delete("/tasks/{task_id}/attachments/{att_id}")
async def delete_task_attachment(task_id: str, att_id: str, user: dict = Depends(get_current_user)):
    """Remove one attachment (proof or reference) from a task — 2026-09-15.

    Only the person who added it, the task's creator or the owner may remove
    it: proof is evidence, so a doer cannot quietly clear someone else's. The
    file record is soft-deleted rather than dropped, matching how files are
    kept everywhere else (is_deleted).
    """
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    att = next((a for a in (t.get("attachments") or []) if a.get("id") == att_id), None)
    if not att:
        raise HTTPException(status_code=404, detail="Attachment not found")
    allowed = user.get("role") == "owner" or att.get("by") == user["id"] or t.get("created_by") == user["id"]
    if not allowed:
        raise HTTPException(status_code=403, detail="Only the person who added it, the task's creator or the owner can remove it")
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {
        "$pull": {"attachments": {"id": att_id}},
        "$set": {"updated_at": now_iso(), "last_action": "Attachment removed"},
    })
    await db.files.update_one({"id": att_id, "tenant_id": user["tenant_id"]},
                              {"$set": {"is_deleted": True, "deleted_at": now_iso(), "deleted_by": user["id"]}})
    what = {"photo": "Removed a photo", "voice": "Removed a voice note",
            "reference": "Removed reference material"}.get(att.get("kind"), "Removed a document")
    await _log_task_event(user, task_id, "task_attachment_removed", f"{what} on '{t['title']}'",
                          f"{what}: {att.get('filename') or 'file'}" if att.get("kind") != "voice" else what)
    return {"ok": True}

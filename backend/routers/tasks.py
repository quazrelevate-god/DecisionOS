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
from services import brain_context
from services.tenancy import tenant_filter  # FIX-001-C
from services.tasks import (
    TASK_STATUSES,
    _attach_reference_ids,
    _can_work_task,
    _plan_progress,
    _tenant_industry,
    enrich_task,
    enrich_tasks,
)


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


async def _tenant_industry(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "industry": 1})
    return (t or {}).get("industry") or "general"


async def _resolve_task_handoff(user, t, task_id, action, text, step_text, inp):
    """Resolve the target for a handoff/escalation and create the follow-up task."""
    tenant_id = user["tenant_id"]
    to_name = to_id = to_role = None
    notify_level, notify_prefix = 2, "[Handoff]"
    if action == "escalate":
        owner = await db.users.find_one({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0})
        if not owner:
            raise HTTPException(status_code=400, detail="No owner to escalate to")
        to_id, to_name, to_role = owner["id"], owner.get("name"), "owner"
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
    user: dict = Depends(get_current_user),
):
    q: dict = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    # ?mine=true (My Work / personal): only tasks assigned to ME + unclaimed role-pool tasks.
    #   Excludes tasks assigned to other specific members of my role.
    # Non-owner team board (mine=false): the whole role lane (any member of my role + role-level tasks).
    # Owner (mine=false): everything.
    if mine:
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_id": None, "assignee_role": user["role"]}]
    elif user["role"] != "owner":
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]
    tasks = await db.tasks.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return await enrich_tasks(tasks)


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = (user.get("role") == "owner" or _can_work_task(user, t)
               or t.get("approver_id") == user["id"] or t.get("created_by") == user["id"]
               or t.get("support_id") == user["id"])
    if not allowed:
        raise HTTPException(status_code=403, detail="You don't have access to this work")
    return await enrich_task(t)


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
    from server import pick_least_loaded_member, push_notification, _approver_ids  # deferred
    tid = new_id()
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
    if not assignee_id and role:
        # Smart assignment: route a role-level task to the least-loaded member of that role.
        assignee_id = await pick_least_loaded_member(user["tenant_id"], role)
    task_type = (inp.task_type or "").strip() or None
    support_id = inp.support_id if inp.support_id and await db.users.find_one({"id": inp.support_id, "tenant_id": user["tenant_id"]}, {"_id": 0}) else None
    approver_id = inp.approver_id if inp.approver_id and await db.users.find_one({"id": inp.approver_id, "tenant_id": user["tenant_id"]}, {"_id": 0}) else None
    progress = max(0, min(100, inp.progress)) if isinstance(inp.progress, int) else 0
    needs_approval = bool(inp.approval_required)
    await db.tasks.insert_one({
        "id": tid, "tenant_id": user["tenant_id"], "title": inp.title, "description": inp.description or "",
        "assignee_role": role, "assignee_id": assignee_id, "priority": inp.priority or "medium",
        "status": "blocked" if needs_approval else "todo", "due_date": due, "decision_id": None,
        "source": "manual", "created_at": now_iso(),
        "task_type": task_type, "op_category": inp.op_category or None, "support_id": support_id,
        "expected_output": inp.expected_output or None, "approval_required": needs_approval,
        "approval_status": "pending" if needs_approval else None,
        "approver_id": approver_id, "progress": progress, "created_by": user["id"],
        "evidence_required": bool(inp.evidence_required),
        # FUP-50: carry finance metadata forward so the FUP-50 auto-
        # invoice hook has something to seed the draft with.
        "contact_id": inp.contact_id,
        "contact_name": inp.contact_name or "",
        "amount": inp.amount,
        "updated_at": now_iso(), "last_action": "Created",
    })
    if inp.reference_file_ids:
        await _attach_reference_ids(user["tenant_id"], user["id"], tid, inp.reference_file_ids, background)
    if needs_approval:
        approvers = [approver_id] if approver_id else await _approver_ids(user["tenant_id"])
        await push_notification(user["tenant_id"], approvers, 2,
                                f"Approval needed before work starts: '{inp.title}'", "task", tid,
                                ntype="approval", title=inp.title, sender=user["name"])
    elif assignee_id and assignee_id != user["id"]:
        await push_notification(user["tenant_id"], [assignee_id], 1,
                                f"New work assigned: '{inp.title}'", "task", tid,
                                ntype="assigned", title=inp.title, sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_created", f"Created task '{inp.title}'", "task", tid)
    return await enrich_task(await db.tasks.find_one({"id": tid}, {"_id": 0}))


@router.patch("/tasks/{task_id}")
async def update_task(task_id: str, inp: TaskUpdateInput, user: dict = Depends(get_current_user)):
    from server import push_notification, _owner_ids  # deferred
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
    if "progress" in updates:
        updates["progress"] = max(0, min(100, int(updates["progress"])))
    if updates.get("status") == "done":
        updates["progress"] = 100
    # Completion-evidence gate: tasks flagged evidence_required need >=1 evidence file before "done".
    if updates.get("status") == "done" and t.get("evidence_required"):
        # Any assignee-uploaded proof (photo/voice/evidence/file) satisfies the gate; reference material does not.
        has_ev = any((a or {}).get("kind") != "reference" for a in (t.get("attachments") or []))
        if not has_ev:
            raise HTTPException(status_code=400,
                                detail="This task requires completion evidence — attach at least one file before marking it done.")
    # Pre-execution approval gate: a task requiring approval is locked (status "blocked")
    # until the approver approves it. The assignee cannot change status/progress before then.
    if t.get("approval_required") and t.get("approval_status") != "approved":
        if any(k in updates for k in ("status", "progress")):
            raise HTTPException(status_code=403, detail="This task is awaiting approval before work can begin.")
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
    if updates:
        if "status" in updates:
            updates["last_action"] = f"Status → {updates['status'].replace('_', ' ')}"
        elif updates.get("assignee_id"):
            updates["last_action"] = "Reassigned"
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
        if updates.get("status") and updates["status"] != t.get("status"):
            watchers = [w for w in ([t.get("created_by")] + await _owner_ids(user["tenant_id"])) if w and w != user["id"]]
            await push_notification(user["tenant_id"], watchers, 1,
                                    f"Status update on '{t['title']}': {updates['status'].replace('_', ' ')}", "task", task_id,
                                    ntype="status", title=t["title"], sender=user["name"])
        if updates.get("status") and t.get("decision_id"):
            await add_decision_event(t["decision_id"], f"{t['title']} → {updates['status'].replace('_',' ')}", user["name"], "task")
        if updates.get("status") == "done":
            await log_activity(user["tenant_id"], user["id"], "task_done", f"Completed task '{t['title']}'", "task", task_id)
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
        elif updates.get("assignee_id"):
            member = await db.users.find_one({"id": updates["assignee_id"]}, {"_id": 0, "name": 1})
            await log_activity(user["tenant_id"], user["id"], "task_assigned",
                               f"Assigned '{t['title']}' to {(member or {}).get('name', 'a member')}", "task", task_id)
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


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
    from server import push_notification  # deferred
    perms = user_perms(user)
    if not (user["role"] == "owner" or "team_manage" in perms or "decisions_approve" in perms):
        raise HTTPException(status_code=403, detail="You can't reassign this task")
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    updates = {"updated_at": now_iso(), "last_action": "Reassigned"}
    new_assignee_id = None
    who: str
    if inp.assignee_id:
        member = await db.users.find_one({"id": inp.assignee_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "role": 1, "name": 1})
        if not member:
            raise HTTPException(status_code=400, detail="Member not found")
        updates["assignee_id"] = inp.assignee_id
        updates["assignee_role"] = member["role"]
        new_assignee_id = inp.assignee_id
        who = member["name"]
    elif inp.assignee_role:
        if inp.assignee_role not in await tenant_role_keys(user["tenant_id"]):
            raise HTTPException(status_code=400, detail="Invalid role")
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
    await log_activity(user["tenant_id"], user["id"], "task_assigned", f"Reassigned '{t['title']}' to {who}", "task", task_id)
    if t.get("decision_id"):
        await add_decision_event(t["decision_id"], f"{t['title']} reassigned to {who}", user["name"], "task")
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


# ---------------------------------------------------------------------------
# Approval loop (pre-execution)
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/approve")
async def approve_task(task_id: str, user: dict = Depends(get_current_user)):
    from server import push_notification  # deferred
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("approval_required"):
        raise HTTPException(status_code=400, detail="This task doesn't require approval")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can approve this task")
    # Pre-execution approval: unlock the task so the assignee can start working on it.
    new_status = "todo" if t.get("status") == "blocked" else t.get("status")
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {  # FIX-001-C
        "status": new_status, "approval_status": "approved",
        "approved_by": user["id"], "approved_at": now_iso(),
        "updated_at": now_iso(), "last_action": "Approved — work can start",
    }})
    if t.get("assignee_id"):
        await push_notification(user["tenant_id"], [t["assignee_id"]], 1, f"Approved: you can start '{t['title']}'", "task", task_id,
                                ntype="approved", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_approved", f"Approved '{t['title']}'", "task", task_id)
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
    from server import push_notification  # deferred
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not t.get("approval_required"):
        raise HTTPException(status_code=400, detail="This task doesn't require approval")
    if not _can_approve_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assigned approver or an owner can reject this task")
    reason = (inp.reason or "").strip()
    # Keep the task locked (blocked) so work still cannot start until it's approved.
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {  # FIX-001-C
        "status": "blocked", "approval_status": "rejected",
        "rejected_by": user["id"], "rejected_at": now_iso(), "rejection_reason": reason,
        "updated_at": now_iso(), "last_action": "Changes requested",
    }})
    msg = f"Changes requested on '{t['title']}' by {user['name']}" + (f": {reason}" if reason else "")
    if t.get("assignee_id"):
        await push_notification(user["tenant_id"], [t["assignee_id"]], 2, msg, "task", task_id,
                                ntype="rejected", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_rejected", f"Requested changes on '{t['title']}'", "task", task_id)
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
    from server import push_notification  # deferred
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
    if t.get("assignee_id"):
        await push_notification(user["tenant_id"], [t["assignee_id"]], 2,
                                f"Clarification needed on '{t['title']}': {note[:120]}", "task", task_id,
                                ntype="clarification", title=t["title"], sender=user["name"])
    await log_activity(user["tenant_id"], user["id"], "task_clarify", f"Requested clarification on '{t['title']}'", "task", task_id)
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


# ---------------------------------------------------------------------------
# Execution plan (AI-generated steps)
# ---------------------------------------------------------------------------
@router.post("/tasks/{task_id}/execution-plan/generate")
async def generate_execution_plan(task_id: str, user: dict = Depends(get_current_user)):
    from server import ai_execution_plan, _tenant_currency  # deferred
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can plan this task")
    if t.get("approval_required") and t.get("approval_status") != "approved":
        raise HTTPException(status_code=403, detail="This task must be approved before you can plan it.")
    industry = await _tenant_industry(user["tenant_id"])
    currency = await _tenant_currency(user["tenant_id"])
    gen = await ai_execution_plan(t, industry, currency, session_id=f"exec-{task_id}")
    steps = [{"id": new_id(), "text": s, "done": False} for s in gen["steps"]]
    plan = {"status": "draft", "task_type": gen["task_type"], "steps": steps,
            "progress": 0, "generated_at": now_iso(), "updated_at": now_iso()}
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": {"execution_plan": plan}})  # FIX-001-C
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.patch("/tasks/{task_id}/execution-plan")
async def save_execution_plan(task_id: str, inp: ExecPlanInput, user: dict = Depends(get_current_user)):
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
        raise HTTPException(status_code=403, detail="Only the assignee or owner can edit this plan")
    if t.get("approval_required") and t.get("approval_status") != "approved":
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
    # Keep the task board in sync: starting work moves a todo task into progress; finishing all steps can complete it.
    if plan["status"] == "accepted" and steps:
        if plan["progress"] == 100 and t.get("status") not in ("done", "blocked"):
            updates["status"] = "done"
        elif plan["progress"] > 0 and t.get("status") == "todo":
            updates["status"] = "in_progress"
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$set": updates})  # FIX-001-C
    if updates.get("status") == "done":
        await log_activity(user["tenant_id"], user["id"], "task_done", f"Completed task '{t['title']}'", "task", task_id)
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
    return await enrich_task(await db.tasks.find_one(tenant_filter(task_id, user["tenant_id"]), {"_id": 0}))  # FIX-001-C


@router.post("/tasks/{task_id}/steps/ask")
async def ask_step_ai(task_id: str, inp: StepAskInput, user: dict = Depends(get_current_user)):
    from server import ai_step_assist  # deferred
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
    from server import push_notification  # deferred
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if not _can_work_task(user, t):
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
        counterparts = [w for w in (t.get("assignee_id"), t.get("created_by"), t.get("approver_id"))
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
    from server import push_notification  # deferred
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
    from server import ai_score_tasks, _tenant_currency  # deferred
    tid = user["tenant_id"]
    q = {"tenant_id": tid, "status": {"$in": ["todo", "in_progress", "blocked"]}}
    if user["role"] != "owner":
        q["$or"] = [{"assignee_id": user["id"]}, {"assignee_role": user["role"]}]
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
    from server import _store_file, _file_public, _analyze_reference_file  # deferred
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    kind = kind if kind in ("reference", "evidence", "photo", "voice") else "evidence"
    rec = await _store_file(user["tenant_id"], user["id"], file, kind, task_id=task_id)
    att = _file_public(rec)
    await db.tasks.update_one(tenant_filter(task_id, user["tenant_id"]), {"$push": {"attachments": att},  # FIX-001-C
                              "$set": {"updated_at": now_iso(), "last_action": f"{kind.title()} attached"}})
    if kind == "reference" and background is not None:
        background.add_task(_analyze_reference_file, user["tenant_id"], task_id, rec)
    return att

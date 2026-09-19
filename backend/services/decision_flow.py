"""Approving and rejecting a decision (ASK-32 decision flow Phase 1, 2026-09-15).

One path for every caller — the Desk popup (routers/decisions.py) and a
WhatsApp capture approved from the review queue (services/captures.py):

  approve  only while pending; only the named approver, an owner, or (when
           nobody is named) a decisions_approve holder. Creates what the
           decision proposed (services.voice.materialize_proposal), releases
           tasks older decisions created blocked, moves procurement workflows
           to their approval stage, and records the outcome.
  reject   the same guards. Nothing proposed is created. For older decisions
           that created work at capture, it cancels tasks still waiting and
           removes only what nobody has touched (a workflow still on its
           first stage with no history, a capture's calendar entry); work
           already under way is never deleted.
"""
from fastapi import HTTPException

import core as _core
from core import db, logger, now_iso
from core.permissions import user_perms
from services.ai import brain_context
from services.tenancy import tenant_filter

PENDING = ("pending", "pending_approval")
# Anything not yet approved or rejected can still be decided — older data and
# seeds use other spellings ("open"), which must not lock a decision forever.
DECIDED = ("approved", "rejected")


# Looked up on `core` at call time (not bound at import) so the E2E harness's
# no-op writers apply here the same way they do in the routers.
async def add_decision_event(*a, **k):
    return await _core.add_decision_event(*a, **k)


async def log_activity(*a, **k):
    return await _core.log_activity(*a, **k)


def can_decide(user: dict, d: dict) -> bool:
    if user.get("role") == "owner":
        return True
    if d.get("approver_id"):
        # RBAC P2 (2026-09-16): or the decider handed their approvals to me while away.
        return d["approver_id"] == user.get("id") or d["approver_id"] in (user.get("_acting_for") or [])
    return "decisions_approve" in user_perms(user)


# ---------------------------------------------------------------------------
# ASK-32 Phase 2 — who decides, and who is told.
# ONE permission decides both where a decision goes and who may approve it:
# the owner, or anyone whose effective permissions (own list, else the company's
# role settings, else the role default) include decisions_approve. Routing used
# to check `approvals` while approving needed decisions_approve.
# ---------------------------------------------------------------------------
async def _role_map(tenant_id: str) -> dict:
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1})
    return {r["key"]: list(r["permissions"]) for r in ((tenant or {}).get("roles") or [])
            if r.get("key") and isinstance(r.get("permissions"), list) and r.get("permissions")}


def member_can_decide(member: dict, role_map: dict) -> bool:
    if not member:
        return False
    if member.get("role") == "owner":
        return True
    return "decisions_approve" in user_perms({**member, "_role_perms_map": role_map})


_PERSON = {"_id": 0, "id": 1, "name": 1, "role": 1, "permissions": 1, "permissions_custom": 1, "reporting_manager_id": 1}


async def decision_deciders(tenant_id: str) -> list:
    """Everyone in the company who may decide a decision — by what they can
    really open (membership, role settings, temporary grants, owner exclusions)."""
    from services.auth.membership import members_effective_perms
    people = await db.users.find({"tenant_id": tenant_id}, _PERSON).to_list(500)
    perms = await members_effective_perms(db, tenant_id, people)
    return [{"id": p["id"], "name": p.get("name"), "role": p.get("role")}
            for p in people if "decisions_approve" in perms.get(p["id"], set())]


async def route_approver(tenant_id: str, capturer_id: str) -> tuple:
    """DD2 — who decides what this person captured: themselves when they can
    approve; else their reporting manager when the manager can; else the owner.
    A company with several owners keeps it with every owner (None), so naming
    one would not hide it from the others. Returns (approver_id, how)."""
    # 2026-09-15 (RBAC P1): by what they can really open, not the bare user record.
    from services.auth.membership import members_effective_perms
    capturer = await db.users.find_one({"id": capturer_id, "tenant_id": tenant_id}, _PERSON)
    if capturer and "decisions_approve" in (await members_effective_perms(db, tenant_id, [capturer])).get(capturer_id, set()):
        return capturer_id, "captured"
    mid = (capturer or {}).get("reporting_manager_id")
    if mid and mid != capturer_id:
        manager = await db.users.find_one({"id": mid, "tenant_id": tenant_id}, _PERSON)
        if manager and "decisions_approve" in (await members_effective_perms(db, tenant_id, [manager])).get(mid, set()):
            return mid, "manager"
    owners = await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1}).to_list(5)
    if len(owners) == 1:
        return owners[0]["id"], "owner"
    return None, "any_owner"


async def name_waiting_approvers(_database=None) -> dict:
    """ASK-32 2.1 backfill (boot migration, runs once): waiting decisions captured
    before routing existed get the approver the same rule would pick now. A
    company with several owners keeps them with every owner (left unnamed)."""
    named = left = 0
    async for d in db.decisions.find(
            {"status": {"$in": list(PENDING)}, "$or": [{"approver_id": None}, {"approver_id": ""}, {"approver_id": {"$exists": False}}]},
            {"_id": 0, "id": 1, "tenant_id": 1, "created_by": 1}):
        aid, how = await route_approver(d["tenant_id"], d.get("created_by") or "")
        if aid:
            await db.decisions.update_one({"id": d["id"], "tenant_id": d["tenant_id"]},
                                          {"$set": {"approver_id": aid, "approver_route": f"backfill_{how}"}})
            named += 1
        else:
            left += 1
    return {"named": named, "left_with_every_owner": left}


async def _notify(tenant_id: str, user_ids, level: int, message: str, entity_type: str, entity_id: str, **kw) -> None:
    # Looked up on the module at call time so tests can keep or silence it.
    import services.notifications as notifications
    ids = [i for i in dict.fromkeys(user_ids or []) if i]
    if ids:
        await notifications.push_notification(tenant_id, ids, level, message, entity_type, entity_id, **kw)


async def notify_decision_waiting(tenant_id: str, decision: dict, sender_name: str = None) -> None:
    """2.3 — the person who has to decide hears that a decision is waiting
    (every owner when none is named). Not the person who captured it."""
    if decision.get("approver_id"):
        targets = [decision["approver_id"]]
    else:
        targets = [o["id"] for o in await db.users.find({"tenant_id": tenant_id, "role": "owner"}, {"_id": 0, "id": 1}).to_list(10)]
    targets = [t for t in targets if t != decision.get("created_by")]
    title = decision.get("title") or "A decision"
    await _notify(tenant_id, targets, 2, f"Decision waiting for you: {title}", "decision", decision["id"],
                  ntype="approval", title=title, sender=sender_name or "Dex")


async def change_approver_flow(user: dict, decision_id: str, approver_id: str) -> dict:
    """2.5 — hand a waiting decision to someone else who can decide. Allowed for
    an owner or the person it is waiting on (anyone who may decide, when nobody
    is named)."""
    tid = user["tenant_id"]
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": tid}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d.get("status") in DECIDED:
        raise HTTPException(status_code=409, detail=f"This decision was already {d['status']}.")
    if not can_decide(user, d):
        raise HTTPException(status_code=403, detail="Only an owner or the person it is waiting on can change who decides.")
    role_map = await _role_map(tid)
    target = await db.users.find_one({"id": approver_id, "tenant_id": tid}, _PERSON)
    if not member_can_decide(target, role_map):
        who = (target or {}).get("name") or "That person"
        raise HTTPException(status_code=400, detail=f"{who} can't approve decisions. Pick someone with the Approve decisions permission.")
    if approver_id != d.get("approver_id"):
        await db.decisions.update_one(tenant_filter(decision_id, tid), {"$set": {
            "approver_id": approver_id, "approver_route": "changed", "approver_changed_by": user["id"],
            "approver_changed_at": now_iso()}})
        await add_decision_event(decision_id, f"Sent to {target.get('name')} to decide", user.get("name") or "", "assigned")
        if approver_id != user["id"]:
            await _notify(tid, [approver_id], 2, f"{user.get('name')} sent you a decision: {d.get('title')}", "decision",
                          decision_id, ntype="approval", title=d.get("title"), sender=user.get("name"))
    return await db.decisions.find_one(tenant_filter(decision_id, tid), {"_id": 0})


async def _load_for_decision(user: dict, decision_id: str, authorized: bool) -> dict:
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d.get("status") in DECIDED:
        raise HTTPException(status_code=409, detail=f"This decision was already {d['status']}.")
    if not authorized and not can_decide(user, d):
        who = None
        if d.get("approver_id"):
            u = await db.users.find_one({"id": d["approver_id"], "tenant_id": user["tenant_id"]}, {"_id": 0, "name": 1})
            who = (u or {}).get("name")
        raise HTTPException(status_code=403, detail=f"Only {who or 'the named approver'} or an owner can decide this.")
    return d


async def _claim(user: dict, decision_id: str, status: str) -> None:
    """Flip pending -> decided atomically, so two clicks cannot both act."""
    res = await db.decisions.update_one(
        {"id": decision_id, "tenant_id": user["tenant_id"], "status": {"$nin": list(DECIDED)}},
        {"$set": {"status": status, "decided_at": now_iso(), "decided_by": user["id"],
                  "decided_by_name": user.get("name")}})
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="This decision was just decided by someone else.")


async def _run_workflow_moves(user: dict, d: dict, made: dict) -> list:
    """Move the workflows an approved decision touches, and say what happened:
      * a workflow it created fires its first stage's automation (template
        tasks, side-effects) — creating it used to skip that;
      * an existing card the proposal names ("move the Toyota order to
        dispatched") steps forward to that stage;
      * a workflow of this decision sitting right before its pipeline's
        approval stage moves into it — every pipeline, not only procurement.
        Approving the decision IS that approval, so the owner-only gate on the
        approval stage does not silently stop a manager who approves."""
    from services.workflow_engine import WorkflowAdvanceError, _load_pipeline, advance, on_stage_enter
    tid, did = user["tenant_id"], d["id"]
    reason = f"Decision approved by {user.get('name') or 'the approver'}: {d.get('title') or ''}"[:300]
    move_to = {w["workflow_id"]: w["move_to"] for w in (d.get("proposal") or {}).get("workflows") or []
               if w.get("mode") == "existing" and w.get("workflow_id") and w.get("move_to")}
    new_ids = set(made.get("workflow_ids") or [])
    ids = [w["id"] async for w in db.workflows.find({"tenant_id": tid, "decision_id": did}, {"_id": 0, "id": 1})]
    ids += list(move_to)
    lines = []
    for wid in dict.fromkeys(ids):
        wf = await db.workflows.find_one({"id": wid, "tenant_id": tid}, {"_id": 0})
        if not wf:
            continue
        title = wf.get("title") or "Workflow"
        if wid in new_ids:
            try:
                await on_stage_enter(tid, wid, user["id"], user.get("name") or "")
            except Exception as e:  # automation must never undo an approval
                logger.warning(f"[ASK-32] first-stage automation failed for workflow {wid}: {e}")
        stages = wf.get("stages") or []
        pipeline = await _load_pipeline(tid, wf.get("type") or "")
        appr = (pipeline or {}).get("approval_stage")
        cur = stages.index(wf["stage"]) if wf.get("stage") in stages else -1
        target = move_to.get(wid)
        if not target and appr in stages and stages.index(appr) == cur + 1 and wf.get("decision_id") == did:
            target = appr
        if not target or target not in stages or stages.index(target) <= cur:
            continue
        try:
            for _ in range(len(stages)):
                now = (await db.workflows.find_one({"id": wid, "tenant_id": tid}, {"_id": 0, "stage": 1}) or {}).get("stage")
                at = stages.index(now) if now in stages else -1
                if at < 0 or at >= stages.index(target):
                    break
                nxt = stages[at + 1]
                await advance(tid, wid, user["id"], user.get("name") or "", "owner" if nxt == appr else (user.get("role") or ""),
                              target_stage=nxt, note=reason, override=True, reason=reason)
            await db.tasks.update_many({"tenant_id": tid, "decision_id": did, "workflow_id": wid, "source": {"$ne": "engine"}},
                                       {"$set": {"stage_key": target}})
            label = next((s.get("label") for s in (pipeline or {}).get("stages") or [] if s.get("key") == target), None)
            lines.append(f"{title} moved to {label or target.replace('_', ' ')}")
        except WorkflowAdvanceError as e:
            lines.append(f"Could not move {title}: {e}")
    return lines


# ---------------------------------------------------------------------------
# ASK-32 Phase 3 (DD5) — change the proposal before approving: who does a task,
# when it is due, or drop an item. Only while undecided, only by whoever decides.
# ---------------------------------------------------------------------------
_KINDS = ("tasks", "workflows", "meetings", "reminders", "memory_notes")
_KIND_WORD = {"tasks": "task", "workflows": "workflow", "meetings": "meeting", "reminders": "reminder", "memory_notes": "note"}


async def _editable(user: dict, decision_id: str) -> dict:
    d = await db.decisions.find_one({"id": decision_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Not found")
    if d.get("status") in DECIDED:
        raise HTTPException(status_code=409, detail=f"This decision was already {d['status']}.")
    if not can_decide(user, d):
        raise HTTPException(status_code=403, detail="Only the person deciding can change it.")
    if not d.get("proposal"):
        raise HTTPException(status_code=400, detail="The work for this decision already exists — change it in My Work.")
    return d


async def _save_proposal(user: dict, d: dict, label: str) -> dict:
    from services.voice import summarize_proposal
    tid = user["tenant_id"]
    await db.decisions.update_one(tenant_filter(d["id"], tid), {"$set": {
        "proposal": d["proposal"], "execution_summary": summarize_proposal(d["proposal"])}})
    await add_decision_event(d["id"], label, user.get("name") or "", "event")
    return await db.decisions.find_one(tenant_filter(d["id"], tid), {"_id": 0})


async def edit_proposal_task(user: dict, decision_id: str, key: str, *, assignee_id=None, due_date=None,
                             priority=None, evidence_required=None, approval_required=None,
                             approval_stage=None, approver_id=None) -> dict:
    """assignee_id: who does it (held to the same rule as giving anyone a task);
    due_date: "YYYY-MM-DD", or "" for no due date.
    ASK-50 — priority, evidence_required, approval_required / approval_stage and
    approver_id ("" = the usual approver): held on the proposal and applied when
    approval creates the task (services.voice._create_decision_tasks). The
    rules are services.proposal_task_settings'; a named approver is held to the
    same checks New Task makes (routers.tasks.create_task)."""
    import re as _re
    d = await _editable(user, decision_id)
    tid = user["tenant_id"]
    task = next((t for t in d["proposal"].get("tasks") or [] if t.get("key") == key), None)
    if not task:
        raise HTTPException(status_code=404, detail="That task is no longer in this decision.")
    changes = []
    if assignee_id and assignee_id != task.get("assignee_id"):
        target = await db.users.find_one({"id": assignee_id, "tenant_id": tid},
                                         {"_id": 0, "id": 1, "name": 1, "role": 1, "reporting_manager_id": 1})
        if not target:
            raise HTTPException(status_code=400, detail="That person isn't in this company.")
        from services.tasks import can_assign_person
        reports = [u["id"] async for u in db.users.find({"tenant_id": tid, "reporting_manager_id": user["id"]}, {"_id": 0, "id": 1})]
        if not can_assign_person(user, target, reports, user_perms(user)):
            raise HTTPException(status_code=403, detail=(
                f"You can give tasks to yourself, your own team or the people who report to you, not {target.get('name')}."))
        task.update({"assignee_id": target["id"], "assignee_role": target.get("role"), "assignee_how": "picked"})
        changes.append(f"goes to {target.get('name')}")
    if due_date is not None:
        if due_date and not _re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
            raise HTTPException(status_code=400, detail="Use a date like 2026-09-30.")
        if (due_date or None) != task.get("due_date"):
            task["due_date"] = due_date or None
            changes.append(f"due {due_date}" if due_date else "no due date")
    # ASK-50 — the settings New Task has and a proposal did not.
    from services.proposal_task_settings import apply_settings
    approver = None
    if approver_id:
        approver = await db.users.find_one({"id": approver_id, "tenant_id": tid},
                                           {"_id": 0, "id": 1, "name": 1, "role": 1, "permissions": 1})
        if not approver:
            raise HTTPException(status_code=400, detail="That person isn't in this company.")
        from routers.tasks import _member_can_approve
        # RBAC P1 — the approver can't be the one doing it (owners exempt), as in New Task.
        if approver.get("role") != "owner" and approver["id"] == task.get("assignee_id"):
            raise HTTPException(status_code=400, detail=(
                f"{approver.get('name') or 'That person'} is doing this task, so they can't approve it. "
                "Pick someone else, or leave it to the usual approver."))
        if not await _member_can_approve(tid, approver):
            raise HTTPException(status_code=400, detail=(
                f"{approver.get('name') or 'That person'} can't approve tasks. Pick someone with approval "
                "access, or leave it to the usual approver."))
    try:
        changes += apply_settings(task, priority=priority, evidence_required=evidence_required,
                                  approval_required=approval_required, approval_stage=approval_stage,
                                  approver=approver, clear_approver=approver_id == "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not changes:
        return d
    return await _save_proposal(user, d, f"Changed before approval: {task.get('title')} — {', '.join(changes)}")


async def remove_proposal_item(user: dict, decision_id: str, kind: str, key: str) -> dict:
    if kind not in _KINDS:
        raise HTTPException(status_code=400, detail="Unknown item")
    d = await _editable(user, decision_id)
    items = d["proposal"].get(kind) or []
    item = next((x for x in items if x.get("key") == key), None)
    if not item:
        raise HTTPException(status_code=404, detail="That item is no longer in this decision.")
    d["proposal"][kind] = [x for x in items if x.get("key") != key]
    if kind == "workflows":  # tasks that were to join it stay plain tasks
        for t in d["proposal"].get("tasks") or []:
            if t.get("workflow_key") == key:
                t.pop("workflow_key", None)
                t.pop("workflow_title", None)
    name = item.get("title") or item.get("text") or _KIND_WORD[kind]
    return await _save_proposal(user, d, f"Removed before approval: {_KIND_WORD[kind]} “{name}”")


async def approve_decision_flow(user: dict, decision_id: str, *, authorized: bool = False) -> dict:
    from services.voice import materialize_proposal
    tid = user["tenant_id"]
    d = await _load_for_decision(user, decision_id, authorized)
    await _claim(user, decision_id, "approved")

    made = {"task_ids": [], "workflow_ids": [], "meetings": 0, "reminders": 0, "memory_notes": 0}
    if d.get("proposal"):
        made = await materialize_proposal(tid, d)
        await db.decisions.update_one(tenant_filter(decision_id, tid), {"$set": {
            "task_ids": list(d.get("task_ids") or []) + made["task_ids"],
            "workflow_ids": list(d.get("workflow_ids") or []) + made["workflow_ids"],
            "created_on_approval": {k: (len(v) if isinstance(v, list) else v) for k, v in made.items()},
        }})
    # Older decisions created their tasks blocked at capture: release them.
    await db.tasks.update_many(
        {"tenant_id": tid, "decision_id": decision_id, "status": "blocked", "approval_required": {"$ne": True}},
        {"$set": {"status": "todo", "updated_at": now_iso(), "last_action": "Decision approved"}})
    parts = []
    if made["task_ids"]:
        parts.append(f"{len(made['task_ids'])} task(s)")
    if made["workflow_ids"]:
        parts.append(f"{len(made['workflow_ids'])} workflow(s)")
    if made["meetings"]:
        parts.append(f"{made['meetings']} meeting(s)")
    if made["reminders"]:
        parts.append(f"{made['reminders']} reminder(s)")
    await add_decision_event(decision_id, "Approved — created " + ", ".join(parts) if parts else "Approved — tasks unblocked",
                             user["name"], "approved")

    # ASK-32 Phase 4.3 — the workflows this decision touches move by themselves
    # (WE-07: through the engine, with a reason in history and the audit log).
    for line in await _run_workflow_moves(user, d, made):
        await add_decision_event(decision_id, line, user["name"], "workflow")
    for t in await db.tasks.find({"tenant_id": tid, "decision_id": decision_id,
                                  "source": {"$nin": ["reminder", "meeting"]}}, {"_id": 0}).to_list(100):
        who = None
        if t.get("assignee_id"):
            m = await db.users.find_one({"id": t["assignee_id"], "tenant_id": tid}, {"_id": 0, "name": 1})
            who = (m or {}).get("name")
        who = who or t.get("assignee_role") or "team"
        await add_decision_event(decision_id, f"Task assigned to {who}: {t['title']}", user["name"], "assigned")
        # ASK-50 — a task that needs approval before work starts is locked; as
        # with New Task, the APPROVER hears about it first, and the doer when it
        # is approved and can actually be started.
        from services.proposal_task_settings import waits_on_approval
        if waits_on_approval(t):
            if t.get("approver_id"):
                approvers = [t["approver_id"]]
            else:
                from services.notifications import _approver_ids
                approvers = await _approver_ids(tid)
            approvers = [a for a in approvers if a and a != user["id"]]
            if approvers:
                await _notify(tid, approvers, 2, f"Approval needed before work starts: '{t['title']}'", "task", t["id"],
                              ntype="approval", title=t["title"], sender=user.get("name"))
            continue
        # ASK-32 2.3 — the person the work went to hears about it.
        if t.get("assignee_id") and t["assignee_id"] != user["id"] and t.get("status") not in ("done", "cancelled"):
            await _notify(tid, [t["assignee_id"]], 1, f"Work assigned to you: '{t['title']}'", "task", t["id"],
                          ntype="assigned", title=t["title"], sender=user.get("name"))
    if d.get("created_by") and d["created_by"] != user["id"]:
        await _notify(tid, [d["created_by"]], 1, f"{user.get('name')} approved your decision: {d.get('title')}",
                      "decision", decision_id, ntype="approved", title=d.get("title"), sender=user.get("name"))
    await log_activity(tid, user["id"], "decision_approved", f"Approved '{d['title']}'", "decision", decision_id)
    await brain_context.record_context(
        tenant_id=tid, kind="decision", title=d.get("title") or "Decision approved",
        outcome="approved", why=d.get("summary") or d.get("description") or "",
        tags=d.get("tags") or [], source_type="decision", source_id=decision_id,
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="public",
    )
    return await db.decisions.find_one(tenant_filter(decision_id, tid), {"_id": 0})


async def reject_decision_flow(user: dict, decision_id: str, *, authorized: bool = False) -> dict:
    tid = user["tenant_id"]
    d = await _load_for_decision(user, decision_id, authorized)
    await _claim(user, decision_id, "rejected")

    # Older decisions made work at capture. Cancel what is still waiting; remove
    # only what nobody touched; never delete work that is under way.
    cancelled = (await db.tasks.update_many(
        {"tenant_id": tid, "decision_id": decision_id, "status": "blocked", "approval_required": {"$ne": True}},
        {"$set": {"status": "cancelled", "updated_at": now_iso(), "last_action": "Decision rejected"}})).modified_count
    removed_wf = 0
    async for wf in db.workflows.find({"tenant_id": tid, "decision_id": decision_id},
                                      {"_id": 0, "id": 1, "stage": 1, "stages": 1, "history": 1}):
        untouched = wf.get("stage") == (wf.get("stages") or [None])[0] and len(wf.get("history") or []) <= 1
        live_tasks = await db.tasks.count_documents({"tenant_id": tid, "workflow_id": wf["id"],
                                                     "status": {"$nin": ["cancelled"]}})
        if untouched and not live_tasks:
            await db.workflows.delete_one({"id": wf["id"], "tenant_id": tid})
            removed_wf += 1
    await db.calendar_events.delete_many({"tenant_id": tid, "decision_id": decision_id, "source": "voice"})
    await db.inbox.update_many({"tenant_id": tid, "ref_type": "decision", "ref_id": decision_id},
                               {"$set": {"status": "dismissed"}})
    if cancelled or removed_wf:
        label = f"Rejected — cancelled {cancelled} waiting task(s), removed {removed_wf} untouched workflow(s)"
    else:
        label = "Rejected — nothing was created"
    await add_decision_event(decision_id, label, user["name"], "rejected")
    if d.get("created_by") and d["created_by"] != user["id"]:  # ASK-32 2.3
        await _notify(tid, [d["created_by"]], 1, f"{user.get('name')} rejected your decision: {d.get('title')}",
                      "decision", decision_id, ntype="rejected", title=d.get("title"), sender=user.get("name"))
    await log_activity(tid, user["id"], "decision_rejected", f"Rejected '{d['title']}'", "decision", decision_id)
    await brain_context.record_context(
        tenant_id=tid, kind="decision", title=d.get("title") or "Decision rejected",
        outcome="rejected", why=d.get("summary") or d.get("description") or "",
        tags=d.get("tags") or [], source_type="decision", source_id=decision_id,
        actor_id=user["id"], actor_name=user.get("name") or "",
        department=user.get("role") or "", visibility="public",
    )
    return await db.decisions.find_one(tenant_filter(decision_id, tid), {"_id": 0})

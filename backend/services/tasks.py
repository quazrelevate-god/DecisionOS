"""Tasks — pure/light-touch helpers extracted from `server.py` in Phase B step 4.

Scope of THIS pass (safe, no inline call-graph fanout):
  • `TASK_STATUSES`                — canonical status vocabulary
  • `_derive_task_type(t)`         — task_type ← stored key / role / 'other'
  • `_task_activity(t)`            — (updated_at, last_action) fallback derivation
  • `enrich_task(t)` / `enrich_tasks(list)` — hydrate assignee/helper/approver/creator names
  • `_can_work_task(user, t)`      — permission gate used by task-owning endpoints
  • `clean_co_assignees` / `assignee_ids_of` — ASK-26 multiple assignees
  • `_plan_progress(steps)`        — execution-plan progress %

Everything that needs LLM planners, notifications, or the resilient chat client
(create_task, patch_task, approve/reject/reassign/clarify/respond/updates,
execution-plan/*, steps/ask, attachment upload, prioritize) stays in
`server.py` for now — those call graphs are too fanned-out to move without
churning half the codebase.
"""
from typing import List, Optional

from core import db


TASK_STATUSES = {"blocked", "todo", "in_progress", "waiting", "review", "done", "cancelled"}

# ASK-28 TK-07 (plan Phase 3, D6) — the STAGES people see, over the statuses
# that stay stored (no migration; the phone app and Dex keep reading them):
#   To do  = todo, blocked (waiting for approval before work starts)
#   Doing  = in_progress, waiting (Waiting on someone), review (approval to close)
#   Done / Cancelled
# Waiting on and Needs approval are flags on top of the stage, not stages.
OPEN_STATUSES = ("todo", "blocked", "in_progress", "waiting", "review")
# Open work that can run late (a task still waiting for approval to START is
# left out, as the delayed counts always did).
WORKING_STATUSES = ("todo", "in_progress", "waiting", "review")
STAGE_STATUSES = {"todo": ("todo", "blocked"), "in_progress": ("in_progress", "waiting", "review")}
WAITING_NAME_MAX = 80


def stage_of(status: Optional[str]) -> str:
    if status in ("done", "cancelled"):
        return status
    return "in_progress" if status in STAGE_STATUSES["in_progress"] else "todo"


def waiting_updates(spec: Optional[dict], member: Optional[dict], actor_id: str, now: str) -> dict:
    """ASK-28 TK-07 — what "Waiting on" writes. `spec` is {"user_id"} (a
    colleague, `member` is their user doc or None if not in the company),
    {"name"} (free text, e.g. a supplier), or empty (stop waiting -> back to
    Doing). Raises ValueError with a message for the person when it can't."""
    if not spec:
        return {"status": "in_progress", "waiting_on": None}
    if spec.get("user_id"):
        if not member:
            raise ValueError("That person isn't in this company.")
        return {"status": "waiting", "waiting_on": {
            "user_id": member["id"], "name": member.get("name") or "a colleague", "since": now, "set_by": actor_id}}
    name = str(spec.get("name") or "").strip()
    if not name:
        raise ValueError("Say who or what this task is waiting on.")
    return {"status": "waiting", "waiting_on": {
        "user_id": None, "name": name[:WAITING_NAME_MAX], "since": now, "set_by": actor_id}}


def status_change_clears_waiting(t: dict, new_status: str) -> dict:
    """Moving a waiting task to any other status ends the wait."""
    if new_status != "waiting" and (t.get("waiting_on") or t.get("status") == "waiting"):
        return {"waiting_on": None}
    return {}


def _derive_task_type(t: dict) -> str:
    # Any stored category key (dynamic per tenant) passes through; else fall back to role, else 'other'.
    if t.get("task_type"):
        return t["task_type"]
    r = t.get("assignee_role")
    if r in ("sales", "finance", "production", "purchase"):
        return r
    return "other"


def _task_activity(t: dict):
    """Return (updated_at_iso, human_label) — persisted values if present, else derived from history."""
    if t.get("updated_at") and t.get("last_action"):
        return t["updated_at"], t["last_action"]
    cand = []
    if t.get("created_at"):
        cand.append((t["created_at"], "Created"))
    for u in (t.get("updates") or []):
        lbl = {"note": "Note added", "handoff": "Handed off", "escalate": "Escalated"}.get(u.get("kind"), "Updated")
        if u.get("created_at"):
            cand.append((u["created_at"], lbl))
    ep = t.get("execution_plan") or {}
    if ep.get("updated_at"):
        cand.append((ep["updated_at"], "Execution plan updated"))
    for a in (t.get("attachments") or []):
        if a.get("at"):
            cand.append((a["at"], "Attachment added"))
    if t.get("approved_at"):
        cand.append((t["approved_at"], "Approved"))
    if t.get("rejected_at"):
        cand.append((t["rejected_at"], "Changes requested"))
    if not cand:
        return t.get("created_at"), "Created"
    cand.sort(key=lambda x: x[0])
    return cand[-1]


async def _fetch_workflow_summaries(tenant_id: str, wf_ids: set) -> dict:
    """WE-11 (2026-08-16): pull a compact summary for every workflow
    referenced by a batch of tasks. Returns
        { wf_id: {id, type, title, stage, short_id} }
    where short_id is the last 4 chars of the workflow id (used by the
    UI chip like 'Order #4821 - Confirmed'). Only the fields the chip
    needs -- keeps the payload small.
    """
    if not wf_ids:
        return {}
    out = {}
    async for wf in db.workflows.find(
        {"id": {"$in": list(wf_ids)}, "tenant_id": tenant_id},
        {"_id": 0, "id": 1, "type": 1, "title": 1, "stage": 1},
    ):
        wf_id = wf["id"]
        out[wf_id] = {
            "id": wf_id,
            "type": wf.get("type") or "",
            "title": wf.get("title") or "",
            "stage": wf.get("stage") or "",
            "short_id": wf_id[-4:] if len(wf_id) > 4 else wf_id,
        }
    return out


async def enrich_task(t: Optional[dict]) -> Optional[dict]:
    if not t:
        return t
    ids = list({t.get(k) for k in ("assignee_id", "approver_id", "created_by") if t.get(k)}
               | set(t.get("co_assignee_ids") or []))
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(50):
            umap[u["id"]] = u["name"]
    t["assignee_name"] = umap.get(t.get("assignee_id"))
    t["co_assignees"] = [{"id": i, "name": umap.get(i)} for i in (t.get("co_assignee_ids") or [])]
    t["approver_name"] = umap.get(t.get("approver_id"))
    t["created_by_name"] = umap.get(t.get("created_by"))
    t["attachment_count"] = len(t.get("attachments") or [])
    t["task_type"] = _derive_task_type(t)
    at, action = _task_activity(t)
    t["updated_at"], t["last_action"] = at, action
    # WE-11: workflow_summary is the compact payload the MyWork stage
    # chip renders from. Only fetched when workflow_id is set (ad-hoc
    # tasks stay unaffected).
    if t.get("workflow_id") and t.get("tenant_id"):
        wf_map = await _fetch_workflow_summaries(t["tenant_id"], {t["workflow_id"]})
        t["workflow_summary"] = wf_map.get(t["workflow_id"]) or None
    else:
        t["workflow_summary"] = None
    return t


async def enrich_tasks(tasks: List[dict]) -> List[dict]:
    ids = set()
    wf_ids = set()
    tenant_id = None
    for t in tasks:
        for k in ("assignee_id", "approver_id", "created_by"):
            if t.get(k):
                ids.add(t[k])
        ids.update(t.get("co_assignee_ids") or [])
        if t.get("workflow_id"):
            wf_ids.add(t["workflow_id"])
        if t.get("tenant_id") and tenant_id is None:
            tenant_id = t["tenant_id"]
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            umap[u["id"]] = u["name"]
    # WE-11: single batch fetch for every workflow the tasks reference
    # (one round trip covers a whole MyWork list).
    wf_map = await _fetch_workflow_summaries(tenant_id, wf_ids) if tenant_id else {}
    for t in tasks:
        t["assignee_name"] = umap.get(t.get("assignee_id"))
        t["co_assignees"] = [{"id": i, "name": umap.get(i)} for i in (t.get("co_assignee_ids") or [])]
        t["approver_name"] = umap.get(t.get("approver_id"))
        t["created_by_name"] = umap.get(t.get("created_by"))
        t["attachment_count"] = len(t.get("attachments") or [])
        t["task_type"] = _derive_task_type(t)
        at, action = _task_activity(t)
        t["updated_at"], t["last_action"] = at, action
        t["workflow_summary"] = (wf_map.get(t.get("workflow_id"))
                                 if t.get("workflow_id") else None)
    return tasks


def _can_work_task(user: dict, t: dict) -> bool:
    return (user.get("role") == "owner"
            or t.get("assignee_id") == user["id"]
            or user["id"] in (t.get("co_assignee_ids") or [])  # ASK-26
            or (t.get("assignee_role") and t.get("assignee_role") == user.get("role")))


def can_note_task(user: dict, t: dict, manages: bool = False) -> bool:
    """ASK-28 TK-01 — who may leave a NOTE on a task: everyone who can work it,
    plus the person who asked for it, plus (TK-03) the manager of someone on
    it. Hand-off and escalate stay with the people doing the work
    (`_can_work_task`)."""
    # ASK-28 TK-07: the colleague a task is waiting on may answer with a note.
    waited_on = (t.get("waiting_on") or {}).get("user_id") == user["id"]
    return bool(_can_work_task(user, t) or t.get("created_by") == user["id"] or manages or waited_on)


def can_see_all_tasks(user: dict, perms) -> bool:
    """ASK-28 TK-08 (plan 6.4) — All Tasks: the owner, or anyone given
    "See all tasks" (tasks_view_all). Off for every role by default."""
    return user.get("role") == "owner" or "tasks_view_all" in (perms or ())


def can_assign_any(user: dict, perms) -> bool:
    return user.get("role") == "owner" or "tasks_assign_any" in (perms or ())


def can_assign_person(user: dict, target: dict, team_ids, perms) -> bool:
    """ASK-28 TK-08 (plan 6.3, D1) — who a person may give work to (as doer or
    helper): anyone, for the owner or a holder of "Assign tasks to anyone";
    otherwise themselves, someone in their own team (role), or one of their
    direct reports (`team_ids`)."""
    if can_assign_any(user, perms):
        return True
    if not target:
        return False
    if target.get("id") == user.get("id"):
        return True
    if target.get("role") and target.get("role") == user.get("role"):
        return True
    return target.get("id") in set(team_ids or [])


def can_assign_team(user: dict, role_key: Optional[str], perms) -> bool:
    """Routing a task to a whole team: one's own team, unless assigning to anyone."""
    return can_assign_any(user, perms) or (bool(role_key) and role_key == user.get("role"))


def manages_task(t: dict, team_ids) -> bool:
    """ASK-28 TK-03 — the doer or a helper on this task reports to me.
    `team_ids` are the ids of my direct reports (users whose
    reporting_manager_id is me)."""
    team = {i for i in (team_ids or []) if i}
    return bool(team and team.intersection(assignee_ids_of(t)))


# ASK-28 TK-05 — the approval moment. The creator picks it per task:
#   "start"  approve before work starts (the lock tasks always had; the default,
#            and what every older approval task without a stage means)
#   "close"  approve before it's marked done: the doer works freely, Complete
#            sends it to the approver, Approve closes it, Request changes sends
#            it back to In progress with the reason.
APPROVAL_STAGES = ("start", "close")


def approval_stage(t: dict) -> Optional[str]:
    """None for a task without approval, else "start" or "close"."""
    if not t.get("approval_required"):
        return None
    return "close" if t.get("approval_stage") == "close" else "start"


def is_start_locked(t: dict) -> bool:
    """Work (status, progress, the checklist) is locked until approved —
    only for approval before work starts."""
    return approval_stage(t) == "start" and t.get("approval_status") != "approved"


def completion_updates(t: dict, can_approve: bool) -> dict:
    """What "mark done" writes. Approval before closing turns it into a
    request for sign-off, unless the person completing may approve it."""
    if approval_stage(t) != "close":
        return {"status": "done"}
    if can_approve:
        return {"status": "done", "approval_status": "approved"}
    return {"status": "review", "approval_status": "pending"}


def reopen_updates(t: dict, new_status: str) -> dict:
    """Moving a close-stage task back into work withdraws a pending sign-off
    request, and a reopened signed-off task needs signing off again. A
    "changes requested" note stays so the doer can still read it."""
    if (approval_stage(t) == "close" and new_status not in ("done", "review")
            and t.get("approval_status") in ("pending", "approved")):
        return {"approval_status": None}
    return {}


def task_list_query(user: dict, mine: bool = False, view: Optional[str] = None,
                    status: Optional[str] = None, can_approve_any: bool = False,
                    team_ids: Optional[List[str]] = None, see_all: bool = False) -> dict:
    """The Mongo filter behind GET /tasks.

    view="team" (ASK-28 TK-03, "My team"): tasks whose doer or a helper is one
    of my direct reports. `team_ids` are their ids; with none, nothing matches.

    view="approvals" (ASK-28 TK-02, "Waiting for my approval"): tasks that need
    approval, are not approved yet (a "changes requested" task still waits on
    the approver) and are not finished — limited to the ones I may approve,
    the same rule as routers.tasks._can_approve_task:
      owner                      every one of them
      named approver             tasks that name me
      `approvals` access holder  tasks that name me + tasks that name nobody
    `can_approve_any` is whether the user holds the `approvals` permission.

    view="asked" (ASK-28 TK-01, "Asked by me"): tasks I created that are not
    mine to do — I am neither the doer nor a helper. `mine` is ignored there.
    Otherwise, unchanged:
      mine=true            my tasks + unclaimed tasks in my role's pool
      mine=false, non-owner my role lane (my tasks + my role's tasks)
      mine=false, owner    everything
    """
    uid = user["id"]
    q: dict = {"tenant_id": user["tenant_id"]}
    if status:
        q["status"] = status
    if view == "approvals":
        q["approval_required"] = True
        # ASK-28 TK-05: approval before work starts waits until approved (changes
        # requested included); approval before closing waits only while the
        # doer has sent it for sign-off — sent back, it is the doer's again.
        q["$and"] = [{"$or": [
            {"approval_stage": {"$ne": "close"}, "approval_status": {"$ne": "approved"}},
            {"approval_stage": "close", "approval_status": "pending"},
        ]}]
        if not status:
            q["status"] = {"$nin": ["done", "cancelled"]}
        if user.get("role") != "owner":
            if can_approve_any:
                q["$or"] = [{"approver_id": uid}, {"approver_id": None}, {"approver_id": ""}]
            else:
                q["approver_id"] = uid
        return q
    if view == "team":
        ids = [i for i in (team_ids or []) if i]
        # $in on an array field matches when any helper is in the team; an
        # empty list matches nothing, so someone with no reports sees none.
        q["$or"] = [{"assignee_id": {"$in": ids}}, {"co_assignee_ids": {"$in": ids}}]
        return q
    if view == "asked":
        q["created_by"] = uid
        # $ne also matches a task with no doer, and on an array it means
        # "does not contain" — so a task I'm only helping on stays out.
        q["assignee_id"] = {"$ne": uid}
        q["co_assignee_ids"] = {"$ne": uid}
        return q
    if mine:
        # ASK-26: and tasks I am on alongside the lead.
        q["$or"] = [{"assignee_id": uid}, {"co_assignee_ids": uid},
                    {"assignee_id": None, "assignee_role": user["role"]}]
    elif user["role"] != "owner" and not see_all:  # ASK-28 TK-08: See all tasks widens it
        q["$or"] = [{"assignee_id": uid}, {"co_assignee_ids": uid}, {"assignee_role": user["role"]}]
    return q


# ---------------------------------------------------------------------------
# ASK-26 — multiple assignees
# ---------------------------------------------------------------------------
# A task has ONE lead (assignee_id) and any number of people alongside them
# (co_assignee_ids). The lead is kept because approvals, hand-offs, reassign,
# least-loaded routing and every workload count already act on assignee_id;
# the list adds people to the task without moving any of that.
MAX_CO_ASSIGNEES = 10


async def clean_co_assignees(tenant_id: str, ids, lead_id: Optional[str]) -> List[str]:
    """The co-assignee list made safe to store: de-duplicated in the order
    given, never containing the lead, only members of this tenant, capped.
    Unknown ids are dropped rather than rejected — the same way an unknown
    assignee_id is treated on create."""
    seen, wanted = set(), []
    for i in ids or []:
        if isinstance(i, str) and i and i != lead_id and i not in seen:
            seen.add(i)
            wanted.append(i)
    if not wanted:
        return []
    found = {u["id"] for u in await db.users.find(
        {"id": {"$in": wanted}, "tenant_id": tenant_id}, {"_id": 0, "id": 1}
    ).to_list(len(wanted))}
    return [i for i in wanted if i in found][:MAX_CO_ASSIGNEES]


def assignee_ids_of(t: dict) -> List[str]:
    """Everyone on the task, lead first — who gets told when it moves."""
    return [i for i in dict.fromkeys([t.get("assignee_id"), *(t.get("co_assignee_ids") or [])]) if i]


def _plan_progress(steps: list) -> int:
    if not steps:
        return 0
    done = sum(1 for s in steps if s.get("done"))
    return round(done / len(steps) * 100)


async def _tenant_industry(tenant_id: str) -> str:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "industry": 1})
    return (t or {}).get("industry") or "general"


async def _attach_reference_ids(tenant_id, user_id, task_id, file_ids, background=None):
    """Link previously-staged reference files (POST /files) to a task.

    `_file_public` and `_analyze_reference_file` still live in `server.py` (they
    depend on obj_store + Claude + LLM_MODEL); imported here on demand to avoid
    the `server.py ↔ services.tasks` cycle.
    """
    from services.files import _analyze_reference_file, _file_public
    for fid in (file_ids or []):
        rec = await db.files.find_one({"id": fid, "tenant_id": tenant_id, "is_deleted": False}, {"_id": 0})
        if not rec:
            continue
        await db.files.update_one({"id": fid}, {"$set": {"task_id": task_id, "kind": "reference"}})
        rec["kind"] = "reference"
        await db.tasks.update_one({"id": task_id}, {"$push": {"attachments": _file_public(rec)}})
        if background is not None:
            background.add_task(_analyze_reference_file, tenant_id, task_id, rec)

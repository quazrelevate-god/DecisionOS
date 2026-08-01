"""Tasks — pure/light-touch helpers extracted from `server.py` in Phase B step 4.

Scope of THIS pass (safe, no inline call-graph fanout):
  • `TASK_STATUSES`                — canonical status vocabulary
  • `_derive_task_type(t)`         — task_type ← stored key / role / 'other'
  • `_task_activity(t)`            — (updated_at, last_action) fallback derivation
  • `enrich_task(t)` / `enrich_tasks(list)` — hydrate assignee/support/approver names
  • `_can_work_task(user, t)`      — permission gate used by task-owning endpoints
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


async def enrich_task(t: Optional[dict]) -> Optional[dict]:
    if not t:
        return t
    ids = list({t.get(k) for k in ("assignee_id", "support_id", "approver_id", "created_by") if t.get(k)})
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(50):
            umap[u["id"]] = u["name"]
    t["assignee_name"] = umap.get(t.get("assignee_id"))
    t["support_name"] = umap.get(t.get("support_id"))
    t["approver_name"] = umap.get(t.get("approver_id"))
    t["created_by_name"] = umap.get(t.get("created_by"))
    t["attachment_count"] = len(t.get("attachments") or [])
    t["task_type"] = _derive_task_type(t)
    at, action = _task_activity(t)
    t["updated_at"], t["last_action"] = at, action
    return t


async def enrich_tasks(tasks: List[dict]) -> List[dict]:
    ids = set()
    for t in tasks:
        for k in ("assignee_id", "support_id", "approver_id", "created_by"):
            if t.get(k):
                ids.add(t[k])
    umap = {}
    if ids:
        for u in await db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "name": 1}).to_list(500):
            umap[u["id"]] = u["name"]
    for t in tasks:
        t["assignee_name"] = umap.get(t.get("assignee_id"))
        t["support_name"] = umap.get(t.get("support_id"))
        t["approver_name"] = umap.get(t.get("approver_id"))
        t["created_by_name"] = umap.get(t.get("created_by"))
        t["attachment_count"] = len(t.get("attachments") or [])
        t["task_type"] = _derive_task_type(t)
        at, action = _task_activity(t)
        t["updated_at"], t["last_action"] = at, action
    return tasks


def _can_work_task(user: dict, t: dict) -> bool:
    return (user.get("role") == "owner"
            or t.get("assignee_id") == user["id"]
            or (t.get("assignee_role") and t.get("assignee_role") == user.get("role")))


def _plan_progress(steps: list) -> int:
    if not steps:
        return 0
    done = sum(1 for s in steps if s.get("done"))
    return round(done / len(steps) * 100)

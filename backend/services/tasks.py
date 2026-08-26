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
        for k in ("assignee_id", "support_id", "approver_id", "created_by"):
            if t.get(k):
                ids.add(t[k])
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
        t["support_name"] = umap.get(t.get("support_id"))
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
            or (t.get("assignee_role") and t.get("assignee_role") == user.get("role")))


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

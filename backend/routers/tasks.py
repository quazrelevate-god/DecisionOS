"""Tasks router — extracted from `server.py` in Phase B step 2 (partial).

This first pass owns the SAFE leaf endpoints:
  • GET  /api/tasks              — list (with `status`, `mine` filters)
  • GET  /api/tasks/{id}         — detail
  • DELETE /api/tasks/{id}       — owner-only delete

The complex flows (create/update/approve/reject/reassign/execution-plan/
respond/attachment/prioritize) stay in `server.py` for now because they
transitively pull in ~15 inline helpers (`_attach_reference_ids`,
`_approver_ids`, `pick_least_loaded_member`, `_route_task_via_ai`,
`_maybe_generate_execution_plan`, etc.). Those helpers will move into
`services/tasks.py` in a follow-up PR before the remaining endpoints
can be extracted safely.

Server-local helpers (`enrich_task`, `enrich_tasks`, `_can_work_task`)
are deferred-imported inside handlers to avoid a circular import.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user


router = APIRouter(prefix="/api/tasks")


@router.get("")
async def list_tasks(
    status: Optional[str] = None,
    mine: Optional[bool] = False,
    user: dict = Depends(get_current_user),
):
    from server import enrich_tasks  # deferred to break the cycle
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


@router.get("/{task_id}")
async def get_task(task_id: str, user: dict = Depends(get_current_user)):
    from server import enrich_task, _can_work_task  # deferred to break the cycle
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Task not found")
    allowed = (user.get("role") == "owner" or _can_work_task(user, t)
               or t.get("approver_id") == user["id"] or t.get("created_by") == user["id"]
               or t.get("support_id") == user["id"])
    if not allowed:
        raise HTTPException(status_code=403, detail="You don't have access to this work")
    return await enrich_task(t)


@router.delete("/{task_id}")
async def delete_task(task_id: str, user: dict = Depends(get_current_user)):
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can delete tasks")
    t = await db.tasks.find_one({"id": task_id, "tenant_id": user["tenant_id"]}, {"_id": 0, "id": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    await db.tasks.delete_one({"id": task_id, "tenant_id": user["tenant_id"]})
    return {"ok": True, "deleted": task_id}

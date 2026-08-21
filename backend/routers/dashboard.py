"""Dashboard / daily-brief endpoint (Epic 8 Sprint 3 -- from server.py).

The home aggregate: pending decisions/purchases, overdue tasks, stats,
on-leave, recent activity + today's wins. run_followup + enrich_decisions
stay in server; tenant pipeline resolvers are deferred-imported from services.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from core import db, get_current_user
from services.tasks import enrich_tasks
from server import run_followup, enrich_decisions  # cross-domain; move in Sprint 4

router = APIRouter(prefix="/api")


@router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    await run_followup(tid)
    now = datetime.now(timezone.utc).isoformat()
    pending_decisions = await db.decisions.find({"tenant_id": tid, "status": "pending_approval"}, {"_id": 0}).to_list(50)
    # FIX-001-A: resolve the tenant's actual procurement pipeline instead of the textile 'purchase_payment' hardcode.
    from services.workflows import tenant_procurement_pipeline, procurement_initial_stage
    _proc = await tenant_procurement_pipeline(tid)
    if _proc and procurement_initial_stage(_proc):
        pending_purchases = await db.workflows.find(
            {"tenant_id": tid, "type": _proc["key"], "stage": procurement_initial_stage(_proc)}, {"_id": 0}
        ).to_list(50)
    else:
        pending_purchases = []
    overdue = await db.tasks.find({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}, "due_date": {"$lt": now, "$ne": None}}, {"_id": 0}).to_list(50)
    open_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": {"$in": ["todo", "in_progress"]}})
    done_tasks = await db.tasks.count_documents({"tenant_id": tid, "status": "done"})
    # FIX-001-F: exclude the tenant's actual terminal stages, not just the
    # textile ones. A salon's 'served' or a bakery's 'settled' now correctly
    # marks a workflow as done so the counter stops climbing forever.
    from services.workflows import tenant_terminal_stages
    _term_stages = await tenant_terminal_stages(tid)
    active_wf = await db.workflows.count_documents({"tenant_id": tid, "stage": {"$nin": _term_stages}})
    activity = await db.activity.find({"tenant_id": tid}, {"_id": 0}).sort("created_at", -1).to_list(15)
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    wins = await db.activity.find(
        {"tenant_id": tid, "kind": {"$in": ["task_done", "decision_approved", "workflow_advanced"]}, "created_at": {"$gte": today_start}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(20)
    today_date = datetime.now(timezone.utc).date().isoformat()
    on_leave = await db.leaves.find(
        {"tenant_id": tid, "status": "approved", "from_date": {"$lte": today_date}, "to_date": {"$gte": today_date}},
        {"_id": 0, "user_id": 1, "user_name": 1, "user_role": 1, "leave_type": 1, "to_date": 1, "day_portion": 1}
    ).to_list(100)
    pending_leaves = await db.leaves.count_documents({"tenant_id": tid, "status": "pending"})
    return {
        # FIX-003-B (S2-05): explicit tenant_id (defense-in-depth).
        "pending_decisions": await enrich_decisions(pending_decisions, tenant_id=tid),
        "pending_purchases": pending_purchases,
        "overdue_tasks": await enrich_tasks(overdue),
        "stats": {"open_tasks": open_tasks, "done_tasks": done_tasks, "active_workflows": active_wf,
                  "pending_approvals": len(pending_decisions) + len(pending_purchases),
                  "on_leave_today": len(on_leave), "pending_leaves": pending_leaves},
        "on_leave": on_leave,
        "activity": activity,
        "wins": wins,
    }

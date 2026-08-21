"""Operating-score + AI work-coach endpoints (Epic 8 Sprint 3 -- from server.py).

Viewer-aware company/self operating dashboard and the personal AI work coach.
The scoring/coaching helpers (_company_operating_view, _self_operating_view,
compute_employee_stats, ai_work_coach, _resolve_coach_target) stay in server
until Sprint 4.
"""
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from core import db, get_current_user, now_iso
from server import (  # cross-domain helpers; move in Sprint 4
    _company_operating_view, _self_operating_view, compute_employee_stats,
    _resolve_coach_target, ai_work_coach,
)

router = APIRouter(prefix="/api")


@router.get("/operating-score")
async def operating_score(
    user_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Viewer-aware operating dashboard.

    Epic 7 Sprint 1 Phase A (2026-08-17): opened this endpoint from
    owner-only to any authenticated user. Owner keeps the company view;
    every other role gets a personal contributor view.

    Epic 7 Sprint 1 batch 4 (2026-08-17): added owner-only view-as.
    Founder ask: 'from the owner side if i click the team member is it
    working better or not will show their tasks all the things the
    individual ops has right'. Answer was no -- clicks went to WorkCoach
    which shows only stats + AI review, not the person's open work or
    active workflows. Now: /api/operating-score?user_id=X returns X's
    full self-view (open work, active workflows, peer context, rich
    stats) so the owner sees exactly what the teammate sees. Non-owners
    passing user_id get 403 -- privacy holds.

    Payloads carry a `view` discriminator so the frontend dispatcher
    can render OwnerView vs SelfView cleanly without probing shape.
    Owner viewing someone else's payload has view='self' plus
    view_as: {id, name, role} so the frontend can show a breadcrumb.
    """
    tid = user["tenant_id"]
    now = datetime.now(timezone.utc).isoformat()
    is_owner = user.get("role") == "owner"

    # Owner-only view-as: return target's self-view instead of the
    # owner's company view.
    if user_id and user_id != user["id"]:
        if not is_owner:
            raise HTTPException(
                status_code=403,
                detail="Only the owner can view another user's operating page",
            )
        target = await db.users.find_one(
            {"id": user_id, "tenant_id": tid},
            {"_id": 0, "id": 1, "name": 1, "role": 1, "email": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="Team member not found")
        payload = await _self_operating_view(tid, target, now)
        payload["view"] = "self"
        payload["view_as"] = {
            "id": target["id"],
            "name": target.get("name"),
            "role": target.get("role"),
        }
        return payload

    if is_owner:
        payload = await _company_operating_view(tid, user, now)
        # Owner is also an IC -- give them their own snapshot so they can
        # see how their personal work stacks up without switching views.
        payload["my_snapshot"] = await compute_employee_stats(tid, user)
        payload["view"] = "owner"
        return payload

    payload = await _self_operating_view(tid, user, now)
    payload["view"] = "self"
    return payload


@router.get("/work-coach")
async def get_work_coach(user_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    target = await _resolve_coach_target(user, user_id)
    stats = await compute_employee_stats(user["tenant_id"], target)
    cached = target.get("coach_summary")
    return {"target": {"id": target["id"], "name": target.get("name"), "role": target.get("role")},
            "stats": stats, "summary": cached}


@router.post("/work-coach/refresh")
async def refresh_work_coach(user_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    target = await _resolve_coach_target(user, user_id)
    stats = await compute_employee_stats(user["tenant_id"], target)
    summary = await ai_work_coach(target, stats, session_id=f"coach-{target['id']}")
    summary["generated_at"] = now_iso()
    summary["stats_snapshot"] = stats
    await db.users.update_one({"id": target["id"]}, {"$set": {"coach_summary": summary}})
    return {"target": {"id": target["id"], "name": target.get("name"), "role": target.get("role")},
            "stats": stats, "summary": summary}

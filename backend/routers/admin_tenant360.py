"""Admin console -- Tenant 360 & cross-tenant search (Epic 10 Sprint 1).

One consolidated per-workspace view for support/ops: plan + entitlements, members,
AI spend, entity counts, recent activity, and health signals -- plus a cross-tenant
search to find a workspace or user by name/email/phone/id. All routes are gated by
get_platform_admin and are READ-ONLY (mutations live in the existing admin router).
"""
from __future__ import annotations
from services.tenant_ai_keys import TENANT_PUBLIC

import asyncio
import re
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, get_platform_admin
from services.admin_workspaces import is_test_tenant, test_reason
from services.platform_config import usd_inr_rate

router = APIRouter(prefix="/api/admin")


def _cutoff_iso(rng: str):
    """ISO cutoff string for a range key, or None for all-time. usage_events.created_at
    is an ISO string (now_iso), so lexical >= comparison is correct."""
    now = datetime.now(timezone.utc)
    dt = {
        "today": now.replace(hour=0, minute=0, second=0, microsecond=0),
        "7d": now - timedelta(days=7),
        "30d": now - timedelta(days=30),
    }.get(rng)
    return dt.isoformat() if dt else None


def _tname(t: dict) -> str:
    return t.get("company_name") or t.get("name") or "—"


@router.get("/search")
async def admin_search(q: str = Query("", min_length=0), admin: dict = Depends(get_platform_admin)):
    """Cross-tenant search: workspaces by name/id, users by name/email/phone/id."""
    q = (q or "").strip()
    if len(q) < 2:
        return {"query": q, "tenants": [], "users": []}
    # Escaped (2026-10-22): what is typed is text to find, not a pattern —
    # "a+b@x.com" or "(" no longer errors or matches the wrong thing.
    rx = {"$regex": re.escape(q), "$options": "i"}
    tenants = await db.tenants.find(
        {"$or": [{"name": rx}, {"company_name": rx}, {"id": q}]},
        {"_id": 0, "id": 1, "name": 1, "company_name": 1, "plan": 1, "suspended": 1, "created_at": 1},
    ).limit(25).to_list(25)
    users = await db.users.find(
        {"$or": [{"name": rx}, {"email": rx}, {"phone": rx}, {"phone_norm": rx}, {"id": q}]},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1, "role": 1, "tenant_id": 1, "suspended": 1},
    ).limit(25).to_list(25)
    tids = list({u.get("tenant_id") for u in users if u.get("tenant_id")})
    tmap = {t["id"]: _tname(t) for t in await db.tenants.find(
        {"id": {"$in": tids}}, {"_id": 0, "id": 1, "name": 1, "company_name": 1}).to_list(50)}
    for u in users:
        u["tenant_name"] = tmap.get(u.get("tenant_id"), "—")
    for t in tenants:
        t["name"] = _tname(t)
    return {"query": q, "tenants": tenants, "users": users}


@router.get("/tenants/{tenant_id}/360")
async def admin_tenant_360(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    """Consolidated per-workspace view: plan, members, AI spend, entity counts,
    recent activity, and health signals -- one call for the Tenant 360 screen."""
    t = await db.tenants.find_one({"id": tenant_id}, TENANT_PUBLIC)
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")

    async def count(coll, extra=None):
        return await db[coll].count_documents({"tenant_id": tenant_id, **(extra or {})})

    (users, active_members, decisions, tasks, tasks_done, captures,
     workflows, contacts, invoices, complaints) = await asyncio.gather(
        count("users"), count("memberships", {"status": "active"}),
        count("decisions"), count("tasks"), count("tasks", {"status": "done"}),
        count("capture_drafts"), count("workflows"), count("contacts"),
        count("invoices"), count("complaints"),
    )

    members = await db.users.find(
        {"tenant_id": tenant_id},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "suspended": 1,
         "created_at": 1, "updated_at": 1},
    ).sort("created_at", 1).to_list(200)

    async def spend(rng):
        match = {"tenant_id": tenant_id}
        c = _cutoff_iso(rng)
        if c:
            match["created_at"] = {"$gte": c}
        cur = await db.usage_events.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "calls": {"$sum": 1},
                        "tokens": {"$sum": "$tokens_total"}, "cost": {"$sum": "$cost_estimate"}}},
        ])
        r = await cur.to_list(1)
        return ({"calls": r[0]["calls"], "tokens": r[0]["tokens"], "cost": round(r[0]["cost"] or 0, 4)}
                if r else {"calls": 0, "tokens": 0, "cost": 0.0})

    spend_30d, spend_all = await asyncio.gather(spend("30d"), spend(None))

    # 2026-10-23 (admin console v2): when each person was last here, the
    # company's milestones and lifecycle, and its last 30 days of counts.
    from services import lifecycle, rollups
    from services.milestones import MILESTONE_LABELS
    seen = {m["user_id"]: m for m in await db.memberships.find(
        {"tenant_id": tenant_id}, {"_id": 0, "user_id": 1, "last_seen_at": 1, "last_login_at": 1, "status": 1,
                                    "invited_at": 1, "accepted_at": 1}).to_list(500)}
    from services.presence import live_last_seen
    live = await live_last_seen(db, [tenant_id])
    for m in members:
        s = seen.get(m["id"]) or {}
        m["last_seen_at"] = max(filter(None, [s.get("last_seen_at"), live.get((m["id"], tenant_id))]), default=None)
        m["last_login_at"] = s.get("last_login_at")
        m["membership_status"] = s.get("status")
    ms = t.get("milestones") or {}
    milestones = [{"key": k, "label": label, "at": ms.get(k)} for k, label in MILESTONE_LABELS.items()]
    events, daily = await asyncio.gather(lifecycle.events_for(tenant_id, 30, database=db),
                                         rollups.series(tenant_id, 30, database=db))

    activity = await db.activity.find(
        {"tenant_id": tenant_id}, {"_id": 0}).sort("created_at", -1).to_list(20)

    return {
        "tenant": {
            "id": t["id"], "name": _tname(t),
            "plan": t.get("plan"), "seat_limit": t.get("seat_limit"),
            "seat_limit_override": t.get("seat_limit_override"),
            "industry": t.get("industry"), "region": t.get("region"), "currency": t.get("currency"),
            "created_at": t.get("created_at"),
            "suspended": bool(t.get("suspended")),
            "feature_flags": t.get("feature_flags", {}), "usage_quotas": t.get("usage_quotas", {}),
            "ai_consent": bool((t.get("ai_consent") or {}).get("granted_at")),
            "ai_setup_status": t.get("ai_setup_status", {}),
            "roles": t.get("roles", []),
            "gst": t.get("gst"),
            # 2026-10-22 (admin redesign): the workspace page shows the trial's
            # end and whether this is one of our test workspaces.
            "trial_ends_at": t.get("trial_ends_at"),
            "suspended_at": t.get("suspended_at"), "suspended_reason": t.get("suspended_reason"),
            "is_test": is_test_tenant(t), "test_reason": test_reason(t),
        },
        "usd_inr": await usd_inr_rate(),
        "counts": {
            "users": users, "active_members": active_members, "decisions": decisions,
            "tasks": tasks, "tasks_done": tasks_done, "captures": captures,
            "workflows": workflows, "contacts": contacts, "invoices": invoices,
            "complaints": complaints,
        },
        "members": members,
        "milestones": milestones,
        "lifecycle": events,
        "daily": daily,
        "spend": {"last_30d": spend_30d, "all_time": spend_all},
        "activity": activity,
        "health": {
            "last_activity": activity[0]["created_at"] if activity else None,
            "suspended": bool(t.get("suspended")),
            "ai_consent": bool((t.get("ai_consent") or {}).get("granted_at")),
        },
    }

"""Admin console -- Tenant 360 & cross-tenant search (Epic 10 Sprint 1).

One consolidated per-workspace view for support/ops: plan + entitlements, members,
AI spend, entity counts, recent activity, and health signals -- plus a cross-tenant
search to find a workspace or user by name/email/phone/id. All routes are gated by
get_platform_admin and are READ-ONLY (mutations live in the existing admin router).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, get_platform_admin

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
    rx = {"$regex": q, "$options": "i"}
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
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
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
        },
        "counts": {
            "users": users, "active_members": active_members, "decisions": decisions,
            "tasks": tasks, "tasks_done": tasks_done, "captures": captures,
            "workflows": workflows, "contacts": contacts, "invoices": invoices,
            "complaints": complaints,
        },
        "members": members,
        "spend": {"last_30d": spend_30d, "all_time": spend_all},
        "activity": activity,
        "health": {
            "last_activity": activity[0]["created_at"] if activity else None,
            "suspended": bool(t.get("suspended")),
            "ai_consent": bool((t.get("ai_consent") or {}).get("granted_at")),
        },
    }

"""Admin console -- what customers hear from us, and what they tell us
(2026-10-23, admin console v2 P4).

  GET /api/admin/messages   every email / SMS / WhatsApp / push we tried to send
                            (core/outbound): channel, kind, company, person, a
                            masked recipient, sent / failed / skipped. Never the
                            body. Filter by company, channel, status; a 7-day
                            tally per channel on top.
  GET /api/admin/nps        the recommend score (routers/nps), its split, and
                            the latest comments.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from core import db, get_platform_admin
from core.outbound import CHANNELS, STATUSES
from routers import nps as nps_mod
from services.admin_workspaces import workspace_name

router = APIRouter(prefix="/api/admin")


async def _names(tenant_ids, user_ids) -> tuple:
    tids = sorted({t for t in tenant_ids if t})
    uids = sorted({u for u in user_ids if u})
    tenants = await db.tenants.find({"id": {"$in": tids}}, {"_id": 0, "id": 1, "name": 1, "company_name": 1}).to_list(len(tids) or 1)
    users = await db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "name": 1}).to_list(len(uids) or 1)
    return ({t["id"]: workspace_name(t) for t in tenants}, {u["id"]: u.get("name") or "" for u in users})


@router.get("/messages")
async def messages(admin: dict = Depends(get_platform_admin), tenant_id: Optional[str] = None,
                   channel: Optional[str] = None, status: Optional[str] = None,
                   limit: int = Query(100, ge=1, le=500)):
    q = {}
    if tenant_id:
        q["tenant_id"] = tenant_id
    if channel in CHANNELS:
        q["channel"] = channel
    if status in STATUSES:
        q["status"] = status
    rows = await db.outbound_messages.find(q, {"_id": 0, "created": 0}).sort("at", -1).to_list(limit)
    tnames, unames = await _names([r.get("tenant_id") for r in rows], [r.get("user_id") for r in rows])
    for r in rows:
        r["tenant_name"] = tnames.get(r.get("tenant_id")) if r.get("tenant_id") else None
        r["user_name"] = unames.get(r.get("user_id")) or None

    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    week_q = {"at": {"$gte": since}, **({"tenant_id": tenant_id} if tenant_id else {})}
    week = await db.outbound_messages.find(week_q, {"_id": 0, "channel": 1, "status": 1, "kind": 1}).to_list(20000)
    tally = {c: {s: 0 for s in STATUSES} for c in CHANNELS}
    failing: dict = {}
    for r in week:
        c, s = r.get("channel"), r.get("status")
        if c in tally and s in tally[c]:
            tally[c][s] += 1
        if s == "failed":
            key = f"{c}:{r.get('kind') or 'other'}"
            failing[key] = failing.get(key, 0) + 1
    top_failing = sorted(({"channel": k.split(":", 1)[0], "kind": k.split(":", 1)[1], "count": n}
                          for k, n in failing.items()), key=lambda x: -x["count"])[:5]
    return {"messages": rows, "week": tally, "failing": top_failing}


@router.get("/nps")
async def nps(admin: dict = Depends(get_platform_admin), days: int = Query(90, ge=7, le=365)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = await db.nps_responses.find({"created_at": {"$gte": since}}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    scored = [r for r in rows if not r.get("dismissed") and isinstance(r.get("score"), int)]
    pro = sum(1 for r in scored if r["score"] >= 9)
    det = sum(1 for r in scored if r["score"] <= 6)
    n = len(scored)
    recent = [r for r in scored if r.get("comment")][:20]
    tnames, unames = await _names([r.get("tenant_id") for r in recent], [r.get("user_id") for r in recent])
    for r in recent:
        r["tenant_name"] = tnames.get(r.get("tenant_id"))
        r["user_name"] = unames.get(r.get("user_id")) or None
    return {
        "enabled": await nps_mod.enabled(), "days": days, "responses": n,
        "dismissed": sum(1 for r in rows if r.get("dismissed")),
        "score": round(100 * (pro - det) / n) if n else None,
        "promoters": pro, "passives": n - pro - det, "detractors": det,
        "comments": recent,
    }

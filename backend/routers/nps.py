"""How likely are you to recommend us? (admin console v2 P4, 2026-10-23).

A one-question card in the app, OFF until a platform admin turns on the global
flag `nps` (Admin › Config). Asked at most once every 90 days per person, and
not in a workspace's first 14 days. A dismissal counts as an answer so the card
doesn't come back the next day.

  GET  /api/nps/ask   should this person see the card now?
  POST /api/nps       a score 0-10 (and an optional comment), or a dismissal

The console reads the answers at GET /api/admin/nps (routers/admin_messages).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_current_user, new_id, now_iso
from services import platform_config as pc

router = APIRouter(prefix="/api/nps")

FLAG = "nps"
EVERY_DAYS = 90
WORKSPACE_MIN_AGE_DAYS = 14


class NpsInput(BaseModel):
    score: Optional[int] = None
    comment: str = ""
    dismissed: bool = False


async def enabled() -> bool:
    return bool(((await pc.get(pc.K_FLAGS, {})) or {}).get(FLAG))


async def should_ask(user: dict, now: Optional[datetime] = None) -> bool:
    if not await enabled():
        return False
    now = now or datetime.now(timezone.utc)
    t = await db.tenants.find_one({"id": user.get("tenant_id")}, {"_id": 0, "created_at": 1}) or {}
    try:
        born = datetime.fromisoformat(str(t.get("created_at")).replace("Z", "+00:00"))
        born = born if born.tzinfo else born.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return False
    if now - born < timedelta(days=WORKSPACE_MIN_AGE_DAYS):
        return False
    since = (now - timedelta(days=EVERY_DAYS)).isoformat()
    last = await db.nps_responses.find_one(
        {"user_id": user["id"], "created_at": {"$gte": since}}, {"_id": 0, "id": 1})
    return last is None


@router.get("/ask")
async def ask(user: dict = Depends(get_current_user)):
    return {"ask": await should_ask(user)}


@router.post("")
async def answer(payload: NpsInput, user: dict = Depends(get_current_user)):
    if not await enabled():
        raise HTTPException(status_code=404, detail="Not available")
    if not payload.dismissed and (payload.score is None or not 0 <= payload.score <= 10):
        raise HTTPException(status_code=422, detail="Pick a score from 0 to 10")
    doc = {
        "id": new_id(), "tenant_id": user["tenant_id"], "user_id": user["id"], "role": user.get("role"),
        "score": None if payload.dismissed else payload.score,
        "comment": "" if payload.dismissed else (payload.comment or "").strip()[:1000],
        "dismissed": bool(payload.dismissed), "created_at": now_iso(),
    }
    await db.nps_responses.insert_one(dict(doc))
    return {"status": "ok"}

"""Admin console -- announcements & comms (Epic 10 Sprint 8).

In-app broadcasts + maintenance banners (audience: all / a plan / one tenant), and a
targeted email blast to workspace owners. Admins manage announcements here; tenants read
their active ones from GET /api/announcements/active to render a banner. Writes audited.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_platform_admin, get_current_user, new_id, now_iso
from routers.admin import log_admin_action

# Admin-facing (prefix /api/admin) + tenant-facing (prefix /api) routers.
router = APIRouter(prefix="/api/admin")
tenant_router = APIRouter(prefix="/api")

KINDS = ("info", "warning", "maintenance")


class AnnouncementInput(BaseModel):
    title: str
    body: str = ""
    kind: str = "info"
    audience: str = "all"          # "all" | "plan:<key>" | "tenant:<id>"
    active: bool = True
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    dismissible: bool = True


class AnnouncementPatch(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    kind: Optional[str] = None
    audience: Optional[str] = None
    active: Optional[bool] = None
    starts_at: Optional[str] = None
    ends_at: Optional[str] = None
    dismissible: Optional[bool] = None


def _pub(a: dict) -> dict:
    a.pop("_id", None)
    return a


def _targets_tenant(a: dict, tenant: dict) -> bool:
    aud = a.get("audience") or "all"
    if aud == "all":
        return True
    if aud.startswith("plan:"):
        return (tenant.get("plan") or "") == aud.split(":", 1)[1]
    if aud.startswith("tenant:"):
        return tenant.get("id") == aud.split(":", 1)[1]
    return False


def _is_live(a: dict, now_iso_str: str) -> bool:
    if not a.get("active"):
        return False
    if a.get("starts_at") and a["starts_at"] > now_iso_str:
        return False
    if a.get("ends_at") and a["ends_at"] < now_iso_str:
        return False
    return True


# --- Admin CRUD -------------------------------------------------------------
@router.get("/announcements")
async def list_announcements(admin: dict = Depends(get_platform_admin)):
    rows = await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    now = now_iso()
    for r in rows:
        r["live"] = _is_live(r, now)
    return {"announcements": rows}


@router.post("/announcements")
async def create_announcement(payload: AnnouncementInput, admin: dict = Depends(get_platform_admin)):
    if not payload.title.strip():
        raise HTTPException(status_code=422, detail="Title is required")
    if payload.kind not in KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {list(KINDS)}")
    doc = {"id": new_id(), "title": payload.title.strip()[:200], "body": payload.body.strip()[:4000],
           "kind": payload.kind, "audience": payload.audience or "all", "active": bool(payload.active),
           "starts_at": payload.starts_at, "ends_at": payload.ends_at, "dismissible": bool(payload.dismissible),
           "created_by": admin.get("email"), "created_at": now_iso(), "updated_at": now_iso()}
    await db.announcements.insert_one(dict(doc))
    await log_admin_action(admin, "announcement_create", f"Created {payload.kind} announcement '{doc['title']}' ({doc['audience']})", "announcement", doc["id"])
    return _pub(doc)


@router.patch("/announcements/{aid}")
async def patch_announcement(aid: str, payload: AnnouncementPatch, admin: dict = Depends(get_platform_admin)):
    if not await db.announcements.find_one({"id": aid}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Announcement not found")
    sets = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "kind" in sets and sets["kind"] not in KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of {list(KINDS)}")
    sets["updated_at"] = now_iso()
    await db.announcements.update_one({"id": aid}, {"$set": sets})
    await log_admin_action(admin, "announcement_update", f"Updated announcement {aid}: {list(sets)}", "announcement", aid)
    return {"status": "ok", **sets}


@router.delete("/announcements/{aid}")
async def delete_announcement(aid: str, admin: dict = Depends(get_platform_admin)):
    r = await db.announcements.delete_one({"id": aid})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Announcement not found")
    await log_admin_action(admin, "announcement_delete", f"Deleted announcement {aid}", "announcement", aid)
    return {"status": "ok"}


@router.post("/announcements/{aid}/email")
async def email_announcement(aid: str, admin: dict = Depends(get_platform_admin)):
    """Email this announcement to the OWNERS of every targeted workspace. Audited; capped."""
    a = await db.announcements.find_one({"id": aid}, {"_id": 0})
    if not a:
        raise HTTPException(status_code=404, detail="Announcement not found")
    tenants = await db.tenants.find({}, {"_id": 0, "id": 1, "plan": 1}).to_list(5000)
    target_ids = [t["id"] for t in tenants if _targets_tenant(a, t)]
    owners = await db.users.find(
        {"tenant_id": {"$in": target_ids}, "role": "owner", "email": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "email": 1, "name": 1}).to_list(5000)
    from services.email import send_email
    html = f"<h2>{a['title']}</h2><p>{(a.get('body') or '').replace(chr(10), '<br/>')}</p>"
    sent = 0
    for o in owners[:1000]:
        try:
            res = await send_email(o["email"], f"[DecisionOS] {a['title']}", html)
            if res.get("sent") or res.get("provider"):
                sent += 1
        except Exception:
            pass
    await log_admin_action(admin, "announcement_email",
                           f"Emailed announcement '{a['title']}' to {sent}/{len(owners)} owners", "announcement", aid)
    return {"status": "ok", "targets": len(owners), "sent": sent}


# --- Tenant-facing active feed (for the in-app banner) ----------------------
@tenant_router.get("/announcements/active")
async def active_announcements(user: dict = Depends(get_current_user)):
    tenant = await db.tenants.find_one({"id": user["tenant_id"]}, {"_id": 0, "id": 1, "plan": 1})
    if not tenant:
        return {"announcements": []}
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.announcements.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(100)
    out = [r for r in rows if _is_live(r, now) and _targets_tenant(r, tenant)]
    return {"announcements": out}

"""Admin console -- managing customers (2026-10-23, admin console v2 P2).

  GET    /api/admin/customers                 every company with health, stage, MRR, seats,
                                              active people, last seen, AI cost, owner, tags
  PATCH  /api/admin/tenants/{id}/account      tags, account owner, next follow-up
  GET    /api/admin/tenants/{id}/notes        notes on a company (pinned first)
  POST   /api/admin/tenants/{id}/notes
  PATCH  /api/admin/notes/{note_id}           pin / unpin, edit
  DELETE /api/admin/notes/{note_id}
  POST   /api/admin/customers/bulk            tag, untag, assign an owner, mark as test / customer
  GET    /api/admin/views                     saved views, shared by the team
  POST   /api/admin/views
  DELETE /api/admin/views/{view_id}
  GET    /api/admin/tenants/{id}/timeline     one stream of what happened to a company
  GET    /api/admin/tenants/{id}/usage        product areas used, week by week
  GET    /api/admin/admin-names               who can own an account (any admin)

Every change is in the audit log. Health and stage: services/customer_health.
"""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import BILLING_PLAN_PRICES_INR_PAISE
from core import db, get_platform_admin, new_id, now_iso
from routers.admin import log_admin_action
from services import customer_health, lifecycle
from services.admin_workspaces import is_test_tenant, workspace_name
from services.plans import effective_plan
from services.presence import live_last_seen
from services.rollups import COLLECTION as DAILY, IST

router = APIRouter(prefix="/api/admin")

PAYING = ("starter", "business", "enterprise")
MAX_TAGS = 12


def _mrr(t: dict) -> float:
    if t.get("plan") not in PAYING or t.get("suspended"):
        return 0.0
    return round((BILLING_PLAN_PRICES_INR_PAISE.get(t["plan"], 0) or 0) / 100, 2)


def _clean_tags(tags) -> list:
    out = []
    for raw in tags or []:
        tag = " ".join(str(raw).strip().lower().split())[:30]
        if tag and tag not in out:
            out.append(tag)
    return out[:MAX_TAGS]


async def _tenant_or_404(tenant_id: str, projection: Optional[dict] = None) -> dict:
    t = await db.tenants.find_one({"id": tenant_id}, projection or {"_id": 0, "id": 1, "name": 1, "company_name": 1})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return t


@router.get("/customers")
async def customers(include_test: bool = False, admin: dict = Depends(get_platform_admin)):
    tenants = await db.tenants.find({}, {
        "_id": 0, "id": 1, "name": 1, "company_name": 1, "industry": 1, "plan": 1, "created_at": 1,
        "trial_ends_at": 1, "suspended": 1, "is_test": 1, "is_demo": 1, "demo": 1, "tags": 1,
        "owner_admin_id": 1, "next_follow_up_at": 1, "seat_limit_override": 1, "milestones": 1,
    }).to_list(10000)
    tenants = [t for t in tenants if include_test or not is_test_tenant(t)]
    ids = [t["id"] for t in tenants]
    computed = await customer_health.compute_all(db, ids)
    live = await live_last_seen(db, ids)
    live_by_tenant = {}
    for (_, tid), seen in live.items():
        if seen > live_by_tenant.get(tid, ""):
            live_by_tenant[tid] = seen
    admins = {a["id"]: a.get("name") or a.get("email") for a in await db.platform_admins.find(
        {}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)}
    rows = []
    for t in tenants:
        c = computed.get(t["id"]) or {}
        last = max(filter(None, [c.get("last_seen_at"), live_by_tenant.get(t["id"])]), default=None)
        rows.append({
            "id": t["id"], "name": workspace_name(t), "industry": t.get("industry"), "plan": t.get("plan"),
            "created_at": t.get("created_at"), "trial_ends_at": t.get("trial_ends_at"),
            "suspended": bool(t.get("suspended")), "is_test": is_test_tenant(t),
            "health": c.get("health"), "stage": c.get("stage"),
            "mrr_inr": _mrr(t), "seats": c.get("seats", 0), "seat_limit": effective_plan(t).get("seat_limit"),
            "active_7d": c.get("active_7d", 0), "last_seen_at": last,
            "ai_cost_30d_usd": c.get("ai_cost_30d_usd", 0.0), "actions_30d": c.get("actions_30d", 0),
            "tags": t.get("tags") or [], "owner_admin_id": t.get("owner_admin_id"),
            "owner_name": admins.get(t.get("owner_admin_id")), "next_follow_up_at": t.get("next_follow_up_at"),
            "activated_at": (t.get("milestones") or {}).get("activated_at"),
        })
    from services.platform_config import usd_inr_rate
    return {"customers": rows, "include_test": include_test, "stages": list(customer_health.STAGES),
            "usd_inr": await usd_inr_rate()}


class AccountInput(BaseModel):
    tags: Optional[List[str]] = None
    owner_admin_id: Optional[str] = None      # "" clears it
    next_follow_up_at: Optional[str] = None   # "" clears it; YYYY-MM-DD


@router.patch("/tenants/{tenant_id}/account")
async def set_account(tenant_id: str, payload: AccountInput, admin: dict = Depends(get_platform_admin)):
    t = await _tenant_or_404(tenant_id)
    sets, unsets, said = {}, {}, []
    if payload.tags is not None:
        sets["tags"] = _clean_tags(payload.tags)
        said.append(f"tags {', '.join(sets['tags']) or 'none'}")
    if payload.owner_admin_id is not None:
        if payload.owner_admin_id:
            owner = await db.platform_admins.find_one({"id": payload.owner_admin_id, "active": {"$ne": False}},
                                                      {"_id": 0, "email": 1})
            if not owner:
                raise HTTPException(status_code=422, detail="That admin doesn't exist or is deactivated")
            sets["owner_admin_id"] = payload.owner_admin_id
            said.append(f"owner {owner.get('email')}")
        else:
            unsets["owner_admin_id"] = ""
            said.append("no owner")
    if payload.next_follow_up_at is not None:
        if payload.next_follow_up_at:
            try:
                datetime.fromisoformat(payload.next_follow_up_at[:10])
            except ValueError:
                raise HTTPException(status_code=422, detail="Follow-up date must be a date")
            sets["next_follow_up_at"] = payload.next_follow_up_at[:10]
            said.append(f"follow up {sets['next_follow_up_at']}")
        else:
            unsets["next_follow_up_at"] = ""
            said.append("no follow-up")
    if not sets and not unsets:
        raise HTTPException(status_code=422, detail="Nothing to change")
    update = {}
    if sets:
        update["$set"] = sets
    if unsets:
        update["$unset"] = unsets
    await db.tenants.update_one({"id": tenant_id}, update)
    await log_admin_action(admin, "customer_account", f"{workspace_name(t)}: {'; '.join(said)}", "tenant", tenant_id)
    return {"status": "ok", **sets, **{k: None for k in unsets}}


class NoteInput(BaseModel):
    text: str
    pinned: bool = False


class NotePatch(BaseModel):
    text: Optional[str] = None
    pinned: Optional[bool] = None


@router.get("/tenants/{tenant_id}/notes")
async def list_notes(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    rows = await db.customer_notes.find({"tenant_id": tenant_id}, {"_id": 0}).to_list(500)
    rows.sort(key=lambda n: n.get("created_at") or "", reverse=True)   # newest first...
    rows.sort(key=lambda n: not n.get("pinned"))                       # ...pinned on top (stable)
    return {"notes": rows}


@router.post("/tenants/{tenant_id}/notes")
async def add_note(tenant_id: str, payload: NoteInput, admin: dict = Depends(get_platform_admin)):
    t = await _tenant_or_404(tenant_id)
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write the note first")
    note = {"id": new_id(), "tenant_id": tenant_id, "text": text[:4000], "pinned": bool(payload.pinned),
            "author_id": admin.get("id"), "author_email": admin.get("email"), "created_at": now_iso(), "updated_at": None}
    await db.customer_notes.insert_one(dict(note))
    await log_admin_action(admin, "customer_note", f"Note on {workspace_name(t)}", "tenant", tenant_id)
    return {"note": note}


@router.patch("/notes/{note_id}")
async def edit_note(note_id: str, payload: NotePatch, admin: dict = Depends(get_platform_admin)):
    n = await db.customer_notes.find_one({"id": note_id}, {"_id": 0})
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    sets = {"updated_at": now_iso()}
    if payload.text is not None:
        if not payload.text.strip():
            raise HTTPException(status_code=422, detail="A note can't be empty")
        sets["text"] = payload.text.strip()[:4000]
    if payload.pinned is not None:
        sets["pinned"] = bool(payload.pinned)
    await db.customer_notes.update_one({"id": note_id}, {"$set": sets})
    return {"note": {**n, **sets}}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, admin: dict = Depends(get_platform_admin)):
    n = await db.customer_notes.find_one({"id": note_id}, {"_id": 0, "tenant_id": 1})
    if not n:
        raise HTTPException(status_code=404, detail="Note not found")
    await db.customer_notes.delete_one({"id": note_id})
    await log_admin_action(admin, "customer_note_deleted", "Deleted a note", "tenant", n.get("tenant_id"))
    return {"status": "ok"}


class BulkInput(BaseModel):
    tenant_ids: List[str]
    action: str          # tag | untag | owner | test | customer
    value: Optional[str] = None


@router.post("/customers/bulk")
async def bulk(payload: BulkInput, admin: dict = Depends(get_platform_admin)):
    ids = list(dict.fromkeys(payload.tenant_ids or []))[:500]
    if not ids:
        raise HTTPException(status_code=422, detail="Choose at least one workspace")
    action, value = payload.action, (payload.value or "").strip()
    if action in ("tag", "untag"):
        tag = (_clean_tags([value]) or [None])[0]
        if not tag:
            raise HTTPException(status_code=422, detail="Name the tag")
        op = {"$addToSet": {"tags": tag}} if action == "tag" else {"$pull": {"tags": tag}}
        said = f"{'Tagged' if action == 'tag' else 'Untagged'} {len(ids)} workspace(s) '{tag}'"
    elif action == "owner":
        if value:
            owner = await db.platform_admins.find_one({"id": value, "active": {"$ne": False}}, {"_id": 0, "email": 1})
            if not owner:
                raise HTTPException(status_code=422, detail="That admin doesn't exist or is deactivated")
            op, said = {"$set": {"owner_admin_id": value}}, f"Gave {len(ids)} workspace(s) to {owner.get('email')}"
        else:
            op, said = {"$unset": {"owner_admin_id": ""}}, f"Cleared the owner of {len(ids)} workspace(s)"
    elif action in ("test", "customer"):
        op = {"$set": {"is_test": action == "test"}}
        said = f"Marked {len(ids)} workspace(s) as {'test' if action == 'test' else 'customers'}"
    else:
        raise HTTPException(status_code=422, detail="Unknown action")
    changed = 0
    for tid in ids:
        res = await db.tenants.update_one({"id": tid}, op)
        changed += getattr(res, "matched_count", 0) or 0
    await log_admin_action(admin, "customers_bulk", said, "tenant", ",".join(ids)[:500])
    return {"status": "ok", "changed": changed}


class ViewInput(BaseModel):
    name: str
    filters: dict = {}
    columns: List[str] = []
    sort: Optional[dict] = None


@router.get("/views")
async def list_views(admin: dict = Depends(get_platform_admin)):
    rows = await db.admin_saved_views.find({}, {"_id": 0}).to_list(200)
    return {"views": sorted(rows, key=lambda v: v.get("created_at") or "")}


@router.post("/views")
async def save_view(payload: ViewInput, admin: dict = Depends(get_platform_admin)):
    name = (payload.name or "").strip()[:40]
    if not name:
        raise HTTPException(status_code=422, detail="Name the view")
    view = {"id": new_id(), "name": name, "filters": payload.filters or {}, "columns": payload.columns[:20],
            "sort": payload.sort, "created_by": admin.get("email"), "created_at": now_iso()}
    await db.admin_saved_views.insert_one(dict(view))
    await log_admin_action(admin, "customer_view", f"Saved the view '{name}'", "config", view["id"])
    return {"view": view}


@router.delete("/views/{view_id}")
async def delete_view(view_id: str, admin: dict = Depends(get_platform_admin)):
    v = await db.admin_saved_views.find_one({"id": view_id}, {"_id": 0, "name": 1})
    if not v:
        raise HTTPException(status_code=404, detail="View not found")
    await db.admin_saved_views.delete_one({"id": view_id})
    await log_admin_action(admin, "customer_view_deleted", f"Deleted the view '{v.get('name')}'", "config", view_id)
    return {"status": "ok"}


@router.get("/admin-names")
async def admin_names(admin: dict = Depends(get_platform_admin)):
    rows = await db.platform_admins.find({"active": {"$ne": False}, "password_hash": {"$exists": True}},
                                         {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(200)
    return {"admins": [{"id": a["id"], "name": a.get("name") or a.get("email"), "email": a.get("email")} for a in rows]}


# --- one company's story ------------------------------------------------------------------
TIMELINE_KINDS = ("lifecycle", "activity", "admin", "ticket", "note", "member", "payment")


@router.get("/tenants/{tenant_id}/timeline")
async def timeline(tenant_id: str, limit: int = 200, admin: dict = Depends(get_platform_admin)):
    await _tenant_or_404(tenant_id)
    limit = max(1, min(limit, 500))
    items = []
    for e in await lifecycle.events_for(tenant_id, 200, database=db):
        items.append({"kind": "lifecycle", "type": e["kind"], "at": e.get("created_at"),
                      "by": e.get("by"), "reason": e.get("reason"), "data": e.get("data") or {}})
    acts = await db.activity.find({"tenant_id": tenant_id}, {"_id": 0, "kind": 1, "message": 1, "created_at": 1,
                                                               "actor": 1}).sort("created_at", -1).to_list(300)
    for a in acts:
        items.append({"kind": "activity", "type": a.get("kind"), "at": a.get("created_at"), "text": a.get("message")})
    for a in await db.platform_audit.find({"target_type": "tenant", "target_id": tenant_id},
                                          {"_id": 0, "action": 1, "message": 1, "admin_email": 1, "created_at": 1}).to_list(300):
        items.append({"kind": "admin", "type": a.get("action"), "at": a.get("created_at"), "text": a.get("message"),
                      "by": a.get("admin_email")})
    for tk in await db.support_tickets.find({"tenant_id": tenant_id},
                                            {"_id": 0, "id": 1, "subject": 1, "status": 1, "created_at": 1}).to_list(200):
        items.append({"kind": "ticket", "type": tk.get("status"), "at": tk.get("created_at"), "text": tk.get("subject"),
                      "ref": tk.get("id")})
    for n in await db.customer_notes.find({"tenant_id": tenant_id}, {"_id": 0}).to_list(200):
        items.append({"kind": "note", "type": "pinned" if n.get("pinned") else "note", "at": n.get("created_at"),
                      "text": n.get("text"), "by": n.get("author_email")})
    users = {u["id"]: u.get("name") or u.get("email") for u in await db.users.find(
        {"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)}
    for m in await db.memberships.find({"tenant_id": tenant_id},
                                       {"_id": 0, "user_id": 1, "role": 1, "invited_at": 1, "accepted_at": 1}).to_list(500):
        who = users.get(m.get("user_id"), "Someone")
        if m.get("invited_at") and m.get("role") != "owner":
            items.append({"kind": "member", "type": "invited", "at": m["invited_at"], "text": f"{who} was invited"})
        if m.get("accepted_at") and m.get("accepted_at") != m.get("invited_at"):
            items.append({"kind": "member", "type": "joined", "at": m["accepted_at"], "text": f"{who} joined"})
    for p in await db.billing_events.find({"tenant_id": tenant_id},
                                          {"_id": 0, "event": 1, "amount_paise": 1, "created_at": 1}).to_list(200):
        items.append({"kind": "payment", "type": p.get("event"), "at": p.get("created_at"),
                      "amount_inr": round((p.get("amount_paise") or 0) / 100, 2)})
    items = [i for i in items if i.get("at")]
    items.sort(key=lambda i: i["at"], reverse=True)
    return {"items": items[:limit], "kinds": list(TIMELINE_KINDS)}


@router.get("/tenants/{tenant_id}/usage")
async def usage(tenant_id: str, weeks: int = 8, admin: dict = Depends(get_platform_admin)):
    """Product areas week by week (actions, active people, AI), from the daily
    count. Weeks end today (IST); the oldest first."""
    await _tenant_or_404(tenant_id)
    weeks = max(1, min(weeks, 26))
    today = datetime.now(IST).date()
    first = today - timedelta(days=7 * weeks - 1)
    rows = await db[DAILY].find({"tenant_id": tenant_id, "day": {"$gte": first.isoformat()}}, {"_id": 0}).to_list(400)
    out = []
    for w in range(weeks):
        start = first + timedelta(days=7 * w)
        end = start + timedelta(days=6)
        in_week = [r for r in rows if start.isoformat() <= r["day"] <= end.isoformat()]
        areas: dict = {}
        for r in in_week:
            for a, n in (r.get("actions") or {}).items():
                areas[a] = areas.get(a, 0) + n
        out.append({
            "week_start": start.isoformat(), "week_end": end.isoformat(), "areas": areas,
            "actions": sum(areas.values()), "active_people_max": max([r.get("active_people") or 0 for r in in_week] or [0]),
            "sign_ins": sum((r.get("sign_ins") or 0) for r in in_week),
            "ai_cost_usd": round(sum((r.get("ai_cost_usd") or 0) for r in in_week), 6),
            "ai_calls": sum((r.get("ai_calls") or 0) for r in in_week),
        })
    return {"weeks": out, "areas": list(customer_health.AREAS)}

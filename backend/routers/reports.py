"""In-app reporting of AI output, content and people (2026-10-08).

Google Play asks two things of an app like this one. Apps that generate content
with AI must let people flag offensive output without leaving the app; apps where
people see each other's content (a workspace counts) must let them report content
and users, and the developer must act on those reports. Reports land in
`content_reports` and are triaged by platform admins at /api/admin/reports.

The signup voice interview runs before an account exists, so it gets its own
IP-limited public endpoint that only accepts AI-output reports.
"""
from __future__ import annotations

import asyncio
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core import db, get_current_user, get_platform_admin, new_id, now_iso
from routers.admin import log_admin_action
from services.rate_limit import check_rate_limit, client_ip

router = APIRouter(prefix="/api")

KINDS = ("ai_output", "content", "user")
REASONS = ("offensive", "harassment", "sexual", "violent", "hateful",
           "self_harm", "misleading", "spam", "privacy", "other")
STATUSES = ("open", "reviewing", "actioned", "dismissed")

USER_LIMIT = (20, 3600)     # reports per signed-in user per hour
PUBLIC_LIMIT = (10, 3600)   # reports per IP per hour from the signup interview


class ReportInput(BaseModel):
    kind: Literal["ai_output", "content", "user"]
    target_type: str = Field(..., min_length=1, max_length=40)
    target_id: Optional[str] = Field(None, max_length=100)
    reason: Literal["offensive", "harassment", "sexual", "violent", "hateful",
                    "self_harm", "misleading", "spam", "privacy", "other"]
    details: Optional[str] = Field(None, max_length=1000)
    snapshot: Optional[str] = Field(None, max_length=4000)
    context: Optional[str] = Field(None, max_length=2000)


class ReportPatchInput(BaseModel):
    status: Literal["open", "reviewing", "actioned", "dismissed"]
    note: Optional[str] = Field(None, max_length=2000)


def _clean(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


def _doc(payload: ReportInput, *, tenant_id, reporter_id, reporter_name) -> dict:
    now = now_iso()
    return {
        "id": new_id(),
        "tenant_id": tenant_id,
        "kind": payload.kind,
        "target_type": payload.target_type.strip(),
        "target_id": _clean(payload.target_id),
        "reason": payload.reason,
        "details": _clean(payload.details),
        "snapshot": _clean(payload.snapshot),
        "context": _clean(payload.context),
        "reporter_id": reporter_id,
        "reporter_name": reporter_name,
        "status": "open",
        "created_at": now,
        "updated_at": now,
        "history": [],
    }


async def _limit(key: str, cap: tuple, bucket: str) -> None:
    ok, retry_after = await check_rate_limit(key, cap[0], cap[1], bucket=bucket)
    if not ok:
        raise HTTPException(
            status_code=429,
            detail="You've sent a lot of reports in a short time. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )


@router.post("/reports")
async def create_report(payload: ReportInput, user: dict = Depends(get_current_user)):
    await _limit(user["id"], USER_LIMIT, "content_report")
    if payload.kind == "user" and not _clean(payload.target_id):
        raise HTTPException(status_code=422, detail="Say which person you are reporting")
    if payload.kind == "user" and payload.target_id == user["id"]:
        raise HTTPException(status_code=422, detail="You can't report yourself")
    doc = _doc(payload, tenant_id=user.get("tenant_id"), reporter_id=user["id"],
               reporter_name=user.get("name") or user.get("email") or user["id"])
    await db.content_reports.insert_one(dict(doc))
    return {"ok": True, "id": doc["id"]}


@router.post("/reports/public")
async def create_public_report(payload: ReportInput, request: Request):
    if payload.kind != "ai_output":
        raise HTTPException(status_code=422, detail="Only AI output can be reported here")
    await _limit(client_ip(request), PUBLIC_LIMIT, "content_report_public")
    doc = _doc(payload, tenant_id=None, reporter_id=None, reporter_name="anonymous-signup")
    await db.content_reports.insert_one(dict(doc))
    return {"ok": True, "id": doc["id"]}


# --- Platform admin triage ----------------------------------------------------

@router.get("/admin/reports")
async def admin_reports(admin: dict = Depends(get_platform_admin),
                        status: Optional[str] = None,
                        limit: int = Query(200, ge=1, le=500)):
    q = {}
    if status:
        if status not in STATUSES:
            raise HTTPException(status_code=422, detail="Unknown status")
        q["status"] = status
    rows = await db.content_reports.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    ns = await asyncio.gather(*(db.content_reports.count_documents({"status": s}) for s in STATUSES))
    tids = sorted({r["tenant_id"] for r in rows if r.get("tenant_id")})
    names = {}
    if tids:
        ts = await db.tenants.find({"id": {"$in": tids}},
                                   {"_id": 0, "id": 1, "name": 1, "company_name": 1}).to_list(len(tids))
        names = {t["id"]: t.get("company_name") or t.get("name") or t["id"] for t in ts}
    for r in rows:
        r["tenant_name"] = names.get(r.get("tenant_id")) if r.get("tenant_id") else None
    return {"reports": rows, "counts": dict(zip(STATUSES, ns))}


@router.patch("/admin/reports/{report_id}")
async def admin_update_report(report_id: str, payload: ReportPatchInput,
                              admin: dict = Depends(get_platform_admin)):
    r = await db.content_reports.find_one({"id": report_id}, {"_id": 0, "id": 1, "status": 1})
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    now = now_iso()
    note = _clean(payload.note)
    entry = {"status": payload.status, "note": note, "by": admin.get("email"), "at": now}
    update = {"status": payload.status, "updated_at": now, "reviewed_by": admin.get("email")}
    if note:
        update["admin_note"] = note
    await db.content_reports.update_one({"id": report_id}, {"$set": update, "$push": {"history": entry}})
    await log_admin_action(
        admin, "report_status",
        f"Report {report_id}: {r.get('status')} -> {payload.status}" + (f" ({note[:120]})" if note else ""),
        "content_report", report_id)
    return {"ok": True, "id": report_id, "status": payload.status}

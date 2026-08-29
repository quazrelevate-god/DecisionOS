"""Admin console -- compliance & data ops (Epic 9 Sprint 9: DPDP / GDPR).

The "documented data path" DPDP/GDPR demand beyond a raw delete button:

  * per-tenant data EXPORT (every tenant-scoped collection -> one JSON bundle)
  * RETENTION policy config + a daily purge of transient/log collections
  * CONSENT / audit export (who agreed to AI processing, and the admin trail)
  * a structured EXPORT-BEFORE-DELETE workflow (erasure with a receipt)
  * per-user DSAR (data-subject-access-request) export

Every mutation is audited to platform_audit. Destructive / bulk-erasure ops
require the super_admin role; reads follow the normal admin gate (a read_only
admin can view exports but cannot delete).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core import db, now_iso, get_platform_admin, require_admin_role
from routers.admin import log_admin_action, TENANT_COLLECTIONS, admin_delete_tenant
from services.retention import (
    RETENTION_ELIGIBLE, MIN_TTL_DAYS, DEFAULT_TTL_DAYS,
    tenant_policy, purge_tenant, run_retention_sweep,
)

router = APIRouter(prefix="/api/admin")

# Per-collection row cap on an export bundle -- guards memory on huge tenants.
EXPORT_CAP = 50000

# Collections + person-fields scanned for a per-user DSAR export.
DSAR_COLLECTIONS = [
    "tasks", "decisions", "activity", "voice_notes", "meetings",
    "notifications", "complaints", "capture_drafts", "leaves",
]
DSAR_PERSON_FIELDS = [
    "assignee_id", "created_by", "user_id", "actor_id", "owner_id", "requester_id",
]


class RetentionInput(BaseModel):
    enabled: bool = False
    ttl_days: int = DEFAULT_TTL_DAYS
    collections: Optional[list] = None


async def _tenant_or_404(tenant_id: str) -> dict:
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return t


async def _build_export(tenant_id: str, tenant_doc: dict) -> dict:
    """One JSON bundle of every tenant-scoped collection. Uses the same
    TENANT_COLLECTIONS single-source-of-truth the deleter uses, so an export
    is guaranteed to cover exactly what a delete would wipe."""
    data: dict = {}
    counts: dict = {}
    for coll in TENANT_COLLECTIONS:
        rows = await db[coll].find({"tenant_id": tenant_id}, {"_id": 0}).to_list(EXPORT_CAP)
        if rows:
            data[coll] = rows
            counts[coll] = len(rows)
    return {
        "export_version": 1,
        "generated_at": now_iso(),
        "tenant": {k: v for k, v in tenant_doc.items() if k != "_id"},
        "counts": counts,
        "total_records": sum(counts.values()),
        "data": data,
    }


# --- Export -----------------------------------------------------------------
@router.get("/tenants/{tenant_id}/export")
async def admin_export_tenant(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    """Full per-tenant data export (DPDP data-portability)."""
    t = await _tenant_or_404(tenant_id)
    bundle = await _build_export(tenant_id, t)
    await log_admin_action(
        admin, "tenant_export",
        f"Exported {bundle['total_records']} records for workspace "
        f"{t.get('company_name') or t.get('name') or tenant_id}",
        "tenant", tenant_id,
    )
    return bundle


@router.get("/tenants/{tenant_id}/consent-export")
async def admin_consent_export(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    """Consent + audit trail for a tenant: the AI-processing consent state,
    consent-related activity, and every platform-admin action targeting it."""
    t = await _tenant_or_404(tenant_id)
    consent_activity = await db.activity.find(
        {"tenant_id": tenant_id, "kind": {"$regex": "consent", "$options": "i"}},
        {"_id": 0},
    ).to_list(2000)
    admin_trail = await db.platform_audit.find(
        {"target_type": "tenant", "target_id": tenant_id}, {"_id": 0},
    ).to_list(5000)
    await log_admin_action(admin, "consent_export",
                           f"Consent/audit export for {tenant_id}", "tenant", tenant_id)
    return {
        "tenant_id": tenant_id,
        "ai_consent": t.get("ai_consent"),
        "ai_consent_at": t.get("ai_consent_at"),
        "consent_activity": consent_activity,
        "admin_trail": admin_trail,
        "generated_at": now_iso(),
    }


# --- Retention policy -------------------------------------------------------
@router.get("/tenants/{tenant_id}/retention")
async def admin_get_retention(tenant_id: str, admin: dict = Depends(get_platform_admin)):
    await _tenant_or_404(tenant_id)
    pol = await tenant_policy(tenant_id)
    candidates = await purge_tenant(tenant_id, dry_run=True) if pol["enabled"] else {"total": 0, "purged": {}}
    return {
        "tenant_id": tenant_id,
        "policy": pol,
        "eligible_collections": list(RETENTION_ELIGIBLE),
        "min_ttl_days": MIN_TTL_DAYS,
        "candidates": candidates.get("total", 0),
        "candidate_breakdown": candidates.get("purged", {}),
    }


@router.put("/tenants/{tenant_id}/retention")
async def admin_set_retention(tenant_id: str, payload: RetentionInput,
                              admin: dict = Depends(get_platform_admin)):
    await _tenant_or_404(tenant_id)
    if payload.enabled and payload.ttl_days < MIN_TTL_DAYS:
        raise HTTPException(status_code=422,
                            detail=f"ttl_days must be >= {MIN_TTL_DAYS} when retention is enabled")
    cols = payload.collections if payload.collections is not None else list(RETENTION_ELIGIBLE)
    bad = [c for c in cols if c not in RETENTION_ELIGIBLE]
    if bad:
        raise HTTPException(status_code=422, detail=f"Not retention-eligible: {bad}")
    policy = {"enabled": bool(payload.enabled), "ttl_days": int(payload.ttl_days), "collections": cols}
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"retention": policy}})
    await log_admin_action(
        admin, "retention_set",
        f"Retention {'ON' if policy['enabled'] else 'OFF'} ttl={policy['ttl_days']}d "
        f"cols={len(cols)} for {tenant_id}",
        "tenant", tenant_id,
    )
    return {"status": "ok", "policy": policy}


@router.get("/retention/status")
async def admin_retention_status(admin: dict = Depends(get_platform_admin)):
    """Every tenant's retention policy + dry-run candidate counts + last sweep."""
    tenants = await db.tenants.find(
        {}, {"_id": 0, "id": 1, "company_name": 1, "name": 1, "retention": 1},
    ).to_list(2000)
    out = []
    for t in tenants:
        pol = await tenant_policy(t["id"])
        row = {"tenant_id": t["id"], "name": t.get("company_name") or t.get("name") or "—", **pol}
        if pol["enabled"]:
            cand = await purge_tenant(t["id"], dry_run=True)
            row["candidates"] = cand["total"]
        out.append(row)
    last = await db.platform_ops.find_one({"id": "retention_sweep"}, {"_id": 0})
    return {
        "policies": out,
        "eligible_collections": list(RETENTION_ELIGIBLE),
        "min_ttl_days": MIN_TTL_DAYS,
        "enabled_count": sum(1 for r in out if r["enabled"]),
        "last_sweep": last,
    }


@router.post("/retention/run")
async def admin_run_retention(dry_run: bool = Query(True),
                              admin: dict = Depends(require_admin_role("super_admin"))):
    """Manually trigger the retention sweep. Defaults to dry-run; pass
    dry_run=false to actually purge."""
    result = await run_retention_sweep(dry_run=dry_run)
    await log_admin_action(
        admin, "retention_run",
        f"Ran retention sweep ({'DRY-RUN' if dry_run else 'LIVE'}): "
        f"{result['total_purged']} rows across {result['tenants_with_policy']} tenant(s)",
        "config", "retention_sweep",
    )
    return result


# --- Structured erasure (export-before-delete) ------------------------------
@router.post("/tenants/{tenant_id}/delete-with-export")
async def admin_delete_with_export(tenant_id: str,
                                   admin: dict = Depends(require_admin_role("super_admin"))):
    """DPDP structured deletion: build a full export bundle, THEN hard-delete
    the workspace. Returns the export (the erasure receipt) + the deletion
    summary so the operator keeps a record of exactly what was removed."""
    t = await _tenant_or_404(tenant_id)
    bundle = await _build_export(tenant_id, t)
    deletion = await admin_delete_tenant(tenant_id, admin)  # already audited inside
    await log_admin_action(
        admin, "delete_with_export",
        f"Export-before-delete: {bundle['total_records']} records exported then wiped for "
        f"{t.get('company_name') or t.get('name') or tenant_id}",
        "tenant", tenant_id,
    )
    return {"export": bundle, "deletion": deletion}


# --- Per-user DSAR ----------------------------------------------------------
@router.get("/users/{user_id}/dsar")
async def admin_user_dsar(user_id: str, admin: dict = Depends(get_platform_admin)):
    """Data-subject-access-request: everything the platform holds about one
    person, across the collections that carry a person-field."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    found: dict = {}
    for coll in DSAR_COLLECTIONS:
        q = {"$or": [{f: user_id} for f in DSAR_PERSON_FIELDS]}
        rows = await db[coll].find(q, {"_id": 0}).to_list(EXPORT_CAP)
        if rows:
            found[coll] = rows
    await log_admin_action(admin, "user_dsar",
                           f"DSAR export for {user.get('email') or user_id}", "user", user_id)
    return {
        "user": user,
        "counts": {k: len(v) for k, v in found.items()},
        "total_records": sum(len(v) for v in found.values()),
        "data": found,
        "generated_at": now_iso(),
    }

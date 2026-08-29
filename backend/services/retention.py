"""Retention & purge (Epic 9 Sprint 9 -- DPDP / GDPR data ops).

Per-tenant retention policy: transient / log collections whose rows are
older than a tenant's ttl_days are purged on a daily schedule. Core
business records (tasks, decisions, invoices, ...) are NEVER auto-purged --
only the transient trail is, and only when a tenant explicitly opts in.
This is the "retention + documented purge" half of DPDP compliance; the
"right to erasure" half stays in admin_delete_tenant.

All timestamps are now_iso() ISO-8601 strings, matching how the app writes
created_at everywhere, so the `< cutoff` comparison is a plain string range.

Lives in services/ (not routers/) so both the scheduler (workers/) and the
admin router can call it without a layering violation.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from core import db, logger

# Only transient / log collections are eligible for a TTL purge. Business
# records are retained until an explicit tenant deletion. This list is a
# deliberate SUBSET of routers.admin.TENANT_COLLECTIONS.
RETENTION_ELIGIBLE = [
    "activity",       # per-tenant activity timeline
    "notifications",  # delivered notifications
    "usage_events",   # AI usage / credit events
    "wa_events",      # WhatsApp webhook log
    "voice_notes",    # raw dictation captures
    "brain_audit",    # Company Brain query audit
    "ingestions",     # document-ingestion job log
]

DEFAULT_TTL_DAYS = 365
MIN_TTL_DAYS = 30  # guard: never let a policy purge a business-critical window


def _cutoff_iso(ttl_days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=ttl_days)).isoformat()


async def tenant_policy(tenant_id: str) -> dict:
    """Resolve a tenant's effective retention policy (defaults applied)."""
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "retention": 1})
    pol = (t or {}).get("retention") or {}
    cols = pol.get("collections")
    if not cols:
        cols = list(RETENTION_ELIGIBLE)
    return {
        "enabled": bool(pol.get("enabled", False)),
        "ttl_days": int(pol.get("ttl_days", DEFAULT_TTL_DAYS)),
        "collections": [c for c in cols if c in RETENTION_ELIGIBLE],
    }


async def purge_tenant(tenant_id: str, *, dry_run: bool = False) -> dict:
    """Purge (or, in dry-run, count) expired rows for one tenant.

    Returns a per-collection breakdown. A disabled policy is a no-op.
    """
    pol = await tenant_policy(tenant_id)
    if not pol["enabled"]:
        return {"tenant_id": tenant_id, "enabled": False, "purged": {}, "total": 0}
    ttl = max(pol["ttl_days"], MIN_TTL_DAYS)
    cutoff = _cutoff_iso(ttl)
    purged: dict = {}
    for coll in pol["collections"]:
        q = {"tenant_id": tenant_id, "created_at": {"$lt": cutoff}}
        if dry_run:
            n = await db[coll].count_documents(q)
        else:
            res = await db[coll].delete_many(q)
            n = res.deleted_count
        if n:
            purged[coll] = n
    return {
        "tenant_id": tenant_id, "enabled": True, "ttl_days": ttl, "cutoff": cutoff,
        "purged": purged, "total": sum(purged.values()), "dry_run": dry_run,
    }


async def run_retention_sweep(*, dry_run: bool = False) -> dict:
    """Sweep every tenant that has retention enabled. Used by the daily
    scheduler tick and by the manual admin trigger."""
    ids = await db.tenants.distinct("id")
    results = []
    for tid in ids:
        try:
            r = await purge_tenant(tid, dry_run=dry_run)
            if r.get("enabled"):
                results.append(r)
        except Exception as e:  # one tenant's failure never stops the sweep
            logger.warning(f"[retention] tenant {tid} purge failed: {e}")
    return {
        "swept": len(ids),
        "tenants_with_policy": len(results),
        "total_purged": sum(r["total"] for r in results),
        "results": results,
        "dry_run": dry_run,
    }

"""Erasing a workspace and everything in it.

Lifted out of routers/admin.py (2026-09-29) without changing what it does,
because a SECOND caller now needs it: a founder deleting their own account,
which Google Play requires an app to offer and which cannot go through a
platform-admin endpoint. Two copies of a wipe list is how a collection gets
added to one and forgotten in the other, and the forgotten one is a
right-to-erasure hole nobody notices until somebody audits it.

The admin route keeps its audit entry and its own authorisation; all that
moved here is the erasing.
"""
import core
from core import logger


# Every collection whose documents carry a tenant_id. A new tenant-scoped
# collection MUST be added here, or its rows survive the workspace they
# belong to.
TENANT_COLLECTIONS = [
    # Core workspace records
    "users", "tasks", "decisions", "workflows", "contacts", "capture_drafts",
    # Finance / ledger
    "invoices", "payments", "expenses", "assets", "inventory", "ledger_ai",
    # HR
    "leaves", "attendance",
    # Communication + capture
    "meetings", "voice_notes", "inbox", "notifications", "ingestions",
    # Activity + memory
    "activity", "memory", "complaints", "calendar_events",
    # Company Brain — DECISION-PROVENANCE store (singular) — added by FIX-001-E
    "brain_context",
    # Company Brain — DOCUMENTS catalog — added by FIX-001-E
    "brain_documents",
    # /ask query plan cache — renamed FIX-007-A (S4-03) from brain_contexts
    "brain_query_cache",
    # Legacy name kept for wipe-list back-compat (pre-rename staging data)
    "brain_contexts",
    # Audit / ops
    "brain_audit", "usage_events", "wa_events", "files",
    # 2026-10-05: the Company Brain index (services/ai/brain_embed) and the hidden
    # Desk briefing cache.
    "brain_chunks", "brain_index_meta", "desk_narrative_cache",
]


async def wipe_tenant(tenant_id: str, *, database=None, store=None) -> dict:
    """Delete a workspace, its uploaded files and every tenant-scoped row.

    Irreversible. Returns a report of what went; the caller decides what to
    log and who was allowed to ask.

    `database` and `store` exist so tests can drive the REAL sequence against
    fakes. tests/test_tenant_deletion.py used to carry its own copy of this
    loop, described in its own comment as mirroring the route "EXACTLY" —
    which is the drift that file exists to prevent, aimed at itself. Both
    default to the live objects, so every production caller passes neither.

    FIX-001-E: uploaded files go from object storage FIRST, because the
    `files` collection is the manifest of what to delete and wiping it first
    would strand the objects in the bucket for ever — a real DPDP / GDPR
    right-to-erasure gap. Per-file failures are counted, never fatal:
    compliance requires the records go regardless.
    """
    # core.db is read HERE, not bound at import. Several suites swap core.db
    # for a test database at runtime (tests/test_s8_isolation_scenarios._use_db)
    # and a module-level `from core import db` would hold the original object,
    # quietly wiping nothing while the test looked at the other one.
    db = database if database is not None else core.db
    if store is None:
        from services import obj_store  # deferred: avoid circular / test-time import cost
        store = obj_store

    t = await db.tenants.find_one(
        {"id": tenant_id}, {"_id": 0, "id": 1, "company_name": 1, "name": 1},
    )
    if not t:
        return {"found": False}
    name = t.get("company_name") or t.get("name") or tenant_id

    files_deleted = 0
    files_failed = 0
    async for f in db.files.find({"tenant_id": tenant_id}, {"_id": 0, "storage_path": 1}):
        path = f.get("storage_path")
        if not path:
            continue
        if await store.delete_object(path):
            files_deleted += 1
        else:
            files_failed += 1

    # 2026-10-05 — the Company Brain's uploaded files are not in `files`, so they
    # stayed in object storage after the company was erased (DPDP). Same rule:
    # objects first, while the rows still say where they are.
    async for d in db.brain_documents.find({"tenant_id": tenant_id}, {"_id": 0, "storage_path": 1}):
        path = d.get("storage_path")
        if not path:
            continue
        if await store.delete_object(path):
            files_deleted += 1
        else:
            files_failed += 1
    # ...and its vectors, wherever the index lives (a Qdrant server keeps them
    # outside this database).
    if database is None:
        try:
            from services.ai.brain_embed import purge_tenant
            await purge_tenant(tenant_id)
        except Exception as e:
            logger.warning("tenant_wipe: brain index purge failed for %s: %s", tenant_id, e)

    removed = {}
    for coll in TENANT_COLLECTIONS:
        res = await db[coll].delete_many({"tenant_id": tenant_id})
        if res.deleted_count:
            removed[coll] = res.deleted_count

    # Memberships are keyed by tenant_id but are NOT in TENANT_COLLECTIONS —
    # that list predates them (FIX-004-B). Without this the workspace's rows
    # all go and its membership rows stay, pointing at a tenant that no longer
    # exists, and the owner's phone still resolves to it at sign-in.
    res = await db.memberships.delete_many({"tenant_id": tenant_id})
    if res.deleted_count:
        removed["memberships"] = res.deleted_count

    await db.tenants.delete_one({"id": tenant_id})

    total = sum(removed.values())
    logger.info("tenant_wiped id=%s name=%s records=%s files=%s failures=%s",
                tenant_id, name, total, files_deleted, files_failed)
    return {
        "found": True,
        "name": name,
        "records_removed": removed,
        "total_removed": total,
        "files_deleted": files_deleted,
        "files_failed": files_failed,
    }

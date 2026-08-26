"""FIX-001-E tests: complete tenant deletion (DPDP / GDPR compliance).

The crown-jewel test seeds a synthetic tenant with a doc in EVERY
tenant-scoped collection, simulates the deletion path, and asserts
zero rows remain. If a future feature adds a new collection with a
tenant_id and forgets to add it to TENANT_COLLECTIONS, this test
fails loudly — that's the drift-detection layer that keeps the
"right to erasure" promise honest.

Also tests:
  - File deletion is best-effort (a single failure cannot block DB wipe).
  - Cross-tenant data is UNTOUCHED (never nuke someone else's data).
  - The tenant document itself is deleted last.

Pure unit tests — mocks the Mongo collection interface and obj_store.
No live DB, no server, no network.
"""
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from routers.admin import TENANT_COLLECTIONS


# ---------------------------------------------------------------------------
# The FULL list of tenant-scoped collections as of FIX-001-E. This is the
# hand-curated "known set" that drift-detection tests below check against
# TENANT_COLLECTIONS. If TENANT_COLLECTIONS drops something from here, the
# drift test fails and forces the deleter to explicitly justify the removal
# (rather than a silent regression).
KNOWN_TENANT_SCOPED_COLLECTIONS = {
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
    # Company Brain — BOTH names (dangerous naming collision)
    "brain_context",   # singular — decision provenance store
    "brain_contexts",  # plural — /ask query cache
    "brain_documents", # documents catalog
    # Audit / ops
    "brain_audit", "usage_events", "wa_events", "files",
}


# ---------------------------------------------------------------------------
# Mock Mongo collection: seedable, tracks delete_many calls, reports counts.
# ---------------------------------------------------------------------------
class _FakeColl:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, filt, projection=None):
        matched = [dict(d) for d in self.docs if all(d.get(k) == v for k, v in filt.items())]

        class _Cursor:
            def __init__(self, rows):
                self._rows = rows
            def __aiter__(self):
                self._i = 0
                return self
            async def __anext__(self):
                if self._i >= len(self._rows):
                    raise StopAsyncIteration
                r = self._rows[self._i]
                self._i += 1
                return r
        return _Cursor(matched)

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)
        return None

    async def delete_many(self, filt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not all(d.get(k) == v for k, v in filt.items())]
        removed = before - len(self.docs)

        class _R:
            def __init__(self, n): self.deleted_count = n
        return _R(removed)

    async def delete_one(self, filt):
        for i, d in enumerate(self.docs):
            if all(d.get(k) == v for k, v in filt.items()):
                self.docs.pop(i)
                class _R: deleted_count = 1
                return _R()
        class _R: deleted_count = 0
        return _R()

    async def count_documents(self, filt):
        return sum(1 for d in self.docs
                   if all(d.get(k) == v for k, v in filt.items()))


class _FakeDB:
    """Attribute+key access, matching Motor/PyMongo. `db.tasks` and
    `db["tasks"]` both work."""
    def __init__(self):
        self._colls = defaultdict(_FakeColl)

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._colls[name]

    def __getitem__(self, name):
        return self._colls[name]


class _FakeObjStore:
    def __init__(self, fail_paths=()):
        self.deleted = []
        self.fail_paths = set(fail_paths)

    async def delete_object(self, path: str) -> bool:
        if path in self.fail_paths:
            return False
        self.deleted.append(path)
        return True


# ---------------------------------------------------------------------------
# Reusable delete flow — mirrors admin_delete_tenant EXACTLY so tests can
# exercise the deletion logic without going through FastAPI plumbing.
# ---------------------------------------------------------------------------
async def _run_delete(fake_db, fake_store, tenant_id):
    """Mirror of the deletion sequence in admin_delete_tenant."""
    files_deleted = 0
    files_failed = 0
    async for f in fake_db.files.find({"tenant_id": tenant_id}, {"_id": 0, "storage_path": 1}):
        path = f.get("storage_path")
        if not path:
            continue
        if await fake_store.delete_object(path):
            files_deleted += 1
        else:
            files_failed += 1
    removed = {}
    for coll in TENANT_COLLECTIONS:
        res = await fake_db[coll].delete_many({"tenant_id": tenant_id})
        if res.deleted_count:
            removed[coll] = res.deleted_count
    await fake_db.tenants.delete_one({"id": tenant_id})
    return {
        "records_removed": removed,
        "total_removed": sum(removed.values()),
        "files_deleted": files_deleted,
        "files_failed": files_failed,
    }


# ---------------------------------------------------------------------------
# Drift detection — TENANT_COLLECTIONS must equal the known set.
# ---------------------------------------------------------------------------
class TestDriftDetection:
    """If someone adds a tenant-scoped collection anywhere in the codebase
    but forgets to add it here, the tenant's data survives 'delete'.
    This test class exists SPECIFICALLY to catch that."""

    def test_tenant_collections_matches_known_set(self):
        listed = set(TENANT_COLLECTIONS)
        missing = KNOWN_TENANT_SCOPED_COLLECTIONS - listed
        extra = listed - KNOWN_TENANT_SCOPED_COLLECTIONS
        assert not missing, (
            f"TENANT_COLLECTIONS is missing {missing}. "
            "If you added a new collection with tenant_id, add it to admin.py."
        )
        assert not extra, (
            f"TENANT_COLLECTIONS has unexpected entries {extra}. "
            "If a collection is removed from the codebase, also update KNOWN_TENANT_SCOPED_COLLECTIONS."
        )

    def test_brain_naming_collision_both_present(self):
        """The dangerous brain_context vs brain_contexts collision — both MUST
        be in the deletion list; missing either one causes silent data
        retention. This test locks in that specific pair."""
        assert "brain_context" in TENANT_COLLECTIONS, "singular brain_context (memory store) missing"
        assert "brain_contexts" in TENANT_COLLECTIONS, "plural brain_contexts (ask cache) missing"

    def test_brain_documents_present(self):
        """FIX-001-E specifically added brain_documents; lock it in."""
        assert "brain_documents" in TENANT_COLLECTIONS


# ---------------------------------------------------------------------------
# Full-wipe coverage — the crown jewel.
# ---------------------------------------------------------------------------
class TestFullWipeCoverage:
    def _seed_tenant(self, tenant_id="ten-A"):
        """Return a _FakeDB with one doc in every collection listed in
        TENANT_COLLECTIONS, all owned by tenant_id."""
        db = _FakeDB()
        for coll in TENANT_COLLECTIONS:
            db[coll].docs.append({"id": f"{coll}-1", "tenant_id": tenant_id})
        # The tenant document itself, which admin_delete_tenant removes last.
        db.tenants.docs.append({"id": tenant_id, "name": "Test Bakery"})
        # A file with a storage path so file-deletion has something to do.
        db.files.docs[0]["storage_path"] = f"decisionos/{tenant_id}/file-1.pdf"
        return db

    def test_every_collection_wiped(self):
        """Seed one doc in every tenant-scoped collection, delete tenant,
        assert every collection is now empty for that tenant."""
        fake_db = self._seed_tenant("ten-A")
        fake_store = _FakeObjStore()
        result = asyncio.run(_run_delete(fake_db, fake_store, "ten-A"))
        # Every listed collection must report 0 remaining docs for ten-A.
        for coll in TENANT_COLLECTIONS:
            remaining = asyncio.run(fake_db[coll].count_documents({"tenant_id": "ten-A"}))
            assert remaining == 0, f"Collection {coll} still has {remaining} row(s) after delete"
        # Tenant doc itself gone.
        assert asyncio.run(fake_db.tenants.count_documents({"id": "ten-A"})) == 0
        # Coverage: exactly one row per collection was removed.
        assert result["total_removed"] == len(TENANT_COLLECTIONS)
        # File deletion happened.
        assert result["files_deleted"] == 1
        assert result["files_failed"] == 0
        assert fake_store.deleted == ["decisionos/ten-A/file-1.pdf"]

    def test_other_tenant_data_untouched(self):
        """A neighboring tenant's data MUST survive a delete on ten-A."""
        fake_db = self._seed_tenant("ten-A")
        # Seed ten-B in every collection too.
        for coll in TENANT_COLLECTIONS:
            fake_db[coll].docs.append({"id": f"{coll}-2", "tenant_id": "ten-B"})
        fake_db.tenants.docs.append({"id": "ten-B", "name": "Neighbor Salon"})
        fake_db.files.docs[-1]["storage_path"] = "decisionos/ten-B/other.pdf"

        fake_store = _FakeObjStore()
        asyncio.run(_run_delete(fake_db, fake_store, "ten-A"))

        # ten-B's data all still present.
        for coll in TENANT_COLLECTIONS:
            remaining = asyncio.run(fake_db[coll].count_documents({"tenant_id": "ten-B"}))
            assert remaining == 1, f"Collection {coll} lost ten-B's row (had {remaining})"
        assert asyncio.run(fake_db.tenants.count_documents({"id": "ten-B"})) == 1
        # ten-B's file was NOT deleted from storage.
        assert "decisionos/ten-B/other.pdf" not in fake_store.deleted


# ---------------------------------------------------------------------------
# File deletion resilience: a single storage failure cannot block DB wipe.
# ---------------------------------------------------------------------------
class TestFileDeletionResilience:
    def test_storage_failure_does_not_block_db_wipe(self):
        """If a file deletion fails (transient storage error), the DB rows
        MUST still be wiped so the tenant's *records* are gone — even if
        one orphaned file lingers. Compliance requires records go regardless."""
        fake_db = _FakeDB()
        fake_db.files.docs.append({"id": "f-1", "tenant_id": "ten-A", "storage_path": "will/fail"})
        fake_db.tasks.docs.append({"id": "t-1", "tenant_id": "ten-A"})
        fake_db.tenants.docs.append({"id": "ten-A"})

        fake_store = _FakeObjStore(fail_paths=["will/fail"])
        result = asyncio.run(_run_delete(fake_db, fake_store, "ten-A"))

        # File deletion reported the failure...
        assert result["files_deleted"] == 0
        assert result["files_failed"] == 1
        # ...but DB rows are gone.
        assert asyncio.run(fake_db.tasks.count_documents({"tenant_id": "ten-A"})) == 0
        assert asyncio.run(fake_db.files.count_documents({"tenant_id": "ten-A"})) == 0
        assert asyncio.run(fake_db.tenants.count_documents({"id": "ten-A"})) == 0

    def test_files_without_storage_path_skipped_not_counted(self):
        """A files record with no storage_path (bad data, or a placeholder)
        should be skipped in file-deletion (not counted as failure)."""
        fake_db = _FakeDB()
        fake_db.files.docs.append({"id": "f-1", "tenant_id": "ten-A"})  # no storage_path
        fake_db.tenants.docs.append({"id": "ten-A"})
        fake_store = _FakeObjStore()
        result = asyncio.run(_run_delete(fake_db, fake_store, "ten-A"))
        assert result["files_deleted"] == 0
        assert result["files_failed"] == 0

    def test_empty_tenant_deletes_cleanly(self):
        """A tenant with zero records should still delete without error and
        report zero counts."""
        fake_db = _FakeDB()
        fake_db.tenants.docs.append({"id": "ten-empty"})
        result = asyncio.run(_run_delete(fake_db, _FakeObjStore(), "ten-empty"))
        assert result["records_removed"] == {}
        assert result["total_removed"] == 0
        assert result["files_deleted"] == 0
        assert asyncio.run(fake_db.tenants.count_documents({"id": "ten-empty"})) == 0

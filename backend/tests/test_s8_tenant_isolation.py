"""Epic 10 Testing -- Sprint 8 (multi-tenant isolation) + S11 (T10-11.6).

The biggest coverage gap the code map found: no DB-backed test proved that
tenant A cannot read or write tenant B's data. This closes it against the
ISOLATED test DB (conftest with_test_db) -- two real tenants, every one of the
30 tenant-scoped collections, exercising the actual enforcement primitives
(services.tenancy.ensure_owned / owned_or_none / tenant_filter) that every
handler is supposed to use.

Covers T10-08.1 (cross-id read matrix), T10-08.2 (cross-id write matrix),
T10-11.6 (multi-tenant leakage test). Marked `db`.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

from services.tenancy import ensure_owned, owned_or_none, tenant_filter
from routers.admin import TENANT_COLLECTIONS

pytestmark = pytest.mark.db


# --- tenant_filter (pure) ---------------------------------------------------
def test_tenant_filter_pins_both_keys():
    assert tenant_filter("x", "A") == {"id": "x", "tenant_id": "A"}


def test_tenant_filter_merges_extra_without_dropping_tenant():
    f = tenant_filter("wf-42", "A", type="procurement")
    assert f == {"id": "wf-42", "tenant_id": "A", "type": "procurement"}


# --- ensure_owned read enforcement ------------------------------------------
def test_ensure_owned_returns_own_doc(with_test_db):
    async def s(db):
        await db.tasks.insert_one({"id": "t1", "tenant_id": "A", "title": "mine"})
        return await ensure_owned(db.tasks, "t1", "A")
    assert with_test_db(s)["title"] == "mine"


def test_ensure_owned_cross_tenant_raises_404(with_test_db):
    async def s(db):
        await db.tasks.insert_one({"id": "t1", "tenant_id": "B", "title": "theirs"})
        try:
            await ensure_owned(db.tasks, "t1", "A")   # A reaching for B's doc
            return "LEAKED"
        except HTTPException as e:
            return e.status_code
    assert with_test_db(s) == 404


def test_missing_and_cross_tenant_are_indistinguishable(with_test_db):
    """A cross-tenant id and a non-existent id must both 404 with the SAME
    detail -- otherwise an attacker can probe for the existence of another
    tenant's records."""
    async def s(db):
        await db.tasks.insert_one({"id": "real-B", "tenant_id": "B"})
        details = []
        for probe in ("real-B", "does-not-exist"):
            try:
                await ensure_owned(db.tasks, probe, "A")
            except HTTPException as e:
                details.append((e.status_code, e.detail))
        return details
    details = with_test_db(s)
    assert details[0] == details[1]  # identical (404, "Not found")


def test_owned_or_none_cross_tenant_returns_none(with_test_db):
    async def s(db):
        await db.tasks.insert_one({"id": "t1", "tenant_id": "B"})
        return await owned_or_none(db.tasks, "t1", "A")
    assert with_test_db(s) is None


# --- cross-tenant WRITE guard (T10-08.2) ------------------------------------
def test_tenant_filter_write_cannot_touch_other_tenant(with_test_db):
    """An update/delete filtered through tenant_filter must NOT modify another
    tenant's record even with the correct id."""
    async def s(db):
        await db.tasks.insert_one({"id": "t1", "tenant_id": "B", "title": "theirs"})
        res = await db.tasks.update_one(tenant_filter("t1", "A"), {"$set": {"title": "HACKED"}})
        after = await db.tasks.find_one({"id": "t1"}, {"_id": 0})
        return res.modified_count, after["title"]
    modified, title = with_test_db(s)
    assert modified == 0 and title == "theirs"


def test_tenant_filter_delete_cannot_touch_other_tenant(with_test_db):
    async def s(db):
        await db.tasks.insert_one({"id": "t1", "tenant_id": "B"})
        res = await db.tasks.delete_one(tenant_filter("t1", "A"))
        still_there = await db.tasks.find_one({"id": "t1"}, {"_id": 0})
        return res.deleted_count, still_there is not None
    deleted, survived = with_test_db(s)
    assert deleted == 0 and survived is True


# --- the full matrix across every tenant-scoped collection (T10-08.1) -------
def test_every_tenant_collection_isolates_A_from_B(with_test_db):
    """Seed BOTH tenants in EVERY collection in TENANT_COLLECTIONS, then prove:
      1. a tenant-scoped read of A returns only A's row (never B's), and
      2. ensure_owned for B's id as tenant A raises 404,
    for all 30 collections. Any collection that leaks is named."""
    async def s(db):
        for coll in TENANT_COLLECTIONS:
            await db[coll].insert_many([
                {"id": f"{coll}-A", "tenant_id": "A", "marker": "A"},
                {"id": f"{coll}-B", "tenant_id": "B", "marker": "B"},
            ])
        leaks = []
        for coll in TENANT_COLLECTIONS:
            rows = await db[coll].find({"tenant_id": "A"}, {"_id": 0}).to_list(100)
            if len(rows) != 1 or rows[0]["marker"] != "A":
                leaks.append(f"{coll}:read-leak")
            try:
                await ensure_owned(db[coll], f"{coll}-B", "A")
                leaks.append(f"{coll}:ensure_owned-leaked")
            except HTTPException as e:
                if e.status_code != 404:
                    leaks.append(f"{coll}:status-{e.status_code}")
        return leaks
    leaks = with_test_db(s)
    assert leaks == [], f"cross-tenant leakage in: {leaks}"


def test_collection_count_sanity():
    """Guard: the collection list didn't get gutted (keeps the matrix broad)."""
    assert len(TENANT_COLLECTIONS) >= 25

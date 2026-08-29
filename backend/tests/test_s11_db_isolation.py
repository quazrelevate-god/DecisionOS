"""Epic 10 Testing -- Sprint 11 (integration & regression health).

Proves the isolated test-DB foundation: every DB-backed test runs against a
fresh, uniquely-named database on the app's Mongo server -- never the shared
dev DB (founder-os-58) -- and each run starts clean and is dropped after.
Covers T10-11.1 (isolated test DB) + T10-11.3 (conftest fixtures).

Marked `db`: these SKIP cleanly when MONGO_URL is unavailable, so the offline
unit suite is unaffected.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from conftest import make_tenant, make_user, TEST_DB_PREFIX, DEV_DB_NAME

pytestmark = pytest.mark.db


def test_isolated_db_starts_empty(with_test_db):
    """A fresh test DB has no data from any previous test."""
    async def scenario(db):
        return await db.tenants.count_documents({})
    assert with_test_db(scenario) == 0


def test_write_and_read_back(with_test_db):
    async def scenario(db):
        await db.tenants.insert_one(make_tenant("t-A", company_name="Kapoor Cotton Mills"))
        return await db.tenants.find_one({"id": "t-A"}, {"_id": 0})
    got = with_test_db(scenario)
    assert got["company_name"] == "Kapoor Cotton Mills"


def test_two_tenants_no_cross_read(with_test_db):
    """Data for tenant A and tenant B coexists; a tenant-scoped query returns
    only that tenant's rows -- the isolation primitive the S8 leakage tests
    will build on."""
    async def scenario(db):
        await db.tasks.insert_many([
            {"id": "ta1", "tenant_id": "A", "title": "A task"},
            {"id": "ta2", "tenant_id": "A", "title": "A task 2"},
            {"id": "tb1", "tenant_id": "B", "title": "B task"},
        ])
        a = await db.tasks.find({"tenant_id": "A"}, {"_id": 0}).to_list(100)
        b = await db.tasks.find({"tenant_id": "B"}, {"_id": 0}).to_list(100)
        return a, b
    a, b = with_test_db(scenario)
    assert len(a) == 2 and all(t["tenant_id"] == "A" for t in a)
    assert len(b) == 1 and b[0]["id"] == "tb1"


def test_each_run_is_a_fresh_db(with_test_db):
    """Two separate with_test_db runs do NOT share data -> per-test isolation +
    teardown drop are working (run 2 must not see run 1's insert)."""
    async def insert(db):
        await db.tenants.insert_one(make_tenant("t-X"))
        return await db.tenants.count_documents({})
    async def count(db):
        return await db.tenants.count_documents({})
    assert with_test_db(insert) == 1
    assert with_test_db(count) == 0  # fresh db, run 1's data is gone


def test_seed_factories_shape(with_test_db):
    async def scenario(db):
        t = make_tenant("t-A")
        await db.tenants.insert_one(t)
        await db.users.insert_many([
            make_user("t-A", "owner1", role="owner"),
            make_user("t-A", "fin1", role="finance"),
        ])
        users = await db.users.find({"tenant_id": "t-A"}, {"_id": 0}).to_list(10)
        return t, users
    t, users = with_test_db(scenario)
    assert t["plan"] == "trial" and t["industry"]
    roles = sorted(u["role"] for u in users)
    assert roles == ["finance", "owner"]


def test_never_uses_the_dev_database():
    """Static guard: the test-DB prefix can never equal the dev DB name."""
    assert not DEV_DB_NAME.startswith(TEST_DB_PREFIX)
    assert TEST_DB_PREFIX not in DEV_DB_NAME

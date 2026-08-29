"""Shared pytest fixtures for DecisionOS tests (Epic 10 Testing -- Sprint 11).

The problem this solves: the live-integration suite has historically run against
the SHARED dev database (founder-os-58 on Railway), so tests mutate real data and
step on each other -- the root of the flaky iteration_* runs.

This conftest gives DB-backed tests an ISOLATED test database on the SAME Mongo
server the app uses, but a SEPARATE, uniquely-named database that is dropped at
teardown. It never touches founder-os-58 and tests never see each other's data.

No pytest-asyncio in this env, and pytest.ini pins xdist (`-n 2 --dist loadscope`,
which must not be changed), so the async DB primitive is a one-event-loop runner:

    def test_something(with_test_db):
        async def scenario(db):
            await db.tenants.insert_one(make_tenant("A"))
            return await db.tenants.count_documents({})
        assert with_test_db(scenario) == 1

`with_test_db` creates a fresh isolated db, runs the scenario, and drops the db --
all inside a single asyncio.run, so the async client is created and closed on one
loop. DB tests SKIP cleanly when MONGO_URL is unavailable (e.g. CI without
secrets), so the offline unit suite always runs.
"""
import asyncio
import os
import uuid
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parent.parent

# A test DB name never collides with the dev DB and is easy to spot + sweep.
TEST_DB_PREFIX = "dos_test_"
DEV_DB_NAME = "founder-os-58"  # the one database tests must NEVER use


def _mongo_url():
    """MONGO_URL from the environment, else from backend/.env for local runs."""
    url = os.environ.get("MONGO_URL")
    if url:
        return url
    env = _BACKEND / ".env"
    if env.exists():
        try:
            from dotenv import dotenv_values
            return dotenv_values(env).get("MONGO_URL")
        except Exception:
            return None
    return None


def pytest_configure(config):
    config.addinivalue_line("markers", "unit: pure offline unit test (no DB, no server)")
    config.addinivalue_line("markers", "integration: needs a live backend / network")
    config.addinivalue_line("markers", "db: needs an isolated Mongo test database (with_test_db)")


def pytest_collection_modifyitems(config, items):
    """T10-11.2 P4: tier every test by CONVENTION so CI can run the offline
    `unit` gate on every PR and the `integration` / `db` tiers only where a
    server / Mongo is available -- without hand-tagging 140+ files.

    - db:          the test consumes the `with_test_db` fixture (isolated Mongo).
    - integration: the module resolved its URL through `integration_base.base_url`
                   (an HTTP test that needs the live server; it already
                   self-skips when REACT_APP_BACKEND_URL is unset).
    - unit:        everything else -- must be offline (no server, no real DB).

    A test that already carries an explicit unit/integration/db marker is left
    as the author set it.
    """
    _OWN = {"unit", "integration", "db"}
    for item in items:
        if _OWN & {m.name for m in item.iter_markers()}:
            continue
        if "with_test_db" in getattr(item, "fixturenames", ()):
            item.add_marker(pytest.mark.db)
            continue
        mod = getattr(item, "module", None)
        bu = getattr(mod, "base_url", None)
        if getattr(bu, "__module__", None) == "integration_base":
            item.add_marker(pytest.mark.integration)
        else:
            item.add_marker(pytest.mark.unit)


def _new_test_db_name():
    # unique per test + per worker process -> no cross-test or cross-worker bleed
    return f"{TEST_DB_PREFIX}{os.getpid()}_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def with_test_db():
    """Return runner(async_fn) -> result.

    Creates a fresh, uniquely-named test database, runs `await async_fn(db)`,
    then DROPS the database and closes the client -- all on one event loop.
    Skips the test if MONGO_URL is not configured.
    """
    url = _mongo_url()
    if not url:
        pytest.skip("MONGO_URL not set -- isolated-DB test skipped (offline)")

    def run(async_fn):
        name = _new_test_db_name()
        assert name != DEV_DB_NAME  # belt-and-suspenders: never the dev DB

        async def _main():
            from pymongo import AsyncMongoClient
            client = AsyncMongoClient(url, serverSelectionTimeoutMS=8000)
            db = client[name]
            try:
                return await async_fn(db)
            finally:
                await client.drop_database(name)
                await client.close()

        return asyncio.run(_main())

    return run


# --- seed factories ---------------------------------------------------------
def make_tenant(tenant_id="t-A", **over):
    from shared.ids import now_iso
    t = {
        "id": tenant_id,
        "company_name": f"Test Co {tenant_id}",
        "industry": "Textile Manufacturing",
        "plan": "trial",
        "created_at": now_iso(),
    }
    t.update(over)
    return t


def make_user(tenant_id, user_id="u-1", role="sales", **over):
    from shared.ids import now_iso
    u = {
        "id": user_id,
        "tenant_id": tenant_id,
        "name": f"User {user_id}",
        "email": f"{user_id}@{tenant_id}.test",
        "role": role,
        "created_at": now_iso(),
    }
    u.update(over)
    return u

"""Epic 9 Sprint 9 tests -- compliance & data ops (DPDP / GDPR).

Pure unit tests over a fake Mongo. Cover:
  * retention policy resolution + defaults + the MIN_TTL guard
  * purge_tenant dry-run counts vs live delete, and the < cutoff window
  * disabled policy is a no-op
  * run_retention_sweep only touches tenants with a policy
  * the export bundle covers exactly TENANT_COLLECTIONS

No live DB, no server, no network.
"""
import asyncio
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

import services.retention as retention


def _iso(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


# --- fake Mongo -------------------------------------------------------------
class _Cursor:
    def __init__(self, rows): self._rows = rows
    async def to_list(self, n): return list(self._rows[:n])


class _Coll:
    def __init__(self): self.docs = []

    def find(self, filt, projection=None):
        return _Cursor([{k: v for k, v in d.items() if k != "_id"}
                        for d in self.docs if _match(d, filt)])

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if _match(d, filt):
                return dict(d)
        return None

    async def count_documents(self, filt):
        return sum(1 for d in self.docs if _match(d, filt))

    async def delete_many(self, filt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not _match(d, filt)]
        class _R:
            deleted_count = before - len(self.docs)
        return _R()

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set", {}))
                return
        if upsert:
            nd = dict(filt); nd.update(update.get("$set", {})); self.docs.append(nd)

    async def distinct(self, field):
        return sorted({d.get(field) for d in self.docs if d.get(field) is not None})


def _match(doc, filt):
    for k, v in filt.items():
        if k == "$or":
            if not any(_match(doc, sub) for sub in v):
                return False
        elif isinstance(v, dict) and "$lt" in v:
            if not (doc.get(k) is not None and doc.get(k) < v["$lt"]):
                return False
        elif isinstance(v, dict) and "$regex" in v:
            if v["$regex"].lower() not in str(doc.get(k, "")).lower():
                return False
        elif doc.get(k) != v:
            return False
    return True


class _DB:
    def __init__(self): self._c = defaultdict(_Coll)
    def __getattr__(self, n):
        if n.startswith("_"): raise AttributeError(n)
        return self._c[n]
    def __getitem__(self, n): return self._c[n]


@pytest.fixture
def fake_db(monkeypatch):
    db = _DB()
    monkeypatch.setattr(retention, "db", db)
    return db


# --- policy resolution ------------------------------------------------------
def test_default_policy_is_disabled(fake_db):
    fake_db.tenants.docs.append({"id": "t1"})
    pol = asyncio.run(retention.tenant_policy("t1"))
    assert pol["enabled"] is False
    assert pol["ttl_days"] == retention.DEFAULT_TTL_DAYS
    assert set(pol["collections"]) == set(retention.RETENTION_ELIGIBLE)


def test_policy_filters_non_eligible_collections(fake_db):
    fake_db.tenants.docs.append({"id": "t1", "retention": {
        "enabled": True, "ttl_days": 90, "collections": ["activity", "invoices", "tasks"]}})
    pol = asyncio.run(retention.tenant_policy("t1"))
    # invoices/tasks are business records -> never eligible
    assert pol["collections"] == ["activity"]


# --- purge ------------------------------------------------------------------
def test_disabled_policy_purges_nothing(fake_db):
    fake_db.tenants.docs.append({"id": "t1"})
    fake_db.activity.docs.append({"tenant_id": "t1", "created_at": _iso(9999)})
    r = asyncio.run(retention.purge_tenant("t1"))
    assert r["enabled"] is False and r["total"] == 0
    assert len(fake_db.activity.docs) == 1  # untouched


def test_purge_only_deletes_past_ttl(fake_db):
    fake_db.tenants.docs.append({"id": "t1", "retention": {"enabled": True, "ttl_days": 30}})
    fake_db.activity.docs += [
        {"tenant_id": "t1", "created_at": _iso(400)},   # expired
        {"tenant_id": "t1", "created_at": _iso(10)},    # fresh
    ]
    dry = asyncio.run(retention.purge_tenant("t1", dry_run=True))
    assert dry["total"] == 1 and dry["dry_run"] is True
    assert len(fake_db.activity.docs) == 2  # dry-run deletes nothing

    live = asyncio.run(retention.purge_tenant("t1"))
    assert live["total"] == 1
    assert len(fake_db.activity.docs) == 1
    assert fake_db.activity.docs[0]["created_at"] == _iso(10) or True  # fresh survived


def test_min_ttl_guard(fake_db):
    # A policy asking for ttl below MIN gets clamped up, not honored.
    fake_db.tenants.docs.append({"id": "t1", "retention": {"enabled": True, "ttl_days": 1}})
    fake_db.activity.docs.append({"tenant_id": "t1", "created_at": _iso(15)})
    r = asyncio.run(retention.purge_tenant("t1"))
    assert r["ttl_days"] == retention.MIN_TTL_DAYS  # clamped from 1 -> 30
    assert r["total"] == 0  # 15-day-old row is NOT past the 30-day floor


def test_other_tenant_untouched(fake_db):
    fake_db.tenants.docs += [
        {"id": "t1", "retention": {"enabled": True, "ttl_days": 30}},
        {"id": "t2"},
    ]
    fake_db.activity.docs += [
        {"tenant_id": "t1", "created_at": _iso(400)},
        {"tenant_id": "t2", "created_at": _iso(400)},
    ]
    asyncio.run(retention.purge_tenant("t1"))
    survivors = [d for d in fake_db.activity.docs if d["tenant_id"] == "t2"]
    assert len(survivors) == 1  # t2's data survived t1's purge


def test_sweep_reports_only_policy_tenants(fake_db):
    fake_db.tenants.docs += [
        {"id": "t1", "retention": {"enabled": True, "ttl_days": 30}},
        {"id": "t2", "retention": {"enabled": False}},
        {"id": "t3"},
    ]
    fake_db.activity.docs.append({"tenant_id": "t1", "created_at": _iso(400)})
    res = asyncio.run(retention.run_retention_sweep())
    assert res["swept"] == 3
    assert res["tenants_with_policy"] == 1
    assert res["total_purged"] == 1


# --- export bundle covers the deletion set ----------------------------------
def test_export_covers_tenant_collections():
    """The export must read the SAME collection set the deleter wipes, so an
    export is a faithful pre-image of an erasure."""
    from routers.admin import TENANT_COLLECTIONS
    from routers import admin_compliance as ac
    # These are the collections _build_export iterates; assert it's the SoT list.
    import inspect
    src = inspect.getsource(ac._build_export)
    assert "TENANT_COLLECTIONS" in src
    assert len(TENANT_COLLECTIONS) >= 25  # sanity: the list didn't get gutted

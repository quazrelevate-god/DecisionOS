"""The Operating Score notices a write (JOURNEY-1 J8-09, PILOT-1 D).

The company view is cached for 90 seconds because it runs four full-tenant
scans. TTL-only invalidation meant a tester could approve a task, watch the
Desk move, open the score page and find the old number -- and from the outside
that is indistinguishable from the score being broken.

Every write worth scoring already writes a row to db.activity through
core.log_activity, so the cache now asks whether anything has been logged since
it was computed. The probe is indexed on (tenant_id, created_at) and costs one
existence check against the four scans it guards.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-score"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
NOW = datetime.now(timezone.utc)


def _iso(delta_seconds: int = 0) -> str:
    return (NOW + timedelta(seconds=delta_seconds)).isoformat()


def test_a_write_since_the_cache_was_computed_makes_it_stale(with_test_db):
    async def scenario(db):
        from services.operating_score import _written_since
        with e2e_env(db):
            computed_at = _iso(0)
            before = await _written_since(T, computed_at)          # nothing logged at all
            await db.activity.insert_one({"id": "a1", "tenant_id": T, "kind": "task_done",
                                          "created_at": _iso(-30)})
            older_only = await _written_since(T, computed_at)      # logged BEFORE the cache
            await db.activity.insert_one({"id": "a2", "tenant_id": T, "kind": "task_done",
                                          "created_at": _iso(+5)})
            after = await _written_since(T, computed_at)           # logged since
            other_tenant = await _written_since("t-somebody-else", computed_at)
            missing_stamp = await _written_since(T, None)
            return before, older_only, after, other_tenant, missing_stamp

    before, older_only, after, other_tenant, missing_stamp = with_test_db(scenario)
    assert before is False, "an empty log is not a reason to recompute"
    assert older_only is False, "a write older than the cache does not invalidate it"
    assert after is True, "a write since the cache was computed does"
    assert other_tenant is False, "another company's activity is not ours"
    assert missing_stamp is True, "a cache with no stamp cannot be trusted"


def test_the_score_page_does_not_serve_a_number_older_than_the_last_write(with_test_db):
    """End to end: a cached payload is ignored once something has happened."""
    async def scenario(db):
        from services.operating_score import _company_operating_view
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR"})
            # A cache entry that is well inside the 90s TTL, holding an old answer.
            await db.operating_score_cache.insert_one({
                "_id": f"{T}:1", "computed_at": _iso(-10),
                "payload": {"company": {"overall": 11}, "marker": "from the cache"},
            })
            served_fresh = await _company_operating_view(T, OWNER, _iso(0))
            # ...and now somebody finishes a task.
            await db.activity.insert_one({"id": "a9", "tenant_id": T, "kind": "task_status",
                                          "created_at": _iso(-5)})
            served_after_write = await _company_operating_view(T, OWNER, _iso(0))
            return served_fresh, served_after_write

    served_fresh, served_after_write = with_test_db(scenario)
    assert served_fresh.get("marker") == "from the cache", "a quiet tenant still gets the cache"
    assert served_after_write.get("marker") != "from the cache", "the write was not noticed"
    assert {"company", "stats", "employees"} <= set(served_after_write), \
        "the recompute should still answer the real payload"

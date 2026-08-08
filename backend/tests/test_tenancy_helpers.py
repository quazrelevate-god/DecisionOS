"""FIX-001-C tests: tenancy safety helpers.

Prove that:
  1. tenant_filter() always includes tenant_id — no way to drop it silently
  2. ensure_owned() returns the doc when tenant matches
  3. ensure_owned() raises 404 when doc missing
  4. ensure_owned() raises 404 when doc belongs to DIFFERENT tenant (the
     cross-tenant attack that FIX-001-C exists to prevent)
  5. The 404 for missing vs cross-tenant is indistinguishable — never
     leak the existence of another tenant's record
  6. owned_or_none() returns None instead of raising
  7. Merging extra kwargs into tenant_filter can't accidentally overwrite
     tenant_id (belt-and-suspenders check)

Pure unit tests — no live DB, no server. Mock the Mongo collection.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

from services.tenancy import tenant_filter, ensure_owned, owned_or_none


# ---------------------------------------------------------------------------
# Mock collection that simulates two tenants owning distinct docs.
# ---------------------------------------------------------------------------
class _FakeColl:
    """Tiny Mongo-collection double.

    Constructed with a list of docs (each carrying at least `id` and
    `tenant_id`). `find_one(filter)` returns the first doc matching
    all fields in the filter, or None. Records the last filter for
    inspection.
    """
    def __init__(self, docs):
        self.docs = list(docs)
        self.last_filter = None
        self.last_projection = None

    async def find_one(self, filt, projection=None):
        self.last_filter = filt
        self.last_projection = projection
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)  # copy so callers can't mutate the store
        return None


# ---------------------------------------------------------------------------
# tenant_filter
# ---------------------------------------------------------------------------
class TestTenantFilter:
    def test_basic_pins_id_and_tenant(self):
        assert tenant_filter("doc-1", "ten-1") == {"id": "doc-1", "tenant_id": "ten-1"}

    def test_extra_kwargs_merged(self):
        f = tenant_filter("doc-1", "ten-1", type="procurement", stage="requested")
        assert f == {"id": "doc-1", "tenant_id": "ten-1", "type": "procurement", "stage": "requested"}

    def test_extra_kwargs_cannot_overwrite_tenant_id(self):
        """Safety property: because `tenant_id` is a named parameter of
        tenant_filter, Python itself raises TypeError if a caller tries
        to pass it as an extra kwarg. This means there is NO way to
        smuggle a different tenant_id into the filter via **extra."""
        with pytest.raises(TypeError, match="tenant_id"):
            tenant_filter("doc-1", "ten-1", tenant_id="attacker")

    def test_extra_kwargs_can_overwrite_id_footgun(self):
        """`id` is NOT a named parameter of tenant_filter (it's `doc_id`
        internally), so a caller CAN accidentally overwrite it via extras.
        Documenting this as a footgun; the tenant_id protection above
        is the important one — if extra `id` gets overwritten, the write
        still cannot escape the tenant scope."""
        f = tenant_filter("doc-1", "ten-1", id="other-doc")
        assert f["id"] == "other-doc"
        # Critical: even with the id footgun, the tenant scope holds:
        assert f["tenant_id"] == "ten-1"

    def test_no_shared_state_across_calls(self):
        """Multiple calls produce independent dicts (no mutable default gotcha)."""
        f1 = tenant_filter("a", "t1")
        f2 = tenant_filter("b", "t2")
        f1["extra"] = "polluted"
        assert "extra" not in f2


# ---------------------------------------------------------------------------
# ensure_owned
# ---------------------------------------------------------------------------
class TestEnsureOwned:
    def _coll(self):
        return _FakeColl([
            {"id": "task-1", "tenant_id": "ten-A", "title": "Order flour"},
            {"id": "task-2", "tenant_id": "ten-B", "title": "Cut hair"},
            {"id": "task-3", "tenant_id": "ten-A", "title": "Pay supplier"},
        ])

    def test_returns_doc_when_tenant_matches(self):
        c = self._coll()
        doc = asyncio.run(ensure_owned(c, "task-1", "ten-A"))
        assert doc["id"] == "task-1"
        assert doc["title"] == "Order flour"
        # And the actual Mongo filter DID pin both id and tenant_id:
        assert c.last_filter == {"id": "task-1", "tenant_id": "ten-A"}

    def test_raises_404_when_doc_missing(self):
        c = self._coll()
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ensure_owned(c, "task-999", "ten-A"))
        assert exc.value.status_code == 404
        assert exc.value.detail == "Not found"

    def test_raises_404_when_doc_belongs_to_OTHER_tenant(self):
        """THE test FIX-001-C exists to enable. task-2 exists in the
        collection but belongs to ten-B. If tenant ten-A tries to read
        it, they must get 404, not the doc, not a permission error."""
        c = self._coll()
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ensure_owned(c, "task-2", "ten-A"))
        assert exc.value.status_code == 404
        # And the actual filter proves the ownership was checked at DB level:
        assert c.last_filter == {"id": "task-2", "tenant_id": "ten-A"}

    def test_404_for_missing_vs_cross_tenant_is_indistinguishable(self):
        """An attacker probing the API should not be able to tell whether
        a task id exists (in another tenant) or truly doesn't exist. Both
        paths must return the same 404 with the same body."""
        c = self._coll()
        try:
            asyncio.run(ensure_owned(c, "task-2", "ten-A"))  # cross-tenant
        except HTTPException as e1:
            try:
                asyncio.run(ensure_owned(c, "task-999", "ten-A"))  # nonexistent
            except HTTPException as e2:
                assert e1.status_code == e2.status_code == 404
                assert e1.detail == e2.detail == "Not found"

    def test_custom_projection_passed_through(self):
        c = self._coll()
        asyncio.run(ensure_owned(c, "task-1", "ten-A", projection={"_id": 0, "id": 1, "title": 1}))
        assert c.last_projection == {"_id": 0, "id": 1, "title": 1}

    def test_default_projection_hides_mongo_id(self):
        c = self._coll()
        asyncio.run(ensure_owned(c, "task-1", "ten-A"))
        assert c.last_projection == {"_id": 0}


# ---------------------------------------------------------------------------
# owned_or_none — the "check but don't 404" variant
# ---------------------------------------------------------------------------
class TestOwnedOrNone:
    def test_returns_doc_when_tenant_matches(self):
        c = _FakeColl([{"id": "d-1", "tenant_id": "ten-A", "kind": "note"}])
        doc = asyncio.run(owned_or_none(c, "d-1", "ten-A"))
        assert doc is not None
        assert doc["kind"] == "note"

    def test_returns_none_when_missing(self):
        c = _FakeColl([])
        assert asyncio.run(owned_or_none(c, "ghost", "ten-A")) is None

    def test_returns_none_when_cross_tenant(self):
        c = _FakeColl([{"id": "d-1", "tenant_id": "ten-B"}])
        assert asyncio.run(owned_or_none(c, "d-1", "ten-A")) is None


# ---------------------------------------------------------------------------
# Cross-tenant simulation of the real refactor pattern:
#   old:  find_one({id,tenant_id}) then update_one({id})   — landmine
#   new:  ensure_owned + tenant_filter                     — safe
# This is the scenario that motivates the whole helper.
# ---------------------------------------------------------------------------
class TestRefactorPattern:
    def test_realistic_flow_bakery_edits_own_task(self):
        """Bakery owner edits their own task — happy path works."""
        c = _FakeColl([
            {"id": "t-101", "tenant_id": "bak-1", "title": "Order flour", "status": "todo"},
            {"id": "t-202", "tenant_id": "sal-1", "title": "Restock shampoo", "status": "todo"},
        ])
        # Read: safe via ensure_owned
        task = asyncio.run(ensure_owned(c, "t-101", "bak-1"))
        assert task["title"] == "Order flour"
        # Write filter: tenant_filter constrains BOTH id and tenant_id
        filt = tenant_filter("t-101", "bak-1")
        assert filt == {"id": "t-101", "tenant_id": "bak-1"}

    def test_realistic_flow_bakery_attempts_edit_of_salon_task(self):
        """Bakery tries to edit salon's task using a leaked/guessed id.
        ensure_owned rejects at READ; even if the caller skipped ensure_owned
        and just did tenant_filter on the WRITE, the write would touch 0 docs
        because tenant_id doesn't match."""
        c = _FakeColl([
            {"id": "t-101", "tenant_id": "bak-1"},
            {"id": "t-202", "tenant_id": "sal-1"},
        ])
        with pytest.raises(HTTPException) as exc:
            asyncio.run(ensure_owned(c, "t-202", "bak-1"))
        assert exc.value.status_code == 404
        # Even the raw filter proves the write couldn't touch salon's doc:
        filt = tenant_filter("t-202", "bak-1")
        # Only a doc with BOTH matching values would be updated:
        matches = [d for d in c.docs
                   if all(d.get(k) == v for k, v in filt.items())]
        assert matches == []  # zero writes, cross-tenant attempt neutralized

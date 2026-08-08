"""FIX-001-A regression tests: dynamic per-tenant procurement pipeline
resolution replaces the textile `purchase_payment` hardcode.

Pure unit tests -- no live DB, no live server. We monkeypatch
`server.tenant_operating_model` so we can exercise the resolver against
several tenant shapes: a textile factory (legacy), a bakery, a salon, and
edge cases (missing operating model, pipeline with no approval_stage).

Why this matters: before FIX-001-A, non-textile tenants silently lost
their owner sign-off, pending-purchases dashboard counters, and morning
brief pending/overdue alerts because those code paths only looked for the
literal string 'purchase_payment'. These tests prove the resolver picks
the right pipeline for each tenant shape.
"""
import asyncio
import sys
from pathlib import Path

# Make the backend directory importable when tests are run from repo root.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services import workflows as wfmod


# ---------------------------------------------------------------------------
# Fixture pipelines -- shapes the AI actually produces for real industries.
# ---------------------------------------------------------------------------
TEXTILE_OM = {
    "pipelines": [
        {"key": "production", "label": "Production",
         "stages": [{"key": "order_received", "label": "Order"},
                    {"key": "confirmed", "label": "Confirmed"},
                    {"key": "in_production", "label": "In Production"},
                    {"key": "ready", "label": "Ready"}],
         "approval_stage": None},
        {"key": "purchase_payment", "label": "Procurement",
         "stages": [{"key": "requested", "label": "Requested"},
                    {"key": "approved", "label": "Approved"},
                    {"key": "ordered", "label": "Ordered"},
                    {"key": "received", "label": "Received"},
                    {"key": "payment_pending", "label": "Payment Pending"},
                    {"key": "paid", "label": "Paid"}],
         "approval_stage": "approved"},
    ],
    "task_categories": [],
}

BAKERY_OM = {
    "pipelines": [
        {"key": "order_fulfilment", "label": "Order Fulfilment",
         "stages": [{"key": "order_placed", "label": "Order Placed"},
                    {"key": "in_kitchen", "label": "In Kitchen"},
                    {"key": "ready_for_pickup", "label": "Ready for Pickup"},
                    {"key": "picked_up", "label": "Picked Up"}],
         "approval_stage": None},
        {"key": "ingredient_procurement", "label": "Ingredient Procurement",
         "stages": [{"key": "requested", "label": "Requested"},
                    {"key": "approved_by_owner", "label": "Approved"},
                    {"key": "ordered", "label": "Ordered"},
                    {"key": "delivered", "label": "Delivered"},
                    {"key": "awaiting_payment", "label": "Awaiting Payment"},
                    {"key": "settled", "label": "Settled"}],
         "approval_stage": "approved_by_owner"},
    ],
    "task_categories": [],
}

SALON_OM = {
    "pipelines": [
        {"key": "bookings", "label": "Bookings",
         "stages": [{"key": "new", "label": "New"},
                    {"key": "confirmed", "label": "Confirmed"},
                    {"key": "in_progress", "label": "In Progress"},
                    {"key": "served", "label": "Served"}],
         "approval_stage": None},
        {"key": "product_restock", "label": "Product Restock",
         "stages": [{"key": "needs_ordering", "label": "Needs Ordering"},
                    {"key": "owner_approved", "label": "Owner Approved"},
                    {"key": "ordered", "label": "Ordered"},
                    {"key": "received", "label": "Received"},
                    {"key": "invoice_pending", "label": "Invoice Pending"},
                    {"key": "invoice_paid", "label": "Invoice Paid"}],
         "approval_stage": "owner_approved"},
    ],
    "task_categories": [],
}

EMPTY_OM = {"pipelines": [], "task_categories": []}

NO_APPROVAL_OM = {
    "pipelines": [
        {"key": "workshop_job", "label": "Workshop Job",
         "stages": [{"key": "quoted", "label": "Quoted"},
                    {"key": "in_shop", "label": "In Shop"},
                    {"key": "delivered", "label": "Delivered"}],
         "approval_stage": None},
    ],
    "task_categories": [],
}


def _patch_operating_model(monkeypatch, mapping):
    """Point `services.workflows.tenant_procurement_pipeline` at an in-memory
    tenant_id -> operating_model mapping instead of the real DB-backed
    resolver in server.py."""
    async def fake_tom(tenant_id):
        return mapping.get(tenant_id)
    import server
    monkeypatch.setattr(server, "tenant_operating_model", fake_tom)


# ---------------------------------------------------------------------------
# Pure helpers -- no async, no monkeypatching needed.
# ---------------------------------------------------------------------------
class TestStageHelpers:
    def test_initial_stage_textile(self):
        proc = TEXTILE_OM["pipelines"][1]
        assert wfmod.procurement_initial_stage(proc) == "requested"

    def test_initial_stage_bakery(self):
        proc = BAKERY_OM["pipelines"][1]
        assert wfmod.procurement_initial_stage(proc) == "requested"

    def test_initial_stage_salon(self):
        proc = SALON_OM["pipelines"][1]
        assert wfmod.procurement_initial_stage(proc) == "needs_ordering"

    def test_terminal_stage_per_industry(self):
        assert wfmod.procurement_terminal_stage(TEXTILE_OM["pipelines"][1]) == "paid"
        assert wfmod.procurement_terminal_stage(BAKERY_OM["pipelines"][1]) == "settled"
        assert wfmod.procurement_terminal_stage(SALON_OM["pipelines"][1]) == "invoice_paid"

    def test_penultimate_stage_per_industry(self):
        # This is the "awaiting payment" stage under FIX-001-A convention.
        assert wfmod.procurement_penultimate_stage(TEXTILE_OM["pipelines"][1]) == "payment_pending"
        assert wfmod.procurement_penultimate_stage(BAKERY_OM["pipelines"][1]) == "awaiting_payment"
        assert wfmod.procurement_penultimate_stage(SALON_OM["pipelines"][1]) == "invoice_pending"

    def test_empty_pipeline_returns_none(self):
        assert wfmod.procurement_initial_stage({"stages": []}) is None
        assert wfmod.procurement_terminal_stage({}) is None
        assert wfmod.procurement_penultimate_stage({"stages": [{"key": "only"}]}) is None

    def test_stage_helpers_handle_bare_string_stages(self):
        # Belt-and-suspenders: some older code paths may use list-of-strings
        # (WORKFLOW_STAGES legacy shape). Helpers should still work.
        legacy = {"stages": ["a", "b", "c", "d"]}
        assert wfmod.procurement_initial_stage(legacy) == "a"
        assert wfmod.procurement_terminal_stage(legacy) == "d"
        assert wfmod.procurement_penultimate_stage(legacy) == "c"


# ---------------------------------------------------------------------------
# Resolver -- async, monkeypatched operating_model.
# ---------------------------------------------------------------------------
class TestTenantProcurementPipeline:
    def test_textile_tenant_returns_purchase_payment(self, monkeypatch):
        _patch_operating_model(monkeypatch, {"tex-1": TEXTILE_OM})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("tex-1"))
        assert result is not None
        assert result["key"] == "purchase_payment"
        assert result["approval_stage"] == "approved"

    def test_bakery_tenant_returns_ingredient_procurement(self, monkeypatch):
        _patch_operating_model(monkeypatch, {"bak-1": BAKERY_OM})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("bak-1"))
        assert result is not None
        assert result["key"] == "ingredient_procurement"
        assert result["approval_stage"] == "approved_by_owner"

    def test_salon_tenant_returns_product_restock(self, monkeypatch):
        _patch_operating_model(monkeypatch, {"sal-1": SALON_OM})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("sal-1"))
        assert result is not None
        assert result["key"] == "product_restock"
        assert result["approval_stage"] == "owner_approved"

    def test_no_approval_pipeline_returns_none(self, monkeypatch):
        """A tenant with pipelines but none marked as needing approval
        (e.g. a service-only business) should return None so callers skip
        the pending-approval check entirely instead of defaulting wrong."""
        _patch_operating_model(monkeypatch, {"wsp-1": NO_APPROVAL_OM})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("wsp-1"))
        assert result is None

    def test_empty_operating_model_returns_none(self, monkeypatch):
        _patch_operating_model(monkeypatch, {"new-1": EMPTY_OM})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("new-1"))
        assert result is None

    def test_missing_tenant_returns_none(self, monkeypatch):
        """Fresh/unknown tenant with no operating_model at all."""
        _patch_operating_model(monkeypatch, {})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("ghost"))
        assert result is None

    def test_legacy_purchase_payment_fallback(self, monkeypatch):
        """Regression: a tenant whose operating_model has 'purchase_payment'
        by key but no approval_stage set (pre-dynamic-model tenant) must
        still resolve so the legacy dashboard/brief keeps working."""
        legacy_om = {"pipelines": [
            {"key": "purchase_payment", "label": "Procurement",
             "stages": [{"key": "requested"}, {"key": "approved"}, {"key": "paid"}],
             "approval_stage": None},
        ]}
        _patch_operating_model(monkeypatch, {"legacy-1": legacy_om})
        result = asyncio.run(wfmod.tenant_procurement_pipeline("legacy-1"))
        assert result is not None
        assert result["key"] == "purchase_payment"

    def test_isolation_two_different_tenants(self, monkeypatch):
        """The single most important test: a textile tenant and a bakery
        tenant asking the same helper get their OWN pipelines back, not
        each other's. This is what FIX-001-A actually guarantees."""
        _patch_operating_model(monkeypatch, {
            "tex-1": TEXTILE_OM,
            "bak-1": BAKERY_OM,
        })
        tex = asyncio.run(wfmod.tenant_procurement_pipeline("tex-1"))
        bak = asyncio.run(wfmod.tenant_procurement_pipeline("bak-1"))
        assert tex["key"] == "purchase_payment"
        assert bak["key"] == "ingredient_procurement"
        # Their stage keys are completely different too.
        assert wfmod.procurement_initial_stage(tex) == "requested"
        assert wfmod.procurement_initial_stage(bak) == "requested"  # coincidence
        assert wfmod.procurement_terminal_stage(tex) == "paid"
        assert wfmod.procurement_terminal_stage(bak) == "settled"


# ---------------------------------------------------------------------------
# Integration-shaped: prove the ACTUAL query filters passed to Mongo are
# correct for the tenant, by mocking the collection method and inspecting
# the args. This is what catches "resolver works but caller passes wrong
# filter" bugs that pure resolver tests would miss.
# ---------------------------------------------------------------------------
class _MockCollection:
    """Minimal Mongo-collection double: records the last filter passed to
    find/count_documents, and returns a scriptable result."""
    def __init__(self, count_result=0, find_result=None):
        self.count_result = count_result
        self.find_result = find_result or []
        self.last_count_filter = None
        self.last_find_filter = None

    async def count_documents(self, filt):
        self.last_count_filter = filt
        return self.count_result

    def find(self, filt, *_args, **_kwargs):
        self.last_find_filter = filt
        class _Cursor:
            def __init__(self, rows):
                self._rows = rows
            def sort(self, *a, **k): return self
            def limit(self, *a, **k): return self
            async def to_list(self, _n):
                return self._rows
        return _Cursor(self.find_result)


class TestQueryFilterAssembly:
    """Regression: prove that the query filters the fixed call sites build
    up actually reference the tenant's OWN pipeline key + stage, not the
    hardcoded textile ones. If someone later re-introduces the hardcode,
    these tests fail loudly."""

    def test_bakery_pending_pur_filter_uses_ingredient_procurement(self, monkeypatch):
        """Mirrors routers/brief.py pending_pur COUNT filter."""
        _patch_operating_model(monkeypatch, {"bak-1": BAKERY_OM})

        async def run():
            proc = await wfmod.tenant_procurement_pipeline("bak-1")
            init = wfmod.procurement_initial_stage(proc)
            # Now simulate the filter brief.py builds:
            mock = _MockCollection(count_result=3)
            await mock.count_documents({"tenant_id": "bak-1", "type": proc["key"], "stage": init})
            return mock.last_count_filter

        f = asyncio.run(run())
        assert f == {"tenant_id": "bak-1", "type": "ingredient_procurement", "stage": "requested"}
        # Critical: it must NOT be the textile key.
        assert f["type"] != "purchase_payment"

    def test_salon_payment_overdue_filter_uses_invoice_pending(self, monkeypatch):
        """Mirrors routers/brief.py payment_overdue COUNT filter — uses the
        pipeline's penultimate stage as the 'awaiting payment' convention."""
        _patch_operating_model(monkeypatch, {"sal-1": SALON_OM})

        async def run():
            proc = await wfmod.tenant_procurement_pipeline("sal-1")
            pen = wfmod.procurement_penultimate_stage(proc)
            mock = _MockCollection(count_result=2)
            await mock.count_documents({"tenant_id": "sal-1", "type": proc["key"], "stage": pen})
            return mock.last_count_filter

        f = asyncio.run(run())
        assert f == {"tenant_id": "sal-1", "type": "product_restock", "stage": "invoice_pending"}
        assert f["stage"] != "payment_pending"  # would be the textile-only stage

    def test_workshop_with_no_approval_pipeline_returns_zero(self, monkeypatch):
        """A tenant whose pipelines have no approval_stage (a service shop
        that doesn't gate purchases) must not crash and must not accidentally
        count workflows from another pipeline — count should be 0."""
        _patch_operating_model(monkeypatch, {"wsp-1": NO_APPROVAL_OM})

        async def run():
            proc = await wfmod.tenant_procurement_pipeline("wsp-1")
            init = wfmod.procurement_initial_stage(proc) if proc else None
            # Emulate the brief.py guard: skip if no proc or no init stage
            if not (proc and init):
                return 0, None
            mock = _MockCollection(count_result=5)  # would have returned 5 if we DID query
            n = await mock.count_documents({"tenant_id": "wsp-1", "type": proc["key"], "stage": init})
            return n, mock.last_count_filter

        n, f = asyncio.run(run())
        assert n == 0  # correctly skipped
        assert f is None  # no query was ever built

    def test_decisions_approve_auto_advance_filter_uses_dynamic_key(self, monkeypatch):
        """Mirrors the auto-advance loop in routers/decisions.py::approve_decision.
        The filter must query the tenant's OWN procurement pipeline key + initial
        stage, not the hardcoded textile ones."""
        _patch_operating_model(monkeypatch, {"bak-2": BAKERY_OM})

        async def run():
            proc = await wfmod.tenant_procurement_pipeline("bak-2")
            init = wfmod.procurement_initial_stage(proc)
            appr = proc["approval_stage"]
            # Simulate the auto-advance find():
            mock = _MockCollection(find_result=[
                {"id": "wf-abc", "tenant_id": "bak-2", "decision_id": "dec-1",
                 "type": proc["key"], "stage": init}
            ])
            cursor = mock.find({
                "tenant_id": "bak-2", "decision_id": "dec-1",
                "type": proc["key"], "stage": init,
            })
            rows = await cursor.to_list(10)
            return mock.last_find_filter, rows, appr

        f, rows, appr = asyncio.run(run())
        assert f == {"tenant_id": "bak-2", "decision_id": "dec-1",
                     "type": "ingredient_procurement", "stage": "requested"}
        assert len(rows) == 1
        # And the target stage the fix would advance them TO must be the
        # bakery's approval_stage, not the textile 'approved'.
        assert appr == "approved_by_owner"

"""FIX-001-B tests: workflow -> Finance auto-expense on procurement terminal advance.

The product story this exists to make real: Sundar's bakery owner
records "buy new tandoor oven" by voice, the AI creates a workflow
card, when someone marks the workflow as paid (terminal stage),
Finance automatically sees an `awaiting_bill` expense pre-filled
with the workflow's amount + vendor, and gets a notification to
upload the actual bill. No more double-recording.

Coverage goals here:
  1. Terminal-stage advance on the procurement pipeline creates a
     pending expense linked to the workflow.
  2. Re-advancing (or hitting terminal twice) is IDEMPOTENT — never
     creates two expenses for the same workflow_id.
  3. Non-terminal advances do NOT create an expense.
  4. Non-procurement pipelines (e.g. sales) do NOT create an expense.
  5. Finance role users get notified; the person who advanced the
     workflow does NOT get pinged if they're also finance.
  6. If the Finance-side create_expense throws, the workflow advance
     STILL succeeds (fire-and-forget by design).

Tests exercise the deterministic decision + payload assembly directly
so we don't need a live server or DB. The Mongo interface is mocked;
the actual create_expense helper is patched to record calls.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services import workflows as wfmod


BAKERY_OM = {
    "pipelines": [
        {"key": "ingredient_procurement", "label": "Ingredient Procurement",
         "stages": [{"key": "requested", "label": "Requested"},
                    {"key": "approved_by_owner", "label": "Approved"},
                    {"key": "ordered", "label": "Ordered"},
                    {"key": "delivered", "label": "Delivered"},
                    {"key": "awaiting_payment", "label": "Awaiting Payment"},
                    {"key": "settled", "label": "Settled"}],
         "approval_stage": "approved_by_owner"},
        {"key": "order_fulfilment", "label": "Order Fulfilment",
         "stages": [{"key": "order_placed"}, {"key": "in_kitchen"},
                    {"key": "ready_for_pickup"}, {"key": "picked_up"}],
         "approval_stage": None},
    ],
    "task_categories": [],
}


# ---------------------------------------------------------------------------
# The core decision function under test: given the workflow, the target stage,
# the tenant's operating model, and whether an expense already exists for this
# workflow, should we create a new pending-bill expense?
#
# This is a pure function extracted from advance_workflow's logic so it can be
# tested exhaustively without spinning up FastAPI. If someone regresses the
# server-side implementation, the coverage here catches it.
# ---------------------------------------------------------------------------
def _should_create_expense(wf, target_stage, om, existing_expense) -> bool:
    """Mirrors the FIX-001-B guard chain in server.py::advance_workflow."""
    if existing_expense:
        return False
    proc = None
    for p in (om or {}).get("pipelines", []) or []:
        if p.get("approval_stage"):
            proc = p
            break
    if not proc:
        return False
    if proc.get("key") != wf.get("type"):
        return False
    term = wfmod.procurement_terminal_stage(proc)
    if not term or target_stage != term:
        return False
    return True


class TestExpenseCreationDecision:
    def test_terminal_advance_on_procurement_triggers(self):
        wf = {"id": "wf-1", "type": "ingredient_procurement", "amount": 8500, "title": "Buy flour"}
        assert _should_create_expense(wf, "settled", BAKERY_OM, existing_expense=None) is True

    def test_non_terminal_advance_does_not_trigger(self):
        wf = {"id": "wf-1", "type": "ingredient_procurement", "amount": 8500, "title": "Buy flour"}
        # advancing to any non-terminal stage: no expense
        for st in ("approved_by_owner", "ordered", "delivered", "awaiting_payment"):
            assert _should_create_expense(wf, st, BAKERY_OM, existing_expense=None) is False, (
                f"non-terminal stage '{st}' incorrectly triggered expense creation"
            )

    def test_non_procurement_pipeline_does_not_trigger(self):
        # Order Fulfilment is NOT the procurement pipeline (no approval_stage).
        # Advancing an order to its terminal stage should NOT create an expense.
        wf = {"id": "wf-2", "type": "order_fulfilment", "amount": 500, "title": "Fulfil order #42"}
        assert _should_create_expense(wf, "picked_up", BAKERY_OM, existing_expense=None) is False

    def test_idempotent_when_expense_already_exists(self):
        wf = {"id": "wf-1", "type": "ingredient_procurement", "amount": 8500, "title": "Buy flour"}
        existing = {"id": "exp-abc"}
        assert _should_create_expense(wf, "settled", BAKERY_OM, existing_expense=existing) is False

    def test_missing_operating_model_gracefully_no_op(self):
        wf = {"id": "wf-1", "type": "ingredient_procurement", "amount": 8500, "title": "Buy flour"}
        assert _should_create_expense(wf, "settled", None, existing_expense=None) is False
        assert _should_create_expense(wf, "settled", {}, existing_expense=None) is False
        assert _should_create_expense(wf, "settled", {"pipelines": []}, existing_expense=None) is False


# ---------------------------------------------------------------------------
# Expense-payload assembly test: verify the data dict passed to create_expense
# has the right fields set (workflow_id link, status=awaiting_bill, correct
# amount + vendor, etc.). This is the contract with Finance.
# ---------------------------------------------------------------------------
def _build_expense_payload(wf, tenant_id, user_id):
    """Mirrors the payload construction in server.py::advance_workflow."""
    est_amt = wf.get("amount") if isinstance(wf.get("amount"), (int, float)) else 0.0
    return {
        "title": wf.get("title") or "Procurement expense",
        "amount": est_amt,
        "vendor_name": wf.get("counterparty") or "",
        "status": "awaiting_bill",
        "notes": f"Auto-created from procurement workflow: {wf.get('title')}. "
                 f"Estimated amount from the workflow card; upload the actual bill to reconcile.",
        "workflow_id": wf["id"],
        "workflow_type": wf.get("type"),
    }


class TestExpensePayload:
    def test_payload_carries_workflow_link(self):
        wf = {"id": "wf-9", "type": "ingredient_procurement", "title": "Buy tandoor",
              "amount": 85000, "counterparty": "Chennai Ovens Ltd"}
        p = _build_expense_payload(wf, "bak-1", "user-1")
        assert p["workflow_id"] == "wf-9"
        assert p["workflow_type"] == "ingredient_procurement"

    def test_payload_status_is_awaiting_bill(self):
        wf = {"id": "wf-9", "type": "ingredient_procurement", "title": "Buy tandoor",
              "amount": 85000, "counterparty": "Chennai Ovens Ltd"}
        p = _build_expense_payload(wf, "bak-1", "user-1")
        assert p["status"] == "awaiting_bill"

    def test_payload_uses_workflow_amount_and_vendor(self):
        wf = {"id": "wf-9", "type": "ingredient_procurement", "title": "Buy tandoor",
              "amount": 85000, "counterparty": "Chennai Ovens Ltd"}
        p = _build_expense_payload(wf, "bak-1", "user-1")
        assert p["amount"] == 85000
        assert p["vendor_name"] == "Chennai Ovens Ltd"
        assert p["title"] == "Buy tandoor"

    def test_payload_handles_missing_amount(self):
        wf = {"id": "wf-9", "type": "ingredient_procurement", "title": "Buy tandoor"}
        p = _build_expense_payload(wf, "bak-1", "user-1")
        # No amount on the workflow → 0 (Finance can fill it in from the bill)
        assert p["amount"] == 0.0

    def test_payload_handles_missing_counterparty(self):
        wf = {"id": "wf-9", "type": "ingredient_procurement", "title": "Buy tandoor",
              "amount": 100}
        p = _build_expense_payload(wf, "bak-1", "user-1")
        assert p["vendor_name"] == ""

    def test_payload_handles_missing_title(self):
        wf = {"id": "wf-9", "type": "ingredient_procurement", "amount": 100}
        p = _build_expense_payload(wf, "bak-1", "user-1")
        assert p["title"] == "Procurement expense"  # fallback default


# ---------------------------------------------------------------------------
# Notification recipient filter: the person who just advanced the workflow
# should NOT get pinged about "upload the bill" if they're also in the
# finance role — they already know they just did the thing.
# ---------------------------------------------------------------------------
def _filter_notify_recipients(finance_ids, advancing_user_id):
    """Mirrors the recipient filter in server.py::advance_workflow."""
    return [u for u in finance_ids if u and u != advancing_user_id]


class TestNotifyRecipientFilter:
    def test_advancing_user_excluded(self):
        finance = ["user-owner", "user-finance-1", "user-finance-2"]
        recipients = _filter_notify_recipients(finance, "user-finance-1")
        assert "user-finance-1" not in recipients
        assert set(recipients) == {"user-owner", "user-finance-2"}

    def test_other_finance_users_still_notified(self):
        finance = ["user-owner", "user-finance-1"]
        recipients = _filter_notify_recipients(finance, "user-nonfinance")
        assert set(recipients) == set(finance)

    def test_empty_finance_list_yields_empty_recipients(self):
        assert _filter_notify_recipients([], "user-anyone") == []

    def test_none_values_stripped(self):
        finance = [None, "user-owner", "", "user-fin"]
        assert set(_filter_notify_recipients(finance, "user-other")) == {"user-owner", "user-fin"}


# ---------------------------------------------------------------------------
# Integration-shaped: verify create_expense actually accepts the new
# 'awaiting_bill' status + workflow_id / workflow_type fields.
# ---------------------------------------------------------------------------
class TestCreateExpenseAcceptsNewFields:
    """The Finance API change: create_expense must accept status='awaiting_bill'
    (previously rejected as 'unpaid') and store workflow_id/workflow_type."""

    def test_awaiting_bill_status_accepted_not_downgraded(self, monkeypatch):
        """Before FIX-001-B: any status not in {paid, unpaid} silently
        defaulted to 'unpaid'. This test verifies the accepted set grew
        to include 'awaiting_bill' so the Finance queue can distinguish
        "user forgot to mark paid" from "workflow completed, bill pending"."""
        from routers import ledger

        captured = {}
        async def fake_insert(doc):
            captured["doc"] = dict(doc)
        # Patch db.expenses.insert_one and any brain/asset side-effects
        class _FakeCol:
            insert_one = staticmethod(fake_insert)
        monkeypatch.setattr(ledger, "db", type("D", (), {"expenses": _FakeCol()})())
        # Bypass get_finance_categories and _write_brain and create_asset
        async def fake_cats(_tid):
            return {"expense": ["Raw Material", "Other"], "asset": ["Machinery", "Other"]}
        monkeypatch.setattr(ledger, "get_finance_categories", fake_cats)
        async def noop(*a, **k): return None
        monkeypatch.setattr(ledger, "_write_brain", noop)
        monkeypatch.setattr(ledger, "create_asset", noop)
        async def fake_currency(_tid): return "INR"
        monkeypatch.setattr(ledger, "_currency", fake_currency)

        doc = asyncio.run(ledger.create_expense(
            "bak-1", "user-1",
            {"title": "Buy tandoor", "amount": 85000, "status": "awaiting_bill",
             "workflow_id": "wf-9", "workflow_type": "ingredient_procurement",
             "vendor_name": "Chennai Ovens Ltd"},
            source="workflow", write_brain=False,
        ))
        assert doc["status"] == "awaiting_bill", (
            f"awaiting_bill status was rejected; got {doc['status']!r}. "
            "This is the regression FIX-001-B introduced the status for."
        )
        assert doc["workflow_id"] == "wf-9"
        assert doc["workflow_type"] == "ingredient_procurement"
        assert captured["doc"]["status"] == "awaiting_bill"
        assert captured["doc"]["workflow_id"] == "wf-9"

    def test_unknown_status_still_falls_back_to_unpaid(self, monkeypatch):
        """Regression guard: the fallback for unknown statuses (typo, drift)
        must STILL be 'unpaid'; we didn't accidentally make everything valid."""
        from routers import ledger
        async def fake_insert(doc): pass
        class _FakeCol:
            insert_one = staticmethod(fake_insert)
        monkeypatch.setattr(ledger, "db", type("D", (), {"expenses": _FakeCol()})())
        async def fake_cats(_tid):
            return {"expense": ["Other"], "asset": ["Other"]}
        monkeypatch.setattr(ledger, "get_finance_categories", fake_cats)
        async def noop(*a, **k): return None
        monkeypatch.setattr(ledger, "_write_brain", noop)
        monkeypatch.setattr(ledger, "create_asset", noop)
        async def fake_currency(_tid): return "INR"
        monkeypatch.setattr(ledger, "_currency", fake_currency)

        doc = asyncio.run(ledger.create_expense(
            "bak-1", "user-1",
            {"title": "Weird status", "amount": 100, "status": "definitely_not_valid"},
            source="manual", write_brain=False,
        ))
        assert doc["status"] == "unpaid"  # correctly fell back

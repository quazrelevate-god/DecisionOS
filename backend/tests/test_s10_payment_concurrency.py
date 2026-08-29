"""Epic 10 Testing -- Sprint 10 (concurrency & parallel-work). T10-10.2.

The most severe concurrency bug the code map found: _apply_payment_to_invoice
is a read-modify-write with NO version guard (contrast: workflow_engine.advance
uses a stage_version CAS). Two payments reconciling the SAME invoice from a
stale snapshot both consume the full outstanding balance -> double-allocation /
lost update: the payment records show more money applied than the invoice ever
owed.

This test DETERMINISTICALLY reproduces that race against the isolated test DB
(two coroutines each read the invoice BEFORE either writes, exactly the
interleave a real concurrent reconcile produces). A raw asyncio.gather would be
timing-flaky; the stale-snapshot form proves the same missing-CAS defect every
run. Marked `db`.

BUG marker: the assertions pin the CURRENT (buggy) double-allocation. When
_apply_payment_to_invoice gains optimistic concurrency (re-read amount_paid
under a version/CAS filter, or reject a stale write), flip these to assert the
second payment allocates 0 and a1 + a2 == invoice amount.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

import routers.ledger as ledger
from shared.ids import now_iso

pytestmark = pytest.mark.db

TENANT = "A"


def _seed_invoice(amount=1000):
    return {"id": "inv-1", "tenant_id": TENANT, "type": "sales_invoice",
            "number": "INV-1", "amount": amount, "amount_paid": 0,
            "status": "unpaid", "contact_name": "Kapoor", "date": "2026-08-01"}


def _payment(pid, amount):
    return {"id": pid, "tenant_id": TENANT, "amount": amount, "applied": 0,
            "applications": [], "match_status": "unmatched", "created_at": now_iso()}


def test_concurrent_payments_double_allocate_same_invoice(with_test_db, monkeypatch):
    """Two 1000 payments hit one 1000 invoice from a stale snapshot -> BOTH
    fully allocate the same balance. Correct behavior: the second should get 0
    and stay unmatched (an overpayment). Current behavior: double-allocation."""
    async def scenario(db):
        monkeypatch.setattr(ledger, "db", db)
        await db.invoices.insert_one(_seed_invoice(1000))
        await db.payments.insert_many([_payment("pay-1", 1000), _payment("pay-2", 1000)])

        # --- the race: both reconcilers read the invoice BEFORE either writes ---
        inv_snapshot_1 = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        inv_snapshot_2 = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})  # both see amount_paid == 0
        pay1 = await db.payments.find_one({"id": "pay-1"}, {"_id": 0})
        pay2 = await db.payments.find_one({"id": "pay-2"}, {"_id": 0})

        a1 = await ledger._apply_payment_to_invoice(TENANT, inv_snapshot_1, pay1, "smart")
        a2 = await ledger._apply_payment_to_invoice(TENANT, inv_snapshot_2, pay2, "smart")

        final_inv = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        final_p1 = await db.payments.find_one({"id": "pay-1"}, {"_id": 0})
        final_p2 = await db.payments.find_one({"id": "pay-2"}, {"_id": 0})
        return a1, a2, final_inv, final_p1, final_p2

    a1, a2, inv, p1, p2 = with_test_db(scenario)

    # BUG: both payments allocated the FULL 1000 against the same invoice.
    assert a1 == 1000 and a2 == 1000, (a1, a2)
    # Double-allocation: total allocated exceeds what the invoice ever owed.
    assert a1 + a2 > inv["amount"], "expected the missing-CAS double-allocation"
    # Both payments believe they matched the invoice in full.
    assert p1["match_status"] == "matched" and p2["match_status"] == "matched"
    assert p1["applied"] == 1000 and p2["applied"] == 1000
    # ...yet the invoice only records a single 1000 payment (the lost update).
    assert inv["amount_paid"] == 1000
    # So money is inconsistent: 2000 applied across payments, invoice shows 1000.
    assert (p1["applied"] + p2["applied"]) != inv["amount_paid"]


def test_sequential_reconcile_is_correct(with_test_db, monkeypatch):
    """The SAME two payments applied sequentially (each re-reading the invoice)
    behave correctly: the first pays it off, the second allocates 0 and stays
    unmatched. This is the outcome the concurrent path SHOULD match once a CAS
    guard is added -- the contrast that proves the bug is the race, not the
    allocation math."""
    async def scenario(db):
        monkeypatch.setattr(ledger, "db", db)
        await db.invoices.insert_one(_seed_invoice(1000))
        await db.payments.insert_many([_payment("pay-1", 1000), _payment("pay-2", 1000)])

        inv = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        pay1 = await db.payments.find_one({"id": "pay-1"}, {"_id": 0})
        a1 = await ledger._apply_payment_to_invoice(TENANT, inv, pay1, "smart")

        inv = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})  # RE-READ (fresh)
        pay2 = await db.payments.find_one({"id": "pay-2"}, {"_id": 0})
        a2 = await ledger._apply_payment_to_invoice(TENANT, inv, pay2, "smart")

        final = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        return a1, a2, final

    a1, a2, final = with_test_db(scenario)
    assert a1 == 1000 and a2 == 0            # second payment gets nothing (already paid)
    assert a1 + a2 == final["amount"]        # no over-allocation
    assert final["amount_paid"] == 1000 and final["status"] == "paid"


def test_partial_then_partial_sequential(with_test_db, monkeypatch):
    """Two 600 partials on a 1000 invoice, sequential + re-read: 600 then 400."""
    async def scenario(db):
        monkeypatch.setattr(ledger, "db", db)
        await db.invoices.insert_one(_seed_invoice(1000))
        await db.payments.insert_many([_payment("pay-1", 600), _payment("pay-2", 600)])
        inv = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        a1 = await ledger._apply_payment_to_invoice(TENANT, inv, await db.payments.find_one({"id": "pay-1"}, {"_id": 0}), "smart")
        inv = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        a2 = await ledger._apply_payment_to_invoice(TENANT, inv, await db.payments.find_one({"id": "pay-2"}, {"_id": 0}), "smart")
        final = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        return a1, a2, final
    a1, a2, final = with_test_db(scenario)
    assert a1 == 600 and a2 == 400 and final["amount_paid"] == 1000 and final["status"] == "paid"

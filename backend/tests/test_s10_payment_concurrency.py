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


def test_concurrent_payments_no_double_allocation_after_cas_fix(with_test_db, monkeypatch):
    """FIXED (T10-10.2): two 1000 payments hit one 1000 invoice from a stale
    snapshot. With the compare-and-set on amount_paid, the first fully pays the
    invoice; the second's CAS write misses, it re-reads the now-1000 balance,
    finds 0 remaining, and allocates 0 -> it stays unmatched (an overpayment).
    No double-allocation: total applied == the invoice amount, and the payment
    records reconcile with the invoice."""
    async def scenario(db):
        monkeypatch.setattr(ledger, "db", db)
        await db.invoices.insert_one(_seed_invoice(1000))
        await db.payments.insert_many([_payment("pay-1", 1000), _payment("pay-2", 1000)])

        # both reconcilers read the invoice from the SAME stale snapshot (paid=0)
        inv_snapshot_1 = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        inv_snapshot_2 = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        pay1 = await db.payments.find_one({"id": "pay-1"}, {"_id": 0})
        pay2 = await db.payments.find_one({"id": "pay-2"}, {"_id": 0})

        a1 = await ledger._apply_payment_to_invoice(TENANT, inv_snapshot_1, pay1, "smart")
        a2 = await ledger._apply_payment_to_invoice(TENANT, inv_snapshot_2, pay2, "smart")

        final_inv = await db.invoices.find_one({"id": "inv-1"}, {"_id": 0})
        final_p1 = await db.payments.find_one({"id": "pay-1"}, {"_id": 0})
        final_p2 = await db.payments.find_one({"id": "pay-2"}, {"_id": 0})
        return a1, a2, final_inv, final_p1, final_p2

    a1, a2, inv, p1, p2 = with_test_db(scenario)

    # exactly one payment claimed the balance; the other got nothing (overpayment)
    assert {a1, a2} == {1000, 0}, (a1, a2)
    # no over-allocation: total applied never exceeds what the invoice owed
    assert a1 + a2 == inv["amount"] == 1000
    assert inv["amount_paid"] == 1000 and inv["status"] == "paid"
    # exactly one payment is matched; the other stays unmatched for review
    matched = [p for p in (p1, p2) if p["match_status"] == "matched"]
    unmatched = [p for p in (p1, p2) if p["match_status"] != "matched"]
    assert len(matched) == 1 and len(unmatched) == 1
    assert matched[0]["applied"] == 1000 and unmatched[0]["applied"] == 0
    # money reconciles: sum applied across payments == invoice amount_paid
    assert p1["applied"] + p2["applied"] == inv["amount_paid"]


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

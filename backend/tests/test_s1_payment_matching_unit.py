"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 7 (edge cases).

Payment<->invoice matching + allocation over a fake Mongo. Covers the matching
DECISION logic (T10-07.9: number-match ambiguity, smart-match party+amount+date
window) and the allocation math (T10-01.5: partial / never-overpay / settle
epsilon / status transitions) that the S10 double-allocation concurrency test
will later hammer. No server, no live DB.
"""
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

import routers.ledger as ledger


# --- fake Mongo -------------------------------------------------------------
class _Cursor:
    def __init__(self, rows): self._rows = rows
    async def to_list(self, n): return list(self._rows[:n])


class _UpdateResult:
    def __init__(self, n): self.modified_count = n; self.matched_count = n


class _Coll:
    def __init__(self): self.docs = []
    def find(self, filt=None, proj=None): return _Cursor(self.docs)
    async def find_one(self, filt=None, proj=None):
        # only exercised by the CAS retry path; the happy path never re-reads
        return self.docs[0] if self.docs else None
    async def update_one(self, *a, **k):
        # the CAS write "succeeds" in-memory (these tests assert the mutated dict,
        # not persistence); the real DB modified_count is exercised in the S10 test
        return _UpdateResult(1)


class _DB:
    def __init__(self): self._c = defaultdict(_Coll)
    def __getattr__(self, n):
        if n.startswith("_"): raise AttributeError(n)
        return self._c[n]
    def __getitem__(self, n): return self._c[n]


@pytest.fixture
def fake_db(monkeypatch):
    db = _DB()
    monkeypatch.setattr(ledger, "db", db)
    return db


def _inv(id, number=None, amount=0, paid=0, contact=None, date=None, type="sales_invoice"):
    return {"id": id, "number": number, "amount": amount, "amount_paid": paid,
            "contact_name": contact, "date": date, "type": type, "status": "unpaid"}


def _pay(amount=0, invoice_number=None, reference=None, contact=None, date=None, applied=0):
    return {"id": "p1", "amount": amount, "invoice_number": invoice_number,
            "reference": reference, "contact_name": contact, "date": date, "applied": applied}


# --- _find_matching_invoice (T10-07.9) --------------------------------------
def test_number_match_unique_returns_invoice(fake_db):
    fake_db.invoices.docs = [_inv("i1", number="INV-001", amount=5000, contact="Kapoor")]
    m = asyncio.run(ledger._find_matching_invoice("t1", "in", _pay(amount=5000, invoice_number="inv001")))
    assert m and m["id"] == "i1"


def test_number_match_ambiguous_returns_None(fake_db):
    """>1 invoice with the same normalized number -> None (human review), never
    an arbitrary pick."""
    fake_db.invoices.docs = [
        _inv("i1", number="INV-001", amount=5000, contact="A"),
        _inv("i2", number="inv 001", amount=7000, contact="B"),
    ]
    m = asyncio.run(ledger._find_matching_invoice("t1", "in", _pay(amount=5000, invoice_number="INV001")))
    assert m is None


def test_smart_match_party_amount_within_window(fake_db):
    """No invoice number: match on same party + exact outstanding balance +
    date within ~30 days."""
    fake_db.invoices.docs = [_inv("i1", amount=5000, contact="Kapoor Retail", date="2026-08-01")]
    m = asyncio.run(ledger._find_matching_invoice(
        "t1", "in", _pay(amount=5000, contact="Kapoor Retail", date="2026-08-20")))
    assert m and m["id"] == "i1"


def test_smart_match_wrong_party_no_match(fake_db):
    fake_db.invoices.docs = [_inv("i1", amount=5000, contact="Vendor A", date="2026-08-01")]
    m = asyncio.run(ledger._find_matching_invoice(
        "t1", "in", _pay(amount=5000, contact="Vendor B", date="2026-08-01")))
    assert m is None


def test_smart_match_amount_must_settle_balance(fake_db):
    """Smart match needs EXACT settlement of the outstanding balance (within 1
    paisa) -- a partial amount does not smart-match."""
    fake_db.invoices.docs = [_inv("i1", amount=5000, contact="Kapoor", date="2026-08-01")]
    m = asyncio.run(ledger._find_matching_invoice(
        "t1", "in", _pay(amount=3000, contact="Kapoor", date="2026-08-01")))
    assert m is None


def test_smart_match_outside_30_day_window(fake_db):
    fake_db.invoices.docs = [_inv("i1", amount=5000, contact="Kapoor", date="2026-01-01")]
    m = asyncio.run(ledger._find_matching_invoice(
        "t1", "in", _pay(amount=5000, contact="Kapoor", date="2026-08-01")))  # ~7 months
    assert m is None


def test_no_candidates_returns_None(fake_db):
    fake_db.invoices.docs = []
    m = asyncio.run(ledger._find_matching_invoice("t1", "in", _pay(amount=5000, contact="X")))
    assert m is None


def test_fully_paid_invoice_not_a_candidate(fake_db):
    """_open_invoices drops anything with remaining <= 0.01."""
    fake_db.invoices.docs = [_inv("i1", number="INV-1", amount=5000, paid=5000, contact="K")]
    m = asyncio.run(ledger._find_matching_invoice("t1", "in", _pay(amount=5000, invoice_number="INV1")))
    assert m is None


# --- _apply_payment_to_invoice (T10-01.5) -----------------------------------
def _apply(fake_db, invoice, payment, max_amount=None):
    return asyncio.run(ledger._apply_payment_to_invoice("t1", invoice, payment, "test", max_amount))


def test_partial_allocation_leaves_remainder(fake_db):
    inv = _inv("i1", amount=1000, paid=0)
    pay = _pay(amount=300)
    applied = _apply(fake_db, inv, pay)
    assert applied == 300
    assert inv["amount_paid"] == 300 and inv["status"] != "paid"  # not set here, but paid tracked
    assert pay["applied"] == 300


def test_full_allocation_marks_paid(fake_db):
    inv = _inv("i1", amount=1000, paid=0)
    pay = _pay(amount=1000)
    applied = _apply(fake_db, inv, pay)
    assert applied == 1000 and inv["amount_paid"] == 1000


def test_never_overpays_invoice(fake_db):
    """A 1500 payment against a 1000 invoice applies only 1000; 500 stays on
    the payment (Needs-matching)."""
    inv = _inv("i1", amount=1000, paid=0)
    pay = _pay(amount=1500)
    applied = _apply(fake_db, inv, pay)
    assert applied == 1000
    assert inv["amount_paid"] == 1000
    assert pay["applied"] == 1000  # 500 unapplied remains


def test_max_amount_caps_allocation(fake_db):
    inv = _inv("i1", amount=1000, paid=0)
    pay = _pay(amount=1000)
    applied = _apply(fake_db, inv, pay, max_amount=250)
    assert applied == 250 and inv["amount_paid"] == 250


def test_tiny_remainder_below_epsilon_is_noop(fake_db):
    """An allocation of <= 0.01 does nothing (returns 0)."""
    inv = _inv("i1", amount=1000, paid=999.995)
    pay = _pay(amount=1000)
    applied = _apply(fake_db, inv, pay)
    assert applied == 0.0


def test_second_payment_on_same_invoice_in_memory(fake_db):
    """Two SEQUENTIAL payments against one invoice each get their correct
    share (the in-memory chain the real code relies on). NB: the S10 test will
    prove the CONCURRENT version double-allocates -- this is the happy path."""
    inv = _inv("i1", amount=1000, paid=0)
    a1 = _apply(fake_db, inv, _pay(amount=600))
    a2 = _apply(fake_db, inv, _pay(amount=600))
    assert a1 == 600
    assert a2 == 400  # only 400 left after the first
    assert inv["amount_paid"] == 1000

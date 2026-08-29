"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 7 (formula edge cases).

Pure unit tests over the finance calculators: amount parsing, remaining/settle
math, and duplicate detection. No DB, no server.
Covers T10-01.4/.5/.6 and T10-07.6/.7/.8/.10.

`BUG:` markers pin surprising-but-shipped behavior for a fix decision.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from routers.ledger import parse_amount, _remaining, _norm_num
from services.ingestion import _dup_reason, _payment_dup_reason, _norm_inv_num, _days_between


# --- parse_amount (T10-01.4 / T10-07.6) -------------------------------------
@pytest.mark.parametrize("raw,expected", [
    (1000, 1000.0),
    (2500.5, 2500.5),
    ("", 0.0),
    ("   ", 0.0),
    ("1000", 1000.0),
    ("Rs 1,20,000", 120000.0),
    ("₹1,20,000", 120000.0),
    ("2.5 lakh", 250000.0),
    ("₹2.5 lakh", 250000.0),
    ("5 cr", 50000000.0),
    ("5 crore", 50000000.0),
    ("999 crore", 9990000000.0),   # no overflow guard
    ("INR 45000", 45000.0),
    ("abc", 0.0),                  # non-numeric -> 0, never raises
])
def test_parse_amount_matrix(raw, expected):
    assert parse_amount(raw) == expected


def test_parse_amount_accepts_negatives():
    """BUG-WATCH (T10-07): negative money is accepted (regex is -?\\d+), so a
    '-500' invoice/expense flows unclamped into outstanding/net_profit."""
    assert parse_amount("-500") == -500.0
    assert parse_amount("Rs -1,000") == -1000.0


def test_parse_amount_first_scale_word_wins():
    """A single scale word multiplies the first number found."""
    assert parse_amount("2 lakh 50 thousand") == 200000.0  # 'thousand' not a scale word here


# --- _remaining / settle (T10-01.5 / T10-07.10) -----------------------------
def test_remaining_basic():
    assert _remaining({"amount": 1000, "amount_paid": 300}) == 700.0


def test_remaining_fully_paid_is_zero():
    assert _remaining({"amount": 1000, "amount_paid": 1000}) == 0.0


def test_remaining_overpaid_goes_negative():
    """BUG-WATCH: overpayment yields a NEGATIVE remaining (no floor), which
    then feeds contact-outstanding + revenue-outstanding sums."""
    assert _remaining({"amount": 1000, "amount_paid": 1200}) == -200.0


def test_remaining_parses_string_amounts():
    """_remaining runs both sides through parse_amount, so lakh/comma strings
    on a record still compute."""
    assert _remaining({"amount": "1 lakh", "amount_paid": "40,000"}) == 60000.0


def test_remaining_missing_fields_default_zero():
    assert _remaining({}) == 0.0
    assert _remaining({"amount": 500}) == 500.0


# --- _norm_num (T10-01.5) ---------------------------------------------------
@pytest.mark.parametrize("a,b", [
    ("INV-001", "inv 001"), ("INV/001", "inv001"), ("Inv_001", "INV001"),
])
def test_norm_num_collapses_separators(a, b):
    assert _norm_num(a) == _norm_num(b)


# --- duplicate detection (T10-01.6 / T10-07.7 / T10-07.8) -------------------
def _inv(number=None, contact=None, amount=None, date=None):
    return {"number": number, "contact_name": contact, "amount": amount, "date": date}


def test_dup_same_number_same_contact_is_number():
    a = _inv("INV-001", "Kapoor Retail", 5000, "2026-08-01")
    b = _inv("inv001", "kapoor retail", 9999, "2026-01-01")
    assert _dup_reason(a, b) == "number"


def test_dup_same_number_unknown_contact_still_flags():
    """Cross-vendor number reuse with an unknown contact on one side is
    accepted as a (weaker) 'number' match."""
    a = _inv("INV-001", "", 5000, "2026-08-01")
    b = _inv("inv001", "Kapoor Retail", 5000, "2026-08-01")
    assert _dup_reason(a, b) == "number"


def test_dup_same_number_different_contact_is_None():
    a = _inv("INV-001", "Vendor A", 5000, "2026-08-01")
    b = _inv("INV-001", "Vendor B", 5000, "2026-08-01")
    assert _dup_reason(a, b) is None


def test_dup_amount_window_same_contact_within_7_days():
    a = _inv(None, "Kapoor Retail", 5000, "2026-08-08")
    b = _inv(None, "Kapoor Retail", 5000, "2026-08-01")   # gap 7
    assert _dup_reason(a, b) == "amount_window"


def test_dup_amount_window_boundary_gap_exactly_7_vs_8():
    base = _inv(None, "Kapoor Retail", 5000, "2026-08-01")
    within = _inv(None, "Kapoor Retail", 5000, "2026-08-08")   # gap 7 -> dup
    outside = _inv(None, "Kapoor Retail", 5000, "2026-08-09")  # gap 8 -> not
    assert _dup_reason(within, base) == "amount_window"
    assert _dup_reason(outside, base) is None


def test_dup_unparseable_date_is_treated_as_dup():
    """BUG-WATCH (T10-07.8): when the date gap can't be computed (None), the
    amount-window rule still fires -> a same-amount same-vendor bill with a
    garbage date is flagged duplicate regardless of how far apart."""
    a = _inv(None, "Kapoor Retail", 5000, "not-a-date")
    b = _inv(None, "Kapoor Retail", 5000, "2020-01-01")
    assert _dup_reason(a, b) == "amount_window"


def test_dup_float_tolerance_now_catches_rounding(a=None):
    """FIXED (T10-07.7): dup now compares amounts with a 1-paisa tolerance
    (abs(a-b) < 0.01) instead of exact ==, so float-rounding artifacts like
    0.1+0.2 vs 0.3 are correctly caught as the same money."""
    incoming = _inv(None, "Kapoor Retail", 0.1 + 0.2, "2026-08-01")
    onfile = _inv(None, "Kapoor Retail", 0.3, "2026-08-01")
    assert _dup_reason(incoming, onfile) == "amount_window"


def test_dup_tolerance_does_not_over_match(a=None):
    """The tolerance is tight (1 paisa): genuinely different amounts (5000 vs
    5001) are NOT collapsed into a duplicate."""
    incoming = _inv(None, "Kapoor Retail", 5001, "2026-08-01")
    onfile = _inv(None, "Kapoor Retail", 5000, "2026-08-01")
    assert _dup_reason(incoming, onfile) is None


def test_days_between_none_on_bad_date():
    assert _days_between("2026-08-08", "2026-08-01") == 7
    assert _days_between("garbage", "2026-08-01") is None


# --- payment duplicate detection (T10-01.7) ---------------------------------
def _pay(reference=None, invoice_number=None, amount=None, contact=None, date=None):
    return {"reference": reference, "invoice_number": invoice_number,
            "amount": amount, "contact_name": contact, "date": date}


def test_payment_dup_reference_is_strongest():
    """A matching transaction reference (UTR/cheque/txn id) -> 'reference',
    regardless of amount/party (a reference is globally unique)."""
    a = _pay(reference="UTR-12345", amount=100, contact="X")
    b = _pay(reference="utr 12345", amount=999, contact="Y")
    assert _payment_dup_reason(a, b) == "reference"


def test_payment_dup_invoice_amount():
    a = _pay(invoice_number="INV-1", amount=5000, contact="Kapoor")
    b = _pay(invoice_number="inv1", amount=5000, contact="Kapoor")
    assert _payment_dup_reason(a, b) == "invoice_amount"


def test_payment_dup_amount_window_same_party():
    a = _pay(amount=5000, contact="Kapoor Retail", date="2026-08-08")
    b = _pay(amount=5000, contact="Kapoor Retail", date="2026-08-01")  # gap 7
    assert _payment_dup_reason(a, b) == "amount_window"


def test_payment_dup_different_party_not_dup():
    a = _pay(amount=5000, contact="Vendor A", date="2026-08-01")
    b = _pay(amount=5000, contact="Vendor B", date="2026-08-01")
    assert _payment_dup_reason(a, b) is None


def test_payment_dup_no_signal_is_none():
    """No reference, no invoice#, different party -> not a duplicate."""
    a = _pay(amount=5000, contact="", date="2026-08-01")
    b = _pay(amount=5000, contact="", date="2026-08-01")
    assert _payment_dup_reason(a, b) is None

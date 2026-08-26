"""Epic 3 Sprint 6 (E3-06.2): duplicate-invoice detection hardening.

Unit tests for the pure decision core (_dup_reason) -- the DB fetch is separated out
(_candidate_invoices) so the money-critical logic is exhaustively testable offline.
A duplicate = the same bill filed twice (double-entry). The two false-positive traps
these guard against: per-vendor invoice-number reuse, and recurring identical bills.
"""
from services.ingestion import (
    _dup_reason, _payment_dup_reason, _norm_inv_num, _days_between, INVOICE_DUP_WINDOW_DAYS,
)


def _inv(number="", contact="", amount=0, date=""):
    return {"number": number, "contact_name": contact, "amount": amount, "date": date}


# --- number rule ------------------------------------------------------------
def test_same_number_same_vendor_is_duplicate():
    a = _inv("INV-001", "Gupta Traders", 1000, "2026-08-01")
    b = _inv("INV-001", "Gupta Traders", 1000, "2026-08-01")
    assert _dup_reason(a, b) == "number"


def test_same_number_different_vendor_is_NOT_duplicate():
    # invoice numbers are unique only per issuer -- vendor B's INV-001 must not
    # collide with vendor A's. This is the core false-positive fix.
    a = _inv("INV-001", "Gupta Traders", 1000, "2026-08-01")
    b = _inv("INV-001", "Sharma Supplies", 5000, "2026-07-15")
    assert _dup_reason(a, b) is None


def test_number_format_variants_still_match():
    a = _inv("INV-001", "Gupta Traders", 1000, "2026-08-01")
    for variant in ("INV 001", "inv/001", "inv001", "INV_001", "  inv-001 "):
        b = _inv(variant, "Gupta Traders", 1000, "2026-08-01")
        assert _dup_reason(a, b) == "number", variant


def test_number_match_with_unknown_contact_still_flags():
    # can't scope to a vendor -> accept the weaker number-only match (routes to review)
    a = _inv("INV-001", "", 1000, "2026-08-01")
    b = _inv("INV-001", "Gupta Traders", 1000, "2026-08-01")
    assert _dup_reason(a, b) == "number"


# --- amount + vendor + window rule -----------------------------------------
def test_same_amount_vendor_same_date_is_duplicate():
    a = _inv("", "Landlord LLC", 50000, "2026-08-01")
    b = _inv("", "Landlord LLC", 50000, "2026-08-01")
    assert _dup_reason(a, b) == "amount_window"


def test_recurring_identical_bill_is_NOT_duplicate():
    # monthly rent, same amount + vendor, ~30 days apart -> legitimate, not a dup.
    a = _inv("", "Landlord LLC", 50000, "2026-09-01")
    b = _inv("", "Landlord LLC", 50000, "2026-08-01")
    assert _dup_reason(a, b) is None


def test_reupload_within_window_is_duplicate():
    a = _inv("", "Landlord LLC", 50000, "2026-08-06")
    b = _inv("", "Landlord LLC", 50000, "2026-08-01")  # 5 days -> within default 7
    assert _dup_reason(a, b) == "amount_window"


def test_same_amount_different_vendor_is_NOT_duplicate():
    a = _inv("", "Vendor A", 50000, "2026-08-01")
    b = _inv("", "Vendor B", 50000, "2026-08-01")
    assert _dup_reason(a, b) is None


def test_missing_dates_flag_conservatively():
    # no date to compare -> flag for review rather than miss a double-entry.
    a = _inv("", "Landlord LLC", 50000, "")
    b = _inv("", "Landlord LLC", 50000, "")
    assert _dup_reason(a, b) == "amount_window"


def test_no_number_no_amount_is_not_duplicate():
    assert _dup_reason(_inv(contact="X"), _inv(contact="X")) is None


def test_amount_mismatch_not_duplicate():
    a = _inv("", "Landlord LLC", 50000, "2026-08-01")
    b = _inv("", "Landlord LLC", 49999, "2026-08-01")
    assert _dup_reason(a, b) is None


# --- payment duplicates (E3-06.5) -------------------------------------------
def _pay(reference="", contact="", amount=0, date="", invoice_number=""):
    return {"reference": reference, "contact_name": contact, "amount": amount,
            "date": date, "invoice_number": invoice_number}


def test_same_reference_is_duplicate_payment():
    a = _pay(reference="UTR-12345", contact="Vendor A", amount=1000, date="2026-08-01")
    b = _pay(reference="utr12345", contact="Vendor A", amount=1000, date="2026-08-01")  # normalized match
    assert _payment_dup_reason(a, b) == "reference"


def test_same_invoice_same_amount_is_duplicate_payment():
    a = _pay(contact="Vendor A", amount=5000, date="2026-08-01", invoice_number="INV-9")
    b = _pay(contact="Vendor A", amount=5000, date="2026-07-01", invoice_number="INV 9")
    assert _payment_dup_reason(a, b) == "invoice_amount"


def test_amount_party_window_is_duplicate_payment():
    a = _pay(contact="Vendor A", amount=5000, date="2026-08-03")
    b = _pay(contact="Vendor A", amount=5000, date="2026-08-01")  # 2 days
    assert _payment_dup_reason(a, b) == "amount_window"


def test_recurring_emi_is_NOT_duplicate_payment():
    # same amount + party, ~30 days apart -> a recurring EMI/subscription, not a dup.
    a = _pay(contact="Bank EMI", amount=15000, date="2026-09-01")
    b = _pay(contact="Bank EMI", amount=15000, date="2026-08-01")
    assert _payment_dup_reason(a, b) is None


def test_same_amount_different_party_not_duplicate_payment():
    a = _pay(contact="Vendor A", amount=5000, date="2026-08-01")
    b = _pay(contact="Vendor B", amount=5000, date="2026-08-01")
    assert _payment_dup_reason(a, b) is None


def test_payment_no_signals_not_duplicate():
    assert _payment_dup_reason(_pay(amount=100), _pay(amount=100)) is None


# --- helpers ----------------------------------------------------------------
def test_norm_inv_num():
    assert _norm_inv_num("INV-001") == "inv001"
    assert _norm_inv_num("  inv / 001 ") == "inv001"
    assert _norm_inv_num(None) == ""
    assert _norm_inv_num(123) == "123"


def test_days_between():
    assert _days_between("2026-08-01", "2026-08-08") == 7
    assert _days_between("2026-08-08", "2026-08-01") == 7  # absolute
    assert _days_between("", "2026-08-01") is None
    assert _days_between("not-a-date", "2026-08-01") is None


def test_window_is_sane():
    assert 0 < INVOICE_DUP_WINDOW_DAYS <= 31

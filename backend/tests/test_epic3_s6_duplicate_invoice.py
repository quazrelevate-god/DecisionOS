"""Epic 3 Sprint 6 (E3-06.2): duplicate-invoice detection hardening.

Unit tests for the pure decision core (_dup_reason) -- the DB fetch is separated out
(_candidate_invoices) so the money-critical logic is exhaustively testable offline.
A duplicate = the same bill filed twice (double-entry). The two false-positive traps
these guard against: per-vendor invoice-number reuse, and recurring identical bills.
"""
from services.ingestion import _dup_reason, _norm_inv_num, _days_between, INVOICE_DUP_WINDOW_DAYS


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

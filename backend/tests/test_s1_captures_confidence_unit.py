"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 7 (edge cases).

Pure unit tests over the capture-routing decision + the confidence calibration
that feeds it. No DB, no server. Covers T10-01.8/.9 and T10-07.12.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services.captures import (
    _needs_owner_review, _decide_processing_level,
    CAPTURE_THRESHOLD, AUTO_CONFIDENCE, ATTENTION_CONFIDENCE,
)
from services.ai.validation import (
    calibrate_confidence, calibrate_doc_confidence, REVIEW_CONFIDENCE,
)


# --- _needs_owner_review (T10-01.8 / T10-07.12) -----------------------------
def test_needs_owner_policy_flag():
    assert _needs_owner_review("purchase", 100, policy=True) is True


def test_needs_owner_approval_or_decision_class():
    assert _needs_owner_review("approval", 10, policy=False) is True
    assert _needs_owner_review("decision", 10, policy=False) is True


def test_needs_owner_amount_at_threshold_is_inclusive():
    """amount >= threshold (50000) -> owner review. The boundary is inclusive."""
    assert _needs_owner_review("purchase", CAPTURE_THRESHOLD, policy=False) is True
    assert _needs_owner_review("purchase", CAPTURE_THRESHOLD - 1, policy=False) is False


def test_needs_owner_none_amount_is_safe():
    assert _needs_owner_review("purchase", None, policy=False) is False


# --- _decide_processing_level priority order (T10-01.8) ----------------------
def test_duplicate_wins_first():
    lvl, _ = _decide_processing_level("purchase", 0.99, 100, needs_owner=False,
                                      is_duplicate=True, has_records=True, is_document=True)
    assert lvl == "attention"


def test_unknown_purchase_forces_attention():
    lvl, _ = _decide_processing_level("purchase", 0.99, 100, needs_owner=False,
                                      is_duplicate=False, has_records=True, is_document=True,
                                      has_unknown_purchase=True)
    assert lvl == "attention"


def test_low_confidence_forces_attention():
    lvl, _ = _decide_processing_level("purchase", ATTENTION_CONFIDENCE - 0.01, 100,
                                      needs_owner=False, is_duplicate=False,
                                      has_records=True, is_document=True)
    assert lvl == "attention"


def test_confidence_exactly_060_not_attention():
    """< 0.60 is attention; exactly 0.60 is not."""
    lvl, _ = _decide_processing_level("purchase", ATTENTION_CONFIDENCE, 100,
                                      needs_owner=False, is_duplicate=False,
                                      has_records=True, is_document=True)
    assert lvl != "attention"


def test_document_without_records_is_attention():
    lvl, _ = _decide_processing_level("purchase", 0.99, 100, needs_owner=False,
                                      is_duplicate=False, has_records=False, is_document=True)
    assert lvl == "attention"


def test_needs_owner_routes_to_confirm():
    lvl, _ = _decide_processing_level("purchase", 0.99, 100, needs_owner=True,
                                      is_duplicate=False, has_records=True, is_document=True)
    assert lvl == "confirm"


def test_auto_file_happy_path():
    """A clean, high-confidence, low-value purchase DOCUMENT auto-files."""
    lvl, _ = _decide_processing_level("purchase", AUTO_CONFIDENCE, 1000, needs_owner=False,
                                      is_duplicate=False, has_records=True, is_document=True)
    assert lvl == "auto"


def test_amount_exactly_50000_never_auto_files():
    """BUG-WATCH (T10-07.12): auto requires 0 < amount < 50000 (strict), so
    exactly 50000 falls through to confirm even when clean + high-confidence."""
    lvl, _ = _decide_processing_level("purchase", 0.99, CAPTURE_THRESHOLD, needs_owner=False,
                                      is_duplicate=False, has_records=True, is_document=True)
    assert lvl == "confirm"


def test_text_voice_can_never_auto_file():
    """BUG-WATCH (T10-07.12): auto requires is_document=True. Text/voice
    captures (is_document=False) can NEVER auto-file, even clean + low-value."""
    lvl, _ = _decide_processing_level("purchase", 0.99, 1000, needs_owner=False,
                                      is_duplicate=False, has_records=True, is_document=False)
    assert lvl == "confirm"


def test_non_purchase_sales_class_not_auto():
    """Only purchase/sales classes are auto-file eligible."""
    lvl, _ = _decide_processing_level("hr", 0.99, 1000, needs_owner=False,
                                      is_duplicate=False, has_records=True, is_document=True)
    assert lvl == "confirm"


# --- calibrate_confidence (T10-01.9) ----------------------------------------
def _extracted(summary="a valid summary here", **buckets):
    d = {"summary": summary}
    d.update(buckets)
    return d


def test_confidence_clean_extraction_unchanged():
    c, reasons, needs = calibrate_confidence(
        _extracted(tasks=[{"x": 1}]), raw=0.9, repaired=False,
        violations_remaining=0, transcript="do the thing")
    assert c == 0.9 and reasons == [] and needs is False


def test_confidence_repaired_penalty():
    c, _, _ = calibrate_confidence(_extracted(tasks=[{"x": 1}]), raw=0.9, repaired=True,
                                   violations_remaining=0, transcript="x")
    assert c == round(0.9 * 0.75, 2)


def test_confidence_violations_penalty_forces_review():
    c, _, needs = calibrate_confidence(_extracted(tasks=[{"x": 1}]), raw=0.9, repaired=False,
                                       violations_remaining=2, transcript="x")
    assert c == round(0.9 * 0.55, 2)
    assert needs is True  # violations always force review


def test_confidence_nothing_actionable_penalty():
    c, _, _ = calibrate_confidence(_extracted(), raw=0.8, repaired=False,
                                   violations_remaining=0, transcript="a real directive")
    # nothing-actionable x0.5, and short-summary? 'a valid summary here' >= 8 -> no
    assert c == round(0.8 * 0.5, 2)


def test_confidence_raw_out_of_range_defaults_070():
    c, _, _ = calibrate_confidence(_extracted(tasks=[{"x": 1}]), raw=5, repaired=False,
                                   violations_remaining=0, transcript="x")
    assert c == 0.7


def test_confidence_needs_review_below_threshold():
    c, _, needs = calibrate_confidence(_extracted(summary="hi"), raw=0.5, repaired=False,
                                       violations_remaining=0, transcript="")
    assert needs is (c < REVIEW_CONFIDENCE)


# --- calibrate_doc_confidence (T10-01.9) ------------------------------------
def test_doc_confidence_clean():
    c, reasons, needs = calibrate_doc_confidence(
        {"invoices": [{"x": 1}]}, raw=0.9, parse_ok=True, doc_type="invoice")
    assert c == 0.9 and needs is False


def test_doc_confidence_parse_fail_penalty_and_review():
    c, _, needs = calibrate_doc_confidence({"invoices": [{"x": 1}]}, raw=0.9,
                                           parse_ok=False, doc_type="invoice")
    assert c == round(0.9 * 0.4, 2)
    assert needs is True  # parse-fail always needs review


def test_doc_confidence_no_records_penalty():
    c, _, _ = calibrate_doc_confidence({}, raw=0.9, parse_ok=True, doc_type="invoice")
    assert c == round(0.9 * 0.5, 2)


def test_doc_confidence_unknown_type_penalty():
    c, _, _ = calibrate_doc_confidence({"invoices": [{"x": 1}]}, raw=0.9,
                                       parse_ok=True, doc_type="unknown")
    assert c == round(0.9 * 0.85, 2)

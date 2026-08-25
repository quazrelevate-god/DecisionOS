"""Epic 3 Sprint 2 (E3-02.1): ai_extract output-schema validation + coercion.

Unit tests for the pure validator/coercer. The end-to-end validate-then-repair
loop inside ai_extract is exercised by the golden-set eval cases
(extraction.extract::auto_repair_recovers / auto_repair_exhausted_coerces), which
run green in CI via test_epic3_s1_evals.py.
"""
from services.ai.validation import (
    validate_extract, coerce_extract, repair_instruction, calibrate_confidence,
    calibrate_doc_confidence, REVIEW_CONFIDENCE,
)


_GOOD = {
    "summary": "Chase the overdue invoice and plan dispatch.",
    "confidence": 0.9,
    "decisions": [{"title": "Chase invoice", "type": "directive"}],
    "tasks": [{"title": "Call Priya", "assignee_role": "finance", "priority": "high", "due_in_days": 2}],
    "workflow_events": [], "reminders": [], "meeting_events": [], "memory_notes": [],
}


# --- validate_extract -------------------------------------------------------
def test_valid_output_has_no_violations():
    assert validate_extract(_GOOD) == []


def test_non_object_is_a_violation():
    assert validate_extract("not json") == ["top-level output is not a JSON object"]


def test_missing_summary_flagged():
    d = dict(_GOOD); d.pop("summary")
    assert any("summary" in v for v in validate_extract(d))


def test_task_missing_required_field_flagged():
    d = {"summary": "x", "tasks": [{"assignee_role": "sales"}]}  # no title
    viol = validate_extract(d)
    assert any("tasks[0]" in v and "title" in v for v in viol)


def test_bad_enum_flagged():
    d = {"summary": "x", "tasks": [{"title": "t", "assignee_role": "sales", "priority": "urgent"}]}
    assert any("priority" in v for v in validate_extract(d))


def test_bad_decision_type_flagged():
    d = {"summary": "x", "decisions": [{"title": "t", "type": "rambling"}]}
    assert any("type" in v for v in validate_extract(d))


def test_non_list_bucket_flagged():
    d = {"summary": "x", "tasks": {"title": "t"}}  # dict, not list
    assert any("'tasks' must be a list" in v for v in validate_extract(d))


def test_confidence_out_of_range_flagged():
    d = {"summary": "x", "confidence": 5}
    assert any("confidence" in v for v in validate_extract(d))


def test_absent_buckets_are_not_violations():
    # a minimal valid output: just a summary, nothing to extract
    assert validate_extract({"summary": "nothing actionable"}) == []


def test_violations_are_bounded():
    d = {"summary": "x", "tasks": [{"assignee_role": "sales"} for _ in range(50)]}
    assert len(validate_extract(d)) <= 12


# --- coerce_extract ---------------------------------------------------------
def test_coerce_guarantees_all_buckets():
    out = coerce_extract({"summary": "s"})
    for k in ("decisions", "tasks", "workflow_events", "reminders", "meeting_events", "memory_notes"):
        assert isinstance(out[k], list)
    assert out["summary"] == "s"
    assert out["confidence"] == 0.8


def test_coerce_fills_summary_from_transcript():
    out = coerce_extract({"summary": ""}, transcript="raw directive text")
    assert out["summary"] == "raw directive text"


def test_coerce_drops_non_dict_items():
    out = coerce_extract({"summary": "s", "tasks": ["oops", {"title": "keep", "assignee_role": "ops"}]})
    assert len(out["tasks"]) == 1 and out["tasks"][0]["title"] == "keep"


def test_coerce_clamps_bad_enums():
    out = coerce_extract({"summary": "s",
                          "tasks": [{"title": "t", "assignee_role": "sales", "priority": "urgent"}],
                          "decisions": [{"title": "d", "type": "rambling"}]})
    assert out["tasks"][0]["priority"] == "medium"
    assert out["decisions"][0]["type"] == "directive"


def test_coerce_preserves_valid_confidence():
    assert coerce_extract({"summary": "s", "confidence": 0.42})["confidence"] == 0.42


def test_coerce_never_raises_on_junk():
    for junk in (None, [], "str", 5, {"tasks": None}):
        out = coerce_extract(junk)
        assert isinstance(out, dict) and isinstance(out["tasks"], list)


# --- calibrate_doc_confidence (E3-06.6) -------------------------------------
def test_doc_clean_extraction_not_flagged():
    cal, reasons, needs = calibrate_doc_confidence(
        {"invoices": [{"amount": 100}]}, raw=0.9, parse_ok=True, doc_type="sales_invoice")
    assert cal == 0.9 and reasons == [] and needs is False


def test_doc_parse_fail_flagged():
    cal, reasons, needs = calibrate_doc_confidence({}, raw=0.9, parse_ok=False, doc_type="other")
    assert needs is True and cal < 0.9 and any("parse" in r for r in reasons)


def test_doc_no_records_flagged():
    cal, reasons, needs = calibrate_doc_confidence({}, raw=0.9, parse_ok=True, doc_type="invoice")
    assert cal < 0.9 and any("no structured records" in r for r in reasons)


def test_doc_confidence_in_range():
    cal, _, _ = calibrate_doc_confidence({}, raw="bad", parse_ok=False, doc_type="")
    assert 0.0 <= cal <= 1.0


# --- repair_instruction -----------------------------------------------------
def test_repair_instruction_lists_violations():
    msg = repair_instruction(["tasks[0]: missing 'title'", "missing 'summary'"])
    assert "tasks[0]: missing 'title'" in msg and "ONLY the JSON" in msg


# --- calibrate_confidence (E3-02.2) -----------------------------------------
_CLEAN = {"summary": "Chase the overdue invoice from Sharma Textiles.",
          "tasks": [{"title": "Call Priya", "assignee_role": "finance"}]}


def test_clean_extraction_keeps_confidence_and_no_review():
    cal, reasons, needs = calibrate_confidence(_CLEAN, raw=0.9, repaired=False,
                                               violations_remaining=0, transcript="chase invoice")
    assert cal == 0.9 and reasons == [] and needs is False


def test_repair_lowers_confidence_with_reason():
    cal, reasons, needs = calibrate_confidence(_CLEAN, raw=0.9, repaired=True,
                                               violations_remaining=0, transcript="chase invoice")
    assert cal < 0.9 and any("repair" in r for r in reasons)


def test_residual_violations_force_review():
    cal, reasons, needs = calibrate_confidence(_CLEAN, raw=0.9, repaired=True,
                                               violations_remaining=2, transcript="chase invoice")
    assert needs is True and any("schema issue" in r for r in reasons)


def test_nothing_extracted_from_real_directive_is_low():
    empty = {"summary": "ok", "tasks": [], "decisions": [], "reminders": [],
             "meeting_events": [], "workflow_events": []}
    cal, reasons, needs = calibrate_confidence(empty, raw=0.9, repaired=False,
                                               violations_remaining=0, transcript="please handle the Kumar order today")
    assert cal < 0.9 and any("nothing actionable" in r for r in reasons)


def test_calibrated_confidence_stays_in_range():
    cal, _, _ = calibrate_confidence({"summary": ""}, raw=1.0, repaired=True,
                                     violations_remaining=5, transcript="x")
    assert 0.0 <= cal <= 1.0


def test_bad_raw_confidence_defaults():
    cal, _, _ = calibrate_confidence(_CLEAN, raw="high", repaired=False,
                                     violations_remaining=0, transcript="chase invoice")
    assert 0.0 <= cal <= 1.0  # non-numeric raw -> safe default, never crashes


def test_review_threshold_is_sane():
    assert 0.0 < REVIEW_CONFIDENCE < 1.0

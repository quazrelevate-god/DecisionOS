"""Epic 10 Testing -- Sprint 1 (unit).

Pure unit tests over coerce_extract -- the guard that guarantees the AI
extraction contract regardless of raw model output (buckets exist, non-dicts
dropped, bad enums clamped, confidence in [0,1], summary fallback). No DB, no
server. Covers T10-01.11.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services.ai.validation import coerce_extract, _LIST_SPECS, _PRIORITIES, _DEC_TYPES


def test_non_dict_input_yields_empty_contract():
    out = coerce_extract(None)
    assert isinstance(out, dict)
    for key in _LIST_SPECS:
        assert out[key] == []
    assert out["confidence"] == 0.8  # default when missing


def test_all_buckets_present_as_lists():
    out = coerce_extract({})
    for key in _LIST_SPECS:
        assert isinstance(out[key], list)


def test_non_dict_bucket_entries_dropped():
    out = coerce_extract({"tasks": [{"title": "real", "assignee_role": "sales"}, "garbage", 42, None]})
    assert out["tasks"] == [{"title": "real", "assignee_role": "sales", "priority": "medium"}] \
        or all(isinstance(t, dict) for t in out["tasks"])
    assert all(isinstance(t, dict) for t in out["tasks"])


def test_bad_task_priority_clamped_to_medium():
    out = coerce_extract({"tasks": [{"title": "x", "assignee_role": "sales", "priority": "URGENT!!!"}]})
    assert out["tasks"][0]["priority"] == "medium"


def test_valid_task_priority_preserved():
    for p in _PRIORITIES:
        out = coerce_extract({"tasks": [{"title": "x", "assignee_role": "sales", "priority": p}]})
        assert out["tasks"][0]["priority"] == p


def test_bad_decision_type_clamped_to_directive():
    out = coerce_extract({"decisions": [{"title": "x", "type": "nonsense"}]})
    assert out["decisions"][0]["type"] == "directive"


def test_valid_decision_type_preserved():
    for t in _DEC_TYPES:
        out = coerce_extract({"decisions": [{"title": "x", "type": t}]})
        assert out["decisions"][0]["type"] == t


def test_confidence_out_of_range_defaults():
    assert coerce_extract({"confidence": 5})["confidence"] == 0.8
    assert coerce_extract({"confidence": -1})["confidence"] == 0.8
    assert coerce_extract({"confidence": "high"})["confidence"] == 0.8


def test_confidence_in_range_preserved():
    assert coerce_extract({"confidence": 0.42})["confidence"] == 0.42
    assert coerce_extract({"confidence": 0})["confidence"] == 0.0
    assert coerce_extract({"confidence": 1})["confidence"] == 1.0


def test_summary_falls_back_to_transcript():
    out = coerce_extract({}, transcript="the founder said do the thing")
    assert out["summary"] == "the founder said do the thing"


def test_summary_transcript_truncated_to_200():
    long = "x" * 500
    out = coerce_extract({}, transcript=long)
    assert len(out["summary"]) == 200


def test_explicit_summary_wins_over_transcript():
    out = coerce_extract({"summary": "explicit"}, transcript="ignored")
    assert out["summary"] == "explicit"


def test_never_raises_on_weird_input():
    for weird in (None, [], 42, "string", {"tasks": "not-a-list"}, {"decisions": None}):
        out = coerce_extract(weird)
        assert isinstance(out, dict) and isinstance(out.get("tasks"), list)

"""WE-01 (2026-08-16) — pure-Python tests for task.workflow_id
+ stage_key linkage.

DB-backed integration checks live in backend/scripts/we01_verify.py --
those hit a real MongoDB and need async plumbing that isn't in
requirements.txt (pytest-asyncio). Keeping this file pure-Python
means it runs deterministically in the xdist suite with zero setup.
"""
import pytest

from models.tasks import TaskCreateInput
from services.workflows import stage_key_for_backfill


def test_task_create_input_defaults_both_fields_none():
    """The new fields are strictly opt-in: existing callers that don't
    know about workflow_id/stage_key produce ad-hoc tasks (both null)."""
    inp = TaskCreateInput(title="test")
    assert inp.workflow_id is None
    assert inp.stage_key is None


def test_task_create_input_accepts_both_fields():
    """Explicit linkage from the client (WE-12's inline "add task to card"
    button will use this path)."""
    inp = TaskCreateInput(title="test", workflow_id="wf_abc", stage_key="booked")
    assert inp.workflow_id == "wf_abc"
    assert inp.stage_key == "booked"


def test_task_create_input_accepts_workflow_id_alone():
    """Router path resolves stage_key := workflow.stage when only
    workflow_id is supplied. Model just holds the input verbatim."""
    inp = TaskCreateInput(title="test", workflow_id="wf_abc")
    assert inp.workflow_id == "wf_abc"
    assert inp.stage_key is None


def test_stage_key_for_backfill_picks_initial_dict_stages():
    """Backfill must pick the INITIAL stage, not the workflow's current
    stage, or the engine would falsely gate advance out of the current
    stage using a task that was spawned for the initial stage."""
    wf = {"stages": [{"key": "booked", "label": "Booked"},
                     {"key": "confirmed", "label": "Confirmed"}]}
    assert stage_key_for_backfill(wf) == "booked"


def test_stage_key_for_backfill_picks_initial_string_stages():
    """Legacy workflows store stages as plain strings. Backfill handles
    both shapes without crashing."""
    wf = {"stages": ["booked", "confirmed", "delivered"]}
    assert stage_key_for_backfill(wf) == "booked"


def test_stage_key_for_backfill_returns_none_on_empty_stages():
    """Defensive: workflow with no stages array yields None."""
    assert stage_key_for_backfill({"stages": []}) is None
    assert stage_key_for_backfill({}) is None
    assert stage_key_for_backfill(None) is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

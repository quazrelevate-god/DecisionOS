"""ASK-28 TK-07 (plan Phase 3) — stages and the Waiting on flag.

Pure unit tests over services.tasks — no server, no database. Stored statuses
stay as they are (D6); people see To do / Doing / Done / Cancelled, and
"Waiting on" is a flag that records who or what, and since when.
"""
import pytest

from services.operating_score import _is_open_task
from services.tasks import (
    OPEN_STATUSES,
    STAGE_STATUSES,
    WORKING_STATUSES,
    can_note_task,
    stage_of,
    status_change_clears_waiting,
    waiting_updates,
)

pytestmark = pytest.mark.unit

NOW = "2026-09-15T09:00:00+00:00"


def test_stages_cover_every_stored_status():
    assert [stage_of(s) for s in ("todo", "blocked")] == ["todo", "todo"]
    assert [stage_of(s) for s in ("in_progress", "waiting", "review")] == ["in_progress"] * 3
    assert (stage_of("done"), stage_of("cancelled")) == ("done", "cancelled")
    assert stage_of(None) == "todo"


def test_open_and_working_sets():
    assert set(OPEN_STATUSES) == set(STAGE_STATUSES["todo"]) | set(STAGE_STATUSES["in_progress"])
    assert "blocked" in OPEN_STATUSES and "blocked" not in WORKING_STATUSES
    assert {"waiting", "review"} <= set(WORKING_STATUSES)


def test_operating_score_counts_waiting_and_review_as_open():
    for s in ("todo", "blocked", "in_progress", "waiting", "review"):
        assert _is_open_task({"status": s}), s
    for s in ("done", "cancelled"):
        assert not _is_open_task({"status": s}), s


def test_waiting_on_a_colleague():
    out = waiting_updates({"user_id": "u-fin"}, {"id": "u-fin", "name": "Sunita"}, "u-ops", NOW)
    assert out == {"status": "waiting", "waiting_on": {"user_id": "u-fin", "name": "Sunita", "since": NOW, "set_by": "u-ops"}}


def test_waiting_on_a_name():
    out = waiting_updates({"name": "  Kumar Fabrics (supplier) "}, None, "u-ops", NOW)
    assert out["status"] == "waiting"
    assert out["waiting_on"] == {"user_id": None, "name": "Kumar Fabrics (supplier)", "since": NOW, "set_by": "u-ops"}


def test_waiting_name_is_capped():
    assert len(waiting_updates({"name": "x" * 200}, None, "u", NOW)["waiting_on"]["name"]) == 80


def test_waiting_needs_someone():
    with pytest.raises(ValueError):
        waiting_updates({"name": "   "}, None, "u", NOW)
    with pytest.raises(ValueError):
        waiting_updates({"user_id": "u-outsider"}, None, "u", NOW)


def test_stop_waiting_goes_back_to_doing():
    assert waiting_updates({}, None, "u", NOW) == {"status": "in_progress", "waiting_on": None}
    assert waiting_updates(None, None, "u", NOW) == {"status": "in_progress", "waiting_on": None}


def test_moving_a_waiting_task_ends_the_wait():
    t = {"status": "waiting", "waiting_on": {"name": "Kumar Fabrics"}}
    assert status_change_clears_waiting(t, "in_progress") == {"waiting_on": None}
    assert status_change_clears_waiting(t, "todo") == {"waiting_on": None}
    assert status_change_clears_waiting(t, "waiting") == {}
    assert status_change_clears_waiting({"status": "todo"}, "in_progress") == {}


def test_colleague_waited_on_may_note():
    t = {"assignee_id": "u-ops", "assignee_role": "operations", "created_by": "u-owner",
         "waiting_on": {"user_id": "u-fin", "name": "Sunita"}}
    assert can_note_task({"id": "u-fin", "role": "finance"}, t)
    assert not can_note_task({"id": "u-prod", "role": "production"}, t)

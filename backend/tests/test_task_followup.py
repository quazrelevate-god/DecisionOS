"""ASK-28 Phase 7 (plan 7.1–7.3) — stuck work, one rule.

Pure unit tests over services.tasks — no server, no database.
  7.1  the ladder: the people on it, again, the manager (day 2), the owner (day 4)
  7.2  what an overdue task is stuck on: approval, waiting on someone, or work
  7.3  escalating goes to your reporting manager, the owner only without one
"""
import pytest

from services.tasks import (
    FOLLOWUP_MANAGER_DAYS,
    FOLLOWUP_OWNER_DAYS,
    escalation_manager_id,
    followup_level,
    stuck_on,
)

pytestmark = pytest.mark.unit


def test_ladder_reaches_the_manager_before_the_owner():
    assert (FOLLOWUP_MANAGER_DAYS, FOLLOWUP_OWNER_DAYS) == (2, 4)
    assert [followup_level(d) for d in range(0, 7)] == [1, 2, 3, 3, 4, 4, 4]


def test_stuck_on_approval_before_start_or_a_close_request():
    assert stuck_on({"approval_required": True, "status": "blocked", "approval_status": "pending"}) == "approval"
    closing = {"approval_required": True, "approval_stage": "close", "status": "review", "approval_status": "pending"}
    assert stuck_on(closing) == "approval"
    # Approved to start, or changes requested on a close request: back with the doer.
    assert stuck_on({"approval_required": True, "status": "in_progress", "approval_status": "approved"}) == "work"
    assert stuck_on({**closing, "status": "in_progress", "approval_status": "rejected"}) == "work"


def test_stuck_on_waiting_or_work():
    assert stuck_on({"status": "waiting", "waiting_on": {"name": "Kumar Fabrics"}}) == "waiting"
    assert stuck_on({"status": "todo"}) == "work"
    assert stuck_on({"status": "in_progress"}) == "work"


def test_escalate_to_the_reporting_manager_else_the_owner():
    assert escalation_manager_id({"id": "u-ops", "reporting_manager_id": "u-sales"}) == "u-sales"
    assert escalation_manager_id({"id": "u-ops"}) is None
    assert escalation_manager_id({"id": "u-ops", "reporting_manager_id": "u-ops"}) is None
    assert escalation_manager_id(None) is None

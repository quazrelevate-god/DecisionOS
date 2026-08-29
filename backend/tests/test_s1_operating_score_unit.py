"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 7 (formula edge cases).

Pure unit tests over the operating-score calculators. No DB, no server.
Covers T10-01.1/.2/.3 and T10-07.1/.3/.5.

These tests LOCK IN the current formula behavior AND pin the exact spots the
2026-08-29 code map flagged as latent bugs, so any future change to the math
is a conscious, reviewed change. Each `BUG:` marker is behavior that is
surprising/wrong but currently shipped -- surfaced here for a fix decision.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services.operating_score import (
    _clamp100, _is_open_task, _score_execution, _score_sales, _score_employees,
)

NOW = "2026-08-29T00:00:00+00:00"
PAST = "2026-08-01T00:00:00+00:00"   # before NOW -> overdue
FUTURE = "2026-12-01T00:00:00+00:00" # after NOW -> not overdue


# --- _clamp100 (T10-01.1) ---------------------------------------------------
@pytest.mark.parametrize("raw,expected", [
    (-20, 0), (0, 0), (45.4, 45), (45.6, 46), (100, 100), (150, 100), (99.9, 100),
])
def test_clamp100_rounds_and_bounds(raw, expected):
    assert _clamp100(raw) == expected


# --- _score_execution (T10-01.2 / T10-07) -----------------------------------
def test_execution_empty_tasks_defaults_to_70():
    """actionable==0 -> completion default 0.7 -> score 70. The 'new tenant
    looks 70% healthy with zero data' default."""
    score, done, open_tasks, overdue, actionable = _score_execution([], NOW)
    assert (score, done, actionable) == (70, 0, 0)


def test_execution_all_done_is_100():
    tasks = [{"status": "done"}, {"status": "done"}]
    assert _score_execution(tasks, NOW)[0] == 100


def test_execution_half_done_no_overdue_is_50():
    tasks = [{"status": "done"}, {"status": "todo", "due_date": FUTURE}]
    assert _score_execution(tasks, NOW)[0] == 50


def test_execution_overdue_penalty():
    """2 open, 1 overdue -> overdue_ratio 0.5 -> -20. completion 0/2? no:
    done=0, open=2, actionable=2, completion 0 -> 0 - 20 -> clamp 0."""
    tasks = [{"status": "todo", "due_date": PAST}, {"status": "todo", "due_date": FUTURE}]
    score, done, open_tasks, overdue, actionable = _score_execution(tasks, NOW)
    assert overdue == 1 and len(open_tasks) == 2
    assert score == 0  # completion 0*100 - 0.5*40 = -20 -> clamp 0


def test_execution_empty_due_date_is_NOT_overdue():
    """BUG-WATCH (T10-07.2): an empty-string due_date is falsy, so
    `t.get('due_date') and t['due_date'] < now` short-circuits -> NOT overdue.
    finance_signals uses ''[:10] <= cutoff which IS overdue -> the SAME blank
    date is treated two different ways across modules. This locks the
    operating_score side."""
    tasks = [{"status": "todo", "due_date": ""}, {"status": "todo", "due_date": None}]
    score, done, open_tasks, overdue, actionable = _score_execution(tasks, NOW)
    assert overdue == 0, "blank/None due_date must not count as overdue here"


# --- _score_sales (T10-01.2) ------------------------------------------------
def test_sales_no_decisions_defaults_to_70():
    assert _score_sales([])[0] == 70


def test_sales_all_approved_is_100():
    decs = [{"status": "approved"}, {"status": "approved"}]
    assert _score_sales(decs)[0] == 100


def test_sales_half_approved_is_50():
    decs = [{"status": "approved"}, {"status": "pending"}]
    assert _score_sales(decs)[0] == 50


# --- _score_employees (T10-07.3 / T10-07.5) ---------------------------------
def test_employee_zero_tasks_scores_None_not_zero():
    """ASYMMETRY (T10-07.3): company completion defaults to 0.7, but an
    employee with zero actionable tasks scores None (not 0, not 70)."""
    members = [{"id": "u1", "name": "A", "role": "sales"}]
    emps = _score_employees([], members, NOW)
    assert emps[0]["score"] is None


def test_unassigned_role_task_double_counts_across_teammates():
    """BUG (T10-07.5): a task with NO assignee_id but assignee_role='sales'
    is credited to EVERY sales member -- so one shared task inflates N
    employees' 'done' counts. Three sales members, one unassigned done task
    -> all three show done==1."""
    members = [
        {"id": "u1", "name": "A", "role": "sales"},
        {"id": "u2", "name": "B", "role": "sales"},
        {"id": "u3", "name": "C", "role": "sales"},
    ]
    tasks = [{"status": "done", "assignee_id": "", "assignee_role": "sales"}]
    emps = _score_employees(tasks, members, NOW)
    done_counts = sorted(e["done"] for e in emps)
    assert done_counts == [1, 1, 1], (
        "one unassigned role task is counted for all 3 teammates (double-count bug)"
    )


def test_employee_direct_assignment_is_scoped():
    """A directly-assigned task credits only that member."""
    members = [
        {"id": "u1", "name": "A", "role": "sales"},
        {"id": "u2", "name": "B", "role": "sales"},
    ]
    tasks = [{"status": "done", "assignee_id": "u1", "assignee_role": "sales"}]
    emps = {e["id"]: e for e in _score_employees(tasks, members, NOW)}
    assert emps["u1"]["done"] == 1 and emps["u2"]["done"] == 0


def test_employee_sort_none_sorts_last():
    members = [
        {"id": "u1", "name": "A", "role": "sales"},   # no tasks -> None
        {"id": "u2", "name": "B", "role": "sales"},   # done -> 100
    ]
    tasks = [{"status": "done", "assignee_id": "u2", "assignee_role": "sales"}]
    emps = _score_employees(tasks, members, NOW)
    assert emps[0]["id"] == "u2" and emps[-1]["score"] is None


# --- _is_open_task ----------------------------------------------------------
@pytest.mark.parametrize("status,is_open", [
    ("todo", True), ("in_progress", True), ("blocked", True),
    ("done", False), ("cancelled", False), (None, False),
])
def test_is_open_task(status, is_open):
    assert _is_open_task({"status": status}) is is_open

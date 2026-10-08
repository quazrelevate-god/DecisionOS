"""Audit C-13 (2026-10-08): a decision's task is due when the person SAID.

"Rahul to send the revised pro-forma invoice by Friday", said on Thursday
8 Oct, became a task due Monday 12 Oct: the extraction model was never told
what day it was, returned no date, and the order card's stage date filled the
gap. "Arun to confirm the advance before production starts" got no date and
nothing said so.

Now today's date rides with the transcript, the model returns the date itself
("due_on"), a task with no deadline stays undated, and the review flags it.
Checked live against the model on 2026-10-08: Rahul -> 2026-10-09, Arun ->
no date, "Priya ... tomorrow" -> 2026-10-09.
"""
from datetime import datetime, timezone
from pathlib import Path

from prompts import get, render
from services.voice import task_due_date

ROOT = Path(__file__).resolve().parents[1]
# Thursday 8 October 2026, 11:00 India time
THU = datetime(2026, 10, 8, 5, 30, tzinfo=timezone.utc)


def test_the_stated_date_wins():
    assert task_due_date({"due_on": "2026-10-09", "due_in_days": 4}, THU) == "2026-10-09"


def test_the_day_count_is_the_fallback():
    assert task_due_date({"due_on": None, "due_in_days": 1}, THU) == "2026-10-09"
    assert task_due_date({"due_on": "not a date", "due_in_days": 0}, THU) == "2026-10-08"


def test_no_deadline_said_means_no_date():
    assert task_due_date({}, THU) is None
    assert task_due_date({"due_on": None, "due_in_days": None}, THU) is None


def test_impossible_dates_are_not_kept():
    assert task_due_date({"due_on": "2026-10-01"}, THU) is None          # in the past
    assert task_due_date({"due_on": "2031-01-01"}, THU) is None          # years out
    assert task_due_date({"due_in_days": -3}, THU) is None
    assert task_due_date({"due_in_days": True}, THU) is None             # a bool is not a count


def test_the_model_is_told_the_date_and_asked_for_it():
    assert get("extraction.extract").version == "1.3"
    text = render("extraction.extract", roles_str="sales", cat_keys_str="sales", pipe_keys_str="sales_orders",
                  members_line="", pipe_desc="", cat_desc="")
    assert '"due_on": "YYYY-MM-DD" or null' in text
    assert "never invent one" in text
    src = (ROOT / "services" / "ai" / "extraction.py").read_text(encoding="utf-8")
    assert 'prompt = (f"Today is {_today.strftime(\'%A\')}' in src


def test_the_review_flags_a_task_with_no_date():
    s = (ROOT.parent / "frontend" / "src" / "components" / "DecisionDialog.js").read_text(encoding="utf-8")
    assert "No date yet — set one" in s
    assert 'data-testid={`decision-task-no-date-${t.key}`}' in s

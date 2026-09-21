"""'Due today' is a day, not the second it was said (2026-09-21).

Found clicking through the Desk: a decision said "send the acknowledgement
today" and the task landed already OVERDUE, an hour after it was made, because
"in N days" was stored as `now + N days` to the second. See shared/due.py.
"""
from datetime import datetime, timezone

from shared.due import due_day


def test_today_is_the_calendar_day_not_the_instant():
    now = datetime(2026, 9, 21, 6, 56, 49, tzinfo=timezone.utc)
    assert due_day(0, now) == "2026-09-21"
    assert due_day(3, now) == "2026-09-24"


def test_the_day_is_indias_so_2am_ist_is_still_today():
    """20:30 UTC on the 20th is 02:00 IST on the 21st."""
    late = datetime(2026, 9, 20, 20, 30, tzinfo=timezone.utc)
    assert due_day(0, late) == "2026-09-21"


def test_no_number_means_no_date():
    assert due_day(None) is None and due_day("2") is None and due_day(True) is None


def test_no_code_path_stores_an_instant_for_in_n_days_any_more():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    for rel in ["routers/decisions.py", "routers/tasks.py", "services/captures.py",
                "services/ingestion.py", "services/meetings.py", "services/voice.py"]:
        src = (root / rel).read_text(encoding="utf-8")
        assert "due_day(" in src, rel
        assert "due_in_days\"])).isoformat()" not in src and "due_in_days)).isoformat()" not in src, rel

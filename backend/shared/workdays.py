"""Working days — the one calendar the workflow timing counts in (2026-09-22).

Sunday is the day off: the same rule the board's "stuck" count already used
(frontend pages/desk/workflowAttention.js, workingDaysBetween), so a stage's
deadline, the stuck alert and the Desk tile all count the same days. There is
no holiday calendar in the product yet; when one arrives it belongs here.

Days are India's (shared/due.py): at 02:00 IST it is already tomorrow.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from shared.due import IST

DAY_OFF = 6   # Sunday (date.weekday())


def ist_day(value) -> Optional[date]:
    """The IST calendar day of an ISO string / datetime / date, or None."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return dt.astimezone(IST).date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if len(s) <= 10:
        try:
            return date.fromisoformat(s)
        except ValueError:
            return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).date()


def today_ist(now: Optional[datetime] = None) -> date:
    return ist_day(now or datetime.now(timezone.utc))


def add_working_days(start: date, n: int) -> date:
    """`n` working days after `start` (the start day itself does not count).
    Landing on the day off moves forward, never back."""
    d = start
    left = max(0, int(n or 0))
    while left > 0:
        d += timedelta(days=1)
        if d.weekday() != DAY_OFF:
            left -= 1
    while d.weekday() == DAY_OFF:
        d += timedelta(days=1)
    return d


def working_days_between(start: Optional[date], end: Optional[date]) -> int:
    """Working days after `start` up to and including `end` (0 when end <= start)."""
    if not start or not end or end <= start:
        return 0
    n, d = 0, start
    while d < end:
        d += timedelta(days=1)
        if d.weekday() != DAY_OFF:
            n += 1
    return n

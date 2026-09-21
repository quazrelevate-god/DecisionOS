"""'Due in N days' is a DAY, not an instant (2026-09-21).

Found clicking through the Desk: a decision said "Priya to send the order
acknowledgement today", and the task landed in her list already marked
OVERDUE — an hour after it was created, on the day it was due. Seven places
turned "in N days" into `now + N days` as a full timestamp, so "today" meant
"at the second Dex read it", and every task Dex made for today was late the
moment it existed. (The screens already read a bare date as "due by the end of
that day" — ASK-29 fixed that side; this is the data side.)

A relative due date is the company's calendar day, stored bare ("2026-09-21").
The day is India's: the product is India-first, and at 02:00 IST it is still
the previous day in UTC, which would put "today" on yesterday.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

IST = timezone(timedelta(hours=5, minutes=30))


def due_day(days, now: Optional[datetime] = None) -> Optional[str]:
    """`days` from today, as the company's calendar day, or None."""
    if not isinstance(days, int) or isinstance(days, bool):
        return None
    base = (now or datetime.now(timezone.utc)).astimezone(IST)
    return (base + timedelta(days=days)).date().isoformat()

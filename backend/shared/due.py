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


# ---------------------------------------------------------------------------
# PILOT-1 D (2026-09-21): ONE RULE FOR "LATE", everywhere a count is made.
#
# The operating score compared a due date with a UTC TIMESTAMP as strings:
# "2026-09-21" < "2026-09-21T08:55:12+00:00" is true, so every task due TODAY
# was counted overdue all day — in the company score, every person's score,
# the self view and compute_employee_stats. The screens fixed exactly this in
# ASK-29 (MyWork.js isOverdue); the Desk already counted by India's day
# (routers/desk._today_ist). These two helpers are that rule, once:
#   a bare day ("2026-09-21")          late from the NEXT day on, India's calendar
#   a day with an hour ("…T15:00:00")  late once that hour has passed — the hour
#                                      is India's clock, as it is stored
#   an old instant with its own zone   late once that instant has passed
# ---------------------------------------------------------------------------
def today_ist(now: Optional[datetime] = None) -> str:
    """Today on the company's calendar (India), as YYYY-MM-DD."""
    return (now or datetime.now(timezone.utc)).astimezone(IST).date().isoformat()


def as_instant(now) -> datetime:
    """`now` as an aware datetime, whether it came as one or as an ISO string."""
    if isinstance(now, datetime):
        return now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    if isinstance(now, str) and now:
        try:
            dt = datetime.fromisoformat(now.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def is_overdue(due, now=None) -> bool:
    """Is work due at `due` late at `now`? (See the rule above.)"""
    if not due or not isinstance(due, str):
        return False
    at = as_instant(now)
    s = due.strip()
    if len(s) <= 10:
        return s < today_ist(at)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return s[:10] < today_ist(at)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=IST)
    return dt < at


def overdue_query(now=None) -> dict:
    """The same rule as a Mongo filter on `due_date`, for counts made in the
    database: an earlier day, or today with an hour that has passed. (Bare
    "YYYY-MM-DD" sorts before "YYYY-MM-DDT…", which is why the second half
    starts at "T".)"""
    at = as_instant(now).astimezone(IST)
    today = at.date().isoformat()
    clock = at.strftime("%H:%M:%S")
    return {"$or": [
        {"due_date": {"$lt": today, "$nin": [None, ""]}},
        {"due_date": {"$gte": f"{today}T", "$lt": f"{today}T{clock}"}},
    ]}

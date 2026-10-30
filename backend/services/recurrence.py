"""Work that comes back (D1, 2026-09-21).

From the workflow/task audit: DecisionOS had no notion of a repeating task at
all — no field, no route, no sweep. Every GST filing, salary run, stock count
and weekly review had to be typed again from scratch, in a product whose whole
promise is that the operations of a company run themselves. Worse, the fifteen
"recurring tasks Dex will keep on rails" collected during onboarding were
stored on the tenant and read by nothing at all.

THE RULE: the next one appears when the last one is CLOSED, not on a timer.

That is a deliberate choice, and it is the one that suits a 10-15 person
company. A timer that creates Monday's stock count whether or not last
Monday's was done buries the person under a column of identical undone tasks,
and the fact that they are falling behind becomes harder to see, not easier.
Closing one to get the next keeps exactly one live instance of each routine,
and a routine that stops being done shows up as one overdue task that the
escalation ladder then chases — which is the behaviour we already have and
trust. It also means recurrence needs no scheduler, no lock and no catch-up
logic, so there is nothing to go wrong quietly at 3am.

A series is identified by `series_id` (the id of its first task), carried on
every occurrence, so "stop this repeating" and "show me this routine's
history" are both a single query.
"""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta
from typing import Optional

EVERY = ("day", "week", "month")
MAX_INTERVAL = 52


def normalise(every: Optional[str], interval: Optional[int],
              until: Optional[str]) -> Optional[dict]:
    """Validate what a client sent into a stored recurrence, or None.

    Raises ValueError with a sentence meant for the person, not a stack trace.
    """
    if not every:
        return None
    every = str(every).strip().lower()
    if every not in EVERY:
        raise ValueError(f"A task can repeat every {', '.join(EVERY)} — not '{every}'.")
    try:
        n = int(interval) if interval is not None else 1
    except (TypeError, ValueError):
        raise ValueError("How often it repeats has to be a whole number.")
    if not (1 <= n <= MAX_INTERVAL):
        raise ValueError(f"Repeat every 1 to {MAX_INTERVAL} {every}s.")
    stop = (until or "").strip()
    if stop:
        try:
            datetime.strptime(stop, "%Y-%m-%d")
        except ValueError:
            raise ValueError(f"'{stop}' is not a date. Use YYYY-MM-DD, or leave it open.")
    return {"every": every, "interval": n, "until": stop or None}


def next_due(current: str, every: str, interval: int = 1) -> Optional[str]:
    """The due date after this one, keeping the hour if there was one.

    A monthly task keeps its day of the month and is pulled back to the last
    day of a short one: the 31st of January repeats on 28 February, not on
    3 March. That is what "monthly on the 31st" means to the person who typed
    it, and drifting forward would move a month-end routine off month end for
    good.
    """
    if not current:
        return None
    day, _, rest = str(current).partition("T")
    try:
        d = datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        return None
    if every == "day":
        nxt = d + timedelta(days=interval)
    elif every == "week":
        nxt = d + timedelta(weeks=interval)
    elif every == "month":
        month0 = d.month - 1 + interval
        year = d.year + month0 // 12
        month = month0 % 12 + 1
        nxt = d.replace(year=year, month=month,
                        day=min(d.day, calendar.monthrange(year, month)[1]))
    else:
        return None
    out = nxt.strftime("%Y-%m-%d")
    return f"{out}T{rest}" if rest else out


def next_due_not_late(current: str, every: str, interval: int = 1,
                      today: Optional[str] = None) -> Optional[str]:
    """The next occurrence that is not already late (BUG-04, 2026-10-21).

    One live instance per routine (above) means a routine done late is caught
    up by doing it, not by working through every date it missed: a daily task
    closed ten days late brought one due nine days ago, born overdue, then
    another, one close per missed day. The next is the first date of the
    series on or after `today` (YYYY-MM-DD), counted in whole steps from the
    date it was due, so a weekly Monday stays on Mondays and "monthly on the
    31st" on month end.
    """
    nxt = next_due(current, every, interval)
    k = 1
    while nxt and today and str(nxt)[:10] < today and k < 5000:
        k += 1
        nxt = next_due(current, every, interval * k)
    return nxt


def series_is_over(rec: dict, next_date: Optional[str]) -> bool:
    """True when the next occurrence would fall past the series' end date."""
    if not next_date:
        return True
    until = (rec or {}).get("until")
    if not until:
        return False
    return str(next_date)[:10] > str(until)[:10]


def describe(rec: Optional[dict]) -> str:
    """How a cadence reads on screen: "Repeats every 2 weeks"."""
    if not rec or not rec.get("every"):
        return ""
    n = int(rec.get("interval") or 1)
    unit = rec["every"]
    when = f"every {unit}" if n == 1 else f"every {n} {unit}s"
    return f"Repeats {when}"


# ---------------------------------------------------------------------------
# NF-4.22 (2026-10-31) — a cadence said in words. Founder: tasks are mostly made
# from the Decision Desk, and "check the stock every Monday" became a one-off
# task — the Desk had no notion of a repeat at all. The extraction model is
# asked for it now (extraction.extract 1.4), and this reads the task's own words
# as well, because a prompt is a request and the cadence is plainly in the text.
#
# Only a cadence counts. "Call him on Monday" is one Monday; "every Monday",
# "each Monday" and "on Mondays" are a routine. "every customer" is no time unit
# and says nothing.
# ---------------------------------------------------------------------------
import re as _re
from datetime import date as _date

_WEEKDAY_WORDS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3, "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}
_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
              "eight": 8, "nine": 9, "ten": 10, "twelve": 12, "other": 2, "alternate": 2}
_DAY_NAME = r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)"
_N = r"(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|other|alternate)"


def _num(s: str) -> int:
    return int(s) if s.isdigit() else _NUM_WORDS.get(s, 1)


def _next_weekday(today: _date, wd: int) -> _date:
    return today + timedelta(days=(wd - today.weekday()) % 7)


def _next_month_day(today: _date, day: int) -> _date:
    y, m = today.year, today.month
    if today.day > min(day, calendar.monthrange(y, m)[1]):
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return today.replace(year=y, month=m, day=min(day, calendar.monthrange(y, m)[1]))


def from_words(text: Optional[str], today: Optional[_date] = None) -> Optional[dict]:
    """{"every", "interval", "first"} when the words say the work comes back.

    `first` is the first date the cadence names on or after today ("every
    Monday" -> the next Monday, "on the 5th of every month" -> the next 5th), or
    None when the cadence names no particular day ("daily", "every 2 weeks").
    """
    t = " " + " ".join(_re.findall(r"[a-z0-9]+", (text or "").lower())) + " "
    if not t.strip():
        return None
    today = today or _date.today()

    def out(every, n=1, first=None):
        n = max(1, min(int(n), MAX_INTERVAL))
        return {"every": every, "interval": n, "first": first.isoformat() if first else None}

    # A weekday cadence: "every Monday", "each Friday", "on Mondays", "every other Monday".
    m = _re.search(rf" (?:every|each) (?:{_N} )?{_DAY_NAME} ", t) or _re.search(r" (?:on )?(mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays) ", t)
    if m:
        groups = [g for g in m.groups() if g]
        day = groups[-1].rstrip("s") if groups[-1].endswith("days") else groups[-1]
        n = _num(groups[0]) if len(groups) == 2 else 1
        return out("week", n, _next_weekday(today, _WEEKDAY_WORDS[day]))
    # A day of the month: "on the 5th of every month", "5th of each month", "every month on the 20th".
    m = (_re.search(r" (\d{1,2}) ?(?:st|nd|rd|th)? (?:of )?(?:every|each) month ", t)
         or _re.search(r" (?:every|each) month (?:on )?(?:the )?(\d{1,2}) ?(?:st|nd|rd|th)? ", t)
         or _re.search(r" monthly (?:on )?(?:the )?(\d{1,2}) ?(?:st|nd|rd|th) ", t))
    if m and 1 <= int(m.group(1)) <= 31:
        return out("month", 1, _next_month_day(today, int(m.group(1))))
    # Every N days / weeks / months.
    m = _re.search(rf" (?:every|each) {_N} (day|week|month)s? ", t)
    if m:
        return out(m.group(2), _num(m.group(1)))
    if _re.search(r" (?:every|each) (?:day|morning|evening|night|working day) | daily | everyday ", t):
        return out("day")
    if _re.search(r" fortnight(?:ly)? | bi ?weekly ", t):
        return out("week", 2)
    if _re.search(r" (?:every|each) week | weekly ", t):
        return out("week")
    if _re.search(r" (?:every|each) quarter | quarterly ", t):
        return out("month", 3)
    if _re.search(r" (?:every|each) month | monthly ", t):
        return out("month")
    return None

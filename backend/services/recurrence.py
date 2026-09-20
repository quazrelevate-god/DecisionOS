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

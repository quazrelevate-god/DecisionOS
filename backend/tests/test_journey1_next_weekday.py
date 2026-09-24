""""Next Wednesday", said on a Tuesday, is tomorrow (JOURNEY-1 J5-02).

The tester told Dex "arrange the vendor call next Wednesday" on a Tuesday and
the call was booked for the Wednesday EIGHT days away. _resolve_meeting_date
already resolves a weekday to its next occurrence; "next" then added a second
week on top of that. Nobody means "a week on Wednesday" when they say "next
Wednesday" the day before.

"Next week Wednesday" is a different phrase and does mean the following week,
so that one keeps the extra seven days.
"""
from datetime import datetime, timedelta, timezone

from services.voice import _resolve_meeting_date

_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def _expected(phrase_day: int, today: datetime, extra_week: bool = False) -> str:
    ahead = (phrase_day - today.weekday()) % 7 or 7
    if extra_week:
        ahead += 7
    return (today + timedelta(days=ahead)).date().isoformat()


def test_next_weekday_is_the_coming_one():
    """For every day of the week, "next <day>" is that day's next occurrence."""
    now = datetime.now(timezone.utc)
    for idx, name in enumerate(_NAMES):
        got = _resolve_meeting_date(f"next {name}", None)
        assert got == _expected(idx, now), f"next {name}: {got}"
        # and the same day named plainly resolves to exactly the same date
        assert _resolve_meeting_date(f"on {name}", None) == got


def test_the_tuesday_case_from_the_audit():
    """The walk itself: on a Tuesday, "next Wednesday" is the very next day."""
    now = datetime.now(timezone.utc)
    got = _resolve_meeting_date("vendor call next wednesday", None)
    days_out = (datetime.fromisoformat(got).date() - now.date()).days
    assert 1 <= days_out <= 7, f"{days_out} days out — a fortnight again?"


def test_next_week_weekday_still_means_the_week_after():
    now = datetime.now(timezone.utc)
    assert _resolve_meeting_date("next week wednesday", None) == _expected(2, now, extra_week=True)


def test_today_and_tomorrow_are_untouched():
    now = datetime.now(timezone.utc)
    assert _resolve_meeting_date("today", None) == now.date().isoformat()
    assert _resolve_meeting_date("tomorrow", None) == (now + timedelta(days=1)).date().isoformat()


def test_a_weekday_never_resolves_to_today():
    """`or 7` is load-bearing: "next Wednesday" said ON a Wednesday is the next one."""
    now = datetime.now(timezone.utc)
    today_name = _NAMES[now.weekday()]
    assert _resolve_meeting_date(f"next {today_name}", None) != now.date().isoformat()

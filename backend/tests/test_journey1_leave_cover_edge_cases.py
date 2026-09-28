"""J14-15 — the leave hand-over, pushed at from every side.

The founder's note on this row: "Kindly test with different scenarios, and if
there is an issue, fix it."

The hand-over is a date window (services/delegation.is_active_now) and windows
are where this kind of thing goes wrong: off by a day at one end, on for ever at
the other, or on for somebody who never asked. Each case here is a shape a real
leave request takes in a workshop — a single day, leave that starts today, leave
taken and then cancelled, somebody nominating themselves.

These are unit tests on the window itself: no database, no clock mocking, and
therefore nothing to go stale.
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.delegation import is_active_now
from shared.due import IST

NOW = datetime.now(timezone.utc)


def _d(n):
    """A date n days from today, as the app writes them — and TODAY is the
    company's day, not UTC's. Between 00:00 and 05:30 IST the two disagree, and
    a test that said "today" in UTC was asking about yesterday."""
    return (NOW.astimezone(IST) + timedelta(days=n)).date().isoformat()


def _cover(delegate="u-rajkumar", frm=None, to=None, **extra):
    ac = {"delegate_user_id": delegate}
    if frm is not None:
        ac["from"] = frm
    if to is not None:
        ac["to"] = to
    ac.update(extra)
    return ac


# ---------------------------------------------------------------------------
# On when it should be on.
# ---------------------------------------------------------------------------
def test_leave_that_starts_today_covers_today():
    """The commonest real case: somebody marks leave on the morning they leave.
    Comparing UTC dates alone left this off until 5:30 am in India, which is
    what the +14h grace in is_active_now is for."""
    assert is_active_now(_cover(frm=_d(0), to=_d(2))) is True


def test_a_single_day_of_leave_is_covered_on_that_day():
    assert is_active_now(_cover(frm=_d(0), to=_d(0))) is True


def test_the_middle_of_a_long_leave_is_covered():
    assert is_active_now(_cover(frm=_d(-3), to=_d(5))) is True


def test_the_last_day_is_still_covered():
    """Inclusive at both ends — a man back at work tomorrow is still away
    today, and his approvals should not bounce on his final afternoon."""
    assert is_active_now(_cover(frm=_d(-4), to=_d(0))) is True


def test_no_end_date_means_until_somebody_says_otherwise():
    """JUDGEMENT, pinned. An open-ended hand-over stays on. That is deliberate —
    indefinite leave is a real thing — but it is also the one shape that can be
    forgotten about, so it is asserted here rather than left to be discovered."""
    assert is_active_now(_cover(frm=_d(-2))) is True


# ---------------------------------------------------------------------------
# Off when it should be off. These are the ones that matter: a hand-over left on
# means somebody keeps approving in another person's name after they are back.
# ---------------------------------------------------------------------------
def test_leave_that_has_not_started_does_not_cover_yet():
    assert is_active_now(_cover(frm=_d(3), to=_d(6))) is False


def test_leave_that_is_over_hands_back_by_itself():
    """Nobody has to remember to switch it off — which was the whole point of
    putting a window on it rather than a flag."""
    assert is_active_now(_cover(frm=_d(-9), to=_d(-2))) is False


def test_it_hands_back_the_day_after_the_last_day():
    assert is_active_now(_cover(frm=_d(-5), to=_d(-1))) is False


def test_a_cover_with_nobody_named_is_not_a_cover():
    """A leave raised without picking anybody must not hand approvals to a blank
    — it should fall through to whoever would have had them anyway."""
    assert is_active_now(_cover(delegate=None, frm=_d(-1), to=_d(1))) is False
    assert is_active_now(_cover(delegate="", frm=_d(-1), to=_d(1))) is False
    assert is_active_now({}) is False
    assert is_active_now(None) is False


def test_a_cleared_cover_is_off_even_inside_its_old_dates():
    """Cancelling leave clears the delegate. The dates may still be sitting
    there; the absence of a person is what decides."""
    assert is_active_now({"from": _d(-1), "to": _d(3)}) is False


# ---------------------------------------------------------------------------
# Shapes that should not throw. A window that raises takes the whole approvals
# feed down for everybody, not just the person who is away.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("ac", [
    {"delegate_user_id": "u-x", "from": "", "to": ""},
    {"delegate_user_id": "u-x", "from": None, "to": None},
    {"delegate_user_id": "u-x", "from": "2026-10-06T00:00:00+05:30", "to": "2026-10-08T23:59:59+05:30"},
    {"delegate_user_id": "u-x", "from": "not-a-date", "to": "also-not"},
])
def test_odd_shapes_answer_rather_than_raise(ac):
    assert is_active_now(ac) in (True, False)


def test_a_full_timestamp_is_read_as_the_day_it_falls_on():
    """The UI writes plain dates, but a capture or an import can carry a full
    timestamp. Only the first ten characters decide, so both behave the same."""
    assert is_active_now(_cover(frm=f"{_d(-1)}T18:30:00+05:30", to=f"{_d(1)}T23:59:59+05:30")) is True
    assert is_active_now(_cover(frm=f"{_d(3)}T00:00:00Z", to=f"{_d(5)}T00:00:00Z")) is False


# ---------------------------------------------------------------------------
# The boundary itself, on a named day rather than on whatever day the suite
# runs — this is the one that was wrong.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("when,live", [
    ("2026-10-08T09:00:00+05:30", True),    # the last morning: away
    ("2026-10-08T23:59:00+05:30", True),    # and still away at the end of it
    ("2026-10-09T00:01:00+05:30", False),   # back — the cover is off at midnight
    ("2026-10-09T14:30:00+05:30", False),   # THE BUG: this said True until 17:30
    ("2026-10-09T22:00:00+05:30", False),
])
def test_the_cover_is_off_at_midnight_after_the_last_day(when, live):
    """It used to shift the UTC clock by -12h at this end, so a cover that
    ended on the 8th stayed live until 12:00 UTC on the 9th — 17:30 IST, most
    of a working day in which somebody else held the approvals of a man already
    back at his desk, and every one of them was recorded in his name."""
    ac = _cover(frm="2026-10-06", to="2026-10-08")
    assert is_active_now(ac, datetime.fromisoformat(when)) is live


def test_the_cover_is_off_until_midnight_on_the_first_day():
    """And the same exactness at the other end, which used to switch on at
    15:30 IST the afternoon before."""
    ac = _cover(frm="2026-10-06", to="2026-10-08")
    assert is_active_now(ac, datetime.fromisoformat("2026-10-05T23:59:00+05:30")) is False
    assert is_active_now(ac, datetime.fromisoformat("2026-10-06T00:01:00+05:30")) is True


def test_an_open_ended_cover_is_still_open_ended_far_in_the_future():
    ac = _cover(frm="2026-10-06")
    assert is_active_now(ac, datetime.fromisoformat("2027-04-01T10:00:00+05:30")) is True

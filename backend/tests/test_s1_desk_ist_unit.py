"""Epic 10 Testing -- Sprint 1 (unit). T10-02 (Desk IST day boundaries).

Structural tests over the Desk's IST date helpers -- the +5:30 offset that
keeps India tenants from seeing 'yesterday's' data between 18:30-23:59 UTC.
Pure date math; no server, no live DB.
"""
import sys
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from routers.desk import _today_ist, _yesterday_ist_window_utc, _IST_OFFSET


def test_ist_offset_is_530():
    assert _IST_OFFSET == timedelta(hours=5, minutes=30)


def test_today_ist_is_valid_date_string():
    s = _today_ist()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", s)
    datetime.strptime(s, "%Y-%m-%d")  # parses


def test_today_ist_matches_utc_plus_offset():
    expected = (datetime.now(timezone.utc) + _IST_OFFSET).date().isoformat()
    assert _today_ist() == expected


def test_yesterday_window_start_before_end():
    start, end = _yesterday_ist_window_utc()
    assert start < end


def test_yesterday_window_is_about_24h():
    start, end = _yesterday_ist_window_utc()
    s = datetime.fromisoformat(start.replace("Z", "+00:00"))
    e = datetime.fromisoformat(end.replace("Z", "+00:00"))
    hours = (e - s).total_seconds() / 3600
    assert 23.5 <= hours <= 24.5  # one IST calendar day expressed in UTC


def test_yesterday_window_ends_before_now():
    _, end = _yesterday_ist_window_utc()
    e = datetime.fromisoformat(end.replace("Z", "+00:00"))
    assert e <= datetime.now(timezone.utc)

"""Notification history (Epic 12, client FEATURE-08, 2026-10-22).

Reading a notification never deleted it — but GET /api/notifications stopped at
the newest 100, read and unread mixed, and counted "unread" inside those 100.
Eleven of 62 people on the dev database were already past it. What is pinned
here:

  * with no parameters the answer is what it always was (the bell and anything
    else reading it keep working), but the counts are TRUE past 100;
  * `status` splits New (unread) from History (read), and `before` pages back
    through either to the very first notification;
  * reading stamps read_at once; "Move back to New" undoes it; nobody ever
    reaches somebody else's notifications;
  * the "need you" badge counts the asks, not the news;
  * History says how long the company keeps notifications.

Pure unit tests — fake Mongo, no live DB, no server, no network.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

import routers.brief as brief
import services.finance_signals as finance_signals
import services.retention as retention
from tests.fake_mongo import FakeDB

_LOOP = asyncio.new_event_loop()


def run(coro):
    return _LOOP.run_until_complete(coro)


T = "t-nh"
ME = {"id": "u-me", "tenant_id": T, "role": "sales", "name": "Meena"}
OTHER = {"id": "u-other", "tenant_id": T, "role": "sales", "name": "Arun"}


def _at(i: int) -> str:
    """A created_at that sorts by i (bigger = newer)."""
    return f"2026-10-{1 + i // 1440:02d}T{(i // 60) % 24:02d}:{i % 60:02d}:00+00:00"


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    for mod in (brief, retention):
        monkeypatch.setattr(mod, "db", fake)

    async def no_followup(*a, **k):
        return None
    monkeypatch.setattr(finance_signals, "run_followup", no_followup)
    run(fake.tenants.insert_one({"id": T, "name": "Nila"}))
    return fake


def seed(db, n, *, user=ME, read=False, ntype="status", start=0):
    """n notifications, inserted NEWEST FIRST (FakeDB's sort is a no-op, so
    insertion order stands in for the server's created_at-descending sort)."""
    for i in reversed(range(start, start + n)):
        run(db.notifications.insert_one({
            "id": f"{user['id']}-{i}", "tenant_id": T, "user_id": user["id"], "type": ntype,
            "message": f"m{i}", "read": read, "created_at": _at(i)}))


def ls(user=ME, **kw):
    kw.setdefault("status", None)
    kw.setdefault("before", None)
    kw.setdefault("limit", None)
    return run(brief.list_notifications(user=user, **kw))


def test_the_plain_answer_is_unchanged_but_its_counts_are_true(db):
    seed(db, 130)
    out = ls()
    assert len(out["notifications"]) == 100, "the bell's answer is the newest 100, as before"
    assert out["unread"] == 130, "counted in the database, not inside the 100"
    assert out["has_more"] is True and "kept_days" not in out


def test_new_and_history_are_separate_and_page_back_to_the_first(db):
    seed(db, 40, read=True, start=0)          # older, read
    seed(db, 5, read=False, start=40)         # newer, unread
    new = ls(status="unread")
    assert [n["id"] for n in new["notifications"]] == [f"u-me-{i}" for i in range(44, 39, -1)]
    assert new["has_more"] is False
    page1 = ls(status="read", limit=30)
    assert len(page1["notifications"]) == 30 and page1["has_more"] is True
    assert all(n["read"] for n in page1["notifications"])
    page2 = ls(status="read", limit=30, before=page1["notifications"][-1]["created_at"])
    assert len(page2["notifications"]) == 10 and page2["has_more"] is False
    assert page2["notifications"][-1]["id"] == "u-me-0", "the very first one is still reachable"
    assert {n["id"] for n in page1["notifications"]}.isdisjoint({n["id"] for n in page2["notifications"]})


def test_nobody_reaches_somebody_elses_notifications(db):
    seed(db, 3, user=OTHER)
    seed(db, 2)
    assert {n["user_id"] for n in ls()["notifications"]} == {"u-me"}
    assert ls(status="read")["notifications"] == []
    with pytest.raises(HTTPException) as e:
        run(brief.unread_notification("u-other-0", user=ME))
    assert e.value.status_code == 404
    run(brief.read_notification("u-other-0", user=ME))
    assert run(db.notifications.find_one({"id": "u-other-0"}))["read"] is False


def test_reading_stamps_when_once_and_moving_back_undoes_it(db):
    seed(db, 1)
    run(brief.read_notification("u-me-0", user=ME))
    first = run(db.notifications.find_one({"id": "u-me-0"}))
    assert first["read"] is True and first["read_at"]
    run(db.notifications.update_one({"id": "u-me-0"}, {"$set": {"read_at": "2026-10-01T00:00:00+00:00"}}))
    run(brief.read_notification("u-me-0", user=ME))
    assert run(db.notifications.find_one({"id": "u-me-0"}))["read_at"] == "2026-10-01T00:00:00+00:00", \
        "reading it again keeps the first time"
    run(brief.unread_notification("u-me-0", user=ME))
    back = run(db.notifications.find_one({"id": "u-me-0"}))
    assert back["read"] is False and back["read_at"] is None
    assert [n["id"] for n in ls(status="unread")["notifications"]] == ["u-me-0"]


def test_read_all_moves_everything_to_history_with_a_time(db):
    seed(db, 4)
    run(brief.read_all_notifications(user=ME))
    assert ls(status="unread")["notifications"] == []
    hist = ls(status="read")["notifications"]
    assert len(hist) == 4 and all(n["read_at"] for n in hist)
    assert ls()["unread"] == 0


def test_the_bell_counts_the_asks_not_the_news(db):
    seed(db, 2, ntype="approval", start=0)
    seed(db, 1, ntype="clarification", start=2)
    seed(db, 1, ntype="desk_nudge", start=3)
    seed(db, 3, ntype="approved", start=4)      # news
    seed(db, 1, ntype="approval", read=True, start=7)
    out = ls()
    assert out["needs_you"] == 4 and out["unread"] == 7


def test_history_says_how_long_it_is_kept(db):
    assert ls(status="read")["kept_days"] is None, "retention off: kept until deleted"
    run(db.tenants.update_one({"id": T}, {"$set": {"retention": {"enabled": True, "ttl_days": 90}}}))
    assert ls(status="read")["kept_days"] == 90
    run(db.tenants.update_one({"id": T}, {"$set": {"retention": {"enabled": True, "ttl_days": 5}}}))
    assert ls(status="read")["kept_days"] == retention.MIN_TTL_DAYS
    run(db.tenants.update_one({"id": T}, {"$set": {"retention": {"enabled": True, "ttl_days": 90,
                                                                  "collections": ["activity"]}}}))
    assert ls(status="read")["kept_days"] is None, "retention on, but not for notifications"


def test_an_unknown_state_is_refused(db):
    with pytest.raises(HTTPException) as e:
        ls(status="archived")
    assert e.value.status_code == 400

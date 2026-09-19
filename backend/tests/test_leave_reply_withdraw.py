"""Answering the approver's question, and withdrawing a leave request (2026-09-19).

Yokesh: "add the reply to info request and withdraw leave."

An approver could ask for more information and the requester had no way to
answer — their only move was raising a fresh request. And nobody could take a
request back when plans changed. Now:

  * POST /leaves/{id}/respond — the requester answers; the request goes back
    to Pending and the approver (and their delegate) hears about it.
  * POST /leaves/{id}/withdraw — the requester takes it back while it waits,
    or once approved but before it starts. It stays in history as withdrawn
    ("cancelled"), the approver is told, and it can no longer be decided.
"""
import os
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-leave"
ME = {"id": "u-me", "tenant_id": T, "name": "Priya Nair", "role": "sales", "permissions": []}
BOSS = {"id": "u-boss", "tenant_id": T, "name": "Rajesh", "role": "owner", "permissions": []}
OTHER = {"id": "u-other", "tenant_id": T, "name": "Arun", "role": "sales", "permissions": []}
FUTURE = (date.today() + timedelta(days=10)).isoformat()
PAST = (date.today() - timedelta(days=3)).isoformat()


async def _leave(db, lid, status="pending", from_date=FUTURE, **extra):
    await db.leaves.insert_one({
        "id": lid, "tenant_id": T, "user_id": ME["id"], "user_name": ME["name"], "leave_type": "casual",
        "from_date": from_date, "to_date": from_date, "status": status, "approver_id": BOSS["id"],
        "approver_name": BOSS["name"], "info_note": extra.pop("info_note", None), "history": [], **extra})


async def _refused(coro):
    try:
        await coro
    except HTTPException as e:
        return e.status_code, e.detail
    return None


def _run(with_test_db, body):
    async def scenario(db):
        with e2e_env(db, keep={"services.notifications.push_notification"}):
            return await body(db)
    return with_test_db(scenario)


def _note(text=""):
    from models.team import LeaveDecisionInput
    return LeaveDecisionInput(note=text)


# ---------------------------------------------------------------------------
# Answering the question.
# ---------------------------------------------------------------------------
def test_the_requester_answers_and_it_goes_back_to_the_approver(with_test_db):
    async def body(db):
        import routers.team as team
        await _leave(db, "lv1", status="info_requested", info_note="Who covers the Chennai dealers?")
        out = await team.respond_to_leave_question("lv1", _note("  Arun has them, we spoke Friday.  "), user=ME)
        notes = await db.notifications.find({"entity_id": "lv1"}, {"_id": 0}).to_list(10)
        return out, notes
    out, notes = _run(with_test_db, body)
    assert out["status"] == "pending", "back with the approver"
    assert out["reply_note"] == "Arun has them, we spoke Friday."
    assert out["info_note"] == "Who covers the Chennai dealers?", "the question is kept beside the answer"
    assert out["history"][-1]["action"] == "replied"
    assert [(n["user_id"], n["type"]) for n in notes] == [("u-boss", "approval")], \
        "the approver is told, as an approval that needs them again"


def test_only_the_requester_answers_and_only_when_asked(with_test_db):
    async def body(db):
        import routers.team as team
        await _leave(db, "lv1", status="info_requested", info_note="?")
        await _leave(db, "lv2", status="pending")
        return (
            await _refused(team.respond_to_leave_question("lv1", _note("mine"), user=OTHER)),
            await _refused(team.respond_to_leave_question("lv1", _note("mine"), user=BOSS)),
            await _refused(team.respond_to_leave_question("lv2", _note("unasked"), user=ME)),
            await _refused(team.respond_to_leave_question("lv1", _note("   "), user=ME)),
        )
    other, boss, unasked, empty = _run(with_test_db, body)
    assert other[0] == 403 and boss[0] == 403, "not a colleague, not even an owner"
    assert unasked[0] == 409, "nothing was asked"
    assert empty[0] == 400


# ---------------------------------------------------------------------------
# Withdrawing.
# ---------------------------------------------------------------------------
def test_a_waiting_request_is_withdrawn_kept_and_the_approver_told(with_test_db):
    async def body(db):
        import routers.team as team
        await _leave(db, "lv1")
        out = await team.withdraw_leave("lv1", _note("Wedding moved to December"), user=ME)
        notes = await db.notifications.find({"entity_id": "lv1"}, {"_id": 0}).to_list(10)
        return out, notes
    out, notes = _run(with_test_db, body)
    assert out["status"] == "cancelled" and out["withdrawn_note"] == "Wedding moved to December"
    assert out["history"][-1]["action"] == "withdrawn", "kept in the history, not deleted"
    assert [(n["user_id"], n["type"]) for n in notes] == [("u-boss", "leave_withdrawn")]


def test_an_approved_leave_can_be_withdrawn_before_it_starts_not_after(with_test_db):
    async def body(db):
        import routers.team as team
        await _leave(db, "future", status="approved", from_date=FUTURE)
        await _leave(db, "started", status="approved", from_date=PAST)
        ok = await team.withdraw_leave("future", _note(), user=ME)
        late = await _refused(team.withdraw_leave("started", _note(), user=ME))
        return ok, late
    ok, late = _run(with_test_db, body)
    assert ok["status"] == "cancelled"
    assert late[0] == 409 and "already started" in late[1]


def test_what_cannot_be_withdrawn(with_test_db):
    async def body(db):
        import routers.team as team
        await _leave(db, "rej", status="rejected")
        await _leave(db, "done", status="cancelled")
        await _leave(db, "theirs")
        return (
            await _refused(team.withdraw_leave("rej", _note(), user=ME)),
            await _refused(team.withdraw_leave("done", _note(), user=ME)),
            await _refused(team.withdraw_leave("theirs", _note(), user=OTHER)),
        )
    rejected, twice, other = _run(with_test_db, body)
    assert rejected[0] == 409 and twice[0] == 409
    assert other[0] == 403, "only the person who asked"


def test_a_withdrawn_request_cannot_be_approved(with_test_db):
    async def body(db):
        import routers.team as team
        await _leave(db, "lv1")
        await team.withdraw_leave("lv1", _note(), user=ME)
        return await _refused(team._decide_leave("lv1", BOSS, "approved", "", "approved", "ok"))
    status, detail = _run(with_test_db, body)
    assert status == 409 and "withdrew" in detail


# ---------------------------------------------------------------------------
# The screens.
# ---------------------------------------------------------------------------
def _fe(*parts):
    from pathlib import Path
    return (Path(__file__).resolve().parents[2] / "frontend" / "src").joinpath(*parts).read_text(encoding="utf-8")


def test_the_requesters_card_can_answer_and_withdraw():
    page = _fe("pages", "Leave.js")
    assert "`/leaves/${lv.id}/respond`" in page and "`/leaves/${lv.id}/withdraw`" in page
    assert "canAct={false} mine" in page, "the Leave page turns them on for your own requests"
    assert 'cancelled: { label: "Withdrawn"' in page
    assert 'lv.status !== "cancelled" && (' in page, "an approver gets no buttons on a withdrawn request"


def test_the_approver_hears_about_a_withdrawal_in_their_queue():
    notif = _fe("lib", "notif.js")
    assert 'n?.type === "leave_withdrawn"' in notif

"""What an approver's signature costs (2026-09-29).

Step three of Yokesh's "we can see individual person efficiency also right".

An approver's queue is invisible in every other number on the Ops page. Work
waiting on a signature is not the approver's OWN task, so it lands in nobody's
Open and nobody's Overdue: a manager who takes three working days over every
sign-off holds up the whole workshop and scores a clean 100. The doer whose
task is stuck behind it, meanwhile, watches it go overdue.

The task already recorded `approved_at`. It never recorded the moment the
request was MADE, so the span could not be computed at all. `approval_stamp`
writes `approval_requested_at` from now on.

WHAT IS RECOVERABLE, AND WHAT IS NOT. A task needing approval BEFORE work
starts is created already waiting, so its `created_at` IS the request — that
is a fact about how the row was written. Approval before CLOSING is asked for
when the doer marks the task complete, and nothing recorded that moment; the
Journal has no "sent for approval" event either. Those stay unmeasured rather
than dated from something that merely looks close, and their turnaround starts
accumulating from today.
"""
import os
from pathlib import Path

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

OPS = (Path(__file__).resolve().parents[2] / "frontend" / "src"
       / "pages" / "OperatingScore.js").read_text(encoding="utf-8")

T = "t-signoff"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}
ANAND = {"id": "u-anand", "tenant_id": T, "role": "accounts", "name": "Anand", "permissions": []}


# ───────────────────────── the stamp ───────────────────────────────────────
def test_being_asked_is_recorded():
    from services.tasks import approval_stamp
    assert approval_stamp({"approval_status": None}, {"approval_status": "pending"}, "NOW") \
        == {"approval_requested_at": "NOW"}


def test_being_asked_twice_does_not_restart_the_clock():
    """Otherwise every save on a waiting task would make the approver look
    instant."""
    from services.tasks import approval_stamp
    assert approval_stamp({"approval_status": "pending"}, {"approval_status": "pending"}, "LATER") == {}
    assert approval_stamp({"approval_status": "pending"}, {"title": "Renamed"}, "LATER") == {}


def test_answering_it_writes_nothing_here():
    """`approved_at` already says when it was answered."""
    from services.tasks import approval_stamp
    assert approval_stamp({"approval_status": "pending"}, {"approval_status": "approved"}, "LATER") == {}


# ───────────────────────── written where it is asked ───────────────────────
def test_a_task_raised_needing_approval_is_stamped_when_it_is_raised(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from fastapi import BackgroundTasks
        from models.tasks import TaskCreateInput
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Nila",
                                         "roles": [{"key": "accounts", "label": "Accounts"}]})
            await db.users.insert_many([
                {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
                {"id": "u-anand", "tenant_id": T, "name": "Anand", "role": "accounts"}])
            await rt.create_task(TaskCreateInput(
                title="Buy a spare motor", assignee_id="u-anand", due_date="2026-10-05",
                approval_required=True, approver_id="u-owner"), BackgroundTasks(), user=OWNER)
            return await db.tasks.find_one({"tenant_id": T}, {"_id": 0})

    row = with_test_db(scenario)
    assert row["approval_status"] == "pending"
    assert row.get("approval_requested_at"), "the clock starts when the request is made"


def test_marking_a_close_stage_task_complete_is_the_request(with_test_db):
    """Approval before closing: the doer finishing IS the ask, and until now
    nothing wrote down when that happened."""
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Nila"})
            await db.users.insert_many([
                {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
                {"id": "u-anand", "tenant_id": T, "name": "Anand", "role": "accounts"}])
            await db.tasks.insert_one({
                "id": "t1", "tenant_id": T, "title": "File the GST return", "status": "in_progress",
                "assignee_id": "u-anand", "created_by": "u-owner", "approval_required": True,
                "approval_stage": "close", "approver_id": "u-owner",
                "created_at": "2026-09-21T04:00:00+00:00"})
            await rt.update_task("t1", TaskUpdateInput(status="done"), user=ANAND)
            return await db.tasks.find_one({"id": "t1"}, {"_id": 0})

    row = with_test_db(scenario)
    assert row["status"] == "review" and row["approval_status"] == "pending"
    assert row.get("approval_requested_at")
    assert not row.get("completed_at"), "sent for sign-off is not finished"


# ───────────────────────── recovering what is knowable ─────────────────────
def test_the_backfill_dates_pre_work_approvals_and_leaves_the_rest_alone(with_test_db):
    async def scenario(db):
        from services.task_timing import backfill_approval_requested_at
        await db.tasks.insert_many([
            {"id": "a1", "tenant_id": T, "approval_required": True, "approval_stage": "start",
             "approval_status": "approved", "created_at": "2026-09-01T04:00:00+00:00",
             "approved_at": "2026-09-03T04:00:00+00:00"},
            {"id": "a2", "tenant_id": T, "approval_required": True, "approval_stage": "close",
             "approval_status": "approved", "created_at": "2026-09-01T04:00:00+00:00",
             "approved_at": "2026-09-03T04:00:00+00:00"},
            {"id": "a3", "tenant_id": T, "approval_required": False,
             "created_at": "2026-09-01T04:00:00+00:00"},
        ])
        await backfill_approval_requested_at(db)
        return {r["id"]: r for r in await db.tasks.find({}, {"_id": 0}).to_list(10)}

    rows = with_test_db(scenario)
    assert rows["a1"]["approval_requested_at"] == "2026-09-01T04:00:00+00:00", \
        "created already waiting, so its creation IS the request"
    assert "approval_requested_at" not in rows["a2"], \
        "sign-off before closing has no record of the moment — not guessed from creation"
    assert "approval_requested_at" not in rows["a3"]


# ───────────────────────── what the numbers mean ───────────────────────────
def _ap(approver="u-owner", asked=None, answered=None, status="approved"):
    return {"approver_id": approver, "approval_status": status,
            "approval_requested_at": asked, "approved_at": answered}


def test_the_typical_turnaround_is_the_median_of_what_was_answered():
    from services.task_timing import approvals_of
    rows = [_ap(asked="2026-09-21", answered="2026-09-22"),
            _ap(asked="2026-09-21", answered="2026-09-22"),
            _ap(asked="2026-09-21", answered="2026-09-28")]
    out = approvals_of(rows, "u-owner", now="2026-09-29")
    assert out["typical_days"] == 1 and out["answered"] == 3


def test_a_queue_nobody_is_clearing_is_visible_even_with_nothing_answered():
    """The case that matters most: an approver who has never answered anything
    shows no turnaround, and four requests waiting."""
    from services.task_timing import approvals_of
    rows = [_ap(asked="2026-09-21", status="pending") for _ in range(4)]
    out = approvals_of(rows, "u-owner", now="2026-09-29")
    assert out["typical_days"] is None and out["answered"] == 0
    assert out["waiting"] == 4
    assert out["oldest_days"] == 7, "21 Sept to 29 Sept, less the Sunday"


def test_somebody_elses_queue_is_not_counted_as_yours():
    from services.task_timing import approvals_of
    rows = [_ap(approver="u-anand", asked="2026-09-21", status="pending"),
            _ap(approver="u-owner", asked="2026-09-21", status="pending")]
    assert approvals_of(rows, "u-owner", now="2026-09-29")["waiting"] == 1


def test_an_unanswered_request_with_no_recorded_ask_is_not_invented():
    """The close-stage history the backfill deliberately left alone must not
    reappear here as a zero-day turnaround."""
    from services.task_timing import approvals_of
    rows = [_ap(asked=None, answered="2026-09-22"), _ap(asked=None, status="pending")]
    out = approvals_of(rows, "u-owner", now="2026-09-29")
    assert out["typical_days"] is None and out["answered"] == 0
    assert out["waiting"] == 1 and out["oldest_days"] is None


# ───────────────────────── it reaches the page ─────────────────────────────
def test_the_payload_carries_the_approvers_queue(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Nila"})
            await db.users.insert_many([
                {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
                {"id": "u-anand", "tenant_id": T, "name": "Anand", "role": "accounts"}])
            await db.tasks.insert_many([
                {"id": "t1", "tenant_id": T, "assignee_id": "u-anand", "approver_id": "u-anand",
                 "status": "blocked", "approval_required": True, "approval_status": "pending",
                 "approval_requested_at": "2026-09-21T04:00:00+00:00",
                 "created_at": "2026-09-21T04:00:00+00:00"},
                {"id": "t2", "tenant_id": T, "assignee_id": "u-owner", "approver_id": "u-anand",
                 "status": "done", "approval_required": True, "approval_status": "approved",
                 "approval_requested_at": "2026-09-21T04:00:00+00:00",
                 "approved_at": "2026-09-23T04:00:00+00:00",
                 "created_at": "2026-09-21T04:00:00+00:00"},
            ])
            return await r.operating_score(user_id="u-anand", user=OWNER)

    a = with_test_db(scenario)["approvals"]
    assert a["waiting"] == 1 and a["answered"] == 1 and a["typical_days"] == 2


def test_the_card_is_shown_only_to_somebody_who_actually_signs_things_off():
    """For everybody else it would be a card of dashes."""
    assert "approvals.waiting > 0 || approvals.answered > 0" in OPS
    assert 'testid="ops-timing-approvals"' in OPS
    assert 'label="Sign-offs waiting"' in OPS
    assert "The oldest has been waiting ${a.oldest_days} working days." in OPS

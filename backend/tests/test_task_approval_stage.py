"""ASK-28 TK-05 — the approval moment: before work starts, or before it's marked done.

Pure unit tests over services.tasks — no server, no database.
  start  the task is locked until approved (what approval always meant)
  close  the doer works freely; completing sends it for approval, unless the
         person completing may approve it themselves
and GET /tasks?view=approvals shows a close-stage task only while it waits.
"""
import pytest

from services.tasks import (
    approval_stage,
    completion_updates,
    is_start_locked,
    reopen_updates,
    task_list_query,
)

pytestmark = pytest.mark.unit

OWNER = {"id": "u-owner", "tenant_id": "t1", "role": "owner"}
FIN = {"id": "u-fin", "tenant_id": "t1", "role": "finance"}


def _matches(q, t):
    for k, v in q.items():
        if k == "$or":
            if not any(_matches(sub, t) for sub in v):
                return False
            continue
        if k == "$and":
            if not all(_matches(sub, t) for sub in v):
                return False
            continue
        have = t.get(k)
        if isinstance(v, dict):
            if "$ne" in v and have == v["$ne"]:
                return False
            if "$nin" in v and have in v["$nin"]:
                return False
        elif have != v:
            return False
    return True


def T(id, **kw):
    base = {"id": id, "tenant_id": "t1", "approval_required": True, "approver_id": "u-fin"}
    base.update(kw)
    return base


# --- which stage a task is in ------------------------------------------------

def test_no_approval_has_no_stage():
    assert approval_stage({"approval_required": False, "approval_stage": "close"}) is None


def test_older_approval_tasks_mean_before_start():
    assert approval_stage({"approval_required": True}) == "start"
    assert approval_stage({"approval_required": True, "approval_stage": "weird"}) == "start"


def test_close_stage_read_back():
    assert approval_stage({"approval_required": True, "approval_stage": "close"}) == "close"


# --- the lock ------------------------------------------------------------------

def test_before_start_locks_until_approved():
    assert is_start_locked(T("a", approval_status="pending", status="blocked"))
    assert is_start_locked(T("a", approval_status="rejected", status="blocked"))
    assert not is_start_locked(T("a", approval_status="approved", status="todo"))


def test_before_close_never_locks_the_work():
    assert not is_start_locked(T("a", approval_stage="close", approval_status=None, status="todo"))
    assert not is_start_locked(T("a", approval_stage="close", approval_status="pending", status="review"))


def test_no_approval_never_locks():
    assert not is_start_locked({"approval_required": False, "approval_status": None})


# --- completing ------------------------------------------------------------------

def test_completing_without_close_approval_is_just_done():
    assert completion_updates({"approval_required": False}, can_approve=False) == {"status": "done"}
    assert completion_updates(T("a", approval_status="approved"), can_approve=False) == {"status": "done"}


def test_doer_completing_close_task_sends_it_for_approval():
    got = completion_updates(T("a", approval_stage="close", status="in_progress"), can_approve=False)
    assert got == {"status": "review", "approval_status": "pending"}


def test_approver_completing_close_task_closes_it():
    got = completion_updates(T("a", approval_stage="close", status="in_progress"), can_approve=True)
    assert got == {"status": "done", "approval_status": "approved"}


def test_changes_requested_then_completed_again_asks_again():
    got = completion_updates(T("a", approval_stage="close", approval_status="rejected", status="in_progress"),
                             can_approve=False)
    assert got["approval_status"] == "pending"


# --- moving back into work -----------------------------------------------------------

def test_moving_back_withdraws_a_pending_request():
    t = T("a", approval_stage="close", approval_status="pending", status="review")
    assert reopen_updates(t, "in_progress") == {"approval_status": None}


def test_reopening_a_signed_off_task_needs_signing_off_again():
    t = T("a", approval_stage="close", approval_status="approved", status="done")
    assert reopen_updates(t, "in_progress") == {"approval_status": None}


def test_changes_requested_note_stays_while_working():
    t = T("a", approval_stage="close", approval_status="rejected", status="in_progress")
    assert reopen_updates(t, "waiting") == {}


def test_reopen_leaves_start_stage_alone():
    assert reopen_updates(T("a", approval_status="approved", status="done"), "in_progress") == {}


# --- the approvals list ------------------------------------------------------------------

TASKS = [
    T("start-pending", approval_status="pending", status="blocked"),
    T("start-rejected", approval_status="rejected", status="blocked"),
    T("start-approved", approval_status="approved", status="todo"),
    T("legacy-no-stage", approval_status="pending", status="blocked"),
    T("close-working", approval_stage="close", approval_status=None, status="in_progress"),
    T("close-pending", approval_stage="close", approval_status="pending", status="review"),
    T("close-sent-back", approval_stage="close", approval_status="rejected", status="in_progress"),
    T("close-approved", approval_stage="close", approval_status="approved", status="done"),
    T("close-pending-named-other", approval_stage="close", approval_status="pending", status="review",
      approver_id="u-sales"),
]


def _ids(user, **kw):
    q = task_list_query(user, view="approvals", **kw)
    return sorted(t["id"] for t in TASKS if _matches(q, t))


def test_owner_sees_both_moments_only_while_they_wait():
    assert _ids(OWNER) == ["close-pending", "close-pending-named-other", "legacy-no-stage",
                           "start-pending", "start-rejected"]


def test_close_task_still_being_worked_or_sent_back_is_not_waiting():
    got = _ids(OWNER)
    for gone in ("close-working", "close-sent-back", "close-approved", "start-approved"):
        assert gone not in got


def test_named_approver_rule_still_applies_to_close_tasks():
    assert _ids(FIN, can_approve_any=False) == ["close-pending", "legacy-no-stage", "start-pending", "start-rejected"]

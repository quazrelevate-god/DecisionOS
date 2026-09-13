"""ASK-28 TK-02 — "Waiting for my approval": the GET /tasks?view=approvals filter.

Pure unit tests over services.tasks — no server, no database. The rule must
match routers.tasks._can_approve_task: owner approves anything; a named
approver approves tasks that name them; an `approvals` holder also approves
tasks that name nobody.
"""
import pytest

from services.tasks import task_list_query

pytestmark = pytest.mark.unit

OWNER = {"id": "u-owner", "tenant_id": "t1", "role": "owner"}
FIN = {"id": "u-fin", "tenant_id": "t1", "role": "finance"}      # holds `approvals` in some tests
SALES = {"id": "u-sales", "tenant_id": "t1", "role": "sales"}


def _matches(q, t):
    for k, v in q.items():
        if k == "$or":
            if not any(_matches(sub, t) for sub in v):
                return False
            continue
        if k == "$and":  # ASK-28 TK-05: the stage clause
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
    base = {"id": id, "tenant_id": "t1", "approval_required": True, "approval_status": "pending",
            "status": "blocked", "approver_id": None}
    base.update(kw)
    return base


TASKS = [
    T("named-fin", approver_id="u-fin"),
    T("named-sales", approver_id="u-sales"),
    T("unnamed"),
    T("unnamed-empty", approver_id=""),
    T("changes-requested", approver_id="u-fin", approval_status="rejected"),
    T("already-approved", approver_id="u-fin", approval_status="approved", status="todo"),
    T("finished", approver_id="u-fin", status="done"),
    T("cancelled", approver_id="u-fin", status="cancelled"),
    {"id": "no-approval", "tenant_id": "t1", "approval_required": False, "status": "todo", "approver_id": "u-fin"},
    T("other-tenant", tenant_id="t2", approver_id="u-fin"),
]


def _ids(user, **kw):
    q = task_list_query(user, view="approvals", **kw)
    return sorted(t["id"] for t in TASKS if _matches(q, t))


def test_owner_sees_every_waiting_approval():
    assert _ids(OWNER) == ["changes-requested", "named-fin", "named-sales", "unnamed", "unnamed-empty"]


def test_approvals_holder_sees_named_to_them_and_unnamed():
    assert _ids(FIN, can_approve_any=True) == ["changes-requested", "named-fin", "unnamed", "unnamed-empty"]


def test_named_approver_without_access_sees_only_their_own():
    assert _ids(FIN, can_approve_any=False) == ["changes-requested", "named-fin"]
    assert _ids(SALES, can_approve_any=False) == ["named-sales"]


def test_approved_finished_and_non_approval_tasks_stay_out():
    got = _ids(OWNER)
    for gone in ("already-approved", "finished", "cancelled", "no-approval", "other-tenant"):
        assert gone not in got


def test_changes_requested_still_waits_on_the_approver():
    assert "changes-requested" in _ids(FIN, can_approve_any=False)


def test_status_filter_replaces_the_open_only_default():
    q = task_list_query(OWNER, view="approvals", status="blocked")
    assert q["status"] == "blocked"


def test_mine_flag_ignored_for_approvals():
    assert task_list_query(SALES, mine=True, view="approvals") == task_list_query(SALES, mine=False, view="approvals")


def test_other_views_unchanged_by_can_approve_any():
    assert task_list_query(SALES, mine=True, can_approve_any=True) == task_list_query(SALES, mine=True)
    assert task_list_query(SALES, view="asked", can_approve_any=True) == task_list_query(SALES, view="asked")

"""ASK-28 TK-08 (plan Phase 6) — task access rules.

Pure unit tests over services.tasks and the permission list — no server, no
database.
  6.1  tasks_assign_any / tasks_view_all exist and no role gets them by default
  6.3  who a person may give work to (D1): anyone with tasks_assign_any (and the
       owner); otherwise themselves, their own team, their direct reports
  6.4  All Tasks: the owner or tasks_view_all — not finance by default
  6.7  who may CHANGE a task (item 7): helpers move it but don't finish it;
       proof only by the person who asked or the owner; See all tasks, the
       approver and strangers change nothing
"""
import pytest

from config import PERMISSION_KEYS
from core.permissions import ROLE_DEFAULT_PERMS, _BASE_PERMS, user_perms
from services.tasks import (
    can_assign_person,
    can_assign_team,
    can_see_all_tasks,
    edit_refusal,
    task_edit_rights,
    task_list_query,
)

pytestmark = pytest.mark.unit

OWNER = {"id": "u-owner", "tenant_id": "t1", "role": "owner"}
SALES = {"id": "u-sales", "tenant_id": "t1", "role": "sales"}
FIN = {"id": "u-fin", "tenant_id": "t1", "role": "finance"}
PROD = {"id": "u-prod", "role": "production"}
SALES2 = {"id": "u-sales2", "role": "sales"}
REPORT = {"id": "u-ops", "role": "operations"}


def test_new_permission_keys_exist_and_are_opt_in():
    for k in ("tasks_assign_any", "tasks_view_all"):
        assert k in PERMISSION_KEYS
        assert k not in _BASE_PERMS
        assert all(k not in set(v) for v in ROLE_DEFAULT_PERMS.values())
        for role in ("sales", "finance", "production", "operations"):
            assert k not in user_perms({"role": role}), (k, role)
        assert k in user_perms({"role": "owner"})


def test_finance_does_not_see_all_tasks_by_default():
    assert not can_see_all_tasks(FIN, user_perms(FIN))
    assert can_see_all_tasks(OWNER, user_perms(OWNER))
    granted = {**FIN, "permissions": ["tasks", "finance", "tasks_view_all"]}
    assert can_see_all_tasks(granted, user_perms(granted))


def test_assign_self_own_team_and_reports():
    perms = user_perms(SALES)
    team = ["u-ops"]
    assert can_assign_person(SALES, SALES, team, perms)
    assert can_assign_person(SALES, SALES2, team, perms)
    assert can_assign_person(SALES, REPORT, team, perms)
    assert not can_assign_person(SALES, PROD, team, perms)
    assert not can_assign_person(SALES, None, team, perms)


def test_assign_any_permission_and_owner_pass():
    anyone = {**SALES, "permissions": ["tasks", "tasks_assign_any"]}
    assert can_assign_person(anyone, PROD, [], user_perms(anyone))
    assert can_assign_team(anyone, "production", user_perms(anyone))
    assert can_assign_person(OWNER, PROD, [], user_perms(OWNER))


def test_team_manage_alone_does_not_assign_anyone():
    manager = {**SALES, "permissions": ["tasks", "team_manage"]}
    assert not can_assign_person(manager, PROD, [], user_perms(manager))


def test_route_to_own_team_only():
    perms = user_perms(SALES)
    assert can_assign_team(SALES, "sales", perms)
    assert not can_assign_team(SALES, "production", perms)
    assert not can_assign_team(SALES, None, perms)


def test_see_all_widens_the_list_query():
    lane = task_list_query(SALES, mine=False)
    everything = task_list_query(SALES, mine=False, see_all=True)
    assert "$or" in lane and "$or" not in everything
    # See all tasks drops the assignee filter, but the approvals exclusion stays:
    # a task waiting for my sign-off is in Approvals, not the task list.
    assert everything["tenant_id"] == "t1" and "$nor" in everything
    assert set(everything) == {"tenant_id", "$nor"}
    # My Tasks stays mine even with See all tasks.
    assert task_list_query(SALES, mine=True, see_all=True) == task_list_query(SALES, mine=True)


# ---------------------------------------------------------------------------
# Item 7 (plan 6.7) — who may change a task
# ---------------------------------------------------------------------------
# Priya (sales) asked Kiran (sales) to do it, with Amit (operations) helping;
# Sunita (finance) approves it; proof is needed.
TASK = {"id": "t", "created_by": "u-sales", "assignee_id": "u-sales2", "assignee_role": "sales",
        "co_assignee_ids": ["u-ops"], "status": "in_progress", "progress": 20, "priority": "medium",
        "evidence_required": True, "approver_id": "u-fin"}
MGR = {"id": "u-mgr", "role": "finance"}          # Kiran's reporting manager
ALL = {"work": True, "finish": True, "people": True, "priority": True, "proof": True}
NONE = dict.fromkeys(ALL, False)


def rights(user, t=TASK, team=()):
    return task_edit_rights(user, t, list(team), user_perms(user))


def test_edit_rights_by_who_you_are_on_the_task():
    assert rights(OWNER) == ALL
    assert rights(SALES) == ALL                                     # asked for it
    assert rights(SALES2) == {**NONE, "work": True, "finish": True}  # doer
    assert rights(REPORT) == {**NONE, "work": True}                 # helper
    assert rights(MGR, team=["u-sales2"]) == {**ALL, "proof": False}
    assert rights(FIN) == NONE                                      # approver: notes, not edits
    assert rights(PROD) == NONE
    assert rights({**PROD, "permissions": ["tasks", "tasks_view_all"]}) == NONE
    assert rights({**PROD, "permissions": ["tasks", "team_manage"]}) == {**NONE, "people": True}


def test_same_team_colleague_is_not_the_doer_unless_nobody_picked_it_up():
    colleague = {"id": "u-sales3", "role": "sales"}
    assert rights(colleague) == NONE
    team_task = {**TASK, "assignee_id": None, "co_assignee_ids": []}
    assert rights(colleague, team_task) == {**NONE, "work": True, "finish": True}


def test_helper_moves_the_work_but_does_not_finish_it():
    r = rights(REPORT)
    assert edit_refusal(TASK, {"status": "todo"}, r) is None
    assert edit_refusal(TASK, {"progress": 60}, r) is None
    assert edit_refusal(TASK, {"waiting_on": {"name": "Kumar Fabrics"}}, r) is None
    assert "mark this task done" in edit_refusal(TASK, {"status": "done"}, r)
    assert "cancel this task" in edit_refusal(TASK, {"status": "cancelled"}, r)
    done = {**TASK, "status": "done"}
    assert "reopen this task" in edit_refusal(done, {"status": "in_progress"}, rights(REPORT, done))
    assert edit_refusal(done, {"status": "in_progress"}, rights(SALES2, done)) is None


def test_proof_only_by_the_person_who_asked_or_the_owner():
    off = {"evidence_required": False}
    assert "proof" in edit_refusal(TASK, off, rights(SALES2))
    assert "proof" in edit_refusal(TASK, off, rights(MGR, team=["u-sales2"]))
    assert edit_refusal(TASK, off, rights(SALES)) is None
    assert edit_refusal(TASK, off, rights(OWNER)) is None


def test_people_and_priority_belong_to_whoever_runs_the_task():
    for change in ({"assignee_id": "u-ops"}, {"co_assignee_ids": []}, {"assignee_role": "operations"}):
        assert "who is on this task" in edit_refusal(TASK, change, rights(SALES2)), change
        assert edit_refusal(TASK, change, rights(SALES)) is None
    admin = {**PROD, "permissions": ["tasks", "team_manage"]}
    assert edit_refusal(TASK, {"co_assignee_ids": []}, rights(admin)) is None
    assert "priority" in edit_refusal(TASK, {"priority": "high"}, rights(admin))
    assert "priority" in edit_refusal(TASK, {"priority": "high"}, rights(SALES2))


def test_unchanged_values_need_no_right_but_strangers_change_nothing():
    assert edit_refusal(TASK, {"priority": "medium", "co_assignee_ids": ["u-ops"]}, rights(SALES2)) is None
    assert edit_refusal(TASK, {}, rights(PROD)) is None
    assert "leave a note" in edit_refusal(TASK, {"status": "in_progress"}, rights(PROD))
    assert "leave a note" in edit_refusal(TASK, {"status": "todo"}, rights(FIN))

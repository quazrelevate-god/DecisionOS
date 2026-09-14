"""ASK-28 TK-08 (plan Phase 6) — task access rules.

Pure unit tests over services.tasks and the permission list — no server, no
database.
  6.1  tasks_assign_any / tasks_view_all exist and no role gets them by default
  6.3  who a person may give work to (D1): anyone with tasks_assign_any (and the
       owner); otherwise themselves, their own team, their direct reports
  6.4  All Tasks: the owner or tasks_view_all — not finance by default
"""
import pytest

from config import PERMISSION_KEYS
from core.permissions import ROLE_DEFAULT_PERMS, _BASE_PERMS, user_perms
from services.tasks import (
    can_assign_person,
    can_assign_team,
    can_see_all_tasks,
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
    assert everything == {"tenant_id": "t1"}
    # My Tasks stays mine even with See all tasks.
    assert task_list_query(SALES, mine=True, see_all=True) == task_list_query(SALES, mine=True)

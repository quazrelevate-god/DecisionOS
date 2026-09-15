"""ASK-28 TK-03 — "My team": the GET /tasks?view=team filter and the manager rule.

Pure unit tests over services.tasks — no server, no database. A manager is
anyone named as Reporting Manager on a user; their team is those direct
reports. My team holds every task a report is doing or helping on.
"""
import pytest

from services.tasks import can_note_task, manages_task, task_list_query

pytestmark = pytest.mark.unit

MGR = {"id": "u-mgr", "tenant_id": "t1", "role": "finance"}
TEAM = ["u-r1", "u-r2"]


def _matches(q, t):
    for k, v in q.items():
        if k == "$or":
            if not any(_matches(sub, t) for sub in v):
                return False
            continue
        have = t.get(k)
        if isinstance(v, dict):
            if "$in" in v:
                vals = have if isinstance(have, list) else [have]
                if not any(x in v["$in"] for x in vals):
                    return False
            if "$ne" in v and have == v["$ne"]:
                return False
        elif have != v:
            return False
    return True


def T(id, **kw):
    base = {"id": id, "tenant_id": "t1", "status": "todo", "assignee_id": None, "co_assignee_ids": []}
    base.update(kw)
    return base


TASKS = [
    T("report-doing", assignee_id="u-r1"),
    T("report-helping", assignee_id="u-x", co_assignee_ids=["u-y", "u-r2"]),
    T("report-done", assignee_id="u-r2", status="done"),
    T("not-my-team", assignee_id="u-x", co_assignee_ids=["u-y"]),
    T("mine-only", assignee_id="u-mgr"),
    T("team-pool", assignee_role="finance"),
    T("other-tenant", tenant_id="t2", assignee_id="u-r1"),
]


def _ids(user, **kw):
    q = task_list_query(user, view="team", **kw)
    return sorted(t["id"] for t in TASKS if _matches(q, t))


def test_team_holds_what_my_reports_do_or_help_on():
    assert _ids(MGR, team_ids=TEAM) == ["report-doing", "report-done", "report-helping"]


def test_no_reports_means_an_empty_team():
    assert _ids(MGR, team_ids=[]) == []
    assert _ids(MGR) == []


def test_blank_ids_do_not_widen_the_team():
    assert _ids(MGR, team_ids=["", None]) == []


def test_other_people_my_own_and_pool_tasks_stay_out():
    got = _ids(MGR, team_ids=TEAM)
    for gone in ("not-my-team", "mine-only", "team-pool", "other-tenant"):
        assert gone not in got


def test_status_filter_applies_on_team():
    assert _ids(MGR, team_ids=TEAM, status="done") == ["report-done"]


def test_mine_flag_ignored_for_team():
    assert task_list_query(MGR, mine=True, view="team", team_ids=TEAM) == task_list_query(MGR, view="team", team_ids=TEAM)


def test_manages_task_doer_or_helper():
    assert manages_task(T("a", assignee_id="u-r1"), TEAM)
    assert manages_task(T("a", assignee_id="u-x", co_assignee_ids=["u-r2"]), TEAM)
    assert not manages_task(T("a", assignee_id="u-x"), TEAM)
    assert not manages_task(T("a", assignee_id="u-r1"), [])
    assert not manages_task(T("a"), ["", None])


def test_manager_may_note_but_not_work():
    t = T("a", assignee_id="u-r1", assignee_role="sales", created_by="u-owner")
    assert not can_note_task(MGR, t)
    assert can_note_task(MGR, t, manages=manages_task(t, TEAM))


def test_other_views_unchanged_by_team_ids():
    assert task_list_query(MGR, view="asked", team_ids=TEAM) == task_list_query(MGR, view="asked")
    assert task_list_query(MGR, mine=True, team_ids=TEAM) == task_list_query(MGR, mine=True)

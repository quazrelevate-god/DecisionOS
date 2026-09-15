"""ASK-28 TK-01 — "Asked by me": the GET /tasks filter and who may leave a note.

Pure unit tests over services.tasks — no server, no database.
"""
import pytest

from services.tasks import _can_work_task, can_note_task, task_list_query

pytestmark = pytest.mark.unit

OWNER = {"id": "u-owner", "tenant_id": "t1", "role": "owner"}
SALES = {"id": "u-sales", "tenant_id": "t1", "role": "sales"}
PROD = {"id": "u-prod", "tenant_id": "t1", "role": "production"}


def _matches(q, t):
    """Tiny evaluator for the operators task_list_query emits."""
    for k, v in q.items():
        if k == "$or":
            if not any(_matches(sub, t) for sub in v):
                return False
            continue
        have = t.get(k)
        if isinstance(v, dict) and "$ne" in v:
            if isinstance(have, list):
                if v["$ne"] in have:
                    return False
            elif have == v["$ne"]:
                return False
        elif have != v:
            return False
    return True


TASKS = [
    {"id": "a", "tenant_id": "t1", "created_by": "u-sales", "assignee_id": "u-prod", "co_assignee_ids": []},
    {"id": "b", "tenant_id": "t1", "created_by": "u-sales", "assignee_id": "u-sales", "co_assignee_ids": []},
    {"id": "c", "tenant_id": "t1", "created_by": "u-sales", "assignee_id": "u-prod", "co_assignee_ids": ["u-sales"]},
    {"id": "d", "tenant_id": "t1", "created_by": "u-sales", "assignee_id": None, "assignee_role": "production"},
    {"id": "e", "tenant_id": "t1", "created_by": "u-prod", "assignee_id": "u-sales", "co_assignee_ids": []},
    {"id": "f", "tenant_id": "t2", "created_by": "u-sales", "assignee_id": "u-prod", "co_assignee_ids": []},
    {"id": "g", "tenant_id": "t1", "created_by": "u-sales", "assignee_id": "u-prod"},
]


def _ids(user, **kw):
    q = task_list_query(user, **kw)
    return sorted(t["id"] for t in TASKS if _matches(q, t))


def test_asked_lists_what_i_created_for_others():
    # a: for production. d: for the production team. g: old task with no helper list.
    assert _ids(SALES, view="asked") == ["a", "d", "g"]


def test_asked_leaves_out_my_own_and_helper_tasks():
    got = _ids(SALES, view="asked")
    assert "b" not in got  # I'm the doer
    assert "c" not in got  # I'm a helper on it
    assert "e" not in got  # someone else created it


def test_asked_stays_in_tenant():
    assert "f" not in _ids(SALES, view="asked")


def test_asked_ignores_mine_flag():
    assert task_list_query(SALES, mine=True, view="asked") == task_list_query(SALES, mine=False, view="asked")


def test_asked_keeps_status_filter():
    q = task_list_query(SALES, view="asked", status="todo")
    assert q["status"] == "todo" and q["created_by"] == "u-sales"


def test_owner_asked_is_scoped_too():
    q = task_list_query(OWNER, view="asked")
    assert q["created_by"] == "u-owner" and "$or" not in q


def test_mine_unchanged():
    assert task_list_query(SALES, mine=True) == {
        "tenant_id": "t1",
        "$or": [{"assignee_id": "u-sales"}, {"co_assignee_ids": "u-sales"},
                {"assignee_id": None, "assignee_role": "sales"}],
    }


def test_non_owner_board_unchanged():
    assert task_list_query(SALES, mine=False) == {
        "tenant_id": "t1",
        "$or": [{"assignee_id": "u-sales"}, {"co_assignee_ids": "u-sales"}, {"assignee_role": "sales"}],
    }


def test_owner_all_unchanged():
    assert task_list_query(OWNER, mine=False) == {"tenant_id": "t1"}


def test_unknown_view_behaves_like_before():
    assert task_list_query(SALES, mine=True, view="nonsense") == task_list_query(SALES, mine=True)


def test_creator_may_note_but_not_work():
    t = TASKS[0]  # sales asked production
    assert can_note_task(SALES, t) is True
    assert not _can_work_task(SALES, t)  # falsy (it returns None, not False)


def test_doer_and_owner_may_note():
    t = TASKS[0]
    assert can_note_task(PROD, t) is True
    assert can_note_task(OWNER, t) is True


def test_stranger_may_not_note():
    stranger = {"id": "u-fin", "tenant_id": "t1", "role": "finance"}
    assert can_note_task(stranger, TASKS[0]) is False

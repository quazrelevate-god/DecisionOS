"""The operating score stops counting today as late, and stops inventing 70s
(PILOT-1 D, 2026-09-21).

The pilot client: "Overall operating score calculation is wrong." Two defects
could be proven without asking them which number looked wrong:

1. A task due TODAY counted as OVERDUE all day. `now` was a UTC timestamp and a
   due date is "YYYY-MM-DD"; compared as strings, "2026-09-21" <
   "2026-09-21T08:55…" is true. It pulled down the company score, every
   person's score, the self view and compute_employee_stats. Now one rule for
   "late" (shared/due.py) — the screens' own (ASK-29) — is used everywhere a
   count is made, the Desk's Delayed and On fire included.
2. A category with nothing to measure scored 70 (Finance with no invoices,
   "Sales" with no decisions), or a free 100 (Responsiveness with no
   complaints and no open work). That invented up to 45% of the overall for a
   company that had not used those parts yet. Now it is left out — the same
   way Finance already was for someone who cannot see money — and the weights
   re-balance over what is left.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

from tests.e2e_harness import e2e_env

IST = timezone(timedelta(hours=5, minutes=30))
# 14:25 in India on 21 September.
NOW_DT = datetime(2026, 9, 21, 8, 55, tzinfo=timezone.utc)
NOW = NOW_DT.isoformat()
TODAY, YESTERDAY, TOMORROW = "2026-09-21", "2026-09-20", "2026-09-22"


# ------------------------------------------------------------ the one rule
def test_a_bare_day_is_late_only_from_the_next_day():
    from shared.due import is_overdue
    assert is_overdue(TODAY, NOW) is False, "due today is not late on the day it is due"
    assert is_overdue(YESTERDAY, NOW) is True
    assert is_overdue(TOMORROW, NOW) is False


def test_a_day_with_an_hour_is_late_once_that_hour_has_passed_in_india():
    from shared.due import is_overdue
    assert is_overdue(f"{TODAY}T10:00:00", NOW) is True      # 10:00 IST, it is 14:25
    assert is_overdue(f"{TODAY}T17:00:00", NOW) is False


def test_the_day_is_indias_not_utcs():
    """At 01:30 IST on the 22nd it is still the 21st in UTC. A task due the
    21st is late in India; comparing by UTC's date would say it is not."""
    from shared.due import is_overdue
    early = datetime(2026, 9, 21, 20, 0, tzinfo=timezone.utc)   # 01:30 IST on the 22nd
    assert is_overdue(TODAY, early) is True


def test_no_date_is_never_late():
    from shared.due import is_overdue
    assert is_overdue(None, NOW) is False and is_overdue("", NOW) is False


# ------------------------------------------- the score's own calculators
def test_execution_does_not_count_today_as_overdue():
    from services.operating_score import _score_execution
    score, done, open_tasks, overdue, actionable = _score_execution(
        [{"status": "todo", "due_date": TODAY}, {"status": "done"}], NOW)
    assert overdue == 0
    assert score == 50, "one of two done, nothing late: 50, not 30"


def test_each_persons_score_does_not_count_today_as_overdue():
    from services.operating_score import _score_employees
    members = [{"id": "u1", "name": "Priya", "role": "sales"}]
    tasks = [{"assignee_id": "u1", "status": "todo", "due_date": TODAY},
             {"assignee_id": "u1", "status": "done"}]
    (priya,) = _score_employees(tasks, members, NOW)
    assert priya["overdue"] == 0 and priya["score"] == 50


def test_execution_with_nothing_to_measure_is_left_out():
    from services.operating_score import _score_execution
    assert _score_execution([], NOW)[0] is None


def test_sales_with_no_decisions_is_left_out():
    from services.operating_score import _score_sales
    assert _score_sales([])[0] is None


# ------------------------------------------------ the whole company view
TENANT = "t-score"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
MEMBER = {"id": "u-sales", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}


def _view(with_test_db, *, tasks=(), decisions=(), invoices=(), payments=(), complaints=(), viewer=OWNER):
    async def scenario(db):
        import services.operating_score as ops
        with e2e_env(db):
            await db.users.insert_many([
                {"id": OWNER["id"], "tenant_id": TENANT, "name": "Rajesh", "role": "owner"},
                {"id": MEMBER["id"], "tenant_id": TENANT, "name": "Priya", "role": "sales"},
            ])
            for coll, rows in (("tasks", tasks), ("decisions", decisions), ("invoices", invoices),
                               ("payments", payments), ("complaints", complaints)):
                if rows:
                    await db[coll].insert_many([{"tenant_id": TENANT, **r} for r in rows])
            return await ops._company_operating_view(TENANT, viewer, NOW)

    return with_test_db(scenario)


def _task(i, **kw):
    return {"id": f"t{i}", "assignee_id": MEMBER["id"], "assignee_role": "sales", **kw}


pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)


def test_a_company_with_only_tasks_is_scored_on_its_tasks(with_test_db):
    """The client's first weeks: tasks, no invoices, no decisions, no complaints.
    The overall IS the execution score — nothing invented beside it."""
    tasks = [_task(1, status="done"), _task(2, status="done"), _task(3, status="todo", due_date=TODAY),
             _task(4, status="todo", due_date=TOMORROW)]
    out = _view(with_test_db, tasks=tasks)
    cats = out["company"]["categories"]
    assert cats["execution"] == 50
    assert cats["finance"] is None and cats["sales"] is None
    assert cats["responsiveness"] == 100, "open work with nothing late: its loops are closed"
    # 0.35·50 + 0.20·100 over the 0.55 of weight that has data
    assert out["company"]["overall"] == round((0.35 * 50 + 0.2 * 100) / 0.55)
    assert out["stats"]["overdue"] == 0, "the task due today is not late"


def test_the_screen_is_told_why_a_category_has_no_number(with_test_db):
    tasks = [_task(1, status="done"), _task(2, status="todo", due_date=TOMORROW), _task(3, status="done")]
    owner = _view(with_test_db, tasks=tasks)
    assert owner["company"]["unscored"] == {"finance": "no_data", "sales": "no_data"}
    member = _view(with_test_db, tasks=tasks, viewer=MEMBER)
    assert member["company"]["unscored"]["finance"] == "no_access"


def test_an_invoice_due_today_is_not_overdue(with_test_db):
    out = _view(with_test_db,
                tasks=[_task(1, status="done"), _task(2, status="done"), _task(3, status="done")],
                invoices=[{"id": "i1", "type": "sales_invoice", "amount": 100000, "status": "unpaid", "due_date": TODAY}],
                payments=[{"id": "p1", "direction": "in", "amount": 50000}])
    assert out["company"]["categories"]["finance"] == 50, "half collected, nothing late: 50, not 45"


def test_nothing_to_measure_anywhere_is_no_score(with_test_db):
    out = _view(with_test_db)
    assert out["company"]["overall"] is None
    assert all(v is None for v in out["company"]["categories"].values())


# --------------------------------------- the Desk counts late the same way
def test_the_desks_delayed_count_uses_the_same_rule(with_test_db):
    async def scenario(db):
        import routers.desk as rd
        import shared.due as due
        with e2e_env(db):
            await db.tasks.insert_many([{"tenant_id": TENANT, **t} for t in (
                _task(1, status="todo", due_date=YESTERDAY),              # late
                _task(2, status="todo", due_date=TODAY),                  # due today, not late
                _task(3, status="todo", due_date=f"{TODAY}T10:00:00"),    # its hour has passed: late
                _task(4, status="todo", due_date=f"{TODAY}T23:00:00"),    # later today: not late
                _task(5, status="done", due_date=YESTERDAY),              # finished
            )])
            real = due.as_instant
            due.as_instant = lambda now=None: real(now or NOW_DT)
            try:
                return await rd._delayed_count(TENANT, OWNER)
            finally:
                due.as_instant = real

    assert with_test_db(scenario) == 2

"""Routines from the Decision Desk, and routines started later (Epic 11 Sprint 4,
NF-4.22 / NF-4.23, founder 2026-10-31).

"They always just go create a task by the Decision Desk" — and the Desk had no
notion of a repeat: "check the stock every Monday" became a one-off task. Only
New Task could make a routine, and only at the moment it was made; afterwards
the one thing a task's drawer offered was "Stop repeating".

  NF-4.22  the Desk hears a cadence (the model's "repeat", else the task's own
           words), shows it on the review, lets the reviewer change it, and
           approving makes a repeating task like New Task's.
  NF-4.23  a task that exists can be made to repeat, or have its cadence
           changed, by the people who may move its date.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-routine"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
DOER = {"id": "u-doer", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": ["tasks"]}


def _quiet(*a, **k):
    return None


async def _quiet_async(*a, **k):
    return None


async def _roles(tenant_id, *a, **k):
    return ["owner", "sales", "finance"]


STUBS = {"services.notifications.push_notification": _quiet_async,
         "services.auto_plan.schedule": _quiet,
         "routers.tasks.tenant_role_keys": _roles}


def _env(db):
    return e2e_env(db, stubs=STUBS, keep={"core.add_decision_event"})


async def _seed(db):
    await db.tenants.insert_one({"id": T, "company_name": "Rajesh Traders", "roles": [
        {"key": "sales", "label": "Sales"}, {"key": "finance", "label": "Finance"}]})
    for p, boss in ((OWNER, None), (DOER, "u-owner")):
        await db.users.insert_one({"id": p["id"], "tenant_id": T, "role": p["role"], "name": p["name"],
                                   "reporting_manager_id": boss, "email": f"{p['id']}@t.test"})
        await db.memberships.insert_one({"id": f"m-{p['id']}", "tenant_id": T, "user_id": p["id"],
                                         "role": p["role"], "status": "active"})


def _today_ist():
    from shared.due import IST
    return datetime.now(timezone.utc).astimezone(IST).date()


async def _refused(coro, status):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


class _Bg:
    def add_task(self, *a, **k):
        pass


# ═══════════════════════ 1 · a cadence in words ═════════════════════════════
@pytest.mark.parametrize("words, every, n, first", [
    ("Check stock every Monday", "week", 1, "2026-11-02"),      # 31 Oct 2026 is a Saturday
    ("Count stock on Mondays", "week", 1, "2026-11-02"),
    ("Each Friday send the sales summary", "week", 1, "2026-11-06"),
    ("Payroll every other Friday", "week", 2, "2026-11-06"),
    ("Send the weekly report", "week", 1, None),
    ("Fortnightly review with the CA", "week", 2, None),
    ("Every 2 weeks clean the machines", "week", 2, None),
    ("Daily cash count", "day", 1, None),
    ("Lock the godown every evening", "day", 1, None),
    ("File GST on the 20th of every month", "month", 1, "2026-11-20"),
    ("Every month on the 5th pay the salary", "month", 1, "2026-11-05"),
    ("Pay rent monthly", "month", 1, None),
    ("Quarterly stock audit", "month", 3, None),
    ("Every 3 months service the generator", "month", 3, None),
])
def test_a_cadence_said_in_words_is_heard(words, every, n, first):
    from datetime import date
    from services.recurrence import from_words
    assert from_words(words, date(2026, 10, 31)) == {"every": every, "interval": n, "first": first}


@pytest.mark.parametrize("words", [
    "Call Ravi on Monday",                 # one Monday
    "Visit every customer in Erode",       # "every" with no time unit
    "Send the pro-forma by Friday",
    "Book the courier",
    "",
])
def test_one_off_work_is_not_made_a_routine(words):
    from datetime import date
    from services.recurrence import from_words
    assert from_words(words, date(2026, 10, 31)) is None


def test_the_5th_already_gone_this_month_means_next_month():
    from datetime import date
    from services.recurrence import from_words
    assert from_words("Pay salary on the 5th of every month", date(2026, 10, 5))["first"] == "2026-10-05", \
        "today is the 5th: today"
    assert from_words("Pay salary on the 5th of every month", date(2026, 10, 6))["first"] == "2026-11-05"


def test_the_models_repeat_wins_and_the_words_name_the_day():
    from services.voice import task_repeat
    # The model said weekly; the words say which day.
    r = task_repeat({"title": "Check stock every Monday", "repeat": "week"})
    assert r["every"] == "week" and r["interval"] == 1 and r["first"]
    assert datetime.strptime(r["first"], "%Y-%m-%d").weekday() == 0
    # The model said every 2 weeks with nothing in the words.
    assert task_repeat({"title": "Review the books", "repeat": "week", "repeat_interval": 2}) == \
        {"every": "week", "interval": 2, "first": None}
    # The model missed it; the words did not.
    assert task_repeat({"title": "Send the weekly report"})["every"] == "week"
    # Nonsense from the model is ignored, not stored.
    assert task_repeat({"title": "Call Ravi", "repeat": "yearly"}) is None
    assert task_repeat({"title": "Call Ravi", "repeat": None}) is None


# ═══════════════════════ 2 · the Desk's proposal ═════════════════════════════
def test_the_proposal_carries_the_routine_and_its_first_day(with_test_db):
    async def scenario(db):
        from services.voice import build_proposal
        await _seed(db)
        with _env(db):
            return await build_proposal(T, {"tasks": [
                {"title": "Check stock every Monday", "assignee_name": "Priya", "due_in_days": None},
                {"title": "Send the weekly report", "assignee_name": "Priya", "due_in_days": 2},
                {"title": "Pay rent", "assignee_name": "Priya", "repeat": "month", "due_on": None},
                {"title": "Call Ravi on Monday", "assignee_name": "Priya", "due_in_days": 2},
            ]}, ["owner", "sales"], [{"id": DOER["id"], "name": "Priya", "role": "sales"}], set(), [])
    p = with_test_db(scenario)
    t = {x["title"]: x for x in p["tasks"]}
    today = _today_ist()
    monday = t["Check stock every Monday"]
    assert (monday["repeat_every"], monday["repeat_interval"]) == ("week", 1)
    assert datetime.strptime(monday["due_date"], "%Y-%m-%d").weekday() == 0, "the series starts on a Monday"
    assert 0 <= (datetime.strptime(monday["due_date"], "%Y-%m-%d").date() - today).days <= 6
    weekly = t["Send the weekly report"]
    assert weekly["repeat_every"] == "week" and weekly["due_date"] == (today + timedelta(days=2)).isoformat(), \
        "a cadence with no day keeps the date that was said"
    rent = t["Pay rent"]
    assert rent["repeat_every"] == "month" and rent["due_date"] == today.isoformat(), \
        "a routine with no date said starts today — the date is what repeats"
    assert "repeat_every" not in t["Call Ravi on Monday"], "one Monday is not a routine"


def _decision(tasks):
    return {"id": "dec-r", "tenant_id": T, "title": "Weekly checks", "status": "pending_approval",
            "created_by": OWNER["id"], "source": "voice", "task_ids": [], "created_at": "2026-10-31T08:00:00+00:00",
            "proposal": {"tasks": tasks, "workflows": [], "meetings": [], "reminders": [], "memory_notes": []}}


def test_the_reviewer_can_change_the_routine_or_make_it_a_one_off(with_test_db):
    async def scenario(db):
        from services.decision_flow import edit_proposal_task
        await _seed(db)
        await db.decisions.insert_one(_decision([
            {"key": "k1", "title": "Count the stock", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": None},
            {"key": "k2", "title": "Send the weekly report", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": "2026-11-03", "repeat_every": "week", "repeat_interval": 1},
        ]))
        out = {}
        with _env(db):
            d = await edit_proposal_task(OWNER, "dec-r", "k1", repeat_every="week", repeat_interval=2)
            out["made"] = next(t for t in d["proposal"]["tasks"] if t["key"] == "k1")
            d = await edit_proposal_task(OWNER, "dec-r", "k2", repeat_every="")
            out["once"] = next(t for t in d["proposal"]["tasks"] if t["key"] == "k2")
            out["bad"] = await _refused(edit_proposal_task(OWNER, "dec-r", "k1", repeat_every="year"), 400)
            out["timeline"] = [e.get("label") for e in (await db.decisions.find_one({"id": "dec-r"})).get("timeline") or []]
        return out
    out = with_test_db(scenario)
    made = out["made"]
    assert (made["repeat_every"], made["repeat_interval"]) == ("week", 2)
    assert made["due_date"] == _today_ist().isoformat(), "a cadence with no date takes today"
    assert "repeat_every" not in out["once"] and "repeat_interval" not in out["once"]
    assert "not 'year'" in out["bad"]
    joined = "\n".join(x for x in out["timeline"] if x)
    assert "repeats every 2 weeks" in joined and "just once" in joined


def test_approving_makes_a_repeating_task_and_finishing_it_brings_the_next(with_test_db, monkeypatch):
    monkeypatch.setattr("shared.due.today_ist", lambda now=None: "2026-11-02")

    async def scenario(db):
        from services.decision_flow import approve_decision_flow
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        await _seed(db)
        await db.decisions.insert_one(_decision([
            {"key": "k1", "title": "Check stock every Monday", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": "2026-11-02", "repeat_every": "week", "repeat_interval": 1},
            {"key": "k2", "title": "Call Ravi", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": "2026-11-02"},
        ]))
        with _env(db):
            await approve_decision_flow(OWNER, "dec-r")
            made = {t["title"]: t for t in await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(10)}
            await rt.update_task(made["Check stock every Monday"]["id"], TaskUpdateInput(status="done"), user=OWNER)
            rows = await db.tasks.find({"tenant_id": T, "title": "Check stock every Monday"}, {"_id": 0}).to_list(10)
        return made, rows
    made, rows = with_test_db(scenario)
    first = made["Check stock every Monday"]
    assert first["recurrence"]["every"] == "week" and first["recurrence"]["interval"] == 1
    assert first["recurrence"]["series_id"] == first["id"] == first["series_id"]
    assert first["decision_id"] == "dec-r"
    assert made["Call Ravi"].get("recurrence") is None, "a one-off stays a one-off"
    assert len(rows) == 2, "closing it brought exactly one more"
    nxt = next(r for r in rows if r["id"] != first["id"])
    assert nxt["due_date"] == "2026-11-09" and nxt["series_id"] == first["id"] and nxt["status"] == "todo"
    assert nxt["assignee_id"] == DOER["id"]


def test_a_routine_left_without_a_date_on_the_proposal_still_gets_one_on_approval(with_test_db):
    async def scenario(db):
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        await db.decisions.insert_one(_decision([
            {"key": "k1", "title": "Daily cash count", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": None, "repeat_every": "day", "repeat_interval": 1}]))
        with _env(db):
            await approve_decision_flow(OWNER, "dec-r")
            return await db.tasks.find_one({"tenant_id": T}, {"_id": 0})
    t = with_test_db(scenario)
    assert t["recurrence"]["every"] == "day" and t["due_date"] == _today_ist().isoformat()


# ═══════════════════════ 3 · a task that exists ══════════════════════════════
async def _a_task(db, tid="tk-1", **extra):
    doc = {"id": tid, "tenant_id": T, "title": "Count the stock", "assignee_id": DOER["id"],
           "assignee_role": "sales", "priority": "medium", "status": "todo", "due_date": "2026-11-02",
           "created_by": OWNER["id"], "source": "manual", "created_at": "2026-10-31T09:00:00+00:00"}
    doc.update(extra)
    await db.tasks.insert_one(doc)


def test_an_existing_task_can_be_made_to_repeat_and_its_cadence_changed(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput as U
        await _seed(db)
        await _a_task(db)
        with _env(db):
            a = await rt.update_task("tk-1", U(repeat_every="week", repeat_interval=2), user=OWNER)
            b = await rt.update_task("tk-1", U(repeat_interval=1), user=OWNER)
            c = await rt.update_task("tk-1", U(repeat_every="month"), user=OWNER)
            d = await rt.update_task("tk-1", U(repeat_every=""), user=OWNER)
        return a, b, c, d
    a, b, c, d = with_test_db(scenario)
    assert a["recurrence"] == {"every": "week", "interval": 2, "until": None, "series_id": "tk-1"}
    assert a["series_id"] == "tk-1"
    assert b["recurrence"]["every"] == "week" and b["recurrence"]["interval"] == 1, "only what was sent changes"
    assert c["recurrence"]["every"] == "month" and c["recurrence"]["series_id"] == "tk-1", "the same series"
    assert d.get("recurrence") is None, "'' makes it a one-off again"


def test_a_task_made_to_repeat_later_brings_the_next_when_done(with_test_db, monkeypatch):
    monkeypatch.setattr("shared.due.today_ist", lambda now=None: "2026-11-02")

    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput as U
        await _seed(db)
        await _a_task(db)
        with _env(db):
            await rt.update_task("tk-1", U(repeat_every="week"), user=OWNER)
            await rt.update_task("tk-1", U(status="done"), user=OWNER)
            return await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(10)
    rows = with_test_db(scenario)
    assert len(rows) == 2
    nxt = next(r for r in rows if r["id"] != "tk-1")
    assert nxt["due_date"] == "2026-11-09" and nxt["series_id"] == "tk-1" and nxt["source"] == "recurring"


def test_a_routine_needs_a_date_and_an_open_task(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput as U
        await _seed(db)
        await _a_task(db, "tk-undated", due_date=None)
        await _a_task(db, "tk-done", status="done")
        with _env(db):
            no_date = await _refused(rt.update_task("tk-undated", U(repeat_every="week"), user=OWNER), 400)
            dated_now = await rt.update_task("tk-undated", U(repeat_every="week", due_date="2026-11-04"), user=OWNER)
            done = await _refused(rt.update_task("tk-done", U(repeat_every="week"), user=OWNER), 400)
            bad = await _refused(rt.update_task("tk-done", U(repeat_every="fortnight"), user=OWNER), 400)
        return no_date, dated_now, done, bad
    no_date, dated_now, done, bad = with_test_db(scenario)
    assert "due date first" in no_date
    assert dated_now["recurrence"]["every"] == "week", "a date sent with the cadence is enough"
    assert "finished" in done
    assert "not 'fortnight'" in bad


def test_only_the_people_who_may_move_its_date_change_how_often_it_repeats(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput as U
        await _seed(db)
        await _a_task(db)
        await _a_task(db, "tk-routine", recurrence={"every": "week", "interval": 1, "until": None,
                                                     "series_id": "tk-routine"}, series_id="tk-routine")
        with _env(db):
            start = await _refused(rt.update_task("tk-1", U(repeat_every="week"), user=DOER), 403)
            stop = await _refused(rt.update_task("tk-routine", U(stop_repeating=True), user=DOER), 403)
            same = await rt.update_task("tk-routine", U(progress=50), user=DOER)
        return start, stop, same
    start, stop, same = with_test_db(scenario)
    assert "how often this task repeats" in start
    assert "how often this task repeats" in stop, "stopping a routine is the same promise"
    assert same["recurrence"]["every"] == "week", "the doer still works the task; the routine is untouched"


def test_a_routine_said_about_work_that_is_already_there_makes_that_task_the_routine(with_test_db):
    """Dex found the task already on someone's list ("Use that task", audit C-14):
    the cadence goes onto it — no twin, and no routine lost."""
    async def scenario(db):
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        await _a_task(db, "tk-old", title="Count the stock", due_date="2026-11-02")
        await _a_task(db, "tk-weekly", title="Send the report", due_date="2026-11-02",
                      recurrence={"every": "week", "interval": 1, "until": None, "series_id": "tk-weekly"},
                      series_id="tk-weekly")
        await db.decisions.insert_one(_decision([
            {"key": "k1", "title": "Count the stock every Monday", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": "2026-11-02", "repeat_every": "week", "repeat_interval": 1,
             "existing": {"id": "tk-old", "title": "Count the stock"}, "use_existing": True},
            {"key": "k2", "title": "Send the report", "assignee_id": DOER["id"], "assignee_role": "sales",
             "priority": "medium", "due_date": "2026-11-02",
             "existing": {"id": "tk-weekly", "title": "Send the report"}, "use_existing": True},
        ]))
        with _env(db):
            await approve_decision_flow(OWNER, "dec-r")
            return ({t["id"]: t for t in await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(10)})
    rows = with_test_db(scenario)
    assert len(rows) == 2, "no twin was made"
    assert rows["tk-old"]["recurrence"] == {"every": "week", "interval": 1, "until": None, "series_id": "tk-old"}
    assert rows["tk-old"]["series_id"] == "tk-old"
    assert rows["tk-weekly"]["recurrence"]["every"] == "week", "a decision silent about the cadence keeps the routine"

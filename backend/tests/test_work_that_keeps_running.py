"""Work that comes back, work that waits, and warning before a deadline.

Phase D of docs/WORKFLOW_OPERATIONS_PLAN.md — the three things that stop a
company's operations needing a person to remember them:

  D1  a task can repeat, and finishing one brings the next
  D2  the people on a task hear BEFORE its date, not only after
  D3  a task can wait on another task, and opens by itself

Yokesh's framing: "the workflow should be continuous."
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

TENANT = "t-ops"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
DOER = {"id": "u-doer", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}


async def _roles(tenant_id, *a, **k):
    return ["owner", "sales", "finance", "production"]


async def _no_pick(tenant_id, role, *a, **k):
    return None


def _env(testdb, keep=()):
    return e2e_env(testdb, stubs={
        "routers.tasks.tenant_role_keys": _roles,
        "services.voice.pick_least_loaded_member": _no_pick,
    }, keep=keep)


async def _people(db):
    await db.users.insert_many([
        {"id": OWNER["id"], "tenant_id": TENANT, "name": "Rajesh", "role": "owner"},
        {"id": DOER["id"], "tenant_id": TENANT, "name": "Priya", "role": "sales"},
    ])


def _create(**kw):
    from models.tasks import TaskCreateInput
    return TaskCreateInput(**kw)


def _update(**kw):
    from models.tasks import TaskUpdateInput
    return TaskUpdateInput(**kw)


class _Bg:
    """BackgroundTasks stand-in — nothing here schedules background work."""
    def add_task(self, *a, **k):
        pass


# ═══════════════════════════ D1 · the maths ════════════════════════════════
def test_a_weekly_task_lands_on_the_same_weekday():
    from services.recurrence import next_due
    assert next_due("2026-09-21", "week", 1) == "2026-09-28"
    assert next_due("2026-09-21", "week", 2) == "2026-10-05"


def test_a_daily_task_and_its_hour_survive_together():
    from services.recurrence import next_due
    assert next_due("2026-09-21T17:30:00", "day", 1) == "2026-09-22T17:30:00"


def test_a_month_end_routine_stays_on_month_end():
    """31 January repeats on 28 February, not on 3 March. Drifting forward
    would move a month-end routine off month end permanently, and "monthly on
    the 31st" means month end to the person who typed it."""
    from services.recurrence import next_due
    assert next_due("2026-01-31", "month", 1) == "2026-02-28"
    assert next_due("2026-03-31", "month", 1) == "2026-04-30"
    assert next_due("2028-01-31", "month", 1) == "2028-02-29", "and a leap year is a leap year"
    assert next_due("2026-11-30", "month", 2) == "2027-01-30", "across a year boundary"


def test_a_cadence_we_do_not_understand_is_refused_in_words():
    from services.recurrence import normalise
    with pytest.raises(ValueError) as e:
        normalise("fortnight", 1, None)
    assert "day, week, month" in str(e.value)
    with pytest.raises(ValueError):
        normalise("week", 0, None)
    with pytest.raises(ValueError):
        normalise("week", 1, "soon")
    assert normalise(None, None, None) is None
    assert normalise("week", None, "") == {"every": "week", "interval": 1, "until": None}


def test_a_series_knows_when_it_is_over():
    from services.recurrence import series_is_over
    assert series_is_over({"until": "2026-10-01"}, "2026-10-02") is True
    assert series_is_over({"until": "2026-10-02"}, "2026-10-02") is False, "the end date is included"
    assert series_is_over({"until": None}, "2030-01-01") is False
    assert series_is_over({"until": None}, None) is True


# ═══════════════════════════ D1 · end to end ═══════════════════════════════
def _make(db_runner, body, user=OWNER):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            try:
                made = await rt.create_task(_create(**body), _Bg(), user=user)
                refused = None
            except HTTPException as e:
                made, refused = None, (e.status_code, e.detail)
            return made, refused

    return db_runner(scenario)


def test_a_repeating_task_is_created_with_its_cadence(with_test_db):
    made, refused = _make(with_test_db, {
        "title": "File GST", "due_date": "2026-10-20",
        "repeat_every": "month", "repeat_interval": 1, "assignee_id": OWNER["id"]})
    assert refused is None
    assert made["recurrence"]["every"] == "month" and made["recurrence"]["interval"] == 1
    assert made["recurrence"]["series_id"] == made["id"], "the first task names the series"
    assert made["series_id"] == made["id"]


def test_a_repeat_with_no_date_is_refused_because_the_date_is_what_repeats(with_test_db):
    made, refused = _make(with_test_db, {"title": "File GST", "repeat_every": "month"})
    assert made is None and refused[0] == 400 and "needs a due date" in refused[1]


def test_an_ordinary_task_carries_no_cadence(with_test_db):
    made, _ = _make(with_test_db, {"title": "Call the accountant"})
    assert made.get("recurrence") is None and made.get("series_id") is None


def test_finishing_one_brings_the_next(with_test_db):
    """The rule that makes recurrence need no scheduler: the next occurrence is
    created by the act of finishing this one, so there is only ever one live."""
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(
                title="Monday stock count", due_date="2026-09-21",
                repeat_every="week", assignee_id=DOER["id"]), _Bg(), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            rows = await db.tasks.find({"tenant_id": TENANT}, {"_id": 0}).sort("created_at", 1).to_list(10)
            return first, rows

    first, rows = with_test_db(scenario)
    assert len(rows) == 2, "exactly one new occurrence"
    nxt = [r for r in rows if r["id"] != first["id"]][0]
    assert nxt["title"] == "Monday stock count"
    assert nxt["due_date"] == "2026-09-28" and nxt["status"] == "todo"
    assert nxt["assignee_id"] == DOER["id"], "the same person keeps the routine"
    assert nxt["series_id"] == first["id"], "and it is the same routine"
    assert nxt["source"] == "recurring"
    assert nxt["progress"] == 0 and nxt.get("workflow_id") is None, \
        "what carries is the work, not this particular run of it"


def test_a_routine_stops_at_its_end_date(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(
                title="Weekly review", due_date="2026-09-21", repeat_every="week",
                repeat_until="2026-09-25", assignee_id=DOER["id"]), _Bg(), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            return await db.tasks.count_documents({"tenant_id": TENANT})

    assert with_test_db(scenario) == 1, "28 Sep is past the 25th, so nothing follows"


def test_a_routine_can_be_stopped_without_cancelling_the_work_in_hand(with_test_db):
    """"We don't do this any more" while you are halfway through the last one:
    this task stays open and finishing it brings nothing after it."""
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(
                title="Weekly review", due_date="2026-09-21", repeat_every="week",
                assignee_id=DOER["id"]), _Bg(), user=OWNER)
            stopped = await rt.update_task(first["id"], _update(stop_repeating=True), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            return stopped, await db.tasks.count_documents({"tenant_id": TENANT})

    stopped, n = with_test_db(scenario)
    assert stopped["status"] != "cancelled", "the work in hand is untouched"
    assert stopped.get("recurrence") is None
    assert n == 1


def test_closing_the_same_task_twice_does_not_double_the_routine(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(
                title="Stock count", due_date="2026-09-21", repeat_every="week",
                assignee_id=DOER["id"]), _Bg(), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            return await db.tasks.count_documents({"tenant_id": TENANT})

    assert with_test_db(scenario) == 2


# ════════════════════════════ D2 · before the date ═════════════════════════
def _sweep(with_test_db, tasks, tenant_fields=None, now=None):
    async def scenario(db):
        import services.finance_signals as fs
        with _env(db):
            await _people(db)
            await db.tenants.insert_one({"id": TENANT, **(tenant_fields or {})})
            if tasks:
                await db.tasks.insert_many(tasks)
            sent: list = []

            async def fake_push(tenant_id, user_ids, level, message, *a, **k):
                sent.append({"to": sorted(user_ids), "message": message, "ntype": k.get("ntype")})

            saved = fs.push_notification
            fs.push_notification = fake_push
            try:
                told = await fs.warn_before_due(TENANT, now or datetime.now(timezone.utc))
            finally:
                fs.push_notification = saved
            rows = await db.tasks.find({"tenant_id": TENANT}, {"_id": 0}).to_list(20)
            return told, sent, rows

    return with_test_db(scenario)


def _open_task(tid, due, **over):
    t = {"id": tid, "tenant_id": TENANT, "title": f"Task {tid}", "status": "todo",
         "assignee_id": DOER["id"], "co_assignee_ids": [], "due_date": due}
    t.update(over)
    return t


def test_the_people_on_a_task_hear_before_it_is_due(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, sent, _ = _sweep(with_test_db, [_open_task("t1", "2026-09-22")], now=now)
    assert told == 1
    assert sent[0]["to"] == [DOER["id"]] and sent[0]["ntype"] == "due_soon"
    assert "due tomorrow" in sent[0]["message"]


def test_a_task_due_today_still_counts(with_test_db):
    """It is stored as a bare date and "now" is a moment part-way through the
    day, so a naive comparison drops exactly the tasks that matter most."""
    now = datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc)
    told, sent, _ = _sweep(with_test_db, [_open_task("t1", "2026-09-21")], now=now)
    assert told == 1 and "due today" in sent[0]["message"]


def test_work_further_out_than_the_lead_time_is_not_news_yet(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, _, _ = _sweep(with_test_db, [_open_task("t1", "2026-09-30")], now=now)
    assert told == 0


def test_the_company_sets_its_own_lead_time(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, _, _ = _sweep(with_test_db, [_open_task("t1", "2026-09-27")],
                        {"due_soon_days": 7}, now=now)
    assert told == 1


def test_a_company_can_turn_the_early_warning_off(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, _, rows = _sweep(with_test_db, [_open_task("t1", "2026-09-22")],
                           {"due_soon_days": 0}, now=now)
    assert told == 0 and "due_soon_notified_for" not in rows[0]


def test_nobody_is_told_twice_about_the_same_date(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, _, rows = _sweep(
        with_test_db,
        [_open_task("t1", "2026-09-22", due_soon_notified_for="2026-09-22")], now=now)
    assert told == 0
    assert rows[0]["due_soon_notified_for"] == "2026-09-22"


def test_moving_the_date_re_arms_the_warning(with_test_db):
    """The idempotency is the date itself, so B2's reschedule needs no extra
    bookkeeping: a warned-for date that no longer matches simply warns again."""
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, sent, _ = _sweep(
        with_test_db,
        [_open_task("t1", "2026-09-22", due_soon_notified_for="2026-09-15")], now=now)
    assert told == 1 and "due tomorrow" in sent[0]["message"]


def test_work_already_late_belongs_to_the_escalation_ladder_not_here(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, _, _ = _sweep(with_test_db, [_open_task("t1", "2026-09-18")], now=now)
    assert told == 0


def test_finished_work_is_never_warned_about(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, _, _ = _sweep(with_test_db, [_open_task("t1", "2026-09-22", status="done")], now=now)
    assert told == 0


def test_a_task_nobody_holds_is_left_for_the_day_it_is_late(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, sent, _ = _sweep(
        with_test_db, [_open_task("t1", "2026-09-22", assignee_id=None)], now=now)
    assert told == 0 and sent == []


def test_everyone_on_the_task_hears_not_only_the_lead(with_test_db):
    now = datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc)
    told, sent, _ = _sweep(
        with_test_db,
        [_open_task("t1", "2026-09-22", co_assignee_ids=[OWNER["id"]])], now=now)
    assert told == 1 and sent[0]["to"] == sorted([DOER["id"], OWNER["id"]])


# ════════════════════════════ D3 · one after another ═══════════════════════
def test_a_task_that_waits_for_other_work_starts_blocked(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(title="Check stock", assignee_id=DOER["id"]),
                                         _Bg(), user=OWNER)
            second = await rt.create_task(_create(
                title="Pack the order", assignee_id=DOER["id"], depends_on=[first["id"]]),
                _Bg(), user=OWNER)
            return first, second

    first, second = with_test_db(scenario)
    assert second["status"] == "blocked" and second["depends_on"] == [first["id"]]


def test_finishing_the_work_before_it_opens_it_by_itself(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(title="Check stock", assignee_id=DOER["id"]),
                                         _Bg(), user=OWNER)
            second = await rt.create_task(_create(
                title="Pack the order", assignee_id=DOER["id"], depends_on=[first["id"]]),
                _Bg(), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            after = await db.tasks.find_one({"id": second["id"]}, {"_id": 0})
            trail = await db.activity.find({"entity_id": second["id"]}, {"_id": 0, "detail": 1}).to_list(10)
            return after, trail

    after, trail = with_test_db(scenario)
    assert after["status"] == "todo"
    assert "Check stock" in after["last_action"]
    assert any("Unblocked" in (e.get("detail") or "") for e in trail), \
        "and the person can read why it opened"


def test_it_waits_for_the_LAST_of_several(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            a = await rt.create_task(_create(title="Check stock", assignee_id=DOER["id"]), _Bg(), user=OWNER)
            b = await rt.create_task(_create(title="Print labels", assignee_id=DOER["id"]), _Bg(), user=OWNER)
            c = await rt.create_task(_create(
                title="Pack the order", assignee_id=DOER["id"],
                depends_on=[a["id"], b["id"]]), _Bg(), user=OWNER)
            await rt.update_task(a["id"], _update(status="done"), user=OWNER)
            midway = await db.tasks.find_one({"id": c["id"]}, {"_id": 0, "status": 1})
            await rt.update_task(b["id"], _update(status="done"), user=OWNER)
            after = await db.tasks.find_one({"id": c["id"]}, {"_id": 0, "status": 1})
            return midway["status"], after["status"]

    assert with_test_db(scenario) == ("blocked", "todo")


def test_clearing_one_block_does_not_clear_another(with_test_db):
    """A task that also needs an approval before work starts stays locked when
    the work before it finishes: two blocks, and only one of them lifted."""
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            first = await rt.create_task(_create(title="Check stock", assignee_id=DOER["id"]),
                                         _Bg(), user=OWNER)
            second = await rt.create_task(_create(
                title="Pay the supplier", assignee_id=DOER["id"], depends_on=[first["id"]],
                approval_required=True, approver_id=OWNER["id"]), _Bg(), user=OWNER)
            await rt.update_task(first["id"], _update(status="done"), user=OWNER)
            return await db.tasks.find_one({"id": second["id"]}, {"_id": 0, "status": 1,
                                                                  "approval_status": 1})

    row = with_test_db(scenario)
    assert row["status"] == "blocked" and row["approval_status"] == "pending"


def test_an_id_we_do_not_recognise_never_blocks_a_task_for_good(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            return await rt.create_task(_create(
                title="Pack the order", assignee_id=DOER["id"],
                depends_on=["gone", "never-existed"]), _Bg(), user=OWNER)

    made = with_test_db(scenario)
    assert made["status"] == "todo" and made["depends_on"] == []


def test_work_in_another_workspace_cannot_be_depended_on(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        with _env(db):
            await _people(db)
            await db.tasks.insert_one({"id": "foreign", "tenant_id": "t-other",
                                       "title": "Their task", "status": "todo"})
            return await rt.create_task(_create(
                title="Pack the order", assignee_id=DOER["id"], depends_on=["foreign"]),
                _Bg(), user=OWNER)

    assert with_test_db(scenario)["depends_on"] == []


def test_a_blocked_task_says_which_kind_of_block_it_is():
    from services.tasks import blocked_reason
    assert blocked_reason({"status": "todo"}) is None
    assert blocked_reason({"status": "blocked", "approval_required": True,
                           "approval_status": "pending"}) == "approval"
    assert blocked_reason({"status": "blocked", "depends_on": ["t1"]}) == "depends"
    assert blocked_reason({"status": "blocked", "decision_id": "d1"}) == "decision"
    assert blocked_reason({"status": "blocked"}) == "blocked"


def test_a_deadline_that_passed_earlier_today_is_already_late(with_test_db):
    """A task due at 9am, read at 2pm, is not "due soon" — it is overdue, and
    the escalation ladder starts the same day. Bare dates mean end of day, so
    those stay in the warning until tomorrow."""
    now = datetime(2026, 9, 21, 14, 0, tzinfo=timezone.utc)
    told, _, _ = _sweep(
        with_test_db,
        [_open_task("t1", datetime(2026, 9, 21, 9, 0, tzinfo=timezone.utc).isoformat())], now=now)
    assert told == 0

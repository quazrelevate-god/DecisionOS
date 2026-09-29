"""Late means late, and the page can be asked about a period (2026-09-29).

Two things the browser walk turned up, both of which flattered the reader.

THE ON-TIME RATE COUNTED ONLY FINISHED WORK. On the company page "Overdue 14"
sat four inches above "Landed on time 100%"; on Anand's page, four dated tasks
all past their date and nothing finished, the card said there was nothing to
judge. A task still open on the day after its due date has already failed to
land on time — that is a fact about today, not a prediction — and leaving it
out of the denominator flatters exactly the team that needs telling.

AND EVERY NUMBER WAS ALL TIME. A workshop that had a bad September carried it
for the rest of its life, and an owner asking "are we better than last month?"
got the same figure either way. Worse, Execution mixed two clocks: completion
counted every task ever while the overdue penalty was as of right now, so one
bad fortnight scored as if it were the company's whole history.

The window's rule is one sentence, and the header says it rather than making
anyone infer it: it narrows the FINISHED work to what finished inside it, and
everything still open counts however old it is. Open work is never filtered —
hiding a March task that is still not done would be the same flattering lie.
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

T = "t-period"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}


# ───────────────── open work past its date is already late ─────────────────
def _t(status="done", created="2026-09-01", completed=None, due=None):
    return {"status": status, "created_at": created, "completed_at": completed, "due_date": due}


def test_a_task_open_past_its_date_has_already_missed_it():
    from services.task_timing import timing_of
    out = timing_of([_t("todo", due="2026-09-20")], now="2026-09-29")
    assert out["on_time_rate"] == 0, "nothing hit its date"
    assert out["dated"] == 1 and out["late_open"] == 1


def test_a_task_whose_day_has_not_come_is_not_judged_yet():
    """Neither early nor late — it still has time."""
    from services.task_timing import timing_of
    out = timing_of([_t("todo", due="2026-10-30")], now="2026-09-29")
    assert out["on_time_rate"] is None and out["dated"] == 0 and out["late_open"] == 0


def test_the_headline_case_from_the_browser(with_test_db=None):
    """Three landed on time and fourteen are open and late: the old rate said
    100%, which is the reading that sent this fix."""
    from services.task_timing import timing_of
    rows = ([_t(completed="2026-09-03", due="2026-09-04")] * 3
            + [_t("todo", due="2026-09-10")] * 14)
    out = timing_of(rows, now="2026-09-29")
    assert out["on_time_rate"] == 18, "3 of 17"
    assert out["dated"] == 17 and out["late_open"] == 14


def test_a_cancelled_task_is_not_late():
    """It was called off, not missed."""
    from services.task_timing import timing_of
    out = timing_of([_t("cancelled", due="2026-09-01")], now="2026-09-29")
    assert out["dated"] == 0 and out["late_open"] == 0


def test_the_card_names_the_open_late_work_rather_than_leaving_a_low_number_bare():
    assert 'label="Hit their date"' in OPS
    assert "open and already past it." in OPS
    assert "Nothing dated has come due yet" in OPS, "and the empty case is explained"


# ───────────────────────── the window's rule ───────────────────────────────
def test_finished_work_is_narrowed_to_the_window():
    from services.operating_score import _task_in_window
    assert _task_in_window({"status": "done", "completed_at": "2026-09-20"}, "2026-09-01") is True
    assert _task_in_window({"status": "done", "completed_at": "2026-08-01"}, "2026-09-01") is False


def test_open_work_is_never_filtered_however_old():
    """A task raised in March and still not done is a live problem today.
    Hiding it behind a 30-day window would flatter the team that needs
    telling — the same mistake the on-time rate was making."""
    from services.operating_score import _task_in_window
    assert _task_in_window({"status": "todo", "created_at": "2026-03-01"}, "2026-09-01") is True
    assert _task_in_window({"status": "in_progress", "created_at": "2026-03-01"}, "2026-09-01") is True


def test_all_time_keeps_everything():
    from services.operating_score import _task_in_window
    assert _task_in_window({"status": "done", "completed_at": "2020-01-01"}, None) is True


@pytest.mark.parametrize("days,expect", [(30, True), (90, True), (7, False), (0, False), (None, False)])
def test_only_the_offered_periods_are_accepted(days, expect):
    from services.operating_score import WINDOWS
    assert (days in WINDOWS) is expect


# ───────────────────────── what the page then says ─────────────────────────
async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Nila"})
    await db.users.insert_many([
        {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
        {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"}])
    await db.tasks.insert_many([
        # finished long ago — inside "all time", outside a 30-day window
        {"id": "old1", "tenant_id": T, "assignee_id": "u-priya", "status": "done",
         "created_at": "2026-01-02T04:00:00+00:00", "completed_at": "2026-01-03T04:00:00+00:00"},
        {"id": "old2", "tenant_id": T, "assignee_id": "u-priya", "status": "done",
         "created_at": "2026-01-02T04:00:00+00:00", "completed_at": "2026-01-03T04:00:00+00:00"},
        # finished this week
        {"id": "new1", "tenant_id": T, "assignee_id": "u-priya", "status": "done",
         "created_at": "2026-09-24T04:00:00+00:00", "completed_at": "2026-09-25T04:00:00+00:00"},
        # open since March, and still open
        {"id": "stale", "tenant_id": T, "assignee_id": "u-priya", "status": "todo",
         "created_at": "2026-03-01T04:00:00+00:00", "due_date": "2026-03-10"},
    ])


def _env(fn):
    async def run(db):
        with e2e_env(db):
            await _seed(db)
            return await fn(db)
    return run


def test_a_window_drops_old_finished_work_and_keeps_the_open_problem(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        allt = await r.operating_score(user_id=None, window=None, user=OWNER)
        win = await r.operating_score(user_id=None, window=30, user=OWNER)
        return allt, win

    allt, win = with_test_db(_env(scenario))
    assert allt["stats"]["done"] == 3 and win["stats"]["done"] == 1, "two old closes aged out"
    assert allt["stats"]["open"] == win["stats"]["open"] == 1, "the March task is in both"
    assert allt["stats"]["overdue"] == win["stats"]["overdue"] == 1
    assert win["window"]["days"] == 30 and win["window"]["since"]
    assert allt["window"]["days"] is None


def test_the_window_moves_the_score_which_is_the_whole_point(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        allt = await r.operating_score(user_id=None, window=None, user=OWNER)
        win = await r.operating_score(user_id=None, window=30, user=OWNER)
        return allt["company"]["categories"]["execution"], win["company"]["categories"]["execution"]

    allt_exec, win_exec = with_test_db(_env(scenario))
    assert allt_exec != win_exec
    assert win_exec < allt_exec, "less finished lately, so recent execution reads lower"


def test_each_period_is_cached_on_its_own(with_test_db):
    """One cache key for all of them would serve last month's figures as this
    month's."""
    async def scenario(db):
        import routers.operating_score as r
        await r.operating_score(user_id=None, window=None, user=OWNER)
        await r.operating_score(user_id=None, window=30, user=OWNER)
        again = await r.operating_score(user_id=None, window=None, user=OWNER)
        keys = [row["_id"] async for row in db.operating_score_cache.find({}, {"_id": 1})]
        return again["stats"]["done"], sorted(keys)

    done, keys = with_test_db(_env(scenario))
    assert done == 3, "all time is still all time after a windowed read"
    assert len(keys) == 2 and any(k.endswith(":30") for k in keys) and any(k.endswith(":all") for k in keys)


def test_a_period_nobody_offers_reads_as_all_time_rather_than_failing(with_test_db):
    """A stale or hand-typed link should show the page, not an error."""
    async def scenario(db):
        import routers.operating_score as r
        return await r.operating_score(user_id=None, window=7, user=OWNER)

    out = with_test_db(_env(scenario))
    assert out["window"]["days"] is None and out["stats"]["done"] == 3


def test_a_persons_page_answers_for_the_period_too(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        allt = await r.operating_score(user_id="u-priya", window=None, user=OWNER)
        win = await r.operating_score(user_id="u-priya", window=30, user=OWNER)
        return allt["stats"], win["stats"]

    allt, win = with_test_db(_env(scenario))
    assert allt["completed"] == 3 and win["completed"] == 1
    assert allt["open"] == win["open"] == 1, "the stale task is nobody's history"


# ───────────────────────── and the page offers it ──────────────────────────
def test_the_header_offers_the_periods_and_states_the_rule():
    assert "const WINDOW_OPTIONS = [" in OPS
    for label in ('"All time"', '"Last 30 days"', '"Last 90 days"'):
        assert label in OPS, label
    assert 'testid="operating-window"' in OPS
    assert 'data-testid="operating-window-note"' in OPS
    assert "Everything still open counts, however old." in OPS, "the rule, said not inferred"


def test_the_choice_lives_in_the_address_so_a_refresh_keeps_it():
    assert 'searchParams.get("window")' in OPS
    assert '["30", "90"].includes(rawWindow) ? rawWindow : "all"' in OPS
    assert '{ replace: true }' in OPS, "flicking between periods is reading, not navigating"
    assert 'queryKey: ["operating-score", userIdParam, windowKey]' in OPS
    assert "placeholderData: (prev) => prev" in OPS, "no blink back to skeletons on each flick"


def test_finance_says_it_is_the_exception():
    """A payment settles an invoice raised long before it, so 'collected in
    the last 30 days' would divide two figures that do not belong together."""
    assert "Finance is the exception" in OPS
    assert '"finance_windowed": False' in (
        Path(__file__).resolve().parents[1] / "services" / "operating_score.py"
    ).read_text(encoding="utf-8")

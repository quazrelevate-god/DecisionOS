"""Ops says how long, not only how much (2026-09-29).

Step two of Yokesh's "we can see individual person efficiency also right".
Step one gave a task the moment it finished (test_a_task_says_when_it_finished);
this puts the two numbers that fall out of it on the screen.

The gap it closes: "5 done" reads identically whether the five took two working
days each or nine, and Overdue only ever counted work still OPEN — so somebody
who finishes everything a week late looked perfect. Now a person's page, the
company's page and the leaderboard all carry:

  * typical days to close — the MEDIAN, because one task left open over a
    festival week drags an average into nonsense;
  * the share of finished, DATED work that landed by its date;
  * how long the oldest open thing has been waiting, which no rate can show.

Everything in working days (Sunday off), the calendar the stage deadlines and
the stuck alerts already count in, so "three days" means one thing across the
product. None, never a flattering zero, wherever there is nothing to measure.
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

T = "t-howlong"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}
PRIYA = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": []}


async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Nila", "roles": [{"key": "sales", "label": "Sales"}]})
    await db.users.insert_many([
        {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
        {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"},
    ])
    # Priya: three closed quickly, one closed late, two still open.
    await db.tasks.insert_many([
        {"id": "p1", "tenant_id": T, "assignee_id": "u-priya", "status": "done",
         "created_at": "2026-09-21T04:00:00+00:00", "completed_at": "2026-09-22T04:00:00+00:00",
         "due_date": "2026-09-25"},
        {"id": "p2", "tenant_id": T, "assignee_id": "u-priya", "status": "done",
         "created_at": "2026-09-21T04:00:00+00:00", "completed_at": "2026-09-22T04:00:00+00:00",
         "due_date": "2026-09-25"},
        {"id": "p3", "tenant_id": T, "assignee_id": "u-priya", "status": "done",
         "created_at": "2026-09-21T04:00:00+00:00", "completed_at": "2026-09-28T04:00:00+00:00",
         "due_date": "2026-09-23"},
        {"id": "p4", "tenant_id": T, "assignee_id": "u-priya", "status": "todo",
         "created_at": "2026-09-14T04:00:00+00:00", "due_date": "2026-09-30"},
        {"id": "p5", "tenant_id": T, "assignee_id": "u-priya", "status": "in_progress",
         "created_at": "2026-09-26T04:00:00+00:00"},
        {"id": "k1", "tenant_id": T, "assignee_id": "u-owner", "status": "done",
         "created_at": "2026-09-21T04:00:00+00:00", "completed_at": "2026-09-21T09:00:00+00:00"},
    ])


def _env(fn):
    async def run(db):
        with e2e_env(db):
            await _seed(db)
            return await fn(db)
    return run


# ───────────────────────── it reaches the person's page ────────────────────
def test_a_persons_payload_carries_how_their_work_moves(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        return await r.operating_score(user_id="u-priya", user=OWNER)

    payload = with_test_db(_env(scenario))
    t = payload["stats"]["timing"]
    # p1, p2 close in one working day; p3 in six (21st -> 28th, minus a Sunday).
    assert t["typical_days"] == 1, t
    assert t["closed"] == 3
    # Two of the three dated tasks landed by their date.
    assert t["on_time_rate"] == 67 and t["dated"] == 3
    assert t["waiting_days"] is not None and t["waiting_days"] > 0


def test_the_company_is_measured_the_same_way(with_test_db):
    """The owner's page gets the whole company on the same footing, so "we are
    slow" and "this person is slow" are the same question at two scales."""
    async def scenario(db):
        import routers.operating_score as r
        return await r.operating_score(user_id=None, user=OWNER)

    payload = with_test_db(_env(scenario))
    assert set(payload["stats"]["timing"]) == {
        "typical_days", "closed", "on_time_rate", "dated", "waiting_days"}
    assert payload["stats"]["timing"]["closed"] == 4, "every finished task in the company"


def test_the_leaderboard_carries_it_per_person(with_test_db):
    """Where comparing actually happens: two people with the same counts are
    not the same, and the table can finally say so."""
    async def scenario(db):
        import routers.operating_score as r
        return await r.operating_score(user_id=None, user=OWNER)

    rows = {e["id"]: e for e in with_test_db(_env(scenario))["employees"]}
    assert rows["u-priya"]["timing"]["typical_days"] == 1
    assert rows["u-owner"]["timing"]["typical_days"] == 0, "raised and closed the same day"


def test_a_person_with_nothing_finished_is_not_given_a_number(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        await db.users.insert_one({"id": "u-new", "tenant_id": T, "name": "Anand", "role": "sales"})
        await db.tasks.insert_one({"id": "n1", "tenant_id": T, "assignee_id": "u-new",
                                   "status": "todo", "created_at": "2026-09-26T04:00:00+00:00"})
        return await r.operating_score(user_id="u-new", user=OWNER)

    t = with_test_db(_env(scenario))["stats"]["timing"]
    assert t["typical_days"] is None and t["on_time_rate"] is None
    assert t["closed"] == 0 and t["dated"] == 0


def test_a_person_sees_their_own_without_asking_for_anybody(with_test_db):
    """The self view is the same payload — this is the screen a team member
    opens about their own work."""
    async def scenario(db):
        import routers.operating_score as r
        return await r.operating_score(user_id=None, user=PRIYA)

    payload = with_test_db(_env(scenario))
    assert payload["view"] == "self"
    assert payload["stats"]["timing"]["typical_days"] == 1


# ───────────────────────── and it is on the screen ─────────────────────────
def test_the_page_draws_the_three_numbers():
    assert "function WorkMovesRow(" in OPS
    assert 'data-testid="operating-work-moves"' in OPS
    for tid in ("ops-timing-typical", "ops-timing-on-time", "ops-timing-waiting"):
        assert f'testid="{tid}"' in OPS, tid
    assert "<WorkMovesRow timing={stats.timing} company />" in OPS, "the company's page"
    assert "<WorkMovesRow timing={stats.timing} who={isViewAs ? firstName : null} />" in OPS


def test_zero_days_reads_as_same_day_not_as_a_missing_number():
    """Raised in the morning, done by evening is the BEST answer, and a bare
    "0" reads like a failure to measure."""
    assert '"Same day"' in OPS
    assert '"same day"' in OPS, "and in the team table's row"


def test_the_cards_say_why_when_there_is_nothing_to_measure():
    """A dash alone invites "is it broken?". Each card explains its own
    silence."""
    assert "Nothing finished yet, so there is nothing to time." in OPS
    assert "work nobody dated cannot be early or late" in OPS
    assert "Nothing open — a good place to be." in OPS


def test_the_units_are_stated_because_sunday_is_not_counted():
    assert "Counted in working days — Sunday off, the same calendar the deadlines use." in OPS


def test_the_page_speaks_about_the_right_person():
    assert 'const theirs = company ? "the company\'s" : who ? `${who}\'s` : "your";' in OPS
    assert 'const them = company ? "the team" : who || "you";' in OPS

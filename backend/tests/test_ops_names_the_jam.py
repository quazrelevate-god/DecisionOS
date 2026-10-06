"""Ops names the jam, and drops the cards with nothing in them (2026-09-29).

Yokesh, walking the page: "it ranks people but never names the bottleneck".
The team table said Anand was 0 and Priya 18 — a verdict on two people, not an
answer to the question an owner-led workshop actually asks, which is WHERE the
work is stuck and who is holding it. The clock that knows already existed
(services/workflow_timing.card_timing, the same one the Desk and the stuck
alert read); nothing had asked it for a ranking.

Two complaints are kept apart rather than blurred into one "stuck":
  * OVER — the stage is taking longer than the board allows;
  * IDLE — nobody has touched the card at all.
A card can be idle without being over (a generous stage) and over without
being idle (somebody is working on it, it is just slow), and the fix differs.

And the second thing from the same walk: on the page of somebody who has
finished nothing, "Proof rate — 0 of 0 done with photo or voice" and "Plans in
use 0/0" took two thirds of a row to say nothing. A proof rate over no
finished work is not a low score, it is an undefined one.
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

T = "t-jam"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}

STAGES = ["inquiry", "sampling", "dispatch"]
PIPELINE = {"key": "orders", "label": "Orders", "stage_days": None, "stages": [
    {"key": "inquiry", "label": "Inquiry", "days": 2},
    {"key": "sampling", "label": "Sampling", "days": 2},
    {"key": "dispatch", "label": "Dispatch", "days": 2},
]}


def _yesterday_ist() -> str:
    """A day inside every stage's two-day allowance, whenever this runs. The
    hard-coded 2026-09-28 was "yesterday" on the day the test was written and a
    genuine jam a week later."""
    from datetime import timedelta
    from shared.workdays import today_ist
    return (today_ist() - timedelta(days=1)).isoformat()


def _card(cid, stage, entered, title, counterparty=None):
    """A card that entered `stage` on `entered` and has not moved since."""
    return {
        "id": cid, "tenant_id": T, "type": "orders", "title": title,
        "stage": stage, "stages": STAGES, "counterparty": counterparty,
        "created_at": f"{entered}T04:00:00+00:00",
        "history": [{"stage": stage, "at": f"{entered}T04:00:00+00:00", "by": "u-owner"}],
    }


async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Nila", "operating_model": {"pipelines": [PIPELINE]}})
    await db.users.insert_many([
        {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
        {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"},
    ])


def _env(fn):
    async def run(db):
        with e2e_env(db):
            await _seed(db)
            return await fn(db)
    return run


# ───────────────────────── the jam is named ────────────────────────────────
def test_the_worst_jam_comes_first_and_says_who_is_holding_it(with_test_db):
    async def scenario(db):
        from services.workflow_timing import bottlenecks
        await db.workflows.insert_many([
            _card("slow", "sampling", "2026-09-01", "Bluewave 5,000 polos", "Bluewave Apparel"),
            _card("slower", "inquiry", "2026-08-01", "Target check 200 shirts"),
            _card("fresh", "inquiry", _yesterday_ist(), "Just raised"),
        ])
        await db.tasks.insert_one({
            "id": "t1", "tenant_id": T, "workflow_id": "slow", "stage_key": "sampling",
            "status": "in_progress", "assignee_id": "u-priya",
            "created_at": "2026-09-01T04:00:00+00:00", "updated_at": "2026-09-01T04:00:00+00:00"})
        return await bottlenecks(T, limit=3)

    jams = with_test_db(_env(scenario))
    assert [c["id"] for c in jams][:2] == ["slower", "slow"], "longest waiting first"
    top = jams[0]
    assert top["stage_label"] == "Inquiry"
    assert top["waiting_days"] >= top["over_days"] > 0
    slow = next(c for c in jams if c["id"] == "slow")
    assert [h["name"] for h in slow["holders"]] == ["Priya"], "the name, not the id"
    assert slow["counterparty"] == "Bluewave Apparel"
    assert not any(c["id"] == "fresh" for c in jams), "a card raised yesterday is not a jam"


def test_a_card_nobody_is_on_says_so_rather_than_showing_a_blank(with_test_db):
    """An empty holders list is not a gap in the data — it IS the finding."""
    async def scenario(db):
        from services.workflow_timing import bottlenecks
        await db.workflows.insert_one(_card("orphan", "sampling", "2026-08-20", "Nobody's card"))
        return await bottlenecks(T, limit=3)

    jams = with_test_db(_env(scenario))
    assert jams[0]["holders"] == [] and jams[0]["open_tasks"] == 0


def test_a_finished_card_is_not_stuck(with_test_db):
    """Parked on the last stage means done, however long it has sat there."""
    async def scenario(db):
        from services.workflow_timing import bottlenecks
        await db.workflows.insert_one(_card("shipped", "dispatch", "2026-06-01", "Long gone"))
        return await bottlenecks(T, limit=3)

    assert with_test_db(_env(scenario)) == []


def test_over_and_idle_are_reported_separately(with_test_db):
    """They are different complaints with different fixes: over means the
    stage is slow, idle means nobody has touched it."""
    async def scenario(db):
        from services.workflow_timing import bottlenecks
        await db.workflows.insert_one(_card("c1", "sampling", "2026-09-10", "Slow one"))
        return await bottlenecks(T, limit=3)

    c = with_test_db(_env(scenario))[0]
    assert set(("over_days", "idle_days", "waiting_days", "stage_days")) <= set(c)
    assert c["waiting_days"] == max(c["over_days"], c["idle_days"])


def test_only_the_worst_few_are_returned(with_test_db):
    """A list of forty is not an answer."""
    async def scenario(db):
        from services.workflow_timing import bottlenecks
        await db.workflows.insert_many([
            _card(f"c{i}", "inquiry", "2026-08-15", f"Card {i}") for i in range(8)])
        return await bottlenecks(T, limit=3)

    assert len(with_test_db(_env(scenario))) == 3


def test_the_company_payload_carries_them(with_test_db):
    async def scenario(db):
        import routers.operating_score as r
        await db.workflows.insert_one(_card("c1", "sampling", "2026-08-20", "Bluewave"))
        await db.tasks.insert_one({
            "id": "t1", "tenant_id": T, "assignee_id": "u-owner", "status": "done",
            "created_at": "2026-09-20T04:00:00+00:00", "completed_at": "2026-09-21T04:00:00+00:00"})
        return await r.operating_score(user_id=None, window=None, user=OWNER)

    out = with_test_db(_env(scenario))
    assert out["bottlenecks"] and out["bottlenecks"][0]["title"] == "Bluewave"


def test_a_period_does_not_hide_a_jam(with_test_db):
    """A card stuck since March is stuck TODAY. Windowing it away would hide
    the worst of them, which is the opposite of the point."""
    async def scenario(db):
        import routers.operating_score as r
        await db.workflows.insert_one(_card("old", "sampling", "2026-03-01", "Since March"))
        await db.tasks.insert_one({
            "id": "t1", "tenant_id": T, "assignee_id": "u-owner", "status": "done",
            "created_at": "2026-09-20T04:00:00+00:00", "completed_at": "2026-09-21T04:00:00+00:00"})
        allt = await r.operating_score(user_id=None, window=None, user=OWNER)
        win = await r.operating_score(user_id=None, window=30, user=OWNER)
        return allt["bottlenecks"], win["bottlenecks"]

    allt, win = with_test_db(_env(scenario))
    assert [c["id"] for c in allt] == [c["id"] for c in win] == ["old"]


# ───────────────────────── and it is on the screen ─────────────────────────
def test_the_owners_page_draws_the_jams():
    assert "function Bottlenecks({ cards })" in OPS
    assert '<Bottlenecks cards={data.bottlenecks} />' in OPS
    assert 'data-testid="operating-bottlenecks"' in OPS
    assert "`operating-jam-${c.id}`" in OPS
    assert "`/workflows?wf=${encodeURIComponent(c.id)}" in OPS, "it opens the card that is stuck"


def test_each_row_says_which_clock_ran_out():
    assert "over the ${c.stage_days} this stage allows" in OPS
    assert 'not moved for ${days(c.idle_days)}' in OPS
    # whichever clock ran longer is the headline, because that is the number
    # beside it — "4 working days over" next to a 7 reads as a mistake
    assert "c.idle_days > c.over_days" in OPS
    assert '"nobody named on it"' in OPS, "an unheld card says so"


def test_nothing_stuck_is_worth_saying_out_loud():
    assert 'data-testid="operating-bottlenecks-empty"' in OPS
    assert "every card has moved inside the days its stage allows" in OPS


# ───────────────────────── the empty cards are gone ────────────────────────
def test_proof_rate_waits_until_there_is_finished_work_to_prove():
    assert "stats.completed > 0 && {" in OPS
    assert 'key: "proof"' in OPS


def test_plans_stays_while_the_nudge_still_means_something():
    """0/0 is noise for somebody with no work, and the message for somebody
    with plenty of it who has never asked Dex to plan any."""
    assert "(stats.plans_used > 0 || stats.actionable >= 3) && {" in OPS
    assert "hasn't used a Dex plan yet" in OPS


def test_the_row_is_sized_to_what_it_holds():
    """Two cards in a three-column grid leave a hole that reads as a card
    which failed to load."""
    assert "const ROW_COLS = { 1:" in OPS
    assert "function BreakdownRow({ cards })" in OPS
    assert "(cards || []).filter(Boolean)" in OPS
    assert "ROW_COLS[shown.length]" in OPS

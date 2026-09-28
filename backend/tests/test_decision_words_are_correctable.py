"""Words Dex misheard, corrected before they become work (2026-09-27).

Yokesh: "in a decision a people has to change their tasks and the titles of
the decisions. It may have multiple tasks also. Let's say they could have
misspelled something."

Dex writes the decision's title, its text and the name of every task it
proposes from what somebody SAID, and speech comes back misspelled — a name,
a fabric, a number. None of it could be corrected in the review: the founder
approved the wrong words, and those are the words the person doing the task
reads, and the ones the Journal, the Company Brain and every later search
carry. The only way out was to approve and rename in My Work, or delete the
task and type it again.

The rule this file holds: what the review says at the moment of approval is
what gets created. Corrections are saved as they are made, and approval uses
them.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-words"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}
SALES = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": []}


def _decision(status="pending_approval", **extra):
    """A decision as Dex leaves it: two proposed tasks, both misheard."""
    return {
        "id": "d1", "tenant_id": T, "status": status,
        "title": "Aproved indigo shirtng for Bluwave",
        "summary": "Approved 2000 metres of indigo shirtng for Bluwave at Rs 240.",
        "created_by": "u-owner", "created_at": "2026-09-27T04:00:00+00:00",
        "updated_at": "2026-09-27T04:00:00+00:00", "task_ids": [],
        "proposal": {"tasks": [
            {"key": "t1", "title": "Complete Tiruppur dispach paperwrk", "assignee_id": "u-priya",
             "assignee_role": "sales", "due_date": "2026-10-02"},
            {"key": "t2", "title": "Send profoma to Bluwave", "assignee_id": "u-owner",
             "assignee_role": "owner", "due_date": "2026-10-03"},
        ], "workflows": [], "meetings": [], "reminders": [], "memory_notes": []},
        **extra}


async def _seed(db, **extra):
    await db.decisions.insert_one(_decision(**extra))
    await db.users.insert_many([
        {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
        {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"}])
    await db.tenants.insert_one({"id": T, "name": "Nila", "roles": [{"key": "sales", "label": "Sales"}]})


def _env(fn):
    async def run(db):
        with e2e_env(db):
            return await fn(db)
    return run


# ───────────────────────── the decision's own words ────────────────────────
def test_the_title_and_the_text_can_be_corrected(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionEditInput
        await _seed(db)
        await r.edit_decision(
            "d1", DecisionEditInput(title="Approved indigo shirting for Bluewave",
                                    summary="Approved 2000 metres of indigo shirting for Bluewave at Rs 240."),
            user=OWNER)
        return await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    row = with_test_db(_env(scenario))
    assert row["title"] == "Approved indigo shirting for Bluewave"
    assert "shirting for Bluewave" in row["summary"]
    assert row["updated_at"] > "2026-09-27T04:00:00+00:00", "stamped, so other screens catch up"


def test_one_of_the_two_can_be_corrected_without_touching_the_other(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionEditInput
        await _seed(db)
        await r.edit_decision("d1", DecisionEditInput(title="Bluewave indigo, 2000 m"), user=OWNER)
        return await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    row = with_test_db(_env(scenario))
    assert row["title"] == "Bluewave indigo, 2000 m"
    assert row["summary"].startswith("Approved 2000 metres of indigo shirtng"), "left alone"


def test_a_title_of_spaces_is_refused_rather_than_saved(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionEditInput
        await _seed(db)
        try:
            await r.edit_decision("d1", DecisionEditInput(title="   "), user=OWNER)
        except HTTPException as e:
            return e.status_code, e.detail, await db.decisions.find_one({"id": "d1"}, {"_id": 0})
        return None, None, None

    code, detail, row = with_test_db(_env(scenario))
    assert code == 400 and "title" in detail.lower()
    assert row["title"] == "Aproved indigo shirtng for Bluwave", "and nothing was written"


# ───────────────────────── each task's own name ────────────────────────────
def test_every_proposed_task_can_be_renamed_and_they_do_not_collide(with_test_db):
    """A decision can propose several; renaming one leaves the rest alone."""
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionProposalTaskInput
        await _seed(db)
        await r.edit_decision_proposal_task("d1", "t1", DecisionProposalTaskInput(
            title="Send the packing list to Anand"), user=OWNER)
        await r.edit_decision_proposal_task("d1", "t2", DecisionProposalTaskInput(
            title="Send the proforma to Bluewave"), user=OWNER)
        return await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    row = with_test_db(_env(scenario))
    tasks = {t["key"]: t for t in row["proposal"]["tasks"]}
    assert tasks["t1"]["title"] == "Send the packing list to Anand"
    assert tasks["t2"]["title"] == "Send the proforma to Bluewave"
    assert tasks["t1"]["assignee_id"] == "u-priya" and tasks["t1"]["due_date"] == "2026-10-02", \
        "renaming changes the name and nothing else"


def test_renaming_is_written_into_the_decisions_own_trail(with_test_db):
    """It lands on the decision's timeline, so the change has an author and a
    time — the trail is kept real here rather than neutralised."""
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionProposalTaskInput
        with e2e_env(db, keep=("core.add_decision_event",)):
            await _seed(db)
            await r.edit_decision_proposal_task("d1", "t1", DecisionProposalTaskInput(
                title="Send the packing list to Anand"), user=OWNER)
            row = await db.decisions.find_one({"id": "d1"}, {"_id": 0})
        return row.get("timeline") or []

    timeline = with_test_db(scenario)
    assert any("renamed from" in (e.get("label") or "") for e in timeline), timeline
    assert any(e.get("actor") == "Kavya" for e in timeline), "and who did it"


def test_an_empty_task_name_is_refused(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionProposalTaskInput
        await _seed(db)
        try:
            await r.edit_decision_proposal_task("d1", "t1", DecisionProposalTaskInput(title="  "), user=OWNER)
        except HTTPException as e:
            return e.status_code, await db.decisions.find_one({"id": "d1"}, {"_id": 0})
        return None, None

    code, row = with_test_db(_env(scenario))
    assert code == 400
    assert row["proposal"]["tasks"][0]["title"] == "Complete Tiruppur dispach paperwrk"


# ───────────────────────── who, and when ───────────────────────────────────
def test_somebody_who_cannot_decide_it_cannot_reword_it(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionEditInput, DecisionProposalTaskInput
        await _seed(db, approver_id="u-owner")
        codes = []
        try:
            await r.edit_decision("d1", DecisionEditInput(title="Mine now"), user=SALES)
        except HTTPException as e:
            codes.append(e.status_code)
        try:
            await r.edit_decision_proposal_task("d1", "t1", DecisionProposalTaskInput(title="Mine now"), user=SALES)
        except HTTPException as e:
            codes.append(e.status_code)
        return codes

    assert with_test_db(_env(scenario)) == [403, 403]


@pytest.mark.parametrize("status", ["approved", "rejected"])
def test_a_decided_decision_keeps_its_words(with_test_db, status):
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionEditInput
        await _seed(db, status=status)
        try:
            await r.edit_decision("d1", DecisionEditInput(title="Too late"), user=OWNER)
        except HTTPException as e:
            return e.status_code, await db.decisions.find_one({"id": "d1"}, {"_id": 0})
        return None, None

    code, row = with_test_db(_env(scenario))
    assert code == 409
    assert row["title"] == "Aproved indigo shirtng for Bluwave"


# ───────────── and the one that matters: approval uses the corrections ─────
def test_approving_creates_the_work_with_the_corrected_words(with_test_db):
    """The whole point. A correction that the review shows but approval ignores
    would be worse than no correction at all."""
    async def scenario(db):
        import routers.decisions as r
        from models.decisions import DecisionEditInput, DecisionProposalTaskInput
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        await r.edit_decision("d1", DecisionEditInput(title="Approved indigo shirting for Bluewave"), user=OWNER)
        await r.edit_decision_proposal_task("d1", "t1", DecisionProposalTaskInput(
            title="Send the packing list to Anand"), user=OWNER)
        await r.edit_decision_proposal_task("d1", "t2", DecisionProposalTaskInput(
            title="Send the proforma to Bluewave"), user=OWNER)
        await approve_decision_flow(OWNER, "d1")
        tasks = await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(20)
        return await db.decisions.find_one({"id": "d1"}, {"_id": 0}), tasks

    decision, tasks = with_test_db(_env(scenario))
    titles = sorted(t["title"] for t in tasks)
    assert titles == ["Send the packing list to Anand", "Send the proforma to Bluewave"], \
        "the work is created with the words the review showed, not Dex's first guess"
    assert decision["title"] == "Approved indigo shirting for Bluewave"
    assert decision["status"] == "approved"


def test_the_review_screen_offers_all_three():
    """The decision's title, its text, and every task's name."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "frontend" / "src"
           / "components" / "DecisionDialog.js").read_text(encoding="utf-8")
    assert "function EditableText" in src
    assert 'testid="decision-title-edit"' in src
    assert 'testid="decision-summary-edit"' in src
    assert "decision-task-title-${t.key}" in src
    # It saves where it is, and a refusal puts the old words back.
    assert "editWords({ title })" in src and "editWords({ summary })" in src
    assert "Could not save those words" in src

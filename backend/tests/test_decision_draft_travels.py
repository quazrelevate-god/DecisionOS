"""A draft is the decision's own state, so it travels (PILOT-2 B, 2026-09-27).

The pilot client asked for Dex's "Later" to say "Save as draft". The rename
shipped, but the mark was a list of ids in one browser's localStorage: a draft
saved on the laptop was not a draft on the phone, and a cleared browser or a
private window lost it. "Save as draft" promises something saved.

The flag is a field on the decision now — the client's words were "so people
can understand the yellow means draft", which is the decision's state for
everyone who looks at it, not one person's bookmark. This is the contract
docs/PILOT-2_DRAFT_FLAG_ASK.md asked for, and what the screens rely on.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-draft"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}
SALES = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya", "permissions": []}


def _decision(status="pending_approval", **extra):
    return {"id": "d1", "tenant_id": T, "title": "Bluewave 5000 polos", "status": status,
            "created_by": "u-owner", "created_at": "2026-09-27T04:00:00+00:00",
            "updated_at": "2026-09-27T04:00:00+00:00", "task_ids": [], **extra}


async def _seed(db, **extra):
    await db.decisions.insert_one(_decision(**extra))
    await db.users.insert_many([
        {"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"},
        {"id": "u-priya", "tenant_id": T, "name": "Priya", "role": "sales"}])


def _env(fn):
    async def run(db):
        with e2e_env(db):
            return await fn(db)
    return run


# ───────────────────────────── setting and clearing ────────────────────────
def test_saving_a_draft_marks_the_decision_and_says_when_and_who(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        await _seed(db)
        out = await r.save_decision_as_draft("d1", user=OWNER)
        row = await db.decisions.find_one({"id": "d1"}, {"_id": 0})
        return out, row

    out, row = with_test_db(_env(scenario))
    assert out["draft"] is True, "the answer carries it, so the screen needs no second request"
    assert row["draft"] is True and row["drafted_by"] == "u-owner" and row["drafted_at"]
    assert row["updated_at"] > "2026-09-27T04:00:00+00:00", "stamped, so /api/pulse carries it"


def test_saving_it_twice_is_not_an_error(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        await _seed(db)
        await r.save_decision_as_draft("d1", user=OWNER)
        return await r.save_decision_as_draft("d1", user=OWNER)

    assert with_test_db(_env(scenario))["draft"] is True


def test_the_mark_comes_off_without_deciding(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        await _seed(db)
        await r.save_decision_as_draft("d1", user=OWNER)
        out = await r.unsave_decision_draft("d1", user=OWNER)
        return out, await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    out, row = with_test_db(_env(scenario))
    assert out["draft"] is False
    assert row["status"] == "pending_approval", "taking the mark off is not deciding it"


# ───────────────────────────── who, and when ───────────────────────────────
def test_somebody_who_cannot_decide_it_cannot_draft_it(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        await _seed(db, approver_id="u-owner")
        codes = []
        for call in (r.save_decision_as_draft, r.unsave_decision_draft):
            try:
                await call("d1", user=SALES)
            except HTTPException as e:
                codes.append(e.status_code)
        return codes, await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    codes, row = with_test_db(_env(scenario))
    assert codes == [403, 403]
    assert not row.get("draft")


@pytest.mark.parametrize("status", ["approved", "rejected"])
def test_a_decided_decision_cannot_be_saved_as_a_draft(with_test_db, status):
    async def scenario(db):
        import routers.decisions as r
        await _seed(db, status=status)
        try:
            await r.save_decision_as_draft("d1", user=OWNER)
        except HTTPException as e:
            return e.status_code, e.detail, await db.decisions.find_one({"id": "d1"}, {"_id": 0})
        return None, None, None

    code, detail, row = with_test_db(_env(scenario))
    assert code == 409 and "already been decided" in detail
    assert not row.get("draft"), "and nothing changed on it"


def test_a_decision_in_another_workspace_is_not_there_to_draft(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        await _seed(db)
        try:
            await r.save_decision_as_draft("d1", user={**OWNER, "tenant_id": "t-other"})
        except HTTPException as e:
            return e.status_code
        return None

    assert with_test_db(_env(scenario)) == 404


# ───────────────────────────── deciding clears it ──────────────────────────
def test_approving_a_draft_leaves_no_draft_behind(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        await r.save_decision_as_draft("d1", user=OWNER)
        await approve_decision_flow(OWNER, "d1")
        return await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    row = with_test_db(_env(scenario))
    assert row["status"] == "approved" and row["draft"] is False


def test_rejecting_a_draft_leaves_no_draft_behind(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from services.decision_flow import reject_decision_flow
        await _seed(db)
        await r.save_decision_as_draft("d1", user=OWNER)
        await reject_decision_flow(OWNER, "d1")
        return await db.decisions.find_one({"id": "d1"}, {"_id": 0})

    row = with_test_db(_env(scenario))
    assert row["status"] == "rejected" and row["draft"] is False


# ───────────────────────────── the Desk carries it ─────────────────────────
def test_the_desk_card_says_it_is_a_draft(with_test_db):
    async def scenario(db):
        import routers.decisions as r
        from routers.desk import _cards_needs_decision
        await _seed(db)
        before = await _cards_needs_decision(T, OWNER)
        await r.save_decision_as_draft("d1", user=OWNER)
        after = await _cards_needs_decision(T, OWNER)
        return before, after

    before, after = with_test_db(_env(scenario))
    assert before[0]["draft"] is False, "a field on every card, so the column needs no second request"
    assert after[0]["draft"] is True


def test_the_frontend_reads_the_flag_and_no_longer_keeps_its_own_list():
    """The screens take it from the decision now; the localStorage module is
    retired, and the drafts already on someone's device are carried over once."""
    from pathlib import Path
    fe = Path(__file__).resolve().parents[2] / "frontend" / "src"
    assert not (fe / "lib" / "deferredDecisions.js").exists(), "the per-device list is gone"
    drafts = (fe / "lib" / "decisionDrafts.js").read_text(encoding="utf-8")
    assert "/draft`" in drafts and "carryOverLocalDrafts" in drafts
    assert "dos_deferred_decisions" in drafts, "it still knows the old key, to carry it over"
    desk = (fe / "pages" / "Desk.js").read_text(encoding="utf-8")
    assert "isDraft(c, draftMarks)" in desk, "the row reads the card's own flag"
    dialog = (fe / "components" / "DecisionDialog.js").read_text(encoding="utf-8")
    assert "readDraft(d, draftMarks)" in dialog
    auth = (fe / "context" / "AuthContext.js").read_text(encoding="utf-8")
    assert "carryOverLocalDrafts()" in auth

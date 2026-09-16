"""What the Decision Desk may raise as a decision (2026-09-16).

Found in the browser on a live workspace: "The new office chairs arrived and
everyone likes them" came back as a decision — "Office chairs received and
approved by team", 0 tasks, 0 approvals — sitting on the owner's desk waiting
for them to approve it. The AI had read it correctly (type "observation",
confidence 0.95); the pipeline raised a decision anyway, because the only gate
asked "did this capture produce literally nothing?" and one memory note was
enough to get past it.

This is the founder's line: a decision is something an owner DECIDED or is
DIRECTING. News is not a decision. Chit-chat is not a decision, and must not
even be remembered.

Two halves, tested here:
  * `decision_worthy` — the deterministic gate, which holds whatever the model
    returns;
  * the prompt, which must carry the guard and its examples so the model does
    not produce the noise in the first place.
"""
import os

import pytest

from services.voice import decision_worthy

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="touches module-level db globals in the noted-outcome test",
)


def _p(**kinds):
    """A proposal with only the kinds named."""
    base = {"tasks": [], "workflows": [], "meetings": [], "reminders": [], "memory_notes": []}
    base.update(kinds)
    return base


def _d(*types):
    return {"decisions": [{"title": "x", "type": t} for t in types]}


# ---------------------------------------------------------------------------
# What IS a decision.
# ---------------------------------------------------------------------------
def test_work_for_someone_is_a_decision():
    assert decision_worthy(_d("directive"), _p(tasks=[{"title": "Get quotes"}]))


def test_a_meeting_to_arrange_is_a_decision():
    assert decision_worthy({}, _p(meetings=[{"title": "Meet Kapoor Traders"}]))


def test_a_personal_follow_up_is_a_decision():
    assert decision_worthy({}, _p(reminders=[{"title": "Call Kumar tomorrow"}]))


def test_a_workflow_move_is_a_decision():
    assert decision_worthy({}, _p(workflows=[{"type": "order"}]))


def test_a_rule_with_no_work_attached_is_still_a_decision():
    """"Never buy from Ravi Packers again" creates no task and must still be
    the owner's call — a policy that slipped into the company brain unapproved
    is worse than one extra card."""
    assert decision_worthy(_d("policy"), _p(memory_notes=[{"text": "Do not buy from Ravi Packers"}]))


def test_an_approval_with_no_work_attached_is_still_a_decision():
    assert decision_worthy(_d("approval"), _p(memory_notes=[{"text": "10% discount approved for Anand Fabrics"}]))


def test_a_remark_that_also_directs_work_is_a_decision():
    """"The chairs arrived — order 20 more for the new floor" is both."""
    assert decision_worthy(_d("observation", "directive"), _p(tasks=[{"title": "Order 20 more chairs"}]))


# ---------------------------------------------------------------------------
# What is NOT.
# ---------------------------------------------------------------------------
def test_a_remark_about_how_things_are_going_is_not_a_decision():
    """The exact capture from the browser run."""
    assert not decision_worthy(
        _d("observation"),
        _p(memory_notes=[{"text": "New office chairs were delivered; team feedback was positive."}]))


def test_a_greeting_is_not_a_decision():
    assert not decision_worthy({"decisions": []}, _p())


def test_a_question_is_not_a_decision():
    assert not decision_worthy({"summary": "How many invoices are pending?", "decisions": []}, _p())


def test_a_model_that_returns_nothing_useful_raises_nothing():
    assert not decision_worthy(None, None)
    assert not decision_worthy({}, {})


def test_a_malformed_decisions_list_does_not_crash_the_gate():
    """The model has returned strings and nulls in here before."""
    assert not decision_worthy({"decisions": ["chairs arrived", None]}, _p(memory_notes=[{"text": "x"}]))


def test_an_untyped_decision_item_counts_as_a_directive():
    """Older captures stored items with no type at all; treat them as work
    rather than silently dropping someone's decision."""
    assert decision_worthy({"decisions": [{"title": "Push festive stock"}]}, _p(memory_notes=[{"text": "x"}]))


# ---------------------------------------------------------------------------
# The prompt carries the guard.
# ---------------------------------------------------------------------------
def test_the_extraction_prompt_states_what_is_not_a_decision():
    from prompts import render, get
    text = render("extraction.extract", roles_str="sales,finance", cat_keys_str="sales",
                  pipe_keys_str="order", pipe_desc="order: an order", cat_desc="sales: selling",
                  members_line="Team: Priya Nair. ")
    assert "WHAT COUNTS AS A DECISION" in text
    for must in (
        "MUST be empty arrays",          # the instruction itself
        "the new chairs arrived",        # (a) a report on how things are
        "good morning",                  # (b) small talk
        "how many invoices are pending",  # (c) a question
        "MIGHT move to Anand Industries",  # (d) thinking out loud
        "NEVER invent work",             # no wrapper task around a remark
    ):
        assert must in text, f"the guard lost: {must!r}"
    assert get("extraction.extract").version != "1.0", "bump the version when the wording changes"


def test_a_greeting_never_becomes_a_company_note():
    """Small talk must not reach the brain either — the prompt says so, and the
    gate means that even if a note arrives, no decision is raised for it."""
    from prompts import render
    text = render("extraction.extract", roles_str="sales", cat_keys_str="sales",
                  pipe_keys_str="order", pipe_desc="order: an order", cat_desc="sales: selling",
                  members_line="")
    assert "a greeting is not a company record" in text


# ---------------------------------------------------------------------------
# News with a fact in it is kept, and the capture says so.
# ---------------------------------------------------------------------------
def test_news_with_a_lasting_fact_is_kept_in_the_company_brain(with_test_db):
    async def scenario(db):
        import services.voice as voice
        saved = voice.db
        voice.db = db
        try:
            kept = await voice.save_memory_notes(
                "t1", "u1",
                [{"text": "Ravi Packers were late three times in September", "tag": "vendor"},
                 {"text": ""},
                 {"text": "The team likes the new chairs", "tag": "facilities"}])
            rows = await db.memory.find({"tenant_id": "t1"}, {"_id": 0}).to_list(10)
            return kept, [r["text"] for r in rows], [r["tag"] for r in rows]
        finally:
            voice.db = saved

    kept, texts, tags = with_test_db(scenario)
    assert kept == 2, "the empty one is skipped, the two real facts are kept"
    assert "Ravi Packers were late three times in September" in texts
    assert "vendor" in tags

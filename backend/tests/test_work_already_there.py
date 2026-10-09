"""Audit 2026-10-09: C-14, C-10, C-15, C-18 -- the day-to-day flow of work.

C-14  A decision added "Send revised pro-forma invoice" and "Confirm 30% advance
      payment received" beside the card's own "Raise the pro-forma invoice" and
      "Verify advance payment or LC". Now the proposal finds the work already
      there, the review shows it ("Already on <card>: ... Sales team, due 13
      Oct") with Use that task / Add as new, and approving updates THAT task.
      Live on the scratch DB: "send the revised quotation to Northwind ... by
      Friday" matched the card's "Send a preliminary quotation to the customer";
      approving moved it to Fri 9 Oct, no second task ("1 existing task updated").
C-10  "It was done -- close it" in the Move-on box closed tasks that ask for
      proof, with none attached. Now such a task is carried on with the card and
      the box shows it as "Needs proof" with Done switched off. Live: carried to
      Quality Check; the other task closed normally.
C-15  After Approve the window kept drawing the pre-approval copy until a
      re-read came back. It shows the approved decision from the answer itself.
C-18  "Set them up" suggested the owner for every routine. Now a routine about a
      team goes to its first member. Live: loom routines -> Murugan (Loom
      Production); routines for empty teams stay with the owner.
"""
import asyncio
from pathlib import Path

import pytest

from services.voice import same_work, work_words, find_existing_work
from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"
NW = work_words("Northwind Apparel")


@pytest.mark.parametrize("a,b,ignore", [
    ("Send revised pro-forma invoice", "Raise the pro-forma invoice for the buyer", set()),
    ("Confirm 30% advance payment received", "Verify advance payment or LC", set()),
    ("Send revised quotation to Northwind Apparel", "Send a preliminary quotation to the customer", NW),
    ("Send dispatch challan", "Prepare dispatch challan and delivery details", set()),
])
def test_the_same_work_is_recognised(a, b, ignore):
    assert same_work(a, b, ignore=ignore)


@pytest.mark.parametrize("a,b,ignore", [
    ("Collect the balance payment", "Confirm the advance payment", set()),
    ("Call Northwind about the indigo lot", "Send a preliminary quotation to the customer", NW),
    ("Book the truck for Tiruppur", "Raise the pro-forma invoice", set()),
])
def test_different_work_is_not(a, b, ignore):
    assert not same_work(a, b, ignore=ignore)


def test_off_the_card_the_bar_is_higher():
    assert not same_work("Send revised pro-forma invoice", "Raise the pro-forma invoice", strict=True)
    assert same_work("Prepare GST return for September filing", "September GST return filing prep", strict=True)


def test_the_proposal_marks_the_existing_task(monkeypatch):
    import services.voice as v
    d = FakeDB()
    d.workflows.docs.append({"id": "wf1", "tenant_id": "t1", "title": "Northwind poplin order",
                             "counterparty": "Northwind Apparel"})
    d.tasks.docs += [
        {"id": "k1", "tenant_id": "t1", "title": "Raise the pro-forma invoice for the buyer", "status": "todo",
         "workflow_id": "wf1", "assignee_role": "accounts", "due_date": "2026-10-12", "created_at": "1"},
        {"id": "k2", "tenant_id": "t1", "title": "Log the inquiry", "status": "done", "workflow_id": "wf1",
         "created_at": "2"},
    ]
    monkeypatch.setattr(v, "db", d)
    tasks = [{"key": "a", "title": "Send revised pro-forma invoice to Northwind Apparel", "workflow_id": "wf1"},
             {"key": "b", "title": "Book the truck for Tiruppur", "workflow_id": "wf1"}]
    asyncio.run(find_existing_work("t1", tasks, []))
    assert tasks[0]["use_existing"] is True and tasks[0]["existing"]["id"] == "k1"
    assert tasks[0]["existing"]["workflow_title"] == "Northwind poplin order"
    assert "existing" not in tasks[1], "unrelated work is new work"


def test_approving_updates_the_task_instead_of_copying_it(monkeypatch):
    import services.voice as v
    d = FakeDB()
    d.tasks.docs.append({"id": "k1", "tenant_id": "t1", "title": "Raise the pro-forma invoice", "status": "todo",
                         "assignee_id": None, "due_date": "2026-10-12"})
    monkeypatch.setattr(v, "db", d)

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(v, "log_activity", _noop)
    reused = []
    items = [{"title": "Send revised pro-forma invoice", "use_existing": True, "existing": {"id": "k1"},
              "assignee_id": "rahul", "assignee_role": "sales", "due_date": "2026-10-09"}]
    made = asyncio.run(v._create_decision_tasks("t1", {"id": "dec1", "created_by": "u1"}, items, reused))
    assert made == [] and reused == ["k1"], "no new task; the existing one is used"
    k1 = d.tasks.docs[0]
    assert len(d.tasks.docs) == 1
    assert (k1["assignee_id"], k1["due_date"]) == ("rahul", "2026-10-09")


def test_the_review_and_the_message_say_so():
    s = (FE / "components" / "DecisionDialog.js").read_text(encoding="utf-8")
    for tid in ("decision-task-existing-", "decision-task-use-existing-", "decision-task-add-new-"):
        assert tid in s
    assert "existing task${reused === 1 ? \"\" : \"s\"} updated" in s
    # C-15: the approved answer is drawn at once
    assert 'qc.setQueryData(["decision", decisionId], (old) => ({ ...(old || {}), ...res.data }));' in s
    flow = (ROOT / "services" / "decision_flow.py").read_text(encoding="utf-8")
    assert "use_existing" in flow and "Used the existing task" in flow


# ---- C-10 ---------------------------------------------------------------------
def test_a_task_that_needs_proof_is_carried_not_closed():
    src = (ROOT / "services" / "workflow_engine.py").read_text(encoding="utf-8")
    assert 'if action == "done" and t.get("evidence_required") and not _has_proof(t):' in src
    from services.workflow_engine import _has_proof
    assert not _has_proof({"attachments": [{"kind": "reference"}]})
    assert _has_proof({"attachments": [{"kind": "photo"}]})
    box = (FE / "components" / "workflow" / "LeftoverReview.js").read_text(encoding="utf-8")
    assert "Needs proof — attach it on the task to close it" in box
    assert 'const blocked = c.key === "done" && needsProof(t);' in box


# ---- C-18 ---------------------------------------------------------------------
def test_a_routine_goes_to_its_team(monkeypatch):
    import services.routines as r
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": [{"key": "accounts_&_gst", "label": "Accounts & GST"},
                                                 {"key": "loom_production", "label": "Loom Production"}],
                           "operational_task_templates": [
                               {"title": "Monthly export invoice reconciliation with Accounts"},
                               {"title": "Check loom running status each morning"},
                               {"title": "Weekly review of order backlog"}]})
    d.users.docs += [{"id": "o", "tenant_id": "t1", "role": "owner", "name": "Meera"},
                     {"id": "a", "tenant_id": "t1", "role": "accounts_&_gst", "name": "Arun"}]
    d.memberships.docs += [{"user_id": "o", "tenant_id": "t1", "status": "active"},
                           {"user_id": "a", "tenant_id": "t1", "status": "active"}]
    monkeypatch.setattr(r, "db", d)
    view = asyncio.run(r.setup_view({"id": "o", "tenant_id": "t1"}))
    who = {i["title"]: (i["assignee_id"], i.get("suggested_team")) for i in view["items"]}
    assert who["Monthly export invoice reconciliation with Accounts"] == ("a", "Accounts & GST")
    assert who["Check loom running status each morning"] == ("o", None), "the loom team has nobody yet"
    assert who["Weekly review of order backlog"] == ("o", None)

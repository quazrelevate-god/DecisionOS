"""ASK-32 decision flow Phase 1 — with REAL saves in an isolated test database.

Drives the real services and routers (process_voice_note, approve / reject,
submit a held recording, execute_capture, update_task, the Desk card) against
with_test_db (dropped at teardown) with the AI and speech-to-text stubbed:

  1.1  capture proposes; nothing exists until approval; approval creates it all
  1.3  approve / reject only while pending, only by the named approver or an owner
  1.2  a task an older decision created blocked cannot start before approval
  1.4  a capture with nothing to act on makes no decision
  1.5  the same capture again within a day is flagged as a repeat
  1.6  a held recording + its reviewed words make ONE decision
  1.8  a WhatsApp capture approves through the same path
  1.9  /dex/capture needs the voice_capture permission

Single-process (reaches shared clients):
    .venv/Scripts/python -m pytest tests/test_decision_flow_e2e.py -o addopts="" -p no:xdist
"""
import os

import pytest
from fastapi import BackgroundTasks, HTTPException

from services.enrich import enrich_decision as real_enrich  # bound before the harness swaps it out
from shared.ids import now_iso
from tests.e2e_harness import e2e_env, seed_tenant_and_users

# The decision timeline is part of what these journeys check, so its writer is
# kept real (it writes to the patched test database).
KEEP = {"core.add_decision_event"}

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="in-process E2E reaches shared Mongo clients -> run single-process, not under xdist")

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Owner"}
FIN = {"id": "u-finance", "tenant_id": T, "role": "finance", "name": "Finance User",
       "permissions": ["inbox", "tasks", "finance", "approvals", "decisions_approve"]}
SALES = {"id": "u-sales", "tenant_id": T, "role": "sales", "name": "Sales User"}

STATE = {"extract": None, "pipeline": None}


async def fake_extract(transcript, session_id, allowed_roles=None, members=None,
                       pipelines=None, task_categories=None, extra_context=""):
    return STATE["extract"](transcript)


def rich(transcript):
    return {
        "summary": "Buy 50 spindles from Rajesh Traders and tell Sales", "confidence": 0.92, "needs_review": False,
        "decisions": [{"title": "Buy 50 spindles from Rajesh Traders", "type": "approval"}],
        "tasks": [{"title": "Tell the customer the new date", "assignee_name": "Sales User",
                   "assignee_role": "sales", "priority": "high", "due_in_days": 2}],
        "workflow_events": [{"type": STATE["pipeline"], "title": "PO: 50 spindles", "counterparty": "Rajesh Traders",
                             "amount": 80000}],
        "meeting_events": [{"title": "Supplier call", "when": "tomorrow"}],
        "reminders": [{"title": "Check the spindle delivery", "due_in_days": 5}],
        "memory_notes": [{"text": "Spindles come from Rajesh Traders", "tag": "supplier"}],
    }


def nothing(transcript):
    return {"summary": "Founder asked about this month's profit", "confidence": 0.9, "needs_review": False,
            "decisions": [{"title": "Profit inquiry", "type": "observation"}], "tasks": [],
            "workflow_events": [], "meeting_events": [], "reminders": [], "memory_notes": []}


async def fake_stt(path, language="auto"):
    return {"transcript": "buy fifty spindles", "language_code": "ta-IN", "language_name": "Tamil", "engine": "stub"}


STUBS = {"services.voice.ai_extract": fake_extract, "services.voice.transcribe_audio_full": fake_stt}


async def _setup(db):
    await seed_tenant_and_users(db)
    await db.users.update_one({"id": "u-finance"}, {"$set": {"permissions": FIN["permissions"]}})
    from services.ai.generators import tenant_operating_model
    om = await tenant_operating_model(T)
    STATE["pipeline"] = om["pipelines"][0]["key"]


async def _capture(db, text="Buy 50 spindles", extract=rich, **note):
    import services.voice as voice
    STATE["extract"] = extract
    nid = f"vn-{await db.voice_notes.count_documents({}) + 1}"
    await db.voice_notes.insert_one({"id": nid, "tenant_id": T, "created_by": "u-owner", "kind": "text",
                                     "transcript": text, "language": "auto", "status": "queued",
                                     "created_at": now_iso(), **note})
    await voice.process_voice_note(nid)
    return await db.voice_notes.find_one({"id": nid}, {"_id": 0})


async def _refused(coro, status):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


def test_capture_proposes_and_approval_creates(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import routers.decisions as decisions
            import routers.desk as desk
            vn = await _capture(db)
            dec = await db.decisions.find_one({"id": vn["decision_id"]}, {"_id": 0})
            assert dec["status"] == "pending_approval"
            p = dec["proposal"]
            assert [t["assignee_id"] for t in p["tasks"]] == ["u-sales"] and p["tasks"][0]["assignee_how"] == "named"
            assert len(p["workflows"]) == 1 and p["workflows"][0]["amount"] == 80000
            assert (len(p["meetings"]), len(p["reminders"]), len(p["memory_notes"])) == (1, 1, 1)
            for coll in ("tasks", "workflows", "calendar_events", "memory"):
                assert await db[coll].count_documents({"tenant_id": T}) == 0, f"{coll} created before approval"

            card = next(c for c in await desk._cards_needs_decision(T, OWNER) if c["id"] == dec["id"])
            assert "On approval: 1 task, 1 workflow" in card["context_line"] and card["amount"] == 80000

            out = await decisions.approve_decision(dec["id"], user=OWNER)
            assert out["status"] == "approved" and out["decided_by"] == "u-owner"
            assert out["created_on_approval"]["task_ids"] == 1 and out["created_on_approval"]["workflow_ids"] == 1
            work = await db.tasks.find_one({"tenant_id": T, "decision_id": dec["id"], "source": {"$nin": ["reminder", "meeting"]}})
            assert work["status"] == "todo" and work["assignee_id"] == "u-sales" and work["priority"] == "high"
            # Phase 4.2: "tell the customer the new date" names no supplier or
            # customer with a workflow, so it stays a plain task.
            assert work["created_by"] == "u-owner" and work.get("workflow_id") is None, work
            assert await db.workflows.count_documents({"tenant_id": T, "decision_id": dec["id"]}) == 1
            assert await db.calendar_events.count_documents({"tenant_id": T, "decision_id": dec["id"]}) == 1
            assert await db.memory.count_documents({"tenant_id": T}) == 1
            assert await db.tasks.count_documents({"tenant_id": T, "source": "reminder"}) == 1
            assert out["task_ids"] == [work["id"]]

            # Once decided, it stays decided.
            await _refused(decisions.approve_decision(dec["id"], user=OWNER), 409)
            await _refused(decisions.reject_decision(dec["id"], user=OWNER), 409)
            return True
    assert with_test_db(scenario) is True


def test_reject_creates_nothing_and_only_the_decider_decides(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await _setup(db)
            import routers.decisions as decisions
            vn = await _capture(db)
            did = vn["decision_id"]
            dec = await db.decisions.find_one({"id": did}, {"_id": 0, "approver_id": 1})
            assert dec["approver_id"] == "u-owner", "the owner captured it and can approve, so it is theirs"
            detail = await _refused(decisions.approve_decision(did, user=FIN), 403)
            assert "Owner" in detail
            await _refused(decisions.reject_decision(did, user=FIN), 403)
            # The named approver (not an owner) can open and decide it.
            await db.decisions.update_one({"id": did}, {"$set": {"approver_id": "u-finance"}})
            opened = await decisions.get_decision(did, user=FIN)
            assert (await real_enrich(opened, tenant_id=T))["approver_name"] == "Finance User"
            out = await decisions.reject_decision(did, user=FIN)
            assert out["status"] == "rejected" and out["decided_by_name"] == "Finance User"
            assert out["timeline"][-1]["label"] == "Rejected — nothing was created"
            for coll in ("tasks", "workflows", "calendar_events", "memory"):
                assert await db[coll].count_documents({"tenant_id": T}) == 0, coll
            return True
    assert with_test_db(scenario) is True


def test_nothing_to_decide_and_repeats(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            vn = await _capture(db, "What is my profit this month?", extract=nothing)
            assert vn["status"] == "done" and vn["outcome"] == "nothing_to_decide" and not vn.get("decision_id")
            assert "profit" in vn["summary"]
            assert await db.decisions.count_documents({"tenant_id": T}) == 0
            assert await db.inbox.count_documents({"tenant_id": T}) == 0

            first = await _capture(db)
            again = await _capture(db)
            d2 = await db.decisions.find_one({"id": again["decision_id"]}, {"_id": 0})
            assert d2["repeat_of"]["id"] == first["decision_id"] and d2["needs_review"] is True
            assert any("repeat" in r for r in d2["review_reasons"])
            return True
    assert with_test_db(scenario) is True


def test_held_recording_makes_one_decision(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import services.voice as voice
            import routers.voice_notes as vnotes
            from models.voice import SubmitNoteInput
            STATE["extract"] = rich
            await db.voice_notes.insert_one({"id": "vn-held", "tenant_id": T, "created_by": "u-owner", "kind": "audio",
                                             "audio_path": "voice-notes/x.webm", "transcript": None, "language": "auto",
                                             "status": "queued", "held": True, "created_at": now_iso()})
            await voice.process_voice_note("vn-held", hold=True)
            note = await db.voice_notes.find_one({"id": "vn-held"}, {"_id": 0})
            assert note["status"] == "transcribed" and note["transcript"] == "buy fifty spindles"
            assert note["detected_language_name"] == "Tamil"
            assert await db.decisions.count_documents({"tenant_id": T}) == 0, "a held recording is not a decision yet"

            # Someone else cannot send it; the recorder sends the reviewed words once.
            await _refused(vnotes.submit_held_note("vn-held", SubmitNoteInput(text="x"), BackgroundTasks(), user=FIN), 404)
            res = await vnotes.submit_held_note("vn-held", SubmitNoteInput(text="Buy 50 spindles from Rajesh"),
                                                BackgroundTasks(), user=OWNER)
            assert res["status"] == "queued"
            await _refused(vnotes.submit_held_note("vn-held", SubmitNoteInput(text="again"), BackgroundTasks(), user=OWNER), 409)
            await voice.process_voice_note("vn-held")  # what the background task runs
            note = await db.voice_notes.find_one({"id": "vn-held"}, {"_id": 0})
            assert note["transcript"] == "Buy 50 spindles from Rajesh" and note["edited"] is True
            assert await db.decisions.count_documents({"tenant_id": T}) == 1
            return True
    assert with_test_db(scenario) is True


def test_older_blocked_task_waits_for_its_decision(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import routers.decisions as decisions
            import routers.tasks as tasks
            from models.tasks import TaskUpdateInput
            await db.decisions.insert_one({"id": "old-dec", "tenant_id": T, "title": "Dispatch 100 items",
                                           "status": "pending_approval", "created_by": "u-owner",
                                           "task_ids": ["old-t"], "created_at": now_iso()})
            await db.tasks.insert_one({"id": "old-t", "tenant_id": T, "title": "Pack 100 items", "status": "blocked",
                                       "decision_id": "old-dec", "assignee_id": "u-sales", "assignee_role": "sales",
                                       "created_at": now_iso()})
            detail = await _refused(tasks.update_task("old-t", TaskUpdateInput(status="in_progress"), user=SALES), 403)
            assert "Dispatch 100 items" in detail
            await _refused(tasks.update_task("old-t", TaskUpdateInput(progress=40), user=SALES), 403)
            await decisions.approve_decision("old-dec", user=OWNER)
            assert (await db.tasks.find_one({"id": "old-t"}))["status"] == "todo"
            await tasks.update_task("old-t", TaskUpdateInput(status="in_progress"), user=SALES)
            assert (await db.tasks.find_one({"id": "old-t"}))["status"] == "in_progress"
            return True
    assert with_test_db(scenario) is True


def test_whatsapp_capture_approves_through_the_one_path(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await _setup(db)
            import services.captures as captures
            STATE["extract"] = rich
            draft = {"id": "cd1", "tenant_id": T, "kind": "text", "text": "Buy 50 spindles", "wa_from": "+919800000000",
                     "assignee_id": "u-operations", "priority": "low"}
            res = await captures.execute_capture(draft, FIN)
            dec = await db.decisions.find_one({"id": res["id"]}, {"_id": 0})
            assert dec["status"] == "approved" and dec["decided_by"] == "u-finance" and dec.get("decided_at")
            assert any(e["label"].startswith("Approved — created") for e in dec["timeline"])
            work = await db.tasks.find_one({"tenant_id": T, "decision_id": dec["id"], "source": {"$nin": ["reminder", "meeting"]}})
            assert work["assignee_id"] == "u-operations" and work["priority"] == "low" and work["status"] == "todo"

            STATE["extract"] = nothing
            res2 = await captures.execute_capture({**draft, "id": "cd2", "text": "profit?"}, FIN)
            assert res2 == {"type": "decision", "id": None, "nothing_to_decide": True}
            return True
    assert with_test_db(scenario) is True


def test_dex_capture_needs_voice_capture(with_test_db):
    async def scenario(db):
        # Inside the harness: the operating-model read must hit the test database.
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import routers.dex as dex
            await _refused(dex.dex_capture(BackgroundTasks(), text="Buy spindles", file=None, language="auto",
                                           file_ids="", user=SALES), 403)
            res = await dex.dex_capture(BackgroundTasks(), text="Buy spindles", file=None, language="auto",
                                        file_ids="", user=OWNER)
            assert res["status"] == "queued"
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# Phase 2 — who decides, who is told, and handing a decision to someone else
# ---------------------------------------------------------------------------
KEEP_TOLD = {"core.add_decision_event", "services.notifications.push_notification"}


def for_ops(transcript):
    out = rich(transcript)
    out["tasks"][0]["assignee_name"] = "Operations User"
    out["tasks"][0]["assignee_role"] = "operations"
    return out


async def _told(db, user_id, entity_id):
    return [n.get("message") async for n in db.notifications.find({"user_id": user_id, "entity_id": entity_id}, {"_id": 0})]


def test_decider_is_routed_and_told(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS, keep=KEEP_TOLD):
            await _setup(db)
            import routers.decisions as decisions
            import routers.desk as desk
            # Sales reports to Finance (who may decide); Operations reports to Sales (who may not).
            await db.users.update_one({"id": "u-sales"}, {"$set": {"reporting_manager_id": "u-finance"}})
            await db.users.update_one({"id": "u-operations"}, {"$set": {"reporting_manager_id": "u-sales"}})

            by_sales = await _capture(db, "Buy spindles", extract=for_ops, created_by="u-sales")
            d1 = await db.decisions.find_one({"id": by_sales["decision_id"]}, {"_id": 0})
            assert (d1["approver_id"], d1["approver_route"]) == ("u-finance", "manager")
            assert await _told(db, "u-finance", d1["id"]), "the manager who decides is told"
            assert not await _told(db, "u-sales", d1["id"]), "the person who captured it is not told it waits"

            by_ops = await _capture(db, "Hire a driver", extract=for_ops, created_by="u-operations")
            d2 = await db.decisions.find_one({"id": by_ops["decision_id"]}, {"_id": 0})
            assert (d2["approver_id"], d2["approver_route"]) == ("u-owner", "owner"), "manager cannot decide -> the owner"

            by_owner = await _capture(db, "Buy more", extract=for_ops)
            d3 = await db.decisions.find_one({"id": by_owner["decision_id"]}, {"_id": 0})
            assert (d3["approver_id"], d3["approver_route"]) == ("u-owner", "captured")
            assert not await _told(db, "u-owner", d3["id"]), "nobody is told about their own capture"

            # The Desk: Sales follows theirs (not counted); Finance has one to decide.
            sales_desk = await desk.desk_chip(chip="needs_decision", user=SALES)
            follow = [c for c in sales_desk["cards"] if c["id"] == d1["id"]]
            assert follow and follow[0]["cta"] == "follow" and "Waiting on Finance User" in follow[0]["context_line"]
            assert sales_desk["counters"]["needs_decision"] == 0
            fin_desk = await desk.desk_chip(chip="needs_decision", user=FIN)
            assert [c["cta"] for c in fin_desk["cards"] if c["id"] == d1["id"]] == ["review"]
            assert fin_desk["counters"]["needs_decision"] == 1

            # Approving tells the person the work went to and the person who raised it.
            await decisions.approve_decision(d1["id"], user=FIN)
            work = await db.tasks.find_one({"decision_id": d1["id"], "source": {"$nin": ["reminder", "meeting"]}}, {"_id": 0})
            assert work["assignee_id"] == "u-operations"
            assert any("Work assigned to you" in m for m in await _told(db, "u-operations", work["id"]))
            assert any("approved your decision" in m for m in await _told(db, "u-sales", d1["id"]))
            # Rejecting tells the person who raised it.
            await decisions.reject_decision(d2["id"], user=OWNER)
            assert any("rejected your decision" in m for m in await _told(db, "u-operations", d2["id"]))
            return True
    assert with_test_db(scenario) is True


def test_hand_a_decision_to_someone_else(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS, keep=KEEP_TOLD):
            await _setup(db)
            import routers.decisions as decisions
            from models.decisions import DecisionApproverInput
            await db.users.update_one({"id": "u-sales"}, {"$set": {"reporting_manager_id": "u-finance"}})
            vn = await _capture(db, "Buy spindles", extract=for_ops, created_by="u-sales")
            did = vn["decision_id"]
            assert {p["id"] for p in await decisions.decision_approvers(did, user=SALES)} == {"u-owner", "u-finance"}

            await _refused(decisions.change_decision_approver(did, DecisionApproverInput(approver_id="u-owner"), user=SALES), 403)
            detail = await _refused(decisions.change_decision_approver(did, DecisionApproverInput(approver_id="u-operations"), user=OWNER), 400)
            assert "Operations User" in detail

            await decisions.change_decision_approver(did, DecisionApproverInput(approver_id="u-owner"), user=FIN)
            d = await db.decisions.find_one({"id": did}, {"_id": 0})
            assert (d["approver_id"], d["approver_route"]) == ("u-owner", "changed")
            assert d["timeline"][-1]["label"] == "Sent to Owner to decide"
            assert any("sent you a decision" in m for m in await _told(db, "u-owner", did))
            await _refused(decisions.approve_decision(did, user=FIN), 403)
            await decisions.approve_decision(did, user=OWNER)
            await _refused(decisions.change_decision_approver(did, DecisionApproverInput(approver_id="u-finance"), user=OWNER), 409)
            return True
    assert with_test_db(scenario) is True


def test_backfill_names_who_decides_on_older_waiting_decisions(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import services.decision_flow as dflow
            await db.users.update_one({"id": "u-sales"}, {"$set": {"reporting_manager_id": "u-finance"}})
            for did, by, status in (("old-1", "u-sales", "pending_approval"), ("old-2", "u-owner", "pending_approval"),
                                    ("done-1", "u-sales", "approved")):
                await db.decisions.insert_one({"id": did, "tenant_id": T, "title": did, "created_by": by,
                                               "status": status, "created_at": now_iso()})
            assert await dflow.name_waiting_approvers(db) == {"named": 2, "left_with_every_owner": 0}
            got = {d["id"]: (d.get("approver_id"), d.get("approver_route")) async for d in db.decisions.find({}, {"_id": 0})}
            assert got["old-1"] == ("u-finance", "backfill_manager")
            assert got["old-2"] == ("u-owner", "backfill_captured")
            assert got["done-1"] == (None, None), "decided decisions are left alone"
            return True
    assert with_test_db(scenario) is True


# ---------------------------------------------------------------------------
# Phase 3 — change the proposal before approving; what was said
# Phase 4 — existing workflows are used, tasks join them, approval moves them
# ---------------------------------------------------------------------------
async def _pipeline_with_approval():
    from services.ai.generators import tenant_operating_model
    om = await tenant_operating_model(T)
    return next(p for p in om["pipelines"] if p.get("approval_stage")), om


def test_change_the_proposal_before_approving(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await _setup(db)
            import routers.decisions as decisions
            from models.decisions import DecisionProposalTaskInput
            vn = await _capture(db)
            did = vn["decision_id"]
            d = await db.decisions.find_one({"id": did}, {"_id": 0})
            tkey = d["proposal"]["tasks"][0]["key"]
            mkey = d["proposal"]["meetings"][0]["key"]

            await _refused(decisions.edit_decision_proposal_task(did, tkey, DecisionProposalTaskInput(assignee_id="u-operations"), user=FIN), 403)
            await _refused(decisions.edit_decision_proposal_task(did, tkey, DecisionProposalTaskInput(due_date="30/09/2026"), user=OWNER), 400)
            await decisions.edit_decision_proposal_task(did, tkey, DecisionProposalTaskInput(assignee_id="u-operations", due_date="2026-10-01"), user=OWNER)
            await decisions.remove_decision_proposal_item(did, "meetings", mkey, user=OWNER)
            d = await db.decisions.find_one({"id": did}, {"_id": 0})
            t = d["proposal"]["tasks"][0]
            assert (t["assignee_id"], t["assignee_how"], t["due_date"]) == ("u-operations", "picked", "2026-10-01")
            assert d["proposal"]["meetings"] == [] and d["execution_summary"]["meetings"] == 0
            assert any("Changed before approval" in e["label"] for e in d["timeline"])
            assert any("Removed before approval" in e["label"] for e in d["timeline"])

            await decisions.approve_decision(did, user=OWNER)
            work = await db.tasks.find_one({"decision_id": did, "source": {"$nin": ["reminder", "meeting"]}}, {"_id": 0})
            assert (work["assignee_id"], work["due_date"]) == ("u-operations", "2026-10-01")
            assert await db.calendar_events.count_documents({"decision_id": did}) == 0, "the removed meeting is not created"
            await _refused(decisions.edit_decision_proposal_task(did, tkey, DecisionProposalTaskInput(due_date="2026-10-02"), user=OWNER), 409)
            return True
    assert with_test_db(scenario) is True


def test_what_was_said_is_shown(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import routers.decisions as decisions
            import routers.voice_notes as vnotes
            vn = await _capture(db, "Buy 50 spindles from Rajesh Traders and tell the customer")
            d = await real_enrich(await decisions.get_decision(vn["decision_id"], user=OWNER), tenant_id=T)
            assert d["said"]["text"] == "Buy 50 spindles from Rajesh Traders and tell the customer"
            assert d["said"]["how"] == "text" and d["said"]["has_audio"] is False
            await _refused(vnotes.voice_note_audio(vn["id"], user=OWNER), 404)
            return True
    assert with_test_db(scenario) is True


def test_existing_workflow_is_moved_not_duplicated(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await _setup(db)
            import routers.decisions as decisions
            from services.ai.generators import tenant_operating_model
            om = await tenant_operating_model(T)
            p = next(x for x in om["pipelines"] if len(x["stages"]) >= 3 and x.get("approval_stage") != x["stages"][1]["key"])
            keys = [s["key"] for s in p["stages"]]
            next_label = p["stages"][1]["label"]
            await db.workflows.insert_one({"id": "wf-toyota", "tenant_id": T, "type": p["key"], "title": "Toyota order",
                                           "counterparty": "Toyota Kirloskar Pvt Ltd", "stage": keys[0], "stages": keys,
                                           "stage_version": 0, "history": [{"stage": keys[0], "note": "Created"}], "created_at": now_iso()})
            await db.workflows.insert_one({"id": "wf-kapoor", "tenant_id": T, "type": p["key"], "title": "Kapoor order",
                                           "counterparty": "Kapoor Retail", "stage": keys[0], "stages": keys,
                                           "stage_version": 0, "history": [], "created_at": now_iso()})

            def toyota(_t):
                return {"summary": "Move Toyota on and tell Kapoor", "confidence": 0.9, "needs_review": False,
                        "decisions": [{"title": "Move the Toyota order on", "type": "directive"}],
                        "tasks": [{"title": "Call Toyota about the new date", "assignee_name": "Sales User", "assignee_role": "sales"},
                                  {"title": "Send the Kapoor Retail invoice copy", "assignee_name": "Finance User", "assignee_role": "finance"},
                                  {"title": "Clean the warehouse", "assignee_name": "Operations User", "assignee_role": "operations"}],
                        "workflow_events": [{"type": p["key"], "title": "Toyota order", "counterparty": "Toyota",
                                             "detail": "Move it to " + next_label}],
                        "meeting_events": [], "reminders": [], "memory_notes": []}

            vn = await _capture(db, "Move the Toyota order on", extract=toyota)
            d = await db.decisions.find_one({"id": vn["decision_id"]}, {"_id": 0})
            wf = d["proposal"]["workflows"][0]
            assert (wf["mode"], wf["workflow_id"], wf["move_to"]) == ("existing", "wf-toyota", keys[1])
            by_title = {t["title"]: t for t in d["proposal"]["tasks"]}
            assert by_title["Call Toyota about the new date"].get("workflow_key") == wf["key"]
            assert by_title["Send the Kapoor Retail invoice copy"].get("workflow_id") == "wf-kapoor"
            assert not by_title["Clean the warehouse"].get("workflow_key") and not by_title["Clean the warehouse"].get("workflow_id")

            await decisions.approve_decision(d["id"], user=OWNER)
            assert await db.workflows.count_documents({"tenant_id": T, "type": p["key"]}) == 2, "no duplicate card"
            assert (await db.workflows.find_one({"id": "wf-toyota"}))["stage"] == keys[1]
            made = {t["title"]: t async for t in db.tasks.find({"decision_id": d["id"]}, {"_id": 0})}
            call = made["Call Toyota about the new date"]
            assert (call["workflow_id"], call["stage_key"]) == ("wf-toyota", keys[1])
            assert made["Send the Kapoor Retail invoice copy"]["workflow_id"] == "wf-kapoor"
            assert made["Clean the warehouse"].get("workflow_id") is None, "a plain task stays plain"
            dd = await db.decisions.find_one({"id": d["id"]}, {"_id": 0})
            assert any("moved to" in e["label"] for e in dd["timeline"])
            return True
    assert with_test_db(scenario) is True


def test_manager_approval_moves_a_new_workflow_into_its_approval_stage(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import routers.decisions as decisions
            p, _om = await _pipeline_with_approval()
            await db.users.update_one({"id": "u-sales"}, {"$set": {"reporting_manager_id": "u-finance"}})

            def buy(_t):
                return {"summary": "Buy dye", "confidence": 0.9, "needs_review": False,
                        "decisions": [{"title": "Buy dye", "type": "approval"}], "tasks": [],
                        "workflow_events": [{"type": p["key"], "title": "PO: dye", "counterparty": "New Dye Co", "amount": 12000}],
                        "meeting_events": [], "reminders": [], "memory_notes": []}
            vn = await _capture(db, "Buy dye", extract=buy, created_by="u-sales")
            d = await db.decisions.find_one({"id": vn["decision_id"]}, {"_id": 0})
            assert d["approver_id"] == "u-finance"
            await decisions.approve_decision(d["id"], user=FIN)
            wf = await db.workflows.find_one({"decision_id": d["id"]}, {"_id": 0})
            assert wf["stage"] == p["approval_stage"], "a manager approval moves it too (was stuck at " + wf["stage"] + ")"
            return True
    assert with_test_db(scenario) is True


def test_dex_chat_proposal_creates_nothing_until_approved(with_test_db):
    async def scenario(db):
        with e2e_env(db, stubs=STUBS):
            await _setup(db)
            import services.ai.agent_tools as tools
            out = await tools._t_propose_task(OWNER, title="Call Kumar about the dye lot", assignee_name="Sales User", assignee_role="sales")
            d = await db.decisions.find_one({"id": out["decision_id"]}, {"_id": 0})
            assert d["status"] == "pending_approval" and d["approver_id"] == "u-owner"
            assert [t["assignee_id"] for t in d["proposal"]["tasks"]] == ["u-sales"]
            assert await db.tasks.count_documents({"tenant_id": T}) == 0
            return True
    assert with_test_db(scenario) is True

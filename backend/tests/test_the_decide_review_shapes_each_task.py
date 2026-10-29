"""The Decide review shapes each task before it exists (founder, 2026-10-29).

The redesigned review (Review & Approve → Tasks created by Dex → one task)
lets whoever decides give a proposed task its details, its tags and the tasks
in the same decision it waits for, and add a task Dex did not hear. All of it
is held on the proposal and applied when approval creates the tasks.

Offline, against the same small in-memory stand-in test_proposal_task_settings
uses: no server, no Mongo.
"""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.test_proposal_task_settings import OWNER, MANAGER, DOER, _DB

pytestmark = pytest.mark.unit

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _decision():
    return {"id": "dec", "tenant_id": "ten", "title": "Ship the lot", "status": "pending_approval",
            "created_by": "u_owner", "approver_id": None,
            "proposal": {"tasks": [
                {"key": "t1", "title": "Pack the lot", "assignee_id": "u_doer", "priority": "medium"},
                {"key": "t2", "title": "Raise the invoice", "assignee_id": "u_doer", "priority": "medium"},
            ]}}


def _flow(monkeypatch, decision):
    import services.decision_flow as flow
    db = _DB(decisions=[decision], users=[OWNER, MANAGER, DOER])
    monkeypatch.setattr(flow, "db", db)
    events = []

    async def _event(did, label, *a, **k):
        events.append(label)

    monkeypatch.setattr(flow, "add_decision_event", _event)
    return flow, db, events


def _task(d, key):
    return next(t for t in d["proposal"]["tasks"] if t["key"] == key)


def test_details_and_tags_are_held_on_the_proposal(monkeypatch):
    flow, _, events = _flow(monkeypatch, _decision())
    d = asyncio.run(flow.edit_proposal_task(OWNER, "dec", "t1", description="  Twelve cartons, the blue tape  ",
                                            tags=["Dispatch", " dispatch ", "Q4", "", "x" * 40]))
    t = _task(d, "t1")
    assert t["description"] == "Twelve cartons, the blue tape"
    assert t["tags"] == ["Dispatch", "Q4", "x" * 24], "trimmed, no repeats, short"
    assert "details changed" in events[0] and "tagged Dispatch" in events[0]


def test_a_task_can_wait_for_another_in_the_same_decision(monkeypatch):
    flow, _, events = _flow(monkeypatch, _decision())
    d = asyncio.run(flow.edit_proposal_task(OWNER, "dec", "t2", depends_on=["t1"]))
    assert _task(d, "t2")["depends_on"] == ["t1"]
    assert "waits for Pack the lot" in events[0]


def test_two_tasks_cannot_wait_for_each_other(monkeypatch):
    dec = _decision()
    dec["proposal"]["tasks"][1]["depends_on"] = ["t1"]
    flow, _, _ = _flow(monkeypatch, dec)
    with pytest.raises(HTTPException) as e:
        asyncio.run(flow.edit_proposal_task(OWNER, "dec", "t1", depends_on=["t2"]))
    assert e.value.status_code == 400 and "wait on each other" in e.value.detail
    with pytest.raises(HTTPException):
        asyncio.run(flow.edit_proposal_task(OWNER, "dec", "t1", depends_on=["gone"]))


def test_removing_a_task_frees_the_ones_waiting_for_it(monkeypatch):
    dec = _decision()
    dec["proposal"]["tasks"][1]["depends_on"] = ["t1"]
    flow, _, _ = _flow(monkeypatch, dec)
    d = asyncio.run(flow.remove_proposal_item(OWNER, "dec", "tasks", "t1"))
    assert [t["key"] for t in d["proposal"]["tasks"]] == ["t2"]
    assert _task(d, "t2")["depends_on"] == []


def test_add_another_task(monkeypatch):
    flow, _, events = _flow(monkeypatch, _decision())
    d = asyncio.run(flow.add_proposal_task(OWNER, "dec", "  Book the  transporter "))
    added = d["proposal"]["tasks"][-1]
    assert added["title"] == "Book the transporter" and added["key"] not in ("t1", "t2")
    assert added["assignee_id"] is None and added["due_date"] is None, "the review flags both"
    assert events == ["Added before approval: task “Book the transporter”"]
    with pytest.raises(HTTPException):
        asyncio.run(flow.add_proposal_task(OWNER, "dec", "   "))


def test_nobody_else_can_add_to_it(monkeypatch):
    flow, _, _ = _flow(monkeypatch, _decision())
    with pytest.raises(HTTPException) as e:
        asyncio.run(flow.add_proposal_task(DOER, "dec", "Sneak one in"))
    assert e.value.status_code == 403


def test_approval_creates_the_tags_and_the_wait(monkeypatch):
    import services.voice as voice
    db = _DB(tasks=[], users=[OWNER, MANAGER, DOER])
    monkeypatch.setattr(voice, "db", db)
    dec = _decision()
    dec["proposal"]["tasks"][0]["tags"] = ["Dispatch"]
    dec["proposal"]["tasks"][1]["depends_on"] = ["t1"]
    ids = asyncio.run(voice._create_decision_tasks("ten", dec, dec["proposal"]["tasks"]))
    first, second = (next(t for t in db.tasks.docs if t["id"] == i) for i in ids)
    assert first["tags"] == ["Dispatch"] and first["status"] == "todo"
    assert second["depends_on"] == [first["id"]], "the key became the new task's id"
    assert second["status"] == "blocked", "it starts when the task before it closes"


def test_approving_to_start_does_not_open_a_task_still_waiting_for_another():
    src = (Path(__file__).resolve().parents[1] / "routers" / "tasks.py").read_text(encoding="utf-8")
    assert '"todo" if t.get("status") == "blocked" and not open_before else' in src


def test_the_phone_review_is_the_founders_four_screens():
    review = (FE / "pages" / "desk" / "DexReview.jsx").read_text(encoding="utf-8")
    popup = (FE / "pages" / "desk" / "DexCapturePopup.jsx").read_text(encoding="utf-8")
    for testid in ("dex-review-overview", "dex-review-tasks", "dex-review-task", "dex-review-add-task",
                   "dex-review-timeline", "dex-review-kpis"):
        assert f'"{testid}"' in review or f"`{testid}" in review, testid
    # The stages Dex reads in, as a checklist.
    assert 'data-testid="dex-popup-stages"' in popup
    # The app's own palette: no blue anywhere in the new review.
    for blue in ("blue-", "sky-", "indigo-"):
        assert blue not in review, blue
    # Approve / Save as draft / Reject keep the testids every Dex suite uses.
    for testid in ("decision-approve", "desk-dex-later", "decision-reject"):
        assert f'data-testid="{testid}"' in review, testid


def test_every_toast_on_a_phone_is_full_screen():
    # 2026-10-29, second pass: errors too, with their own mark; no pill left.
    layer = (FE / "components" / "mobile" / "Affirmation.jsx").read_text(encoding="utf-8")
    for wrapped in ('toast.success = wrap("success"', 'toast.error = wrap("error"', 'toast.info = wrap("info"',
                    'toast.message = wrap("info"', 'toast.loading = wrap("loading"', "toast.dismiss = (id) =>"):
        assert wrapped in layer, wrapped
    assert 'kind === "error" && <>' in layer, "an error has its own mark, not the tick"
    # A bare toast("…") cannot be wrapped, so none is left in the app.
    import re
    for path in FE.rglob("*.js*"):
        if path.name in ("use-toast.js", "Affirmation.jsx") or "fixtures" in path.parts:
            continue
        src = path.read_text(encoding="utf-8", errors="ignore")
        if 'from "sonner"' not in src:
            continue
        assert not re.search(r"(^|[^.\w])toast\(", src, re.M), f"{path.name} still calls toast() directly"


def test_a_pop_up_opens_in_place_on_a_phone():
    for name in ("dialog.jsx", "alert-dialog.jsx"):
        src = (FE / "components" / "ui" / name).read_text(encoding="utf-8")
        assert src.count("max-lg:data-[state=open]:animate-none") >= 2, name


def test_the_wave_is_broad_and_dex_reads_as_a_figure():
    wave = (FE / "components" / "mobile" / "DexWave.jsx").read_text(encoding="utf-8")
    assert "Math.pow(Math.sin(Math.PI * p), 0.45)" in wave, "a flat envelope, so loud speech spreads"
    assert "freq: 0.42" in wave and "freq: 2.10" not in wave
    popup = (FE / "pages" / "desk" / "DexCapturePopup.jsx").read_text(encoding="utf-8")
    assert "<DexBuilderFit" in popup and "DexForgeFit" not in popup

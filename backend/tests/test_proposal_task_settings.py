"""ASK-50 — priority, proof and approval on a decision's proposed tasks.

Offline: the rules in services.proposal_task_settings are pure, and the two
database paths that use them — editing a proposed task, and creating the tasks
when the decision is approved — run against a small in-memory stand-in for the
collections they touch. No server, no Mongo.

  1  a setting is validated, recorded in words, and left alone when not sent
  2  approval: on (before work starts by default), moved, turned off; who
     approves only while it is on
  3  what a proposed task becomes when approval creates it — the same fields,
     and the same lock before work starts, that New Task writes
  4  editing a proposed task through the service: saved on the proposal,
     refused when invalid, a named approver held to New Task's checks
  5  approving: the task is created with its settings, the default approver is
     the one New Task would pick
"""
import asyncio

import pytest

from services.proposal_task_settings import (
    APPROVAL_STAGES,
    apply_settings,
    creation_fields,
    waits_on_approval,
)

pytestmark = pytest.mark.unit


# ── 1 · validation and words ────────────────────────────────────────────────
def test_priority_is_validated_recorded_and_left_alone_when_not_sent():
    t = {"title": "Ship it", "priority": "medium"}
    assert apply_settings(t, priority="high") == ["high priority"]
    assert t["priority"] == "high"
    assert apply_settings(t, priority="high") == []          # no change, no event
    assert apply_settings(t) == [] and t["priority"] == "high"  # not sent = untouched
    with pytest.raises(ValueError):
        apply_settings(t, priority="urgent")
    assert t["priority"] == "high"


def test_a_task_without_a_priority_counts_as_medium():
    t = {"title": "Ship it"}
    assert apply_settings(t, priority="medium") == []
    assert "priority" not in t


def test_proof_turns_on_and_off():
    t = {}
    assert apply_settings(t, evidence_required=True) == ["needs proof to be completed"]
    assert t["evidence_required"] is True
    assert apply_settings(t, evidence_required=True) == []
    assert apply_settings(t, evidence_required=False) == ["no proof needed"]
    assert t["evidence_required"] is False


# ── 2 · approval ────────────────────────────────────────────────────────────
def test_approval_turns_on_before_work_starts_by_default():
    t = {}
    assert apply_settings(t, approval_required=True) == ["approval before work starts"]
    assert (t["approval_required"], t["approval_stage"]) == (True, "start")


def test_approval_can_be_asked_for_before_it_is_marked_done():
    t = {}
    apply_settings(t, approval_required=True, approval_stage="close")
    assert t["approval_stage"] == "close"
    assert apply_settings(t, approval_stage="start") == ["approval before work starts"]


def test_an_unknown_stage_is_refused():
    with pytest.raises(ValueError):
        apply_settings({}, approval_required=True, approval_stage="whenever")
    assert APPROVAL_STAGES == ("start", "close")


def test_turning_approval_off_forgets_who_approves():
    t = {}
    apply_settings(t, approval_required=True, approver={"id": "u_mgr", "name": "Meena"})
    assert t["approver_id"] == "u_mgr"
    assert apply_settings(t, approval_required=False) == ["no approval"]
    assert not {"approval_required", "approval_stage", "approver_id", "approver_name"} & set(t)
    assert apply_settings(t, approval_required=False) == []


def test_who_approves_means_something_only_while_approval_is_on():
    with pytest.raises(ValueError):
        apply_settings({}, approver={"id": "u_mgr", "name": "Meena"})
    t = {}
    apply_settings(t, approval_required=True, approver={"id": "u_mgr", "name": "Meena"})
    assert apply_settings(t, clear_approver=True) == ["approved by the usual approver"]
    assert "approver_id" not in t and t["approval_required"] is True


# ── 3 · what a proposed task becomes ────────────────────────────────────────
def test_no_settings_is_a_plain_open_task():
    f = creation_fields({"title": "Ship it"}, "u_owner")
    assert f == {"evidence_required": False, "approval_required": False, "approval_stage": None,
                 "approver_id": None, "status": "todo", "approval_status": None}


def test_approval_before_work_starts_is_created_locked_and_pending():
    f = creation_fields({"approval_required": True, "approval_stage": "start"}, "u_owner")
    assert (f["status"], f["approval_status"], f["approver_id"]) == ("blocked", "pending", "u_owner")
    assert waits_on_approval(f)


def test_approval_before_it_is_done_is_created_open():
    f = creation_fields({"approval_required": True, "approval_stage": "close"}, "u_owner")
    assert (f["status"], f["approval_status"], f["approval_stage"]) == ("todo", None, "close")
    assert not waits_on_approval(f)


def test_a_named_approver_beats_the_default_and_proof_is_carried():
    f = creation_fields({"approval_required": True, "approver_id": "u_mgr", "evidence_required": True}, "u_owner")
    assert f["approver_id"] == "u_mgr" and f["evidence_required"] is True


# ── the in-memory stand-in ──────────────────────────────────────────────────
def _match(doc, filt):
    for k, v in filt.items():
        if isinstance(v, dict) and "$in" in v:
            if doc.get(k) not in v["$in"]:
                return False
        elif doc.get(k) != v:
            return False
    return True


class _Coll:
    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    async def find_one(self, filt, projection=None, **_):
        return next((dict(d) for d in self.docs if _match(d, filt)), None)

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, filt, update):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set", {}))
                return


class _DB:
    def __init__(self, **colls):
        for name, docs in colls.items():
            setattr(self, name, _Coll(docs))


OWNER = {"id": "u_owner", "tenant_id": "ten", "name": "Rajesh", "role": "owner"}
MANAGER = {"id": "u_mgr", "tenant_id": "ten", "name": "Meena", "role": "manager", "permissions": ["approvals"]}
DOER = {"id": "u_doer", "tenant_id": "ten", "name": "Sunita", "role": "sales", "permissions": []}


def _decision(**task):
    return {"id": "dec", "tenant_id": "ten", "title": "Ship the lot", "status": "pending_approval",
            "created_by": "u_owner", "approver_id": None,
            "proposal": {"tasks": [{"key": "t1", "title": "Pack the lot", "assignee_id": "u_doer",
                                    "priority": "medium", **task}]}}


# ── 4 · the edit, through the service ───────────────────────────────────────
def _edit(monkeypatch, decision, **kw):
    import services.decision_flow as flow
    import routers.tasks as rtasks
    db = _DB(decisions=[decision], users=[OWNER, MANAGER, DOER])
    monkeypatch.setattr(flow, "db", db)
    events = []

    async def _event(did, label, *a, **k):
        events.append(label)

    async def _can_approve(tid, member):
        return member.get("role") == "owner" or "approvals" in (member.get("permissions") or [])

    monkeypatch.setattr(flow, "add_decision_event", _event)
    monkeypatch.setattr(rtasks, "_member_can_approve", _can_approve)
    out = asyncio.run(flow.edit_proposal_task(OWNER, "dec", "t1", **kw))
    return out, events


def test_editing_saves_the_settings_on_the_proposal(monkeypatch):
    d, events = _edit(monkeypatch, _decision(), priority="high", evidence_required=True,
                      approval_required=True, approval_stage="close", approver_id="u_mgr")
    t = d["proposal"]["tasks"][0]
    assert (t["priority"], t["evidence_required"], t["approval_stage"], t["approver_id"]) == ("high", True, "close", "u_mgr")
    assert len(events) == 1 and "high priority" in events[0] and "approved by Meena" in events[0]


def test_editing_refuses_what_it_does_not_know(monkeypatch):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        _edit(monkeypatch, _decision(), priority="urgent")
    assert e.value.status_code == 400


def test_the_doer_cannot_be_the_approver(monkeypatch):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        _edit(monkeypatch, _decision(), approval_required=True, approver_id="u_doer")
    assert e.value.status_code == 400 and "doing this task" in e.value.detail


def test_an_approver_must_be_able_to_approve(monkeypatch):
    from fastapi import HTTPException
    other = dict(DOER, id="u_other", name="Kiran")
    import services.decision_flow as flow
    import routers.tasks as rtasks
    db = _DB(decisions=[_decision()], users=[OWNER, MANAGER, DOER, other])
    monkeypatch.setattr(flow, "db", db)

    async def _no(tid, member):
        return False

    monkeypatch.setattr(rtasks, "_member_can_approve", _no)
    with pytest.raises(HTTPException) as e:
        asyncio.run(flow.edit_proposal_task(OWNER, "dec", "t1", approval_required=True, approver_id="u_other"))
    assert "can't approve tasks" in e.value.detail


# ── 5 · approving creates the tasks with their settings ─────────────────────
def _create(monkeypatch, decision, default_approver="u_mgr"):
    import services.voice as voice
    import routers.tasks as rtasks
    db = _DB(tasks=[], users=[OWNER, MANAGER, DOER])
    monkeypatch.setattr(voice, "db", db)
    seen = {}

    async def _default(user, on_task=frozenset()):
        seen["user"], seen["on_task"] = user["id"], set(on_task)
        return default_approver

    monkeypatch.setattr(rtasks, "_default_task_approver", _default)
    ids = asyncio.run(voice._create_decision_tasks("ten", decision, decision["proposal"]["tasks"]))
    return db.tasks.docs, ids, seen


def test_an_approved_task_carries_its_priority_and_proof(monkeypatch):
    docs, ids, _ = _create(monkeypatch, _decision(priority="high", evidence_required=True))
    assert len(docs) == len(ids) == 1
    assert (docs[0]["priority"], docs[0]["evidence_required"], docs[0]["status"]) == ("high", True, "todo")
    assert docs[0]["approval_required"] is False


def test_approval_before_work_starts_is_created_locked_for_the_usual_approver(monkeypatch):
    docs, _, seen = _create(monkeypatch, _decision(approval_required=True, approval_stage="start"))
    t = docs[0]
    assert (t["status"], t["approval_status"], t["approver_id"]) == ("blocked", "pending", "u_mgr")
    # chosen the way New Task chooses, for the person who raised the decision,
    # keeping them and the doer off it
    assert seen["user"] == "u_owner" and seen["on_task"] == {"u_owner", "u_doer"}


def test_a_named_approver_is_kept_and_no_default_is_looked_up(monkeypatch):
    docs, _, seen = _create(monkeypatch, _decision(approval_required=True, approval_stage="close", approver_id="u_owner"))
    assert (docs[0]["status"], docs[0]["approver_id"], docs[0]["approval_stage"]) == ("todo", "u_owner", "close")
    assert seen == {}


def test_an_older_proposal_without_settings_is_created_as_before(monkeypatch):
    docs, _, seen = _create(monkeypatch, _decision())
    t = docs[0]
    assert (t["status"], t["priority"], t["approval_required"], t["evidence_required"]) == ("todo", "medium", False, False)
    assert seen == {}

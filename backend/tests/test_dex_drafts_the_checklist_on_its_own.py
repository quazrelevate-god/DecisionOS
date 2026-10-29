"""Dex drafts a task's checklist by itself when the task is made (founder,
2026-10-29: "we also need to generate the subtask checklist automatically once
the task is created").

The redesigned My Work card names each task's NEXT ACTION — the first step of
its checklist not yet ticked — so a task needs a checklist from the moment it
exists. services.auto_plan drafts it in the background; these pin its rules.

Runs on a throwaway database (with_test_db); the model is stubbed.
"""
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONSENT = {"granted_at": "2026-10-01T00:00:00+00:00", "version": "1.0", "revoked_at": None}
STEPS = ["Check the PO against the quote", "Raise the invoice", "Share the DC with the customer"]


def _stub(steps=STEPS):
    calls = []

    async def fake(task, industry, currency, session_id):
        calls.append(task["id"])
        return {"task_type": "billing", "steps": list(steps)}
    return fake, calls


def _run(with_test_db, body, steps=STEPS):
    def runner(db):
        async def go():
            import services.ai.extraction as ex
            fake, calls = _stub(steps)
            saved = ex.ai_execution_plan
            ex.ai_execution_plan = fake
            try:
                return await body(db, calls)
            finally:
                ex.ai_execution_plan = saved
        return go()
    return with_test_db(runner)


async def _tenant(db, consent=True):
    await db.tenants.insert_one({"id": "t1", "name": "Sharma Textiles", "industry": "textiles",
                                 "currency": "INR", **({"ai_consent": CONSENT} if consent else {})})


def _task(tid="k1", **kw):
    return {"id": tid, "tenant_id": "t1", "title": "Bill Highway Road Tech for the delineators",
            "status": "todo", "created_at": "2099-01-01T00:00:00+00:00", **kw}


def test_a_new_task_gets_a_ready_to_tick_checklist(with_test_db):
    async def body(db, calls):
        from services import auto_plan
        await _tenant(db)
        await db.tasks.insert_one(_task())
        assert await auto_plan.draft_plan(db, "t1", "k1") is True
        t = await db.tasks.find_one({"id": "k1"})
        plan = t["execution_plan"]
        assert [s["text"] for s in plan["steps"]] == STEPS
        assert plan["status"] == "accepted", "ready to tick, not a draft to accept"
        assert plan["auto"] is True and not any(s["done"] for s in plan["steps"])
        assert t.get("plan_auto_at"), "stamped, so it is never drafted twice"
        row = await db.activity.find_one({"entity_id": "k1", "kind": "task_plan"})
        assert row and "Dex drafted a checklist (3 steps)" == row["detail"], "the timeline says who made it"
        # Once only.
        assert await auto_plan.draft_plan(db, "t1", "k1") is False
        assert calls == ["k1"]
    _run(with_test_db, body)


def test_no_consent_no_draft(with_test_db):
    async def body(db, calls):
        from services import auto_plan
        await _tenant(db, consent=False)
        await db.tasks.insert_one(_task())
        assert await auto_plan.draft_plan(db, "t1", "k1") is False
        assert calls == [], "AI off means the model is never asked"
        assert not (await db.tasks.find_one({"id": "k1"})).get("execution_plan")
    _run(with_test_db, body)


def test_it_never_replaces_or_touches_what_it_should_not(with_test_db):
    async def body(db, calls):
        from services import auto_plan
        await _tenant(db)
        mine = {"status": "accepted", "steps": [{"id": "s1", "text": "My own step", "done": False}]}
        await db.tasks.insert_many([
            _task("has-plan", execution_plan=mine),
            _task("finished", status="done"),
            _task("locked", status="blocked", approval_required=True, approval_stage="start",
                  approval_status="pending"),
        ])
        for tid in ("has-plan", "finished", "locked"):
            assert await auto_plan.draft_plan(db, "t1", tid) is False, tid
        assert calls == []
        assert (await db.tasks.find_one({"id": "has-plan"}))["execution_plan"] == mine
    _run(with_test_db, body)


def test_a_placeholder_list_is_not_written(with_test_db):
    async def body(db, calls):
        from services import auto_plan
        await _tenant(db)
        await db.tasks.insert_one(_task())
        assert await auto_plan.draft_plan(db, "t1", "k1") is False
        assert not (await db.tasks.find_one({"id": "k1"})).get("execution_plan"), \
            "'Review the task details' must not become every card's next action"
    _run(with_test_db, body, steps=["Review the task details", "Do the work", "Upload proof / notes", "Close the task"])


def test_the_sweep_catches_tasks_made_elsewhere(with_test_db):
    async def body(db, calls):
        from services import auto_plan
        await _tenant(db)
        await db.tasks.insert_many([_task("a"), _task("b"), _task("old", created_at="2020-01-01T00:00:00+00:00")])
        import os
        os.environ["AUTO_PLAN"] = "on"
        try:
            assert await auto_plan.sweep(db, "t1") == 2
        finally:
            os.environ["AUTO_PLAN"] = "off"
        assert sorted(calls) == ["a", "b"], "only recent open work"
    _run(with_test_db, body)


def test_a_routine_brings_its_steps_round_unticked(with_test_db):
    async def body(db, calls):
        from services import auto_plan
        await _tenant(db)
        prev = _task("prev", status="done", execution_plan={"status": "accepted", "task_type": "ops", "steps": [
            {"id": "s1", "text": "Count godown 2", "done": True}, {"id": "s2", "text": "Post the count", "done": True}]})
        await db.tasks.insert_one(_task("next"))
        assert await auto_plan.copy_from(db, "t1", "next", prev) is True
        plan = (await db.tasks.find_one({"id": "next"}))["execution_plan"]
        assert [s["text"] for s in plan["steps"]] == ["Count godown 2", "Post the count"]
        assert not any(s["done"] for s in plan["steps"]) and calls == [], "no model call for a routine"
    _run(with_test_db, body)


@pytest.mark.parametrize("path,needle", [
    ("routers/tasks.py", "auto_plan.schedule(db, user[\"tenant_id\"], tid)"),
    ("routers/tasks.py", "auto_plan.schedule(db, user[\"tenant_id\"], task_id)"),
    ("routers/tasks.py", "auto_plan.copy_from(db"),
    ("routers/decisions.py", "auto_plan.schedule(db, user[\"tenant_id\"], tid)"),
    ("services/voice.py", "auto_plan.schedule(db, tenant_id, tid)"),
    ("workers/schedulers.py", "auto_plan.sweep(db, tid)"),
])
def test_every_way_a_task_is_made_asks_for_one(path, needle):
    assert needle in (ROOT / path).read_text(), f"{path} no longer schedules the checklist"


def test_a_failed_call_is_retried_a_few_times_then_left(with_test_db):
    def runner(db):
        async def go():
            import services.ai.extraction as ex
            from services import auto_plan
            calls = []

            async def boom(task, industry, currency, session_id):
                calls.append(1)
                raise RuntimeError("provider down")
            saved = ex.ai_execution_plan
            ex.ai_execution_plan = boom
            try:
                await _tenant(db)
                await db.tasks.insert_one(_task())
                for _ in range(5):
                    assert await auto_plan.draft_plan(db, "t1", "k1") is False
                assert len(calls) == 3, "three tries, then the person's own Ask Dex"
                t = await db.tasks.find_one({"id": "k1"})
                assert t.get("plan_auto_at") and not t.get("execution_plan")
            finally:
                ex.ai_execution_plan = saved
        return go()
    with_test_db(runner)

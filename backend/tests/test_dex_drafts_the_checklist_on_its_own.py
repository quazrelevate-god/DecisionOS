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


async def _tenant(db, consent=True, auto=True):
    # NF-4.18 (2026-10-30): drafting by itself is something a company turns on
    # (Settings > Task steps from Dex); these tests are about a company that has.
    await db.tenants.insert_one({"id": "t1", "name": "Sharma Textiles", "industry": "textiles",
                                 "currency": "INR", **({"ai_consent": CONSENT} if consent else {}),
                                 **({"auto_plan_steps": True} if auto else {})})


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
    assert needle in (ROOT / path).read_text(encoding="utf-8"), f"{path} no longer schedules the checklist"


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


def test_a_checklist_never_moves_a_task_to_doing(with_test_db):
    # 2026-10-29 (founder): "even though the checklist was made by the LLM, I
    # want it to be To do. Only if I click the button should it change."
    def runner(db):
        async def go():
            from tests.e2e_harness import e2e_env, seed_tenant_and_users
            from models.tasks import ExecPlanInput
            with e2e_env(db):
                import routers.tasks as rt
                await seed_tenant_and_users(db)
                owner = {"id": "u-owner", "tenant_id": "t1", "role": "owner", "name": "Owner"}
                await db.tasks.insert_one({**_task(), "tenant_id": "t1", "assignee_id": "u-owner", "created_by": "u-owner"})
                await rt.save_execution_plan("k1", ExecPlanInput(status="accepted", steps=[
                    {"id": "s1", "text": "Check the PO", "done": True},
                    {"id": "s2", "text": "Raise the invoice", "done": False}]), user=owner)
                return await db.tasks.find_one({"id": "k1"}, {"_id": 0, "status": 1, "progress": 1})
        return go()
    t = with_test_db(runner)
    assert t["status"] == "todo" and t["progress"] == 50, "a ticked step moves the bar, not the status"



# ---------------------------------------------------------------------------
# NF-4.18 (founder 2026-10-30): "I don't want that automatically creating of
# execution steps. It should be an optional thing — we can't spend much on AI.
# When they need it, they can click it."
# ---------------------------------------------------------------------------
def test_unless_the_company_turns_it_on_nothing_is_drafted_by_itself(with_test_db):
    async def body(db, calls):
        import os
        from services import auto_plan
        await _tenant(db, auto=False)
        await db.tasks.insert_many([_task("a"), _task("b")])
        user = {"id": "u1", "tenant_id": "t1", "role": "owner"}

        async def may_read(u, t):
            return True
        os.environ["AUTO_PLAN"] = "on"
        try:
            made = await auto_plan.draft_plan(db, "t1", "a")
            asked = await auto_plan.request(db, user, ["a", "b"], may_read, wait=True)
            swept = await auto_plan.sweep(db, "t1")
        finally:
            os.environ["AUTO_PLAN"] = "off"
        rows = await db.tasks.find({"tenant_id": "t1"}, {"_id": 0}).to_list(10)
        assert made is False and asked == [] and swept == 0, \
            "no draft on creation, on opening My Work, or by the sweep"
        assert calls == [], "not one AI call"
        assert not any(r.get("execution_plan") or r.get("plan_auto_at") for r in rows), "nothing written or stamped"
    _run(with_test_db, body)


def test_ask_dex_in_the_task_still_drafts_on_a_tap():
    src = (ROOT / "routers" / "tasks.py").read_text(encoding="utf-8")
    assert '@router.post("/tasks/{task_id}/execution-plan/generate")' in src, "the button's own route is untouched"
    mw = (ROOT.parent / "frontend" / "src" / "pages" / "MyWork.js").read_text(encoding="utf-8")
    assert "if (!tenant?.auto_plan_steps) return;" in mw, "My Work asks for nothing by itself"
    assert "const needsDraft = autoSteps && expanded" in mw, "opening a task asks for nothing by itself"
    assert 'data-testid={`task-ask-dex-first-${t.id}`}' in mw, "a task with no steps offers Ask Dex"
    st = (ROOT.parent / "frontend" / "src" / "pages" / "Settings.js").read_text(encoding="utf-8")
    assert 'data-testid="auto-steps-toggle"' in st and 'auto_plan_steps: !on' in st

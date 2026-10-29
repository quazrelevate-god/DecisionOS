"""Finished work reaches the owner (the pilot client, through the founder,
2026-10-29): "when the task is finished and marked as done, the owner needs to
be intimated as a push notification — and whenever the app is opened, a
floating card shows the finished tasks that still need to be seen, each shown
once."

And the checklist Dex drafts by itself is not lost to a failed first try:
the placeholder answer counts as a failure, and My Work can ask again for the
tasks on screen that still have none.

Runs on a throwaway database (with_test_db + e2e_env); the model is stubbed.
"""


from tests.e2e_harness import e2e_env, seed_tenant_and_users

OWNER = {"id": "u-owner", "tenant_id": "t1", "role": "owner", "name": "Owner"}
SALES = {"id": "u-sales", "tenant_id": "t1", "role": "sales", "name": "Sales User"}


def _task(tid, **kw):
    return {"id": tid, "tenant_id": "t1", "title": f"Task {tid}", "status": "todo",
            "created_at": "2099-01-01T00:00:00+00:00", **kw}


def test_the_owner_is_told_when_a_task_is_done(with_test_db):
    async def scenario(db):
        with e2e_env(db, keep=("services.notifications.push_notification",)):
            import routers.tasks as rt
            await seed_tenant_and_users(db)
            t = _task("k1", assignee_id="u-sales", created_by="u-owner")
            await db.tasks.insert_one(t)
            await rt._tell_owners_done(SALES, t, "k1")
            rows = await db.notifications.find({"entity_id": "k1"}, {"_id": 0}).to_list(10)
            # …and not the owner who closed it themselves.
            await rt._tell_owners_done(OWNER, t, "k1")
            again = await db.notifications.count_documents({"entity_id": "k1"})
        return rows, again

    rows, again = with_test_db(scenario)
    assert [r["user_id"] for r in rows] == ["u-owner"]
    assert rows[0]["type"] == "task_done" and "Sales User finished 'Task k1'" == rows[0]["message"]
    assert again == 1, "an owner closing a task is not told about it"


def test_the_finished_list_shows_each_task_once(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            import routers.tasks as rt
            from models.tasks import FinishedSeenInput
            await seed_tenant_and_users(db)
            await db.tasks.insert_many([
                _task("a", status="done", assignee_id="u-sales", created_by="u-owner", completed_at="2099-01-02T10:00:00+00:00"),
                _task("b", status="done", assignee_id="u-finance", created_by="u-sales", completed_at="2099-01-02T11:00:00+00:00"),
                _task("mine", status="done", assignee_id="u-owner", completed_at="2099-01-02T12:00:00+00:00"),
                _task("open", assignee_id="u-sales"),
            ])
            first = await rt.finished_tasks_unseen(user=OWNER)
            await rt.finished_tasks_seen(FinishedSeenInput(until=first["tasks"][0]["completed_at"]), user=OWNER)
            second = await rt.finished_tasks_unseen(user=OWNER)
            # The person who asked for work sees what they asked for, nothing else.
            sales = await rt.finished_tasks_unseen(user=SALES)
            # A later "seen" never moves the mark backwards.
            await rt.finished_tasks_seen(FinishedSeenInput(until="2099-01-01T00:00:00+00:00"), user=OWNER)
            third = await rt.finished_tasks_unseen(user=OWNER)
        return first, second, sales, third

    first, second, sales, third = with_test_db(scenario)
    assert [t["id"] for t in first["tasks"]] == ["b", "a"], "newest first, the owner's own work left out"
    assert first["tasks"][1]["assignee_name"] == "Sales User"
    assert second["tasks"] == [] and third["tasks"] == [], "once seen, never shown again"
    assert [t["id"] for t in sales["tasks"]] == ["b"]


def _stub_plan(steps):
    calls = []

    async def fake(task, industry, currency, session_id):
        calls.append(task["id"])
        return {"task_type": "ops", "steps": list(steps)}
    return fake, calls


def test_a_placeholder_answer_is_tried_again(with_test_db):
    async def scenario(db):
        import services.ai.extraction as ex
        from services import auto_plan
        await seed_tenant_and_users(db)
        await db.tasks.insert_one(_task("k1"))
        saved = ex.ai_execution_plan
        try:
            ex.ai_execution_plan, _ = _stub_plan(auto_plan._FALLBACK)
            assert await auto_plan.draft_plan(db, "t1", "k1") is False
            after_fail = await db.tasks.find_one({"id": "k1"}, {"_id": 0})
            ex.ai_execution_plan, calls = _stub_plan(["Count the stock", "Post the count"])
            assert await auto_plan.draft_plan(db, "t1", "k1") is True
        finally:
            ex.ai_execution_plan = saved
        return after_fail, await db.tasks.find_one({"id": "k1"}, {"_id": 0})

    after_fail, done = with_test_db(scenario)
    assert "plan_auto_at" not in after_fail and after_fail["plan_auto_tries"] == 1
    assert [s["text"] for s in done["execution_plan"]["steps"]] == ["Count the stock", "Post the count"]


def test_my_work_can_ask_for_the_missing_checklists(with_test_db):
    async def scenario(db):
        import services.ai.extraction as ex
        from services import auto_plan
        await seed_tenant_and_users(db)
        await db.tasks.insert_many([
            _task("stale", assignee_id="u-sales", plan_auto_at="2000-01-01T00:00:00+00:00", plan_auto_tries=1),
            _task("spent", assignee_id="u-sales", plan_auto_at="2000-01-01T00:00:00+00:00", plan_auto_tries=3),
            _task("fresh", assignee_id="u-sales", plan_auto_at="2999-01-01T00:00:00+00:00"),
            _task("hidden", assignee_id="u-finance"),
        ])

        async def may_read(user, t):
            return t.get("assignee_id") == user["id"]
        saved = ex.ai_execution_plan
        try:
            ex.ai_execution_plan, calls = _stub_plan(["Call the buyer"])
            asked = await auto_plan.request(db, SALES, ["stale", "spent", "fresh", "hidden", "nope"], may_read, wait=True)
        finally:
            ex.ai_execution_plan = saved
        stale = await db.tasks.find_one({"id": "stale"}, {"_id": 0})
        return asked, calls, stale

    asked, calls, stale = with_test_db(scenario)
    assert asked == ["stale"], "three spent tries, a draft in flight and someone else's task are left alone"
    assert calls == ["stale"] and stale["execution_plan"]["steps"][0]["text"] == "Call the buyer"


def test_the_routes_and_the_phone_are_wired():
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    src = (root / "routers" / "tasks.py").read_text(encoding="utf-8")
    assert '@router.post("/tasks/auto-plan")' in src and '@router.get("/finished-tasks")' in src
    assert "await _tell_owners_done(user, t, task_id)" in src
    fe = root.parent / "frontend" / "src"
    mw = (fe / "pages" / "MyWork.js").read_text(encoding="utf-8")
    assert '"/tasks/auto-plan"' in mw
    desk = (fe / "pages" / "desk" / "FinishedWorkCard.jsx").read_text(encoding="utf-8")
    assert '"/finished-tasks"' in desk and '"/finished-tasks/seen"' in desk



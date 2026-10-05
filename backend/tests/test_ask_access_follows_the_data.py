"""Ask: access follows the DATA, not the words (2026-10-05, founder: "hope the
ask has the RBAC right … question might be from the task as well … make the
ask question more reliable, better design").

The live matrix (24+ questions x owner / Sales / Accounts / a Tasks-only
member) found: a salesperson refused her own order's status as "finance"; the
same person refused "what were our sales" because her team is not literally
named "sales"; "show Priya Nair's overdue tasks" empty (the name was matched
against task titles); "what needs my attention today?" telling the owner she
had nothing to do; "who is on leave this week" listing every leave ever filed;
a follow-up able to reuse another person's question. These lock the fixes,
with the AI (planner + answer writer) stubbed and the access logic real.

Single-process (reaches shared clients):
    .venv/Scripts/python -m pytest tests/test_ask_access_follows_the_data.py -o addopts="" -p no:xdist
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env, seed_tenant_and_users

pytestmark = pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                                reason="single-process: reaches shared clients")

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Owner"}
SALES = {"id": "u-sales", "tenant_id": T, "role": "sales", "name": "Sales User",
         "permissions": ["inbox", "tasks", "workflows", "ask", "brain", "crm_buyers"]}
ACCOUNTS = {"id": "u-finance", "tenant_id": T, "role": "finance", "name": "Finance User",
            "permissions": ["inbox", "tasks", "workflows", "ask", "brain", "finance"]}
TASKS_ONLY = {"id": "u-operations", "tenant_id": T, "role": "operations", "name": "Operations User",
              "permissions": ["tasks", "ask"]}
NOW = datetime.now(timezone.utc)
PAST = (NOW - timedelta(days=5)).isoformat()
FUTURE = (NOW + timedelta(days=5)).isoformat()


async def _seed(db):
    await seed_tenant_and_users(db)
    await db.workflows.insert_one({"id": "w1", "tenant_id": T, "type": "order_management",
                                   "title": "Bluewave UK - 5,000 polos", "stage": "ready_for_dispatch",
                                   "amount": 1250000, "created_at": PAST})
    await db.tasks.insert_many([
        {"id": "t-sales-1", "tenant_id": T, "title": "Send proforma invoice to Bluewave", "assignee_id": "u-sales",
         "assignee_role": "sales", "status": "todo", "due_date": PAST, "created_at": PAST},
        {"id": "t-sales-2", "tenant_id": T, "title": "Confirm Bluewave sizes", "assignee_id": "u-sales",
         "assignee_role": "sales", "status": "waiting", "due_date": FUTURE, "created_at": PAST},
        {"id": "t-owner", "tenant_id": T, "title": "GST filing on the 10th", "assignee_id": "u-owner",
         "assignee_role": "owner", "status": "todo", "due_date": PAST, "created_at": PAST},
        {"id": "t-fin", "tenant_id": T, "title": "Raise advance invoice", "assignee_id": "u-finance",
         "assignee_role": "finance", "status": "done", "due_date": PAST, "created_at": PAST},
    ])
    today = NOW.date()
    await db.leaves.insert_many([
        {"id": "l-now", "tenant_id": T, "user_id": "u-sales", "user_name": "Sales User", "approver_id": "u-owner",
         "leave_type": "casual", "status": "approved",
         "from_date": (today - timedelta(days=1)).isoformat(), "to_date": (today + timedelta(days=1)).isoformat()},
        {"id": "l-old", "tenant_id": T, "user_id": "u-sales", "user_name": "Sales User", "approver_id": "u-owner",
         "leave_type": "sick", "status": "approved", "from_date": "2025-01-02", "to_date": "2025-01-03"},
    ])
    await db.memory.insert_one({"id": "m1", "tenant_id": T, "text": "Bluewave payment terms: 30% advance",
                                "created_at": PAST})


class _Stub:
    """Swap the two AI calls in routers.brain for fixed, inspectable ones."""
    def __init__(self, brain, plan):
        self.brain, self.plan, self.prev_seen = brain, plan, []

    def __enter__(self):
        b = self.brain
        self.saved = (b._plan, b._answer, b._enrich_with_brain)

        async def _plan(question, prev, lang):
            self.prev_seen.append(prev)
            return b._refine_plan(dict(self.plan), question)

        async def _answer(q, kpis, table, lang, **k):
            self.answer_kwargs = k
            return "ok", []

        async def _extras(plan, scope, user, question=""):
            return {"document_hits": [], "knowledge_hits": [], "passages": []}
        b._plan, b._answer, b._enrich_with_brain = _plan, _answer, _extras
        return self

    def __exit__(self, *a):
        self.brain._plan, self.brain._answer, self.brain._enrich_with_brain = self.saved


def _ask(brain, user, question, context_id=None):
    from models.brain import AskRequest
    return brain.ask(AskRequest(question=question, context_id=context_id), user=user)


def test_a_named_order_is_answered_from_the_pipeline_without_money(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            with _Stub(brain, {"primary_entity": "invoices", "needs_finance": True, "keywords": ["Bluewave UK"]}) as st:
                res = await _ask(brain, SALES, "What is the status of the Bluewave UK order?")
                assert st.answer_kwargs["no_money"] is True and st.answer_kwargs["not_everything"] is True
            assert res["type"] == "ANSWER" and res["applied_filters"]["primary_entity"] == "workflows"
            assert res["answer"].startswith("(Invoices, payments and balances (Finance) aren't part of your access")
            assert res["table"]["rows"][0]["stage"] == "ready_for_dispatch"
            assert all("amount" not in r for r in res["table"]["rows"])
            return True
    assert with_test_db(scenario) is True


def test_a_money_question_is_refused_with_what_they_can_ask(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            with _Stub(brain, {"primary_entity": "invoices", "needs_finance": True, "keywords": ["Bluewave"]}):
                res = await _ask(brain, SALES, "How much does Bluewave owe us?")
                ok = await _ask(brain, ACCOUNTS, "How much does Bluewave owe us?")
            assert res["type"] == "PERMISSION_DENIED"
            assert "Finance" in res["message"] and "tasks" in res["can_ask"]
            assert ok["type"] in ("ANSWER", "INSUFFICIENT_DATA"), "Finance access answers it"
            return True
    assert with_test_db(scenario) is True


def test_nothing_they_can_open_matches_so_it_is_refused(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            with _Stub(brain, {"primary_entity": "workflows", "keywords": ["Bluewave UK"]}):
                res = await _ask(brain, TASKS_ONLY, "Has the Bluewave UK order shipped?")
            assert res["type"] == "PERMISSION_DENIED" and "pipelines (Workflows) aren't" in res["message"]
            return True
    assert with_test_db(scenario) is True


def test_a_teammates_name_selects_their_work_within_what_you_can_see(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            from routers.brain import _retrieve

            async def ids(user, plan):
                scope = {"tenant_id": T, "uid": user["id"], "role": user["role"],
                         "can_finance": False, "privileged": user["role"] == "owner"}
                return sorted(r["id"] for r in (await _retrieve(plan, scope, user))["records"])
            plan = {"primary_entity": "tasks", "keywords": ["Sales User's"]}
            assert await ids(OWNER, plan) == ["t-sales-1", "t-sales-2"]
            assert await ids(OWNER, {"primary_entity": "tasks", "keywords": ["Sales"]}) == ["t-sales-1", "t-sales-2"], "first name"
            assert await ids(ACCOUNTS, plan) == [], "not a task the Accounts member can see"
            assert await ids(OWNER, {"primary_entity": "tasks", "keywords": [], "mine": True}) == ["t-owner"]
            return True
    assert with_test_db(scenario) is True


def test_the_questions_words_are_read_the_way_people_mean_them():
    import routers.brain as brain
    r = brain._refine_plan
    p = r({"primary_entity": "invoices", "needs_finance": True, "keywords": ["Bluewave", "proforma"]},
          "Who is working on the Bluewave proforma invoice?")
    assert p["primary_entity"] == "tasks" and p["needs_finance"] is False
    p = r({"primary_entity": "tasks", "mine": True, "status": None, "date_preset": "today"},
          "What needs my attention today?")
    assert p["mine"] is False and p["status"] == "open" and p["date_preset"] is None
    assert r({"primary_entity": "tasks", "mine": False}, "Show my tasks")["mine"] is True
    assert r({"primary_entity": "tasks", "mine": True}, "Show me all tasks")["mine"] is False, "all beats a planner slip"
    assert r({"primary_entity": "tasks", "mine": True}, "mere pending kaam dikhao")["mine"] is True, "the planner reads Hindi"
    assert r({"primary_entity": "tasks", "status": "pending"}, "what is pending")["status"] == "open"


def test_open_means_every_unfinished_status_and_leave_means_overlapping(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            scope = {"tenant_id": T, "uid": "u-owner", "role": "owner", "can_finance": True, "privileged": True}
            plan = {"primary_entity": "tasks", "keywords": [], "status": "open"}
            _, table, _ = await brain._compute(plan, await brain._retrieve(plan, scope, OWNER), scope)
            assert sorted(r["task"] for r in table["rows"]) == [
                "Confirm Bluewave sizes", "GST filing on the 10th", "Send proforma invoice to Bluewave"], "waiting counts as open"
            plan = {"primary_entity": "leaves", "keywords": [], "date_preset": "this_week"}
            _, table, _ = await brain._compute(plan, await brain._retrieve(plan, scope, OWNER), scope)
            assert [r["type"] for r in table["rows"]] == ["casual"], "this week's leave, not every leave ever"
            return True
    assert with_test_db(scenario) is True


def test_policy_questions_read_documents_and_saved_notes(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            with _Stub(brain, {"primary_entity": "documents", "keywords": ["payment terms", "Bluewave"]}):
                res = await _ask(brain, SALES, "What does our document say about Bluewave payment terms?")
                none = await _ask(brain, TASKS_ONLY, "What does our document say about Bluewave payment terms?")
            assert res["type"] == "ANSWER" and res["table"]["rows"][0]["note"].startswith("Bluewave payment terms")
            assert none["type"] == "INSUFFICIENT_DATA", "no Brain access: no notes, and documents are open but empty"
            return True
    assert with_test_db(scenario) is True


def test_a_follow_up_never_reuses_someone_elses_question(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            await db.brain_query_cache.insert_one({"id": "ctx-owner", "tenant_id": T, "user_id": "u-owner",
                                                   "plan": {"primary_entity": "invoices", "keywords": ["secret"]}})
            with _Stub(brain, {"primary_entity": "tasks", "keywords": []}) as st:
                await _ask(brain, SALES, "and these?", context_id="ctx-owner")
                await _ask(brain, OWNER, "and these?", context_id="ctx-owner")
            assert st.prev_seen[0] is None, "another person's plan is not carried into mine"
            assert st.prev_seen[1]["primary_entity"] == "invoices", "my own follow-up still works"
            return True
    assert with_test_db(scenario) is True


def test_export_follows_the_same_rule(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            import routers.brain as brain
            from models.brain import ExportRequest
            await db.brain_query_cache.insert_one({"id": "ctx-s", "tenant_id": T, "user_id": "u-sales",
                                                   "plan": {"primary_entity": "invoices", "keywords": []}})
            await db.brain_query_cache.insert_one({"id": "ctx-o", "tenant_id": T, "user_id": "u-owner",
                                                   "plan": {"primary_entity": "tasks", "keywords": []}})
            for ctx, code in (("ctx-s", 403), ("ctx-o", 404)):
                try:
                    await brain.export(ExportRequest(context_id=ctx, format="csv"), user=SALES)
                    raise AssertionError("should refuse")
                except HTTPException as e:
                    assert e.status_code == code, (ctx, e.status_code)
            return True
    assert with_test_db(scenario) is True

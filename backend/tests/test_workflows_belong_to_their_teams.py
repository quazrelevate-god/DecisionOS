"""Workflows belong to the teams that work in them (2026-10-03, founder: "build both").

Workflows was one switch for every pipeline. A sales member with no Finance
access had a Buyer Payments card as the Desk's "Next up" -- "Bluewave - 30%
Advance Invoice Raised -> Advance to Advance Received" -- and could advance it.

Every stage already names the team that owns it (stage.role and each stage
task's role, resolved against the company's own department names by
shared/roles.resolve_role). A person now sees, and may move, a pipeline's
cards when their team owns a stage in it. The owner and anyone given "See all
tasks" see every pipeline; a card whose type is not in the company's model has
no owner to ask, so the Workflows switch alone decides it.

Verified on the scratch company: Sales sees Order Management (+ Raw Material
Procurement, where it owns a stage), not Buyer Payments; reading or advancing
the payments card answers 403 "This workflow belongs to another team"; Accounts
and the owner see both; Sales' Desk "Next up" became its own order card.
"""
import asyncio
from pathlib import Path

import pytest

BE = Path(__file__).resolve().parents[1]
FE = BE.parent / "frontend" / "src"


def be(rel):
    return (BE / rel).read_text(encoding="utf-8")


def fe(rel):
    return (FE / rel).read_text(encoding="utf-8")


PIPELINES = [
    {"key": "order_management", "stages": [
        {"key": "inquiry", "role": "sales"},
        {"key": "production", "role": "production_&_quality"}]},
    {"key": "buyer_payments", "stages": [
        {"key": "invoice_raised", "role": "accounts_&_buyer_payments",
         "tasks": [{"title": "Issue invoice", "role": "accounts_&_buyer_payments"}]}]},
    {"key": "export_compliance", "stages": [
        {"key": "docs", "role": "export", "tasks": [{"title": "Pay duty", "role": "accounts"}]}]},
]
ROLES = [{"key": k} for k in ("sales_&_order_management", "production_&_quality",
                              "export_&_logistics", "accounts_&_buyer_payments")]

_LOOP = asyncio.new_event_loop()


def _scope(monkeypatch, role, perms=None):
    import services.ai.generators as gen
    import core

    async def fake_model(_tid):
        return {"pipelines": PIPELINES}

    class _Tenants:
        async def find_one(self, *_a, **_k):
            return {"roles": ROLES}

    class _DB:
        tenants = _Tenants()

    monkeypatch.setattr(gen, "tenant_operating_model", fake_model)
    monkeypatch.setattr(core, "db", _DB())
    from services.workflows import workflow_scope
    user = {"tenant_id": "t", "id": "u", "role": role, "permissions": perms or [],
            "permissions_custom": bool(perms)}
    return _LOOP.run_until_complete(workflow_scope(user))


def test_a_team_sees_the_pipelines_it_owns_a_stage_in(monkeypatch):
    s = _scope(monkeypatch, "sales_&_order_management")
    assert s["visible"] == ["order_management"]
    assert "buyer_payments" not in s["visible"]


def test_a_stage_task_counts_as_owning(monkeypatch):
    s = _scope(monkeypatch, "accounts_&_buyer_payments")
    assert set(s["visible"]) == {"buyer_payments", "export_compliance"}


def test_the_owner_and_see_all_tasks_see_every_pipeline(monkeypatch):
    assert _scope(monkeypatch, "owner") is None
    assert _scope(monkeypatch, "production_&_quality", ["workflows", "tasks_view_all"]) is None


def test_a_card_outside_the_model_follows_the_switch_alone():
    from services.workflows import in_scope, scope_query
    s = {"visible": ["order_management"], "modelled": ["order_management", "buyer_payments"]}
    assert in_scope(s, "order_management")
    assert not in_scope(s, "buyer_payments")
    assert in_scope(s, "purchase_payment")          # pre-model card
    assert in_scope(None, "buyer_payments")
    assert scope_query(None) == {}
    assert scope_query(s) == {"$or": [{"type": {"$nin": s["modelled"]}}, {"type": {"$in": s["visible"]}}]}


@pytest.mark.parametrize("fn", ["get_workflow", "update_workflow", "workflow_leftover",
                                "approve_workflow_stage", "advance_workflow"])
def test_every_single_card_route_asks(fn):
    w = be("routers/workflows.py")
    i = w.index(f"async def {fn}(")
    assert "await _in_my_pipelines(user, workflow_id)" in w[i:i + 2500], fn


def test_the_board_counts_and_create_ask():
    w = be("routers/workflows.py")
    assert w.count("scope_query(await workflow_scope(user))") >= 2       # counts + list
    assert 'raise HTTPException(status_code=403, detail="This pipeline belongs to another team.")' in w


@pytest.mark.parametrize("rel", ["routers/calendar.py", "routers/brain.py", "routers/brain_search.py",
                                 "services/ai/agent_tools.py"])
def test_the_other_readers_of_workflows_ask_too(rel):
    assert "workflow_scope" in be(rel), rel


def test_brain_search_lists_only_what_its_screens_would():
    """It returned every decision matching a word (9, to a member whose own
    Decisions list showed 2) and contacts regardless of CRM access."""
    s = be("routers/brain_search.py")
    assert "visible_decisions_clause(user)" in s
    assert '"type": {"$in": types}' in s
    assert "async def visible_decisions_clause(user: dict) -> dict:" in be("routers/decisions.py")


def test_the_screens_are_told_the_scope():
    assert '"workflow_scope": await workflow_scope(user),' in be("routers/auth.py")
    p = fe("lib/perms.js")
    assert "export function canSeePipeline(user, key)" in p
    assert "om.pipelines.filter((p) => canSeePipeline(user, p.key))" in fe("pages/Workflows.js")
    assert "canSeePipeline(user, type)" in fe("components/workflow/WorkflowLink.js")
    assert fe("pages/MyWork.js").count("<WorkflowLink type={t.workflow_summary.type}") == 2


def test_a_new_team_says_what_it_started_with():
    c = fe("components/settings/TeamsCard.js")  # moved 2026-10-05
    assert "as well as everyday work. Change it under Access." in c

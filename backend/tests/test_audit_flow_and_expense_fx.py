"""Product audit 2026-10-08 — two more follow-ups.

  EXP-FX  An expense in another currency (a USD bill read from a photo) was
          added to Spend at face value. It now counts at its exchange rate;
          with no rate it is left out and listed, and "Set rate" fixes it.
  FLOW    How work moves — the pipelines — are designed on the sign-up review
          from the interview (POST /signup/interview/flow), drawn as a route,
          and register takes exactly those (no second AI design after Enter).
"""
import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException

from tests.fake_mongo import FakeDB

ROOT = Path(__file__).resolve().parents[1]
FE = ROOT.parent / "frontend" / "src"
OWNER = {"id": "u1", "tenant_id": "t1", "role": "owner", "name": "Meera"}


def _src(rel):
    return (FE / rel).read_text(encoding="utf-8")


def _run(c):
    return asyncio.run(c)


async def _noop(*a, **k):
    return None


# --- EXP-FX -------------------------------------------------------------------------------
@pytest.fixture
def books(monkeypatch):
    import routers.invoicing as inv
    import routers.ledger as led
    import services.finance_words as fw
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "name": "Audit Textiles", "currency": "INR"})
    d.expenses.docs += [
        {"id": "e1", "tenant_id": "t1", "title": "Freight", "amount": 18400, "currency": "INR",
         "category": "Logistics", "status": "paid"},
        {"id": "e2", "tenant_id": "t1", "title": "Lab test (UK)", "amount": 200, "currency": "USD",
         "category": "Testing", "status": "unpaid", "vendor_name": "Intertek"},
    ]
    for mod in (inv, led, fw):
        monkeypatch.setattr(mod, "db", d)
    monkeypatch.setattr(inv, "log_activity", _noop)
    return d


def test_a_foreign_expense_is_left_out_until_it_has_a_rate(books):
    from routers.ledger import ledger_summary, list_expenses
    t = _run(ledger_summary(OWNER))["totals"]
    assert t["total_spend"] == 18400                          # not 18,600
    assert {"currency": "USD", "count": 1, "amount": 200.0} in t["needs_rate"]
    rows = _run(list_expenses(OWNER, limit=100, offset=0))
    assert next(r for r in rows if r["id"] == "e2")["amount_base"] is None
    assert next(r for r in rows if r["id"] == "e1")["amount_base"] == 18400


def test_setting_an_expense_rate_counts_it(books):
    from models.finance import FxRateInput
    from routers.invoicing import set_expense_fx_rate
    from routers.ledger import ledger_summary
    out = _run(set_expense_fx_rate("e2", FxRateInput(fx_rate=84), OWNER))
    assert out["amount_base"] == 16800
    t = _run(ledger_summary(OWNER))["totals"]
    assert t["total_spend"] == 18400 + 16800 and t["needs_rate"] == []
    assert books.tenants.docs[0]["fx_last"]["USD"] == 84
    with pytest.raises(HTTPException):
        _run(set_expense_fx_rate("e1", FxRateInput(fx_rate=2), OWNER))     # already in INR


def test_a_bills_rate_reaches_the_expense_booked_from_it(books):
    from models.finance import FxRateInput
    from routers.invoicing import set_invoice_fx_rate
    books.invoices.docs.append({"id": "b9", "tenant_id": "t1", "type": "purchase_bill", "amount": 200,
                                "currency": "USD", "status": "unpaid"})
    books.expenses.docs[1]["invoice_id"] = "b9"
    _run(set_invoice_fx_rate("b9", FxRateInput(fx_rate=84), OWNER))
    assert books.expenses.docs[1]["fx_rate"] == 84


def test_the_expense_screens_convert_and_ask():
    math = _src("pages/finance/ledgerMath.js")
    assert "spend: (expenses || []).filter((e) => baseOf(e) != null)" in math
    recs = _src("pages/finance/FinanceRecords.jsx")
    assert 'data-testid={`expense-rate-${e.id}`}' in recs and 'testid="expenses-needs-rate"' in recs
    money = _src("pages/finance/MoneyActions.jsx")
    assert 'invoice.kind === "expense" ? `/expenses/${invoice.id}/fx-rate`' in money


# --- FLOW ---------------------------------------------------------------------------------
TEAMS = [{"key": "sales_&_merchandising", "label": "Sales & Merchandising"}, {"key": "accounts", "label": "Accounts"}]
OM = {"pipelines": [{"key": "order_execution", "label": "Order Execution", "approval_stage": None,
                     "stages": [{"key": "sampling", "label": "Sampling", "role": "sales"},
                                {"key": "order_confirmation", "label": "Order Confirmation", "role": "Sales & Merchandising",
                                 "tasks": [{"title": "Collect 30% advance", "role": "finance"}]},
                                {"key": "shipped", "label": "Shipped", "role": ""}]}],
      "task_categories": []}


def test_the_previewed_pipelines_are_used_as_they_are():
    from services.ai.ai_setup import _shown_operating_model
    om = _shown_operating_model(OM, TEAMS)
    stages = om["pipelines"][0]["stages"]
    assert [s["key"] for s in stages] == ["sampling", "order_confirmation", "shipped"]
    assert stages[1]["role"] == "sales_&_merchandising"           # resolved onto the real team key
    assert stages[1]["tasks"][0]["role"] == "accounts"             # "finance" -> the Accounts team
    assert _shown_operating_model({"pipelines": []}, TEAMS) is None
    assert _shown_operating_model(None, TEAMS) is None


def test_register_hands_the_previewed_flow_to_setup_and_skips_the_second_design(monkeypatch):
    import services.ai.ai_setup as setup
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": TEAMS, "approval_rules": [
        {"name": "Order confirmation", "description": "Sales up to 5 lakh"}]})
    monkeypatch.setattr(setup, "db", d)
    import services.ai.approval_rules as ar
    monkeypatch.setattr(ar, "db", d)
    called = {"om": 0}

    async def no_second_design(*a, **k):
        called["om"] += 1
        return {}, "failed"

    async def quick(*a, **k):
        return {}, "defaulted"
    monkeypatch.setattr(setup, "ai_generate_operating_model_with_status", no_second_design)
    monkeypatch.setattr(setup, "ai_generate_lexicon_with_status", quick)
    monkeypatch.setattr(setup, "ai_generate_finance_categories_with_status", quick)
    actions = [{"rule": "Order confirmation", "kind": "stage_limit", "pipeline": "order_execution",
                "stage": "order_confirmation", "team": "sales_&_merchandising", "up_to": 500000},
               {"rule": "Not a rule of theirs", "kind": "money_threshold", "amount": 1}]
    status = _run(setup.generate_tenant_setup("t1", industry="Textiles", company_size="11-50", roles=TEAMS,
                                              description="", operating_model=OM, approval_actions=actions))
    assert called["om"] == 0 and status["operating_model"] == "generated"
    t = d.tenants.docs[0]
    p = t["operating_model"]["pipelines"][0]
    assert p["approval_stage"] == "order_confirmation"
    assert p["approval_delegate"] == {"role": "sales_&_merchandising", "up_to": 500000.0}
    assert "high_value_threshold" not in t                       # an action for a rule they never gave is dropped


def test_the_flow_endpoint_designs_from_the_interview():
    src = (ROOT / "routers" / "signup.py").read_text(encoding="utf-8")
    assert '@router.post("/interview/flow")' in src
    assert 'await _guard_signup_endpoint(request, "interview_flow")' in src
    assert "_interview_context(s)" in src
    # designed in the background from the moment the plan exists, never inside a request
    assert "await _start_flow_design(s[\"id\"], _flow_signature(result))" in src
    assert "task = asyncio.create_task(_design_flow(session_id, sig))" in src


class _Req:
    def __init__(self, retry=False):
        self.query_params = {"retry": "1"} if retry else {}
        self.headers = {}


@pytest.fixture
def signup(monkeypatch):
    import routers.signup as su
    d = FakeDB()
    d.signup_sessions.docs.append({"id": "s1", "industry": "Textiles", "team_size": "11-50", "qa": [],
                                   "blueprint": {"departments": TEAMS, "approval_rules": []}})
    monkeypatch.setattr(su, "db", d)
    started = []

    async def fake_start(sid, sig):
        started.append(sig)
        await d.signup_sessions.update_one({"id": sid}, {"$set": {"flow": {
            "sig": sig, "status": "designing", "started_at": "2999-01-01T00:00:00+00:00"}}})
    monkeypatch.setattr(su, "_start_flow_design", fake_start)
    monkeypatch.setattr(su, "_guard_signup_endpoint", _noop)
    return su, d, started


def test_the_screen_polls_a_background_design(signup):
    from models.signup import InterviewSessionInput
    su, d, started = signup
    inp = InterviewSessionInput(session_id="s1")
    assert _run(su.interview_flow(inp, _Req()))["status"] == "designing" and len(started) == 1
    assert _run(su.interview_flow(inp, _Req()))["status"] == "designing" and len(started) == 1   # a poll starts nothing
    sig = started[0]
    d.signup_sessions.docs[0]["flow"] = {"sig": sig, "status": "ready", "operating_model": OM,
                                         "approval_actions": [], "rules_said": []}
    out = _run(su.interview_flow(inp, _Req()))
    assert out["status"] == "ready" and out["operating_model"]["pipelines"][0]["key"] == "order_execution"


def test_a_failed_design_waits_for_try_again_and_a_dead_one_restarts(signup):
    from models.signup import InterviewSessionInput
    su, d, started = signup
    inp = InterviewSessionInput(session_id="s1")
    sig = su._flow_signature(d.signup_sessions.docs[0]["blueprint"])
    d.signup_sessions.docs[0]["flow"] = {"sig": sig, "status": "failed"}
    assert _run(su.interview_flow(inp, _Req()))["status"] == "failed" and not started
    assert _run(su.interview_flow(inp, _Req(retry=True)))["status"] == "designing" and len(started) == 1
    # "designing" for longer than a design can take: its worker died; start again
    d.signup_sessions.docs[0]["flow"] = {"sig": sig, "status": "designing", "started_at": "2000-01-01T00:00:00+00:00"}
    assert _run(su.interview_flow(inp, _Req()))["status"] == "designing" and len(started) == 2
    # a plan changed by a refine is a new design, not the old answer
    d.signup_sessions.docs[0]["flow"] = {"sig": "old-plan", "status": "ready", "operating_model": OM}
    assert _run(su.interview_flow(inp, _Req()))["status"] == "designing" and len(started) == 3


def test_the_job_stores_its_result_only_for_the_plan_it_designed(monkeypatch):
    import routers.signup as su
    import services.ai.generators as gen
    import services.ai.approval_rules as ar
    d = FakeDB()
    d.signup_sessions.docs.append({"id": "s1", "industry": "Textiles", "qa": [],
                                   "blueprint": {"departments": TEAMS, "approval_rules": []},
                                   "flow": {"sig": "plan-a", "status": "designing"}})
    monkeypatch.setattr(su, "db", d)

    async def om(*a, **k):
        return OM

    async def rules(*a, **k):
        return []
    monkeypatch.setattr(gen, "ai_generate_operating_model", om)
    monkeypatch.setattr(ar, "structure_approval_rules", rules)
    _run(su._design_flow("s1", "plan-a"))
    assert d.signup_sessions.docs[0]["flow"]["status"] == "ready"
    d.signup_sessions.docs[0]["flow"] = {"sig": "plan-b", "status": "designing"}     # refined meanwhile
    _run(su._design_flow("s1", "plan-a"))
    assert d.signup_sessions.docs[0]["flow"] == {"sig": "plan-b", "status": "designing"}


def test_the_review_and_settings_draw_the_route():
    flow = _src("components/workflow/PipelineFlow.jsx")
    assert "export function PipelineFlow(" in flow and "export function withRules(" in flow
    assert 'data-testid="flow-track"' in flow and 'data-testid="flow-timeline"' in flow
    # across only when every step has room, measured on the card -- never cut off
    assert "setAcross(el.clientWidth >= count * STATION_MIN_PX)" in flow and "overflow-x-auto" not in flow
    review = _src("pages/onboarding/BuildReveal.js")
    assert "timer = setTimeout(() => ask(false), FLOW_POLL_MS);" in review         # short polls, no long request
    assert "SLOW_TIMEOUT_MS" not in review
    assert "operating_model: flow.operating_model," in review and "<WorkFlowSection" in review
    assert "<WorkFlowCard />" in _src("pages/Settings.js")

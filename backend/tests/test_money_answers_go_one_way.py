"""The two money AIs, and which way the money goes (audit F-01 / G-01, 2026-10-09).

G-01  Dex, asked "What do we owe suppliers, and when is it due?", answered
      "2 outstanding supplier invoices totalling Rs 13,18,000": the invoices it
      read hold BOTH directions and its Outstanding added a customer's
      Rs 11,50,000 (owed TO us) to the Rs 1,68,000 yarn bill.
F-01  The Finance "Ask AI" box answered Rs 0 to the same question; and asked
      from the Revenue / Assets / Inventory tabs it was never given the bills.

Checked live on the scratch database (2026-10-09): Dex -> "1 outstanding
supplier bill totalling Rs 1,68,000 ... due 5 November"; Finance, asked from the
Revenue tab -> "You owe Rs 1,68,000 to Sri Lakshmi Yarn Mills ... due 5 Nov".
The model-side answer is also in the golden set: evals/cases/finance.py.

A-42 (the Desk loop on short screens) is pinned at the bottom.
"""
import asyncio
from pathlib import Path

import pytest

from routers.brain import money_side, _refine_plan

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("q", [
    "What do we owe suppliers, and when is it due?", "list unpaid vendor bills",
    "what bills do we have to pay this week", "who do we owe money to", "total payables",
])
def test_supplier_questions(q):
    assert money_side(q) == "supplier"


@pytest.mark.parametrize("q", [
    "How much do customers owe us?", "Which buyers have not paid?", "receivables over 30 days",
    "how much money is coming in this month", "what is left to collect",
])
def test_customer_questions(q):
    assert money_side(q) == "customer"


@pytest.mark.parametrize("q", ["What is outstanding?", "Show me all unpaid invoices",
                               "Do suppliers or customers owe more?"])
def test_neither_or_both(q):
    assert money_side(q) == ""


def test_a_supplier_owe_question_reads_the_bills_not_the_expenses():
    plan = _refine_plan({"primary_entity": "expenses", "keywords": []}, "What do we owe suppliers?")
    assert plan["primary_entity"] == "invoices" and plan["money_side"] == "supplier"


ROWS = [
    {"id": "b1", "type": "purchase_bill", "number": "SLY-4471", "contact_name": "Sri Lakshmi Yarn Mills",
     "amount": 168000, "amount_paid": 0, "status": "unpaid", "currency": "INR", "due_date": "2026-11-05",
     "date": "2026-10-06"},
    {"id": "s1", "type": "sales_invoice", "number": "NW-001", "contact_name": "Northwind Apparel",
     "amount": 1150000, "amount_paid": 0, "status": "unpaid", "currency": "INR", "due_date": "2026-11-20",
     "date": "2026-10-07"},
]


def _compute(side, monkeypatch):
    import routers.brain as br

    async def _inr(_tid):
        return "INR"
    monkeypatch.setattr(br, "_currency", _inr)
    ctx = {"tid": "t1", "start": None, "end": None}
    plan = {"money_side": side} if side else {}
    return asyncio.run(br._compute_invoices(ctx, plan, ROWS))


def test_what_we_owe_is_the_bill_only(monkeypatch):
    kpis, table, _ = _compute("supplier", monkeypatch)
    k = {x["label"]: x["value"] for x in kpis}
    assert k["We owe suppliers"] == 168000, "Rs 1,68,000 -- not Rs 13,18,000"
    assert [r["party"] for r in table["rows"]] == ["Sri Lakshmi Yarn Mills"]
    assert table["rows"][0]["type"] == "Supplier bill (we owe)"


def test_what_customers_owe_is_the_invoice_only(monkeypatch):
    kpis, table, _ = _compute("customer", monkeypatch)
    assert {x["label"]: x["value"] for x in kpis}["Customers owe us"] == 1150000
    assert [r["party"] for r in table["rows"]] == ["Northwind Apparel"]


def test_both_sides_are_never_summed(monkeypatch):
    kpis, _, _ = _compute("", monkeypatch)
    k = {x["label"]: x["value"] for x in kpis}
    assert k["Customers owe us"] == 1150000 and k["We owe suppliers"] == 168000
    assert 1318000 not in k.values() and "Outstanding" not in k


def test_the_finance_ai_gets_both_sides_on_every_tab():
    src = (ROOT / "routers" / "ledger.py").read_text(encoding="utf-8")
    assert 'await _finance_context(user["tenant_id"], scope, both_ways=True)' in src
    assert 'if scope in ("expenses", "brief", "overview") or both_ways:' in src
    assert 'if scope in ("revenue", "brief") or both_ways:' in src
    from prompts import get, render
    assert get("ledger.ask").version == "1.1"
    assert "Never add one to the other" in render("ledger.ask", currency="INR", today="2026-10-09")


def test_the_golden_set_has_the_audit_case():
    import evals.cases  # noqa: F401 -- registers
    from evals.base import all_cases
    names = {c.name for c in all_cases() if c.task == "ledger.ask"}
    assert {"what_we_owe_suppliers_is_the_stock_bill", "what_customers_owe_us_is_not_the_bill"} <= names


# ---- A-42 ---------------------------------------------------------------------
def test_the_desk_gives_room_back_once_not_forever():
    """At 840x602 with decisions waiting the Desk's card had 9px untight and 45px
    tight; 45 > 2 x 9 released tight, the card fell back to 9px and asked again
    in the same commit -- "Maximum update depth exceeded", no Desk. Checked in the
    browser after the fix at 840x602, 360x640, 375x667, 390x844 and 440x956 with
    2 and 6 decisions waiting, on all three tabs."""
    s = (ROOT.parent / "frontend" / "src" / "pages" / "Desk.js").read_text(encoding="utf-8")
    assert "tight && avail > tightAt.current * 2 && released.current < 1" in s
    assert "released.current = 0;" in s, "a resize lets it be given back again"
    assert "deficit.current = { avail: -1, hits: 0, asks: deficit.current.asks };" in s

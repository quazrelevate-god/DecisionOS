"""Product audit 2026-10-08 — two follow-ups.

  FX    A GBP 160 export invoice was added to "Revenue billed" as Rs 160. A
        foreign invoice now carries its exchange rate and every total counts it
        in the company's currency; one with no rate yet is left out of the
        totals and listed (needs_rate), never counted at face value.
  A-11  The sign-up review screen shows the approval rules from the interview
        before the founder enters (and lets one be left out).
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


# --- the helpers --------------------------------------------------------------------------
def test_conversion_never_guesses():
    from shared.money import in_base, money_words, needs_rate, rate_of, total_in_base
    gbp = {"currency": "GBP", "amount": 160, "fx_rate": 107.5}
    bare = {"currency": "USD", "amount": 50}
    inr = {"currency": "INR", "amount": 1000}
    legacy = {"amount": 500}                                  # no currency = the company's own
    assert rate_of(inr, "INR") == 1 and rate_of(legacy, "INR") == 1 and rate_of(bare, "INR") is None
    assert in_base(160, gbp, "INR") == 17200 and in_base(50, bare, "INR") is None
    docs = [gbp, bare, inr, legacy]
    assert total_in_base(docs, "INR", lambda d: d["amount"]) == 17200 + 1000 + 500
    assert needs_rate(docs, "INR", lambda d: d["amount"]) == [{"currency": "USD", "count": 1, "amount": 50.0}]
    assert money_words(168000) == "₹1.68 lakh"              # the module's existing helper is intact


# --- the books ----------------------------------------------------------------------------
@pytest.fixture
def books(monkeypatch):
    import routers.invoicing as inv
    import routers.ledger as led
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "name": "Audit Textiles", "currency": "INR", "state": "Tamil Nadu"})
    d.invoices.docs += [
        {"id": "s1", "tenant_id": "t1", "type": "sales_invoice", "number": "AT/26-27/001", "amount": 1150000,
         "amount_paid": 0, "status": "unpaid", "currency": "INR"},
        {"id": "x1", "tenant_id": "t1", "type": "sales_invoice", "number": "AT/26-27/003", "amount": 160,
         "amount_paid": 60, "status": "partial", "currency": "GBP", "contact_name": "Northwind"},
    ]
    d.payments.docs.append({"id": "p1", "tenant_id": "t1", "direction": "in", "amount": 60, "currency": "GBP",
                            "invoice_id": "x1", "applied": 60, "match_status": "matched"})
    import services.finance_words as fw
    for mod in (inv, led, fw):
        monkeypatch.setattr(mod, "db", d)
    monkeypatch.setattr(inv, "log_activity", _noop)
    return d


def test_a_foreign_invoice_with_no_rate_is_left_out_not_counted_at_face_value(books):
    from routers.ledger import ledger_summary, list_revenue
    t = _run(ledger_summary(OWNER))["totals"]
    assert t["revenue_billed"] == 1150000                     # not 1,150,160
    assert t["revenue_received"] == 0                         # the GBP 60 is not Rs 60
    assert t["needs_rate"] == [{"currency": "GBP", "count": 1, "amount": 160.0}]
    rev = _run(list_revenue(OWNER))
    x = next(i for i in rev["invoices"] if i["id"] == "x1")
    assert x["amount_base"] is None and rev["totals"]["needs_rate"][0]["currency"] == "GBP"


def test_setting_the_rate_counts_it_and_its_payments(books):
    from models.finance import FxRateInput
    from routers.invoicing import set_invoice_fx_rate
    from routers.ledger import ledger_summary
    out = _run(set_invoice_fx_rate("x1", FxRateInput(fx_rate=107.5), OWNER))
    assert out["amount_base"] == 17200
    assert books.payments.docs[0]["fx_rate"] == 107.5          # the payment already made takes it too
    assert books.tenants.docs[0]["fx_last"]["GBP"] == 107.5
    t = _run(ledger_summary(OWNER))["totals"]
    assert t["revenue_billed"] == 1150000 + 17200 and t["revenue_received"] == 6450
    assert t["revenue_outstanding"] == 1150000 + 10750 and t["needs_rate"] == []
    with pytest.raises(HTTPException):
        _run(set_invoice_fx_rate("s1", FxRateInput(fx_rate=2), OWNER))   # already in INR


def test_an_export_invoice_needs_its_rate_and_keeps_it(books):
    from models.finance import GstInvoiceInput
    from routers.invoicing import create_gst_invoice
    lines = [{"description": "Polo shirts", "qty": 50, "rate": 3.2, "gst_rate": 5}]
    with pytest.raises(HTTPException) as e:
        _run(create_gst_invoice(GstInvoiceInput(customer_name="Northwind", place_of_supply="Export (outside India)",
                                                currency="GBP", items=lines), OWNER))
    assert "exchange rate" in e.value.detail
    doc = _run(create_gst_invoice(GstInvoiceInput(customer_name="Northwind", place_of_supply="Export (outside India)",
                                                  currency="GBP", fx_rate=107.5, items=lines), OWNER))
    assert doc["fx_rate"] == 107.5 and doc["amount"] == 160
    assert books.tenants.docs[0]["fx_last"]["GBP"] == 107.5


def test_a_payment_on_a_foreign_invoice_takes_its_rate(books):
    from models.finance import RecordPaymentInput
    from routers.invoicing import record_invoice_payment
    books.invoices.docs[1]["fx_rate"] = 107.5
    out = _run(record_invoice_payment("x1", RecordPaymentInput(amount=100), OWNER))
    assert out["payment"]["currency"] == "GBP" and out["payment"]["fx_rate"] == 107.5


def test_every_other_total_converts_too():
    for rel, needle in [("routers/desk.py", "total_in_base(overdue_rows"),
                        ("routers/brain.py", "billed = total_in_base(filtered, base"),
                        ("routers/finance.py", "total_billed = total_in_base(invoices, _base"),
                        ("routers/crm.py", "remaining = in_base(_remaining(inv), inv, base)"),
                        ("routers/ledger.py", '"not_in_totals_no_exchange_rate": _needs_rate(')]:
        assert needle in (ROOT / rel).read_text(encoding="utf-8"), rel


def test_the_screens_use_the_company_currency_and_ask_for_a_rate():
    math = _src("pages/finance/ledgerMath.js")
    assert "export const baseOf = (d) =>" in math and "filter((i) => baseOf(i) != null)" in math
    recs = _src("pages/finance/FinanceRecords.jsx")
    assert '"no rate yet"' in recs and "onSetRate={onSetRate}" in recs and "<NeedsRateNote" in recs
    money = _src("pages/finance/MoneyActions.jsx")
    assert "export function SetRateDialog" in money and 'data-testid="invoice-fx-rate"' in money
    assert "`/invoices/${invoice.id}/fx-rate`" in money and "api.patch(path, { fx_rate: n })" in money
    assert "<NeedsRateNote" in _src("pages/finance/FinanceOverview.jsx")
    assert "<SetRateDialog" in _src("pages/Ledger.js")


# --- A-11 ---------------------------------------------------------------------------------
def test_the_review_screen_shows_who_signs_off():
    s = _src("pages/onboarding/BuildReveal.js")
    assert "function ApprovalRules({ rules, onRemove, still, startAt })" in s
    assert "<ApprovalRules rules={bp?.approval_rules}" in s
    assert 'data-testid="build-approval-rule-remove"' in s
    # what was removed stays removed, in the saved draft and in what register gets
    assert "onBlueprint?.(next);" in s and "approval_rules: bp.approval_rules || []," in s

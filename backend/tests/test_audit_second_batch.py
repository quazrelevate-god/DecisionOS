"""Product audit 2026-10-08 — the second batch.

  F-02  record a payment against an invoice or a supplier bill (full or part)
  F-03  a GST / export invoice with line items, a number series and a PDF
  F-04  "To pay" on the overview; profit counts the cost of stock USED
  B-01  the sign-up interview's approval rules become settings
  (F-01 in passing: the Finance AI is now shown the unpaid supplier bills)
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


async def _noop(*a, **k):
    return None


@pytest.fixture
def books(monkeypatch):
    import routers.invoicing as inv
    import routers.ledger as led
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "name": "Audit Textiles", "currency": "INR", "state": "Tamil Nadu",
                           "gst": "33ABCDE1234F1Z5", "address": "Tiruppur"})
    d.invoices.docs += [
        {"id": "s1", "tenant_id": "t1", "type": "sales_invoice", "number": "AT/26-27/001", "amount": 1150000,
         "amount_paid": 0, "status": "unpaid", "contact_name": "Northwind", "currency": "INR"},
        {"id": "b1", "tenant_id": "t1", "type": "purchase_bill", "number": "SLY/2026/0412", "amount": 168000,
         "status": "unpaid", "contact_name": "Sri Lakshmi Yarn Mills", "purchase_type": "inventory",
         "due_date": "2026-11-05"},
        {"id": "other", "tenant_id": "t2", "type": "sales_invoice", "amount": 5, "status": "unpaid"},
    ]
    d.expenses.docs.append({"id": "e1", "tenant_id": "t1", "invoice_id": "b1", "amount": 168000, "status": "unpaid",
                            "category": "Raw Materials"})
    d.inventory.docs.append({"id": "i1", "tenant_id": "t1", "item": "Cotton yarn", "quantity": 500, "unit": "kg",
                             "unit_cost": 336, "value": 168000, "currency": "INR"})
    import services.finance_words as fw
    for mod in (inv, led, fw):
        monkeypatch.setattr(mod, "db", d)
    monkeypatch.setattr(inv, "log_activity", _noop)
    return d


def _run(c):
    return asyncio.run(c)


# --- F-02 --------------------------------------------------------------------------------
def test_a_part_payment_then_the_rest(books):
    from models.finance import RecordPaymentInput
    from routers.invoicing import record_invoice_payment
    out = _run(record_invoice_payment("s1", RecordPaymentInput(amount=345000, method="bank transfer", reference="UTR1"), OWNER))
    assert out["invoice"]["status"] == "partial" and out["invoice"]["balance"] == 805000
    assert out["payment"]["direction"] == "in" and out["payment"]["match_status"] in ("matched",)
    out = _run(record_invoice_payment("s1", RecordPaymentInput(amount=805000), OWNER))
    assert out["invoice"]["status"] == "paid" and out["invoice"]["balance"] == 0
    assert len([p for p in books.payments.docs if p["invoice_id"] == "s1"]) == 2


def test_cannot_pay_more_than_is_due_or_nothing(books):
    from models.finance import RecordPaymentInput
    from routers.invoicing import record_invoice_payment
    with pytest.raises(HTTPException) as e:
        _run(record_invoice_payment("s1", RecordPaymentInput(amount=2000000), OWNER))
    assert e.value.status_code == 400 and "still due" in e.value.detail
    with pytest.raises(HTTPException):
        _run(record_invoice_payment("s1", RecordPaymentInput(amount=0), OWNER))
    with pytest.raises(HTTPException) as e:
        _run(record_invoice_payment("other", RecordPaymentInput(amount=1), OWNER))   # another company's
    assert e.value.status_code == 404


def test_paying_a_supplier_bill_in_full_marks_its_expense_paid(books):
    from models.finance import RecordPaymentInput
    from routers.invoicing import record_invoice_payment
    out = _run(record_invoice_payment("b1", RecordPaymentInput(amount=168000, method="upi"), OWNER))
    assert out["invoice"]["status"] == "paid" and out["payment"]["direction"] == "out"
    assert books.expenses.docs[0]["status"] == "paid"


# --- F-03 --------------------------------------------------------------------------------
def test_gst_split_follows_the_place_of_supply():
    from services.invoicing import EXPORT, compute_invoice
    line = [{"description": "Cotton polo shirts", "hsn": "6105", "qty": 5000, "rate": 230, "gst_rate": 5}]
    intra = compute_invoice(line, seller_state="Tamil Nadu", place_of_supply="Tamil Nadu")
    assert intra["tax_mode"] == "intra" and intra["cgst"] == intra["sgst"] == 28750 and intra["igst"] == 0
    inter = compute_invoice(line, seller_state="Tamil Nadu", place_of_supply="Karnataka")
    assert inter["tax_mode"] == "inter" and inter["igst"] == 57500 and inter["amount"] == 1207500
    exp = compute_invoice([{**line[0], "rate": 2.3}], seller_state="Tamil Nadu", place_of_supply=EXPORT, currency="GBP")
    assert exp["tax_mode"] == "export" and exp["tax_total"] == 0 and exp["amount"] == 11500


def test_rupee_totals_round_to_the_rupee_and_read_in_words():
    from services.invoicing import amount_in_words, compute_invoice, financial_year
    c = compute_invoice([{"description": "x", "qty": 3, "rate": 99.99, "gst_rate": 18}],
                        seller_state="Tamil Nadu", place_of_supply="Tamil Nadu")
    assert c["amount"] == 354 and c["round_off"] == 0.04
    assert amount_in_words(168000) == "Rupees One Lakh Sixty-Eight Thousand Only"
    assert amount_in_words(11500, "GBP") == "Pounds Eleven Thousand Five Hundred Only"
    assert financial_year("2026-10-08") == "26-27" and financial_year("2027-03-31") == "26-27"


def test_raise_an_invoice_numbers_it_and_makes_a_pdf(books):
    from models.finance import GstInvoiceInput
    from routers.invoicing import create_gst_invoice, invoice_pdf
    inp = GstInvoiceInput(customer_name="Kumar Traders", customer_gstin="29ABCDE1234F1Z5", place_of_supply="Karnataka",
                          items=[{"description": "Polo shirts", "hsn": "6105", "qty": 100, "rate": 250, "gst_rate": 5}])
    doc = _run(create_gst_invoice(inp, OWNER))
    assert doc["number"] == "AT/26-27/002"              # after the one typed by hand
    assert doc["igst"] == 1250 and doc["amount"] == 26250 and doc["status"] == "unpaid"
    res = _run(invoice_pdf(doc["id"], OWNER))
    assert res.media_type == "application/pdf" and res.body[:5] == b"%PDF-"


def test_a_bad_gstin_or_an_empty_invoice_is_refused(books):
    from models.finance import GstInvoiceInput
    from routers.invoicing import create_gst_invoice
    with pytest.raises(HTTPException) as e:
        _run(create_gst_invoice(GstInvoiceInput(customer_name="X", customer_gstin="ABC123",
                                                items=[{"description": "a", "qty": 1, "rate": 1}]), OWNER))
    assert "GSTIN" in e.value.detail
    with pytest.raises(HTTPException):
        _run(create_gst_invoice(GstInvoiceInput(customer_name="X", items=[]), OWNER))


# --- F-04 --------------------------------------------------------------------------------
def test_using_stock_moves_its_cost_into_profit(books):
    from models.finance import StockUseInput
    from routers.invoicing import use_stock
    from routers.ledger import ledger_summary
    books.invoices.docs[0]["amount_paid"] = 0
    out = _run(use_stock("i1", StockUseInput(quantity=500, note="NW-001"), OWNER))
    assert out["item"]["quantity"] == 0 and out["movement"]["value"] == 168000
    s = _run(ledger_summary(OWNER))
    t = s["totals"]
    assert t["stock_used"] == 168000
    assert t["net_profit"] == 1150000 - 168000           # the sale, less the yarn that went into it
    assert t["payables_outstanding"] == 168000 and t["open_bill_count"] == 1
    with pytest.raises(HTTPException):
        _run(use_stock("i1", StockUseInput(quantity=1), OWNER))      # none left


def test_the_finance_ai_is_shown_what_is_owed(books):
    from routers.ledger import _finance_context
    ctx = _run(_finance_context("t1", "brief"))
    assert ctx["totals"]["payables_outstanding"] == 168000
    assert ctx["payables_due"][0]["supplier"] == "Sri Lakshmi Yarn Mills"
    assert ctx["payables_due"][0]["booked_as"] == "inventory"


def test_the_overview_shows_both_ways_and_profit_after_stock():
    ov = _src("pages/finance/FinanceOverview.jsx")
    assert 'id: "to-pay"' in ov and 'id: "to-collect"' in ov and "totals.payables_outstanding" in ov
    math = _src("pages/finance/ledgerMath.js")
    assert "const netNow = billed.value - operating.value - used.value;" in math
    recs = _src("pages/finance/FinanceRecords.jsx")
    assert "<BillsToPayPanel" in recs and "<InvoiceRowActions" in recs and "inventory-use-" in recs
    forms = _src("pages/finance/FinanceForms.jsx")
    assert '<InvoiceBuilderDialog {...bind("invoice")} />' in forms


# --- B-01 --------------------------------------------------------------------------------
TEAMS = [{"key": "sales_&_buyer_management", "label": "Sales & Buyer Management"},
         {"key": "hr", "label": "HR"}, {"key": "accounts", "label": "Accounts"}]
PIPES = [{"key": "order_fulfillment", "label": "Order Fulfillment", "approval_stage": "order_confirmed",
          "stages": [{"key": "inquiry", "label": "Inquiry"}, {"key": "order_confirmed", "label": "Order Confirmed"},
                     {"key": "shipped", "label": "Shipped"}]}]
RULES = [{"name": "Order confirmation", "description": "Sales confirms orders up to 5 lakh; above that the owner"},
         {"name": "Leave", "description": "HR manager approves leave"},
         {"name": "Purchases", "description": "POs over 1 lakh need the owner"},
         {"name": "Discounts", "description": "Discounts over 5% need the owner"}]


def test_only_real_keys_survive_and_every_rule_is_accounted_for():
    from services.ai.approval_rules import validate_actions
    raw = {"actions": [
        {"rule": "Order confirmation", "kind": "stage_limit", "pipeline": "order_fulfillment",
         "stage": "order_confirmed", "team": "sales_&_buyer_management", "up_to": 500000},
        {"rule": "Leave", "kind": "leave_approver", "team": "hr", "for_teams": ["*"]},
        {"rule": "Purchases", "kind": "money_threshold", "amount": "100000"},
        {"rule": "Discounts", "kind": "stage_limit", "pipeline": "nope", "stage": "x", "team": "hr", "up_to": 1},
        {"rule": "Invented", "kind": "money_threshold", "amount": 5},
    ]}
    acts = validate_actions(raw, rules=RULES, teams=TEAMS, pipelines=PIPES)
    kinds = {a["rule"]: a["kind"] for a in acts}
    assert kinds == {"Order confirmation": "stage_limit", "Leave": "leave_approver",
                     "Purchases": "money_threshold", "Discounts": "note"}
    assert next(a for a in acts if a["rule"] == "Purchases")["amount"] == 100000


def test_the_actions_become_settings(monkeypatch):
    import services.ai.approval_rules as ar
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "roles": TEAMS, "operating_model": {"pipelines": [dict(p) for p in PIPES]},
                           "approval_rules": RULES})
    monkeypatch.setattr(ar, "db", d)
    acts = ar.validate_actions({"actions": [
        {"rule": "Order confirmation", "kind": "stage_limit", "pipeline": "order_fulfillment",
         "stage": "order_confirmed", "team": "sales_&_buyer_management", "up_to": 500000},
        {"rule": "Leave", "kind": "leave_approver", "team": "hr", "for_teams": ["*"]},
        {"rule": "Purchases", "kind": "money_threshold", "amount": 100000}]},
        rules=RULES, teams=TEAMS, pipelines=PIPES)
    summary = _run(ar.apply_actions("t1", acts))
    t = d.tenants.docs[0]
    assert t["operating_model"]["pipelines"][0]["approval_delegate"] == {"role": "sales_&_buyer_management", "up_to": 500000}
    assert t["leave_approver_teams"] == {"*": "hr"}
    assert t["high_value_threshold"] == 100000 and t["require_owner_signoff"] is True
    said = {s["rule"]: s for s in summary}
    assert "up to ₹5,00,000" in said["Order confirmation"]["became"]          # Indian grouping
    assert said["Order confirmation"]["setting"] and "₹1,00,000" in said["Purchases"]["became"]
    assert said["Discounts"]["setting"] is False and "Noted" in said["Discounts"]["became"]


def test_the_delegate_survives_a_settings_save():
    from shared.normalizers import normalize_operating_model
    om = normalize_operating_model({"pipelines": [{**PIPES[0], "approval_delegate": {"role": "sales", "up_to": "500000"}}]})
    assert om["pipelines"][0]["approval_delegate"] == {"role": "sales", "up_to": 500000.0}
    om = normalize_operating_model({"pipelines": [{**PIPES[0], "approval_stage": None,
                                                   "approval_delegate": {"role": "sales", "up_to": 5}}]})
    assert "approval_delegate" not in om["pipelines"][0]        # no sign-off stage, no delegate


def test_the_engine_lets_the_delegate_through_within_the_limit():
    src = (ROOT / "services" / "workflow_engine.py").read_text(encoding="utf-8")
    assert 'dlg = (pipeline or {}).get("approval_delegate") or {}' in src
    assert "value is not None and float(value) <= float(limit)" in src
    assert "Add the order value to the card first" in src
    assert 'cap = "₹" + _money(float(limit), "INR")[:-3]' in src     # ₹5,00,000, not 500,000


def test_a_team_named_in_the_interview_approves_leave(monkeypatch):
    import services.leave as lv
    import services.auth.membership as mem
    d = FakeDB()
    d.tenants.docs.append({"id": "t1", "leave_approver_teams": {"*": "hr"}})
    d.users.docs += [{"id": "rahul", "tenant_id": "t1", "role": "sales_&_buyer_management", "name": "Rahul"},
                     {"id": "kavitha", "tenant_id": "t1", "role": "hr", "name": "Kavitha"},
                     {"id": "meera", "tenant_id": "t1", "role": "owner", "name": "Meera"}]
    monkeypatch.setattr(lv, "db", d)

    async def members(db, tid, statuses=None):
        return [{"user_id": u["id"], "role": u["role"], "status": "active"} for u in d.users.docs]

    async def perms(db, tid, people):
        return {p["id"]: ({"leave_approve"} if p["id"] == "kavitha" else set()) for p in people}
    monkeypatch.setattr(mem, "list_memberships_for_tenant", members)
    monkeypatch.setattr(mem, "members_effective_perms", perms)
    assert _run(lv._resolve_leave_approver("t1", d.users.docs[0])) == ("kavitha", "Kavitha")
    # Kavitha's own leave goes on up to the owner, never back to herself.
    assert _run(lv._resolve_leave_approver("t1", d.users.docs[1])) == ("meera", "Meera")


def test_rules_are_applied_after_sign_up_and_shown_in_settings():
    setup = (ROOT / "services" / "ai" / "ai_setup.py").read_text(encoding="utf-8")
    assert "apply_interview_rules(tenant_id)" in setup
    assert "<InterviewRulesCard />" in _src("pages/Settings.js")
    assert "op-delegate-role-" in _src("components/OperatingModelEditor.js")
    assert "team (from your sign-up)" in _src("pages/Leave.js")

"""Golden cases for ledger.ask -- the Finance "Ask AI" box (audit F-01, 2026-10-09).

The audit's case: a Rs 1,68,000 yarn bill from Sri Lakshmi Yarn Mills, booked as
STOCK and unpaid, due 5 Nov; and Northwind Apparel's Rs 11,50,000 sales invoice,
owed TO the company. "How much do we owe suppliers and when is it due?" was
answered "Rs 0 ... already fully paid for", and Dex (routers/brain.py, tested in
tests/test_money_answers_go_one_way.py) added the two together.

The checks are the invariants that make the answer right, not its wording:
the supplier figure is named, the customer's money is not added to it, and the
due date is given.
"""
from evals.base import register, EvalCase, predicate
from routers.ledger import answer_finance_question

CTX = {
    "currency": "INR", "today": "2026-10-09",
    "totals": {"total_spend": 168000, "paid": 0, "outstanding": 168000, "expense_count": 0,
               "asset_count": 0, "asset_value": 0, "inventory_count": 1, "inventory_value": 168000,
               "revenue_billed": 1150000, "revenue_received": 0, "revenue_outstanding": 1150000,
               "sales_count": 1, "operating_spend": 0, "stock_spend": 168000, "capital_spend": 0,
               "stock_used": 0, "net_profit": 1150000, "payables_outstanding": 168000, "open_bill_count": 1,
               "not_in_totals_no_exchange_rate": []},
    "by_category": [], "by_vendor": [], "by_month": [], "top_unpaid": [],
    "payables_due": [{"supplier": "Sri Lakshmi Yarn Mills", "number": "SLY-4471", "booked_as": "inventory",
                      "balance": 168000, "currency": "INR", "due_date": "2026-11-05", "date": "2026-10-06"}],
    "top_customers": [{"name": "Northwind Apparel", "amount": 1150000}],
    "outstanding_receivables": [{"title": "INV-001", "customer": "Northwind Apparel", "amount": 1150000,
                                 "currency": "INR", "due_date": "2026-11-20", "date": "2026-10-07"}],
}


def _says(*forms):
    def _f(r):
        a = (r.get("answer") or "").replace(" ", "").lower()
        return any(f.replace(" ", "").lower() in a for f in forms)
    return _f


register(EvalCase(
    task="ledger.ask", name="what_we_owe_suppliers_is_the_stock_bill",
    fn=answer_finance_question,
    kwargs={"ctx": CTX, "question": "How much do we owe suppliers and when is it due?"},
    golden=("You owe Sri Lakshmi Yarn Mills ₹1,68,000 on bill SLY-4471 (booked as stock), due on "
            "5 November 2026. That is the only unpaid supplier bill."),
    checks=[
        predicate("names the Rs 1,68,000 owed", _says("1,68,000", "168000", "168,000", "1.68 lakh")),
        predicate("does not add the customer's Rs 11,50,000",
                  lambda r: not _says("13,18,000", "1318000", "1,318,000", "13.18")(r)),
        predicate("does not say nothing is owed", lambda r: not _says("₹0", "rs0", "no outstanding payable")(r)),
        predicate("gives the due date", _says("5 nov", "nov 5", "2026-11-05", "5th nov", "05 nov")),
    ],
    note="F-01: a bill booked as stock is still owed; payables and receivables never summed.",
))

register(EvalCase(
    task="ledger.ask", name="what_customers_owe_us_is_not_the_bill",
    fn=answer_finance_question,
    kwargs={"ctx": CTX, "question": "How much do customers owe us?"},
    golden="Northwind Apparel owes you ₹11,50,000 on invoice INV-001, due 20 November 2026.",
    checks=[
        predicate("names the Rs 11,50,000 owed to us", _says("11,50,000", "1150000", "1,150,000", "11.5 lakh")),
        predicate("does not add the supplier bill",
                  lambda r: not _says("13,18,000", "1318000", "1,318,000")(r)),
    ],
    note="F-01/G-01: the other direction, so the two are told apart both ways.",
))

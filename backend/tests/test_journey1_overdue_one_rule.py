"""One rule for "overdue", the Desk's and the Finance page's (JOURNEY-1,
2026-09-22).

Rajesh's Desk said "To collect (overdue) ₹6.8L"; the Finance page it opens,
filtered to Overdue, said ₹4L — and the AI panel on that same page listed the
₹6.8L. The Desk counted invoices a week or more past their DUE date
(services/finance_signals); the page counted invoices RAISED more than 30 days
ago, due date or not. The server now answers for each invoice (GET /revenue:
`overdue`, `days_past_due`) with the Desk's own rule, and the page shows that.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-overdue"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
NOW = datetime.now(timezone.utc)


def _day(n):
    return (NOW + timedelta(days=n)).strftime("%Y-%m-%d")


def _inv(i, *, issued, due, amount=100000, status="unpaid", paid=0):
    return {"id": f"inv{i}", "tenant_id": T, "type": "sales_invoice", "number": f"S-{i}",
            "amount": amount, "paid_amount": paid, "status": status, "date": _day(issued),
            "due_date": due and _day(due), "created_at": NOW.isoformat()}


INVOICES = [
    _inv(1, issued=-5, due=-10),          # raised last week, 10 days past due: OVERDUE (the page missed it)
    _inv(2, issued=-40, due=+5),          # raised 40 days ago, not due yet: NOT overdue (the page flagged it)
    _inv(3, issued=-20, due=-3),          # 3 days past due: inside the week's grace, not yet
    _inv(4, issued=-60, due=-30, status="paid", paid=100000),   # paid: never
    _inv(5, issued=-50, due=None),        # no due date: the rule cannot say it is late
]


def test_the_rule_on_its_own():
    from services.finance_signals import days_past_due, receivable_overdue
    by_id = {i["id"]: i for i in INVOICES}
    assert receivable_overdue(by_id["inv1"], NOW) is True
    assert receivable_overdue(by_id["inv2"], NOW) is False
    assert receivable_overdue(by_id["inv3"], NOW) is False
    assert receivable_overdue(by_id["inv4"], NOW) is False
    assert receivable_overdue(by_id["inv5"], NOW) is False
    assert days_past_due(by_id["inv1"], NOW) == 10
    assert days_past_due(by_id["inv5"], NOW) is None


def test_the_page_and_the_desk_count_the_same_invoices(with_test_db):
    async def scenario(db):
        import routers.ledger as ledger
        from services.finance_signals import _overdue_receivables
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR"})
            await db.invoices.insert_many([dict(i) for i in INVOICES])
            page = await ledger.list_revenue(user=OWNER)
            desk = await _overdue_receivables(T)
            return page, desk

    page, desk = with_test_db(scenario)
    flagged = {i["id"] for i in page["invoices"] if i.get("overdue")}
    assert flagged == {r["id"] for r in desk} == {"inv1"}
    inv1 = next(i for i in page["invoices"] if i["id"] == "inv1")
    assert inv1["days_past_due"] == 10, "the page says days past the due date, not days since it was raised"

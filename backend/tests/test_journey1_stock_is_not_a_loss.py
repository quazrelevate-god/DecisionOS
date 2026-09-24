"""Buying stock is not a loss (JOURNEY-1 J2-06, founder 24 Sep).

A wholesaler's first act is buying Rs 86,400 of groundnut oil to sell. Under
"revenue minus everything spent" her profit read MINUS Rs 86,400, in red, on
day one — arithmetically right and commercially nonsense. She had not lost
anything; she had turned cash into stock sitting in the godown.

Profit is revenue minus what it costs to RUN the place. Stock and equipment
are still counted and still shown — as Spend, and on their own tiles — they
are simply not a loss. This is not an accountant's P&L (a real one recognises
the cost of stock when the stock is SOLD, which needs inventory valuation this
app does not keep); it is the honest version of the number a shopkeeper is
asking for.
"""
import os

import pytest

from routers.ledger import _spend_split
from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-stock"
OWNER = {"id": "u-lakshmi", "tenant_id": T, "role": "owner", "name": "Lakshmi", "permissions": []}


def _e(amount, category):
    return {"amount": amount, "category": category}


def test_the_split_itself():
    operating, stock, capital = _spend_split([
        _e(86400, "Raw Material"),        # the oil she bought to sell
        _e(1800000, "Asset Purchase"),    # the press brake
        _e(12000, "Rent"),
        _e(9400, "Utilities"),
        _e(5000, None),                   # uncategorised is a running cost
    ])
    assert stock == 86400
    assert capital == 1800000
    assert operating == 26400


def test_case_matters_not_at_all():
    _op, stock, _cap = _spend_split([_e(100, "raw material"), _e(100, "  Stock  "), _e(100, "INVENTORY")])
    assert stock == 300


def test_her_first_day_is_not_a_loss(with_test_db):
    """The walk itself: stock bought, nothing sold yet."""
    async def scenario(db):
        import routers.ledger as ledger
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sri Lakshmi Traders", "currency": "INR"})
            await db.expenses.insert_many([
                {"id": "e1", "tenant_id": T, "title": "Groundnut oil", "amount": 86400,
                 "category": "Raw Material", "date": "2026-09-22", "created_at": "2026-09-22T00:00:00+00:00"},
            ])
            return await ledger.ledger_summary(user=OWNER)

    tot = with_test_db(scenario)["totals"]
    assert tot["net_profit"] == 0, "she has not lost Rs 86,400 by opening for business"
    assert tot["stock_spend"] == 86400, "and the money is still counted, as stock"
    assert tot["total_spend"] == 86400, "Spend is unchanged — this splits profit, not spend"
    assert tot["operating_spend"] == 0


def test_the_figures_still_add_up(with_test_db):
    async def scenario(db):
        import routers.ledger as ledger
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sri Lakshmi Traders", "currency": "INR"})
            await db.expenses.insert_many([
                {"id": "e1", "tenant_id": T, "amount": 86400, "category": "Raw Material",
                 "date": "2026-09-22", "created_at": "2026-09-22T00:00:00+00:00"},
                {"id": "e2", "tenant_id": T, "amount": 12000, "category": "Rent",
                 "date": "2026-09-22", "created_at": "2026-09-22T00:00:00+00:00"},
                {"id": "e3", "tenant_id": T, "amount": 40000, "category": "Asset Purchase",
                 "date": "2026-09-22", "created_at": "2026-09-22T00:00:00+00:00"},
            ])
            await db.invoices.insert_many([
                {"id": "i1", "tenant_id": T, "type": "sales_invoice", "amount": 120000,
                 "status": "unpaid", "created_at": "2026-09-23T00:00:00+00:00"},
            ])
            return await ledger.ledger_summary(user=OWNER)

    tot = with_test_db(scenario)["totals"]
    assert tot["operating_spend"] + tot["stock_spend"] + tot["capital_spend"] == tot["total_spend"]
    assert tot["net_profit"] == 120000 - 12000, "revenue minus the rent, which is what running it cost"


def test_a_real_loss_is_still_a_loss(with_test_db):
    async def scenario(db):
        import routers.ledger as ledger
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sri Lakshmi Traders", "currency": "INR"})
            await db.expenses.insert_many([
                {"id": "e1", "tenant_id": T, "amount": 50000, "category": "Salary & Wages",
                 "date": "2026-09-22", "created_at": "2026-09-22T00:00:00+00:00"},
            ])
            await db.invoices.insert_many([
                {"id": "i1", "tenant_id": T, "type": "sales_invoice", "amount": 10000,
                 "status": "unpaid", "created_at": "2026-09-23T00:00:00+00:00"},
            ])
            return await ledger.ledger_summary(user=OWNER)

    assert with_test_db(scenario)["totals"]["net_profit"] == -40000, \
        "paying wages out of nothing IS a loss, and must still read as one"

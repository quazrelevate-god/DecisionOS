"""One rule for a bill that buys a machine (JOURNEY-1 J7-07).

The same bill was booked two different ways depending on how it arrived. Typed
into Finance with the "Asset Purchase" category it became an expense AND a
tracked asset. Photographed and filed through the capture inbox it became the
ASSET ALONE -- so the money never appeared in what the company had spent.

Both routes go through routers.ledger.create_expense now. The ingestion route
hands it the asset's own name and category, so the AI's reading of the bill is
kept rather than re-guessed.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-onebill"
U = "u-sunita"


def test_a_typed_asset_bill_lands_in_both_books(with_test_db):
    async def scenario(db):
        from routers.ledger import create_expense
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Patil Engineering", "currency": "INR"})
            await create_expense(T, U, {
                "title": "Anand Machines — Bill 4471", "amount": 1800000,
                "category": "Asset Purchase", "vendor_name": "Anand Machines", "date": "2026-09-20",
            }, source="manual")
            return (await db.expenses.find({"tenant_id": T}, {"_id": 0}).to_list(10),
                    await db.assets.find({"tenant_id": T}, {"_id": 0}).to_list(10))

    expenses, assets = with_test_db(scenario)
    assert len(expenses) == 1 and len(assets) == 1
    assert expenses[0]["amount"] == 1800000
    assert assets[0]["expense_id"] == expenses[0]["id"], "the asset points at the bill that paid for it"


def test_the_same_bill_through_the_capture_inbox_lands_in_both_too(with_test_db):
    """The audit's case: a photographed bill used to leave no expense at all."""
    async def scenario(db):
        from services.ingestion import commit_ingestion_records
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Patil Engineering", "currency": "INR"})
            records = {"invoices": [{
                "type": "purchase_bill", "number": "4471", "contact_name": "Anand Machines",
                "date": "2026-09-20", "amount": 1800000, "currency": "INR",
                "purchase_type": "asset", "asset_name": "Press brake (second)",
                "asset_category": "Machinery",
                "line_items": [{"description": "Hydraulic press brake 100T"}],
            }], "payments": [], "expenses": [], "contacts": []}
            await commit_ingestion_records(T, U, records, "ing1", "capture")
            return (await db.expenses.find({"tenant_id": T}, {"_id": 0}).to_list(10),
                    await db.assets.find({"tenant_id": T}, {"_id": 0}).to_list(10))

    expenses, assets = with_test_db(scenario)
    assert len(expenses) == 1, "a photographed bill must reach the money, not only the asset register"
    assert len(assets) == 1, "and it is still a tracked asset"
    assert expenses[0]["amount"] == 1800000
    assert expenses[0]["category"] == "Asset Purchase"
    assert assets[0]["expense_id"] == expenses[0]["id"]
    assert assets[0]["name"] == "Press brake (second)", "the AI's reading of the bill is kept"
    assert assets[0]["category"] == "Machinery"


def test_an_ordinary_bill_is_still_only_an_expense(with_test_db):
    async def scenario(db):
        from routers.ledger import create_expense
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Patil Engineering", "currency": "INR"})
            await create_expense(T, U, {"title": "Electricity", "amount": 9400,
                                        "category": "Utilities", "date": "2026-09-20"}, source="manual")
            return await db.assets.find({"tenant_id": T}, {"_id": 0}).to_list(10)

    assert with_test_db(scenario) == [], "only an asset purchase makes an asset"

"""A supplier added in CRM can be picked in a finance form (PILOT-1 E, 2026-09-21).

The pilot client: "I have added Vendor, but not able to select when adding new
expense." The expense form's supplier was a plain text box that never read CRM,
so there was nothing to pick, and POST /expenses/with-file had no way to carry
the link even though create_expense stores a vendor_id.

Now the finance forms read a NARROW list of the company's CRM suppliers (and,
for income, buyers) behind Finance's own gate — a finance person without the
CRM (`people`) permission can pick a supplier without CRM being opened to them
— and the record keeps the link. A new name can still be typed.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-fin"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "role": "owner", "name": "Rajesh", "permissions": []}
# Finance access, and NOT the CRM permission.
ACCOUNTS = {"id": "u-acc", "tenant_id": TENANT, "role": "finance", "name": "Anita",
            "permissions": ["finance", "tasks"]}
SALES = {"id": "u-sales", "tenant_id": TENANT, "role": "sales", "name": "Priya",
         "permissions": ["people", "tasks"]}

CONTACTS = [
    {"id": "c-surat", "tenant_id": TENANT, "type": "vendor", "name": "Surat Spinners", "company": "Surat Spinners Pvt Ltd",
     "phone": "+919800000001", "email": "accounts@surat.test", "notes": "pays late"},
    {"id": "c-coim", "tenant_id": TENANT, "type": "vendor", "name": "Coimbatore Loom Works", "company": ""},
    {"id": "c-anand", "tenant_id": TENANT, "type": "customer", "name": "Anand Fabrics", "company": "Anand Fabrics"},
    {"id": "c-deal", "tenant_id": TENANT, "type": "dealer", "name": "Kumar Traders", "company": ""},
    {"id": "c-other", "tenant_id": "t-elsewhere", "type": "vendor", "name": "Someone Else's Supplier"},
]


async def _seed(db):
    await db.tenants.insert_one({"id": TENANT, "company_name": "Balaji Textiles", "currency": "INR"})
    await db.contacts.insert_many([dict(c) for c in CONTACTS])


def _run(with_test_db, fn):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            return await fn(db)

    return with_test_db(scenario)


# ------------------------------------------------------------- the picker list
def test_a_finance_person_without_crm_access_can_list_suppliers(with_test_db):
    async def fn(db):
        import routers.ledger as led
        return await led.list_parties(kind="vendor", q=None, limit=200, user=ACCOUNTS)
    rows = _run(with_test_db, fn)
    assert [r["name"] for r in rows] == ["Coimbatore Loom Works", "Surat Spinners"]


def test_the_list_is_narrow_not_the_crm_record(with_test_db):
    async def fn(db):
        import routers.ledger as led
        return await led.list_parties(kind="vendor", q=None, limit=200, user=ACCOUNTS)
    rows = _run(with_test_db, fn)
    assert all(set(r) == {"id", "name", "company", "type"} for r in rows), \
        "a picker gets a name to show, not phone numbers, emails or notes"


def test_customers_are_customers_and_dealers(with_test_db):
    async def fn(db):
        import routers.ledger as led
        return await led.list_parties(kind="customer", q=None, limit=200, user=ACCOUNTS)
    assert {r["name"] for r in _run(with_test_db, fn)} == {"Anand Fabrics", "Kumar Traders"}


def test_typing_narrows_the_list(with_test_db):
    async def fn(db):
        import routers.ledger as led
        return await led.list_parties(kind="vendor", q="sura", limit=200, user=ACCOUNTS)
    assert [r["name"] for r in _run(with_test_db, fn)] == ["Surat Spinners"]


def test_nobody_without_finance_access_gets_the_list(with_test_db):
    async def fn(db):
        import routers.ledger as led
        try:
            await led.require_ledger(user=SALES)
            return None
        except HTTPException as e:
            return e.status_code
    assert _run(with_test_db, fn) == 403


# --------------------------------------------------- the record keeps the link
def test_an_expense_keeps_the_supplier_it_was_picked_from(with_test_db):
    async def fn(db):
        import routers.ledger as led
        doc = await led.add_expense_with_file(
            title="Yarn for the Diwali run", amount="480000", vendor_name="Surat Spinners",
            category="", date="2026-09-20", status="unpaid", notes="", file=None,
            vendor_id="c-surat", user=ACCOUNTS)
        return await db.expenses.find_one({"id": doc["id"]}, {"_id": 0})
    row = _run(with_test_db, fn)
    assert row["vendor_id"] == "c-surat"
    assert row["vendor_name"] == "Surat Spinners"


def test_the_link_carries_the_crm_name(with_test_db):
    """The name on the record is the supplier's name in CRM, so a supplier's
    spend adds up under one name however it was typed in the box."""
    async def fn(db):
        import routers.ledger as led
        doc = await led.add_expense_with_file(
            title="Yarn", amount="1000", vendor_name="surat", category="", date="", status="unpaid",
            notes="", file=None, vendor_id="c-surat", user=ACCOUNTS)
        return doc["vendor_name"]
    assert _run(with_test_db, fn) == "Surat Spinners"


def test_a_new_name_can_still_be_typed(with_test_db):
    async def fn(db):
        import routers.ledger as led
        doc = await led.add_expense_with_file(
            title="Diesel", amount="3200", vendor_name="Highway Fuels", category="", date="", status="paid",
            notes="", file=None, vendor_id="", user=ACCOUNTS)
        return await db.expenses.find_one({"id": doc["id"]}, {"_id": 0})
    row = _run(with_test_db, fn)
    assert row["vendor_name"] == "Highway Fuels" and row["vendor_id"] is None


def test_a_supplier_from_another_company_is_refused(with_test_db):
    async def fn(db):
        import routers.ledger as led
        try:
            await led.add_expense_with_file(
                title="Yarn", amount="1000", vendor_name="", category="", date="", status="unpaid",
                notes="", file=None, vendor_id="c-other", user=ACCOUNTS)
            return None, await db.expenses.count_documents({})
        except HTTPException as e:
            return e.status_code, await db.expenses.count_documents({})
    code, stored = _run(with_test_db, fn)
    assert code == 400 and stored == 0


def test_a_customer_is_not_a_supplier(with_test_db):
    async def fn(db):
        import routers.ledger as led
        try:
            await led.add_expense_with_file(
                title="Yarn", amount="1000", vendor_name="", category="", date="", status="unpaid",
                notes="", file=None, vendor_id="c-anand", user=ACCOUNTS)
            return None
        except HTTPException as e:
            return e.status_code
    assert _run(with_test_db, fn) == 400


def test_an_asset_keeps_its_supplier(with_test_db):
    async def fn(db):
        import routers.ledger as led
        doc = await led.add_asset_with_file(
            name="Second-hand warping machine", purchase_amount="350000", vendor_name="", category="",
            purchase_date="", status="active", notes="", file=None, vendor_id="c-coim", user=ACCOUNTS)
        return await db.assets.find_one({"id": doc["id"]}, {"_id": 0})
    row = _run(with_test_db, fn)
    assert row["vendor_id"] == "c-coim" and row["vendor_name"] == "Coimbatore Loom Works"


def test_stock_keeps_its_supplier(with_test_db):
    async def fn(db):
        import routers.ledger as led
        doc = await led.add_inventory_with_file(
            item="Polyester yarn 40s", sku="", quantity="20", unit="cone", unit_cost="1800", category="",
            vendor_name="", notes="", file=None, vendor_id="c-surat", user=ACCOUNTS)
        return await db.inventory.find_one({"id": doc["id"]}, {"_id": 0})
    row = _run(with_test_db, fn)
    assert row["vendor_id"] == "c-surat" and row["vendor_name"] == "Surat Spinners"


def test_income_keeps_its_customer(with_test_db):
    async def fn(db):
        import routers.ledger as led
        doc = await led.add_revenue_with_file(
            title="Job work — lot 14", customer_name="", amount="60000", number="", date="", due_date="",
            status="unpaid", received="false", notes="", file=None, contact_id="c-anand", user=ACCOUNTS)
        return await db.invoices.find_one({"id": doc["id"]}, {"_id": 0})
    row = _run(with_test_db, fn)
    assert row["contact_id"] == "c-anand" and row["contact_name"] == "Anand Fabrics"


def test_a_supplier_is_not_a_customer(with_test_db):
    async def fn(db):
        import routers.ledger as led
        try:
            await led.add_revenue_with_file(
                title="Sale", customer_name="", amount="100", number="", date="", due_date="",
                status="unpaid", received="false", notes="", file=None, contact_id="c-surat", user=ACCOUNTS)
            return None
        except HTTPException as e:
            return e.status_code
    assert _run(with_test_db, fn) == 400

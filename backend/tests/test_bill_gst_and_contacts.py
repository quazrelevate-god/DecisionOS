"""GST on a read bill, and contacts that are what they say (audit 2026-10-08).

F-05  A yarn bill showed the supplier's GSTIN and CGST 2.5% + SGST 2.5%. Neither
      was captured, the supplier's GSTIN stayed empty, and the stock was costed
      at Rs 336/kg -- the price WITH GST, which a GST-registered company claims
      back as input credit.
C-05  The same buyer could be added twice with no word.
C-06  "ABC123" was accepted as a GSTIN.
"""
import asyncio
import os

import pytest
from fastapi import HTTPException

from services.ingestion import bill_gst
from shared.tax_id import tax_id_problem, clean_tax_id
from tests.fake_mongo import FakeDB


# ---- F-05: the split, and when it is credit ---------------------------------
YARN = {"type": "purchase_bill", "amount": 168000, "gstin": "33ABCDE1234F1Z5",
        "taxable_value": 160000, "cgst": 4000, "sgst": 4000, "tax_total": 8000}


def test_a_registered_buyer_gets_the_bills_gst_as_input_credit():
    g = bill_gst(YARN, buyer_registered=True)
    assert g["gstin"] == "33ABCDE1234F1Z5"
    assert (g["taxable_value"], g["cgst"], g["sgst"], g["tax_total"]) == (160000, 4000, 4000, 8000)
    assert g["input_tax_credit"] == 8000


def test_no_credit_without_our_gstin_or_theirs():
    assert bill_gst(YARN, buyer_registered=False)["input_tax_credit"] == 0
    assert bill_gst({**YARN, "gstin": ""}, buyer_registered=True)["input_tax_credit"] == 0


def test_a_split_that_does_not_add_up_is_not_trusted():
    g = bill_gst({**YARN, "taxable_value": 100000}, buyer_registered=True)   # 100000 + 8000 != 168000
    assert g["tax_total"] is None and g["input_tax_credit"] == 0
    assert g["gstin"] == "33ABCDE1234F1Z5", "the GSTIN is still kept"


def test_the_tax_total_is_worked_out_from_the_parts():
    g = bill_gst({"amount": 105000, "gstin": "27AAAAA0000A1Z5", "igst": 5000}, buyer_registered=True)
    assert g["tax_total"] == 5000 and g["taxable_value"] == 100000 and g["input_tax_credit"] == 5000


pytestmark_single = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)


@pytestmark_single
def test_the_yarn_bill_is_filed_with_its_gst(with_test_db):
    from tests.e2e_harness import e2e_env

    async def scenario(db):
        from services.ingestion import commit_ingestion_records
        with e2e_env(db):
            await db.tenants.insert_one({"id": "t-gst", "name": "Clickthrough Mills", "currency": "INR",
                                         "gst": "33AAACC1234D1Z9"})
            records = {"contacts": [{"type": "vendor", "name": "Surat Yarn Mills", "tax_id": "33ABCDE1234F1Z5"}],
                       "invoices": [{**YARN, "number": "Y-77", "contact_name": "Surat Yarn Mills",
                                     "date": "2026-10-05", "purchase_type": "inventory",
                                     "inventory_qty": 500, "inventory_unit": "kg",
                                     "line_items": [{"description": "Cotton yarn 40s", "gst_rate": 5}]}],
                       "payments": [], "tasks": []}
            await commit_ingestion_records("t-gst", "u1", records, "ing-gst", "upload")
            return (await db.invoices.find_one({"tenant_id": "t-gst"}, {"_id": 0}),
                    await db.contacts.find_one({"tenant_id": "t-gst"}, {"_id": 0}),
                    await db.inventory.find_one({"tenant_id": "t-gst"}, {"_id": 0}))

    bill, supplier, stock = with_test_db(scenario)
    assert bill["amount"] == 168000, "what we owe is still the whole bill"
    assert bill["input_tax_credit"] == 8000 and bill["cgst"] == 4000 and bill["sgst"] == 4000
    assert supplier["tax_id"] == "33ABCDE1234F1Z5", "the supplier's GSTIN reaches their record"
    assert stock["unit_cost"] == 320, "stock is costed without the GST we claim back (160000 / 500)"


# ---- C-06: what a tax id may be -----------------------------------------------
@pytest.mark.parametrize("v", ["33ABCDE1234F1Z5", "33abcde1234f1z5", "33 ABCDE 1234 F1Z5", "GB123456789", "DE811907980", ""])
def test_good_tax_ids(v):
    assert tax_id_problem(v) == ""


@pytest.mark.parametrize("v", ["ABC123", "33ABC", "99999999999999", "INX12345678", "45ABCDE1234F1Z5", "12"])
def test_bad_tax_ids(v):
    assert tax_id_problem(v), v


def test_tax_ids_are_stored_clean():
    assert clean_tax_id(" 33abcde-1234f1z5 ") == "33ABCDE1234F1Z5"


# ---- C-05 / C-06 through the contacts router -----------------------------------
class _User(dict):
    pass


@pytest.fixture
def contacts(monkeypatch):
    import routers.contacts as rc
    d = FakeDB()
    d.contacts.docs.append({"id": "c1", "tenant_id": "t1", "type": "customer", "name": "Northwind Apparel"})
    monkeypatch.setattr(rc, "db", d)

    async def _noop(*a, **k):
        return None

    async def _same(rows):
        return rows
    monkeypatch.setattr(rc, "log_activity", _noop)
    monkeypatch.setattr(rc, "enrich_contacts", _same)
    monkeypatch.setattr(rc, "_refuse_other_side", lambda *a, **k: None)
    return rc, d


USER = {"id": "u1", "tenant_id": "t1", "role": "owner"}


def test_a_second_buyer_by_the_same_name_is_caught(contacts):
    rc, d = contacts
    from models.contacts import ContactInput
    with pytest.raises(HTTPException) as e:
        asyncio.run(rc.create_contact(ContactInput(type="customer", name="  northwind   apparel "), USER))
    assert e.value.status_code == 409
    assert e.value.detail["code"] == "duplicate_contact" and e.value.detail["contact_id"] == "c1"
    # ...and "Add anyway" adds it (two firms can share a name)
    asyncio.run(rc.create_contact(ContactInput(type="customer", name="Northwind Apparel", allow_duplicate=True), USER))
    assert len([c for c in d.contacts.docs if c["name"] == "Northwind Apparel"]) == 2


def test_a_supplier_may_share_a_buyers_name(contacts):
    rc, d = contacts
    from models.contacts import ContactInput
    asyncio.run(rc.create_contact(ContactInput(type="vendor", name="Northwind Apparel"), USER))


def test_a_fake_gstin_is_refused(contacts):
    rc, _ = contacts
    from models.contacts import ContactInput
    with pytest.raises(HTTPException) as e:
        asyncio.run(rc.create_contact(ContactInput(type="customer", name="Fresh Co", tax_id="ABC123"), USER))
    assert e.value.status_code == 400 and "GSTIN" in e.value.detail

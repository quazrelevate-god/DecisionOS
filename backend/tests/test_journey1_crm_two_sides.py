"""CRM opens one side at a time (JOURNEY-1 J7-04 / J8-01, founder 24 Sep).

FIX-FUP-51 took "people" out of the base permissions because a supplier list
carries prices, terms and personal numbers, and every default role was being
handed it. That was right, and it also meant the salesperson could not add the
buyer she had just met and the accountant could not add the supplier whose bill
he was entering — the two lists those two people live in.

So CRM has two keys now: `crm_buyers` (customers and dealers) and
`crm_suppliers` (vendors). Sales starts with the first, Finance with the
second, a team that is both gets both. "people" stays and means both, so every
tenant and every role setting made before today keeps exactly what it had.
"""
import os

import pytest
from fastapi import HTTPException

from core.permissions import crm_types, may_see_contact, ROLE_DEFAULT_PERMS, _BASE_PERMS
from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-crm"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "permissions": []}
SALES = {"id": "u-priya", "tenant_id": T, "role": "sales", "permissions": ["inbox", "crm_buyers"], "permissions_custom": True}
FIN = {"id": "u-sunita", "tenant_id": T, "role": "finance", "permissions": ["inbox", "finance", "crm_suppliers"], "permissions_custom": True}
BOTH = {"id": "u-both", "tenant_id": T, "role": "sales_accounts",
        "permissions": ["inbox", "crm_buyers", "crm_suppliers"], "permissions_custom": True}
OLD = {"id": "u-old", "tenant_id": T, "role": "ops", "permissions": ["inbox", "people"], "permissions_custom": True}
NOBODY = {"id": "u-amit", "tenant_id": T, "role": "production", "permissions": ["inbox"], "permissions_custom": True}

CONTACTS = [
    {"id": "c1", "tenant_id": T, "type": "customer", "name": "Krishna Garments", "created_at": "2026-09-01T00:00:00+00:00"},
    {"id": "c2", "tenant_id": T, "type": "dealer", "name": "Mumbai Dealer", "created_at": "2026-09-02T00:00:00+00:00"},
    {"id": "c3", "tenant_id": T, "type": "vendor", "name": "Anand Mills", "created_at": "2026-09-03T00:00:00+00:00"},
]


def test_each_side_is_its_own_key():
    assert set(crm_types(SALES)) == {"customer", "dealer"}
    assert set(crm_types(FIN)) == {"vendor"}
    assert set(crm_types(BOTH)) == {"customer", "dealer", "vendor"}
    assert crm_types(NOBODY) == ()


def test_people_still_means_both_so_nothing_set_before_today_changes():
    assert set(crm_types(OLD)) == {"customer", "dealer", "vendor"}
    assert set(crm_types(OLD)) == set(crm_types(OWNER)), "an owner and a 'people' holder see the same CRM"


def test_holding_both_new_keys_is_the_same_as_holding_people():
    assert set(crm_types(BOTH)) == set(crm_types(OLD))


def test_the_roles_start_on_the_side_they_work_in():
    assert "crm_buyers" in ROLE_DEFAULT_PERMS["sales"]
    assert "crm_suppliers" not in ROLE_DEFAULT_PERMS["sales"], "Sales does not get suppliers by default"
    assert "crm_suppliers" in ROLE_DEFAULT_PERMS["finance"]
    assert "crm_buyers" not in ROLE_DEFAULT_PERMS["finance"]
    assert "people" not in ROLE_DEFAULT_PERMS["sales"] and "people" not in ROLE_DEFAULT_PERMS["finance"], \
        "FIX-FUP-51 stands: neither gets the whole of CRM by default"
    assert _BASE_PERMS <= ROLE_DEFAULT_PERMS["sales"]


def test_a_single_contact_is_judged_by_its_own_type():
    assert may_see_contact(SALES, "customer") and may_see_contact(SALES, "dealer")
    assert not may_see_contact(SALES, "vendor")
    assert may_see_contact(FIN, "vendor") and not may_see_contact(FIN, "customer")
    assert not may_see_contact(NOBODY, "customer")
    assert not may_see_contact(SALES, "something-we-do-not-know"), "an unplaceable contact is not shown"


def _list_as(with_test_db, who, **kw):
    async def scenario(db):
        import routers.contacts as contacts
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles"})
            await db.contacts.insert_many([dict(c) for c in CONTACTS])
            try:
                rows = await contacts.list_contacts(user=who, **kw)
                return {"ids": sorted(r["id"] for r in rows)}
            except HTTPException as e:
                return {"refused": e.status_code, "detail": e.detail}
    return with_test_db(scenario)


def test_the_list_answers_with_the_side_you_hold(with_test_db):
    assert _list_as(with_test_db, SALES, type=None, status=None, q=None)["ids"] == ["c1", "c2"]
    assert _list_as(with_test_db, FIN, type=None, status=None, q=None)["ids"] == ["c3"]
    assert _list_as(with_test_db, BOTH, type=None, status=None, q=None)["ids"] == ["c1", "c2", "c3"]
    assert _list_as(with_test_db, OLD, type=None, status=None, q=None)["ids"] == ["c1", "c2", "c3"]


def test_asking_for_the_other_side_by_name_is_refused_by_name(with_test_db):
    out = _list_as(with_test_db, SALES, type="vendor", status=None, q=None)
    assert out.get("refused") == 403 and "suppliers" in out["detail"], out
    out2 = _list_as(with_test_db, FIN, type="customer", status=None, q=None)
    assert out2.get("refused") == 403 and "customers" in out2["detail"], out2


def test_no_crm_at_all_is_still_refused(with_test_db):
    """The gate is a dependency, so it is asked for directly here — and the
    query underneath it answers with nothing either way, which is the second
    line of the same defence."""
    async def scenario(db):
        import routers.contacts as contacts
        with e2e_env(db):
            try:
                await contacts.require_crm(user=NOBODY)
                return None
            except HTTPException as e:
                return e.status_code
    assert with_test_db(scenario) == 403
    assert _list_as(with_test_db, NOBODY, type=None, status=None, q=None)["ids"] == []


def test_she_can_add_the_buyer_she_just_met_and_not_a_supplier(with_test_db):
    async def scenario(db):
        import routers.contacts as contacts
        from models.contacts import ContactInput
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles"})
            made = await contacts.create_contact(ContactInput(type="customer", name="New Buyer"), user=SALES)
            try:
                await contacts.create_contact(ContactInput(type="vendor", name="New Supplier"), user=SALES)
                refused = None
            except HTTPException as e:
                refused = e.status_code
            return made["name"], refused
    name, refused = with_test_db(scenario)
    assert name == "New Buyer", "this is the thing FIX-FUP-51 took away"
    assert refused == 403, "and the supplier list is still not hers"

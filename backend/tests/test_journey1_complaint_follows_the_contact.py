"""J14-05 — a salesperson can complain about her own customer.

The audit watched Deepa open Ashok Pumps on her phone, tap "Log complaint",
write "two brackets bent on the last lot", pick Serious, and press the button
the screen had given her. The server answered 403: logging a complaint asked for
`people`, which is access to BOTH sides of the address book, and a salesperson
holds `crm_buyers` only.

The rule that fits the job is the contact's own: you may complain about somebody
you are allowed to see. This pins all four corners of that — her own customer,
a supplier she may not see, an accounts person's supplier, and somebody with no
CRM access at all.
"""
from core.permissions import crm_types, may_see_contact

# No database and no module-level rebinding here, so these run in parallel with
# everything else — the skipif the db-backed journey tests carry is not needed.

SALES = {"id": "u-deepa", "role": "sales", "name": "Deepa",
         "permissions": ["inbox", "crm_buyers"], "permissions_custom": True}
ACCOUNTS = {"id": "u-suresh", "role": "finance", "name": "Suresh",
            "permissions": ["inbox", "finance", "crm_suppliers"], "permissions_custom": True}
PRODUCTION = {"id": "u-murugan", "role": "production", "name": "Murugan",
              "permissions": ["inbox", "tasks"], "permissions_custom": True}
OWNER = {"id": "u-raj", "role": "owner", "name": "Rajkumar", "permissions": []}


def test_sales_may_complain_about_her_own_customer():
    """The case the audit found. A customer is her side of the book."""
    assert may_see_contact(SALES, "customer") is True
    assert may_see_contact(SALES, "dealer") is True


def test_sales_may_not_complain_about_a_supplier():
    """The split still holds: widening who may complain must not widen who may
    see the supplier list."""
    assert may_see_contact(SALES, "vendor") is False


def test_accounts_may_complain_about_a_supplier_but_not_a_customer():
    assert may_see_contact(ACCOUNTS, "vendor") is True
    assert may_see_contact(ACCOUNTS, "customer") is False


def test_somebody_with_no_crm_may_not_complain_about_anybody():
    """Production has tasks and the Desk and nothing else — there is no contact
    they can see, so there is no complaint they can raise."""
    assert crm_types(PRODUCTION) == ()
    for kind in ("customer", "dealer", "vendor"):
        assert may_see_contact(PRODUCTION, kind) is False


def test_the_owner_may_complain_about_anybody():
    for kind in ("customer", "dealer", "vendor"):
        assert may_see_contact(OWNER, kind) is True


def test_an_unknown_contact_type_is_refused_rather_than_waved_through():
    """A contact we cannot place is not one we can safely act on — the same
    rule may_see_contact already applies to reading."""
    assert may_see_contact(OWNER, "something-new") is False
    assert may_see_contact(SALES, "") is False
    assert may_see_contact(SALES, None) is False

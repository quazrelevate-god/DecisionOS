"""A picker does not invite a duplicate (2026-10-03).

Proving the surfaces that had only been READ, not forced. Four of them
(DeskDexWell, WorkflowsTile, FinanceRecords, FinanceForms) hold no query at
all -- they take props, so they cannot tell this lie. ContactProfile and
ContactProfileMobile already handle `error || !data?.contact`.

ONE WAS REAL, AND IT IS THE MOST EXPENSIVE OF THE WHOLE SWEEP.

With /ledger/parties answering 500, the supplier picker on the expense form
showed no matches and a cheerful

    Add "E" as a supplier

while Erode Yarn Mills sat in the CRM, unmatched because the list had never
arrived. Verified in the browser, against that real contact. The founder is
mid-expense; they take the offer; the company now has two suppliers with one
name and a ledger split across them -- and nothing in the app ever said
anything went wrong.

Every other lie in this sweep cost a reader a wrong impression. This one
writes bad data, and the damage outlives the outage.

The popover also refused to open at all on error (`open && (rows.length > 0
|| isSuccess)`), so even a warning would have had nowhere to appear.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
PICKER = (FE / "components" / "karma" / "PartyPicker.jsx").read_text(encoding="utf-8")


def test_the_picker_says_its_list_never_arrived():
    assert "partiesQ.isError && !partiesQ.data && (" in PICKER
    assert "so this list is empty — it is not" in PICKER
    assert "Check the name before adding a new one." in PICKER


def test_the_warning_comes_before_the_offer_to_create_one():
    """Order is the point: the trap is the "add new" row, so the correction
    has to be above it."""
    warn = PICKER.index("partiesQ.isError && !partiesQ.data && (")
    empty = PICKER.index("shown.length === 0 && !offerNew")
    assert warn < empty


def test_the_popover_opens_when_the_lookup_failed():
    """It would not, so there was nowhere to say it."""
    assert "open={open && (rows.length > 0 || partiesQ.isSuccess || partiesQ.isError)}" in PICKER


def test_the_cheerful_empty_line_stands_down_on_error():
    """"No suppliers in CRM yet" is a fact about the company, not about the
    request."""
    assert "shown.length === 0 && !offerNew && !partiesQ.isError && (" in PICKER


def test_the_surfaces_with_no_query_are_recorded_as_such():
    """So the next census does not keep re-opening them: they take props."""
    for rel in ("pages/desk/DeskDexWell.jsx", "pages/desk/WorkflowsTile.jsx",
                "pages/finance/FinanceRecords.jsx", "pages/finance/FinanceForms.jsx"):
        assert "useQuery(" not in (FE / rel).read_text(encoding="utf-8"), rel


def test_the_mobile_profile_was_already_right():
    cpm = (FE / "pages" / "mobile" / "ContactProfileMobile.jsx").read_text(encoding="utf-8")
    assert "if (error || !data?.contact) {" in cpm


# ───────── and the page nobody could reach is gone ────────────────────────
def test_the_retired_contacts_page_is_deleted():
    """E2-01 retired /contacts to a redirect; the file stayed for a year with
    nothing importing it. It was not free: the role-label sweep in 28d4ac3
    counted one of its "six implementations" in a file nobody renders, so dead
    code had already cost a round of maintenance."""
    assert not (FE / "pages" / "Contacts.js").exists()


def test_nothing_referenced_it():
    needles = ('pages/Contacts"', "pages/Contacts'", "ContactsPanel")
    for f in list(FE.rglob("*.js")) + list(FE.rglob("*.jsx")):
        body = f.read_text(encoding="utf-8")
        for n in needles:
            assert n not in body, f"{f.name} still mentions {n}"


def test_the_route_still_lands_somewhere_sensible():
    """/contacts is a redirect, and /contacts/:id still opens a profile, so
    old links keep working."""
    app = (FE / "App.js").read_text(encoding="utf-8")
    assert '<Route path="/contacts" element={<Navigate to="/crm" replace />} />' in app
    assert 'path="/contacts/:id"' in app

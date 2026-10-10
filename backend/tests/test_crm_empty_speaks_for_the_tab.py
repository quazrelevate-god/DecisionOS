"""The CRM's empty card speaks for the tab, not the company (2026-09-29).

Found walking CRM at phone width, where the two sit in one glance: the tab
chips read

    Buyers 0 · Partners 0 · Suppliers 1

and three centimetres below, "No relationships yet — Add your first one from
the Add contact button". One supplier is on record; the card says nobody is.

The button underneath had it right all along ("Add your first buyer"). Only
the heading and the line above it were speaking for everybody, because the
card fires whenever the CURRENT list is empty and its words were written for
a brand-new workspace.
"""
from pathlib import Path

CRM = (Path(__file__).resolve().parents[2] / "frontend" / "src"
       / "pages" / "CRM.js").read_text(encoding="utf-8")


def test_it_knows_whether_anybody_is_on_record_at_all():
    assert "const anyContacts = SCOPES.some((sc) => sc.count > 0);" in CRM


def test_an_empty_tab_in_a_company_that_has_contacts_says_so():
    assert "`No ${scopeLabel.toLowerCase()} yet`" in CRM
    assert "Your other lists have people in them — this one is empty." in CRM


def test_a_genuinely_new_workspace_still_gets_the_welcome():
    """"No relationships yet" is right exactly once — when it is true."""
    assert 't("crm.empty_title")' in CRM
    assert 't("crm.empty_hint_manage", {' in CRM   # audit C-08: in the company's words
    i_any = CRM.index("anyContacts ? `No ${scopeLabel.toLowerCase()} yet`")
    i_all = CRM.index(': t("crm.empty_title")')
    assert i_any < i_all, "the tab case is decided first, the whole-CRM case is the fallback"


def test_searching_still_wins_over_both():
    """A filter that matches nothing is neither an empty tab nor an empty
    company, and it already had its own words."""
    i_filter = CRM.index('{filtering ? "No matches"')
    i_any = CRM.index("anyContacts ? `No ${scopeLabel.toLowerCase()} yet`")
    assert i_filter < i_any


def test_the_card_can_be_found_by_a_test_that_reads_it():
    assert 'data-testid="crm-empty-title"' in CRM

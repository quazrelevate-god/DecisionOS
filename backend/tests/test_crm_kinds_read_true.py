"""The CRM's three kinds, checked on screen (2026-09-27).

J15 gave each kind its own door, its own tab and no way to switch what a
contact is. Walking it in the browser afterwards found four things the change
had not finished, and one older one it sat next to:

  1. Delete asked through window.confirm — which some browsers and embed
     contexts answer with a silent false and no dialog. Pressing Delete did
     nothing at all. It is the third time this has been paid for here (FUP-49
     on My Work's Complete, ASK-2 on the workflow card's delete).
  2. "Dealer" was renamed to "Partner" in pages/CRM.js's own constant, so the
     CRM page said Partner while the contact's own page — which reads the
     shared map in lib/format — still said Dealer about the same company.
  3. Adding a partner from its own door left the list on the Buyers tab, which
     on a new workspace still read "No relationships yet": the toast said it
     had worked and the screen said nothing was there.
  4. "New partner" sat in the menu beside "New Buyer" and "New Supplier".
  5. A complaint was asked as Minor / Serious / Urgent and read back as its
     stored value, so ticking "Serious" showed a chip saying "medium".
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _read(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


# ─────────────────── 1. the confirm is the app's own ───────────────────────
def test_deleting_a_contact_asks_in_the_app_not_the_browser():
    src = _read("pages", "CRM.js")
    # The CALL, not the word: the comment above the handler explains why it went.
    assert "window.confirm(" not in src, (
        "window.confirm can return false with no UI — the click reads as a dead button"
    )
    assert 'data-testid="crm-contact-delete-confirm"' in src
    assert "AlertDialogAction" in src and 'data-testid="crm-contact-delete-confirm-action"' in src
    assert "api.delete(`/contacts/${contact.id}`)" in src, "and it still calls the endpoint"


def test_the_app_has_no_browser_confirm_left_in_the_crm_or_the_contact_page():
    for where in (("pages", "CRM.js"), ("pages", "ContactProfile.js"), ("components", "crm", "LogComplaintDialog.jsx")):
        assert "window.confirm(" not in _read(*where), where


# ─────────────────── 2. one word, one place ────────────────────────────────
def test_partner_is_the_word_everywhere_and_dealer_is_still_the_value():
    fmt = _read("lib", "format.js")
    assert 'dealer: "Partner"' in fmt, "the map every screen reads"
    assert 'dealer: "Dealer"' not in fmt
    # The stored value is untouched: renaming it is a migration, not a word.
    crm = _read("pages", "CRM.js")
    assert 'PARTNER_TYPES = ["dealer"]' in crm


def test_the_contact_page_takes_its_kind_from_that_map():
    src = _read("pages", "ContactProfile.js")
    assert "typeLabel(c.type)" in src
    assert 'from "../lib/format"' in src


# ─────────────────── 3. you see what you just added ────────────────────────
def test_adding_a_contact_shows_the_tab_it_landed_on():
    src = _read("pages", "CRM.js")
    assert "const scopeForType" in src
    assert "setScope(scopeForType(adding))" in src, "the list follows what was added"


# ─────────────────── 4. the menu reads as one list ─────────────────────────
def test_the_three_doors_are_named_alike():
    src = _read("pages", "CRM.js")
    assert "`New ${PARTNER_LABEL}`" in src
    assert "PARTNER_LABEL.toLowerCase()" not in src.split("const scopeForType")[0], "not lower-cased in the menu"


# ─────────────────── 5. asked and read back in one word ────────────────────
def test_a_complaint_reads_back_in_the_words_it_was_asked_in():
    dlg = _read("components", "crm", "LogComplaintDialog.jsx")
    assert "export const severityLabel" in dlg
    assert '{ key: "medium", label: "Serious" }' in dlg
    for where in (("pages", "CRM.js"), ("pages", "ContactProfile.js")):
        src = _read(*where)
        assert "severityLabel(cp.severity)" in src, where
        assert "{cp.severity}" not in src.replace("severityLabel(cp.severity)", ""), where

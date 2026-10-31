"""Everything links to CRM, the follow-through (Epic 11 Sprint 12 polish,
2026-10-31; docs/CRM_LINKS_PLAN.md).

Sprint 12 linked the work; this makes the link visible and usable everywhere the
work is seen:

  · a task finished from the phone's card, the bulk bar or the status picker
    asks for the customer's phone and GST, as the drawer's slider already did;
  · task cards, workflow cards and calendar meetings wear the party chip, with
    the record's own kind, so a supplier is never called a customer;
  · CRM's edit window can clear "Details needed" without a phone number;
  · every party window is the app's glass sheet (a bottom sheet on a phone),
    with the glass dropdown and the design system's checkbox, never the OS's.
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tests.test_everything_links_to_crm import OWNER, T, _env, _seed

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return (FE.joinpath(*parts)).read_text(encoding="utf-8")


# ═══════════════════════ the chip's data, where the work is listed ══════════
def test_a_workflow_card_carries_its_party_with_the_records_kind(with_test_db):
    async def scenario(db):
        import routers.workflows as rw
        await _seed(db)
        base = {"tenant_id": T, "type": "distribution", "stage": "new", "stages": ["new", "done"],
                "created_at": "2026-10-31T09:00:00+00:00", "history": []}
        await db.workflows.insert_one({**base, "id": "wf-linked", "title": "Yarn order",
                                       "counterparty": "Gujarat Cotton Mills", "contact_id": "c-gcm"})
        await db.workflows.insert_one({**base, "id": "wf-text", "title": "Walk-in order",
                                       "counterparty": "Someone at the gate", "contact_id": None})
        with _env(db):
            return {w["id"]: w for w in await rw.list_workflows(type=None, with_tasks=False, user=OWNER)}
    cards = with_test_db(scenario)
    chip = cards["wf-linked"]["contact_summary"]
    assert chip["id"] == "c-gcm" and chip["name"] == "Gujarat Cotton Mills"
    assert chip["kind"] == "supplier", "a vendor is a supplier on the chip, never 'Customer'"
    assert cards["wf-text"]["contact_summary"] is None, "a party only typed as text stays text"
    assert cards["wf-text"]["counterparty"] == "Someone at the gate"


def test_a_meeting_on_the_calendar_says_who_it_is_with(with_test_db):
    today = datetime.now(timezone.utc).date().isoformat()

    async def scenario(db):
        import routers.calendar as rcal
        await _seed(db)
        await db.contacts.update_one({"id": "c-kexp"}, {"$set": {"needs_details": True}})
        await db.calendar_events.insert_one({"id": "ev-1", "tenant_id": T, "date": today, "title": "Visit Kumar Exports",
                                             "when_text": "Friday", "contact_id": "c-kexp", "contact_name": "Kumar Exports"})
        await db.calendar_events.insert_one({"id": "ev-2", "tenant_id": T, "date": today, "title": "Team review",
                                             "when_text": "", "contact_id": None})
        with _env(db):
            return await rcal.business_calendar(days=45, user=OWNER)
    out = with_test_db(scenario)
    evs = {e["entity_id"]: e for d in out["days"] for e in d["events"] if e["type"] == "meeting"}
    assert evs["ev-1"]["party"] == {"id": "c-kexp", "name": "Kumar Exports", "type": "customer",
                                    "kind": "customer", "needs_details": True}
    assert evs["ev-1"]["contact_id"] is None, "the row is about the meeting; the chip is the way to the customer"
    assert evs["ev-2"]["party"] is None


def test_details_are_complete_clears_the_flag_without_a_phone(with_test_db):
    async def scenario(db):
        import routers.contacts as rc
        from models.contacts import ContactUpdateInput
        await _seed(db)
        await db.contacts.insert_one({"id": "c-walkin", "tenant_id": T, "name": "Walk-in buyer", "type": "customer",
                                      "phone": "", "notes": "keep me", "needs_details": True,
                                      "created_at": "2026-10-31T09:00:00+00:00"})
        with _env(db):
            await rc.update_contact("c-walkin", ContactUpdateInput(needs_details=False), user=OWNER)
            listed = await rc.parties_needing_details(user=OWNER)
        return await db.contacts.find_one({"id": "c-walkin"}, {"_id": 0}), listed
    row, listed = with_test_db(scenario)
    assert row["needs_details"] is False and row["phone"] == "" and row["notes"] == "keep me", \
        "only the flag changes"
    assert all(i["name"] != "Walk-in buyer" for i in listed["items"])


# ═══════════════════════ the screens ════════════════════════════════════════
def test_finishing_from_the_card_the_bulk_bar_or_the_status_asks_for_details():
    deck = _fe("pages", "mywork", "WorkDeck.jsx")
    assert 'if (body.status === "done" && data?.status === "done") askPartyDetails(t);' in deck
    mw = _fe("pages", "MyWork.js")
    # The bulk bar asks once, for the first finished task whose party needs details.
    assert "const done = await Promise.all(targets.map((tk) => api.patch(`/tasks/${tk.id}`, { status: \"done\" })));" in mw
    assert 'const ask = targets.find((tk, i) => done[i]?.data?.status === "done" && tk.contact_summary?.needs_details);' in mw
    assert 'if (status === "done" && data?.status === "done") askPartyDetails(t);' in mw


def test_cards_and_rows_wear_the_party_chip():
    deck = _fe("pages", "mywork", "WorkDeck.jsx")
    assert "<PartyChip party={t.contact_summary} testid={`deck-party-${t.id}`}" in deck
    assert "compact />" in deck, "a card's meta line wears the compact chip"
    assert "testid={`task-card-party-${t.id}`}" in _fe("pages", "MyWork.js")
    assert "<PartyChip party={w.contact_summary} testid={`wf-card-party-${w.id}`} compact />" in _fe("pages", "Workflows.js")
    assert "<PartyChip party={e.party} testid={`cal-event-party-${e.type}-${i}`} />" in _fe("pages", "Calendar.js")


def test_crm_can_say_the_details_are_complete():
    crm = _fe("pages", "CRM.js")
    assert "await api.patch(`/contacts/${contact.id}`, { needs_details: false });" in crm
    assert 'data-testid="crm-contact-details-complete"' in crm


def test_every_party_window_is_the_glass_sheet_with_the_apps_own_controls():
    party = FE / "components" / "party"
    for name in ("PartyDialog.jsx", "OpenPartiesDialog.jsx", "PartyDetailsPrompt.jsx", "LinkSuggestionsDialog.jsx"):
        src = (party / name).read_text(encoding="utf-8")
        assert "<PartySheet" in src, name
        assert "DialogContent" not in src, f"{name} draws its own dialog"
    for f in party.glob("*.jsx"):
        src = f.read_text(encoding="utf-8")
        assert "<select" not in src, f"{f.name}: a native dropdown"
        assert 'type="checkbox"' not in src, f"{f.name}: a native checkbox"
    sheet = (party / "PartySheet.jsx").read_text(encoding="utf-8")
    assert "max-lg:bottom-0" in sheet and "max-lg:top-auto" in sheet, "a bottom sheet on a phone"
    assert "pb-[max(1rem,var(--sa-bottom))]" in sheet, "its last row clears the home indicator"
    assert "GLASS_SHEET" in sheet
    assert "<GlassSelect" in (party / "PartyPicker.jsx").read_text(encoding="utf-8")
    assert "<DesignCheckbox" in (party / "LinkSuggestionsDialog.jsx").read_text(encoding="utf-8")

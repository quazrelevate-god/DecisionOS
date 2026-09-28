"""The pulse watches what two people look at together (2026-09-28).

J14-03 built one small question the open screens ask every 20 seconds — "has
anything I care about moved?" — and it watched four things: tasks, leaves,
decisions and notifications.

An audit of every write in the app (Yokesh, 2026-09-28) found the gap was not
in the writes. A person's own action refreshes their screen almost everywhere.
What nothing told them about was somebody ELSE's change to the three kinds two
people genuinely look at at the same time:

  * the WORKFLOW BOARD — a card moved by a colleague stayed where it was until
    the tab was refocused, which is the very case this mechanism exists for;
  * CONTACTS — added, renamed or deleted by whoever is on the phone;
  * COMPLAINTS — resolving one changes a red count carried by the CRM card,
    the contact's page and the Desk.

The signature is "how many, and the newest stamp", so a change in place is
only seen if the write stamps a time. A resolve writes `resolved_at`; a
contact's edit wrote nothing at all until this change, so renaming one looked
to every other screen exactly like nothing happening.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-pulse"
OTHER = "t-somebody-else"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}


async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Nila"})
    await db.users.insert_one({"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"})
    await db.workflows.insert_one({
        "id": "wf1", "tenant_id": T, "type": "orders", "title": "Bluewave", "stage": "inquiry",
        "stages": ["inquiry", "sampling", "shipped"], "stage_version": 0, "history": [],
        "created_at": "2026-09-28T04:00:00+00:00", "updated_at": "2026-09-28T04:00:00+00:00"})
    await db.contacts.insert_one({
        "id": "c1", "tenant_id": T, "type": "customer", "name": "Bluewave Apparel",
        "created_at": "2026-09-28T04:00:00+00:00"})
    await db.complaints.insert_one({
        "id": "cp1", "tenant_id": T, "customer_id": "c1", "text": "Short shipment",
        "status": "open", "severity": "medium", "created_at": "2026-09-28T04:00:00+00:00"})


def _env(fn):
    async def run(db):
        with e2e_env(db):
            await _seed(db)
            return await fn(db)
    return run


async def _pulse():
    import routers.pulse as p
    return await p.pulse(user=OWNER)


# ───────────────────────── the three are watched at all ────────────────────
def test_the_pulse_answers_for_the_shared_screens_too(with_test_db):
    async def scenario(db):
        return await _pulse()

    now = with_test_db(_env(scenario))
    for kind in ("tasks", "leaves", "decisions", "notifications", "workflows", "contacts", "complaints"):
        assert kind in now, kind
        assert now[kind] != "", f"{kind} answered nothing at all"


# ───────────────────────── a card somebody else moved ──────────────────────
def test_moving_a_card_moves_the_workflow_signature(with_test_db):
    """The case the whole mechanism exists for."""
    async def scenario(db):
        before = await _pulse()
        await db.workflows.update_one({"id": "wf1"}, {"$set": {
            "stage": "sampling", "updated_at": "2026-09-28T06:00:00+00:00"}})
        after = await _pulse()
        return before, after

    before, after = with_test_db(_env(scenario))
    assert after["workflows"] != before["workflows"]
    assert after["contacts"] == before["contacts"], "and nothing else is refetched for no reason"
    assert after["tasks"] == before["tasks"]


def test_a_new_card_and_a_deleted_one_both_show(with_test_db):
    async def scenario(db):
        first = await _pulse()
        await db.workflows.insert_one({"id": "wf2", "tenant_id": T, "type": "orders", "title": "Second",
                                       "stage": "inquiry", "stages": ["inquiry"], "created_at": "2026-09-28T07:00:00+00:00"})
        added = await _pulse()
        await db.workflows.delete_one({"id": "wf2"})
        removed = await _pulse()
        return first, added, removed

    first, added, removed = with_test_db(_env(scenario))
    assert added["workflows"] != first["workflows"], "a card created"
    assert removed["workflows"] != added["workflows"], "and a card deleted — the count carries it"


# ───────────────────────── contacts, including a rename ────────────────────
def test_adding_and_deleting_a_contact_shows(with_test_db):
    async def scenario(db):
        before = await _pulse()
        await db.contacts.insert_one({"id": "c2", "tenant_id": T, "type": "vendor", "name": "Erode Yarn",
                                      "created_at": "2026-09-28T07:00:00+00:00"})
        added = await _pulse()
        await db.contacts.delete_one({"id": "c2"})
        gone = await _pulse()
        return before, added, gone

    before, added, gone = with_test_db(_env(scenario))
    assert added["contacts"] != before["contacts"]
    assert gone["contacts"] != added["contacts"]


def test_renaming_a_contact_shows_because_the_edit_is_stamped(with_test_db):
    """The rename went through the router, which now writes `updated_at`.
    Without that stamp the signature is unchanged and every other screen keeps
    the old name until its tab is refocused."""
    async def scenario(db):
        import routers.contacts as rc
        from models.contacts import ContactUpdateInput
        before = await _pulse()
        await rc.update_contact("c1", ContactUpdateInput(name="Bluewave Apparel UK"), user=OWNER)
        after = await _pulse()
        row = await db.contacts.find_one({"id": "c1"}, {"_id": 0})
        return before, after, row

    before, after, row = with_test_db(_env(scenario))
    assert row["name"] == "Bluewave Apparel UK"
    assert row.get("updated_at"), "the edit stamps a time"
    assert after["contacts"] != before["contacts"], "so the other screens learn about it"


# ───────────────────────── a resolved complaint ────────────────────────────
def test_resolving_a_complaint_shows(with_test_db):
    async def scenario(db):
        import routers.complaints as rc
        before = await _pulse()
        await rc.resolve_complaint("cp1", user=OWNER)
        after = await _pulse()
        return before, after

    before, after = with_test_db(_env(scenario))
    assert after["complaints"] != before["complaints"], "resolve writes resolved_at, which is watched"


# ───────────────────────── one workspace cannot see another ────────────────
def test_another_workspace_moving_changes_nothing_here(with_test_db):
    async def scenario(db):
        before = await _pulse()
        await db.workflows.insert_one({"id": "wfX", "tenant_id": OTHER, "type": "orders", "title": "Theirs",
                                       "stage": "inquiry", "stages": ["inquiry"], "created_at": "2026-09-28T08:00:00+00:00"})
        await db.contacts.insert_one({"id": "cX", "tenant_id": OTHER, "type": "customer", "name": "Theirs",
                                      "created_at": "2026-09-28T08:00:00+00:00"})
        after = await _pulse()
        return before, after

    before, after = with_test_db(_env(scenario))
    assert after == before, "the signature is per workspace"


# ───────────────────────── the screens each kind refreshes ─────────────────
def test_the_client_refreshes_the_lists_each_kind_appears_on():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[2] / "frontend" / "src"
           / "hooks" / "usePulse.js").read_text(encoding="utf-8")
    # The board, its counts and the Desk's tile all read the same move.
    assert '["workflows"], ["workflow"], ["workflows-counts"], ["desk"]' in src
    # A contact's name is carried by the CRM list, its own page and finance.
    assert '["contacts"], ["crm-contacts"], ["contact-profile"], ["ledger-parties"]' in src
    # A red count lives on the card, the page and the Desk.
    assert '["complaints"], ["complaints-open"], ["contact-profile"], ["crm-contacts"], ["desk"]' in src

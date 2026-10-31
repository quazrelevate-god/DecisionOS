"""Everything links to CRM (Epic 11 Sprint 12, docs/CRM_LINKS_PLAN.md, founder
2026-10-31).

Decisions, tasks, meetings and workflow cards named the companies a business
deals with and carried none of their CRM records: Tracole had 647 tasks naming a
customer or supplier and not one linked, and the customer's page found its work
by searching titles for the name ("Ravi Traders" picked up the employee Ravi).

THE RULE these tests hold: Dex proposes, the person decides. The matcher never
creates; approval (or a person adding one by hand) is the only way a record is
made, once, marked Needs details; every guess can be changed before approving;
and old data is only ever suggested, never changed behind anyone's back.
"""
import os

import pytest
from fastapi import BackgroundTasks, HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-crm"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
DOER = {"id": "u-doer", "tenant_id": T, "role": "sales", "name": "Priya Nair", "permissions": ["tasks"],
        "permissions_custom": True}
SELLER = {"id": "u-seller", "tenant_id": T, "role": "sales", "name": "Arun", "permissions_custom": True,
          "permissions": ["tasks", "crm_buyers"]}
ACCOUNTS = {"id": "u-acc", "tenant_id": T, "role": "finance", "name": "Meena", "permissions_custom": True,
            "permissions": ["tasks", "finance"]}
STRANGER = {"id": "u-x", "tenant_id": T, "role": "production", "name": "Ravi", "permissions": ["tasks"],
            "permissions_custom": True}

CONTACTS = [
    {"id": "c-toyota", "name": "Toyota Kirloskar Pvt Ltd", "type": "customer"},
    {"id": "c-kexp", "name": "Kumar Exports", "type": "customer"},
    {"id": "c-ktex", "name": "Kumar Textiles", "type": "vendor"},
    {"id": "c-ravi", "name": "Ravi Traders", "type": "customer"},
    {"id": "c-mk", "name": "MK Associates", "type": "customer"},
    {"id": "c-gcm", "name": "Gujarat Cotton Mills", "type": "vendor"},
]


def _quiet(*a, **k):
    return None


async def _quiet_async(*a, **k):
    return None


async def _roles(tenant_id, *a, **k):
    return ["owner", "sales", "finance", "production"]


STUBS = {"services.notifications.push_notification": _quiet_async,
         "services.auto_plan.schedule": _quiet,
         "routers.tasks.tenant_role_keys": _roles}


def _env(db):
    return e2e_env(db, stubs=STUBS, keep={"core.add_decision_event"})


async def _seed(db):
    await db.tenants.insert_one({"id": T, "company_name": "Sharma Fabrics", "roles": [
        {"key": "sales", "label": "Sales"}, {"key": "finance", "label": "Finance"},
        {"key": "production", "label": "Production"}]})
    for p in (OWNER, DOER, SELLER, ACCOUNTS, STRANGER):
        await db.users.insert_one({"id": p["id"], "tenant_id": T, "role": p["role"], "name": p["name"],
                                   "reporting_manager_id": None if p is OWNER else "u-owner",
                                   "email": f"{p['id']}@t.test"})
        await db.memberships.insert_one({"id": f"m-{p['id']}", "tenant_id": T, "user_id": p["id"],
                                         "role": p["role"], "status": "active"})
    for c in CONTACTS:
        await db.contacts.insert_one({**c, "tenant_id": T, "phone": "", "created_at": "2026-10-01T00:00:00+00:00"})


async def _refused(coro, status):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


def _book():
    from services.parties import Book
    return Book([dict(c) for c in CONTACTS], [{"name": "Ravi Kumar"}, {"name": "Priya Nair"}], "Sharma Fabrics")


# ═══════════════════════ 1 · who is this? ════════════════════════════════════
@pytest.mark.parametrize("said, kind, status, expect", [
    ("Toyota", None, "linked", "Toyota Kirloskar Pvt Ltd"),                     # a short name
    ("toyota kirloskar private limited", None, "linked", "Toyota Kirloskar Pvt Ltd"),   # Pvt / Ltd / case
    ("M/s Kumar Exports", None, "linked", "Kumar Exports"),
    ("Kumar Exprts", None, "linked", "Kumar Exports"),                         # a misspelling, one plainly closest
    ("Kumar", None, "choose", ["Kumar Exports", "Kumar Textiles"]),            # two could be: the person picks
    ("Kumar", "supplier", "linked", "Kumar Textiles"),                         # ...unless the kind settles it
    ("Ravi", None, "none", "team"),                                            # one of the team
    ("Ravi Traders", None, "linked", "Ravi Traders"),                          # ...is not the firm
    ("the exporters", None, "none", "generic"),                                # words that name no firm
    ("Sharma Fabrics", None, "none", "own_company"),                           # ourselves
    ("Nippon Audiotronix", "customer", "new", "customer"),                     # nobody in CRM yet
])
def test_the_matcher_answers_and_never_guesses(said, kind, status, expect):
    ans = _book().find(said, kind)
    assert ans["status"] == status, ans
    if status == "linked":
        assert ans["contact_name"] == expect
    elif status == "choose":
        assert sorted(c["name"] for c in ans["candidates"]) == expect
    elif status == "none":
        assert ans["reason"] == expect
    else:
        assert ans["kind"] == expect


def test_one_firm_on_both_sides_is_linked_and_said_so():
    ans = _book().find("Gujarat Cotton Mills", "customer")
    assert ans["status"] == "linked" and ans["contact_id"] == "c-gcm"
    assert ans["kind_differs"] is True, "the chip says it is in CRM as a supplier; no second record"


def test_a_sentence_names_firms_only_by_their_whole_name():
    bk = _book()
    assert {c["id"] for c in bk.scan("Call MK Associates about the Ravi Traders order")} == {"c-ravi", "c-mk"}
    assert bk.scan("Tell Ravi to sweep the godown") == [], "an employee's name is never a firm"
    assert bk.scan("Send the exporters their samples") == []


# ═══════════════════════ 2 · Dex names the party ═════════════════════════════
def test_the_proposal_carries_each_items_party(with_test_db):
    async def scenario(db):
        from services.voice import build_proposal
        await _seed(db)
        with _env(db):
            return await build_proposal(T, {
                "tasks": [
                    {"title": "Send the quote", "assignee_name": "Priya", "party": "Toyota", "party_kind": "customer"},
                    {"title": "Chase payment", "assignee_name": "Priya", "party": "Kumar"},
                    {"title": "Call about samples", "assignee_name": "Priya", "party": "Nippon Audiotronix",
                     "party_kind": "prospect", "party_person": "Sajith"},
                    {"title": "Pack the Ravi Traders order", "assignee_name": "Priya"},
                    {"title": "Tell Ravi to sweep", "assignee_name": "Priya"},
                ],
                "meeting_events": [{"title": "Meet MK Associates", "when": "tomorrow", "party": "MK Associates"}],
            }, ["owner", "sales"], [{"id": DOER["id"], "name": "Priya Nair", "role": "sales"}], set(), [])
    p = with_test_db(scenario)
    t = {x["title"]: x["party"] for x in p["tasks"]}
    assert t["Send the quote"]["status"] == "linked" and t["Send the quote"]["contact_id"] == "c-toyota"
    assert t["Chase payment"]["status"] == "choose", "Which Kumar? is asked, not guessed"
    new = t["Call about samples"]
    assert (new["status"], new["kind"], new["person"]) == ("new", "prospect", "Sajith")
    assert t["Pack the Ravi Traders order"]["contact_id"] == "c-ravi", "the task's own words, when Dex named nobody"
    assert t["Tell Ravi to sweep"] is None
    assert p["meetings"][0]["party"]["contact_id"] == "c-mk"


# ═══════════════════════ 3 · the review decides ══════════════════════════════
def _party(said, status="new", kind="customer", **extra):
    return {"said": said, "status": status, "kind": kind, **extra}


def _decision(tasks, meetings=()):
    return {"id": "dec-1", "tenant_id": T, "title": "Kumar and Nippon", "status": "pending_approval",
            "created_by": OWNER["id"], "source": "voice", "task_ids": [], "created_at": "2026-10-31T08:00:00+00:00",
            "proposal": {"tasks": tasks, "workflows": [], "meetings": list(meetings), "reminders": [],
                         "memory_notes": []}}


def _task(key, title, party):
    return {"key": key, "title": title, "assignee_id": DOER["id"], "assignee_role": "sales",
            "priority": "medium", "due_date": "2026-11-05", "party": party}


def test_the_reviewer_can_change_every_guess(with_test_db):
    async def scenario(db):
        from services.decision_flow import edit_proposal_party as edit
        await _seed(db)
        several = {"said": "Kumar Exports, Ravi Traders", "status": "several", "kind": None, "several": [
            {"id": "c-kexp", "name": "Kumar Exports", "kind": "customer", "type": "customer"},
            {"id": "c-ravi", "name": "Ravi Traders", "kind": "customer", "type": "customer"}]}
        await db.decisions.insert_one(_decision([
            _task("k1", "Chase payment", _party("Kumar", "choose", None)),
            _task("k2", "Send statement", _party("Kumar", "choose", None)),
            _task("k3", "Call about samples", _party("Nippon Audiotronix")),
            _task("k4", "Fix the AC at the office", _party("Kumar Textiles", "linked", "supplier",
                                                           contact_id="c-ktex", contact_name="Kumar Textiles")),
            _task("k5", "Collect from both", several),
            _task("k6", "Visit them", _party("Ravi Traders Erode")),
        ]))
        with _env(db):
            out = {}
            d = await edit(OWNER, "dec-1", "tasks", "k1", "link", contact_id="c-kexp")
            out["link"] = {t["key"]: t["party"] for t in d["proposal"]["tasks"]}
            d = await edit(OWNER, "dec-1", "tasks", "k3", "kind", kind="dealer")
            d = await edit(OWNER, "dec-1", "tasks", "k3", "person", person="Sajith")
            out["k3"] = next(t["party"] for t in d["proposal"]["tasks"] if t["key"] == "k3")
            d = await edit(OWNER, "dec-1", "tasks", "k4", "none")
            out["k4"] = next(t["party"] for t in d["proposal"]["tasks"] if t["key"] == "k4")
            d = await edit(OWNER, "dec-1", "tasks", "k6", "new", name="Ravi Traders")
            out["k6"] = next(t["party"] for t in d["proposal"]["tasks"] if t["key"] == "k6")
            d = await edit(OWNER, "dec-1", "tasks", "k5", "split")
            out["split"] = [(t["title"], t["party"]["contact_id"]) for t in d["proposal"]["tasks"]
                            if t["title"].startswith("Collect from both")]
            out["kind_on_linked"] = await _refused(edit(OWNER, "dec-1", "tasks", "k1", "kind", kind="dealer"), 400)
            out["stranger"] = await _refused(edit(STRANGER, "dec-1", "tasks", "k1", "none"), 403)
            out["contacts"] = await db.contacts.count_documents({"tenant_id": T})
            out["timeline"] = "\n".join(e.get("label") or "" for e in
                                        (await db.decisions.find_one({"id": "dec-1"})).get("timeline") or [])
        return out
    out = with_test_db(scenario)
    assert out["link"]["k1"]["contact_id"] == "c-kexp"
    assert out["link"]["k2"]["contact_id"] == "c-kexp", "Which Kumar? answered once answers it on every task"
    assert (out["k3"]["status"], out["k3"]["kind"], out["k3"]["person"]) == ("new", "dealer", "Sajith")
    assert out["k4"]["status"] == "none", "not a customer or supplier"
    assert out["k6"]["status"] == "linked" and out["k6"]["contact_id"] == "c-ravi", \
        "adding a name already in CRM links that record instead of making a twin"
    assert out["split"] == [("Collect from both — Kumar Exports", "c-kexp"), ("Collect from both — Ravi Traders", "c-ravi")]
    assert "change it there" in out["kind_on_linked"]
    assert out["contacts"] == len(CONTACTS), "the review writes nothing to CRM"
    assert "linked to Kumar Exports (2 items)" in out["timeline"]


def test_approval_links_everything_and_adds_a_new_party_once(with_test_db):
    async def scenario(db):
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        new = _party("Nippon Audiotronix", person="Sajith")
        await db.decisions.insert_one(_decision([
            _task("k1", "Call about samples", dict(new)),
            _task("k2", "Send the catalogue", _party("nippon audiotronix")),     # the same party, said again
            _task("k3", "Send the quote", _party("Toyota", "linked", contact_id="c-toyota",
                                                 contact_name="Toyota Kirloskar Pvt Ltd")),
            _task("k4", "Chase payment", _party("Kumar", "choose", None)),       # left open
        ], meetings=[{"key": "m1", "title": "Meet Nippon", "when": "tomorrow", "date": "2026-11-01",
                      "party": _party("Nippon Audiotronix")}]))
        with _env(db):
            await approve_decision_flow(OWNER, "dec-1")
            made = await db.contacts.find({"tenant_id": T, "needs_details": True}, {"_id": 0}).to_list(10)
            tasks = {t["title"]: t for t in await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(20)}
            meeting = await db.calendar_events.find_one({"tenant_id": T}, {"_id": 0})
            dec = await db.decisions.find_one({"id": "dec-1"}, {"_id": 0})
        return made, tasks, meeting, dec
    made, tasks, meeting, dec = with_test_db(scenario)
    assert len(made) == 1, "one record for one party, however many items name it"
    nip = made[0]
    assert nip["name"] == "Nippon Audiotronix" and nip["type"] == "customer"
    assert nip["made_from"] == {"kind": "decision", "id": "dec-1"}
    assert [p["name"] for p in nip["contact_people"]] == ["Sajith"], "the person named there is saved with it"
    assert tasks["Call about samples"]["contact_id"] == tasks["Send the catalogue"]["contact_id"] == nip["id"]
    assert tasks["Send the quote"]["contact_id"] == "c-toyota"
    assert not tasks["Chase payment"].get("contact_id"), "an open question is left for the old-data review"
    assert meeting["contact_id"] == nip["id"]
    assert set(dec["contact_ids"]) == {nip["id"], "c-toyota"}
    assert any("Added to CRM — details needed: Nippon Audiotronix" in (e.get("label") or "")
               for e in dec.get("timeline") or [])


def test_a_rejected_decision_adds_nothing_to_crm(with_test_db):
    async def scenario(db):
        from services.decision_flow import reject_decision_flow
        await _seed(db)
        await db.decisions.insert_one(_decision([_task("k1", "Call about samples", _party("Nippon Audiotronix"))]))
        with _env(db):
            await reject_decision_flow(OWNER, "dec-1")
            return await db.contacts.count_documents({"tenant_id": T})
    assert with_test_db(scenario) == len(CONTACTS)


def test_the_open_questions_are_listed_before_approving(with_test_db):
    async def scenario(db):
        from services.enrich import enrich_decision
        await _seed(db)
        await db.decisions.insert_one(_decision([
            _task("k1", "Chase payment", _party("Kumar", "choose", None)),
            _task("k2", "Call about samples", _party("Nippon Audiotronix"))]))
        with _env(db):
            d = await db.decisions.find_one({"id": "dec-1"}, {"_id": 0})
            return await enrich_decision(d, tenant_id=T)
    d = with_test_db(scenario)
    assert [(q["key"], q["party"]["status"]) for q in d["open_parties"]] == [("k1", "choose")]


# ═══════════════════════ 4 · manual work, the drawer, Needs details ═══════════
def _create(**kw):
    from models.tasks import TaskCreateInput
    return TaskCreateInput(**{"title": "Send samples", "assignee_id": DOER["id"], "due_date": "2026-11-05", **kw})


def test_new_task_links_a_party_or_adds_one_found_again_next_time(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        await _seed(db)
        with _env(db):
            a = await rt.create_task(_create(contact_id="c-toyota"), BackgroundTasks(), user=OWNER)
            b = await rt.create_task(_create(contact_new={"name": "Nippon Audiotronix", "kind": "dealer"}),
                                     BackgroundTasks(), user=OWNER)
            c = await rt.create_task(_create(contact_new={"name": "Nippon Audiotronix Pvt Ltd", "kind": "dealer"}),
                                     BackgroundTasks(), user=OWNER)
            gone = await _refused(rt.create_task(_create(contact_id="c-nope"), BackgroundTasks(), user=OWNER), 400)
            rows = await db.contacts.find({"tenant_id": T, "needs_details": True}, {"_id": 0}).to_list(10)
        return a, b, c, gone, rows
    a, b, c, gone, rows = with_test_db(scenario)
    assert (a["contact_id"], a["contact_name"]) == ("c-toyota", "Toyota Kirloskar Pvt Ltd")
    assert len(rows) == 1 and rows[0]["type"] == "dealer" and rows[0]["made_from"] == {"kind": "task"}
    assert b["contact_id"] == c["contact_id"] == rows[0]["id"], "the second time it is found, not made again"
    assert "isn't in CRM" in gone


def test_the_drawer_changes_the_party_only_for_people_with_a_say(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskUpdateInput
        await _seed(db)
        await db.tasks.insert_one({"id": "tk-1", "tenant_id": T, "title": "Send samples", "assignee_id": DOER["id"],
                                   "assignee_role": "sales", "priority": "medium", "status": "todo",
                                   "due_date": "2026-11-05", "created_by": OWNER["id"], "source": "manual",
                                   "created_at": "2026-10-31T09:00:00+00:00"})
        with _env(db):
            refused = await _refused(rt.update_task("tk-1", TaskUpdateInput(
                contact_new={"name": "Someone New Ltd"}), user=STRANGER), 403)
            after_refusal = await db.contacts.count_documents({"tenant_id": T})
            await rt.update_task("tk-1", TaskUpdateInput(contact_id="c-mk"), user=DOER)
            linked = await db.tasks.find_one({"id": "tk-1"}, {"_id": 0})
            await rt.update_task("tk-1", TaskUpdateInput(contact_id=""), user=DOER)
            cleared = await db.tasks.find_one({"id": "tk-1"}, {"_id": 0})
        return refused, after_refusal, linked, cleared
    refused, after_refusal, linked, cleared = with_test_db(scenario)
    assert after_refusal == len(CONTACTS), "refused before a record is made"
    assert (linked["contact_id"], linked["contact_name"]) == ("c-mk", "MK Associates")
    assert not cleared["contact_id"], "\"\" = not about a customer or supplier any more"


def test_the_doer_fills_in_the_details_when_the_task_is_done(with_test_db):
    async def scenario(db):
        import routers.tasks as rt
        from models.tasks import TaskPartyDetailsInput as Fill
        await _seed(db)
        await db.contacts.insert_one({"id": "c-new", "tenant_id": T, "name": "Nippon Audiotronix", "type": "customer",
                                      "phone": "", "address": "Plot 4, SIPCOT", "needs_details": True})
        for tid, cid in (("tk-1", "c-new"), ("tk-2", "c-toyota")):
            await db.tasks.insert_one({"id": tid, "tenant_id": T, "title": "Send samples", "assignee_id": DOER["id"],
                                       "assignee_role": "sales", "status": "done", "created_by": OWNER["id"],
                                       "contact_id": cid, "created_at": "2026-10-31T09:00:00+00:00"})
        with _env(db):
            out = await rt.fill_task_party_details("tk-1", Fill(phone=" 98400 12345 ", tax_id="33abcde1234f1z5",
                                                                address="Somewhere else"), user=DOER)
            row = await db.contacts.find_one({"id": "c-new"}, {"_id": 0})
            already = await _refused(rt.fill_task_party_details("tk-2", Fill(phone="1"), user=DOER), 409)
            stranger = await _refused(rt.fill_task_party_details("tk-1", Fill(phone="1"), user=STRANGER), 403)
        return out, row, already, stranger
    out, row, already, stranger = with_test_db(scenario)
    assert out["needs_details"] is False and row["needs_details"] is False, "a phone number is enough"
    assert (row["phone"], row["tax_id"]) == ("98400 12345", "33ABCDE1234F1Z5")
    assert row["address"] == "Plot 4, SIPCOT", "what somebody already wrote is never overwritten"


def test_saving_a_phone_in_crm_clears_needs_details_and_the_list_shows_the_rest(with_test_db):
    async def scenario(db):
        import routers.contacts as rc
        from models.contacts import ContactUpdateInput
        await _seed(db)
        for cid, name, typ in (("c-n1", "Nippon Audiotronix", "customer"), ("c-n2", "Sree Bobbins", "vendor")):
            await db.contacts.insert_one({"id": cid, "tenant_id": T, "name": name, "type": typ, "phone": "",
                                          "needs_details": True, "created_at": "2026-10-31T09:00:00+00:00"})
        with _env(db):
            seller_sees = await rc.parties_needing_details(user=SELLER)
            await rc.update_contact("c-n1", ContactUpdateInput(phone="9840012345"), user=OWNER)
            owner_sees = await rc.parties_needing_details(user=OWNER)
            filtered = await rc.list_contacts(needs_details=True, user=OWNER)
        return seller_sees, owner_sees, filtered
    seller_sees, owner_sees, filtered = with_test_db(scenario)
    assert [i["name"] for i in seller_sees["items"]] == ["Nippon Audiotronix"], "only the side of CRM they hold"
    assert owner_sees["count"] == 1 and owner_sees["items"][0]["name"] == "Sree Bobbins"
    assert [c["name"] for c in filtered] == ["Sree Bobbins"]


def test_anyone_who_makes_work_can_find_a_party_by_name_but_sees_nothing_more(with_test_db):
    async def scenario(db):
        import routers.contacts as rc
        await _seed(db)
        await db.contacts.update_one({"id": "c-toyota"}, {"$set": {"phone": "9840000000"}})
        with _env(db):
            return await rc.search_parties(q="toyota", user=DOER), await rc.search_parties(q="Kumar", user=DOER)
    toyota, kumar = with_test_db(scenario)
    assert [r["name"] for r in toyota["results"]][:1] == ["Toyota Kirloskar Pvt Ltd"]
    assert all("phone" not in r for r in toyota["results"])
    assert {r["name"] for r in kumar["results"]} >= {"Kumar Exports", "Kumar Textiles"}


# ═══════════════════════ 5 · the customer's page reads links ════════════════
def test_the_page_reads_links_and_keeps_money_with_finance(with_test_db):
    async def scenario(db):
        import routers.finance as fin
        await _seed(db)
        await db.tasks.insert_many([
            {"id": "tk-1", "tenant_id": T, "title": "Pack the order", "contact_id": "c-ravi", "status": "todo",
             "created_at": "2026-10-31T09:00:00+00:00"},
            {"id": "tk-2", "tenant_id": T, "title": "Ravi Traders call", "status": "todo",     # names, not linked
             "created_at": "2026-10-31T09:00:00+00:00"},
            {"id": "tk-3", "tenant_id": T, "title": "Tell Ravi to sweep", "status": "todo",
             "created_at": "2026-10-31T09:00:00+00:00"}])
        await db.decisions.insert_one({"id": "d-1", "tenant_id": T, "title": "Ravi Traders terms",
                                       "contact_ids": ["c-ravi"], "created_at": "2026-10-31T09:00:00+00:00"})
        await db.calendar_events.insert_one({"id": "m-1", "tenant_id": T, "title": "Meet them", "date": "2026-11-01",
                                             "contact_id": "c-ravi"})
        await db.invoices.insert_one({"id": "i-1", "tenant_id": T, "contact_id": "c-ravi", "amount": 5000,
                                      "amount_paid": 0, "currency": "INR", "created_at": "2026-10-30T00:00:00+00:00"})
        with _env(db):
            crm = await fin.contact_profile("c-ravi", SELLER)
            money = await fin.contact_profile("c-ravi", ACCOUNTS)
            nope = await _refused(fin.contact_profile("c-ravi", STRANGER), 403)
            supplier = await _refused(fin.contact_profile("c-ktex", SELLER), 403)
        return crm, money, nope, supplier
    crm, money, nope, supplier = with_test_db(scenario)
    assert [t["id"] for t in crm["tasks"]] == ["tk-1"], "links, not a search of titles"
    assert [d["id"] for d in crm["decisions"]] == ["d-1"] and [m["id"] for m in crm["meetings"]] == ["m-1"]
    assert crm["money"] is False and crm["invoices"] == [] and crm["summary"]["total_billed"] == 0
    assert money["money"] is True and [i["id"] for i in money["invoices"]] == ["i-1"]


# ═══════════════════════ 6 · old data: a review list ═════════════════════════
def test_old_work_is_suggested_and_linked_only_when_approved(with_test_db):
    async def scenario(db):
        import routers.crm as crm
        from models.crm import LinkSuggestionsInput
        await _seed(db)
        rows = [("tk-1", "Send Ravi Traders the quote"), ("tk-2", "Tell Ravi to sweep"),
                ("tk-3", "Call MK Associates and Ravi Traders"), ("tk-4", "Chase Kumar Textiles for the yarn")]
        for tid, title in rows:
            await db.tasks.insert_one({"id": tid, "tenant_id": T, "title": title, "status": "todo",
                                       "created_at": "2026-10-20T09:00:00+00:00"})
        await db.workflows.insert_one({"id": "w-1", "tenant_id": T, "title": "Order", "counterparty": "Toyota",
                                       "stage": "new", "contact_id": None})
        with _env(db):
            before = await crm.link_suggestions(user=OWNER)
            seller = await crm.link_suggestions(user=SELLER)
            untouched = await db.tasks.count_documents({"tenant_id": T, "contact_id": {"$nin": [None, ""]}})
            # tk-1 is linked by hand meanwhile; the review must not replace it
            await db.tasks.update_one({"id": "tk-1"}, {"$set": {"contact_id": "c-mk"}})
            out = await crm.apply_link_suggestions(LinkSuggestionsInput(links=[
                {"kind": "task", "id": "tk-1", "contact_id": "c-ravi"},
                {"kind": "task", "id": "tk-4", "contact_id": "c-ktex"},
                {"kind": "workflow", "id": "w-1", "contact_id": "c-toyota"}]), user=OWNER)
            after = {t["id"]: t.get("contact_id") for t in await db.tasks.find({"tenant_id": T}, {"_id": 0}).to_list(10)}
            wf = await db.workflows.find_one({"id": "w-1"}, {"_id": 0})
        return before, seller, untouched, out, after, wf
    before, seller, untouched, out, after, wf = with_test_db(scenario)
    got = {g["contact"]["name"]: sorted(i["id"] for i in g["items"]) for g in before["groups"]}
    assert got == {"Ravi Traders": ["tk-1"], "Kumar Textiles": ["tk-4"], "Toyota Kirloskar Pvt Ltd": ["w-1"]}, \
        "one whole name -> suggested; an employee's name or two firms -> not"
    assert {g["contact"]["name"] for g in seller["groups"]} == {"Ravi Traders", "Toyota Kirloskar Pvt Ltd"}, \
        "only the side of CRM they hold"
    assert untouched == 0, "suggesting changes nothing"
    assert out["linked"] == {"task": 1, "decision": 0, "workflow": 1}
    assert after["tk-1"] == "c-mk", "a link made meanwhile is never replaced"
    assert after["tk-4"] == "c-ktex" and wf["contact_id"] == "c-toyota"

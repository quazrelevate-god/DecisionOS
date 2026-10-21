"""Requests (2026-10-21, docs/REQUESTS_PLAN.md).

An employee raises a request with one or many items and sends it to their
reporting manager (the default) or the owner. Approval books an expense in
Finance; Finance marks it paid (or buys the items into stock) and the request
is done. What is worth pinning down:

  * the ROUTING — manager by default, owner on request, owner when there is no
    manager (and the request says so), an owner's own request recorded;
  * the ACCESS — the requester, the approver (or their delegate), the owner,
    and Finance only once there is something to pay; everyone else gets 404;
  * the MONEY — approval books exactly one expense even when two people press
    Approve together, paying it closes the request, deleting it unlinks;
  * the ASK-BACK — a question, an answer, a withdrawal, a rejection with a
    reason — each told to the person on the other side.

Pure unit tests — fake Mongo, no live DB, no server, no network.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from fastapi import HTTPException

import routers.files as files_rt
import routers.ledger as ledger
import routers.staff_requests as rt
import services.finance_words as finance_words
import services.staff_requests as svc
from models.finance import ExpensePatch
from models.staff_requests import RequestCreateInput, RequestFulfilInput, RequestNoteInput
from tests.fake_mongo import FakeDB

_LOOP = asyncio.new_event_loop()


def run(coro):
    return _LOOP.run_until_complete(coro)


T = "t-req"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya"}
MANAGER = {"id": "u-mgr", "tenant_id": T, "role": "operations", "name": "Ravi"}
STAFF = {"id": "u-staff", "tenant_id": T, "role": "sales", "name": "Meena", "reporting_manager_id": "u-mgr"}
LONER = {"id": "u-loner", "tenant_id": T, "role": "sales", "name": "Arun"}
FIN = {"id": "u-fin", "tenant_id": T, "role": "finance", "name": "Priya"}
OUTSIDER = {"id": "u-out", "tenant_id": T, "role": "sales", "name": "Deepa"}
PEOPLE = (OWNER, MANAGER, STAFF, LONER, FIN, OUTSIDER)


@pytest.fixture
def env(monkeypatch):
    db = FakeDB()
    for mod in (svc, rt, ledger, finance_words, files_rt):
        monkeypatch.setattr(mod, "db", db)
    sent = []

    async def push(tenant_id, user_ids, level, message, entity_type=None, entity_id=None,
                   ntype=None, title=None, sender=None, **_):
        sent.append({"to": sorted(user_ids), "type": ntype, "msg": message, "entity_id": entity_id})

    async def noop(*a, **k):
        return None

    for mod in (svc, rt):
        monkeypatch.setattr(mod, "push_notification", push)
        monkeypatch.setattr(mod, "log_activity", noop)

    async def seed():
        await db.tenants.insert_one({"id": T, "name": "Nila Textiles", "currency": "INR"})
        await db.tenants.insert_one({"id": "t-other", "name": "Elsewhere", "currency": "INR"})
        for p in PEOPLE:
            await db.users.insert_one(dict(p))
    run(seed())
    return db, sent


def _new(kind="purchase", items=None, **kw):
    items = items if items is not None else [
        {"name": "Cement", "quantity": 20, "unit": "bags", "amount": 8000},
        {"name": "Sand", "quantity": 2, "unit": "loads", "amount": 4000},
    ]
    return RequestCreateInput(type=kind, items=items, **kw)


def _raise(user=STAFF, **kw):
    return run(rt.create_request(_new(**kw), user=user))


def _note(text=""):
    return RequestNoteInput(note=text)


def _code(coro):
    with pytest.raises(HTTPException) as e:
        run(coro)
    return e.value.status_code


# ───────────────────────── the words ─────────────────────────
def test_money_reads_the_indian_way():
    assert svc.money_words(123456) == "₹1,23,456"
    assert svc.money_words(1000) == "₹1,000"
    assert svc.money_words(12345678) == "₹1,23,45,678"
    assert svc.money_words(None) == "₹0"


def test_blank_rows_are_dropped_and_bad_numbers_refused():
    rows = svc.clean_items([{"name": "  "}, {"name": "Gloves", "quantity": "4.0", "amount": "120"}])
    assert rows == [{"name": "Gloves", "quantity": 4, "unit": "", "amount": 120.0}]
    with pytest.raises(HTTPException):
        svc.clean_items([{"name": "Gloves", "amount": -1}])
    with pytest.raises(HTTPException):
        svc.clean_items([{"name": "Gloves", "quantity": "lots"}])


def test_the_title_defaults_to_what_is_asked_for():
    assert svc.default_title([{"name": "Cement"}]) == "Cement"
    assert svc.default_title([{"name": "Cement"}, {"name": "Sand"}, {"name": "Steel"}]) == "Cement and 2 more"


# ───────────────────────── routing ─────────────────────────
def test_the_form_offers_the_manager_first(env):
    opts = run(rt.request_approver_options(user=STAFF))
    assert opts["default"] == "manager"
    assert opts["manager"]["id"] == "u-mgr" and opts["owner"]["id"] == "u-owner"
    assert {t["key"] for t in opts["types"]} == set(svc.REQUEST_TYPES)
    assert run(rt.request_approver_options(user=LONER))["default"] == "owner"
    assert run(rt.request_approver_options(user=OWNER))["self_owner"] is True


def test_a_request_goes_to_the_reporting_manager_by_default(env):
    db, sent = env
    r = _raise()
    assert r["status"] == "pending" and r["number"] == "REQ-0001"
    assert r["approver_id"] == "u-mgr" and r["approver_kind"] == "manager"
    assert r["total"] == 12000 and r["title"] == "Cement and 1 more"
    assert r["can"] == {"decide": False, "respond": False, "withdraw": True, "fulfil": False}
    assert sent[-1]["to"] == ["u-mgr"] and sent[-1]["type"] == "approval"
    assert "₹12,000" in sent[-1]["msg"]


def test_the_requester_can_send_it_to_the_owner_instead(env):
    r = _raise(approver_choice="owner")
    assert r["approver_id"] == "u-owner" and r["approver_kind"] == "owner"


def test_no_manager_means_the_owner_and_the_request_says_why(env):
    r = _raise(user=LONER)
    assert r["approver_id"] == "u-owner"
    assert any(h["action"] == "routed" for h in r["history"])


def test_numbers_count_up_per_company(env):
    assert _raise()["number"] == "REQ-0001"
    assert _raise()["number"] == "REQ-0002"
    other = {"id": "u-x", "tenant_id": "t-other", "role": "owner", "name": "X"}
    run(env[0].users.insert_one(dict(other)))
    assert run(rt.create_request(_new(), user=other))["number"] == "REQ-0001"


def test_what_a_request_must_say(env):
    assert _raise(kind="general", items=[{"name": "A quieter desk"}])["status"] == "pending"
    assert _code(rt.create_request(_new(items=[{"name": "Cement"}]), user=STAFF)) == 400   # no amount
    assert _code(rt.create_request(_new(items=[]), user=STAFF)) == 400
    assert _code(rt.create_request(_new(kind="yacht"), user=STAFF)) == 400
    assert _code(rt.create_request(_new(needed_by="next week"), user=STAFF)) == 400


def test_an_owners_own_request_is_recorded_and_booked(env):
    db, sent = env
    r = _raise(user=OWNER)
    assert r["status"] == "approved" and r["expense_id"]
    assert not any(s["type"] == "approval" for s in sent)
    assert any(s["to"] == ["u-fin"] for s in sent), "Finance hears there is something to pay"


# ───────────────────────── access ─────────────────────────
def test_nobody_else_can_see_it(env):
    r = _raise()
    assert _code(rt.get_request(r["id"], user=OUTSIDER)) == 404
    assert _code(rt.approve_request(r["id"], _note(), user=OUTSIDER)) == 404
    # Finance sees it only once there is something to pay.
    assert _code(rt.get_request(r["id"], user=FIN)) == 404
    run(rt.approve_request(r["id"], _note(), user=MANAGER))
    assert run(rt.get_request(r["id"], user=FIN))["can"]["fulfil"] is True


def test_you_cannot_approve_your_own_request(env):
    r = _raise()
    assert _code(rt.approve_request(r["id"], _note(), user=STAFF)) == 403


def test_the_owner_may_decide_any_pending_request(env):
    r = _raise()
    assert run(rt.approve_request(r["id"], _note(), user=OWNER))["status"] == "approved"


def test_a_delegate_decides_for_the_approver(env):
    r = _raise()
    cover = {**OUTSIDER, "_acting_for": ["u-mgr"]}
    assert run(rt.get_request(r["id"], user=cover))["can"]["decide"] is True
    assert run(rt.approve_request(r["id"], _note(), user=cover))["decided_by"] == "u-out"


def test_each_list_shows_only_its_own_rows(env):
    mine = _raise()
    _raise(user=LONER)                                         # goes to the owner
    assert [r["id"] for r in run(rt.list_requests(view="mine", user=STAFF))] == [mine["id"]]
    assert [r["id"] for r in run(rt.list_requests(view="approvals", user=MANAGER))] == [mine["id"]]
    assert len(run(rt.list_requests(view="approvals", user=OWNER))) == 2
    assert len(run(rt.list_requests(view="all", user=OWNER))) == 2
    # "all" is the owner's; anyone else asking for it gets their own.
    assert [r["id"] for r in run(rt.list_requests(view="all", user=STAFF))] == [mine["id"]]
    assert run(rt.list_requests(view="fulfil", user=FIN)) == []
    run(rt.approve_request(mine["id"], _note(), user=MANAGER))
    assert [r["id"] for r in run(rt.list_requests(view="fulfil", user=FIN))] == [mine["id"]]


# ───────────────────────── the money ─────────────────────────
def test_approval_books_one_expense_linked_to_the_request(env):
    db, sent = env
    r = _raise()
    done = run(rt.approve_request(r["id"], _note("Go ahead"), user=MANAGER))
    assert done["status"] == "approved" and done["decision_note"] == "Go ahead"
    exp = run(db.expenses.find_one({"id": done["expense_id"]}))
    assert exp["request_id"] == r["id"] and exp["amount"] == 12000 and exp["status"] == "unpaid"
    assert exp["title"].startswith("REQ-0001 ·") and exp["category"] == "Raw Material"
    assert exp["source"] == "request"
    told = {s["type"]: s["to"] for s in sent[1:]}
    assert told["approved"] == ["u-staff"]
    assert told["assigned"] == ["u-fin", "u-owner"], "Finance and the owner, not the approver"


def test_two_approvals_at_once_make_one_expense(env, monkeypatch):
    db, _ = env
    r = _raise()
    stale = run(rt._load(r["id"], MANAGER))                    # read while still pending
    run(rt.approve_request(r["id"], _note(), user=OWNER))

    async def stale_load(rid, user):
        return dict(stale)
    monkeypatch.setattr(rt, "_load", stale_load)
    assert _code(rt.approve_request(r["id"], _note(), user=MANAGER)) == 409
    assert run(db.expenses.count_documents({"request_id": r["id"]})) == 1


def test_the_category_is_found_in_the_companys_own_words():
    textile = ["Raw Materials", "Machine Maintenance", "Freight & Logistics", "Labour Wages", "Other"]
    assert svc.pick_category("purchase", textile) == "Raw Materials"
    assert svc.pick_category("repair", textile) == "Machine Maintenance"
    # Staff travel is not freight: no category that says travel, so the hint
    # goes on to create_expense's own snap-or-guess.
    assert svc.pick_category("travel", textile) == "Logistics & Freight"
    assert svc.pick_category("purchase", list(finance_words.EXPENSE_CATEGORIES)) == "Raw Material"
    assert svc.pick_category("general", textile) == ""


def test_approval_books_into_a_company_category(env):
    db, _ = env
    run(db.tenants.update_one({"id": T}, {"$set": {"finance_categories": {
        "expense": ["Raw Materials", "Machine Maintenance", "Other"], "asset": ["Other"]}}}))
    done = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    assert run(db.expenses.find_one({"id": done["expense_id"]}))["category"] == "Raw Materials"
    assert done["expense_category"] == "Raw Materials"


def test_a_failed_booking_keeps_the_yes(env, monkeypatch):
    async def broken(*a, **k):
        raise RuntimeError("ledger down")
    monkeypatch.setattr(ledger, "create_expense", broken)
    r = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    assert r["status"] == "approved" and not r["expense_id"] and "Finance" in r["expense_error"]


def test_equipment_lands_on_the_asset_register(env):
    db, _ = env
    r = _raise(kind="equipment", items=[{"name": "Laptop", "quantity": 1, "amount": 55000}])
    run(rt.approve_request(r["id"], _note(), user=MANAGER))
    asset = run(db.assets.find_one({"name": "Laptop"}))
    assert asset and asset["purchase_amount"] == 55000


def test_a_reimbursement_is_paid_to_the_person_who_spent(env):
    db, _ = env
    r = _raise(kind="reimbursement", items=[{"name": "Auto to the client", "amount": 340}])
    done = run(rt.approve_request(r["id"], _note(), user=MANAGER))
    assert run(db.expenses.find_one({"id": done["expense_id"]}))["vendor_name"] == "Meena"


def test_fulfilling_pays_the_expense_and_stocks_the_items(env):
    db, sent = env
    r = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    assert _code(rt.fulfil_request(r["id"], RequestFulfilInput(), user=MANAGER)) in (403, 404)
    done = run(rt.fulfil_request(r["id"], RequestFulfilInput(note="Bought at Ganesh Traders", add_to_stock=True), user=FIN))
    assert done["status"] == "fulfilled" and len(done["stock_item_ids"]) == 2
    assert run(db.expenses.find_one({"id": r["expense_id"]}))["status"] == "paid"
    cement = run(db.inventory.find_one({"item": "Cement"}))
    assert cement["quantity"] == 20 and cement["unit_cost"] == 400 and cement["unit"] == "bags"
    assert sent[-1]["to"] == ["u-staff"] and sent[-1]["type"] == "status"
    assert _code(rt.fulfil_request(r["id"], RequestFulfilInput(), user=FIN)) == 409


def test_only_an_approved_request_can_be_fulfilled(env):
    r = _raise()
    assert _code(rt.fulfil_request(r["id"], RequestFulfilInput(), user=OWNER)) == 409


def test_paying_the_expense_in_finance_closes_the_request(env):
    db, sent = env
    r = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    run(ledger.update_expense(r["expense_id"], ExpensePatch(status="paid"), user=FIN))
    after = run(rt.get_request(r["id"], user=STAFF))
    assert after["status"] == "fulfilled" and after["fulfilled_by"] == "u-fin"
    assert sent[-1]["to"] == ["u-staff"]


def test_deleting_the_expense_unlinks_the_request(env):
    r = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    run(ledger.delete_expense(r["expense_id"], user=FIN))
    after = run(rt.get_request(r["id"], user=STAFF))
    assert after["expense_id"] is None and "deleted" in after["expense_error"]


# ───────────────────────── a general request is not about money ─────────────
def test_a_general_request_is_a_yes_and_nothing_else(env):
    """Yokesh 2026-10-21: General is not financial — approval closes it."""
    db, sent = env
    r = _raise(kind="general", items=[{"name": "Van on Saturday for the expo", "amount": 900}])
    assert r["total"] == 0 and r["items"][0]["amount"] == 0, "a general request carries no money"
    assert "₹" not in sent[-1]["msg"] and sent[-1]["type"] == "approval"
    done = run(rt.approve_request(r["id"], _note(), user=MANAGER))
    assert done["status"] == "approved" and done["expense_id"] is None and not done["expense_error"]
    assert run(db.expenses.count_documents({})) == 0, "no expense is booked"
    assert [s["type"] for s in sent[1:]] == ["approved"], "the requester is told; Finance is not"
    assert "Finance" not in sent[-1]["msg"]
    # Finance never lists it, cannot open it, and nobody can "pay" it.
    assert run(rt.list_requests(view="fulfil", user=FIN)) == []
    assert _code(rt.get_request(r["id"], user=FIN)) == 404
    assert run(rt.get_request(r["id"], user=OWNER))["can"]["fulfil"] is False
    assert _code(rt.fulfil_request(r["id"], RequestFulfilInput(), user=OWNER)) == 409
    with pytest.raises(HTTPException) as e:
        run(rt.withdraw_request(r["id"], _note(), user=STAFF))
    assert "Finance" not in e.value.detail


def test_an_owners_general_request_is_recorded_without_money(env):
    db, sent = env
    r = _raise(user=OWNER, kind="general", items=[{"name": "Close early on Diwali eve"}])
    assert r["status"] == "approved" and r["expense_id"] is None
    assert run(db.expenses.count_documents({})) == 0 and sent == []


def test_money_requests_still_go_to_finance_beside_general_ones(env):
    _raise(kind="general", items=[{"name": "A second monitor from the store room"}])
    money = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    assert [r["id"] for r in run(rt.list_requests(view="fulfil", user=FIN))] == [money["id"]]


# ───────────────────────── the ask-back ─────────────────────────
def test_a_rejection_needs_a_reason_and_books_nothing(env):
    db, sent = env
    r = _raise()
    assert _code(rt.reject_request(r["id"], _note("  "), user=MANAGER)) == 400
    done = run(rt.reject_request(r["id"], _note("Use the stock we have"), user=MANAGER))
    assert done["status"] == "rejected" and done["decision_note"] == "Use the stock we have"
    assert sent[-1] == {"to": ["u-staff"], "type": "request_rejected",
                        "msg": sent[-1]["msg"], "entity_id": r["id"]}
    assert run(db.expenses.count_documents({})) == 0
    assert _code(rt.approve_request(r["id"], _note(), user=MANAGER)) == 409


def test_a_question_and_its_answer(env):
    _, sent = env
    r = _raise()
    assert _code(rt.ask_about_request(r["id"], _note(), user=MANAGER)) == 400
    asked = run(rt.ask_about_request(r["id"], _note("Which supplier?"), user=MANAGER))
    assert asked["status"] == "info_requested" and sent[-1]["type"] == "clarification"
    assert run(rt.get_request(r["id"], user=STAFF))["can"]["respond"] is True
    assert _code(rt.ask_about_request(r["id"], _note("And?"), user=MANAGER)) == 409
    assert _code(rt.respond_to_request_question(r["id"], _note("Ganesh"), user=MANAGER)) == 403
    answered = run(rt.respond_to_request_question(r["id"], _note("Ganesh Traders"), user=STAFF))
    assert answered["status"] == "pending" and answered["reply_note"] == "Ganesh Traders"
    assert sent[-1]["to"] == ["u-mgr"]
    assert _code(rt.respond_to_request_question(r["id"], _note("again"), user=STAFF)) == 409


def test_an_approver_can_still_decide_while_waiting_on_an_answer(env):
    r = _raise()
    run(rt.ask_about_request(r["id"], _note("Which supplier?"), user=MANAGER))
    assert run(rt.approve_request(r["id"], _note(), user=MANAGER))["status"] == "approved"


def test_withdrawing_before_and_after_a_decision(env):
    _, sent = env
    r = _raise()
    assert _code(rt.withdraw_request(r["id"], _note(), user=MANAGER)) == 403
    gone = run(rt.withdraw_request(r["id"], _note("Found some in the store"), user=STAFF))
    assert gone["status"] == "cancelled" and sent[-1]["type"] == "request_withdrawn"
    assert sent[-1]["to"] == ["u-mgr"]
    second = run(rt.approve_request(_raise()["id"], _note(), user=MANAGER))
    with pytest.raises(HTTPException) as e:
        run(rt.withdraw_request(second["id"], _note(), user=STAFF))
    assert e.value.status_code == 409 and "approved" in e.value.detail


# ───────────────────────── attachments ─────────────────────────
def test_a_request_attaches_only_your_own_files_and_shares_them_with_its_readers(env):
    db, _ = env
    for fid, by in (("f-mine", "u-staff"), ("f-theirs", "u-out")):
        run(db.files.insert_one({"id": fid, "tenant_id": T, "uploaded_by": by, "is_deleted": False,
                                 "original_filename": f"{fid}.jpg", "content_type": "image/jpeg", "kind": "reference"}))
    r = _raise(attachment_ids=["f-mine", "f-theirs"])
    assert r["attachment_ids"] == ["f-mine"]
    rec = run(db.files.find_one({"id": "f-mine"}))
    assert run(files_rt.may_read_file(MANAGER, rec)) is True
    assert run(files_rt.may_read_file(OUTSIDER, rec)) is False

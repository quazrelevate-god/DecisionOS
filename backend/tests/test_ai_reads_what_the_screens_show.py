"""AI audit, step 1 (2026-10-05, founder: "fix the 1") — with REAL saves in an
isolated test database.

What the audit found live on the scratch company, and what these lock:
  * Dex told Anand (Accounts) the history of a Sales order, because the Brain
    memory row about it was written "public" — memory rows now follow the
    record they describe (services/record_access.readable_context_rows).
  * /ask listed every decision, contact, leave and memory note in the company
    to any member — each now follows its own screen's rule.
  * a removed employee could still WhatsApp into the company, and fall through
    to the WA_TENANT_ID catch-all — only live members get in.
  * a WhatsApp bill the model rated itself 90% sure of filed itself — only
    when the company opted in, under its own threshold.
  * two taps on Approve filed a bill twice — the approval is claimed first.

Single-process (reaches shared clients):
    .venv/Scripts/python -m pytest tests/test_ai_reads_what_the_screens_show.py -o addopts="" -p no:xdist
"""
import asyncio
import os

import pytest
from fastapi import HTTPException

from shared.ids import now_iso
from tests.e2e_harness import e2e_env, seed_tenant_and_users

pytestmark = pytest.mark.skipif(bool(os.environ.get("PYTEST_XDIST_WORKER")),
                                reason="single-process: reaches shared clients")

T = "t1"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Owner"}
# A sales member with buyer-side CRM and the base Brain/Ask access — no
# finance, no leave approval, no supplier CRM.
SALES = {"id": "u-sales", "tenant_id": T, "role": "sales", "name": "Sales User",
         "permissions": ["inbox", "tasks", "workflows", "ask", "brain", "crm_buyers"]}
# A member with no CRM and no Brain.
OPS = {"id": "u-operations", "tenant_id": T, "role": "operations", "name": "Operations User",
       "permissions": ["inbox", "tasks", "ask"]}


async def _seed(db):
    await seed_tenant_and_users(db)
    now = now_iso()
    await db.decisions.insert_many([
        {"id": "d-mine", "tenant_id": T, "title": "Bluewave order terms", "created_by": "u-sales",
         "approver_id": "u-owner", "status": "approved", "created_at": now},
        {"id": "d-theirs", "tenant_id": T, "title": "Bluewave payment write-off", "created_by": "u-finance",
         "approver_id": "u-owner", "status": "approved", "created_at": now},
    ])
    await db.contacts.insert_many([
        {"id": "c-buyer", "tenant_id": T, "name": "Bluewave UK", "type": "customer", "phone": "+44 1", "created_at": now},
        {"id": "c-vendor", "tenant_id": T, "name": "Bluewave Yarns", "type": "vendor", "phone": "+91 2", "created_at": now},
    ])
    await db.complaints.insert_many([
        {"id": "cp-buyer", "tenant_id": T, "customer_id": "c-buyer", "text": "Bluewave short shipment",
         "created_by": "u-owner", "status": "resolved", "created_at": now},
        {"id": "cp-vendor", "tenant_id": T, "customer_id": "c-vendor", "text": "Bluewave yarn late",
         "created_by": "u-owner", "status": "resolved", "created_at": now},
    ])
    await db.leaves.insert_many([
        {"id": "l-mine", "tenant_id": T, "user_id": "u-sales", "approver_id": "u-owner",
         "leave_type": "casual", "status": "approved", "created_at": now},
        {"id": "l-theirs", "tenant_id": T, "user_id": "u-finance", "approver_id": "u-owner",
         "leave_type": "sick", "status": "approved", "created_at": now},
    ])
    await db.memory.insert_one({"id": "m1", "tenant_id": T, "text": "Bluewave pays late", "created_at": now})
    rows = [
        ("decision", "d-mine", "Bluewave order terms approved"),
        ("decision", "d-theirs", "Bluewave payment write-off approved"),
        ("complaint", "cp-buyer", "Bluewave short shipment resolved"),
        ("complaint", "cp-vendor", "Bluewave yarn late resolved"),
        ("meeting", "mt1", "Bluewave review meeting"),
        ("", "", "Bluewave note"),
    ]
    await db.brain_context.insert_many([
        {"id": f"bc{i}", "tenant_id": T, "kind": "note", "title": title, "why": "", "tags": ["bluewave"],
         "source_type": st, "source_id": sid, "visibility": "public", "actor_id": "u-owner",
         "created_at": now} for i, (st, sid, title) in enumerate(rows)
    ])


def test_memory_rows_follow_the_record_they_describe(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            from services.ai.brain_context import query_context
            titles = lambda rows: sorted(r["title"] for r in rows)  # noqa: E731
            mine = await query_context(tenant_id=T, user=SALES, limit=25)
            assert titles(mine) == ["Bluewave note", "Bluewave order terms approved", "Bluewave short shipment resolved"], (
                "the other team's decision, the supplier complaint and the meeting stay out")
            assert len(await query_context(tenant_id=T, user=OWNER, limit=25)) == 6, "the owner reads everything"
            # The keyword path is filtered the same way.
            found = await query_context(tenant_id=T, user=OPS, q="Bluewave", limit=25)
            assert "Bluewave payment write-off approved" not in titles(found)
            assert "Bluewave review meeting" not in titles(found)
            return True
    assert with_test_db(scenario) is True


def test_ask_reads_only_what_the_askers_screens_show(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await _seed(db)
            from routers.brain import _retrieve

            async def rows(user, entity):
                scope = {"tenant_id": T, "uid": user["id"], "role": user["role"],
                         "can_finance": False, "privileged": False}
                out = await _retrieve({"primary_entity": entity, "keywords": [], "date_preset": None}, scope, user)
                return sorted(r["id"] for r in out["records"])

            assert await rows(SALES, "decisions") == ["d-mine"]
            assert await rows(SALES, "contacts") == ["c-buyer"], "buyers only: no supplier CRM"
            assert await rows(OPS, "contacts") == [], "no CRM, no contacts"
            assert await rows(SALES, "leaves") == ["l-mine"], "not a colleague's sick leave"
            assert await rows(SALES, "memory") == ["m1"]
            assert await rows(OPS, "memory") == [], "the company memory is the Brain's"
            assert await rows(OWNER, "decisions") == ["d-mine", "d-theirs"]
            assert await rows(OWNER, "leaves") == ["l-mine", "l-theirs"]
            return True
    assert with_test_db(scenario) is True


def test_a_removed_member_cannot_whatsapp_in(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            await db.users.update_one({"id": "u-sales"}, {"$set": {"phone_norm": "9820010001"}})
            await db.users.update_one({"id": "u-finance"}, {"$set": {"phone_norm": "9820010002"}})
            await db.memberships.update_one({"user_id": "u-sales", "tenant_id": T}, {"$set": {"status": "removed"}})
            from services.whatsapp import resolve_wa_tenant
            before = os.environ.get("WA_TENANT_ID")
            os.environ["WA_TENANT_ID"] = "catch-all"
            try:
                assert await resolve_wa_tenant("+91 98200 10002") == T, "a live member still gets in"
                assert await resolve_wa_tenant("+91 98200 10001") is None, (
                    "removed: dropped, and never handed to the catch-all")
            finally:
                if before is None:
                    os.environ.pop("WA_TENANT_ID", None)
                else:
                    os.environ["WA_TENANT_ID"] = before
            return True
    assert with_test_db(scenario) is True


def test_nothing_files_itself_unless_the_company_said_so(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            from services.captures import _capture_auto_file
            assert await _capture_auto_file(T) is False
            await db.tenants.update_one({"id": T}, {"$set": {"capture_auto_file": True}})
            assert await _capture_auto_file(T) is True
            return True
    assert with_test_db(scenario) is True


def test_two_taps_on_approve_file_a_bill_once(with_test_db):
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            await db.capture_drafts.insert_one({
                "id": "cd1", "tenant_id": T, "kind": "image", "status": "pending_review",
                "reviewer_role": "finance", "filename": "bill.jpg", "summary": "Bill WB-9",
                "records": {"contacts": [{"name": "Noble Steels"}],
                            "invoices": [{"number": "WB-9", "contact_name": "Noble Steels", "amount": 4200,
                                          "currency": "INR", "type": "sales_invoice"}],
                            "payments": [], "tasks": []},
                "created_at": now_iso()})
            from routers.captures import approve_capture
            results = await asyncio.gather(approve_capture("cd1", user=OWNER), approve_capture("cd1", user=OWNER),
                                           return_exceptions=True)
            ok = [r for r in results if isinstance(r, dict) and r.get("ok")]
            refused = [r for r in results if isinstance(r, HTTPException) and r.status_code == 400]
            assert len(ok) == 1 and len(refused) == 1, results
            assert await db.invoices.count_documents({"tenant_id": T, "number": "WB-9"}) == 1
            assert (await db.capture_drafts.find_one({"id": "cd1"}))["status"] == "executed"
            return True
    assert with_test_db(scenario) is True


def test_money_notes_in_the_company_memory_are_finances(with_test_db):
    """2026-10-06 — the ledger used to copy every expense/asset/inventory/income
    with its amount into the company memory, which any member reads through Ask.
    New ones are no longer written; the ones already there are Finance's."""
    async def scenario(db):
        with e2e_env(db):
            await seed_tenant_and_users(db)
            await db.memory.insert_many([
                {"id": "m-exp", "tenant_id": T, "text": "Expense: Yarn - INR 45,000", "tag": "expense", "created_at": now_iso()},
                {"id": "m-note", "tenant_id": T, "text": "Bluewave prefers morning calls", "tag": "note", "created_at": now_iso()},
            ])
            from routers.brain import _retrieve
            fin = {**SALES, "permissions": SALES["permissions"] + ["finance"]}

            async def ids(user):
                scope = {"tenant_id": T, "uid": user["id"], "role": user["role"], "can_finance": False, "privileged": False}
                out = await _retrieve({"primary_entity": "memory", "keywords": [], "date_preset": None}, scope, user)
                return sorted(r["id"] for r in out["records"])
            assert await ids(SALES) == ["m-note"]
            assert await ids(fin) == ["m-exp", "m-note"]
            import inspect
            import routers.ledger as ledger
            assert not hasattr(ledger, "_write_brain") and "db.memory.insert" not in inspect.getsource(ledger)
            return True
    assert with_test_db(scenario) is True

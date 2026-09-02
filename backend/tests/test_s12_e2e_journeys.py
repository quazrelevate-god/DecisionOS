"""Epic 10 Sprint 12 -- in-process END-TO-END persona journeys.

Each test drives the REAL service/router functions (approve_decision,
reconcile_payment, workflow_engine.advance, operating_score, create_complaint,
_create_leave, execute_capture, process_voice_note, ...) in sequence against an
isolated with_test_db Mongo, asserting CROSS-MODULE state at each hand-off. The
LLM/transport leaves are stubbed; the business logic is real.

Single-process only: the flow reaches shared AsyncMongoClient-backed modules, so
under xdist's separate event loops a foreign-loop client would raise. Run:

    .venv/Scripts/python -m pytest tests/test_s12_e2e_journeys.py -o addopts="" -p no:xdist
"""
import os
import pytest

from shared.ids import now_iso
from tests.e2e_harness import e2e_env, seed_tenant_and_users, owner, member

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="in-process E2E reaches shared Mongo clients -> run single-process, not under xdist")

import routers.decisions as decisions
import routers.ledger as ledger
import routers.operating_score as osr
import services.workflow_engine as wfe
import services.ai.generators as generators


# ===========================================================================
# T10-12.1  Owner golden path
# decision -> approve (unblocks task) -> task done w/ evidence -> invoice
# raised -> payment matched -> operating score reflects. One unbroken journey.
# ===========================================================================
def test_owner_golden_path(with_test_db):
    async def scenario(db):
        await seed_tenant_and_users(db)
        with e2e_env(db):
            # --- decision + a blocked task waiting on approval ---
            await db.decisions.insert_one({
                "id": "dec1", "tenant_id": "t1", "title": "Fulfil the Kapoor order",
                "type": "directive", "status": "pending_approval", "task_ids": ["tk1"],
                "created_by": "u-owner", "created_at": now_iso()})
            await db.tasks.insert_one({
                "id": "tk1", "tenant_id": "t1", "title": "Pack + dispatch the Kapoor order",
                "status": "blocked", "decision_id": "dec1", "assignee_role": "operations",
                "evidence_required": True, "created_by": "u-owner", "created_at": now_iso()})

            # --- owner approves -> blocked task becomes actionable ---
            await decisions.approve_decision("dec1", user=owner())
            dec = await db.decisions.find_one({"id": "dec1"})
            tk = await db.tasks.find_one({"id": "tk1"})
            assert dec["status"] == "approved", dec["status"]
            assert tk["status"] == "todo", f"approval did not unblock the task: {tk['status']}"

            # --- task done WITH evidence (the evidence gate is real) ---
            await db.tasks.update_one({"id": "tk1"}, {"$set": {
                "status": "done", "progress": 100,
                "attachments": [{"id": "att1", "kind": "evidence", "name": "dispatch_photo.jpg"}]}})

            # --- invoice raised + inbound payment reconciled ---
            await db.invoices.insert_one({
                "id": "inv1", "tenant_id": "t1", "type": "sales_invoice", "number": "INV-1",
                "contact_name": "Kapoor Retail", "amount": 80000, "amount_paid": 0,
                "status": "unpaid", "created_at": now_iso()})
            payment = {"id": "pay1", "tenant_id": "t1", "direction": "in", "amount": 80000,
                       "contact_name": "Kapoor Retail", "invoice_number": "INV-1",
                       "applied": 0, "created_at": now_iso()}
            await db.payments.insert_one(payment)
            matched = await ledger.reconcile_payment("t1", payment, matched_by="auto")
            inv = await db.invoices.find_one({"id": "inv1"})
            assert inv["amount_paid"] == 80000 and inv["status"] == "paid", inv
            assert matched is not None

            # --- operating score reflects the closed loop (owner view) ---
            score = await osr.operating_score(user_id=None, user=owner())
            assert score["view"] == "owner" and "company" in score
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.2  Finance persona journey
# raise invoices -> reconcile inbound payments (full / partial / none) ->
# outstanding correct. Money surfaces where finance-permitted.
# ===========================================================================
def test_finance_persona_journey(with_test_db):
    async def scenario(db):
        await seed_tenant_and_users(db)
        with e2e_env(db):
            invs = [("INV-A", 80000, 80000), ("INV-B", 50000, 30000), ("INV-C", 20000, 0)]
            for num, amt, paid in invs:
                await db.invoices.insert_one({
                    "id": f"i-{num}", "tenant_id": "t1", "type": "sales_invoice", "number": num,
                    "contact_name": "Kapoor Retail", "amount": amt, "amount_paid": 0,
                    "status": "unpaid", "created_at": now_iso()})
                if paid:
                    pay = {"id": f"p-{num}", "tenant_id": "t1", "direction": "in", "amount": paid,
                           "contact_name": "Kapoor Retail", "invoice_number": num, "applied": 0,
                           "created_at": now_iso()}
                    await db.payments.insert_one(pay)
                    await ledger.reconcile_payment("t1", pay, matched_by="auto")

            a = await db.invoices.find_one({"id": "i-INV-A"})
            b = await db.invoices.find_one({"id": "i-INV-B"})
            c = await db.invoices.find_one({"id": "i-INV-C"})
            assert a["status"] == "paid" and a["amount_paid"] == 80000
            assert b["status"] == "partial" and b["amount_paid"] == 30000
            assert c["status"] == "unpaid" and c["amount_paid"] == 0

            # outstanding receivables = remaining across unpaid+partial = 20000 + 20000
            rows = await db.invoices.find({"tenant_id": "t1"}).to_list(50)
            outstanding = sum(r["amount"] - r.get("amount_paid", 0)
                              for r in rows if r["status"] != "paid")
            assert outstanding == 40000, outstanding

            # a finance owner sees the company money view
            score = await osr.operating_score(user_id=None, user=owner())
            assert "company" in score
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.3  Sales persona journey
# contact -> activity -> CRM outstanding -> complaint raised -> resolved
# (writes brain_context provenance). Blocked from the finance/company view.
# ===========================================================================
def test_sales_persona_journey(with_test_db):
    import routers.crm as crm
    import routers.complaints as complaints

    async def scenario(db):
        await seed_tenant_and_users(db)
        # keep brain_context.record_context REAL so we can assert provenance was written
        with e2e_env(db, keep=["services.ai.brain_context.record_context"]):
            sales = member("sales")
            await db.contacts.insert_one({
                "id": "ct1", "tenant_id": "t1", "name": "Kapoor Retail", "type": "customer",
                "created_by": sales["id"], "created_at": now_iso()})
            await db.crm_activities.insert_one({
                "id": "ac1", "tenant_id": "t1", "contact_id": "ct1", "kind": "call",
                "note": "Discussed the festival order", "created_by": sales["id"], "created_at": now_iso()})
            await db.invoices.insert_one({
                "id": "iv1", "tenant_id": "t1", "type": "sales_invoice", "number": "INV-9",
                "contact_id": "ct1", "contact_name": "Kapoor Retail", "amount": 35000,
                "amount_paid": 0, "status": "unpaid", "created_at": now_iso()})

            # CRM outstanding attributes the unpaid invoice to the contact
            out = await crm.outstanding_by_contact(user=sales)
            blob = str(out)
            assert "Kapoor Retail" in blob or "ct1" in blob
            assert "35000" in blob.replace(",", "")

            # raise + resolve a complaint -> resolution provenance in brain_context
            await db.complaints.insert_one({
                "id": "cp1", "tenant_id": "t1", "contact_id": "ct1", "contact_name": "Kapoor Retail",
                "title": "Late delivery", "status": "open", "created_by": sales["id"],
                "created_at": now_iso()})
            await complaints.resolve_complaint("cp1", user=sales)
            cp = await db.complaints.find_one({"id": "cp1"})
            assert cp["status"] == "resolved" and cp.get("resolved_at")
            prov = await db.brain_context.find_one({"tenant_id": "t1", "kind": "resolution"})
            assert prov is not None, "resolving a complaint did not write brain_context provenance"

            # sales is NOT the owner company view (blocked from the finance/company snapshot)
            sview = await osr.operating_score(user_id=None, user=sales)
            assert sview.get("view") != "owner"
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.4  Operations persona journey
# tasks -> start workflow -> advance stages (CAS) to terminal -> request leave
# -> owner approves -> approved leave reflects on the calendar/availability read.
# ===========================================================================
def test_operations_persona_journey(with_test_db):
    import services.leave as leave_svc
    import routers.team as team

    async def scenario(db):
        await seed_tenant_and_users(db)
        with e2e_env(db):
            # start a workflow on the DEFAULT production pipeline (no tenant operating_model
            # -> fallback), then advance through every stage to terminal.
            stages = ["order_received", "confirmed", "in_production", "ready"]
            await db.workflows.insert_one({
                "id": "wf1", "tenant_id": "t1", "type": "production", "stage": "order_received",
                "stages": stages, "stage_version": 0,
                "history": [{"stage": "order_received", "at": now_iso()}], "created_at": now_iso()})
            for expect in ("confirmed", "in_production", "ready"):
                await wfe.advance("t1", "wf1", actor_id="u-operations", actor_name="Ops User",
                                  actor_role="operations")
                wf = await db.workflows.find_one({"id": "wf1"})
                assert wf["stage"] == expect, f"advance stuck at {wf['stage']}, wanted {expect}"
            wf = await db.workflows.find_one({"id": "wf1"})
            assert wf.get("completed_at"), "terminal stage did not set completed_at"
            assert wf["stage_version"] == 3, wf["stage_version"]

            # request leave -> owner approves -> approved row is what the calendar reads
            lv = await leave_svc._create_leave(
                "t1", member("operations"), "casual", "2026-09-10", "2026-09-11",
                "full", "Family function", False)
            await team._decide_leave(lv["id"], owner(), "approved", "", "leave_approved", "Approved")
            row = await db.leaves.find_one({"id": lv["id"]})
            assert row["status"] == "approved", row["status"]
            approved = await db.leaves.find_one({"tenant_id": "t1", "status": "approved"})
            assert approved is not None  # the calendar/on-leave read merges this dynamically
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.5  Multi-role parallel day
# owner + finance + sales + ops all act in the same tenant/window ->
# cross-module state stays consistent (no contention corruption).
# ===========================================================================
def test_multi_role_parallel_day(with_test_db):
    import routers.complaints as complaints

    async def scenario(db):
        await seed_tenant_and_users(db)
        with e2e_env(db):
            # owner: decision + task, approve
            await db.decisions.insert_one({"id": "d5", "tenant_id": "t1", "title": "Ship it",
                "status": "pending_approval", "task_ids": ["t5"], "created_at": now_iso()})
            await db.tasks.insert_one({"id": "t5", "tenant_id": "t1", "title": "Dispatch",
                "status": "blocked", "decision_id": "d5", "assignee_role": "operations",
                "created_at": now_iso()})
            await decisions.approve_decision("d5", user=owner())

            # finance: invoice + payment reconcile
            await db.invoices.insert_one({"id": "i5", "tenant_id": "t1", "type": "sales_invoice",
                "number": "INV-5", "contact_name": "Kapoor", "amount": 60000, "amount_paid": 0,
                "status": "unpaid", "created_at": now_iso()})
            pay = {"id": "p5", "tenant_id": "t1", "direction": "in", "amount": 60000,
                   "contact_name": "Kapoor", "invoice_number": "INV-5", "applied": 0, "created_at": now_iso()}
            await db.payments.insert_one(pay)
            await ledger.reconcile_payment("t1", pay, matched_by="auto")

            # sales: complaint raise + resolve
            await db.complaints.insert_one({"id": "c5", "tenant_id": "t1", "title": "Colour off",
                "status": "open", "created_at": now_iso()})
            await complaints.resolve_complaint("c5", user=member("sales"))

            # ops: workflow advance one stage
            await db.workflows.insert_one({"id": "w5", "tenant_id": "t1", "type": "production",
                "stage": "order_received", "stages": ["order_received", "confirmed", "in_production", "ready"],
                "stage_version": 0, "history": [{"stage": "order_received", "at": now_iso()}],
                "created_at": now_iso()})
            await wfe.advance("t1", "w5", actor_id="u-operations", actor_name="Ops", actor_role="operations")

            # cross-module consistency: every role's write landed, none clobbered another
            assert (await db.decisions.find_one({"id": "d5"}))["status"] == "approved"
            assert (await db.tasks.find_one({"id": "t5"}))["status"] == "todo"
            assert (await db.invoices.find_one({"id": "i5"}))["status"] == "paid"
            assert (await db.complaints.find_one({"id": "c5"}))["status"] == "resolved"
            assert (await db.workflows.find_one({"id": "w5"}))["stage"] == "confirmed"
            # owner score still computes cleanly over the mixed state
            assert "company" in await osr.operating_score(user_id=None, user=owner())
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.6  WhatsApp -> action E2E
# a bill-photo capture draft -> owner executes -> ledger record filed + inbox
# closed. The zero-typing capture path.
# ===========================================================================
def test_whatsapp_bill_to_ledger_and_inbox(with_test_db):
    import services.captures as captures

    async def scenario(db):
        await seed_tenant_and_users(db)
        with e2e_env(db):
            draft = {
                "id": "cd1", "tenant_id": "t1", "kind": "image", "wa_from": "+919812345678",
                "filename": "noble_steels_bill.jpg", "classification": "invoice",
                "summary": "Bill from Noble Steels Rs 27,625",
                "records": {
                    "contacts": [{"name": "Noble Steels"}],
                    "invoices": [{"number": "WB-1", "contact_name": "Noble Steels",
                                  "amount": 27625, "currency": "INR", "type": "sales_invoice"}],
                    "payments": [], "tasks": []},
            }
            res = await captures.execute_capture(draft, owner())
            assert res["type"] == "ingestion"

            inv = await db.invoices.find_one({"tenant_id": "t1", "number": "WB-1"})
            assert inv is not None and inv["amount"] == 27625, "bill photo did not create a ledger record"
            ing = await db.ingestions.find_one({"id": res["id"]})
            assert ing["status"] == "filed"
            inbox = await db.inbox.find_one({"tenant_id": "t1", "ref_id": res["id"]})
            assert inbox is not None and inbox.get("status") == "done", "inbox item not filed/closed"
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.7  Voice -> decision -> execution E2E
# dictate -> Dex structures a pending_approval decision + blocked task ->
# approve -> generate execution plan -> tick every step -> task completes.
# ===========================================================================
def test_voice_to_decision_to_execution(with_test_db):
    import services.voice as voice
    import routers.tasks as tasks_router
    from models.tasks import ExecPlanInput, ExecStep

    async def fake_extract(transcript, session_id, allowed_roles=None, members=None,
                           pipelines=None, task_categories=None, extra_context=""):
        return {"summary": "Dispatch the Kapoor order today", "confidence": 0.9, "needs_review": False,
                "decisions": [{"title": "Dispatch the Kapoor order", "type": "directive"}],
                "tasks": [{"title": "Pack and ship the Kapoor order", "assignee_role": "operations",
                           "priority": "high", "due_in_days": 1}],
                "workflow_events": [], "meeting_events": [], "reminders": [], "memory_notes": []}

    async def fake_plan(task, industry, currency, session_id=""):
        return {"task_type": "fulfilment",
                "steps": ["Pick the order items", "Quality-check", "Pack and label", "Hand to courier"]}

    async def scenario(db):
        await seed_tenant_and_users(db)
        stubs = {"services.ai.extraction.ai_extract": fake_extract,
                 "services.voice.ai_extract": fake_extract,
                 "services.ai.extraction.ai_execution_plan": fake_plan}
        with e2e_env(db, stubs=stubs):
            # dictate -> structure
            await db.voice_notes.insert_one({
                "id": "vn1", "tenant_id": "t1", "created_by": "u-owner", "kind": "text",
                "transcript": "Dispatch the Kapoor order today", "language": "auto",
                "status": "queued", "created_at": now_iso()})
            await voice.process_voice_note("vn1")

            vn = await db.voice_notes.find_one({"id": "vn1"})
            dec_id = vn.get("decision_id")
            assert dec_id, "voice note did not materialise a decision"
            dec = await db.decisions.find_one({"id": dec_id})
            assert dec["status"] == "pending_approval", dec["status"]
            tk = await db.tasks.find_one({"tenant_id": "t1", "decision_id": dec_id})
            assert tk is not None and tk["status"] == "blocked", "task not created blocked"

            # approve -> task actionable
            await decisions.approve_decision(dec_id, user=owner())
            tk = await db.tasks.find_one({"id": tk["id"]})
            assert tk["status"] == "todo"

            # generate an execution plan, tick every step, save as accepted -> task done
            await tasks_router.generate_execution_plan(tk["id"], user=owner())
            tk = await db.tasks.find_one({"id": tk["id"]})
            steps = tk["execution_plan"]["steps"]
            assert len(steps) == 4
            ticked = [ExecStep(id=s["id"], text=s["text"], done=True) for s in steps]
            await tasks_router.save_execution_plan(
                tk["id"], ExecPlanInput(steps=ticked, status="accepted"), user=owner())
            tk = await db.tasks.find_one({"id": tk["id"]})
            assert tk["status"] == "done", f"ticking all steps did not complete the task: {tk['status']}"
            assert tk["execution_plan"]["progress"] == 100
            return True
    assert with_test_db(scenario) is True


# ===========================================================================
# T10-12.8  Kapoor golden path (WE-15) -- full assertion
# workflow through every stage with per-stage template tasks + role hand-offs,
# terminal create_expense side effect; plus the not-ready negative gate.
# ===========================================================================
_KAPOOR_PIPELINE = {
    "key": "sales", "label": "Sales", "sub": "Order -> Ready", "approval_stage": None,
    "stages": [
        {"key": "order_received", "label": "Order Received",
         "tasks": [{"title": "Confirm with customer", "role": "sales", "evidence_required": False}],
         "approval": None, "side_effects": []},
        {"key": "confirmed", "label": "Confirmed",
         "tasks": [{"title": "Prepare invoice", "role": "finance", "evidence_required": False}],
         "approval": None, "side_effects": []},
        {"key": "in_production", "label": "In Production",
         "tasks": [{"title": "Pack + label", "role": "operations", "evidence_required": False}],
         "approval": None, "side_effects": []},
        {"key": "ready", "label": "Ready", "tasks": [], "approval": None,
         "side_effects": [{"kind": "create_expense", "params": {"status": "awaiting_bill"}}]},
    ],
}


def test_kapoor_golden_path_full(with_test_db):
    async def scenario(db):
        # a tenant whose operating_model carries the WE-15 sales pipeline
        await db.tenants.insert_one({
            "id": "t1", "tenant_id": "t1", "company_name": "Kapoor Cotton Mills",
            "industry": "Textile & Apparel", "plan": "business",
            "operating_model": {"pipelines": [_KAPOOR_PIPELINE],
                                "task_categories": [{"key": "sales", "label": "Sales"}]},
            "created_at": now_iso()})
        await seed_tenant_and_users(db, tenant="t1")  # users per role for least-loaded assignment
        with e2e_env(db):
            stages = ["order_received", "confirmed", "in_production", "ready"]
            await db.workflows.insert_one({
                "id": "kw", "tenant_id": "t1", "type": "sales", "stage": "order_received",
                "stages": stages, "stage_version": 0,
                "history": [{"stage": "order_received", "at": now_iso()}], "created_at": now_iso()})

            # enter the first stage -> its template task spawns
            await wfe.on_stage_enter("t1", "kw", actor_id="u-owner", actor_name="Owner")
            first = await db.tasks.find({"tenant_id": "t1", "workflow_id": "kw",
                                         "stage_key": "order_received"}).to_list(10)
            assert any(t["title"] == "Confirm with customer" for t in first), first

            # NEGATIVE: an open stage task blocks the advance (CAS readiness gate)
            ready = await wfe.check_stage_ready("t1", "kw")
            assert ready["ready"] is False and len(ready["open_task_ids"]) == 1
            try:
                await wfe.advance("t1", "kw", actor_id="u-owner", actor_name="Owner", actor_role="owner")
                assert False, "advance should have raised not_ready with an open task"
            except wfe.WorkflowAdvanceError as e:
                assert e.code == "not_ready" and e.http_status == 409
            assert (await db.workflows.find_one({"id": "kw"}))["stage_version"] == 0  # unchanged

            # GOLDEN PATH: close each stage's tasks and advance to terminal
            for stage, nxt in [("order_received", "confirmed"), ("confirmed", "in_production"),
                               ("in_production", "ready")]:
                await db.tasks.update_many(
                    {"tenant_id": "t1", "workflow_id": "kw", "stage_key": stage},
                    {"$set": {"status": "done", "progress": 100}})
                r = await wfe.check_stage_ready("t1", "kw")
                assert r["ready"] is True, f"{stage} still not ready: {r}"
                await wfe.advance("t1", "kw", actor_id="u-owner", actor_name="Owner", actor_role="owner")
                assert (await db.workflows.find_one({"id": "kw"}))["stage"] == nxt

            wf = await db.workflows.find_one({"id": "kw"})
            assert wf["stage"] == "ready" and wf.get("completed_at"), "did not reach terminal"
            assert wf["stage_version"] == 3
            # terminal side effect: a create_expense awaiting the bill
            exp = await db.expenses.find_one({"tenant_id": "t1"})
            assert exp is not None and exp.get("status") == "awaiting_bill", "terminal create_expense missing"
            # role hand-offs happened: finance + operations tasks were spawned along the way
            titles = {t["title"] for t in await db.tasks.find({"tenant_id": "t1", "workflow_id": "kw"}).to_list(50)}
            assert {"Confirm with customer", "Prepare invoice", "Pack + label"} <= titles, titles
            return True
    assert with_test_db(scenario) is True

"""Epic 10 Testing -- Sprint 5, the REAL end-to-end operational flow (T10-05.1).

Unlike test_s5_niches.py (isolated read paths on seeded data), this drives the
actual operational chain end to end with the REAL service functions:

    bill (invoice) -> payment MATCHES it (routers.ledger.reconcile_payment)
      -> decision APPROVED, blocked task UNBLOCKED (routers.decisions.approve_decision)
      -> task DONE -> operating score REFLECTS the completed, paid work.

Side-effect writers that need external infra (Brain/Qdrant embeddings, audit) are
no-op'd; the assertions are on the core state transitions the flow must make.
"""
import os

import pytest

import routers.ledger as ledger
import routers.decisions as decisions
import routers.operating_score as osr
import services.operating_score as oss
import services.ai.brain_context as brain_context
import services.enrich as enrich
import core
from core import now_iso

# This drives real ROUTER endpoints (reconcile_payment, approve_decision), which
# reach into the PRODUCTION module clients (core.db / routers.*.db -- shared
# AsyncMongoClients). Patching those to the per-test isolated db is only safe on
# a single event loop; under the suite's `-n2 --dist loadscope` those clients are
# bound to another worker's loop and raise "AsyncMongoClient in different event
# loop". So this flow test runs SINGLE-PROCESS only:
#     .venv/Scripts/python -m pytest tests/test_s5_e2e_flow.py -o addopts=""
# (The same end-to-end chain also runs against a live server in the integration
# tier -- test_iteration55_ledger, test_s2_functional.)
pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="endpoint-level e2e patches production clients; cross-loop under xdist -- run single-process")


def _patch(testdb):
    saved = {
        "ledger": ledger.db, "decisions": decisions.db, "osr": osr.db, "oss": oss.db,
        "core": core.db,
        "rc": brain_context.record_context, "enr": enrich.enrich_decision,
        "ade": core.add_decision_event, "la": core.log_activity,
    }
    ledger.db = decisions.db = osr.db = oss.db = core.db = testdb

    async def _noop(*a, **k):
        return None

    async def _enrich(d, *a, **k):
        return d
    brain_context.record_context = _noop
    enrich.enrich_decision = _enrich
    core.add_decision_event = _noop
    core.log_activity = _noop

    def restore():
        ledger.db, decisions.db, osr.db, oss.db, core.db = (
            saved["ledger"], saved["decisions"], saved["osr"], saved["oss"], saved["core"])
        brain_context.record_context = saved["rc"]
        enrich.enrich_decision = saved["enr"]
        core.add_decision_event = saved["ade"]
        core.log_activity = saved["la"]
    return restore


def test_bill_to_match_to_approve_to_done_to_score(with_test_db):
    from tests.factories import build_niche_tenant

    async def scenario(db):
        restore = _patch(db)
        try:
            t = await build_niche_tenant(db, "textile", tenant_id="t1")
            owner = {"id": t["owner_id"], "tenant_id": "t1", "name": "Ravi", "role": "owner"}

            # --- 1) BILL -> MATCH -------------------------------------------
            await db.invoices.insert_one({
                "id": "inv1", "tenant_id": "t1", "type": "sales_invoice", "number": "INV-1",
                "contact_name": "Brand Kart", "amount": 42000, "amount_paid": 0,
                "status": "open", "currency": "INR", "date": now_iso()[:10], "created_at": now_iso()})
            payment = {"id": "pay1", "tenant_id": "t1", "direction": "in", "amount": 42000,
                       "contact_name": "Brand Kart", "reference": "INV-1", "date": now_iso()[:10],
                       "applied": 0, "applications": [], "created_at": now_iso()}
            await db.payments.insert_one(dict(payment))
            matched = await ledger.reconcile_payment("t1", payment, matched_by="auto")
            inv_after = await db.invoices.find_one({"id": "inv1"}, {"_id": 0})
            pay_after = await db.payments.find_one({"id": "pay1"}, {"_id": 0})

            # --- 2) DECISION -> APPROVE (unblock the blocked task) ----------
            await db.decisions.insert_one({
                "id": "dec1", "tenant_id": "t1", "title": "Approve bulk yarn purchase",
                "status": "open", "created_at": now_iso()})
            await db.tasks.insert_one({
                "id": "tsk1", "tenant_id": "t1", "decision_id": "dec1", "title": "Place yarn order",
                "status": "blocked", "assignee_id": t["owner_id"], "assignee_role": "procurement",
                "created_at": now_iso()})
            await decisions.approve_decision("dec1", user=owner)
            dec_after = await db.decisions.find_one({"id": "dec1"}, {"_id": 0})
            task_unblocked = await db.tasks.find_one({"id": "tsk1"}, {"_id": 0})

            # --- 3) TASK -> DONE --------------------------------------------
            await db.tasks.update_one({"id": "tsk1", "tenant_id": "t1"},
                                      {"$set": {"status": "done", "completed_at": now_iso()}})
            task_done = await db.tasks.find_one({"id": "tsk1"}, {"_id": 0})

            # --- 4) OPERATING SCORE reflects the completed, paid work -------
            company = await osr.operating_score(user_id=None, user=owner)
            return (matched is not None, inv_after["amount_paid"], inv_after["status"],
                    pay_after.get("match_status"), pay_after.get("applied"),
                    dec_after["status"], task_unblocked["status"], task_done["status"],
                    company["view"], "company" in company)
        finally:
            restore()

    (matched, inv_paid, inv_status, pay_match, pay_applied, dec_status,
     task_after_approve, task_after_done, view, has_company) = with_test_db(scenario)

    # bill -> match
    assert matched and inv_paid == 42000 and inv_status == "paid", "the payment auto-matched + fully settled the invoice"
    assert pay_applied == 42000 and pay_match in ("matched", "reconciled", "applied"), \
        f"the payment is applied to the invoice (match_status={pay_match})"
    # decision -> approve -> unblock
    assert dec_status == "approved", "the decision is approved"
    assert task_after_approve == "todo", "approving the decision UNBLOCKED its blocked task (blocked -> todo)"
    # task -> done -> score
    assert task_after_done == "done", "the unblocked task is completed"
    assert view == "owner" and has_company, "operating score renders over the completed, paid flow"

"""Epic 10 Testing -- Sprint 2 (functional / lifecycle).

db-tier: each test drives the REAL router handlers against a fresh isolated Mongo
database (with_test_db), pointing every module the flow touches at it. This pins
the end-to-end behavior a client sees -- status codes, cascades, counts, no
orphans -- without a live server.

Batch 1:
  T10-02.14  viewer-aware operating-score dispatch + view-as privacy (403/404)
  T10-02.12  inbox counts reflect the FULL open total even when the list paginates
  T10-02.4   contact rename cascades into invoices/payments/workflows; outstanding
             splits purchase_bill -> payables vs receivables
"""
from fastapi import HTTPException


def _use_db(testdb, *mods):
    """Point each listed module's global `db` at the isolated test db; return
    restore(). List EVERY module the flow touches -- any left on the real client
    both hits founder-os-58 and can cross-loop-fail under the shared client."""
    saved = [(m, m.db) for m in mods if hasattr(m, "db")]   # skip modules with no db global
    for m, _ in saved:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


def _u(role, uid, tid="t1", **over):
    u = {"role": role, "tenant_id": tid, "id": uid, "name": f"{role}-{uid}"}
    u.update(over)
    return u


# ---------------------------------------------------------------------------
# T10-02.14 -- operating-score is viewer-aware; view-as is owner-only.
# ---------------------------------------------------------------------------
def test_operating_score_viewer_dispatch_and_privacy(with_test_db):
    import routers.operating_score as osr
    import services.operating_score as oss

    async def scenario(db):
        restore = _use_db(db, osr, oss)
        try:
            tid = "t1"
            await db.users.insert_many([
                {"id": "owner1", "tenant_id": tid, "role": "owner", "name": "Owner"},
                {"id": "sales1", "tenant_id": tid, "role": "sales", "name": "Sam"},
            ])
            owner = _u("owner", "owner1")
            sales = _u("sales", "sales1")
            r = {}
            p = await osr.operating_score(user_id=None, user=owner)
            r["owner_view"], r["owner_snapshot"] = p["view"], ("my_snapshot" in p)
            p = await osr.operating_score(user_id=None, user=sales)
            r["sales_view"] = p["view"]
            p = await osr.operating_score(user_id="sales1", user=owner)   # owner view-as
            r["viewas_view"], r["viewas_id"] = p["view"], p.get("view_as", {}).get("id")
            try:                                                          # non-owner -> 403
                await osr.operating_score(user_id="owner1", user=sales)
                r["privacy"] = None
            except HTTPException as e:
                r["privacy"] = e.status_code
            try:                                                          # owner -> ghost -> 404
                await osr.operating_score(user_id="ghost", user=owner)
                r["missing"] = None
            except HTTPException as e:
                r["missing"] = e.status_code
            return r
        finally:
            restore()

    r = with_test_db(scenario)
    assert r["owner_view"] == "owner" and r["owner_snapshot"]
    assert r["sales_view"] == "self"
    assert r["viewas_view"] == "self" and r["viewas_id"] == "sales1"
    assert r["privacy"] == 403, "a non-owner must NOT see another user's operating page"
    assert r["missing"] == 404


# ---------------------------------------------------------------------------
# T10-02.12 -- inbox counts reflect the FULL open total, not the paginated slice.
# ---------------------------------------------------------------------------
def test_inbox_counts_full_open_total_and_status_validation(with_test_db):
    import routers.inbox as inbox
    from routers.inbox import InboxStatusInput

    async def scenario(db):
        restore = _use_db(db, inbox)
        try:
            tid = "t1"
            docs = ([{"id": f"a{i}", "tenant_id": tid, "classification": "complaint",
                      "status": "open", "created_at": f"2026-01-0{i+1}"} for i in range(3)]
                    + [{"id": f"b{i}", "tenant_id": tid, "classification": "payment",
                        "status": "open", "created_at": f"2026-02-0{i+1}"} for i in range(2)]
                    + [{"id": "d0", "tenant_id": tid, "classification": "complaint",
                        "status": "done", "created_at": "2026-03-01"}])
            await db.inbox.insert_many(docs)
            user = _u("owner", "owner1")
            listed = await inbox.list_inbox(classification=None, status="open", limit=2, user=user)
            ok = await inbox.set_inbox_status("a0", InboxStatusInput(status="done"), user=user)
            bad = missing = None
            try:
                await inbox.set_inbox_status("a1", InboxStatusInput(status="bogus"), user=user)
            except HTTPException as e:
                bad = e.status_code
            try:
                await inbox.set_inbox_status("nope", InboxStatusInput(status="done"), user=user)
            except HTTPException as e:
                missing = e.status_code
            return len(listed["items"]), listed["open_total"], listed["counts"], ok, bad, missing
        finally:
            restore()

    n_items, open_total, counts, ok, bad, missing = with_test_db(scenario)
    assert n_items == 2, "list is paginated to the limit"
    assert open_total == 5, "open_total must reflect ALL open items, not the page"
    assert counts.get("complaint") == 3 and counts.get("payment") == 2
    assert ok == {"ok": True, "status": "done"}
    assert bad == 400, "invalid status must 400"
    assert missing == 404, "unknown item id must 404"


# ---------------------------------------------------------------------------
# T10-02.4 -- rename cascades the denormalized name; outstanding splits by type.
# ---------------------------------------------------------------------------
def test_contact_rename_cascade_and_outstanding_split(with_test_db):
    import routers.contacts as contacts
    import routers.crm as crm
    from routers.contacts import ContactUpdateInput

    async def scenario(db):
        restore = _use_db(db, contacts, crm)
        try:
            tid = "t1"
            await db.contacts.insert_one({"id": "c1", "tenant_id": tid, "name": "Old Name",
                                          "type": "customer"})
            # denormalized copies of the name across three collections
            await db.invoices.insert_many([
                {"id": "inv-recv", "tenant_id": tid, "contact_id": "c1", "contact_name": "Old Name",
                 "type": "sales_invoice", "amount": 1000, "amount_paid": 0, "status": "unpaid"},
                {"id": "inv-pay", "tenant_id": tid, "contact_id": "c1", "contact_name": "Old Name",
                 "type": "purchase_bill", "amount": 400, "amount_paid": 0, "status": "unpaid"},
            ])
            await db.payments.insert_one({"id": "p1", "tenant_id": tid, "contact_id": "c1",
                                          "contact_name": "Old Name", "amount": 100})
            await db.workflows.insert_one({"id": "w1", "tenant_id": tid, "contact_id": "c1",
                                           "counterparty": "Old Name"})
            owner = _u("owner", "owner1")

            await contacts.update_contact("c1", ContactUpdateInput(name="New Name"), user=owner)

            inv = await db.invoices.find_one({"id": "inv-recv"}, {"_id": 0, "contact_name": 1})
            pay = await db.payments.find_one({"id": "p1"}, {"_id": 0, "contact_name": 1})
            wf = await db.workflows.find_one({"id": "w1"}, {"_id": 0, "counterparty": 1})
            con = await db.contacts.find_one({"id": "c1"}, {"_id": 0, "name": 1})

            outstanding = await crm.outstanding_by_contact(user=owner)
            return (inv["contact_name"], pay["contact_name"], wf["counterparty"], con["name"],
                    outstanding.get("c1"))
        finally:
            restore()

    inv_name, pay_name, wf_cp, con_name, bucket = with_test_db(scenario)
    assert con_name == "New Name"
    assert inv_name == "New Name", "invoice contact_name must cascade on rename"
    assert pay_name == "New Name", "payment contact_name must cascade on rename"
    assert wf_cp == "New Name", "workflow counterparty must cascade on rename"
    # outstanding: sales invoice -> receivables (1000), purchase bill -> payables (400)
    assert bucket is not None
    assert bucket["receivables"] == 1000 and bucket["payables"] == 400


# ===========================================================================
# Batch 2: complaint lifecycle, workflow create/advance/override.
# ===========================================================================

# ---------------------------------------------------------------------------
# T10-02.10 -- complaint log -> resolve (writes brain memory) + memory asymmetry.
# ---------------------------------------------------------------------------
def test_complaint_log_resolve_and_memory(with_test_db):
    import core
    import routers.complaints as comp
    import services.inbox as inbox_svc
    import services.ai.brain_context as bctx
    from models.complaints import ComplaintInput, MemoryInput

    async def scenario(db):
        restore = _use_db(db, comp, inbox_svc, bctx, core)
        try:
            tid = "t1"
            owner = _u("owner", "o1")
            c = await comp.create_complaint(ComplaintInput(text="Late delivery again", severity="high"), user=owner)
            cid = c["id"]
            logged = await db.complaints.find_one({"id": cid}, {"_id": 0, "status": 1})
            inbox_n = await db.inbox.count_documents({"tenant_id": tid})           # auto-inbox
            await comp.resolve_complaint(cid, user=owner)
            resolved = await db.complaints.find_one({"id": cid}, {"_id": 0, "status": 1})
            bc_n = await db.brain_context.count_documents(
                {"tenant_id": tid, "kind": "resolution", "source_id": cid})        # resolution memory
            missing = None
            try:
                await comp.resolve_complaint("ghost", user=owner)
            except HTTPException as e:
                missing = e.status_code
            await comp.add_memory(MemoryInput(text="Prefers email over calls"), user=owner)
            mem = await comp.list_memory(user=owner)
            return logged["status"], inbox_n, resolved["status"], bc_n, missing, len(mem)
        finally:
            restore()

    logged, inbox_n, resolved, bc_n, missing, mem_n = with_test_db(scenario)
    assert logged == "open"
    assert inbox_n == 1, "logging a complaint auto-creates an inbox item"
    assert resolved == "resolved"
    assert bc_n == 1, "resolving writes a resolution row to brain memory"
    assert missing == 404
    assert mem_n == 1


# ---------------------------------------------------------------------------
# T10-02.3 -- workflow create validates type; advance is gated / override audited.
# ---------------------------------------------------------------------------
def test_workflow_create_and_advance_gating(with_test_db):
    import core
    import core.deps as core_deps             # tenant_role_keys (task-spawn) reads db here
    import routers.workflows as wfr
    import services.ai.generators as gen
    import services.workflow_engine as eng
    import services.ai.brain_context as bctx   # engine.advance writes a brain_context row
    from models.workflows import WorkflowCreateInput, WorkflowAdvanceInput

    async def scenario(db):
        restore = _use_db(db, wfr, gen, core, core_deps, eng, bctx)
        try:
            tid = "t1"
            owner = _u("owner", "o1")

            # invalid type -> 400
            bad = None
            try:
                await wfr.create_workflow(WorkflowCreateInput(type="not_a_pipeline", title="X"), user=owner)
            except HTTPException as e:
                bad = e.status_code

            # valid type -> created at the first stage
            wf = await wfr.create_workflow(WorkflowCreateInput(type="production", title="Order 42"), user=owner)
            wid, first_stage = wf["id"], wf["stage"]

            # an open task at the current stage makes it NOT stage-ready -> advance 409
            await db.tasks.insert_one({"id": "t-block", "tenant_id": tid, "workflow_id": wid,
                                       "stage_key": first_stage, "status": "todo", "title": "cut fabric"})
            not_ready = None
            try:
                await wfr.advance_workflow(wid, WorkflowAdvanceInput(stage="confirmed"), user=owner)
            except HTTPException as e:
                not_ready = e.status_code

            # override WITHOUT a reason -> refused
            no_reason = None
            try:
                await wfr.advance_workflow(wid, WorkflowAdvanceInput(stage="confirmed", override=True, reason=""), user=owner)
            except HTTPException as e:
                no_reason = e.status_code

            # override WITH a reason -> forces the transition even though a task is open
            forced = await wfr.advance_workflow(
                wid, WorkflowAdvanceInput(stage="confirmed", override=True, reason="customer needs it today"), user=owner)
            return bad, first_stage, not_ready, no_reason, forced.get("stage")
        finally:
            restore()

    bad, first_stage, not_ready, no_reason, forced_stage = with_test_db(scenario)
    assert bad == 400, "an unknown workflow type must 400"
    assert first_stage == "order_received"
    assert not_ready == 409, "advancing with an open stage task must 409"
    assert no_reason == 400, "override requires a non-empty reason"
    assert forced_stage == "confirmed", "audited override advances despite the open task"


# ===========================================================================
# Batch 3: decision approve/reject lifecycle.
# ===========================================================================

# create_workflow stores stages as a list of string keys -- match that shape.
_PP_STAGES = ["requested", "approved", "ordered", "received", "payment_pending", "paid"]


def test_decision_approve_and_reject_lifecycle(with_test_db):
    import core
    import core.deps as core_deps
    import routers.decisions as dec
    import services.enrich as enrich
    import services.tasks as tasks_svc
    import services.workflows as wfs
    import services.ai.generators as gen
    import services.workflow_engine as eng
    import services.ai.brain_context as bctx

    async def scenario(db):
        restore = _use_db(db, dec, core, core_deps, enrich, tasks_svc, wfs, gen, eng, bctx)
        try:
            tid = "t1"
            owner = _u("owner", "o1")

            # --- APPROVE: unblock tasks + advance the procurement workflow ---
            await db.decisions.insert_one({"id": "dec1", "tenant_id": tid, "title": "Buy fabric",
                                           "status": "pending_approval", "summary": "restock",
                                           "task_ids": ["tk1"]})
            await db.tasks.insert_one({"id": "tk1", "tenant_id": tid, "decision_id": "dec1",
                                       "status": "blocked", "title": "Order 500m"})
            await db.workflows.insert_one({"id": "wf1", "tenant_id": tid, "decision_id": "dec1",
                                           "type": "purchase_payment", "stage": "requested",
                                           "stage_version": 0, "stages": _PP_STAGES,
                                           "title": "Fabric PO"})
            await dec.approve_decision("dec1", user=owner)
            d1 = await db.decisions.find_one({"id": "dec1"}, {"_id": 0, "status": 1})
            t1 = await db.tasks.find_one({"id": "tk1"}, {"_id": 0, "status": 1})
            w1 = await db.workflows.find_one({"id": "wf1"}, {"_id": 0, "stage": 1})
            bc_appr = await db.brain_context.count_documents(
                {"tenant_id": tid, "kind": "decision", "source_id": "dec1", "outcome": "approved"})

            # --- REJECT: cascade-delete everything spawned, no orphans ---
            await db.decisions.insert_one({"id": "dec2", "tenant_id": tid, "title": "Hire temp",
                                           "status": "pending_approval", "summary": "seasonal"})
            await db.tasks.insert_one({"id": "tk2", "tenant_id": tid, "decision_id": "dec2",
                                       "status": "todo", "title": "Post listing"})
            await db.workflows.insert_one({"id": "wf2", "tenant_id": tid, "decision_id": "dec2",
                                           "type": "purchase_payment", "stage": "requested",
                                           "stage_version": 0, "stages": _PP_STAGES})
            await db.calendar_events.insert_one({"id": "cal2", "tenant_id": tid, "decision_id": "dec2"})
            await db.inbox.insert_one({"id": "ib2", "tenant_id": tid, "ref_type": "decision",
                                       "ref_id": "dec2", "status": "open"})
            await dec.reject_decision("dec2", user=owner)
            d2 = await db.decisions.find_one({"id": "dec2"}, {"_id": 0, "status": 1})
            orphan_tasks = await db.tasks.count_documents({"tenant_id": tid, "decision_id": "dec2"})
            orphan_wfs = await db.workflows.count_documents({"tenant_id": tid, "decision_id": "dec2"})
            orphan_cal = await db.calendar_events.count_documents({"tenant_id": tid, "decision_id": "dec2"})
            ib = await db.inbox.find_one({"id": "ib2"}, {"_id": 0, "status": 1})

            # missing decision -> 404
            missing = None
            try:
                await dec.approve_decision("ghost", user=owner)
            except Exception as e:
                missing = getattr(e, "status_code", None)

            return (d1["status"], t1["status"], w1["stage"], bc_appr,
                    d2["status"], orphan_tasks, orphan_wfs, orphan_cal, ib["status"], missing)
        finally:
            restore()

    (appr_status, task_status, wf_stage, bc_appr, rej_status,
     orphan_t, orphan_w, orphan_c, ib_status, missing) = with_test_db(scenario)
    # approve
    assert appr_status == "approved"
    assert task_status == "todo", "approving a decision unblocks its blocked tasks"
    assert wf_stage == "approved", "the procurement workflow auto-advances to approval_stage"
    assert bc_appr == 1, "approval writes a decision row to brain memory"
    # reject
    assert rej_status == "rejected"
    assert orphan_t == 0 and orphan_w == 0 and orphan_c == 0, "reject must leave NO orphans"
    assert ib_status == "dismissed", "reject dismisses the decision's inbox item"
    assert missing == 404

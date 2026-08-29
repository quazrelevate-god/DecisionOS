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
from fastapi import HTTPException, BackgroundTasks


def _BG():
    return BackgroundTasks()


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


# ===========================================================================
# Batch 4: task lifecycle -- smart-route, evidence/approval gates, auto-invoice.
# ===========================================================================

def test_task_gates_smart_route_and_auto_invoice(with_test_db):
    from fastapi import BackgroundTasks
    import core
    import core.deps as core_deps
    import routers.tasks as tasks
    import services.tasks as tasks_svc   # enrich_task reads db here
    import services.voice as voice
    import services.notifications as notif
    from models.tasks import TaskUpdateInput, TaskCreateInput

    async def scenario(db):
        restore = _use_db(db, tasks, tasks_svc, core, core_deps, voice, notif)
        try:
            tid = "t1"
            owner = _u("owner", "o1")
            r = {}

            # --- smart-route: a role task with no assignee -> least-loaded member ---
            await db.tenants.insert_one({"id": tid, "roles": [{"key": "sales"}, {"key": "finance"},
                                                              {"key": "operations"}]})
            await db.users.insert_many([
                {"id": "s1", "tenant_id": tid, "role": "sales", "name": "Sana"},
                {"id": "s2", "tenant_id": tid, "role": "sales", "name": "Sam"},
            ])
            await db.memberships.insert_many([
                {"tenant_id": tid, "user_id": "s1", "status": "active"},
                {"tenant_id": tid, "user_id": "s2", "status": "active"},
            ])
            await db.tasks.insert_one({"id": "load1", "tenant_id": tid, "assignee_id": "s1",
                                       "status": "todo"})   # s1 has load, s2 has none
            created = await tasks.create_task(TaskCreateInput(title="Chase new leads", assignee_role="sales"),
                                              background=BackgroundTasks(), user=owner)
            r["routed_to"] = created.get("assignee_id")

            # --- evidence gate: evidence_required + no proof -> done is 400 ---
            await db.tasks.insert_one({"id": "ev", "tenant_id": tid, "status": "todo", "title": "Upload proof",
                                       "evidence_required": True, "attachments": []})
            try:
                await tasks.update_task("ev", TaskUpdateInput(status="done"), user=owner)
                r["evidence_gate"] = None
            except HTTPException as e:
                r["evidence_gate"] = e.status_code

            # --- approval gate: unapproved task cannot start ---
            await db.tasks.insert_one({"id": "ap", "tenant_id": tid, "status": "blocked", "title": "Awaiting approval",
                                       "approval_required": True, "approval_status": "pending"})
            try:
                await tasks.update_task("ap", TaskUpdateInput(status="in_progress"), user=owner)
                r["approval_gate"] = None
            except HTTPException as e:
                r["approval_gate"] = e.status_code

            # --- valid completion ---
            await db.tasks.insert_one({"id": "ok", "tenant_id": tid, "status": "todo", "title": "Simple task"})
            await tasks.update_task("ok", TaskUpdateInput(status="done"), user=owner)
            done = await db.tasks.find_one({"id": "ok"}, {"_id": 0, "status": 1, "progress": 1})
            r["done_status"], r["done_progress"] = done["status"], done.get("progress")

            # --- invalid status / missing ---
            try:
                await tasks.update_task("ok", TaskUpdateInput(status="bogus"), user=owner)
                r["bad_status"] = None
            except HTTPException as e:
                r["bad_status"] = e.status_code
            try:
                await tasks.update_task("ghost", TaskUpdateInput(status="done"), user=owner)
                r["missing"] = None
            except HTTPException as e:
                r["missing"] = e.status_code

            # --- auto-invoice on done, idempotent by source_task_id ---
            await db.tasks.insert_one({"id": "inv", "tenant_id": tid, "status": "todo",
                                       "title": "Raise invoice for order 42", "amount": 5000,
                                       "contact_id": "c1"})
            await tasks.update_task("inv", TaskUpdateInput(status="done"), user=owner)
            after_first = await db.invoices.count_documents({"tenant_id": tid, "source_task_id": "inv"})
            # re-running the generator must NOT create a second invoice
            t_inv = await db.tasks.find_one({"id": "inv"}, {"_id": 0})
            await tasks._maybe_auto_invoice(tid, owner["id"], t_inv, "inv")
            after_second = await db.invoices.count_documents({"tenant_id": tid, "source_task_id": "inv"})
            r["inv_first"], r["inv_second"] = after_first, after_second
            return r
        finally:
            restore()

    r = with_test_db(scenario)
    assert r["routed_to"] == "s2", "a role task auto-routes to the least-loaded member"
    assert r["evidence_gate"] == 400, "evidence_required blocks done without proof"
    assert r["approval_gate"] == 403, "an unapproved task cannot be started"
    assert r["done_status"] == "done" and r["done_progress"] == 100
    assert r["bad_status"] == 400
    assert r["missing"] == 404
    assert r["inv_first"] == 1, "completing an invoice-task auto-creates a draft invoice"
    assert r["inv_second"] == 1, "auto-invoice is idempotent (source_task_id dedup)"


# ===========================================================================
# Batch 5: leave request/approve + attendance upsert.
# ===========================================================================

def test_leave_request_validation_approve_and_attendance(with_test_db):
    import core
    import core.deps as core_deps
    import routers.team as team
    import services.leave as leave_svc
    import services.notifications as notif
    from models.team import LeaveRequestInput, LeaveDecisionInput, AttendanceInput

    async def scenario(db):
        restore = _use_db(db, team, leave_svc, notif, core, core_deps)
        try:
            tid = "t1"
            owner = _u("owner", "o1")
            emp = _u("sales", "e1")
            r = {}

            # bad leave type -> 400
            try:
                await team.create_leave(LeaveRequestInput(leave_type="vacation", from_date="2026-06-01",
                                                          to_date="2026-06-02", day_portion="full", reason="x"), user=emp)
                r["bad_type"] = None
            except HTTPException as e:
                r["bad_type"] = e.status_code

            # end before start -> 400
            try:
                await team.create_leave(LeaveRequestInput(leave_type="casual", from_date="2026-06-05",
                                                          to_date="2026-06-01", day_portion="full", reason="x"), user=emp)
                r["bad_range"] = None
            except HTTPException as e:
                r["bad_range"] = e.status_code

            # valid request -> pending
            created = await team.create_leave(LeaveRequestInput(leave_type="casual", from_date="2026-06-01",
                                                                to_date="2026-06-03", day_portion="full",
                                                                reason="family"), user=emp)
            lid = created["id"]
            r["created_status"] = created.get("status")

            # approve -> approved
            await team.approve_leave(lid, LeaveDecisionInput(note="approved, enjoy"), user=owner)
            after = await db.leaves.find_one({"id": lid}, {"_id": 0, "status": 1})
            r["approved_status"] = after["status"]

            # attendance upsert: same (user, date) twice -> one row, latest status
            await team.mark_attendance(AttendanceInput(user_id="e1", status="absent", date="2026-06-10"), user=owner)
            await team.mark_attendance(AttendanceInput(user_id="e1", status="present", date="2026-06-10"), user=owner)
            att = await db.attendance.find({"tenant_id": tid, "user_id": "e1", "date": "2026-06-10"}, {"_id": 0}).to_list(10)
            r["att_count"], r["att_status"] = len(att), (att[0]["status"] if att else None)
            return r
        finally:
            restore()

    r = with_test_db(scenario)
    assert r["bad_type"] == 400, "an unknown leave type must 400"
    assert r["bad_range"] == 400, "end-before-start must 400"
    assert r["created_status"] == "pending"
    assert r["approved_status"] == "approved"
    assert r["att_count"] == 1, "attendance upserts one row per (user, date)"
    assert r["att_status"] == "present", "the latest mark wins"


# ===========================================================================
# Batch 6: WhatsApp webhook verify + HMAC gates (pure -- unit tier).
# ===========================================================================

def test_whatsapp_verify_and_webhook_gates(monkeypatch):
    import asyncio
    import routers.whatsapp as wa
    from starlette.datastructures import QueryParams, Headers
    from fastapi import BackgroundTasks

    class _Req:
        def __init__(self, query=None, headers=None, body=b""):
            self.query_params = QueryParams(query or {})
            self.headers = Headers(headers or {})
            self._b = body

        async def body(self):
            return self._b

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(wa, "log_wa_event", _noop)   # 403 path audits before rejecting -> skip the db write

    r = {}
    # --- verify handshake: challenge echoed only on mode+token match ---
    monkeypatch.setenv("WA_VERIFY_TOKEN", "vtok")
    resp = asyncio.run(wa.whatsapp_verify(_Req(query={"hub.mode": "subscribe",
                                                      "hub.verify_token": "vtok", "hub.challenge": "C42"})))
    r["challenge"] = resp.body.decode()
    try:
        asyncio.run(wa.whatsapp_verify(_Req(query={"hub.mode": "subscribe", "hub.verify_token": "WRONG"})))
        r["verify_bad"] = None
    except HTTPException as e:
        r["verify_bad"] = e.status_code

    # --- not configured: no WA_ACCESS_TOKEN -> JSON no-op, never processes ---
    monkeypatch.delenv("WA_ACCESS_TOKEN", raising=False)
    out = asyncio.run(wa.whatsapp_webhook(_Req(body=b"{}"), BackgroundTasks()))
    r["not_configured"] = out.get("status")

    # --- configured + signature mismatch -> 403 ---
    monkeypatch.setenv("WA_ACCESS_TOKEN", "tok")
    monkeypatch.setenv("WA_APP_SECRET", "secret")
    monkeypatch.setenv("ENV", "dev")
    try:
        asyncio.run(wa.whatsapp_webhook(_Req(headers={"X-Hub-Signature-256": "sha256=deadbeef"}, body=b"{}"),
                                        BackgroundTasks()))
        r["mismatch"] = None
    except HTTPException as e:
        r["mismatch"] = e.status_code

    # --- prod + no secret -> 503 (refuse forged-message surface) ---
    monkeypatch.setenv("WA_ACCESS_TOKEN", "tok")
    monkeypatch.delenv("WA_APP_SECRET", raising=False)
    monkeypatch.setenv("ENV", "prod")
    try:
        asyncio.run(wa.whatsapp_webhook(_Req(body=b"{}"), BackgroundTasks()))
        r["prod_no_secret"] = None
    except HTTPException as e:
        r["prod_no_secret"] = e.status_code

    assert r["challenge"] == "C42", "verify echoes the challenge on a valid handshake"
    assert r["verify_bad"] == 403, "a bad verify token is rejected"
    assert r["not_configured"] == "not_configured", "unconfigured webhook is a JSON no-op"
    assert r["mismatch"] == 403, "a forged signature is rejected"
    assert r["prod_no_secret"] == 503, "prod without WA_APP_SECRET refuses the webhook"


# ===========================================================================
# Batch 7: ledger typed CRUD + payment matching + delete cascade (T10-02.6).
# (AI OCR path — /expenses/with-file — is exercised in the S2.5 ingest tests.)
# ===========================================================================

def test_ledger_typed_crud_payment_match_and_delete_cascade(with_test_db):
    import core
    import core.deps as core_deps
    import routers.ledger as led
    import services.ai.brain_context as bctx
    from models.finance import ExpenseInput

    async def scenario(db):
        restore = _use_db(db, led, core, core_deps, bctx)
        try:
            tid = "t1"
            owner = _u("owner", "o1")
            r = {}

            # --- typed expense CRUD ---
            exp = await led.add_expense(ExpenseInput(title="Godown rent", amount=5000, category="Rent"),
                                        user=owner)
            r["expense_saved"] = await db.expenses.count_documents({"id": exp["id"], "tenant_id": tid})

            # --- payment match: inbound partial leaves the invoice partial ---
            await db.invoices.insert_one({"id": "i1", "tenant_id": tid, "type": "sales_invoice",
                                          "number": "INV-1", "amount": 1000, "amount_paid": 0,
                                          "status": "unpaid", "contact_name": "Acme"})
            await db.payments.insert_one({"id": "pay1", "tenant_id": tid, "direction": "in",
                                          "amount": 600, "applied": 0, "invoice_number": "INV-1"})
            pay1 = {"id": "pay1", "tenant_id": tid, "direction": "in", "amount": 600,
                    "applied": 0, "invoice_number": "INV-1"}
            await led.reconcile_payment(tid, pay1, "test")
            inv1 = await db.invoices.find_one({"id": "i1"}, {"_id": 0, "amount_paid": 1, "status": 1})
            r["partial_paid"], r["partial_status"] = inv1["amount_paid"], inv1["status"]

            # --- payment match: overpay leaves a remainder on the payment ---
            await db.invoices.insert_one({"id": "i2", "tenant_id": tid, "type": "sales_invoice",
                                          "number": "INV-2", "amount": 500, "amount_paid": 0,
                                          "status": "unpaid", "contact_name": "Beta"})
            await db.payments.insert_one({"id": "pay2", "tenant_id": tid, "direction": "in",
                                          "amount": 800, "applied": 0, "invoice_number": "INV-2"})
            pay2 = {"id": "pay2", "tenant_id": tid, "direction": "in", "amount": 800,
                    "applied": 0, "invoice_number": "INV-2"}
            await led.reconcile_payment(tid, pay2, "test")
            inv2 = await db.invoices.find_one({"id": "i2"}, {"_id": 0, "status": 1})
            p2 = await db.payments.find_one({"id": "pay2"}, {"_id": 0, "applied": 1, "match_status": 1})
            r["over_inv_status"] = inv2["status"]
            r["over_applied"], r["over_match"] = p2["applied"], p2.get("match_status")

            # --- no confident match -> unmatched ---
            pay3 = {"id": "pay3", "tenant_id": tid, "direction": "in", "amount": 999,
                    "applied": 0, "invoice_number": "NOPE", "contact_name": ""}
            await db.payments.insert_one(dict(pay3))
            await led.reconcile_payment(tid, pay3, "test")
            p3 = await db.payments.find_one({"id": "pay3"}, {"_id": 0, "match_status": 1})
            r["unmatched"] = p3.get("match_status")

            # --- delete revenue cascades its payments; missing -> 404 ---
            await db.invoices.insert_one({"id": "i3", "tenant_id": tid, "type": "sales_invoice",
                                          "number": "INV-3", "amount": 200, "status": "unpaid"})
            await db.payments.insert_one({"id": "pay4", "tenant_id": tid, "invoice_id": "i3",
                                          "direction": "in", "amount": 200})
            await led.delete_revenue_invoice("i3", user=owner)
            r["inv_gone"] = await db.invoices.count_documents({"id": "i3"})
            r["pay_cascaded"] = await db.payments.count_documents({"invoice_id": "i3"})
            missing = None
            try:
                await led.delete_revenue_invoice("ghost", user=owner)
            except HTTPException as e:
                missing = e.status_code
            r["missing"] = missing
            return r
        finally:
            restore()

    r = with_test_db(scenario)
    assert r["expense_saved"] == 1
    assert r["partial_paid"] == 600 and r["partial_status"] == "partial", "partial payment leaves invoice partial"
    assert r["over_inv_status"] == "paid", "overpayment settles the invoice"
    assert r["over_applied"] == 500 and r["over_match"] == "partial", "the 300 remainder stays on the payment"
    assert r["unmatched"] == "unmatched", "no confident match -> stays in the queue"
    assert r["inv_gone"] == 0 and r["pay_cascaded"] == 0, "deleting revenue cascades its payments"
    assert r["missing"] == 404


# ===========================================================================
# Batch 8: meeting + voice text intake (T10-02.9 / T10-02.8).
# Background AI/STT jobs are queued (not run in a direct call), so these pin the
# request-side contract; the STT-failure path is covered separately below.
# ===========================================================================

def test_meeting_text_intake_and_cross_tenant_404(with_test_db):
    import routers.meetings as meet
    from models.voice import TextNoteInput

    async def scenario(db):
        restore = _use_db(db, meet)
        try:
            owner = _u("owner", "o1", tid="t1")
            out = await meet.create_meeting_text(TextNoteInput(text="Discussed Q3 targets"),
                                                 background=_BG(), user=owner)
            rec = await db.meetings.find_one({"id": out["id"]}, {"_id": 0, "title": 1, "status": 1})
            got = await meet.get_meeting(out["id"], user=owner)
            # cross-tenant + missing -> 404
            other = _u("owner", "x1", tid="t2")
            cross = missing = None
            try:
                await meet.get_meeting(out["id"], user=other)
            except HTTPException as e:
                cross = e.status_code
            try:
                await meet.get_meeting("ghost", user=owner)
            except HTTPException as e:
                missing = e.status_code
            return out["status"], rec["title"], rec["status"], got["id"], cross, missing
        finally:
            restore()

    status, title, rec_status, got_id, cross, missing = with_test_db(scenario)
    assert status == "queued" and rec_status == "queued"
    assert title == "Processing meeting…", "record starts in a Processing state until the job finishes"
    assert cross == 404, "another tenant cannot read this meeting"
    assert missing == 404


def test_voice_text_note_queues_and_empty_is_400(with_test_db):
    import routers.voice_notes as vn
    from models.voice import TextNoteInput

    async def scenario(db):
        restore = _use_db(db, vn)
        try:
            owner = _u("owner", "o1")
            out = await vn.create_text_note(TextNoteInput(text="Order 50 bags of cement"),
                                            background=_BG(), user=owner)
            note = await db.voice_notes.find_one({"id": out["id"]}, {"_id": 0, "status": 1})
            empty = None
            try:
                await vn.create_text_note(TextNoteInput(text="   "), background=_BG(), user=owner)
            except HTTPException as e:
                empty = e.status_code
            return out["status"], note["status"], empty
        finally:
            restore()

    status, note_status, empty = with_test_db(scenario)
    assert status == "queued" and note_status == "queued"
    assert empty == 400, "an empty directive with no attachment is rejected"


def test_transcribe_only_stt_failure_is_503(monkeypatch):
    import asyncio
    import io
    import routers.voice_notes as vn
    from starlette.datastructures import UploadFile

    async def _boom(*a, **k):
        raise RuntimeError("Sarvam unavailable")
    monkeypatch.setattr(vn, "transcribe_audio", _boom)

    owner = _u("owner", "o1")
    uf = UploadFile(file=io.BytesIO(b"fake-audio"), filename="clip.mp3")
    code = None
    try:
        asyncio.run(vn.transcribe_only(file=uf, language="auto", user=owner))
    except HTTPException as e:
        code = e.status_code
    assert code == 503, "an STT provider failure surfaces as 503"


# ===========================================================================
# Batch 9 (final): ingest commit idempotency + Ask RBAC / INSUFFICIENT_DATA.
# ===========================================================================

def test_ingest_commit_is_idempotent(with_test_db):
    import core
    import core.deps as core_deps
    import routers.finance as fin
    import services.ingestion as ingestion
    from models.finance import IngestCommitInput

    async def scenario(db):
        restore = _use_db(db, fin, ingestion, core, core_deps)
        try:
            tid = "t1"
            owner = _u("owner", "o1")
            await db.ingestions.insert_one({"id": "ing1", "tenant_id": tid, "status": "review",
                                            "source": "upload", "filename": "bills.pdf",
                                            "inbox_id": "ib1"})
            await db.inbox.insert_one({"id": "ib1", "tenant_id": tid, "status": "open"})

            first = await fin.commit_ingestion("ing1", IngestCommitInput(records={}), user=owner)
            ing = await db.ingestions.find_one({"id": "ing1"}, {"_id": 0, "status": 1})
            ib = await db.inbox.find_one({"id": "ib1"}, {"_id": 0, "status": 1})

            dup = None
            try:
                await fin.commit_ingestion("ing1", IngestCommitInput(records={}), user=owner)
            except HTTPException as e:
                dup = e.status_code
            missing = None
            try:
                await fin.commit_ingestion("ghost", IngestCommitInput(records={}), user=owner)
            except HTTPException as e:
                missing = e.status_code
            return first.get("filed"), ing["status"], ib["status"], dup, missing
        finally:
            restore()

    filed, ing_status, ib_status, dup, missing = with_test_db(scenario)
    assert filed is True
    assert ing_status == "filed", "a committed ingestion is marked filed"
    assert ib_status == "done", "committing closes the source inbox item"
    assert dup == 400, "committing an already-filed upload is rejected"
    assert missing == 404

def test_ask_finance_intent_denied_and_insufficient_data(with_test_db):
    import core
    import core.deps as core_deps
    import routers.brain as brain
    import services.ai.brain_rbac as brain_rbac
    from models.brain import AskRequest

    async def scenario(db):
        restore = _use_db(db, brain, core, core_deps)
        # deterministic, offline: control the intent classifier + the LLM planner.
        saved = (brain_rbac.classify_intent, brain_rbac.allowed_intents, brain._plan)
        try:
            # --- a non-finance user asking a money question is refused up front ---
            brain_rbac.classify_intent = lambda q: "finance"
            brain_rbac.allowed_intents = lambda u: {"operations"}
            denied = await brain.ask(AskRequest(question="What are our total sales this month?"),
                                     user=_u("sales", "s1"))

            # --- second guard: even if the intent passes, a plan that NEEDS finance
            #     is refused for a non-finance user (defence in depth, no LLM call) ---
            brain_rbac.classify_intent = lambda q: "operations"
            brain_rbac.allowed_intents = lambda u: {"operations", "finance"}

            async def _fake_plan(question, prev, lang):
                return {"primary_entity": "invoice", "needs_finance": True, "metrics": [],
                        "filters": {}, "intent": "operations", "entities": []}
            brain._plan = _fake_plan
            plan_denied = await brain.ask(AskRequest(question="How is business doing?"),
                                          user=_u("sales", "s1"))
            return denied.get("type"), plan_denied.get("type")
        finally:
            brain_rbac.classify_intent, brain_rbac.allowed_intents, brain._plan = saved
            restore()

    intent_denied, plan_denied = with_test_db(scenario)
    assert intent_denied == "PERMISSION_DENIED", "intent gate: a non-finance user can't ask money questions"
    assert plan_denied == "PERMISSION_DENIED", "plan gate: a finance-needing plan is refused for non-finance users"

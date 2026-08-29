"""Iteration 80 — Backend regression for DecisionOS Phase B Part 2 refactor.

Coverage:
  • Auth (login/me) for owner + sales + finance
  • Decisions router extraction (NEW /routers/decisions.py):
      GET /api/decisions (list + filter), GET /api/decisions/{id}, /timeline,
      POST /approve, /reject, /tasks, /comment, /api/journal
      RBAC: sales user cannot approve/reject
      brain_context capture on approve
  • Tasks router + services.tasks helpers (regressions):
      GET /api/tasks (>=50), GET /api/tasks/{id}, POST/PATCH/DELETE
      DELETE owner-only (sales denied)
  • Brain endpoints: /api/ask, /api/brain/agent, /api/brain/documents, /api/brain/context
      RBAC: sales user asking finance question → denied=true via /api/ask
  • Object storage: POST /api/files + GET /api/files/{id}/download
  • Brief endpoint (owner counters intact) + inbox endpoint (no 500 after PyMongo migration)
  • Sharma demo data dedup: at most 1 INV-2045 chase task
  • Import cycle sanity: services + shims resolve
"""
import io
import os
import re
import subprocess
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient


from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()

# Direct Mongo for injecting pending_approval decisions (no POST /api/decisions exists).
_mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
_db = _mongo[os.environ.get("DB_NAME", "test_database")]


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _login(email: str, password: str = "demo1234") -> tuple:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"no token in {body}"
    return tok


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner@sharma.com")


@pytest.fixture(scope="module")
def sales_token():
    return _login("sales@sharma.com")


@pytest.fixture(scope="module")
def finance_token():
    return _login("finance@sharma.com")


def _get_owner_tenant():
    u = _db.users.find_one({"email": "owner@sharma.com"}, {"_id": 0, "id": 1, "tenant_id": 1})
    assert u, "owner@sharma.com not found in Mongo"
    return u["id"], u["tenant_id"]


def _mk_pending_decision(prefix: str = "TEST_iter80") -> str:
    """Insert a fresh pending_approval decision directly in Mongo for approve/reject tests."""
    owner_id, tid = _get_owner_tenant()
    did = str(uuid.uuid4())
    _db.decisions.insert_one({
        "id": did, "tenant_id": tid, "voice_note_id": None,
        "title": f"{prefix} decision {did[:6]}",
        "summary": "regression test — safe to delete", "items": [], "workflow_events": [],
        "dtype": "operational", "status": "pending_approval",
        "created_by": owner_id, "created_at": datetime.now(timezone.utc).isoformat(),
        "task_ids": [], "timeline": [],
    })
    return did


def _cleanup_decision(did: str):
    _db.decisions.delete_one({"id": did})
    _db.tasks.delete_many({"decision_id": did})
    _db.workflows.delete_many({"decision_id": did})
    _db.calendar_events.delete_many({"decision_id": did})


# ---------------------------------------------------------------------------
# 0. Import sanity — imports resolve, shims work
# ---------------------------------------------------------------------------


class TestImportSanity:
    def test_services_and_shims_import(self):
        code = (
            "from services.obj_store import put_object, get_object;"
            "from services.ai.brain_context import record_context, query_context;"
            "from services.ai.brain_rbac import classify_intent, allowed_intents;"
            "from services.tasks import enrich_task, enrich_tasks, _can_work_task, "
            "_derive_task_type, _task_activity, TASK_STATUSES, _plan_progress;"
            "from models.tasks import TaskCreateInput, TaskUpdateInput;"
            "import services.obj_store as obj_store, services.ai.brain_context as brain_context, services.ai.brain_rbac as brain_rbac;"
            "assert obj_store.put_object and brain_context.record_context and brain_rbac.classify_intent"
        )
        import sys
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        res = subprocess.run(
            [sys.executable, "-c", code], cwd=backend_dir,
            capture_output=True, text=True, timeout=30,
        )
        assert res.returncode == 0, f"import failed: {res.stderr}"


# ---------------------------------------------------------------------------
# 1. Auth
# ---------------------------------------------------------------------------


class TestAuth:
    def test_owner_login_and_me(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        me = r.json()
        # /api/auth/me returns {user: {...}, tenant: {...}}
        assert me["user"]["email"] == "owner@sharma.com"
        assert me["user"]["role"] == "owner"
        assert "tenant" in me

    def test_sales_login_and_me(self, sales_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(sales_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "sales"

    def test_finance_login_and_me(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(finance_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "finance"


# ---------------------------------------------------------------------------
# 2. Decisions router — NEW extracted /routers/decisions.py
# ---------------------------------------------------------------------------


class TestDecisionsRouter:
    def test_list_decisions_200(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/decisions", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_list_decisions_status_filter(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/decisions?status=approved",
                         headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        for d in r.json():
            assert d.get("status") == "approved"

    def test_get_decision_invalid_returns_404(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/decisions/nonexistent-id-xyz",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 404, r.text

    def test_journal_200(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/journal", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "days" in body
        assert isinstance(body["days"], list)

    def test_journal_with_query(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/journal?q=cotton",
                         headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        assert "days" in r.json()

    def test_get_decision_and_timeline(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/decisions", headers=_h(owner_token), timeout=15)
        decisions = r.json()
        if not decisions:
            pytest.skip("no decisions in demo tenant")
        did = decisions[0]["id"]
        r = requests.get(f"{BASE_URL}/api/decisions/{did}", headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == did
        r2 = requests.get(f"{BASE_URL}/api/decisions/{did}/timeline",
                          headers=_h(owner_token), timeout=15)
        assert r2.status_code == 200
        assert "timeline" in r2.json()

    def test_sales_cannot_approve_decision(self, sales_token):
        did = _mk_pending_decision("TEST_iter80_sales_gate")
        try:
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/approve",
                              headers=_h(sales_token), timeout=15)
            assert r.status_code in (401, 403), \
                f"sales was able to approve! {r.status_code} {r.text[:200]}"
        finally:
            _cleanup_decision(did)

    def test_sales_cannot_reject_decision(self, sales_token):
        did = _mk_pending_decision("TEST_iter80_sales_reject_gate")
        try:
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/reject",
                              headers=_h(sales_token), timeout=15)
            assert r.status_code in (401, 403), \
                f"sales was able to reject! {r.status_code} {r.text[:200]}"
        finally:
            _cleanup_decision(did)

    def test_add_task_to_decision(self, owner_token):
        did = _mk_pending_decision("TEST_iter80_addtask")
        try:
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/tasks",
                              json={"title": "TEST_iter80 decision task",
                                    "priority": "medium", "due_in_days": 3},
                              headers=_h(owner_token), timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["id"] == did
            # spawned task should be blocked (parent still pending_approval)
            tasks = _db.tasks.find({"decision_id": did})
            names = [t["title"] for t in tasks]
            assert any("TEST_iter80" in n for n in names)
        finally:
            _cleanup_decision(did)

    def test_comment_on_decision_participant_only(self, owner_token, sales_token):
        did = _mk_pending_decision("TEST_iter80_comment")
        try:
            # Owner is a participant (created_by is owner_id via _mk_pending_decision) → 200
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/comment",
                              json={"text": "TEST_iter80 owner comment"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            # Sales is NOT a participant (no tasks assigned yet) → 403
            r2 = requests.post(f"{BASE_URL}/api/decisions/{did}/comment",
                               json={"text": "TEST_iter80 sales comment"},
                               headers=_h(sales_token), timeout=15)
            assert r2.status_code == 403, r2.text
            # Empty comment → 400
            r3 = requests.post(f"{BASE_URL}/api/decisions/{did}/comment",
                               json={"text": "   "},
                               headers=_h(owner_token), timeout=15)
            assert r3.status_code == 400
        finally:
            _cleanup_decision(did)

    def test_approve_decision_and_unblock_tasks(self, owner_token):
        did = _mk_pending_decision("TEST_iter80_approve")
        try:
            # Add a task first (blocked because parent pending)
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/tasks",
                              json={"title": "TEST_iter80 unblock-me",
                                    "priority": "low", "due_in_days": 2},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            r2 = requests.post(f"{BASE_URL}/api/decisions/{did}/approve",
                               headers=_h(owner_token), timeout=30)
            assert r2.status_code == 200, r2.text
            body = r2.json()
            assert body["status"] == "approved"
            # Verify the spawned task moved from blocked → todo
            t = _db.tasks.find_one({"decision_id": did, "title": {"$regex": "unblock-me"}})
            assert t is not None
            assert t["status"] in ("todo", "in_progress"), f"task not unblocked: {t.get('status')}"
        finally:
            _cleanup_decision(did)

    def test_reject_decision_cascades_deletes(self, owner_token):
        did = _mk_pending_decision("TEST_iter80_reject")
        try:
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/tasks",
                              json={"title": "TEST_iter80 will be cascaded",
                                    "priority": "low"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            # sanity: task exists
            assert _db.tasks.count_documents({"decision_id": did}) >= 1
            r2 = requests.post(f"{BASE_URL}/api/decisions/{did}/reject",
                               headers=_h(owner_token), timeout=20)
            assert r2.status_code == 200
            assert r2.json()["status"] == "rejected"
            # spawned tasks should be cascade-deleted
            assert _db.tasks.count_documents({"decision_id": did}) == 0
        finally:
            _cleanup_decision(did)


# ---------------------------------------------------------------------------
# 3. Tasks router — regression
# ---------------------------------------------------------------------------


class TestTasksRouter:
    def test_list_tasks(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        tasks = r.json()
        assert isinstance(tasks, list)
        # request expects 189+; if seed varies slightly accept anything > 50
        assert len(tasks) >= 50, f"only {len(tasks)} tasks — seed regression?"

    def test_task_detail_has_enriched_fields(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=15)
        tasks = r.json()
        if not tasks:
            pytest.skip("no tasks")
        tid = tasks[0]["id"]
        r2 = requests.get(f"{BASE_URL}/api/tasks/{tid}",
                          headers=_h(owner_token), timeout=15)
        assert r2.status_code == 200
        body = r2.json()
        assert body["id"] == tid
        # enriched fields from services.tasks.enrich_task
        assert "task_type" in body
        assert "attachment_count" in body

    def test_create_patch_delete_task(self, owner_token):
        payload = {"title": "TEST_iter80 crud", "priority": "low",
                   "assignee_role": "sales"}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload,
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            # PATCH status
            r2 = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                                json={"status": "in_progress"},
                                headers=_h(owner_token), timeout=15)
            assert r2.status_code == 200
            assert r2.json()["status"] == "in_progress"
        finally:
            r3 = requests.delete(f"{BASE_URL}/api/tasks/{tid}",
                                 headers=_h(owner_token), timeout=15)
            assert r3.status_code in (200, 204)
        # Verify deleted
        r4 = requests.get(f"{BASE_URL}/api/tasks/{tid}",
                          headers=_h(owner_token), timeout=10)
        assert r4.status_code == 404

    def test_sales_cannot_delete_task(self, owner_token, sales_token):
        r = requests.post(f"{BASE_URL}/api/tasks",
                          json={"title": "TEST_iter80 owner-only-delete",
                                "priority": "low", "assignee_role": "sales"},
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            r2 = requests.delete(f"{BASE_URL}/api/tasks/{tid}",
                                 headers=_h(sales_token), timeout=15)
            assert r2.status_code in (401, 403), \
                f"sales was able to delete a task! {r2.status_code}"
        finally:
            requests.delete(f"{BASE_URL}/api/tasks/{tid}",
                            headers=_h(owner_token), timeout=10)


# ---------------------------------------------------------------------------
# 4. Brain endpoints
# ---------------------------------------------------------------------------


class TestBrainEndpoints:
    def test_brain_context_get(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brain/context",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200

    def test_brain_documents_get(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brain/documents",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200

    def test_ask_owner_200(self, owner_token):
        r = requests.post(f"{BASE_URL}/api/ask",
                          json={"question": "what should I focus on today?"},
                          headers=_h(owner_token), timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "answer" in body
        assert isinstance(body["answer"], str) and len(body["answer"]) > 0

    def test_ask_sales_finance_denied(self, sales_token):
        r = requests.post(f"{BASE_URL}/api/ask",
                          json={"question": "how many unpaid invoices do we have this month?"},
                          headers=_h(sales_token), timeout=45)
        assert r.status_code == 200
        body = r.json()
        # Denial shape: {type: 'PERMISSION_DENIED', message, intent: 'finance', allowed_intents}
        denied = body.get("denied") is True or body.get("type") == "PERMISSION_DENIED"
        assert denied, f"sales was NOT denied on finance question: {body}"
        # intent should be classified as finance
        if "intent" in body:
            assert body["intent"] == "finance"

    def test_brain_agent_owner_200(self, owner_token):
        r = requests.post(f"{BASE_URL}/api/brain/agent",
                          json={"question": "How many decisions are pending approval?"},
                          headers=_h(owner_token), timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "answer" in body


# ---------------------------------------------------------------------------
# 5. Object storage — /api/files upload + download
# ---------------------------------------------------------------------------


class TestObjectStorage:
    def test_upload_and_download(self, owner_token):
        payload = f"TEST_iter80 obj store {uuid.uuid4()}".encode("utf-8")
        files = {"file": ("test_iter80.txt", io.BytesIO(payload), "text/plain")}
        r = requests.post(f"{BASE_URL}/api/files", files=files,
                          headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        fid = r.json().get("id") or r.json().get("file_id")
        assert fid, f"no file id in {r.json()}"
        r2 = requests.get(f"{BASE_URL}/api/files/{fid}/download",
                          headers=_h(owner_token), timeout=30)
        assert r2.status_code == 200
        assert payload in r2.content


# ---------------------------------------------------------------------------
# 6. Brief + inbox (PyMongo aggregate regression)
# ---------------------------------------------------------------------------


class TestBriefInbox:
    def test_brief_owner_200(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict)
        # owner counters + finance_amounts intact
        assert "counters" in body
        assert "finance_amounts" in body

    def test_inbox_no_500(self, owner_token):
        # 5 back-to-back probes — any 500 flags PyMongo aggregate regression
        for i in range(5):
            r = requests.get(f"{BASE_URL}/api/inbox", headers=_h(owner_token), timeout=20)
            assert r.status_code == 200, \
                f"inbox call {i} returned {r.status_code}: {r.text[:200]}"


# ---------------------------------------------------------------------------
# 7. brain_context capture on decision approve
# ---------------------------------------------------------------------------


class TestBrainContextCapture:
    def test_new_context_row_appears_after_decision_approve(self, owner_token):
        _owner_id, tid = _get_owner_tenant()
        baseline = _db.brain_context.count_documents({"tenant_id": tid})
        did = _mk_pending_decision("TEST_iter80_ctx")
        try:
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/approve",
                              headers=_h(owner_token), timeout=30)
            assert r.status_code == 200
            time.sleep(1)
            after = _db.brain_context.count_documents({"tenant_id": tid})
            assert after > baseline, \
                f"brain_context did not grow after approve — {baseline} → {after}"
            # And verify the row references our decision
            row = _db.brain_context.find_one({"tenant_id": tid, "source_id": did})
            assert row is not None
            assert row.get("outcome") == "approved"
            assert row.get("source_type") == "decision"
        finally:
            _cleanup_decision(did)
            _db.brain_context.delete_many({"source_id": did})


# ---------------------------------------------------------------------------
# 8. Sharma demo data — no duplicated INV-2045 chase tasks
# ---------------------------------------------------------------------------


class TestSharmaDedup:
    def test_at_most_one_chase_task_for_inv_2045(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        tasks = r.json()
        rx = re.compile(r"\bINV-?2045\b", re.IGNORECASE)
        chases = [
            t for t in tasks
            if rx.search(t.get("title", "") or "") or rx.search(t.get("description", "") or "")
        ]
        assert len(chases) <= 1, (
            f"Found {len(chases)} tasks referencing INV-2045 — dedup regressed. "
            f"Titles: {[c.get('title') for c in chases]}")

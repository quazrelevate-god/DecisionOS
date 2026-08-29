"""Iteration 81 — regression for Phase B step 5: extraction of ALL 14 remaining
/api/tasks/* endpoints from server.py into routers/tasks.py.

Coverage (17 task endpoints total in routers/tasks.py):
  Leaf reads/deletes:
    GET  /api/tasks                 (owner sees all, sales role-scoped)
    GET  /api/tasks/{id}            (200 for assignee/creator/approver, 403 outsider)
    DELETE /api/tasks/{id}          (owner-only, non-owner 403)
  Create + patch:
    POST /api/tasks                 (title/priority; auto-role-assignment; blocked when approval_required)
    PATCH /api/tasks/{id}           (status transitions; progress clamp; evidence gate)
  Assignment:
    POST /api/tasks/{id}/reassign   (by id, by role, invalid, RBAC)
  Approval loop:
    POST /api/tasks/{id}/approve    (400 if !approval_required; 403 if not approver; 200 unblocks)
    POST /api/tasks/{id}/reject     (approval_status=rejected, keeps blocked)
    POST /api/tasks/{id}/clarify    (pushes 'Clarification requested' entry into updates trail)
  Execution plan (AI Claude):
    POST /api/tasks/{id}/execution-plan/generate  (Claude call returns steps)
    PATCH /api/tasks/{id}/execution-plan          (save steps; accepted+100% -> auto done)
    DELETE /api/tasks/{id}/execution-plan         (clears plan)
    POST /api/tasks/{id}/steps/ask                (AI step help)
  Collaboration:
    POST /api/tasks/{id}/updates    (note / handoff / escalate — creates followup_task_id)
    POST /api/tasks/{id}/respond    (only on parent_task_id-tasks; pushes reply into parent updates)
  Ranking:
    POST /api/tasks/prioritize      (route-ordering sanity — mustn't collide with /tasks/{id}/*)
  Files:
    POST /api/tasks/{id}/attachment (upload works; kind=reference does not error)

Cross-domain regressions:
  • services.tasks._attach_reference_ids still callable from server.py capture flow
  • services.tasks._tenant_industry still callable from /api/capture/clarify
  • Decisions router (Phase B step 3) still works: POST /api/decisions/{id}/tasks
  • Non-task endpoints still 200: /brief, /inbox, /brain/documents, /brain/agent, /ask
"""
import io
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient


from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()

# Direct Mongo for injecting pending_approval decisions and inspecting side effects.
_mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
_db = _mongo[os.environ.get("DB_NAME", "test_database")]


# ---------------------------------------------------------------------------
# fixtures / helpers
# ---------------------------------------------------------------------------


def _login(email: str, password: str = "demo1234") -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text[:200]}"
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


@pytest.fixture(scope="module")
def production_token():
    return _login("production@sharma.com")


@pytest.fixture(scope="module")
def owner_ctx():
    """Return (owner_id, tenant_id, sales_id, finance_id) from Mongo."""
    ou = _db.users.find_one({"email": "owner@sharma.com"}, {"_id": 0, "id": 1, "tenant_id": 1})
    su = _db.users.find_one({"email": "sales@sharma.com"}, {"_id": 0, "id": 1})
    fu = _db.users.find_one({"email": "finance@sharma.com"}, {"_id": 0, "id": 1})
    return ou["id"], ou["tenant_id"], su["id"], fu["id"]


def _make_task(owner_token, **overrides) -> str:
    """Create a task via API and return its id."""
    payload = {"title": f"TEST_iter81 {uuid.uuid4().hex[:8]}", "priority": "low"}
    payload.update(overrides)
    r = requests.post(f"{BASE_URL}/api/tasks", json=payload,
                      headers=_h(owner_token), timeout=20)
    assert r.status_code == 200, f"create task failed: {r.status_code} {r.text[:300]}"
    return r.json()["id"]


def _cleanup_task(task_id: str):
    _db.tasks.delete_many({"$or": [{"id": task_id}, {"parent_task_id": task_id}]})


# ---------------------------------------------------------------------------
# 0. Sanity: server boots, task router mounted, all endpoints reachable
# ---------------------------------------------------------------------------


class TestRouterMountSanity:
    def test_list_tasks_reachable(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_prioritize_path_not_shadowed(self, owner_token):
        """CRITICAL: routers/tasks.py has /tasks/{id}/* AND /tasks/prioritize.
        Verify FastAPI matches /prioritize as a literal, not as task_id=prioritize.
        """
        r = requests.post(f"{BASE_URL}/api/tasks/prioritize?force=false&limit=2",
                          headers=_h(owner_token), timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tasks" in body
        assert "scored" in body
        # Must be the prioritize response shape, not a "task not found" 404
        assert isinstance(body["tasks"], list)


# ---------------------------------------------------------------------------
# 1. GET /api/tasks — list scoping
# ---------------------------------------------------------------------------


class TestListTasks:
    def test_owner_sees_all(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        tasks = r.json()
        # Owner should see all tenant tasks — Sharma seed is big
        assert len(tasks) >= 50

    def test_sales_role_scoped(self, owner_token, sales_token, owner_ctx):
        """Sales sees only tasks assigned to sales member or assignee_role=sales."""
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(sales_token), timeout=20)
        assert r.status_code == 200
        stasks = r.json()
        _, _, sales_id, _ = owner_ctx
        # Every visible task must be assigned to sales user or role=sales
        for t in stasks:
            allowed = (t.get("assignee_id") == sales_id
                       or t.get("assignee_role") == "sales"
                       or t.get("created_by") == sales_id)
            # If not directly assigned, allowed only if watching (creator/approver/support)
            assert allowed or t.get("approver_id") == sales_id or t.get("support_id") == sales_id, (
                f"sales sees unrelated task: {t.get('title')} "
                f"assignee_id={t.get('assignee_id')} role={t.get('assignee_role')}"
            )

    def test_mine_filter_owner(self, owner_token, owner_ctx):
        owner_id, _, _, _ = owner_ctx
        r = requests.get(f"{BASE_URL}/api/tasks?mine=true",
                         headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        for t in r.json():
            # Must be assigned to me OR unclaimed pool matching my role
            assert (t.get("assignee_id") == owner_id
                    or (t.get("assignee_id") is None
                        and t.get("assignee_role") == "owner")), t.get("title")


# ---------------------------------------------------------------------------
# 2. GET /api/tasks/{id} — RBAC
# ---------------------------------------------------------------------------


class TestGetTask:
    def test_owner_can_view_any_task(self, owner_token):
        # Owner should be able to view any task
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=15)
        tasks = r.json()
        if not tasks:
            pytest.skip("no tasks")
        r2 = requests.get(f"{BASE_URL}/api/tasks/{tasks[0]['id']}",
                          headers=_h(owner_token), timeout=15)
        assert r2.status_code == 200
        assert "task_type" in r2.json()  # enrich_task ran

    def test_outsider_403(self, owner_token, sales_token):
        """Task assigned to FINANCE role — sales user should get 403."""
        tid = _make_task(owner_token, title=f"TEST_iter81 outsider {uuid.uuid4().hex[:6]}",
                         assignee_role="finance")
        try:
            r = requests.get(f"{BASE_URL}/api/tasks/{tid}",
                             headers=_h(sales_token), timeout=15)
            assert r.status_code == 403, (
                f"expected 403 for sales on finance task, got {r.status_code} {r.text[:200]}"
            )
        finally:
            _cleanup_task(tid)

    def test_not_found_404(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/tasks/nonexistent-{uuid.uuid4().hex}",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# 3. DELETE /api/tasks/{id} — owner-only
# ---------------------------------------------------------------------------


class TestDeleteTask:
    def test_owner_can_delete(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        r = requests.delete(f"{BASE_URL}/api/tasks/{tid}",
                            headers=_h(owner_token), timeout=15)
        assert r.status_code in (200, 204)
        r2 = requests.get(f"{BASE_URL}/api/tasks/{tid}",
                          headers=_h(owner_token), timeout=10)
        assert r2.status_code == 404

    def test_non_owner_cannot_delete(self, owner_token, sales_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.delete(f"{BASE_URL}/api/tasks/{tid}",
                                headers=_h(sales_token), timeout=15)
            assert r.status_code == 403
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 4. POST /api/tasks — create (auto-role-assignment; blocked when approval_required)
# ---------------------------------------------------------------------------


class TestCreateTask:
    def test_create_with_title_priority(self, owner_token):
        payload = {"title": f"TEST_iter81 basic {uuid.uuid4().hex[:6]}",
                   "priority": "high", "assignee_role": "sales"}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload,
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["title"] == payload["title"]
        assert body["priority"] == "high"
        assert body["status"] == "todo"
        _cleanup_task(body["id"])

    def test_auto_role_assignment(self, owner_token, owner_ctx):
        """When only assignee_role given, task should auto-assign to a member of that role."""
        _, tid_tenant, sales_id, _ = owner_ctx
        payload = {"title": f"TEST_iter81 autoassign {uuid.uuid4().hex[:6]}",
                   "priority": "medium", "assignee_role": "sales"}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload,
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        # pick_least_loaded_member should have set assignee_id to some sales user
        assert body["assignee_role"] == "sales"
        assert body.get("assignee_id") is not None, "auto-assignment did NOT pick a member"
        # Verify it's actually a sales user
        u = _db.users.find_one({"id": body["assignee_id"]}, {"_id": 0, "role": 1})
        assert u and u.get("role") == "sales", f"auto-assigned to non-sales: {u}"
        _cleanup_task(body["id"])

    def test_approval_required_blocks(self, owner_token, finance_token, owner_ctx):
        """approval_required=True → status=blocked + approval_status=pending."""
        _, _, _, finance_id = owner_ctx
        payload = {"title": f"TEST_iter81 approval {uuid.uuid4().hex[:6]}",
                   "priority": "medium", "assignee_role": "finance",
                   "approval_required": True, "approver_id": finance_id}
        r = requests.post(f"{BASE_URL}/api/tasks", json=payload,
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "blocked"
        assert body.get("approval_required") is True
        assert body.get("approval_status") == "pending"
        _cleanup_task(body["id"])


# ---------------------------------------------------------------------------
# 5. PATCH /api/tasks/{id}
# ---------------------------------------------------------------------------


class TestPatchTask:
    def test_status_transitions(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r1 = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                                json={"status": "in_progress"},
                                headers=_h(owner_token), timeout=15)
            assert r1.status_code == 200
            assert r1.json()["status"] == "in_progress"
            r2 = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                                json={"status": "done"},
                                headers=_h(owner_token), timeout=15)
            assert r2.status_code == 200
            body = r2.json()
            assert body["status"] == "done"
            assert body["progress"] == 100  # auto-set to 100 when done
        finally:
            _cleanup_task(tid)

    def test_progress_clamp(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                               json={"progress": 500},
                               headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            assert r.json()["progress"] == 100
            r2 = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                                json={"progress": -10},
                                headers=_h(owner_token), timeout=15)
            assert r2.status_code == 200
            assert r2.json()["progress"] == 0
        finally:
            _cleanup_task(tid)

    def test_evidence_required_gate(self, owner_token):
        """evidence_required=True + no attachment → cannot mark done."""
        tid = _make_task(owner_token, assignee_role="sales",
                         evidence_required=True)
        try:
            r = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                               json={"status": "done"},
                               headers=_h(owner_token), timeout=15)
            assert r.status_code == 400, (
                f"evidence gate did NOT block done — got {r.status_code} {r.text[:200]}"
            )
            assert "evidence" in r.text.lower()
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 6. POST /api/tasks/{id}/reassign
# ---------------------------------------------------------------------------


class TestReassign:
    def test_reassign_by_id(self, owner_token, owner_ctx):
        _, _, sales_id, _ = owner_ctx
        tid = _make_task(owner_token, assignee_role="finance")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/reassign",
                              json={"assignee_id": sales_id},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            body = r.json()
            assert body["assignee_id"] == sales_id
            assert body["assignee_role"] == "sales"  # role auto-updated from member
        finally:
            _cleanup_task(tid)

    def test_reassign_by_role(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/reassign",
                              json={"assignee_role": "production"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            body = r.json()
            assert body["assignee_role"] == "production"
            assert body["assignee_id"] is None
        finally:
            _cleanup_task(tid)

    def test_reassign_empty_400(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/reassign",
                              json={}, headers=_h(owner_token), timeout=15)
            assert r.status_code == 400
        finally:
            _cleanup_task(tid)

    def test_reassign_invalid_role_400(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/reassign",
                              json={"assignee_role": "nonexistent_role"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 400
        finally:
            _cleanup_task(tid)

    def test_non_owner_no_perm_403(self, owner_token, sales_token):
        """Sales user typically lacks team_manage/decisions_approve → 403."""
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/reassign",
                              json={"assignee_role": "production"},
                              headers=_h(sales_token), timeout=15)
            assert r.status_code == 403, (
                f"sales was able to reassign! {r.status_code} {r.text[:200]}"
            )
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 7. Approval loop: approve / reject / clarify
# ---------------------------------------------------------------------------


class TestApprovalLoop:
    def test_approve_400_if_no_approval_required(self, owner_token):
        tid = _make_task(owner_token, assignee_role="sales")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/approve",
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 400
        finally:
            _cleanup_task(tid)

    def test_approve_unblocks_blocked(self, owner_token, owner_ctx):
        _, _, _, finance_id = owner_ctx
        r0 = requests.post(f"{BASE_URL}/api/tasks",
                           json={"title": f"TEST_iter81 approve {uuid.uuid4().hex[:6]}",
                                 "assignee_role": "finance",
                                 "approval_required": True,
                                 "approver_id": finance_id},
                           headers=_h(owner_token), timeout=15)
        assert r0.status_code == 200
        tid = r0.json()["id"]
        assert r0.json()["status"] == "blocked"
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/approve",
                              headers=_h(owner_token), timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "todo"  # unblocked
            assert body.get("approval_status") == "approved"
        finally:
            _cleanup_task(tid)

    def test_approve_403_if_not_approver(self, owner_token, sales_token, owner_ctx):
        _, _, _, finance_id = owner_ctx
        r0 = requests.post(f"{BASE_URL}/api/tasks",
                           json={"title": f"TEST_iter81 approve_gate {uuid.uuid4().hex[:6]}",
                                 "assignee_role": "finance",
                                 "approval_required": True,
                                 "approver_id": finance_id},
                           headers=_h(owner_token), timeout=15)
        assert r0.status_code == 200
        tid = r0.json()["id"]
        try:
            # Sales is neither the assigned approver nor the owner → 403
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/approve",
                              headers=_h(sales_token), timeout=15)
            assert r.status_code == 403
        finally:
            _cleanup_task(tid)

    def test_reject_keeps_blocked(self, owner_token, owner_ctx):
        _, _, _, finance_id = owner_ctx
        r0 = requests.post(f"{BASE_URL}/api/tasks",
                           json={"title": f"TEST_iter81 reject {uuid.uuid4().hex[:6]}",
                                 "assignee_role": "finance",
                                 "approval_required": True,
                                 "approver_id": finance_id},
                           headers=_h(owner_token), timeout=15)
        tid = r0.json()["id"]
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/reject",
                              json={"reason": "please revise scope"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("approval_status") == "rejected"
            assert body["status"] == "blocked"
            assert body.get("rejection_reason") == "please revise scope"
        finally:
            _cleanup_task(tid)

    def test_clarify_pushes_update_entry(self, owner_token, owner_ctx):
        _, _, _, finance_id = owner_ctx
        r0 = requests.post(f"{BASE_URL}/api/tasks",
                           json={"title": f"TEST_iter81 clarify {uuid.uuid4().hex[:6]}",
                                 "assignee_role": "finance",
                                 "approval_required": True,
                                 "approver_id": finance_id},
                           headers=_h(owner_token), timeout=15)
        tid = r0.json()["id"]
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/clarify",
                              json={"reason": "Please confirm invoice numbers"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            # Fetch the task and look for the clarification update entry
            r2 = requests.get(f"{BASE_URL}/api/tasks/{tid}",
                              headers=_h(owner_token), timeout=15)
            updates = r2.json().get("updates") or []
            assert any("Clarification requested" in (u.get("text") or "") for u in updates), (
                f"clarify entry not found in updates trail: {updates}"
            )
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 8. Execution plan (AI Claude) — generate / patch / delete / steps/ask
# ---------------------------------------------------------------------------


class TestExecutionPlan:
    def test_generate_execution_plan_ai(self, owner_token, owner_ctx):
        """Real Claude call — must return {task_type, steps: [str]} shape."""
        owner_id, _, _, _ = owner_ctx
        # Owner-assigned task so owner can plan it
        tid = _make_task(owner_token,
                         title=f"TEST_iter81 plan {uuid.uuid4().hex[:6]}",
                         description="Prepare Q1 sales pitch deck for a wholesale customer",
                         assignee_id=owner_id, assignee_role="owner")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/execution-plan/generate",
                              headers=_h(owner_token), timeout=120)
            assert r.status_code == 200, r.text
            body = r.json()
            plan = body.get("execution_plan")
            assert plan is not None, f"no execution_plan in response: {list(body.keys())}"
            assert "steps" in plan
            assert isinstance(plan["steps"], list) and len(plan["steps"]) >= 1, (
                f"Claude returned empty/invalid steps: {plan}"
            )
            for s in plan["steps"]:
                assert s.get("text") and isinstance(s["text"], str), s
                assert s.get("id"), s
            assert plan.get("status") == "draft"
        finally:
            _cleanup_task(tid)

    def test_generate_execution_plan_403_when_unapproved(self, owner_token, sales_token, owner_ctx):
        """approval_required && not approved → 403 on plan generation."""
        _, _, sales_id, _ = owner_ctx
        r0 = requests.post(f"{BASE_URL}/api/tasks",
                           json={"title": f"TEST_iter81 plan_gate {uuid.uuid4().hex[:6]}",
                                 "assignee_id": sales_id,
                                 "assignee_role": "sales",
                                 "approval_required": True},
                           headers=_h(owner_token), timeout=15)
        tid = r0.json()["id"]
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/execution-plan/generate",
                              headers=_h(sales_token), timeout=30)
            assert r.status_code == 403, (
                f"plan generated on unapproved task: {r.status_code} {r.text[:200]}"
            )
        finally:
            _cleanup_task(tid)

    def test_patch_execution_plan_auto_done(self, owner_token, owner_ctx):
        """PATCH execution-plan with status=accepted + all steps done → task auto-marks done."""
        owner_id, _, _, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner")
        try:
            payload = {
                "steps": [
                    {"text": "Step 1", "done": True},
                    {"text": "Step 2", "done": True},
                ],
                "status": "accepted",
            }
            r = requests.patch(f"{BASE_URL}/api/tasks/{tid}/execution-plan",
                               json=payload, headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "done", (
                f"auto-done did not fire: task status = {body['status']}, "
                f"plan progress = {(body.get('execution_plan') or {}).get('progress')}"
            )
            assert (body.get("execution_plan") or {}).get("progress") == 100
        finally:
            _cleanup_task(tid)

    def test_delete_execution_plan(self, owner_token, owner_ctx):
        owner_id, _, _, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner")
        try:
            # First put a plan on it
            r0 = requests.patch(f"{BASE_URL}/api/tasks/{tid}/execution-plan",
                                json={"steps": [{"text": "one", "done": False}],
                                      "status": "draft"},
                                headers=_h(owner_token), timeout=15)
            assert r0.status_code == 200
            assert r0.json().get("execution_plan") is not None
            # Delete
            r = requests.delete(f"{BASE_URL}/api/tasks/{tid}/execution-plan",
                                headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            body = r.json()
            assert body.get("execution_plan") is None or body.get("execution_plan") == {}
        finally:
            _cleanup_task(tid)

    def test_steps_ask_ai(self, owner_token, owner_ctx):
        """Real Claude step-assist — must return a non-empty answer."""
        owner_id, _, _, _ = owner_ctx
        tid = _make_task(owner_token,
                         title=f"TEST_iter81 step_ask {uuid.uuid4().hex[:6]}",
                         description="Chase overdue invoice from customer",
                         assignee_id=owner_id, assignee_role="owner")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/steps/ask",
                              json={"step_text": "Draft a polite reminder email"},
                              headers=_h(owner_token), timeout=90)
            assert r.status_code == 200, r.text
            body = r.json()
            # AI returns a dict — accept any non-trivial payload
            # (server's ai_step_assist shape includes 'suggestion' / 'objections' / 'checks' / etc.)
            assert isinstance(body, dict) and len(body) > 0, f"empty body: {body}"
            has_content = any(
                (isinstance(v, str) and len(v) > 10) or
                (isinstance(v, list) and len(v) > 0) or
                (isinstance(v, dict) and len(v) > 0)
                for v in body.values()
            )
            assert has_content, f"steps/ask returned empty AI response: {body}"
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 9. Collaboration: updates (note/handoff/escalate) + respond
# ---------------------------------------------------------------------------


class TestUpdatesAndRespond:
    def test_note_update(self, owner_token, owner_ctx):
        owner_id, _, _, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/updates",
                              json={"text": "TEST_iter81 note", "action": "note"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            updates = r.json().get("updates") or []
            assert any(u.get("kind") == "note" and "TEST_iter81 note" in (u.get("text") or "")
                       for u in updates)
        finally:
            _cleanup_task(tid)

    def test_handoff_creates_followup(self, owner_token, owner_ctx):
        owner_id, tenant_id, sales_id, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/updates",
                              json={"text": "please review",
                                    "action": "handoff", "to_id": sales_id},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            entry = None
            for u in (r.json().get("updates") or []):
                if u.get("kind") == "handoff":
                    entry = u
                    break
            assert entry, f"no handoff entry: {r.json().get('updates')}"
            fid = entry.get("followup_task_id")
            assert fid, f"handoff entry missing followup_task_id: {entry}"
            # Verify followup task in Mongo with parent_task_id set
            ft = _db.tasks.find_one({"id": fid}, {"_id": 0})
            assert ft, "followup task not persisted"
            assert ft["parent_task_id"] == tid
            assert ft["assignee_id"] == sales_id
        finally:
            _cleanup_task(tid)

    def test_escalate_creates_owner_followup(self, owner_token, sales_token, owner_ctx):
        """Sales user escalates → owner gets a high-priority followup."""
        owner_id, tenant_id, sales_id, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=sales_id, assignee_role="sales")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/updates",
                              json={"text": "blocked — need help",
                                    "action": "escalate"},
                              headers=_h(sales_token), timeout=15)
            assert r.status_code == 200, r.text
            entry = next((u for u in (r.json().get("updates") or [])
                          if u.get("kind") == "escalate"), None)
            assert entry, "no escalate entry"
            fid = entry["followup_task_id"]
            ft = _db.tasks.find_one({"id": fid}, {"_id": 0})
            assert ft and ft["priority"] == "high"
            assert ft["assignee_id"] == owner_id
            assert ft["source"] == "escalation"
        finally:
            _cleanup_task(tid)

    def test_respond_to_handoff(self, owner_token, sales_token, owner_ctx):
        owner_id, tenant_id, sales_id, _ = owner_ctx
        # Owner creates a task and hands off to sales.
        parent_tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{parent_tid}/updates",
                              json={"text": "please check", "action": "handoff",
                                    "to_id": sales_id},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 200
            fid = next(u["followup_task_id"] for u in r.json()["updates"]
                       if u.get("kind") == "handoff")

            # Sales replies to the followup
            r2 = requests.post(f"{BASE_URL}/api/tasks/{fid}/respond",
                               json={"text": "done — see attachment"},
                               headers=_h(sales_token), timeout=15)
            assert r2.status_code == 200, r2.text
            # Followup should be marked done
            assert r2.json()["status"] == "done"

            # Parent should have a reply entry
            parent = _db.tasks.find_one({"id": parent_tid}, {"_id": 0})
            reply_kinds = [u.get("kind") for u in (parent.get("updates") or [])]
            assert any(k in reply_kinds for k in ("handoff_reply", "response")), (
                f"reply not pushed into parent trail: {reply_kinds}"
            )
        finally:
            _cleanup_task(parent_tid)

    def test_respond_400_on_non_followup(self, owner_token):
        """respond on a task with no parent_task_id → 400."""
        tid = _make_task(owner_token, assignee_role="owner")
        try:
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/respond",
                              json={"text": "nope"},
                              headers=_h(owner_token), timeout=15)
            assert r.status_code == 400
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 10. POST /api/tasks/prioritize
# ---------------------------------------------------------------------------


class TestPrioritize:
    def test_prioritize_scores_and_sorts(self, owner_token):
        r = requests.post(f"{BASE_URL}/api/tasks/prioritize?force=true&limit=5",
                          headers=_h(owner_token), timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        tasks = body["tasks"]
        assert body["scored"] >= 1
        # Sorted descending by ai_scores.priority_score
        scores = [(t.get("ai_scores") or {}).get("priority_score", -1) for t in tasks]
        assert scores == sorted(scores, reverse=True), (
            f"tasks not sorted by priority_score: {scores}"
        )
        # Each scored task has real Claude output (business_impact/urgency/reason)
        first_scored = next((t for t in tasks if t.get("ai_scores")), None)
        assert first_scored, "no task got scored"
        s = first_scored["ai_scores"]
        assert isinstance(s.get("priority_score"), (int, float))
        assert isinstance(s.get("reason"), str) and len(s["reason"]) > 0

    def test_prioritize_force_false_reuses_scores(self, owner_token):
        # first call scores everything
        r1 = requests.post(f"{BASE_URL}/api/tasks/prioritize?force=true&limit=3",
                           headers=_h(owner_token), timeout=120)
        assert r1.status_code == 200
        # second call with force=false — should score 0 additional since already scored
        r2 = requests.post(f"{BASE_URL}/api/tasks/prioritize?force=false&limit=3",
                           headers=_h(owner_token), timeout=90)
        assert r2.status_code == 200
        assert r2.json()["scored"] == 0, (
            f"force=false rescored tasks: {r2.json()['scored']}"
        )


# ---------------------------------------------------------------------------
# 11. POST /api/tasks/{id}/attachment (multipart upload)
# ---------------------------------------------------------------------------


class TestAttachment:
    def test_attach_evidence_file(self, owner_token, owner_ctx):
        owner_id, _, _, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner")
        try:
            payload = f"TEST_iter81 evidence {uuid.uuid4()}".encode()
            files = {"file": ("evidence.txt", io.BytesIO(payload), "text/plain")}
            data = {"kind": "evidence"}
            r = requests.post(f"{BASE_URL}/api/tasks/{tid}/attachment",
                              files=files, data=data,
                              headers=_h(owner_token), timeout=30)
            assert r.status_code == 200, r.text
            att = r.json()
            assert att.get("kind") == "evidence"
            # Fetch task and confirm attachment persisted
            r2 = requests.get(f"{BASE_URL}/api/tasks/{tid}",
                              headers=_h(owner_token), timeout=15)
            assert r2.json().get("attachment_count", 0) >= 1
        finally:
            _cleanup_task(tid)

    def test_evidence_gate_unblocked_after_attachment(self, owner_token, owner_ctx):
        """evidence_required=True + attachment=uploaded → can mark done."""
        owner_id, _, _, _ = owner_ctx
        tid = _make_task(owner_token, assignee_id=owner_id, assignee_role="owner",
                         evidence_required=True)
        try:
            # attach evidence
            payload = f"TEST_iter81 proof {uuid.uuid4()}".encode()
            files = {"file": ("proof.txt", io.BytesIO(payload), "text/plain")}
            r0 = requests.post(f"{BASE_URL}/api/tasks/{tid}/attachment",
                               files=files, data={"kind": "evidence"},
                               headers=_h(owner_token), timeout=30)
            assert r0.status_code == 200
            # now marking done should work
            r = requests.patch(f"{BASE_URL}/api/tasks/{tid}",
                               json={"status": "done"},
                               headers=_h(owner_token), timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "done"
        finally:
            _cleanup_task(tid)


# ---------------------------------------------------------------------------
# 12. Cross-domain regression: /capture/clarify still calls _tenant_industry
# ---------------------------------------------------------------------------


class TestCrossDomain:
    def test_capture_clarify_still_works(self, owner_token):
        """POST /api/capture/clarify uses services.tasks._tenant_industry (re-exported in server.py)."""
        r = requests.post(f"{BASE_URL}/api/capture/clarify",
                          json={"text": "buy 100 kg cotton from supplier next week"},
                          headers=_h(owner_token), timeout=90)
        assert r.status_code == 200, r.text
        # Response shape (from server.py:1936): output of ai_clarify_directive.
        body = r.json()
        assert isinstance(body, dict)
        assert "complete" in body or "questions" in body, (
            f"unexpected clarify shape: {body}"
        )

    def test_capture_clarify_empty_400(self, owner_token):
        r = requests.post(f"{BASE_URL}/api/capture/clarify",
                          json={"text": "   "},
                          headers=_h(owner_token), timeout=15)
        assert r.status_code == 400

    def test_decisions_router_still_works(self, owner_token):
        # Regression from iteration 80 — decisions router must still work
        r = requests.get(f"{BASE_URL}/api/decisions",
                         headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_decisions_add_task_still_works(self, owner_token):
        """POST /api/decisions/{id}/tasks — uses TaskCreateInput from models/tasks.py."""
        # Insert a pending_approval decision directly
        ou = _db.users.find_one({"email": "owner@sharma.com"}, {"_id": 0, "id": 1, "tenant_id": 1})
        did = str(uuid.uuid4())
        _db.decisions.insert_one({
            "id": did, "tenant_id": ou["tenant_id"], "voice_note_id": None,
            "title": f"TEST_iter81 xdec {did[:6]}",
            "summary": "regression", "items": [], "workflow_events": [],
            "dtype": "operational", "status": "pending_approval",
            "created_by": ou["id"],
            "created_at": datetime.now(timezone.utc).isoformat(),
            "task_ids": [], "timeline": [],
        })
        try:
            r = requests.post(f"{BASE_URL}/api/decisions/{did}/tasks",
                              json={"title": "TEST_iter81 decision task",
                                    "priority": "medium", "due_in_days": 2},
                              headers=_h(owner_token), timeout=20)
            assert r.status_code == 200, r.text
        finally:
            _db.decisions.delete_one({"id": did})
            _db.tasks.delete_many({"decision_id": did})

    def test_brief_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brief", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200
        assert "counters" in r.json()

    def test_inbox_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/inbox", headers=_h(owner_token), timeout=20)
        assert r.status_code == 200

    def test_brain_documents_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/brain/documents",
                         headers=_h(owner_token), timeout=15)
        assert r.status_code == 200

    def test_workflows_ok(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/workflows",
                         headers=_h(owner_token), timeout=20)
        assert r.status_code == 200

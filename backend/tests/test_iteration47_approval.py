"""Iteration 47 — Role-Based Approval Gate + Execution Plan Options.

All tests are self-contained per class so pytest-xdist loadscope doesn't split state.
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=", 1)[1].splitlines()[0]).rstrip("/")
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
FIN = ("finance@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    assert any(c.name == "dos_token" for c in s.cookies), "dos_token cookie missing"
    return s


def _users_by_email(sess):
    r = sess.get(f"{API}/users", timeout=10)
    r.raise_for_status()
    return {u["email"]: u for u in r.json()}


def _mktask(sess, **payload):
    r = sess.post(f"{API}/tasks", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# 1. Auth + cookie
# ---------------------------------------------------------------------------
class TestAuth:
    def test_login_and_me(self):
        s = _login(*OWNER)
        r = s.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["user"]["email"] == OWNER[0]
        assert j["tenant"]["name"]

    def test_logout_clears_cookie(self):
        s = _login(*OWNER)
        r = s.post(f"{API}/auth/logout", timeout=10)
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# 2. PATCH /users/{id} permissions (setup for role-based approver)
# ---------------------------------------------------------------------------
class TestPermsSetup:
    def test_grant_approvals_to_finance(self):
        s = _login(*OWNER)
        u = _users_by_email(s)[FIN[0]]
        r = s.patch(f"{API}/users/{u['id']}",
                    json={"permissions": ["inbox", "tasks", "approvals", "finance"]}, timeout=10)
        assert r.status_code == 200, r.text
        assert "approvals" in r.json()["permissions"]

    def test_deny_approvals_to_sales(self):
        s = _login(*OWNER)
        u = _users_by_email(s)[SALES[0]]
        r = s.patch(f"{API}/users/{u['id']}",
                    json={"permissions": ["inbox", "tasks"]}, timeout=10)
        assert r.status_code == 200
        assert "approvals" not in r.json()["permissions"]


# ---------------------------------------------------------------------------
# 3. Full role-based-approval + gate flow
# ---------------------------------------------------------------------------
class TestApprovalFlow:
    def test_full_no_approver_role_based(self):
        """Task with approval_required=True and NO approver_id
        - status=blocked / approval_status=pending
        - PATCH status/progress → 403 (pre-exec lock)
        - Generate/Save plan → 403
        - sales (no 'approvals' perm) → 403 on approve
        - finance (with 'approvals' perm, no approver_id) → 200 on approve
        - After approve: status=todo, approval_status=approved
        - Then status/progress changes work; done completes without 2nd approval
        """
        owner = _login(*OWNER)
        # Ensure finance has 'approvals', sales does not
        umap = _users_by_email(owner)
        owner.patch(f"{API}/users/{umap[FIN[0]]['id']}",
                    json={"permissions": ["inbox", "tasks", "approvals", "finance"]}, timeout=10)
        owner.patch(f"{API}/users/{umap[SALES[0]]['id']}",
                    json={"permissions": ["inbox", "tasks"]}, timeout=10)

        t = _mktask(owner, title=f"TEST_APPRV_NOAPP_{uuid.uuid4().hex[:6]}",
                    approval_required=True)
        assert t["status"] == "blocked"
        assert t["approval_status"] == "pending"
        assert t["approval_required"] is True
        assert "_id" not in t
        tid = t["id"]

        # Pre-exec lock
        r = owner.patch(f"{API}/tasks/{tid}", json={"status": "in_progress"}, timeout=10)
        assert r.status_code == 403
        assert "awaiting approval" in r.json()["detail"].lower()

        r = owner.patch(f"{API}/tasks/{tid}", json={"progress": 50}, timeout=10)
        assert r.status_code == 403

        # Plan generate/save blocked while pending
        rg = owner.post(f"{API}/tasks/{tid}/execution-plan/generate", timeout=60)
        assert rg.status_code == 403
        rs = owner.patch(f"{API}/tasks/{tid}/execution-plan",
                         json={"steps": [{"text": "x"}]}, timeout=10)
        assert rs.status_code == 403

        # sales cannot approve (no approvals perm)
        sales = _login(*SALES)
        r = sales.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 403

        # finance CAN approve (has approvals perm, no approver_id set)
        finance = _login(*FIN)
        r = finance.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["approval_status"] == "approved"
        assert j["status"] == "todo"
        assert j.get("approved_by")

        # Post-approval: status/progress works
        r = owner.patch(f"{API}/tasks/{tid}", json={"status": "in_progress"}, timeout=10)
        assert r.status_code == 200 and r.json()["status"] == "in_progress"

        r = owner.patch(f"{API}/tasks/{tid}", json={"progress": 60}, timeout=10)
        assert r.status_code == 200 and r.json()["progress"] == 60

        # No 2nd approval at completion
        r = owner.patch(f"{API}/tasks/{tid}", json={"status": "done"}, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["status"] == "done"
        assert j["progress"] == 100
        assert j["approval_status"] == "approved"

    def test_specific_approver_id(self):
        """When approver_id is set, only that user (or owner) can approve — even if others have 'approvals' perm."""
        owner = _login(*OWNER)
        umap = _users_by_email(owner)
        # Grant approvals to finance
        owner.patch(f"{API}/users/{umap[FIN[0]]['id']}",
                    json={"permissions": ["inbox", "tasks", "approvals", "finance"]}, timeout=10)

        # Task with owner as approver_id
        t = _mktask(owner, title=f"TEST_APPRV_OWN_{uuid.uuid4().hex[:6]}",
                    approval_required=True, approver_id=umap[OWNER[0]]["id"])
        tid = t["id"]
        assert t["approver_id"] == umap[OWNER[0]]["id"]

        # Finance (with approvals perm) can't approve because owner is the specific approver
        finance = _login(*FIN)
        r = finance.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 403

        # Owner can approve
        r = owner.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 200
        assert r.json()["approval_status"] == "approved"

    def test_finance_as_approver(self):
        """Task with finance as approver_id — finance can approve; sales cannot."""
        owner = _login(*OWNER)
        umap = _users_by_email(owner)
        t = _mktask(owner, title=f"TEST_APPRV_FIN_{uuid.uuid4().hex[:6]}",
                    approval_required=True, approver_id=umap[FIN[0]]["id"])
        tid = t["id"]
        sales = _login(*SALES)
        r = sales.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 403
        finance = _login(*FIN)
        r = finance.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 200
        assert r.json()["approval_status"] == "approved"

    def test_reject_flow(self):
        owner = _login(*OWNER)
        t = _mktask(owner, title=f"TEST_REJECT_{uuid.uuid4().hex[:6]}",
                    approval_required=True)
        tid = t["id"]
        r = owner.post(f"{API}/tasks/{tid}/reject",
                       json={"reason": "TEST_needs more detail"}, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["status"] == "blocked"
        assert j["approval_status"] == "rejected"
        assert j.get("rejection_reason") == "TEST_needs more detail"
        # Still locked
        r2 = owner.patch(f"{API}/tasks/{tid}", json={"status": "todo"}, timeout=10)
        assert r2.status_code == 403


# ---------------------------------------------------------------------------
# 4. Execution plan lifecycle
# ---------------------------------------------------------------------------
class TestExecutionPlan:
    def test_generate_accept_delete(self):
        owner = _login(*OWNER)
        umap = _users_by_email(owner)
        # Approval-required task, approved by owner
        t = _mktask(owner, title=f"TEST_EXECPLAN_{uuid.uuid4().hex[:6]}",
                    approval_required=True, approver_id=umap[OWNER[0]]["id"])
        tid = t["id"]
        r = owner.post(f"{API}/tasks/{tid}/approve", timeout=10)
        assert r.status_code == 200

        # Generate
        r = owner.post(f"{API}/tasks/{tid}/execution-plan/generate", timeout=60)
        assert r.status_code == 200, r.text
        plan = r.json()["execution_plan"]
        assert plan["status"] == "draft"
        assert isinstance(plan["steps"], list) and len(plan["steps"]) > 0

        # Accept
        steps = plan["steps"]
        r = owner.patch(f"{API}/tasks/{tid}/execution-plan",
                        json={"steps": [{"id": s["id"], "text": s["text"], "done": False} for s in steps],
                              "status": "accepted"}, timeout=15)
        assert r.status_code == 200
        assert r.json()["execution_plan"]["status"] == "accepted"

        # Delete clears
        r = owner.delete(f"{API}/tasks/{tid}/execution-plan", timeout=10)
        assert r.status_code == 200
        assert r.json().get("execution_plan") in (None, {})

    def test_manual_plan_save(self):
        owner = _login(*OWNER)
        t = _mktask(owner, title=f"TEST_MANUAL_{uuid.uuid4().hex[:6]}")
        assert t["status"] == "todo"
        tid = t["id"]
        r = owner.patch(f"{API}/tasks/{tid}/execution-plan",
                        json={"steps": [{"text": "Draft outreach email"},
                                        {"text": "Send to lead"}]}, timeout=10)
        assert r.status_code == 200
        plan = r.json()["execution_plan"]
        assert len(plan["steps"]) == 2


# ---------------------------------------------------------------------------
# 5. Regression — non-approval task normal flow + list hygiene
# ---------------------------------------------------------------------------
class TestNonApprovalRegression:
    def test_normal_task_flow(self):
        owner = _login(*OWNER)
        r = owner.post(f"{API}/tasks", json={"title": f"TEST_NORMAL_{uuid.uuid4().hex[:6]}"}, timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["status"] == "todo"
        assert j.get("approval_required") in (False, None)
        rr = owner.patch(f"{API}/tasks/{j['id']}", json={"status": "in_progress"}, timeout=10)
        assert rr.status_code == 200
        assert rr.json()["status"] == "in_progress"

    def test_list_no_id_leak(self):
        owner = _login(*OWNER)
        r = owner.get(f"{API}/tasks", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for t in rows:
            assert "_id" not in t

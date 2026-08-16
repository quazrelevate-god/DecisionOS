"""Iteration 45 — P2 items: enforced task-level approval, smart assignment, refactor regression.

Uses the public REACT_APP_BACKEND_URL and Bearer JWT tokens (which login/register still return
alongside the HttpOnly cookie).
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


# ---------------------------- fixtures ---------------------------------------
def _login(email: str, password: str):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()


@pytest.fixture(scope="module")
def owner_token():
    return _login("owner@sharma.com", "demo1234")["token"]


@pytest.fixture(scope="module")
def sales_token():
    return _login("sales@sharma.com", "demo1234")["token"]


@pytest.fixture(scope="module")
def owner_me(owner_token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {owner_token}"}, timeout=30)
    r.raise_for_status()
    return r.json()


def _h(tok): return {"Authorization": f"Bearer {tok}"}


# ---------------------------- refactor regression ----------------------------
class TestRefactorRegression:
    """Onboarding endpoints moved to routers/onboarding.py still work."""

    def test_onboarding_suggest_200(self):
        r = requests.post(f"{API}/onboarding/suggest", json={"industry": "Retail"}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "roles" in data and isinstance(data["roles"], list) and len(data["roles"]) >= 1
        assert "products" in data and isinstance(data["products"], list)
        # roles never contain 'owner'
        assert all((r_.get("key") != "owner") for r_ in data["roles"])

    def test_onboarding_os_blueprint_200(self):
        r = requests.post(f"{API}/onboarding/os-blueprint", json={"industry": "Retail"}, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("departments", "workflows", "operational_tasks", "approval_rules"):
            assert k in data and isinstance(data[k], list) and len(data[k]) >= 1

    def test_patch_tenant_os_blueprint_owner_200(self, owner_token, owner_me):
        # snapshot current workflow templates and append a TEST_ one
        # WE-02 (2026-08-16): workflow_templates ghost dropped. Use
        # operational_task_templates for the regression check instead --
        # it is a still-alive field on the tenant doc.
        current = owner_me.get("tenant", {}).get("operational_task_templates", []) or []
        payload = {"operational_task_templates": current + [{"title": f"TEST_p2_regression_{int(time.time())}", "category": "Other"}]}
        r = requests.patch(f"{API}/tenant/os-blueprint", json=payload, headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        updated = r.json()
        names = [w.get("title") for w in updated.get("operational_task_templates", [])]
        assert any(n.startswith("TEST_p2_regression_") for n in names)


# ---------------------------- approval enforcement ---------------------------
class TestApprovalFlow:
    def _create_task(self, owner_token, owner_id):
        payload = {
            "title": f"TEST_approval_{int(time.time()*1000)}",
            "description": "test approval enforcement",
            "task_type": "operational",
            "op_category": "Meeting",
            "assignee_id": owner_id,
            "approval_required": True,
            "approver_id": owner_id,
        }
        r = requests.post(f"{API}/tasks", json=payload, headers=_h(owner_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        return r.json()

    def test_patch_done_goes_to_review(self, owner_token, owner_me):
        owner_id = owner_me["user"]["id"] if "user" in owner_me else owner_me["id"]
        t = self._create_task(owner_token, owner_id)
        tid = t["id"]
        assert t.get("approval_required") is True
        # attempt to complete
        r = requests.patch(f"{API}/tasks/{tid}", json={"status": "done"}, headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "review", f"expected review got {body['status']}"
        assert body.get("approval_status") == "pending"

    def test_approve_endpoint_completes(self, owner_token, owner_me):
        owner_id = owner_me["user"]["id"] if "user" in owner_me else owner_me["id"]
        t = self._create_task(owner_token, owner_id)
        tid = t["id"]
        # submit
        requests.patch(f"{API}/tasks/{tid}", json={"status": "done"}, headers=_h(owner_token), timeout=30)
        # approve
        r = requests.post(f"{API}/tasks/{tid}/approve", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "done"
        assert body.get("approval_status") == "approved"
        assert body.get("progress") == 100

    def test_reject_endpoint_returns_in_progress(self, owner_token, owner_me):
        owner_id = owner_me["user"]["id"] if "user" in owner_me else owner_me["id"]
        t = self._create_task(owner_token, owner_id)
        tid = t["id"]
        requests.patch(f"{API}/tasks/{tid}", json={"status": "done"}, headers=_h(owner_token), timeout=30)
        r = requests.post(f"{API}/tasks/{tid}/reject", headers=_h(owner_token),
                         json={"reason": "TEST reject reason"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "in_progress"
        assert body.get("approval_status") == "rejected"

    def test_non_approver_gets_403(self, owner_token, owner_me, sales_token):
        owner_id = owner_me["user"]["id"] if "user" in owner_me else owner_me["id"]
        t = self._create_task(owner_token, owner_id)  # approver = owner
        tid = t["id"]
        requests.patch(f"{API}/tasks/{tid}", json={"status": "done"}, headers=_h(owner_token), timeout=30)
        r = requests.post(f"{API}/tasks/{tid}/approve", headers=_h(sales_token), timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
        r2 = requests.post(f"{API}/tasks/{tid}/reject", headers=_h(sales_token),
                          json={"reason": "nope"}, timeout=30)
        assert r2.status_code == 403


# ---------------------------- smart assignment -------------------------------
class TestSmartAssignment:
    def test_role_only_creation_auto_assigns(self, owner_token):
        payload = {
            "title": f"TEST_smart_assign_{int(time.time()*1000)}",
            "task_type": "operational",
            "assignee_role": "sales",   # no assignee_id
        }
        r = requests.post(f"{API}/tasks", json=payload, headers=_h(owner_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("assignee_id"), f"assignee_id should be populated, got {body}"
        assert body.get("assignee_role") == "sales"

    def test_role_production_auto_assigns(self, owner_token):
        payload = {
            "title": f"TEST_smart_assign_prod_{int(time.time()*1000)}",
            "task_type": "operational",
            "assignee_role": "production",
        }
        r = requests.post(f"{API}/tasks", json=payload, headers=_h(owner_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body.get("assignee_id"), f"assignee_id should be populated, got {body}"
        assert body.get("assignee_role") == "production"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

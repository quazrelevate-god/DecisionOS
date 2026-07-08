"""
Iteration 16 — Task allocation to team members
Backend tests: assignee_id validation, auto-fill assignee_role from member,
reassignment via PATCH, exclude_unset on status-only update, mine filter.
"""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}


def _login(creds):
    r = requests.post(f"{BASE}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER)


@pytest.fixture(scope="module")
def sales_token():
    return _login(SALES)


@pytest.fixture(scope="module")
def owner_headers(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


@pytest.fixture(scope="module")
def sales_headers(sales_token):
    return {"Authorization": f"Bearer {sales_token}"}


@pytest.fixture(scope="module")
def users(owner_headers):
    r = requests.get(f"{BASE}/api/users", headers=owner_headers, timeout=30)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def priya(users):
    for u in users:
        if u.get("role") == "sales":
            return u
    pytest.skip("No sales member in Sharma tenant")


# --- CREATE tests -----------------------------------------------------------

class TestCreateTaskAssignment:
    def test_create_with_valid_assignee_id_autofills_role(self, owner_headers, priya):
        payload = {"title": "TEST_assign_valid", "description": "auto role", "assignee_id": priya["id"]}
        r = requests.post(f"{BASE}/api/tasks", headers=owner_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["assignee_id"] == priya["id"]
        assert data["assignee_role"] == "sales", f"expected auto-filled 'sales', got {data.get('assignee_role')}"
        assert data.get("assignee_name") == priya["name"]
        assert data["status"] == "todo"

    def test_create_with_bogus_assignee_id_nullified(self, owner_headers):
        payload = {"title": "TEST_bogus_assignee", "assignee_id": "bogus-does-not-exist"}
        r = requests.post(f"{BASE}/api/tasks", headers=owner_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("assignee_id") is None
        assert data.get("assignee_name") is None

    def test_create_with_role_only(self, owner_headers):
        payload = {"title": "TEST_role_only", "assignee_role": "sales"}
        r = requests.post(f"{BASE}/api/tasks", headers=owner_headers, json=payload, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("assignee_id") is None
        assert data.get("assignee_role") == "sales"

    def test_create_with_invalid_role(self, owner_headers):
        payload = {"title": "TEST_invalid_role", "assignee_role": "not-a-real-role"}
        r = requests.post(f"{BASE}/api/tasks", headers=owner_headers, json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json().get("assignee_role") is None


# --- PATCH tests ------------------------------------------------------------

class TestReassignTask:
    def test_patch_assignee_id_updates_role_and_name(self, owner_headers, priya):
        # Create unassigned
        cr = requests.post(f"{BASE}/api/tasks", headers=owner_headers,
                           json={"title": "TEST_reassign_target"}, timeout=30)
        assert cr.status_code == 200
        tid = cr.json()["id"]
        # Patch with member
        pr = requests.patch(f"{BASE}/api/tasks/{tid}", headers=owner_headers,
                            json={"assignee_id": priya["id"]}, timeout=30)
        assert pr.status_code == 200, pr.text
        data = pr.json()
        assert data["assignee_id"] == priya["id"]
        assert data["assignee_role"] == "sales"
        assert data.get("assignee_name") == priya["name"]

    def test_patch_status_only_preserves_assignee(self, owner_headers, priya):
        cr = requests.post(f"{BASE}/api/tasks", headers=owner_headers,
                           json={"title": "TEST_status_preserve", "assignee_id": priya["id"]}, timeout=30)
        tid = cr.json()["id"]
        pr = requests.patch(f"{BASE}/api/tasks/{tid}", headers=owner_headers,
                            json={"status": "in_progress"}, timeout=30)
        assert pr.status_code == 200
        data = pr.json()
        assert data["status"] == "in_progress"
        assert data["assignee_id"] == priya["id"], "assignee wiped on status-only update"
        assert data["assignee_role"] == "sales"
        assert data.get("assignee_name") == priya["name"]

    def test_patch_bogus_assignee_id_ignored(self, owner_headers, priya):
        cr = requests.post(f"{BASE}/api/tasks", headers=owner_headers,
                           json={"title": "TEST_patch_bogus", "assignee_id": priya["id"]}, timeout=30)
        tid = cr.json()["id"]
        pr = requests.patch(f"{BASE}/api/tasks/{tid}", headers=owner_headers,
                            json={"assignee_id": "bogus-id"}, timeout=30)
        assert pr.status_code == 200
        # bogus assignee is popped => original preserved (not overwritten)
        assert pr.json()["assignee_id"] == priya["id"]


# --- LIST mine=true ---------------------------------------------------------

class TestMineFilter:
    def test_mine_returns_assignee_id_matches(self, owner_headers, sales_headers, priya):
        # Owner creates a task assigned to Priya (sales user)
        cr = requests.post(f"{BASE}/api/tasks", headers=owner_headers,
                           json={"title": "TEST_mine_for_priya", "assignee_id": priya["id"]}, timeout=30)
        assert cr.status_code == 200
        tid = cr.json()["id"]
        # Priya lists mine=true
        lr = requests.get(f"{BASE}/api/tasks?mine=true", headers=sales_headers, timeout=30)
        assert lr.status_code == 200
        ids = [t["id"] for t in lr.json()]
        assert tid in ids

    def test_mine_returns_role_matches(self, owner_headers, sales_headers):
        cr = requests.post(f"{BASE}/api/tasks", headers=owner_headers,
                           json={"title": "TEST_mine_role_sales", "assignee_role": "sales"}, timeout=30)
        assert cr.status_code == 200
        tid = cr.json()["id"]
        lr = requests.get(f"{BASE}/api/tasks?mine=true", headers=sales_headers, timeout=30)
        assert lr.status_code == 200
        ids = [t["id"] for t in lr.json()]
        assert tid in ids

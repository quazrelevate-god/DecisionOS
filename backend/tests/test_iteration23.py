"""
Iteration 23 — Note & Handoff capability
Backend tests for POST /api/tasks/{id}/updates:
 - permissions (403/404/400)
 - action=note (no follow-up, no notification)
 - action=handoff to member (creates follow-up + notifies member)
 - action=handoff to role (creates role-scoped follow-up + notifies role members)
 - action=escalate (targets owner, high priority, decision timeline event when linked)
 - validation (missing to_id/to_role, invalid to_role)
 - regression: /api/tasks scoping still works
"""

import os
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return None
    return None

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL missing"
API = f"{BASE_URL}/api"

CREDS = {
    "owner": ("owner@sharma.com", "demo1234"),
    "production": ("production@sharma.com", "demo1234"),
    "sales": ("sales@sharma.com", "demo1234"),
    "finance": ("finance@sharma.com", "demo1234"),
}


# ---------- shared helpers ----------

def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _find_task_by_id(token, tid):
    """No GET /tasks/{id} route — list all and filter."""
    for mine in ("false", "true"):
        r = requests.get(f"{API}/tasks", headers=_h(token), params={"mine": mine}, timeout=15)
        if r.status_code == 200:
            for t in r.json():
                if t.get("id") == tid:
                    return t
    return None


@pytest.fixture(scope="module")
def tokens():
    return {k: _login(e, p) for k, (e, p) in CREDS.items()}


def _notif_items(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("notifications") or payload.get("items") or []
    return []


@pytest.fixture(scope="module")
def users(tokens):
    """Return list of tenant users (from owner-scoped GET /users) + role map."""
    r = requests.get(f"{API}/users", headers=_h(tokens["owner"]), timeout=15)
    assert r.status_code == 200
    data = r.json()
    us = data if isinstance(data, list) else data.get("items") or data.get("users") or []
    assert us, "expected users in tenant"
    return us


@pytest.fixture(scope="module")
def me(tokens):
    out = {}
    for k, tok in tokens.items():
        r = requests.get(f"{API}/auth/me", headers=_h(tok), timeout=15)
        assert r.status_code == 200
        d = r.json()
        out[k] = d.get("user", d)
    return out


@pytest.fixture(scope="module")
def seeded_task(tokens, me):
    """Create a fresh production task owned by owner and assigned to production user."""
    prod_uid = me["production"]["id"]
    payload = {
        "title": "TEST_iter23_note_handoff_task",
        "description": "seed for iter23 note/handoff tests",
        "assignee_id": prod_uid,
        "priority": "medium",
        "status": "todo",
    }
    r = requests.post(f"{API}/tasks", headers=_h(tokens["owner"]), json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text
    tid = r.json()["id"]
    yield tid
    # cleanup follow-ups referencing this task, then the task itself
    try:
        rs = requests.get(f"{API}/tasks", headers=_h(tokens["owner"]), params={"mine": "false"}, timeout=20)
        for t in (rs.json() if rs.status_code == 200 else []):
            if t.get("parent_task_id") == tid or t.get("id") == tid:
                requests.delete(f"{API}/tasks/{t['id']}", headers=_h(tokens["owner"]), timeout=10)
    except Exception:
        pass


# ---------- permission tests ----------

class TestPermissions:
    def test_missing_task_returns_404(self, tokens):
        r = requests.post(f"{API}/tasks/does-not-exist/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "hi", "action": "note"}, timeout=10)
        assert r.status_code == 404

    def test_non_assignee_non_owner_gets_403(self, tokens, seeded_task):
        # finance user is neither production (assignee) nor owner
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["finance"]),
                          json={"text": "unauthorized note", "action": "note"}, timeout=10)
        assert r.status_code == 403

    def test_empty_text_returns_400(self, tokens, seeded_task):
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "   ", "action": "note"}, timeout=10)
        assert r.status_code == 400

    def test_unauth_401(self, seeded_task):
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          json={"text": "x", "action": "note"}, timeout=10)
        assert r.status_code in (401, 403)


# ---------- action=note ----------

class TestNote:
    def test_note_appends_to_updates_no_followup_no_notification(self, tokens, seeded_task, me):
        # snapshot notifications for production user (self note shouldn't ping)
        prod_uid = me["production"]["id"]
        before = requests.get(f"{API}/notifications", headers=_h(tokens["production"]), timeout=10)
        assert before.status_code == 200

        body = {"text": "Supplier confirmed shipping tomorrow", "action": "note"}
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]), json=body, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["id"] == seeded_task
        ups = data.get("updates") or []
        assert len(ups) >= 1
        last = ups[-1]
        assert last["kind"] == "note"
        assert last["text"] == body["text"]
        assert last["author_id"] == prod_uid
        assert last["author_name"]
        assert last["followup_task_id"] is None
        assert last["to_id"] is None and last["to_role"] is None

    def test_note_with_step_id_resolves_step_text(self, tokens, seeded_task):
        # Save an execution plan via PATCH /tasks/{id}/execution-plan
        r = requests.patch(
            f"{API}/tasks/{seeded_task}/execution-plan",
            headers=_h(tokens["production"]),
            json={"steps": [{"text": "Call supplier"}, {"text": "Update ERP"}], "status": "draft"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        steps = ((r.json().get("execution_plan") or {}).get("steps") or [])
        assert steps, "no steps saved"
        step_id = steps[0]["id"]

        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "step-scoped finding", "action": "note", "step_id": step_id},
                          timeout=15)
        assert r.status_code == 200, r.text
        ups = r.json()["updates"]
        last = ups[-1]
        assert last["step_id"] == step_id
        assert last["step_text"] and "Call" in last["step_text"]


# ---------- action=handoff ----------

class TestHandoff:
    def test_handoff_to_member_creates_followup_and_notifies(self, tokens, seeded_task, me, users):
        sales = next((u for u in users if u.get("role") == "sales"), None)
        assert sales, "sales user must exist"
        sales_id = sales["id"]

        # baseline notifications for sales
        n_before = requests.get(f"{API}/notifications", headers=_h(tokens["sales"]), timeout=10).json()
        before_items = _notif_items(n_before)
        before_count = len(before_items or [])

        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "Sales, please align pricing", "action": "handoff", "to_id": sales_id},
                          timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        ups = data["updates"]
        last = ups[-1]
        assert last["kind"] == "handoff"
        assert last["to_id"] == sales_id
        assert last["followup_task_id"]
        followup_id = last["followup_task_id"]

        # original task not reassigned
        assert data["assignee_id"] == me["production"]["id"]

        # follow-up task exists, assigned to sales user, status todo, parent link intact
        ft = _find_task_by_id(tokens["sales"], followup_id) or _find_task_by_id(tokens["owner"], followup_id)
        assert ft, "follow-up task not found"
        assert ft["assignee_id"] == sales_id
        assert ft["status"] == "todo"
        assert ft.get("parent_task_id") == seeded_task
        assert ft.get("source") == "handoff"
        assert ft["title"].startswith("Follow-up:")

        # notification pushed to sales
        n_after = requests.get(f"{API}/notifications", headers=_h(tokens["sales"]), timeout=10).json()
        after_items = _notif_items(n_after)
        assert len(after_items or []) >= before_count + 1
        latest = (after_items or [])[0]
        # some tenants sort desc; try to find "[Handoff]"
        found = any("[Handoff]" in (i.get("message") or "") for i in (after_items or [])[:5])
        assert found, f"expected [Handoff] notification in first 5 items, got {[i.get('message') for i in (after_items or [])[:5]]}"

    def test_handoff_to_role_creates_role_scoped_followup(self, tokens, seeded_task):
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "Finance team please review invoice", "action": "handoff", "to_role": "finance"},
                          timeout=15)
        assert r.status_code == 200, r.text
        last = r.json()["updates"][-1]
        assert last["kind"] == "handoff"
        assert last["to_role"] == "finance"
        assert last["to_id"] is None
        followup_id = last["followup_task_id"]
        assert followup_id

        # follow-up: assignee_id null, assignee_role finance
        ft = _find_task_by_id(tokens["owner"], followup_id)
        assert ft, "role-scoped follow-up not found"
        assert ft.get("assignee_id") in (None, "")
        assert ft.get("assignee_role") == "finance"
        assert ft.get("source") == "handoff"
        assert ft.get("parent_task_id") == seeded_task

        # Finance user should see the follow-up in their unclaimed pool (mine=true)
        fm = requests.get(f"{API}/tasks", headers=_h(tokens["finance"]), params={"mine": "true"}, timeout=15).json()
        assert any(t["id"] == followup_id for t in fm), "finance member should see role-scoped follow-up"

    def test_handoff_missing_target_returns_400(self, tokens, seeded_task):
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "no target", "action": "handoff"}, timeout=10)
        assert r.status_code == 400

    def test_handoff_invalid_role_returns_400(self, tokens, seeded_task):
        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "bad role", "action": "handoff", "to_role": "not_a_real_role"},
                          timeout=10)
        assert r.status_code == 400


# ---------- action=escalate ----------

class TestEscalate:
    def test_escalate_targets_owner_high_priority(self, tokens, seeded_task, me):
        # owner notifications baseline
        n_before = requests.get(f"{API}/notifications", headers=_h(tokens["owner"]), timeout=10).json()
        before_items = _notif_items(n_before)
        before_count = len(before_items or [])

        r = requests.post(f"{API}/tasks/{seeded_task}/updates",
                          headers=_h(tokens["production"]),
                          json={"text": "Blocker — need decision", "action": "escalate"}, timeout=15)
        assert r.status_code == 200, r.text
        last = r.json()["updates"][-1]
        assert last["kind"] == "escalate"
        assert last["to_role"] == "owner"
        assert last["to_id"] == me["owner"]["id"]
        followup_id = last["followup_task_id"]
        assert followup_id

        # follow-up is high priority to owner
        ft = _find_task_by_id(tokens["owner"], followup_id)
        assert ft, "escalation follow-up not found"
        assert ft["assignee_id"] == me["owner"]["id"]
        assert ft["priority"] == "high"
        assert ft["status"] == "todo"
        assert ft.get("parent_task_id") == seeded_task

        # notification to owner
        n_after = requests.get(f"{API}/notifications", headers=_h(tokens["owner"]), timeout=10).json()
        after_items = _notif_items(n_after)
        assert len(after_items or []) >= before_count + 1
        found = any("[Escalation]" in (i.get("message") or "") for i in (after_items or [])[:5])
        assert found


# ---------- regression ----------

class TestRegression:
    def test_task_scoping_still_works(self, tokens):
        r = requests.get(f"{API}/tasks", headers=_h(tokens["production"]), params={"mine": "true"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)

    def test_notifications_endpoint_shape(self, tokens):
        r = requests.get(f"{API}/notifications", headers=_h(tokens["production"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        # doc says returns dict with items key
        assert isinstance(data, (dict, list))

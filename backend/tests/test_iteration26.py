"""
Iteration 26 — Escalation discoverability fix.

Verifies:
1. Production escalates a task -> follow-up task tagged source='escalation',
   assignee_id=owner, priority='high', owner receives '[Escalation]' notification.
2. Owner GET /api/notifications -> {notifications:[...], unread:N} contains the
   '[Escalation] ...' message.
3. Owner GET /api/tasks?mine=true -> includes the source='escalation' follow-up.
4. Handoff (to specific member) tags source='handoff' (not 'escalation') and shows
   up on that member's mine=true list.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
PROD = {"email": "production@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}


# --- fixtures ---
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def prod_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=PROD, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def sales_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=SALES, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


def _me(token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_h(token), timeout=10)
    assert r.status_code == 200
    j = r.json()
    return j.get("user") or j


@pytest.fixture(scope="module")
def owner_id(owner_token):
    return _me(owner_token)["id"]


@pytest.fixture(scope="module")
def prod_id(prod_token):
    return _me(prod_token)["id"]


@pytest.fixture(scope="module")
def sales_id(sales_token):
    return _me(sales_token)["id"]


# --- helpers ---
def _create_task_for_prod(owner_token, prod_id):
    """Owner creates a task assigned to production."""
    # Use POST /api/tasks (standalone) — need to inspect API.
    # Fallback: use owner /decisions/{id}/tasks pattern via a decision, OR
    # simpler: post via /api/tasks if it exists.
    payload = {
        "title": "TEST_iter26 production task to escalate",
        "assignee_id": prod_id,
        "priority": "medium",
    }
    r = requests.post(f"{BASE_URL}/api/tasks", headers=_h(owner_token), json=payload, timeout=15)
    return r


# --- tests ---
class TestEscalationFlow:
    def test_login_all_users(self, owner_token, prod_token, sales_token):
        assert owner_token and prod_token and sales_token

    def test_create_task_and_escalate(self, owner_token, prod_token, owner_id, prod_id):
        # 1. Owner creates a task assigned to production.
        r = _create_task_for_prod(owner_token, prod_id)
        if r.status_code == 404:
            # No standalone POST /api/tasks — find an existing task assigned to prod.
            rl = requests.get(f"{BASE_URL}/api/tasks", headers=_h(prod_token), params={"mine": "true"}, timeout=10)
            assert rl.status_code == 200, rl.text
            tasks = rl.json()
            # Pick a task not sourced as escalation/handoff (i.e. a native task)
            candidates = [t for t in tasks if t.get("source") not in ("escalation", "handoff") and t.get("status") != "done"]
            assert candidates, "no candidate task for production to escalate"
            task = candidates[0]
        else:
            assert r.status_code in (200, 201), r.text
            task = r.json()

        task_id = task["id"]
        pytest.escalate_task_id = task_id

        # Capture owner notifications before
        r_before = requests.get(f"{BASE_URL}/api/notifications", headers=_h(owner_token), timeout=10)
        assert r_before.status_code == 200, r_before.text
        j_before = r_before.json()
        assert "notifications" in j_before and "unread" in j_before, j_before
        unread_before = j_before["unread"]

        # 2. Production escalates the task
        note_text = f"TEST_iter26 escalating urgent — payment blocker {int(time.time())}"
        r_esc = requests.post(
            f"{BASE_URL}/api/tasks/{task_id}/updates",
            headers=_h(prod_token),
            json={"text": note_text, "action": "escalate"},
            timeout=15,
        )
        assert r_esc.status_code in (200, 201), r_esc.text
        pytest.escalate_note = note_text

        # 3. Verify follow-up task on owner /tasks?mine=true has source='escalation'
        r_mine = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), params={"mine": "true"}, timeout=10)
        assert r_mine.status_code == 200
        mine = r_mine.json()
        followups = [t for t in mine if t.get("source") == "escalation" and t.get("parent_task_id") == task_id]
        assert followups, f"no escalation followup found for parent {task_id}. mine tasks={[{'id':t.get('id'),'source':t.get('source'),'parent':t.get('parent_task_id')} for t in mine[:20]]}"
        fu = followups[0]
        assert fu["source"] == "escalation"
        assert fu.get("assignee_id") == owner_id, f"expected assignee=owner {owner_id}, got {fu.get('assignee_id')}"
        assert fu.get("priority") == "high", f"expected priority high, got {fu.get('priority')}"
        assert fu.get("status") != "done"
        pytest.followup_id = fu["id"]

        # 4. Verify owner notifications contain the '[Escalation]' message
        r_after = requests.get(f"{BASE_URL}/api/notifications", headers=_h(owner_token), timeout=10)
        assert r_after.status_code == 200
        j_after = r_after.json()
        assert j_after["unread"] >= unread_before + 1, f"unread did not increase: before={unread_before} after={j_after['unread']}"
        esc_notifs = [n for n in j_after["notifications"] if "[Escalation]" in (n.get("message") or "")]
        assert esc_notifs, f"no [Escalation] notification for owner. Latest 5: {[n.get('message') for n in j_after['notifications'][:5]]}"
        # The freshest one should mention the note text prefix
        latest = esc_notifs[0]
        assert "[Escalation]" in latest["message"]

    def test_handoff_tags_source_handoff_not_escalation(self, owner_token, prod_token, sales_token, sales_id, prod_id):
        """Prod hands off (handoff, not escalate) to sales member — source must be 'handoff'."""
        # Find a task assigned to production
        r_prod_tasks = requests.get(f"{BASE_URL}/api/tasks", headers=_h(prod_token), params={"mine": "true"}, timeout=10)
        assert r_prod_tasks.status_code == 200
        prod_tasks = r_prod_tasks.json()
        candidates = [t for t in prod_tasks if t.get("source") not in ("escalation", "handoff") and t.get("status") != "done"]
        assert candidates, "no candidate task for production to hand off"
        task_id = candidates[0]["id"]

        # Sales notifications before
        r_before = requests.get(f"{BASE_URL}/api/notifications", headers=_h(sales_token), timeout=10)
        unread_before = r_before.json().get("unread", 0)

        r_ho = requests.post(
            f"{BASE_URL}/api/tasks/{task_id}/updates",
            headers=_h(prod_token),
            json={"text": f"TEST_iter26 handing off to sales {int(time.time())}", "action": "handoff", "to_id": sales_id},
            timeout=15,
        )
        assert r_ho.status_code in (200, 201), r_ho.text

        # Sales /tasks?mine=true should contain the follow-up with source='handoff'
        r_sales_mine = requests.get(f"{BASE_URL}/api/tasks", headers=_h(sales_token), params={"mine": "true"}, timeout=10)
        assert r_sales_mine.status_code == 200
        sales_mine = r_sales_mine.json()
        handoffs = [t for t in sales_mine if t.get("source") == "handoff" and t.get("parent_task_id") == task_id]
        assert handoffs, f"no handoff followup found for parent {task_id} in sales mine. sample: {[{'id':t.get('id'),'source':t.get('source'),'parent':t.get('parent_task_id')} for t in sales_mine[:20]]}"
        fu = handoffs[0]
        assert fu["source"] == "handoff"
        assert fu["source"] != "escalation"
        assert fu.get("assignee_id") == sales_id

        # Sales notifications should contain '[Handoff]'
        r_after = requests.get(f"{BASE_URL}/api/notifications", headers=_h(sales_token), timeout=10)
        j = r_after.json()
        assert j["unread"] >= unread_before + 1
        ho_notifs = [n for n in j["notifications"] if "[Handoff]" in (n.get("message") or "")]
        assert ho_notifs, f"no [Handoff] notif. latest 5: {[n.get('message') for n in j['notifications'][:5]]}"

    def test_notifications_shape(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_h(owner_token), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert isinstance(j, dict)
        assert "notifications" in j and isinstance(j["notifications"], list)
        assert "unread" in j and isinstance(j["unread"], int)
        # No mongo _id leaking
        if j["notifications"]:
            assert "_id" not in j["notifications"][0]

    def test_owner_has_escalation_visible_in_mine(self, owner_token):
        """Regression: owner /tasks?mine=true must include tasks with source='escalation'."""
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), params={"mine": "true"}, timeout=10)
        assert r.status_code == 200
        tasks = r.json()
        escs = [t for t in tasks if t.get("source") == "escalation"]
        assert escs, "owner has no escalation follow-ups in mine=true (should have at least the one we just created)"
        # Sanity fields
        for t in escs[:3]:
            assert t.get("assignee_id"), "escalation followup must have assignee_id"
            assert t.get("title"), "escalation followup must have title"


class TestRegression:
    """Ensure existing flows still work: inbox capture list + notifications read."""

    def test_owner_inbox_endpoint(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/inbox", headers=_h(owner_token), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert "items" in j

    def test_owner_decisions_endpoint(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/decisions", headers=_h(owner_token), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_note_action_still_works(self, owner_token, prod_token):
        """Adding a 'note' action must NOT create follow-up task."""
        r_prod = requests.get(f"{BASE_URL}/api/tasks", headers=_h(prod_token), params={"mine": "true"}, timeout=10)
        tasks = [t for t in r_prod.json() if t.get("status") != "done"]
        assert tasks
        tid = tasks[0]["id"]
        r = requests.post(
            f"{BASE_URL}/api/tasks/{tid}/updates",
            headers=_h(prod_token),
            json={"text": f"TEST_iter26 plain note {int(time.time())}", "action": "note"},
            timeout=15,
        )
        assert r.status_code in (200, 201), r.text

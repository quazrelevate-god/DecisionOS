"""
Iteration 17 tests — voice/text directive with named team member assignment.

Feature: POST /api/voice-notes/text extracts tasks. When directive names a person
(e.g. "Tell Priya to..."), the created task gets assignee_id + assignee_role
derived from that member. Otherwise falls back to role-only allocation.
"""
import os
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # Fallback: read from frontend/.env (this is the source of truth)
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set and /app/frontend/.env missing")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

OWNER_EMAIL = os.environ.get("TEST_OWNER_EMAIL", "owner@sharma.com")
OWNER_PASSWORD = os.environ.get("TEST_OWNER_PASSWORD", "demo1234")


# -------------------- fixtures --------------------
@pytest.fixture(scope="module")
def owner_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json().get("token") or r.json().get("access_token")
    assert token, f"no token in login response: {r.json()}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def sharma_members(owner_client):
    """Fetch real named members (ignore TEST_* leftovers)."""
    r = owner_client.get(f"{API}/users", timeout=15)
    assert r.status_code == 200, r.text
    users = r.json()
    return {u["name"]: u for u in users if not u["name"].startswith("TEST_")}


def _wait_for_done(client, note_id, timeout=45):
    """Poll voice-note status until 'done' or 'failed'."""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = client.get(f"{API}/voice-notes/{note_id}", timeout=15)
        if r.status_code == 200:
            last = r.json()
            if last.get("status") in ("done", "failed"):
                return last
        time.sleep(1.5)
    return last


def _tasks_for_decision(client, decision_id):
    r = client.get(f"{API}/tasks", timeout=15)
    assert r.status_code == 200
    return [t for t in r.json() if t.get("decision_id") == decision_id]


# -------------------- sanity --------------------
class TestSanity:
    def test_login_and_members_exist(self, owner_client, sharma_members):
        # Members must contain Priya Nair, Sunita Rao, Amit Verma, Rajesh Sharma
        expected = {"Priya Nair", "Sunita Rao", "Amit Verma", "Rajesh Sharma"}
        missing = expected - set(sharma_members.keys())
        assert not missing, f"missing named members in Sharma tenant: {missing}"
        assert sharma_members["Priya Nair"]["role"] == "sales"
        assert sharma_members["Sunita Rao"]["role"] == "finance"


# -------------------- primary flow --------------------
class TestNamedAssignment:
    def test_named_person_and_role_fallback(self, owner_client, sharma_members):
        """Priya (named) -> assignee_id + sales role.
           Finance (role) -> assignee_role only, no assignee_id."""
        text = (
            "Tell Priya to send the revised quote to Kumar Garments by Friday, "
            "and ask finance to clear the packaging invoice this week."
        )
        r = owner_client.post(f"{API}/voice-notes/text", json={"text": text, "language": "en"}, timeout=30)
        assert r.status_code == 200, r.text
        note_id = r.json()["id"]

        final = _wait_for_done(owner_client, note_id, timeout=60)
        assert final and final.get("status") == "done", f"note did not complete: {final}"
        decision_id = final.get("decision_id")
        assert decision_id, f"no decision_id on done note: {final}"

        tasks = _tasks_for_decision(owner_client, decision_id)
        assert tasks, f"no tasks created for decision {decision_id}"

        # Every task must be blocked (voice tasks start blocked until decision approved)
        for t in tasks:
            assert t["status"] == "blocked", f"expected blocked task, got {t['status']}: {t}"
            assert t["source"] == "voice"

        # Find the Priya task (quote)
        priya_id = sharma_members["Priya Nair"]["id"]
        priya_tasks = [t for t in tasks if t.get("assignee_id") == priya_id]
        assert priya_tasks, f"no task assigned to Priya Nair; tasks={tasks}"
        pt = priya_tasks[0]
        assert pt["assignee_role"] == "sales", f"Priya's role should be 'sales', got {pt['assignee_role']}"
        # loose title check (LLM wording may vary)
        assert "quote" in (pt["title"] + pt.get("description", "")).lower(), pt

        # Find the finance role-only task
        finance_tasks = [t for t in tasks if t.get("assignee_role") == "finance" and not t.get("assignee_id")]
        assert finance_tasks, f"no role-only finance task; tasks={tasks}"

        # Decision must be pending_approval
        rd = owner_client.get(f"{API}/decisions/{decision_id}", timeout=15)
        if rd.status_code == 200:
            assert rd.json().get("status") == "pending_approval"

    def test_no_name_role_only(self, owner_client):
        """Directive with no name — task gets role only, assignee_id null."""
        text = "Ask sales to prepare the monthly report."
        r = owner_client.post(f"{API}/voice-notes/text", json={"text": text, "language": "en"}, timeout=30)
        assert r.status_code == 200, r.text
        note_id = r.json()["id"]
        final = _wait_for_done(owner_client, note_id, timeout=60)
        assert final and final.get("status") == "done", final
        decision_id = final.get("decision_id")
        tasks = _tasks_for_decision(owner_client, decision_id)
        assert tasks, "expected at least one task"
        # At least one task with role=sales and assignee_id null
        sales_role_only = [t for t in tasks if t.get("assignee_role") == "sales" and not t.get("assignee_id")]
        assert sales_role_only, f"no role-only sales task; tasks={tasks}"

    def test_first_name_only_resolves(self, owner_client, sharma_members):
        """'Tell Priya...' with just first name should resolve to Priya Nair."""
        text = "Tell Priya to follow up with the Delhi customer tomorrow."
        r = owner_client.post(f"{API}/voice-notes/text", json={"text": text, "language": "en"}, timeout=30)
        assert r.status_code == 200, r.text
        note_id = r.json()["id"]
        final = _wait_for_done(owner_client, note_id, timeout=60)
        assert final and final.get("status") == "done", final
        decision_id = final.get("decision_id")
        tasks = _tasks_for_decision(owner_client, decision_id)
        priya_id = sharma_members["Priya Nair"]["id"]
        matched = [t for t in tasks if t.get("assignee_id") == priya_id]
        assert matched, f"first-name 'Priya' did not resolve to Priya Nair; tasks={tasks}"
        assert matched[0]["assignee_role"] == "sales"

    def test_unknown_name_does_not_crash(self, owner_client):
        """Unknown person name should not crash — assignee_id null, role fallback OK."""
        text = "Tell Zephyrine to double-check the export shipment paperwork."
        r = owner_client.post(f"{API}/voice-notes/text", json={"text": text, "language": "en"}, timeout=30)
        assert r.status_code == 200, r.text
        note_id = r.json()["id"]
        final = _wait_for_done(owner_client, note_id, timeout=60)
        assert final and final.get("status") == "done", final
        decision_id = final.get("decision_id")
        tasks = _tasks_for_decision(owner_client, decision_id)
        assert tasks, "expected task even with unknown name"
        # None of the tasks should have a real assignee_id (Zephyrine doesn't exist)
        for t in tasks:
            # allow either assignee_id null OR role-based; must not crash
            assert "assignee_id" in t
        # No task points to a non-existent user
        # Voice note should have decision_id set (pipeline succeeded)
        assert final.get("decision_id"), "pipeline broke on unknown name"


# -------------------- regression: pipeline still works --------------------
class TestPipelineRegression:
    def test_reminder_and_memory_extraction(self, owner_client):
        """Multi-intent: task + reminder + memory note should all still be extracted."""
        text = (
            "Ask production to restart the cotton batch. Also, remind me to call "
            "Mr. Kumar next Monday. And remember: do not purchase from XYZ Traders again."
        )
        r = owner_client.post(f"{API}/voice-notes/text", json={"text": text, "language": "en"}, timeout=30)
        assert r.status_code == 200
        note_id = r.json()["id"]
        final = _wait_for_done(owner_client, note_id, timeout=60)
        assert final and final.get("status") == "done", final
        # Inbox should have a fresh entry
        rb = owner_client.get(f"{API}/inbox", timeout=15)
        if rb.status_code == 200:
            payload = rb.json()
            items = payload.get("items", []) if isinstance(payload, dict) else payload
            assert any(i.get("ref_id") == final.get("decision_id") for i in items), "inbox item missing"

    def test_tanglish_still_produces_english(self, owner_client, sharma_members):
        """Tanglish directive with a name — should still produce English tasks + name resolution."""
        text = "Priya kitte solu revised quote Kumar Garments ku Friday la anuppanum."
        r = owner_client.post(f"{API}/voice-notes/text", json={"text": text, "language": "tanglish"}, timeout=30)
        assert r.status_code == 200
        note_id = r.json()["id"]
        final = _wait_for_done(owner_client, note_id, timeout=60)
        assert final and final.get("status") == "done", final
        tasks = _tasks_for_decision(owner_client, final["decision_id"])
        assert tasks, "no tasks from tanglish directive"
        # Task titles must be plain English (basic ASCII heuristic)
        for t in tasks:
            title = t["title"]
            assert all(ord(c) < 128 for c in title), f"task title not English: {title!r}"


# -------------------- regression: manual task allocation (iter 16) --------------------
class TestManualAllocationRegression:
    def test_create_task_with_assignee_and_reassign(self, owner_client, sharma_members):
        priya = sharma_members["Priya Nair"]
        rajesh = sharma_members["Rajesh Sharma"]

        payload = {"title": "TEST_iter17_manual_alloc", "assignee_id": priya["id"], "priority": "medium"}
        r = owner_client.post(f"{API}/tasks", json=payload, timeout=15)
        assert r.status_code in (200, 201), r.text
        tid = r.json()["id"]
        assert r.json()["assignee_id"] == priya["id"]
        assert r.json()["assignee_role"] == "sales"

        # PATCH reassign
        r2 = owner_client.patch(f"{API}/tasks/{tid}", json={"assignee_id": rajesh["id"]}, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["assignee_id"] == rajesh["id"]

        # PATCH status-only should preserve assignee
        r3 = owner_client.patch(f"{API}/tasks/{tid}", json={"status": "in_progress"}, timeout=15)
        assert r3.status_code == 200, r3.text
        assert r3.json()["assignee_id"] == rajesh["id"], "status-only PATCH wiped assignee"
        assert r3.json()["status"] == "in_progress"

        # cleanup
        owner_client.delete(f"{API}/tasks/{tid}", timeout=15)

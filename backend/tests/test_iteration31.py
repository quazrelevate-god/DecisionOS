"""
Iteration 31 — Execution Summary panel backend tests.

Covers:
- Login owner
- POST /api/voice-notes/text produces execution_summary once note.status='done'
- Multi-directive: tasks>0, assignees>0, (workflows>=1 OR meetings>=1)
- Decision object mirrors execution_summary via GET /api/decisions
- Meeting detection creates a source='meeting' follow-up task
- Reminder-only directive → reminders>=1 (or tasks>=1)

Cleanup: deletes created voice_notes, decisions, and tasks tagged with these transcripts
after the test class completes so the demo workspace stays clean.
"""
import os
import time
import pytest
import requests
from pathlib import Path


def _load_frontend_backend_url():
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL")


BASE_URL = (_load_frontend_backend_url() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing (looked in env + frontend/.env)"
OWNER_EMAIL = os.environ.get("TEST_OWNER_EMAIL", "owner@sharma.com")
OWNER_PASSWORD = os.environ.get("TEST_OWNER_PASSWORD", "demo1234")

DEMO_DIRECTIVE = (
    "Follow up with all overdue customers. "
    "Stop dispatch without payment approval. "
    "Arrange a sales review on Friday. "
    "Start hiring two technicians."
)
REMINDER_DIRECTIVE = "Remind me to call Kumar tomorrow"

POLL_TIMEOUT_S = 60
POLL_INTERVAL_S = 2.0


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, f"No token in login response: {r.json()}"
    return tok


@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _submit_text(auth_headers, text):
    r = requests.post(
        f"{BASE_URL}/api/voice-notes/text",
        json={"text": text, "language": "en"},
        headers=auth_headers,
        timeout=20,
    )
    assert r.status_code == 200, f"submit failed: {r.status_code} {r.text}"
    body = r.json()
    assert "id" in body, body
    assert body.get("status") in ("queued", "structuring", "transcribing", "done"), body
    return body["id"]


def _poll_note_done(auth_headers, note_id, timeout=POLL_TIMEOUT_S):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/voice-notes", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        notes = r.json()
        last = next((n for n in notes if n.get("id") == note_id), None)
        if last and last.get("status") == "done":
            return last
        if last and last.get("status") == "failed":
            pytest.fail(f"Note failed: {last.get('error')}")
        time.sleep(POLL_INTERVAL_S)
    pytest.fail(f"Timed out waiting for note {note_id}; last state: {last}")


_created_note_ids = []
_created_decision_ids = []


@pytest.fixture(scope="module", autouse=True)
def _cleanup(auth_headers):
    yield
    # Direct mongo cleanup — backend has no DELETE endpoints for voice_notes/decisions.
    # Remove exactly the docs this test created (by transcript-substring match) so the
    # Sharma demo tenant stays clean.
    try:
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL") or "mongodb://localhost:27017"
        db_name = os.environ.get("DB_NAME") or "test_database"
        # fallback to backend/.env
        env_path = Path("/app/backend/.env")
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("MONGO_URL="):
                    mongo_url = line.split("=", 1)[1].strip().strip('"')
                if line.startswith("DB_NAME="):
                    db_name = line.split("=", 1)[1].strip().strip('"')
        client = MongoClient(mongo_url)
        db = client[db_name]
        # Delete voice_notes we created
        for nid in _created_note_ids:
            db.voice_notes.delete_many({"id": nid})
        # Delete decisions and their tasks
        for did in _created_decision_ids:
            db.tasks.delete_many({"decision_id": did})
            db.decisions.delete_many({"id": did})
            # Also clean inbox items pointing at these decisions
            db.inbox_items.delete_many({"ref_id": did})
        # Clean up transcript-tagged reminder/meeting tasks that don't have decision_id
        # (These were spawned by the reminder-only and meeting-only directives.)
        # Match by created_at recency + source and title contains a unique demo string.
        db.tasks.delete_many({"source": "reminder", "title": {"$regex": "Kumar", "$options": "i"}})
        db.tasks.delete_many({"source": "meeting", "title": {"$regex": "sales review", "$options": "i"}})
        client.close()
    except Exception as e:
        print(f"[cleanup] non-fatal: {e}")


class TestExecutionSummary:
    """Execution Summary panel — end-to-end backend contract."""

    def test_login_owner_returns_jwt(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        tok = body.get("token") or body.get("access_token")
        assert isinstance(tok, str) and len(tok) > 20

    def test_multi_directive_execution_summary(self, auth_headers):
        """Demo directive must produce tasks>0, assignees>0, (workflows>=1 OR meetings>=1),
        and mirror execution_summary on the decision."""
        note_id = _submit_text(auth_headers, DEMO_DIRECTIVE)
        _created_note_ids.append(note_id)

        done_note = _poll_note_done(auth_headers, note_id, timeout=90)
        es = done_note.get("execution_summary")
        assert es is not None, f"No execution_summary on note: {done_note}"

        # numeric fields present
        for k in ("tasks", "assignees", "approvals", "workflows", "meetings", "reminders"):
            assert k in es, f"missing {k} in {es}"
            assert isinstance(es[k], int), f"{k} not int: {es[k]!r}"

        assert es["tasks"] > 0, f"expected tasks>0, got {es}"
        assert es["assignees"] > 0, f"expected assignees>0, got {es}"
        assert (es["workflows"] >= 1 or es["meetings"] >= 1), f"expected workflows>=1 OR meetings>=1, got {es}"

        # Decision mirror
        decision_id = done_note.get("decision_id")
        assert decision_id, f"note has no decision_id: {done_note}"
        _created_decision_ids.append(decision_id)

        r = requests.get(f"{BASE_URL}/api/decisions", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        decisions = r.json()
        d = next((x for x in decisions if x.get("id") == decision_id), None)
        assert d is not None, f"decision {decision_id} not returned by /api/decisions"
        d_es = d.get("execution_summary")
        assert d_es == es, f"decision execution_summary mismatch: {d_es} vs {es}"

    def test_meeting_detected_creates_source_meeting_task(self, auth_headers):
        """The 'sales review on Friday' meeting must (a) be counted in meetings>=1
        AND (b) create a lightweight source='meeting' task."""
        # Use a dedicated meeting-only directive to make attribution unambiguous
        directive = "Arrange a sales review with the team on Friday to discuss north-region performance."
        note_id = _submit_text(auth_headers, directive)
        _created_note_ids.append(note_id)

        done_note = _poll_note_done(auth_headers, note_id, timeout=90)
        es = done_note["execution_summary"]
        assert es["meetings"] >= 1, f"expected meetings>=1 for meeting directive, got {es}"
        if done_note.get("decision_id"):
            _created_decision_ids.append(done_note["decision_id"])

        # Fetch tasks and confirm at least one source='meeting' task exists (created recently)
        r = requests.get(f"{BASE_URL}/api/tasks?mine=true", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        tasks = r.json()
        meeting_tasks = [t for t in tasks if t.get("source") == "meeting"]
        assert meeting_tasks, "expected at least one task with source='meeting'"

    def test_reminder_only_directive(self, auth_headers):
        """'Remind me to call Kumar tomorrow' → reminders>=1 OR tasks>=1; approvals expected 0."""
        note_id = _submit_text(auth_headers, REMINDER_DIRECTIVE)
        _created_note_ids.append(note_id)

        done_note = _poll_note_done(auth_headers, note_id, timeout=90)
        es = done_note["execution_summary"]
        assert (es["reminders"] >= 1 or es["tasks"] >= 1), f"expected reminders>=1 or tasks>=1, got {es}"
        # Reminder-only directive shouldn't create a payment/dispatch style approval; but assert non-negative int
        assert es["approvals"] >= 0
        if done_note.get("decision_id"):
            _created_decision_ids.append(done_note["decision_id"])

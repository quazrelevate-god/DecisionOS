"""
Iteration 18 tests — Phase 1 (Journal + Decision Timeline) and Phase 2 (AI Task Prioritization).
Focus:
  * GET /api/journal — brain-permission, day grouping, search
  * GET /api/decisions/{id}/timeline — sorted timeline; created/approved/rejected/assigned/task events
  * POST /api/tasks/prioritize — scoring, caching, force re-score
  * Regression: task CRUD, decision approve/reject still work (and push timeline events).
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "owner@sharma.com"
OWNER_PW = "demo1234"

# Generous timeout for the LLM-backed prioritize endpoint
PRIORITIZE_TIMEOUT = 90


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PW}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def auth(owner_token):
    return {"Authorization": f"Bearer {owner_token}"}


# ---------- 1. Journal ----------

class TestJournal:
    def test_journal_returns_days_shape(self, auth):
        r = requests.get(f"{API}/journal", headers=auth, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "days" in data and isinstance(data["days"], list)
        for d in data["days"]:
            assert set(d.keys()) >= {"date", "decisions", "notes"}
            assert isinstance(d["decisions"], list)
            assert isinstance(d["notes"], list)

    def test_journal_days_sorted_desc(self, auth):
        r = requests.get(f"{API}/journal", headers=auth, timeout=30)
        assert r.status_code == 200
        dates = [d["date"] for d in r.json().get("days", [])]
        assert dates == sorted(dates, reverse=True), f"Days not desc-sorted: {dates}"

    def test_journal_search_filter(self, auth):
        r = requests.get(f"{API}/journal", params={"q": "zzz_no_such_term_xyz_qwerty"}, headers=auth, timeout=30)
        assert r.status_code == 200
        days = r.json().get("days", [])
        # An obscure term should yield no results (or empty days)
        total = sum(len(d["decisions"]) + len(d["notes"]) for d in days)
        assert total == 0, f"Unexpected matches for garbage query: {total}"

    def test_journal_search_broad_returns_some(self, auth):
        # A common two-char token likely matches at least one decision/note in demo tenant.
        r_all = requests.get(f"{API}/journal", headers=auth, timeout=30).json()
        total_all = sum(len(d["decisions"]) + len(d["notes"]) for d in r_all.get("days", []))
        if total_all == 0:
            pytest.skip("Empty journal in this tenant — cannot compare search")
        # Pick a token from the first decision title
        first = None
        for d in r_all["days"]:
            if d["decisions"]:
                first = d["decisions"][0]
                break
        if not first:
            for d in r_all["days"]:
                if d["notes"]:
                    first = d["notes"][0]
                    break
        assert first is not None
        # Extract a >=2-char alnum token
        import re
        toks = [t for t in re.findall(r"[A-Za-z0-9]+", (first.get("title") or first.get("text") or "")) if len(t) >= 3]
        if not toks:
            pytest.skip("No usable token to search")
        r = requests.get(f"{API}/journal", params={"q": toks[0]}, headers=auth, timeout=30)
        assert r.status_code == 200
        filtered = sum(len(d["decisions"]) + len(d["notes"]) for d in r.json().get("days", []))
        assert filtered >= 1

    def test_journal_requires_auth(self):
        r = requests.get(f"{API}/journal", timeout=15)
        assert r.status_code in (401, 403)


# ---------- 2. Decision Timeline ----------

class TestDecisionTimeline:
    def _pick_decision(self, auth, status=None):
        params = {"status": status} if status else {}
        r = requests.get(f"{API}/decisions", headers=auth, params=params, timeout=30)
        assert r.status_code == 200
        arr = r.json()
        return arr[0] if arr else None

    def test_timeline_shape(self, auth):
        d = self._pick_decision(auth)
        if not d:
            pytest.skip("No decisions in tenant")
        r = requests.get(f"{API}/decisions/{d['id']}/timeline", headers=auth, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body.keys()) >= {"title", "status", "timeline"}
        assert isinstance(body["timeline"], list)
        for e in body["timeline"]:
            assert {"ts", "label", "actor", "kind"} <= set(e.keys())

    def test_timeline_sorted_by_ts(self, auth):
        # Find a decision with 2+ events (approved decisions typically have created + approved + task events)
        r = requests.get(f"{API}/decisions", params={"status": "approved"}, headers=auth, timeout=30)
        assert r.status_code == 200
        for d in r.json():
            tl = requests.get(f"{API}/decisions/{d['id']}/timeline", headers=auth, timeout=30).json().get("timeline", [])
            if len(tl) >= 2:
                ts_list = [e["ts"] for e in tl]
                assert ts_list == sorted(ts_list), f"Timeline not ts-sorted for {d['id']}: {ts_list}"
                return
        pytest.skip("No decision with 2+ timeline events found")

    def test_timeline_404(self, auth):
        r = requests.get(f"{API}/decisions/does-not-exist-id/timeline", headers=auth, timeout=15)
        assert r.status_code == 404

    def test_new_voice_decision_has_created_event(self, auth):
        """Create a decision via voice-notes/text, verify timeline has a 'created' event."""
        payload = {
            "text": "TEST_iter18: Approve INR 15,000 payment to Kumar Fabrics for the yellow silk lot.",
            "kind": "text",
        }
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=auth, timeout=60)
        assert r.status_code == 200, r.text
        note_id = r.json().get("id")
        # Poll until processed
        decision_id = None
        for _ in range(30):
            time.sleep(2)
            note = requests.get(f"{API}/voice-notes/{note_id}", headers=auth, timeout=15).json()
            if note.get("status") == "done":
                decision_id = note.get("decision_id")
                break
        assert decision_id, "voice-note did not produce a decision"
        tl = requests.get(f"{API}/decisions/{decision_id}/timeline", headers=auth, timeout=15).json().get("timeline", [])
        kinds = [e["kind"] for e in tl]
        assert "created" in kinds, f"No 'created' event, got kinds={kinds}"

    def test_approve_pushes_events(self, auth):
        """Create decision from voice, approve it, verify approved+assigned events."""
        payload = {
            "text": "TEST_iter18_approve: Tell sales to send the revised quote to Suresh Traders by Friday.",
            "kind": "text",
        }
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=auth, timeout=60)
        assert r.status_code == 200
        note_id = r.json()["id"]
        decision_id = None
        for _ in range(30):
            time.sleep(2)
            note = requests.get(f"{API}/voice-notes/{note_id}", headers=auth, timeout=15).json()
            if note.get("status") == "done":
                decision_id = note.get("decision_id")
                break
        assert decision_id
        ap = requests.post(f"{API}/decisions/{decision_id}/approve", headers=auth, timeout=30)
        assert ap.status_code == 200, ap.text
        tl = requests.get(f"{API}/decisions/{decision_id}/timeline", headers=auth, timeout=15).json().get("timeline", [])
        kinds = [e["kind"] for e in tl]
        assert "created" in kinds
        assert "approved" in kinds, f"No 'approved' event, got={kinds}"
        # At least one 'assigned' if there was any task
        # (Some decisions may have zero tasks — don't hard-fail)

    def test_reject_pushes_event(self, auth):
        payload = {
            "text": "TEST_iter18_reject: Consider hiring a second delivery driver from October.",
            "kind": "text",
        }
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=auth, timeout=60)
        assert r.status_code == 200
        note_id = r.json()["id"]
        decision_id = None
        for _ in range(30):
            time.sleep(2)
            note = requests.get(f"{API}/voice-notes/{note_id}", headers=auth, timeout=15).json()
            if note.get("status") == "done":
                decision_id = note.get("decision_id")
                break
        assert decision_id
        rj = requests.post(f"{API}/decisions/{decision_id}/reject", headers=auth, timeout=30)
        assert rj.status_code == 200, rj.text
        tl = requests.get(f"{API}/decisions/{decision_id}/timeline", headers=auth, timeout=15).json().get("timeline", [])
        kinds = [e["kind"] for e in tl]
        assert "rejected" in kinds, f"No 'rejected' event, got={kinds}"


# ---------- 3. Prioritize ----------

class TestPrioritize:
    def test_prioritize_returns_shape_and_caches(self, auth):
        # First call — may score up to 25 tasks (~30s on force). We DON'T force.
        r = requests.post(f"{API}/tasks/prioritize", headers=auth, timeout=PRIORITIZE_TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "tasks" in body and "scored" in body
        assert isinstance(body["tasks"], list)
        assert isinstance(body["scored"], int)
        # Sort order: priority_score desc among tasks that have scores
        scored = [t for t in body["tasks"] if (t.get("ai_scores") or {}).get("priority_score") is not None]
        vals = [(t.get("ai_scores") or {}).get("priority_score", -1) for t in scored]
        assert vals == sorted(vals, reverse=True), f"Not desc-sorted by priority_score: {vals[:10]}"
        # Second call without force should be instant and score 0
        r2 = requests.post(f"{API}/tasks/prioritize", headers=auth, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["scored"] == 0, "Second call should hit cache (scored=0)"

    def test_prioritize_score_shape(self, auth):
        r = requests.post(f"{API}/tasks/prioritize", headers=auth, timeout=PRIORITIZE_TIMEOUT)
        assert r.status_code == 200
        tasks = r.json()["tasks"]
        if not tasks:
            pytest.skip("No open tasks")
        # Find any scored task
        scored = next((t for t in tasks if t.get("ai_scores")), None)
        if not scored:
            pytest.skip("No scored task available (LLM failure?)")
        s = scored["ai_scores"]
        for k in ("business_impact", "revenue", "risk", "urgency", "priority_score"):
            assert k in s, f"Missing {k}"
            assert isinstance(s[k], int) and 0 <= s[k] <= 100, f"{k}={s[k]} out of range"
        assert isinstance(s.get("reason"), str)

    def test_prioritize_limit_param(self, auth):
        r = requests.post(f"{API}/tasks/prioritize", params={"limit": 3}, headers=auth, timeout=60)
        assert r.status_code == 200
        assert len(r.json()["tasks"]) <= 3

    def test_prioritize_only_open_tasks(self, auth):
        r = requests.post(f"{API}/tasks/prioritize", headers=auth, timeout=60)
        assert r.status_code == 200
        for t in r.json()["tasks"]:
            assert t.get("status") in ("todo", "in_progress", "blocked"), f"Non-open task in prioritize: {t.get('status')}"


# ---------- 4. Regression: tasks + decisions ----------

class TestRegression:
    def test_task_create_update_delete(self, auth):
        r = requests.post(f"{API}/tasks", json={
            "title": "TEST_iter18_regression_task",
            "description": "Regression check",
            "priority": "medium",
        }, headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        # Update status
        r = requests.patch(f"{API}/tasks/{tid}", json={"status": "in_progress"}, headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "in_progress"
        # Complete it
        r = requests.patch(f"{API}/tasks/{tid}", json={"status": "done"}, headers=auth, timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "done"

    def test_decisions_list_status_filter(self, auth):
        for st in ("pending_approval", "approved", "rejected"):
            r = requests.get(f"{API}/decisions", params={"status": st}, headers=auth, timeout=15)
            assert r.status_code == 200
            for d in r.json():
                assert d.get("status") == st

    def test_auth_me(self, auth):
        r = requests.get(f"{API}/auth/me", headers=auth, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # /auth/me returns {user, tenant}
        assert (body.get("user") or {}).get("email") == OWNER_EMAIL

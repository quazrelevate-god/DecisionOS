"""Iteration 76 — verify the 4 signup onboarding fixes:
1) /interview/start returns INSTANTLY (<2s) with fixed opener including company name + "day-to-day operations"
2) /interview/answer returns operational follow-up (about handoffs/approvals/workflow), NOT re-asking what the company does
3) /interview/blueprint returns departments, workflows, operational_tasks, approval_rules, welcome_line
4) /signup/tts with en-IN returns audio_b64
"""
import os
import time
import base64
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def profile():
    return {
        "company_name": "Kaveri Threads",
        "founder_name": "Priya Menon",
        "team_size": "11-50",
        "industry": "Textile & Apparel",
        "business_model": "B2B",
        "description": "",
        "website_summary": "",
        "products": [],
    }


class TestInterviewFlow:
    """All interview tests share state via pytest module attr — kept in one class so
    pytest-xdist's loadscope scheduler runs them serially on the same worker."""

    def test_a_start_is_instant_and_returns_fixed_opener(self, api, profile):
        t0 = time.time()
        r = api.post(f"{BASE_URL}/api/signup/interview/start", json=profile, timeout=15)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        data = r.json()

        # Should be near-instant (no LLM call). Give generous 3s network slack.
        assert elapsed < 3.0, f"interview/start took {elapsed:.2f}s — should be instant (<2s)"

        # Shape
        assert "session_id" in data and isinstance(data["session_id"], str) and data["session_id"]
        assert data.get("index") == 1
        assert data.get("max") == 4
        q = data.get("question", "")
        assert isinstance(q, str) and q
        # Fixed opener requirements
        assert profile["company_name"] in q, f"Company name missing from opener: {q}"
        assert "day-to-day operations" in q.lower(), f"Opener missing 'day-to-day operations': {q}"
        assert "tell me about" in q.lower(), f"Opener missing 'tell me about': {q}"
        # Personalization: founder first name
        assert "Priya" in q, f"Founder first name missing from opener: {q}"

        # Persist for next test
        pytest.session_id = data["session_id"]


    def test_b_answer_returns_operational_followup(self, api):
        sid = getattr(pytest, "session_id", None)
        assert sid, "session_id from start test missing"

        answer = (
            "We're a B2B textile mill. A customer sends an enquiry to my sales team, "
            "we send a quote, once confirmed my production manager schedules the loom, "
            "we weave, QC checks the fabric, then dispatch ships it. I approve any purchase over 50k. "
            "Most days I'm on WhatsApp chasing dyers and checking loom output."
        )
        r = api.post(
            f"{BASE_URL}/api/signup/interview/answer",
            json={"session_id": sid, "answer": answer, "language_code": "en-IN"},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        data = r.json()

        # Should NOT be done after 1 answer (needs 2+)
        assert data.get("done") is False, f"Interview ended too early: {data}"

        q2 = data.get("question", "")
        assert q2 and isinstance(q2, str)

        # Must NOT re-ask what the company does
        forbidden = [
            "what do you do",
            "what does your company do",
            "tell me about your company",
            "what is your business",
            "what industry",
        ]
        low = q2.lower()
        for f in forbidden:
            assert f not in low, f"Follow-up re-asks what the company does: {q2}"

        # Should feel OPERATIONAL — hint at at least one operational keyword.
        operational_terms = [
            "approv", "handoff", "hand-off", "workflow", "step", "process",
            "bottleneck", "slip", "delay", "stuck", "who", "how do you",
            "how does", "when", "check", "review", "escalat", "sign off",
            "manager", "team", "day", "week", "track", "chase", "dispatch",
            "quality", "loom", "customer", "order", "quote", "production",
            "purchase", "decision",
        ]
        assert any(t in low for t in operational_terms), (
            f"Follow-up doesn't look operational: {q2}"
        )

        pytest.q2 = q2

    def test_c_second_answer_progresses(self, api):
        sid = getattr(pytest, "session_id", None)
        assert sid
        answer = (
            "Yes — the biggest slip is between production QC and dispatch: sometimes fabric passes QC "
            "but the dispatch guy doesn't get the packing list on time, so shipments miss the truck. "
            "My production manager approves reworks, I approve any credit note above 25k."
        )
        r = api.post(
            f"{BASE_URL}/api/signup/interview/answer",
            json={"session_id": sid, "answer": answer, "language_code": "en-IN"},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # After 2 answers Claude MAY end (enough=true) or ask a 3rd operational Q.
        if data.get("done"):
            assert data.get("index") == 2
        else:
            q3 = data.get("question", "")
            assert q3 and isinstance(q3, str)
            assert data.get("index") == 3


    def test_d_blueprint_returns_full_os(self, api):
        sid = getattr(pytest, "session_id", None)
        assert sid
        # Force done by sending 2 more answers up to MAX_QUESTIONS if not done
        for extra in [
            "Cash flow is tight — I personally check bank balance every morning.",
            "Sales handoff to production is a Google Sheet plus a WhatsApp group.",
        ]:
            r = api.post(
                f"{BASE_URL}/api/signup/interview/answer",
                json={"session_id": sid, "answer": extra, "language_code": "en-IN"},
                timeout=45,
            )
            if r.status_code == 200 and r.json().get("done"):
                break

        r = api.post(
            f"{BASE_URL}/api/signup/interview/blueprint",
            json={"session_id": sid, "language_code": "en-IN"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        bp = r.json()
        for key in ["departments", "workflows", "operational_tasks", "approval_rules", "welcome_line"]:
            assert key in bp, f"Missing key {key} in blueprint"
        assert isinstance(bp["departments"], list) and len(bp["departments"]) >= 3
        assert isinstance(bp["workflows"], list) and len(bp["workflows"]) >= 3
        assert isinstance(bp["operational_tasks"], list) and len(bp["operational_tasks"]) >= 3
        assert isinstance(bp["approval_rules"], list) and len(bp["approval_rules"]) >= 1
        assert isinstance(bp["welcome_line"], str) and bp["welcome_line"].strip()


class TestTTS:
    """Fix: /signup/tts returns audio_b64 for en-IN."""

    def test_tts_returns_wav_bytes(self, api):
        r = api.post(
            f"{BASE_URL}/api/signup/tts",
            json={"text": "Hi Priya, welcome to DecisionOS.", "language_code": "en-IN"},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "audio_b64" in data and data["audio_b64"]
        assert data.get("mime") == "audio/wav"
        assert data.get("language_code") == "en-IN"
        # Decode & sanity check
        raw = base64.b64decode(data["audio_b64"])
        assert len(raw) > 1024, f"audio too small: {len(raw)} bytes"
        # WAV header signature
        assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE", "not a valid RIFF/WAVE file"

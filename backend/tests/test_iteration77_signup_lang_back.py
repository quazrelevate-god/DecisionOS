"""Iteration 77 — verify NEW signup onboarding language + back-button features.

Focus:
  1) /interview/start returns instant localized opener for ta-IN (Tamil script + company name)
  2) /interview/start with hi-IN + empty founder_name → Hindi opener WITHOUT a name in it
  3) /interview/start with unknown/missing language_code falls back to en-IN opener
  4) /interview/answer on a ta-IN session returns operational Q2 in Tamil (native script)
     and language persists in the session (no language_code needed on second call)
  5) /interview/back at Q1 (empty qa) returns 400 "Already at the first question"
  6) /interview/back after answering pops the last Q&A, returns prev question + prev_answer + index
  7) Re-answering after going back progresses the interview correctly
  8) /signup/tts returns valid RIFF/WAVE base64 audio for ta-IN, hi-IN, pa-IN, en-IN
"""
import os
import time
import base64
import re
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _base_profile(**overrides):
    p = {
        "company_name": "Kaveri Threads",
        "founder_name": "Priya Menon",
        "team_size": "11-50",
        "industry": "Textile & Apparel",
        "business_model": "B2B",
        "description": "",
        "website_summary": "",
        "products": [],
        "language_code": "en-IN",
    }
    p.update(overrides)
    return p


# ---------------------------------------------------------------------------
# 1) /interview/start localized openers
# ---------------------------------------------------------------------------
class TestInterviewStartOpeners:
    def test_ta_in_returns_instant_tamil_opener_with_company(self, api):
        t0 = time.time()
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=_base_profile(language_code="ta-IN"),
            timeout=15,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        data = r.json()
        # Instant (no LLM)
        assert elapsed < 3.0, f"ta-IN start took {elapsed:.2f}s — should be instant"
        # Shape
        assert data.get("index") == 1 and data.get("max") == 4
        assert data.get("language_code") == "ta-IN"
        q = data.get("question", "")
        # Tamil-script opener
        assert "வணக்கம்" in q, f"Tamil greeting missing: {q!r}"
        assert "Kaveri Threads" in q, f"Company missing from Tamil opener: {q!r}"
        # Contains Tamil unicode range chars
        assert re.search(r"[\u0B80-\u0BFF]", q), "No Tamil unicode chars in question"

    def test_hi_in_empty_founder_name_returns_hindi_opener_without_name(self, api):
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=_base_profile(founder_name="", language_code="hi-IN"),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("language_code") == "hi-IN"
        q = data.get("question", "")
        # Hindi greeting present
        assert "नमस्ते" in q, f"Hindi greeting missing: {q!r}"
        # Company present
        assert "Kaveri Threads" in q, f"Company missing from Hindi opener: {q!r}"
        # No dangling name: template is "नमस्ते{name} — मुझे {company} ...".
        # With empty name the greeting must be immediately followed by " —" (em dash) with just a space.
        assert re.search(r"नमस्ते\s+—", q), f"Empty-name Hindi opener has stray name/space: {q!r}"

    def test_unknown_language_code_falls_back_to_english(self, api):
        # Unknown code → en-IN
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=_base_profile(language_code="zz-ZZ"),
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("language_code") == "en-IN"
        q = data.get("question", "")
        assert "tell me about" in q.lower()
        assert "Kaveri Threads" in q
        assert "Priya" in q  # founder first name still injected

    def test_missing_language_code_defaults_to_english(self, api):
        payload = _base_profile()
        payload.pop("language_code", None)  # simulate frontend not sending it
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=payload,
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("language_code") == "en-IN"
        assert "tell me about" in data.get("question", "").lower()


# ---------------------------------------------------------------------------
# 2) /interview/answer preserves language (Tamil follow-up)
# ---------------------------------------------------------------------------
class TestInterviewAnswerLangPersists:
    """Class-scoped: start a Tamil session, answer once, verify Q2 is in Tamil
    and session persists the language even without language_code on the call."""

    @pytest.fixture(scope="class")
    def tamil_session_id(self, api):
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=_base_profile(language_code="ta-IN"),
            timeout=15,
        )
        assert r.status_code == 200
        return r.json()["session_id"]

    def test_answer_returns_tamil_question_language_persists(self, api, tamil_session_id):
        # Answer in English but session language is Tamil — question must come back in Tamil.
        # Do NOT send language_code, so we prove it's read from the session.
        r = api.post(
            f"{BASE_URL}/api/signup/interview/answer",
            json={
                "session_id": tamil_session_id,
                "answer": (
                    "We're a small textile mill. Orders come via WhatsApp, my production manager "
                    "schedules the loom, we weave, QC checks the fabric, then dispatch ships it. "
                    "I approve any purchase above 50k."
                ),
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("done") is False
        assert data.get("language_code") == "ta-IN", f"language not persisted: {data}"
        q = data.get("question", "")
        # Question must contain Tamil script chars (native, not transliteration)
        assert re.search(r"[\u0B80-\u0BFF]", q), (
            f"Q2 not in Tamil script: {q!r}"
        )
        # Store for downstream back-button tests
        pytest.tamil_session_id = tamil_session_id
        pytest.tamil_q2 = q


# ---------------------------------------------------------------------------
# 3) /interview/back — edge case (Q1) + happy path
# ---------------------------------------------------------------------------
class TestInterviewBack:
    def test_back_at_q1_returns_400(self, api):
        # Start fresh session; qa is empty → back must 400.
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=_base_profile(language_code="en-IN"),
            timeout=15,
        )
        assert r.status_code == 200
        sid = r.json()["session_id"]

        r2 = api.post(
            f"{BASE_URL}/api/signup/interview/back",
            json={"session_id": sid},
            timeout=15,
        )
        assert r2.status_code == 400, r2.text
        detail = r2.json().get("detail", "")
        assert "first" in detail.lower(), f"unexpected detail: {detail}"

    def test_back_unknown_session_returns_404(self, api):
        r = api.post(
            f"{BASE_URL}/api/signup/interview/back",
            json={"session_id": "does-not-exist-xyz"},
            timeout=15,
        )
        assert r.status_code == 404

    def test_back_pops_last_qa_and_reanswer_progresses(self, api):
        # Fresh English session
        r = api.post(
            f"{BASE_URL}/api/signup/interview/start",
            json=_base_profile(language_code="en-IN"),
            timeout=15,
        )
        assert r.status_code == 200
        start_data = r.json()
        sid = start_data["session_id"]
        q1_text = start_data["question"]

        # Answer 1 → Q2 appears
        first_answer = (
            "We are a B2B textile mill in Coimbatore. Orders come from big retailers, "
            "my production manager schedules looms, and QC checks fabric before dispatch."
        )
        r2 = api.post(
            f"{BASE_URL}/api/signup/interview/answer",
            json={"session_id": sid, "answer": first_answer, "language_code": "en-IN"},
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2.get("done") is False
        assert d2.get("index") == 2

        # BACK: pop Q1 answer, return to Q1 with prev_answer prefilled
        r3 = api.post(
            f"{BASE_URL}/api/signup/interview/back",
            json={"session_id": sid},
            timeout=15,
        )
        assert r3.status_code == 200, r3.text
        d3 = r3.json()
        assert d3.get("prev_answer") == first_answer, (
            f"prev_answer mismatch: {d3.get('prev_answer')!r} vs {first_answer!r}"
        )
        assert d3.get("question") == q1_text, "back did not restore Q1 question"
        # index after back = len(qa) before pop = 1 (the position of the question we returned to)
        assert d3.get("index") == 1, f"unexpected index after back: {d3.get('index')}"
        assert d3.get("max") == 4

        # Re-answer with edited text → should progress to Q2 again
        edited = first_answer + " We ship pan-India via GATI."
        r4 = api.post(
            f"{BASE_URL}/api/signup/interview/answer",
            json={"session_id": sid, "answer": edited, "language_code": "en-IN"},
            timeout=60,
        )
        assert r4.status_code == 200, r4.text
        d4 = r4.json()
        assert d4.get("done") is False, f"interview ended prematurely: {d4}"
        assert d4.get("index") == 2
        assert d4.get("question"), "Q2 missing after re-answer"


# ---------------------------------------------------------------------------
# 4) /signup/tts per-language speakers → valid audio
# ---------------------------------------------------------------------------
class TestTTSPerLanguage:
    """Per-language TTS. Uses short native-script text so Sarvam can synthesise it correctly."""

    SAMPLES = {
        "en-IN": "Hello and welcome to DecisionOS.",
        "hi-IN": "नमस्ते, डिसीज़नओएस में आपका स्वागत है।",
        "ta-IN": "வணக்கம், DecisionOS-க்கு உங்களை வரவேற்கிறோம்.",
        "pa-IN": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ, DecisionOS ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ।",
    }

    @pytest.mark.parametrize("lang", ["en-IN", "hi-IN", "ta-IN", "pa-IN"])
    def test_tts_returns_valid_wav_bytes(self, api, lang):
        r = api.post(
            f"{BASE_URL}/api/signup/tts",
            json={"text": self.SAMPLES[lang], "language_code": lang},
            timeout=60,
        )
        assert r.status_code == 200, f"{lang} TTS failed: {r.status_code} {r.text[:200]}"
        data = r.json()
        assert data.get("mime") == "audio/wav"
        assert data.get("language_code") == lang
        b64 = data.get("audio_b64") or ""
        assert b64, f"{lang}: empty audio_b64"
        raw = base64.b64decode(b64)
        assert len(raw) > 1024, f"{lang}: audio too small ({len(raw)}B)"
        assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE", (
            f"{lang}: not a valid RIFF/WAVE file (header={raw[:12]!r})"
        )

"""Iteration 75 — tests for the newly added auto-adaptive language plumbing
across the signup voice interview endpoints.

Covered:
  1. POST /api/signup/tts accepts `language_code`, returns non-empty audio_b64,
     and echoes back the normalised language_code for both en-IN and hi-IN.
  2. POST /api/signup/stt returns both `text` and `language_code` (may be "").
  3. POST /api/signup/interview/answer accepts optional `language_code`,
     persists it on the session, and returns it in the response.
  4. POST /api/signup/interview/blueprint accepts optional `language_code`
     and produces a welcome_line — Devanagari for hi-IN, ASCII for en-IN.
     Departments / workflows / operational_tasks stay English regardless.
"""
import base64
import os
import re
import time
import unicodedata

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
AUDIO_FIXTURE = "/app/test_fixtures/audio.wav"

HINDI_WELCOME_PROFILE = {
    "company_name": f"LangTest Weavers {int(time.time())}",
    "founder_name": "Meera Test",
    "team_size": "11-50",
    "industry": "Textile & Apparel",
    "business_model": "B2B",
    "description": "We weave and export cotton fabrics from Panipat to Gulf garment brands.",
    "website_summary": "Cotton weaving mill exporting to Gulf",
    "products": [{"name": "Cotton fabric", "description": "Loomed cotton for garments"}],
}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    return s


# ---------------------------------------------------------------------------
# 1. TTS language_code plumbing
# ---------------------------------------------------------------------------
class TestTTSLanguage:
    """POST /api/signup/tts must accept language_code and echo it back."""

    def test_tts_english(self, api):
        r = api.post(f"{BASE_URL}/api/signup/tts",
                     json={"text": "Hello, welcome to DecisionOS.", "language_code": "en-IN"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("language_code") == "en-IN"
        b64 = data.get("audio_b64") or ""
        assert len(b64) > 500, f"audio_b64 too small: {len(b64)}"
        # Sarvam returns base64 WAV — verify header
        raw = base64.b64decode(b64)
        assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE", "Not a valid WAV"

    def test_tts_hindi(self, api):
        r = api.post(f"{BASE_URL}/api/signup/tts",
                     json={"text": "नमस्ते, DecisionOS में आपका स्वागत है।",
                           "language_code": "hi-IN"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("language_code") == "hi-IN"
        b64 = data.get("audio_b64") or ""
        assert len(b64) > 500, f"audio_b64 too small: {len(b64)}"
        raw = base64.b64decode(b64)
        assert raw[:4] == b"RIFF"

    def test_tts_unknown_language_defaults_to_english(self, api):
        r = api.post(f"{BASE_URL}/api/signup/tts",
                     json={"text": "Hello", "language_code": "xx-YY"})
        assert r.status_code == 200, r.text
        assert r.json().get("language_code") == "en-IN"


# ---------------------------------------------------------------------------
# 2. STT returns text + language_code shape
# ---------------------------------------------------------------------------
class TestSTTShape:
    def test_stt_returns_text_and_language_code(self, api):
        assert os.path.exists(AUDIO_FIXTURE), \
            f"Missing test fixture {AUDIO_FIXTURE}"
        with open(AUDIO_FIXTURE, "rb") as f:
            files = {"file": ("answer.wav", f, "audio/wav")}
            # requests will drop json content-type when files are used
            r = requests.post(f"{BASE_URL}/api/signup/stt", files=files, timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "text" in body and isinstance(body["text"], str)
        assert "language_code" in body and isinstance(body["language_code"], str)


# ---------------------------------------------------------------------------
# 3+4. Interview answer + blueprint language plumbing
# ---------------------------------------------------------------------------
def _start_session(api, profile):
    r = api.post(f"{BASE_URL}/api/signup/interview/start", json=profile, timeout=90)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("language_code") == "en-IN"  # Q1 is always English
    assert data.get("question")
    return data["session_id"]


def _feed_answer(api, sid, text, lang):
    return api.post(f"{BASE_URL}/api/signup/interview/answer",
                    json={"session_id": sid, "answer": text, "language_code": lang},
                    timeout=90)


class TestInterviewLanguage:
    """The `language_code` field is threaded start → answer → blueprint."""

    @pytest.fixture(scope="class")
    def hindi_session(self, api):
        sid = _start_session(api, HINDI_WELCOME_PROFILE)
        # Answer #1 in Hindi — expect language_code echoed back
        r1 = _feed_answer(
            api, sid,
            "हमारे यहाँ ऑर्डर व्हाट्सएप पर आते हैं, फिर हम कच्चा माल खरीदते हैं और चार हफ्ते में डिलीवर करते हैं।",
            "hi-IN",
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1.get("language_code") == "hi-IN", d1
        # Answer #2 — enough may or may not be true
        r2 = _feed_answer(
            api, sid,
            "हमारे पास तीन प्रोडक्शन मैनेजर हैं, हर एक अपनी टीम को देखता है। पैसों की मंज़ूरी मैं खुद देता हूँ।",
            "hi-IN",
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("language_code") == "hi-IN"
        return sid

    def test_answer_persists_language_on_session(self, api, hindi_session):
        """After 2 answers with hi-IN, the blueprint call without a code must default to hi-IN."""
        # We rely on session persistence: pass empty code → server should use session.language_code
        r = api.post(f"{BASE_URL}/api/signup/interview/blueprint",
                     json={"session_id": hindi_session, "language_code": ""},
                     timeout=120)
        assert r.status_code == 200, r.text
        bp = r.json()
        # welcome_line must contain Devanagari because session lang is hi-IN
        wl = bp.get("welcome_line") or ""
        assert wl, "welcome_line missing"
        assert re.search(r"[\u0900-\u097F]", wl), \
            f"welcome_line is not Devanagari when session lang=hi-IN: {wl!r}"

    def test_blueprint_hindi_welcome_line_but_english_structure(self, api):
        # Fresh session so we can also assert override behaviour
        sid = _start_session(api, HINDI_WELCOME_PROFILE)
        _feed_answer(api, sid, "Orders come in on WhatsApp then we buy raw material and ship in four weeks.", "en-IN")
        _feed_answer(api, sid, "Approvals for any spend above 1 lakh come to me personally.", "en-IN")

        r = api.post(f"{BASE_URL}/api/signup/interview/blueprint",
                     json={"session_id": sid, "language_code": "hi-IN"},
                     timeout=120)
        assert r.status_code == 200, r.text
        bp = r.json()

        # welcome_line — Devanagari
        wl = bp.get("welcome_line") or ""
        assert wl, "welcome_line missing"
        assert re.search(r"[\u0900-\u097F]", wl), \
            f"welcome_line lacks Devanagari when language_code=hi-IN: {wl!r}"

        # departments — English (ASCII letters only allowed, no Devanagari)
        depts = bp.get("departments") or []
        assert depts, "departments empty"
        for d in depts:
            name = d if isinstance(d, str) else (d.get("label") or d.get("name") or "")
            assert not re.search(r"[\u0900-\u097F]", name), \
                f"Department leaked into Hindi: {name!r}"

        # workflows — English
        for w in (bp.get("workflows") or []):
            name = w.get("name", "")
            assert not re.search(r"[\u0900-\u097F]", name), \
                f"Workflow name leaked into Hindi: {name!r}"

        # operational_tasks — English
        for t in (bp.get("operational_tasks") or []):
            title = t.get("title", "")
            assert not re.search(r"[\u0900-\u097F]", title), \
                f"Task title leaked into Hindi: {title!r}"

    def test_blueprint_english_welcome_line_stays_ascii(self, api):
        sid = _start_session(api, HINDI_WELCOME_PROFILE)
        _feed_answer(api, sid, "Orders arrive on WhatsApp, we run production in four weeks.", "en-IN")
        _feed_answer(api, sid, "I personally approve any spend above 1 lakh.", "en-IN")
        r = api.post(f"{BASE_URL}/api/signup/interview/blueprint",
                     json={"session_id": sid, "language_code": "en-IN"},
                     timeout=120)
        assert r.status_code == 200, r.text
        wl = r.json().get("welcome_line") or ""
        assert wl
        # No Devanagari when en-IN
        assert not re.search(r"[\u0900-\u097F]", wl), \
            f"English welcome_line has Devanagari chars: {wl!r}"
        # Should be Latin-heavy (allow some punctuation)
        latin = sum(1 for c in wl if unicodedata.name(c, "").startswith("LATIN"))
        assert latin > len(wl) * 0.4, f"Welcome line doesn't look English: {wl!r}"

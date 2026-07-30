"""Iteration 74 backend tests — new founder-onboarding signup pipeline.

Endpoints under test (all PUBLIC, no auth):
    POST /api/signup/check-email
    POST /api/signup/website-intel
    POST /api/signup/interview/start
    POST /api/signup/interview/answer   (called 4x -> adaptive flow, done:true at end)
    POST /api/signup/interview/blueprint
    POST /api/signup/tts                (Sarvam bulbul:v3)
    POST /api/signup/stt                (Sarvam saaras:v3 — accepts small audio; 503 tolerated)
"""
import base64
import os
import time

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


# ---- Fixtures ----
@pytest.fixture(scope="module")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- Email availability ----
def test_check_email_taken_for_demo_owner(http):
    r = http.post(f"{API}/signup/check-email", json={"email": "owner@sharma.com"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("available") is False, body


def test_check_email_available_for_random(http):
    fresh = f"tester+{int(time.time() * 1000)}@nowhere-testco.io"
    r = http.post(f"{API}/signup/check-email", json={"email": fresh})
    assert r.status_code == 200
    assert r.json().get("available") is True


# ---- Website intel ----
def test_website_intel_stripe_real_fetch(http):
    r = http.post(
        f"{API}/signup/website-intel",
        json={"url": "stripe.com", "company_name": "Stripe"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("fetched") is True, data
    assert isinstance(data.get("summary"), str) and len(data["summary"]) > 20
    assert data.get("industry")
    assert data.get("business_model") in [
        "B2B", "B2C", "B2B & B2C", "D2C", "Marketplace", "Services", ""
    ]
    # Real content assertion — Stripe is a payments company
    joined = (data["summary"] + " " + " ".join(h for h in data.get("highlights") or [])).lower()
    assert any(k in joined for k in ["payment", "billing", "money", "finance", "commerce", "checkout"]), joined


def test_website_intel_garbage_url(http):
    r = http.post(
        f"{API}/signup/website-intel",
        json={"url": "notarealwebsite-xyz-123.com", "company_name": "Nope"},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("fetched") is False


# ---- Adaptive interview + blueprint ----
INTERVIEW_PROFILE = {
    "company_name": "Iteration74 Weavers",
    "founder_name": "Meera Test",
    "team_size": "11-50",
    "industry": "Textile & Apparel",
    "business_model": "B2B",
    "description": "We weave and export cotton fabrics to European garment brands.",
    "website_summary": "You weave premium cotton fabrics and export to European garment brands.",
    "products": [{"name": "Cotton fabric", "description": "Loom-woven fabric"}],
}

CANNED_ANSWERS = [
    "Orders come in from our two overseas agents by email. My production manager Rakesh drafts a job card, we book yarn, weave for 2 weeks, quality-check and ship via CIF Mumbai. Payments trail invoices by 60 days on average.",
    "Yarn availability slips the most — the mill sometimes short-supplies our count and we hunt in the open market. Also QC rejects mean re-weaving one shipment a month.",
    "I personally approve any purchase over ₹2 lakh, and my brother-in-law signs on shipments above 20 tonnes. Salaries are approved by our accountant on the 1st.",
    "Every morning I check yesterday's loom output vs plan, cash in bank, and any customer complaints. That's the pulse I want on one screen.",
]


@pytest.fixture(scope="module")
def interview_session(http):
    r = http.post(f"{API}/signup/interview/start", json=INTERVIEW_PROFILE, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("session_id")
    assert data.get("question")
    assert data.get("index") == 1 and data.get("max") == 4
    return data


def test_interview_full_loop_and_adaptive(http, interview_session):
    session_id = interview_session["session_id"]
    q_text = interview_session["question"]
    assert len(q_text.split()) < 50
    questions_seen = [q_text]

    done = False
    idx = 1
    for i in range(4):
        r = http.post(
            f"{API}/signup/interview/answer",
            json={"session_id": session_id, "answer": CANNED_ANSWERS[i]},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        if data.get("done"):
            done = True
            idx = data.get("index", idx + 1)
            break
        # otherwise expect a new question and monotonic index
        assert data.get("question"), data
        questions_seen.append(data["question"])
        assert data["index"] == idx + 1, data
        idx = data["index"]
    assert done, f"Interview did not finish after 4 answers; last idx={idx}"
    # Adaptive check — questions should differ (LLM did not repeat the same one)
    normalised = [q.strip().lower() for q in questions_seen]
    assert len(set(normalised)) == len(normalised), f"Duplicate questions asked: {questions_seen}"


def test_interview_blueprint_personalized(http, interview_session):
    session_id = interview_session["session_id"]
    r = http.post(
        f"{API}/signup/interview/blueprint",
        json={"session_id": session_id},
        timeout=90,
    )
    assert r.status_code == 200, r.text
    bp = r.json()

    # Structure
    depts = bp.get("departments") or []
    workflows = bp.get("workflows") or []
    tasks = bp.get("operational_tasks") or []
    rules = bp.get("approval_rules") or []
    products = bp.get("products") or []
    welcome_line = bp.get("welcome_line") or ""

    assert 3 <= len(depts) <= 12, depts
    # departments should be normalized to key/label dicts (per problem statement)
    assert all(isinstance(d, dict) and "key" in d and "label" in d for d in depts), depts

    assert 3 <= len(workflows) <= 15
    assert all(isinstance(w, dict) and w.get("name") for w in workflows), workflows

    assert 5 <= len(tasks) <= 20
    for t in tasks:
        assert t.get("title") and t.get("category")

    assert 2 <= len(rules) <= 10
    for rl in rules:
        assert rl.get("name") and rl.get("description")

    assert len(products) >= 1
    for p in products:
        assert p.get("name")

    assert len(welcome_line) > 5

    # Personalization — should reference at least one of the founder's real terms
    all_text = " ".join([
        welcome_line,
        " ".join(w["name"] for w in workflows),
        " ".join(t["title"] for t in tasks),
        " ".join(d.get("label", "") for d in depts),
    ]).lower()
    personal_hits = sum(kw in all_text for kw in [
        "yarn", "loom", "weav", "cotton", "export", "shipment", "qc", "quality",
        "rakesh", "meera", "fabric", "garment"
    ])
    assert personal_hits >= 1, f"Blueprint does not reference founder's answers. Text: {all_text[:400]}"


# ---- Sarvam TTS ----
def test_tts_returns_playable_audio(http):
    r = http.post(f"{API}/signup/tts", json={"text": "Hello founder"}, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    b64 = body.get("audio_b64") or ""
    assert body.get("mime") == "audio/wav"
    assert len(b64) > 500, "TTS audio too small — likely empty"
    audio_bytes = base64.b64decode(b64)
    # WAV header
    assert audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE", audio_bytes[:16]
    assert len(audio_bytes) > 2000  # > 1KB real audio


# ---- Sarvam STT ----
def test_stt_accepts_wav_or_returns_clean_503():
    fixture = "/app/test_fixtures/audio.wav"
    assert os.path.exists(fixture), "Missing /app/test_fixtures/audio.wav — please seed a small WAV"
    with open(fixture, "rb") as f:
        r = requests.post(
            f"{API}/signup/stt",
            files={"file": ("audio.wav", f, "audio/wav")},
            timeout=90,
        )
    if r.status_code == 200:
        # transcript may be empty for a short/synthetic clip, but shape is validated
        assert isinstance(r.json().get("text", ""), str)
        return
    # Sarvam sometimes rejects short/synthetic audio — a clean 503 is acceptable
    assert r.status_code == 503, f"STT returned unexpected status {r.status_code}: {r.text}"


# ---- Sanity: legacy login endpoint still up (regression that Login page depends on) ----
def test_auth_login_still_works():
    r = requests.post(f"{API}/auth/login", json={
        "email": "owner@sharma.com",
        "password": "demo1234",
    }, timeout=30)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("token") or j.get("access_token")

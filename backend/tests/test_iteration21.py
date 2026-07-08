"""
Iteration 21 — Personal AI Work Coach
Backend tests for GET /api/work-coach and POST /api/work-coach/refresh.
"""
import os
import pytest
import requests
from pathlib import Path


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    env_file = Path("/app/frontend/.env")
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

CREDS = {
    "owner": ("owner@sharma.com", "demo1234"),
    "sales": ("sales@sharma.com", "demo1234"),
    "production": ("production@sharma.com", "demo1234"),
    "finance": ("finance@sharma.com", "demo1234"),
}


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def tokens():
    return {role: _login(*c) for role, c in CREDS.items()}


@pytest.fixture(scope="module")
def me(tokens):
    out = {}
    for role, tok in tokens.items():
        r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        assert r.status_code == 200, r.text
        payload = r.json()
        out[role] = payload.get("user") or payload
    return out


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# --- GET /api/work-coach ---
class TestGetWorkCoach:
    def test_own_coach_default(self, tokens, me):
        r = requests.get(f"{API}/work-coach", headers=_h(tokens["production"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(["target", "stats", "summary"]).issubset(data.keys())
        assert data["target"]["id"] == me["production"]["id"]
        assert data["target"]["role"] == "production"
        s = data["stats"]
        # spec keys
        for k in ["completed", "open", "overdue", "actionable", "completion_rate",
                  "proof_upload_rate", "plans_used", "plans_completed",
                  "photos_uploaded", "voice_updates"]:
            assert k in s, f"missing stat key {k}"
            assert isinstance(s[k], int), f"{k} not int: {s[k]}"
        # completion_rate math sanity: 0 <= rate <= 100
        assert 0 <= s["completion_rate"] <= 100
        assert 0 <= s["proof_upload_rate"] <= 100
        # actionable == completed + open
        assert s["actionable"] == s["completed"] + s["open"]
        # summary can be null OR dict
        assert data["summary"] is None or isinstance(data["summary"], dict)

    def test_own_coach_explicit_user_id(self, tokens, me):
        uid = me["production"]["id"]
        r = requests.get(f"{API}/work-coach?user_id={uid}", headers=_h(tokens["production"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["target"]["id"] == uid

    def test_owner_can_view_employee(self, tokens, me):
        uid = me["sales"]["id"]
        r = requests.get(f"{API}/work-coach?user_id={uid}", headers=_h(tokens["owner"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["target"]["id"] == uid
        assert r.json()["target"]["role"] == "sales"

    def test_non_owner_forbidden_for_others(self, tokens, me):
        uid = me["production"]["id"]
        r = requests.get(f"{API}/work-coach?user_id={uid}", headers=_h(tokens["sales"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_non_existent_user_id(self, tokens):
        r = requests.get(f"{API}/work-coach?user_id=does-not-exist-xyz", headers=_h(tokens["owner"]), timeout=15)
        assert r.status_code == 404, r.text

    def test_unauth(self):
        r = requests.get(f"{API}/work-coach", timeout=10)
        assert r.status_code in (401, 403)


# --- POST /api/work-coach/refresh ---
class TestRefreshWorkCoach:
    def test_refresh_own_returns_summary(self, tokens, me):
        r = requests.post(f"{API}/work-coach/refresh", headers=_h(tokens["production"]), timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["target"]["id"] == me["production"]["id"]
        s = data["summary"]
        assert isinstance(s, dict)
        assert isinstance(s.get("headline"), str) and len(s["headline"]) > 0
        assert isinstance(s.get("strengths"), list) and 1 <= len(s["strengths"]) <= 4
        assert isinstance(s.get("improvements"), list) and 1 <= len(s["improvements"]) <= 3
        assert isinstance(s.get("recommendation"), str) and len(s["recommendation"]) > 0
        assert "generated_at" in s
        assert "stats_snapshot" in s and isinstance(s["stats_snapshot"], dict)
        # length caps
        assert len(s["headline"]) <= 200
        assert len(s["recommendation"]) <= 240

    def test_refresh_persists_summary_via_get(self, tokens):
        # GET after refresh should return the cached summary
        r = requests.get(f"{API}/work-coach", headers=_h(tokens["production"]), timeout=15)
        assert r.status_code == 200
        assert r.json()["summary"] is not None
        s = r.json()["summary"]
        assert "headline" in s and "generated_at" in s

    def test_refresh_owner_for_employee(self, tokens, me):
        uid = me["sales"]["id"]
        r = requests.post(f"{API}/work-coach/refresh?user_id={uid}", headers=_h(tokens["owner"]), timeout=90)
        assert r.status_code == 200, r.text
        assert r.json()["target"]["id"] == uid
        assert isinstance(r.json()["summary"], dict)

    def test_refresh_forbidden_for_non_owner_others(self, tokens, me):
        uid = me["production"]["id"]
        r = requests.post(f"{API}/work-coach/refresh?user_id={uid}", headers=_h(tokens["sales"]), timeout=15)
        assert r.status_code == 403, r.text

    def test_refresh_404_missing_user(self, tokens):
        r = requests.post(f"{API}/work-coach/refresh?user_id=nope-nope", headers=_h(tokens["owner"]), timeout=15)
        assert r.status_code == 404, r.text


# --- Stats correctness (regression) ---
class TestStatsCorrectness:
    def test_completion_rate_math(self, tokens):
        r = requests.get(f"{API}/work-coach", headers=_h(tokens["production"]), timeout=15)
        assert r.status_code == 200
        s = r.json()["stats"]
        expected = round(s["completed"] / s["actionable"] * 100) if s["actionable"] else 0
        assert s["completion_rate"] == expected

    def test_own_stats_nonzero_for_production(self, tokens):
        # per agent-context: production has completed 3, open 49 approx
        r = requests.get(f"{API}/work-coach", headers=_h(tokens["production"]), timeout=15)
        s = r.json()["stats"]
        assert s["actionable"] > 0, f"expected some tasks for production; stats={s}"

    def test_owner_view_matches_employee_self_view(self, tokens, me):
        # Both owner-viewing-sales and sales-viewing-self should return same stats
        uid = me["sales"]["id"]
        r_owner = requests.get(f"{API}/work-coach?user_id={uid}", headers=_h(tokens["owner"]), timeout=15).json()
        r_self = requests.get(f"{API}/work-coach", headers=_h(tokens["sales"]), timeout=15).json()
        assert r_owner["stats"] == r_self["stats"], f"stats mismatch owner={r_owner['stats']} self={r_self['stats']}"
        assert r_owner["target"]["id"] == r_self["target"]["id"]

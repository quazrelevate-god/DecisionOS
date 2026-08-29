"""Iteration 60: Platform Super-Admin console tests.
Covers admin login, isolation, AI keys, tenants, users, health,
suspension enforcement in tenant get_current_user, and regressions.
"""
import os
import time
import pytest
import requests
from pathlib import Path

def _load_frontend_env():
    p = Path("/app/frontend/.env")
    if p.exists():
        for line in p.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return None

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
ADMIN_EMAIL = "admin@decisionos.biz"
ADMIN_PASS = "DecisionOS@2026"
OWNER_EMAIL = "owner@sharma.com"
OWNER_PASS = "demo1234"
SALES_EMAIL = "sales@sharma.com"
SALES_PASS = "demo1234"


# ----------------------------- Fixtures --------------------------------------
@pytest.fixture(scope="session")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/admin/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["admin"]["email"] == ADMIN_EMAIL
    return s


@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=15)
    assert r.status_code == 200, f"Owner login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def sales_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": SALES_EMAIL, "password": SALES_PASS}, timeout=15)
    assert r.status_code == 200, f"Sales login failed: {r.text}"
    return r.json()["token"]


# ----------------------------- Auth ------------------------------------------
class TestAdminAuth:
    def test_admin_login_success(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/me", timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL

    def test_admin_login_wrong_password(self):
        r = requests.post(f"{BASE_URL}/api/admin/login",
                          json={"email": ADMIN_EMAIL, "password": "wrongpassword-xyz"}, timeout=10)
        assert r.status_code == 401

    def test_admin_endpoints_require_cookie(self):
        # No cookie
        for path in ["/api/admin/me", "/api/admin/metrics", "/api/admin/tenants",
                     "/api/admin/users", "/api/admin/ai-keys", "/api/admin/health"]:
            r = requests.get(f"{BASE_URL}{path}", timeout=10)
            assert r.status_code in (401, 403), f"{path} should require admin cookie, got {r.status_code}"

    def test_tenant_token_cannot_access_admin(self, owner_token):
        # Tenant bearer token should not grant admin access
        r = requests.get(f"{BASE_URL}/api/admin/metrics",
                         headers={"Authorization": f"Bearer {owner_token}"}, timeout=10)
        assert r.status_code in (401, 403)


# ----------------------------- Metrics / Tenants / Users ---------------------
class TestAdminData:
    def test_metrics(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/metrics", timeout=10)
        assert r.status_code == 200
        d = r.json()
        for k in ("tenants", "users", "decisions", "tasks", "captures", "workflows", "contacts"):
            assert k in d and isinstance(d[k], int)
        assert d["tenants"] >= 1 and d["users"] >= 1

    def test_tenants(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/tenants", timeout=10)
        assert r.status_code == 200
        tenants = r.json()["tenants"]
        assert isinstance(tenants, list) and len(tenants) >= 1
        t = tenants[0]
        for k in ("id", "name", "users", "decisions", "tasks"):
            assert k in t

    def test_users(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/users", timeout=10)
        assert r.status_code == 200
        users = r.json()["users"]
        assert isinstance(users, list) and len(users) >= 1
        emails = [u["email"] for u in users]
        assert OWNER_EMAIL in emails
        # No password_hash leaked
        for u in users:
            assert "password_hash" not in u


# ----------------------------- AI Keys ---------------------------------------
class TestAiKeys:
    def test_list_ai_keys(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/ai-keys", timeout=10)
        assert r.status_code == 200
        keys = r.json()["keys"]
        providers = {k["provider"] for k in keys}
        # voyage (E3-09 embeddings) + sarvam (STT) were added to the admin-updatable
        # AI-key set after this test first froze its expectation at 5 providers.
        assert providers == {"anthropic", "openai", "gemini", "voyage", "sarvam",
                             "wa_access_token", "wa_phone_number_id"}
        for k in keys:
            assert "source" in k and "masked" in k

    def test_put_empty_reverts_env(self, admin_session):
        # PUT empty string should revert to env
        r = admin_session.put(f"{BASE_URL}/api/admin/ai-keys",
                              json={"anthropic": ""}, timeout=10)
        assert r.status_code == 200
        # Verify source is env after revert
        r2 = admin_session.get(f"{BASE_URL}/api/admin/ai-keys", timeout=10)
        row = next(k for k in r2.json()["keys"] if k["provider"] == "anthropic")
        assert row["source"] in ("env", "emergent", "default"), f"Expected env fallback, got {row['source']}"

    def test_put_no_keys_400(self, admin_session):
        r = admin_session.put(f"{BASE_URL}/api/admin/ai-keys", json={}, timeout=10)
        assert r.status_code == 400

    def test_ai_keys_status_probe(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/ai-keys/status", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) >= {"anthropic", "openai", "gemini", "whatsapp"}
        # anthropic expected out_of_credits, others should be active/known
        assert d["anthropic"]["status"] in ("out_of_credits", "active", "fallback", "invalid", "error")
        assert d["openai"]["status"] in ("active", "invalid", "not_set", "error")
        assert d["gemini"]["status"] in ("active", "invalid", "not_set", "error")


# ----------------------------- Health ----------------------------------------
class TestAdminHealth:
    def test_health(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/admin/health", timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["database"]["status"] == "ok"
        assert d["scheduler"]["status"] == "running"
        assert d["emergent_key"] == "configured"
        assert "ai_providers" in d


# ----------------------------- Suspend / Reactivate / Reset ------------------
class TestUserActions:
    def test_cannot_suspend_owner(self, admin_session):
        users = admin_session.get(f"{BASE_URL}/api/admin/users", timeout=10).json()["users"]
        owner = next(u for u in users if u["email"] == OWNER_EMAIL)
        r = admin_session.post(f"{BASE_URL}/api/admin/users/{owner['id']}/suspend", timeout=10)
        assert r.status_code == 400

    def test_suspend_flow_and_isolation(self, admin_session, sales_token):
        # Sales user is not owner; verify tenant call works pre-suspend
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {sales_token}"}, timeout=10)
        assert r.status_code == 200
        sales_user_id = r.json()["user"]["id"]

        # Suspend
        r = admin_session.post(f"{BASE_URL}/api/admin/users/{sales_user_id}/suspend", timeout=10)
        assert r.status_code == 200 and r.json()["suspended"] is True

        # Verify /me now 403
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {sales_token}"}, timeout=10)
        assert r.status_code == 403, f"Suspended user should be blocked, got {r.status_code}"

        # Verify list shows suspended
        users = admin_session.get(f"{BASE_URL}/api/admin/users", timeout=10).json()["users"]
        target = next(u for u in users if u["id"] == sales_user_id)
        assert target["suspended"] is True

        # Reactivate
        r = admin_session.post(f"{BASE_URL}/api/admin/users/{sales_user_id}/reactivate", timeout=10)
        assert r.status_code == 200 and r.json()["suspended"] is False

        # Verify /me works again
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {sales_token}"}, timeout=10)
        assert r.status_code == 200

        # Reset access
        r = admin_session.post(f"{BASE_URL}/api/admin/users/{sales_user_id}/reset-access", timeout=10)
        assert r.status_code == 200


# ----------------------------- Regression ------------------------------------
class TestRegression:
    def test_owner_login_and_core_endpoints(self, owner_token):
        h = {"Authorization": f"Bearer {owner_token}"}
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=h, timeout=10)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/tasks", headers=h, timeout=15)
        assert r.status_code == 200
        # brief endpoint if it exists
        r = requests.get(f"{BASE_URL}/api/brief", headers=h, timeout=15)
        assert r.status_code in (200, 404)  # accept 404 if not present

    def test_admin_cookie_not_required_for_tenant(self, owner_token):
        # Ensure tenant endpoints don't require admin cookie
        r = requests.get(f"{BASE_URL}/api/tasks",
                         headers={"Authorization": f"Bearer {owner_token}"}, timeout=15)
        assert r.status_code == 200

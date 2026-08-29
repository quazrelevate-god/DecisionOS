"""
Iteration 14 — Module-level per-employee access control (Team menu).

Covers:
- Backend permission enforcement (limited user with explicit permissions list)
- Role-default fallback for existing demo users (no permissions field)
- Owner bypass across sensitive endpoints
- PATCH /api/users/{id} owner update flow + owner-protected + invalid role
- POST /api/users cleans unknown permission keys
- team_manage requirement for user & invite management
- Ask AI money question restriction message for user without finance
"""
import os
import io
import time
import uuid
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    fp = "/app/frontend/.env"
    if os.path.exists(fp):
        with open(fp) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}
FINANCE = {"email": "finance@sharma.com", "password": "demo1234"}
PROD = {"email": "production@sharma.com", "password": "demo1234"}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"], data["tenant"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Session-scoped fixtures: owner token + a freshly created limited test user
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def owner_ctx():
    token, user, tenant = _login(OWNER["email"], OWNER["password"])
    return {"token": token, "user": user, "tenant": tenant}


@pytest.fixture(scope="module")
def limited_user_ctx(owner_ctx):
    """Create a limited user (role sales, permissions=['inbox','tasks']) and log in."""
    email = f"TEST_limited_{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "name": "TEST Limited",
        "email": email,
        "password": "limitpass1",
        "role": "sales",
        "permissions": ["inbox", "tasks"],
    }
    r = requests.post(f"{API}/users", json=payload, headers=_h(owner_ctx["token"]), timeout=15)
    assert r.status_code == 200, f"create limited user failed: {r.status_code} {r.text}"
    created = r.json()
    assert created["permissions"] == ["inbox", "tasks"]
    token, user, _ = _login(email, "limitpass1")
    yield {"token": token, "user": user, "email": email, "id": created["id"]}


@pytest.fixture(scope="module")
def contact_id(owner_ctx):
    """Ensure at least one contact exists for /contacts/{id}/profile tests."""
    r = requests.get(f"{API}/contacts", headers=_h(owner_ctx["token"]), timeout=15)
    assert r.status_code == 200
    lst = r.json()
    if lst:
        return lst[0]["id"]
    cr = requests.post(
        f"{API}/contacts",
        json={"type": "customer", "name": "TEST_ACL_Contact", "company": "TEST Co"},
        headers=_h(owner_ctx["token"]),
        timeout=15,
    )
    assert cr.status_code == 200
    return cr.json()["id"]


# ---------------------------------------------------------------------------
# Backend permission enforcement — limited user with permissions=[inbox, tasks]
# ---------------------------------------------------------------------------
class TestLimitedUserEnforcement:
    def test_limited_forbidden_invoices(self, limited_user_ctx):
        r = requests.get(f"{API}/invoices", headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 403, r.text

    def test_limited_forbidden_payments(self, limited_user_ctx):
        r = requests.get(f"{API}/payments", headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 403, r.text

    def test_limited_forbidden_ingest_csv(self, limited_user_ctx):
        files = {"file": ("t.csv", io.BytesIO(b"name,phone\nA,1\n"), "text/csv")}
        r = requests.post(f"{API}/ingest/csv", files=files, headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 403, r.text

    def test_limited_forbidden_ingest_document(self, limited_user_ctx):
        files = {"file": ("t.txt", io.BytesIO(b"hello"), "text/plain")}
        r = requests.post(f"{API}/ingest/document", files=files, headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 403, r.text

    def test_limited_forbidden_contact_profile(self, limited_user_ctx, contact_id):
        r = requests.get(f"{API}/contacts/{contact_id}/profile", headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 403, r.text

    def test_limited_forbidden_create_user(self, limited_user_ctx):
        r = requests.post(
            f"{API}/users",
            json={"name": "X", "email": f"x{uuid.uuid4().hex[:6]}@example.com", "password": "abcdef1", "role": "sales"},
            headers=_h(limited_user_ctx["token"]),
        )
        assert r.status_code == 403, r.text

    def test_limited_forbidden_invites(self, limited_user_ctx):
        r = requests.post(f"{API}/invites", json={"phones": ["+919999999999"]}, headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 403, r.text

    def test_limited_allowed_tasks(self, limited_user_ctx):
        r = requests.get(f"{API}/tasks", headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_limited_allowed_inbox(self, limited_user_ctx):
        r = requests.get(f"{API}/inbox", headers=_h(limited_user_ctx["token"]))
        assert r.status_code == 200

    def test_limited_ask_money_restricted_message(self, limited_user_ctx):
        r = requests.post(
            f"{API}/ask",
            json={"question": "How much money do our customers owe us in total?"},
            headers=_h(limited_user_ctx["token"]),
            timeout=60,
        )
        assert r.status_code == 200, r.text
        ans = (r.json().get("answer") or "").lower()
        # backend prompt says: "Financial data ... is NOT available ... restricted to Owner and Finance"
        assert "restrict" in ans or "not available" in ans or "owner" in ans, f"expected restriction msg, got: {ans[:200]}"


# ---------------------------------------------------------------------------
# Role-default fallback — demo users without a "permissions" field
# ---------------------------------------------------------------------------
class TestRoleDefaultFallback:
    def test_finance_role_default_can_list_invoices(self):
        tok, _, _ = _login(FINANCE["email"], FINANCE["password"])
        r = requests.get(f"{API}/invoices", headers=_h(tok))
        assert r.status_code == 200, r.text

    def test_finance_role_default_can_open_contact_profile(self, contact_id):
        tok, _, _ = _login(FINANCE["email"], FINANCE["password"])
        r = requests.get(f"{API}/contacts/{contact_id}/profile", headers=_h(tok))
        assert r.status_code == 200, r.text

    def test_sales_role_default_can_ingest_csv(self):
        tok, _, _ = _login(SALES["email"], SALES["password"])
        files = {"file": ("t.csv", io.BytesIO(b"name,phone,email\nTEST_ACL_A,111,a@x.com\n"), "text/csv")}
        r = requests.post(f"{API}/ingest/csv", files=files, headers=_h(tok))
        assert r.status_code == 200, r.text

    def test_production_role_default_forbidden_invoices(self):
        tok, _, _ = _login(PROD["email"], PROD["password"])
        r = requests.get(f"{API}/invoices", headers=_h(tok))
        assert r.status_code == 403, r.text

    def test_production_role_default_forbidden_ingest(self):
        tok, _, _ = _login(PROD["email"], PROD["password"])
        files = {"file": ("t.csv", io.BytesIO(b"name,phone\nX,1\n"), "text/csv")}
        r = requests.post(f"{API}/ingest/csv", files=files, headers=_h(tok))
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# Owner bypass — owner hits all gated endpoints
# ---------------------------------------------------------------------------
class TestOwnerBypass:
    def test_owner_invoices(self, owner_ctx):
        r = requests.get(f"{API}/invoices", headers=_h(owner_ctx["token"]))
        assert r.status_code == 200

    def test_owner_payments(self, owner_ctx):
        r = requests.get(f"{API}/payments", headers=_h(owner_ctx["token"]))
        assert r.status_code == 200

    def test_owner_contact_profile(self, owner_ctx, contact_id):
        r = requests.get(f"{API}/contacts/{contact_id}/profile", headers=_h(owner_ctx["token"]))
        assert r.status_code == 200

    def test_owner_ingest_csv(self, owner_ctx):
        files = {"file": ("t.csv", io.BytesIO(b"name,phone\nTEST_ACL_owner,999\n"), "text/csv")}
        r = requests.post(f"{API}/ingest/csv", files=files, headers=_h(owner_ctx["token"]))
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# PATCH /api/users/{id} — role & permissions updates, owner-protected
# ---------------------------------------------------------------------------
class TestUserPatch:
    def test_owner_can_patch_permissions(self, owner_ctx, limited_user_ctx):
        r = requests.patch(
            f"{API}/users/{limited_user_ctx['id']}",
            json={"permissions": ["inbox", "tasks", "brain"]},
            headers=_h(owner_ctx["token"]),
        )
        assert r.status_code == 200, r.text
        updated = r.json()
        assert set(updated["permissions"]) == {"inbox", "tasks", "brain"}

    def test_patch_owner_user_forbidden(self, owner_ctx):
        r = requests.patch(
            f"{API}/users/{owner_ctx['user']['id']}",
            json={"permissions": ["inbox"]},
            headers=_h(owner_ctx["token"]),
        )
        assert r.status_code == 400, r.text

    def test_patch_invalid_role(self, owner_ctx, limited_user_ctx):
        r = requests.patch(
            f"{API}/users/{limited_user_ctx['id']}",
            json={"role": "not_a_role_xyz"},
            headers=_h(owner_ctx["token"]),
        )
        assert r.status_code == 400, r.text

    def test_patch_without_team_manage_forbidden(self, limited_user_ctx):
        # limited user only has inbox+tasks — no team_manage
        # (test isolation: use limited_user's own token to try to patch itself)
        r = requests.patch(
            f"{API}/users/{limited_user_ctx['id']}",
            json={"permissions": ["inbox"]},
            headers=_h(limited_user_ctx["token"]),
        )
        assert r.status_code == 403, r.text


# ---------------------------------------------------------------------------
# POST /api/users — cleans unknown permission keys
# ---------------------------------------------------------------------------
class TestPostUserCleansPerms:
    def test_unknown_perm_keys_dropped(self, owner_ctx):
        email = f"TEST_cleanperms_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "name": "TEST CleanPerms",
            "email": email,
            "password": "abcdef1",
            "role": "sales",
            "permissions": ["inbox", "not_a_perm", "tasks", "hackerman", "finance"],
        }
        r = requests.post(f"{API}/users", json=payload, headers=_h(owner_ctx["token"]))
        assert r.status_code == 200, r.text
        created = r.json()
        # Only known keys remain, in insertion order (finance is a known key)
        assert set(created["permissions"]) == {"inbox", "tasks", "finance"}
        assert "not_a_perm" not in created["permissions"]
        assert "hackerman" not in created["permissions"]

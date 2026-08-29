"""Tests for industry-aware onboarding + per-tenant dynamic roles."""
import os
import time
import uuid
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _suggest(industry, company_size=None, retries=1):
    for attempt in range(retries + 1):
        r = requests.post(f"{API}/onboarding/suggest",
                          json={"industry": industry, "company_size": company_size}, timeout=45)
        if r.status_code == 200:
            return r
        if r.status_code >= 500 and attempt < retries:
            time.sleep(2)
            continue
        return r
    return r


class TestOnboardingSuggest:
    """POST /api/onboarding/suggest is public and returns roles + products."""

    def test_public_no_auth_needed(self):
        r = _suggest("Restaurant / Food & Beverage", "1-10")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "roles" in d and "products" in d
        assert 3 <= len(d["roles"]) <= 6
        assert 0 <= len(d["products"]) <= 5
        for role in d["roles"]:
            assert "key" in role and "label" in role
            assert role["key"] != "owner", "roles must not include 'owner'"
            assert role["key"].islower() or "_" in role["key"]

    def test_tech_saas_returns_relevant_roles(self):
        r = _suggest("Technology / SaaS", "11-50")
        assert r.status_code == 200
        d = r.json()
        assert len(d["roles"]) >= 3
        # sanity: not just default roles for tech
        keys = [r["key"] for r in d["roles"]]
        labels_lower = " ".join(r["label"].lower() for r in d["roles"])
        assert not all(k == "owner" for k in keys)
        # products should have some content
        assert isinstance(d["products"], list)


class TestRegisterOnboarding:
    """POST /api/auth/register with industry/company_size/region/currency/roles/products."""

    def test_register_with_custom_roles(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "company_name": f"TEST_Bistro_{uuid.uuid4().hex[:6]}",
            "name": "TEST_Chef",
            "email": email,
            "password": "testpass123",
            "industry": "Restaurant / Food & Beverage",
            "company_size": "1-10",
            "region": "USA",
            "currency": "USD",
            "roles": [
                {"key": "kitchen", "label": "Kitchen"},
                {"key": "front_of_house", "label": "Front of House"},
            ],
            "products": [{"name": "Wood-fired Pizza", "description": "Neapolitan style"}],
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "owner"
        t = data["tenant"]
        assert t["industry"] == "Restaurant / Food & Beverage"
        assert t["company_size"] == "1-10"
        assert t["region"] == "USA"
        assert t["currency"] == "USD"
        role_keys = {r["key"] for r in t["roles"]}
        assert role_keys == {"kitchen", "front_of_house"}, f"got {role_keys}"
        assert any(p["name"] == "Wood-fired Pizza" for p in t["products"])

        token = data["token"]

        # role='kitchen' -> 200
        r_ok = requests.post(f"{API}/users", json={
            "name": "TEST_KitchenUser", "email": f"k_{uuid.uuid4().hex[:6]}@example.com",
            "password": "testpass123", "role": "kitchen",
        }, headers=_hdr(token), timeout=10)
        assert r_ok.status_code == 200, r_ok.text
        assert r_ok.json()["role"] == "kitchen"

        # role='sales' -> 400 (not in tenant roles)
        r_bad = requests.post(f"{API}/users", json={
            "name": "TEST_Bad", "email": f"b_{uuid.uuid4().hex[:6]}@example.com",
            "password": "testpass123", "role": "sales",
        }, headers=_hdr(token), timeout=10)
        assert r_bad.status_code == 400, f"expected 400 for invalid role, got {r_bad.status_code}: {r_bad.text}"

        # Task with unknown assignee_role stored as null
        rt = requests.post(f"{API}/tasks", json={
            "title": "TEST_task_bad_role", "assignee_role": "sales",
        }, headers=_hdr(token), timeout=10)
        assert rt.status_code == 200
        assert rt.json().get("assignee_role") is None

        # Task with valid tenant role
        rt2 = requests.post(f"{API}/tasks", json={
            "title": "TEST_task_kitchen", "assignee_role": "kitchen",
        }, headers=_hdr(token), timeout=10)
        assert rt2.status_code == 200
        assert rt2.json().get("assignee_role") == "kitchen"

    def test_register_owner_role_stripped(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={
            "company_name": f"TEST_Co_{uuid.uuid4().hex[:6]}",
            "name": "TEST_Owner", "email": email, "password": "testpass123",
            "industry": "Technology / SaaS",
            "roles": [
                {"key": "owner", "label": "Owner"},   # should be dropped
                {"key": "engineering", "label": "Engineering"},
                {"key": "engineering", "label": "Engineering"},  # dup
            ],
        }, timeout=15)
        assert r.status_code == 200, r.text
        keys = [rr["key"] for rr in r.json()["tenant"]["roles"]]
        assert "owner" not in keys
        assert keys.count("engineering") == 1


class TestSharmaRegression:
    """Existing Sharma demo tenant must be migrated with expected fields."""

    def test_me_returns_industry_and_roles(self):
        d = _login(*OWNER)
        r = requests.get(f"{API}/auth/me", headers=_hdr(d["token"]), timeout=10)
        assert r.status_code == 200
        t = r.json()["tenant"]
        assert t["industry"] == "Textile Manufacturing", f"got {t.get('industry')}"
        keys = [rr["key"] for rr in t["roles"]]
        assert set(keys) == {"sales", "production", "finance"}, f"got {keys}"
        assert len(t["products"]) == 3
        assert t["currency"] == "INR"

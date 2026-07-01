"""Tests for 'Other' free-text industry onboarding (iteration 6)."""
import os
import time
import uuid
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://founder-os-58.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


def _suggest(industry, company_size=None, retries=1):
    """POST /onboarding/suggest with retry on 5xx (LLM budget)."""
    last = None
    for attempt in range(retries + 1):
        r = requests.post(f"{API}/onboarding/suggest",
                          json={"industry": industry, "company_size": company_size}, timeout=60)
        last = r
        if r.status_code == 200:
            return r
        if r.status_code >= 500 and attempt < retries:
            time.sleep(3)
            continue
        return r
    return last


class TestFreeTextIndustry:
    """AI should return industry-relevant suggestions for a free-text description."""

    def test_pet_grooming_free_text(self):
        sentence = "We run a mobile pet grooming and dog walking service"
        r = _suggest(sentence, "1-10")
        assert r.status_code == 200, r.text
        d = r.json()
        assert 3 <= len(d["roles"]) <= 6
        for role in d["roles"]:
            assert "key" in role and "label" in role
            assert role["key"] != "owner"
            # key must be slug-like
            assert all(c.isalnum() or c == "_" for c in role["key"])
        # products should be a list (may be 0-5)
        assert isinstance(d["products"], list)
        assert 0 <= len(d["products"]) <= 5

    def test_register_with_custom_industry_sentence(self):
        sentence = "Boutique mobile pet grooming and dog walking service across the city"
        email = f"other_{uuid.uuid4().hex[:8]}@example.com"
        payload = {
            "company_name": f"TEST_Pets_{uuid.uuid4().hex[:6]}",
            "name": "TEST_Owner",
            "email": email,
            "password": "testpass123",
            "industry": sentence,        # <-- free text sent as industry
            "company_size": "1-10",
            "region": "USA",
            "currency": "USD",
            "roles": [
                {"key": "groomer", "label": "Groomer"},
                {"key": "dog_walker", "label": "Dog Walker"},
            ],
            "products": [{"name": "Mobile Grooming", "description": "Full-service at your door"}],
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["tenant"]["industry"] == sentence, "backend must store the sentence verbatim"
        token = data["token"]

        # /auth/me should also return the sentence
        me = requests.get(f"{API}/auth/me",
                          headers={"Authorization": f"Bearer {token}"}, timeout=10)
        assert me.status_code == 200
        assert me.json()["tenant"]["industry"] == sentence


class TestPresetRegression:
    """Preset industry values still work."""

    def test_technology_saas_preset(self):
        r = _suggest("Technology / SaaS", "11-50")
        assert r.status_code == 200
        d = r.json()
        assert 3 <= len(d["roles"]) <= 6

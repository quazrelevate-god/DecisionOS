"""
Iteration 15 — Bug fix verification for Company Brain search.
Root cause: brain_search used the whole query as a single literal regex.
Fix: tokenize query, re.escape each token, OR-match tokens of len>=2.

Endpoint under test: GET /api/brain/search?q=<query>
Regression: POST /api/ask still returns answer for owner.
"""

import os
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": "owner@sharma.com", "password": "demo1234"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def sales_token():
    r = requests.post(f"{API}/auth/login", json={"email": "sales@sharma.com", "password": "demo1234"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _get(token, q):
    return requests.get(f"{API}/brain/search", params={"q": q}, headers={"Authorization": f"Bearer {token}"}, timeout=30)


def _total(data):
    return sum(len(data.get(k, [])) for k in ("decisions", "tasks", "workflows", "contacts", "memory", "invoices"))


# ---------- Brain search: multi-word queries ----------
class TestBrainSearchMultiWord:
    def test_kumar_garments_payment_owner(self, owner_token):
        r = _get(owner_token, "Kumar Garments payment")
        assert r.status_code == 200, r.text
        data = r.json()
        # Should return relevant matches across multiple collections
        assert _total(data) > 0, f"Expected matches but got: {data}"
        # spec: decisions + tasks + at least 1 contact + invoices for owner
        assert len(data.get("decisions", [])) >= 1 or len(data.get("tasks", [])) >= 1, \
            f"Expected decisions or tasks for 'Kumar Garments payment', got {data}"
        # contacts (Kumar Garments) or invoices should have at least one hit for owner
        assert len(data.get("contacts", [])) + len(data.get("invoices", [])) >= 1, \
            f"Expected contact/invoice hits, got contacts={data.get('contacts')}, invoices={data.get('invoices')}"

    def test_kumar_garments_payment_sales(self, sales_token):
        # sales does not have finance perm, so invoices route is gated but /brain/search itself is not
        r = _get(sales_token, "Kumar Garments payment")
        assert r.status_code == 200, r.text
        data = r.json()
        assert _total(data) > 0

    def test_cotton_supplier(self, owner_token):
        r = _get(owner_token, "cotton supplier")
        assert r.status_code == 200, r.text
        data = r.json()
        # Spec: multiple decisions/tasks
        assert len(data.get("decisions", [])) + len(data.get("tasks", [])) >= 2, \
            f"Expected >=2 decisions/tasks for 'cotton supplier', got {data}"

    def test_who_owes_money(self, owner_token):
        r = _get(owner_token, "who owes money")
        assert r.status_code == 200, r.text
        data = r.json()
        # Spec: at least a task/decision match
        assert len(data.get("decisions", [])) + len(data.get("tasks", [])) >= 1, \
            f"Expected task/decision hit for 'who owes money', got {data}"


# ---------- Regression: single word still works ----------
class TestBrainSearchSingleWord:
    def test_payment_single_word(self, owner_token):
        r = _get(owner_token, "payment")
        assert r.status_code == 200, r.text
        data = r.json()
        # single word 'payment' -> many results
        assert _total(data) >= 3, f"Expected many results for single-word 'payment', got total={_total(data)}"


# ---------- Empty query returns records (exists filter) ----------
class TestBrainSearchEmpty:
    def test_empty_q(self, owner_token):
        r = _get(owner_token, "")
        assert r.status_code == 200, r.text
        data = r.json()
        assert _total(data) > 0, "Empty q should return existing records"


# ---------- Special regex chars must not error / must be escaped ----------
class TestBrainSearchSpecialChars:
    def test_parentheses(self, owner_token):
        r = _get(owner_token, "payment (urgent)")
        # Must not 500
        assert r.status_code == 200, r.text
        data = r.json()
        # 'payment' token (>=2 chars) matches; '(urgent)' after escape still valid
        assert _total(data) >= 1

    def test_plus_sign(self, owner_token):
        r = _get(owner_token, "cotton+supplier")
        assert r.status_code == 200, r.text
        # single "token" with escaped '+' — should not error and should match "cotton+supplier" literal
        # (may or may not match seed data, but must not 500)

    def test_only_special_chars(self, owner_token):
        # Only chars that after re.escape+split would produce no tokens of len>=2
        r = _get(owner_token, "(*)")
        assert r.status_code == 200, r.text

    def test_short_tokens_filtered(self, owner_token):
        # 'a b' -> both tokens len<2, tokens list empty, falls to $exists -> returns records
        r = _get(owner_token, "a b")
        assert r.status_code == 200, r.text
        data = r.json()
        assert _total(data) > 0


# ---------- Regression: Ask AI still works ----------
class TestAskAIRegression:
    def test_ask_owner_returns_answer(self, owner_token):
        r = requests.post(
            f"{API}/ask",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"question": "what should I focus on today?"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "answer" in data
        assert isinstance(data["answer"], str) and len(data["answer"]) > 0

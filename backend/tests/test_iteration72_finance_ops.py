"""
Iteration 72: Finance-as-Operations testing
Tests:
- Owner /api/brief returns receivables_overdue, bills_due, unmatched_payments counters + finance_amounts
- Drill-down /api/brief/details for these keys returns items (owner only)
- Non-owner (finance role) receives empty items for owner-gated finance keys
- Finance tasks (source=finance) auto-created, idempotent, assigned to finance member
"""
import os
import requests
import pytest

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
FINANCE = {"email": "finance@sharma.com", "password": "demo1234"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s, data


@pytest.fixture(scope="module")
def owner_client():
    s, _ = _login(OWNER)
    return s


@pytest.fixture(scope="module")
def finance_client():
    s, _ = _login(FINANCE)
    return s


class TestOwnerBriefFinance:
    def test_owner_brief_has_finance_counters(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/brief?period=morning", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        counters = data.get("counters", {})
        finance_amounts = data.get("finance_amounts", {})
        for key in ["receivables_overdue", "bills_due", "unmatched_payments"]:
            assert key in counters, f"missing counter {key}. keys={list(counters.keys())}"
        assert isinstance(finance_amounts, dict), "finance_amounts must be dict"
        # For sharma demo, receivables_overdue should be > 0 with amount > 0
        if counters.get("receivables_overdue", 0) > 0:
            assert finance_amounts.get("receivables_overdue", 0) > 0, "amount should be >0 when counter >0"
        print(f"Owner counters: receivables_overdue={counters.get('receivables_overdue')}, bills_due={counters.get('bills_due')}, unmatched_payments={counters.get('unmatched_payments')}")
        print(f"Finance amounts: {finance_amounts}")

    def test_owner_drill_receivables_overdue(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/brief/details?key=receivables_overdue", timeout=30)
        assert r.status_code == 200, r.text[:300]
        data = r.json()
        items = data.get("items", [])
        assert isinstance(items, list)
        print(f"receivables_overdue items count: {len(items)}")
        if items:
            first = items[0]
            # Each item should have some identifier and amount
            assert any(k in first for k in ["amount", "amount_inr", "value", "total", "meta"]), f"item missing amount: {first}"

    def test_owner_drill_bills_due(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/brief/details?key=bills_due", timeout=30)
        assert r.status_code == 200, r.text[:300]
        items = r.json().get("items", [])
        assert isinstance(items, list)
        print(f"bills_due items count: {len(items)}")

    def test_owner_drill_unmatched_payments(self, owner_client):
        r = owner_client.get(f"{BASE_URL}/api/brief/details?key=unmatched_payments", timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert isinstance(r.json().get("items", []), list)


class TestNonOwnerGating:
    def test_finance_role_gated_empty_items(self, finance_client):
        for key in ["receivables_overdue", "bills_due", "unmatched_payments"]:
            r = finance_client.get(f"{BASE_URL}/api/brief/details?key={key}", timeout=30)
            assert r.status_code in (200, 403), f"{key} -> {r.status_code}"
            if r.status_code == 200:
                items = r.json().get("items", [])
                assert items == [] or len(items) == 0, f"non-owner should get empty items for {key}, got {len(items)}"
                print(f"Non-owner {key}: empty items OK")


class TestFinanceTasks:
    def test_finance_tasks_created(self, owner_client):
        # Trigger followup / fetch tasks
        owner_client.get(f"{BASE_URL}/api/notifications", timeout=30)
        r = owner_client.get(f"{BASE_URL}/api/tasks", timeout=30)
        assert r.status_code == 200, r.text[:300]
        tasks = r.json()
        if isinstance(tasks, dict):
            tasks = tasks.get("items") or tasks.get("tasks") or []
        finance_tasks = [t for t in tasks if t.get("source") == "finance"]
        print(f"finance tasks: {len(finance_tasks)}")
        assert len(finance_tasks) > 0, "expected at least one finance-source task"
        titles = [t.get("title", "") for t in finance_tasks]
        has_chase_or_pay = any(("Chase" in t) or ("Approve & pay" in t) or ("pay" in t.lower()) for t in titles)
        assert has_chase_or_pay, f"expected Chase/Approve titles, got: {titles[:5]}"

    def test_finance_tasks_idempotent(self, owner_client):
        # Snapshot count
        r1 = owner_client.get(f"{BASE_URL}/api/tasks", timeout=30)
        t1 = r1.json()
        if isinstance(t1, dict):
            t1 = t1.get("items") or t1.get("tasks") or []
        c1 = len([t for t in t1 if t.get("source") == "finance"])
        # Force /brief which triggers finance sweep (throttle 60s but count should not go up beyond dup invoices)
        owner_client.get(f"{BASE_URL}/api/brief?period=morning", timeout=30)
        owner_client.get(f"{BASE_URL}/api/notifications", timeout=30)
        r2 = owner_client.get(f"{BASE_URL}/api/tasks", timeout=30)
        t2 = r2.json()
        if isinstance(t2, dict):
            t2 = t2.get("items") or t2.get("tasks") or []
        c2 = len([t for t in t2 if t.get("source") == "finance"])
        print(f"finance task counts: before={c1}, after={c2}")
        assert c2 == c1, f"finance tasks should be idempotent; grew from {c1} to {c2}"

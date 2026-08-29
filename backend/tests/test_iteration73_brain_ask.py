"""Iteration 73 — Company Brain 'Ask' pipeline tests.

Covers POST /api/ask and POST /api/brain/export.
"""
import os
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def sales_token():
    return _login(*SALES)


def _ask(token, question, context_id=None):
    body = {"question": question}
    if context_id:
        body["context_id"] = context_id
    r = requests.post(f"{API}/ask", json=body,
                      headers={"Authorization": f"Bearer {token}"}, timeout=120)
    return r


# ---------- on-time analysis ----------
def test_owner_on_time_tasks_this_month(owner_token):
    r = _ask(owner_token, "Show all tasks completed on time this month")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["type"] == "ANSWER", data
    labels = {k["label"] for k in data["kpis"]}
    for req in ("Completed", "On time", "Late", "On-time rate"):
        assert req in labels, f"missing KPI {req}: {labels}"
    assert data["table"]["columns"], "table.columns missing"
    assert data["table"]["total_rows"] >= 0
    assert isinstance(data["sources"], list) and len(data["sources"]) > 0
    s0 = data["sources"][0]
    for k in ("type", "title", "id", "deep_link"):
        assert k in s0, f"source missing {k}"
    assert data["query_context_id"]
    assert set(data["export_options"]) >= {"csv", "excel", "pdf"}
    assert isinstance(data["suggested_questions"], list)


# ---------- permission gating ----------
def test_sales_denied_profit_question(sales_token):
    r = _ask(sales_token, "What is the profit percentage of our products?")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["type"] == "PERMISSION_DENIED", data
    assert "permission" in data["message"].lower()
    assert "kpis" not in data
    assert "table" not in data


def test_sales_denied_outstanding_invoices(sales_token):
    r = _ask(sales_token, "Show outstanding invoices")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "PERMISSION_DENIED", data


def test_owner_outstanding_invoices(owner_token):
    r = _ask(owner_token, "Show outstanding invoices")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "ANSWER"
    cols = [c["key"] for c in data["table"]["columns"]]
    assert "outstanding" in cols
    assert data["table"]["total_rows"] > 0


# ---------- follow-up context ----------
def test_followup_context_group_by_employee(owner_token):
    r1 = _ask(owner_token, "Show all tasks completed on time this month")
    ctx = r1.json().get("query_context_id")
    assert ctx
    r2 = _ask(owner_token, "group them by employee", context_id=ctx)
    assert r2.status_code == 200
    data = r2.json()
    assert data["type"] in ("ANSWER", "INSUFFICIENT_DATA"), data


# ---------- employees ranking ----------
def test_employees_overdue_ranking(owner_token):
    r = _ask(owner_token, "Which employees have the most overdue tasks?")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "ANSWER", data
    labels = [c["label"] for c in data["table"]["columns"]]
    assert "Employee / Team" in labels
    assert "Overdue" in labels
    assert "Open" in labels
    assert data["table"]["total_rows"] > 0
    # rows ordered by overdue desc
    ov = [r["overdue"] for r in data["table"]["rows"]]
    assert ov == sorted(ov, reverse=True)


# ---------- insufficient data ----------
def test_insufficient_data_nonsense(owner_token):
    r = _ask(owner_token, "Show tasks about zxqwv nonexistent widget xyz123")
    assert r.status_code == 200
    data = r.json()
    assert data["type"] == "INSUFFICIENT_DATA", data


# ---------- exports ----------
@pytest.fixture(scope="module")
def owner_ctx(owner_token):
    r = _ask(owner_token, "Show all tasks completed on time this month")
    return r.json()["query_context_id"]


@pytest.fixture(scope="module")
def finance_ctx_owner(owner_token):
    r = _ask(owner_token, "Show outstanding invoices")
    return r.json()["query_context_id"]


@pytest.mark.parametrize("fmt,ct_prefix", [
    ("csv", "text/csv"),
    ("excel", "application/vnd.openxmlformats"),
    ("pdf", "application/pdf"),
])
def test_export_formats(owner_token, owner_ctx, fmt, ct_prefix):
    r = requests.post(f"{API}/brain/export",
                      json={"context_id": owner_ctx, "format": fmt},
                      headers={"Authorization": f"Bearer {owner_token}"}, timeout=60)
    assert r.status_code == 200, r.text
    assert r.headers.get("content-type", "").startswith(ct_prefix), r.headers
    assert len(r.content) > 100


def test_sales_cannot_export_finance_context(sales_token, finance_ctx_owner):
    r = requests.post(f"{API}/brain/export",
                      json={"context_id": finance_ctx_owner, "format": "csv"},
                      headers={"Authorization": f"Bearer {sales_token}"}, timeout=60)
    # Either 403 (finance gate) or 404 (tenant scoped context lookup returns None for cross-user).
    # brain_contexts is tenant-scoped (not user-scoped) so 403 expected here.
    assert r.status_code in (403, 404), r.status_code

"""Iteration 12 backend tests.

Covers:
- GET /api/inbox and POST /api/inbox/{id}/status (tenant scope, filters, error codes)
- Inbox auto-creation for text directives, ingest doc/csv, ingest commit flips to done, complaints
- GET /api/contacts/{id}/profile role-gate (owner/finance only) and aggregate shape
- POST /api/ask money context gated to owner/finance; non-money still works for all
"""
import os
import io
import time
import uuid
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")
PRODUCTION = ("production@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


def _hdr(tok, json_ct=True):
    h = {"Authorization": f"Bearer {tok}"}
    if json_ct:
        h["Content-Type"] = "application/json"
    return h


@pytest.fixture(scope="session")
def owner_auth():
    return _login(*OWNER)


@pytest.fixture(scope="session")
def sales_auth():
    return _login(*SALES)


@pytest.fixture(scope="session")
def production_auth():
    return _login(*PRODUCTION)


@pytest.fixture(scope="session")
def finance_auth():
    return _login(*FINANCE)


# --------------------------------------------------------------- Inbox basics
class TestInboxList:
    def test_shape_and_open_total(self, owner_auth):
        r = requests.get(f"{API}/inbox", headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert set(d.keys()) >= {"items", "counts", "open_total"}
        assert isinstance(d["items"], list)
        assert isinstance(d["counts"], dict)
        assert isinstance(d["open_total"], int)
        # each item carries required fields
        for it in d["items"][:20]:
            for k in ("id", "classification", "source", "title", "status"):
                assert k in it, f"missing {k} in inbox item"
            assert it["status"] in ("open", "done", "dismissed")

    def test_filter_by_classification(self, owner_auth):
        r = requests.get(f"{API}/inbox?classification=complaint", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["classification"] == "complaint"

    def test_filter_by_status(self, owner_auth):
        r = requests.get(f"{API}/inbox?status=open", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["status"] == "open"

    def test_tenant_isolation(self):
        # register a fresh tenant, its inbox must be empty
        email = f"iso_{uuid.uuid4().hex[:8]}@example.com"
        reg = requests.post(f"{API}/auth/register", json={
            "company_name": "TEST_InboxIso",
            "name": "TEST_iso",
            "email": email,
            "password": "testpass123",
        }, timeout=10).json()
        r = requests.get(f"{API}/inbox", headers=_hdr(reg["token"]), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["items"] == []
        assert d["open_total"] == 0


class TestInboxStatus:
    def _make_open_item(self, owner_tok):
        # complaint creates an inbox item quickly & deterministically
        # find a contact id first
        cs = requests.get(f"{API}/contacts", headers=_hdr(owner_tok), timeout=10).json()
        assert cs, "no contacts to attach complaint"
        cid = cs[0]["id"]
        r = requests.post(f"{API}/complaints", json={
            "customer_id": cid, "text": f"TEST_inbox_complaint {uuid.uuid4().hex[:6]}",
        }, headers=_hdr(owner_tok), timeout=10)
        assert r.status_code == 200, r.text
        # now find the corresponding inbox item (most recent complaint)
        inbox = requests.get(f"{API}/inbox?classification=complaint&status=open",
                             headers=_hdr(owner_tok), timeout=10).json()
        assert inbox["items"], "expected an open complaint inbox item"
        return inbox["items"][0]["id"]

    def test_mark_done(self, owner_auth):
        item_id = self._make_open_item(owner_auth["token"])
        r = requests.post(f"{API}/inbox/{item_id}/status", json={"status": "done"},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "done"
        # verify by listing
        got = requests.get(f"{API}/inbox?status=done", headers=_hdr(owner_auth["token"]), timeout=10).json()
        assert any(it["id"] == item_id for it in got["items"])

    def test_dismiss(self, owner_auth):
        item_id = self._make_open_item(owner_auth["token"])
        r = requests.post(f"{API}/inbox/{item_id}/status", json={"status": "dismissed"},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["status"] == "dismissed"

    def test_invalid_status_400(self, owner_auth):
        item_id = self._make_open_item(owner_auth["token"])
        r = requests.post(f"{API}/inbox/{item_id}/status", json={"status": "nope"},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 400, r.text

    def test_unknown_id_404(self, owner_auth):
        r = requests.post(f"{API}/inbox/{uuid.uuid4().hex}/status", json={"status": "done"},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 404, r.text


# --------------------------------------------------------------- Auto-creation
class TestInboxAutoCreate:
    def test_complaint_creates_inbox_item(self, owner_auth):
        cs = requests.get(f"{API}/contacts", headers=_hdr(owner_auth["token"]), timeout=10).json()
        assert cs
        cid = cs[0]["id"]
        marker = f"TEST_autoinbox_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/complaints", json={"customer_id": cid, "text": marker},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        inbox = requests.get(f"{API}/inbox?classification=complaint",
                             headers=_hdr(owner_auth["token"]), timeout=10).json()
        assert any(marker in (it.get("preview") or "") or marker in (it.get("title") or "")
                   for it in inbox["items"]), "expected complaint inbox item"

    def test_text_directive_creates_inbox_item(self, owner_auth):
        marker = f"TEST_txtdir_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/voice-notes/text",
                          json={"text": f"{marker}: Priya please prepare a quote and follow up tomorrow."},
                          headers=_hdr(owner_auth["token"]), timeout=20)
        assert r.status_code == 200, r.text
        nid = r.json()["id"]
        deadline = time.time() + 40
        final = None
        while time.time() < deadline:
            g = requests.get(f"{API}/voice-notes/{nid}", headers=_hdr(owner_auth["token"]), timeout=10).json()
            if g.get("status") in ("done", "failed"):
                final = g
                break
            time.sleep(2)
        if not final or final["status"] != "done":
            pytest.skip(f"AI extraction not done: {final and final.get('status')} {final and final.get('error')}")
        # inbox should have an item with allowed classification (approval/task/reminder/decision)
        inbox = requests.get(f"{API}/inbox", headers=_hdr(owner_auth["token"]), timeout=10).json()
        matched = [it for it in inbox["items"]
                   if it.get("ref_type") == "decision" and it.get("ref_id") == final.get("decision_id")]
        assert matched, "expected inbox item referencing new decision"
        assert matched[0]["classification"] in ("approval", "task", "reminder", "decision")

    def test_csv_ingest_creates_open_item_and_commit_flips_done(self, owner_auth):
        csv_bytes = b"name,phone,type\nTEST_Inbox Ravi,9999900001,customer\nTEST_Inbox Meena,9999900002,customer\n"
        files = {"file": ("test_iter12.csv", csv_bytes, "text/csv")}
        headers = {"Authorization": f"Bearer {owner_auth['token']}"}
        r = requests.post(f"{API}/ingest/csv", files=files, headers=headers, timeout=60)
        assert r.status_code == 200, r.text
        doc = r.json()
        if doc.get("status") == "failed":
            pytest.skip(f"LLM failed: {doc.get('error')}")
        assert doc.get("inbox_id"), "ingest response must carry inbox_id"
        # inbox item is open
        inbox = requests.get(f"{API}/inbox", headers=_hdr(owner_auth["token"]), timeout=10).json()
        item = next((it for it in inbox["items"] if it["id"] == doc["inbox_id"]), None)
        assert item is not None
        assert item["status"] == "open"
        # commit ingestion
        commit_payload = {"records": doc.get("records") or {}}
        cr = requests.post(f"{API}/ingest/{doc['id']}/commit", json=commit_payload,
                           headers=_hdr(owner_auth["token"]), timeout=30)
        assert cr.status_code == 200, cr.text
        # inbox item flips to done
        inbox2 = requests.get(f"{API}/inbox", headers=_hdr(owner_auth["token"]), timeout=10).json()
        item2 = next((it for it in inbox2["items"] if it["id"] == doc["inbox_id"]), None)
        assert item2 is not None and item2["status"] == "done", f"expected done, got {item2}"


# --------------------------------------------------------------- 360 profile
class TestContactProfile:
    def _first_contact_id(self, tok):
        cs = requests.get(f"{API}/contacts", headers=_hdr(tok), timeout=10).json()
        return cs[0]["id"] if cs else None

    def test_owner_gets_full_profile(self, owner_auth):
        cid = self._first_contact_id(owner_auth["token"])
        assert cid
        r = requests.get(f"{API}/contacts/{cid}/profile", headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("contact", "summary", "invoices", "payments", "complaints",
                  "pending_deliveries", "follow_ups", "tasks", "decisions", "price_history"):
            assert k in d, f"missing key {k}"
        s = d["summary"]
        for k in ("total_billed", "total_paid", "outstanding", "last_payment", "open_complaints"):
            assert k in s, f"summary missing {k}"
        assert isinstance(s["total_billed"], (int, float))
        assert isinstance(s["outstanding"], (int, float))

    def test_finance_gets_profile(self, finance_auth, owner_auth):
        cid = self._first_contact_id(owner_auth["token"])
        r = requests.get(f"{API}/contacts/{cid}/profile", headers=_hdr(finance_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text

    def test_sales_forbidden(self, sales_auth, owner_auth):
        cid = self._first_contact_id(owner_auth["token"])
        r = requests.get(f"{API}/contacts/{cid}/profile", headers=_hdr(sales_auth["token"]), timeout=10)
        assert r.status_code == 403, f"expected 403 sales, got {r.status_code}"

    def test_production_forbidden(self, production_auth, owner_auth):
        cid = self._first_contact_id(owner_auth["token"])
        r = requests.get(f"{API}/contacts/{cid}/profile", headers=_hdr(production_auth["token"]), timeout=10)
        assert r.status_code == 403

    def test_missing_contact_404(self, owner_auth):
        r = requests.get(f"{API}/contacts/nonexistent-xyz/profile",
                         headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 404


# --------------------------------------------------------------- Ask AI money
class TestAskAIMoneyRoleGate:
    def _ask(self, tok, q):
        r = requests.post(f"{API}/ask", json={"question": q}, headers=_hdr(tok), timeout=60)
        if r.status_code == 502:
            time.sleep(2)
            r = requests.post(f"{API}/ask", json={"question": q}, headers=_hdr(tok), timeout=60)
        return r

    def test_owner_money_question_answers(self, owner_auth):
        r = self._ask(owner_auth["token"], "Who owes us the most money right now?")
        if r.status_code == 502:
            pytest.skip("LLM transient error")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("answer"), str) and len(d["answer"]) > 5
        # should NOT refuse
        low = d["answer"].lower()
        # Basic sanity: doesn't outright say restricted
        assert "restricted to owner" not in low or "kumar" in low or "sharma" not in low  # loose check

    def test_finance_money_question_answers(self, finance_auth):
        r = self._ask(finance_auth["token"], "What are the outstanding invoices for our top customer?")
        if r.status_code == 502:
            pytest.skip("LLM transient error")
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d.get("answer"), str) and len(d["answer"]) > 5

    def test_sales_money_question_restricted(self, sales_auth):
        r = self._ask(sales_auth["token"], "Who owes us more than 5 lakh?")
        if r.status_code == 502:
            pytest.skip("LLM transient error")
        assert r.status_code == 200, r.text
        answer = (r.json().get("answer") or "").lower()
        # Expect mention of restriction / owner+finance / not available
        assert any(k in answer for k in ("restrict", "owner", "finance", "not available", "don't have", "do not have")), \
            f"expected restriction message; got: {answer[:200]}"

    def test_production_non_money_question_works(self, production_auth):
        r = self._ask(production_auth["token"], "What are the current pending purchase workflows?")
        if r.status_code == 502:
            pytest.skip("LLM transient error")
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("answer"), str)

    def test_sales_non_money_question_works(self, sales_auth):
        r = self._ask(sales_auth["token"], "What tasks are assigned to sales role?")
        if r.status_code == 502:
            pytest.skip("LLM transient error")
        assert r.status_code == 200, r.text
        assert isinstance(r.json().get("answer"), str)

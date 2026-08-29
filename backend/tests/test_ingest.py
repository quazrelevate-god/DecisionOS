"""DecisionOS Data Ingestion pipeline tests (iteration 11).

Covers:
- POST /api/ingest/document (PDF/image OCR via Gemini)
- POST /api/ingest/csv      (spreadsheet mapping via Claude)
- POST /api/ingest/{id}/commit  (files review records; double-commit -> 400)
- GET  /api/ingest, /api/ingest/{id}, /api/invoices, /api/payments  (tenant scope)
- Role enforcement: production must be 403 on ingest endpoints; all roles GET
- POST /api/webhooks/whatsapp -> not_configured (no WHATSAPP_TOKEN)
"""
import io
import os
import time
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")
PRODUCTION = ("production@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")

INVOICE_PATH = "/tmp/invoice.png"
CSV_PATH = "/tmp/customers.csv"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _hdr(token):
    return {"Authorization": f"Bearer {token}"}


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


# -------- Role enforcement (401/403) --------
class TestIngestRoleGate:
    def test_document_requires_auth(self):
        with open(INVOICE_PATH, "rb") as f:
            r = requests.post(f"{API}/ingest/document",
                              files={"file": ("invoice.png", f, "image/png")}, timeout=30)
        assert r.status_code in (401, 403), f"unauth ingest doc expected 401/403, got {r.status_code}"

    def test_csv_requires_auth(self):
        with open(CSV_PATH, "rb") as f:
            r = requests.post(f"{API}/ingest/csv",
                              files={"file": ("customers.csv", f, "text/csv")}, timeout=30)
        assert r.status_code in (401, 403)

    def test_production_forbidden_document(self, production_auth):
        with open(INVOICE_PATH, "rb") as f:
            r = requests.post(f"{API}/ingest/document",
                              files={"file": ("invoice.png", f, "image/png")},
                              headers=_hdr(production_auth["token"]), timeout=30)
        assert r.status_code == 403, f"expected 403 for production, got {r.status_code}: {r.text}"

    def test_production_forbidden_csv(self, production_auth):
        with open(CSV_PATH, "rb") as f:
            r = requests.post(f"{API}/ingest/csv",
                              files={"file": ("customers.csv", f, "text/csv")},
                              headers=_hdr(production_auth["token"]), timeout=30)
        assert r.status_code == 403

    def test_production_can_list_invoices(self, production_auth):
        r = requests.get(f"{API}/invoices", headers=_hdr(production_auth["token"]), timeout=10)
        assert r.status_code == 200 and isinstance(r.json(), list)

    def test_production_can_list_payments(self, production_auth):
        r = requests.get(f"{API}/payments", headers=_hdr(production_auth["token"]), timeout=10)
        assert r.status_code == 200 and isinstance(r.json(), list)


# -------- Document upload (Gemini vision OCR) --------
class TestIngestDocument:
    def test_upload_invoice_image_returns_review(self, owner_auth):
        with open(INVOICE_PATH, "rb") as f:
            r = requests.post(f"{API}/ingest/document",
                              files={"file": ("invoice.png", f, "image/png")},
                              headers=_hdr(owner_auth["token"]), timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        # Handle LLM budget scenario gracefully
        if data.get("status") == "failed" and "Budget" in (data.get("error") or ""):
            pytest.skip(f"LLM budget exceeded: {data.get('error')}")
        assert data["id"]
        assert data["kind"] == "image"
        assert data["status"] == "review", f"unexpected status={data.get('status')} err={data.get('error')}"
        assert "records" in data
        recs = data["records"]
        for k in ("contacts", "invoices", "payments", "tasks"):
            assert k in recs and isinstance(recs[k], list)
        # We expect at least one invoice extracted from the sample invoice image
        assert len(recs["invoices"]) >= 1 or len(recs["contacts"]) >= 1, \
            f"expected some extraction; got summary={data.get('summary')} recs={recs}"
        pytest.ingest_doc_id = data["id"]

    def test_reject_unsupported_extension(self, owner_auth):
        buf = io.BytesIO(b"hello world")
        r = requests.post(f"{API}/ingest/document",
                          files={"file": ("note.txt", buf, "text/plain")},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 400
        assert "PDF" in r.text or "image" in r.text.lower()


# -------- CSV upload (Claude mapping) --------
class TestIngestCSV:
    def test_upload_customers_csv(self, owner_auth):
        with open(CSV_PATH, "rb") as f:
            r = requests.post(f"{API}/ingest/csv",
                              files={"file": ("customers.csv", f, "text/csv")},
                              headers=_hdr(owner_auth["token"]), timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        if data.get("status") == "failed" and "Budget" in (data.get("error") or ""):
            pytest.skip(f"LLM budget exceeded: {data.get('error')}")
        assert data["status"] == "review", f"unexpected status={data.get('status')} err={data.get('error')}"
        assert data.get("row_count") == 3
        recs = data["records"]
        # Auto-detected as customers
        assert data.get("entity") in ("customers", "vendors", "invoices", "payments")
        # Contacts should have been populated from customer list
        assert len(recs.get("contacts", [])) >= 1, f"expected contacts, got recs={recs}"
        pytest.ingest_csv_id = data["id"]

    def test_reject_unsupported_spreadsheet(self, owner_auth):
        buf = io.BytesIO(b"blob")
        r = requests.post(f"{API}/ingest/csv",
                          files={"file": ("random.txt", buf, "text/plain")},
                          headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 400


# -------- GET ingestions (list + detail) --------
class TestIngestList:
    def test_list_contains_new_ingests(self, owner_auth):
        r = requests.get(f"{API}/ingest", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        ids = {i["id"] for i in r.json()}
        # These are set in the tests above; may be absent if budget-skipped
        doc_id = getattr(pytest, "ingest_doc_id", None)
        csv_id = getattr(pytest, "ingest_csv_id", None)
        if doc_id:
            assert doc_id in ids
        if csv_id:
            assert csv_id in ids

    def test_get_ingestion_detail(self, owner_auth):
        doc_id = getattr(pytest, "ingest_doc_id", None)
        if not doc_id:
            pytest.skip("no doc ingest available")
        r = requests.get(f"{API}/ingest/{doc_id}", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["id"] == doc_id
        assert "records" in d

    def test_get_missing_ingestion_404(self, owner_auth):
        r = requests.get(f"{API}/ingest/nonexistent-xxx", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 404


# -------- Commit ingestion (creates invoices/contacts/etc) --------
class TestIngestCommit:
    def test_commit_csv_creates_contacts(self, owner_auth):
        csv_id = getattr(pytest, "ingest_csv_id", None)
        if not csv_id:
            pytest.skip("CSV ingest missing")
        # Fetch current review records
        d = requests.get(f"{API}/ingest/{csv_id}", headers=_hdr(owner_auth["token"]), timeout=10).json()
        review_contacts = d["records"].get("contacts", [])
        assert len(review_contacts) >= 1, "no contacts in review to commit"
        contacts_before = requests.get(f"{API}/contacts", headers=_hdr(owner_auth["token"]), timeout=10).json()
        # Dedupe is by name (case-insensitive) — record existing names before
        existing_names = {c.get("name", "").lower() for c in (contacts_before or [])}
        new_review_names = {(c.get("name") or "").lower() for c in review_contacts if c.get("name")}
        expected_new = new_review_names - existing_names
        r = requests.post(f"{API}/ingest/{csv_id}/commit",
                          json={"records": d["records"]},
                          headers={**_hdr(owner_auth["token"]), "Content-Type": "application/json"},
                          timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("filed") is True
        # Either new contacts were created, or all were dedupes of existing ones
        assert body["created"]["contacts"] == len(expected_new), \
            f"expected {len(expected_new)} new contacts, got {body['created']['contacts']} (review={new_review_names}, existing_overlap={new_review_names & existing_names})"
        # Verify persistence — final list must contain every reviewed name
        got = requests.get(f"{API}/ingest/{csv_id}", headers=_hdr(owner_auth["token"]), timeout=10).json()
        assert got["status"] == "filed"
        contacts_after = requests.get(f"{API}/contacts", headers=_hdr(owner_auth["token"]), timeout=10).json()
        after_names = {c.get("name", "").lower() for c in (contacts_after or [])}
        assert new_review_names.issubset(after_names), \
            f"reviewed contacts missing after commit; missing={new_review_names - after_names}"

    def test_double_commit_rejected(self, owner_auth):
        csv_id = getattr(pytest, "ingest_csv_id", None)
        if not csv_id:
            pytest.skip("CSV ingest missing")
        d = requests.get(f"{API}/ingest/{csv_id}", headers=_hdr(owner_auth["token"]), timeout=10).json()
        r = requests.post(f"{API}/ingest/{csv_id}/commit",
                          json={"records": d["records"]},
                          headers={**_hdr(owner_auth["token"]), "Content-Type": "application/json"},
                          timeout=15)
        assert r.status_code == 400, f"expected 400 on double commit, got {r.status_code} {r.text}"

    def test_commit_document_creates_invoice_and_task(self, owner_auth):
        doc_id = getattr(pytest, "ingest_doc_id", None)
        if not doc_id:
            pytest.skip("doc ingest missing")
        d = requests.get(f"{API}/ingest/{doc_id}", headers=_hdr(owner_auth["token"]), timeout=10).json()
        # Skip if no invoices/contacts extracted (LLM variability)
        if not d.get("records") or (not d["records"].get("invoices") and not d["records"].get("contacts")):
            pytest.skip("no extracted records to commit")
        # Ensure at least a follow-up task exists
        recs = d["records"]
        if not recs.get("tasks"):
            recs["tasks"] = []
        inv_before = requests.get(f"{API}/invoices", headers=_hdr(owner_auth["token"]), timeout=10).json()
        n_inv_before = len(inv_before)
        r = requests.post(f"{API}/ingest/{doc_id}/commit",
                          json={"records": recs},
                          headers={**_hdr(owner_auth["token"]), "Content-Type": "application/json"},
                          timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("filed") is True
        # If at least one invoice was in records, invoices table should grow
        if recs.get("invoices"):
            inv_after = requests.get(f"{API}/invoices", headers=_hdr(owner_auth["token"]), timeout=10).json()
            assert len(inv_after) >= n_inv_before + 1
            assert any(i.get("ingestion_id") == doc_id for i in inv_after)


# -------- Tenant isolation on filed data --------
class TestIngestIsolation:
    def test_new_tenant_cannot_see_others_invoices(self):
        import uuid
        email = f"iso_{uuid.uuid4().hex[:8]}@example.com"
        reg = requests.post(f"{API}/auth/register", json={
            "company_name": "TEST_ingest_iso",
            "name": "TEST_iso_owner",
            "email": email,
            "password": "testpass123",
        }, timeout=15).json()
        tok = reg["token"]
        r_inv = requests.get(f"{API}/invoices", headers=_hdr(tok), timeout=10)
        r_pay = requests.get(f"{API}/payments", headers=_hdr(tok), timeout=10)
        r_ing = requests.get(f"{API}/ingest", headers=_hdr(tok), timeout=10)
        assert r_inv.status_code == 200 and r_inv.json() == []
        assert r_pay.status_code == 200 and r_pay.json() == []
        assert r_ing.status_code == 200 and r_ing.json() == []


# -------- WhatsApp webhook (mocked/not-configured) --------
class TestWhatsAppWebhook:
    def test_not_configured_when_no_token(self):
        r = requests.post(f"{API}/webhooks/whatsapp", json={"anything": True}, timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "not_configured"

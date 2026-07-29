"""Iteration 67 – Unknown-purchase review gate + reclassify endpoint."""
import os, uuid, time, requests, pytest
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://founder-os-58.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
mongo = MongoClient(MONGO_URL)[DB_NAME]


def _login(email, pwd):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=20)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    d = r.json()
    return d["token"], d["user"]


@pytest.fixture(scope="module")
def owner():
    tok, u = _login("owner@sharma.com", "demo1234")
    return {"tok": tok, "user": u, "h": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def finance():
    tok, u = _login("finance@sharma.com", "demo1234")
    return {"tok": tok, "user": u, "h": {"Authorization": f"Bearer {tok}"}}


@pytest.fixture(scope="module")
def sales():
    tok, u = _login("sales@sharma.com", "demo1234")
    return {"tok": tok, "user": u, "h": {"Authorization": f"Bearer {tok}"}}


def _seed_ingestion(tenant_id, user_id, purchase_type, extra_inv=None):
    ing_id = str(uuid.uuid4())
    inv = {
        "type": "purchase_bill",
        "purchase_type": purchase_type,
        "number": f"TEST-{ing_id[:6]}",
        "contact_name": "TEST_Vendor",
        "date": "2025-01-15",
        "amount": 5000,
        "currency": "INR",
        "line_items": [{"description": "TEST item", "qty": 1, "rate": 5000, "amount": 5000}],
    }
    if extra_inv:
        inv.update(extra_inv)
    doc = {
        "id": ing_id, "tenant_id": tenant_id, "user_id": user_id,
        "source": "upload", "filename": "TEST_bill.png", "status": "review",
        "records": {"contacts": [], "invoices": [inv], "payments": [], "tasks": []},
        "summary": "TEST", "created_at": "2025-01-15T00:00:00Z",
    }
    mongo.ingestions.insert_one(doc)
    return ing_id, inv


# ------------------------------------------------------------------
# Commit endpoint gating
# ------------------------------------------------------------------
class TestCommitUnknownGate:
    def test_commit_rejects_unknown(self, owner):
        ing_id, inv = _seed_ingestion(owner["user"]["tenant_id"], owner["user"]["id"], "unknown")
        try:
            r = requests.post(f"{API}/ingest/{ing_id}/commit",
                              headers=owner["h"], json={"records": {"invoices": [inv]}}, timeout=30)
            assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"
            assert "classify" in r.text.lower()
        finally:
            mongo.ingestions.delete_one({"id": ing_id})

    def test_commit_rejects_blank(self, owner):
        ing_id, inv = _seed_ingestion(owner["user"]["tenant_id"], owner["user"]["id"], "")
        try:
            r = requests.post(f"{API}/ingest/{ing_id}/commit",
                              headers=owner["h"], json={"records": {"invoices": [inv]}}, timeout=30)
            assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"
        finally:
            mongo.ingestions.delete_one({"id": ing_id})

    def test_commit_succeeds_asset(self, owner):
        ing_id, inv = _seed_ingestion(owner["user"]["tenant_id"], owner["user"]["id"],
                                      "asset", {"asset_name": "TEST_Machine"})
        try:
            r = requests.post(f"{API}/ingest/{ing_id}/commit",
                              headers=owner["h"], json={"records": {"invoices": [inv]}}, timeout=30)
            assert r.status_code == 200, f"{r.status_code} {r.text}"
            body = r.json()
            assert body.get("filed") is True
            assert body["created"].get("assets", 0) >= 1
            # verify asset row exists
            a = mongo.assets.find_one({"tenant_id": owner["user"]["tenant_id"], "name": "TEST_Machine"})
            assert a is not None
            mongo.assets.delete_many({"tenant_id": owner["user"]["tenant_id"], "name": "TEST_Machine"})
        finally:
            mongo.ingestions.delete_one({"id": ing_id})
            mongo.invoices.delete_many({"ingestion_id": ing_id})

    def test_commit_succeeds_inventory(self, owner):
        ing_id, inv = _seed_ingestion(owner["user"]["tenant_id"], owner["user"]["id"],
                                      "inventory", {"inventory_qty": 10, "inventory_unit": "kg"})
        try:
            r = requests.post(f"{API}/ingest/{ing_id}/commit",
                              headers=owner["h"], json={"records": {"invoices": [inv]}}, timeout=30)
            assert r.status_code == 200, f"{r.status_code} {r.text}"
            assert r.json()["created"].get("inventory", 0) >= 1
            mongo.inventory.delete_many({"tenant_id": owner["user"]["tenant_id"], "vendor_name": "TEST_Vendor"})
        finally:
            mongo.ingestions.delete_one({"id": ing_id})
            mongo.invoices.delete_many({"ingestion_id": ing_id})

    def test_commit_succeeds_expense(self, owner):
        ing_id, inv = _seed_ingestion(owner["user"]["tenant_id"], owner["user"]["id"], "expense")
        try:
            r = requests.post(f"{API}/ingest/{ing_id}/commit",
                              headers=owner["h"], json={"records": {"invoices": [inv]}}, timeout=30)
            assert r.status_code == 200, f"{r.status_code} {r.text}"
            assert r.json()["created"].get("expenses", 0) >= 1
            mongo.expenses.delete_many({"tenant_id": owner["user"]["tenant_id"], "vendor_name": "TEST_Vendor"})
        finally:
            mongo.ingestions.delete_one({"id": ing_id})
            mongo.invoices.delete_many({"ingestion_id": ing_id})


# ------------------------------------------------------------------
# Reclassify endpoint auth + shape
# ------------------------------------------------------------------
class TestReclassifyEndpoint:
    def test_non_owner_forbidden_sales(self, sales):
        r = requests.post(f"{API}/ledger/reclassify-purchases", headers=sales["h"], timeout=15)
        assert r.status_code == 403, f"sales should be 403, got {r.status_code}: {r.text}"

    def test_non_owner_forbidden_finance(self, finance):
        r = requests.post(f"{API}/ledger/reclassify-purchases", headers=finance["h"], timeout=15)
        # Finance has ledger permission but is not owner → 403
        assert r.status_code == 403, f"finance should be 403, got {r.status_code}: {r.text}"

    def test_owner_returns_summary(self, owner):
        r = requests.post(f"{API}/ledger/reclassify-purchases", headers=owner["h"], timeout=120)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        s = r.json()
        for k in ("reviewed", "to_asset", "to_inventory", "kept_expense", "unknown", "unchanged"):
            assert k in s, f"missing {k} in summary {s}"
            assert isinstance(s[k], int)

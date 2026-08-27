"""Iteration 55 — Full backend regression for the new Finance Ledger module.

Covers:
- Expenses / Assets / Inventory full CRUD
- AI expense category suggestion (Claude → keyword fallback)
- Ledger summary aggregation (totals, by_category, by_vendor, by_month)
- Auto-Asset creation when expense category == "Asset Purchase"
- RBAC via require_ledger (owner + finance perm OK, sales without perm 403)
- Company Brain sync (write on manual and ingest, search returns arrays)
- Regression: ingestion flow still creates contacts/invoices/payments/tasks
  and rolls up purchase_bill + outgoing payment → expenses
"""
import os
import uuid
import time

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

OWNER = ("owner@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")


# ---------- shared login / cleanup helpers ----------
def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


CREATED = {"expenses": [], "assets": [], "inventory": []}


@pytest.fixture(scope="module")
def owner_tok() -> str:
    return _login(*OWNER)


@pytest.fixture(scope="module")
def finance_tok() -> str:
    return _login(*FINANCE)


@pytest.fixture(scope="module")
def sales_tok() -> str:
    return _login(*SALES)


@pytest.fixture(scope="module", autouse=True)
def _cleanup(owner_tok):
    """After all tests, delete every record this suite created."""
    yield
    h = _h(owner_tok)
    for eid in CREATED["expenses"]:
        try:
            requests.delete(f"{API}/expenses/{eid}", headers=h, timeout=15)
        except Exception:
            pass
    for aid in CREATED["assets"]:
        try:
            requests.delete(f"{API}/assets/{aid}", headers=h, timeout=15)
        except Exception:
            pass
    for iid in CREATED["inventory"]:
        try:
            requests.delete(f"{API}/inventory/{iid}", headers=h, timeout=15)
        except Exception:
            pass


# =======================================================================
# 1. Expenses CRUD
# =======================================================================
class TestExpensesCRUD:
    def test_list_expenses_shape(self, owner_tok):
        r = requests.get(f"{API}/expenses", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_read_update_delete_expense(self, owner_tok):
        h = _h(owner_tok)
        payload = {
            "title": f"TEST_iter55 Electricity bill {uuid.uuid4().hex[:6]}",
            "amount": 1234.50,
            "category": "Utilities",
            "vendor_name": "TEST_iter55 Vendor",
            "status": "unpaid",
            "notes": "TEST_iter55",
        }
        r = requests.post(f"{API}/expenses", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["title"] == payload["title"]
        assert doc["amount"] == 1234.50
        assert doc["category"] == "Utilities"
        assert doc["vendor_name"] == "TEST_iter55 Vendor"
        assert doc["status"] == "unpaid"
        assert "id" in doc
        assert "currency" in doc
        eid = doc["id"]
        CREATED["expenses"].append(eid)

        # GET verify persisted
        lst = requests.get(f"{API}/expenses", headers=h, timeout=30).json()
        found = next((e for e in lst if e["id"] == eid), None)
        assert found is not None
        assert found["amount"] == 1234.50

        # PATCH — change amount + status
        r = requests.patch(f"{API}/expenses/{eid}", json={"amount": 2000, "status": "paid"},
                           headers=h, timeout=30)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert upd["amount"] == 2000
        assert upd["status"] == "paid"

        # DELETE
        r = requests.delete(f"{API}/expenses/{eid}", headers=h, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        CREATED["expenses"].remove(eid)

        # verify gone
        lst = requests.get(f"{API}/expenses", headers=h, timeout=30).json()
        assert all(e["id"] != eid for e in lst)


# =======================================================================
# 2. Assets CRUD
# =======================================================================
class TestAssetsCRUD:
    def test_list_assets(self, owner_tok):
        r = requests.get(f"{API}/assets", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_asset_full_cycle(self, owner_tok):
        h = _h(owner_tok)
        payload = {
            "name": f"TEST_iter55 Laptop {uuid.uuid4().hex[:6]}",
            "category": "IT & Electronics",
            "purchase_amount": 85000,
            "vendor_name": "TEST_iter55 Vendor",
        }
        r = requests.post(f"{API}/assets", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["name"] == payload["name"]
        assert a["purchase_amount"] == 85000
        assert a["category"] == "IT & Electronics"
        aid = a["id"]
        CREATED["assets"].append(aid)

        # PATCH change status
        payload_upd = dict(payload)
        payload_upd["status"] = "maintenance"
        r = requests.patch(f"{API}/assets/{aid}", json=payload_upd, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "maintenance"

        # DELETE
        r = requests.delete(f"{API}/assets/{aid}", headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["assets"].remove(aid)


# =======================================================================
# 3. Inventory CRUD + value math
# =======================================================================
class TestInventoryCRUD:
    def test_inventory_value_computed(self, owner_tok):
        h = _h(owner_tok)
        payload = {
            "item": f"TEST_iter55 Yarn {uuid.uuid4().hex[:6]}",
            "sku": "T55-YARN",
            "quantity": 12.5,
            "unit": "kg",
            "unit_cost": 200,
            "category": "Raw Material",
        }
        r = requests.post(f"{API}/inventory", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        i = r.json()
        assert i["value"] == round(12.5 * 200, 2)  # 2500
        assert i["quantity"] == 12.5
        assert i["unit_cost"] == 200
        iid = i["id"]
        CREATED["inventory"].append(iid)

        # PATCH quantity → value should recompute
        payload_upd = dict(payload)
        payload_upd["quantity"] = 20
        r = requests.patch(f"{API}/inventory/{iid}", json=payload_upd, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["value"] == round(20 * 200, 2)  # 4000

        # DELETE
        r = requests.delete(f"{API}/inventory/{iid}", headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["inventory"].remove(iid)


# =======================================================================
# 4. AI Suggest category
# =======================================================================
class TestSuggestCategory:
    def test_suggest_ai_or_heuristic(self, owner_tok):
        h = _h(owner_tok)
        VALID = {"Raw Material", "Salary & Wages", "Rent", "Utilities", "Logistics & Freight",
                 "Marketing", "Professional Services", "Asset Purchase", "Maintenance & Repairs",
                 "Taxes & Duties", "Office Supplies", "Other"}
        # Text obviously about a machine → should be Asset Purchase, but AI/heuristic must return SOME valid category
        r = requests.post(f"{API}/expenses/suggest-category",
                          json={"text": "Bought new spinning machinery for factory floor"},
                          headers=h, timeout=45)
        assert r.status_code == 200, r.text
        cat = r.json().get("category")
        assert cat in VALID, f"category '{cat}' not in EXPENSE_CATEGORIES"

    def test_suggest_never_500(self, owner_tok):
        # Even an empty text should NOT 500 (endpoint has heuristic fallback → "Other")
        r = requests.post(f"{API}/expenses/suggest-category",
                          json={"text": ""}, headers=_h(owner_tok), timeout=30)
        assert r.status_code == 200
        assert r.json().get("category") == "Other"


# =======================================================================
# 5. Auto-asset when category == Asset Purchase
# =======================================================================
class TestAssetPurchaseAutoCreate:
    def test_asset_purchase_creates_asset(self, owner_tok):
        h = _h(owner_tok)
        # count assets before
        before = requests.get(f"{API}/assets", headers=h, timeout=30).json()
        before_ids = {a["id"] for a in before}

        marker = f"TEST_iter55 Machine {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/expenses",
                          json={"title": marker, "amount": 500000, "category": "Asset Purchase",
                                "vendor_name": "TEST_iter55 Machinery Co", "status": "paid"},
                          headers=h, timeout=30)
        assert r.status_code == 200, r.text
        exp = r.json()
        CREATED["expenses"].append(exp["id"])

        # small wait for insert consistency (not strictly needed – awaited in handler)
        time.sleep(0.5)
        after = requests.get(f"{API}/assets", headers=h, timeout=30).json()
        new_assets = [a for a in after if a["id"] not in before_ids]
        assert len(new_assets) >= 1, "Asset should have been auto-created for 'Asset Purchase' expense"
        # linked back to the expense
        linked = [a for a in new_assets if a.get("expense_id") == exp["id"]]
        assert linked, f"None of the new assets linked to expense_id={exp['id']}: {new_assets}"
        auto_asset = linked[0]
        assert auto_asset["name"] == marker
        assert auto_asset["purchase_amount"] == 500000
        # cleanup
        CREATED["assets"].append(auto_asset["id"])


# =======================================================================
# 6. Ledger summary
# =======================================================================
class TestLedgerSummary:
    def test_summary_shape(self, owner_tok):
        r = requests.get(f"{API}/ledger/summary", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        for k in ("currency", "totals", "by_category", "by_vendor", "by_month",
                  "categories", "asset_categories"):
            assert k in s, f"missing key {k}"
        t = s["totals"]
        for k in ("total_spend", "paid", "outstanding", "expense_count",
                  "asset_count", "asset_value", "inventory_count", "inventory_value"):
            assert k in t, f"missing totals key {k}"
        assert isinstance(s["by_category"], list)
        assert isinstance(s["by_vendor"], list)
        assert isinstance(s["by_month"], list)
        # outstanding == total_spend - paid (rounding tolerant)
        assert abs((t["total_spend"] - t["paid"]) - t["outstanding"]) < 0.01

    def test_summary_reflects_new_expense(self, owner_tok):
        h = _h(owner_tok)
        before = requests.get(f"{API}/ledger/summary", headers=h, timeout=30).json()["totals"]
        marker = f"TEST_iter55 Freight {uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/expenses",
                          json={"title": marker, "amount": 9999, "category": "Logistics & Freight",
                                "vendor_name": "TEST_iter55 Transport", "status": "unpaid"},
                          headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["expenses"].append(r.json()["id"])
        after = requests.get(f"{API}/ledger/summary", headers=h, timeout=30).json()["totals"]
        assert after["expense_count"] == before["expense_count"] + 1
        assert round(after["total_spend"] - before["total_spend"], 2) == 9999.0
        # outstanding should also increase since status=unpaid
        assert round(after["outstanding"] - before["outstanding"], 2) == 9999.0


# =======================================================================
# 7. RBAC — require_ledger
# =======================================================================
class TestRBAC:
    def test_owner_can_access(self, owner_tok):
        r = requests.get(f"{API}/expenses", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 200

    def test_finance_can_access(self, finance_tok):
        # finance role's ROLE_DEFAULT_PERMS include 'ledger' + 'finance'
        r = requests.get(f"{API}/expenses", headers=_h(finance_tok), timeout=30)
        assert r.status_code == 200
        r = requests.get(f"{API}/ledger/summary", headers=_h(finance_tok), timeout=30)
        assert r.status_code == 200

    def test_sales_denied(self, sales_tok):
        # sales role's default perms don't include ledger/finance → 403
        r = requests.get(f"{API}/expenses", headers=_h(sales_tok), timeout=30)
        assert r.status_code == 403, f"expected 403 for sales, got {r.status_code}: {r.text}"
        r = requests.get(f"{API}/assets", headers=_h(sales_tok), timeout=30)
        assert r.status_code == 403
        r = requests.get(f"{API}/inventory", headers=_h(sales_tok), timeout=30)
        assert r.status_code == 403
        r = requests.get(f"{API}/ledger/summary", headers=_h(sales_tok), timeout=30)
        assert r.status_code == 403
        r = requests.post(f"{API}/expenses",
                          json={"title": "TEST_iter55 blocked", "amount": 1},
                          headers=_h(sales_tok), timeout=30)
        assert r.status_code == 403


# =======================================================================
# 8. Company Brain sync + search
# =======================================================================
class TestBrainSync:
    def test_manual_expense_written_to_brain(self, owner_tok):
        h = _h(owner_tok)
        uniq = f"BrainSyncMarker{uuid.uuid4().hex[:8]}"
        title = f"TEST_iter55 {uniq} widget"
        r = requests.post(f"{API}/expenses",
                          json={"title": title, "amount": 111, "category": "Office Supplies",
                                "vendor_name": "TEST_iter55 Stationery", "status": "unpaid"},
                          headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["expenses"].append(r.json()["id"])
        time.sleep(0.5)
        # brain search returns expenses AND memory
        r = requests.get(f"{API}/brain/search", params={"q": uniq}, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("expenses", "assets", "inventory", "memory"):
            assert k in body, f"brain/search missing '{k}'"
        expenses = body["expenses"]
        assert any(uniq in (e.get("title") or "") for e in expenses), \
            f"expense with marker {uniq} not returned by brain search"
        # memory row for manual expense (write_brain=True)
        mem = body["memory"]
        assert any(uniq in (m.get("text") or "") for m in mem), \
            "memory row not written for manual expense — write_brain=True path broken"

    def test_manual_asset_and_inventory_in_brain_search(self, owner_tok):
        h = _h(owner_tok)
        uniq = f"BrainAssetMarker{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/assets",
                          json={"name": f"TEST_iter55 {uniq}", "category": "Equipment",
                                "purchase_amount": 10000}, headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["assets"].append(r.json()["id"])
        uniq2 = f"BrainInvMarker{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/inventory",
                          json={"item": f"TEST_iter55 {uniq2}", "quantity": 3,
                                "unit": "pcs", "unit_cost": 500}, headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["inventory"].append(r.json()["id"])
        time.sleep(0.5)
        b1 = requests.get(f"{API}/brain/search", params={"q": uniq}, headers=h, timeout=30).json()
        assert any(uniq in (a.get("name") or "") for a in b1.get("assets", []))
        b2 = requests.get(f"{API}/brain/search", params={"q": uniq2}, headers=h, timeout=30).json()
        assert any(uniq2 in (i.get("item") or "") for i in b2.get("inventory", []))


# =======================================================================
# 9. Regression — Ingestion flow still works and rolls up to expenses
# =======================================================================
class TestIngestRegression:
    def test_commit_ingestion_creates_records_and_rolls_up(self, owner_tok):
        """Use /api/ingest/{id}/commit with a hand-built records payload.

        This bypasses AI extraction (which needs a real PDF+Claude) but exercises the
        commit_ingestion_records path that the review calls out: a purchase_bill →
        expense, and an outgoing payment → expense. To create an ingestion row we
        first insert a minimal stub via /api/ingest/document (a tiny image file).
        """
        h = _h(owner_tok)
        # 1×1 PNG stub
        png_bytes = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0"
            "00000003000101616e0d5c0000000049454e44ae426082"
        )
        marker = f"TEST_iter55_ingest_{uuid.uuid4().hex[:8]}"
        files = {"file": (f"{marker}.png", png_bytes, "image/png")}
        # Multipart — no Content-Type from _h
        up = requests.post(f"{API}/ingest/document",
                           headers={"Authorization": h["Authorization"]},
                           files=files, data={"source": "upload"}, timeout=60)
        assert up.status_code == 200, up.text
        ing = up.json()
        ing_id = ing["id"]

        # 2) Commit with a fabricated records payload
        vendor_name = f"TEST_iter55 Vendor {uuid.uuid4().hex[:5]}"
        commit_payload = {
            "records": {
                "contacts": [{"name": vendor_name, "type": "vendor"}],
                "invoices": [{
                    "type": "purchase_bill",
                    "number": f"BILL-{marker}",
                    "contact_name": vendor_name,
                    "amount": 4200,
                    "currency": "INR",
                    "date": "2026-01-15",
                    "line_items": [{"description": "Widgets"}],
                }],
                "payments": [{
                    "direction": "out",
                    "amount": 1500,
                    "contact_name": vendor_name,
                    "date": "2026-01-16",
                    "method": "bank",
                    "reference": marker,
                }],
                "tasks": [{"title": f"Followup {marker}", "priority": "medium"}],
            }
        }
        r = requests.post(f"{API}/ingest/{ing_id}/commit", json=commit_payload,
                          headers=h, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["filed"] is True
        c = body["created"]
        assert c["contacts"] >= 1
        assert c["invoices"] == 1
        assert c["payments"] == 1
        assert c["tasks"] == 1
        # KEY REVIEW POINT: purchase_bill + outgoing payment → 2 expenses
        assert c["expenses"] == 2, f"expected 2 expense roll-ups, got {c}"

        # 3) Verify the roll-up expenses exist and are linked
        time.sleep(0.5)
        lst = requests.get(f"{API}/expenses", headers=h, timeout=30).json()
        bill_exp = [e for e in lst if e.get("ingestion_id") == ing_id and e.get("invoice_id")]
        pay_exp = [e for e in lst if e.get("ingestion_id") == ing_id and e.get("payment_id")]
        assert bill_exp, "purchase_bill roll-up expense not found"
        assert pay_exp, "outgoing payment roll-up expense not found"
        assert bill_exp[0]["amount"] == 4200
        assert bill_exp[0]["status"] == "unpaid"
        assert pay_exp[0]["amount"] == 1500
        assert pay_exp[0]["status"] == "paid"

        # 4) Brain search should surface these expenses (source != manual → write_brain True)
        b = requests.get(f"{API}/brain/search",
                        params={"q": vendor_name.split()[-1]}, headers=h, timeout=30).json()
        vend_hit = any(vendor_name in (e.get("vendor_name") or "") for e in b.get("expenses", []))
        assert vend_hit, "ingested expense not searchable in Company Brain"

        # cleanup — remember both expenses, contact, invoice, payment, task, ingestion
        for e in bill_exp + pay_exp:
            CREATED["expenses"].append(e["id"])
        # best-effort delete ingestion + contact via direct APIs (contacts don't get exposed cleanup here)
        try:
            requests.delete(f"{API}/ingest/{ing_id}", headers=h, timeout=15)
        except Exception:
            pass

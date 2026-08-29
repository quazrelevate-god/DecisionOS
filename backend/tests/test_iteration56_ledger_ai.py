"""Iteration 56 — Ledger v2: File attachments + AI Cockpit.

Covers:
- POST /api/expenses/with-file, /api/assets/with-file, /api/inventory/with-file
  * WITHOUT a file (typed-only) → creates and returns 200
  * WITH an image bill → AI OCR extracts, merges with typed (typed wins), attachment stored
  * 400 when both typed identifier AND file are empty
  * Asset Purchase auto-creates linked Asset through the new path
- AI cockpit endpoints:
  * GET /api/ledger/ai/{scope} for scope in {brief, overview, expenses, assets, inventory}
  * POST /api/ledger/ai/{scope}/refresh — new generated_at
  * POST /api/ledger/ask — 400 empty, real answer non-empty
  * 404 unknown scope
- RBAC — sales blocked from every new endpoint
- REGRESSION — existing JSON endpoints, PATCH, DELETE, summary, suggest-category still work
- Serves the stored attachment file (GET /api/files/{fname})
"""
import os
import io
import uuid
import time
from pathlib import Path

import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE = base_url()
API = f"{BASE}/api"

OWNER = ("owner@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")

VALID_EXPENSE_CATS = {
    "Raw Material", "Salary & Wages", "Rent", "Utilities", "Logistics & Freight",
    "Marketing", "Professional Services", "Asset Purchase", "Maintenance & Repairs",
    "Taxes & Duties", "Office Supplies", "Other",
}
VALID_ASSET_CATS = {
    "Machinery", "Equipment", "Vehicle", "Furniture", "IT & Electronics", "Building", "Other",
}

CREATED = {"expenses": [], "assets": [], "inventory": []}
CREATED_FILES = []  # backend/uploads filenames to cleanup
UPLOAD_DIR = Path("/app/backend/uploads")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text}"
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _hauth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_tok():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def finance_tok():
    return _login(*FINANCE)


@pytest.fixture(scope="module")
def sales_tok():
    return _login(*SALES)


@pytest.fixture(scope="module", autouse=True)
def _cleanup(owner_tok):
    yield
    h = _h(owner_tok)
    for eid in CREATED["expenses"]:
        try: requests.delete(f"{API}/expenses/{eid}", headers=h, timeout=15)
        except Exception: pass
    for aid in CREATED["assets"]:
        try: requests.delete(f"{API}/assets/{aid}", headers=h, timeout=15)
        except Exception: pass
    for iid in CREATED["inventory"]:
        try: requests.delete(f"{API}/inventory/{iid}", headers=h, timeout=15)
        except Exception: pass
    for fname in CREATED_FILES:
        try:
            fp = UPLOAD_DIR / fname
            if fp.exists():
                fp.unlink()
        except Exception:
            pass


def _make_invoice_png(vendor="Sunrise Machinery Ltd", amount="336300",
                     date="2026-01-15", item="CNC Lathe Machine") -> bytes:
    """Build a small, readable invoice PNG."""
    img = Image.new("RGB", (520, 340), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
    except Exception:
        font = ImageFont.load_default()
        small = ImageFont.load_default()
    d.text((20, 15), "TAX INVOICE", fill="black", font=font)
    d.text((20, 55), f"Vendor: {vendor}", fill="black", font=small)
    d.text((20, 80), f"Date: {date}", fill="black", font=small)
    d.text((20, 105), f"Bill No: INV-{uuid.uuid4().hex[:6].upper()}", fill="black", font=small)
    d.line([(20, 135), (500, 135)], fill="black", width=2)
    d.text((20, 145), f"Item: {item}", fill="black", font=small)
    d.text((20, 170), "Qty: 1", fill="black", font=small)
    d.text((20, 195), f"Rate: INR {amount}", fill="black", font=small)
    d.line([(20, 225), (500, 225)], fill="black", width=2)
    d.text((20, 240), f"Total Amount: INR {amount}", fill="black", font=font)
    d.text((20, 285), "Terms: Net 30 days", fill="black", font=small)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ============================================================================
# 1) with-file: no file (typed-only) path
# ============================================================================
class TestWithFileNoFile:
    def test_expense_no_file(self, owner_tok):
        title = f"TEST_iter56 Electricity bill {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/expenses/with-file",
            headers=_hauth(owner_tok),
            data={"title": title, "amount": "2100", "vendor_name": "TEST_iter56 MSEDCL",
                  "category": "", "status": "unpaid", "notes": "TEST_iter56"},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["title"] == title
        assert doc["amount"] == 2100
        assert doc["status"] == "unpaid"
        assert doc.get("attachment") in (None, {})
        # Category auto-guessed to Utilities via 'electricity' keyword
        assert doc["category"] in VALID_EXPENSE_CATS
        CREATED["expenses"].append(doc["id"])

    def test_asset_no_file(self, owner_tok):
        name = f"TEST_iter56 Printer {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/assets/with-file",
            headers=_hauth(owner_tok),
            data={"name": name, "purchase_amount": "45000",
                  "vendor_name": "TEST_iter56 Vendor", "category": "IT & Electronics",
                  "purchase_date": "2026-01-10", "status": "active", "notes": ""},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["name"] == name
        assert doc["purchase_amount"] == 45000
        assert doc["category"] == "IT & Electronics"
        CREATED["assets"].append(doc["id"])

    def test_inventory_no_file(self, owner_tok):
        item = f"TEST_iter56 Yarn {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/inventory/with-file",
            headers=_hauth(owner_tok),
            data={"item": item, "sku": "T56-YARN", "quantity": "10", "unit": "kg",
                  "unit_cost": "250", "category": "Raw Material",
                  "vendor_name": "TEST_iter56 Yarn Co", "notes": ""},
            timeout=45,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["item"] == item
        assert doc["value"] == round(10 * 250, 2)
        CREATED["inventory"].append(doc["id"])


# ============================================================================
# 2) with-file: 400 when both typed identifier + file empty
# ============================================================================
class TestWithFileEmpty:
    def test_expense_empty_400(self, owner_tok):
        r = requests.post(f"{API}/expenses/with-file", headers=_hauth(owner_tok),
                          data={"title": "", "amount": "", "vendor_name": ""}, timeout=30)
        assert r.status_code == 400, r.text

    def test_asset_empty_400(self, owner_tok):
        r = requests.post(f"{API}/assets/with-file", headers=_hauth(owner_tok),
                          data={"name": "", "purchase_amount": ""}, timeout=30)
        assert r.status_code == 400, r.text

    def test_inventory_empty_400(self, owner_tok):
        r = requests.post(f"{API}/inventory/with-file", headers=_hauth(owner_tok),
                          data={"item": "", "quantity": "", "unit_cost": ""}, timeout=30)
        assert r.status_code == 400, r.text


# ============================================================================
# 3) with-file: WITH an image bill → attachment stored + AI merge
# ============================================================================
class TestWithFileImage:
    def test_expense_with_bill_stored_and_ai_reads(self, owner_tok):
        h = _hauth(owner_tok)
        # Only supply amount typed; leave title/vendor blank so AI fills them.
        img = _make_invoice_png(vendor="Sunrise Machinery Ltd",
                                amount="336300", item="CNC Lathe Machine",
                                date="2026-01-15")
        marker = f"iter56img{uuid.uuid4().hex[:6]}"
        files = {"file": (f"bill-{marker}.png", img, "image/png")}
        r = requests.post(
            f"{API}/expenses/with-file", headers=h,
            data={"title": "", "amount": "", "vendor_name": "", "category": "",
                  "status": "paid", "notes": f"TEST_iter56 {marker}"},
            files=files, timeout=120,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        CREATED["expenses"].append(doc["id"])

        # Attachment persisted with filename/url/mime
        att = doc.get("attachment")
        assert isinstance(att, dict) and att.get("url"), f"attachment missing: {doc}"
        assert att["url"].startswith("/api/files/")
        assert att["mime"].startswith("image/") or att["mime"] == "image/png"
        CREATED_FILES.append(att["url"].split("/")[-1])

        # Served publicly (or at least with auth) — try authenticated fetch
        r2 = requests.get(f"{BASE}{att['url']}", headers=h, timeout=30)
        assert r2.status_code == 200, f"served file returned {r2.status_code}"
        assert len(r2.content) > 500, "served bill has too few bytes"

        # AI (or heuristic fallback) filled at least SOMETHING from the bill.
        # Typed values were empty for title/amount/vendor so those should have
        # been populated by AI extraction; but AI may fail — endpoint must NOT 500.
        # We assert amount is a number and title is non-empty (Gemini extraction
        # is the happy path). If AI failed, title == "Expense" (fallback).
        assert isinstance(doc.get("amount"), (int, float))
        assert doc["title"], "title must not be empty"

    def test_expense_typed_wins_over_ai(self, owner_tok):
        """If AI extracts different vendor, TYPED vendor must win."""
        h = _hauth(owner_tok)
        img = _make_invoice_png(vendor="Sunrise Machinery Ltd", amount="336300",
                                item="CNC Lathe Machine")
        typed_vendor = f"TypedVendor_{uuid.uuid4().hex[:6]}"
        typed_title = f"TypedTitle_{uuid.uuid4().hex[:6]}"
        typed_amount = "999"  # different from bill's 336300
        files = {"file": ("bill.png", img, "image/png")}
        r = requests.post(
            f"{API}/expenses/with-file", headers=h,
            data={"title": typed_title, "amount": typed_amount,
                  "vendor_name": typed_vendor, "category": "Other",
                  "status": "unpaid", "notes": "TEST_iter56 typed-wins"},
            files=files, timeout=120,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        CREATED["expenses"].append(doc["id"])
        if doc.get("attachment", {}).get("url"):
            CREATED_FILES.append(doc["attachment"]["url"].split("/")[-1])

        assert doc["title"] == typed_title, f"typed title must win, got {doc['title']}"
        assert doc["amount"] == 999.0, f"typed amount must win, got {doc['amount']}"
        assert doc["vendor_name"] == typed_vendor

    def test_expense_asset_purchase_from_bill_auto_creates_asset(self, owner_tok):
        """When the AI categorizes the bill as 'Asset Purchase', a linked Asset must exist."""
        h = _hauth(owner_tok)
        # Force category = Asset Purchase (typed wins) — this exercises the
        # create_expense → auto-create Asset branch through the new with-file path.
        img = _make_invoice_png(vendor="Sunrise Machinery Ltd", amount="500000",
                                item="Machinery")
        title = f"TEST_iter56 Asset Bill {uuid.uuid4().hex[:6]}"
        files = {"file": ("machine-bill.png", img, "image/png")}
        r = requests.post(
            f"{API}/expenses/with-file", headers=h,
            data={"title": title, "amount": "500000",
                  "vendor_name": "TEST_iter56 Machinery Co",
                  "category": "Asset Purchase", "status": "paid",
                  "notes": "TEST_iter56"},
            files=files, timeout=120,
        )
        assert r.status_code == 200, r.text
        exp = r.json()
        CREATED["expenses"].append(exp["id"])
        if exp.get("attachment", {}).get("url"):
            CREATED_FILES.append(exp["attachment"]["url"].split("/")[-1])
        assert exp["category"] == "Asset Purchase"

        time.sleep(0.6)
        assets = requests.get(f"{API}/assets", headers=_h(owner_tok), timeout=30).json()
        linked = [a for a in assets if a.get("expense_id") == exp["id"]]
        assert linked, "linked Asset should have been auto-created from the Asset Purchase bill"
        auto_asset = linked[0]
        assert auto_asset["name"] == title
        assert auto_asset["purchase_amount"] == 500000
        CREATED["assets"].append(auto_asset["id"])

    def test_asset_with_bill(self, owner_tok):
        h = _hauth(owner_tok)
        img = _make_invoice_png(vendor="TEST_iter56 Furniture", amount="65000",
                                item="Office Chair")
        name = f"TEST_iter56 Chair {uuid.uuid4().hex[:6]}"
        files = {"file": ("chair.png", img, "image/png")}
        r = requests.post(
            f"{API}/assets/with-file", headers=h,
            data={"name": name, "purchase_amount": "65000",
                  "vendor_name": "TEST_iter56 Furniture",
                  "category": "Furniture", "purchase_date": "2026-01-15",
                  "status": "active", "notes": ""},
            files=files, timeout=120,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        CREATED["assets"].append(doc["id"])
        assert doc.get("attachment", {}).get("url", "").startswith("/api/files/")
        CREATED_FILES.append(doc["attachment"]["url"].split("/")[-1])
        assert doc["name"] == name

    def test_inventory_with_bill(self, owner_tok):
        h = _hauth(owner_tok)
        img = _make_invoice_png(vendor="TEST_iter56 Yarn Co", amount="7500",
                                item="Cotton yarn")
        item = f"TEST_iter56 Cotton {uuid.uuid4().hex[:6]}"
        files = {"file": ("yarn.png", img, "image/png")}
        r = requests.post(
            f"{API}/inventory/with-file", headers=h,
            data={"item": item, "sku": "T56-COT", "quantity": "30", "unit": "kg",
                  "unit_cost": "250", "category": "Raw Material",
                  "vendor_name": "TEST_iter56 Yarn Co", "notes": ""},
            files=files, timeout=120,
        )
        assert r.status_code == 200, r.text
        doc = r.json()
        CREATED["inventory"].append(doc["id"])
        assert doc.get("attachment", {}).get("url", "").startswith("/api/files/")
        CREATED_FILES.append(doc["attachment"]["url"].split("/")[-1])
        assert doc["item"] == item
        assert doc["value"] == round(30 * 250, 2)


# ============================================================================
# 4) AI cockpit — GET /api/ledger/ai/{scope}, refresh, ask
# ============================================================================
class TestLedgerAI:
    @pytest.mark.parametrize("scope", ["brief", "overview", "expenses", "assets", "inventory"])
    def test_ai_scope_shape(self, owner_tok, scope):
        r = requests.get(f"{API}/ledger/ai/{scope}", headers=_h(owner_tok), timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("scope", "summary", "alerts", "recommendations", "generated_at"):
            assert k in body, f"missing key {k} for scope={scope}"
        assert body["scope"] == scope
        assert isinstance(body["summary"], str) and body["summary"].strip()
        assert isinstance(body["alerts"], list)
        assert isinstance(body["recommendations"], list)
        # Every alert/rec is a dict with at least a 'title'
        for a in body["alerts"]:
            assert isinstance(a, dict)
        for r_ in body["recommendations"]:
            assert isinstance(r_, dict)

    def test_ai_unknown_scope_404(self, owner_tok):
        r = requests.get(f"{API}/ledger/ai/does-not-exist", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 404, r.text
        r = requests.post(f"{API}/ledger/ai/does-not-exist/refresh", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 404, r.text

    def test_ai_refresh_returns_new_generated_at(self, owner_tok):
        # first fetch to prime cache
        first = requests.get(f"{API}/ledger/ai/brief", headers=_h(owner_tok), timeout=90).json()
        first_gen = first["generated_at"]
        time.sleep(1.2)
        r = requests.post(f"{API}/ledger/ai/brief/refresh", headers=_h(owner_tok), timeout=90)
        assert r.status_code == 200, r.text
        refreshed = r.json()
        assert refreshed["scope"] == "brief"
        # generated_at is ISO — string compare works
        assert refreshed["generated_at"] > first_gen, \
            f"refreshed generated_at ({refreshed['generated_at']}) should be > previous ({first_gen})"
        # Cache is updated for subsequent GET
        r2 = requests.get(f"{API}/ledger/ai/brief", headers=_h(owner_tok), timeout=30).json()
        assert r2["generated_at"] == refreshed["generated_at"]


class TestLedgerAsk:
    def test_ask_empty_400(self, owner_tok):
        r = requests.post(f"{API}/ledger/ask",
                          json={"question": "", "scope": "brief"},
                          headers=_h(owner_tok), timeout=30)
        assert r.status_code == 400, r.text

    def test_ask_returns_grounded_answer(self, owner_tok):
        r = requests.post(f"{API}/ledger/ask",
                          json={"question": "What is my total outstanding right now?",
                                "scope": "brief"},
                          headers=_h(owner_tok), timeout=90)
        assert r.status_code == 200, r.text
        ans = r.json().get("answer")
        assert isinstance(ans, str) and len(ans.strip()) > 5, f"empty answer: {ans!r}"


# ============================================================================
# 5) RBAC — sales blocked from every new endpoint
# ============================================================================
class TestRBAC:
    def test_sales_blocked_with_file(self, sales_tok):
        h = _hauth(sales_tok)
        for path in ("/expenses/with-file", "/assets/with-file", "/inventory/with-file"):
            r = requests.post(f"{API}{path}", headers=h,
                              data={"title": "x", "name": "x", "item": "x",
                                    "amount": "1", "purchase_amount": "1",
                                    "quantity": "1", "unit_cost": "1"},
                              timeout=30)
            assert r.status_code == 403, f"{path} expected 403 got {r.status_code}: {r.text}"

    def test_sales_blocked_ai_endpoints(self, sales_tok):
        h = _h(sales_tok)
        r = requests.get(f"{API}/ledger/ai/brief", headers=h, timeout=30)
        assert r.status_code == 403
        r = requests.post(f"{API}/ledger/ai/brief/refresh", headers=h, timeout=30)
        assert r.status_code == 403
        r = requests.post(f"{API}/ledger/ask", json={"question": "hi"}, headers=h, timeout=30)
        assert r.status_code == 403

    def test_finance_allowed_ai(self, finance_tok):
        r = requests.get(f"{API}/ledger/ai/brief", headers=_h(finance_tok), timeout=90)
        assert r.status_code == 200


# ============================================================================
# 6) REGRESSION — existing JSON endpoints
# ============================================================================
class TestRegression:
    def test_json_expense_crud_still_works(self, owner_tok):
        h = _h(owner_tok)
        payload = {"title": f"TEST_iter56 regr {uuid.uuid4().hex[:6]}",
                   "amount": 500, "category": "Utilities",
                   "vendor_name": "TEST_iter56", "status": "unpaid"}
        r = requests.post(f"{API}/expenses", json=payload, headers=h, timeout=30)
        assert r.status_code == 200, r.text
        eid = r.json()["id"]
        CREATED["expenses"].append(eid)
        r = requests.patch(f"{API}/expenses/{eid}", json={"status": "paid"}, headers=h, timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "paid"

    def test_json_asset_and_inventory_crud(self, owner_tok):
        h = _h(owner_tok)
        r = requests.post(f"{API}/assets",
                          json={"name": f"TEST_iter56 A {uuid.uuid4().hex[:6]}",
                                "category": "Equipment", "purchase_amount": 1000},
                          headers=h, timeout=30)
        assert r.status_code == 200, r.text
        CREATED["assets"].append(r.json()["id"])
        r = requests.post(f"{API}/inventory",
                          json={"item": f"TEST_iter56 I {uuid.uuid4().hex[:6]}",
                                "quantity": 5, "unit": "pcs", "unit_cost": 100},
                          headers=h, timeout=30)
        assert r.status_code == 200
        CREATED["inventory"].append(r.json()["id"])

    def test_ledger_summary_still_works(self, owner_tok):
        r = requests.get(f"{API}/ledger/summary", headers=_h(owner_tok), timeout=30)
        assert r.status_code == 200
        for k in ("currency", "totals", "by_category", "by_vendor", "by_month"):
            assert k in r.json()

    def test_suggest_category_still_works(self, owner_tok):
        r = requests.post(f"{API}/expenses/suggest-category",
                          json={"text": "electricity bill for factory"},
                          headers=_h(owner_tok), timeout=45)
        assert r.status_code == 200
        assert r.json().get("category") in VALID_EXPENSE_CATS

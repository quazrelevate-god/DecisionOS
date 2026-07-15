"""
Iteration 46 — WhatsApp Smart Capture (AI triage → draft → review → execute)
Backend API tests. Uses localhost:8001 for webhook POSTs (external URL is fronted by
Cloudflare which returns 403 for non-browser UAs). App-facing endpoints (login,
/api/captures*) work fine on either.
"""
import os
import re
import time
import json
import pytest
import requests

# External URL for regular API testing; localhost only for the webhook.
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
LOCAL_URL = "http://localhost:8001"

OWNER_EMAIL = "owner@sharma.com"
OWNER_PASSWORD = "demo1234"
SALES_EMAIL = "sales@sharma.com"
SALES_PASSWORD = "demo1234"
FINANCE_EMAIL = "finance@sharma.com"
FINANCE_PASSWORD = "demo1234"

AI_WAIT = 10   # seconds allowed for the LLM triage + persist_capture_draft


# ---------- fixtures ----------
def _login(email, password):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    tok = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER_EMAIL, OWNER_PASSWORD)


@pytest.fixture(scope="module")
def sales():
    return _login(SALES_EMAIL, SALES_PASSWORD)


@pytest.fixture(scope="module")
def finance():
    return _login(FINANCE_EMAIL, FINANCE_PASSWORD)


# ---------- helpers ----------
def send_wa_text(from_phone: str, text: str):
    """POST a synthetic Meta webhook payload for a text message."""
    body = {"entry": [{"changes": [{"value": {"messages": [
        {"from": from_phone, "type": "text", "text": {"body": text}}
    ]}}]}]}
    r = requests.post(f"{LOCAL_URL}/api/webhooks/whatsapp",
                      json=body,
                      headers={"X-Hub-Signature-256": "sha256=x"},
                      timeout=30)
    return r


def wait_for_capture(session, contains_text: str, max_wait=25):
    """Poll GET /api/captures until a draft whose text contains `contains_text` shows up."""
    key = contains_text.lower()[:30]
    deadline = time.time() + max_wait
    while time.time() < deadline:
        r = session.get(f"{BASE_URL}/api/captures?status=pending_review", timeout=15)
        assert r.status_code == 200, f"list captures failed: {r.status_code} {r.text[:200]}"
        for row in r.json():
            hay = ((row.get("text") or "") + " " + (row.get("summary") or "")).lower()
            if key in hay:
                return row
        time.sleep(2)
    return None


# ---------- Section 1: WhatsApp status + logs (owner-only) ----------
class TestWhatsAppStatus:
    def test_status_configured(self, owner):
        r = owner.get(f"{BASE_URL}/api/whatsapp/status", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # required booleans + display_number
        for k in ("configured", "has_token", "has_phone_id", "has_verify_token",
                  "has_app_secret", "has_fallback_tenant"):
            assert k in data, f"missing key {k}"
        assert data["has_token"] is True
        assert data["has_phone_id"] is True
        # display_number is best-effort (depends on Graph API); the field must exist
        assert "display_number" in data

    def test_logs_owner_only(self, owner, sales):
        r_ok = owner.get(f"{BASE_URL}/api/whatsapp/logs", timeout=15)
        assert r_ok.status_code == 200
        assert isinstance(r_ok.json(), list)
        r_no = sales.get(f"{BASE_URL}/api/whatsapp/logs", timeout=15)
        assert r_no.status_code == 403


# ---------- Section 2: inbound webhook creates draft (not auto-execute) ----------
class TestWebhookCreatesDrafts:
    def test_sales_followup_creates_draft(self, owner):
        text = "TEST_CAP_SALES please follow up with Kapoor Retail on the pending Delhi festive order and share updated timelines"
        r = send_wa_text("919812345670", text)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"
        d = wait_for_capture(owner, "TEST_CAP_SALES", max_wait=AI_WAIT * 2)
        assert d is not None, "sales follow-up draft not created within timeout"
        # AI classification asserts
        assert d["status"] == "pending_review"
        assert d["classification"] in ("sales", "operational_task", "other")
        assert d["reviewer_role"] in ("sales", "owner", "operations", "finance", "purchase", "hr", "production")
        assert d.get("summary")
        assert d.get("priority") in ("low", "medium", "high")
        # Sales instruction should NOT be owner-escalated
        assert d.get("needs_owner") in (False, None), f"unexpected needs_owner=True: {d}"

    def test_invoice_instruction_creates_finance_draft(self, owner):
        text = "TEST_CAP_INVOICE we received an invoice from Gujarat Cotton Mills for 32000, please book it and pay by end of week"
        r = send_wa_text("919812345671", text)
        assert r.status_code == 200
        d = wait_for_capture(owner, "TEST_CAP_INVOICE", max_wait=AI_WAIT * 2)
        assert d is not None
        assert d["classification"] in ("invoice", "purchase", "payment", "operational_task")
        # Invoice/purchase/payment items must route to finance (per CAPTURE_ROUTING)
        # or fall back to owner. 32000 < 50000 so no owner-escalation
        assert d["reviewer_role"] in ("finance", "purchase", "owner"), d["reviewer_role"]
        assert d.get("needs_owner") in (False, None)

    def test_high_value_approval_escalates_to_owner(self, owner):
        text = "TEST_CAP_HIGHVAL Approve purchase of 200 cotton bales from Gujarat Cotton Mills for 85000"
        r = send_wa_text("919812345672", text)
        assert r.status_code == 200
        d = wait_for_capture(owner, "TEST_CAP_HIGHVAL", max_wait=AI_WAIT * 2)
        assert d is not None
        # Either amount>=50000 OR classification approval -> needs_owner + reviewer=owner
        assert d.get("needs_owner") is True, f"expected owner-escalation, got {d}"
        assert d["reviewer_role"] == "owner"
        assert d.get("escalate_reason")  # non-empty string

    def test_meeting_creates_owner_draft(self, owner):
        text = "TEST_CAP_MEETING please arrange a sales review meeting with the team next Friday at 4pm"
        r = send_wa_text("919812345673", text)
        assert r.status_code == 200
        d = wait_for_capture(owner, "TEST_CAP_MEETING", max_wait=AI_WAIT * 2)
        assert d is not None
        # meeting routing -> owner (per CAPTURE_ROUTING)
        assert d["reviewer_role"] == "owner", f"meeting should route to owner, got {d['reviewer_role']}"


# ---------- Section 3: list + filters + pending-count ----------
class TestListAndCount:
    def test_owner_sees_all_pending(self, owner):
        r = owner.get(f"{BASE_URL}/api/captures?status=pending_review", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        # At least the drafts we created above (some may already be executed by later tests)
        # so this list is >= 0. Just verify shape when non-empty.
        if rows:
            row = rows[0]
            for f in ("id", "classification", "reviewer_role", "priority",
                      "summary", "needs_owner", "status", "created_at"):
                assert f in row, f"missing field {f} in capture row"
            # Mongo _id must be excluded
            assert "_id" not in row

    def test_non_owner_sees_only_their_role_queue(self, owner, sales):
        # ensure at least one 'owner'-reviewer draft exists (meeting from previous test)
        r_all = owner.get(f"{BASE_URL}/api/captures?status=pending_review", timeout=15).json()
        r_sales = sales.get(f"{BASE_URL}/api/captures?status=pending_review", timeout=15)
        assert r_sales.status_code == 200
        for row in r_sales.json():
            assert row["reviewer_role"] == "sales", f"sales user sees non-sales draft: {row}"

    def test_pending_count(self, owner):
        r = owner.get(f"{BASE_URL}/api/captures/pending-count", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "count" in data
        assert isinstance(data["count"], int)
        assert data["count"] >= 0


# ---------- Section 4: edit / reassign / clarify / reject / approve ----------
@pytest.fixture(scope="module")
def sales_draft(owner):
    """A pending sales draft for edit/reassign/reject/clarify tests."""
    text = f"TEST_CAP_ACTIONS_{int(time.time())} share latest catalog with Threads Boutique tomorrow"
    r = send_wa_text("919812349999", text)
    assert r.status_code == 200
    d = wait_for_capture(owner, text.split(" ")[0], max_wait=AI_WAIT * 2)
    assert d is not None
    return d


class TestDraftActions:
    def test_edit_capture(self, owner, sales_draft):
        cid = sales_draft["id"]
        r = owner.patch(f"{BASE_URL}/api/captures/{cid}",
                        json={"priority": "high", "summary": "TEST_EDITED_SUMMARY"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["priority"] == "high"
        assert data["summary"] == "TEST_EDITED_SUMMARY"
        # GET back to confirm persistence
        rows = owner.get(f"{BASE_URL}/api/captures?status=pending_review", timeout=15).json()
        found = next((x for x in rows if x["id"] == cid), None)
        assert found and found["priority"] == "high" and found["summary"] == "TEST_EDITED_SUMMARY"

    def test_reassign_capture(self, owner, sales_draft):
        cid = sales_draft["id"]
        r = owner.post(f"{BASE_URL}/api/captures/{cid}/reassign",
                       json={"reviewer_role": "finance"}, timeout=15)
        assert r.status_code == 200
        assert r.json().get("ok") is True
        rows = owner.get(f"{BASE_URL}/api/captures?status=pending_review", timeout=15).json()
        found = next((x for x in rows if x["id"] == cid), None)
        assert found and found["reviewer_role"] == "finance"

    def test_clarify_moves_to_clarification(self, owner, sales_draft):
        cid = sales_draft["id"]
        r = owner.post(f"{BASE_URL}/api/captures/{cid}/clarify",
                       json={"note": "TEST_which_boutique?"}, timeout=15)
        assert r.status_code == 200
        rows = owner.get(f"{BASE_URL}/api/captures?status=clarification_requested", timeout=15).json()
        found = next((x for x in rows if x["id"] == cid), None)
        assert found, "draft not found in clarification_requested list"
        assert found["status"] == "clarification_requested"
        assert found["clarification_note"] == "TEST_which_boutique?"

    def test_reject_moves_to_rejected(self, owner):
        # Create a fresh draft to reject
        text = f"TEST_CAP_REJECT_{int(time.time())} spam-like message ignore this"
        send_wa_text("919812340001", text)
        d = wait_for_capture(owner, text.split(" ")[0], max_wait=AI_WAIT * 2)
        assert d, "reject-test draft not created"
        r = owner.post(f"{BASE_URL}/api/captures/{d['id']}/reject",
                       json={"reason": "TEST_reject_reason_spam"}, timeout=15)
        assert r.status_code == 200
        rows = owner.get(f"{BASE_URL}/api/captures?status=rejected", timeout=15).json()
        found = next((x for x in rows if x["id"] == d["id"]), None)
        assert found and found["status"] == "rejected"
        assert found.get("clarification_note") == "TEST_reject_reason_spam"

    def test_approve_creates_decision_and_marks_executed(self, owner):
        # Fresh, non-escalated sales instruction we can approve
        text = f"TEST_CAP_APPROVE_{int(time.time())} tell the sales team to send a thank-you note to Threads Boutique"
        send_wa_text("919812340002", text)
        d = wait_for_capture(owner, text.split(" ")[0], max_wait=AI_WAIT * 2)
        assert d, "approve-test draft not created"
        assert d.get("needs_owner") in (False, None)
        r = owner.post(f"{BASE_URL}/api/captures/{d['id']}/approve", timeout=90)
        assert r.status_code == 200, f"approve failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        assert body.get("ok") is True
        # result_ref should be returned with a type
        result = body.get("result") or {}
        assert result.get("type") in ("decision", "ingestion"), result
        # For a text draft we expect a decision
        assert result["type"] == "decision"
        assert result.get("id"), "no decision id returned"
        # Draft moves to executed
        rows = owner.get(f"{BASE_URL}/api/captures?status=executed", timeout=15).json()
        found = next((x for x in rows if x["id"] == d["id"]), None)
        assert found and found["status"] == "executed"
        assert found.get("result_ref", {}).get("type") == "decision"

    def test_owner_escalated_draft_403_for_non_owner(self, owner, finance):
        """Non-owner approving a needs_owner=True draft must get 403."""
        text = f"TEST_CAP_OWNER_ONLY_{int(time.time())} approve equipment purchase for 92000 from PackWell"
        send_wa_text("919812340003", text)
        d = wait_for_capture(owner, text.split(" ")[0], max_wait=AI_WAIT * 2)
        assert d and d.get("needs_owner") is True, f"expected escalated draft, got {d}"
        # Reassign it to finance so finance user can see + attempt to approve
        r = owner.post(f"{BASE_URL}/api/captures/{d['id']}/reassign",
                       json={"reviewer_role": "finance"}, timeout=15)
        assert r.status_code == 200
        # Finance tries to approve -> 403
        r_no = finance.post(f"{BASE_URL}/api/captures/{d['id']}/approve", timeout=30)
        assert r_no.status_code == 403, f"expected 403 for non-owner approving escalated draft, got {r_no.status_code} {r_no.text[:200]}"

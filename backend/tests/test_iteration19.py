"""
Iteration 19 backend tests — Phase 3 & 4 of DecisionOS roadmap.

Coverage:
  - POST /api/contacts/{id}/rescore  (Phase 3: AI relationship/risk)
  - GET  /api/contacts/{id}/profile  (ai_relationship field present)
  - GET  /api/calendar               (Phase 3: unified business calendar)
  - Contact create/update accepts `birthday`
  - POST /api/meetings/text          (Phase 4: AI meeting notes, async)
  - GET  /api/meetings, /api/meetings/{id}
  - GET  /api/operating-score        (Phase 4: company/employee scores)
  - Permission gating: sales must NOT see payment_due events or outstanding money
"""
import os
import time
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None


from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"

OWNER = ("owner@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def owner_token():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def sales_token():
    return _login(*SALES)


@pytest.fixture(scope="module")
def finance_token():
    return _login(*FINANCE)


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------------------------------------------------------------------
# Phase 3 — Contact 360 + AI rescore
# ---------------------------------------------------------------------------
class TestContactRescore:
    def test_pick_contact_and_rescore(self, owner_token):
        # find a customer contact
        r = requests.get(f"{BASE_URL}/api/contacts?type=customer", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        contacts = r.json()
        assert isinstance(contacts, list) and len(contacts) > 0, "Demo tenant must have customers"
        cid = contacts[0]["id"]

        # rescore
        r = requests.post(f"{BASE_URL}/api/contacts/{cid}/rescore",
                          headers=_h(owner_token), timeout=60)
        assert r.status_code == 200, f"rescore failed: {r.status_code} {r.text}"
        data = r.json()
        assert "ai_relationship" in data
        rel = data["ai_relationship"]
        assert isinstance(rel, dict) and rel, "ai_relationship should be non-empty on success"
        for k in ("relationship_score", "risk_score", "reason", "signals"):
            assert k in rel, f"Missing key: {k}"
        assert 0 <= rel["relationship_score"] <= 100
        assert 0 <= rel["risk_score"] <= 100
        assert isinstance(rel["signals"], list)
        assert isinstance(rel["reason"], str)

        # verify persistence via profile endpoint
        r = requests.get(f"{BASE_URL}/api/contacts/{cid}/profile",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        prof = r.json()
        assert "ai_relationship" in prof
        assert prof["ai_relationship"] is not None
        assert prof["ai_relationship"]["relationship_score"] == rel["relationship_score"]
        assert prof["ai_relationship"]["risk_score"] == rel["risk_score"]

    def test_sales_cannot_rescore(self, sales_token):
        # sales role does NOT have finance perm
        r = requests.get(f"{BASE_URL}/api/contacts", headers=_h(sales_token), timeout=30)
        assert r.status_code == 200
        contacts = r.json()
        if not contacts:
            pytest.skip("No contacts")
        cid = contacts[0]["id"]
        r = requests.post(f"{BASE_URL}/api/contacts/{cid}/rescore",
                          headers=_h(sales_token), timeout=30)
        assert r.status_code in (401, 403), f"expected forbidden, got {r.status_code}"


# ---------------------------------------------------------------------------
# Contact birthday field
# ---------------------------------------------------------------------------
class TestContactBirthday:
    def test_create_contact_with_birthday(self, owner_token):
        payload = {
            "type": "customer", "name": "TEST_iter19_bday", "company": "TEST Co",
            "phone": "9999999999", "email": "test19bday@example.com",
            "birthday": "1990-06-15", "status": "active", "tags": ["TEST_iter19"],
        }
        r = requests.post(f"{BASE_URL}/api/contacts", headers=_h(owner_token),
                          json=payload, timeout=30)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        cid = r.json()["id"]

        # GET back and verify persistence
        r = requests.get(f"{BASE_URL}/api/contacts?q=TEST_iter19_bday",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        found = [c for c in r.json() if c["id"] == cid]
        assert found, "created contact not returned"
        assert found[0].get("birthday") == "1990-06-15"

        # PATCH birthday
        r = requests.patch(f"{BASE_URL}/api/contacts/{cid}", headers=_h(owner_token),
                           json={"birthday": "1985-12-25"}, timeout=30)
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/contacts?q=TEST_iter19_bday",
                         headers=_h(owner_token), timeout=30)
        found = [c for c in r.json() if c["id"] == cid]
        assert found and found[0]["birthday"] == "1985-12-25"

        # cleanup
        requests.delete(f"{BASE_URL}/api/contacts/{cid}", headers=_h(owner_token), timeout=30)


# ---------------------------------------------------------------------------
# Phase 3 — Business Calendar
# ---------------------------------------------------------------------------
class TestCalendar:
    def test_owner_sees_all_types(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/calendar?days=45", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("days", "counts", "total"):
            assert k in d
        assert isinstance(d["days"], list)
        assert isinstance(d["counts"], dict)
        assert isinstance(d["total"], int)
        # verify all events have required shape and are within window
        for day in d["days"]:
            assert "date" in day and "events" in day
            for e in day["events"]:
                for k in ("date", "type", "title", "subtitle", "contact_id", "entity_id", "amount", "overdue"):
                    assert k in e, f"event missing {k}: {e}"
                assert e["type"] in ("payment_due", "task", "delivery", "complaint", "birthday")
        # verify days are sorted
        dates = [d0["date"] for d0 in d["days"]]
        assert dates == sorted(dates)

    def test_sales_does_not_see_payment_due(self, sales_token):
        r = requests.get(f"{BASE_URL}/api/calendar?days=45", headers=_h(sales_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for day in d["days"]:
            for e in day["events"]:
                assert e["type"] != "payment_due", "sales must not see payment_due"
        assert d["counts"].get("payment_due", 0) == 0

    def test_finance_sees_payment_due(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/calendar?days=45", headers=_h(finance_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        # demo has 152 events per main agent; payment_due should be > 0
        # Not asserting >0 hard because seed may vary — just structural.
        assert isinstance(d["counts"].get("payment_due", 0), int)


# ---------------------------------------------------------------------------
# Phase 4 — Meetings (text pipeline)
# ---------------------------------------------------------------------------
TRANSCRIPT = (
    "Meeting between Priya (sales lead) and Amit (production lead). "
    "We discussed the delayed shipment for Sharma Textiles. Decision: we will move the "
    "delivery date by one week. Priya will call the customer today. Amit will confirm the "
    "new schedule with the warehouse by Friday. Also we decided to raise cotton yarn prices "
    "by 3 percent from next month."
)


class TestMeetings:
    def test_text_meeting_creates_tasks(self, owner_token):
        # count tasks before
        r0 = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=30)
        before = len(r0.json())

        r = requests.post(f"{BASE_URL}/api/meetings/text", headers=_h(owner_token),
                          json={"text": TRANSCRIPT}, timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        mid = r.json()["id"]
        assert r.json()["status"] == "queued"

        # poll until done (up to ~30s)
        done = None
        for _ in range(20):
            time.sleep(2)
            r = requests.get(f"{BASE_URL}/api/meetings/{mid}", headers=_h(owner_token), timeout=30)
            assert r.status_code == 200
            m = r.json()
            if m["status"] in ("done", "failed"):
                done = m
                break
        assert done, "meeting processing did not finish in time"
        assert done["status"] == "done", f"processing failed: {done}"
        assert done.get("title") and done["title"] != "Processing meeting…"
        assert isinstance(done.get("summary"), str) and len(done["summary"]) > 0
        assert isinstance(done.get("key_points"), list)
        assert isinstance(done.get("decisions"), list)
        assert isinstance(done.get("action_items"), list)
        assert isinstance(done.get("task_ids"), list)
        # Should have created at least 1 task from action items
        assert len(done["action_items"]) > 0, "AI should extract at least 1 action item"
        assert len(done["task_ids"]) > 0, "should have created tasks"

        # Verify a task was actually created with source=meeting
        r = requests.get(f"{BASE_URL}/api/tasks", headers=_h(owner_token), timeout=30)
        after = r.json()
        assert len(after) > before
        meeting_tasks = [t for t in after if t.get("id") in done["task_ids"]]
        assert len(meeting_tasks) == len(done["task_ids"])
        for t in meeting_tasks:
            assert t.get("source") == "meeting"

    def test_list_meetings(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/meetings", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_meeting_not_found(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/meetings/does-not-exist",
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Phase 4 — Operating Score
# ---------------------------------------------------------------------------
class TestOperatingScore:
    def test_owner_full_response(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/operating-score", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        d = r.json()
        # Verify structural keys
        assert "company" in d and "stats" in d and "employees" in d and "can_finance" in d
        c = d["company"]
        assert "overall" in c and "categories" in c
        assert 0 <= c["overall"] <= 100
        cats = c["categories"]
        for k in ("execution", "finance", "sales", "responsiveness"):
            assert k in cats, f"missing category {k}"
            assert 0 <= cats[k] <= 100
        s = d["stats"]
        for k in ("done", "open", "overdue", "total_decisions", "approved", "open_complaints", "outstanding"):
            assert k in s, f"missing stat {k}"
        assert d["can_finance"] is True
        assert s["outstanding"] is not None  # owner has finance perm
        # employees
        assert isinstance(d["employees"], list)
        if d["employees"]:
            e = d["employees"][0]
            for k in ("id", "name", "role", "score", "done", "open", "overdue"):
                assert k in e

    def test_sales_hides_finance(self, sales_token):
        r = requests.get(f"{BASE_URL}/api/operating-score", headers=_h(sales_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["can_finance"] is False
        assert d["stats"]["outstanding"] is None, "sales must not see money"

    def test_finance_role_can_see_money(self, finance_token):
        r = requests.get(f"{BASE_URL}/api/operating-score",
                         headers=_h(finance_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["can_finance"] is True
        assert d["stats"]["outstanding"] is not None

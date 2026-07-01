"""DecisionOS backend integration tests.

Covers: auth, dashboard, voice-notes text ingestion + AI extraction, decision approval,
tasks CRUD, workflows (with owner gate on purchase_payment approved), Company Brain search,
Ask AI, email digest (mocked), team users.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://founder-os-58.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")
PRODUCTION = ("production@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and "user" in data
    return data


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# -------- fixtures --------
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


# -------- Auth --------
class TestAuth:
    def test_login_owner_returns_token_user(self):
        d = _login(*OWNER)
        assert d["user"]["email"] == OWNER[0]
        assert d["user"]["role"] == "owner"
        assert isinstance(d["token"], str) and len(d["token"]) > 20
        assert d["tenant"]["name"] == "Sharma Textiles Pvt Ltd"

    def test_login_invalid(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER[0], "password": "wrong"}, timeout=10)
        assert r.status_code == 401

    def test_me_with_token(self, owner_auth):
        r = requests.get(f"{API}/auth/me", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["email"] == OWNER[0]
        assert data["tenant"]["id"] == owner_auth["user"]["tenant_id"]

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me", timeout=10)
        assert r.status_code == 401

    def test_register_new_company(self):
        email = f"test_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={
            "company_name": f"TEST_Co_{uuid.uuid4().hex[:6]}",
            "name": "TEST_Owner",
            "email": email,
            "password": "testpass123",
        }, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["role"] == "owner"
        assert data["user"]["email"] == email
        # Verify me works with new token
        me = requests.get(f"{API}/auth/me", headers=_hdr(data["token"]), timeout=10)
        assert me.status_code == 200
        assert me.json()["tenant"]["id"] == data["tenant"]["id"]


# -------- Dashboard --------
class TestDashboard:
    def test_dashboard_shape(self, owner_auth):
        r = requests.get(f"{API}/dashboard", headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200
        data = r.json()
        for k in ("stats", "pending_decisions", "pending_purchases", "overdue_tasks", "activity"):
            assert k in data, f"missing {k}"
        stats = data["stats"]
        for sk in ("open_tasks", "done_tasks", "active_workflows", "pending_approvals"):
            assert sk in stats
        # Seeded: pending purchase PO #221 should always be there
        assert any(p["type"] == "purchase_payment" for p in data["pending_purchases"])
        assert isinstance(data["pending_decisions"], list)
        assert isinstance(stats["pending_approvals"], int)

    def test_dashboard_tenant_isolation(self):
        # register a fresh tenant and verify dashboard is empty
        email = f"iso_{uuid.uuid4().hex[:8]}@example.com"
        reg = requests.post(f"{API}/auth/register", json={
            "company_name": "TEST_Isolation",
            "name": "TEST_iso",
            "email": email,
            "password": "testpass123",
        }, timeout=10).json()
        r = requests.get(f"{API}/dashboard", headers=_hdr(reg["token"]), timeout=10)
        assert r.status_code == 200
        d = r.json()
        assert d["pending_decisions"] == []
        assert d["pending_purchases"] == []


# -------- Voice-note text ingestion + AI extraction --------
class TestVoiceNoteAI:
    def test_text_directive_flow(self, owner_auth):
        payload = {"text": "Prepare a quote for a Bangalore retailer for 200 units of cotton kurtas. Priya should follow up in 2 days and production must confirm feasibility."}
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text
        nid = r.json()["id"]

        # Poll until done or failed; allow retry on transient budget error
        deadline = time.time() + 40
        final = None
        while time.time() < deadline:
            gr = requests.get(f"{API}/voice-notes/{nid}", headers=_hdr(owner_auth["token"]), timeout=10)
            assert gr.status_code == 200
            n = gr.json()
            if n["status"] in ("done", "failed"):
                final = n
                break
            time.sleep(2)

        assert final is not None, "voice-note processing timed out"
        if final["status"] == "failed" and "Budget" in (final.get("error") or ""):
            # retry once per instructions
            r2 = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_auth["token"]), timeout=15)
            nid = r2.json()["id"]
            deadline = time.time() + 40
            while time.time() < deadline:
                gr = requests.get(f"{API}/voice-notes/{nid}", headers=_hdr(owner_auth["token"]), timeout=10)
                n = gr.json()
                if n["status"] in ("done", "failed"):
                    final = n
                    break
                time.sleep(2)

        assert final["status"] == "done", f"expected done, got {final.get('status')} err={final.get('error')}"
        assert "decision_id" in final

        # Verify decision is pending_approval and tasks are blocked
        d = requests.get(f"{API}/decisions/{final['decision_id']}", headers=_hdr(owner_auth["token"]), timeout=10).json()
        assert d["status"] == "pending_approval"
        # tasks may be zero if AI produced none, but usually >=1
        for t in d.get("tasks", []):
            assert t["status"] == "blocked"

        # store for downstream approval tests
        pytest.decision_id_from_ai = final["decision_id"]


# -------- Decision approval --------
class TestDecisionApproval:
    def test_reject_by_sales_forbidden(self, sales_auth, owner_auth):
        # Fetch a pending decision (seeded d2)
        dashboard = requests.get(f"{API}/dashboard", headers=_hdr(owner_auth["token"]), timeout=10).json()
        assert dashboard["pending_decisions"], "no pending decision to test"
        did = dashboard["pending_decisions"][0]["id"]
        r = requests.post(f"{API}/decisions/{did}/approve", headers=_hdr(sales_auth["token"]), timeout=10)
        assert r.status_code == 403

    def test_approve_by_owner_unblocks_tasks(self, owner_auth):
        # Use AI-generated decision if available, else seeded pending one
        did = getattr(pytest, "decision_id_from_ai", None)
        if not did:
            dash = requests.get(f"{API}/dashboard", headers=_hdr(owner_auth["token"]), timeout=10).json()
            did = dash["pending_decisions"][0]["id"]
        r = requests.post(f"{API}/decisions/{did}/approve", headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "approved"
        # Verify tasks unblocked
        for t in d.get("tasks", []):
            assert t["status"] in ("todo", "in_progress", "done"), f"task {t['id']} not unblocked: {t['status']}"

    def test_reject_flow(self, owner_auth):
        # Create a new text note -> new decision, then reject
        r = requests.post(f"{API}/voice-notes/text", json={"text": "TEST_REJECT: consider changing our packaging vendor next quarter."}, headers=_hdr(owner_auth["token"]), timeout=15)
        nid = r.json()["id"]
        deadline = time.time() + 40
        note = None
        while time.time() < deadline:
            note = requests.get(f"{API}/voice-notes/{nid}", headers=_hdr(owner_auth["token"]), timeout=10).json()
            if note["status"] in ("done", "failed"):
                break
            time.sleep(2)
        if note["status"] != "done":
            pytest.skip(f"AI extraction not done: {note.get('status')} {note.get('error')}")
        did = note["decision_id"]
        rj = requests.post(f"{API}/decisions/{did}/reject", headers=_hdr(owner_auth["token"]), timeout=10)
        assert rj.status_code == 200
        assert rj.json()["status"] == "rejected"
        for t in rj.json().get("tasks", []):
            assert t["status"] == "cancelled"


# -------- Tasks --------
class TestTasks:
    def test_list_tasks(self, owner_auth):
        r = requests.get(f"{API}/tasks", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_mine_filter_sales(self, sales_auth):
        r = requests.get(f"{API}/tasks?mine=true", headers=_hdr(sales_auth["token"]), timeout=10)
        assert r.status_code == 200
        tasks = r.json()
        # seeded sales task should show up
        assert any(t.get("assignee_role") == "sales" or t.get("assignee_id") == sales_auth["user"]["id"] for t in tasks)

    def test_create_and_progress_task(self, owner_auth):
        r = requests.post(f"{API}/tasks", json={
            "title": "TEST_task_progress",
            "description": "verify state transitions",
            "assignee_role": "sales",
            "priority": "medium",
            "due_in_days": 2,
        }, headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        assert r.json()["status"] == "todo"
        # move todo -> in_progress
        r2 = requests.patch(f"{API}/tasks/{tid}", json={"status": "in_progress"}, headers=_hdr(owner_auth["token"]), timeout=10)
        assert r2.status_code == 200 and r2.json()["status"] == "in_progress"
        # in_progress -> done
        r3 = requests.patch(f"{API}/tasks/{tid}", json={"status": "done"}, headers=_hdr(owner_auth["token"]), timeout=10)
        assert r3.status_code == 200 and r3.json()["status"] == "done"


# -------- Workflows --------
class TestWorkflows:
    def test_list_sales_dispatch(self, owner_auth):
        r = requests.get(f"{API}/workflows?type=sales_dispatch", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        wfs = r.json()
        assert len(wfs) >= 1
        assert all(w["type"] == "sales_dispatch" for w in wfs)

    def test_list_purchase_payment(self, owner_auth):
        r = requests.get(f"{API}/workflows?type=purchase_payment", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        wfs = r.json()
        assert any(w["stage"] == "requested" for w in wfs)

    def test_create_workflow(self, owner_auth):
        r = requests.post(f"{API}/workflows", json={
            "type": "sales_dispatch", "title": "TEST_Order_XYZ", "detail": "test", "amount": 1000, "counterparty": "TEST_customer",
        }, headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["stage"] == "order_received"

    def test_advance_workflow(self, owner_auth):
        # create then advance
        cr = requests.post(f"{API}/workflows", json={
            "type": "sales_dispatch", "title": "TEST_Order_ADV", "detail": "adv", "amount": 500, "counterparty": "TEST_cp",
        }, headers=_hdr(owner_auth["token"]), timeout=10).json()
        wid = cr["id"]
        r = requests.patch(f"{API}/workflows/{wid}/advance", json={"stage": "confirmed", "note": "PO confirmed"},
                           headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        assert r.json()["stage"] == "confirmed"

    def test_purchase_approve_gate_production_forbidden(self, production_auth, owner_auth):
        # create a purchase workflow (as production)
        cr = requests.post(f"{API}/workflows", json={
            "type": "purchase_payment", "title": "TEST_PO_gate", "detail": "test", "amount": 100, "counterparty": "TEST_vendor",
        }, headers=_hdr(production_auth["token"]), timeout=10).json()
        wid = cr["id"]
        r = requests.patch(f"{API}/workflows/{wid}/advance", json={"stage": "approved"},
                           headers=_hdr(production_auth["token"]), timeout=10)
        assert r.status_code == 403, f"expected 403 for non-owner approve, got {r.status_code}"
        # owner can approve
        r2 = requests.patch(f"{API}/workflows/{wid}/advance", json={"stage": "approved"},
                            headers=_hdr(owner_auth["token"]), timeout=10)
        assert r2.status_code == 200 and r2.json()["stage"] == "approved"

    def test_finance_cannot_approve_purchase(self, finance_auth):
        cr = requests.post(f"{API}/workflows", json={
            "type": "purchase_payment", "title": "TEST_PO_fin_gate", "detail": "t", "amount": 50, "counterparty": "TEST_v",
        }, headers=_hdr(finance_auth["token"]), timeout=10).json()
        r = requests.patch(f"{API}/workflows/{cr['id']}/advance", json={"stage": "approved"},
                           headers=_hdr(finance_auth["token"]), timeout=10)
        assert r.status_code == 403


# -------- Company Brain search --------
class TestBrainSearch:
    def test_search_matches_seeded(self, owner_auth):
        r = requests.get(f"{API}/brain/search?q=festive", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "decisions" in data and "tasks" in data and "workflows" in data
        # linked tasks inside decisions
        found = False
        for d in data["decisions"]:
            if "tasks" in d:
                found = True
                break
        assert found or data["tasks"] or data["workflows"], "expected some result for 'festive'"


# -------- Ask AI --------
class TestAskAI:
    def test_ask_returns_answer(self, owner_auth):
        r = requests.post(f"{API}/ask", json={"question": "What purchases need my approval?"},
                          headers=_hdr(owner_auth["token"]), timeout=45)
        if r.status_code == 502:
            # transient - retry once
            time.sleep(2)
            r = requests.post(f"{API}/ask", json={"question": "What purchases need my approval?"},
                              headers=_hdr(owner_auth["token"]), timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "answer" in data and isinstance(data["answer"], str) and len(data["answer"]) > 5


# -------- Email digest --------
class TestDigest:
    def test_owner_mocked(self, owner_auth):
        r = requests.post(f"{API}/brief/send-digest", headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["sent"] is False and data["mocked"] is True
        assert "preview_html" in data and "DecisionOS Daily Brief" in data["preview_html"]

    def test_non_owner_forbidden(self, sales_auth):
        r = requests.post(f"{API}/brief/send-digest", headers=_hdr(sales_auth["token"]), timeout=10)
        assert r.status_code == 403


# -------- Team users --------
class TestTeam:
    def test_list_users(self, owner_auth):
        r = requests.get(f"{API}/users", headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200
        users = r.json()
        emails = {u["email"] for u in users}
        assert OWNER[0] in emails and SALES[0] in emails

    def test_add_user_owner(self, owner_auth):
        email = f"TEST_{uuid.uuid4().hex[:8]}@sharma.com"
        r = requests.post(f"{API}/users", json={
            "name": "TEST_member", "email": email, "password": "testpass123", "role": "production",
        }, headers=_hdr(owner_auth["token"]), timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["role"] == "production"

    def test_add_user_non_owner_forbidden(self, sales_auth):
        r = requests.post(f"{API}/users", json={
            "name": "TEST_forbidden", "email": f"TEST_{uuid.uuid4().hex[:8]}@sharma.com", "password": "testpass123", "role": "sales",
        }, headers=_hdr(sales_auth["token"]), timeout=10)
        assert r.status_code == 403

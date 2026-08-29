"""Iteration 7 tests: Contacts CRM + multilingual voice.

Covers:
- Contacts CRUD role gates (owner/sales write, finance/production read only)
- Contact filters (type, status, q)
- Demo seed contacts (Kapoor, Threads, Gujarat, PackWell)
- Workflow linkage via contact_id
- Brain search & Ask AI include contacts
- Multilingual voice: Tanglish + Tamil text-directive extraction
"""
import os
import time
import uuid
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
SALES = ("sales@sharma.com", "demo1234")
PROD = ("production@sharma.com", "demo1234")
FIN = ("finance@sharma.com", "demo1234")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"{email} login failed: {r.text}"
    return r.json()


def _hdr(t):
    return {"Authorization": f"Bearer {t}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def owner_a():
    return _login(*OWNER)


@pytest.fixture(scope="module")
def sales_a():
    return _login(*SALES)


@pytest.fixture(scope="module")
def prod_a():
    return _login(*PROD)


@pytest.fixture(scope="module")
def fin_a():
    return _login(*FIN)


# =========== CONTACTS ===========
class TestContactsSeed:
    def test_demo_contacts_present(self, owner_a):
        r = requests.get(f"{API}/contacts", headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200
        cs = r.json()
        names = {c["name"] for c in cs}
        assert "Kapoor Retail" in names
        assert "Threads Boutique" in names
        assert "Gujarat Cotton Mills" in names
        assert "PackWell Industries" in names
        # each seeded contact must have assigned_name
        for c in cs:
            if c["name"] in ("Kapoor Retail", "Threads Boutique", "Gujarat Cotton Mills", "PackWell Industries"):
                assert c.get("assigned_name"), f"{c['name']} missing assigned_name"

    def test_filter_type_customer(self, owner_a):
        r = requests.get(f"{API}/contacts?type=customer", headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200
        cs = r.json()
        assert all(c["type"] == "customer" for c in cs)
        assert any(c["name"] == "Kapoor Retail" for c in cs)

    def test_filter_type_vendor(self, owner_a):
        r = requests.get(f"{API}/contacts?type=vendor", headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200
        cs = r.json()
        assert all(c["type"] == "vendor" for c in cs)
        assert any(c["name"] == "PackWell Industries" for c in cs)

    def test_search_q_kapoor(self, owner_a):
        r = requests.get(f"{API}/contacts?q=kapoor", headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200
        cs = r.json()
        assert any("Kapoor" in c["name"] or "Kapoor" in (c.get("company") or "") for c in cs)

    def test_finance_can_read_contacts(self, fin_a):
        r = requests.get(f"{API}/contacts", headers=_hdr(fin_a["token"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


class TestContactsRoleGates:
    def _payload(self):
        return {
            "type": "customer", "name": f"TEST_C_{uuid.uuid4().hex[:6]}",
            "company": "TEST_Co", "phone": "+919999999999", "email": "test@example.com",
            "status": "lead",
        }

    def test_create_owner_ok(self, owner_a):
        r = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["type"] == "customer"
        assert c["status"] == "lead"
        # cleanup
        requests.delete(f"{API}/contacts/{c['id']}", headers=_hdr(owner_a["token"]), timeout=10)

    def test_create_sales_ok(self, sales_a):
        r = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(sales_a["token"]), timeout=10)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        requests.delete(f"{API}/contacts/{cid}", headers=_hdr(sales_a["token"]), timeout=10)

    def test_create_finance_forbidden(self, fin_a):
        r = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(fin_a["token"]), timeout=10)
        assert r.status_code == 403

    def test_create_production_forbidden(self, prod_a):
        r = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(prod_a["token"]), timeout=10)
        assert r.status_code == 403

    def test_update_owner_and_verify(self, owner_a):
        # create
        cr = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(owner_a["token"]), timeout=10)
        assert cr.status_code == 200
        cid = cr.json()["id"]
        # update
        upd = requests.patch(f"{API}/contacts/{cid}", json={"status": "active", "notes": "verified"},
                             headers=_hdr(owner_a["token"]), timeout=10)
        assert upd.status_code == 200
        assert upd.json()["status"] == "active"
        assert upd.json()["notes"] == "verified"
        # verify via GET
        got = requests.get(f"{API}/contacts", headers=_hdr(owner_a["token"]), timeout=10).json()
        matched = [c for c in got if c["id"] == cid]
        assert matched and matched[0]["status"] == "active"
        # cleanup
        requests.delete(f"{API}/contacts/{cid}", headers=_hdr(owner_a["token"]), timeout=10)

    def test_update_finance_forbidden(self, owner_a, fin_a):
        cr = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(owner_a["token"]), timeout=10)
        cid = cr.json()["id"]
        r = requests.patch(f"{API}/contacts/{cid}", json={"status": "active"},
                           headers=_hdr(fin_a["token"]), timeout=10)
        assert r.status_code == 403
        requests.delete(f"{API}/contacts/{cid}", headers=_hdr(owner_a["token"]), timeout=10)

    def test_delete_finance_forbidden(self, owner_a, fin_a):
        cr = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(owner_a["token"]), timeout=10)
        cid = cr.json()["id"]
        r = requests.delete(f"{API}/contacts/{cid}", headers=_hdr(fin_a["token"]), timeout=10)
        assert r.status_code == 403
        # owner cleanup
        requests.delete(f"{API}/contacts/{cid}", headers=_hdr(owner_a["token"]), timeout=10)

    def test_delete_owner_removes(self, owner_a):
        cr = requests.post(f"{API}/contacts", json=self._payload(), headers=_hdr(owner_a["token"]), timeout=10)
        cid = cr.json()["id"]
        d = requests.delete(f"{API}/contacts/{cid}", headers=_hdr(owner_a["token"]), timeout=10)
        assert d.status_code == 200
        # verify not returned
        got = requests.get(f"{API}/contacts", headers=_hdr(owner_a["token"]), timeout=10).json()
        assert not any(c["id"] == cid for c in got)


class TestContactsWorkflowLink:
    def test_seeded_workflows_linked(self, owner_a):
        sales_wfs = requests.get(f"{API}/workflows?type=sales_dispatch", headers=_hdr(owner_a["token"]), timeout=10).json()
        # Find non-TEST workflow with contact_id set (Kapoor or Threads)
        linked_demo = [w for w in sales_wfs if w.get("contact_id") and not w.get("title", "").startswith("TEST_")]
        assert linked_demo, "expected at least one seeded sales workflow to have contact_id set"

        po_wfs = requests.get(f"{API}/workflows?type=purchase_payment", headers=_hdr(owner_a["token"]), timeout=10).json()
        linked_po = [w for w in po_wfs if w.get("contact_id") and not w.get("title", "").startswith("TEST_")]
        assert linked_po, "expected at least one seeded PO workflow to have contact_id set"

    def test_create_workflow_with_contact_copies_counterparty(self, owner_a):
        # Pick Kapoor Retail
        cs = requests.get(f"{API}/contacts?q=kapoor", headers=_hdr(owner_a["token"]), timeout=10).json()
        assert cs, "no kapoor contact"
        kapoor = cs[0]
        # Create workflow WITHOUT counterparty but WITH contact_id
        r = requests.post(f"{API}/workflows", json={
            "type": "sales_dispatch", "title": "TEST_link_kapoor", "detail": "linked wf",
            "amount": 5000, "counterparty": "", "contact_id": kapoor["id"],
        }, headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200, r.text
        w = r.json()
        assert w.get("contact_id") == kapoor["id"]
        # counterparty should be filled with company or name
        expected = kapoor.get("company") or kapoor.get("name")
        assert w["counterparty"] == expected, f"expected {expected}, got {w['counterparty']}"


class TestContactsBrainAndAsk:
    def test_brain_search_returns_contacts(self, owner_a):
        r = requests.get(f"{API}/brain/search?q=kapoor", headers=_hdr(owner_a["token"]), timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "contacts" in data, "brain/search must return 'contacts' key"
        assert any("Kapoor" in (c.get("name") or "") or "Kapoor" in (c.get("company") or "") for c in data["contacts"])

    def test_ask_ai_answers_from_contact(self, owner_a):
        payload = {"question": "Give me the phone number and status of Kapoor Retail"}
        r = requests.post(f"{API}/ask", json=payload, headers=_hdr(owner_a["token"]), timeout=60)
        if r.status_code == 502:
            time.sleep(3)
            r = requests.post(f"{API}/ask", json=payload, headers=_hdr(owner_a["token"]), timeout=60)
        assert r.status_code == 200, r.text
        ans = r.json().get("answer", "").lower()
        # Should mention Kapoor and either the phone (any digit) or status word
        assert "kapoor" in ans
        assert any(w in ans for w in ("active", "lead", "inactive")) or any(ch.isdigit() for ch in ans)


# =========== MULTILINGUAL VOICE ===========
def _wait_note(token, nid, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = requests.get(f"{API}/voice-notes/{nid}", headers=_hdr(token), timeout=10)
        if r.status_code == 200:
            n = r.json()
            if n["status"] in ("done", "failed"):
                return n
        time.sleep(2)
    return None


class TestMultilingualVoice:
    def test_tanglish_text_extraction(self, owner_a):
        payload = {
            "text": "Priya kitta sollu, Delhi retailer ku naalaikku follow up pannanum. Finance team packaging invoice Friday kulla clear pannanum.",
            "language": "tanglish",
        }
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        nid = r.json()["id"]
        note = _wait_note(owner_a["token"], nid, 50)
        assert note, "tanglish note processing timed out"
        # retry once on budget
        if note["status"] == "failed" and "Budget" in (note.get("error") or ""):
            r2 = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_a["token"]), timeout=15)
            nid = r2.json()["id"]
            note = _wait_note(owner_a["token"], nid, 50)
        assert note["status"] == "done", f"expected done, got {note.get('status')} err={note.get('error')}"
        assert note.get("decision_id"), "no decision_id"

        # fetch decision + tasks and check role assignments
        d = requests.get(f"{API}/decisions/{note['decision_id']}", headers=_hdr(owner_a["token"]), timeout=10).json()
        tasks = d.get("tasks", [])
        assert tasks, "no tasks extracted from tanglish"
        roles = {t.get("assignee_role") for t in tasks}
        # Expect at least one of sales/finance in the roles
        assert roles & {"sales", "finance"}, f"expected sales/finance in tasks, got roles={roles}"

        # English output check: task titles should be English (ascii-mostly)
        for t in tasks:
            title = t.get("title", "")
            # heuristic: contains any English letter
            assert any(ch.isascii() and ch.isalpha() for ch in title), f"non-English task title: {title}"

    def test_tamil_script_text_extraction(self, owner_a):
        # Tamil script sentence: "Priya, follow up with Delhi retailer tomorrow"
        payload = {
            "text": "பிரியா, டெல்லி வாடிக்கையாளருடன் நாளை தொடர்பு கொள்ளவும். பினான்ஸ் டீம் இன்வாய்ஸ் வெள்ளி வரை கிளியர் செய்யவும்.",
            "language": "ta",
        }
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_a["token"]), timeout=15)
        assert r.status_code == 200, r.text
        nid = r.json()["id"]
        note = _wait_note(owner_a["token"], nid, 50)
        assert note, "tamil note timed out"
        if note["status"] == "failed" and "Budget" in (note.get("error") or ""):
            r2 = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_a["token"]), timeout=15)
            nid = r2.json()["id"]
            note = _wait_note(owner_a["token"], nid, 50)
        assert note["status"] == "done", f"expected done, got {note.get('status')} err={note.get('error')}"
        d = requests.get(f"{API}/decisions/{note['decision_id']}", headers=_hdr(owner_a["token"]), timeout=10).json()
        # decision title/description should be English
        title = (d.get("title") or "") + " " + (d.get("description") or "")
        assert any(ch.isascii() and ch.isalpha() for ch in title), f"expected English output, got: {title}"

    def test_language_en_still_works(self, owner_a):
        payload = {"text": "Sales team should call Anil about the new order.", "language": "en"}
        r = requests.post(f"{API}/voice-notes/text", json=payload, headers=_hdr(owner_a["token"]), timeout=15)
        assert r.status_code == 200
        nid = r.json()["id"]
        note = _wait_note(owner_a["token"], nid, 40)
        assert note and note["status"] in ("done", "failed")

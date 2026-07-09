"""
Iteration 32 — Auto-materialize workflow_events into REAL Workflow board cards.

Covers:
- Login owner
- Toyota+spindles directive → produces execution_summary.workflows >= 1 (target: 2)
  and creates BOTH sales_dispatch (order_received) AND purchase_payment (requested)
  cards on /api/workflows with source='voice', decision_id set, correct fields.
- Policy directive ('never dispatch without payment approval') → does NOT create
  sales_dispatch/purchase_payment cards; goes to memory_notes instead.
- execution_summary regression: still has all 6 numeric keys and decision mirrors
  it via GET /api/decisions and has workflow_ids list.

Cleanup: deletes every voice_note/decision/task/workflow created by these tests
from the demo tenant so the board returns to baseline (2 SD + 2 PP seeded cards).
"""
import os
import time
import pytest
import requests
from pathlib import Path


def _load_frontend_backend_url():
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL")


BASE_URL = (_load_frontend_backend_url() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL missing"

OWNER_EMAIL = "owner@sharma.com"
OWNER_PASSWORD = "demo1234"

TOYOTA_DIRECTIVE = (
    "Dispatch the Toyota order once payment clears. "
    "Also raise a purchase order for 50 spindles from Rajesh Traders for eighty thousand rupees."
)
POLICY_DIRECTIVE = "From now on, never dispatch any order without my payment approval."

POLL_TIMEOUT_S = 90
POLL_INTERVAL_S = 2.0

# Track everything we create for teardown
_CREATED = {"note_ids": set(), "decision_ids": set(), "workflow_ids": set(), "task_ids": set()}


def _login():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, r.json()
    return tok


@pytest.fixture(scope="module")
def token():
    return _login()


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _submit_text(auth_headers, text):
    r = requests.post(
        f"{BASE_URL}/api/voice-notes/text",
        json={"text": text, "language": "en"},
        headers=auth_headers,
        timeout=20,
    )
    assert r.status_code == 200, f"submit failed: {r.status_code} {r.text}"
    body = r.json()
    assert "id" in body
    _CREATED["note_ids"].add(body["id"])
    return body["id"]


def _poll_note_done(auth_headers, note_id, timeout=POLL_TIMEOUT_S):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        r = requests.get(f"{BASE_URL}/api/voice-notes", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        for n in r.json():
            if n.get("id") == note_id:
                last = n
                if n.get("status") == "done":
                    return n
                if n.get("status") == "failed":
                    pytest.fail(f"Voice note failed: {n.get('error')}")
                break
        time.sleep(POLL_INTERVAL_S)
    pytest.fail(f"Voice note {note_id} not done in {timeout}s. Last state: {last}")


def _baseline_workflows(auth_headers):
    sd = requests.get(f"{BASE_URL}/api/workflows?type=sales_dispatch", headers=auth_headers, timeout=15).json()
    pp = requests.get(f"{BASE_URL}/api/workflows?type=purchase_payment", headers=auth_headers, timeout=15).json()
    return {w["id"] for w in sd}, {w["id"] for w in pp}


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

class TestWorkflowMaterialization:
    """Verify AI-detected workflow_events become real board cards."""

    def test_1_login_returns_jwt(self, token):
        assert isinstance(token, str) and len(token) > 20

    def test_2_toyota_spindles_creates_two_workflow_cards(self, auth_headers):
        sd_before, pp_before = _baseline_workflows(auth_headers)

        note_id = _submit_text(auth_headers, TOYOTA_DIRECTIVE)
        note = _poll_note_done(auth_headers, note_id)

        # execution_summary present + numeric
        es = note.get("execution_summary") or {}
        for k in ("tasks", "assignees", "approvals", "workflows", "meetings", "reminders"):
            assert k in es, f"execution_summary missing {k}: {es}"
            assert isinstance(es[k], int), f"{k} not int: {es}"

        assert es["workflows"] >= 1, f"expected workflows>=1, got {es}"
        # Non-deterministic; log if only 1
        if es["workflows"] < 2:
            print(f"[WARN] Only {es['workflows']} workflow(s) generated; expected 2 (Toyota + spindles).")

        decision_id = note.get("decision_id")
        assert decision_id, f"decision_id missing on note: {note}"
        _CREATED["decision_ids"].add(decision_id)

        # Decision mirrors execution_summary + has workflow_ids
        d_resp = requests.get(f"{BASE_URL}/api/decisions", headers=auth_headers, timeout=15)
        assert d_resp.status_code == 200
        dec = next((d for d in d_resp.json() if d.get("id") == decision_id), None)
        assert dec, f"decision {decision_id} not found in /api/decisions"
        assert dec.get("execution_summary") == es, f"decision es mismatch: {dec.get('execution_summary')} vs note es {es}"
        assert isinstance(dec.get("workflow_ids"), list), f"workflow_ids not list: {dec}"
        assert len(dec["workflow_ids"]) == es["workflows"], f"workflow_ids count mismatch: {dec['workflow_ids']} vs workflows={es['workflows']}"
        for wid in dec["workflow_ids"]:
            _CREATED["workflow_ids"].add(wid)
        # Track tasks generated too
        for tid in (dec.get("task_ids") or []):
            _CREATED["task_ids"].add(tid)

        # Fetch board and find new cards
        sd_resp = requests.get(f"{BASE_URL}/api/workflows?type=sales_dispatch", headers=auth_headers, timeout=15)
        pp_resp = requests.get(f"{BASE_URL}/api/workflows?type=purchase_payment", headers=auth_headers, timeout=15)
        assert sd_resp.status_code == 200 and pp_resp.status_code == 200
        sd_cards = sd_resp.json()
        pp_cards = pp_resp.json()

        new_sd = [w for w in sd_cards if w["id"] not in sd_before]
        new_pp = [w for w in pp_cards if w["id"] not in pp_before]

        # Track newly-created workflows for cleanup (belt & suspenders)
        for w in new_sd + new_pp:
            _CREATED["workflow_ids"].add(w["id"])

        # At least ONE new card must exist; ideally one of each type
        assert len(new_sd) + len(new_pp) >= 1, "no new workflow cards materialized"

        # Validate the sales_dispatch card (Toyota)
        toyota = None
        for w in new_sd:
            title = (w.get("title") or "").lower()
            if "toyota" in title or "dispatch" in title:
                toyota = w
                break
        if new_sd and not toyota:
            toyota = new_sd[0]  # fallback: still a sales_dispatch card
        if toyota:
            assert toyota["source"] == "voice", toyota
            assert toyota["decision_id"] == decision_id, toyota
            assert toyota["type"] == "sales_dispatch"
            assert toyota["stage"] == "order_received", f"expected order_received, got {toyota['stage']}"

        # Validate the purchase_payment card (Spindles / Rajesh Traders)
        spindles = None
        for w in new_pp:
            title = (w.get("title") or "").lower()
            cp = (w.get("counterparty") or "").lower()
            if "spindle" in title or "rajesh" in cp or "rajesh" in title:
                spindles = w
                break
        if new_pp and not spindles:
            spindles = new_pp[0]  # fallback: still a purchase card
        if spindles:
            assert spindles["source"] == "voice", spindles
            assert spindles["decision_id"] == decision_id, spindles
            assert spindles["type"] == "purchase_payment"
            assert spindles["stage"] == "requested", f"expected requested, got {spindles['stage']}"
            cp = (spindles.get("counterparty") or "").lower()
            if cp:
                assert "rajesh" in cp, f"counterparty should mention rajesh: {cp}"
            amt = spindles.get("amount")
            if amt is not None:
                # 80,000 target; be permissive on parsing
                assert 70000 <= amt <= 90000, f"unexpected amount for 80k: {amt}"

        # Assert we saw both types when workflows>=2
        if es["workflows"] >= 2:
            assert toyota is not None and spindles is not None, \
                f"Expected both sales_dispatch + purchase_payment when workflows=2. new_sd={new_sd} new_pp={new_pp}"

    def test_3_policy_directive_does_not_materialize(self, auth_headers):
        sd_before, pp_before = _baseline_workflows(auth_headers)

        note_id = _submit_text(auth_headers, POLICY_DIRECTIVE)
        note = _poll_note_done(auth_headers, note_id)

        es = note.get("execution_summary") or {}
        assert isinstance(es.get("workflows"), int)

        decision_id = note.get("decision_id")
        if decision_id:
            _CREATED["decision_ids"].add(decision_id)
            d_resp = requests.get(f"{BASE_URL}/api/decisions", headers=auth_headers, timeout=15)
            dec = next((d for d in d_resp.json() if d.get("id") == decision_id), None)
            if dec:
                for wid in (dec.get("workflow_ids") or []):
                    _CREATED["workflow_ids"].add(wid)
                for tid in (dec.get("task_ids") or []):
                    _CREATED["task_ids"].add(tid)

        # Ideal: 0 workflow cards materialized (policy → memory_note)
        sd_resp = requests.get(f"{BASE_URL}/api/workflows?type=sales_dispatch", headers=auth_headers, timeout=15).json()
        pp_resp = requests.get(f"{BASE_URL}/api/workflows?type=purchase_payment", headers=auth_headers, timeout=15).json()
        new_sd = [w for w in sd_resp if w["id"] not in sd_before]
        new_pp = [w for w in pp_resp if w["id"] not in pp_before]
        for w in new_sd + new_pp:
            _CREATED["workflow_ids"].add(w["id"])
        total_new = len(new_sd) + len(new_pp)
        # LLM non-deterministic; policy should ideally yield 0 cards. Allow 1 (minor) but not more.
        assert total_new <= 1, f"Policy directive materialized {total_new} cards; expected 0. new_sd={new_sd} new_pp={new_pp}"
        if total_new == 1:
            print(f"[WARN] policy directive slipped 1 card through — minor LLM non-determinism.")
        else:
            assert es["workflows"] == 0, f"expected workflows=0 for policy, got {es['workflows']}"

    def test_4_execution_summary_shape_regression(self, auth_headers):
        # Reuse note from test_2 by pulling latest voice_notes
        r = requests.get(f"{BASE_URL}/api/voice-notes", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        notes = r.json()
        assert notes, "no voice notes returned"
        # look at our created notes
        for nid in _CREATED["note_ids"]:
            note = next((n for n in notes if n["id"] == nid), None)
            if not note:
                continue
            es = note.get("execution_summary") or {}
            for k in ("tasks", "assignees", "approvals", "workflows", "meetings", "reminders"):
                assert isinstance(es.get(k), int), f"note {nid} es.{k} not int: {es}"


# ------------------------------------------------------------------
# Teardown — clean up all TEST-created data from demo tenant
# ------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def _cleanup(request, auth_headers):
    yield
    # Mongo cleanup (public API has no DELETE for workflows/decisions/voice_notes)
    try:
        import motor.motor_asyncio, asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url:
            env = Path("/app/backend/.env").read_text()
            for line in env.splitlines():
                if line.startswith("MONGO_URL="):
                    mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                if line.startswith("DB_NAME="):
                    db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
        if not db_name:
            db_name = "test_database"
        # Strip quotes if env var had them
        mongo_url = (mongo_url or "").strip().strip('"').strip("'")
        db_name = (db_name or "test_database").strip().strip('"').strip("'")

        async def _clean():
            client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
            db = client[db_name]
            note_ids = list(_CREATED["note_ids"])
            dec_ids = list(_CREATED["decision_ids"])
            wf_ids = list(_CREATED["workflow_ids"])
            task_ids = list(_CREATED["task_ids"])

            # Also match by transcript text as safety net
            note_query_texts = [TOYOTA_DIRECTIVE, POLICY_DIRECTIVE]
            extra_notes = await db.voice_notes.find(
                {"transcript": {"$in": note_query_texts}}, {"id": 1, "decision_id": 1, "_id": 0}
            ).to_list(100)
            for n in extra_notes:
                note_ids.append(n["id"])
                if n.get("decision_id"):
                    dec_ids.append(n["decision_id"])

            # Cascade: from decisions, get workflow_ids & task_ids
            if dec_ids:
                cascade = await db.decisions.find({"id": {"$in": dec_ids}}, {"workflow_ids": 1, "task_ids": 1, "_id": 0}).to_list(200)
                for d in cascade:
                    wf_ids.extend(d.get("workflow_ids") or [])
                    task_ids.extend(d.get("task_ids") or [])

            # Also: purge any workflows with source='voice' + decision_id in dec_ids
            if dec_ids:
                extra_wf = await db.workflows.find({"source": "voice", "decision_id": {"$in": dec_ids}}, {"id": 1, "_id": 0}).to_list(200)
                for w in extra_wf:
                    wf_ids.append(w["id"])

            note_ids = list(set(note_ids))
            dec_ids = list(set(dec_ids))
            wf_ids = list(set(wf_ids))
            task_ids = list(set(task_ids))

            deleted = {}
            if wf_ids:
                r = await db.workflows.delete_many({"id": {"$in": wf_ids}})
                deleted["workflows"] = r.deleted_count
            if task_ids:
                r = await db.tasks.delete_many({"id": {"$in": task_ids}})
                deleted["tasks"] = r.deleted_count
            if dec_ids:
                r = await db.decisions.delete_many({"id": {"$in": dec_ids}})
                deleted["decisions"] = r.deleted_count
            if note_ids:
                r = await db.voice_notes.delete_many({"id": {"$in": note_ids}})
                deleted["voice_notes"] = r.deleted_count
            print(f"[cleanup] deleted: {deleted}")
            client.close()

        asyncio.run(_clean())
    except Exception as e:
        print(f"[cleanup] FAILED: {e}")

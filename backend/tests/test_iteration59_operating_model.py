"""Iteration 59 — Industry Operating Model backend verification.

Covers:
- GET /api/auth/me returns tenant.operating_model with the right shape
  (pipelines[{key,label,sub,approval_stage,stages[{key,label}]}], task_categories[{key,label}])
- POST /api/workflows with a real pipeline key -> card at first stage; invalid type -> 400
- advance_workflow dynamic owner sign-off gate: non-owner into approval_stage -> 403; owner -> 200
- PATCH /api/tenant/operating-model (owner OK, sales 403) + persistence
- POST /api/tenant/operating-model/regenerate (owner OK, sales 403)
- REGRESSION for existing manufacturing demo: workflows list, advance
- AI directive routing (salon): POST /api/voice-notes/text drops workflow cards
  into the tenant's real pipeline keys and tasks are tagged with the tenant's
  own task_category keys (front_desk / inventory / ...).
"""
import os
import time
import uuid
import pytest
import requests

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}
PRODUCTION = {"email": "production@sharma.com", "password": "demo1234"}
SALON = {"email": "salon_1784655690@test.com", "password": "demo1234"}


# ---------------- fixtures ------------------------------------------------
def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']} failed: {r.text}"
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def owner_token():
    return _login(OWNER)


@pytest.fixture(scope="module")
def sales_token():
    return _login(SALES)


@pytest.fixture(scope="module")
def prod_token():
    return _login(PRODUCTION)


@pytest.fixture(scope="module")
def salon_token():
    return _login(SALON)


@pytest.fixture(scope="module")
def owner_om(owner_token):
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=60)
    assert r.status_code == 200
    return r.json()["tenant"]["operating_model"]


@pytest.fixture(scope="module")
def original_owner_om(owner_token):
    """Capture the demo's operating model at start so we can restore it at teardown."""
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=60)
    assert r.status_code == 200
    return r.json()["tenant"]["operating_model"]


# ---------------- shape helper -------------------------------------------
def _assert_operating_model_shape(om):
    assert isinstance(om, dict), f"operating_model is not dict: {om!r}"
    pipes = om.get("pipelines")
    cats = om.get("task_categories")
    assert isinstance(pipes, list) and pipes, f"pipelines empty: {pipes!r}"
    assert isinstance(cats, list) and cats, f"task_categories empty: {cats!r}"
    stage_keys = {"key", "label"}
    pipe_keys = {"key", "label", "sub", "stages", "approval_stage"}
    cat_keys = {"key", "label"}
    for p in pipes:
        missing = pipe_keys - set(p.keys())
        assert not missing, f"pipeline missing keys {missing}: {p}"
        assert isinstance(p["stages"], list) and p["stages"], f"pipeline {p['key']} has no stages"
        for s in p["stages"]:
            assert stage_keys <= set(s.keys()), f"stage missing keys: {s}"
    for c in cats:
        assert cat_keys <= set(c.keys()), f"cat missing keys: {c}"


# ---------------- GET /auth/me shape -------------------------------------
class TestAuthMeOperatingModel:
    def test_owner_me_returns_om(self, owner_om):
        _assert_operating_model_shape(owner_om)

    def test_owner_me_om_reflects_manufacturing(self, owner_om):
        """Existing textile tenant was auto-backfilled to a manufacturing-ish model."""
        labels = " ".join([p["label"].lower() for p in owner_om["pipelines"]])
        blob = " ".join([labels] + [c["label"].lower() for c in owner_om["task_categories"]])
        assert any(w in blob for w in [
            "production", "procurement", "raw material", "order", "manufactur", "dispatch",
            "fulfil", "quality", "goods",
        ]), f"expected manufacturing-ish labels, got: {blob}"

    def test_salon_me_reflects_salon(self, salon_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(salon_token), timeout=60)
        assert r.status_code == 200
        om = r.json()["tenant"]["operating_model"]
        _assert_operating_model_shape(om)
        pipe_keys = {p["key"] for p in om["pipelines"]}
        pipe_labels = " ".join([p["label"].lower() for p in om["pipelines"]])
        cat_labels = " ".join([c["label"].lower() for c in om["task_categories"]])
        # No production/dispatch language, and does include salon vocab
        assert "production" not in pipe_keys, f"salon shouldn't have 'production' pipeline: {pipe_keys}"
        assert any(w in pipe_labels for w in ["appointment", "service", "client", "booking", "procurement"]), (
            f"salon pipelines should include appointment/service vocab, got: {pipe_labels}")
        assert any(w in cat_labels for w in ["front", "salon", "inventory", "service"]), (
            f"salon categories should be salon-ish, got: {cat_labels}")


# ---------------- POST /workflows --------------------------------------
class TestCreateWorkflow:
    def test_invalid_type_400(self, owner_token):
        r = requests.post(f"{BASE_URL}/api/workflows", headers=_auth(owner_token), timeout=30,
                          json={"type": "does_not_exist_xyz", "title": "TEST_bad"})
        assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    def test_valid_pipeline_creates_at_first_stage(self, owner_token, owner_om):
        # Pick the first non-approval pipeline for a clean create
        pipe = next((p for p in owner_om["pipelines"] if not p.get("approval_stage")), owner_om["pipelines"][0])
        pkey = pipe["key"]
        first_stage = pipe["stages"][0]["key"]
        r = requests.post(f"{BASE_URL}/api/workflows", headers=_auth(owner_token), timeout=30,
                          json={"type": pkey, "title": f"TEST_it59_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200, r.text
        wf = r.json()
        assert wf["type"] == pkey
        assert wf["stage"] == first_stage, f"expected {first_stage}, got {wf['stage']}"
        assert wf["stages"] == [s["key"] for s in pipe["stages"]]
        # cleanup
        requests.delete(f"{BASE_URL}/api/workflows/{wf['id']}", headers=_auth(owner_token), timeout=15)


# ---------------- advance_workflow approval gate ------------------------
class TestApprovalGate:
    def test_non_owner_403_at_approval_stage_owner_ok(self, owner_token, prod_token, owner_om):
        appr_pipe = next((p for p in owner_om["pipelines"] if p.get("approval_stage")), None)
        if not appr_pipe:
            pytest.skip("No approval_stage pipeline in the demo tenant's operating model")
        stages = [s["key"] for s in appr_pipe["stages"]]
        appr_key = appr_pipe["approval_stage"]
        appr_idx = stages.index(appr_key)
        # need at least one stage before it
        if appr_idx == 0:
            pytest.skip(f"approval stage is at index 0 for pipeline {appr_pipe['key']}")

        # Create a workflow as owner
        r = requests.post(f"{BASE_URL}/api/workflows", headers=_auth(owner_token), timeout=30,
                          json={"type": appr_pipe["key"], "title": f"TEST_it59_appr_{uuid.uuid4().hex[:6]}"})
        assert r.status_code == 200, r.text
        wf = r.json()
        wid = wf["id"]

        try:
            # Advance the card up to just before the approval stage (as owner)
            for i in range(1, appr_idx):
                stg = stages[i]
                rr = requests.patch(f"{BASE_URL}/api/workflows/{wid}/advance",
                                    headers=_auth(owner_token), timeout=30,
                                    json={"stage": stg, "note": "TEST prep"})
                assert rr.status_code == 200, f"owner advance to {stg} failed: {rr.status_code} {rr.text}"

            # Production tries to advance INTO the approval stage -> 403
            r_prod = requests.patch(f"{BASE_URL}/api/workflows/{wid}/advance",
                                    headers=_auth(prod_token), timeout=30,
                                    json={"stage": appr_key, "note": "TEST prod attempt"})
            assert r_prod.status_code == 403, f"expected 403 for production at appr stage, got {r_prod.status_code}: {r_prod.text}"

            # Owner advances into the approval stage -> 200
            r_own = requests.patch(f"{BASE_URL}/api/workflows/{wid}/advance",
                                   headers=_auth(owner_token), timeout=30,
                                   json={"stage": appr_key, "note": "TEST owner approve"})
            assert r_own.status_code == 200, f"owner advance failed: {r_own.status_code} {r_own.text}"
            assert r_own.json()["stage"] == appr_key
        finally:
            requests.delete(f"{BASE_URL}/api/workflows/{wid}", headers=_auth(owner_token), timeout=15)

    def test_regression_advance_existing_purchase_payment_card(self, owner_token):
        """Existing legacy purchase_payment card (no matching new-om pipeline) still advances via wf['stages']."""
        r = requests.get(f"{BASE_URL}/api/workflows?type=purchase_payment",
                         headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200, r.text
        cards = r.json()
        # Find one where stage is not the last
        cand = None
        for c in cards:
            stages = c.get("stages") or []
            if not stages:
                continue
            cur = c.get("stage")
            if cur in stages and stages.index(cur) < len(stages) - 1:
                nxt = stages[stages.index(cur) + 1]
                # Skip if next is "approved" (that's owner-only, but owner IS the caller so OK).
                cand = (c, nxt, cur)
                break
        if not cand:
            pytest.skip("No advanceable legacy purchase_payment cards on demo")
        card, nxt, cur = cand
        rr = requests.patch(f"{BASE_URL}/api/workflows/{card['id']}/advance",
                            headers=_auth(owner_token), timeout=30,
                            json={"stage": nxt, "note": "TEST regression it59"})
        assert rr.status_code == 200, f"legacy advance {cur}->{nxt} failed: {rr.status_code} {rr.text}"
        # Note: we intentionally do not rewind — the demo tenant's op-model gets restored,
        # but the workflow's stage change is a tiny drift. Acceptable and expected in tests.


# ---------------- PATCH / regenerate RBAC + persistence ------------------
class TestOperatingModelRBAC:
    def test_sales_patch_forbidden(self, sales_token):
        r = requests.patch(f"{BASE_URL}/api/tenant/operating-model",
                           headers=_auth(sales_token), timeout=30,
                           json={"operating_model": {"pipelines": [], "task_categories": []}})
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_sales_regenerate_forbidden(self, sales_token):
        r = requests.post(f"{BASE_URL}/api/tenant/operating-model/regenerate",
                          headers=_auth(sales_token), timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

    def test_owner_patch_persists_then_restore(self, owner_token, original_owner_om):
        # Edit: rename first pipeline label + add a stage
        edited = {
            "pipelines": [{**p, "stages": [{"key": s["key"], "label": s["label"]} for s in p["stages"]]}
                          for p in original_owner_om["pipelines"]],
            "task_categories": [{**c} for c in original_owner_om["task_categories"]],
        }
        marker = f"TESTIT59-{uuid.uuid4().hex[:6]}"
        original_label = edited["pipelines"][0]["label"]
        edited["pipelines"][0]["label"] = f"{original_label} {marker}"
        edited["pipelines"][0]["stages"].append({"key": "testit59_extra", "label": "TESTIT59 Extra"})

        p = requests.patch(f"{BASE_URL}/api/tenant/operating-model",
                           headers=_auth(owner_token), timeout=30,
                           json={"operating_model": edited})
        assert p.status_code == 200, p.text
        saved = p.json().get("operating_model") or {}
        _assert_operating_model_shape(saved)
        # First pipeline label reflects marker
        assert marker in saved["pipelines"][0]["label"], f"marker missing from saved label: {saved['pipelines'][0]['label']}"
        # The added stage is persisted
        stage_keys = [s["key"] for s in saved["pipelines"][0]["stages"]]
        assert "testit59_extra" in stage_keys, f"added stage key not persisted: {stage_keys}"

        # Re-fetch via /auth/me
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=30)
        after = r2.json()["tenant"]["operating_model"]
        assert marker in after["pipelines"][0]["label"], "marker didn't survive round-trip"

        # Restore original (payload must match input shape)
        restore = {
            "pipelines": [{"key": p["key"], "label": p["label"], "sub": p["sub"],
                           "approval_stage": p.get("approval_stage"),
                           "stages": [{"key": s["key"], "label": s["label"]} for s in p["stages"]]}
                          for p in original_owner_om["pipelines"]],
            "task_categories": [{"key": c["key"], "label": c["label"]} for c in original_owner_om["task_categories"]],
        }
        rr = requests.patch(f"{BASE_URL}/api/tenant/operating-model",
                            headers=_auth(owner_token), timeout=30,
                            json={"operating_model": restore})
        assert rr.status_code == 200, rr.text
        saved_back = rr.json()["operating_model"]
        assert saved_back["pipelines"][0]["label"] == original_label, (
            f"restore didn't reset label: {saved_back['pipelines'][0]['label']} vs {original_label}")

    def test_owner_regenerate_ok_then_restore(self, owner_token, original_owner_om):
        r = requests.post(f"{BASE_URL}/api/tenant/operating-model/regenerate",
                          headers=_auth(owner_token), timeout=90)
        assert r.status_code == 200, r.text
        om = r.json().get("operating_model")
        _assert_operating_model_shape(om)
        # Restore original
        restore = {
            "pipelines": [{"key": p["key"], "label": p["label"], "sub": p["sub"],
                           "approval_stage": p.get("approval_stage"),
                           "stages": [{"key": s["key"], "label": s["label"]} for s in p["stages"]]}
                          for p in original_owner_om["pipelines"]],
            "task_categories": [{"key": c["key"], "label": c["label"]} for c in original_owner_om["task_categories"]],
        }
        rr = requests.patch(f"{BASE_URL}/api/tenant/operating-model",
                            headers=_auth(owner_token), timeout=30,
                            json={"operating_model": restore})
        assert rr.status_code == 200, rr.text


# ---------------- AI directive routing (salon) ----------------------------
class TestAIDirectiveRoutingSalon:
    """Live Claude AI test: verify a salon directive routes into salon pipelines/categories."""

    def test_salon_directive_creates_appointment_and_procurement_and_tagged_tasks(self, salon_token):
        # Snapshot existing counts to only count new items
        r_wf0 = requests.get(f"{BASE_URL}/api/workflows", headers=_auth(salon_token), timeout=30)
        assert r_wf0.status_code == 200
        wf_ids_before = {w["id"] for w in r_wf0.json()}

        r_t0 = requests.get(f"{BASE_URL}/api/tasks", headers=_auth(salon_token), timeout=30)
        assert r_t0.status_code == 200
        task_ids_before = {t["id"] for t in r_t0.json()}

        # A directive that clearly triggers both an appointment + a procurement flow.
        marker = f"TESTIT59-{uuid.uuid4().hex[:6]}"
        directive = (
            f"[{marker}] Book Priya Sharma tomorrow 3pm for a haircut and hair spa. "
            "Also, order 5 packs of L'Oreal shampoo from our supplier — we're running low. "
            "Ask front desk to confirm the appointment by phone and inventory to check stock levels."
        )
        r = requests.post(f"{BASE_URL}/api/voice-notes/text",
                          headers=_auth(salon_token), timeout=30,
                          json={"text": directive})
        assert r.status_code == 200, r.text
        note_id = r.json()["id"]

        # Poll the note until done (or failed) — background task w/ Claude call.
        end = time.time() + 90
        note = None
        while time.time() < end:
            time.sleep(2)
            g = requests.get(f"{BASE_URL}/api/voice-notes/{note_id}",
                             headers=_auth(salon_token), timeout=30)
            if g.status_code == 200:
                note = g.json()
                if note.get("status") in ("done", "failed"):
                    break
        assert note is not None and note.get("status") == "done", (
            f"voice-note did not finish, status={note and note.get('status')} err={note and note.get('error')}"
        )

        # Fetch the salon's operating model to know valid pipeline & category keys
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(salon_token), timeout=30).json()
        om = me["tenant"]["operating_model"]
        pipe_keys = {p["key"] for p in om["pipelines"]}
        cat_keys = {c["key"] for c in om["task_categories"]}

        # Fetch new workflows created by the directive
        r_wf1 = requests.get(f"{BASE_URL}/api/workflows", headers=_auth(salon_token), timeout=30)
        new_wfs = [w for w in r_wf1.json() if w["id"] not in wf_ids_before]
        assert new_wfs, "AI directive did not create any new workflow cards"

        # Every new card must use one of the salon's real pipeline keys
        for w in new_wfs:
            assert w["type"] in pipe_keys, (
                f"workflow type '{w['type']}' is not in salon pipelines {pipe_keys}: {w.get('title')}")

        # At least one appointment-flavored + one procurement-flavored card
        appt_pipes = {k for k in pipe_keys if any(w in k for w in ("appoint", "book", "service"))}
        proc_pipes = {k for k in pipe_keys if any(w in k for w in ("procure", "purchase", "supply", "inventory"))}
        types_created = {w["type"] for w in new_wfs}
        if appt_pipes:
            assert types_created & appt_pipes, (
                f"expected an appointment card, got types={types_created} appt_candidates={appt_pipes}")
        if proc_pipes:
            assert types_created & proc_pipes, (
                f"expected a procurement card, got types={types_created} proc_candidates={proc_pipes}")

        # Fetch newly created tasks and check task_type against tenant category keys
        r_t1 = requests.get(f"{BASE_URL}/api/tasks", headers=_auth(salon_token), timeout=30)
        new_tasks = [t for t in r_t1.json() if t["id"] not in task_ids_before]
        # Not every directive necessarily creates tasks, but we're asking for confirm + stock check.
        assert new_tasks, "AI directive did not create any new tasks"
        # Any new task with a task_type set must use a tenant category key
        typed = [t for t in new_tasks if t.get("task_type") and t.get("task_type") not in ("other",)]
        # AI is free to pick most fitting cat, but must fall within the tenant's set OR fallback ("other")
        for t in new_tasks:
            tt = t.get("task_type")
            assert tt in cat_keys or tt in (None, "", "other", "sales", "finance", "production", "purchase"), (
                f"task_type '{tt}' not in salon categories {cat_keys} for task {t.get('title')}")
        # At least one task should be tagged with a salon-specific category
        salon_tagged = [t for t in new_tasks if t.get("task_type") in cat_keys]
        assert salon_tagged, (
            f"expected at least one task tagged with tenant category ({cat_keys}), "
            f"but tasks were: { [(t.get('title'), t.get('task_type')) for t in new_tasks] }")

    def test_zzz_cleanup_ai_directive_artifacts(self, salon_token):
        """Best-effort cleanup: delete all TESTIT59 workflows & tasks & voice notes on the salon tenant."""
        try:
            r_wf = requests.get(f"{BASE_URL}/api/workflows", headers=_auth(salon_token), timeout=20)
            for w in r_wf.json():
                if "TESTIT59" in (w.get("title") or "") or "TESTIT59" in (w.get("detail") or ""):
                    requests.delete(f"{BASE_URL}/api/workflows/{w['id']}",
                                    headers=_auth(salon_token), timeout=15)
        except Exception:
            pass
        try:
            r_t = requests.get(f"{BASE_URL}/api/tasks", headers=_auth(salon_token), timeout=20)
            for t in r_t.json():
                if "TESTIT59" in (t.get("title") or "") or "TESTIT59" in (t.get("description") or ""):
                    requests.delete(f"{BASE_URL}/api/tasks/{t['id']}",
                                    headers=_auth(salon_token), timeout=15)
        except Exception:
            pass

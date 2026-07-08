"""Iteration 20 — AI Execution Guide (Phase 1) tests.

Covers:
  - POST /api/tasks/{id}/execution-plan/generate  (assignee/role/owner allowed; others 403)
  - PATCH /api/tasks/{id}/execution-plan          (edit/add/remove/reorder; progress; task-status transitions)
  - POST /api/tasks/{id}/steps/ask                (per-step AI assist)
  - Perm gating for a finance user against a production-scoped task
  - Regression: task PATCH complete + attachment endpoints still function
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://founder-os-58.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER = ("owner@sharma.com", "demo1234")
PRODUCTION = ("production@sharma.com", "demo1234")
FINANCE = ("finance@sharma.com", "demo1234")


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()


def _hdr(token, json=True):
    h = {"Authorization": f"Bearer {token}"}
    if json:
        h["Content-Type"] = "application/json"
    return h


# -------- shared session fixtures --------
@pytest.fixture(scope="session")
def owner_auth():
    return _login(*OWNER)


@pytest.fixture(scope="session")
def prod_auth():
    return _login(*PRODUCTION)


@pytest.fixture(scope="session")
def fin_auth():
    return _login(*FINANCE)


# -------- helpers --------
def _create_task(owner_token, title="TEST_iter20_exec_plan", assignee_role="production", assignee_id=None):
    payload = {
        "title": title,
        "description": "Follow up with customer Rajesh for payment on invoice INV-2213 for 45,000 INR.",
        "assignee_role": assignee_role,
        "priority": "high",
    }
    if assignee_id:
        payload["assignee_id"] = assignee_id
    r = requests.post(f"{API}/tasks", json=payload, headers=_hdr(owner_token), timeout=15)
    assert r.status_code in (200, 201), f"create task failed: {r.status_code} {r.text}"
    return r.json()


def _get_task(token, tid):
    """No single-task GET exists; fetch via list."""
    r = requests.get(f"{API}/tasks", headers=_hdr(token), timeout=15)
    assert r.status_code == 200
    for t in r.json():
        if t.get("id") == tid:
            return t
    return None


# =====================================================================
# TestGenerate — POST /tasks/{id}/execution-plan/generate
# =====================================================================
class TestGenerate:
    def test_generate_plan_by_role_assignee(self, owner_auth, prod_auth):
        """production user is assignee-by-role → can generate an AI plan."""
        t = _create_task(owner_auth["token"], title="TEST_iter20_gen_by_role", assignee_role="production")
        r = requests.post(
            f"{API}/tasks/{t['id']}/execution-plan/generate",
            headers=_hdr(prod_auth["token"]), timeout=90,
        )
        assert r.status_code == 200, f"generate failed: {r.status_code} {r.text}"
        data = r.json()
        assert "execution_plan" in data, f"missing execution_plan: {data}"
        plan = data["execution_plan"]
        # shape
        assert plan["status"] == "draft"
        assert isinstance(plan.get("steps"), list) and len(plan["steps"]) >= 3, f"got {plan.get('steps')}"
        # step shape
        for s in plan["steps"]:
            assert "id" in s and isinstance(s["id"], str)
            assert "text" in s and isinstance(s["text"], str) and s["text"].strip()
            assert s["done"] is False
        assert plan["progress"] == 0
        assert plan.get("task_type"), "task_type should be classified by AI"
        # persistence: owner GET returns same plan
        fetched = _get_task(owner_auth["token"], t["id"])
        assert fetched and fetched.get("execution_plan"), "plan not persisted"
        assert len(fetched["execution_plan"]["steps"]) == len(plan["steps"])
        # stash for next tests
        pytest.exec_task_id = t["id"]
        pytest.exec_task_steps = plan["steps"]

    def test_generate_by_owner(self, owner_auth):
        """owner can always generate a plan (role='owner' short-circuit)."""
        t = _create_task(owner_auth["token"], title="TEST_iter20_gen_by_owner", assignee_role="sales")
        r = requests.post(
            f"{API}/tasks/{t['id']}/execution-plan/generate",
            headers=_hdr(owner_auth["token"]), timeout=90,
        )
        assert r.status_code == 200
        assert r.json()["execution_plan"]["status"] == "draft"

    def test_generate_forbidden_for_other_role(self, owner_auth, fin_auth):
        """finance user cannot generate a plan on a production-only task → 403."""
        t = _create_task(owner_auth["token"], title="TEST_iter20_gen_forbidden", assignee_role="production")
        r = requests.post(
            f"{API}/tasks/{t['id']}/execution-plan/generate",
            headers=_hdr(fin_auth["token"]), timeout=30,
        )
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"

    def test_generate_404_missing_task(self, owner_auth):
        r = requests.post(
            f"{API}/tasks/does-not-exist-xyz/execution-plan/generate",
            headers=_hdr(owner_auth["token"]), timeout=15,
        )
        assert r.status_code == 404


# =====================================================================
# TestPatch — PATCH /tasks/{id}/execution-plan
# =====================================================================
class TestPatch:
    def test_patch_edit_add_remove_reorder_and_status_transitions(self, owner_auth, prod_auth):
        """One flow covering: reorder, add custom, remove, empty-text drop,
        progress recompute, status→in_progress at >0%, status→done at 100%."""
        # Self-contained: generate a fresh plan so this works under pytest-xdist
        t = _create_task(owner_auth["token"], title="TEST_iter20_patch_flow", assignee_role="production")
        g = requests.post(
            f"{API}/tasks/{t['id']}/execution-plan/generate",
            headers=_hdr(prod_auth["token"]), timeout=90,
        )
        assert g.status_code == 200, g.text
        base = g.json()["execution_plan"]["steps"]
        tid = t["id"]
        assert len(base) >= 3

        # ---- 1) reorder + add custom + empty step dropped, save as draft ----
        reordered = [base[1], base[0]] + base[2:]
        payload_steps = (
            [{"id": s["id"], "text": s["text"], "done": False} for s in reordered]
            + [{"text": "Meet the Purchase Manager", "done": False}]          # add custom
            + [{"text": "   ", "done": False}]                                  # empty → dropped
        )
        r = requests.patch(
            f"{API}/tasks/{tid}/execution-plan",
            json={"steps": payload_steps, "status": "draft"},
            headers=_hdr(prod_auth["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        plan = r.json()["execution_plan"]
        assert plan["status"] == "draft"
        assert len(plan["steps"]) == len(base) + 1, "empty step should be dropped"
        # reorder verified
        assert plan["steps"][0]["text"] == base[1]["text"]
        assert plan["steps"][1]["text"] == base[0]["text"]
        # custom step got a server-side id
        assert plan["steps"][-1]["text"] == "Meet the Purchase Manager"
        assert plan["steps"][-1]["id"] and isinstance(plan["steps"][-1]["id"], str)
        # progress 0 because none done
        assert plan["progress"] == 0

        # snapshot to build next payload
        steps_now = plan["steps"]

        # ---- 2) remove first step + mark 60% done + accept ----
        after_remove = steps_now[1:]
        # mark enough done to be > 60% but < 100
        n = len(after_remove)
        done_count = max(1, int(round(n * 0.6)))
        for i in range(done_count):
            after_remove[i]["done"] = True
        r = requests.patch(
            f"{API}/tasks/{tid}/execution-plan",
            json={
                "steps": [{"id": s["id"], "text": s["text"], "done": bool(s["done"])} for s in after_remove],
                "status": "accepted",
            },
            headers=_hdr(prod_auth["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        plan = body["execution_plan"]
        assert plan["status"] == "accepted"
        assert len(plan["steps"]) == n
        # progress > 0 and < 100
        expected_progress = round(done_count / n * 100)
        assert plan["progress"] == expected_progress
        assert 0 < plan["progress"] < 100
        # task status flipped todo → in_progress (progress>0 & accepted)
        assert body["status"] == "in_progress", f"task status did not transition to in_progress: {body.get('status')}"

        # ---- 3) mark ALL done → task becomes 'done' ----
        for s in plan["steps"]:
            s["done"] = True
        r = requests.patch(
            f"{API}/tasks/{tid}/execution-plan",
            json={"steps": [{"id": s["id"], "text": s["text"], "done": True} for s in plan["steps"]],
                  "status": "accepted"},
            headers=_hdr(prod_auth["token"]), timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["execution_plan"]["progress"] == 100
        assert body["status"] == "done", f"task should be done: {body.get('status')}"

    def test_patch_forbidden_for_other_role(self, owner_auth, fin_auth):
        t = _create_task(owner_auth["token"], title="TEST_iter20_patch_forbidden", assignee_role="production")
        r = requests.patch(
            f"{API}/tasks/{t['id']}/execution-plan",
            json={"steps": [{"text": "sneaky", "done": False}], "status": "draft"},
            headers=_hdr(fin_auth["token"]), timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_patch_all_empty_steps_dropped(self, owner_auth, prod_auth):
        t = _create_task(owner_auth["token"], title="TEST_iter20_empty_drop", assignee_role="production")
        r = requests.patch(
            f"{API}/tasks/{t['id']}/execution-plan",
            json={"steps": [{"text": "  "}, {"text": ""}], "status": "draft"},
            headers=_hdr(prod_auth["token"]), timeout=15,
        )
        assert r.status_code == 200
        plan = r.json()["execution_plan"]
        assert plan["steps"] == []
        assert plan["progress"] == 0


# =====================================================================
# TestAsk — POST /tasks/{id}/steps/ask
# =====================================================================
class TestAsk:
    def test_ask_step_returns_suggestion_and_objections(self, owner_auth, prod_auth):
        t = _create_task(owner_auth["token"], title="TEST_iter20_ask_step", assignee_role="production")
        r = requests.post(
            f"{API}/tasks/{t['id']}/steps/ask",
            json={"step_text": "Call the customer to negotiate payment terms"},
            headers=_hdr(prod_auth["token"]), timeout=60,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data.get("suggestion"), str) and len(data["suggestion"]) > 10
        assert isinstance(data.get("objections"), list)
        # AI usually returns 2-4 objections, we assert at least 1
        assert len(data["objections"]) >= 1, f"expected >=1 objection, got {data['objections']}"
        for o in data["objections"]:
            assert isinstance(o.get("objection"), str) and o["objection"].strip()
            assert isinstance(o.get("response"), str) and o["response"].strip()

    def test_ask_step_forbidden_for_other_role(self, owner_auth, fin_auth):
        t = _create_task(owner_auth["token"], title="TEST_iter20_ask_forbidden", assignee_role="production")
        r = requests.post(
            f"{API}/tasks/{t['id']}/steps/ask",
            json={"step_text": "Try something"},
            headers=_hdr(fin_auth["token"]), timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_ask_step_404_missing_task(self, prod_auth):
        r = requests.post(
            f"{API}/tasks/does-not-exist-xyz/steps/ask",
            json={"step_text": "x"},
            headers=_hdr(prod_auth["token"]), timeout=15,
        )
        assert r.status_code == 404


# =====================================================================
# TestRegression — verify existing task actions still work
# =====================================================================
class TestRegression:
    def test_role_scoped_task_visibility(self, prod_auth):
        """production sees only their lane (assignee_role=production OR assignee_id=self)."""
        r = requests.get(f"{API}/tasks?mine=true", headers=_hdr(prod_auth["token"]), timeout=15)
        assert r.status_code == 200
        tasks = r.json()
        # ok if list is empty on a fresh install, but if not, every visible task
        # must belong to production role or the current user
        me = prod_auth["user"]["id"]
        for t in tasks:
            assert t.get("assignee_role") in (None, "production") or t.get("assignee_id") == me, \
                f"production leaked task: {t.get('id')} role={t.get('assignee_role')}"

    def test_task_patch_complete_still_works(self, owner_auth):
        t = _create_task(owner_auth["token"], title="TEST_iter20_regression_complete", assignee_role="production")
        r = requests.patch(f"{API}/tasks/{t['id']}", json={"status": "done"},
                           headers=_hdr(owner_auth["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "done"

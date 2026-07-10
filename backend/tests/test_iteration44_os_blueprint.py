"""
Iteration 44 - Industry Templates / Operating System blueprint

Covers:
- POST /api/onboarding/os-blueprint (AI generates OS)
- POST /api/auth/register with os_blueprint payload returns os_summary,
  stores workflow_templates/operational_task_templates/approval_rules,
  derives roles from departments.
- PATCH /api/tenant/os-blueprint updates the three template lists (owner ok).
"""
import os
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # fallback: read frontend .env
    p = "/app/frontend/.env"
    if os.path.exists(p):
        with open(p) as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    return ln.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"


# ------------------------ fixtures ------------------------

@pytest.fixture(scope="module")
def blueprint():
    """Generate one blueprint per module to save the LLM call cost."""
    r = requests.post(f"{API}/onboarding/os-blueprint",
                      json={"industry": "Manufacturing", "company_size": "11-50"},
                      timeout=90)
    assert r.status_code == 200, f"blueprint gen failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def registered(blueprint):
    """Register a fresh tenant using the blueprint."""
    ts = int(time.time())
    email = f"qatest+os{ts}@example.com"
    payload = {
        "company_name": f"TEST_OS_{ts}",
        "name": "QA Owner",
        "email": email,
        "password": "test1234",
        "industry": "Manufacturing",
        "os_blueprint": blueprint,
    }
    sess = requests.Session()
    r = sess.post(f"{API}/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return {"session": sess, "email": email, "data": data, "token": data.get("token")}


# ------------------------ os-blueprint generation ------------------------

class TestOsBlueprintGen:
    def test_shape(self, blueprint):
        assert isinstance(blueprint, dict)
        for k in ("departments", "workflows", "operational_tasks", "approval_rules"):
            assert k in blueprint, f"missing key {k}"
            assert isinstance(blueprint[k], list)

    def test_content_counts(self, blueprint):
        # normalised caps: 12 dept, 16 wf, 20 op, 10 rules
        assert 4 <= len(blueprint["departments"]) <= 12
        assert 4 <= len(blueprint["workflows"]) <= 16
        assert 4 <= len(blueprint["operational_tasks"]) <= 20
        assert 2 <= len(blueprint["approval_rules"]) <= 10

    def test_department_shape(self, blueprint):
        d = blueprint["departments"][0]
        assert "key" in d and "label" in d
        assert d["key"] and d["key"] != "owner"

    def test_workflow_shape(self, blueprint):
        w = blueprint["workflows"][0]
        assert "name" in w and w["name"]

    def test_optask_shape(self, blueprint):
        t = blueprint["operational_tasks"][0]
        assert "title" in t and "category" in t
        assert t["title"] and t["category"]

    def test_rule_shape(self, blueprint):
        r = blueprint["approval_rules"][0]
        assert "name" in r and r["name"]


# ------------------------ register w/ blueprint ------------------------

class TestRegisterWithBlueprint:
    def test_returns_os_summary(self, registered, blueprint):
        d = registered["data"]
        assert "os_summary" in d, f"os_summary missing: {d.keys()}"
        s = d["os_summary"]
        assert s["departments"] == len(blueprint["departments"])
        assert s["workflows"] == len(blueprint["workflows"])
        assert s["operational_tasks"] == len(blueprint["operational_tasks"])
        assert s["approval_rules"] == len(blueprint["approval_rules"])

    def test_departments_became_roles(self, registered, blueprint):
        tenant = registered["data"]["tenant"]
        role_keys = {r["key"] for r in tenant.get("roles", [])}
        for d in blueprint["departments"]:
            assert d["key"] in role_keys, f"dept {d['key']} not in tenant roles"
        assert "owner" not in role_keys  # owner is implicit

    def test_templates_stored_on_tenant(self, registered, blueprint):
        tenant = registered["data"]["tenant"]
        assert len(tenant.get("workflow_templates", [])) == len(blueprint["workflows"])
        assert len(tenant.get("operational_task_templates", [])) == len(blueprint["operational_tasks"])
        assert len(tenant.get("approval_rules", [])) == len(blueprint["approval_rules"])

    def test_duplicate_email_rejected(self, registered):
        # Same email should now return 400
        payload = {
            "company_name": "TEST_DUP",
            "name": "Dup",
            "email": registered["email"],
            "password": "test1234",
            "industry": "Manufacturing",
        }
        r = requests.post(f"{API}/auth/register", json=payload, timeout=15)
        assert r.status_code == 400


# ------------------------ PATCH /tenant/os-blueprint ------------------------

class TestPatchOsBlueprint:
    def test_add_workflow_persists(self, registered):
        sess = registered["session"]
        token = registered["token"]
        headers = {"Authorization": f"Bearer {token}"}
        me = sess.get(f"{API}/auth/me", headers=headers, timeout=15)
        assert me.status_code == 200
        tenant = me.json()["tenant"]
        wfs = list(tenant.get("workflow_templates", []))
        wfs.append({"name": "TEST_new_workflow"})

        r = sess.patch(f"{API}/tenant/os-blueprint",
                       headers=headers,
                       json={"workflow_templates": wfs},
                       timeout=15)
        assert r.status_code == 200, f"patch failed: {r.status_code} {r.text}"
        got = r.json()
        names = [w["name"] for w in got.get("workflow_templates", [])]
        assert "TEST_new_workflow" in names

        # GET to verify persisted
        me2 = sess.get(f"{API}/auth/me", headers=headers, timeout=15).json()
        names2 = [w["name"] for w in me2["tenant"].get("workflow_templates", [])]
        assert "TEST_new_workflow" in names2

    def test_update_rules(self, registered):
        sess = registered["session"]
        token = registered["token"]
        headers = {"Authorization": f"Bearer {token}"}
        rules = [{"name": "TEST_rule_A", "description": "must be approved"}]
        r = sess.patch(f"{API}/tenant/os-blueprint", headers=headers,
                       json={"approval_rules": rules}, timeout=15)
        assert r.status_code == 200
        out = r.json()["approval_rules"]
        assert len(out) == 1
        assert out[0]["name"] == "TEST_rule_A"

    def test_update_optasks(self, registered):
        sess = registered["session"]
        token = registered["token"]
        headers = {"Authorization": f"Bearer {token}"}
        tasks = [{"title": "TEST_task_1", "category": "Meeting"},
                 {"title": "TEST_task_2", "category": "Review"}]
        r = sess.patch(f"{API}/tenant/os-blueprint", headers=headers,
                       json={"operational_task_templates": tasks}, timeout=15)
        assert r.status_code == 200
        out = r.json()["operational_task_templates"]
        assert len(out) == 2
        assert out[0]["title"] == "TEST_task_1"
        assert out[0]["category"] == "Meeting"


# ------------------------ Legacy owner (no blueprint) ------------------------

class TestLegacyOwner:
    def test_legacy_owner_can_still_patch(self):
        sess = requests.Session()
        r = sess.post(f"{API}/auth/login",
                      json={"email": "owner@sharma.com", "password": "demo1234"},
                      timeout=15)
        assert r.status_code == 200
        token = r.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        r2 = sess.patch(f"{API}/tenant/os-blueprint", headers=headers,
                        json={"workflow_templates": [{"name": "TEST_legacy_wf"}]},
                        timeout=15)
        assert r2.status_code == 200
        names = [w["name"] for w in r2.json().get("workflow_templates", [])]
        assert "TEST_legacy_wf" in names

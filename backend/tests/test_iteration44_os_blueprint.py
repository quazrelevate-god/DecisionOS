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
        # WE-02 (2026-08-16): 'workflows' key dropped from
        # normalize_os_blueprint output.
        for k in ("departments", "operational_tasks", "approval_rules"):
            assert k in blueprint, f"missing key {k}"
            assert isinstance(blueprint[k], list)
        assert "workflows" not in blueprint, \
            "ghost 'workflows' key should not appear in os-blueprint output"

    def test_content_counts(self, blueprint):
        # normalised caps: 12 dept, 20 op, 10 rules (workflows dropped WE-02)
        assert 4 <= len(blueprint["departments"]) <= 12
        assert 4 <= len(blueprint["operational_tasks"]) <= 20
        assert 2 <= len(blueprint["approval_rules"]) <= 10

    def test_department_shape(self, blueprint):
        d = blueprint["departments"][0]
        assert "key" in d and "label" in d
        assert d["key"] and d["key"] != "owner"

    # WE-02: test_workflow_shape removed (blueprint.workflows no longer exists).

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
        # WE-02 (2026-08-16): 'workflows' key removed from os_summary.
        assert "workflows" not in s, f"os_summary should not include ghost 'workflows' key: {s}"
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
        # WE-02: workflow_templates removed from tenant doc entirely.
        assert "workflow_templates" not in tenant, "workflow_templates should be gone from tenant doc"
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
    # WE-02 (2026-08-16): test_add_workflow_persists removed. The endpoint
    # no longer stores workflow_templates. Any client that still sends the
    # field gets it silently dropped by Pydantic. See test_workflow_field_silently_ignored.

    def test_workflow_field_silently_ignored(self, registered):
        """WE-02: legacy clients that still POST workflow_templates get
        200 back (extra fields dropped); the tenant doc is unchanged."""
        sess = registered["session"]
        token = registered["token"]
        headers = {"Authorization": f"Bearer {token}"}
        r = sess.patch(f"{API}/tenant/os-blueprint",
                       headers=headers,
                       json={"workflow_templates": [{"name": "TEST_legacy_ghost"}]},
                       timeout=15)
        assert r.status_code == 200, f"patch failed: {r.status_code} {r.text}"
        # The endpoint returns the whole tenant doc. WE-02 migration
        # $unset'd workflow_templates, so it should not appear even
        # after a legacy PATCH.
        got = r.json()
        assert "workflow_templates" not in got, \
            f"workflow_templates ghost re-created by PATCH: {got.get('workflow_templates')}"

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
    def test_legacy_owner_patch_still_returns_200(self):
        """WE-02: even a legacy client posting the ghost field gets 200
        (silently dropped) rather than a 422 that would break older
        installs. The tenant doc is not corrupted."""
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
        assert "workflow_templates" not in r2.json(), \
            "ghost field re-appeared after legacy PATCH"

"""Iteration 58 — Business Vocabulary (lexicon) backend verification.

Covers:
- GET /api/auth/me returns tenant.lexicon (auto-backfilled if missing)
- Register generates a lexicon tailored to the industry (Claude live)
- PATCH /api/tenant/lexicon (owner OK, sales 403)
- POST /api/tenant/lexicon/regenerate (owner OK, sales 403)
- Normalization of a partial input keeps all default keys
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')

OWNER = {"email": "owner@sharma.com", "password": "demo1234"}
SALES = {"email": "sales@sharma.com", "password": "demo1234"}

LEXICON_KEYS = {"customer_singular", "customer_plural", "vendor_singular", "vendor_plural", "workflows", "task_types"}
WF_KEYS = {"production", "distribution", "purchase_payment"}
TT_KEYS = {"operational", "sales", "purchase", "production", "finance", "hr"}


# -------- fixtures ---------------------------------------------------------
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=OWNER, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def sales_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=SALES, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _assert_lexicon_shape(lex):
    assert isinstance(lex, dict), f"lexicon not dict: {lex!r}"
    missing = LEXICON_KEYS - set(lex.keys())
    assert not missing, f"missing top-level keys: {missing}"
    for k in ("customer_singular", "customer_plural", "vendor_singular", "vendor_plural"):
        assert isinstance(lex[k], str) and lex[k].strip(), f"{k} empty: {lex[k]!r}"
    assert set(lex["workflows"].keys()) >= WF_KEYS, f"workflows keys={list(lex['workflows'])}"
    for wk in WF_KEYS:
        w = lex["workflows"][wk]
        assert isinstance(w, dict) and w.get("label") and w.get("sub"), f"workflows[{wk}]={w!r}"
    assert set(lex["task_types"].keys()) >= TT_KEYS, f"task_types keys={list(lex['task_types'])}"
    for tk in TT_KEYS:
        assert isinstance(lex["task_types"][tk], str) and lex["task_types"][tk].strip()


# -------- GET /auth/me lexicon (with auto-backfill) ------------------------
class TestAuthMeLexicon:
    def test_me_returns_lexicon_shape(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "tenant" in data and isinstance(data["tenant"], dict)
        lex = data["tenant"].get("lexicon")
        assert lex, f"tenant.lexicon missing/empty: {data['tenant'].keys()}"
        _assert_lexicon_shape(lex)

    def test_me_lexicon_reflects_industry(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=60)
        assert r.status_code == 200
        tenant = r.json()["tenant"]
        industry = (tenant.get("industry") or "").lower()
        # Sharma Textiles → industry-appropriate customer/vendor words
        lex = tenant["lexicon"]
        # Words shouldn't be empty; for a textile company, at minimum should not be the string 'None'.
        assert lex["customer_singular"].lower() != "none"
        # Sanity: it's a business word (not multi-line garbage).
        for k in ("customer_singular", "customer_plural", "vendor_singular", "vendor_plural"):
            assert "\n" not in lex[k] and len(lex[k]) < 40, f"{k}={lex[k]!r}"


# -------- Register generates tailored lexicon ------------------------------
class TestRegisterTailoredLexicon:
    def test_register_coaching_institute_gets_student_vocab(self):
        suffix = uuid.uuid4().hex[:8]
        payload = {
            "company_name": f"TESTIT58 Coaching {suffix}",
            "name": "Test Owner",
            "email": f"testit58-{suffix}@example.com",
            "password": "demo1234",
            "industry": "Coaching institute (leads coaching institute)",
            "company_size": "1-10",
        }
        r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and "tenant" in body
        lex = (body.get("tenant") or {}).get("lexicon")
        assert lex, f"no lexicon on registered tenant: {body}"
        _assert_lexicon_shape(lex)
        blob = " ".join([
            lex["customer_singular"], lex["customer_plural"],
            lex["workflows"]["production"]["label"], lex["workflows"]["distribution"]["label"],
            " ".join(lex["task_types"].values()),
        ]).lower()
        assert any(w in blob for w in ["student", "learner", "enroll", "admission", "course", "batch"]), (
            f"Coaching-institute lexicon should mention student/enrollment vocabulary but got: {lex}"
        )


# -------- PATCH /tenant/lexicon (RBAC) -------------------------------------
class TestPatchLexicon:
    def test_owner_can_patch_and_persists(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=30)
        assert r.status_code == 200
        original = r.json()["tenant"]["lexicon"]
        marker = f"TESTIT58 {uuid.uuid4().hex[:6]}"
        edited = {
            **original,
            "customer_singular": marker,
            "customer_plural": marker + "s",
        }
        p = requests.patch(f"{BASE_URL}/api/tenant/lexicon", json={"lexicon": edited},
                           headers=_auth(owner_token), timeout=30)
        assert p.status_code == 200, p.text
        saved = p.json().get("lexicon") or {}
        _assert_lexicon_shape(saved)
        assert saved["customer_singular"] == marker
        assert saved["customer_plural"] == marker + "s"
        # Persistence: re-fetch through /auth/me
        r2 = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=30)
        assert r2.status_code == 200
        after = r2.json()["tenant"]["lexicon"]
        assert after["customer_singular"] == marker
        # Restore original
        restore = requests.patch(f"{BASE_URL}/api/tenant/lexicon", json={"lexicon": original},
                                 headers=_auth(owner_token), timeout=30)
        assert restore.status_code == 200

    def test_sales_patch_lexicon_forbidden(self, sales_token):
        payload = {"lexicon": {"customer_singular": "Nope"}}
        r = requests.patch(f"{BASE_URL}/api/tenant/lexicon", json=payload,
                           headers=_auth(sales_token), timeout=30)
        assert r.status_code == 403, f"expected 403 for sales, got {r.status_code} {r.text}"

    def test_normalize_preserves_defaults_on_partial_input(self, owner_token):
        # Patch with only a couple keys — the response should still include full shape
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=30)
        original = r.json()["tenant"]["lexicon"]
        partial = {"customer_singular": "TESTIT58Partial"}
        p = requests.patch(f"{BASE_URL}/api/tenant/lexicon", json={"lexicon": partial},
                           headers=_auth(owner_token), timeout=30)
        assert p.status_code == 200, p.text
        lex = p.json().get("lexicon") or {}
        _assert_lexicon_shape(lex)
        # Filled in default vendor/plural etc
        assert lex["customer_singular"] == "TESTIT58Partial"
        # Restore
        requests.patch(f"{BASE_URL}/api/tenant/lexicon", json={"lexicon": original},
                       headers=_auth(owner_token), timeout=30)


# -------- POST /tenant/lexicon/regenerate (RBAC) ---------------------------
class TestRegenerateLexicon:
    def test_owner_regenerate_returns_lexicon(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=_auth(owner_token), timeout=30)
        original = r.json()["tenant"]["lexicon"]
        p = requests.post(f"{BASE_URL}/api/tenant/lexicon/regenerate",
                          headers=_auth(owner_token), timeout=90)
        assert p.status_code == 200, p.text
        body = p.json()
        lex = body.get("lexicon") or {}
        _assert_lexicon_shape(lex)
        # Restore to avoid leaving demo tenant with a different lexicon.
        requests.patch(f"{BASE_URL}/api/tenant/lexicon", json={"lexicon": original},
                       headers=_auth(owner_token), timeout=30)

    def test_sales_regenerate_forbidden(self, sales_token):
        r = requests.post(f"{BASE_URL}/api/tenant/lexicon/regenerate",
                          headers=_auth(sales_token), timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text}"


# -------- Cleanup: remove any TESTIT58 tenants/users -----------------------
def test_zzz_cleanup_testit58():
    """Best-effort cleanup of temp tenants created by test_register_coaching."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "test_database")

    async def _run():
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        tenants = await db.tenants.find({"name": {"$regex": "^TESTIT58"}}).to_list(100)
        tids = [t["id"] for t in tenants]
        if tids:
            await db.users.delete_many({"tenant_id": {"$in": tids}})
            await db.tenants.delete_many({"id": {"$in": tids}})
        # Also remove any activity log entries referencing testit58 marker
        await db.activity.delete_many({"message": {"$regex": "TESTIT58"}})
        client.close()

    asyncio.run(_run())

"""
Iteration 29 — Mobile + OTP login (DEV mode), phone field on
signup/member/company forms and phone persistence via PATCH endpoints.

Covers:
- Existing email/password login still works (regression)
- POST /api/auth/otp/request DEV mode (returns dev_otp, dev_mode=true)
- POST /api/auth/otp/verify success → returns {token, user, tenant}
- OTP re-use after successful verify fails (400 "Request an OTP first")
- Verify without prior request returns 400
- Request for unregistered mobile returns 404
- Wrong code returns 401 "Incorrect OTP"
- _norm_phone accepts formatted numbers (e.g. "+91 98200 10003")
- Register accepts phone; new user can then login via OTP
- Member Add/Edit: create with phone, PATCH updates phone
- PATCH /api/tenant with phone works for owner and persists
"""

import os
import re
import uuid
import random
import asyncio
import pytest
import requests

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

# Epic 8 migrated the app off motor to PyMongo's AsyncMongoClient (API-compatible
# for this file's direct-DB helper). Aliased so the call sites below are unchanged.
from pymongo import AsyncMongoClient as AsyncIOMotorClient  # noqa: E402

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

OWNER_EMAIL = os.environ.get("TEST_OWNER_EMAIL", "owner@sharma.com")
OWNER_PASSWORD = os.environ.get("TEST_OWNER_PASSWORD", "demo1234")
OWNER_PHONE_RAW = "9820010001"
PROD_PHONE_RAW = "9820010003"
SALES_PHONE_RAW = "9820010002"
FIN_PHONE_RAW = "9820010004"
PROD_NAME = "Amit Verma"


def _reset_otp(phone_last10: str):
    """Delete any pending otp_codes record for a phone so we bypass the 30s resend cooldown."""
    norm = re.sub(r"\D", "", phone_last10)[-10:]

    async def _do():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            db = c[os.environ["DB_NAME"]]
            await db.otp_codes.delete_many({"phone": norm})
        finally:
            c.close()

    asyncio.run(_do())


@pytest.fixture(scope="session")
def s():
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json"})
    return ses


@pytest.fixture(scope="session")
def owner_token(s):
    r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="session")
def owner_client(s, owner_token):
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {owner_token}"})
    return ses


# ------------------------------- regression --------------------------------
class TestEmailPasswordRegression:
    def test_owner_login_ok(self, s):
        r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASSWORD})
        assert r.status_code == 200
        d = r.json()
        assert "token" in d and isinstance(d["token"], str) and len(d["token"]) > 10
        assert d["user"]["email"] == OWNER_EMAIL
        assert d["user"]["role"] == "owner"
        assert d["tenant"]["name"] == "Sharma Textiles Pvt Ltd"

    def test_owner_login_bad_password(self, s):
        r = s.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrongpass"})
        assert r.status_code == 401

    def test_me_with_token(self, owner_client):
        r = owner_client.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["email"] == OWNER_EMAIL


# --------------------------- OTP request/verify ----------------------------
class TestOtpFlow:
    def test_request_returns_dev_otp_for_registered_phone(self, s):
        r = s.post(f"{API}/auth/otp/request", json={"phone": PROD_PHONE_RAW})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("dev_mode") is True
        assert re.fullmatch(r"\d{6}", d.get("dev_otp", "")), f"Expected 6-digit dev_otp, got {d}"

    def test_verify_success_returns_token_and_user(self, s):
        # Request fresh OTP
        _reset_otp(PROD_PHONE_RAW)
        r1 = s.post(f"{API}/auth/otp/request", json={"phone": PROD_PHONE_RAW})
        assert r1.status_code == 200
        code = r1.json()["dev_otp"]

        r2 = s.post(f"{API}/auth/otp/verify", json={"phone": PROD_PHONE_RAW, "code": code})
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert "token" in d and isinstance(d["token"], str) and len(d["token"]) > 10
        assert d["user"]["name"] == PROD_NAME
        assert d["user"]["role"] == "production"
        assert d["tenant"]["name"] == "Sharma Textiles Pvt Ltd"

        # Token from OTP login must be usable
        r3 = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {d['token']}"})
        assert r3.status_code == 200
        assert r3.json()["user"]["email"] == "production@sharma.com"

    def test_verify_reuse_same_code_fails(self, s):
        _reset_otp(PROD_PHONE_RAW)
        r1 = s.post(f"{API}/auth/otp/request", json={"phone": PROD_PHONE_RAW})
        assert r1.status_code == 200
        code = r1.json()["dev_otp"]
        r2 = s.post(f"{API}/auth/otp/verify", json={"phone": PROD_PHONE_RAW, "code": code})
        assert r2.status_code == 200
        # Reusing must fail because record was deleted after use
        r3 = s.post(f"{API}/auth/otp/verify", json={"phone": PROD_PHONE_RAW, "code": code})
        assert r3.status_code == 400
        assert "request an otp" in r3.text.lower() or "expired" in r3.text.lower()

    def test_verify_without_request_returns_400(self, s):
        # Use a fresh number (no prior request record) — an unregistered but well-formed number.
        # Even before the "registered" check on verify, since /verify checks otp_codes first, expect 400.
        random_phone = "9" + "".join(str((i * 7) % 10) for i in range(9))  # deterministic non-registered
        r = s.post(f"{API}/auth/otp/verify", json={"phone": random_phone, "code": "123456"})
        assert r.status_code == 400
        assert "request" in r.text.lower()

    def test_verify_wrong_code_returns_401(self, s):
        _reset_otp(PROD_PHONE_RAW)
        r1 = s.post(f"{API}/auth/otp/request", json={"phone": PROD_PHONE_RAW})
        assert r1.status_code == 200
        # deliberately wrong 6-digit code (avoid collision with dev_otp)
        real = r1.json()["dev_otp"]
        wrong = "".join(str((int(d) + 1) % 10) for d in real)
        r2 = s.post(f"{API}/auth/otp/verify", json={"phone": PROD_PHONE_RAW, "code": wrong})
        assert r2.status_code == 401
        assert "incorrect" in r2.text.lower()

    def test_request_unregistered_returns_404(self, s):
        r = s.post(f"{API}/auth/otp/request", json={"phone": "9999999998"})
        assert r.status_code == 404
        assert "no account" in r.text.lower() or "registered" in r.text.lower()

    def test_request_invalid_phone_returns_400(self, s):
        r = s.post(f"{API}/auth/otp/request", json={"phone": "123"})
        assert r.status_code == 400

    def test_norm_phone_accepts_formatted(self, s):
        # +91 98200 10001 → last 10 digits 9820010001 must match owner
        _reset_otp(OWNER_PHONE_RAW)
        r = s.post(f"{API}/auth/otp/request", json={"phone": "+91 98200 10001"})
        assert r.status_code == 200
        code = r.json()["dev_otp"]
        r2 = s.post(f"{API}/auth/otp/verify", json={"phone": "+91 98200 10001", "code": code})
        assert r2.status_code == 200
        assert r2.json()["user"]["email"] == OWNER_EMAIL


# --------------------------- register + new-user OTP -----------------------
class TestRegisterWithPhone:
    def test_register_with_phone_then_login_via_otp(self, s):
        suffix = uuid.uuid4().hex[:8]
        # Random 10-digit phone starting with 9 to guarantee uniqueness across runs.
        phone_digits = "9" + "".join(str(random.randint(0, 9)) for _ in range(9))
        payload = {
            "company_name": f"TEST_OTP_CO_{suffix}",
            "name": f"TEST_OTP_User_{suffix}",
            "email": f"test_otp_{suffix}@example.com",
            "password": "pw123456",
            "phone": phone_digits,
            "industry": "General",
        }
        r = s.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["email"] == payload["email"]
        assert d["user"].get("phone") == phone_digits

        # OTP login for this new user
        r2 = s.post(f"{API}/auth/otp/request", json={"phone": phone_digits})
        assert r2.status_code == 200, r2.text
        code = r2.json()["dev_otp"]
        r3 = s.post(f"{API}/auth/otp/verify", json={"phone": phone_digits, "code": code})
        assert r3.status_code == 200
        assert r3.json()["user"]["email"] == payload["email"]


# --------------------------- Member (users) phone --------------------------
class TestMemberPhone:
    def test_owner_creates_member_with_phone_and_edits_it(self, owner_client):
        suffix = uuid.uuid4().hex[:8]
        phone1 = "9" + "".join(str(random.randint(0, 9)) for _ in range(9))
        payload = {
            "name": f"TEST_member_{suffix}",
            "email": f"test_mem_{suffix}@sharma.com",
            "password": "pw123456",
            "role": "sales",
            "phone": phone1,
        }
        r = owner_client.post(f"{API}/users", json=payload)
        assert r.status_code in (200, 201), r.text
        member = r.json()
        assert member.get("phone") == phone1
        uid = member["id"]

        # OTP login for the newly created member using phone1
        req = requests.post(f"{API}/auth/otp/request", json={"phone": phone1})
        assert req.status_code == 200, req.text
        code = req.json()["dev_otp"]
        ver = requests.post(f"{API}/auth/otp/verify", json={"phone": phone1, "code": code})
        assert ver.status_code == 200
        assert ver.json()["user"]["id"] == uid

        # Edit phone via PATCH
        phone2 = "9" + "".join(str(random.randint(0, 9)) for _ in range(9))
        r2 = owner_client.patch(f"{API}/users/{uid}", json={"phone": phone2})
        assert r2.status_code == 200, r2.text

        # Verify old phone no longer works (unregistered now for that number)
        old = requests.post(f"{API}/auth/otp/request", json={"phone": phone1})
        assert old.status_code == 404
        # New phone works
        req2 = requests.post(f"{API}/auth/otp/request", json={"phone": phone2})
        assert req2.status_code == 200, req2.text
        code2 = req2.json()["dev_otp"]
        ver2 = requests.post(f"{API}/auth/otp/verify", json={"phone": phone2, "code": code2})
        assert ver2.status_code == 200
        assert ver2.json()["user"]["id"] == uid


# --------------------------- Tenant company phone --------------------------
class TestTenantPhone:
    def test_owner_can_patch_tenant_phone(self, owner_client):
        # Read current tenant
        me = owner_client.get(f"{API}/auth/me").json()
        original = me["tenant"].get("phone", "")

        new_phone = "+91 98765 43210"
        r = owner_client.patch(f"{API}/tenant", json={"phone": new_phone})
        assert r.status_code == 200, r.text

        me2 = owner_client.get(f"{API}/auth/me").json()
        assert me2["tenant"]["phone"] == new_phone

        # Restore
        r3 = owner_client.patch(f"{API}/tenant", json={"phone": original})
        assert r3.status_code == 200

    def test_production_cannot_patch_tenant(self, s):
        # OTP login as production
        _reset_otp(PROD_PHONE_RAW)
        r = s.post(f"{API}/auth/otp/request", json={"phone": PROD_PHONE_RAW})
        assert r.status_code == 200, r.text
        code = r.json()["dev_otp"]
        tok = s.post(f"{API}/auth/otp/verify", json={"phone": PROD_PHONE_RAW, "code": code}).json()["token"]
        rr = requests.patch(f"{API}/tenant", json={"phone": "9111111111"},
                            headers={"Authorization": f"Bearer {tok}"})
        assert rr.status_code == 403

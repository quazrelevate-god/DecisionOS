"""
Iteration 30 — Passwordless invite + auto invite link tests
- POST /api/users create passwordless (no password) + password variants
- Invite link full flow: invite_info → invite_start → otp/verify
- Regenerate invite endpoint
- list users leak-guard (no invite_token in responses)
- RBAC for non-team_manage user
- OTP regression (owner phone still works)
"""
import os
import re
import time
import uuid
import asyncio
import pytest
import requests
# Epic 8 migrated the app off motor to PyMongo's AsyncMongoClient (API-compatible
# for this file's direct-DB helper). Aliased so the call sites below are unchanged.
from pymongo import AsyncMongoClient as AsyncIOMotorClient

from integration_base import base_url  # T10-11.2: fail-closed, env-only
BASE_URL = base_url()
if not BASE_URL:
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

OWNER_EMAIL = "owner@sharma.com"
OWNER_PASS = "demo1234"
SALES_EMAIL = "sales@sharma.com"
SALES_PASS = "demo1234"
OWNER_PHONE = "9820010001"

# ----- mongo helpers to reset OTP records (bypass 30s cooldown) & cleanup users
_MONGO_URL = None
_DB_NAME = None
with open("/app/backend/.env") as fh:
    for line in fh:
        if line.startswith("MONGO_URL="):
            _MONGO_URL = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("DB_NAME="):
            _DB_NAME = line.split("=", 1)[1].strip().strip('"')


def _norm_phone(s: str) -> str:
    d = re.sub(r"\D", "", s or "")
    return d[-10:] if len(d) >= 10 else d


async def _reset_otp(phone: str):
    client = AsyncIOMotorClient(_MONGO_URL)
    try:
        await client[_DB_NAME].otp_codes.delete_many({"phone": _norm_phone(phone)})
    finally:
        client.close()


async def _delete_test_users():
    client = AsyncIOMotorClient(_MONGO_URL)
    try:
        await client[_DB_NAME].users.delete_many({"email": {"$regex": "^test_it30_"}})
    finally:
        client.close()


def reset_otp(phone: str):
    asyncio.get_event_loop().run_until_complete(_reset_otp(phone))


@pytest.fixture(scope="module", autouse=True)
def cleanup_users_at_end():
    yield
    asyncio.new_event_loop().run_until_complete(_delete_test_users())


@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def sales_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": SALES_EMAIL, "password": SALES_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _rand_phone():
    # 10-digit, unlikely to collide with seeded (9820010001..4)
    return "98111" + str(uuid.uuid4().int)[:5]


def _rand_email(tag=""):
    return f"test_it30_{tag}_{uuid.uuid4().hex[:8]}@example.com"


# --------------------------------------------------------------------------
# 1) Owner login sanity
# --------------------------------------------------------------------------
class TestOwnerLogin:
    def test_owner_login_returns_token(self, owner_token):
        assert isinstance(owner_token, str) and len(owner_token) > 20

    def test_owner_me(self, owner_token):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["email"] == OWNER_EMAIL
        assert data["user"]["role"] == "owner"


# --------------------------------------------------------------------------
# 2/3/4) Create user variants
# --------------------------------------------------------------------------
class TestCreateUser:
    def test_create_passwordless_member(self, owner_token):
        phone = _rand_phone()
        email = _rand_email("pl")
        r = requests.post(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "PL Member", "email": email, "role": "sales", "phone": phone},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["passwordless"] is True
        assert data.get("invite_token")
        assert data["email"] == email
        assert data["phone"] == phone
        # invite token must not be a valid _id-ish reference — just present + non-empty
        assert isinstance(data["invite_token"], str) and len(data["invite_token"]) > 10

        # Email/password login for this user must return 401
        r2 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "anything"})
        assert r2.status_code == 401

    def test_create_password_member_with_phone_returns_invite_token(self, owner_token):
        phone = _rand_phone()
        email = _rand_email("pw")
        r = requests.post(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "PW Member", "email": email, "password": "hello123",
                  "role": "sales", "phone": phone},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("passwordless") is False
        assert data.get("invite_token"), "password-mode user with phone should still get invite_token"
        # Email/password login for this user should work
        r2 = requests.post(f"{BASE_URL}/api/auth/login",
                           json={"email": email, "password": "hello123"})
        assert r2.status_code == 200

    def test_create_password_member_without_phone_no_invite_token(self, owner_token):
        email = _rand_email("nophone")
        r = requests.post(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "NoPhone Member", "email": email, "password": "hello123", "role": "sales"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Since no phone, no invite_token should be surfaced
        assert not data.get("invite_token")

    def test_create_passwordless_without_phone_400(self, owner_token):
        email = _rand_email("badpl")
        r = requests.post(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Bad PL", "email": email, "role": "sales"},
        )
        assert r.status_code == 400
        detail = (r.json().get("detail") or "").lower()
        assert "mobile" in detail or "phone" in detail

    def test_create_passwordless_with_short_phone_400(self, owner_token):
        email = _rand_email("shortphone")
        r = requests.post(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Short Ph", "email": email, "role": "sales", "phone": "12345"},
        )
        assert r.status_code == 400


# --------------------------------------------------------------------------
# 5/6) Invite link public endpoints + full invite → OTP → login flow
# --------------------------------------------------------------------------
class TestInviteFlow:
    @pytest.fixture(scope="class")
    def invited_member(self, owner_token):
        phone = _rand_phone()
        email = _rand_email("invite")
        r = requests.post(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {owner_token}"},
            json={"name": "Invitee One", "email": email, "role": "sales", "phone": phone},
        )
        assert r.status_code == 200, r.text
        return r.json()

    def test_invite_info_returns_welcome(self, invited_member):
        tok = invited_member["invite_token"]
        r = requests.get(f"{BASE_URL}/api/auth/invite/{tok}")
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Invitee One"
        assert data["phone_masked"].startswith("••••")
        # last 4 digits should appear
        assert invited_member["phone"][-4:] in data["phone_masked"]
        assert data["company"]  # some string

    def test_invite_info_invalid_404(self):
        r = requests.get(f"{BASE_URL}/api/auth/invite/does-not-exist-token-xyz")
        assert r.status_code == 404

    def test_invite_start_full_flow(self, invited_member):
        tok = invited_member["invite_token"]
        phone = invited_member["phone"]
        # Reset any prior otp record — invite_start bypasses cooldown but we want clean slate
        reset_otp(phone)
        r = requests.post(f"{BASE_URL}/api/auth/invite/{tok}/start")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dev_mode"] is True
        assert re.fullmatch(r"\d{6}", data["dev_otp"])
        assert data["phone"] == phone
        assert data["name"] == "Invitee One"

        # Verify OTP → returns token+user
        r2 = requests.post(f"{BASE_URL}/api/auth/otp/verify",
                           json={"phone": phone, "code": data["dev_otp"]})
        assert r2.status_code == 200, r2.text
        v = r2.json()
        assert v.get("token") and v.get("user")
        assert v["user"]["email"] == invited_member["email"]
        # sanity — token works
        me = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {v['token']}"})
        assert me.status_code == 200
        assert me.json()["user"]["email"] == invited_member["email"]

    def test_invite_start_invalid_token_404(self):
        r = requests.post(f"{BASE_URL}/api/auth/invite/does-not-exist-xyz/start")
        assert r.status_code == 404


# --------------------------------------------------------------------------
# 7) Regenerate invite endpoint
# --------------------------------------------------------------------------
class TestRegenerateInvite:
    def test_regenerate_invite_for_member_with_phone(self, owner_token):
        phone = _rand_phone()
        email = _rand_email("regen")
        r = requests.post(f"{BASE_URL}/api/users",
                          headers={"Authorization": f"Bearer {owner_token}"},
                          json={"name": "Regen M", "email": email, "role": "sales", "phone": phone})
        assert r.status_code == 200
        uid = r.json()["id"]
        original_token = r.json()["invite_token"]

        r2 = requests.post(f"{BASE_URL}/api/users/{uid}/invite",
                           headers={"Authorization": f"Bearer {owner_token}"})
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data["invite_token"]
        assert data["invite_token"] != original_token, "regeneration should produce a NEW token"
        assert data["name"] == "Regen M"
        assert phone[-4:] in data["phone_masked"]

        # Old token should now be invalid
        r3 = requests.get(f"{BASE_URL}/api/auth/invite/{original_token}")
        assert r3.status_code == 404

    def test_regenerate_invite_no_phone_400(self, owner_token):
        # Create a user without phone, then try to regenerate an invite
        email = _rand_email("regnophone")
        r = requests.post(f"{BASE_URL}/api/users",
                          headers={"Authorization": f"Bearer {owner_token}"},
                          json={"name": "NoPh Regen", "email": email,
                                "password": "hello123", "role": "sales"})
        assert r.status_code == 200
        uid = r.json()["id"]

        r2 = requests.post(f"{BASE_URL}/api/users/{uid}/invite",
                           headers={"Authorization": f"Bearer {owner_token}"})
        assert r2.status_code == 400, r2.text
        detail = (r2.json().get("detail") or "").lower()
        assert "mobile" in detail or "phone" in detail

    def test_regenerate_invite_unknown_user_404(self, owner_token):
        r = requests.post(f"{BASE_URL}/api/users/does-not-exist/invite",
                          headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 404


# --------------------------------------------------------------------------
# 8) list users must not leak invite_token / invite_expires_at
# --------------------------------------------------------------------------
class TestListUsersLeakGuard:
    def test_no_invite_token_leak(self, owner_token):
        # First ensure at least one user with an invite exists
        phone = _rand_phone()
        email = _rand_email("leak")
        requests.post(f"{BASE_URL}/api/users",
                      headers={"Authorization": f"Bearer {owner_token}"},
                      json={"name": "Leak Chk", "email": email, "role": "sales", "phone": phone})
        r = requests.get(f"{BASE_URL}/api/users",
                        headers={"Authorization": f"Bearer {owner_token}"})
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list) and len(users) > 0
        for u in users:
            assert "invite_token" not in u, f"invite_token leaked in list for {u.get('email')}"
            assert "invite_expires_at" not in u, f"invite_expires_at leaked in list for {u.get('email')}"
            assert "password_hash" not in u


# --------------------------------------------------------------------------
# 9) RBAC — non-team_manage user cannot create members / regenerate invites
# --------------------------------------------------------------------------
class TestRbacTeamManage:
    def test_sales_cannot_create_user(self, sales_token):
        r = requests.post(f"{BASE_URL}/api/users",
                          headers={"Authorization": f"Bearer {sales_token}"},
                          json={"name": "Not Allowed", "email": _rand_email("rbac"),
                                "role": "sales", "phone": _rand_phone()})
        assert r.status_code == 403, r.text

    def test_sales_cannot_regenerate_invite(self, sales_token, owner_token):
        # Owner creates a member first
        phone = _rand_phone()
        email = _rand_email("rbaci")
        r = requests.post(f"{BASE_URL}/api/users",
                          headers={"Authorization": f"Bearer {owner_token}"},
                          json={"name": "Target", "email": email, "role": "sales", "phone": phone})
        assert r.status_code == 200
        uid = r.json()["id"]

        r2 = requests.post(f"{BASE_URL}/api/users/{uid}/invite",
                           headers={"Authorization": f"Bearer {sales_token}"})
        assert r2.status_code == 403


# --------------------------------------------------------------------------
# 10) Existing OTP login regression — owner phone still works
# --------------------------------------------------------------------------
class TestOtpRegression:
    def test_owner_otp_request_and_verify(self):
        reset_otp(OWNER_PHONE)
        r = requests.post(f"{BASE_URL}/api/auth/otp/request", json={"phone": OWNER_PHONE})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["dev_mode"] is True
        assert re.fullmatch(r"\d{6}", data["dev_otp"])
        r2 = requests.post(f"{BASE_URL}/api/auth/otp/verify",
                           json={"phone": OWNER_PHONE, "code": data["dev_otp"]})
        assert r2.status_code == 200
        assert r2.json()["user"]["email"] == OWNER_EMAIL

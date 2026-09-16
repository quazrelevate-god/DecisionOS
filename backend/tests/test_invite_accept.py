"""Signing in accepts the invite (2026-09-16).

A member is created as a `pending` membership row and nothing moved that row to
`active`. Since 59e9684 a pending row also blocks the legacy user.tenant_id
fallback in get_current_user, so an invited member came out of the OTP flow
holding a session token and was refused on their very next request. These tests
drive the real endpoints against an isolated db:

  * OTP verify flips pending -> active, so the membership deps looks for exists.
  * Suspended rows are not a state someone logs their way out of.
  * A workspace that filled up after the invite went out still lets them in
    (the seat is recounted, not reserved at the door).
  * A password sign-in accepts the invite too - the workspace picker only ever
    listed live memberships.
  * The invite link keeps the ordinary 30s OTP cooldown, and a re-tap inside it
    still returns what the device needs instead of an error.
"""
import os
from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException, Response

import routers.auth_otp as aotp
import services.otp as otpmod
from models.auth import OtpVerifyInput
from services.auth.membership import (
    create_membership, find_membership, accept_pending_membership,
    legacy_access_allowed, LIVE_STATUSES,
    STATUS_PENDING, STATUS_ACTIVE, STATUS_SUSPENDED,
)

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

CODE = "424242"
PHONE = "9876500077"


def _patch(testdb):
    saved = (aotp.db, otpmod.db, otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms)
    aotp.db = testdb
    otpmod.db = testdb

    async def _apm(norm):
        return CODE

    async def _sms(phone, code):
        return True

    otpmod._apm_send_and_fetch_otp = _apm
    otpmod._send_otp_sms = _sms

    def restore():
        aotp.db, otpmod.db, otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms = saved
    return restore


async def _seed_invited(db, *, status=STATUS_PENDING, uid="u-invited", tenant_id="tA",
                        phone=PHONE, token="tok-invite", tenant_extra=None):
    """A member exactly as POST /users leaves them: user doc + invite token +
    a membership row that stays pending until they sign in."""
    await db.tenants.update_one(
        {"id": tenant_id},
        {"$set": {"id": tenant_id, "name": "Alpha Traders", **(tenant_extra or {})}},
        upsert=True,
    )
    await db.users.insert_one({
        "id": uid, "tenant_id": tenant_id, "name": "Asha", "role": "sales",
        "email": uid + "@alphatraders.co",
        "phone": phone, "phone_norm": phone[-10:],
        "invite_token": token,
        "invite_expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    })
    await create_membership(
        db, user_id=uid, tenant_id=tenant_id, role="sales", permissions=[],
        status=status, invite_token=token,
    )


# ---------------------------------------------------------------------------
# The regression itself: the invite link has to end in a usable session.
# ---------------------------------------------------------------------------
def test_otp_sign_in_accepts_the_pending_invite(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await _seed_invited(db)
            await aotp.invite_start("tok-invite")
            await aotp.verify_otp(OtpVerifyInput(phone=PHONE, code=CODE), Response())
            row = await find_membership(db, "u-invited", "tA")
            live = await find_membership(db, "u-invited", "tA", statuses=LIVE_STATUSES)
            # get_current_user's other door: with a membership row present the
            # legacy fallback is closed, so the live row IS the access.
            legacy = await legacy_access_allowed(
                db, {"id": "u-invited", "tenant_id": "tA", "role": "sales"}, "tA")
            return row["status"], bool(row.get("accepted_at")), bool(live), legacy
        finally:
            restore()

    status, accepted, live, legacy = with_test_db(scenario)
    assert status == STATUS_ACTIVE, "signing in IS accepting the invite"
    assert accepted, "the accept is stamped on the membership"
    assert live, "deps looks for a live membership - an invited member must now have one"
    assert legacy is False, "and they are let in by that row, not by the legacy fallback"


def test_a_suspended_member_cannot_sign_their_way_back_in(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await _seed_invited(db, status=STATUS_SUSPENDED)
            await aotp.invite_start("tok-invite")
            await aotp.verify_otp(OtpVerifyInput(phone=PHONE, code=CODE), Response())
            row = await find_membership(db, "u-invited", "tA")
            live = await find_membership(db, "u-invited", "tA", statuses=LIVE_STATUSES)
            return row["status"], live
        finally:
            restore()

    status, live = with_test_db(scenario)
    assert status == STATUS_SUSPENDED, "suspension is a decision about them, not a login state"
    assert live is None, "and they still hold no live membership"


def test_a_full_workspace_still_admits_someone_already_invited(with_test_db):
    """The seat is taken when they arrive, not held while the invite sits in
    their WhatsApp - so a workspace that filled up meanwhile must not turn an
    invited member away at the door."""
    async def scenario(db):
        restore = _patch(db)
        try:
            # starter plan: 3 seats, all of them already counted as used
            await _seed_invited(db, tenant_extra={"plan": "starter", "seats_used": 3})
            for i in range(3):
                await create_membership(db, user_id="u-seat" + str(i), tenant_id="tA",
                                        role="sales", permissions=[], status=STATUS_ACTIVE)
            await db.tenants.update_one({"id": "tA"}, {"$set": {"seats_used": 3}})
            await aotp.invite_start("tok-invite")
            await aotp.verify_otp(OtpVerifyInput(phone=PHONE, code=CODE), Response())
            row = await find_membership(db, "u-invited", "tA")
            tenant = await db.tenants.find_one({"id": "tA"}, {"_id": 0, "seats_used": 1})
            return row["status"], tenant.get("seats_used")
        finally:
            restore()

    status, seats_used = with_test_db(scenario)
    assert status == STATUS_ACTIVE, "an invited member is not locked out by the seat cap"
    assert seats_used == 4, "the seat count is corrected instead - the next ADD is what gets blocked"


# ---------------------------------------------------------------------------
# The same rule on the password door.
# ---------------------------------------------------------------------------
def test_password_sign_in_accepts_the_pending_invite(with_test_db):
    async def scenario(db):
        import routers.auth as rauth
        from starlette.requests import Request
        from core import hash_password
        from models.auth import LoginInput

        saved_db = rauth.db
        rauth.db = db
        try:
            await _seed_invited(db, uid="u-pw", token=None, phone="9876500088")
            await db.users.update_one({"id": "u-pw"},
                                      {"$set": {"password_hash": hash_password("secret123")}})
            req = Request({"type": "http", "method": "POST", "path": "/api/auth/login",
                           "headers": [], "query_string": b"", "client": ("10.0.0.1", 0)})
            out = await rauth.login(LoginInput(email="u-pw@alphatraders.co", password="secret123"),
                                    req, Response())
            row = await find_membership(db, "u-pw", "tA")
            return bool(out.get("token") or out.get("user")), row["status"]
        finally:
            rauth.db = saved_db

    signed_in, status = with_test_db(scenario)
    assert signed_in, "an invited member can sign in with their password"
    assert status == STATUS_ACTIVE, "and that sign-in accepts the invite"


def test_an_unrelated_pending_invite_is_not_accepted_by_signing_in_elsewhere(with_test_db):
    """Two pending invites and no workspace named: accepting one of them would
    be choosing for the member (and spending a seat they never claimed)."""
    async def scenario(db):
        await _seed_invited(db, uid="u-two", tenant_id="tA", token="tok-a", phone="9876500099")
        await db.tenants.update_one({"id": "tB"}, {"$set": {"id": "tB", "name": "Beta"}}, upsert=True)
        await create_membership(db, user_id="u-two", tenant_id="tB", role="sales",
                                permissions=[], status=STATUS_PENDING)
        picked = await accept_pending_membership(db, "u-two")
        rows = {m["tenant_id"]: m["status"]
                for m in await db.memberships.find({"user_id": "u-two"}, {"_id": 0}).to_list(10)}
        named = await accept_pending_membership(db, "u-two", "tB")
        return picked, rows, (named or {}).get("status")

    picked, rows, named_status = with_test_db(scenario)
    assert picked is None, "ambiguous - leave it to the invite link for that workspace"
    assert rows == {"tA": STATUS_PENDING, "tB": STATUS_PENDING}, "neither invite was spent"
    assert named_status == STATUS_ACTIVE, "naming the workspace accepts that one"


# ---------------------------------------------------------------------------
# An invite link is a forwarded URL anyone can tap - it texts on the same
# cooldown as an ordinary login, without dead-ending the person who tapped.
# ---------------------------------------------------------------------------
def test_invite_link_keeps_the_otp_cooldown_without_dead_ending(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await _seed_invited(db)
            first = await aotp.invite_start("tok-invite")
            row1 = await db.otp_codes.find_one({"phone": PHONE}, {"_id": 0})
            second = await aotp.invite_start("tok-invite")
            row2 = await db.otp_codes.find_one({"phone": PHONE}, {"_id": 0})
            n = await db.otp_codes.count_documents({"phone": PHONE})
            # the code from the FIRST send still works
            await aotp.verify_otp(OtpVerifyInput(phone=PHONE, code=CODE), Response())
            return (first.get("phone"), second.get("phone"), second.get("name"),
                    row1["created_at"] == row2["created_at"], n)
        finally:
            restore()

    p1, p2, name, same_code, n = with_test_db(scenario)
    assert p1 == PHONE and p2 == PHONE, "a re-tap still hands the device the number to verify"
    assert name == "Asha", "and the welcome it renders"
    assert same_code, "no second SMS inside the cooldown - the live code stands"
    assert n == 1, "one OTP row for the invite, not one per tap"


def test_invite_start_still_refuses_a_dead_link(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await _seed_invited(db)
            try:
                await aotp.invite_start("tok-nope")
                return None
            except HTTPException as e:
                return e.status_code
        finally:
            restore()

    assert with_test_db(scenario) == 404, "an unknown invite token is still Not Found"

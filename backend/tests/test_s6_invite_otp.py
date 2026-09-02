"""Epic 10 Testing -- Sprint 6 (T10-06.9): invite + OTP flow at scale.

db-tier: drive the real /auth/invite + /auth/otp endpoints against an isolated
Mongo db, with the SMS/APM gateway mocked to a known code. Covers the invite
lifecycle (7-day expiry, single-use consumption on OTP verify), the OTP policy
(30s resend cooldown, 300s TTL, 5-attempt lockout, single-use), and multi-tenant
resolution with NO cross-tenant leak -- across 30 concurrent invites.
"""
import asyncio
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException, Response

import routers.auth_otp as aotp
import services.otp as otpmod
from services.whatsapp import _norm_phone
from models.auth import OtpRequestInput, OtpVerifyInput

CODE = "424242"   # the mocked APM/SMS gateway always "sends" this


def _patch(testdb):
    saved = (aotp.db, otpmod.db, otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms)
    aotp.db = testdb
    otpmod.db = testdb

    async def _apm(norm):
        return CODE          # gateway returns the code it "sent"

    async def _sms(phone, code):
        return True

    otpmod._apm_send_and_fetch_otp = _apm
    otpmod._send_otp_sms = _sms

    def restore():
        aotp.db, otpmod.db, otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms = saved
    return restore


async def _seed_member(db, *, uid, tenant_id, tenant_name, phone, name="Member",
                       role="sales", invite_token=None, invite_expires_at=None):
    await db.tenants.update_one({"id": tenant_id}, {"$set": {"id": tenant_id, "name": tenant_name}}, upsert=True)
    await db.users.insert_one({
        "id": uid, "tenant_id": tenant_id, "name": name, "role": role,
        "phone": phone, "phone_norm": _norm_phone(phone),
        "invite_token": invite_token, "invite_expires_at": invite_expires_at,
    })


# ---------------------------------------------------------------------------
# Invite lifecycle: valid -> welcome, expired -> 410, consumed-on-verify -> 404.
# ---------------------------------------------------------------------------
def test_invite_7day_expiry_and_single_use_consumption(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
            await _seed_member(db, uid="u1", tenant_id="tA", tenant_name="Alpha",
                               phone="9876500001", name="Asha", invite_token="tok-live",
                               invite_expires_at=future)
            await _seed_member(db, uid="u2", tenant_id="tA", tenant_name="Alpha",
                               phone="9876500002", name="Bala", invite_token="tok-stale",
                               invite_expires_at=past)

            # valid invite resolves to a friendly welcome
            info = await aotp.invite_info("tok-live")
            # expired invite (past the 7-day window) -> 410 Gone
            try:
                await aotp.invite_info("tok-stale"); expired = None
            except HTTPException as e:
                expired = e.status_code
            # unknown token -> 404
            try:
                await aotp.invite_info("tok-nope"); unknown = None
            except HTTPException as e:
                unknown = e.status_code

            # accept: start (sends OTP) -> verify -> the invite is consumed
            await aotp.invite_start("tok-live")
            await aotp.verify_otp(OtpVerifyInput(phone="9876500001", code=CODE), Response())
            user = await db.users.find_one({"id": "u1"}, {"_id": 0})
            try:
                await aotp.invite_info("tok-live"); reused = None    # single-use: now dead
            except HTTPException as e:
                reused = e.status_code
            return info.get("company"), expired, unknown, user.get("invite_token"), \
                user.get("invite_consumed_at"), reused
        finally:
            restore()

    company, expired, unknown, tok_after, consumed_at, reused = with_test_db(scenario)
    assert company == "Alpha", "a live invite resolves to the workspace welcome"
    assert expired == 410, "an invite past its 7-day window is Gone"
    assert unknown == 404, "an unknown invite token is Not Found"
    assert tok_after is None and consumed_at, "OTP verify consumes the invite (token nulled, consumed_at stamped)"
    assert reused == 404, "the consumed invite link is single-use -- it no longer resolves"


# ---------------------------------------------------------------------------
# OTP resend cooldown (30s) is scoped per (phone, tenant): a cooldown in one
# workspace does NOT lock the same phone out of another.
# ---------------------------------------------------------------------------
def test_otp_cooldown_is_per_tenant_scoped(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            # same phone registered in TWO workspaces
            await _seed_member(db, uid="a1", tenant_id="tA", tenant_name="Alpha", phone="9990000001")
            await _seed_member(db, uid="b1", tenant_id="tB", tenant_name="Beta", phone="9990000001")

            first = await aotp.request_otp(OtpRequestInput(phone="9990000001", tenant_id="tA"))
            try:  # immediate resend for tenant A -> 30s cooldown
                await aotp.request_otp(OtpRequestInput(phone="9990000001", tenant_id="tA")); a_again = "ok"
            except HTTPException as e:
                a_again = e.status_code
            # SAME phone, tenant B -> issues fine (cooldown is per-tenant)
            b_first = await aotp.request_otp(OtpRequestInput(phone="9990000001", tenant_id="tB"))
            n_rows = await db.otp_codes.count_documents({"phone": "9990000001"})
            return first.get("sent"), a_again, b_first.get("sent"), n_rows
        finally:
            restore()

    a_sent, a_again, b_sent, n_rows = with_test_db(scenario)
    assert a_sent is True and b_sent is True, "both workspaces can issue an OTP for the shared phone"
    assert a_again == 429, "an immediate resend in the same workspace hits the 30s cooldown"
    assert n_rows == 2, "each (phone, tenant) keeps its own OTP row -- no cross-tenant overwrite"


# ---------------------------------------------------------------------------
# Multi-tenant ambiguity: NO OTP is sent and NO tenant is leaked until the
# caller disambiguates; verify without a tenant hint is a 409.
# ---------------------------------------------------------------------------
def test_ambiguous_phone_no_leak(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await _seed_member(db, uid="a1", tenant_id="tA", tenant_name="Alpha", phone="9991110000")
            await _seed_member(db, uid="b1", tenant_id="tB", tenant_name="Beta", phone="9991110000")
            resp = await aotp.request_otp(OtpRequestInput(phone="9991110000"))   # no tenant hint
            rows_after_request = await db.otp_codes.count_documents({"phone": "9991110000"})
            try:
                await aotp.verify_otp(OtpVerifyInput(phone="9991110000", code=CODE), Response()); vstatus = None
            except HTTPException as e:
                vstatus = e.status_code
            return resp.get("ambiguous"), len(resp.get("choices") or []), rows_after_request, vstatus
        finally:
            restore()

    ambiguous, n_choices, rows, vstatus = with_test_db(scenario)
    assert ambiguous is True and n_choices == 2, "an ambiguous phone returns the workspace choices"
    assert rows == 0, "NO OTP is sent for an ambiguous phone (no 'you're in workspace X' leak)"
    assert vstatus == 409, "verifying without a tenant hint on an ambiguous phone is refused (409)"


# ---------------------------------------------------------------------------
# OTP verify: single-use, 5-attempt lockout, expiry.
# ---------------------------------------------------------------------------
def test_otp_single_use_attempts_and_expiry(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            await _seed_member(db, uid="u1", tenant_id="tA", tenant_name="Alpha", phone="9992220000")

            # 5 wrong codes -> 401 each (attempts climb); 6th -> 429 lockout
            await aotp.request_otp(OtpRequestInput(phone="9992220000", tenant_id="tA"))
            wrongs = []
            for _ in range(otpmod.OTP_MAX_ATTEMPTS):
                try:
                    await aotp.verify_otp(OtpVerifyInput(phone="9992220000", code="000000", tenant_id="tA"), Response())
                except HTTPException as e:
                    wrongs.append(e.status_code)
            try:
                await aotp.verify_otp(OtpVerifyInput(phone="9992220000", code="000000", tenant_id="tA"), Response()); locked = None
            except HTTPException as e:
                locked = e.status_code

            # fresh code -> correct verify succeeds, then is single-use
            await aotp.request_otp(OtpRequestInput(phone="9992220000", tenant_id="tA"))
            ok = await aotp.verify_otp(OtpVerifyInput(phone="9992220000", code=CODE, tenant_id="tA"), Response())
            try:
                await aotp.verify_otp(OtpVerifyInput(phone="9992220000", code=CODE, tenant_id="tA"), Response()); reuse = None
            except HTTPException as e:
                reuse = e.status_code

            # expiry: a code whose expires_at is in the past -> 400
            await aotp.request_otp(OtpRequestInput(phone="9992220000", tenant_id="tA"))
            await db.otp_codes.update_one({"phone": "9992220000", "tenant_id": "tA"},
                {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()}})
            try:
                await aotp.verify_otp(OtpVerifyInput(phone="9992220000", code=CODE, tenant_id="tA"), Response()); expired = None
            except HTTPException as e:
                expired = e.status_code
            return wrongs, locked, ("token" in ok or "user" in ok), reuse, expired
        finally:
            restore()

    wrongs, locked, ok_login, reuse, expired = with_test_db(scenario)
    assert wrongs == [401] * otpmod.OTP_MAX_ATTEMPTS, "each wrong code is a 401 while attempts remain"
    assert locked == 429, "past the attempt cap the OTP is locked (429)"
    assert ok_login, "the correct code logs the member in"
    assert reuse == 400, "the OTP is single-use -- a second verify has no code to check"
    assert expired == 400, "an OTP past its TTL is rejected"


# ---------------------------------------------------------------------------
# At scale: 30 invites issued concurrently -> 30 independent OTP rows, each
# verifiable only in its own tenant. No collision, no cross-tenant leak.
# ---------------------------------------------------------------------------
def test_thirty_invites_at_scale_stay_isolated(with_test_db):
    async def scenario(db):
        restore = _patch(db)
        try:
            future = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
            # 30 invited members, spread across 3 tenants, each a distinct phone
            for i in range(30):
                t = f"t{i % 3}"
                await _seed_member(db, uid=f"m{i}", tenant_id=t, tenant_name=f"WS{i % 3}",
                                   phone=f"98700000{i:02d}", invite_token=f"tok{i}",
                                   invite_expires_at=future)
            # fire all 30 invite-starts concurrently (each sends its own OTP)
            await asyncio.gather(*[aotp.invite_start(f"tok{i}") for i in range(30)])
            n_otps = await db.otp_codes.count_documents({})
            # each member verifies with the shared mocked code in their OWN tenant
            results = await asyncio.gather(
                *[aotp.verify_otp(OtpVerifyInput(phone=f"98700000{i:02d}", code=CODE, tenant_id=f"t{i % 3}"), Response())
                  for i in range(30)],
                return_exceptions=True)
            ok = sum(1 for r in results if not isinstance(r, Exception))
            consumed = await db.users.count_documents({"invite_token": None, "invite_consumed_at": {"$ne": None}})
            leftover = await db.otp_codes.count_documents({})
            return n_otps, ok, consumed, leftover
        finally:
            restore()

    n_otps, ok, consumed, leftover = with_test_db(scenario)
    assert n_otps == 30, "30 invites -> 30 independent OTP rows (no collision across tenants)"
    assert ok == 30, "all 30 members verify successfully in their own workspace"
    assert consumed == 30, "every accepted invite is consumed (token nulled, consumed_at stamped)"
    assert leftover == 0, "every OTP is single-use -- all 30 rows are deleted after verify"

"""Changing your own mobile is confirmed by a code to the new number
(2026-09-19, U7-24.14).

Signup stopped trusting a typed number the same day (U7-24.11). Settings ›
Your Profile still did: it checked only that nobody else in the workspace had
the number, then saved it. The mobile is a sign-in (Mobile OTP) and a route
(WhatsApp from it lands as you), so a slip there locked you out of Mobile OTP
and gave whoever owns the mistyped number a sign-in as you. A 5-digit "number"
saved too.

Now /auth/phone/send-code texts the NEW number, and PATCH /auth/profile saves a
new number only with that code. Nothing here reaches an SMS gateway: the
senders are replaced by a fake that returns a known code.
"""
import os

import pytest
from fastapi import HTTPException

import routers.auth as rauth
import services.otp as otpmod
from models.auth import ProfileUpdateInput, PhoneChangeCodeInput

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-sharma"
CODE = "615243"
ME = {"id": "u-fin", "tenant_id": TENANT, "name": "Sunita", "role": "finance", "permissions": []}


def _patch(testdb):
    saved = (rauth.db, otpmod.db, otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms)
    texted = []

    async def _fake_gateway(norm):
        texted.append(norm)
        return CODE

    async def _no_twilio(*a, **k):
        raise AssertionError("the fake gateway answers first")

    rauth.db = otpmod.db = testdb
    otpmod._apm_send_and_fetch_otp = _fake_gateway
    otpmod._send_otp_sms = _no_twilio

    def restore():
        rauth.db, otpmod.db, otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms = saved
    return texted, restore


async def _seed(db, **mine):
    from services.rate_limit import reset_for_test
    await reset_for_test()
    await db.users.insert_one({"id": "u-owner", "tenant_id": TENANT, "name": "Rajesh", "role": "owner",
                               "phone": "9820010001", "phone_norm": "9820010001"})
    await db.users.insert_one({"id": "u-fin", "tenant_id": TENANT, "name": "Sunita", "role": "finance",
                               "email": "sunita@sharma.co", "phone": "9820010003", "phone_norm": "9820010003",
                               **mine})


def _run(with_test_db, body, **mine):
    """Seed, run `body(db, texted)`, restore. Returns what body returns."""
    async def scenario(db):
        texted, restore = _patch(db)
        try:
            await _seed(db, **mine)
            return await body(db, texted)
        finally:
            restore()
    return with_test_db(scenario)


async def _refused(coro):
    try:
        await coro
    except HTTPException as e:
        return e.status_code, e.detail
    return None


# ---------------------------------------------------------------------------
# Saving a new number needs its code.
# ---------------------------------------------------------------------------
def test_a_new_number_without_a_code_is_not_saved(with_test_db):
    async def body(db, texted):
        refused = await _refused(rauth.update_profile(ProfileUpdateInput(phone="98200 10055"), user=ME))
        row = await db.users.find_one({"id": "u-fin"}, {"_id": 0})
        return refused, row
    refused, row = _run(with_test_db, body)
    assert refused[0] == 400 and refused[1]["code"] == "phone_unconfirmed"
    assert row["phone_norm"] == "9820010003", "the old number stays until the new one is confirmed"


def test_the_code_texted_to_the_new_number_saves_it(with_test_db):
    async def body(db, texted):
        sent = await rauth.send_phone_change_code(PhoneChangeCodeInput(phone="98200 10055"), user=ME)
        await rauth.update_profile(ProfileUpdateInput(phone="98200 10055", phone_code=CODE), user=ME)
        row = await db.users.find_one({"id": "u-fin"}, {"_id": 0})
        left = await db.otp_codes.count_documents({})
        return texted, sent, row, left
    texted, sent, row, left = _run(with_test_db, body)
    assert texted == ["9820010055"], "the code goes to the NEW number, not the old one"
    assert sent["phone"] == "+91 98200 10055" and "tenant_id" not in sent
    assert row["phone"] == "+91 98200 10055" and row["phone_norm"] == "9820010055"
    assert row["phone_verified_at"], "and we know it was confirmed"
    assert row.get("wa_phone_obsolete") is False, "WhatsApp matching follows the new number"
    assert left == 0, "the code is good once"


def test_a_wrong_code_is_refused_and_nothing_moves(with_test_db):
    async def body(db, texted):
        await rauth.send_phone_change_code(PhoneChangeCodeInput(phone="9820010055"), user=ME)
        refused = await _refused(rauth.update_profile(
            ProfileUpdateInput(phone="9820010055", phone_code="000000"), user=ME))
        row = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "phone_norm": 1})
        return refused, row
    refused, row = _run(with_test_db, body)
    assert refused[0] == 401
    assert row["phone_norm"] == "9820010003"


def test_a_code_for_one_number_does_not_confirm_another(with_test_db):
    """Text your own new number, then type a different one before saving."""
    async def body(db, texted):
        await rauth.send_phone_change_code(PhoneChangeCodeInput(phone="9820010055"), user=ME)
        return await _refused(rauth.update_profile(
            ProfileUpdateInput(phone="9820010066", phone_code=CODE), user=ME))
    refused = _run(with_test_db, body)
    assert refused and refused[0] == 400, "no code was ever sent to 9820010066"


def test_a_sign_in_code_cannot_stand_in_for_a_change_code(with_test_db):
    """The change code lives in its own scope. A sign-in OTP for the new number
    (say it already signs in to another workspace) must not confirm this."""
    async def body(db, texted):
        await otpmod._issue_otp("9820010055", "9820010055", tenant_id=TENANT)
        return await _refused(rauth.update_profile(
            ProfileUpdateInput(phone="9820010055", phone_code=CODE), user=ME))
    refused = _run(with_test_db, body)
    assert refused and refused[0] == 400


def test_a_refusal_elsewhere_in_the_form_does_not_spend_the_code(with_test_db):
    """The code is checked last, just before the write."""
    async def body(db, texted):
        await rauth.send_phone_change_code(PhoneChangeCodeInput(phone="9820010055"), user=ME)
        bad = await _refused(rauth.update_profile(ProfileUpdateInput(
            phone="9820010055", phone_code=CODE, email="new@sharma.co", current_password="wrong"), user=ME))
        still = await db.otp_codes.count_documents({"phone": "9820010055"})
        await rauth.update_profile(ProfileUpdateInput(phone="9820010055", phone_code=CODE), user=ME)
        row = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "phone_norm": 1})
        return bad, still, row
    bad, still, row = _run(with_test_db, body)
    assert bad and bad[0] == 400, "the email change is refused (wrong password)"
    assert still == 1, "and the phone code survives it"
    assert row["phone_norm"] == "9820010055", "so the retry saves"


# ---------------------------------------------------------------------------
# What is not a change, and what is not a number.
# ---------------------------------------------------------------------------
def test_the_same_number_written_differently_needs_no_code(with_test_db):
    async def body(db, texted):
        await rauth.update_profile(ProfileUpdateInput(name="Sunita Rao", phone="+91 98200-10003"), user=ME)
        return texted, await db.users.find_one({"id": "u-fin"}, {"_id": 0})
    texted, row = _run(with_test_db, body)
    assert texted == [] and row["name"] == "Sunita Rao" and row["phone_norm"] == "9820010003"


def test_an_old_malformed_number_does_not_block_a_name_change(with_test_db):
    """Numbers saved before the rule existed ride along untouched until changed."""
    async def body(db, texted):
        await rauth.update_profile(ProfileUpdateInput(name="Sunita Rao", phone="12345"), user=ME)
        return await db.users.find_one({"id": "u-fin"}, {"_id": 0})
    row = _run(with_test_db, body, phone="12345", phone_norm="12345")
    assert row["name"] == "Sunita Rao" and row["phone"] == "12345"


@pytest.mark.parametrize("typed", ["12345", "5820010055", "+1 415 555 0100"])
def test_a_number_that_cannot_be_a_mobile_is_refused(with_test_db, typed):
    async def body(db, texted):
        saved = await _refused(rauth.update_profile(ProfileUpdateInput(phone=typed, phone_code=CODE), user=ME))
        asked = await _refused(rauth.send_phone_change_code(PhoneChangeCodeInput(phone=typed), user=ME))
        return saved, asked, texted
    saved, asked, texted = _run(with_test_db, body)
    assert saved[1]["code"] == "phone_invalid", "a 5-digit number used to save"
    assert asked[0] == 400 and texted == [], "and nothing is texted to it"


def test_a_colleagues_number_is_refused_before_anything_is_texted(with_test_db):
    async def body(db, texted):
        return await _refused(rauth.send_phone_change_code(PhoneChangeCodeInput(phone="9820010001"), user=ME)), texted
    refused, texted = _run(with_test_db, body)
    assert refused[0] == 400 and "Rajesh" in refused[1] and texted == []


def test_your_current_number_is_not_texted_again(with_test_db):
    async def body(db, texted):
        return await _refused(rauth.send_phone_change_code(PhoneChangeCodeInput(phone="+91 98200 10003"), user=ME))
    refused = _run(with_test_db, body)
    assert refused == (400, "That's already your number.")


# ---------------------------------------------------------------------------
# Removing it.
# ---------------------------------------------------------------------------
def test_someone_who_signs_in_by_mobile_cannot_remove_it(with_test_db):
    async def body(db, texted):
        refused = await _refused(rauth.update_profile(ProfileUpdateInput(phone=""), user=ME))
        return refused, await db.users.find_one({"id": "u-fin"}, {"_id": 0, "phone_norm": 1})
    refused, row = _run(with_test_db, body, passwordless=True)
    assert refused[0] == 400 and "not removed" in refused[1]
    assert row["phone_norm"] == "9820010003", "they would have had no way in at all"


def test_someone_with_a_password_can_remove_it(with_test_db):
    async def body(db, texted):
        await rauth.update_profile(ProfileUpdateInput(phone=""), user=ME)
        return await db.users.find_one({"id": "u-fin"}, {"_id": 0})
    row = _run(with_test_db, body)
    assert row["phone"] == "" and row["phone_norm"] == "" and row["phone_verified_at"] is None


# ---------------------------------------------------------------------------
# Texting on a loop.
# ---------------------------------------------------------------------------
def test_one_number_cannot_be_texted_on_a_loop(with_test_db):
    async def body(db, texted):
        saved = otpmod.OTP_RESEND_COOLDOWN
        otpmod.OTP_RESEND_COOLDOWN = 0
        try:
            for _ in range(6):
                r = await _refused(rauth.send_phone_change_code(PhoneChangeCodeInput(phone="9820010055"), user=ME))
                if r:
                    return texted, r
            return texted, None
        finally:
            otpmod.OTP_RESEND_COOLDOWN = saved
    texted, refused = _run(with_test_db, body)
    assert len(texted) == 5 and refused[0] == 429 and "minute" in refused[1]


# ---------------------------------------------------------------------------
# The screen.
# ---------------------------------------------------------------------------
def test_the_profile_form_texts_the_new_number_and_sends_the_code_on_save():
    from pathlib import Path
    form = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "ProfileDialog.js").read_text(encoding="utf-8")
    assert '"/auth/phone/send-code"' in form
    assert "phone_code:" in form, "the code travels with Save"
    assert 'testid="profile-phone-code-boxes"' in form
    assert "normIndianMobile" in form, "the same rule as signup"
    # the email-change code for a mobile-only member goes to the number ON FILE
    # (which is what the server checks), not whatever is in the phone box
    assert 'api.post("/auth/otp/request", { phone: user?.phone })' in form

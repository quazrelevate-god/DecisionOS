"""The member loop: members sign in by mobile, owners have both (2026-09-19).

Yokesh: a manager or HR person adds each member on Team — name, role, mobile —
and the member makes the account their own. Checking that loop found it half
built: a "temporary" password nothing ever asked the member to replace (so the
manager who typed it could keep signing in as them), mobile-only members who
could never add a password, a mobile never marked confirmed, a Team form that
took any 10+ digits, and a first sign-in that landed straight on the Desk.

The model now:
  * Members sign in with their mobile and a texted code. No password is set
    for them; the email is optional contact detail.
  * Their FIRST sign-in comes through the invite link. Until then their number
    opens nothing on its own — a mistyped number can't hand the account to
    whoever owns it.
  * Signing in by code marks the mobile confirmed; the first time, a one-time
    welcome card asks them to check their details.
  * Owners have an email and a password as well. Someone who becomes an owner
    by mobile adds theirs at the next sign-in.
  * A new password is 8+ characters with a letter and a number.

No SMS gateway is reached: the senders are replaced by a fake with a known code.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response

import routers.auth as rauth
import routers.auth_otp as aotp
import routers.team as team
import services.otp as otpmod
import core
import core.deps as core_deps
from models.auth import OtpRequestInput, OtpVerifyInput, OwnerCredentialsInput, ChangePasswordInput, \
    PasswordResetInput
from models.team import UserCreateInput, UserUpdateInput

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-lakshmi"
OTHER = "t-other"
CODE = "731905"
OWNER = {"id": "u-owner", "tenant_id": TENANT, "name": "Lakshmi", "role": "owner", "permissions": []}


def _patch(testdb):
    import services.plans as plans
    mods = [rauth, aotp, team, otpmod, core, core_deps]
    saved = [(m, m.db) for m in mods]
    texted = []

    async def _fake_gateway(norm):
        texted.append(norm)
        return CODE

    async def _no_twilio(*a, **k):
        raise AssertionError("the fake gateway answers first")

    async def _room(*a, **k):
        return None

    s_apm, s_tw, s_seat = otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms, plans.enforce_seat_limit
    for m in mods:
        m.db = testdb
    otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms = _fake_gateway, _no_twilio
    plans.enforce_seat_limit = _room

    def restore():
        for m, d in saved:
            m.db = d
        otpmod._apm_send_and_fetch_otp, otpmod._send_otp_sms = s_apm, s_tw
        plans.enforce_seat_limit = s_seat
    return texted, restore


async def _seed(db):
    from services.rate_limit import reset_for_test
    await reset_for_test()
    # the index the app now creates: unique among real addresses only
    await db.users.create_index("email", unique=True, name="email_1",
                                partialFilterExpression={"email": {"$gt": ""}})
    await db.tenants.insert_one({"id": TENANT, "name": "Lakshmi Looms",
                                 "roles": [{"key": "sales", "label": "Sales"}, {"key": "finance", "label": "Finance"}]})
    await db.users.insert_one({"id": "u-owner", "tenant_id": TENANT, "name": "Lakshmi", "role": "owner",
                               "email": "lakshmi@looms.in", "phone": "+91 98200 70001", "phone_norm": "9820070001"})
    await db.memberships.insert_one({"id": "m-owner", "user_id": "u-owner", "tenant_id": TENANT,
                                     "role": "owner", "status": "active", "permissions": []})


def _run(with_test_db, body):
    async def scenario(db):
        texted, restore = _patch(db)
        try:
            await _seed(db)
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


async def _add(name, phone, **kw):
    return await team.create_user(UserCreateInput(name=name, role=kw.pop("role", "sales"), phone=phone, **kw),
                                  user=OWNER)


# ---------------------------------------------------------------------------
# Adding a member on Team.
# ---------------------------------------------------------------------------
def test_a_member_is_added_with_a_mobile_and_no_password(with_test_db):
    async def body(db, texted):
        out = await _add("Priya", "098200-70002")
        row = await db.users.find_one({"id": out["id"]}, {"_id": 0})
        mem = await db.memberships.find_one({"user_id": out["id"]}, {"_id": 0})
        return out, row, mem
    out, row, mem = _run(with_test_db, body)
    assert row["passwordless"] is True, "they sign in by mobile"
    assert row["phone"] == "+91 98200 70002" and row["phone_norm"] == "9820070002"
    assert "email" not in row, "no email given, none stored (not even an empty one)"
    assert out.get("invite_token") and mem["status"] == "pending", "an invite link to hand over"


def test_a_manager_can_no_longer_choose_the_members_password(with_test_db):
    async def body(db, texted):
        return await _refused(_add("Priya", "9820070002", password="Temp1234"))
    status, detail = _run(with_test_db, body)
    assert status == 400 and "no password to set" in detail


@pytest.mark.parametrize("phone", ["", "12345678", "5820070002", "+1 415 555 0100"])
def test_the_members_mobile_is_required_and_real(with_test_db, phone):
    async def body(db, texted):
        return await _refused(_add("Priya", phone))
    status, detail = _run(with_test_db, body)
    assert status == 400 and "10-digit Indian mobile" in detail


def test_several_members_can_be_added_without_an_email(with_test_db):
    """A plain unique index on users.email counts every missing email as the
    same value, so the second member without one used to be refused."""
    async def body(db, texted):
        await _add("Priya", "9820070002")
        await _add("Arun", "9820070003")
        with_email = await _add("Sunita", "9820070004", email="Sunita@Looms.in")
        dup = await _refused(_add("Ravi", "9820070005", email="sunita@looms.in"))
        return await db.users.count_documents({"tenant_id": TENANT}), with_email, dup
    n, with_email, dup = _run(with_test_db, body)
    assert n == 4, "the owner and three members"
    assert with_email["email"] == "sunita@looms.in"
    assert dup and dup[0] == 400, "a real email is still unique"


def test_team_edits_hold_the_same_mobile_rule(with_test_db):
    async def body(db, texted):
        out = await _add("Priya", "9820070002")
        bad = await _refused(team.update_user(out["id"], UserUpdateInput(phone="12345"), user=OWNER))
        cleared = await _refused(team.update_user(out["id"], UserUpdateInput(phone=""), user=OWNER))
        await team.update_user(out["id"], UserUpdateInput(phone="98200 70009"), user=OWNER)
        return bad, cleared, await db.users.find_one({"id": out["id"]}, {"_id": 0, "phone": 1})
    bad, cleared, row = _run(with_test_db, body)
    assert bad[0] == 400 and "10-digit" in bad[1]
    assert cleared[0] == 400 and "not removed" in cleared[1], "they would have no way in"
    assert row["phone"] == "+91 98200 70009"


# ---------------------------------------------------------------------------
# The first sign-in comes through the invite link.
# ---------------------------------------------------------------------------
def test_before_the_invite_is_used_the_number_alone_opens_nothing(with_test_db):
    """The stranger who owns a mistyped number asks for a code: none is sent."""
    async def body(db, texted):
        await _add("Priya", "9820070002")
        asked = await _refused(aotp.request_otp(OtpRequestInput(phone="9820070002")))
        guessed = await _refused(aotp.verify_otp(OtpVerifyInput(phone="9820070002", code=CODE), Response()))
        return asked, guessed, texted
    asked, guessed, texted = _run(with_test_db, body)
    assert asked[0] == 403 and "invite link" in asked[1]
    assert guessed[0] == 403
    assert texted == [], "not one text went out"


def test_the_invite_link_signs_them_in_confirms_the_mobile_and_asks_for_details(with_test_db):
    async def body(db, texted):
        out = await _add("Priya", "9820070002")
        await aotp.invite_start(out["invite_token"])
        signed = await aotp.verify_otp(OtpVerifyInput(phone="9820070002", code=CODE,
                                                      invite_token=out["invite_token"]), Response())
        row = await db.users.find_one({"id": out["id"]}, {"_id": 0})
        mem = await db.memberships.find_one({"user_id": out["id"]}, {"_id": 0})
        return texted, signed, row, mem
    texted, signed, row, mem = _run(with_test_db, body)
    assert texted == ["9820070002"]
    assert signed["user"]["id"] == row["id"]
    assert mem["status"] == "active", "the invite is accepted"
    assert row["phone_verified_at"], "reading the code back proves the number is theirs"
    assert row["welcome_pending"] is True, "a one-time welcome card on their first screen"
    assert row.get("invite_token") is None, "the link is spent"


def test_after_the_invite_the_mobile_is_all_they_need(with_test_db):
    async def body(db, texted):
        out = await _add("Priya", "9820070002")
        await aotp.invite_start(out["invite_token"])
        await aotp.verify_otp(OtpVerifyInput(phone="9820070002", code=CODE, invite_token=out["invite_token"]),
                              Response())
        await db.otp_codes.delete_many({})
        otpmod.OTP_RESEND_COOLDOWN, saved = 0, otpmod.OTP_RESEND_COOLDOWN
        try:
            await aotp.request_otp(OtpRequestInput(phone="+91 98200 70002"))
            again = await aotp.verify_otp(OtpVerifyInput(phone="9820070002", code=CODE), Response())
        finally:
            otpmod.OTP_RESEND_COOLDOWN = saved
        return again
    again = _run(with_test_db, body)
    assert again["user"]["name"] == "Priya"


def test_a_spent_or_wrong_invite_link_does_not_sign_in(with_test_db):
    async def body(db, texted):
        out = await _add("Priya", "9820070002")
        await aotp.invite_start(out["invite_token"])
        wrong = await _refused(aotp.verify_otp(
            OtpVerifyInput(phone="9820070002", code=CODE, invite_token="not-the-link"), Response()))
        await db.users.update_one({"id": out["id"]}, {"$set": {
            "invite_expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}})
        expired = await _refused(aotp.verify_otp(
            OtpVerifyInput(phone="9820070002", code=CODE, invite_token=out["invite_token"]), Response()))
        return wrong, expired
    wrong, expired = _run(with_test_db, body)
    assert wrong[0] == 400 and expired[0] == 410


def test_a_number_live_elsewhere_still_signs_in_there_while_this_invite_waits(with_test_db):
    """A consultant already in another workspace is invited here: plain Mobile
    OTP keeps opening the workspace they're in, and only the link opens this one."""
    async def body(db, texted):
        await db.tenants.insert_one({"id": OTHER, "name": "Other Co"})
        await db.users.insert_one({"id": "u-elsewhere", "tenant_id": OTHER, "name": "Priya", "role": "sales",
                                   "phone": "9820070002", "phone_norm": "9820070002", "passwordless": True})
        await db.memberships.insert_one({"id": "m-e", "user_id": "u-elsewhere", "tenant_id": OTHER,
                                         "role": "sales", "status": "active", "permissions": []})
        await _add("Priya", "9820070002")
        sent = await aotp.request_otp(OtpRequestInput(phone="9820070002"))
        return sent
    sent = _run(with_test_db, body)
    assert sent.get("tenant_id") == OTHER and not sent.get("ambiguous"), \
        "no picker offering the workspace they haven't joined yet"


# ---------------------------------------------------------------------------
# The welcome card, and owners.
# ---------------------------------------------------------------------------
def test_the_welcome_card_goes_away_once_seen(with_test_db):
    async def body(db, texted):
        await db.users.update_one({"id": "u-owner"}, {"$set": {"welcome_pending": True}})
        await rauth.welcome_done(user=OWNER)
        return await db.users.find_one({"id": "u-owner"}, {"_id": 0})
    assert "welcome_pending" not in _run(with_test_db, body)


def test_an_owner_who_came_in_by_mobile_adds_an_email_and_password(with_test_db):
    async def body(db, texted):
        out = await _add("Karthik", "9820070006", role="owner")
        me = {"id": out["id"], "tenant_id": TENANT, "name": "Karthik", "role": "owner"}
        weak = await _refused(rauth.set_owner_credentials(
            OwnerCredentialsInput(email="karthik@looms.in", password="123456"), None, user=me))
        taken = await _refused(rauth.set_owner_credentials(
            OwnerCredentialsInput(email="lakshmi@looms.in", password="Looms2026"), None, user=me))
        await rauth.set_owner_credentials(
            OwnerCredentialsInput(email="Karthik@Looms.in", password="Looms2026"), None, user=me)
        again = await _refused(rauth.set_owner_credentials(
            OwnerCredentialsInput(email="karthik@looms.in", password="Looms2027"), None, user=me))
        row = await db.users.find_one({"id": out["id"]}, {"_id": 0})
        return weak, taken, again, row
    weak, taken, again, row = _run(with_test_db, body)
    assert weak[0] == 400 and "8 characters" in weak[1]
    assert taken[0] == 400
    assert row["email"] == "karthik@looms.in" and row["passwordless"] is False
    assert core.verify_password("Looms2026", row["password_hash"]), "they can sign in with it"
    assert again[0] == 400, "done once; changing it is Settings' job"


def test_members_do_not_get_owner_credentials(with_test_db):
    async def body(db, texted):
        out = await _add("Priya", "9820070002")
        me = {"id": out["id"], "tenant_id": TENANT, "name": "Priya", "role": "sales"}
        return await _refused(rauth.set_owner_credentials(
            OwnerCredentialsInput(email="priya@looms.in", password="Looms2026"), None, user=me))
    assert _run(with_test_db, body)[0] == 403


# ---------------------------------------------------------------------------
# A new password is 8+ characters with a letter and a number.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("pw, ok", [
    ("123456", False), ("abcdefgh", False), ("12345678", False), ("Lak1", False),
    ("looms2026", True), ("Scratch-4821", True),
])
def test_the_rule(pw, ok):
    from services.auth.passwords import password_problem
    assert (password_problem(pw) == "") is ok


def test_changing_to_a_weak_password_is_refused(with_test_db):
    async def body(db, texted):
        await db.users.update_one({"id": "u-owner"}, {"$set": {"password_hash": core.hash_password("Looms2026")}})
        return await _refused(rauth.change_password(
            ChangePasswordInput(current_password="Looms2026", new_password="123456"), user=OWNER))
    status, detail = _run(with_test_db, body)
    assert status == 400 and "8 characters" in detail


def test_a_weak_reset_is_refused_without_spending_the_link(with_test_db):
    async def body(db, texted):
        from services.auth import auth_emails
        row = await auth_emails.issue(db, kind=auth_emails.KIND_PASSWORD_RESET,
                                      user_id="u-owner", tenant_id=TENANT, email="lakshmi@looms.in")
        weak = await _refused(rauth.password_reset(PasswordResetInput(token=row["token"], new_password="123456")))
        live = await db.auth_email_tokens.find_one({"token": row["token"]}, {"_id": 0, "used_at": 1})
        return weak, live
    weak, live = _run(with_test_db, body)
    assert weak[0] == 400 and "8 characters" in weak[1]
    assert live["used_at"] is None, "they can try again with the same link"


# ---------------------------------------------------------------------------
# The screens.
# ---------------------------------------------------------------------------
def _fe(*parts):
    from pathlib import Path
    return (Path(__file__).resolve().parents[2] / "frontend" / "src").joinpath(*parts).read_text(encoding="utf-8")


def test_the_team_form_has_no_password_and_requires_a_real_mobile():
    team_js = _fe("pages", "Team.js")
    assert 'data-testid="member-password-input"' not in team_js, "no password for the manager to choose"
    assert 'data-testid="login-method-toggle"' not in team_js
    assert "normIndianMobile" in team_js


def test_the_invite_sign_in_carries_its_link():
    login = _fe("pages", "Login.js")
    assert "invite?.token" in login and "loginWithOtp(otpPhone, otpCode, otpTenant, invite?.token)" in login
    assert "invite_token: inviteToken" in _fe("context", "AuthContext.js")


def test_the_app_asks_owners_for_credentials_and_welcomes_members():
    layout = _fe("components", "Layout.js")
    assert "OwnerCredentialsGate" in layout and "WelcomeMemberCard" in layout
    assert '"/auth/owner-credentials"' in _fe("components", "auth", "OwnerCredentialsGate.js")
    assert '"/auth/welcome/done"' in _fe("components", "auth", "WelcomeMemberCard.js")


def test_every_new_password_screen_uses_the_rule():
    for parts in (("pages", "onboarding", "BasicsFlow.js"), ("pages", "PasswordReset.js"),
                  ("components", "ProfileDialog.js"), ("components", "auth", "OwnerCredentialsGate.js")):
        assert "passwordProblem" in _fe(*parts), parts[-1]

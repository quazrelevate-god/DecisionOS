"""The founder's mobile is confirmed before it is trusted (2026-09-19).

A mobile on an account is two things at once: a SIGN-IN (Mobile OTP, and the
mobile app) and a ROUTE (WhatsApp from that number lands in the workspace as
that person). Signup used to store whatever was typed, checked against nothing
stricter than "8 digits". So:

  * a one-digit slip locked the founder out of Mobile OTP, and
  * the stranger who owns the mistyped number could request an OTP, receive it
    on their own phone, and sign in as the workspace's OWNER — with their
    WhatsApp messages filed as the owner's captures.

Now the number is a real Indian mobile, confirmed by a texted code at the step
where it is typed, and /auth/register trusts a phone only with the proof
/signup/phone/verify issued for that exact number.

Nothing here reaches an SMS gateway: the APM and Twilio senders are replaced
with a fake that returns a known code. (A real text went to an invented number
from this suite once; see test_s8_isolation_scenarios.)
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

# A number in the 6-9 series that the fake gateway "texts". No gateway is
# called, so it never leaves this process.
FOUNDER = "+91 98200 55501"
FOUNDER_NORM = "9820055501"
FAKE_CODE = "482913"


# ---------------------------------------------------------------------------
# What counts as a mobile number.
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("typed", [
    "+91 98200 55501", "9820055501", "09820055501", "919820055501",
    "98200-55501", "(98200) 55501", "+91-98200-55501", " 98200 55501 ",
])
def test_the_ways_people_write_an_indian_mobile_are_accepted(typed):
    from services.auth.phone import valid_indian_mobile
    assert valid_indian_mobile(typed) == FOUNDER_NORM


@pytest.mark.parametrize("typed, why", [
    ("12345678", "the old rule let 8 digits through; OTP sign-in then refused it"),
    ("5820055501", "Indian mobiles start 6-9"),
    ("044 2345 6789", "a landline cannot receive the code"),
    ("+1 415 555 0100", "a US number: its last ten digits are nobody's"),
    ("+971 50 123 4567", "a UAE number: its last ten digits would be someone else's Indian mobile"),
    ("98200555012", "eleven digits with no 0 prefix is a typo, not a number"),
    ("", "empty"),
    ("abcdefghij", "letters"),
])
def test_anything_else_is_refused_rather_than_guessed_at(typed, why):
    from services.auth.phone import valid_indian_mobile
    assert valid_indian_mobile(typed) == "", why


def test_the_frontend_rule_is_the_same_rule():
    """Two copies of one rule drift. Keep them visibly in step."""
    from pathlib import Path
    js = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "phone.js").read_text(encoding="utf-8")
    assert "/^[6-9]\\d{9}$/" in js
    assert 'startsWith("91")' in js and 'startsWith("0")' in js


# ---------------------------------------------------------------------------
# The proof.
# ---------------------------------------------------------------------------
def test_a_proof_vouches_for_exactly_one_number():
    from services.auth.phone_proof import issue_phone_proof, read_phone_proof
    proof = issue_phone_proof(FOUNDER_NORM)
    assert read_phone_proof(proof["phone_token"]) == FOUNDER_NORM
    assert read_phone_proof(proof["phone_token"]) != "9820055502"
    assert proof["expires_at"], "the screen is told when to ask again"


def test_a_proof_cannot_be_forged_stretched_or_borrowed():
    import jwt
    from config import JWT_SECRET, JWT_ALGORITHM
    from services.auth import phone_proof as pp

    good = pp.issue_phone_proof(FOUNDER_NORM)["phone_token"]
    assert pp.read_phone_proof(good[:-2] + ("aa" if not good.endswith("aa") else "bb")) == "", "tampered"
    assert pp.read_phone_proof("") == "" and pp.read_phone_proof(None) == ""

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    expired = jwt.encode({"sub": FOUNDER_NORM, "purpose": pp.PURPOSE, "exp": past}, pp._KEY, algorithm=JWT_ALGORITHM)
    assert pp.read_phone_proof(expired) == "", "a lapsed proof is no proof"

    other_purpose = jwt.encode({"sub": FOUNDER_NORM, "purpose": "something_else",
                                "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                               pp._KEY, algorithm=JWT_ALGORITHM)
    assert pp.read_phone_proof(other_purpose) == ""

    # Signed with the session secret itself — the thing a leaked session
    # token would be. The derived key refuses it.
    with_session_key = jwt.encode({"sub": FOUNDER_NORM, "purpose": pp.PURPOSE,
                                   "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                                  JWT_SECRET, algorithm=JWT_ALGORITHM)
    assert pp.read_phone_proof(with_session_key) == ""


# ---------------------------------------------------------------------------
# Texting the code, and checking it.
# ---------------------------------------------------------------------------
class _Req:
    def __init__(self, ip="10.44.0.1"):
        self.headers = {"X-Forwarded-For": ip, "user-agent": "pytest"}
        self.client = type("C", (), {"host": ip})()


def _gateway_patch(testdb):
    """Point the OTP store at the test db and replace BOTH senders."""
    import services.otp as otp
    import services.captcha as captcha_mod
    import routers.signup as signup
    saved = (otp.db, signup.db, otp._apm_send_and_fetch_otp, otp._send_otp_sms, captcha_mod.verify_captcha)
    texted = []

    async def _fake_gateway(norm):
        texted.append(norm)
        return FAKE_CODE

    async def _no_twilio(*a, **k):
        raise AssertionError("the fake gateway answers first; Twilio must not be reached")

    async def _cap(*a, **k):
        return True, "test"

    otp.db = testdb
    signup.db = testdb
    otp._apm_send_and_fetch_otp = _fake_gateway
    otp._send_otp_sms = _no_twilio
    captcha_mod.verify_captcha = _cap

    def restore():
        (otp.db, signup.db, otp._apm_send_and_fetch_otp, otp._send_otp_sms,
         captcha_mod.verify_captcha) = saved
    return texted, restore


def test_a_code_is_texted_to_a_real_mobile_and_confirms_it(with_test_db):
    async def scenario(db):
        import routers.signup as signup
        from models.signup import PhoneCodeInput, PhoneVerifyInput
        from services.rate_limit import reset_for_test
        from services.auth.phone_proof import read_phone_proof
        await reset_for_test()
        texted, restore = _gateway_patch(db)
        try:
            sent = await signup.phone_send_code(PhoneCodeInput(phone=FOUNDER), _Req())
            ok = await signup.phone_verify(PhoneVerifyInput(phone="98200 55501", code=FAKE_CODE), _Req())
            left = await db.otp_codes.count_documents({"phone": FOUNDER_NORM})
            return texted, sent, ok, left, read_phone_proof(ok["phone_token"])
        finally:
            restore()

    texted, sent, ok, left, vouched = with_test_db(scenario)
    assert texted == [FOUNDER_NORM], "texted once, to the ten digits the gateway expects"
    assert sent["sent"] is True and "tenant_id" not in sent, "the internal scope stays internal"
    assert ok["verified"] is True and ok["phone"] == "+91 98200 55501"
    assert vouched == FOUNDER_NORM, "the proof names the number that was confirmed"
    assert left == 0, "a code is good once"


def test_a_malformed_number_is_refused_before_anything_is_texted(with_test_db):
    async def scenario(db):
        import routers.signup as signup
        from models.signup import PhoneCodeInput
        from services.rate_limit import reset_for_test
        await reset_for_test()
        texted, restore = _gateway_patch(db)
        try:
            with pytest.raises(HTTPException) as e:
                await signup.phone_send_code(PhoneCodeInput(phone="12345678"), _Req())
            return texted, e.value
        finally:
            restore()

    texted, err = with_test_db(scenario)
    assert err.status_code == 400 and "10-digit Indian mobile" in err.detail
    assert texted == [], "no text for a number that cannot be one"


def test_a_wrong_code_is_counted_and_five_spend_it(with_test_db):
    async def scenario(db):
        import routers.signup as signup
        from models.signup import PhoneCodeInput, PhoneVerifyInput
        from services.rate_limit import reset_for_test
        await reset_for_test()
        _, restore = _gateway_patch(db)
        try:
            await signup.phone_send_code(PhoneCodeInput(phone=FOUNDER), _Req())
            codes = []
            for i in range(6):
                try:
                    await signup.phone_verify(PhoneVerifyInput(phone=FOUNDER, code="000000"),
                                              _Req(ip=f"10.44.1.{i}"))
                except HTTPException as e:
                    codes.append(e.status_code)
            # the right code, after the wrong ones spent it
            try:
                await signup.phone_verify(PhoneVerifyInput(phone=FOUNDER, code=FAKE_CODE), _Req(ip="10.44.2.1"))
                late = 200
            except HTTPException as e:
                late = e.status_code
            return codes, late
        finally:
            restore()

    codes, late = with_test_db(scenario)
    assert codes[:5] == [401] * 5, "each wrong guess is refused and counted"
    assert codes[5] == 429, "the sixth finds the code spent"
    assert late == 400, "and the right code no longer works — ask for a new one"


def test_one_number_cannot_be_texted_on_a_loop(with_test_db):
    """The one public endpoint that texts a number nobody registered. Per
    network limits alone would let a script rotate addresses; this caps the
    number itself."""
    async def scenario(db):
        import routers.signup as signup
        import services.otp as otp
        from models.signup import PhoneCodeInput
        from services.rate_limit import reset_for_test
        await reset_for_test()
        texted, restore = _gateway_patch(db)
        saved_cooldown = otp.OTP_RESEND_COOLDOWN
        otp.OTP_RESEND_COOLDOWN = 0   # step past the 30s wait to reach the hourly cap
        try:
            refused = None
            for i in range(7):
                try:
                    await signup.phone_send_code(PhoneCodeInput(phone=FOUNDER), _Req(ip=f"10.45.0.{i}"))
                except HTTPException as e:
                    refused = (i, e.status_code, e.detail)
                    break
            return texted, refused
        finally:
            otp.OTP_RESEND_COOLDOWN = saved_cooldown
            restore()

    texted, refused = with_test_db(scenario)
    assert len(texted) == 5, "five codes an hour to one number, from any number of networks"
    assert refused and refused[0] == 5 and refused[1] == 429
    assert "minute" in refused[2], "and it says how long"


# ---------------------------------------------------------------------------
# Register trusts a phone only with proof for that number.
# ---------------------------------------------------------------------------
def _register(db, **extra):
    from tests.test_s4_register import _reg_patch, _Req as _RegReq
    import routers.auth as auth
    from services.rate_limit import reset_for_test

    async def go():
        restore = _reg_patch(db)
        await reset_for_test()
        try:
            inp = auth.RegisterInput(company_name="Sharma Textiles", name="Ravi Sharma",
                                     email="ravi@sharmatex.in", password="Scratch-4821",
                                     industry="Textiles", **extra)
            try:
                await auth.register(inp, _RegReq(), Response())
            except HTTPException as e:
                return {"error": (e.status_code, e.detail)}
            return {"user": await db.users.find_one({"email": "ravi@sharmatex.in"}, {"_id": 0})}
        finally:
            restore()
    return go()


def test_register_refuses_a_mobile_nobody_confirmed(with_test_db):
    out = with_test_db(lambda db: _register(db, phone=FOUNDER))
    status, detail = out["error"]
    assert status == 400 and detail["code"] == "phone_unverified"


def test_register_refuses_a_proof_for_a_different_number(with_test_db):
    """Confirm your own number, then type a colleague's: the proof does not
    transfer."""
    from services.auth.phone_proof import issue_phone_proof
    token = issue_phone_proof("9820055502")["phone_token"]
    out = with_test_db(lambda db: _register(db, phone=FOUNDER, phone_token=token))
    assert out["error"][1]["code"] == "phone_unverified"


def test_register_refuses_a_number_that_cannot_be_a_mobile(with_test_db):
    out = with_test_db(lambda db: _register(db, phone="12345678"))
    assert out["error"][1]["code"] == "phone_invalid"


def test_a_confirmed_mobile_is_stored_the_way_it_is_written_and_marked(with_test_db):
    from services.auth.phone_proof import issue_phone_proof
    token = issue_phone_proof(FOUNDER_NORM)["phone_token"]
    out = with_test_db(lambda db: _register(db, phone="098200-55501", phone_token=token))
    user = out["user"]
    assert user["phone"] == "+91 98200 55501", "however it was typed"
    assert user["phone_norm"] == FOUNDER_NORM, "the sign-in and WhatsApp key"
    assert user["phone_verified_at"], "and we know it was confirmed, and when"


def test_register_without_a_phone_still_works_for_callers_that_have_none(with_test_db):
    """The wizard now requires the mobile. The API does not: an account with
    no phone simply cannot use Mobile OTP, which is harmless. What the API
    enforces is the security property — a phone it stores was proven."""
    out = with_test_db(lambda db: _register(db))
    assert out["user"]["phone_norm"] == "" and out["user"]["phone_verified_at"] is None


# ---------------------------------------------------------------------------
# Twilio gets a number it can dial.
# ---------------------------------------------------------------------------
def test_twilio_is_handed_an_e164_number_not_what_was_typed(with_test_db):
    async def scenario(db):
        import services.otp as otp
        saved = (otp.db, otp._apm_send_and_fetch_otp, otp._send_otp_sms)
        dialled = []

        async def _no_apm(norm):
            return None

        async def _twilio(to, code):
            dialled.append(to)
            return True
        otp.db, otp._apm_send_and_fetch_otp, otp._send_otp_sms = db, _no_apm, _twilio
        try:
            await otp._issue_otp(FOUNDER_NORM, "98200 55501", tenant_id="t-any")
            return dialled
        finally:
            otp.db, otp._apm_send_and_fetch_otp, otp._send_otp_sms = saved

    assert with_test_db(scenario) == ["+919820055501"]


# ---------------------------------------------------------------------------
# The screens.
# ---------------------------------------------------------------------------
def _fe(*parts):
    from pathlib import Path
    return (Path(__file__).resolve().parents[2] / "frontend" / "src").joinpath(*parts).read_text(encoding="utf-8")


def test_the_signup_step_requires_the_mobile_and_confirms_it():
    basics = _fe("pages", "onboarding", "BasicsFlow.js")
    phone = basics[basics.index('key: "phone"'):basics.index('key: "team_size"')]
    assert "optional: true" not in phone, "the founder's mobile is not optional any more"
    assert "normIndianMobile(v)" in phone, "and it is the shared rule, not a digit count"
    assert "confirmByCode: true" in phone
    assert '"/signup/phone/send-code"' in basics and '"/signup/phone/verify"' in basics


def test_the_proof_reaches_register_and_survives_a_resume():
    assert "phone_token: payload.phone_token" in _fe("pages", "onboarding", "BuildReveal.js")
    assert "phone_token: whole.phone_token" in _fe("pages", "Signup.js"), "saved on the draft with the number"
    assert "phone_token: about.phone_token" in _fe("lib", "onboardingDraft.js"), "and restored from it"


def test_a_lapsed_proof_at_create_has_a_way_back_to_the_step():
    reveal = _fe("pages", "onboarding", "BuildReveal.js")
    assert '"phone_unverified"' in reveal and 'data-testid="build-error-fix-phone"' in reveal


def test_sign_in_asks_which_workspace_instead_of_claiming_a_code_was_sent():
    """/auth/otp/request sends NOTHING for a number in two workspaces and
    answers with a list. The page used to ignore that, say "OTP sent", and
    wait for a text that was never coming."""
    login = _fe("pages", "Login.js")
    handler = login[login.index("const requestOtp"):login.index("const submitOtp")]
    assert "data.ambiguous" in handler, "the list is read"
    assert handler.index("data.ambiguous") < handler.index("setOtpSent(true)"), \
        "and handled before the page claims a code went out"
    assert 'data-testid="otp-workspace-picker"' in login
    assert "loginWithOtp(otpPhone, otpCode, otpTenant)" in login, "verify names the workspace it chose"
    assert "tenant_id: tenantId" in _fe("context", "AuthContext.js")


def test_the_code_boxes_are_one_component():
    shared = _fe("components", "auth", "OtpBoxes.js")
    assert "export default function OtpBoxes" in shared
    for page in (("pages", "Login.js"), ("pages", "onboarding", "BasicsFlow.js")):
        assert 'components/auth/OtpBoxes' in _fe(*page), f"{page[-1]} uses the shared boxes"

"""One founder, several companies (2026-09-20).

Yokesh: a founder may run more than one business. The mobile is the person —
the same number signs in to each of their companies — and the email is one per
company. Until now the second company died at the very end of onboarding:
`users.email` is globally unique, so reusing the address was refused after the
whole OS had been built, and if the password matched too, register quietly
signed them into their FIRST workspace while the screen showed the reveal.

So: /signup/phone/verify says what the number already reaches, register accepts
a second company with the confirmed mobile and NO email or password, the
switcher links a person's rows by that number, and WhatsApp keeps working.
"""
import os

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request as StarletteRequest

import core
import routers.auth as rauth
import routers.signup as rsignup
import services.whatsapp as wa
from core import hash_password, now_iso
from models.auth import RegisterInput, SwitchWorkspaceInput
from models.signup import PhoneVerifyInput
from services.auth.phone_proof import issue_phone_proof

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

# A workspace that has already been set up: /auth/me backfills vocabulary, the
# operating model and finance categories through the AI when they are missing,
# and these tests are not about that.
_SETTLED = {
    "lexicon": {"customer": {"singular": "Buyer", "plural": "Buyers"}},
    "operating_model": {"pipelines": [{"key": "sales", "label": "Sales", "stages": []}]},
    "finance_categories": {"expense": ["Other"], "asset": ["Other"]},
}
PHONE = "9820010001"
OTHER = "9820019999"


_IP = iter(f"10.0.{n // 250}.{n % 250}" for n in range(1, 5000))


def _req(path="/api/auth/register"):
    """A request from its own address: register allows three workspaces per
    network per hour (auth.py), and that bucket outlives a single test."""
    return StarletteRequest({"type": "http", "method": "POST", "path": path,
                             "headers": [], "query_string": b"", "client": (next(_IP), 0)})


def _patch(testdb, *mods):
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb

    def restore():
        for m, d in saved:
            m.db = d
    return restore


def _proof(norm=PHONE):
    """What /signup/phone/verify hands the wizard for a confirmed number."""
    return issue_phone_proof(norm)["phone_token"]


async def _seed_first_company(db, *, phone=PHONE, email="rajesh@sharma.co", verified=True):
    """Sharma Textiles, owned by Rajesh, who signs in with email OR mobile."""
    await db.tenants.insert_one({"id": "t-sharma", "name": "Sharma Textiles", **_SETTLED})
    await db.users.insert_one({
        "id": "u-rajesh", "tenant_id": "t-sharma", "name": "Rajesh Sharma", "role": "owner",
        "email": email, "password_hash": hash_password("Textiles-4821"),
        "phone": "+91 98200 10001", "phone_norm": phone,
        "phone_verified_at": now_iso() if verified else None, "created_at": now_iso()})
    from services.auth.membership import create_membership
    from core import PERMISSION_KEYS
    await create_membership(db, user_id="u-rajesh", tenant_id="t-sharma", role="owner",
                            permissions=list(PERMISSION_KEYS))


async def _refused(coro):
    try:
        return None, await coro
    except HTTPException as e:
        return (e.status_code, e.detail), None


# ---------------------------------------------------------------------------
# The moment the code is confirmed, say what this number already reaches.
# ---------------------------------------------------------------------------
def test_confirming_the_code_says_which_companies_the_number_already_runs(with_test_db, monkeypatch):
    async def scenario(db):
        restore = _patch(db, rsignup)
        try:
            await _seed_first_company(db)
            # invited to a second workspace, never signed in: that one opens
            # with its invite link, so it is listed apart and carries no id
            await db.tenants.insert_one({"id": "t-nila", "name": "Nila Exports"})
            await db.users.insert_one({
                "id": "u-inv", "tenant_id": "t-nila", "name": "Rajesh", "role": "sales",
                "phone_norm": PHONE, "created_at": now_iso()})
            from services.auth.membership import create_membership, STATUS_PENDING
            await create_membership(db, user_id="u-inv", tenant_id="t-nila", role="sales",
                                    permissions=[], status=STATUS_PENDING)
            return await rsignup.phone_verify(PhoneVerifyInput(phone=PHONE, code="123456"), _req())
        finally:
            restore()

    # the code itself is checked by the OTP service; this test is about the answer
    async def _ok(*a, **k):
        return True
    monkeypatch.setattr("services.otp.consume_otp", _ok)
    monkeypatch.setattr(rsignup, "_guard_signup_endpoint", _ok, raising=False)

    out = with_test_db(scenario)
    assert out["verified"] is True and out["phone_token"], "the proof still comes back"
    assert [w["tenant_name"] for w in out["workspaces"]] == ["Sharma Textiles"]
    assert out["workspaces"][0]["role"] == "owner"
    assert [p["tenant_name"] for p in out["pending_invites"]] == ["Nila Exports"]
    assert "tenant_id" not in out["pending_invites"][0], "an invite is not a door to pick here"
    assert out["name"] == "Rajesh Sharma", "so a second company need not ask again"


def test_a_number_nobody_has_used_reaches_nothing(with_test_db, monkeypatch):
    async def scenario(db):
        restore = _patch(db, rsignup)
        try:
            return await rsignup.phone_verify(PhoneVerifyInput(phone=OTHER, code="123456"), _req())
        finally:
            restore()

    async def _ok(*a, **k):
        return True
    monkeypatch.setattr("services.otp.consume_otp", _ok)
    monkeypatch.setattr(rsignup, "_guard_signup_endpoint", _ok, raising=False)

    out = with_test_db(scenario)
    assert out["workspaces"] == [] and out["pending_invites"] == [] and out["name"] == ""


# ---------------------------------------------------------------------------
# A second company: the confirmed mobile, and nothing else.
# ---------------------------------------------------------------------------
def test_a_second_company_needs_no_email_and_no_password(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db)
            out = await rauth.register(
                RegisterInput(company_name="Nila Exports", name="Rajesh Sharma",
                              phone_token=_proof()),
                _req(), Response())
            new_tid = out["tenant"]["id"]
            owner = await db.users.find_one({"tenant_id": new_tid}, {"_id": 0})
            from services.auth.membership import find_membership
            m = await find_membership(db, owner["id"], new_tid)
            first = await db.users.find_one({"id": "u-rajesh"}, {"_id": 0, "wa_primary": 1})
            return out, owner, m, first, await db.tenants.count_documents({})
        finally:
            restore()

    out, owner, m, first, tenants = with_test_db(scenario)
    assert out["tenant"]["name"] == "Nila Exports" and tenants == 2, "a real second workspace"
    assert owner["role"] == "owner" and (m or {}).get("role") == "owner"
    assert owner["email"] == "" and owner["passwordless"] is True, "mobile is the way in"
    assert "password_hash" not in owner
    assert owner["name"] == "Rajesh Sharma", "their name comes from the account they already have"
    assert owner["phone_norm"] == PHONE and owner["phone_verified_at"]
    assert first.get("wa_primary") is True, "WhatsApp keeps landing in the first company"


def test_a_first_company_still_needs_an_email_and_a_password(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            # a proof for a number nobody has confirmed before
            refused, _ = await _refused(rauth.register(
                RegisterInput(company_name="Brand New", name="Someone", phone_token=_proof(OTHER)),
                _req(), Response()))
            # and the other way round: no proof at all
            refused_2, _ = await _refused(rauth.register(
                RegisterInput(company_name="Brand New", name="Someone"),
                _req(), Response()))
            return refused, refused_2, await db.tenants.count_documents({})
        finally:
            restore()

    refused, refused_2, tenants = with_test_db(scenario)
    assert refused[0] == 400 and refused[1]["code"] == "identity_unknown"
    assert refused_2[0] == 400 and refused_2[1]["code"] == "identity_unknown"
    assert tenants == 0, "nothing half-created"


# ---------------------------------------------------------------------------
# The email wall, and the sign-in that pretended to be a new company.
# ---------------------------------------------------------------------------
def test_reusing_the_address_for_another_company_is_refused_by_name(with_test_db):
    """The report: told at the very end that the email is taken. It still is —
    one address, one company — but now it says which company holds it and where
    the second one comes from."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db)
            refused, _ = await _refused(rauth.register(
                RegisterInput(company_name="Nila Exports", name="Rajesh Sharma",
                              email="rajesh@sharma.co", password="Textiles-4821",
                              phone_token=_proof()),
                _req(), Response()))
            return refused, await db.tenants.count_documents({})
        finally:
            restore()

    refused, tenants = with_test_db(scenario)
    assert refused[0] == 400 and refused[1]["code"] == "email_registered"
    assert "Sharma Textiles" in refused[1]["message"], "it names the company that holds the address"
    assert "mobile" in refused[1]["message"], "and the door that opens"
    assert tenants == 1, "they were NOT signed into the first company as if it had worked"


def test_the_same_company_pressed_twice_still_signs_them_in(with_test_db):
    """The lost press (2026-09-17) must keep working: same address, same
    password, same company name — their first attempt did create it."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db)
            out = await rauth.register(
                RegisterInput(company_name="Sharma Textiles", name="Rajesh Sharma",
                              email="rajesh@sharma.co", password="Textiles-4821"),
                _req(), Response())
            return out, await db.tenants.count_documents({})
        finally:
            restore()

    out, tenants = with_test_db(scenario)
    assert out["user"]["id"] == "u-rajesh" and out["tenant"]["id"] == "t-sharma"
    assert tenants == 1


# ---------------------------------------------------------------------------
# Moving between them.
# ---------------------------------------------------------------------------
async def _two_companies(db):
    await _seed_first_company(db)
    await db.tenants.insert_one({"id": "t-nila", "name": "Nila Exports", **_SETTLED})
    await db.users.insert_one({
        "id": "u-rajesh-2", "tenant_id": "t-nila", "name": "Rajesh Sharma", "role": "owner",
        "email": "", "passwordless": True, "phone": "+91 98200 10001", "phone_norm": PHONE,
        "phone_verified_at": now_iso(), "created_at": now_iso()})
    from services.auth.membership import create_membership
    from core import PERMISSION_KEYS
    await create_membership(db, user_id="u-rajesh-2", tenant_id="t-nila", role="owner",
                            permissions=list(PERMISSION_KEYS))


def test_the_switcher_lists_both_and_moves_between_them(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _two_companies(db)
            me = {"id": "u-rajesh", "tenant_id": "t-sharma", "role": "owner", "permissions": []}
            listed = await rauth.list_my_workspaces(user=me)
            switched = await rauth.switch_workspace(
                SwitchWorkspaceInput(tenant_id="t-nila"), _req("/api/auth/me/switch-workspace"),
                Response(), user=me)
            return listed, switched
        finally:
            restore()

    listed, switched = with_test_db(scenario)
    names = sorted(w["tenant_name"] for w in listed["workspaces"])
    assert names == ["Nila Exports", "Sharma Textiles"], "both companies, one mobile"
    assert [w["is_current"] for w in listed["workspaces"] if w["tenant_id"] == "t-sharma"] == [True]
    assert switched["tenant"]["id"] == "t-nila", "and switching lands in the other one"


def test_switching_is_refused_without_a_confirmed_number_on_both_sides(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _two_companies(db)
            # the second company's row was never confirmed by a code
            await db.users.update_one({"id": "u-rajesh-2"}, {"$set": {"phone_verified_at": None}})
            me = {"id": "u-rajesh", "tenant_id": "t-sharma", "role": "owner", "permissions": []}
            unverified, _ = await _refused(rauth.switch_workspace(
                SwitchWorkspaceInput(tenant_id="t-nila"), _req(), Response(), user=me))
            # and a workspace this number has nothing to do with
            await db.tenants.insert_one({"id": "t-stranger", "name": "Someone Else"})
            stranger, _ = await _refused(rauth.switch_workspace(
                SwitchWorkspaceInput(tenant_id="t-stranger"), _req(), Response(), user=me))
            return unverified, stranger
        finally:
            restore()

    unverified, stranger = with_test_db(scenario)
    assert unverified[0] == 403 and stranger[0] == 403


def test_a_removed_membership_is_not_a_way_back_in(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _two_companies(db)
            from services.auth.membership import update_membership
            await update_membership(db, user_id="u-rajesh-2", tenant_id="t-nila",
                                    updates={"status": "removed"})
            me = {"id": "u-rajesh", "tenant_id": "t-sharma", "role": "owner", "permissions": []}
            listed = await rauth.list_my_workspaces(user=me)
            refused, _ = await _refused(rauth.switch_workspace(
                SwitchWorkspaceInput(tenant_id="t-nila"), _req(), Response(), user=me))
            return listed, refused
        finally:
            restore()

    listed, refused = with_test_db(scenario)
    assert [w["tenant_name"] for w in listed["workspaces"]] == ["Sharma Textiles"]
    assert refused[0] == 403


# ---------------------------------------------------------------------------
# The gate, and WhatsApp.
# ---------------------------------------------------------------------------
def test_the_owner_gate_stands_down_when_the_credentials_exist_elsewhere(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _two_companies(db)
            second = {"id": "u-rajesh-2", "tenant_id": "t-nila", "role": "owner",
                      "permissions": [], "passwordless": True, "email": ""}
            out = await rauth.me(user=second)
            # someone genuinely mobile-only, with nothing anywhere else
            await db.tenants.insert_one({"id": "t-solo", "name": "Solo Co", **_SETTLED})
            await db.users.insert_one({
                "id": "u-solo", "tenant_id": "t-solo", "name": "Solo", "role": "owner",
                "email": "", "passwordless": True, "phone_norm": OTHER,
                "phone_verified_at": now_iso(), "created_at": now_iso()})
            solo = {"id": "u-solo", "tenant_id": "t-solo", "role": "owner",
                    "permissions": [], "passwordless": True, "email": ""}
            out_solo = await rauth.me(user=solo)
            return out["user"]["credentials_elsewhere"], out_solo["user"]["credentials_elsewhere"]
        finally:
            restore()

    second, solo = with_test_db(scenario)
    assert second is True, "their first company already has an email and a password"
    assert solo is False, "a genuinely mobile-only owner is still asked"


def test_whatsapp_lands_in_the_company_the_number_chose(with_test_db):
    async def scenario(db):
        restore = _patch(db, wa)
        try:
            await _two_companies(db)
            await db.users.update_one({"id": "u-rajesh"}, {"$set": {"wa_primary": True}})
            chosen = await wa.resolve_wa_tenant("+919820010001")
            # with nothing chosen it stays ambiguous and is not guessed
            await db.users.update_one({"id": "u-rajesh"}, {"$unset": {"wa_primary": ""}})
            ambiguous = await wa.resolve_wa_tenant("+919820010001")
            return chosen, ambiguous
        finally:
            restore()

    chosen, ambiguous = with_test_db(scenario)
    assert chosen == "t-sharma", "the first company keeps the WhatsApp line"
    assert ambiguous != "t-sharma", "an unchosen collision is still not guessed at"


# ---------------------------------------------------------------------------
# The wizard itself.
# ---------------------------------------------------------------------------
from pathlib import Path  # noqa: E402

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


def test_the_mobile_is_asked_before_the_email():
    """Which is the whole point: the number is what tells us they already have
    a company, so it has to come before the address that collides."""
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    order = [k for k in ("company_name", "name", "phone", "email", "password", "team_size")
             if f'key: "{k}"' in src]
    assert order == ["company_name", "name", "phone", "email", "password", "team_size"]
    assert src.index('key: "phone"') < src.index('key: "email"')


def test_a_founder_we_know_is_asked_for_neither_an_email_nor_a_password():
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    assert src.count("onlyWhenNew: true") == 2, "the email and password steps, and only those"
    assert "const stepsFor = (identityKnown) => STEPS.filter((st) => !st.onlyWhenNew || !identityKnown);" in src
    signup = _fe("pages", "Signup.js")
    assert 'if (identity?.known) return { ...base, email: "", password: "", identity_known: true };' in signup
    build = _fe("pages", "onboarding", "BuildReveal.js")
    assert "...(payload.identity_known ? {} : { email: payload.email, password: payload.password })" in build


def test_the_chooser_offers_both_doors():
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    assert 'data-testid="signup-existing-workspaces"' in src
    assert 'data-testid="signup-create-another"' in src
    assert "navigate(`/login?phone=" in src, "opening one goes to sign-in for a fresh code"
    assert 'data-testid="signup-existing-invite"' in src, "an invite is shown, not offered as a door"


def test_the_recovery_sign_in_cannot_land_in_another_company():
    build = _fe("pages", "onboarding", "BuildReveal.js")
    assert "if (signIn && !payload.identity_known) {" in build
    assert "landed.trim().toLowerCase() === (payload.company_name || \"\").trim().toLowerCase()" in build


def test_the_profile_menu_switches_between_companies():
    layout = _fe("components", "Layout.js")
    assert 'data-testid="workspace-switcher"' in layout
    assert 'data-testid={`switch-workspace-${r.tenant_id}`}' in layout
    assert 'data-testid="add-company"' in layout and '/signup?add=1' in layout
    ctx = _fe("context", "AuthContext.js")
    assert 'api.post("/auth/me/switch-workspace"' in ctx


def test_the_owner_gate_reads_the_servers_answer():
    gate = _fe("components", "auth", "OwnerCredentialsGate.js")
    assert "&& !user.credentials_elsewhere;" in gate

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
import routers.tenant_settings as ts
import services.whatsapp as wa
from core import hash_password, now_iso
from models.auth import RegisterInput, SwitchWorkspaceInput
from models.tenant import TenantUpdateInput
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


def test_a_first_company_needs_an_address_and_a_confirmed_mobile(with_test_db):
    """No password from anyone (2026-09-20) — but a first company must say where
    to reach them, and everyone must have a way back in."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            # a proof for a number nobody has confirmed, and no address with it
            no_address, _ = await _refused(rauth.register(
                RegisterInput(company_name="Brand New", name="Someone", phone_token=_proof(OTHER)),
                _req(), Response()))
            # and nothing at all: no proof, no password, no way in
            no_way_in, _ = await _refused(rauth.register(
                RegisterInput(company_name="Brand New", name="Someone", email="new@brand.co"),
                _req(), Response()))
            return no_address, no_way_in, await db.tenants.count_documents({})
        finally:
            restore()

    no_address, no_way_in, tenants = with_test_db(scenario)
    assert no_address[0] == 400 and no_address[1]["code"] == "identity_unknown"
    assert no_way_in[0] == 400 and no_way_in[1]["code"] == "phone_unverified"
    assert tenants == 0, "nothing half-created"


def test_a_first_company_sets_no_password_at_all(with_test_db):
    """Yokesh: we don't need that password — let them log in by mobile."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            out = await rauth.register(
                RegisterInput(company_name="Brand New", name="Asha", email="asha@brand.co",
                              phone=OTHER, phone_token=_proof(OTHER)),
                _req(), Response())
            owner = await db.users.find_one({"tenant_id": out["tenant"]["id"]}, {"_id": 0})
            return out, owner
        finally:
            restore()

    out, owner = with_test_db(scenario)
    assert out["tenant"]["name"] == "Brand New"
    assert owner["passwordless"] is True and "password_hash" not in owner
    assert owner["email"] == "asha@brand.co", "the address is still how support reaches them"
    assert owner["phone_norm"] == OTHER and owner["phone_verified_at"], "and the mobile is the sign-in"


def test_a_signed_in_founder_creates_a_company_without_a_code(with_test_db):
    """Their session carries a mobile that was confirmed long ago; register
    reads it instead of asking for a fresh proof."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db)
            signed_in = {"id": "u-rajesh", "tenant_id": "t-sharma", "role": "owner",
                         "name": "Rajesh Sharma", "permissions": [],
                         "phone_norm": PHONE, "phone_verified_at": now_iso()}
            out = await rauth.register(
                RegisterInput(company_name="Kaveri Logistics", name="Rajesh Sharma"),
                _req(), Response(), caller=signed_in)
            owner = await db.users.find_one({"tenant_id": out["tenant"]["id"]}, {"_id": 0})
            return out, owner
        finally:
            restore()

    out, owner = with_test_db(scenario)
    assert out["tenant"]["name"] == "Kaveri Logistics"
    assert owner["phone_norm"] == PHONE and owner["phone_verified_at"], "the session's number"
    assert owner["passwordless"] is True and owner["email"] == ""
    assert owner["name"] == "Rajesh Sharma"


def test_a_session_whose_number_was_never_confirmed_is_still_asked(with_test_db):
    """There would otherwise be nothing to sign the new workspace in with."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db, verified=False)
            unconfirmed = {"id": "u-rajesh", "tenant_id": "t-sharma", "role": "owner",
                           "name": "Rajesh Sharma", "permissions": [],
                           "phone_norm": PHONE, "phone_verified_at": None}
            refused, _ = await _refused(rauth.register(
                RegisterInput(company_name="Kaveri Logistics", name="Rajesh Sharma"),
                _req(), Response(), caller=unconfirmed))
            return refused, await db.tenants.count_documents({})
        finally:
            restore()

    refused, tenants = with_test_db(scenario)
    assert refused[0] == 400 and refused[1]["code"] == "phone_unverified"
    assert tenants == 1, "nothing created"


def test_a_lost_create_press_is_recovered_by_the_confirmed_mobile(with_test_db):
    """The recovery used to be the password they had just typed. There is none
    now, so the number confirmed one step earlier answers instead."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db)
            await db.users.update_one({"id": "u-rajesh"}, {"$unset": {"password_hash": ""},
                                                           "$set": {"passwordless": True}})
            same = await rauth.register(
                RegisterInput(company_name="Sharma Textiles", name="Rajesh Sharma",
                              email="rajesh@sharma.co", phone_token=_proof()),
                _req(), Response())
            # somebody else's address, with their own confirmed number
            theirs, _ = await _refused(rauth.register(
                RegisterInput(company_name="Sharma Textiles", name="Impostor",
                              email="rajesh@sharma.co", phone_token=_proof(OTHER)),
                _req(), Response()))
            return same, theirs, await db.tenants.count_documents({})
        finally:
            restore()

    same, theirs, tenants = with_test_db(scenario)
    assert same["tenant"]["id"] == "t-sharma" and same["user"]["id"] == "u-rajesh"
    assert theirs[0] == 400 and theirs[1]["code"] == "email_registered", "a stranger gets the wall"
    assert tenants == 1


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
# The company's own address (2026-09-20, Yokesh): "I just get the email for the
# support thing, so there's no need for the password asking."
# ---------------------------------------------------------------------------
def test_a_second_company_keeps_a_contact_address_of_its_own(with_test_db):
    """Not a sign-in, so it can be the SAME address the first company uses —
    that is the whole point of holding it on the workspace."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _seed_first_company(db)
            out = await rauth.register(
                RegisterInput(company_name="Nila Exports", name="Rajesh Sharma",
                              phone_token=_proof(), support_email="rajesh@sharma.co"),
                _req(), Response())
            tid = out["tenant"]["id"]
            tenant = await db.tenants.find_one({"id": tid}, {"_id": 0, "support_email": 1})
            owner = await db.users.find_one({"tenant_id": tid}, {"_id": 0, "email": 1, "passwordless": 1})
            return tenant, owner
        finally:
            restore()

    tenant, owner = with_test_db(scenario)
    assert tenant["support_email"] == "rajesh@sharma.co", "the same address their first company uses"
    assert owner["email"] == "" and owner["passwordless"] is True, "and still no second sign-in"


def test_the_address_can_be_skipped_and_added_later_in_settings(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, core, ts)
        try:
            await _seed_first_company(db)
            out = await rauth.register(
                RegisterInput(company_name="Nila Exports", name="Rajesh Sharma", phone_token=_proof()),
                _req(), Response())
            tid = out["tenant"]["id"]
            skipped = await db.tenants.find_one({"id": tid}, {"_id": 0, "support_email": 1})
            owner = await db.users.find_one({"tenant_id": tid}, {"_id": 0, "id": 1})
            later = await ts.update_tenant(
                TenantUpdateInput(support_email="hello@nila.co"),
                user={"id": owner["id"], "tenant_id": tid, "role": "owner",
                      "permissions": ["team_manage"], "name": "Rajesh"})
            return skipped, later.get("support_email")
        finally:
            restore()

    skipped, later = with_test_db(scenario)
    assert skipped["support_email"] == "", "skipping is fine"
    assert later == "hello@nila.co", "Settings fills it in"


# ---------------------------------------------------------------------------
# Switching must really switch.
# ---------------------------------------------------------------------------
def test_switching_hands_over_the_other_workspaces_own_identity(with_test_db):
    """The row, the role and the workspace all come from the target — nothing
    of the old company may ride along."""
    async def scenario(db):
        restore = _patch(db, rauth, core)
        try:
            await _two_companies(db)
            # they are the OWNER of the first and only Sales in the second
            await db.users.update_one({"id": "u-rajesh-2"}, {"$set": {"role": "sales"}})
            from services.auth.membership import update_membership
            await update_membership(db, user_id="u-rajesh-2", tenant_id="t-nila",
                                    updates={"role": "sales", "permissions": []})
            me = {"id": "u-rajesh", "tenant_id": "t-sharma", "role": "owner", "permissions": []}
            out = await rauth.switch_workspace(
                SwitchWorkspaceInput(tenant_id="t-nila"), _req(), Response(), user=me)
            import jwt as _jwt
            from core import JWT_SECRET, JWT_ALGORITHM
            token = out.get("token") or ""
            claims = _jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM]) if token else {}
            return out, claims
        finally:
            restore()

    out, claims = with_test_db(scenario)
    assert out["tenant"]["id"] == "t-nila"
    assert out.get("role") == "sales", "their role THERE, not the one they hold here"
    if claims:
        assert claims["tenant_id"] == "t-nila"
        assert claims["sub"] == "u-rajesh-2", "the token names the row that workspace knows"


def test_the_switch_drops_what_was_cached_for_the_old_company():
    """The service worker caches API GETs by URL for 24h — tasks, people,
    invoices, /auth/me. After a switch those answers belong to another company,
    so the switch purges them exactly as signing out does."""
    sw = (FE.parent / "src" / "service-worker.js").read_text(encoding="utf-8")
    assert "'/api/auth/me/switch-workspace'" in sw
    block = sw[sw.index("'/api/auth/me/switch-workspace'"):]
    assert "caches.delete('decisionos-api')" in block[:600]
    assert "PURGE_API_CACHE" in sw, "and the page can ask for it directly"
    ctx = _fe("context", "AuthContext.js")
    assert 'postMessage({ type: "PURGE_API_CACHE" })' in ctx


def test_other_tabs_follow_the_switch():
    """One cookie per browser: a tab still showing the old company is, from the
    moment of the switch, writing into the new one."""
    ctx = _fe("context", "AuthContext.js")
    assert 'localStorage.setItem("dos_active_workspace"' in ctx
    assert 'e.key !== "dos_active_workspace"' in ctx
    assert "window.location.reload();" in ctx


# ---------------------------------------------------------------------------
# The wizard itself.
# ---------------------------------------------------------------------------
from pathlib import Path  # noqa: E402

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*parts):
    return FE.joinpath(*parts).read_text(encoding="utf-8")


def test_the_mobile_is_the_very_first_question():
    """Yokesh: a returning founder could type any name and then be greeted as
    whoever the number belongs to ("type Nitish, hear Welcome back Rajesh").
    Asking the number first means we know WHO before we ask anything of them."""
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    order = [k for k in ("phone", "name", "company_name", "email", "support_email", "team_size")
             if f'key: "{k}"' in src]
    assert order == ["phone", "name", "company_name", "email", "support_email", "team_size"]
    assert src.index('key: "phone"') < src.index('key: "name"') < src.index('key: "company_name"')


def test_a_founder_we_know_is_never_asked_for_a_name():
    """Their name comes from the account the confirmed number belongs to, and
    the greeting uses THAT — never anything typed on this screen."""
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    name_step = src[src.index('key: "name"'):src.index('key: "company_name"')]
    assert "onlyWhenNew: true" in name_step
    company = src[src.index('key: "company_name"'):src.index('key: "email"')]
    assert "q: (f, who) =>" in company and "Hello ${first(who)}" in company
    assert "step.q(form, identity?.name)" in src, "and the greeting is passed that name"


def test_a_signed_in_founder_is_not_sent_back_through_a_code():
    """Yokesh: "it has the catch about being signed in, so why put the number
    and get the OTP again?" The session stands in for the proof."""
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    phone_step = src[src.index('key: "phone"'):src.index('key: "name"')]
    assert "skipWhenSignedIn: true" in phone_step
    assert "if (signedIn && st.skipWhenSignedIn) return false;" in src
    signup = _fe("pages", "Signup.js")
    assert "const sessionIdentity = user?.phone_verified_at" in signup, "confirmed number only"
    assert "fromSession: true" in signup
    assert 'setBasicsStart("company_name")' in signup, "straight to the company question"


def test_only_an_owner_is_invited_to_start_a_company():
    layout = _fe("components", "Layout.js")
    assert 'const canAddCompany = user?.role === "owner";' in layout
    assert "{canAddCompany && (" in layout
    assert "if (!others.length && !canAddCompany) return null;" in layout


def test_nobody_is_asked_for_a_password_and_a_second_company_gets_its_own_address():
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    assert 'key: "password"' not in src, "signup sets no password for anyone any more"
    assert "passwordProblem" not in src and "showPw" not in src, "and nothing is left of that step"
    # asked only of a founder we do not know: their name, and their address
    assert src.count("onlyWhenNew: true") == 2, "the name and the address a NEW founder gives"
    assert src.count("onlyWhenKnown: true") == 1, "the company address, asked only of them"
    assert "return identityKnown ? !st.onlyWhenNew : !st.onlyWhenKnown;" in src
    support = src[src.index('key: "support_email"'):]
    assert "optional: true" in support[:700], "skippable — Settings can fill it in later"
    signup = _fe("pages", "Signup.js")
    assert 'email: "", identity_known: true' in signup, "a second company sends no address"
    def _code(block):
        """The block with its prose stripped — these are notes ABOUT the
        password that was removed, not code that sends one."""
        keep = [l for l in block.splitlines() if not l.strip().startswith(("//", "/*", "*"))]
        return "\n".join(keep)

    payload = _code(signup[signup.index("const buildPayload"):signup.index("// Resume (or start) the draft")])
    assert "password" not in payload, "register is sent no password by anyone"
    form = _code(signup[signup.index("const [form, setForm] = useState("):signup.index("const [resumed,")])
    assert "password" not in form, "the wizard does not even hold one"
    assert 'support_email: (form.support_email || "").trim()' in signup, "the company address is"
    build = _fe("pages", "onboarding", "BuildReveal.js")
    assert "{ support_email: payload.support_email }" in build, "and reaches register"
    build = _fe("pages", "onboarding", "BuildReveal.js")
    assert "...(payload.identity_known ? {} : { email: payload.email })" in build


def test_the_chooser_offers_both_doors():
    src = _fe("pages", "onboarding", "BasicsFlow.js")
    assert 'data-testid="signup-existing-workspaces"' in src
    assert 'data-testid="signup-create-another"' in src
    assert "navigate(`/login?phone=" in src, "opening one goes to sign-in for a fresh code"
    assert 'data-testid="signup-existing-invite"' in src, "an invite is shown, not offered as a door"


def test_the_screen_no_longer_tries_to_recover_by_signing_in():
    """It cannot: nobody typed a password. register recognises the lost press
    from the confirmed mobile and answers with the session itself."""
    build = _fe("pages", "onboarding", "BuildReveal.js")
    assert "signIn" not in build and "payload.password" not in build


def test_the_switcher_keeps_the_list_it_fetched():
    """It fetched 200 OK and rendered nothing: the popover mounts and unmounts
    its content as it opens (StrictMode double-invokes besides), so a `live`
    flag captured per effect run was false by the time the answer arrived and
    every response was dropped. Same trap BasicsFlow documents."""
    layout = _fe("components", "Layout.js")
    block = layout[layout.index("function WorkspaceSwitcher"):layout.index("export default function Layout")]
    assert "let live = true" not in block and "live = false" not in block
    assert ".then(({ data }) => setRows(data?.workspaces || []))" in block


def test_the_profile_menu_switches_between_companies():
    layout = _fe("components", "Layout.js")
    assert 'data-testid="workspace-switcher"' in layout
    assert 'data-testid={`switch-workspace-${r.tenant_id}`}' in layout
    assert 'data-testid="add-company"' in layout and '/signup?add=1' in layout
    ctx = _fe("context", "AuthContext.js")
    assert 'api.post("/auth/me/switch-workspace"' in ctx


def test_the_owner_gate_only_stops_an_owner_with_no_way_in():
    """Every founder is mobile-only now, so a confirmed number is enough; the
    gate is left for an owner who has neither that nor a password."""
    gate = _fe("components", "auth", "OwnerCredentialsGate.js")
    assert "if (user.credentials_elsewhere) return false;" in gate
    assert "const signsInByMobile = !!user.phone_verified_at;" in gate
    assert "return !signsInByMobile && !signsInByPassword;" in gate

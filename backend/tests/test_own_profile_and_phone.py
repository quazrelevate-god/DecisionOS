"""Your own details are yours; someone else's mobile is not (2026-09-16).

Two halves of the same line.

The mobile number IS a sign-in: a code goes to it and whoever reads that code is
in. Manage team could change anyone's number, so a manager could point a
colleague's account at their own phone and sign in as them — the "Manage team
cannot raise access" rule (1fca68d) walked around, because you don't grant
yourself Finance, you become the person who has it. A manager may still FILL IN
a number for someone who has none (they cannot sign in at all until then, and
the invite link needs one); changing one already set is the owner's call.

And the other way round: a person keeps their own name, job title, what they
handle, mobile and email current without going through a manager — but nothing
in that form touches role, permissions or the reporting line.
"""
import os

import pytest
from fastapi import HTTPException

import core.deps as core_deps      # tenant_role_keys reads tenants through its own db
import routers.team as team
import routers.auth as rauth
import services.otp as otpmod
from models.team import UserCreateInput, UserUpdateInput
from models.auth import ProfileUpdateInput

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-sharma"


def _patch(testdb, *mods):
    saved = [(m, m.db) for m in mods]
    for m in mods:
        m.db = testdb

    def restore():
        for m, d in saved:
            m.db = d
    return restore


async def _seed(db):
    """An owner, a manager who holds Manage team, and a teammate with a number."""
    await db.tenants.update_one({"id": TENANT}, {"$set": {"id": TENANT, "name": "Sharma Textiles"}}, upsert=True)
    people = [
        {"id": "u-owner", "name": "Rajesh", "role": "owner", "email": "owner@sharma.co", "phone": "9820010001"},
        {"id": "u-mgr", "name": "Priya", "role": "sales", "email": "priya@sharma.co", "phone": "9820010002"},
        {"id": "u-fin", "name": "Sunita", "role": "finance", "email": "sunita@sharma.co", "phone": "9820010003"},
        {"id": "u-nophone", "name": "Arun", "role": "sales", "email": "arun@sharma.co", "phone": ""},
    ]
    for p in people:
        await db.users.insert_one({
            **p, "tenant_id": TENANT, "phone_norm": p["phone"][-10:] if p["phone"] else "",
            "permissions": ["team_manage"] if p["id"] == "u-mgr" else [],
        })
    return {p["id"]: p for p in people}


def _actor(uid, role, perms):
    return {"id": uid, "tenant_id": TENANT, "name": uid, "role": role, "permissions": perms}


OWNER = _actor("u-owner", "owner", [])
MANAGER = _actor("u-mgr", "sales", ["team_manage"])


# ---------------------------------------------------------------------------
# Someone else's mobile.
# ---------------------------------------------------------------------------
def test_a_manager_cannot_move_a_teammates_number_to_their_own_phone(with_test_db):
    async def scenario(db):
        restore = _patch(db, team)
        try:
            await _seed(db)
            try:
                await team.update_user("u-fin", UserUpdateInput(phone="9199999999"), user=MANAGER)
                refused = None
            except HTTPException as e:
                refused = e.status_code
            after = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "phone": 1, "phone_norm": 1})
            # The owner can, because that is who the rule leaves it to.
            await team.update_user("u-fin", UserUpdateInput(phone="9820010009"), user=OWNER)
            owner_did = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "phone": 1, "phone_norm": 1})
            return refused, after, owner_did
        finally:
            restore()

    refused, after, owner_did = with_test_db(scenario)
    assert refused == 403, "Manage team is not enough to change a number that is already set"
    assert after["phone"] == "9820010003" and after["phone_norm"] == "9820010003", "nothing moved"
    assert owner_did["phone_norm"] == "9820010009", "an owner can correct it"


def test_a_manager_can_still_fill_in_a_missing_number(with_test_db):
    """Someone with no number cannot sign in at all and has no invite link — the
    redesigned Team page hands a manager exactly this job."""
    async def scenario(db):
        restore = _patch(db, team)
        try:
            await _seed(db)
            await team.update_user("u-nophone", UserUpdateInput(phone="9820010077"), user=MANAGER)
            row = await db.users.find_one({"id": "u-nophone"}, {"_id": 0, "phone": 1, "phone_norm": 1})
            return row
        finally:
            restore()

    row = with_test_db(scenario)
    assert row["phone_norm"] == "9820010077", "a manager may add a number where there is none"


def test_everything_else_about_a_teammate_still_saves(with_test_db):
    """The rule is about the number, not about editing people: a manager sends
    the whole form back, phone included and unchanged, and it goes through."""
    async def scenario(db):
        restore = _patch(db, team)
        try:
            await _seed(db)
            await team.update_user(
                "u-fin",
                UserUpdateInput(title="Head of Finance", phone="+91 98200 10003"),
                user=MANAGER,
            )
            return await db.users.find_one({"id": "u-fin"}, {"_id": 0, "title": 1, "phone_norm": 1})
        finally:
            restore()

    row = with_test_db(scenario)
    assert row["title"] == "Head of Finance", "the rest of the form saves"
    assert row["phone_norm"] == "9820010003", "the same number, written differently, is not a change"


def test_one_mobile_one_member_in_a_workspace(with_test_db):
    """Two people on one number means codes and WhatsApp captures land on the
    wrong account. (The same number in ANOTHER workspace stays fine.)"""
    async def scenario(db):
        restore = _patch(db, team, core_deps)
        try:
            await db.tenants.update_one({"id": TENANT}, {"$set": {"roles": [{"key": "sales", "label": "Sales"}]}}, upsert=True)
            await _seed(db)
            try:
                await team.update_user("u-nophone", UserUpdateInput(phone="9820010003"), user=OWNER)
                edit = None
            except HTTPException as e:
                edit = (e.status_code, str(e.detail))
            try:
                await team.create_user(UserCreateInput(
                    name="Copycat", email="copy@sharma.co", role="sales",
                    phone="9820010003", password="secret123"), user=OWNER)
                add = None
            except HTTPException as e:
                add = e.status_code
            return edit, add
        finally:
            restore()

    edit, add = with_test_db(scenario)
    assert edit and edit[0] == 400 and "Sunita" in edit[1], "it says whose number it already is"
    assert add == 400, "and a new member cannot be created on it either"


# ---------------------------------------------------------------------------
# Your own details.
# ---------------------------------------------------------------------------
def test_a_member_keeps_their_own_details_without_a_manager(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth)
        try:
            await _seed(db)
            me = _actor("u-fin", "finance", [])
            await rauth.update_profile(ProfileUpdateInput(
                name="Sunita Rao", title="Head of Finance",
                about="GST filings, and every payment over 1 lakh",
                # the whole form comes back on save, number included: the same
                # number, written differently, is not a change and needs no code
                phone="+91 98200 10003"), user=me)
            return await db.users.find_one({"id": "u-fin"}, {"_id": 0})
        finally:
            restore()

    row = with_test_db(scenario)
    assert row["name"] == "Sunita Rao"
    assert row["title"] == "Head of Finance", "their own job title, in their own hands"
    assert row["about"].startswith("GST filings"), "and what they handle, for the team to see"
    assert row["phone_norm"] == "9820010003", "an unchanged number rides along untouched"
    # Changing it is theirs too — confirmed by a code to the new number since
    # 2026-09-19; see test_own_mobile_change_is_confirmed.py.
    assert row["role"] == "finance" and row["permissions"] == [], "and nothing about their access moved"


def test_your_own_profile_cannot_touch_role_or_access(with_test_db):
    """Not a rule in the endpoint — a shape. The form has no way to say it."""
    fields = set(ProfileUpdateInput.model_fields)
    for forbidden in ("role", "permissions", "follow_role", "reporting_manager_id", "tenant_id"):
        assert forbidden not in fields, f"{forbidden} has no business on your own profile"


def test_changing_your_own_email_asks_for_your_password(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth)
        try:
            await _seed(db)
            from core import hash_password
            await db.users.update_one({"id": "u-fin"},
                                      {"$set": {"password_hash": hash_password("secret123"),
                                                "email_verified_at": "2026-09-01T00:00:00+00:00"}})
            me = _actor("u-fin", "finance", [])
            try:
                await rauth.update_profile(ProfileUpdateInput(email="new@sharma.co"), user=me)
                bare = None
            except HTTPException as e:
                bare = e.status_code
            try:
                await rauth.update_profile(
                    ProfileUpdateInput(email="new@sharma.co", current_password="wrong-one"), user=me)
                wrong = None
            except HTTPException as e:
                wrong = e.status_code
            after_refusals = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "email": 1})
            await rauth.update_profile(
                ProfileUpdateInput(email="new@sharma.co", current_password="secret123"), user=me)
            done = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "email": 1, "email_verified_at": 1})
            # ...and not onto an address someone else already signs in with.
            try:
                await rauth.update_profile(
                    ProfileUpdateInput(email="priya@sharma.co", current_password="secret123"), user=me)
                taken = None
            except HTTPException as e:
                taken = e.status_code
            return bare, wrong, after_refusals["email"], done, taken
        finally:
            restore()

    bare, wrong, unchanged, done, taken = with_test_db(scenario)
    assert bare == 400 and wrong == 400, "the password is the proof it is you at the keyboard"
    assert unchanged == "sunita@sharma.co", "a refused change writes nothing"
    assert done["email"] == "new@sharma.co", "with the password, it saves"
    assert done["email_verified_at"] is None, "and the new address is unproven until they click the link"
    assert taken == 400, "an address already in use is refused"


def test_a_mobile_only_member_confirms_their_email_with_a_texted_code(with_test_db):
    async def scenario(db):
        restore = _patch(db, rauth, otpmod)
        try:
            await _seed(db)
            await db.users.update_one({"id": "u-fin"}, {"$set": {"passwordless": True}})
            me = _actor("u-fin", "finance", [])
            try:
                await rauth.update_profile(ProfileUpdateInput(email="otp@sharma.co"), user=me)
                bare = None
            except HTTPException as e:
                bare = e.status_code
            # the code the sign-in door would have texted them
            from services.otp import _hash_otp
            from datetime import datetime, timezone, timedelta
            await db.otp_codes.insert_one({
                "phone": "9820010003", "tenant_id": TENANT,
                "code_hash": _hash_otp("424242", "9820010003"),
                "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(), "attempts": 0,
            })
            try:
                await rauth.update_profile(
                    ProfileUpdateInput(email="otp@sharma.co", otp_code="000000"), user=me)
                wrong = None
            except HTTPException as e:
                wrong = e.status_code
            await rauth.update_profile(
                ProfileUpdateInput(email="otp@sharma.co", otp_code="424242"), user=me)
            row = await db.users.find_one({"id": "u-fin"}, {"_id": 0, "email": 1})
            spent = await db.otp_codes.count_documents({"phone": "9820010003"})
            return bare, wrong, row["email"], spent
        finally:
            restore()

    bare, wrong, email, spent = with_test_db(scenario)
    assert bare == 400, "a member with no password is asked for a code instead"
    assert wrong == 401, "a wrong code is refused the same way the sign-in door refuses it"
    assert email == "otp@sharma.co", "the right code saves the change"
    assert spent == 0, "and the code is spent, so it can't be replayed"

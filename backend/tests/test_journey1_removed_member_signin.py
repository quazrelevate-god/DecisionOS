"""A person removed from a company is told so at sign-in (JOURNEY-1, 2026-09-22).

Rajesh removed Sunita. She could still ask for a code, sign in, and land on a
Desk whose every request was then refused ("You no longer have access to this
workspace") — an empty Desk of skeletons and "…" with no reason given. Nothing
leaked (the server refused the data), but a person who was let go, or
suspended by mistake, deserves a sentence, not a spinner. The membership says
removed or suspended: no code is sent, and the screen says why.

The step that would send a code is stubbed: these tests must never reach an
SMS gateway.
"""
import os

import pytest
from fastapi import HTTPException, Response

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-removed"
PHONE = "7000011111"          # a fake number (never dialled; sending is stubbed anyway)
_sent = []


async def _fake_issue(norm, phone, tenant_id=None):
    _sent.append((norm, tenant_id))
    return {"sent": True, "dev_mode": True, "tenant_id": tenant_id}


def _env(db):
    # routers.auth_otp is not in the harness's list of modules it points at the
    # test database, so it is pointed here explicitly — these tests must never
    # read or write the database named in backend/.env.
    return e2e_env(db, stubs={"routers.auth_otp._issue_otp": _fake_issue, "routers.auth_otp.db": db})


async def _seed(db, status):
    await db.tenants.insert_one({"id": T, "name": "Sharma Textiles"})
    await db.users.insert_one({"id": "u-sunita", "tenant_id": T, "name": "Sunita Rao", "role": "finance",
                               "phone": PHONE, "phone_norm": PHONE, "created_at": "2026-09-01T00:00:00+00:00"})
    await db.memberships.insert_one({"id": "m1", "user_id": "u-sunita", "tenant_id": T, "status": status,
                                     "role": "finance"})


def _request(with_test_db, status, tenant_id=None):
    async def scenario(db):
        from models.auth import OtpRequestInput
        from routers.auth_otp import request_otp
        with _env(db):
            await _seed(db, status)
            _sent.clear()
            try:
                return await request_otp(OtpRequestInput(phone=PHONE, tenant_id=tenant_id)), list(_sent)
            except HTTPException as e:
                return e, list(_sent)
    return with_test_db(scenario)


def test_a_removed_person_gets_no_code_and_is_told_why(with_test_db):
    out, sent = _request(with_test_db, "removed")
    assert isinstance(out, HTTPException) and out.status_code == 403
    assert "no longer part of Sharma Textiles" in out.detail
    assert sent == [], "no code is sent to someone who was removed"


def test_a_suspended_person_is_told_the_same(with_test_db):
    out, sent = _request(with_test_db, "suspended")
    assert isinstance(out, HTTPException) and "no longer part of" in out.detail and sent == []


def test_naming_the_company_does_not_get_round_it(with_test_db):
    out, sent = _request(with_test_db, "removed", tenant_id=T)
    assert isinstance(out, HTTPException) and out.status_code == 403 and "no longer part of" in out.detail
    assert sent == []


def test_an_active_member_still_gets_a_code(with_test_db):
    out, sent = _request(with_test_db, "active")
    assert not isinstance(out, HTTPException) and out["sent"] is True
    assert sent == [(PHONE, T)]


def test_an_invited_member_is_still_sent_to_their_link(with_test_db):
    out, _ = _request(with_test_db, "pending")
    from routers.auth_otp import INVITE_FIRST
    assert isinstance(out, HTTPException) and out.detail == INVITE_FIRST


def test_the_code_step_refuses_a_removed_person_too(with_test_db):
    async def scenario(db):
        from models.auth import OtpVerifyInput
        from routers.auth_otp import verify_otp
        with _env(db):
            await _seed(db, "removed")
            try:
                await verify_otp(OtpVerifyInput(phone=PHONE, code="123456"), Response())
            except HTTPException as e:
                return e
            return None

    e = with_test_db(scenario)
    assert e is not None and e.status_code == 403 and "no longer part of" in e.detail


def test_signup_does_not_offer_a_company_the_person_was_removed_from(with_test_db):
    async def scenario(db):
        from services.auth.phone import find_tenant_choices_for_phone, split_live_and_pending
        with _env(db):
            await _seed(db, "removed")
            return await split_live_and_pending(db, await find_tenant_choices_for_phone(db, PHONE))

    live, pending = with_test_db(scenario)
    assert live == [] and pending == []

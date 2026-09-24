"""An invitation takes a seat (JOURNEY-1 J12-09).

The audit's workspace read "0 of 15 seats" over 23 people who had been invited
and could all have walked in. Seats were counted with LIVE_STATUSES -- active
memberships -- so somebody became a seat the first time they SIGNED IN, and
until then the cap did nothing at all.

The founder's call: the invite is the commitment, so the invite is the seat. To
invite one more at the cap, cancel an invitation nobody has used
(POST /users/{id}/uninvite) and the seat comes straight back.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-seats"
CAP = 3


def _member(n, status):
    return {"id": f"m{n}", "user_id": f"u{n}", "tenant_id": T, "role": "sales",
            "status": status, "created_at": f"2026-09-2{n}T00:00:00+00:00"}


def _run(with_test_db, members):
    async def scenario(db):
        from services.plans import enforce_seat_limit
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "seat_limit_override": CAP})
            if members:
                await db.memberships.insert_many([dict(m) for m in members])
            try:
                await enforce_seat_limit(db, T)
                return None
            except HTTPException as e:
                return e.detail
    return with_test_db(scenario)


def test_two_active_and_one_invited_fills_a_three_seat_plan(with_test_db):
    refused = _run(with_test_db, [_member(1, "active"), _member(2, "active"), _member(3, "pending")])
    assert refused, "the third seat was taken by an invitation; the fourth should be refused"
    assert refused["seats_used"] == 3
    assert refused["seats_invited"] == 1
    assert "haven't been used" in refused["message"], refused["message"]
    assert "Cancel an invitation" in refused["message"], "say the way out that costs nothing"


def test_invitations_alone_can_fill_the_plan(with_test_db):
    """The audit's own case, in miniature: nobody has signed in yet."""
    refused = _run(with_test_db, [_member(1, "pending"), _member(2, "pending"), _member(3, "pending")])
    assert refused, "23 invitations against 15 seats is what this stops"
    assert refused["seats_used"] == 3 and refused["seats_invited"] == 3


def test_cancelling_an_invitation_gives_the_seat_back(with_test_db):
    """uninvite sets the membership to `removed`, which is not a seat."""
    ok = _run(with_test_db, [_member(1, "active"), _member(2, "active"), _member(3, "removed")])
    assert ok is None, "a cancelled invitation must not go on holding a seat"


def test_a_suspended_member_is_counted_as_it_always_was(with_test_db):
    ok = _run(with_test_db, [_member(1, "active"), _member(2, "active"), _member(3, "suspended")])
    assert ok is None, "suspended stays uncounted — this change was not about them"


def test_room_to_spare_is_still_room(with_test_db):
    assert _run(with_test_db, [_member(1, "active"), _member(2, "pending")]) is None

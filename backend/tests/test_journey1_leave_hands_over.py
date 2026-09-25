"""Leave hands the approvals over, and takes them back (ASK-5 / J11-02).

A manager going on leave left every decision and escalation waiting on them,
waiting on them: leave changed who was in the building and nothing else.

The founder's rule, 24 September: an approver is ASKED who covers them when
they raise the leave, the cover is switched on by the APPROVAL of that leave,
and it ends with the leave's own last day — nobody has to remember to hand it
back, because the window in `acting_as` (RBAC-26) simply stops being active.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-cover"
NOW = datetime.now(timezone.utc)
KARTHIK = {"id": "u-karthik", "tenant_id": T, "role": "manager", "name": "Karthik",
           "permissions": ["inbox", "decisions_approve", "approvals"], "permissions_custom": True}
RAJESH = {"id": "u-rajesh", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
AMIT = {"id": "u-amit", "tenant_id": T, "role": "operations", "name": "Amit",
        "permissions": ["inbox"], "permissions_custom": True}


def _day(n):
    return (NOW + timedelta(days=n)).date().isoformat()


async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Sharma Textiles"})
    await db.users.insert_many([
        {"id": KARTHIK["id"], "tenant_id": T, "name": "Karthik", "role": "manager",
         "permissions": KARTHIK["permissions"], "permissions_custom": True},
        {"id": RAJESH["id"], "tenant_id": T, "name": "Rajesh", "role": "owner"},
        {"id": AMIT["id"], "tenant_id": T, "name": "Amit", "role": "operations"},
    ])


def _raise_and_decide(with_test_db, *, delegate, decision, requester=KARTHIK):
    async def scenario(db):
        from services.leave import _create_leave
        import routers.team as team
        from models.team import LeaveDecisionInput
        with e2e_env(db, keep={"services.notifications.push_notification"}):
            await _seed(db)
            lv = await _create_leave(T, requester, "casual", _day(1), _day(3), "full", "Wedding",
                                     is_emergency=False, delegate_user_id=delegate)
            if decision:
                await team._decide_leave(lv["id"], RAJESH, decision, "", decision, "decided")
            who = await db.users.find_one({"id": requester["id"], "tenant_id": T}, {"_id": 0, "acting_as": 1})
            return lv, (who or {}).get("acting_as")
    return with_test_db(scenario)


def test_the_cover_is_asked_for_and_kept_on_the_request(with_test_db):
    lv, _acting = _raise_and_decide(with_test_db, delegate=AMIT["id"], decision=None)
    assert lv["delegate_user_id"] == AMIT["id"], "the approver can see who will cover before they say yes"


def test_nothing_is_handed_over_until_the_leave_is_approved(with_test_db):
    _lv, acting = _raise_and_decide(with_test_db, delegate=AMIT["id"], decision=None)
    assert not acting, "a request is not a hand-over"


def test_approving_the_leave_hands_the_approvals_over_for_its_days(with_test_db):
    _lv, acting = _raise_and_decide(with_test_db, delegate=AMIT["id"], decision="approved")
    assert acting and acting["delegate_user_id"] == AMIT["id"]
    assert acting["from"] == _day(1) and acting["to"] == _day(3), "exactly the days of the leave"


def test_it_comes_back_on_its_own_when_the_leave_is_over(with_test_db):
    """No sweeper anywhere: the window carries dates, and delegation reads
    them. (is_active_now allows up to 14 hours of grace either side, on
    purpose — India is UTC+5:30 and "from today" has to work at 9am there —
    so a leave starting tomorrow may already be live tonight.)"""
    from services.delegation import is_active_now
    _lv, acting = _raise_and_decide(with_test_db, delegate=AMIT["id"], decision="approved")
    assert is_active_now({**acting, "from": _day(4), "to": _day(6)}) is False, "not started"
    assert is_active_now({**acting, "from": _day(-6), "to": _day(-4)}) is False, "over — handed back"
    assert is_active_now({**acting, "from": _day(-1), "to": _day(1)}) is True, "on, while they are away"


def test_a_rejected_leave_hands_nothing_over(with_test_db):
    _lv, acting = _raise_and_decide(with_test_db, delegate=AMIT["id"], decision="rejected")
    assert not acting, "nobody covers a leave that was turned down"


def test_somebody_with_nothing_to_approve_is_not_asked(with_test_db):
    lv, acting = _raise_and_decide(with_test_db, delegate=AMIT["id"], decision="approved", requester=AMIT)
    assert lv["delegate_user_id"] is None, "Amit approves nothing; there is nothing to hand over"
    assert not acting


def test_naming_nobody_is_allowed(with_test_db):
    _lv, acting = _raise_and_decide(with_test_db, delegate=None, decision="approved")
    assert not acting, "the founder's rule is to ASK, not to insist"


def test_the_delegate_is_told(with_test_db):
    async def scenario(db):
        from services.leave import _create_leave
        import routers.team as team
        with e2e_env(db, keep={"services.notifications.push_notification"}):
            await _seed(db)
            lv = await _create_leave(T, KARTHIK, "casual", _day(1), _day(3), "full", "Wedding",
                                     is_emergency=False, delegate_user_id=AMIT["id"])
            await team._decide_leave(lv["id"], RAJESH, "approved", "", "approved", "decided")
            return await db.notifications.find({"tenant_id": T, "user_id": AMIT["id"]}, {"_id": 0}).to_list(10)

    notes = with_test_db(scenario)
    assert any("on leave" in n["message"] and "approvals come to you" in n["message"] for n in notes), notes


def test_the_route_actually_passes_the_cover_through(with_test_db):
    """R10-34 (manual round 1) — THE BUG THE TESTS ABOVE COULD NOT SEE.

    Every test above calls _create_leave directly, so all of them passed while
    the HTTP route dropped `delegate_user_id` on the floor: the model accepted
    it, the service honoured it, and nothing carried it between the two. Every
    cover was silently None. This one goes through routers.team.create_leave,
    the way the phone does."""
    async def scenario(db):
        import routers.team as team
        from models.team import LeaveRequestInput
        with e2e_env(db, keep={"services.notifications.push_notification"}):
            await _seed(db)
            lv = await team.create_leave(
                LeaveRequestInput(leave_type="casual", from_date=_day(1), to_date=_day(3),
                                  day_portion="full", reason="Wedding",
                                  delegate_user_id=AMIT["id"]),
                user=KARTHIK)
            return lv

    lv = with_test_db(scenario)
    assert lv["delegate_user_id"] == AMIT["id"], \
        "the route must carry the cover to the service, not only the model"

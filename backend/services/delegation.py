"""Approval delegation — "approve on my behalf while I'm away" (RBAC-26).

A member sets `acting_as` on themselves: {delegate_user_id, from, to, reason}
(POST /me/acting-as). While today is inside that window, the delegate may
approve tasks and decide decisions that name the member, sees them in their
Approvals view and on the Desk, and is told when new ones arrive.

2026-09-16 (RBAC P2): the setting was stored but nothing read it.
"""
from datetime import datetime
from typing import Iterable, List, Optional

from shared.due import today_ist


def is_active_now(ac: dict, now: Optional[datetime] = None) -> bool:
    """Inclusive date window; an empty end means no bound on that side.

    `now` is for the tests, which need to stand on a named day rather than on
    whatever day the suite happens to run.
    """
    if not (ac or {}).get("delegate_user_id"):
        return False
    # THE WINDOW IS READ ON THE COMPANY'S OWN CALENDAR (2026-09-28).
    # The dates are days a person picked — "away from the 6th to the 8th" — so
    # the only question is what day it is HERE, and shared/due.today_ist is the
    # one answer the whole product uses (due dates, working days, the reminder
    # sweep). Both ends are then exact: on from the first day, off at midnight
    # after the last.
    #
    # It used to shift the UTC clock instead — +14h at the start, -12h at the
    # end, "on while it is that date anywhere in the world". The start was only
    # early, which costs nothing; the END was LATE, and late means somebody
    # still holds another person's approvals after they are back. A cover that
    # ended on Friday stayed live until 12:00 UTC on Saturday — 17:30 IST, most
    # of the working day — and every approval it let through was recorded in
    # the absent person's name. The window exists so nobody has to remember to
    # switch the hand-over off; one that switches off late gives that away.
    today = today_ist(now)
    start, end = (ac.get("from") or "")[:10], (ac.get("to") or "")[:10]
    if start and today < start:
        return False
    if end and today > end:
        return False
    return True


async def acting_for(db, tenant_id: str, user_id: str) -> List[str]:
    """The people whose approvals `user_id` holds right now."""
    if not tenant_id or not user_id:
        return []
    rows = await db.users.find(
        {"tenant_id": tenant_id, "acting_as.delegate_user_id": user_id},
        {"_id": 0, "id": 1, "acting_as": 1},
    ).to_list(50)
    return [r["id"] for r in rows if r.get("id") != user_id and is_active_now(r.get("acting_as") or {})]


async def delegates_of(db, tenant_id: str, user_ids: Iterable[str]) -> List[str]:
    """The active delegates of these people, so they hear what waits."""
    ids = [u for u in dict.fromkeys(user_ids or []) if u]
    if not ids:
        return []
    rows = await db.users.find(
        {"tenant_id": tenant_id, "id": {"$in": ids}}, {"_id": 0, "acting_as": 1},
    ).to_list(len(ids))
    out = []
    for r in rows:
        ac = r.get("acting_as") or {}
        if is_active_now(ac) and ac["delegate_user_id"] not in ids:
            out.append(ac["delegate_user_id"])
    return list(dict.fromkeys(out))

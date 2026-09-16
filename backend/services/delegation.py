"""Approval delegation — "approve on my behalf while I'm away" (RBAC-26).

A member sets `acting_as` on themselves: {delegate_user_id, from, to, reason}
(POST /me/acting-as). While today is inside that window, the delegate may
approve tasks and decide decisions that name the member, sees them in their
Approvals view and on the Desk, and is told when new ones arrive.

2026-09-16 (RBAC P2): the setting was stored but nothing read it.
"""
from datetime import datetime, timedelta, timezone
from typing import Iterable, List


def is_active_now(ac: dict) -> bool:
    """Inclusive date window; an empty end means no bound on that side."""
    if not (ac or {}).get("delegate_user_id"):
        return False
    # Dates are picked in the person's own day, which can be up to 14 hours
    # ahead of UTC and 12 behind (India is +5:30). A window is on while it is
    # that date anywhere, so "from today" works first thing in the morning —
    # comparing with the UTC date alone left it off until 5:30 am in India.
    now = datetime.now(timezone.utc)
    start, end = (ac.get("from") or "")[:10], (ac.get("to") or "")[:10]
    if start and (now + timedelta(hours=14)).date().isoformat() < start:
        return False
    if end and (now - timedelta(hours=12)).date().isoformat() > end:
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

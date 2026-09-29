"""One reading a day, so the score can eventually have a past (2026-09-29).

The Ops page has been honest about a real gap since KR-9: the founder's
reference draws a trend line and a "+3 pts this week" chip, and neither was
built, because NOTHING IN THE SYSTEM KEPT SCORE HISTORY. A trend drawn from a
single reading is drawn from nothing. So the page states its scope — all time —
and the delta chip renders for the demo tenant alone.

That gap closes by writing the number down. Once a day, per company, the
overall score and its four categories are appended to `operating_score_history`
— a small row, one per company per day. Nothing reads it yet and the page keeps
saying "all time"; in a month there is a month of real readings, and the trend
that was refused because it would have been invented can be drawn because it
is not.

Deliberately small:
  * ONE row per company per IST day (`_id` is "<tenant>:<day>"), so a restart
    storm, a second replica or a manual re-run cannot double-count. The FIRST
    reading of the day is the one kept, and later ticks cost a single
    find_one: the sweep runs every five minutes against a hundred companies,
    and scoring one takes about a second, so re-scoring all day would be most
    of what the worker does. A trend also wants its readings taken at a
    comparable hour, which the first sweep after midnight IST gives and "the
    last tick before the process happened to restart" does not.
  * It rides the leader-locked sweep, never a user's request: computing a
    company's score takes about a second, and nobody should wait for it.
  * Counts travel with the score. "Execution fell 9 points" is only useful
    beside "overdue went 4 -> 14", and re-deriving that later is impossible
    once the work has moved on.
  * Written from the OWNER's view of the company (finance included), because
    that is the company's score. Who may SEE it is the reading screen's
    business, as it already is for the live number.
"""
from __future__ import annotations

from typing import Optional

from core import logger, now_iso
from shared.due import today_ist

COLLECTION = "operating_score_history"


async def record_today(db, tenant_id: str, *, day: Optional[str] = None) -> bool:
    """Append today's reading for one company. True when a row was written.

    Idempotent per day: the row's id is the company and the day, so calling
    this ten times on a Tuesday leaves one Tuesday row — and the nine later
    calls cost one indexed lookup each, not nine scorings.
    """
    if not tenant_id:
        return False
    day = day or today_ist()
    if await db[COLLECTION].find_one({"_id": f"{tenant_id}:{day}"}, {"_id": 1}):
        return False
    try:
        from services.operating_score import _company_operating_view
        # An owner's eyes: the company's score is the whole company's, finance
        # and all. A synthetic viewer, not a real user row — nothing is read
        # from it but the permission flag.
        view = await _company_operating_view(tenant_id, {"role": "owner", "id": None}, now_iso())
    except Exception as e:
        logger.warning(f"[score-history] {tenant_id[:8]}... could not be scored: {e}")
        return False

    company, stats = view.get("company") or {}, view.get("stats") or {}
    if company.get("overall") is None:
        # Too new to have a score. Nothing to remember, and a row of nulls
        # would later read as a real zero.
        return False

    await db[COLLECTION].update_one(
        {"_id": f"{tenant_id}:{day}"},
        {"$set": {
            "tenant_id": tenant_id, "day": day, "recorded_at": now_iso(),
            "overall": company.get("overall"),
            "categories": company.get("categories") or {},
            "counts": {k: stats.get(k) for k in ("done", "open", "overdue", "open_complaints")},
        }},
        upsert=True,
    )
    return True


async def record_all(db) -> int:
    """Today's reading for every company. Returns how many were written."""
    day = today_ist()
    written = 0
    for tid in await db.tenants.distinct("id"):
        try:
            if await record_today(db, tid, day=day):
                written += 1
        except Exception as e:
            logger.warning(f"[score-history] {str(tid)[:8]}... failed: {e}")
    if written:
        logger.info(f"[score-history] {day}: {written} company reading(s) recorded")
    return written


async def history_for(db, tenant_id: str, days: int = 30) -> list[dict]:
    """The last `days` readings, oldest first. Nothing reads this yet — it is
    what the trend line will be drawn from once there is a month of it."""
    rows = await db[COLLECTION].find(
        {"tenant_id": tenant_id}, {"_id": 0},
    ).sort("day", -1).to_list(max(1, min(days, 365)))
    return list(reversed(rows))

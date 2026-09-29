"""How long work actually takes (2026-09-29).

Yokesh, walking the Ops page: "we can see individual person efficiency also
right". The page could say how MUCH each person had — done, open, overdue —
and nothing about how long any of it took. Two people both showing "5 done"
read the same whether one closes in two days and the other in nine, and
somebody who finishes everything a week late looked perfect, because `overdue`
only ever counted work still OPEN.

Both questions need one thing the task never carried: the moment it finished.
`updated_at` moves on any edit, so a task done on Monday and renamed on Friday
looked like five days of work. services/tasks.completion_stamp writes
`completed_at` from now on; `backfill_completed_at` below recovers it for
everything already finished.

THE HISTORY IS NOT LOST. Every close is in the activity log — kind
"task_done", carrying the task's id and when — because the Journal has been
writing one per completion all along. So the backfill is a real recovery, not
a guess: the log's time is the true one, and only a task with no event falls
back to `updated_at` (marked, so nothing later mistakes a fallback for a
measurement).

Everything here counts in WORKING days (shared/workdays: Sunday off), the same
calendar the stage deadlines and the stuck alerts use, so "three days" means
the same thing everywhere in the product.
"""
from __future__ import annotations

from statistics import median
from typing import Iterable, Optional

from core import logger
from shared.due import today_ist
from shared.workdays import ist_day, working_days_between


async def backfill_completed_at(db) -> None:
    """Recover the finish time of work that closed before the field existed.

    Idempotent: only touches tasks that have no `completed_at` yet, so a
    re-run after a failure picks up where it stopped.
    """
    finished = await db.tasks.find(
        {"status": "done", "completed_at": {"$exists": False}},
        {"_id": 0, "id": 1, "updated_at": 1, "created_at": 1},
    ).to_list(100_000)
    if not finished:
        return

    # One pass over the log for the ids we care about. Earliest event wins: a
    # task closed, reopened and closed again is dated from when it first
    # landed, which is the honest reading of "how long did this take".
    when: dict[str, str] = {}
    ids = [t["id"] for t in finished]
    for chunk in (ids[i:i + 500] for i in range(0, len(ids), 500)):
        async for ev in db.activity.find(
            {"kind": "task_done", "entity_id": {"$in": chunk}},
            {"_id": 0, "entity_id": 1, "created_at": 1},
        ):
            at, tid = ev.get("created_at"), ev.get("entity_id")
            if at and tid and (tid not in when or at < when[tid]):
                when[tid] = at

    from_log = guessed = 0
    for t in finished:
        at = when.get(t["id"])
        stamp = {"completed_at": at} if at else {
            # No event: `updated_at` is the closest thing on record. Said out
            # loud, so a reader of this data knows which rows are measured and
            # which are inferred.
            "completed_at": t.get("updated_at") or t.get("created_at"),
            "completed_at_inferred": True,
        }
        if not stamp["completed_at"]:
            continue
        if at:
            from_log += 1
        else:
            guessed += 1
        await db.tasks.update_one({"id": t["id"]}, {"$set": stamp})
    logger.info(f"[backfill_completed_at] {from_log} dated from the journal, {guessed} from updated_at")


# ─────────────────────────── reading it back ────────────────────────────────

def _days_to_close(t: dict) -> Optional[int]:
    """Working days from the day a task was created to the day it closed."""
    start, end = ist_day(t.get("created_at")), ist_day(t.get("completed_at"))
    if not start or not end or end < start:
        return None
    return working_days_between(start, end)


def _closed_on_time(t: dict) -> Optional[bool]:
    """Did it land by its date? None when it never had one — a task nobody
    dated cannot be late, and counting it either way would be a verdict the
    data does not support."""
    due, done = ist_day(t.get("due_date")), ist_day(t.get("completed_at"))
    if not due or not done:
        return None
    return done <= due


def timing_of(tasks: Iterable[dict], now: Optional[str] = None) -> dict:
    """How a person's finished work behaved, over the tasks handed in.

    Returns, with None wherever there is nothing to measure rather than a
    flattering zero:
      * `typical_days`   — the MEDIAN working days to close. Median, not mean:
                           one task left open over a festival week would drag
                           an average into nonsense.
      * `on_time_rate`   — of the closed tasks that HAD a due date, the share
                           that landed by it (0-100).
      * `dated`/`closed` — the denominators, so the screen can say what the
                           percentage is out of instead of asserting it.
      * `waiting_days`   — how long the OLDEST thing still open has been open.
                           The queue's age, which a rate cannot show.
    """
    rows = list(tasks or [])
    done = [t for t in rows if t.get("status") == "done" and t.get("completed_at")]
    spans = [d for d in (_days_to_close(t) for t in done) if d is not None]
    judged = [v for v in (_closed_on_time(t) for t in done) if v is not None]

    today = ist_day(now or today_ist())
    ages = []
    for t in rows:
        if t.get("status") in ("done", "cancelled"):
            continue
        started = ist_day(t.get("created_at"))
        if started and today and started <= today:
            ages.append(working_days_between(started, today))

    return {
        "typical_days": int(median(spans)) if spans else None,
        "closed": len(done),
        "on_time_rate": round(sum(1 for v in judged if v) * 100 / len(judged)) if judged else None,
        "dated": len(judged),
        "waiting_days": max(ages) if ages else None,
    }


# ─────────────────────── how long a sign-off waits ──────────────────────────

async def backfill_approval_requested_at(db) -> None:
    """Recover the request time for the approvals where it is knowable.

    A task that needs approval BEFORE work starts is created already waiting,
    so its `created_at` IS the moment the approver was asked — that is a fact
    about how the row was written, not a guess.

    Approval before CLOSING is different: the request is made when the doer
    marks the task complete, and nothing recorded that moment. There is no
    event for it in the Journal either (the log writes `task_approved`, not
    "sent for approval"), so those stay unmeasured rather than dated from
    something that only looks close. Turnaround for close-stage sign-offs
    begins accumulating from the day this shipped.
    """
    rows = await db.tasks.find(
        {"approval_required": True, "approval_stage": {"$ne": "close"},
         "approval_requested_at": {"$exists": False}},
        {"_id": 0, "id": 1, "created_at": 1},
    ).to_list(100_000)
    n = 0
    for t in rows:
        if not t.get("created_at"):
            continue
        await db.tasks.update_one({"id": t["id"]}, {"$set": {"approval_requested_at": t["created_at"]}})
        n += 1
    if n:
        logger.info(f"[backfill_approval_requested_at] {n} pre-work approval(s) dated from when they were raised")


def approvals_of(tasks: Iterable[dict], user_id: str, now: Optional[str] = None) -> dict:
    """What sign-offs cost, for one approver.

    An approver's queue is invisible in every count on the Ops page: work
    waiting on a signature is not the approver's OWN task, so it lands in
    nobody's Open and nobody's Overdue. A manager who takes three days over
    every approval slows the whole workshop and scores perfectly.

      * `typical_days` — median working days from the request to the answer.
      * `answered`     — how many were measured (the denominator).
      * `waiting`      — how many are sitting on them RIGHT NOW.
      * `oldest_days`  — how long the one at the bottom has been there.
    """
    rows = [t for t in (tasks or []) if t.get("approver_id") == user_id]
    spans = []
    for t in rows:
        asked, answered = ist_day(t.get("approval_requested_at")), ist_day(t.get("approved_at"))
        if asked and answered and answered >= asked:
            spans.append(working_days_between(asked, answered))

    today = ist_day(now or today_ist())
    pending = [t for t in rows if t.get("approval_status") == "pending"]
    ages = []
    for t in pending:
        asked = ist_day(t.get("approval_requested_at"))
        if asked and today and asked <= today:
            ages.append(working_days_between(asked, today))

    return {
        "typical_days": int(median(spans)) if spans else None,
        "answered": len(spans),
        "waiting": len(pending),
        "oldest_days": max(ages) if ages else None,
    }

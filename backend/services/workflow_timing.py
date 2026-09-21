"""Workflow timing: how long a stage should take, and what follows from it
(2026-09-22, Yokesh: "delay, overdue for the workflow, setting up the
timeline").

What was missing. The engine gated, advanced and escalated — but only on
DATES, and the work it created for a stage had none (on_stage_enter wrote
`due_date: None`). So stage work was never warned about, never overdue, never
escalated and never counted by the Desk's Delayed tile or the score. "Stuck"
existed only as a browser calculation nobody was told about, and a card had
no deadline of its own.

The rules, in one place:

  * A STAGE TAKES N WORKING DAYS — `days` on the stage in the operating model,
    else DEFAULT_STAGE_DAYS. When a card enters it, every open task on that
    stage without a date gets the stage's due date (entered + N working days).
    From there the machinery that already exists takes over: the due-soon
    warning, the overdue ladder (doer -> waited-on -> manager -> owner), the
    Delayed tile, the operating score.
  * A CARD IS STUCK after `stuck_after_days` working days in which neither it
    nor the work at its stage moved (per board, else DEFAULT_STUCK_DAYS). The
    leader-locked sweep now tells the people on that stage and the owner, once
    per quiet spell.
  * A CARD MAY HAVE A TARGET DATE ("ship by 15 Oct"). Its FORECAST is the
    current stage's due date (or today, if that has passed) plus the planned
    days of every stage still to come; forecast after target = at risk.
  * THE TIMELINE is each stage's planned days against the days it actually
    took, read off the stage-entered events the engine already records.

Working days are Monday-Saturday (shared/workdays.py).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from core import db, now_iso
from shared.workdays import add_working_days, ist_day, today_ist, working_days_between

logger = logging.getLogger("decisionos")

DEFAULT_STAGE_DAYS = 3
DEFAULT_STUCK_DAYS = 3
_CLOSED = ("done", "cancelled")


# ─────────────────────────────── pure helpers ──────────────────────────────
def stage_obj(pipeline: Optional[dict], key: str) -> dict:
    for s in (pipeline or {}).get("stages") or []:
        if isinstance(s, dict) and s.get("key") == key:
            return s
    return {}


def stage_days(pipeline: Optional[dict], key: str) -> int:
    """How many working days a stage should take."""
    try:
        n = int(stage_obj(pipeline, key).get("days") or 0)
    except (TypeError, ValueError):
        n = 0
    return n if n > 0 else DEFAULT_STAGE_DAYS


def stuck_days(pipeline: Optional[dict]) -> int:
    try:
        n = int((pipeline or {}).get("stuck_after_days") or 0)
    except (TypeError, ValueError):
        n = 0
    return n if n > 0 else DEFAULT_STUCK_DAYS


def entered_map(wf: dict) -> dict:
    """When the card entered each stage. The first 'entered' event wins (a
    replayed enter after a crash does not move the date); stage one's entry is
    the card's creation."""
    entered: dict = {}
    for ev in wf.get("stage_events") or []:
        key = (ev or {}).get("stage")
        if (ev or {}).get("kind") == "entered" and key and key not in entered:
            entered[key] = ev.get("at")
    # Cards moved before stage_events existed: fall back to the move history.
    for h in wf.get("history") or []:
        key = (h or {}).get("stage")
        if key and key not in entered and h.get("at"):
            entered[key] = h.get("at")
    stages = wf.get("stages") or []
    if stages and stages[0] not in entered and wf.get("created_at"):
        entered[stages[0]] = wf.get("created_at")
    return entered


def stage_due_date(entered_at, days: int) -> Optional[str]:
    day = ist_day(entered_at)
    return add_working_days(day, days).isoformat() if day else None


def card_timing(wf: dict, pipeline: Optional[dict], today=None, last_activity: Optional[str] = None) -> dict:
    """Everything about time for one card: the current stage's due date and
    how late it is, the target and forecast, the stuck clock, and the
    planned-vs-actual timeline of every stage."""
    today = today or today_ist()
    stages = wf.get("stages") or []
    cur_key = wf.get("stage")
    cur = stages.index(cur_key) if cur_key in stages else -1
    final = len(stages) - 1
    finished = cur == final and final >= 0
    entered = entered_map(wf)

    timeline = []
    for i, key in enumerate(stages):
        so = stage_obj(pipeline, key)
        planned = stage_days(pipeline, key)
        start = ist_day(entered.get(key)) if i <= cur else None
        left = ist_day(entered.get(stages[i + 1])) if (i < cur and i + 1 < len(stages)) else None
        actual = working_days_between(start, left or today) if start else None
        state = "done" if i < cur else ("current" if i == cur else "upcoming")
        timeline.append({
            "key": key, "label": so.get("label") or key.replace("_", " ").title(),
            "planned_days": None if i == final else planned,
            "actual_days": None if (i == final or state == "upcoming") else actual,
            "entered_at": entered.get(key) if i <= cur else None,
            "left_at": entered.get(stages[i + 1]) if i < cur else None,
            "state": state,
            "over": bool(actual is not None and i != final and actual > planned),
        })

    out = {
        "finished": finished,
        "stage_days": None, "stage_due": None, "stage_late_days": 0,
        "target_date": wf.get("target_date") or None,
        "forecast_date": None, "at_risk": False, "past_target": False,
        "stuck_after_days": stuck_days(pipeline),
        "idle_since": None, "idle_days": 0, "stuck": False,
        "timeline": timeline,
    }
    if cur < 0 or finished:
        if finished:
            out["forecast_date"] = (ist_day(entered.get(cur_key)) or today).isoformat()
        return out

    days = stage_days(pipeline, cur_key)
    due = stage_due_date(entered.get(cur_key), days)
    out["stage_days"], out["stage_due"] = days, due
    due_day = ist_day(due)
    if due_day and today > due_day:
        out["stage_late_days"] = working_days_between(due_day, today)

    # Forecast: this stage finishes on its due date (or today, if that has
    # passed and it is still here), then each stage still to come takes its
    # planned days; arriving at the final stage is the finish.
    base = max(due_day or today, today)
    remaining = sum(stage_days(pipeline, stages[i]) for i in range(cur + 1, final))
    forecast = add_working_days(base, remaining)
    out["forecast_date"] = forecast.isoformat()
    target = ist_day(out["target_date"])
    if target:
        out["past_target"] = today > target
        out["at_risk"] = forecast > target

    # The stuck clock: the last time the card or the work at its stage moved.
    moves = [h.get("at") for h in (wf.get("history") or []) if h.get("at")]
    moves += [e.get("at") for e in (wf.get("stage_events") or []) if e.get("at")]
    moves += [wf.get("created_at"), last_activity]
    idle_since = max((m for m in moves if m), default=None)
    out["idle_since"] = idle_since
    out["idle_days"] = working_days_between(ist_day(idle_since), today) if idle_since else 0
    out["stuck"] = out["idle_days"] >= out["stuck_after_days"]
    return out


# ─────────────────────────────── the engine's hook ─────────────────────────
async def date_stage_work(tenant_id: str, wf: dict, pipeline: Optional[dict]) -> Optional[str]:
    """On entering a stage: give every open, undated task on it the stage's due
    date, and record that date on the card. Returns the date.

    Tasks already dated keep their date — a person set it, or a decision did.
    """
    key = wf.get("stage")
    if not key:
        return None
    entered = entered_map(wf).get(key) or now_iso()
    due = stage_due_date(entered, stage_days(pipeline, key))
    if not due:
        return None
    await db.tasks.update_many(
        {"tenant_id": tenant_id, "workflow_id": wf["id"], "stage_key": key,
         "status": {"$nin": list(_CLOSED)}, "due_date": {"$in": [None, ""]}},
        {"$set": {"due_date": due, "due_from_stage": True, "updated_at": now_iso()}})
    await db.workflows.update_one({"id": wf["id"], "tenant_id": tenant_id},
                                  {"$set": {"stage_due": due}})
    return due


# ─────────────────────────────── the stuck alert ───────────────────────────
async def warn_stuck_workflows(tenant_id: str, now: Optional[datetime] = None) -> int:
    """Tell the people on a card's stage, and the owner, when the card has sat
    still for its board's stuck days. Once per quiet spell: the spell is named
    by the moment it began, so any move starts a new one. Returns how many
    cards were flagged."""
    from services.ai.generators import tenant_operating_model
    from services.notifications import _owner_ids, push_notification
    now = now or datetime.now(timezone.utc)
    today = today_ist(now)
    om = await tenant_operating_model(tenant_id)
    pipes = {p.get("key"): p for p in (om.get("pipelines") or [])}
    cards = await db.workflows.find(
        {"tenant_id": tenant_id},
        {"_id": 0, "id": 1, "title": 1, "type": 1, "stage": 1, "stages": 1, "history": 1,
         "stage_events": 1, "created_at": 1, "stuck_notified_for": 1, "target_date": 1}).to_list(500)
    active = [w for w in cards if w.get("stages") and w.get("stage") in w["stages"]
              and w["stage"] != w["stages"][-1]]
    if not active:
        return 0
    tasks = await db.tasks.find(
        {"tenant_id": tenant_id, "workflow_id": {"$in": [w["id"] for w in active]}},
        {"_id": 0, "workflow_id": 1, "stage_key": 1, "status": 1, "updated_at": 1,
         "assignee_id": 1, "co_assignee_ids": 1}).to_list(5000)
    owners = None
    flagged = 0
    for w in active:
        at_stage = [t for t in tasks if t.get("workflow_id") == w["id"] and t.get("stage_key") == w["stage"]]
        last_task = max((t.get("updated_at") for t in at_stage if t.get("updated_at")), default=None)
        pipe = pipes.get(w.get("type"))
        timing = card_timing(w, pipe, today, last_task)
        if not timing["stuck"] or w.get("stuck_notified_for") == timing["idle_since"]:
            continue
        if owners is None:
            owners = await _owner_ids(tenant_id)
        people = set(owners)
        for t in at_stage:
            if t.get("status") not in _CLOSED:
                people.add(t.get("assignee_id"))
                people.update(t.get("co_assignee_ids") or [])
        label = stage_obj(pipe, w["stage"]).get("label") or w["stage"].replace("_", " ")
        await push_notification(
            tenant_id, [p for p in people if p], 2,
            f"'{w.get('title')}' has not moved at {label} for {timing['idle_days']} working days",
            "workflow", w["id"], ntype="workflow_stuck", title=w.get("title"))
        await db.workflows.update_one({"id": w["id"], "tenant_id": tenant_id},
                                      {"$set": {"stuck_notified_for": timing["idle_since"]}})
        flagged += 1
    return flagged


# ─────────────────────────────── one-time backfill ─────────────────────────
async def backfill_stage_due_dates(dbh) -> None:
    """Date the stage work that was created before stages had a duration.

    Each open, undated task on a card's CURRENT stage gets the stage's due
    date — but never earlier than the next working day, so switching this on
    does not turn a company's whole board overdue overnight and fire the
    escalation ladder at everyone at once. Tasks on stages the card has left
    are the leftover review's business, not this one's.
    """
    from shared.normalizers import normalize_operating_model
    floor = add_working_days(today_ist(), 1)
    async for tenant in dbh.tenants.find({}, {"_id": 0, "id": 1, "operating_model": 1}):
        om = tenant.get("operating_model")
        pipes = {p.get("key"): p for p in (normalize_operating_model(om).get("pipelines") if om else [])}
        async for wf in dbh.workflows.find(
                {"tenant_id": tenant["id"]},
                {"_id": 0, "id": 1, "type": 1, "stage": 1, "stages": 1, "history": 1,
                 "stage_events": 1, "created_at": 1}):
            key = wf.get("stage")
            if not key or not wf.get("stages") or key == wf["stages"][-1]:
                continue
            pipe = pipes.get(wf.get("type"))
            due_day = ist_day(stage_due_date(entered_map(wf).get(key) or now_iso(), stage_days(pipe, key)))
            due = max(due_day or floor, floor).isoformat()
            res = await dbh.tasks.update_many(
                {"tenant_id": tenant["id"], "workflow_id": wf["id"], "stage_key": key,
                 "status": {"$nin": list(_CLOSED)}, "due_date": {"$in": [None, ""]}},
                {"$set": {"due_date": due, "due_from_stage": True}})
            await dbh.workflows.update_one({"id": wf["id"]}, {"$set": {"stage_due": due}})
            if res.modified_count:
                logger.info(f"[stage-days] dated {res.modified_count} task(s) on {wf['id'][:8]} to {due}")

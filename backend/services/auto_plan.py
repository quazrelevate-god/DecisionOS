"""The checklist Dex drafts by itself when a task is made (founder, 2026-10-29).

NF-4.18 (founder 2026-10-30): NOW OFF UNLESS THE COMPANY TURNS IT ON. "I don't
want that automatically creating of execution steps. It should be an optional
thing — we can't spend much on AI. When they need it, they can click it." Every
task got an AI call on creation, a background sweep drafted the rest, and My
Work asked for every card on screen without steps. Now none of that runs unless
an owner switches on Settings > AI processing > "Dex drafts steps for every new
task" (tenant.auto_plan_steps, default off). Ask Dex in the task
(POST /tasks/{id}/execution-plan/generate) and Add manually are unchanged.

Until now the AI Execution Guide waited for someone to press "Ask Dex" in the
task. The redesigned My Work shows each task's NEXT ACTION on its card — the
first step of its checklist not yet ticked — so every task needs a checklist
from the moment it exists. This drafts one, in the background, right after a
task is created, and the steps arrive ready to tick (accepted), editable like
any checklist.

Rules it keeps, all of them the manual button's:
  * only with the workspace's AI consent (services.ai_consent) — AI off means
    no draft, and the task keeps its "Add manually / Ask Dex" choice;
  * never over a checklist somebody already has, never on finished work, and
    never on a task still locked until it is approved before work starts (the
    approval unlocks it and schedules the draft then);
  * once per task: `plan_auto_at` is stamped before the call, so a retry, a
    second replica or the sweep never drafts it twice;
  * the generic four-step fallback (what ai_execution_plan returns when the
    model's answer could not be read) is not written — a placeholder list
    would show "Review the task details" as every card's next action.

`schedule()` is fire-and-forget and takes the CALLER'S db handle, so a test
that patched its router's db is the database the draft writes to. It is off
when AUTO_PLAN=off (the test suite sets that; tests call `draft_plan` directly).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# What ai_execution_plan falls back to when it cannot read the model's answer.
_FALLBACK = ["Review the task details", "Do the work", "Upload proof / notes", "Close the task"]
_TERMINAL = ("done", "cancelled")
_pending: set = set()   # strong refs, so a running draft is not garbage-collected


def _enabled() -> bool:
    return (os.environ.get("AUTO_PLAN") or "on").strip().lower() not in ("off", "0", "false", "no")


def auto_on(tenant: dict | None) -> bool:
    """The company chose to have every new task's steps drafted by Dex."""
    return bool((tenant or {}).get("auto_plan_steps"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _start_locked(t: dict) -> bool:
    # services.tasks.is_start_locked, inlined so this module has no import
    # cycle with the routers that call it.
    return bool(t.get("approval_required")) and t.get("approval_stage") != "close" \
        and t.get("approval_status") != "approved"


def _eligible(t: dict | None) -> bool:
    if not t:
        return False
    if (t.get("execution_plan") or {}).get("steps"):
        return False
    if t.get("plan_auto_at"):
        return False
    if t.get("status") in _TERMINAL:
        return False
    return not _start_locked(t)


async def draft_plan(db, tenant_id: str, task_id: str) -> bool:
    """Draft and save the checklist. True when one was written."""
    from services.ai_consent import has_active_consent
    try:
        t = await db.tasks.find_one({"id": task_id, "tenant_id": tenant_id}, {"_id": 0})
        if not _eligible(t):
            return False
        tenant = await db.tenants.find_one({"id": tenant_id},
                                           {"_id": 0, "ai_consent": 1, "industry": 1, "currency": 1,
                                            "auto_plan_steps": 1}) or {}
        if not has_active_consent(tenant) or not auto_on(tenant):
            return False
        # Claim it first: only the caller that flips the stamp drafts.
        claim = await db.tasks.update_one(
            {"id": task_id, "tenant_id": tenant_id, "plan_auto_at": {"$exists": False},
             "execution_plan.steps.0": {"$exists": False}},
            {"$set": {"plan_auto_at": _now()}})
        if not getattr(claim, "modified_count", 0):
            return False
        from services.ai.extraction import ai_execution_plan

        async def _give_back():
            # Hand the claim back so a later try can draft it — at most three
            # times, then it is left to the person's own Redraft.
            tries = int(t.get("plan_auto_tries") or 0) + 1
            if tries < 3:
                await db.tasks.update_one({"id": task_id, "tenant_id": tenant_id},
                                          {"$unset": {"plan_auto_at": ""}, "$set": {"plan_auto_tries": tries}})
            else:
                await db.tasks.update_one({"id": task_id, "tenant_id": tenant_id},
                                          {"$set": {"plan_auto_tries": tries}})
        try:
            gen = await ai_execution_plan(t, tenant.get("industry") or "general", tenant.get("currency") or "INR",
                                          session_id=f"exec-auto-{task_id}")
        except Exception:
            await _give_back()   # the provider failed (network, outage)
            raise
        texts = [s for s in (gen.get("steps") or []) if s]
        if not texts or texts == _FALLBACK:
            # 2026-10-29 — the placeholder is what comes back when the model
            # could not be reached or read (AI keys missing, a bad answer). It
            # was taken as an answer and the task stamped for good, so it never
            # got a checklist; it is a failed try like any other now.
            await _give_back()
            return False
        from core import new_id
        now = _now()
        steps = [{"id": new_id(), "text": s, "done": False} for s in texts]
        plan = {"status": "accepted", "task_type": gen.get("task_type") or "generic", "steps": steps,
                "progress": 0, "generated_at": now, "updated_at": now, "auto": True}
        # Written only if nobody made a checklist by hand while Dex was thinking.
        res = await db.tasks.update_one(
            {"id": task_id, "tenant_id": tenant_id, "execution_plan.steps.0": {"$exists": False}},
            {"$set": {"execution_plan": plan}})
        if not getattr(res, "modified_count", 0):
            return False
        # The task's timeline (routers/tasks.py _log_task_event's row). No actor:
        # nobody pressed anything, and the line says who did it.
        try:
            await db.activity.insert_one({
                "id": new_id(), "tenant_id": tenant_id, "actor": None, "actor_name": "Dex", "kind": "task_plan",
                "message": f"Dex drafted a checklist for '{t.get('title', 'the task')}'",
                "detail": f"Dex drafted a checklist ({len(steps)} steps)",
                "entity_type": "task", "entity_id": task_id, "created_at": now,
            })
        except Exception:  # noqa: BLE001 — the trail is a nicety; the checklist is written
            pass
        return True
    except Exception as e:  # noqa: BLE001 — a draft that fails leaves the manual routes in place
        logger.info(f"[auto-plan] no draft for task {task_id}: {e}")
        return False


async def request(db, user: dict, task_ids: list, may_read, wait: bool = False) -> list:
    """2026-10-29 (founder) — My Work asks for the checklists it is about to
    show: a task still without one (made before this, or whose tries were
    spent on a failure that has since cleared) gets its draft now, instead of
    its card saying "Plan the first step". Every rule of draft_plan holds;
    this only clears a stamp left by a try that wrote nothing, and only once it
    is a minute old, so a draft still in flight is never started twice.
    Returns the ids it asked for."""
    tid = user["tenant_id"]
    asked = []
    if not auto_on(await db.tenants.find_one({"id": tid}, {"_id": 0, "auto_plan_steps": 1})):
        return asked   # off: steps come from Ask Dex or by hand
    stale = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
    for task_id in task_ids[:10]:
        t = await db.tasks.find_one({"id": task_id, "tenant_id": tid}, {"_id": 0})
        if not t or not await may_read(user, t):
            continue
        if (t.get("execution_plan") or {}).get("steps") or t.get("status") in _TERMINAL or _start_locked(t):
            continue
        if t.get("plan_auto_at"):
            if int(t.get("plan_auto_tries") or 0) >= 3 or str(t["plan_auto_at"]) > stale:
                continue
            await db.tasks.update_one({"id": task_id, "tenant_id": tid, "execution_plan.steps.0": {"$exists": False}},
                                      {"$unset": {"plan_auto_at": ""}})
        asked.append(task_id)
        if wait:
            await draft_plan(db, tid, task_id)
        else:
            schedule(db, tid, task_id)
    return asked


def schedule(db, tenant_id: str, task_id: str) -> None:
    """Fire-and-forget draft, after the response that created the task."""
    if not _enabled() or not tenant_id or not task_id:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    job = loop.create_task(draft_plan(db, tenant_id, task_id))
    _pending.add(job)
    job.add_done_callback(_pending.discard)


async def sweep(db, tenant_id: str, limit: int = 8) -> int:
    """The follow-up tick's catch-all: open tasks from the last two days that
    reached the database by a path that did not schedule a draft (a workflow
    stage's template, a meeting, a bill). Few per tick, oldest first."""
    if not _enabled():
        return 0
    from services.ai_consent import has_active_consent
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "ai_consent": 1, "auto_plan_steps": 1})
    if not has_active_consent(tenant or {}) or not auto_on(tenant):
        return 0
    since = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    cur = db.tasks.find(
        {"tenant_id": tenant_id, "created_at": {"$gte": since}, "status": {"$nin": list(_TERMINAL)},
         "plan_auto_at": {"$exists": False}, "execution_plan.steps.0": {"$exists": False}},
        {"_id": 0, "id": 1}).sort("created_at", 1).limit(limit)
    n = 0
    async for row in cur:
        if await draft_plan(db, tenant_id, row["id"]):
            n += 1
    return n


async def copy_from(db, tenant_id: str, task_id: str, previous: dict) -> bool:
    """A routine's next occurrence repeats the same work: its steps come from the
    one just finished, unticked, with no model call at all."""
    steps_src = ((previous or {}).get("execution_plan") or {}).get("steps") or []
    if not steps_src:
        return False
    from core import new_id
    now = _now()
    steps = [{"id": new_id(), "text": s.get("text", ""), "done": False} for s in steps_src if s.get("text")]
    if not steps:
        return False
    plan = {"status": "accepted", "task_type": (previous.get("execution_plan") or {}).get("task_type", "generic"),
            "steps": steps, "progress": 0, "generated_at": now, "updated_at": now, "copied": True}
    res = await db.tasks.update_one({"id": task_id, "tenant_id": tenant_id,
                                     "execution_plan.steps.0": {"$exists": False}},
                                    {"$set": {"execution_plan": plan, "plan_auto_at": now}})
    return bool(getattr(res, "modified_count", 0))

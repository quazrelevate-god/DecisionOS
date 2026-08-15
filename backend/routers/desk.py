"""Decision Desk router — Epic 2 Sprint 2.

Ships:
  * GET  /api/desk?chip=needs_decision|on_fire|due_today|important
    - Aggregation endpoint feeding the 4-chip Desk. Returns
      {counters:{...}, cards:[...]}. counters is always the full
      map so the header subline renders in one call.
  * POST /api/desk/nudge/{item_id}
    - Sends a nudge/chase to the counterparty. For now writes a
      notification row (WhatsApp send is a future integration once
      the WHATSAPP_API_KEY is provisioned). Returns
      {sent:True, channel:"notification", target_name, target_id}.

Chips explained (all tenant + user scoped):
  needs_decision -> decisions.status='pending' AND
                    (approver_id=me OR (approver_id is null AND created_by=me and I'm owner))
  on_fire        -> tasks whose latest 'updates' entry has
                    action in {escalate, handoff} and to_id=me
                    UNION tasks I own (assignee_id=me) that are
                    overdue and not done/cancelled
  due_today      -> tasks I own with due_date=today
                    (status not in {done, cancelled})
  important      -> AI-ranked (services/ai/priorities.py extension).
                    MVP: returns empty list (fail-open).
                    Wire ranker in E2-21.

Deep-linked from front-end Desk.js. Zero server.py churn.
"""
from datetime import datetime, timezone, date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, get_current_user, now_iso, new_id


router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Epic 2 Sprint 6 (E2-46): /api/desk/summary -- Greeting + Dex narrative +
# Trends + Shortcuts. Feeds the merged CEO-Brief-on-Desk header. Reuses the
# same underlying data the /api/brief endpoint uses so no source-of-truth
# drift. Template-based narrative for MVP; LLM-generated variant deferred
# (E2-48). All computation happens live -- 15-min cache lives on the
# LLM upgrade item, not the template.
# ---------------------------------------------------------------------------
def _greeting_for(user: dict) -> str:
    """Time-of-day greeting. Server is UTC; add IST offset (+5:30) for
    Kapoor tenant defaults. If we grow beyond India we'll thread tenant
    timezone through here."""
    hour_ist = (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).hour
    if hour_ist < 12:
        tod = "Good morning"
    elif hour_ist < 17:
        tod = "Good afternoon"
    else:
        tod = "Good evening"
    first_name = (user.get("name") or "").split(" ")[0] or "there"
    return f"{tod}, {first_name}"


async def _delayed_count(tid: str, user: dict) -> int:
    """Count tasks past due_date, not done/cancelled. Owner sees all,
    non-owner sees their own."""
    today = datetime.now(timezone.utc).date().isoformat()
    q = {"tenant_id": tid, "status": {"$nin": ["done", "cancelled"]},
         "due_date": {"$lt": today, "$ne": None}}
    if user.get("role") != "owner":
        q["assignee_id"] = user["id"]
    return await db.tasks.count_documents(q)


async def _completed_yesterday(tid: str, user: dict) -> int:
    """Tasks that hit status=done in the last 24h."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    q = {"tenant_id": tid, "status": "done"}
    if user.get("role") != "owner":
        q["assignee_id"] = user["id"]
    # updated_at fallback -- tasks may not have a `completed_at`.
    q["updated_at"] = {"$gte": since}
    return await db.tasks.count_documents(q)


async def _pending_decisions_for(tid: str, user: dict) -> int:
    """Decisions this user needs to approve. Mirrors the on-desk
    needs_decision chip logic."""
    uid = user["id"]
    is_owner = user.get("role") == "owner"
    q = {"tenant_id": tid, "status": "pending"}
    if is_owner:
        q["$or"] = [{"approver_id": uid}, {"approver_id": {"$in": [None, ""]}}]
    else:
        q["approver_id"] = uid
    return await db.decisions.count_documents(q)


async def _cash_flow_status(tid: str) -> dict:
    """Compact cash-flow summary. All numbers in tenant currency."""
    # Overdue receivables: sales invoices where balance_due > 0 and past due
    today = datetime.now(timezone.utc).date().isoformat()
    overdue_receivables = 0
    async for inv in db.invoices.find({"tenant_id": tid, "balance_due": {"$gt": 0}}, {"_id": 0}):
        due = inv.get("due_date") or inv.get("date")
        if due and due < today:
            overdue_receivables += float(inv.get("balance_due") or 0)
    # Unmatched payments (need matching to a bill or invoice)
    unmatched_count = await db.payments.count_documents(
        {"tenant_id": tid, "matched": {"$ne": True}, "direction": "in"}
    )
    # Overall clear? no overdue receivables + no unmatched inbound payments
    clear = overdue_receivables == 0 and unmatched_count == 0
    return {
        "clear": clear,
        "overdue_receivables_amount": overdue_receivables,
        "unmatched_payments": unmatched_count,
    }


async def _weekly_completion_rate(tid: str, user: dict) -> dict:
    """Completed tasks this week vs last week. Returns count + delta_pct."""
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    two_weeks_ago = (now - timedelta(days=14)).isoformat()
    scope_this = {"tenant_id": tid, "status": "done", "updated_at": {"$gte": week_ago}}
    scope_last = {"tenant_id": tid, "status": "done",
                    "updated_at": {"$gte": two_weeks_ago, "$lt": week_ago}}
    if user.get("role") != "owner":
        scope_this["assignee_id"] = user["id"]
        scope_last["assignee_id"] = user["id"]
    this_wk = await db.tasks.count_documents(scope_this)
    last_wk = await db.tasks.count_documents(scope_last)
    if last_wk == 0:
        delta_pct = 100 if this_wk > 0 else 0
    else:
        delta_pct = round(((this_wk - last_wk) / last_wk) * 100)
    direction = "up" if delta_pct > 5 else "down" if delta_pct < -5 else "flat"
    return {"value": this_wk, "delta_pct": delta_pct, "direction": direction}


async def _complaints_trend(tid: str) -> dict:
    """Open complaints (all-time) + how many opened in the last 7 days."""
    open_now = await db.complaints.count_documents(
        {"tenant_id": tid, "status": {"$ne": "resolved"}}
    )
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    new_7d = await db.complaints.count_documents(
        {"tenant_id": tid, "created_at": {"$gte": week_ago}}
    )
    direction = "up" if new_7d >= 2 else "flat" if new_7d == 1 else "down"
    return {"value": open_now, "new_7d": new_7d, "direction": direction}


def _narrative(*, delayed: int, completed_yday: int, pending_decisions: int,
                cash: dict, is_owner: bool) -> str:
    """Deterministic template narrative. LLM variant lands in E2-48
    (Backlog). Ordered by urgency -- delays first (bad), completed next
    (good), cash-flow last (steady)."""
    bits = []
    if delayed > 0:
        bits.append(
            f"{delayed} task{'s' if delayed != 1 else ''} "
            f"{'are' if delayed != 1 else 'is'} delayed"
        )
    if completed_yday > 0:
        bits.append(f"{completed_yday} completed yesterday")
    if cash.get("clear"):
        bits.append("cash-flow all clear")
    else:
        n_over = int(cash.get("overdue_receivables_amount") or 0)
        n_unm = int(cash.get("unmatched_payments") or 0)
        parts = []
        if n_over > 0:
            parts.append(f"Rs {n_over:,.0f} in overdue receivables")
        if n_unm > 0:
            parts.append(f"{n_unm} payments to match")
        if parts:
            bits.append("cash-flow needs attention -- " + ", ".join(parts))
    if not bits:
        return ("You're all clear -- nothing pressing right now. "
                "Nice place to be.")
    lead = f"{len(bits)} thing{'s' if len(bits) != 1 else ''} worth knowing: "
    body = ". ".join(bits[:-1]) + ("." if len(bits) > 1 else "")
    tail = " " + bits[-1] + "."
    prose = (lead + body + tail).replace("..", ".")
    if is_owner and pending_decisions > 0:
        prose += (f" {pending_decisions} decision"
                    f"{'s are' if pending_decisions != 1 else ' is'} "
                    f"waiting on you -- see below.")
    return prose


@router.get("/desk/summary")
async def desk_summary(user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    is_owner = user.get("role") == "owner"

    delayed = await _delayed_count(tid, user)
    completed_yday = await _completed_yesterday(tid, user)
    pending_decisions = await _pending_decisions_for(tid, user)
    cash = await _cash_flow_status(tid)
    weekly_completion = await _weekly_completion_rate(tid, user)
    complaints = await _complaints_trend(tid)

    narrative = _narrative(
        delayed=delayed, completed_yday=completed_yday,
        pending_decisions=pending_decisions, cash=cash,
        is_owner=is_owner,
    )

    # Shortcuts: which top-of-Desk quick-links to render.
    # Owner-only for CEO Journal and Ops health.
    shortcuts = {
        "ceo_journal": is_owner,
        "ops_health": is_owner,
        "team_leaderboard": is_owner,
    }

    return {
        "greeting": _greeting_for(user),
        "narrative": narrative,
        "trends": {
            "weekly_completion_rate": weekly_completion,
            "complaints_trend": complaints,
            "cash_flow": {
                "clear": cash.get("clear"),
                "overdue_receivables_amount": cash.get("overdue_receivables_amount") or 0,
                "unmatched_payments": cash.get("unmatched_payments") or 0,
                "direction": "flat" if cash.get("clear") else "down",
            },
        },
        "shortcuts": shortcuts,
        "counters": {
            "delayed": delayed,
            "completed_yesterday": completed_yday,
            "pending_decisions": pending_decisions,
        },
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _iso_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _days_between(iso_start: Optional[str], iso_end: Optional[str] = None) -> int:
    """Naive day-diff between two ISO date/datetime strings.
    Missing values -> 0. Never negative.
    """
    if not iso_start:
        return 0
    try:
        d_start = datetime.fromisoformat(iso_start.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return 0
    d_end = date.fromisoformat(iso_end) if iso_end else datetime.now(timezone.utc).date()
    return max(0, (d_end - d_start).days)


def _format_amount(n) -> Optional[str]:
    """Return Indian-format money string (₹4,80,000). None if no amount."""
    if n is None:
        return None
    try:
        n = float(n)
    except (ValueError, TypeError):
        return None
    if n == 0:
        return None
    # Indian grouping: last three digits, then pairs.
    s = f"{int(round(n)):,}"
    parts = s.split(",")
    if len(parts) > 2:
        last = parts[-1]
        rest = parts[:-1]
        s = ",".join(rest[::-1][0:1] + [",".join(rest[::-1][1:][::-1])]) if len(rest) > 1 else ",".join(rest)
        # Simpler: reformat with Indian style manually
    # Fallback: use en-US grouping (still readable). Indian formatting is
    # cosmetic — the front-end can prettify further with Intl API if needed.
    return f"₹{s}"


async def _my_role_keys(tid: str, user_id: str) -> list:
    """Return the role keys the user holds — used for role-routed
    escalations/handoffs. Owner sees all so returns ['*']."""
    u = await db.users.find_one({"id": user_id, "tenant_id": tid},
                                 {"_id": 0, "role": 1})
    if not u:
        return []
    if u.get("role") == "owner":
        return ["*"]
    return [u.get("role")] if u.get("role") else []


async def _users_lookup(tid: str, ids: list) -> dict:
    ids = [i for i in set(ids or []) if i]
    if not ids:
        return {}
    rows = await db.users.find(
        {"id": {"$in": ids}, "tenant_id": tid},
        {"_id": 0, "id": 1, "name": 1, "phone": 1, "email": 1},
    ).to_list(200)
    return {u["id"]: u for u in rows}


def _latest_update(t: dict) -> Optional[dict]:
    updates = t.get("updates") or []
    if not updates:
        return None
    with_ts = [u for u in updates if u.get("created_at")]
    if not with_ts:
        return updates[-1]
    return sorted(with_ts, key=lambda u: u["created_at"])[-1]


# ---------------------------------------------------------------------------
# Chip builders — each returns a list of card dicts.
# Card contract: {id, kind, title, context_line, amount?, amount_formatted?,
#                 cta, target_id, target_kind, target_owner_id?}
# ---------------------------------------------------------------------------
async def _cards_needs_decision(tid: str, user: dict) -> list:
    uid = user["id"]
    is_owner = user.get("role") == "owner"
    q = {"tenant_id": tid, "status": "pending"}
    if is_owner:
        # Owner sees decisions where approver_id=me OR unassigned.
        q["$or"] = [{"approver_id": uid}, {"approver_id": {"$in": [None, ""]}}]
    else:
        q["approver_id"] = uid
    rows = await db.decisions.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    creator_ids = [d.get("created_by") for d in rows if d.get("created_by")]
    umap = await _users_lookup(tid, creator_ids)
    cards = []
    for d in rows:
        creator = (umap.get(d.get("created_by") or "", {}) or {}).get("name") or "Unknown"
        waiting_days = _days_between(d.get("created_at"))
        proposed = len(d.get("proposed_tasks") or [])
        ctx_parts = [f"Waiting {waiting_days} day{'s' if waiting_days != 1 else ''}"]
        ctx_parts.append(f"From {creator}")
        if proposed:
            ctx_parts.append(f"Unblocks {proposed} task{'s' if proposed != 1 else ''}")
        cards.append({
            "id": d["id"],
            "kind": "decision",
            "title": d.get("title") or d.get("summary", "")[:80],
            "context_line": " · ".join(ctx_parts),
            "amount": d.get("amount"),
            "amount_formatted": _format_amount(d.get("amount")),
            "cta": "review",
            "target_id": d["id"],
            "target_kind": "decision",
        })
    # Sort by waiting_days desc via created_at asc (oldest = most waiting)
    cards.sort(key=lambda c: c["context_line"], reverse=False)
    return cards


async def _cards_on_fire(tid: str, user: dict) -> list:
    uid = user["id"]
    role_keys = await _my_role_keys(tid, uid)
    today = _iso_today()

    # 1) Overdue tasks I'm ACCOUNTABLE for but someone ELSE owns.
    # "Chase" is a verb aimed at the assignee -- if I'm the assignee it's
    # my own todo, belongs on My Work, not on the Desk's On Fire chip.
    # Owner sees every non-owner overdue in the tenant; other roles see
    # overdue tasks they created (raised for a teammate to do).
    is_owner = user.get("role") == "owner"
    q_overdue = {
        "tenant_id": tid,
        "assignee_id": {"$ne": uid, "$exists": True, "$nin": [None, ""]},
        "status": {"$nin": ["done", "cancelled"]},
        "due_date": {"$lt": today, "$ne": None},
    }
    if not is_owner:
        q_overdue["created_by"] = uid
    overdue = await db.tasks.find(q_overdue, {"_id": 0}).sort("due_date", 1).to_list(200)

    # 2) Escalations/handoffs pointed at me. The `updates` array is the
    # source of truth; the latest entry with action in {escalate, handoff}
    # to_id=uid (or to_role in my role keys) makes the task "awaiting me".
    q_addressed = {
        "tenant_id": tid,
        "status": {"$nin": ["done", "cancelled"]},
        "updates.action": {"$in": ["escalate", "handoff"]},
    }
    candidates = await db.tasks.find(q_addressed, {"_id": 0}).to_list(500)
    addressed = []
    for t in candidates:
        latest = _latest_update(t)
        if not latest:
            continue
        if latest.get("action") not in ("escalate", "handoff"):
            continue
        addr_me = (latest.get("to_id") == uid) or (
            role_keys and (latest.get("to_role") in role_keys or "*" in role_keys)
        )
        if addr_me:
            addressed.append((t, latest))

    # Merge: escalations first (respond), then overdue (chase). Dedupe on id.
    seen = set()
    cards = []

    # Gather actor names
    actor_ids = [u.get("actor_id") for _, u in addressed if u.get("actor_id")]
    actor_ids += [t.get("assignee_id") for t in overdue if t.get("assignee_id")]
    umap = await _users_lookup(tid, actor_ids)

    for t, latest in addressed:
        if t["id"] in seen:
            continue
        seen.add(t["id"])
        actor = (umap.get(latest.get("actor_id") or "", {}) or {}).get("name") or "someone"
        verb = "Escalated by" if latest.get("action") == "escalate" else "Handed to you by"
        with_who = (umap.get(t.get("assignee_id") or "", {}) or {}).get("name")
        ctx_parts = [f"{verb} {actor}"]
        if with_who and with_who != actor:
            ctx_parts.append(f"With {with_who}")
        cards.append({
            "id": t["id"],
            "kind": "task_escalation" if latest.get("action") == "escalate" else "task_handoff",
            "title": t.get("title", "(untitled task)"),
            "context_line": " · ".join(ctx_parts),
            "amount": t.get("amount"),
            "amount_formatted": _format_amount(t.get("amount")),
            "cta": "respond",
            "target_id": t["id"],
            "target_kind": "task",
            "target_owner_id": t.get("assignee_id"),
        })

    for t in overdue:
        if t["id"] in seen:
            continue
        seen.add(t["id"])
        overdue_days = _days_between(t.get("due_date"))
        with_who = (umap.get(t.get("assignee_id") or "", {}) or {}).get("name")
        ctx_parts = [f"{overdue_days} day{'s' if overdue_days != 1 else ''} overdue"]
        if with_who and t.get("assignee_id") != uid:
            ctx_parts.append(f"With {with_who}")
        cards.append({
            "id": t["id"],
            "kind": "task_overdue",
            "title": t.get("title", "(untitled task)"),
            "context_line": " · ".join(ctx_parts),
            "amount": t.get("amount"),
            "amount_formatted": _format_amount(t.get("amount")),
            "cta": "chase",
            "target_id": t["id"],
            "target_kind": "task",
            "target_owner_id": t.get("assignee_id"),
        })
    return cards


async def _cards_due_today(tid: str, user: dict) -> list:
    """Tasks due today that someone else owns (I care about them, they
    need nudging). Mirror of on_fire scope: not-me + I-created-them,
    or owner scope for owner. My own due-today lives on My Work."""
    uid = user["id"]
    today = _iso_today()
    is_owner = user.get("role") == "owner"
    q = {
        "tenant_id": tid,
        "assignee_id": {"$ne": uid, "$exists": True, "$nin": [None, ""]},
        "status": {"$nin": ["done", "cancelled"]},
        "due_date": today,
    }
    if not is_owner:
        q["created_by"] = uid
    rows = await db.tasks.find(q, {"_id": 0}).to_list(200)
    assignee_ids = [t.get("assignee_id") for t in rows if t.get("assignee_id")]
    umap = await _users_lookup(tid, assignee_ids)
    cards = []
    for t in rows:
        with_who = (umap.get(t.get("assignee_id") or "", {}) or {}).get("name")
        ctx = f"With {with_who}" if with_who and t.get("assignee_id") != uid else "Due today"
        cards.append({
            "id": t["id"],
            "kind": "task_due_today",
            "title": t.get("title", "(untitled task)"),
            "context_line": ctx,
            "amount": t.get("amount"),
            "amount_formatted": _format_amount(t.get("amount")),
            "cta": "nudge",
            "target_id": t["id"],
            "target_kind": "task",
            "target_owner_id": t.get("assignee_id"),
        })
    # Sort by amount desc (highest-stakes first)
    cards.sort(key=lambda c: (c.get("amount") or 0), reverse=True)
    return cards


async def _cards_important(tid: str, user: dict) -> list:
    """E2-21 hook: AI ranker for 'not urgent yet but worth your attention'.
    MVP fail-open: return []. Extend services/ai/priorities.py with a
    decision-level model in the follow-up."""
    return []


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
@router.get("/desk")
async def desk_chip(chip: str = "needs_decision", user: dict = Depends(get_current_user)):
    tid = user["tenant_id"]
    if chip not in ("needs_decision", "on_fire", "due_today", "important"):
        raise HTTPException(status_code=400, detail="Invalid chip")

    # Counters (always return the full map so header subline is one call)
    counters = {
        "needs_decision": len(await _cards_needs_decision(tid, user)),
        "on_fire": len(await _cards_on_fire(tid, user)),
        "due_today": len(await _cards_due_today(tid, user)),
        "important": len(await _cards_important(tid, user)),
    }

    # Cards for the requested chip
    builder = {
        "needs_decision": _cards_needs_decision,
        "on_fire": _cards_on_fire,
        "due_today": _cards_due_today,
        "important": _cards_important,
    }[chip]
    cards = await builder(tid, user)
    return {"chip": chip, "counters": counters, "cards": cards}


class NudgeInput(BaseModel):
    channel: Optional[str] = "auto"  # future: 'whatsapp' | 'email' | 'auto'


@router.post("/desk/nudge/{item_id}")
async def desk_nudge(item_id: str, inp: NudgeInput = None,
                       user: dict = Depends(get_current_user)):
    """Send a nudge (Chase / Nudge button on Desk cards) to the person
    we're waiting on.

    MVP: writes a notification row for the target user. When
    WHATSAPP_API_KEY is configured the send path will also fire a
    WhatsApp template; when SMTP is up, an email fallback follows.
    Response contract stays the same so the front-end doesn't need to
    know which channel eventually landed.
    """
    tid = user["tenant_id"]
    # The item can be a task (overdue/due-today) or a decision.
    # Try task first, then decision.
    t = await db.tasks.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})
    target_id = None
    target_kind = None
    subject = ""
    if t:
        target_id = t.get("assignee_id")
        target_kind = "task"
        subject = t.get("title") or "(untitled task)"
    else:
        d = await db.decisions.find_one({"id": item_id, "tenant_id": tid}, {"_id": 0})
        if not d:
            raise HTTPException(status_code=404, detail="Item not found")
        # For decisions the target is whoever raised it — we're chasing
        # them for the info we need to approve.
        target_id = d.get("created_by")
        target_kind = "decision"
        subject = d.get("title") or d.get("summary", "")[:80]

    if not target_id:
        raise HTTPException(status_code=400,
                            detail="This item has no assignable target to nudge")
    if target_id == user["id"]:
        raise HTTPException(status_code=400,
                            detail="Can't nudge yourself")

    target = await db.users.find_one({"id": target_id, "tenant_id": tid},
                                      {"_id": 0, "id": 1, "name": 1, "phone": 1, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="Target user not found")

    # Write a notification for the target user (the persistent record)
    notif = {
        "id": new_id(),
        "tenant_id": tid,
        "user_id": target_id,
        "kind": "desk_nudge",
        "title": f"Nudge from {user.get('name') or 'the owner'}",
        "body": f"Please prioritise: {subject}",
        "link": f"/my-work?task={item_id}" if target_kind == "task" else f"/inbox?decision={item_id}",
        "read": False,
        "created_at": now_iso(),
        "meta": {
            "from_user_id": user["id"],
            "target_kind": target_kind,
            "target_id": item_id,
        },
    }
    await db.notifications.insert_one(notif)

    # WhatsApp/email send is a follow-up (services/whatsapp send helper +
    # SMTP fallback). Response shape is stable — 'channel' will change
    # from 'notification' to 'whatsapp' or 'email' once wired.
    return {
        "sent": True,
        "channel": "notification",
        "target_id": target_id,
        "target_name": target.get("name"),
    }

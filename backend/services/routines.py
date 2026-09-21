"""The routines promised at sign-up, made real (2026-09-21).

The last onboarding screen tells the founder "Nila Garments now runs on
DecisionOS" and counts "8 recurring tasks Dex will keep on rails". Until now
nothing created them: the list was stored on the tenant as
`operational_task_templates` and read by nothing, so the Monday checks and the
GST filing the founder believed were covered were not.

The AI gives a routine a NAME only ("Monday shipment review"). How often it
comes back, when it starts and who does it are guesses, and a wrong guess puts
a task on someone's list every week. So the founder confirms them once — on the
reveal screen, or later from Tasks — and each one they keep becomes a real
repeating task (services/recurrence: the next one appears when the last one is
closed).

FRICTIONLESS, NOT PRESUMPTUOUS: a routine whose name says how often it happens
("weekly", "Monday", "GST", "end of day") starts ticked with that cadence; one
whose name says nothing about time, or reads as something that happens per
order or per delivery ("Capture signed POD on delivery"), starts unticked —
that is workflow work, and turning it into a weekly task would be wrong. The
founder can tick it anyway.

Each template's answer is remembered on the tenant under `routine_setup`
({key: {"state": "started"|"skipped", ...}}), so nothing is offered twice and
starting the same routine twice (a double tap, two tabs) creates one series.
"""
from __future__ import annotations

import calendar
import hashlib
import re
from datetime import date, timedelta
from typing import Optional

from core import db, new_id, now_iso
from services import recurrence as recurrence_svc

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

# Words that say "this happens per order / per event", not on a calendar.
_EVENT = re.compile(
    r"\b(on delivery|on receipt|per order|each order|every order|each booking|per booking|"
    r"when |whenever|as they come|on arrival|incoming|after (?:the )?(?:shipment|dispatch|delivery|service)|"
    r"(?:for |per )?each (?:shipment|dispatch|client|customer|order|booking|job)|per shipment|new (?:order|lead|inquiry|enquiry|patient|booking)|"
    r"escalate any|register patient|book appointment|assign .* to booking|to booking)\b", re.I)
_DAY = re.compile(
    r"\b(daily|every day|each day|morning|evening|nightly|end[- ]of[- ]day|eod|at close|"
    r"close of day|day[- ]end|opening|shift|for the day|today)\b", re.I)
_WEEK = re.compile(r"\b(weekly|every week|each week|week)\b", re.I)
_FORTNIGHT = re.compile(r"\b(fortnight(?:ly)?|every two weeks|bi-?weekly)\b", re.I)
_MONTH = re.compile(
    r"\b(monthly|every month|each month|month[- ]end|month|gst|gstr|tds|salary|salaries|payroll|"
    r"rent|pf|esi|emi)\b", re.I)
_QUARTER = re.compile(r"\b(quarterly|every quarter|quarter)\b", re.I)


def routine_key(title: str) -> str:
    """A stable key for one template: the same name is the same routine."""
    norm = " ".join(str(title or "").lower().split())
    return "rt-" + hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def _month_day(d: date, day: int) -> date:
    return d.replace(day=min(day, calendar.monthrange(d.year, d.month)[1]))


def _next_month_day(today: date, day: int) -> date:
    """The next date on `day` of a month, strictly after today (last day = 31)."""
    cand = _month_day(today, day)
    if cand <= today:
        y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
        cand = _month_day(date(y, m, 1), day)
    return cand


def first_dates(title: str, today: Optional[date] = None) -> dict:
    """When each cadence would first fall due, so the founder can switch the
    cadence without being handed a date picker."""
    today = today or date.today()
    low = (title or "").lower()
    # Weekly: the weekday the name mentions, else the coming Monday.
    wd = next((i for i, n in enumerate(WEEKDAYS) if n in low), 0)
    ahead = (wd - today.weekday()) % 7 or 7
    week = today + timedelta(days=ahead)
    # Monthly: the day the name gives ("GST filing on the 10th"), else the day
    # the thing is usually due.
    named = re.search(r"\b(?:on|by|before) the (\d{1,2})(?:st|nd|rd|th)\b", low)
    if named and 1 <= int(named.group(1)) <= 31:
        mday = int(named.group(1))
    elif re.search(r"\bgst|gstr\b", low):
        mday = 20            # GSTR-3B is due on the 20th
    elif re.search(r"\btds\b", low):
        mday = 7             # TDS deposit is due on the 7th
    elif re.search(r"salar|payroll|month[- ]end|close the month|closing", low):
        mday = 31            # last day of the month
    else:
        mday = 1
    return {
        "day": (today + timedelta(days=1)).isoformat(),
        "week": week.isoformat(),
        "month": _next_month_day(today, mday).isoformat(),
    }


def guess_cadence(title: str, category: str = "") -> dict:
    """How often a routine probably comes back, and whether the name said so.

    Returns {"every", "interval", "confident", "reason"}. `confident` is what
    decides whether it starts ticked.
    """
    text = f"{title or ''}"
    # A name that SAYS how often wins, even when it also mentions an event
    # ("Chase balance payment post-dispatch — weekly follow-up log").
    if _QUARTER.search(text):
        return {"every": "month", "interval": 3, "confident": True, "reason": "The name says quarterly"}
    if _FORTNIGHT.search(text):
        return {"every": "week", "interval": 2, "confident": True, "reason": "The name says every two weeks"}
    if re.search(r"\b(daily|every day|each day)\b", text, re.I):
        return {"every": "day", "interval": 1, "confident": True, "reason": "The name says daily"}
    if re.search(r"\b(weekly|every week|each week)\b", text, re.I) or any(n in text.lower() for n in WEEKDAYS):
        return {"every": "week", "interval": 1, "confident": True, "reason": "The name says weekly"}
    if re.search(r"\b(monthly|every month|each month)\b", text, re.I):
        return {"every": "month", "interval": 1, "confident": True, "reason": "The name says monthly"}
    if _EVENT.search(text):
        return {"every": "week", "interval": 1, "confident": False,
                "reason": "Sounds like it happens per order or event — better as a workflow step"}
    if _MONTH.search(text):
        return {"every": "month", "interval": 1, "confident": True, "reason": "Usually done once a month"}
    if _DAY.search(text):
        return {"every": "day", "interval": 1, "confident": True, "reason": "Happens every working day"}
    if _WEEK.search(text):
        return {"every": "week", "interval": 1, "confident": True, "reason": "The name says weekly"}
    return {"every": "week", "interval": 1, "confident": False,
            "reason": "The name doesn't say how often — check it before starting"}


async def _people(tenant_id: str) -> list:
    """Active people a routine can go to, owner first."""
    live = {m.get("user_id") for m in await db.memberships.find(
        {"tenant_id": tenant_id, "status": "active"}, {"_id": 0, "user_id": 1}).to_list(1000)}
    rows = await db.users.find({"tenant_id": tenant_id}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(500)
    if live:
        rows = [r for r in rows if r["id"] in live]
    rows.sort(key=lambda r: (r.get("role") != "owner", (r.get("name") or "").lower()))
    return rows


async def setup_view(user: dict, today: Optional[date] = None) -> dict:
    """The routines from sign-up still waiting for an answer, each with a
    suggested cadence, first date and person."""
    tid = user["tenant_id"]
    tenant = await db.tenants.find_one(
        {"id": tid}, {"_id": 0, "operational_task_templates": 1, "routine_setup": 1}) or {}
    answered = tenant.get("routine_setup") or {}
    seen: set = set()
    items, started = [], 0
    for tpl in tenant.get("operational_task_templates") or []:
        title = " ".join(str((tpl or {}).get("title") or "").split()) if isinstance(tpl, dict) else str(tpl or "")
        if not title:
            continue
        key = routine_key(title)
        if key in seen:
            continue
        seen.add(key)
        state = (answered.get(key) or {}).get("state")
        if state == "started":
            started += 1
            continue
        if state == "skipped":
            continue
        guess = guess_cadence(title, (tpl or {}).get("category", "") if isinstance(tpl, dict) else "")
        items.append({
            "key": key, "title": title,
            "category": (tpl or {}).get("category") if isinstance(tpl, dict) else None,
            **guess,
            "first_due": first_dates(title, today),
            "assignee_id": user["id"],
        })
    people = [{"id": p["id"], "name": p.get("name") or "Someone", "role": p.get("role")}
              for p in await _people(tid)]
    return {"items": items, "people": people, "started": started, "pending": len(items)}


async def apply_setup(user: dict, start: list, skip: list, today: Optional[date] = None) -> dict:
    """Start the routines the founder kept; remember the ones they let go.

    Every choice is validated here: an unknown key, a cadence we cannot
    repeat, or a person outside the company is dropped or corrected, never
    stored as-is.
    """
    from services.notifications import push_notification
    tid = user["tenant_id"]
    view = await setup_view(user, today)
    waiting = {i["key"]: i for i in view["items"]}
    people = {p["id"] for p in view["people"]}
    created = []
    for choice in start or []:
        key = (choice or {}).get("key")
        item = waiting.pop(key, None)
        if not item:
            continue   # already answered (double tap / other tab) or not ours
        every = choice.get("every") or item["every"]
        # A changed cadence starts at "every 1": "every 3 months" switched to
        # weekly means weekly, not every 3 weeks.
        interval = choice.get("interval") or (item["interval"] if every == item["every"] else 1)
        try:
            rec = recurrence_svc.normalise(every, interval, None)
        except ValueError:
            rec = recurrence_svc.normalise(item["every"], item["interval"], None)
        due = item["first_due"].get(rec["every"])
        assignee = choice.get("assignee_id") if choice.get("assignee_id") in people else user["id"]
        member = await db.users.find_one({"id": assignee, "tenant_id": tid}, {"_id": 0, "role": 1, "name": 1})
        # Claim the key first: a second request racing this one finds it taken.
        claim = await db.tenants.update_one(
            {"id": tid, f"routine_setup.{key}": {"$exists": False}},
            {"$set": {f"routine_setup.{key}": {"state": "started", "at": now_iso(), "by": user["id"]}}})
        if not claim.modified_count:
            continue
        task_id = new_id()
        await db.tasks.insert_one({
            "id": task_id, "tenant_id": tid, "title": item["title"], "description": "",
            "assignee_role": (member or {}).get("role"), "assignee_id": assignee,
            "priority": "medium", "co_assignee_ids": [], "auto_assigned": None,
            "status": "todo", "depends_on": [], "due_date": due, "decision_id": None,
            "source": "routine", "created_at": now_iso(),
            "task_type": None, "op_category": item.get("category"),
            "expected_output": None, "approval_required": False, "approval_status": None,
            "approval_stage": None, "approver_id": None, "progress": 0, "created_by": user["id"],
            "evidence_required": False, "contact_id": None, "contact_name": "", "amount": None,
            "workflow_id": None, "stage_key": None,
            "recurrence": {**rec, "series_id": task_id}, "series_id": task_id,
            "updated_at": now_iso(), "last_action": "Routine started",
        })
        await db.tenants.update_one({"id": tid}, {"$set": {f"routine_setup.{key}.series_id": task_id}})
        await db.activity.insert_one({
            "id": new_id(), "tenant_id": tid, "actor": user["id"], "kind": "task_created",
            "message": f"Started routine '{item['title']}'",
            "detail": f"{recurrence_svc.describe(rec)} — from your setup",
            "entity_type": "task", "entity_id": task_id, "created_at": now_iso(),
        })
        if assignee != user["id"]:
            await push_notification(tid, [assignee], 1, f"New routine: '{item['title']}'", "task", task_id,
                                    ntype="assigned", title=item["title"], sender=user.get("name"))
        created.append({"key": key, "task_id": task_id, "title": item["title"], "due_date": due,
                        "repeats": recurrence_svc.describe(rec), "assignee_name": (member or {}).get("name")})
    skipped = 0
    for key in skip or []:
        if key in waiting:
            res = await db.tenants.update_one(
                {"id": tid, f"routine_setup.{key}": {"$exists": False}},
                {"$set": {f"routine_setup.{key}": {"state": "skipped", "at": now_iso(), "by": user["id"]}}})
            skipped += res.modified_count
    return {"created": created, "skipped": skipped, **(await setup_view(user, today))}

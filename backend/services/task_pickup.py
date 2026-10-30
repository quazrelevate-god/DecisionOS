"""Work nobody has yet finds its person (Epic 11 Sprint 11, founder 2026-10-30).

The complaint: a decision makes its tasks and most of them land with nobody.
A task meant for a TEAM was handed to whoever in it had the fewest open tasks
— the founder: "that's not the right way" — and when the team had nobody, or
Dex named no team, the task sat unassigned and nobody was told.

The rule now, for a task that has no person (the decision named nobody):

  the team has one person            -> that person
  the team has people                -> the team's QUEUE: everyone in the team,
                                        its head included, sees it in My Work
                                        and can Take it (routers.tasks)
  high priority                      -> the team's nearest managers are asked
                                        to assign it at once (it is in the
                                        queue too); no managers: the owner
  no team, or nobody in the team     -> the owner is asked to assign it

Nobody is ever picked by how many tasks they have.

THE TEAM'S MANAGERS come from Team > "Reports to" — there is no manager
setting yet (founder: later, once a client confirms). In a team, a manager is
anyone who reports straight to an owner (the team's head) or has people
reporting to them. Their LEVEL is how far they are from the owner: 1 reports
to the owner, 2 reports to a level 1, and so on (someone at the top of a chain
that never reaches an owner counts as level 1).

THE REMINDER LADDER (founder 2026-10-30: rather than putting a lot of
notifications on the owner): while a task has nobody, it climbs the team's
reporting tree ONE LEVEL A DAY, nearest managers first, the owner last:
    when placed   the queue (high priority: the nearest managers instead)
    day 1         the team's deepest managers (e.g. level 2 team leads)
    day 2         the next level up (e.g. the level 1 head)
    ...           ...
    last          the owner
A team with no managers goes straight to the owner on day 1. Two managers at
the same level are both asked. A task already waiting on the owner (no team,
nobody in it) is not chased further — it stays on the Desk's Needs a person.
The step length is Settings > Deadlines > Work nobody has (pickup_step_days,
1 day). Each step is ONE notification per person however many tasks.

A task records where it is waiting:
    pickup_route  "queue" | "manager" | "owner"
    pickup_why    "" | "no_team" | "nobody_in_team" | "no_head" (no managers)
    pickup_since  when it started waiting
    pickup_level  0 placed, not yet told · 1 told · 1+n: n ladder steps asked
and drops all four the moment it has a person or is finished.

Every function takes the caller's `db`, so a router, the workflow engine and
the off-boarding service (which is handed its own) all write to the same one.
"""
import logging
from datetime import datetime, timezone
from typing import Iterable, Optional

from core import now_iso
from shared.roles import dept_name

logger = logging.getLogger(__name__)

PICKUP_FIELDS = ("pickup_route", "pickup_why", "pickup_since", "pickup_level")
UNSET = {f: "" for f in PICKUP_FIELDS}
NO_PERSON = {"$in": [None, ""]}
# A personal reminder or a meeting's to-do always has its person.
SKIP_SOURCES = ["reminder", "meeting"]
OPEN = ["todo", "blocked", "in_progress", "waiting", "review"]
PICKUP_STEP_DAYS = 1


def pickup_step_days(tenant: Optional[dict]) -> int:
    """Days between one step of the ladder and the next."""
    return max(1, int((tenant or {}).get("pickup_step_days") or PICKUP_STEP_DAYS))


class Company:
    """Who is in the company right now: active people, their teams, the owners."""

    def __init__(self, people: list, roles: list):
        self.people = people
        self.roles = roles or []
        self.owner_ids = [p["id"] for p in people if p.get("role") == "owner"]
        self._by_id = {p["id"]: p for p in people}
        self._bosses = {p.get("reporting_manager_id") for p in people if p.get("reporting_manager_id")}

    def members(self, role: Optional[str]) -> list:
        return [p for p in self.people if role and p.get("role") == role]

    def level(self, uid: str) -> int:
        """How far someone is from the owner: 1 reports to an owner, 2 reports
        to a 1, … Someone at the top of a chain that never reaches an owner
        (nobody set, or someone who has left) counts as 1."""
        owners, seen, cur, n = set(self.owner_ids), set(), uid, 0
        while cur and cur not in seen and n < 30:
            seen.add(cur)
            n += 1
            boss = (self._by_id.get(cur) or {}).get("reporting_manager_id")
            if boss in owners or not boss or boss not in self._by_id:
                return n
            cur = boss
        return n

    def managers(self, role: Optional[str]) -> list:
        """The team's managers: who reports straight to an owner (its head),
        or has anyone reporting to them."""
        owners = set(self.owner_ids)
        return [p for p in self.members(role)
                if p.get("reporting_manager_id") in owners or p["id"] in self._bosses]

    def ladder(self, role: Optional[str]) -> list:
        """The team's managers, one group per level, nearest the work first."""
        by_level: dict = {}
        for p in self.managers(role):
            by_level.setdefault(self.level(p["id"]), []).append(p)
        return [by_level[k] for k in sorted(by_level, reverse=True)]

    def heads(self, role: Optional[str]) -> list:
        """The team's head(s): its top level of managers."""
        steps = self.ladder(role)
        return steps[-1] if steps else []

    def is_manager(self, user: dict, role: Optional[str]) -> bool:
        return any(p["id"] == user.get("id") for p in self.managers(role))

    def name(self, uid: Optional[str]) -> str:
        return next((p.get("name") or "" for p in self.people if p["id"] == uid), "")

    def dept(self, role: Optional[str]) -> str:
        return dept_name(self.roles, role) if role else ""


async def company(db, tenant_id: str) -> Company:
    users = await db.users.find(
        {"tenant_id": tenant_id},
        {"_id": 0, "id": 1, "name": 1, "role": 1, "reporting_manager_id": 1, "invite_status": 1}).to_list(2000)
    # Active people only — never someone removed, suspended or not yet joined.
    # Judged PER PERSON: a membership row that is not active leaves them out; a
    # person with no row at all is from before memberships and counts. (Found
    # on the demo company, 2026-10-30: with the company-wide "any rows? then
    # only active rows" rule the old auto-assign used, inviting ONE new person
    # to an older company silently dropped everyone who joined before.)
    active, has_row = set(), set()
    async for m in db.memberships.find({"tenant_id": tenant_id}, {"_id": 0, "user_id": 1, "status": 1}):
        has_row.add(m.get("user_id"))
        if m.get("status") == "active":
            active.add(m.get("user_id"))
    people = [u for u in users
              if (u.get("id") in active or u.get("id") not in has_row)
              and (u.get("invite_status") or "active") == "active"]
    if not any(p.get("role") == "owner" for p in people):
        # An owner from before memberships still owns the company.
        people += [u for u in users if u.get("role") == "owner"]
    tenant = await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "roles": 1}) or {}
    return Company(people, tenant.get("roles") or [])


def route(c: Company, role: Optional[str], priority: Optional[str]) -> dict:
    """Where a task with no person goes. {"assignee_id"} when the team is one
    person; otherwise {"route", "why"}."""
    members = c.members(role)
    if len(members) == 1:
        return {"assignee_id": members[0]["id"]}
    if not members:
        return {"route": "owner", "why": "nobody_in_team" if role else "no_team"}
    if priority == "high":
        return {"route": "manager", "why": ""} if c.managers(role) else {"route": "owner", "why": "no_head"}
    return {"route": "queue", "why": ""}


def _names(people: list) -> str:
    names = [(p.get("name") or "").split(" ")[0] or "Someone" for p in people]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " or " + names[-1]


def goes_to(c: Company, role: Optional[str], priority: Optional[str]) -> dict:
    """What the Decide review says about a task nobody is named for."""
    r = route(c, role, priority)
    d = c.dept(role)
    if r.get("assignee_id"):
        return {"route": "person", "assignee_id": r["assignee_id"],
                "label": f"{c.name(r['assignee_id']) or 'The one person'} — the only one in {d}"}
    if r["route"] == "queue":
        return {"route": "queue", "label": f"{d} queue — anyone in {d} can take it"}
    if r["route"] == "manager":
        return {"route": "manager", "label": f"{_names(c.ladder(role)[0])} assigns it — high priority"}
    if r["why"] == "no_head":
        return {"route": "owner", "label": f"{d} queue, and the owner is asked — high priority, no manager in {d}"}
    if r["why"] == "nobody_in_team":
        return {"route": "owner", "label": f"The owner assigns it — nobody in {d} yet"}
    return {"route": "owner", "label": "The owner assigns it — no team named"}


def waiting_line(c: Company, t: dict) -> str:
    """Where a created task with nobody is waiting, in words."""
    d = c.dept(t.get("assignee_role"))
    r, why = t.get("pickup_route"), t.get("pickup_why")
    if r == "queue":
        return f"In the {d} queue"
    if r == "manager":
        steps = c.ladder(t.get("assignee_role"))
        return f"Waiting for {_names(steps[0]) if steps else 'a ' + d + ' manager'} to assign it"
    if why == "no_head":
        return f"In the {d} queue — the owner is asked (high priority, no manager in {d})"
    if why == "nobody_in_team":
        return f"Waiting for the owner to assign it — nobody in {d}"
    if r == "owner":
        return "Waiting for the owner to assign it — no team"
    return f"In the {d} queue" if d else "Nobody has it yet"


async def place(db, tenant_id: str, task_ids: Iterable[str], c: Optional[Company] = None) -> dict:
    """Give each just-made task that has nobody its place: the team's one
    person, or a route to wait on. Returns {"assigned": [...], "placed": [...]}."""
    ids = [i for i in dict.fromkeys(task_ids or []) if i]
    out = {"assigned": [], "placed": []}
    if not ids:
        return out
    rows = await db.tasks.find(
        {"tenant_id": tenant_id, "id": {"$in": ids}, "status": {"$in": OPEN},
         "assignee_id": NO_PERSON, "source": {"$nin": SKIP_SOURCES},
         # already waiting somewhere: placed once, never twice
         "pickup_level": {"$exists": False}},
        {"_id": 0, "id": 1, "assignee_role": 1, "priority": 1}).to_list(len(ids))
    if not rows:
        return out
    c = c or await company(db, tenant_id)
    now = now_iso()
    for t in rows:
        r = route(c, t.get("assignee_role"), t.get("priority"))
        if r.get("assignee_id"):
            res = await db.tasks.update_one(
                {"tenant_id": tenant_id, "id": t["id"], "assignee_id": NO_PERSON},
                {"$set": {"assignee_id": r["assignee_id"], "assignee_how": "only_member", "updated_at": now},
                 "$unset": UNSET})
            if getattr(res, "modified_count", 1):
                out["assigned"].append(t["id"])
            continue
        await db.tasks.update_one(
            {"tenant_id": tenant_id, "id": t["id"], "assignee_id": NO_PERSON},
            {"$set": {"pickup_route": r["route"], "pickup_why": r["why"], "pickup_since": now, "pickup_level": 0}})
        out["placed"].append(t["id"])
    return out


def steps_for(c: Company, t: dict) -> list:
    """The ladder a waiting task climbs: its team's managers by level, nearest
    first, then the owner. Work already waiting on the owner has only that."""
    if t.get("pickup_route") == "owner":
        return [list(c.owner_ids)]
    return [[p["id"] for p in step] for step in c.ladder(t.get("assignee_role"))] + [list(c.owner_ids)]


def _recipients(c: Company, t: dict) -> list:
    """Who is told when a task starts waiting: the team (queue), else the
    ladder's first step — the nearest managers (high priority) or the owner."""
    if t.get("pickup_route") == "queue":
        return [p["id"] for p in c.members(t.get("assignee_role"))]
    return steps_for(c, t)[0]


def _told_text(c: Company, route_: str, why: str, role: Optional[str], tasks: list) -> str:
    d, n, title = c.dept(role), len(tasks), (tasks[0].get("title") or "A task")
    if route_ == "queue":
        return (f"New in the {d} queue: '{title}'. Take it if it's yours." if n == 1
                else f"{n} new tasks in the {d} queue. Take the ones that are yours.")
    if route_ == "manager":
        return (f"'{title}' is high priority and nobody in {d} has it yet. Assign it to someone." if n == 1
                else f"{n} high-priority tasks in {d} have nobody yet. Assign them.")
    if why == "no_head":
        return (f"'{title}' is high priority and {d} has no head to assign it. Assign it to someone." if n == 1
                else f"{n} high-priority tasks in {d} have nobody, and {d} has no head. Assign them.")
    if why == "nobody_in_team":
        return (f"'{title}' is for {d}, but nobody is in {d}. Assign it to someone." if n == 1
                else f"{n} tasks are for {d}, but nobody is in {d}. Assign them.")
    return (f"'{title}' has no team, so nobody has it. Assign it to someone." if n == 1
            else f"{n} tasks have no team, so nobody has them. Assign them.")


async def _send(db, tenant_id: str, groups: dict, sender: Optional[str] = None) -> int:
    """One notification per (person, what it says). `groups` maps
    (uid, text-key...) -> (text, [tasks]). Looked up on the module at call
    time so tests can keep or silence it."""
    import services.notifications as notifications
    sent = 0
    for (uid, *_), (text, tasks, ntype, level) in groups.items():
        await notifications.push_notification(
            tenant_id, [uid], level, text, "task", tasks[0]["id"], ntype=ntype,
            title=tasks[0].get("title") if len(tasks) == 1 else f"{len(tasks)} tasks", sender=sender)
        sent += 1
    return sent


async def announce(db, tenant_id: str, task_ids: Iterable[str], actor_id: Optional[str] = None,
                   sender: Optional[str] = None, c: Optional[Company] = None) -> int:
    """Tell the people a newly placed task waits on (pickup_level 0 -> 1).
    The person who just made or approved it is not told — they saw where it
    went. Returns how many notifications went out."""
    ids = [i for i in dict.fromkeys(task_ids or []) if i]
    if not ids:
        return 0
    rows = await db.tasks.find(
        {"tenant_id": tenant_id, "id": {"$in": ids}, "pickup_level": 0, "assignee_id": NO_PERSON},
        {"_id": 0, "id": 1, "title": 1, "assignee_role": 1, "pickup_route": 1, "pickup_why": 1}).to_list(len(ids))
    if not rows:
        return 0
    c = c or await company(db, tenant_id)
    groups: dict = {}
    for t in rows:
        key = (t.get("pickup_route"), t.get("pickup_why") or "", t.get("assignee_role"))
        for uid in _recipients(c, t):
            if uid and uid != actor_id:
                groups.setdefault((uid, *key), []).append(t)
    out = {k: (_told_text(c, k[1], k[2], k[3], v), v,
               "queue" if k[1] == "queue" else "needs_person", 1 if k[1] == "queue" else 2)
           for k, v in groups.items()}
    sent = await _send(db, tenant_id, out, sender)
    # The queue was told (1); a task that went to the ladder's first step at
    # once — high priority, or waiting on the owner — has climbed one step (2).
    ids = [t["id"] for t in rows]
    await db.tasks.update_many({"tenant_id": tenant_id, "id": {"$in": ids}, "pickup_level": 0,
                                "pickup_route": "queue"}, {"$set": {"pickup_level": 1}})
    await db.tasks.update_many({"tenant_id": tenant_id, "id": {"$in": ids}, "pickup_level": 0},
                               {"$set": {"pickup_level": 2}})
    return sent


async def place_and_announce(db, tenant_id: str, task_ids: Iterable[str], actor_id: Optional[str] = None,
                             sender: Optional[str] = None) -> dict:
    c = await company(db, tenant_id)
    out = await place(db, tenant_id, task_ids, c)
    out["told"] = await announce(db, tenant_id, out["placed"], actor_id, sender, c)
    return out


def _ladder_text(c: Company, owner_step: bool, role: Optional[str], tasks: list, days: int) -> str:
    n, title, d = len(tasks), tasks[0].get("title") or "A task", c.dept(role)
    span = "a day" if days <= 1 else f"{days} days"
    if not owner_step:
        return (f"Nobody has taken '{title}' from the {d} queue for {span}. Assign it to someone." if n == 1
                else f"{n} tasks have sat in the {d} queue for {span} with nobody. Assign them.")
    return (f"'{title}' has had nobody for {span}. Assign it to someone." if n == 1
            else f"{n} tasks have had nobody for {span} or more. Assign them.")


async def warn_unpicked(db, tenant_id: str, now: Optional[datetime] = None) -> dict:
    """The follow-up sweep's step for work with nobody. Runs on the leader-
    locked follow-up tick (services.finance_signals.run_followup)."""
    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat()
    # Found a person, or finished: the marks go.
    await db.tasks.update_many(
        {"tenant_id": tenant_id, "pickup_level": {"$exists": True},
         "$or": [{"assignee_id": {"$nin": [None, ""]}}, {"status": {"$nin": OPEN}}]},
        {"$unset": UNSET})
    rows = await db.tasks.find(
        {"tenant_id": tenant_id, "status": {"$in": OPEN}, "assignee_id": NO_PERSON,
         "source": {"$nin": SKIP_SOURCES}},
        {"_id": 0, "id": 1, "title": 1, "assignee_role": 1, "priority": 1, "pickup_route": 1,
         "pickup_why": 1, "pickup_since": 1, "pickup_level": 1}).to_list(2000)
    report = {"joined": 0, "told": 0, "managers": 0, "owner": 0}
    if not rows:
        return report
    c = await company(db, tenant_id)
    step_days = pickup_step_days(await db.tenants.find_one({"id": tenant_id}, {"_id": 0, "pickup_step_days": 1}))

    def where(t):
        # Joining now, nothing is handed out silently: a team of one is that
        # person's queue (they Take it), not an assignment nobody made.
        r = route(c, t.get("assignee_role"), t.get("priority"))
        return ("queue", "") if r.get("assignee_id") else (r["route"], r["why"])

    # Never placed — older work, or made somewhere that doesn't place it. It
    # joins its queue quietly and its days start today, so a backlog does not
    # arrive on the owner's phone all at once.
    for t in [t for t in rows if t.get("pickup_level") is None or not t.get("pickup_since")]:
        rte, why = where(t)
        await db.tasks.update_one({"tenant_id": tenant_id, "id": t["id"]}, {"$set": {
            "pickup_route": rte, "pickup_why": why, "pickup_since": stamp, "pickup_level": 1}})
        report["joined"] += 1
    # Placed by a path that could not tell anyone (a member removed with their
    # work handed to nobody): told now.
    fresh = [t for t in rows if t.get("pickup_level") == 0 and t.get("pickup_since")]
    for t in fresh:
        if not t.get("pickup_route"):
            rte, why = where(t)
            await db.tasks.update_one({"tenant_id": tenant_id, "id": t["id"]},
                                      {"$set": {"pickup_route": rte, "pickup_why": why}})
    if fresh:
        report["told"] = await announce(db, tenant_id, [t["id"] for t in fresh], c=c)

    # The ladder: one level up the team's reporting tree per step, the owner
    # last. A queued task's first step is a step after it was placed; one that
    # went to the ladder at once (high priority, waiting on the owner) has
    # climbed its first step already. Only the step now due is asked — a task
    # found late does not set off every level at once.
    groups: dict = {}
    for t in rows:
        level = t.get("pickup_level")
        if not level or not t.get("pickup_since"):
            continue
        try:
            since = datetime.fromisoformat(str(t["pickup_since"]).replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        days = int((now - since).total_seconds() // 86400)
        steps = steps_for(c, t)
        started = 0 if t.get("pickup_route") == "queue" else 1
        due = min(days // step_days + started, len(steps))
        if due <= level - 1:
            continue
        owner_step = due == len(steps)
        role = t.get("assignee_role")
        for uid in steps[due - 1]:
            groups.setdefault((uid, owner_step, None if owner_step else role), []).append((t, days))
        await db.tasks.update_one({"tenant_id": tenant_id, "id": t["id"]}, {"$set": {"pickup_level": due + 1}})
        report["owner" if owner_step else "managers"] += 1
    out = {}
    for (uid, owner_step, role), items in groups.items():
        tasks = [t for t, _ in items]
        days = min(d for _, d in items)
        out[(uid, owner_step, role)] = (_ladder_text(c, owner_step, role, tasks, days), tasks,
                                        "needs_person", 4 if owner_step else 3)
    await _send(db, tenant_id, out)
    return report


def _days_waiting(t: dict, now: datetime) -> int:
    try:
        since = datetime.fromisoformat(str(t.get("pickup_since") or t.get("created_at")).replace("Z", "+00:00"))
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        return max(0, int((now - since).total_seconds() // 86400))
    except (TypeError, ValueError):
        return 0


async def needs_person(db, user: dict) -> dict:
    """The Desk's "Needs a person": every open task with nobody, for an owner;
    their own team's, for any of its managers (the ladder asks each of them in
    turn). Oldest first."""
    tid = user["tenant_id"]
    c = await company(db, tid)
    owner = user.get("role") == "owner"
    head = not owner and c.is_manager(user, user.get("role"))
    if not owner and not head:
        return {"rows": [], "count": 0, "scope": "none"}
    q = {"tenant_id": tid, "status": {"$in": OPEN}, "assignee_id": NO_PERSON, "source": {"$nin": SKIP_SOURCES}}
    if head:
        q["assignee_role"] = user.get("role")
    rows = await db.tasks.find(q, {"_id": 0, "id": 1, "title": 1, "assignee_role": 1, "priority": 1,
                                   "due_date": 1, "decision_id": 1, "created_at": 1, "pickup_route": 1,
                                   "pickup_why": 1, "pickup_since": 1}).sort("created_at", 1).to_list(300)
    now = datetime.now(timezone.utc)
    dec_ids = list({t["decision_id"] for t in rows if t.get("decision_id")})
    titles = {d["id"]: d.get("title") async for d in db.decisions.find(
        {"tenant_id": tid, "id": {"$in": dec_ids}}, {"_id": 0, "id": 1, "title": 1})} if dec_ids else {}
    out = []
    for t in rows:
        out.append({
            "id": t["id"], "title": t.get("title"), "priority": t.get("priority") or "medium",
            "due_date": t.get("due_date"), "assignee_role": t.get("assignee_role"),
            "department": c.dept(t.get("assignee_role")), "route": t.get("pickup_route") or "queue",
            "line": waiting_line(c, t), "days": _days_waiting(t, now),
            "decision_id": t.get("decision_id"), "decision_title": titles.get(t.get("decision_id")),
            "can_take": owner or (bool(t.get("assignee_role")) and t.get("assignee_role") == user.get("role")),
        })
    return {"rows": out, "count": len(out), "scope": "company" if owner else "team"}


async def take(db, user: dict, task_id: str) -> dict:
    """Take it: a task in my team's queue becomes mine. One person wins; the
    second is told who has it. Returns the task as it now stands."""
    from fastapi import HTTPException
    tid = user["tenant_id"]
    t = await db.tasks.find_one({"id": task_id, "tenant_id": tid}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if t.get("status") in ("done", "cancelled"):
        raise HTTPException(status_code=409, detail="This task is already finished.")
    c = await company(db, tid)
    if t.get("assignee_id"):
        if t["assignee_id"] == user["id"]:
            return t
        raise HTTPException(status_code=409, detail=f"{c.name(t['assignee_id']) or 'Someone'} already has this task.")
    owner = user.get("role") == "owner"
    role = t.get("assignee_role")
    if not owner and (not role or role != user.get("role")):
        d = c.dept(role)
        raise HTTPException(status_code=403, detail=(
            f"Only people in {d} can take this task." if d else
            "This task has no team, so the owner assigns it."))
    now = now_iso()
    name = user.get("name") or "Someone"
    res = await db.tasks.update_one(
        {"id": task_id, "tenant_id": tid, "assignee_id": NO_PERSON},
        {"$set": {"assignee_id": user["id"], "assignee_role": role or user.get("role"),
                  "assignee_how": "took", "auto_assigned": None, "updated_at": now,
                  "last_action": f"Taken by {name}"},
         "$unset": UNSET})
    if not getattr(res, "modified_count", 0):
        again = await db.tasks.find_one({"id": task_id, "tenant_id": tid}, {"_id": 0, "assignee_id": 1})
        who = c.name((again or {}).get("assignee_id")) or "Someone"
        raise HTTPException(status_code=409, detail=f"{who} took it just before you.")
    # It is settled: the team's nearest managers hear, and everyone the ladder
    # has already asked (the owner only once it reached them).
    ladder = c.ladder(role) if role else []
    asked = steps_for(c, t)[:max(0, (t.get("pickup_level") or 0) - 1)]
    tell = [p["id"] for p in (ladder[0] if ladder else [])] + [i for step in asked for i in step]
    tell = [i for i in dict.fromkeys(tell) if i and i != user["id"]]
    if tell:
        import services.notifications as notifications
        where = f" from the {c.dept(role)} queue" if role else ""
        await notifications.push_notification(
            tid, tell, 1, f"{name} took '{t.get('title')}'{where}.", "task", task_id,
            ntype="status", title=t.get("title"), sender=name)
    return await db.tasks.find_one({"id": task_id, "tenant_id": tid}, {"_id": 0})

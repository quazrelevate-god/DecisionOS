"""Work nobody has finds its person (Epic 11 Sprint 11, founder 2026-10-30).

"From the decision it is creating a task — the task is mostly getting
unassigned." And: "I can't say we should directly assign to the least number
of tasks. That's not the right way." The rule (services.task_pickup):

  named person                      -> that person
  the team has one person           -> that person
  the team has people               -> the team's queue; anyone in it Takes it
  high priority                     -> the team's head is asked (still queued);
                                       no head -> the owner is asked
  no team / nobody in the team      -> the owner is asked
  the team's head                   =  whoever in it reports to an owner

and while it has nobody it climbs the team's reporting tree one level a day,
nearest managers first, the owner last (founder 2026-10-30: "rather than
putting a lot of notifications on the owner") — one message per person per
step, however many tasks. A team's managers: who reports to the owner, or has
people reporting to them.

The company used throughout:
    Meena  owner
    Sales  Ravi (reports to Meena: HEAD) · Priya (reports to Ravi) · Anil (no
           one) · Gopal (REMOVED, reported to Meena — must never count)
    Accounts  Fatima, the only one (reports to Meena)
    Ops    Kiran, Lata — neither reports to Meena: a team with NO head
    Design nobody
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import BackgroundTasks, HTTPException

from services.enrich import enrich_decision as real_enrich  # bound before the harness swaps it out
from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-pick"
OWNER = {"id": "u-meena", "tenant_id": T, "role": "owner", "name": "Meena Rao"}
RAVI = {"id": "u-ravi", "tenant_id": T, "role": "sales", "name": "Ravi Kumar"}
PRIYA = {"id": "u-priya", "tenant_id": T, "role": "sales", "name": "Priya Nair"}
ANIL = {"id": "u-anil", "tenant_id": T, "role": "sales", "name": "Anil Shah"}
FATIMA = {"id": "u-fatima", "tenant_id": T, "role": "accounts", "name": "Fatima Sayed"}
KIRAN = {"id": "u-kiran", "tenant_id": T, "role": "ops", "name": "Kiran Das"}
SALES_TEAM = {"u-ravi", "u-priya", "u-anil"}

SENT = []


async def _record(tenant_id, user_ids, level, message, entity_type=None, entity_id=None,
                  ntype=None, title=None, sender=None):
    for uid in user_ids:
        SENT.append({"to": uid, "level": level, "msg": message, "type": ntype, "entity": entity_id})


def _quiet(*a, **k):
    return None


STUBS = {"services.notifications.push_notification": _record,
         "services.auto_plan.schedule": _quiet}
KEEP = {"core.add_decision_event"}


async def _seed(db):
    SENT.clear()
    await db.tenants.insert_one({"id": T, "company_name": "Rao Textiles", "roles": [
        {"key": "sales", "label": "Sales"}, {"key": "accounts", "label": "Accounts"},
        {"key": "ops", "label": "Ops"}, {"key": "design", "label": "Design"}]})
    people = [
        (OWNER, None, "active"), (RAVI, "u-meena", "active"), (PRIYA, "u-ravi", "active"),
        (ANIL, None, "active"), (FATIMA, "u-meena", "active"), (KIRAN, None, "active"),
        ({"id": "u-lata", "role": "ops", "name": "Lata Iyer"}, None, "active"),
        ({"id": "u-gopal", "role": "sales", "name": "Gopal Removed"}, "u-meena", "removed"),
    ]
    for p, boss, status in people:
        await db.users.insert_one({"id": p["id"], "tenant_id": T, "role": p["role"], "name": p["name"],
                                   "reporting_manager_id": boss, "email": f"{p['id']}@t.test"})
        await db.memberships.insert_one({"id": f"m-{p['id']}", "tenant_id": T, "user_id": p["id"],
                                         "role": p["role"], "status": status})


async def _task(db, tid, title, role=None, priority="medium", **extra):
    doc = {"id": tid, "tenant_id": T, "title": title, "assignee_id": None, "assignee_role": role,
           "priority": priority, "status": "todo", "source": "voice", "created_at": "2026-10-30T09:00:00+00:00"}
    doc.update(extra)
    await db.tasks.insert_one(doc)


def _to(uid, kind=None):
    return [s for s in SENT if s["to"] == uid and (kind is None or s["type"] == kind)]


async def _refused(coro, status):
    try:
        await coro
    except HTTPException as e:
        assert e.status_code == status, (e.status_code, e.detail)
        return e.detail
    raise AssertionError(f"expected HTTP {status}")


# ═══════════════════════════ 1 · where a task goes ══════════════════════════
def test_the_rule_for_every_kind_of_team(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        c = await tp.company(db, T)
        return {
            "sales": tp.route(c, "sales", "medium"),
            "sales_low": tp.route(c, "sales", "low"),
            "sales_high": tp.route(c, "sales", "high"),
            "accounts": tp.route(c, "accounts", "medium"),
            "accounts_high": tp.route(c, "accounts", "high"),
            "ops_high": tp.route(c, "ops", "high"),
            "ops": tp.route(c, "ops", "medium"),
            "design": tp.route(c, "design", "medium"),
            "none": tp.route(c, None, "medium"),
            "heads": [p["id"] for p in c.heads("sales")],
            "members": sorted(p["id"] for p in c.members("sales")),
        }
    r = with_test_db(scenario)
    assert r["sales"] == {"route": "queue", "why": ""} and r["sales_low"] == {"route": "queue", "why": ""}
    assert r["sales_high"] == {"route": "manager", "why": ""}, "high priority asks the team's head"
    assert r["accounts"] == {"assignee_id": "u-fatima"}, "a team of one is that person"
    assert r["accounts_high"] == {"assignee_id": "u-fatima"}
    assert r["ops_high"] == {"route": "owner", "why": "no_head"}, "no head: the owner is asked"
    assert r["ops"] == {"route": "queue", "why": ""}, "no head still has a queue"
    assert r["design"] == {"route": "owner", "why": "nobody_in_team"}
    assert r["none"] == {"route": "owner", "why": "no_team"}
    assert r["heads"] == ["u-ravi"], "the head is whoever reports to the owner — Priya reports to Ravi, not a head"
    assert r["members"] == ["u-anil", "u-priya", "u-ravi"], "Gopal was removed and never counts"


def test_people_from_before_memberships_count_and_invitees_do_not(with_test_db):
    """Found on the demo company (2026-10-30): an older company's people have no
    membership rows. Inviting one new person must not drop everyone else — and
    someone invited but not yet joined is nobody's only person."""
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await db.users.insert_one({"id": "u-old", "tenant_id": T, "role": "design", "name": "Old Timer"})
        await db.users.insert_one({"id": "u-inv", "tenant_id": T, "role": "accounts", "name": "Not Yet",
                                   "invite_status": "pending"})
        await db.memberships.insert_one({"id": "m-inv2", "tenant_id": T, "user_id": "u-inv", "status": "pending"})
        await db.users.insert_one({"id": "u-susp", "tenant_id": T, "role": "design", "name": "Suspended",
                                   "invite_status": "suspended"})
        c = await tp.company(db, T)
        return tp.route(c, "design", "medium"), tp.route(c, "accounts", "medium")
    design, accounts = with_test_db(scenario)
    assert design == {"assignee_id": "u-old"}, "no membership row: from before memberships, counts"
    assert accounts == {"assignee_id": "u-fatima"}, "a pending invitee does not count"


def test_two_people_reporting_to_the_owner_are_both_the_head(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await db.users.update_one({"id": "u-anil"}, {"$set": {"reporting_manager_id": "u-meena"}})
        c = await tp.company(db, T)
        return sorted(p["id"] for p in c.heads("sales")), tp.goes_to(c, "sales", "high")["label"]
    heads, label = with_test_db(scenario)
    assert heads == ["u-anil", "u-ravi"]
    assert label.startswith("Anil or Ravi assigns it") or label.startswith("Ravi or Anil assigns it")


def test_nobody_is_ever_picked_by_how_few_tasks_they_have(with_test_db):
    """Ravi has ten open tasks, Priya none. The old rule gave Priya the work;
    now it waits in the Sales queue for whoever takes it."""
    async def scenario(db):
        import services.voice as voice
        await _seed(db)
        for i in range(10):
            await _task(db, f"busy{i}", f"Ravi's work {i}", "sales", assignee_id="u-ravi")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            members = await db.users.find({"tenant_id": T}, {"_id": 0, "id": 1, "name": 1, "role": 1}).to_list(50)
            p = await voice.build_proposal(T, {"tasks": [
                {"title": "Quote Kumar Exports", "assignee_role": "sales"},
                {"title": "Book the courier", "assignee_role": "accounts"},
                {"title": "Call Lakshmi Mills", "assignee_name": "Priya Nair", "assignee_role": "sales"},
            ]}, {"sales", "accounts", "ops", "design", "owner"}, members, set(), [])
            return [(t["title"], t["assignee_id"], t["assignee_how"]) for t in p["tasks"]]
    rows = with_test_db(scenario)
    assert rows == [("Quote Kumar Exports", None, "team"),
                    ("Book the courier", "u-fatima", "only_member"),
                    ("Call Lakshmi Mills", "u-priya", "named")]


# ═══════════════════════ 2 · a decision, approved ═══════════════════════════
def _decision(tasks):
    return {"id": "dec-1", "tenant_id": T, "title": "Restock for the Diwali order", "status": "pending_approval",
            "created_by": "u-meena", "source": "voice", "task_ids": [], "created_at": "2026-10-30T08:00:00+00:00",
            "proposal": {"tasks": tasks, "workflows": [], "meetings": [], "reminders": [], "memory_notes": []}}


PROPOSAL = [
    {"key": "k1", "title": "Call Lakshmi Mills", "assignee_id": "u-priya", "assignee_role": "sales", "priority": "medium"},
    {"key": "k2", "title": "Quote Kumar Exports", "assignee_id": None, "assignee_role": "sales", "priority": "medium"},
    {"key": "k3", "title": "Send samples today", "assignee_id": None, "assignee_role": "sales", "priority": "high"},
    {"key": "k4", "title": "Book the courier", "assignee_id": None, "assignee_role": "accounts", "priority": "medium"},
    {"key": "k5", "title": "Check the dye stock", "assignee_id": None, "assignee_role": None, "priority": "medium",
     "added_by_hand": True},
    {"key": "k6", "title": "Draw the new label", "assignee_id": None, "assignee_role": "design", "priority": "medium"},
    {"key": "k7", "title": "Pack the boxes", "assignee_id": None, "assignee_role": "sales", "priority": "low"},
]


def test_the_review_says_where_each_task_nobody_is_named_for_will_go(with_test_db):
    async def scenario(db):
        await _seed(db)
        await db.decisions.insert_one(_decision([dict(t) for t in PROPOSAL]))
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            d = await real_enrich(await db.decisions.find_one({"id": "dec-1"}, {"_id": 0}), tenant_id=T)
        return {t["key"]: (t.get("goes_to") or {}) for t in d["proposal"]["tasks"]}
    g = with_test_db(scenario)
    assert g["k1"] == {}, "a named person needs no line"
    assert g["k2"] == {"route": "queue", "label": "Sales queue — anyone in Sales can take it"}
    assert g["k3"] == {"route": "manager", "label": "Ravi assigns it — high priority"}
    assert g["k4"]["route"] == "person" and g["k4"]["label"] == "Fatima Sayed — the only one in Accounts"
    assert g["k5"] == {"route": "owner", "label": "The owner assigns it — no team named"}
    assert g["k6"] == {"route": "owner", "label": "The owner assigns it — nobody in Design yet"}


def test_approving_puts_every_task_with_its_person_or_in_its_queue_and_tells_them_once(with_test_db):
    async def scenario(db):
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        await db.decisions.insert_one(_decision([dict(t) for t in PROPOSAL]))
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await approve_decision_flow(OWNER, "dec-1")
        tasks = {t["title"]: t for t in await db.tasks.find({"tenant_id": T, "decision_id": "dec-1"}, {"_id": 0}).to_list(20)}
        events = [e.get("label") for e in (await db.decisions.find_one({"id": "dec-1"}, {"_id": 0})).get("timeline") or []]
        return tasks, events
    tasks, events = with_test_db(scenario)
    assert tasks["Call Lakshmi Mills"]["assignee_id"] == "u-priya"
    q = tasks["Quote Kumar Exports"]
    assert (q["assignee_id"], q["pickup_route"], q["pickup_level"]) == (None, "queue", 1)
    s = tasks["Send samples today"]
    assert (s["assignee_id"], s["assignee_role"], s["pickup_route"]) == (None, "sales", "manager"), \
        "high priority: still the Sales team's, and Ravi is asked"
    b = tasks["Book the courier"]
    assert (b["assignee_id"], b.get("assignee_how")) == ("u-fatima", "only_member") and "pickup_route" not in b
    assert (tasks["Check the dye stock"]["pickup_route"], tasks["Check the dye stock"]["pickup_why"]) == ("owner", "no_team")
    assert (tasks["Draw the new label"]["pickup_route"], tasks["Draw the new label"]["pickup_why"]) == ("owner", "nobody_in_team")
    assert tasks["Pack the boxes"]["pickup_route"] == "queue"

    # The Sales team hears about its queue ONCE — two queue tasks, one message each.
    for uid in SALES_TEAM:
        q_msgs = _to(uid, "queue")
        assert len(q_msgs) == 1, (uid, q_msgs)
        assert q_msgs[0]["msg"] == "2 new tasks in the Sales queue. Take the ones that are yours."
    ravi_ask = _to("u-ravi", "needs_person")
    assert len(ravi_ask) == 1 and "'Send samples today' is high priority" in ravi_ask[0]["msg"]
    assert not _to("u-priya", "needs_person") and not _to("u-anil", "needs_person"), "only the head is asked"
    assert [m["msg"] for m in _to("u-fatima", "assigned")] == ["Work assigned to you: 'Book the courier'"]
    assert not _to("u-meena"), "the owner who approved saw where it all went; nobody re-tells them"
    assert not _to("u-gopal") and not _to("u-kiran"), "removed people and other teams hear nothing"

    timeline = "\n".join(e for e in events if e)
    assert "In the Sales queue: Quote Kumar Exports" in timeline
    assert "Waiting for Ravi to assign it: Send samples today" in timeline
    assert "Task assigned to Fatima Sayed: Book the courier" in timeline
    assert "Waiting for the owner to assign it — no team: Check the dye stock" in timeline
    assert "Waiting for the owner to assign it — nobody in Design: Draw the new label" in timeline


def test_a_manager_who_approves_is_not_told_about_their_own_queue(with_test_db):
    async def scenario(db):
        from services.decision_flow import approve_decision_flow
        await _seed(db)
        d = _decision([dict(PROPOSAL[1]), dict(PROPOSAL[2])])
        d["approver_id"] = "u-ravi"
        await db.decisions.insert_one(d)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await approve_decision_flow({**RAVI, "permissions": ["decisions_approve", "tasks"]}, "dec-1", authorized=True)
    with_test_db(scenario)
    assert not _to("u-ravi"), "Ravi approved it — he knows"
    assert len(_to("u-priya", "queue")) == 1


# ═════════════════════════════ 3 · Take it ═══════════════════════════════════
def test_someone_in_the_team_takes_it_and_the_head_hears(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        await _seed(db)
        await db.decisions.insert_one({"id": "dec-9", "tenant_id": T, "title": "Diwali", "status": "approved"})
        await _task(db, "q1", "Quote Kumar Exports", "sales", decision_id="dec-9",
                    pickup_route="queue", pickup_why="", pickup_since="2026-10-30T09:00:00+00:00", pickup_level=1)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            t = await tasks_router.take_task("q1", user=PRIYA)
            second = await _refused(tasks_router.take_task("q1", user=ANIL), 409)
            again = await tasks_router.take_task("q1", user=PRIYA)
        row = await db.tasks.find_one({"id": "q1"}, {"_id": 0})
        d = await db.decisions.find_one({"id": "dec-9"}, {"_id": 0})
        return t, second, again, row, [e.get("label") for e in (d.get("timeline") or [])]
    t, second, again, row, events = with_test_db(scenario)
    assert (row["assignee_id"], row["assignee_how"], row["assignee_role"]) == ("u-priya", "took", "sales")
    assert not any(f in row for f in ("pickup_route", "pickup_level", "pickup_since", "pickup_why")), \
        "it stops waiting the moment it has a person"
    assert second == "Priya Nair already has this task."
    assert again["assignee_id"] == "u-priya", "taking your own task again is harmless"
    heard = _to("u-ravi", "status")
    assert len(heard) == 1 and heard[0]["msg"] == "Priya Nair took 'Quote Kumar Exports' from the Sales queue."
    assert not _to("u-meena"), "the owner was never asked, so is not told"
    assert any("Priya Nair took 'Quote Kumar Exports'" in (e or "") for e in events)


def test_only_the_team_takes_its_queue_and_the_owner_takes_what_has_no_team(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        await _seed(db)
        await _task(db, "q1", "Quote Kumar Exports", "sales", pickup_route="queue", pickup_level=1,
                    pickup_since="2026-10-30T09:00:00+00:00")
        await _task(db, "n1", "Check the dye stock", None, pickup_route="owner", pickup_why="no_team",
                    pickup_level=1, pickup_since="2026-10-30T09:00:00+00:00")
        await _task(db, "d1", "Finished thing", "sales", status="done")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            other_team = await _refused(tasks_router.take_task("q1", user=FATIMA), 403)
            member_no_team = await _refused(tasks_router.take_task("n1", user=ANIL), 403)
            owner = await tasks_router.take_task("n1", user=OWNER)
            done = await _refused(tasks_router.take_task("d1", user=PRIYA), 409)
            missing = await _refused(tasks_router.take_task("nope", user=PRIYA), 404)
        return other_team, member_no_team, owner, done, missing
    other_team, member_no_team, owner, done, missing = with_test_db(scenario)
    assert other_team == "Only people in Sales can take this task."
    assert member_no_team == "This task has no team, so the owner assigns it."
    assert owner["assignee_id"] == "u-meena"
    assert done == "This task is already finished."


def test_two_people_taking_at_the_same_moment_one_wins(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await _task(db, "q1", "Quote Kumar Exports", "sales", pickup_route="queue", pickup_level=1,
                    pickup_since="2026-10-30T09:00:00+00:00")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            res = await asyncio.gather(tp.take(db, PRIYA, "q1"), tp.take(db, ANIL, "q1"), return_exceptions=True)
        return res, await db.tasks.find_one({"id": "q1"}, {"_id": 0})
    res, row = with_test_db(scenario)
    wins = [r for r in res if isinstance(r, dict)]
    lost = [r for r in res if isinstance(r, HTTPException)]
    assert len(wins) == 1 and len(lost) == 1 and lost[0].status_code == 409
    assert row["assignee_id"] == wins[0]["assignee_id"]


# ════════════════════════ 4 · the reminders that follow ═════════════════════
def _ago(days, hours=0):
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours)).isoformat()


def test_a_day_in_the_queue_asks_the_head_two_days_the_owner_one_message_each(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        for i in (1, 2, 3):
            await _task(db, f"q{i}", f"Sales job {i}", "sales", pickup_route="queue", pickup_why="",
                        pickup_since=_ago(1, 1), pickup_level=1)
        await _task(db, "fresh", "Brand new", "sales", pickup_route="queue", pickup_why="",
                    pickup_since=_ago(0, 3), pickup_level=1)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            first = await tp.warn_unpicked(db, T)
            ravi_after_first = list(_to("u-ravi"))
            owner_after_first = list(_to("u-meena"))
            again = await tp.warn_unpicked(db, T)
            SENT.clear()
            later = await tp.warn_unpicked(db, T, datetime.now(timezone.utc) + timedelta(days=1))
        levels = {t["id"]: t.get("pickup_level") async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}
        return first, ravi_after_first, owner_after_first, again, later, list(SENT), levels
    first, ravi1, owner1, again, later, sent_later, levels = with_test_db(scenario)
    assert first["managers"] == 3
    assert len(ravi1) == 1 and ravi1[0]["msg"] == "3 tasks have sat in the Sales queue for a day with nobody. Assign them."
    assert ravi1[0]["type"] == "needs_person" and ravi1[0]["level"] == 3
    assert not owner1, "a day in: the head, not yet the owner"
    assert again == {"joined": 0, "told": 0, "managers": 0, "owner": 0}, "asked once per step"
    assert later["owner"] == 3 and later["managers"] == 1, "the three reach the owner; the fresh one reaches its head"
    owner_msgs = [s for s in sent_later if s["to"] == "u-meena"]
    assert len(owner_msgs) == 1 and owner_msgs[0]["msg"] == "3 tasks have had nobody for 2 days or more. Assign them."
    assert owner_msgs[0]["level"] == 4
    assert levels["q1"] == 3 and levels["fresh"] == 2


def test_a_team_with_no_managers_asks_the_owner_at_the_first_step(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await _task(db, "o1", "Fix the loom", "ops", pickup_route="queue", pickup_why="",
                    pickup_since=_ago(1, 1), pickup_level=1)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await tp.warn_unpicked(db, T)
        return list(SENT)
    sent = with_test_db(scenario)
    assert [(s["to"], s["msg"]) for s in sent] == [
        ("u-meena", "'Fix the loom' has had nobody for a day. Assign it to someone.")]


def test_high_priority_climbs_a_day_sooner_and_owner_work_is_not_chased(with_test_db):
    """High priority asked Ravi when it was made, so a day later it is the
    owner's. Work already waiting on the owner is not chased again — it stays
    on the Desk's Needs a person instead of piling up on the owner's phone."""
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await _task(db, "m1", "Send samples today", "sales", priority="high", pickup_route="manager",
                    pickup_why="", pickup_since=_ago(1, 1), pickup_level=2)
        await _task(db, "w1", "Check the dye stock", None, pickup_route="owner", pickup_why="no_team",
                    pickup_since=_ago(1, 1), pickup_level=2)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            day1 = await tp.warn_unpicked(db, T)
            sent1 = list(SENT)
            SENT.clear()
            await tp.warn_unpicked(db, T, datetime.now(timezone.utc) + timedelta(days=5))
        return day1, sent1, list(SENT)
    day1, sent1, later = with_test_db(scenario)
    assert day1["owner"] == 1 and [(s["to"], s["msg"]) for s in sent1] == [
        ("u-meena", "'Send samples today' has had nobody for a day. Assign it to someone.")]
    assert not later, "the top of the ladder is asked once; the Desk keeps showing it"


def test_older_work_joins_its_queue_quietly_and_its_days_start_today(with_test_db):
    """July's 86 unassigned tasks must not land on the owner's phone at once."""
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await _task(db, "old1", "July job", "sales", created_at="2026-07-12T09:00:00+00:00")
        await _task(db, "old2", "July job, no team", None, created_at="2026-07-12T09:00:00+00:00")
        await _task(db, "old3", "July job for Fatima", "accounts", created_at="2026-07-12T09:00:00+00:00")
        await _task(db, "rem", "A reminder", None, source="reminder")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            r = await tp.warn_unpicked(db, T)
        rows = {t["id"]: t async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}
        return r, rows, list(SENT)
    r, rows, sent = with_test_db(scenario)
    assert r["joined"] == 3 and not sent, "joined, not announced"
    assert rows["old1"]["pickup_route"] == "queue" and rows["old1"]["pickup_level"] == 1
    assert rows["old1"]["pickup_since"] > "2026-10-29", "its days start today, not in July"
    assert (rows["old2"]["pickup_route"], rows["old2"]["pickup_why"]) == ("owner", "no_team")
    assert rows["old3"]["assignee_id"] is None and rows["old3"]["pickup_route"] == "queue", \
        "nothing is handed out silently — Fatima takes it from her queue"
    assert "pickup_route" not in rows["rem"], "reminders always have their person"


def test_work_that_found_a_person_or_finished_stops_waiting(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await _task(db, "a1", "Assigned elsewhere", "sales", assignee_id="u-anil", pickup_route="queue",
                    pickup_since=_ago(3), pickup_level=1)
        await _task(db, "f1", "Finished", "sales", status="done", pickup_route="queue",
                    pickup_since=_ago(3), pickup_level=1)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await tp.warn_unpicked(db, T)
        return {t["id"]: t async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}, list(SENT)
    rows, sent = with_test_db(scenario)
    assert "pickup_level" not in rows["a1"] and "pickup_level" not in rows["f1"]
    assert not sent


def test_the_companys_own_days_are_used(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await db.tenants.update_one({"id": T}, {"$set": {"pickup_step_days": 3}})
        await _task(db, "q1", "Sales job", "sales", pickup_route="queue", pickup_why="",
                    pickup_since=_ago(2, 1), pickup_level=1)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            two = await tp.warn_unpicked(db, T)
            three = await tp.warn_unpicked(db, T, datetime.now(timezone.utc) + timedelta(days=1))
        return two, three
    two, three = with_test_db(scenario)
    assert two["managers"] == 0 and three["managers"] == 1


# ═══════════════════ 5 · every other place work is made ═════════════════════
def test_new_task_given_to_a_team_waits_in_its_queue(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        from models.tasks import TaskCreateInput
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            team = await tasks_router.create_task(TaskCreateInput(
                title="Visit Lakshmi Mills", assignee_role="sales", due_date="2026-11-05"), BackgroundTasks(), user=OWNER)
            one = await tasks_router.create_task(TaskCreateInput(
                title="File the GST return", assignee_role="accounts", due_date="2026-11-05"), BackgroundTasks(), user=OWNER)
            high = await tasks_router.create_task(TaskCreateInput(
                title="Fix the loom today", assignee_role="ops", priority="high", due_date="2026-11-05"),
                BackgroundTasks(), user=OWNER)
        rows = {t["title"]: t async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}
        return team, one, high, rows
    team, one, high, rows = with_test_db(scenario)
    assert team["assignee_id"] is None and rows["Visit Lakshmi Mills"]["pickup_route"] == "queue"
    assert not team.get("auto_assigned"), "no 'picked automatically: fewest open tasks' any more"
    assert one["assignee_id"] == "u-fatima" and rows["File the GST return"]["assignee_how"] == "only_member"
    assert (rows["Fix the loom today"]["pickup_route"], rows["Fix the loom today"]["pickup_why"]) == ("owner", "no_head")
    assert len(_to("u-priya", "queue")) == 1 and _to("u-priya", "queue")[0]["msg"] == \
        "New in the Sales queue: 'Visit Lakshmi Mills'. Take it if it's yours."
    assert [m["msg"] for m in _to("u-fatima", "assigned")] == ["New work assigned: 'File the GST return'"]
    assert not _to("u-meena"), "the owner made them — not told about their own tasks"


def test_a_workflow_stage_puts_its_work_in_the_teams_queue(with_test_db):
    async def om(tenant_id, *a, **k):
        return {"pipelines": [{"key": "orders", "label": "Orders", "stages": [
            {"key": "inquiry", "label": "Inquiry", "role": "sales",
             "tasks": [{"title": "Log the buyer's inquiry", "role": "sales"},
                       {"title": "Raise the proforma", "role": "accounts"},
                       {"title": "Design the swatch card", "role": "design"}]},
            {"key": "made", "label": "Made", "role": "ops", "tasks": []}]}]}

    async def scenario(db):
        import services.workflow_engine as eng
        await _seed(db)
        with e2e_env(db, stubs={**STUBS, "services.ai.generators.tenant_operating_model": om}, keep=KEEP):
            await db.workflows.insert_one({"id": "wf1", "tenant_id": T, "type": "orders", "title": "Kumar Exports",
                                           "stage": "inquiry", "stages": ["inquiry", "made"]})
            await eng.on_stage_enter(T, "wf1", "u-ravi", "Ravi Kumar")
        return {t["title"]: t async for t in db.tasks.find({"tenant_id": T}, {"_id": 0})}
    rows = with_test_db(scenario)
    log = rows["Log the buyer's inquiry"]
    assert (log["assignee_id"], log["pickup_route"], log["pickup_level"]) == (None, "queue", 1)
    assert rows["Raise the proforma"]["assignee_id"] == "u-fatima"
    assert rows["Design the swatch card"]["pickup_why"] == "nobody_in_team"
    assert len(_to("u-priya", "queue")) == 1 and not _to("u-ravi", "queue"), "Ravi moved the card — not told"
    assert len(_to("u-meena", "needs_person")) == 1, "the owner is asked about Design"


def test_someone_leaving_with_their_work_handed_to_nobody_puts_it_in_their_teams_queue(with_test_db):
    async def scenario(db):
        from services.deprovisioning import deprovision_user
        from services import task_pickup as tp
        await _seed(db)
        await _task(db, "a1", "Anil's quote", "sales", assignee_id="u-anil")
        await deprovision_user(db, target_user_id="u-anil", tenant_id=T, actor_user_id="u-meena",
                               reassign_to_user_id=None)
        before = await db.tasks.find_one({"id": "a1"}, {"_id": 0})
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await tp.warn_unpicked(db, T)
        return before, await db.tasks.find_one({"id": "a1"}, {"_id": 0})
    before, after = with_test_db(scenario)
    assert (before["assignee_id"], before["assignee_role"], before["pickup_level"]) == (None, "sales", 0), \
        "it keeps its team (it used to lose it)"
    assert (after["pickup_route"], after["pickup_level"]) == ("queue", 1)
    assert len(_to("u-priya", "queue")) == 1 and len(_to("u-ravi", "queue")) == 1
    assert not _to("u-anil"), "the person who left is not told"


def test_a_task_added_to_an_approved_decision_finds_its_place(with_test_db):
    async def scenario(db):
        import routers.decisions as decisions_router
        from models.tasks import TaskCreateInput
        await _seed(db)
        await db.decisions.insert_one({**_decision([]), "status": "approved"})
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await decisions_router.add_decision_task("dec-1", TaskCreateInput(title="Chase the dyer", assignee_role="sales"),
                                                     user=OWNER)
        return await db.tasks.find_one({"title": "Chase the dyer"}, {"_id": 0})
    t = with_test_db(scenario)
    assert (t["assignee_id"], t["pickup_route"], t["pickup_level"]) == (None, "queue", 1)


# ═════════════ 6 · the Desk's Needs a person, and assigning from it ═════════
def test_needs_a_person_shows_the_owner_everything_and_a_head_their_team(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        await _seed(db)
        await _task(db, "q1", "Quote Kumar Exports", "sales", pickup_route="queue", pickup_why="",
                    pickup_since=_ago(2), pickup_level=3, created_at="2026-10-28T09:00:00+00:00")
        await _task(db, "n1", "Check the dye stock", None, pickup_route="owner", pickup_why="no_team",
                    pickup_since=_ago(0), pickup_level=1, created_at="2026-10-30T09:00:00+00:00")
        await _task(db, "x1", "Has a person", "sales", assignee_id="u-anil")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            return (await tasks_router.tasks_needing_a_person(user=OWNER),
                    await tasks_router.tasks_needing_a_person(user=RAVI),
                    await tasks_router.tasks_needing_a_person(user=PRIYA))
    owner, head, member = with_test_db(scenario)
    assert owner["scope"] == "company" and [r["id"] for r in owner["rows"]] == ["q1", "n1"], "oldest first"
    q = owner["rows"][0]
    assert (q["department"], q["line"], q["days"], q["can_take"]) == ("Sales", "In the Sales queue", 2, True)
    assert owner["rows"][1]["line"] == "Waiting for the owner to assign it — no team"
    assert head["scope"] == "team" and [r["id"] for r in head["rows"]] == ["q1"], "a head sees their own team"
    assert member == {"rows": [], "count": 0, "scope": "none"}, "the team's queue is in My Work for everyone else"


def test_the_head_assigns_from_the_queue_and_others_cannot(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        from models.tasks import TaskReassignInput
        await _seed(db)
        await _task(db, "q1", "Quote Kumar Exports", "sales", pickup_route="queue", pickup_since=_ago(1),
                    pickup_level=2, created_by="u-meena")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            refused = await _refused(tasks_router.reassign_task("q1", TaskReassignInput(assignee_id="u-priya"),
                                                                user=ANIL), 403)
            await tasks_router.reassign_task("q1", TaskReassignInput(assignee_id="u-priya"), user=RAVI)
        return refused, await db.tasks.find_one({"id": "q1"}, {"_id": 0})
    refused, row = with_test_db(scenario)
    assert "can change who is on this task" in refused
    assert row["assignee_id"] == "u-priya" and "pickup_level" not in row
    assert [m["msg"] for m in _to("u-priya", "assigned")] == ["Work assigned to you: 'Quote Kumar Exports'"]


def test_moving_a_task_to_another_team_puts_it_in_that_queue(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        from models.tasks import TaskReassignInput
        await _seed(db)
        await _task(db, "q1", "Count the cartons", "sales", pickup_route="queue", pickup_since=_ago(1),
                    pickup_level=2, created_by="u-meena")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await tasks_router.reassign_task("q1", TaskReassignInput(assignee_role="ops"), user=OWNER)
        return await db.tasks.find_one({"id": "q1"}, {"_id": 0})
    row = with_test_db(scenario)
    assert (row["assignee_role"], row["pickup_route"], row["pickup_level"]) == ("ops", "queue", 1)
    assert row["pickup_since"] > _ago(0, 1), "its days start again in the new team"
    assert len(_to("u-kiran", "queue")) == 1 and len(_to("u-lata", "queue")) == 1


# ═══════════════════════════════ 7 · settings ═══════════════════════════════
def test_the_owner_sets_how_many_days_each_step_of_the_ladder_is(with_test_db):
    async def scenario(db):
        import routers.tenant_settings as ts
        from models.tenant import TenantSettingsInput
        await _seed(db)
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            saved = await ts.update_tenant_settings(TenantSettingsInput(pickup_step_days=2), user=OWNER)
            zero = await _refused(ts.update_tenant_settings(TenantSettingsInput(pickup_step_days=0), user=OWNER), 400)
            too_long = await _refused(ts.update_tenant_settings(TenantSettingsInput(pickup_step_days=20), user=OWNER), 400)
        return saved, zero, too_long
    saved, zero, too_long = with_test_db(scenario)
    assert saved["pickup_step_days"] == 2
    assert "1 to 14 days" in zero and "1 to 14 days" in too_long


# ═════════════════════════════ 8 · the screens ══════════════════════════════
FRONT = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")


def _src(*parts):
    with open(os.path.join(FRONT, *parts), encoding="utf-8") as f:
        return f.read()


def test_the_screens_show_the_queue_take_it_and_needs_a_person():
    sheet = _src("pages", "desk", "NeedsPersonSheet.jsx")
    assert 'api.get("/tasks/needs-person")' in sheet and "/reassign" in sheet and "/take" in sheet
    desk = _src("pages", "Desk.js")
    assert "NeedsPersonSheet" in desk and 'needsCard("desk-needs-person")' in desk
    assert 'searchParams.get("needs") === "person"' in desk, "the notification opens the list"
    work = _src("pages", "MyWork.js")
    assert "function TakeItBar" in work and "api.post(`/tasks/${t.id}/take`)" in work
    assert "Picked automatically: fewest open tasks" not in work
    for review in (_src("components", "DecisionDialog.js"), _src("pages", "desk", "DexReview.jsx")):
        assert "goes_to?.label" in review
    assert 'needs_person: { label: "Needs a Person"' in _src("lib", "notif.js")
    assert 'data-testid="pickup-step-days"' in _src("pages", "Settings.js")


# ═════════════ 9 · a deeper team: the reminder climbs one level a day ════════
async def _deep_sales(db):
    """Sales as a three-level tree:
        Meena (owner)
          Ravi      level 1, the head
            Priya   level 2, a team lead — Esha reports to her
            Anil    level 2, a team lead — Dev reports to him
              Esha, Dev  entry level
    """
    await _seed(db)
    await db.users.update_one({"id": "u-anil"}, {"$set": {"reporting_manager_id": "u-ravi"}})
    for uid, name, boss in (("u-esha", "Esha Pillai", "u-priya"), ("u-dev", "Dev Menon", "u-anil")):
        await db.users.insert_one({"id": uid, "tenant_id": T, "role": "sales", "name": name,
                                   "reporting_manager_id": boss, "email": f"{uid}@t.test"})
        await db.memberships.insert_one({"id": f"m-{uid}", "tenant_id": T, "user_id": uid, "role": "sales",
                                         "status": "active"})


def test_the_ladder_is_the_teams_reporting_tree_nearest_managers_first(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _deep_sales(db)
        c = await tp.company(db, T)
        return ([sorted(p["id"] for p in step) for step in c.ladder("sales")],
                {u: c.level(u) for u in ("u-ravi", "u-priya", "u-anil", "u-esha")},
                tp.goes_to(c, "sales", "high")["label"])
    ladder, levels, label = with_test_db(scenario)
    assert ladder == [["u-anil", "u-priya"], ["u-ravi"]], "team leads first, then the head; the owner comes after"
    assert levels == {"u-ravi": 1, "u-priya": 2, "u-anil": 2, "u-esha": 3}
    assert label in ("Anil or Priya assigns it — high priority", "Priya or Anil assigns it — high priority")


def test_a_queued_task_asks_the_team_leads_then_the_head_then_the_owner_a_day_apart(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _deep_sales(db)
        await _task(db, "q1", "Quote Kumar Exports", "sales", pickup_route="queue", pickup_why="",
                    pickup_since=_ago(0, 1), pickup_level=1)
        now = datetime.now(timezone.utc)
        days = []
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            for d in (0, 1, 2, 3, 4):
                SENT.clear()
                await tp.warn_unpicked(db, T, now + timedelta(days=d))
                days.append(sorted((s["to"], s["level"]) for s in SENT))
        return days
    d0, d1, d2, d3, d4 = with_test_db(scenario)
    assert d0 == [], "the queue was told when it was made"
    assert d1 == [("u-anil", 3), ("u-priya", 3)], "day 1: the two team leads"
    assert d2 == [("u-ravi", 3)], "day 2: the head"
    assert d3 == [("u-meena", 4)], "day 3: the owner, last"
    assert d4 == [], "and then nobody is chased again"


def test_a_high_priority_task_starts_with_the_team_leads_at_once(with_test_db):
    async def scenario(db):
        from services import task_pickup as tp
        await _deep_sales(db)
        await _task(db, "h1", "Send samples today", "sales", priority="high")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            await tp.place_and_announce(db, T, ["h1"], actor_id="u-meena")
            at_once = sorted(s["to"] for s in SENT)
            SENT.clear()
            await tp.warn_unpicked(db, T, datetime.now(timezone.utc) + timedelta(days=1, hours=1))
            day1 = sorted(s["to"] for s in SENT)
            SENT.clear()
            await tp.warn_unpicked(db, T, datetime.now(timezone.utc) + timedelta(days=2, hours=1))
            day2 = sorted(s["to"] for s in SENT)
        return at_once, day1, day2, await db.tasks.find_one({"id": "h1"}, {"_id": 0})
    at_once, day1, day2, row = with_test_db(scenario)
    assert at_once == ["u-anil", "u-priya"], "the team leads at once — not the whole team, not the owner"
    assert day1 == ["u-ravi"] and day2 == ["u-meena"]
    assert row["pickup_level"] == 4


def test_any_manager_in_the_team_sees_and_assigns_its_queue_the_rest_do_not(with_test_db):
    async def scenario(db):
        import routers.tasks as tasks_router
        from models.tasks import TaskReassignInput
        await _deep_sales(db)
        await _task(db, "q1", "Quote Kumar Exports", "sales", pickup_route="queue", pickup_since=_ago(1),
                    pickup_level=2, created_by="u-meena")
        with e2e_env(db, stubs=STUBS, keep=KEEP):
            lead = await tasks_router.tasks_needing_a_person(user=PRIYA)
            entry = await tasks_router.tasks_needing_a_person(user={"id": "u-esha", "tenant_id": T, "role": "sales",
                                                                     "name": "Esha Pillai"})
            await tasks_router.reassign_task("q1", TaskReassignInput(assignee_id="u-esha"), user=PRIYA)
        return lead, entry, await db.tasks.find_one({"id": "q1"}, {"_id": 0})
    lead, entry, row = with_test_db(scenario)
    assert lead["scope"] == "team" and [r["id"] for r in lead["rows"]] == ["q1"], "a team lead is asked, so sees it"
    assert entry["scope"] == "none"
    assert row["assignee_id"] == "u-esha"


def test_someone_at_the_top_of_a_chain_that_never_reaches_the_owner_still_counts(with_test_db):
    """Ops: Lata reports to Kiran, and Kiran's own 'Reports to' was never set.
    Kiran manages someone, so he is Ops's manager (level 1)."""
    async def scenario(db):
        from services import task_pickup as tp
        await _seed(db)
        await db.users.update_one({"id": "u-lata"}, {"$set": {"reporting_manager_id": "u-kiran"}})
        c = await tp.company(db, T)
        return [[p["id"] for p in step] for step in c.ladder("ops")], tp.route(c, "ops", "high")
    ladder, high = with_test_db(scenario)
    assert ladder == [["u-kiran"]] and high == {"route": "manager", "why": ""}


# ═══════════════════ 10 · Finance's own follow-ups join the queue ═══════════
def _overdue_invoice():
    return {"id": "inv-1", "tenant_id": T, "type": "sales_invoice", "status": "unpaid", "number": "INV-42",
            "contact_name": "Kapoor Retail", "amount": 48000, "amount_paid": 0, "currency": "INR",
            "due_date": (datetime.now(timezone.utc) - timedelta(days=20)).strftime("%Y-%m-%d")}


def test_a_finance_follow_up_goes_to_the_finance_team_not_whoever_has_fewest_tasks(with_test_db):
    async def scenario(db):
        import services.finance_signals as fs
        await _seed(db)
        # Accounts has two people now: Fatima (reports to Meena) and Ganesh (reports to Fatima).
        await db.users.insert_one({"id": "u-ganesh", "tenant_id": T, "role": "accounts", "name": "Ganesh Rao",
                                   "reporting_manager_id": "u-fatima", "email": "g@t.test"})
        await db.memberships.insert_one({"id": "m-g", "tenant_id": T, "user_id": "u-ganesh", "status": "active"})
        await db.invoices.insert_one(_overdue_invoice())
        with e2e_env(db, stubs={**STUBS, "services.finance_signals.db": db}, keep=KEEP):
            await fs.run_finance_actions(T)
        return await db.tasks.find_one({"tenant_id": T, "source": "finance"}, {"_id": 0})
    t = with_test_db(scenario)
    assert t["title"].startswith("Chase Kapoor Retail") and t["assignee_id"] is None
    assert (t["assignee_role"], t["pickup_route"], t["pickup_level"]) == ("accounts", "manager", 2), \
        "a chase is high priority: Fatima, Accounts' manager, is asked at once"
    asks = _to("u-fatima", "needs_person")
    assert len(asks) == 1 and "Chase Kapoor Retail" in asks[0]["msg"]
    assert not _to("u-ganesh") and not _to("u-meena")


def test_a_finance_team_of_one_gets_the_follow_up_and_no_team_asks_the_owner(with_test_db):
    async def scenario(db):
        import services.finance_signals as fs
        await _seed(db)
        await db.invoices.insert_one(_overdue_invoice())
        with e2e_env(db, stubs={**STUBS, "services.finance_signals.db": db}, keep=KEEP):
            await fs.run_finance_actions(T)
            one = await db.tasks.find_one({"tenant_id": T, "source": "finance"}, {"_id": 0})
            # A company with no Finance / Accounts team at all
            await db.tasks.delete_many({})
            await db.invoices.update_one({"id": "inv-1"}, {"$unset": {"action_task_id": ""}})
            await db.tenants.update_one({"id": T}, {"$set": {"roles": [{"key": "sales", "label": "Sales"}]}})
            SENT.clear()
            await fs.run_finance_actions(T)
            none = await db.tasks.find_one({"tenant_id": T, "source": "finance"}, {"_id": 0})
        return one, none, list(SENT)
    one, none, sent = with_test_db(scenario)
    assert (one["assignee_id"], one["assignee_how"]) == ("u-fatima", "only_member")
    assert (none["assignee_id"], none["assignee_role"], none["pickup_route"], none["pickup_why"]) == \
        (None, None, "owner", "no_team")
    assert [s["to"] for s in sent] == ["u-meena"], "no Finance team: the owner is asked"

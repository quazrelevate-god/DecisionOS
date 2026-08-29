"""Epic 10 Testing -- Sprint 6 (team scale: 1 / 10 / 20 / 30 + parallel).

db-tier: provision teams of increasing size in an isolated Mongo db and assert the
product holds -- no divide-by-zero at N=1, the seat cap enforces (atomically), and
per-member data stays isolated at scale.
"""
import asyncio

from fastapi import HTTPException


def _use_db(testdb, *mods):
    saved = [(m, m.db) for m in mods if hasattr(m, "db")]
    for m, _ in saved:
        m.db = testdb
    return lambda: [setattr(m, "db", d) for m, d in saved]


def _u(role, uid, tid="t1", **over):
    u = {"role": role, "tenant_id": tid, "id": uid, "name": f"{role}-{uid}"}
    u.update(over)
    return u


# ---------------------------------------------------------------------------
# T10-06.1 -- solo owner (1 user): everything renders, no divide-by-zero.
# ---------------------------------------------------------------------------
def test_solo_owner_operating_score_no_crash(with_test_db):
    import routers.operating_score as osr
    import services.operating_score as oss

    async def scenario(db):
        restore = _use_db(db, osr, oss)
        try:
            tid = "t1"
            await db.users.insert_one({"id": "o1", "tenant_id": tid, "role": "owner", "name": "Solo"})
            owner = _u("owner", "o1")
            company = await osr.operating_score(user_id=None, user=owner)   # owner -> company view
            self_view = await osr.operating_score(user_id=None, user=_u("sales", "s0"))  # a lone non-owner
            return (company["view"], "company" in company, "my_snapshot" in company,
                    self_view["view"])
        finally:
            restore()

    view, has_company, has_snapshot, self_view = with_test_db(scenario)
    assert view == "owner" and has_company and has_snapshot, "solo owner gets a full company view"
    assert self_view == "self", "a lone contributor still gets a self view (no empty-team crash)"


# ---------------------------------------------------------------------------
# T10-06.2 -- 10-member team on starter: the 11th seat is refused (402).
# ---------------------------------------------------------------------------
def test_starter_seat_cap_blocks_eleventh(with_test_db):
    from services.plans import reserve_seat

    async def scenario(db):
        tid = "t1"
        await db.tenants.insert_one({"id": tid, "plan": "starter"})   # starter = 10 seats
        # owner + 8 members already active -> 9 seats used, 1 free
        await db.memberships.insert_many([
            {"tenant_id": tid, "user_id": f"u{i}", "status": "active"} for i in range(9)])

        tenth = eleventh = None
        try:
            await reserve_seat(db, tid); tenth = "ok"           # 10th seat -> fits
        except HTTPException as e:
            tenth = e.status_code
        try:
            await reserve_seat(db, tid); eleventh = "ok"        # 11th -> refused
        except HTTPException as e:
            eleventh = e.status_code
        used = (await db.tenants.find_one({"id": tid}, {"_id": 0, "seats_used": 1}))["seats_used"]
        return tenth, eleventh, used

    tenth, eleventh, used = with_test_db(scenario)
    assert tenth == "ok", "the 10th seat fits under a starter cap of 10"
    assert eleventh == 402, "the 11th seat is refused with seat_limit_reached"
    assert used == 10, "the cap counts active memberships including the owner"


# ---------------------------------------------------------------------------
# T10-06.6 -- seat-limit race at the cap: BUG-12 fix holds at scale (cap 10).
# ---------------------------------------------------------------------------
def test_seat_race_at_cap_admits_exactly_free_seats(with_test_db):
    from services.plans import reserve_seat

    async def scenario(db):
        tid = "t1"
        await db.tenants.insert_one({"id": tid, "plan": "starter"})   # cap 10
        await db.memberships.insert_many([
            {"tenant_id": tid, "user_id": f"u{i}", "status": "active"} for i in range(8)])  # 2 free

        async def reserve():
            try:
                await reserve_seat(db, tid)
                return True
            except HTTPException:
                return False

        # 6 invites race for the 2 remaining seats
        admitted = sum(await asyncio.gather(*[reserve() for _ in range(6)]))
        used = (await db.tenants.find_one({"id": tid}, {"_id": 0, "seats_used": 1}))["seats_used"]
        return admitted, used

    admitted, used = with_test_db(scenario)
    assert admitted == 2, "exactly the 2 free seats are admitted from 6 racing invites"
    assert used == 10, "seats_used lands exactly at the cap, never over-provisions"


# ---------------------------------------------------------------------------
# T10-06.4 + T10-06.7 -- operating score at 30 members: per-employee list holds,
# owner sees the whole roster, a member sees only their own scoped view.
# ---------------------------------------------------------------------------
def test_operating_score_at_thirty_members_scoped(with_test_db):
    import routers.operating_score as osr
    import services.operating_score as oss

    async def scenario(db):
        restore = _use_db(db, osr, oss)
        try:
            tid = "t1"
            roles = ["sales", "operations", "finance"]
            members = [{"id": f"m{i}", "tenant_id": tid, "role": roles[i % 3], "name": f"M{i}"}
                       for i in range(30)]
            await db.users.insert_many([{"id": "o1", "tenant_id": tid, "role": "owner", "name": "Boss"}]
                                       + members)
            # a couple of tasks each so _score_employees has real work to roll up
            await db.tasks.insert_many([
                {"id": f"t{i}", "tenant_id": tid, "assignee_id": f"m{i}", "status": "done"}
                for i in range(30)])

            owner = _u("owner", "o1")
            company = await osr.operating_score(user_id=None, user=owner)
            employees = company["employees"]

            # a member views their OWN page -> self view, not the company roster
            m5 = {"id": "m5", "tenant_id": tid, "role": "sales", "name": "M5"}
            self_view = await osr.operating_score(user_id=None, user=m5)
            # owner viewing m5 -> that member's self view (view-as), scoped to m5
            as_m5 = await osr.operating_score(user_id="m5", user=owner)
            return len(employees), self_view["view"], "employees" not in self_view, \
                as_m5.get("view_as", {}).get("id")
        finally:
            restore()

    n_emp, self_view, self_scoped, viewas_id = with_test_db(scenario)
    assert n_emp == 31, "the roster holds the whole team at scale (owner + 30 members)"
    assert self_view == "self", "a member gets their own view, not the company roster"
    assert self_scoped, "a member's self view does NOT expose the whole-team employee list"
    assert viewas_id == "m5", "owner view-as is scoped to the target member"


# ---------------------------------------------------------------------------
# T10-06.5 -- 30 members working in parallel: no lost writes.
# ---------------------------------------------------------------------------
def test_thirty_parallel_task_creates_no_lost_writes(with_test_db):
    async def scenario(db):
        tid = "t1"
        # 30 concurrent task inserts (distinct ids) -- every write must land.
        await asyncio.gather(*[
            db.tasks.insert_one({"id": f"p{i}", "tenant_id": tid, "assignee_id": f"m{i % 30}",
                                 "title": f"Task {i}", "status": "todo"})
            for i in range(30)])
        total = await db.tasks.count_documents({"tenant_id": tid})
        distinct = len(set(t["id"] for t in await db.tasks.find({"tenant_id": tid}, {"_id": 0, "id": 1}).to_list(100)))
        return total, distinct

    total, distinct = with_test_db(scenario)
    assert total == 30 and distinct == 30, "all 30 concurrent writes landed with no loss or collision"


# ---------------------------------------------------------------------------
# T10-06.3 -- business plan: seats are unlimited, 20 members provision freely.
# ---------------------------------------------------------------------------
def test_business_plan_seats_are_unlimited(with_test_db):
    from services.plans import reserve_seat

    async def scenario(db):
        tid = "t1"
        await db.tenants.insert_one({"id": tid, "plan": "business"})   # unlimited seats
        refused = 0
        for _ in range(20):
            try:
                await reserve_seat(db, tid)
            except HTTPException:
                refused += 1
        tenant = await db.tenants.find_one({"id": tid}, {"_id": 0})
        return refused, tenant.get("seats_used")

    refused, seats_used = with_test_db(scenario)
    assert refused == 0, "an unlimited plan never refuses a seat, even at 20 members"
    assert seats_used is None, "unlimited plans don't materialise a seat counter to enforce against"


# ---------------------------------------------------------------------------
# T10-06.10 -- deprovision at scale: no orphaned tasks + the last owner is guarded.
# ---------------------------------------------------------------------------
def test_deprovision_at_scale_no_orphans_and_last_owner_guard(with_test_db):
    from services.deprovisioning import deprovision_user
    from services.auth.membership import create_membership, STATUS_ACTIVE

    async def scenario(db):
        tid = "t1"
        await db.tenants.insert_one({"id": tid, "plan": "business"})
        # two owners + 30 members, each owning a task
        await create_membership(db, user_id="o1", tenant_id=tid, role="owner", status=STATUS_ACTIVE)
        await create_membership(db, user_id="o2", tenant_id=tid, role="owner", status=STATUS_ACTIVE)
        for i in range(30):
            uid = f"m{i}"
            await create_membership(db, user_id=uid, tenant_id=tid, role="sales", status=STATUS_ACTIVE)
            await db.tasks.insert_one({"id": f"t{i}", "tenant_id": tid, "assignee_id": uid,
                                       "title": f"Task {i}", "status": "todo"})

        # deprovision one member, reassigning their task to another member -> no orphan
        rep = await deprovision_user(db, target_user_id="m0", tenant_id=tid,
                                     actor_user_id="o1", reassign_to_user_id="m1")

        # every task in the tenant still points at a live member (no null assignee)
        orphans = await db.tasks.count_documents({"tenant_id": tid, "assignee_id": None})
        m0_still_active = await db.memberships.count_documents(
            {"tenant_id": tid, "user_id": "m0", "status": "active"})

        # last-owner guard: remove o2, then deprovisioning the sole remaining owner is refused
        await deprovision_user(db, target_user_id="o2", tenant_id=tid, actor_user_id="o1")
        guard = await deprovision_user(db, target_user_id="o1", tenant_id=tid, actor_user_id="o1")
        o1_still_active = await db.memberships.count_documents(
            {"tenant_id": tid, "user_id": "o1", "status": "active"})
        return (rep["ok"], rep["membership_removed"], rep["tasks_reassigned"],
                orphans, m0_still_active, guard["ok"], o1_still_active)

    ok, removed, reassigned, orphans, m0_active, guard_ok, o1_active = with_test_db(scenario)
    assert ok and removed and reassigned == 1, "the member is off-boarded and their task is reassigned"
    assert orphans == 0, "no task is left orphaned (null assignee) after deprovision at scale"
    assert m0_active == 0, "the deprovisioned member no longer holds an active membership"
    assert guard_ok is False, "the last owner cannot be deprovisioned"
    assert o1_active == 1, "the guarded last owner stays active"


# ---------------------------------------------------------------------------
# T10-06.8 -- quota walls hold under load: usage near the cap pre-blocks the
# call that would tip a starter tenant over its monthly LLM-token quota, and
# the brain-doc count wall enforces independently.
# ---------------------------------------------------------------------------
def test_quota_walls_pre_block_at_the_cap(with_test_db):
    from services.quotas import check_quota
    from datetime import datetime, timezone

    async def scenario(db):
        tid = "t1"
        await db.tenants.insert_one({"id": tid, "plan": "starter"})  # llm cap 2M, brain_docs cap 200
        now = datetime.now(timezone.utc).isoformat()
        # spread this month's LLM usage across 100 events summing to 1,999,000 tokens
        await db.usage_events.insert_many([
            {"tenant_id": tid, "created_at": now, "tokens_total": 19_990} for _ in range(100)])

        # a call that would tip us over (1,999,000 + 2,000 = 2,001,000 > 2,000,000) is pre-blocked
        over_ok, _ = await check_quota(db, tid, "llm_tokens_total", cost=2_000)
        # a call that stays under the cap passes
        under_ok, _ = await check_quota(db, tid, "llm_tokens_total", cost=500)

        # storage wall (BUG-14: this path summed uploads via an un-awaited
        # aggregate and silently failed open). Seed files near the 5 GB cap.
        gb = 1024 * 1024 * 1024
        await db.files.insert_many([
            {"id": f"f{i}", "tenant_id": tid, "size": gb} for i in range(4)])  # 4 GB used
        store_over_ok, _ = await check_quota(db, tid, "storage_bytes", cost=2 * gb)  # ->6 GB > 5 GB
        store_under_ok, _ = await check_quota(db, tid, "storage_bytes", cost=512 * 1024 * 1024)

        # brain-doc wall: exactly at cap (200 docs) -> the 201st is blocked
        await db.brain_documents.insert_many([
            {"id": f"d{i}", "tenant_id": tid, "is_deleted": False} for i in range(200)])
        doc_ok, doc_detail = await check_quota(db, tid, "brain_docs", cost=1)
        return (over_ok, under_ok, store_over_ok, store_under_ok, doc_ok, doc_detail["over"])

    over_ok, under_ok, store_over_ok, store_under_ok, doc_ok, doc_over = with_test_db(scenario)
    assert over_ok is False, "an LLM call that would exceed the monthly token cap is pre-blocked"
    assert under_ok is True, "a call that stays under the cap is allowed even near the wall"
    assert store_over_ok is False, "an upload that would exceed the storage cap is pre-blocked (BUG-14)"
    assert store_under_ok is True, "an upload that stays under the storage cap is allowed"
    assert doc_ok is False and doc_over, "the brain-doc quota wall blocks the 201st doc on a 200 cap"

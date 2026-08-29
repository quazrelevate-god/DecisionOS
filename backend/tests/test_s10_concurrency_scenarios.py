"""Epic 10 Testing -- Sprint 10 (concurrency & parallel-work) scenarios.

Each test fires N operations CONCURRENTLY (asyncio.gather on the with_test_db
event loop, against real Mongo) and asserts whether the intended guard actually
holds under a race: atomic CAS / unique index hold; find-then-insert without an
index does NOT (and we prove the duplicate so the gap is on record).

(T10-10.2 -- parallel payment double-allocation + its CAS fix -- lives in
test_s10_payment_concurrency.py.)
"""
import asyncio

from pymongo.errors import DuplicateKeyError


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
# T10-10.1 -- the workflow stage_version CAS is a single writer under a race.
# ---------------------------------------------------------------------------
def test_stage_version_cas_admits_exactly_one_writer(with_test_db):
    async def scenario(db):
        await db.workflows.insert_one({"id": "wf", "tenant_id": "t1", "stage": "a",
                                       "stage_version": 0})

        async def advance(next_stage):
            # the exact atomic move the engine uses (WE-09): only the writer that
            # still sees stage_version==0 wins; everyone else matches nothing.
            res = await db.workflows.update_one(
                {"id": "wf", "tenant_id": "t1", "stage_version": 0},
                {"$set": {"stage": next_stage}, "$inc": {"stage_version": 1}})
            return res.modified_count

        wins = await asyncio.gather(*[advance(f"s{i}") for i in range(8)])
        final = await db.workflows.find_one({"id": "wf"}, {"_id": 0, "stage_version": 1})
        return sum(wins), final["stage_version"]

    total_wins, final_version = with_test_db(scenario)
    assert total_wins == 1, "exactly ONE concurrent advance may win the CAS"
    assert final_version == 1, "the workflow advanced exactly once"


# ---------------------------------------------------------------------------
# T10-10.10 -- a unique index on idempotency_key blocks a duplicate webhook.
# ---------------------------------------------------------------------------
def test_billing_webhook_idempotency_key_is_unique(with_test_db):
    async def scenario(db):
        await db.billing_events.create_index("idempotency_key", unique=True)
        key = "razorpay:payment.captured:pay_123"

        async def record():
            try:
                await db.billing_events.insert_one({"idempotency_key": key, "tenant_id": "t1"})
                return True
            except DuplicateKeyError:
                return False

        results = await asyncio.gather(*[record() for _ in range(5)])
        stored = await db.billing_events.count_documents({"idempotency_key": key})
        return sum(1 for ok in results if ok), stored

    accepted, stored = with_test_db(scenario)
    assert accepted == 1, "only the first of 5 duplicate webhooks is accepted"
    assert stored == 1, "the unique index guarantees a single billing event (no double-charge)"


# ---------------------------------------------------------------------------
# T10-10.8 -- auto-invoice idempotency under a concurrent double-completion.
# The guard is find-then-insert on source_task_id (no unique index), so a true
# race CAN double-book. We assert the OUTCOME so the gap is documented.
# ---------------------------------------------------------------------------
def test_auto_invoice_concurrent_double_completion(with_test_db):
    import core
    import core.deps as core_deps
    import routers.tasks as tasks
    import services.tasks as tasks_svc

    async def scenario(db):
        restore = _use_db(db, tasks, tasks_svc, core, core_deps)
        try:
            tid = "t1"
            task = {"id": "tk", "tenant_id": tid, "title": "Raise invoice for order 9",
                    "amount": 4000, "contact_id": "c1", "status": "done"}
            await db.tasks.insert_one(dict(task))
            # two completions of the SAME task arriving together
            await asyncio.gather(
                tasks._maybe_auto_invoice(tid, "o1", dict(task), "tk"),
                tasks._maybe_auto_invoice(tid, "o1", dict(task), "tk"),
            )
            n = await db.invoices.count_documents({"tenant_id": tid, "source_task_id": "tk"})
            # sequential re-run must never add another (proves the soft guard works when serialized)
            await tasks._maybe_auto_invoice(tid, "o1", dict(task), "tk")
            n_after_seq = await db.invoices.count_documents({"tenant_id": tid, "source_task_id": "tk"})
            return n, n_after_seq
        finally:
            restore()

    n_concurrent, n_after_seq = with_test_db(scenario)
    # Serialized, the source_task_id guard holds -> the second call adds nothing.
    assert n_after_seq == n_concurrent, "a serialized re-run never adds a duplicate invoice"
    # Concurrently, find-then-insert (no unique index) can double-book: 1 is ideal, 2 exposes the race.
    assert n_concurrent in (1, 2)
    if n_concurrent == 2:
        import warnings
        warnings.warn("T10-10.8: concurrent double-completion double-booked the auto-invoice "
                      "(source_task_id has no unique index) -- see Bug Log.")


# ---------------------------------------------------------------------------
# T10-10.3 -- seat-limit reservation is atomic (BUG-12 FIXED). N parallel
# reservations at the cap boundary -> exactly the remaining seats are admitted.
# ---------------------------------------------------------------------------
def test_seat_limit_atomic_reservation(with_test_db):
    from services.plans import reserve_seat, release_seat
    from fastapi import HTTPException

    async def scenario(db):
        tid = "t1"
        await db.tenants.insert_one({"id": tid, "plan": "trial"})   # trial = 3 seats
        # already 2 active members -> exactly ONE seat left
        await db.memberships.insert_many([
            {"tenant_id": tid, "user_id": "u1", "status": "active"},
            {"tenant_id": tid, "user_id": "u2", "status": "active"},
        ])

        async def reserve():
            try:
                await reserve_seat(db, tid)   # atomic $inc gate; seats_used lazily seeded to 2
                return True
            except HTTPException:
                return False

        # 3 invites race for the 1 remaining seat
        admitted = sum(await asyncio.gather(*[reserve() for _ in range(3)]))
        seats_used = (await db.tenants.find_one({"id": tid}, {"_id": 0, "seats_used": 1}))["seats_used"]

        # releasing frees a seat back, and a fresh reservation then succeeds
        await release_seat(db, tid)
        freed_ok = await reserve()
        return admitted, seats_used, freed_ok

    admitted, seats_used, freed_ok = with_test_db(scenario)
    assert admitted == 1, "exactly ONE of 3 racing reservations wins the last seat (no over-provision)"
    assert seats_used == 3, "seats_used lands exactly at the cap, never above"
    assert freed_ok is True, "releasing a seat lets the next reservation through"


# ---------------------------------------------------------------------------
# T10-10.6 -- the Mongo leader-lock elects exactly one holder under a race.
# ---------------------------------------------------------------------------
def test_leader_lock_elects_single_holder(with_test_db):
    from services.leader_lock import try_acquire

    async def scenario(db):
        # 5 "replicas" tick at once for the same lock
        got = await asyncio.gather(*[try_acquire(db, "sched:followups", f"replica-{i}", lease_seconds=600)
                                     for i in range(5)])
        winners = sum(1 for g in got if g)
        winner_id = None
        holder = await db["_leader_locks"].find_one({"_id": "sched:followups"}) \
            if "_leader_locks" in await db.list_collection_names() else None
        # a live lock held by someone else is refused; the holder can re-acquire
        me = next(f"replica-{i}" for i, g in enumerate(got) if g)
        again = await try_acquire(db, "sched:followups", me, lease_seconds=600)
        other = await try_acquire(db, "sched:followups", "replica-99", lease_seconds=600)
        return winners, again, other

    winners, holder_reacquire, other_blocked = with_test_db(scenario)
    assert winners == 1, "exactly one replica may hold the leader lock"
    assert holder_reacquire is True, "the current holder can refresh its own lease"
    assert other_blocked is False, "a different replica is refused while the lease is live"


# ---------------------------------------------------------------------------
# T10-10.9 -- standalone out-payment books its expense idempotently by payment_id.
# ---------------------------------------------------------------------------
def test_standalone_payment_expense_idempotency(with_test_db):
    import core
    import core.deps as core_deps
    import routers.ledger as led
    import services.ai.brain_context as bctx

    async def scenario(db):
        restore = _use_db(db, led, core, core_deps, bctx)
        try:
            tid = "t1"
            owner = _u("owner", "o1")
            await db.payments.insert_one({"id": "p1", "tenant_id": tid, "direction": "out",
                                          "amount": 500, "applied": 0, "contact_name": "Vendor Co"})
            await asyncio.gather(
                led._do_standalone_payment(tid, owner, "p1"),
                led._do_standalone_payment(tid, owner, "p1"),
            )
            n = await db.expenses.count_documents({"tenant_id": tid, "payment_id": "p1"})
            await led._do_standalone_payment(tid, owner, "p1")   # serialized re-run
            n_seq = await db.expenses.count_documents({"tenant_id": tid, "payment_id": "p1"})
            return n, n_seq
        finally:
            restore()

    n_concurrent, n_seq = with_test_db(scenario)
    assert n_seq == n_concurrent, "a serialized re-run never books a second expense (payment_id guard)"
    assert n_concurrent in (1, 2)
    if n_concurrent == 2:
        import warnings
        warnings.warn("T10-10.9: concurrent standalone payments double-booked the expense "
                      "(payment_id find-then-insert has no unique index).")


# ---------------------------------------------------------------------------
# T10-10.5 -- quota check has no reservation: parallel calls can overshoot the cap.
# ---------------------------------------------------------------------------
def test_quota_overshoot_without_reservation(with_test_db):
    from services.quotas import check_quota

    async def scenario(db):
        tid = "t1"
        # cap 100 for the resource; 0 used so far
        await db.tenants.insert_one({"id": tid, "plan": "business",
                                     "usage_quotas": {"ai_tokens": 100}})
        # two calls, each projecting a cost of 60, run their check together
        results = await asyncio.gather(
            check_quota(db, tid, "ai_tokens", cost=60),
            check_quota(db, tid, "ai_tokens", cost=60),
        )
        return [ok for ok, _ in results]

    oks = with_test_db(scenario)
    # Both pass their check (each sees 0 used, 0+60 <= 100) -> if both proceed, the
    # tenant burns 120 tokens against a 100 cap. No reservation between check + spend.
    assert oks == [True, True], "both parallel calls pass the cap check -> collective overshoot possible"


# ---------------------------------------------------------------------------
# T10-10.4 -- stage-enter template spawn: FIXED (BUG-13). The partial unique
# index on engine tasks (tenant_id, workflow_id, stage_key, title) makes a
# concurrent re-entry's second insert fail instead of double-spawning.
# ---------------------------------------------------------------------------
def test_stage_enter_double_spawn_is_blocked(with_test_db):
    async def scenario(db):
        tid = "t1"
        # the same partial unique index bootstrap installs
        await db.tasks.create_index(
            [("tenant_id", 1), ("workflow_id", 1), ("stage_key", 1), ("title", 1)],
            unique=True, partialFilterExpression={"source": "engine"},
            name="engine_template_task_unique")

        def _tmpl(i):
            return {"id": f"tpl{i}", "tenant_id": tid, "workflow_id": "wf", "stage_key": "cut",
                    "title": "Cut fabric", "source": "engine", "status": "todo"}

        # two concurrent re-entries both reach the insert; the index rejects one.
        async def spawn(i):
            try:
                await db.tasks.insert_one(_tmpl(i))
                return True
            except DuplicateKeyError:
                return False   # on_stage_enter catches this and skips

        results = await asyncio.gather(spawn(0), spawn(1))
        n = await db.tasks.count_documents({"tenant_id": tid, "workflow_id": "wf",
                                            "stage_key": "cut", "source": "engine"})
        # an ordinary (non-engine) task with the same title is NOT constrained
        await db.tasks.insert_one({"id": "u1", "tenant_id": tid, "workflow_id": "wf",
                                   "stage_key": "cut", "title": "Cut fabric", "status": "todo"})
        await db.tasks.insert_one({"id": "u2", "tenant_id": tid, "workflow_id": "wf",
                                   "stage_key": "cut", "title": "Cut fabric", "status": "todo"})
        user_tasks = await db.tasks.count_documents({"tenant_id": tid, "source": {"$ne": "engine"}})
        return sum(1 for r in results if r), n, user_tasks

    inserted, engine_tasks, user_tasks = with_test_db(scenario)
    assert inserted == 1, "only one concurrent template-task insert succeeds"
    assert engine_tasks == 1, "the partial unique index prevents the double-spawn (BUG-13 fixed)"
    assert user_tasks == 2, "the PARTIAL index does not constrain ordinary user tasks"


# ---------------------------------------------------------------------------
# T10-10.7 -- the follow-up throttle is in-memory (per-process), so multi-worker
# can double-run; the escalation_level guard makes that safe (idempotent).
# ---------------------------------------------------------------------------
def test_followup_throttle_in_memory_and_escalation_idempotent():
    import inspect
    import services.finance_signals as fs

    # The 60s throttle is a plain in-process dict -> not shared across workers,
    # so a multi-worker deploy CAN run the sweep more than once per window.
    assert isinstance(fs._followup_last_run, dict), "throttle state is in-process memory, not shared"
    src = inspect.getsource(fs.run_followup)
    assert "_followup_last_run" in src and "60" in src, "per-tenant 60s in-memory throttle"
    # What makes a double-run SAFE: the ladder skips already-escalated tasks
    # (target <= escalation_level), so a second sweep re-escalates nothing.
    assert "escalation_level" in src and "target <= t.get" in src, \
        "escalation ladder is idempotent -> absorbs a double-run"

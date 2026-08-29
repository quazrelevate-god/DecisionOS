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

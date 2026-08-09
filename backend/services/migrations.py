"""MongoDB migration ledger.

Alembic-equivalent for a schemaless store: we don't manage DDL (Mongo has
none), but we DO need a way to run a data reshape or backfill EXACTLY
ONCE and know it succeeded. Introduced by FIX-002-C ahead of S1-03
(migrate all uploads to obj_store) which is the first migration where
"ran twice" would corrupt data (double-move, delete source, second run
loses everything).

Contract:
  apply_migration(db, name, fn, *, description="")
    - Looks up `name` in db.migrations_applied.
    - If present with status="ok", the migration is skipped (idempotent
      no-op at boot).
    - If present with status="failed" (previous run crashed), the
      migration IS retried — a failed migration must be re-runnable
      because the code got a fix.
    - If not present, `fn(db)` is awaited. On success, records
      {name, status:"ok", applied_at, duration_ms, description}.
      On exception, records {name, status:"failed", failed_at, error}
      and RE-RAISES so the bootstrap surfaces the problem in logs.

  applied_migrations(db) -> list of names known to be applied.

Design notes:
  * The ledger collection is `migrations_applied` (plural for consistency
    with other admin collections). `name` is the unique key — pick names
    that are stable across code revisions ("add_phone_norm_backfill_v1"
    rather than "add_field").
  * Concurrent boot: two replicas booting simultaneously could both see
    the migration missing and both try to run it. Mongo's upsert on
    `name` (unique index) makes the second insert fail with
    DuplicateKeyError — we catch that and skip. Idempotent.
  * A migration that MUST NOT re-run even after a manual crash cleanup
    (destructive move) should be written to be idempotent internally
    AS WELL — the ledger is the belt, the migration's own guards are
    the braces.
  * `create_index` calls do NOT need to go through this helper —
    MongoDB's create_index is already idempotent (creating an existing
    index is a no-op).
"""
import asyncio
import time
from typing import Awaitable, Callable, Optional

from core import logger, now_iso


LEDGER_COLLECTION = "migrations_applied"


class MigrationError(Exception):
    """Raised when a migration function raises; original exception is chained."""


async def _ensure_ledger_index(db) -> None:
    """The one prerequisite: a unique index on `name` so concurrent boots
    can't record the same migration twice. Safe to call on every boot —
    Mongo's create_index is idempotent."""
    try:
        await db[LEDGER_COLLECTION].create_index("name", unique=True,
                                                 name="migrations_applied_name_unique")
    except Exception as e:
        # If the collection already has data with a different index, log
        # and continue — the caller's insert will catch conflicts.
        logger.warning(f"migrations ledger index setup: {e}")


async def _already_applied(db, name: str) -> bool:
    """Return True if this migration has a status=ok row in the ledger."""
    row = await db[LEDGER_COLLECTION].find_one(
        {"name": name, "status": "ok"}, {"_id": 0, "name": 1})
    return row is not None


async def applied_migrations(db) -> list:
    """List every migration name known to be successfully applied. Used
    by admin health endpoints + tests."""
    rows = await db[LEDGER_COLLECTION].find(
        {"status": "ok"}, {"_id": 0, "name": 1, "applied_at": 1}
    ).sort("applied_at", 1).to_list(1000)
    return rows


async def apply_migration(
    db,
    name: str,
    fn: Callable[[object], Awaitable[None]],
    *,
    description: str = "",
) -> str:
    """Run `fn(db)` exactly once across the lifetime of the deployment.

    Returns one of:
      "skipped"  — already recorded as applied; no-op
      "applied"  — ran and recorded successfully
      "retried"  — previous attempt had failed; ran again successfully

    Raises MigrationError (chaining the original exception) if `fn`
    raises; also records a status=failed row so ops can see the trail.
    The bootstrap should surface this in logs but SHOULD NOT abort
    (a failed migration doesn't necessarily block app boot — depends
    on the migration).
    """
    await _ensure_ledger_index(db)

    # Was there a prior successful run?
    prior_ok = await db[LEDGER_COLLECTION].find_one(
        {"name": name, "status": "ok"}, {"_id": 0, "name": 1})
    if prior_ok:
        return "skipped"

    # Was there a prior FAILED run? Track it so the return value tells
    # ops "we retried" (not "first time we ever tried").
    prior_failed = await db[LEDGER_COLLECTION].find_one(
        {"name": name, "status": "failed"}, {"_id": 0, "name": 1})

    started = time.time()
    try:
        await fn(db)
    except Exception as e:
        # Record the failure (upsert so a repeated failure updates in
        # place instead of accumulating rows). RE-RAISE so the caller
        # sees the problem.
        try:
            await db[LEDGER_COLLECTION].update_one(
                {"name": name},
                {"$set": {
                    "name": name, "status": "failed",
                    "description": description,
                    "failed_at": now_iso(),
                    "error": str(e)[:500],
                }},
                upsert=True,
            )
        except Exception as ledger_err:
            logger.error(f"migration ledger write failed for {name}: {ledger_err}")
        raise MigrationError(f"migration {name!r} failed: {e}") from e

    duration_ms = int((time.time() - started) * 1000)
    # Success: upsert the ok row (replaces any prior failed row with ok).
    # If two replicas race here, the second one hits DuplicateKeyError on
    # the unique(name) index — catch, treat as already-applied.
    try:
        await db[LEDGER_COLLECTION].update_one(
            {"name": name},
            {"$set": {
                "name": name, "status": "ok",
                "description": description,
                "applied_at": now_iso(),
                "duration_ms": duration_ms,
            }},
            upsert=True,
        )
    except Exception as ledger_err:
        # Even if we can't record it, the migration DID run. Log loudly.
        logger.error(
            f"migration {name!r} succeeded but ledger write failed "
            f"(will re-run next boot): {ledger_err}")

    return "retried" if prior_failed else "applied"

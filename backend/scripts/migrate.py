"""S5-05 -- pre-deploy schema migration / verification.

DecisionOS applies its schema changes (indexes, additive fields, the
brain_contexts->brain_query_cache rename fix, the none-language text-index
rebuild) IDEMPOTENTLY at every app boot via bootstrap.lifecycle._bootstrap.
This script runs that same bootstrap STANDALONE against MONGO_URL/DB_NAME, so a
deploy pipeline can APPLY + VERIFY the migration as an explicit pre-deploy step
and fail fast if an index build errors -- instead of discovering it on the first
live request.

Idempotent + safe to re-run. See docs/runbooks/MIGRATION_PLAN.md for the policy.

    PYTHONPATH=. .venv/Scripts/python.exe scripts/migrate.py
    # in CD:  python scripts/migrate.py   (gated on tests passing, before deploy)
"""
import asyncio
import sys

from bootstrap.lifecycle import _bootstrap
from core import logger


async def main() -> int:
    logger.info("migrate: applying idempotent schema bootstrap (indexes + additive ensures)...")
    try:
        await _bootstrap()
    except Exception as e:
        logger.error("migrate: FAILED -- %s", e)
        return 1
    logger.info("migrate: OK -- schema is at the current version")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

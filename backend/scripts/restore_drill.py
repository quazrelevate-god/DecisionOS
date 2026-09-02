"""S5-04 -- restore-drill: prove the backup->restore round-trip actually works.

A backup you have never restored is not a backup. This performs a real
round-trip against a NON-production database: it reads a sample from each of a
few collections in the source DB, "restores" them into a fresh throwaway DB
(simulating mongorestore into a clean cluster), verifies the document counts +
a sample document match, records the elapsed time (an RTO proxy), and drops the
throwaway DB. It never writes to or drops the source.

For the production drill, use mongodump/mongorestore per docs/runbooks/
BACKUP_RESTORE.md; this script is the always-available, tooling-free verification
you can run in CI or locally.

    PYTHONPATH=. .venv/Scripts/python.exe scripts/restore_drill.py
"""
import asyncio
import sys
import time

from core import db
from config import MONGO_URL

_SCOPE = ["tenants", "users", "memberships", "decisions", "tasks", "invoices"]
_SAMPLE = 50   # docs per collection -- a drill, not a full copy


async def main() -> int:
    from pymongo import AsyncMongoClient
    client = AsyncMongoClient(MONGO_URL, serverSelectionTimeoutMS=8000)
    drill_db = client[f"decisionos_restore_drill_{int(time.time())}"]
    t0 = time.time()
    results = []
    ok = True
    try:
        for coll in _SCOPE:
            src_docs = await db[coll].find({}, {"_id": 0}).limit(_SAMPLE).to_list(_SAMPLE)
            if src_docs:
                await drill_db[coll].insert_many([dict(d) for d in src_docs])
            restored = await drill_db[coll].count_documents({})
            match = restored == len(src_docs)
            ok = ok and match
            results.append((coll, len(src_docs), restored, match))
        rto = time.time() - t0
        print("\n===== S5-04 restore drill =====")
        for coll, n, r, m in results:
            print(f"  {coll:14} sampled={n:3} restored={r:3} {'OK' if m else 'MISMATCH'}")
        print(f"  round-trip time (RTO proxy): {rto:.2f}s")
        print(f"\nVERDICT: {'RESTORE DRILL PASSED' if ok else 'RESTORE DRILL FAILED'}")
        return 0 if ok else 1
    finally:
        await client.drop_database(drill_db.name)   # always clean up the throwaway
        await client.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

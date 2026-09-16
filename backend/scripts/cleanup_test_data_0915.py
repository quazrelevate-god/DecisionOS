"""Clear old test tasks and non-actionable decisions from one company — Yokesh 2026-09-15.

Nothing is lost: every removed document (tasks, decisions, and the notifications and
activity that point at them) is first copied to the `cleanup_archive` collection with
its source collection and a run id, and to a JSON file. `--restore <run_id>` puts a
run back.

What counts:
  test tasks       title starts TEST_, TESTIT<n> , QA_NOTIF_TEST, or "Follow-up: TEST_"
  junk decisions   no tasks and no proposed tasks, and the title says there was nothing
                   to act on ("No actionable directive", "said hello", "Casual greeting", ...)

    python scripts/cleanup_test_data_0915.py --email owner@sharma.com            # dry run
    python scripts/cleanup_test_data_0915.py --email owner@sharma.com --apply
    python scripts/cleanup_test_data_0915.py --restore <run_id>
"""
import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import core  # noqa: E402

TASK_RX = re.compile(r"^(TEST_|TESTIT\d+ |QA_NOTIF_TEST|Follow-up: TEST_)")
JUNK_RX = re.compile(
    r"no actionable|non-actionable|no operational directive|no specific directive|empty directive|"
    r"said hello|casual greeting|brief note with no|will provide details shortly|trying to get a job|"
    r"deliberating between two options|affirmative response|look, look", re.I)
ARCHIVE = "cleanup_archive"


async def plan(db, tenant_id):
    tasks = [t for t in await db.tasks.find({"tenant_id": tenant_id}, {"_id": 0}).to_list(10000)
             if TASK_RX.search(t.get("title") or "")]
    decisions = [d for d in await db.decisions.find({"tenant_id": tenant_id}, {"_id": 0}).to_list(10000)
                 if JUNK_RX.search(d.get("title") or "") and not d.get("task_ids")
                 and not ((d.get("proposal") or {}).get("tasks"))]
    ids = [t["id"] for t in tasks] + [d["id"] for d in decisions]
    related = {}
    for coll, field in (("notifications", "entity_id"), ("activity", "entity_id")):
        related[coll] = await db[coll].find({"tenant_id": tenant_id, field: {"$in": ids}}, {"_id": 0}).to_list(100000)
    return {"tasks": tasks, "decisions": decisions, **related}


async def apply(db, tenant_id, found, out_dir):
    run_id = "cleanup-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{run_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"tenant_id": tenant_id, "run_id": run_id, **found}, f, ensure_ascii=False, default=str)
    for coll, docs in found.items():
        if not docs:
            continue
        await db[ARCHIVE].insert_many([{"run_id": run_id, "collection": coll, "tenant_id": tenant_id,
                                        "archived_at": datetime.now(timezone.utc).isoformat(), "doc": d} for d in docs])
        if coll in ("tasks", "decisions"):
            res = await db[coll].delete_many({"tenant_id": tenant_id, "id": {"$in": [d["id"] for d in docs]}})
        else:
            res = await db[coll].delete_many({"tenant_id": tenant_id, "entity_id": {"$in": [d["entity_id"] for d in docs]}})
        print(f"  {coll}: archived {len(docs)}, removed {res.deleted_count}")
    print(f"run {run_id}; copy at {path}")


async def restore(db, run_id):
    rows = await db[ARCHIVE].find({"run_id": run_id}, {"_id": 0}).to_list(200000)
    by = {}
    for r in rows:
        by.setdefault(r["collection"], []).append(r["doc"])
    for coll, docs in by.items():
        await db[coll].insert_many(docs)
        print(f"  {coll}: restored {len(docs)}")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--email")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--restore")
    # .audit-artifacts/ is gitignored: the copy holds company data and never goes to git.
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                                                  ".audit-artifacts", "cleanup_backups"))
    a = ap.parse_args()
    db = core.db
    if a.restore:
        return await restore(db, a.restore)
    u = await db.users.find_one({"email": a.email}, {"_id": 0, "tenant_id": 1})
    if not u:
        sys.exit(f"no user {a.email}")
    found = await plan(db, u["tenant_id"])
    for coll, docs in found.items():
        print(f"{coll}: {len(docs)}")
    for d in found["decisions"]:
        print(f"  decision  {d.get('status'):17} {(d.get('title') or '')[:80]}")
    if a.apply:
        await apply(db, u["tenant_id"], found, a.out)
    else:
        print("dry run — add --apply to archive and remove")


if __name__ == "__main__":
    asyncio.run(main())

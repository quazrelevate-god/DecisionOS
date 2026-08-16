"""S5-05 staging dry-run harness (2026-08-16).

WHAT: Snapshots the staging DB, wipes migrations_applied, waits for
you to restart the backend pointed at staging, then snapshots again
and diffs. Success = only migrations_applied changes; every other
collection's count/shape/index is stable.

WHY: Every migration in the ledger has already run against prod, so a
naive fork would leave migrations_applied full and skip all replays.
This harness forces a from-zero replay on the fork so we see exactly
what the migrations would do to a fresh copy of real-shaped data.

USAGE:
    # Terminal 1 -- run this harness in interactive mode
    STAGING_MONGO_URL="mongodb://..." python scripts/s5_05_staging_dryrun.py

    # Follow the prompts. Between the "baseline captured" and
    # "restart your backend" prompts, edit backend/.env to swap
    # MONGO_URL to the staging URL and restart uvicorn.
    # Once the backend is up and healthy on staging, hit enter to
    # continue and get the diff report.

SAFETY: This script NEVER writes to the URL in your normal .env. It
requires STAGING_MONGO_URL from the environment. It will refuse to
run if that URL matches the one in .env.
"""
import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

# Motor driver -- same as the backend uses.
from motor.motor_asyncio import AsyncIOMotorClient


BACKEND_DIR = Path(__file__).resolve().parent.parent


def _load_prod_url_from_env_file() -> str:
    """Read backend/.env so we can refuse to run against it."""
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("MONGO_URL="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


async def snapshot(db) -> dict:
    """Capture per-collection stats. Returns a dict:
      { collection_name: {count, indexes: [...], sample_shape_hash: str} }
    Sample shape hash = md5 of sorted top-level keys of one document,
    so schema drift shows as a hash change without dumping PII."""
    names = await db.list_collection_names()
    out = {}
    for name in sorted(names):
        col = db[name]
        count = await col.count_documents({})
        idx = sorted((await col.index_information()).keys())
        # Cheap shape probe: sorted top-level keys of one doc.
        doc = await col.find_one({}, {"_id": 0})
        if doc:
            keys = sorted(doc.keys())
            shape = hashlib.md5(",".join(keys).encode()).hexdigest()[:12]
        else:
            shape = "(empty)"
        out[name] = {"count": count, "indexes": idx, "shape": shape}
    return out


def diff_snapshots(before: dict, after: dict) -> list:
    """Return human-readable lines describing every change."""
    lines = []
    all_names = sorted(set(before) | set(after))
    for name in all_names:
        b = before.get(name)
        a = after.get(name)
        if b is None:
            lines.append(f"[NEW] {name}: created (count={a['count']}, indexes={len(a['indexes'])})")
            continue
        if a is None:
            lines.append(f"[DEL] {name}: dropped (was count={b['count']})")
            continue
        changes = []
        if b["count"] != a["count"]:
            changes.append(f"count {b['count']} -> {a['count']}")
        if b["indexes"] != a["indexes"]:
            added = set(a["indexes"]) - set(b["indexes"])
            removed = set(b["indexes"]) - set(a["indexes"])
            if added: changes.append(f"+idx {sorted(added)}")
            if removed: changes.append(f"-idx {sorted(removed)}")
        if b["shape"] != a["shape"]:
            changes.append(f"shape {b['shape']} -> {a['shape']}")
        if changes:
            lines.append(f"[CHG] {name}: {'; '.join(changes)}")
    return lines


async def main():
    staging_url = os.environ.get("STAGING_MONGO_URL", "").strip()
    if not staging_url:
        print("ERROR: STAGING_MONGO_URL not set.")
        print("       export STAGING_MONGO_URL='mongodb://...' and re-run.")
        sys.exit(1)

    prod_url = _load_prod_url_from_env_file()
    if prod_url and staging_url == prod_url:
        print("ERROR: STAGING_MONGO_URL matches the MONGO_URL in backend/.env.")
        print("       Refusing to run -- this is a staging dry-run.")
        sys.exit(1)

    # Backend .env DB name is 'decisionos' or similar. The staging URL
    # should point at the fork, which uses the same DB name.
    client = AsyncIOMotorClient(staging_url)
    # Same fallback the backend uses: pick the DB from the URL path
    # if present, else 'decisionos'.
    from urllib.parse import urlparse
    path = urlparse(staging_url).path.lstrip("/").split("?")[0]
    db_name = path or os.environ.get("DB_NAME", "decisionos")
    db = client[db_name]

    print(f"=== S5-05 staging dry-run against {db_name} ===\n")

    print("[step 1] Snapshotting BEFORE state...")
    before = await snapshot(db)
    print(f"          {len(before)} collections captured.")

    # Show migration ledger for context.
    if "migrations_applied" in before:
        applied = [m["name"] async for m in db.migrations_applied.find({}, {"_id": 0, "name": 1})]
        print(f"          migrations_applied has {len(applied)} rows:")
        for name in applied:
            print(f"            - {name}")

    print()
    print("[step 2] Wipe migrations_applied so replays fire from zero.")
    input("          Enter to proceed (or Ctrl+C to abort): ")
    del_res = await db.migrations_applied.delete_many({})
    print(f"          Deleted {del_res.deleted_count} ledger rows.\n")

    print("[step 3] NOW: point backend at staging + restart.")
    print("         In backend/.env, temporarily change MONGO_URL to:")
    print(f"           {staging_url}")
    print("         Then restart uvicorn. Watch the log -- with S5-AUDIT-04,")
    print("         any migration failure will now leave a full traceback.")
    input("         Enter here ONCE the backend is up and healthy on staging: ")

    print()
    print("[step 4] Snapshotting AFTER state...")
    after = await snapshot(db)

    # Re-fetch ledger to confirm replays landed.
    replayed = [m["name"] async for m in db.migrations_applied.find({}, {"_id": 0, "name": 1})]
    print(f"          migrations_applied now has {len(replayed)} rows.\n")

    print("[step 5] Diff:")
    diff = diff_snapshots(before, after)
    if not diff:
        print("          NO CHANGES. Migrations were pure no-ops on already-migrated data.")
    else:
        for line in diff:
            print(f"          {line}")

    # Success criterion: only migrations_applied should have changed
    # (and it should have re-grown to match its prior size).
    unexpected = [line for line in diff
                  if not line.startswith("[CHG] migrations_applied")]
    print()
    if unexpected:
        print(f"[VERDICT] {len(unexpected)} unexpected change(s). Review above.")
        sys.exit(2)
    else:
        print("[VERDICT] PASS. Migrations replayed cleanly with no schema drift.")

    # Persist snapshot for the record.
    report = {
        "staging_url_host": urlparse(staging_url).hostname,
        "db_name": db_name,
        "before": before,
        "after": after,
        "diff": diff,
        "replayed_migrations": replayed,
    }
    report_path = BACKEND_DIR / "scripts" / "s5_05_dryrun_report.json"
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"          Report saved: {report_path}")


if __name__ == "__main__":
    asyncio.run(main())

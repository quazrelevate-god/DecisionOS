"""Snapshot the live DecisionOS MongoDB (plus its uploads folder) into another database.

Why: the live database is on Emergent's Atlas cluster, which only accepts
connections from Emergent. This script runs inside Emergent, copies everything
into a snapshot database on a server the migration machine can reach (Railway),
and the snapshot becomes the source for migrate_main_to_karma.py (plan /
rehearse / execute).

The live database is only ever read. The snapshot keeps every document's
original _id, stores the uploads folder in a GridFS bucket, and records counts
and index definitions in `_snapshot_meta`.

COMMANDS
    copy           live DB (+ uploads dir) -> snapshot DB. Run inside Emergent:
                     cd /app/backend
                     python scripts/snapshot_live.py copy \
                         --target-url '<railway mongo url>' --target-db decisionos_live_snapshot \
                         --uploads-dir /app/backend/uploads
                   The source defaults to MONGO_URL / DB_NAME from backend/.env
                   (override with --source-url / --source-db).
    fetch-uploads  snapshot's uploads bucket -> a local folder (for --uploads-dir):
                     python scripts/snapshot_live.py fetch-uploads \
                         --target-url '<railway mongo url>' --target-db decisionos_live_snapshot --out ./prod_uploads

EXIT CODES
    0 ok | 1 fatal/config error | 3 snapshot counts do not match the source |
    4 ok, but the live DB changed while copying (take the cutover snapshot during a write freeze)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from gridfs import AsyncGridFSBucket
from pymongo import AsyncMongoClient, ReplaceOne
from pymongo.errors import BulkWriteError, PyMongoError

BACKEND_DIR = Path(__file__).resolve().parent.parent
META_COLL = "_snapshot_meta"
UPLOADS_BUCKET = "_snapshot_uploads"
EXIT_OK, EXIT_FATAL, EXIT_MISMATCH, EXIT_DRIFT = 0, 1, 3, 4


class Fatal(Exception):
    pass


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def mask_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        if parts.password:
            return url.replace(":" + parts.password + "@", ":***@", 1)
    except ValueError:
        pass
    return url


def url_hosts(url: str) -> set[str]:
    netloc = url.split("://", 1)[-1].split("/", 1)[0].rsplit("@", 1)[-1]
    return {h.strip().lower() for h in netloc.split(",") if h.strip()}


def env_file_value(key: str) -> str | None:
    env = BACKEND_DIR / ".env"
    if not env.exists():
        return None
    try:
        from dotenv import dotenv_values
    except ImportError:
        return None
    return dotenv_values(env).get(key)


async def real_collections(db) -> list[str]:
    names = []
    cursor = await db.list_collections()
    async for info in cursor:
        if info.get("type", "collection") == "collection" and not info["name"].startswith("system."):
            names.append(info["name"])
    return sorted(names)


# =============================================================================
# copy
# =============================================================================
async def copy_collection(src_db, dst_db, name: str, batch_size: int) -> int:
    written = 0
    batch: list[dict] = []

    async def flush() -> None:
        nonlocal written
        if not batch:
            return
        try:
            await dst_db[name].bulk_write([ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in batch], ordered=False)
        except BulkWriteError as e:
            raise Fatal(f"{name}: write failed: {e.details.get('writeErrors', [])[:3]}") from e
        written += len(batch)
        batch.clear()

    async for doc in src_db[name].find({}, sort=[("_id", 1)], batch_size=batch_size):
        batch.append(doc)
        if len(batch) >= batch_size:
            await flush()
    await flush()
    return written


async def copy_uploads(dst_db, uploads_dir: Path) -> dict:
    """Store every top-level file of uploads_dir in the snapshot's GridFS bucket.
    Re-runs skip files already stored with the same sha256."""
    bucket = AsyncGridFSBucket(dst_db, bucket_name=UPLOADS_BUCKET)
    stored = {}
    async for f in dst_db[f"{UPLOADS_BUCKET}.files"].find({}, {"filename": 1, "metadata": 1}):
        stored[f["filename"]] = f
    files = sorted(p for p in uploads_dir.iterdir() if p.is_file())
    skipped_dirs = sorted(p.name for p in uploads_dir.iterdir() if p.is_dir())
    uploaded = unchanged = 0
    total_bytes = 0
    for i, path in enumerate(files, 1):
        data = await asyncio.to_thread(path.read_bytes)
        digest = hashlib.sha256(data).hexdigest()
        total_bytes += len(data)
        prior = stored.get(path.name)
        if prior and (prior.get("metadata") or {}).get("sha256") == digest:
            unchanged += 1
            continue
        if prior:
            await bucket.delete(prior["_id"])
        await bucket.upload_from_stream(path.name, data, metadata={"sha256": digest, "size": len(data)})
        uploaded += 1
        if i % 100 == 0:
            log(f"    uploads {i}/{len(files)}")
    return {
        "files": len(files),
        "uploaded": uploaded,
        "unchanged": unchanged,
        "total_mb": round(total_bytes / 1e6, 1),
        "skipped_subfolders": skipped_dirs,
    }


async def cmd_copy(args: argparse.Namespace) -> int:
    if args.uploads_dir and not args.uploads_dir.is_dir():
        raise Fatal(f"--uploads-dir {args.uploads_dir} is not a directory")
    src_client = AsyncMongoClient(args.source_url, serverSelectionTimeoutMS=20000, appname="snapshot_live:src")
    dst_client = AsyncMongoClient(args.target_url, serverSelectionTimeoutMS=20000, appname="snapshot_live:dst")
    try:
        for label, client, url in (("source", src_client, args.source_url), ("target", dst_client, args.target_url)):
            try:
                await client.admin.command("ping")
            except PyMongoError as e:
                raise Fatal(f"cannot reach {label} {mask_url(url)}: {type(e).__name__}: {e}") from e
        if url_hosts(args.source_url) & url_hosts(args.target_url) and args.source_db == args.target_db:
            raise Fatal("source and target are the same database -- refusing")
        src_db, dst_db = src_client[args.source_db], dst_client[args.target_db]
        log(f"source   {mask_url(args.source_url)} / {args.source_db}")
        log(f"snapshot {mask_url(args.target_url)} / {args.target_db}")

        existing = await dst_db.list_collection_names()
        if existing and not args.resume:
            raise Fatal(
                f"snapshot DB {args.target_db!r} is not empty ({len(existing)} collections). "
                "Use a new name, or --resume to finish an interrupted copy."
            )

        names = await real_collections(src_db)
        if not names:
            raise Fatal(f"source DB {args.source_db!r} has no collections -- wrong DB_NAME?")
        started = datetime.now(timezone.utc)
        before = {n: await src_db[n].count_documents({}) for n in names}
        log(f"copying {len(names)} collections, {sum(before.values())} documents ...")
        indexes = {}
        for name in names:
            t0 = time.time()
            written = await copy_collection(src_db, dst_db, name, args.batch_size)
            indexes[name] = [
                {"name": idx_name, **{k: v for k, v in spec.items() if k != "ns"}}
                for idx_name, spec in (await src_db[name].index_information()).items()
            ]
            log(f"  {name:<28} {written:>8} docs ({time.time() - t0:.1f}s)")

        uploads = None
        if args.uploads_dir:
            log(f"copying uploads from {args.uploads_dir} ...")
            uploads = await copy_uploads(dst_db, args.uploads_dir)
            log(
                f"  {uploads['files']} files, {uploads['total_mb']} MB ({uploads['uploaded']} stored, {uploads['unchanged']} unchanged)"
            )

        after = {n: await src_db[n].count_documents({}) for n in names}
        snap = {n: await dst_db[n].count_documents({}) for n in names}
        drift = {n: [before[n], after[n]] for n in names if before[n] != after[n]}
        mismatch = {
            n: {"source": after[n], "snapshot": snap[n]} for n in names if after[n] != snap[n] and n not in drift
        }

        await dst_db[META_COLL].replace_one(
            {"_id": "snapshot"},
            {
                "_id": "snapshot",
                "source": mask_url(args.source_url),
                "source_db": args.source_db,
                "started_at": started,
                "finished_at": datetime.now(timezone.utc),
                "collections": {n: {"before": before[n], "after": after[n], "snapshot": snap[n]} for n in names},
                "indexes": indexes,
                "uploads": uploads,
                "drift": drift,
            },
            upsert=True,
        )

        if mismatch:
            log(f"MISMATCH: snapshot counts differ from the source: {mismatch}")
            return EXIT_MISMATCH
        if drift:
            log(f"done, but the live DB changed while copying: {drift}")
            log("fine for a dry run; take the cutover snapshot during a write freeze")
            return EXIT_DRIFT
        log(f"snapshot OK: {sum(snap.values())} documents in {len(names)} collections")
        return EXIT_OK
    finally:
        await src_client.close()
        await dst_client.close()


# =============================================================================
# fetch-uploads
# =============================================================================
async def cmd_fetch_uploads(args: argparse.Namespace) -> int:
    client = AsyncMongoClient(args.target_url, serverSelectionTimeoutMS=20000, appname="snapshot_live:fetch")
    try:
        db = client[args.target_db]
        bucket = AsyncGridFSBucket(db, bucket_name=UPLOADS_BUCKET)
        out = args.out.resolve()
        out.mkdir(parents=True, exist_ok=True)
        fetched = unchanged = bad = 0
        async for f in db[f"{UPLOADS_BUCKET}.files"].find({}):
            name = f["filename"]
            path = (out / name).resolve()
            if path.parent != out:
                log(f"  skipped unsafe file name {name!r}")
                bad += 1
                continue
            want = (f.get("metadata") or {}).get("sha256")
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == want:
                unchanged += 1
                continue
            stream = await bucket.open_download_stream(f["_id"])
            data = await stream.read()
            if hashlib.sha256(data).hexdigest() != want:
                log(f"  checksum mismatch for {name}")
                bad += 1
                continue
            path.write_bytes(data)
            fetched += 1
        log(f"uploads in {out}: {fetched} downloaded, {unchanged} already present, {bad} problems")
        return EXIT_OK if not bad else EXIT_MISMATCH
    finally:
        await client.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Snapshot the live DecisionOS MongoDB for the karma migration.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = p.add_subparsers(dest="command", required=True)

    c = sub.add_parser("copy", help="live DB (+ uploads) -> snapshot DB")
    c.add_argument("--source-url", default=os.environ.get("SOURCE_MONGO_URL") or env_file_value("MONGO_URL"))
    c.add_argument("--source-db", default=os.environ.get("SOURCE_DB_NAME") or env_file_value("DB_NAME"))
    c.add_argument("--target-url", default=os.environ.get("TARGET_MONGO_URL"))
    c.add_argument("--target-db", default=os.environ.get("TARGET_DB_NAME"))
    c.add_argument("--uploads-dir", type=Path)
    c.add_argument("--batch-size", type=int, default=500)
    c.add_argument("--resume", action="store_true", help="continue into a non-empty snapshot DB (upserts by _id)")

    f = sub.add_parser("fetch-uploads", help="snapshot uploads bucket -> local folder")
    f.add_argument("--target-url", default=os.environ.get("TARGET_MONGO_URL"))
    f.add_argument("--target-db", default=os.environ.get("TARGET_DB_NAME"))
    f.add_argument("--out", type=Path, required=True)

    args = p.parse_args(argv)
    needed = ["target_url", "target_db"] + (["source_url", "source_db"] if args.command == "copy" else [])
    missing = [n for n in needed if not getattr(args, n)]
    if missing:
        p.error("missing: " + ", ".join("--" + m.replace("_", "-") for m in missing))
    return args


async def amain(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.command == "copy":
            return await cmd_copy(args)
        return await cmd_fetch_uploads(args)
    except Fatal as e:
        log(f"FATAL: {e}")
        return EXIT_FATAL


if __name__ == "__main__":
    sys.exit(asyncio.run(amain()))

"""Load a JSON database dump into an EMPTY MongoDB database.

The production export is one `<collection>.json` file per collection, each a
JSON array of documents, zipped. It is not mongodump/mongoexport output, so
mongorestore cannot read it, and `mongoimport --jsonArray` would keep every
`_id` as the 24-hex STRING the exporter wrote instead of the ObjectId prod has.
This loader restores it faithfully:

  * `_id` that is a 24-hex string becomes an ObjectId again (as in prod)
  * MongoDB Extended JSON ({"$oid": ..}, {"$date": ..}) is honoured if present
  * every other value is kept exactly as exported (main stores dates as ISO
    strings, so nothing else is converted)

The loaded database is the SOURCE for scripts/migrate_main_to_karma.py:

    cd backend
    .venv/bin/python scripts/load_json_dump.py ../founder-os-58-test_database_dump_20260916_173131.zip \
        --target-url mongodb://127.0.0.1:27017 --target-db decisionos_main_dump
    .venv/bin/python scripts/migrate_main_to_karma.py plan \
        --source-url mongodb://127.0.0.1:27017 --source-db decisionos_main_dump

It refuses a database that already has collections, and exits non-zero unless
every collection's document count matches its file.

EXIT CODES
    0 ok | 1 fatal/config error | 3 loaded but counts do not match the dump
"""

from __future__ import annotations

import argparse
import io
import os
import re
import sys
import zipfile
from pathlib import Path
from typing import Iterator

from bson import ObjectId, json_util
from pymongo import MongoClient
from pymongo.errors import BulkWriteError, PyMongoError

EXIT_OK, EXIT_FATAL, EXIT_VERIFY_FAILED = 0, 1, 3
OID_HEX = re.compile(r"^[0-9a-f]{24}$")
COLL_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")


class Fatal(Exception):
    pass


def restore_id(doc: dict) -> dict:
    _id = doc.get("_id")
    if isinstance(_id, str) and OID_HEX.match(_id):
        doc["_id"] = ObjectId(_id)
    return doc


def parse_docs(text: str, source: str) -> list[dict]:
    """A JSON array of documents, or one document per line (mongoexport)."""
    stripped = text.lstrip()
    if not stripped:
        return []
    if stripped.startswith("["):
        docs = json_util.loads(text)
    else:
        docs = [json_util.loads(line) for line in text.splitlines() if line.strip()]
    if not isinstance(docs, list) or not all(isinstance(d, dict) for d in docs):
        raise Fatal(f"{source}: expected a JSON array of documents")
    return [restore_id(d) for d in docs]


def iter_dump(path: Path) -> Iterator[tuple[str, str, str]]:
    """(collection, file name, JSON text) for every *.json in a zip or directory."""
    if path.is_dir():
        files = sorted(p for p in path.iterdir() if p.suffix == ".json")
        for p in files:
            yield p.stem, p.name, p.read_text(encoding="utf-8")
        return
    if not zipfile.is_zipfile(path):
        raise Fatal(f"{path} is neither a directory nor a zip file")
    with zipfile.ZipFile(path) as zf:
        for info in sorted(zf.infolist(), key=lambda i: i.filename):
            name = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
            if info.is_dir() or not name.endswith(".json"):
                continue
            with zf.open(info) as fh:
                yield name[: -len(".json")], info.filename, io.TextIOWrapper(fh, encoding="utf-8").read()


def load(path: Path, db, batch_size: int) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for coll, fname, text in iter_dump(path):
        if not COLL_NAME.match(coll) or coll.startswith("system."):
            raise Fatal(f"{fname}: {coll!r} is not a usable collection name")
        if coll in results:
            raise Fatal(f"{fname}: collection {coll!r} appears twice in the dump")
        docs = parse_docs(text, fname)
        inserted = 0
        for i in range(0, len(docs), batch_size):
            try:
                inserted += len(db[coll].insert_many(docs[i : i + batch_size], ordered=False).inserted_ids)
            except BulkWriteError as e:
                errs = e.details.get("writeErrors", [])
                raise Fatal(f"{coll}: {len(errs)} insert error(s), first: {errs[:3]}") from e
        if not docs:
            db.create_collection(coll)  # keep empty collections so the migration sees them
        results[coll] = {"file": fname, "in_dump": len(docs), "inserted": inserted}
        print(f"  {coll:<28} {len(docs):>8}", flush=True)
    if not results:
        raise Fatal(f"no *.json collection files found in {path}")
    return results


def verify(db, results: dict[str, dict]) -> list[str]:
    failures = []
    for coll, r in results.items():
        got = db[coll].count_documents({})
        r["in_db"] = got
        if got != r["in_dump"]:
            failures.append(f"{coll}: database has {got} documents, dump has {r['in_dump']}")
    return failures


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Load a JSON-array database dump into an empty MongoDB database.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("dump", type=Path, help="the dump .zip, or a directory of <collection>.json files")
    p.add_argument("--target-url", default=os.environ.get("TARGET_MONGO_URL"))
    p.add_argument("--target-db", default=os.environ.get("TARGET_DB_NAME"))
    p.add_argument("--batch-size", type=int, default=1000)
    args = p.parse_args(argv)
    missing = [f for f in ("target_url", "target_db") if not getattr(args, f)]
    if missing:
        p.error("missing: " + ", ".join("--" + m.replace("_", "-") for m in missing))
    if not args.dump.exists():
        p.error(f"{args.dump} does not exist")
    if args.batch_size < 1:
        p.error("--batch-size must be >= 1")
    return args


def main(argv: list[str] | None = None, client_factory=MongoClient) -> int:
    args = parse_args(argv)
    client = client_factory(args.target_url, serverSelectionTimeoutMS=15000, appname="load_json_dump")
    try:
        db = client[args.target_db]
        try:
            existing = db.list_collection_names()
        except PyMongoError as e:
            raise Fatal(f"cannot reach MongoDB: {e}") from e
        if existing:
            raise Fatal(
                f"database {args.target_db!r} already has {len(existing)} collection(s) -- "
                "load into a new, empty database (or drop this one yourself first)"
            )
        print(f"loading {args.dump} into {args.target_db} ...", flush=True)
        results = load(args.dump, db, args.batch_size)
        failures = verify(db, results)
        total = sum(r["in_dump"] for r in results.values())
        if failures:
            for f in failures:
                print(f"  FAIL {f}", flush=True)
            return EXIT_VERIFY_FAILED
        print(f"OK: {len(results)} collections, {total} documents, counts match the dump", flush=True)
        return EXIT_OK
    except Fatal as e:
        print(f"FATAL: {e}", flush=True)
        return EXIT_FATAL
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())

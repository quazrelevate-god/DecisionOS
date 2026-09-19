"""Async MongoDB client and shared `db` handle.

The whole app imports `db` from this module (or transitively via `core`
which re-exports it). Split out of `core.py` in Phase A so the DB layer
stands on its own.

PyMongo Async is the official successor to Motor (Motor reaches EOL May
2026). `AsyncMongoClient` is a drop-in replacement — `find().to_list(N)`,
`insert_one`, `update_one`, `aggregate()` etc. all remain awaitable — with
one gotcha: `db.X.aggregate(...)` now returns a coroutine that MUST be
awaited before `async for` iteration (Motor let you skip it).
"""
import os

from pymongo import AsyncMongoClient

from config import MONGO_URL, DB_NAME

# U7-24.18 (2026-09-19): PyMongo opens at most 2 connections at a time by
# default (maxConnecting=2), and a waiter takes whichever connection comes back
# first rather than waiting for a new one. Against a remote database (~200 ms a
# round trip through the Railway proxy) the pool therefore never grew past 3-4
# connections, and a dozen Desk requests firing at sign-in queued every query
# behind each other -- a profile save took 6-8 s. Letting more connections open
# at once lets the pool grow to the real concurrency (still capped by
# maxPoolSize, default 100).
MONGO_MAX_CONNECTING = int(os.environ.get("MONGO_MAX_CONNECTING", "16"))

client = AsyncMongoClient(MONGO_URL, maxConnecting=MONGO_MAX_CONNECTING)
db = client[DB_NAME]

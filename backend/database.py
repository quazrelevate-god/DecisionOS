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
from pymongo import AsyncMongoClient

from config import MONGO_URL, DB_NAME

client = AsyncMongoClient(MONGO_URL)
db = client[DB_NAME]

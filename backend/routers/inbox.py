"""Inbox router — extracted from `server.py` in Phase B step 6.

Owns:
  • GET  /api/inbox                — list items with counts (?classification, ?status filters)
  • POST /api/inbox/{id}/status    — mark open/done/dismissed

The `push_inbox` helper that WRITES to the inbox stays in `server.py` because
many domain workflows (invoice ingest, complaint escalation, decision
publish, task escalation) call it inline. This router only owns the READ
and STATUS-mutation surface — the smallest coherent slice.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db, get_current_user
from models.inbox import INBOX_CLASSES, InboxStatusInput


router = APIRouter(prefix="/api")


@router.get("/inbox")
async def list_inbox(
    classification: Optional[str] = None,
    status: Optional[str] = None,
    # E2-64: `limit` param + higher max so tenants with >300 open inbox
    # items can page. Counters still reflect the full total_open so the
    # UI can show 'showing N of M'.
    limit: int = Query(300, ge=1, le=1000),
    user: dict = Depends(get_current_user),
):
    tid = user["tenant_id"]
    query: dict = {"tenant_id": tid}
    if classification and classification in INBOX_CLASSES:
        query["classification"] = classification
    if status in ("open", "done", "dismissed"):
        query["status"] = status
    items = await db.inbox.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    counts: dict = {}
    # PyMongo Async: aggregate() returns a coroutine yielding the cursor, so
    # it must be awaited BEFORE `async for` iteration (Motor let you skip the
    # await — a subtle drop-in-migration gotcha).
    agg_cursor = await db.inbox.aggregate([
        {"$match": {"tenant_id": tid, "status": "open"}},
        {"$group": {"_id": "$classification", "n": {"$sum": 1}}},
    ])
    async for row in agg_cursor:
        counts[row["_id"]] = row["n"]
    open_total = await db.inbox.count_documents({"tenant_id": tid, "status": "open"})
    return {"items": items, "counts": counts, "open_total": open_total}


@router.post("/inbox/{item_id}/status")
async def set_inbox_status(item_id: str, inp: InboxStatusInput, user: dict = Depends(get_current_user)):
    if inp.status not in ("open", "done", "dismissed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    res = await db.inbox.update_one(
        {"id": item_id, "tenant_id": user["tenant_id"]},
        {"$set": {"status": inp.status}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True, "status": inp.status}

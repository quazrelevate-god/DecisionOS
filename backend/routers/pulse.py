"""J14-03 (JOURNEY-1) — one small question the open screens ask.

THE PROBLEM. Every list in this app fetched once and then sat there. Work sent
to a man's phone reached the database and nowhere else; a leave approved by the
owner never showed on the applicant's screen; a task reassigned or deleted under
somebody left them typing into a card that had moved on. The audit watched four
screens for 75 seconds each and not one of them changed by itself.

WHY NOT POLL EACH LIST. The obvious answer — refetch every list on a timer —
multiplies by however many lists are on screen, and every one of those requests
does real work (permission filtering, enrichment, joins). On a phone on a slow
line that is the wrong trade.

WHAT THIS IS INSTEAD. One endpoint, asked at most every 20 seconds by the whole
app, that answers a question no heavier than "has anything I care about moved?"
It returns a short signature per kind of thing: how many rows this tenant has,
and the newest timestamp among them. The client keeps the last answer, compares,
and refetches only the lists whose signature changed. Nothing changed means one
small request and no work anywhere else.

It is deliberately NOT a live channel. A socket is the right end state and this
is not it; it is the smallest thing that makes a screen somebody is sitting in
front of tell the truth, without a rewrite. The 20-second worst case is the
founder's call (J14: "reloading the same screen and showing the new data is very
important").

Cost: four indexed max/count pairs. The fields are the ones the collections are
already indexed on for their own listings.
"""
from fastapi import APIRouter, Depends

from core import db, get_current_user

router = APIRouter(prefix="/api")

# The collections worth watching. Anything not here is either rarely changed by
# somebody else (settings) or already refetched by the screen that owns it (the
# AI briefs, which carry their own "updated" stamp).
# Each entry names the stamps worth reading. A collection keeps `updated_at`
# where somebody remembered to write it and its own word for the same idea
# where they did not — a leave that is approved sets `decided_at` and nothing
# else, so watching `updated_at` alone would have said "nothing has changed"
# while somebody's leave was being approved in front of them. Reading the
# newest of a small list is the version of this that does not depend on every
# write path being tidy.
_WATCHED = (
    ("tasks", "tasks", ("updated_at", "created_at")),
    ("leaves", "leaves", ("updated_at", "decided_at", "replied_at", "withdrawn_at", "created_at")),
    ("decisions", "decisions", ("updated_at", "decided_at", "created_at")),
    ("notifications", "notifications", ("created_at",)),
)


async def _signature(collection: str, stamp_fields, tenant_id: str) -> str:
    """How many, and the newest stamp across the fields worth watching.

    The count alone would miss an edit in place (a task reassigned, a leave
    approved); a stamp alone would miss a deletion. Together they catch both
    without reading a single document's contents.
    """
    coll = getattr(db, collection)
    q = {"tenant_id": tenant_id}
    n = await coll.count_documents(q)
    newest = ""
    for field in stamp_fields:
        rows = await coll.find({**q, field: {"$ne": None}}, {"_id": 0, field: 1}) \
                         .sort(field, -1).limit(1).to_list(1)
        at = (rows[0].get(field) if rows else "") or ""
        if str(at) > newest:
            newest = str(at)
    return f"{n}:{newest}"


@router.get("/pulse")
async def pulse(user: dict = Depends(get_current_user)):
    """What has moved in this workspace, in one cheap answer.

    Shape: {"tasks": "12:2026-09-26T...", "leaves": "...", ...}. The values are
    opaque to the client — it only ever asks whether they are the same string it
    saw last time.
    """
    tid = user["tenant_id"]
    out = {}
    for key, collection, stamp_fields in _WATCHED:
        try:
            out[key] = await _signature(collection, stamp_fields, tid)
        except Exception:
            # A watch that cannot be read must not take the whole answer down:
            # the screens simply do not learn about that one kind this time.
            out[key] = ""
    return out

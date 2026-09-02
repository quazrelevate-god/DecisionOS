"""T10-13.9 seed: an in-flight voice note + a pending_approval (voice-sourced)
decision for the Weave Co owner, so the Dex inflight badge + decision-review
dialog have state to surface. Idempotent. Run before s13_9_voice_dex_playwright.py.

    PYTHONPATH=. .venv/Scripts/python.exe scripts/s13_9_seed.py
Clean up with:  scripts/s13_9_seed.py --clean
"""
import asyncio, sys
from core import db, now_iso

OWNER_EMAIL = "ravi.kumar@weaveco.in"
IDS = ["s139-vn", "s139-dec", "s139-t1", "s139-t2"]


async def main(clean=False):
    owner = await db.users.find_one({"email": OWNER_EMAIL}, {"_id": 0})
    assert owner, f"owner {OWNER_EMAIL} not found"
    tid, uid = owner["tenant_id"], owner["id"]
    if clean:
        await db.voice_notes.delete_many({"id": {"$in": IDS}})
        await db.decisions.delete_many({"id": {"$in": IDS}})
        await db.tasks.delete_many({"id": {"$in": IDS}})
        print("cleaned s139-* seed rows"); return
    await db.voice_notes.update_one({"id": "s139-vn"}, {"$set": {
        "id": "s139-vn", "tenant_id": tid, "created_by": uid, "kind": "audio",
        "transcript": "Tell the team to prep the Kapoor dispatch", "language": "auto",
        "status": "structuring", "source": "voice", "created_at": now_iso()}}, upsert=True)
    await db.decisions.update_one({"id": "s139-dec"}, {"$set": {
        "id": "s139-dec", "tenant_id": tid, "status": "pending_approval", "source": "voice",
        "title": "Prep and dispatch the Kapoor order", "type": "directive",
        "summary": "Confirm stock, pack, and dispatch the Kapoor Retail order today.",
        "task_ids": ["s139-t1", "s139-t2"], "created_by": uid,
        "timeline": [{"label": "Dex structured this from your voice note", "at": now_iso(), "kind": "event"}],
        "created_at": now_iso()}}, upsert=True)
    for i, (title, role) in enumerate([("Confirm stock with warehouse", "operations"),
                                       ("Pack + label the order", "operations")], 1):
        await db.tasks.update_one({"id": f"s139-t{i}"}, {"$set": {
            "id": f"s139-t{i}", "tenant_id": tid, "title": title, "status": "blocked",
            "decision_id": "s139-dec", "assignee_role": role, "created_by": uid,
            "created_at": now_iso()}}, upsert=True)
    print(f"seeded for owner {uid} / tenant {tid}: voice_note s139-vn (structuring) + decision s139-dec")

asyncio.run(main(clean="--clean" in sys.argv))

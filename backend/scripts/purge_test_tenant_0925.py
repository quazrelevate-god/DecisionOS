"""Take ONE company out of a shared database, and be able to put it back.

Written for the round-1 manual test (docs/testing/MANUAL-E2E-ROUND-1.md), which
the founder decided on 25 September to run inside the pilot client's own
database rather than a throwaway one. That is safe only if the test company can
be removed afterwards EXACTLY — which is what this does, and why it exists
before the test rather than after it.

WHY IT CAN BE EXACT. DecisionOS is multi-tenant: a new company gets its own
`tenant_id`, and all but a handful of collections carry that field on every
document. So the test is ADDITIVE to the client's database — it is beside their
company, never inside it — and removing it is a delete by tenant_id, plus the
five odds and ends listed in EXTRAS below.

NOTHING IS LOST. Every document is copied to `cleanup_archive` with a run id,
and to a JSON file, BEFORE it is deleted. `--restore <run_id>` puts the whole
company back. Same pattern as scripts/cleanup_test_data_0915.py, which this
follows deliberately.

    python scripts/purge_test_tenant_0925.py --company "Vetri Engineering"   # dry run
    python scripts/purge_test_tenant_0925.py --tenant <id>                   # dry run
    python scripts/purge_test_tenant_0925.py --tenant <id> --apply
    python scripts/purge_test_tenant_0925.py --restore <run_id>

A dry run is the default and prints what it WOULD remove, company name and
creation date first. Read that line before you type --apply.
"""
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import core  # noqa: E402

ARCHIVE = "cleanup_archive"

# Every collection that carries `tenant_id` on its documents (bootstrap/lifecycle.py
# indexes most of them on it). A collection missing from this list is one whose
# rows would SURVIVE the purge — so when a new collection is added, add it here.
TENANT_SCOPED = [
    "activity", "assets", "billing_events", "brain_audit", "brain_context",
    "brain_documents", "brain_query_cache", "calendar_events", "complaints",
    "contacts", "crm_activities", "decisions", "expenses", "files", "inbox",
    "ingestions", "inventory", "invoices", "leaves", "meetings", "memberships",
    "memory", "notifications", "payments", "tasks", "usage_events", "users",
    "voice_notes", "workflows",
]

# EXTRAS — the ones that are NOT keyed on tenant_id, and would otherwise be left
# behind. Each is deliberate, not a guess:
#   tenants                 the company document itself is keyed `id`, not tenant_id
#   operating_score_cache   _id is "<tenant_id>:0" / "<tenant_id>:1"
#   otp_codes               keyed by phone — the test numbers, not the tenant
#   signup_sessions         a half-finished sign-up, keyed by its own session id
#
# Deliberately NOT touched, because they are the platform's and not this
# company's: platform_admins, platform_audit, revoked_tokens, scheduler_locks,
# auth_email_tokens, active_sessions, audit_log, cleanup_archive itself.

# A company this script refuses to remove, whatever is typed. The pilot client's
# own workspace is the whole reason for the care here.
PROTECTED_NAMES = {"sharma textiles", "sharma textiles pvt ltd"}


async def _resolve(db, tenant_id, company):
    if tenant_id:
        t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
        if not t:
            sys.exit(f"no company with id {tenant_id} in this database")
        return t
    rx = {"$regex": company, "$options": "i"}
    hits = await db.tenants.find({"name": rx}, {"_id": 0}).to_list(50)
    if not hits:
        sys.exit(f"no company whose name matches {company!r}")
    if len(hits) > 1:
        for h in hits:
            print(f"  {h['id']}  {h.get('name')}  created {h.get('created_at')}")
        sys.exit("more than one company matches — pass --tenant <id>")
    return hits[0]


async def plan(db, tenant_id, phones):
    found = {}
    for coll in TENANT_SCOPED:
        rows = await db[coll].find({"tenant_id": tenant_id}, {"_id": 0}).to_list(200000)
        if rows:
            found[coll] = rows
    t = await db.tenants.find_one({"id": tenant_id}, {"_id": 0})
    if t:
        found["tenants"] = [t]
    cache = await db.operating_score_cache.find(
        {"_id": {"$regex": "^" + tenant_id + ":"}}).to_list(10)
    if cache:
        found["operating_score_cache"] = [dict(c, _key=c.get("_id")) for c in cache]
    if phones:
        rows = await db.otp_codes.find({"phone": {"$in": phones}}, {"_id": 0}).to_list(500)
        if rows:
            found["otp_codes"] = rows
    sess = await db.signup_sessions.find({"tenant_id": tenant_id}, {"_id": 0}).to_list(500)
    if sess:
        found["signup_sessions"] = sess
    return found


async def apply(db, tenant, found, out_dir, phones):
    tid = tenant["id"]
    run_id = "purge-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{run_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"tenant_id": tid, "company": tenant.get("name"), "run_id": run_id,
                   "phones": phones, **found}, f, ensure_ascii=False, default=str)
    print(f"copy written to {path}")

    for coll, docs in found.items():
        await db[ARCHIVE].insert_many([
            {"run_id": run_id, "collection": coll, "tenant_id": tid,
             "archived_at": datetime.now(timezone.utc).isoformat(), "doc": d} for d in docs])
    print(f"archived {sum(len(v) for v in found.values())} documents to {ARCHIVE} as {run_id}")

    # Only now, with two copies in hand, does anything get deleted.
    for coll in found:
        if coll == "tenants":
            res = await db.tenants.delete_many({"id": tid})
        elif coll == "operating_score_cache":
            res = await db.operating_score_cache.delete_many({"_id": {"$regex": "^" + tid + ":"}})
        elif coll == "otp_codes":
            res = await db.otp_codes.delete_many({"phone": {"$in": phones}})
        else:
            res = await db[coll].delete_many({"tenant_id": tid})
        print(f"  {coll}: removed {res.deleted_count}")
    print(f"\ndone. put it back with:  --restore {run_id}")


async def restore(db, run_id):
    rows = await db[ARCHIVE].find({"run_id": run_id}, {"_id": 0}).to_list(500000)
    if not rows:
        sys.exit(f"no archived run {run_id}")
    by = {}
    for r in rows:
        by.setdefault(r["collection"], []).append(r["doc"])
    for coll, docs in by.items():
        for d in docs:
            d.pop("_key", None)
        await db[coll].insert_many(docs)
        print(f"  {coll}: restored {len(docs)}")
    print("restored. the archive rows are left in place — delete them by hand when you are sure.")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", help="the company's tenant_id")
    ap.add_argument("--company", help="or match it by name")
    ap.add_argument("--phones", default="", help="comma-separated test mobiles, to clear their sign-in codes")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--restore")
    # .audit-artifacts/ is gitignored: the copy holds company data and never goes to git.
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..",
                                                  ".audit-artifacts", "cleanup_backups"))
    a = ap.parse_args()
    db = core.db

    if a.restore:
        return await restore(db, a.restore)
    if not (a.tenant or a.company):
        sys.exit("pass --tenant <id> or --company <name>")

    tenant = await _resolve(db, a.tenant, a.company)
    name = (tenant.get("name") or "").strip()
    if name.lower() in PROTECTED_NAMES:
        sys.exit(f"refusing: {name!r} is on the protected list in this script. "
                 "If that is genuinely what you mean, take it off the list by hand.")

    phones = [p.strip() for p in a.phones.split(",") if p.strip()]
    print(f"\ndatabase : {core.db.name}")
    print(f"company  : {name}")
    print(f"tenant_id: {tenant['id']}")
    print(f"created  : {tenant.get('created_at')}\n")

    found = await plan(db, tenant["id"], phones)
    total = sum(len(v) for v in found.values())
    for coll in sorted(found):
        print(f"  {coll:24} {len(found[coll]):6}")
    print(f"  {'TOTAL':24} {total:6}\n")

    if not a.apply:
        print("dry run — nothing touched. Read the company name above, then add --apply.")
        return
    if total == 0:
        print("nothing to remove.")
        return
    await apply(db, tenant, found, a.out, phones)


if __name__ == "__main__":
    asyncio.run(main())

"""Sprint 13 (T10-13.6) setup: create finance/sales/operations members with
passwords in the Weave Co tenant so a Playwright script can log in as each and
verify the role-gated UI. Idempotent. Bumps the tenant to 'business' (unlimited
seats) so all members fit.

    .venv/Scripts/python scripts/s13_setup_members.py
"""
import asyncio

from core import db, hash_password, now_iso, new_id
from core.permissions import ROLE_DEFAULT_PERMS
from services.auth.membership import create_membership, STATUS_ACTIVE

OWNER_EMAIL = "ravi.kumar@weaveco.in"
PW = "testpass123"
MEMBERS = [("finance", "s13.finance@weaveco.in"),
           ("sales", "s13.sales@weaveco.in"),
           ("operations", "s13.ops@weaveco.in")]


async def main():
    owner = await db.users.find_one({"email": OWNER_EMAIL}, {"_id": 0})
    if not owner:
        print(f"OWNER {OWNER_EMAIL} not found -- register it via the app first")
        return
    tid = owner["tenant_id"]
    tenant = await db.tenants.find_one({"id": tid}, {"_id": 0})
    # unlimited seats so the 3 members fit past the trial cap
    await db.tenants.update_one({"id": tid}, {"$set": {"plan": "business", "seats_used": None}})

    print(f"tenant: {tenant.get('name')} ({tid})")
    print(f"owner:  {OWNER_EMAIL} / {PW}")
    for role, email in MEMBERS:
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing:
            uid = existing["id"]
            await db.users.update_one({"id": uid}, {"$set": {
                "tenant_id": tid, "role": role, "password_hash": hash_password(PW)}})
        else:
            uid = new_id()
            await db.users.insert_one({
                "id": uid, "tenant_id": tid, "name": f"{role.title()} Member", "email": email,
                "password_hash": hash_password(PW), "role": role, "created_at": now_iso()})
        await create_membership(db, user_id=uid, tenant_id=tid, role=role,
                                status=STATUS_ACTIVE,
                                permissions=list(ROLE_DEFAULT_PERMS.get(role, [])))
        print(f"  {role:11} {email} / {PW}   perms={sorted(ROLE_DEFAULT_PERMS.get(role, []))}")


asyncio.run(main())

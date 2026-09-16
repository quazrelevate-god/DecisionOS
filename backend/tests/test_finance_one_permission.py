"""Finance is one permission (2026-09-16).

There were two toggles — "Finance (invoices, payments, 360°)" and "Finance
Ledger (expenses, assets, inventory)" — and nothing behind them: all 31 ledger
endpoints let you through on EITHER key, and the Finance page has no per-tab
gate, so ticking one gave the other. A small business has one finance person,
so it is now one permission.

What must hold:
  * the key is gone from the surface, and clean_perms drops it;
  * the Finance endpoints ask for "finance" and nothing else;
  * nobody loses a page they were using: the boot migration gives "finance" to
    everyone who held "ledger", in their own list, in their membership, in a
    tenant's role map — and an owner shut out of the ledger stays shut out.
"""
import os

import pytest

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="drives the boot migration against an isolated db - single-process only",
)


def test_the_ledger_key_is_gone_from_the_surface():
    from core import PERMISSION_KEYS, clean_perms, user_perms, ROLE_DEFAULT_PERMS
    assert "ledger" not in PERMISSION_KEYS
    assert "finance" in PERMISSION_KEYS
    assert clean_perms(["finance", "ledger", "tasks"]) == ["finance", "tasks"], (
        "a list still carrying the dead key is cleaned, not rejected"
    )
    assert "ledger" not in ROLE_DEFAULT_PERMS["finance"]
    assert "finance" in user_perms({"role": "finance"})


def test_finance_endpoints_ask_for_finance_only():
    import inspect
    from routers.ledger import require_ledger
    src = inspect.getsource(require_ledger)
    assert '"finance" in user_perms(user)' in src
    assert '"ledger" in perms' not in src, (
        "accepting either key is how two toggles came to mean the same thing"
    )


def test_a_member_who_held_the_ledger_keeps_finance(with_test_db):
    """The real boot migration, against a workspace as it looks today."""
    async def scenario(db):
        from bootstrap.migrations import merge_ledger_into_finance

        await db.tenants.insert_one({
            "id": "t1", "name": "Sharma Textiles",
            "roles": [
                {"key": "sales", "label": "Sales"},
                {"key": "store", "label": "Store", "permissions": ["ledger", "tasks"]},
            ],
            "owner_exclusions": ["ledger"],
        })
        await db.users.insert_many([
            {"id": "u-store", "tenant_id": "t1", "name": "Arun", "role": "sales",
             "permissions": ["inbox", "ledger"]},
            {"id": "u-both", "tenant_id": "t1", "name": "Sunita", "role": "finance",
             "permissions": ["finance", "ledger"]},
            {"id": "u-plain", "tenant_id": "t1", "name": "Priya", "role": "sales",
             "permissions": ["inbox", "tasks"]},
        ])
        await db.memberships.insert_one({
            "id": "m1", "user_id": "u-store", "tenant_id": "t1", "role": "sales",
            "status": "active", "permissions": ["inbox", "ledger"],
        })

        await merge_ledger_into_finance(db)
        # Running it twice must change nothing more (boot may retry it).
        await merge_ledger_into_finance(db)

        users = {u["id"]: u async for u in db.users.find({}, {"_id": 0})}
        membership = await db.memberships.find_one({"id": "m1"}, {"_id": 0})
        tenant = await db.tenants.find_one({"id": "t1"}, {"_id": 0})
        return users, membership, tenant

    users, membership, tenant = with_test_db(scenario)

    assert sorted(users["u-store"]["permissions"]) == ["finance", "inbox"], (
        "someone who only had the ledger keeps the page, under the one key"
    )
    assert users["u-both"]["permissions"] == ["finance"], "no duplicate, no dead key"
    assert users["u-plain"]["permissions"] == ["inbox", "tasks"], "everyone else is untouched"
    assert sorted(membership["permissions"]) == ["finance", "inbox"], "the membership too"

    store = next(r for r in tenant["roles"] if r["key"] == "store")
    assert sorted(store["permissions"]) == ["finance", "tasks"], "and a tenant's own role"
    assert tenant["owner_exclusions"] == ["finance"], (
        "an owner shut out of the ledger stays shut out of Finance"
    )


def test_the_boot_migration_is_registered():
    """It must actually run on a deployment, once, through the ledger."""
    import inspect
    import bootstrap.lifecycle as lifecycle
    src = inspect.getsource(lifecycle)
    assert '"merge_ledger_into_finance_v1"' in src
    assert "merge_ledger_into_finance," in src, "handed to _apply_migration"

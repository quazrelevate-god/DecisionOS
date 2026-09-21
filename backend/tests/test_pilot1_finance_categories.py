"""A category can be added from the form it is needed in (PILOT-1 F, 2026-09-21).

The pilot client: "Need to be able to customize and add categories." Most of it
already existed — categories are per company, and Settings > Money edits them —
but nobody goes to Settings in the middle of an expense, saving there needs
Manage Team, which a finance person may not have, and an expense saved with a
category that is not on the list silently became "Other".

Anyone with Finance access may now ADD a category (POST /ledger/categories),
saved to the same list Settings edits. Renaming and removing stay in Settings
behind Manage Team.
"""
import os

import pytest
from fastapi import HTTPException

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

TENANT = "t-cat"
ACCOUNTS = {"id": "u-acc", "tenant_id": TENANT, "role": "finance", "name": "Anita",
            "permissions": ["finance", "tasks"]}
SALES = {"id": "u-sales", "tenant_id": TENANT, "role": "sales", "name": "Priya", "permissions": ["tasks"]}

START = {"expense": ["Raw Material", "Power & Fuel", "Salaries", "Other"],
         "asset": ["Machinery", "Vehicles", "Other"]}


def _run(with_test_db, fn, categories=START):
    async def scenario(db):
        with e2e_env(db):
            tenant = {"id": TENANT, "company_name": "Balaji Textiles", "currency": "INR"}
            if categories is not None:
                tenant["finance_categories"] = {k: list(v) for k, v in categories.items()}
            await db.tenants.insert_one(tenant)
            return await fn(db)

    return with_test_db(scenario)


async def _add(kind, name, user=ACCOUNTS):
    import routers.ledger as led
    try:
        return await led.add_finance_category(led.NewCategoryInput(kind=kind, name=name), user=user), None
    except HTTPException as e:
        return None, (e.status_code, e.detail)


async def _stored(db, kind):
    t = await db.tenants.find_one({"id": TENANT}, {"_id": 0, "finance_categories": 1})
    return t["finance_categories"][kind]


def test_a_finance_person_adds_an_expense_category(with_test_db):
    async def fn(db):
        out, refused = await _add("expense", "Loom spares")
        return out, refused, await _stored(db, "expense")
    out, refused, stored = _run(with_test_db, fn)
    assert refused is None and out["added"] is True and out["category"] == "Loom spares"
    assert stored == ["Raw Material", "Power & Fuel", "Salaries", "Loom spares", "Other"], \
        "saved to the same list Settings edits, and Other stays last"


def test_an_asset_category_too(with_test_db):
    async def fn(db):
        await _add("asset", "Solar panels")
        return await _stored(db, "asset")
    assert _run(with_test_db, fn) == ["Machinery", "Vehicles", "Solar panels", "Other"]


def test_the_same_name_twice_is_one_category(with_test_db):
    async def fn(db):
        await _add("expense", "Loom spares")
        again, _ = await _add("expense", "  loom   SPARES ")
        return again, await _stored(db, "expense")
    again, stored = _run(with_test_db, fn)
    assert again["added"] is False and again["category"] == "Loom spares", "hands back the one that exists"
    assert stored.count("Loom spares") == 1


def test_other_is_never_added_twice(with_test_db):
    async def fn(db):
        out, _ = await _add("expense", "other")
        return out, await _stored(db, "expense")
    out, stored = _run(with_test_db, fn)
    assert out["category"] == "Other" and stored.count("Other") == 1


def test_a_category_needs_a_name(with_test_db):
    async def fn(db):
        return await _add("expense", "   ")
    _, refused = _run(with_test_db, fn)
    assert refused and refused[0] == 400


def test_a_company_on_the_default_list_can_add_too(with_test_db):
    """Older companies have no list of their own and read the defaults; the
    first category they add becomes their list, defaults included."""
    async def fn(db):
        import routers.ledger as led
        out, refused = await _add("expense", "Loom spares")
        return out, refused, await _stored(db, "expense"), list(led.EXPENSE_CATEGORIES)
    out, refused, stored, defaults = _run(with_test_db, fn, categories=None)
    assert refused is None
    assert stored[-1] == "Other" and "Loom spares" in stored
    assert all(c in stored for c in defaults), "nothing they had is lost"


def test_an_expense_filed_under_the_new_category_keeps_it(with_test_db):
    """The silent 'Other': an expense is only ever filed under a category on the
    company's list — so the one just added is on it, and the expense keeps it."""
    async def fn(db):
        import routers.ledger as led
        await _add("expense", "Loom spares")
        doc = await led.add_expense_with_file(
            title="Shuttle for loom 4", amount="4200", vendor_name="", category="Loom spares", date="",
            status="paid", notes="", file=None, vendor_id="", user=ACCOUNTS)
        return doc["category"]
    assert _run(with_test_db, fn) == "Loom spares"


def test_nobody_without_finance_access_adds_one(with_test_db):
    async def fn(db):
        import routers.ledger as led
        try:
            await led.require_ledger(user=SALES)
            return None
        except HTTPException as e:
            return e.status_code
    assert _run(with_test_db, fn) == 403


def test_a_full_list_says_so_instead_of_dropping_one(with_test_db):
    from services.ai.generators import FINANCE_CATEGORY_CAPS
    full = {"expense": [f"Cat {i}" for i in range(FINANCE_CATEGORY_CAPS["expense"])] + ["Other"],
            "asset": ["Other"]}

    async def fn(db):
        return await _add("expense", "One more"), await _stored(db, "expense")
    (out, refused), stored = _run(with_test_db, fn, categories=full)
    assert out is None and refused[0] == 400 and "Manage Team" in refused[1]
    assert stored == full["expense"]


def test_settings_keeps_what_people_added():
    """A Settings save runs the whole list through normalize_finance_categories;
    its old cap (14) would have cut off categories people added."""
    from services.ai.generators import normalize_finance_categories
    added = [f"Cat {i}" for i in range(20)]
    assert normalize_finance_categories({"expense": added, "asset": ["Machinery"]})["expense"] == added + ["Other"]

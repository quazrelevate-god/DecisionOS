"""The high-value threshold applies however the money is entered (JOURNEY-1, J7).

The owner sets a figure and a WhatsApp capture above it waits for them. Typed
into Finance by hand, the same figure went straight into the books: the audit
put a Rs 6,00,000 expense through as a finance person and nobody was asked
anything. A threshold that depends on which door the money came through is not
a threshold.

Nobody is blocked and nothing is lost: the expense is saved, marked, left out
of the totals, and it joins them the moment an owner says yes. An owner
entering their own expense is not asked to approve themselves.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-highvalue"
OWNER = {"id": "u-rajesh", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
FINANCE = {"id": "u-sunita", "tenant_id": T, "role": "finance", "name": "Sunita",
           "permissions": ["inbox", "data_input", "finance"]}
BIG, SMALL = 600000.0, 4000.0


def _expense(amount, title="Bill"):
    from models.finance import ExpenseInput
    return ExpenseInput(title=title, amount=amount, category="Other", date="2026-09-22")


def _go(with_test_db, who, amount, threshold=100000):
    async def scenario(db):
        import routers.ledger as ledger
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR",
                                         "high_value_threshold": threshold})
            doc = await ledger.add_expense(_expense(amount), user=who)
            summary = await ledger.ledger_summary(user=OWNER)
            return doc, summary
    return with_test_db(scenario)


def test_a_big_expense_typed_by_a_finance_person_waits(with_test_db):
    doc, summary = _go(with_test_db, FINANCE, BIG)
    assert doc["approval_status"] == "pending", "Rs 6,00,000 went straight through"
    assert summary["totals"]["total_spend"] == 0, "money nobody approved is not spend yet"


def test_and_it_counts_the_moment_it_is_approved(with_test_db):
    async def scenario(db):
        import routers.ledger as ledger
        from models.finance import ExpenseApprovalInput
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR",
                                         "high_value_threshold": 100000})
            doc = await ledger.add_expense(_expense(BIG), user=FINANCE)
            after = await ledger.decide_expense(doc["id"], ExpenseApprovalInput(approve=True), user=OWNER)
            summary = await ledger.ledger_summary(user=OWNER)
            return after, summary
    after, summary = with_test_db(scenario)
    assert after["approval_status"] == "approved" and after["approved_by"] == OWNER["id"]
    assert summary["totals"]["total_spend"] == BIG


def test_a_rejected_one_stays_on_the_list_and_out_of_the_books(with_test_db):
    async def scenario(db):
        import routers.ledger as ledger
        from models.finance import ExpenseApprovalInput
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR",
                                         "high_value_threshold": 100000})
            doc = await ledger.add_expense(_expense(BIG), user=FINANCE)
            after = await ledger.decide_expense(doc["id"], ExpenseApprovalInput(approve=False, note="Not this quarter"),
                                                user=OWNER)
            listed = await ledger.list_expenses(user=OWNER, limit=100, offset=0)
            summary = await ledger.ledger_summary(user=OWNER)
            return after, listed, summary
    after, listed, summary = with_test_db(scenario)
    assert after["approval_status"] == "rejected"
    assert after["approval_note"] == "Not this quarter"
    assert len(listed) == 1, "it is not deleted behind the person who typed it"
    assert summary["totals"]["total_spend"] == 0


def test_a_small_expense_is_not_bothered(with_test_db):
    doc, summary = _go(with_test_db, FINANCE, SMALL)
    assert doc["approval_status"] is None
    assert summary["totals"]["total_spend"] == SMALL


def test_an_owner_does_not_approve_themselves(with_test_db):
    doc, summary = _go(with_test_db, OWNER, BIG)
    assert doc["approval_status"] is None
    assert summary["totals"]["total_spend"] == BIG

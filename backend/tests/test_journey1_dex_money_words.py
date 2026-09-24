""""How much do customers owe us?" finds the money (JOURNEY-1 J5p-01 / DX-01).

An owner asked the most basic money question there is and was told, in bold,
that the receivables table was empty -- beside a ledger holding Rs 7,49,000.
The planner was right (invoices, unpaid, grouped by contact). The keywords it
carried were words from the QUESTION, and "owe" and "receivable" are not the
name of anything, so retrieval ran {number|contact_name ~ /owe|receivable/i}
and matched no invoices at all. The numbers are computed from the rows by code,
so zero rows narrated as zero rupees.

Two answers: the words a money question is made of are stop-words now, and on
a money entity a filter that matches nothing while the collection holds
something is treated as a bad filter and dropped.
"""
import os

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-j1-dex"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Rajesh", "permissions": []}
# What _ask builds before retrieval: who is asking, and what they may see.
SCOPE = {"tenant_id": T, "uid": OWNER["id"], "role": "owner", "privileged": True}

INVOICES = [
    {"id": "i1", "tenant_id": T, "type": "sales_invoice", "number": "S-1", "contact_name": "Krishna Garments",
     "amount": 400000, "status": "unpaid", "created_at": "2026-09-01T00:00:00+00:00"},
    {"id": "i2", "tenant_id": T, "type": "sales_invoice", "number": "S-2", "contact_name": "Mumbai Traders",
     "amount": 349000, "status": "unpaid", "created_at": "2026-09-02T00:00:00+00:00"},
]


def test_the_question_words_are_not_record_filters():
    from routers.brain import _rx
    assert _rx(["outstanding", "owe", "customers", "receivable"]) is None, \
        "every one of these is a word from the question, not the name of a record"
    assert _rx(["dues", "balance", "total", "much", "money"]) is None
    # A real name still filters, which is the whole point of keywords.
    got = _rx(["Krishna"])
    assert got and "Krishna" in got["$regex"]


def test_a_money_question_reaches_the_invoices(with_test_db):
    async def scenario(db):
        from routers.brain import _retrieve
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR"})
            await db.invoices.insert_many([dict(i) for i in INVOICES])
            plan = {"primary_entity": "invoices", "keywords": ["outstanding", "owe", "customers", "receivable"]}
            return await _retrieve(plan, SCOPE, OWNER)

    out = with_test_db(scenario)
    ids = {r["id"] for r in out["records"]}
    assert ids == {"i1", "i2"}, "the ledger is not empty, and the answer must not say it is"


def test_a_keyword_nobody_has_heard_of_is_dropped_rather_than_answered_as_zero(with_test_db):
    """Wrong-but-broad beats confidently empty on money."""
    async def scenario(db):
        from routers.brain import _retrieve
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR"})
            await db.invoices.insert_many([dict(i) for i in INVOICES])
            plan = {"primary_entity": "invoices", "keywords": ["zzqqxx"]}
            return await _retrieve(plan, SCOPE, OWNER)

    assert len({r["id"] for r in with_test_db(scenario)["records"]}) == 2


def test_a_real_name_still_narrows(with_test_db):
    async def scenario(db):
        from routers.brain import _retrieve
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR"})
            await db.invoices.insert_many([dict(i) for i in INVOICES])
            plan = {"primary_entity": "invoices", "keywords": ["Krishna"]}
            return await _retrieve(plan, SCOPE, OWNER)

    assert {r["id"] for r in with_test_db(scenario)["records"]} == {"i1"}, \
        "dropping a filter that matches NOTHING must not drop one that matches something"


def test_an_empty_ledger_still_answers_empty(with_test_db):
    async def scenario(db):
        from routers.brain import _retrieve
        with e2e_env(db):
            await db.tenants.insert_one({"id": T, "name": "Sharma Textiles", "currency": "INR"})
            plan = {"primary_entity": "invoices", "keywords": ["owe"]}
            return await _retrieve(plan, SCOPE, OWNER)

    assert with_test_db(scenario)["records"] == [], "nothing there is still nothing there"

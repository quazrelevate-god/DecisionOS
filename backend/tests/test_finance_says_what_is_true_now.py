"""The finance analysis notices when the figures move (2026-09-29).

Found walking Finance at phone width, which is where it is unavoidable: the
AI Analysis panel on the Revenue tab said

    "No income data found — revenue picture is completely blank"
    "Zero revenue records: ₹0 billed, ₹0 received"

directly above cards reading Billed ₹13,58,500 · 3 invoices. On the Expenses
tab it went further — "Zero records found: data pipeline may be broken" — over
a list of three real expenses. Telling a founder their books are broken when
they are not, on the one page whose whole job is to be trusted about money.

The generator was never at fault. Pressing Refresh produced a good, true
analysis ("₹9.66L receivables dominate; ₹48,500 from Target Sourcing due
TOMORROW"). Nothing ever asked it again: `db.ledger_ai` was cleared only by a
full finance re-sync, never when an invoice, expense or payment was written,
and the client held its first answer for the whole session.

WHY A FINGERPRINT OF THE FIGURES AND NOT A TIMESTAMP. The cheap check used
everywhere else in this codebase is /api/pulse's — how many rows, and the
newest stamp. It does not work here: NONE of the thirteen finance update sites
in routers/ledger.py writes `updated_at`. Marking an invoice paid sets
`amount_paid` and `status` and nothing else, so a stamp-and-count signature
would sail straight past the single change the receivables analysis most needs
to notice. The analysis records what it was written from instead.
"""
import os
from pathlib import Path

import pytest

from tests.e2e_harness import e2e_env

pytestmark = pytest.mark.skipif(
    bool(os.environ.get("PYTEST_XDIST_WORKER")),
    reason="rebinds module-level db globals - single-process only",
)

T = "t-money"
OWNER = {"id": "u-owner", "tenant_id": T, "role": "owner", "name": "Kavya", "permissions": []}


def _invoice(iid, amount, status="unpaid", paid=0.0):
    return {"id": iid, "tenant_id": T, "type": "sales_invoice", "number": iid,
            "contact_name": "Bluewave Apparel UK", "title": "Polos",
            "date": "2026-09-10", "due_date": "2026-09-25", "amount": amount,
            "currency": "INR", "status": status, "amount_paid": paid,
            "created_at": "2026-09-10T04:00:00+00:00"}


async def _seed(db):
    await db.tenants.insert_one({"id": T, "name": "Nila", "currency": "INR"})
    await db.users.insert_one({"id": "u-owner", "tenant_id": T, "name": "Kavya", "role": "owner"})


class _Chat:
    """A stand-in for the model. What is under test is whether the analysis is
    ASKED FOR again, not what it comes back with — and a real call per case
    turned this file into two minutes of the suite."""
    def with_model(self, *a, **k):
        return self

    async def send_message(self, *a, **k):
        return '{"headline": "A headline", "insights": []}'


def _env(fn):
    async def run(db):
        import routers.ledger as L
        saved = L.claude_chat
        L.claude_chat = lambda **k: _Chat()
        try:
            with e2e_env(db):
                await _seed(db)
                return await fn(db)
        finally:
            L.claude_chat = saved
    return run


# ───────────────── the fingerprint is of the figures ───────────────────────
def test_the_basis_ignores_the_wall_clock():
    """`today` moves on its own every night; regenerating for that would be a
    daily AI call that tells nobody anything new."""
    from routers.ledger import _basis_of
    a = {"currency": "INR", "today": "2026-09-29", "revenue_billed": 100}
    b = {"currency": "INR", "today": "2026-09-30", "revenue_billed": 100}
    assert _basis_of(a) == _basis_of(b)


def test_the_basis_moves_when_the_money_does():
    from routers.ledger import _basis_of
    a = {"currency": "INR", "today": "2026-09-29", "revenue_billed": 100}
    b = {"currency": "INR", "today": "2026-09-29", "revenue_billed": 250}
    assert _basis_of(a) != _basis_of(b)


def test_the_basis_is_stable_across_key_order():
    from routers.ledger import _basis_of
    assert _basis_of({"a": 1, "b": 2}) == _basis_of({"b": 2, "a": 1})


# ───────────────── what the endpoint does with it ──────────────────────────
def test_an_analysis_written_for_an_empty_company_is_not_served_after_the_first_invoice(with_test_db):
    """The exact path a new customer walks: open Finance on day one, then
    raise the first invoice."""
    async def scenario(db):
        import routers.ledger as L
        first = await L.get_ledger_ai("revenue", user=OWNER)          # empty company
        await db.invoices.insert_one(_invoice("INV-1", 393000.0))     # first sale
        second = await L.get_ledger_ai("revenue", user=OWNER)
        row = await db.ledger_ai.find_one({"tenant_id": T, "scope": "revenue"}, {"_id": 0})
        return first, second, row

    first, second, row = with_test_db(_env(scenario))
    assert first.get("basis") and second.get("basis")
    assert second["basis"] != first["basis"], "the figures moved, so it was written again"
    assert row["basis"] == second["basis"], "and the stored one is the new one"


def test_nothing_changing_costs_nothing(with_test_db):
    """The saving that pays for the freshness check: when the money has not
    moved, the cached analysis is handed straight back."""
    async def scenario(db):
        import routers.ledger as L
        await db.invoices.insert_one(_invoice("INV-1", 393000.0))
        one = await L.get_ledger_ai("revenue", user=OWNER)
        two = await L.get_ledger_ai("revenue", user=OWNER)
        three = await L.get_ledger_ai("revenue", user=OWNER)
        return one, two, three

    one, two, three = with_test_db(_env(scenario))
    assert one["generated_at"] == two["generated_at"] == three["generated_at"], \
        "written once, then served"


def test_marking_an_invoice_paid_counts_as_a_change(with_test_db):
    """The case a timestamp signature would have missed entirely: none of the
    finance update sites writes `updated_at`, and being paid is exactly what
    a receivables analysis is about."""
    async def scenario(db):
        import routers.ledger as L
        await db.invoices.insert_one(_invoice("INV-1", 393000.0))
        before = await L.get_ledger_ai("revenue", user=OWNER)
        await db.invoices.update_one({"id": "INV-1"},
                                     {"$set": {"status": "paid", "amount_paid": 393000.0}})
        after = await L.get_ledger_ai("revenue", user=OWNER)
        return before, after

    before, after = with_test_db(_env(scenario))
    assert after["basis"] != before["basis"]
    assert after["generated_at"] != before["generated_at"], "and it was written again"


def test_a_row_from_before_this_shipped_is_rewritten_once(with_test_db):
    """Every tenant already has cached rows with no basis on them."""
    async def scenario(db):
        import routers.ledger as L
        await db.ledger_ai.insert_one({
            "tenant_id": T, "scope": "revenue", "headline": "stale words",
            "insights": [], "generated_at": "2026-01-01T00:00:00+00:00"})
        out = await L.get_ledger_ai("revenue", user=OWNER)
        return out

    out = with_test_db(_env(scenario))
    assert out.get("basis"), "it now carries one"
    assert out["headline"] != "stale words"


def test_each_scope_is_judged_on_its_own(with_test_db):
    async def scenario(db):
        import routers.ledger as L
        await L.get_ledger_ai("revenue", user=OWNER)
        await L.get_ledger_ai("expenses", user=OWNER)
        rows = await db.ledger_ai.find({"tenant_id": T}, {"_id": 0, "scope": 1, "basis": 1}).to_list(10)
        return sorted(r["scope"] for r in rows)

    assert with_test_db(_env(scenario)) == ["expenses", "revenue"]


# ───────────────── and the panel asks again ────────────────────────────────
def test_the_panel_no_longer_holds_its_first_answer_for_the_session():
    src = (Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages"
           / "finance" / "FinanceAi.jsx").read_text(encoding="utf-8")
    # Narrow to the CODE: the sentence above it in the source explains what
    # `staleTime: Infinity` used to do, and matched a looser assertion.
    assert "    staleTime: Infinity," not in src
    assert "    staleTime: 60_000," in src

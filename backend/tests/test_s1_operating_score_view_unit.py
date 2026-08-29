"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 7 (formula edge cases).

Company-view tests over a fake Mongo -- the two edge cases that live in the
async assembly (not the pure helpers): the enough_data None<->70 discontinuity
(T10-07.1) and the unguarded float(amount) crash on a malformed invoice amount
(T10-07.14). No server, no live DB.
"""
import asyncio
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

import services.operating_score as ops

NOW = "2026-08-29T00:00:00+00:00"


# --- fake Mongo -------------------------------------------------------------
class _Cursor:
    def __init__(self, rows): self._rows = rows
    async def to_list(self, n): return list(self._rows[:n])


class _Coll:
    def __init__(self): self.docs = []
    def find(self, filt=None, proj=None): return _Cursor(self.docs)
    async def find_one(self, filt=None, proj=None): return None  # cache miss
    async def update_one(self, *a, **k): return None             # cache write no-op


class _DB:
    def __init__(self): self._c = defaultdict(_Coll)
    def __getattr__(self, n):
        if n.startswith("_"): raise AttributeError(n)
        return self._c[n]
    def __getitem__(self, n): return self._c[n]


@pytest.fixture
def fake_db(monkeypatch):
    db = _DB()
    monkeypatch.setattr(ops, "db", db)
    return db


OWNER = {"role": "owner", "id": "owner1"}


def _view(db):
    return asyncio.run(ops._company_operating_view("t1", OWNER, NOW))


# --- None<->70 discontinuity (T10-07.1) -------------------------------------
def test_two_actionable_no_invoices_overall_is_None():
    """actionable==2 AND inv_count==0 -> enough_data False -> company.overall
    is None even though sub-scores are computed."""
    db = _DB()
    import services.operating_score as _ops
    _ops.db = db  # direct set (fixture-free for clarity)
    db.tasks.docs = [{"status": "done"}, {"status": "done"}]  # actionable 2
    payload = asyncio.run(_ops._company_operating_view("t1", OWNER, NOW))
    assert payload["company"]["enough_data"] is False
    assert payload["company"]["overall"] is None
    # but execution sub-score IS computed (2/2 done -> 100)
    assert payload["company"]["categories"]["execution"] == 100


def test_three_actionable_crosses_into_a_number():
    """actionable==3 -> enough_data True -> overall becomes a real number.
    The discontinuity is exactly at 2->3."""
    db = _DB()
    import services.operating_score as _ops
    _ops.db = db
    db.tasks.docs = [{"status": "done"}, {"status": "done"}, {"status": "done"}]
    payload = asyncio.run(_ops._company_operating_view("t1", OWNER, NOW))
    assert payload["company"]["enough_data"] is True
    assert payload["company"]["overall"] is not None


def test_zero_tasks_one_invoice_also_crosses():
    """inv_count>0 alone flips enough_data True even with zero tasks."""
    db = _DB()
    import services.operating_score as _ops
    _ops.db = db
    db.invoices.docs = [{"amount": 1000, "type": "sales_invoice", "status": "unpaid"}]
    payload = asyncio.run(_ops._company_operating_view("t1", OWNER, NOW))
    assert payload["company"]["enough_data"] is True
    assert payload["company"]["overall"] is not None


# --- malformed amount crash (T10-07.14) -------------------------------------
def test_malformed_invoice_amount_currently_raises():
    """BUG (T10-07.14): line 114 does float(i.get('amount') or 0) with NO
    try/except, so a non-numeric amount string on a sales_invoice crashes the
    WHOLE operating-score view. This test pins the current crash; the fix is to
    route the amount through the tolerant parse_amount (which returns 0.0).

    When the code is hardened, flip this to assert it computes instead of raises."""
    db = _DB()
    import services.operating_score as _ops
    _ops.db = db
    db.invoices.docs = [{"amount": "N/A", "type": "sales_invoice", "status": "unpaid"}]
    with pytest.raises(ValueError):
        asyncio.run(_ops._company_operating_view("t1", OWNER, NOW))


def test_numeric_string_amount_also_raises_today():
    """Even a clean numeric STRING '5000' is fine for float(), so only truly
    non-numeric strings crash -- OCR 'Rs 5,000' (comma/currency) WOULD crash
    here, unlike everywhere else that uses parse_amount."""
    db = _DB()
    import services.operating_score as _ops
    _ops.db = db
    db.invoices.docs = [{"amount": "Rs 5,000", "type": "sales_invoice", "status": "unpaid"}]
    with pytest.raises(ValueError):
        asyncio.run(_ops._company_operating_view("t1", OWNER, NOW))

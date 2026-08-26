"""Epic 3 Sprint 8 (E3-08.3): per-tenant AI cost budgets.

Tests the pure budget decision + resolution logic, and ai_budget_status against a
tiny fake db (no real Mongo). Enforcement lives in guarded_llm's gate.
"""
import asyncio

from services.ai.budget import (
    budget_state, tenant_budget_usd, ai_budget_status, invalidate_budget_cache,
)


# --- budget_state (pure) ----------------------------------------------------
def test_unlimited_when_no_budget():
    assert budget_state(1000, 0) == "unlimited"
    assert budget_state(1000, None) == "unlimited"
    assert budget_state(1000, -5) == "unlimited"


def test_ok_below_ninety_percent():
    assert budget_state(50, 100) == "ok"
    assert budget_state(0, 100) == "ok"


def test_near_at_ninety_percent():
    assert budget_state(90, 100) == "near"
    assert budget_state(95, 100) == "near"


def test_over_at_or_above_budget():
    assert budget_state(100, 100) == "over"
    assert budget_state(150, 100) == "over"


# --- tenant_budget_usd (pure) -----------------------------------------------
def test_tenant_override_wins_when_positive():
    assert tenant_budget_usd({"ai_budget_usd": 25}) == 25.0


def test_falls_back_to_default_when_missing_or_invalid(monkeypatch):
    import services.ai.budget as bud
    monkeypatch.setattr(bud, "AI_MONTHLY_BUDGET_USD", 40.0)
    assert tenant_budget_usd({}) == 40.0
    assert tenant_budget_usd({"ai_budget_usd": 0}) == 40.0
    assert tenant_budget_usd({"ai_budget_usd": "bad"}) == 40.0
    assert tenant_budget_usd({"ai_budget_usd": -1}) == 40.0


# --- ai_budget_status (fake db) ---------------------------------------------
class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, n):
        return self._rows[:n]


class _FakeColl:
    def __init__(self, rows):
        self._rows = rows

    async def aggregate(self, pipeline):          # this driver: aggregate() is a coroutine
        return _FakeCursor(self._rows)


class _FakeDB:
    def __init__(self, cost):
        self.usage_events = _FakeColl([{"_id": None, "cost": cost}] if cost is not None else [])


def test_status_reports_over(monkeypatch):
    invalidate_budget_cache()
    db = _FakeDB(cost=120.0)
    st = asyncio.run(ai_budget_status(db, "t1", tenant_doc={"ai_budget_usd": 100}))
    assert st["state"] == "over" and st["spend_usd"] == 120.0 and st["budget_usd"] == 100.0


def test_status_unlimited_skips_spend_query():
    invalidate_budget_cache()
    # cost row present, but no budget -> unlimited, spend not counted
    db = _FakeDB(cost=999.0)
    st = asyncio.run(ai_budget_status(db, "t2", tenant_doc={}))  # no budget, default 0
    assert st["state"] == "unlimited" and st["spend_usd"] == 0.0


def test_status_ok_under_budget():
    invalidate_budget_cache()
    db = _FakeDB(cost=10.0)
    st = asyncio.run(ai_budget_status(db, "t3", tenant_doc={"ai_budget_usd": 100}))
    assert st["state"] == "ok" and st["ratio"] == 0.1

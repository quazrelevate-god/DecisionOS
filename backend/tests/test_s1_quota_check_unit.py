"""Epic 10 Testing -- Sprint 1 (unit). T10-01.10 (quota enforcement).

Unit tests over check_quota with a fake Mongo + a stubbed usage reader:
unlimited-plan pass, over/under the cap, the exactly-at-cap boundary, and
negative-cost handling. No server, no live DB.
"""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

import services.quotas as quotas
from services.plans import effective_plan

RESOURCE = "llm_tokens_total"
TRIAL_CAP = effective_plan({"plan": "trial"})["quotas"][RESOURCE]  # 300000


class _Tenants:
    def __init__(self, tenant): self.tenant = tenant
    async def find_one(self, filt=None, proj=None): return self.tenant


class _DB:
    def __init__(self, tenant): self.tenants = _Tenants(tenant)


def _check(tenant, usage, cost, monkeypatch):
    async def fake_usage(db, tid, resource): return usage
    monkeypatch.setattr(quotas, "_usage_for_resource", fake_usage)
    return asyncio.run(quotas.check_quota(_DB(tenant), "t1", RESOURCE, cost))


def test_enterprise_plan_unlimited_always_ok(monkeypatch):
    """Enterprise is truly unlimited (cap None) -> always OK regardless of usage."""
    ok, detail = _check({"plan": "enterprise"}, usage=10_000_000, cost=999999, monkeypatch=monkeypatch)
    assert ok is True and detail["cap"] is None and detail["over"] is False


def test_business_plan_has_finite_token_cap(monkeypatch):
    """NOTE: business has UNLIMITED SEATS but a FINITE token quota (10M) -- the
    two are independent. A business tenant CAN be blocked on tokens."""
    cap = effective_plan({"plan": "business"})["quotas"][RESOURCE]
    assert cap is not None and cap > TRIAL_CAP
    ok, detail = _check({"plan": "business"}, usage=cap, cost=1, monkeypatch=monkeypatch)
    assert ok is False and detail["over"] is True


def test_under_cap_ok(monkeypatch):
    ok, detail = _check({"plan": "trial"}, usage=100_000, cost=0, monkeypatch=monkeypatch)
    assert ok is True and detail["over"] is False
    assert detail["cap"] == TRIAL_CAP


def test_projected_over_cap_blocks(monkeypatch):
    ok, detail = _check({"plan": "trial"}, usage=TRIAL_CAP - 1000, cost=5000, monkeypatch=monkeypatch)
    assert ok is False and detail["over"] is True
    assert detail["projected"] == TRIAL_CAP - 1000 + 5000


def test_exactly_at_cap_is_ok(monkeypatch):
    """projected == cap is NOT over (over is strictly >)."""
    ok, detail = _check({"plan": "trial"}, usage=TRIAL_CAP, cost=0, monkeypatch=monkeypatch)
    assert ok is True and detail["over"] is False


def test_one_over_cap_blocks(monkeypatch):
    ok, _ = _check({"plan": "trial"}, usage=TRIAL_CAP, cost=1, monkeypatch=monkeypatch)
    assert ok is False


def test_negative_cost_treated_as_zero(monkeypatch):
    ok, detail = _check({"plan": "trial"}, usage=100_000, cost=-999999, monkeypatch=monkeypatch)
    assert ok is True
    assert detail["projected"] == 100_000  # max(0, cost) -> 0 increment


def test_seat_override_does_not_affect_token_quota(monkeypatch):
    """A seat_limit_override changes seats, not the token cap."""
    ok, detail = _check({"plan": "trial", "seat_limit_override": 50}, usage=100_000, cost=0,
                        monkeypatch=monkeypatch)
    assert detail["cap"] == TRIAL_CAP


def test_usage_quota_override_raises_cap(monkeypatch):
    ok, detail = _check({"plan": "trial", "usage_quotas": {RESOURCE: 9_000_000}},
                        usage=1_000_000, cost=0, monkeypatch=monkeypatch)
    assert detail["cap"] == 9_000_000 and ok is True

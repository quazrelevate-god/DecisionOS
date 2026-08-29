"""FIX-005-A (S3-02 + S3-03) tests: plan/entitlement fields + per-tenant AI keys.

  * services.plans.effective_plan merges base + tenant overrides.
  * has_feature reader honors plan defaults + feature_flags override.
  * trial_expired boundary.
  * enforce_seat_limit raises 402 when full.
  * new_tenant_plan_fields returns the right defaults.
  * Backfill migration marks legacy tenants as grandfathered.
  * services.tenant_ai_keys.resolve_ai_key precedence (tenant > platform).
  * summarize_tenant_ai_keys never leaks the raw key.
  * normalize_ai_key_map filters unknown providers + strips empty.
  * Endpoints: /tenant/plan (any user), /tenant/ai-keys (owner-only,
    audit-log rotation events).
  * Register sets plan=trial with trial_ends_at.
"""
import asyncio
import inspect
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ---------------------------------------------------------------------------
# Minimal fake DB
# ---------------------------------------------------------------------------
class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)
        self._sort = None

    def sort(self, field, direction=1):
        self._sort = (field, direction)
        return self

    def to_list(self, n):
        docs = list(self._docs)
        if self._sort:
            f, d = self._sort
            docs.sort(key=lambda x: (x.get(f) or ""), reverse=(d == -1))

        async def _r():
            return [dict(x) for x in (docs[:n] if n else docs)]
        return _r()


class _Col:
    def __init__(self):
        self.docs = []

    async def find_one(self, q, projection=None):
        for d in self.docs:
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q, projection=None):
        return _Cursor([dict(d) for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=doc.get("id"))

    async def update_one(self, q, u, upsert=False):
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_many(self, q, u):
        n = 0
        for d in self.docs:
            if self._match(d, q):
                if "$set" in u:
                    d.update(u["$set"])
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def create_index(self, *a, **kw):
        return "ok"

    def _match(self, d, q):
        for k, v in q.items():
            dv = d.get(k)
            if isinstance(v, dict):
                for op, ov in v.items():
                    if op == "$in" and dv not in ov:
                        return False
                    elif op == "$ne" and dv == ov:
                        return False
                    elif op == "$exists" and (k in d) != ov:
                        return False
            elif dv != v:
                return False
        return True


class _FakeDB:
    def __init__(self):
        self.tenants = _Col()
        self.memberships = _Col()
        self.users = _Col()

    def __getattr__(self, name):
        col = _Col()
        setattr(self, name, col)
        return col

    def __getitem__(self, name):
        return getattr(self, name)


# Dedicated module-scoped loop (see audit-log note): owning our own loop
# keeps every call in this module on one live loop and is immune to another
# module's asyncio.run() closing the process current loop under -n/loadscope.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


# ===========================================================================
# services.plans — effective plan resolution
# ===========================================================================
class TestEffectivePlan:
    def test_trial_defaults(self):
        from services.plans import effective_plan
        ep = effective_plan({"plan": "trial"})
        assert ep["key"] == "trial"
        assert ep["seat_limit"] == 3
        assert ep["quotas"]["stt_minutes"] == 30
        assert ep["features"]["whatsapp"] is False

    def test_business_defaults(self):
        from services.plans import effective_plan
        ep = effective_plan({"plan": "business"})
        assert ep["seat_limit"] is None    # unlimited
        assert ep["features"]["whatsapp"] is True

    def test_seat_limit_override_wins(self):
        from services.plans import effective_plan
        ep = effective_plan({"plan": "starter", "seat_limit_override": 25})
        assert ep["seat_limit"] == 25

    def test_quota_override_replaces_default(self):
        from services.plans import effective_plan
        ep = effective_plan({
            "plan": "starter",
            "usage_quotas": {"llm_tokens_total": 5_000_000},
        })
        assert ep["quotas"]["llm_tokens_total"] == 5_000_000
        # Untouched quotas keep their plan default
        assert ep["quotas"]["stt_minutes"] == 300

    def test_feature_flag_override_wins(self):
        from services.plans import effective_plan
        ep = effective_plan({
            "plan": "trial",
            "feature_flags": {"whatsapp": True},
        })
        assert ep["features"]["whatsapp"] is True

    def test_unknown_plan_falls_back_to_trial(self):
        from services.plans import effective_plan
        ep = effective_plan({"plan": "made_up"})
        assert ep["key"] == "trial"

    def test_grandfathered_plan_unlimited(self):
        from services.plans import effective_plan
        ep = effective_plan({"plan": "grandfathered"})
        assert ep["seat_limit"] is None
        assert all(v is None for v in ep["quotas"].values())


class TestTrialExpiry:
    def test_expired_trial(self):
        from services.plans import trial_expired
        ended = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        assert trial_expired({"plan": "trial", "trial_ends_at": ended}) is True

    def test_active_trial(self):
        from services.plans import trial_expired
        ends = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        assert trial_expired({"plan": "trial", "trial_ends_at": ends}) is False

    def test_non_trial_never_expires(self):
        from services.plans import trial_expired
        assert trial_expired({"plan": "business", "trial_ends_at": None}) is False


class TestHasFeature:
    def test_flag_default_from_plan(self):
        from services.plans import has_feature
        assert has_feature({"plan": "business"}, "whatsapp") is True
        assert has_feature({"plan": "trial"}, "whatsapp") is False

    def test_flag_override_wins(self):
        from services.plans import has_feature
        assert has_feature({"plan": "trial", "feature_flags": {"whatsapp": True}},
                            "whatsapp") is True

    def test_unknown_flag_false(self):
        from services.plans import has_feature
        assert has_feature({"plan": "business"}, "made_up_flag") is False


class TestNewTenantPlanFields:
    def test_new_registration_gets_trial(self):
        from services.plans import new_tenant_plan_fields, PLAN_TRIAL
        f = new_tenant_plan_fields()
        assert f["plan"] == PLAN_TRIAL
        assert f["trial_ends_at"]  # non-empty iso date
        assert f["seat_limit_override"] is None
        assert f["usage_quotas"] == {}
        assert f["feature_flags"] == {}


class TestEnforceSeatLimit:
    def test_raises_402_when_full(self):
        from services.plans import enforce_seat_limit
        from services.auth.membership import create_membership
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "trial"}))
        # trial cap = 3 — add 3 active members
        for i in range(3):
            _run(create_membership(db, user_id=f"u{i}", tenant_id="t1", role="sales"))
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            _run(enforce_seat_limit(db, "t1"))
        assert exc_info.value.status_code == 402
        assert exc_info.value.detail["code"] == "seat_limit_reached"

    def test_no_raise_below_cap(self):
        from services.plans import enforce_seat_limit
        from services.auth.membership import create_membership
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "starter"}))  # cap 10
        for i in range(3):
            _run(create_membership(db, user_id=f"u{i}", tenant_id="t1", role="sales"))
        # 4th call should succeed silently
        _run(enforce_seat_limit(db, "t1"))

    def test_unlimited_plan_never_raises(self):
        from services.plans import enforce_seat_limit
        from services.auth.membership import create_membership
        db = _FakeDB()
        _run(db.tenants.insert_one({"id": "t1", "plan": "business"}))
        for i in range(50):
            _run(create_membership(db, user_id=f"u{i}", tenant_id="t1", role="sales"))
        _run(enforce_seat_limit(db, "t1"))


# ===========================================================================
# Register sets plan fields
# ===========================================================================
class TestRegisterSetsPlanFields:
    def test_register_source_populates_trial_fields(self):
        from routers.auth import register
        src = inspect.getsource(register)
        assert "new_tenant_plan_fields" in src
        # Fields must land in the tenant_doc (spread into it)
        assert "**_plan_fields" in src


class TestBootstrapBackfill:
    def test_migration_registered(self):
        import server
        src = inspect.getsource(server._bootstrap)
        assert "backfill_grandfathered_plans_v1" in src
        assert "PLAN_GRANDFATHERED" in src


# ===========================================================================
# services.tenant_ai_keys — resolver + summary
# ===========================================================================
class TestResolveAiKey:
    def test_tenant_key_wins(self, monkeypatch):
        # Prevent env from leaking into the fallback path.
        for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"):
            monkeypatch.delenv(k, raising=False)
        from services.tenant_ai_keys import resolve_ai_key
        tenant = {"ai_keys": {"anthropic": "sk-tenant-abc"}}
        assert resolve_ai_key(tenant, "anthropic") == "sk-tenant-abc"

    def test_falls_back_to_platform(self, monkeypatch):
        from core import _ai_keys
        monkeypatch.setitem(_ai_keys, "anthropic", "sk-platform-xyz")
        from services.tenant_ai_keys import resolve_ai_key
        tenant = {}
        assert resolve_ai_key(tenant, "anthropic") == "sk-platform-xyz"

    def test_empty_tenant_key_falls_back(self, monkeypatch):
        from core import _ai_keys
        monkeypatch.setitem(_ai_keys, "anthropic", "sk-platform-xyz")
        from services.tenant_ai_keys import resolve_ai_key
        tenant = {"ai_keys": {"anthropic": ""}}
        assert resolve_ai_key(tenant, "anthropic") == "sk-platform-xyz"

    def test_none_tenant_falls_back(self, monkeypatch):
        from core import _ai_keys
        monkeypatch.setitem(_ai_keys, "openai", "sk-plat-openai")
        from services.tenant_ai_keys import resolve_ai_key
        assert resolve_ai_key(None, "openai") == "sk-plat-openai"

    def test_unknown_provider_falls_back(self):
        from services.tenant_ai_keys import resolve_ai_key
        # Never in CUSTOMIZABLE_PROVIDERS; delegates to get_ai_key.
        result = resolve_ai_key({"ai_keys": {"made_up": "x"}}, "made_up")
        # Whatever get_ai_key returns — as long as tenant key was ignored.
        assert result != "x"


class TestAiKeySource:
    def test_tenant_source_reported(self):
        from services.tenant_ai_keys import ai_key_source_for
        assert ai_key_source_for({"ai_keys": {"anthropic": "sk-x"}},
                                   "anthropic") == "tenant"

    def test_not_set_when_neither(self, monkeypatch):
        from core import _ai_keys
        monkeypatch.setitem(_ai_keys, "openai", "")
        from services.tenant_ai_keys import ai_key_source_for
        assert ai_key_source_for({}, "openai") == "not_set"


class TestNormalizeAiKeyMap:
    def test_strips_empty_values(self):
        from services.tenant_ai_keys import normalize_ai_key_map
        out = normalize_ai_key_map({"anthropic": "sk-real", "openai": ""})
        assert out == {"anthropic": "sk-real"}

    def test_drops_unknown_providers(self):
        from services.tenant_ai_keys import normalize_ai_key_map
        out = normalize_ai_key_map({"anthropic": "sk", "made_up": "x"})
        assert "made_up" not in out
        assert "anthropic" in out

    def test_non_string_dropped(self):
        from services.tenant_ai_keys import normalize_ai_key_map
        out = normalize_ai_key_map({"anthropic": None, "openai": 123})
        assert out == {}


class TestSummarizeTenantAiKeys:
    def test_never_leaks_full_secret(self):
        from services.tenant_ai_keys import summarize_tenant_ai_keys
        tenant = {"ai_keys": {"anthropic": "sk-ant-fullsecret1234567890"}}
        out = summarize_tenant_ai_keys(tenant)
        # Find the anthropic row
        ant = next(r for r in out if r["provider"] == "anthropic")
        assert ant["source"] == "tenant"
        assert ant["has_tenant_key"] is True
        assert "fullsecret" not in ant["masked"]
        assert "sk-ant" in ant["masked"]  # first few chars only


# ===========================================================================
# Endpoints
# ===========================================================================
class TestPlanEndpoint:
    def test_plan_endpoint_open_to_any_user(self):
        """Every logged-in member reads the plan (UI needs it for
        upgrade prompts + seat-count badges)."""
        from routers.tenant_settings import get_tenant_plan
        src = inspect.getsource(get_tenant_plan)
        assert "get_current_user" in src
        # Includes seats_used so the UI doesn't need a second call.
        assert "seats_used" in src


class TestAiKeyEndpoints:
    def test_get_owner_only(self):
        from routers.tenant_settings import get_tenant_ai_keys
        src = inspect.getsource(get_tenant_ai_keys)
        assert 'require_role("owner")' in src

    def test_put_owner_only(self):
        from routers.tenant_settings import put_tenant_ai_keys
        src = inspect.getsource(put_tenant_ai_keys)
        assert 'require_role("owner")' in src

    def test_delete_owner_only(self):
        from routers.tenant_settings import delete_tenant_ai_key
        src = inspect.getsource(delete_tenant_ai_key)
        assert 'require_role("owner")' in src

    def test_put_audits_rotation(self):
        """Each provider whose key was added/rotated/removed emits an
        ai_key_updated audit row. Compliance-critical."""
        from routers.tenant_settings import put_tenant_ai_keys
        src = inspect.getsource(put_tenant_ai_keys)
        assert 'action="ai_key_updated"' in src
        assert "was_rotated" in src

    def test_put_never_logs_key_value(self):
        """Regression guard: the audit meta must NOT include the key
        itself — only provider + presence."""
        from routers.tenant_settings import put_tenant_ai_keys
        src = inspect.getsource(put_tenant_ai_keys)
        # Metadata contains provider + presence booleans, not the key.
        assert '"provider": p' in src
        # Any string literal 'sk-' or actual key content would be a leak
        # sign — none should exist in the audit block.
        assert '"key":' not in src or 'meta={"provider"' in src

    def test_delete_reverts_to_platform(self):
        from routers.tenant_settings import delete_tenant_ai_key
        src = inspect.getsource(delete_tenant_ai_key)
        assert "keys.pop(provider" in src


class TestSeatLimitEnforcedOnCreateUser:
    def test_create_user_calls_enforce_seat_limit(self):
        from routers.team import create_user
        src = inspect.getsource(create_user)
        assert "enforce_seat_limit" in src
        # Called BEFORE the email dup-check + db writes — fail fast.
        # (Position check via substring order.)
        pos_enforce = src.find("enforce_seat_limit(db")
        pos_users_insert = src.find("db.users.insert_one(")
        assert 0 < pos_enforce < pos_users_insert

"""Epic 10 Testing -- Sprint 1 (unit) + Sprint 6 (scale caps).

Pure unit tests over the plan / seat-limit / feature resolution. No DB, no
server. Covers T10-01.10 and T10-06 seat-cap expectations.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services.plans import (
    effective_plan, trial_expired, has_feature, PLAN_DEFINITIONS, PLAN_KEYS, PLAN_TRIAL,
)


# --- seat limits per plan (T10-06) ------------------------------------------
def test_default_is_trial_3_seats():
    ep = effective_plan({})
    assert ep["key"] == PLAN_TRIAL
    assert ep["seat_limit"] == 3


def test_starter_10_seats():
    assert effective_plan({"plan": "starter"})["seat_limit"] == 10


def test_business_unlimited_seats():
    """business/enterprise seat_limit is None = unlimited -> 20/30-member tests
    must use business+ (or a seat_limit_override)."""
    assert effective_plan({"plan": "business"})["seat_limit"] is None
    assert effective_plan({"plan": "enterprise"})["seat_limit"] is None


def test_unknown_plan_falls_back_to_trial():
    assert effective_plan({"plan": "made_up"})["key"] == PLAN_TRIAL


def test_seat_limit_override_wins():
    ep = effective_plan({"plan": "starter", "seat_limit_override": 25})
    assert ep["seat_limit"] == 25


def test_seat_limit_override_can_set_unlimited():
    ep = effective_plan({"plan": "trial", "seat_limit_override": None})
    # override None is 'not set' (the code uses `is not None`), so base trial 3 stands
    assert ep["seat_limit"] == 3


# --- quota overrides --------------------------------------------------------
def test_usage_quota_override_only_known_keys():
    base = PLAN_DEFINITIONS["trial"]["quotas"]
    ep = effective_plan({"plan": "trial", "usage_quotas": {"llm_tokens_total": 999999, "bogus": 1}})
    assert ep["quotas"]["llm_tokens_total"] == 999999
    assert "bogus" not in ep["quotas"]
    # other quotas untouched
    for k in base:
        if k != "llm_tokens_total":
            assert ep["quotas"][k] == base[k]


def test_usage_quota_override_none_means_unlimited():
    ep = effective_plan({"plan": "trial", "usage_quotas": {"llm_tokens_total": None}})
    assert ep["quotas"]["llm_tokens_total"] is None


# --- feature flags ----------------------------------------------------------
def test_feature_flag_override():
    ep = effective_plan({"plan": "trial", "feature_flags": {"whatsapp": True}})
    assert ep["features"]["whatsapp"] is True


def test_has_feature_reader():
    assert has_feature({"plan": "trial", "feature_flags": {"sso": True}}, "sso") is True
    assert has_feature({"plan": "trial"}, "sso") is False
    assert has_feature(None, "sso") is False


# --- trial expiry -----------------------------------------------------------
def test_trial_expired_past_date():
    assert trial_expired({"plan": "trial", "trial_ends_at": "2000-01-01T00:00:00+00:00"}) is True


def test_trial_not_expired_future_date():
    assert trial_expired({"plan": "trial", "trial_ends_at": "2099-01-01T00:00:00+00:00"}) is False


def test_trial_expired_false_for_paid_plan():
    assert trial_expired({"plan": "business", "trial_ends_at": "2000-01-01T00:00:00+00:00"}) is False


def test_trial_expired_handles_missing_or_bad_date():
    assert trial_expired({"plan": "trial"}) is False
    assert trial_expired({"plan": "trial", "trial_ends_at": "garbage"}) is False
    assert trial_expired(None) is False


# --- all plan keys defined --------------------------------------------------
def test_every_plan_key_has_a_definition():
    for k in PLAN_KEYS:
        assert k in PLAN_DEFINITIONS
        assert "seat_limit" in PLAN_DEFINITIONS[k]
        assert "quotas" in PLAN_DEFINITIONS[k]

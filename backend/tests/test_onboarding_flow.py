"""FIX-001-D tests: onboarding drafts + AI setup status + retry.

Covers the two gaps the founder surfaced:

  Gap 1: Silent AI degradation during registration.
    - `ai_setup_svc.*_with_status` returns explicit generated/defaulted/failed.
    - summarize_ai_setup_status flips healthy=False when anything didn't
      generate cleanly.

  Gap 2: User loses 7 steps of typing when /register fails.
    - onboarding_drafts_svc.create/patch/get preserves each step.
    - patch_draft rejects unknown step keys (defense in depth).
    - patch_draft refuses to touch a completed draft (no reuse after
      registration consumed it).
    - merge_draft_into_register_input fills gaps but never overrides
      client-provided values.

Pure unit tests — no live DB, no server. Mocks the Mongo interface
plus stubs the AI generators the wrappers delegate to.
"""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest

from services import ai_setup as ai_setup_svc
from services import onboarding_drafts as drafts_svc


# ---------------------------------------------------------------------------
# Fake Mongo interface (minimal — enough for the draft helpers).
# ---------------------------------------------------------------------------
class _FakeColl:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def find_one(self, filt, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                return dict(d)
        return None

    async def update_one(self, filt, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                sets = update.get("$set", {})
                for k, v in sets.items():
                    if "." in k:
                        # dotted-path set (e.g. "step_data.about")
                        head, tail = k.split(".", 1)
                        d.setdefault(head, {})[tail] = v
                    else:
                        d[k] = v
                class _R:
                    matched_count = 1
                return _R()
        class _R:
            matched_count = 0
        return _R()


class _FakeDB:
    def __init__(self):
        self.onboarding_drafts = _FakeColl()


# ---------------------------------------------------------------------------
# ai_setup summarize
# ---------------------------------------------------------------------------
class TestSummarizeAiSetupStatus:
    def test_all_generated_is_healthy(self):
        s = ai_setup_svc.summarize_ai_setup_status({
            "lexicon": "generated",
            "operating_model": "generated",
            "finance_categories": "generated",
        })
        assert s["healthy"] is True
        assert s["needs_retry"] == []

    def test_any_defaulted_flips_unhealthy(self):
        s = ai_setup_svc.summarize_ai_setup_status({
            "lexicon": "generated",
            "operating_model": "defaulted",  # THE textile-fallback case
            "finance_categories": "generated",
        })
        assert s["healthy"] is False
        assert s["needs_retry"] == ["operating_model"]

    def test_all_failed_reported(self):
        s = ai_setup_svc.summarize_ai_setup_status({
            "lexicon": "failed",
            "operating_model": "failed",
            "finance_categories": "failed",
        })
        assert s["healthy"] is False
        assert set(s["needs_retry"]) == {"lexicon", "operating_model", "finance_categories"}

    def test_empty_status_map_is_treated_as_healthy_but_empty(self):
        s = ai_setup_svc.summarize_ai_setup_status({})
        assert s["healthy"] is True
        assert s["needs_retry"] == []
        assert s["detail"] == {}

    def test_none_is_safe(self):
        s = ai_setup_svc.summarize_ai_setup_status(None)
        assert s["healthy"] is True


# ---------------------------------------------------------------------------
# ai_setup: is_meaningful_* predicates (edge cases matter)
# ---------------------------------------------------------------------------
class TestMeaningfulPredicates:
    def test_lexicon_meaningful_when_any_field_populated(self):
        assert ai_setup_svc._is_meaningful_lexicon({"business_terms": ["POS"]}) is True

    def test_lexicon_meaningful_all_empty_is_false(self):
        assert ai_setup_svc._is_meaningful_lexicon({"business_terms": []}) is False
        assert ai_setup_svc._is_meaningful_lexicon({}) is False
        assert ai_setup_svc._is_meaningful_lexicon(None) is False

    def test_operating_model_meaningful_requires_pipelines(self):
        assert ai_setup_svc._is_meaningful_operating_model(
            {"pipelines": [{"key": "procurement", "stages": [{"key": "req"}]}]}) is True
        assert ai_setup_svc._is_meaningful_operating_model({"pipelines": []}) is False
        assert ai_setup_svc._is_meaningful_operating_model({}) is False
        assert ai_setup_svc._is_meaningful_operating_model(None) is False

    def test_finance_meaningful_requires_more_than_just_other(self):
        """normalize_finance_categories always appends 'Other' — so len==1
        means the AI returned nothing and only the sentinel is present."""
        assert ai_setup_svc._is_meaningful_finance({"expense": ["Other"]}) is False
        assert ai_setup_svc._is_meaningful_finance(
            {"expense": ["Raw Material", "Salary", "Other"]}) is True
        assert ai_setup_svc._is_meaningful_finance({}) is False


# ---------------------------------------------------------------------------
# ai_setup wrappers: stub the underlying generators + assert status logic
# ---------------------------------------------------------------------------
class TestAiWrappers:
    def test_operating_model_success_reports_generated(self, monkeypatch):
        async def fake(*a, **k):
            return {"pipelines": [{"key": "procurement", "stages": [{"key": "req"}]}]}
        # Patch on the `server` module the wrapper imports from lazily
        import server
        monkeypatch.setattr(server, "ai_generate_operating_model", fake)
        result, status = asyncio.run(
            ai_setup_svc.ai_generate_operating_model_with_status("bakery", "5-10", [], ""))
        assert status == "generated"
        assert result["pipelines"]

    def test_operating_model_empty_result_reports_defaulted(self, monkeypatch):
        """The failure case that made a bakery silently look textile:
        AI returned no pipelines → the normalize step handed back a
        default → user got the wrong boards without knowing."""
        async def fake(*a, **k):
            # Simulate normalize_operating_model's default-return shape
            return {"pipelines": []}
        import server
        monkeypatch.setattr(server, "ai_generate_operating_model", fake)
        result, status = asyncio.run(
            ai_setup_svc.ai_generate_operating_model_with_status("bakery", "5-10", [], ""))
        assert status == "defaulted"

    def test_operating_model_raise_reports_failed(self, monkeypatch):
        async def boom(*a, **k):
            raise TimeoutError("Anthropic timeout")
        import server
        monkeypatch.setattr(server, "ai_generate_operating_model", boom)
        result, status = asyncio.run(
            ai_setup_svc.ai_generate_operating_model_with_status("bakery", "5-10", [], ""))
        assert status == "failed"
        # Result is still usable (normalized empty), not None
        assert isinstance(result, dict)

    def test_lexicon_wrapper_similar_semantics(self, monkeypatch):
        async def fake_good(*a, **k):
            return {"business_terms": ["POS"], "actions": ["Ship"]}
        import server
        monkeypatch.setattr(server, "ai_generate_lexicon", fake_good)
        result, status = asyncio.run(
            ai_setup_svc.ai_generate_lexicon_with_status("bakery", "", [], ""))
        assert status == "generated"

    def test_finance_wrapper_similar_semantics(self, monkeypatch):
        async def fake_good(*a, **k):
            return {"expense": ["Ingredients", "Rent", "Other"], "asset": ["Oven", "Other"]}
        import server
        monkeypatch.setattr(server, "ai_generate_finance_categories", fake_good)
        result, status = asyncio.run(
            ai_setup_svc.ai_generate_finance_categories_with_status("bakery", "", [], ""))
        assert status == "generated"


# ---------------------------------------------------------------------------
# onboarding_drafts: CRUD + step validation
# ---------------------------------------------------------------------------
class TestDraftCrud:
    def test_create_returns_new_draft_with_id(self):
        db = _FakeDB()
        doc = asyncio.run(drafts_svc.create_draft(db, email="raj@boutique.in"))
        assert doc["id"]
        assert doc["email"] == "raj@boutique.in"
        assert doc["step_data"] == {}
        assert doc["completed_at"] is None
        assert doc["ai_calls"] == {}

    def test_email_normalized_lowercase(self):
        db = _FakeDB()
        doc = asyncio.run(drafts_svc.create_draft(db, email="RAJ@BOUTIQUE.IN "))
        assert doc["email"] == "raj@boutique.in"

    def test_get_returns_none_for_missing(self):
        db = _FakeDB()
        assert asyncio.run(drafts_svc.get_draft(db, "ghost")) is None

    def test_patch_saves_step_data(self):
        db = _FakeDB()
        d = asyncio.run(drafts_svc.create_draft(db, email="raj@boutique.in"))
        updated = asyncio.run(drafts_svc.patch_draft(db, d["id"], "about",
                              {"company_name": "Raj Boutique", "industry": "clothing"}))
        assert updated is not None
        assert updated["step_data"]["about"]["company_name"] == "Raj Boutique"
        assert updated["step_data"]["about"]["industry"] == "clothing"

    def test_patch_rejects_unknown_step(self):
        """A client shouldn't be able to stash arbitrary keys in the draft
        (defense against draft-as-scratchpad abuse)."""
        db = _FakeDB()
        d = asyncio.run(drafts_svc.create_draft(db))
        result = asyncio.run(drafts_svc.patch_draft(db, d["id"], "not_a_real_step",
                                                    {"anything": "goes"}))
        assert result is None  # rejected

    def test_patch_multiple_steps_accumulates(self):
        db = _FakeDB()
        d = asyncio.run(drafts_svc.create_draft(db))
        asyncio.run(drafts_svc.patch_draft(db, d["id"], "about", {"industry": "bakery"}))
        asyncio.run(drafts_svc.patch_draft(db, d["id"], "scale", {"team_size": 8}))
        final = asyncio.run(drafts_svc.get_draft(db, d["id"]))
        assert final["step_data"]["about"]["industry"] == "bakery"
        assert final["step_data"]["scale"]["team_size"] == 8

    def test_mark_completed_prevents_further_patches(self):
        """After registration consumes a draft, it can't be edited or re-used."""
        db = _FakeDB()
        d = asyncio.run(drafts_svc.create_draft(db))
        asyncio.run(drafts_svc.mark_completed(db, d["id"], "tenant-123"))
        result = asyncio.run(drafts_svc.patch_draft(db, d["id"], "about", {"anything": "goes"}))
        assert result is None  # locked

    def test_record_ai_call_never_raises(self):
        db = _FakeDB()
        d = asyncio.run(drafts_svc.create_draft(db))
        # Should not raise even for non-existent draft
        asyncio.run(drafts_svc.record_ai_call(db, "ghost", "os_blueprint", "failed"))
        asyncio.run(drafts_svc.record_ai_call(db, d["id"], "os_blueprint", "failed"))
        final = asyncio.run(drafts_svc.get_draft(db, d["id"]))
        assert final["ai_calls"]["os_blueprint"] == "failed"


# ---------------------------------------------------------------------------
# Draft -> register merge semantics
# ---------------------------------------------------------------------------
class TestDraftMerge:
    def test_client_values_win_over_draft(self):
        """If user edits the final screen, client value overrides the draft."""
        draft = {"step_data": {"about": {"company_name": "OLD Bakery"}}}
        provided = {"company_name": "NEW Bakery"}
        merged = drafts_svc.merge_draft_into_register_input(draft, provided)
        assert merged["company_name"] == "NEW Bakery"

    def test_draft_fills_missing_client_values(self):
        """The real recovery case: /register was retried after a crash,
        client re-sent the payload but forgot half the fields — draft
        fills them in."""
        draft = {"step_data": {
            "about": {"company_name": "Raj Boutique", "industry": "clothing"},
            "scale": {"team_size": "10-25", "currency": "INR"},
        }}
        provided = {"email": "raj@x.in", "password": "hunter22"}
        merged = drafts_svc.merge_draft_into_register_input(draft, provided)
        assert merged["company_name"] == "Raj Boutique"
        assert merged["industry"] == "clothing"
        assert merged["company_size"] == "10-25"
        assert merged["currency"] == "INR"
        # Client-provided ones untouched
        assert merged["email"] == "raj@x.in"
        assert merged["password"] == "hunter22"

    def test_none_draft_returns_provided_unchanged(self):
        provided = {"company_name": "Anything"}
        assert drafts_svc.merge_draft_into_register_input(None, provided) is provided

    def test_empty_string_client_treated_as_missing(self):
        """An empty string in client input is not a "value" — draft still fills."""
        draft = {"step_data": {"about": {"industry": "bakery"}}}
        provided = {"industry": ""}
        merged = drafts_svc.merge_draft_into_register_input(draft, provided)
        assert merged["industry"] == "bakery"

    def test_os_blueprint_passed_through(self):
        draft = {"step_data": {"os_blueprint": {"departments": [{"key": "kitchen"}], "workflows": []}}}
        merged = drafts_svc.merge_draft_into_register_input(draft, {})
        assert merged["os_blueprint"]["departments"] == [{"key": "kitchen"}]

"""WE-03 (2026-08-16) — structured stage objects on pipelines[].stages[].

Runs offline (no DB, no HTTP) — normalize_operating_model is a pure
function, so these tests are the safest thing in the suite to keep
green forever. Any future edit to _norm_stage that breaks empty-default
preservation will show up here.
"""
import pytest

from core import normalize_operating_model, DEFAULT_OPERATING_MODEL


NEW_STAGE_FIELDS = ("tasks", "approval", "side_effects")


def _first_stage(om: dict) -> dict:
    return om["pipelines"][0]["stages"][0]


def test_old_string_stages_upgrade_with_empty_defaults():
    """A pre-WE-03 tenant with string stage entries lands on the new
    shape with all three fields defaulted to empty."""
    r = normalize_operating_model({
        "pipelines": [{"key": "p", "label": "P", "stages": ["first", "second"]}]
    })
    st = _first_stage(r)
    assert st == {"key": "first", "label": "first",
                  "tasks": [], "approval": None, "side_effects": []}


def test_old_dict_stages_upgrade_with_empty_defaults():
    """A pre-WE-03 tenant with {key,label} stage dicts also gets the
    new fields defaulted."""
    r = normalize_operating_model({
        "pipelines": [{"key": "p", "label": "P",
                       "stages": [{"key": "a", "label": "A"}]}]
    })
    st = _first_stage(r)
    for field in NEW_STAGE_FIELDS:
        assert field in st, f"missing {field!r} after normalize"
    assert st["tasks"] == [] and st["approval"] is None and st["side_effects"] == []


def test_full_new_shape_roundtrip():
    """New shape with all three fields populated survives normalize."""
    inp = {"pipelines": [{"key": "p", "label": "P", "stages": [{
        "key": "confirmed", "label": "Confirmed",
        "tasks": [{"title": "Confirm with customer", "role": "sales",
                   "evidence_required": True}],
        "approval": {"role": "owner", "required": True},
        "side_effects": [{"kind": "create_expense",
                          "params": {"category": "cogs"}}],
    }]}]}
    st = _first_stage(normalize_operating_model(inp))
    assert st["tasks"] == [{"title": "Confirm with customer", "role": "sales",
                            "evidence_required": True}]
    assert st["approval"] == {"role": "owner", "required": True}
    assert st["side_effects"] == [{"kind": "create_expense",
                                   "params": {"category": "cogs"}}]


def test_bad_input_hygiene():
    """Empty title strips the task; empty approval role -> None; non-dict
    side-effect entries stripped; non-dict params reset to {}. This is
    the guarantee that AI-generated garbage can't corrupt the store."""
    inp = {"pipelines": [{"key": "p", "label": "P", "stages": [{
        "key": "x", "label": "X",
        "tasks": [{"title": ""}, {"title": "Real", "role": "sales"}, None,
                  {"title": "x" * 300}],
        "approval": {"role": "", "required": True},
        "side_effects": [{"kind": ""}, "garbage", {"kind": "ok", "params": "no"}],
    }]}]}
    st = _first_stage(normalize_operating_model(inp))
    assert len(st["tasks"]) == 2
    assert st["tasks"][0] == {"title": "Real", "role": "sales",
                              "evidence_required": False}
    assert len(st["tasks"][1]["title"]) == 120  # truncated to cap
    assert st["approval"] is None  # empty role dropped the whole gate
    assert len(st["side_effects"]) == 1
    assert st["side_effects"][0] == {"kind": "ok", "params": {}}


def test_per_stage_caps_enforced():
    """6 tasks + 6 side-effects max per stage — prevents pathological
    operating_model docs from blowing up tenant document size."""
    inp = {"pipelines": [{"key": "p", "label": "P", "stages": [{
        "key": "x", "label": "X",
        "tasks": [{"title": f"t{i}", "role": "sales"} for i in range(20)],
        "side_effects": [{"kind": f"k{i}"} for i in range(20)],
    }]}]}
    st = _first_stage(normalize_operating_model(inp))
    assert len(st["tasks"]) == 6
    assert len(st["side_effects"]) == 6


def test_default_operating_model_normalizes_cleanly():
    """DEFAULT_OPERATING_MODEL only has {key,label} stages. After
    WE-03 normalization every stage picks up empty defaults — the
    behaviour test that proves no existing tenant loses anything."""
    r = normalize_operating_model(DEFAULT_OPERATING_MODEL)
    assert len(r["pipelines"]) == 3
    for p in r["pipelines"]:
        for st in p["stages"]:
            assert st["tasks"] == []
            assert st["approval"] is None
            assert st["side_effects"] == []


def test_normalize_is_idempotent():
    """Running normalize twice returns the exact same document — critical
    for the migration ledger's "already applied = skip" model. If this
    ever fails, the WE-03 migration would rewrite every tenant on every
    boot instead of being a one-time transform."""
    r1 = normalize_operating_model(DEFAULT_OPERATING_MODEL)
    r2 = normalize_operating_model(r1)
    assert r1 == r2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

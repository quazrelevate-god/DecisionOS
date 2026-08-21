"""Epic 8 Sprint 2 — unit tests for the normalizers extracted to shared/normalizers.py.

Pure, in-process tests (no backend / Mongo / network). They pin the behaviour of
the blueprint / lexicon / operating-model coercion that moved out of core.py, and
verify core.py still re-exports the same objects so `from core import ...` is intact.
"""
import pytest

from shared import normalizers as sn
from shared.normalizers import (
    normalize_os_blueprint, normalize_lexicon, normalize_operating_model,
    DEFAULT_OPERATING_MODEL, DEFAULT_LEXICON,
)


# --- lexicon ---------------------------------------------------------------
def test_lexicon_defaults_on_empty():
    out = normalize_lexicon({})
    assert out["customer_singular"] == "Customer"
    assert out["vendor_plural"] == "Suppliers"
    assert set(out["task_types"]) == set(DEFAULT_LEXICON["task_types"])
    assert out["task_types"]["hr"] == "HR"


def test_lexicon_override_keeps_known_drops_unknown():
    out = normalize_lexicon({
        "customer_singular": "Client",
        "task_types": {"sales": "Deals", "not_a_key": "x"},
    })
    assert out["customer_singular"] == "Client"
    assert out["task_types"]["sales"] == "Deals"
    assert "not_a_key" not in out["task_types"]          # unknown key filtered
    assert out["task_types"]["purchase"] == "Purchase"   # untouched default


def test_lexicon_blank_falls_back_to_default():
    out = normalize_lexicon({"customer_singular": "   "})
    assert out["customer_singular"] == "Customer"


# --- blueprint -------------------------------------------------------------
def test_blueprint_departments_slug_dedup_and_owner_excluded():
    out = normalize_os_blueprint({
        "departments": ["Sales", {"label": "Ops/Floor"}, {"name": "HR"},
                        "owner", {"label": ""}, "Sales"],
    })
    keys = [d["key"] for d in out["departments"]]
    assert "owner" not in keys              # owner is reserved / excluded
    assert keys.count("sales") == 1         # deduped by slug
    assert "ops_floor" in keys              # slugified (/ -> _)
    assert all(d["label"] for d in out["departments"])  # blanks dropped


def test_blueprint_departments_capped_at_12():
    out = normalize_os_blueprint({"departments": [f"D{i}" for i in range(30)]})
    assert len(out["departments"]) == 12


def test_blueprint_tasks_and_rules_shapes():
    out = normalize_os_blueprint({
        "operational_tasks": ["Cut", {"title": "Stitch", "category": "Production"}],
        "approval_rules": ["Sign-off", {"name": "Finance", "description": "over 50k"}],
    })
    assert {"title": "Cut", "category": "Other"} in out["operational_tasks"]
    assert {"title": "Stitch", "category": "Production"} in out["operational_tasks"]
    assert {"name": "Sign-off", "description": ""} in out["approval_rules"]
    assert {"name": "Finance", "description": "over 50k"} in out["approval_rules"]


# --- operating model -------------------------------------------------------
def test_operating_model_defaults_on_empty():
    out = normalize_operating_model({})
    assert out["pipelines"] == DEFAULT_OPERATING_MODEL["pipelines"]
    assert out["task_categories"] == DEFAULT_OPERATING_MODEL["task_categories"]


def test_operating_model_stage_task_approval_side_effects():
    out = normalize_operating_model({
        "pipelines": [{
            "label": "Make",
            "stages": [
                "Start",
                {"label": "Mid", "key": "mid",
                 "tasks": [{"title": "do", "role": "Floor Ops", "evidence_required": True}],
                 "approval": {"role": "Owner", "required": True},
                 "side_effects": [{"kind": "create_expense", "params": {"amt": 5}}]},
                {"name": "End"},
            ],
        }],
        "task_categories": ["Sales", {"label": "Finance", "key": "fin"}],
    })
    pipe = out["pipelines"][0]
    assert pipe["key"] == "make"
    stage_keys = [s["key"] for s in pipe["stages"]]
    assert stage_keys == ["start", "mid", "end"]
    mid = pipe["stages"][1]
    assert mid["tasks"][0] == {"title": "do", "role": "floor_ops", "evidence_required": True}
    assert mid["approval"] == {"role": "owner", "required": True}
    assert mid["side_effects"][0]["kind"] == "create_expense"
    cats = [c["key"] for c in out["task_categories"]]
    assert cats == ["sales", "fin"]


def test_operating_model_caps_pipelines_stages_categories():
    om = {
        "pipelines": [
            {"label": f"P{i}", "stages": [f"s{j}" for j in range(12)]}
            for i in range(10)
        ],
        "task_categories": [f"C{i}" for i in range(20)],
    }
    out = normalize_operating_model(om)
    assert len(out["pipelines"]) <= 6
    assert all(len(p["stages"]) <= 8 for p in out["pipelines"])
    assert len(out["task_categories"]) <= 10


def test_operating_model_approval_stage_must_match_a_stage_key():
    out = normalize_operating_model({
        "pipelines": [{"label": "Buy", "approval_stage": "ghost",
                       "stages": ["Req", "Approved"]}],
    })
    # 'ghost' is not among the stage keys -> coerced to None
    assert out["pipelines"][0]["approval_stage"] is None


def test_stage_task_title_truncated_to_120():
    long_title = "x" * 200
    out = normalize_operating_model({
        "pipelines": [{"label": "P", "stages": [
            {"label": "S", "tasks": [{"title": long_title}]}]}],
    })
    assert len(out["pipelines"][0]["stages"][0]["tasks"][0]["title"]) == 120


# --- core re-export contract ----------------------------------------------
def test_core_reexports_same_objects():
    """`from core import normalize_* / DEFAULT_OPERATING_MODEL` must resolve to the
    exact objects now living in shared.normalizers (import env may be unset locally)."""
    core = pytest.importorskip("core")
    assert core.normalize_lexicon is sn.normalize_lexicon
    assert core.normalize_operating_model is sn.normalize_operating_model
    assert core.normalize_os_blueprint is sn.normalize_os_blueprint
    assert core.DEFAULT_OPERATING_MODEL is sn.DEFAULT_OPERATING_MODEL

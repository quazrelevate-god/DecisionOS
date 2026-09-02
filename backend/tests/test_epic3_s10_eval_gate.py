"""Epic 3 Sprint 10 -- E3-10.4 (golden-set + CI regression gate) + E3-10.6
(model-comparison benchmark harness).

E3-10.4: the golden set is the AI regression gate -- test_epic3_s1_evals.py already
replays every golden case in CI (a prompt/route change that breaks a case fails the
build). This file adds the ANTI-SHRINK half: per-domain coverage floors so the
golden set can't be quietly gutted, and asserts the whole set still replays green.

E3-10.6: tests the benchmark harness plumbing (route override per model, tabulation,
ranking, override cleanup) offline in replay mode -- the real A/B is `python -m
evals.benchmark --models ... --live`.
"""
import asyncio
from collections import Counter

import evals  # noqa: F401 -- registers all cases
from evals.base import all_cases, run_all
from evals.benchmark import benchmark_models, rank
from config import MODELS, model_for, MODEL_ROUTES


# ===========================================================================
# E3-10.4 -- golden-set coverage floors (anti-shrink regression gate)
# ===========================================================================
def _golden_by_domain():
    c = Counter(x.domain for x in all_cases() if x.golden is not None)
    return c


# floors sit just below current counts: they catch DELETION of coverage without
# being brittle to a single case being retired. Bump them up as the set grows.
_DOMAIN_FLOORS = {
    "captures": 5, "coaching": 3, "documents": 5,
    "extraction": 10, "generators": 4, "onboarding": 8,
}


def test_golden_set_total_floor():
    total = sum(1 for c in all_cases() if c.golden is not None)
    assert total >= 36, f"golden set shrank to {total} replayable cases (floor 36)"


def test_every_core_domain_meets_its_floor():
    counts = _golden_by_domain()
    short = {d: (counts.get(d, 0), floor) for d, floor in _DOMAIN_FLOORS.items()
             if counts.get(d, 0) < floor}
    assert not short, f"domains below their golden-coverage floor (have, need): {short}"


def test_every_case_task_routes_to_a_real_model():
    # a case whose task has no resolvable model would blow up live -> guard it here.
    for c in all_cases():
        prov, mid = model_for(c.task, "vision" if c.domain == "documents" and "extract" in c.task else "llm")
        assert prov and mid, f"{c.task} resolved to an empty model {(prov, mid)}"


def test_whole_golden_set_replays_green():
    # the regression gate itself: every recorded golden still passes its checks.
    results = asyncio.run(run_all(live=False))
    failed = [(r.case.task, r.case.name, r.failed_checks or r.error)
              for r in results if r.status == "fail"]
    assert not failed, f"golden replay regressions: {failed}"


# ===========================================================================
# E3-10.6 -- model-comparison benchmark harness plumbing
# ===========================================================================
def test_benchmark_produces_a_report_per_model():
    report = asyncio.run(benchmark_models(
        ["claude-sonnet", "gemini-flash-3"], domain="captures", live=False))
    assert set(report) == {"claude-sonnet", "gemini-flash-3"}
    for m, r in report.items():
        assert r["model_id"] == MODELS[m][1]
        assert r["ran"] >= 1 and r["passed"] == r["ran"]      # replay: every case passes
        assert 0.0 <= r["pass_rate"] <= 1.0
        assert isinstance(r["avg_latency_ms"], float)
        assert len(r["rows"]) == r["cases"]


def test_benchmark_clears_route_overrides_afterward():
    default = MODEL_ROUTES.get("captures.triage")           # 'claude-sonnet'
    asyncio.run(benchmark_models(["gemini-flash-3"], domain="captures", live=False))
    # after the run, no override leaks -> the task resolves to its catalog default again
    prov, mid = model_for("captures.triage")
    assert (prov, mid) == MODELS[default], f"route override leaked: {(prov, mid)}"


def test_benchmark_rejects_unknown_model():
    import pytest
    with pytest.raises(ValueError):
        asyncio.run(benchmark_models(["not-a-model"], domain="captures", live=False))


def test_benchmark_rejects_empty_selection():
    import pytest
    with pytest.raises(ValueError):
        asyncio.run(benchmark_models(["claude-sonnet"], task="nonexistent.task", live=False))


def test_rank_orders_best_first():
    fake = {
        "a": {"model": "a", "pass_rate": 0.8, "avg_latency_ms": 100.0},
        "b": {"model": "b", "pass_rate": 1.0, "avg_latency_ms": 500.0},
        "c": {"model": "c", "pass_rate": 1.0, "avg_latency_ms": 200.0},
    }
    order = [r["model"] for r in rank(fake)]
    assert order == ["c", "b", "a"]   # higher pass-rate first; latency breaks the b/c tie

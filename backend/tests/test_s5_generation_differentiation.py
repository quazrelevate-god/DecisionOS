"""Epic 10 Testing -- Sprint 5, the REAL niche-differentiation gate (T10-05.12).

Unlike test_s5_niches.py (which asserts hand-seeded factory data), this runs the
ACTUAL AI operating-model generator (services.ai.generators.ai_generate_operating_model)
for several distinct industries and proves the model designs a DIFFERENT
operating system per niche -- distinct pipelines + niche-specific stages, not a
textile template copied onto everyone.

LIVE-ONLY: it calls the real model. Skipped unless RUN_LIVE_LLM=1 (so CI stays
free/deterministic). Run it with:
    RUN_LIVE_LLM=1 .venv/Scripts/python -m pytest tests/test_s5_generation_differentiation.py -o addopts=""
"""
import asyncio
import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("RUN_LIVE_LLM"),
    reason="live-LLM niche-differentiation gate; set RUN_LIVE_LLM=1 to run")


NICHES = [
    ("Textile & Apparel", "bulk woven + dyed fabric for garment brands"),
    ("Logistics & Transport", "refrigerated trucking + cold storage for dairy and pharma"),
    ("Restaurant / Food & Beverage", "sit-down restaurant + a delivery arm"),
    ("Healthcare", "single-doctor GP clinic with a pharmacy counter"),
]


def _sig(om):
    """The set of NON-universal pipeline keys -- 'procurement' is shared by every
    business, so it's excluded from the niche signature."""
    return frozenset(
        (p.get("key") or "").lower()
        for p in (om.get("pipelines") or [])
        if (p.get("key") or "").lower() not in {"procurement", "purchase", "purchase_payment"})


def _all_stage_keys(om):
    return {(s.get("key") or "").lower()
            for p in (om.get("pipelines") or []) for s in (p.get("stages") or [])}


def test_ai_generates_distinct_operating_models_per_niche():
    from services.ai.generators import ai_generate_operating_model

    async def run():
        out = {}
        for industry, desc in NICHES:
            out[industry] = await ai_generate_operating_model(industry, "11-50", [], desc)
        return out

    models = asyncio.run(run())

    # 1. Every niche produced a real multi-pipeline operating model.
    for ind, om in models.items():
        assert len(om.get("pipelines") or []) >= 3, f"[{ind}] too few pipelines: {om.get('pipelines')}"

    # 2. Each niche's NON-universal pipeline signature is DISTINCT -- no two
    #    niches got the same operating model, and none is a textile copy.
    sigs = {ind: _sig(om) for ind, om in models.items()}
    assert len(set(sigs.values())) == len(sigs), \
        f"niches share an operating-model signature (template leak): {sigs}"
    textile_sig = sigs["Textile & Apparel"]
    for ind, s in sigs.items():
        if ind != "Textile & Apparel":
            assert s != textile_sig, f"[{ind}] reuses the textile pipeline set"
            assert not (s <= textile_sig), f"[{ind}] is a subset of textile -- no niche-specific pipeline"

    # 3. Niche-specific STAGES show up where the domain demands them (robust to
    #    exact wording via substring probes).
    def stage_has(ind, *needles):
        blob = " ".join(_all_stage_keys(models[ind]))
        return any(n in blob for n in needles)

    assert stage_has("Textile & Apparel", "dye", "finish", "grey", "fabric", "stitch", "production"), \
        "textile model has no production/dyeing stage"
    assert stage_has("Logistics & Transport", "transit", "dispatch", "delivered", "storage", "load", "pod"), \
        "logistics model has no transit/storage stage"
    assert stage_has("Restaurant / Food & Beverage", "kitchen", "prep", "served", "table", "order", "delivery"), \
        "restaurant model has no kitchen/service stage"
    assert stage_has("Healthcare", "appointment", "consult", "patient", "prescription", "follow", "visit"), \
        "clinic model has no appointment/consultation stage"

    # 4. The universal pipeline is the ONLY thing they may share -- prove real
    #    variety: at least len(niches) distinct non-universal pipeline keys total.
    all_niche_pipes = set().union(*sigs.values())
    assert len(all_niche_pipes) >= 2 * len(NICHES), \
        f"not enough niche-specific pipeline variety across {len(NICHES)} niches: {all_niche_pipes}"

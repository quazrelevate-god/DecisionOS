"""Epic 3 Sprint 1 (E3-01.4): the AI golden-set eval harness runs in CI.

Replay-mode eval cases are deterministic, DB-free and network-free (the LLM call
is stubbed to the recorded golden response), so the whole golden set runs here as
ordinary unit tests -- a prompt or model change that breaks an AI function's shape
fails the suite instead of shipping. The `--live` mode (real model) is run
manually against the preview backend; it's not exercised here.
"""
import asyncio

import pytest

import evals  # noqa: F401 -- registers all cases
from evals.base import all_cases, run_case
from prompts import all_prompts


REPLAY_CASES = [c for c in all_cases() if c.golden is not None]


def test_harness_has_cases():
    assert len(REPLAY_CASES) >= 15, "golden set unexpectedly small -- did case registration break?"


@pytest.mark.parametrize("case", REPLAY_CASES, ids=lambda c: f"{c.task}::{c.name}")
def test_golden_case_replay(case):
    """Each recorded (input -> response) pair produces the asserted output shape."""
    result = asyncio.run(run_case(case, live=False))
    assert result.error is None, f"{case.task}/{case.name} crashed: {result.error}"
    failed = result.failed_checks
    assert not failed, f"{case.task}/{case.name} failed checks: {failed}"


def test_every_case_task_is_a_registered_prompt():
    """An eval case's task must be a real prompt-registry name -- this keeps the
    eval set, the prompt registry, the model routes and telemetry all keyed the
    same way, so a renamed prompt can't silently orphan its evals."""
    known = set(all_prompts())
    for c in all_cases():
        assert c.task in known, f"eval case {c.name!r} targets unknown prompt {c.task!r}"

"""AI golden-set eval harness (Epic 3 Sprint 1 -- E3-01.4).

Importing ``evals`` self-registers every golden case and exposes the runner.
See evals/base.py for the design; run with ``python -m evals.run``.
"""
from evals.base import (  # noqa: F401
    EvalCase, register, all_cases, run_case, run_all, CaseResult,
)
from evals import cases  # noqa: F401 -- self-registers all cases on import

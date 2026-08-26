"""Golden-set eval harness core (Epic 3 Sprint 1 -- E3-01.4).

The AI layer now has a registry (versioned prompts), central model routing, and
per-call telemetry. This is the fourth leg: a way to prove that a prompt tweak or
a model swap did NOT quietly break a function's output before it ships.

A *golden case* is one recorded ``(input -> raw model response)`` pair plus a set
of shape/spot-check assertions. The harness runs the REAL AI function over the
recorded input in one of two modes:

* **replay** (default, free, deterministic, CI-safe) -- the LLM call is stubbed to
  return the recorded ``golden`` response, so the function's own prompt-render,
  model-routing, JSON-parse and normalization logic all execute for real. This
  catches the regressions that actually happen: a renamed prompt placeholder
  (``render`` raises), a parse/clamp/default that stops handling a field, a route
  that points at a missing model. Zero tokens, no DB, no network.

* **live** (``--live``) -- no stub; the real model answers. Same shape assertions,
  now catching quality/drift regressions (a prompt change that makes the model
  emit the wrong shape, out-of-range scores, or empty results). Needs a key +
  the preview backend.

Checks assert on *shape and invariants*, never exact strings -- AI output is
non-deterministic, so an eval that pins the exact text is an eval that cries wolf.

Run:  python -m evals.run            # replay every registered case (free)
      python -m evals.run --live     # re-run against the real model
      python -m evals.run --task extraction.extract
      python -m evals.run --domain extraction --json
"""
from __future__ import annotations

import asyncio
import contextlib
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


# --- Check builders ---------------------------------------------------------
# A check is (label, fn) where fn(result) raises AssertionError on failure. The
# builders below cover the invariants we tune on; use `predicate` for anything
# bespoke. Keep them asserting SHAPE, not exact wording.

Check = tuple[str, Callable[[Any], None]]


def key_present(k: str) -> Check:
    def _f(r):
        assert isinstance(r, dict) and k in r, f"missing key {k!r}"
    return (f"has {k!r}", _f)


def is_type(k: str, t) -> Check:
    tname = getattr(t, "__name__", str(t))
    def _f(r):
        assert isinstance(r.get(k), t), f"{k!r} is {type(r.get(k)).__name__}, want {tname}"
    return (f"{k!r} is {tname}", _f)


def is_list(k: str) -> Check:
    return is_type(k, list)


def nonempty_list(k: str) -> Check:
    def _f(r):
        v = r.get(k)
        assert isinstance(v, list) and len(v) > 0, f"{k!r} is empty/not a list"
    return (f"{k!r} nonempty list", _f)


def nonempty_str(k: str) -> Check:
    def _f(r):
        v = r.get(k)
        assert isinstance(v, str) and v.strip(), f"{k!r} is blank"
    return (f"{k!r} nonempty str", _f)


def in_range(k: str, lo: float, hi: float) -> Check:
    def _f(r):
        v = r.get(k)
        assert isinstance(v, (int, float)), f"{k!r} not numeric: {v!r}"
        assert lo <= v <= hi, f"{k!r}={v} out of [{lo},{hi}]"
    return (f"{lo}<={k!r}<={hi}", _f)


def one_of(k: str, allowed) -> Check:
    allowed = list(allowed)
    def _f(r):
        assert r.get(k) in allowed, f"{k!r}={r.get(k)!r} not in {allowed}"
    return (f"{k!r} in {allowed}", _f)


def each_item(k: str, *item_checks: Check) -> Check:
    """Run item-level checks against every dict in list r[k] (min one item)."""
    def _f(r):
        items = r.get(k)
        assert isinstance(items, list) and items, f"{k!r} empty/not a list"
        for i, it in enumerate(items):
            for lbl, fn in item_checks:
                try:
                    fn(it)
                except AssertionError as e:
                    raise AssertionError(f"{k}[{i}].{lbl}: {e}")
    labels = ", ".join(lbl for lbl, _ in item_checks)
    return (f"each {k!r}: {labels}", _f)


def predicate(label: str, fn: Callable[[Any], bool]) -> Check:
    def _f(r):
        assert fn(r), label
    return (label, _f)


# --- Case model + registry --------------------------------------------------
@dataclass
class EvalCase:
    task: str                      # prompt-registry name -- ties eval to prompt/route/telemetry
    name: str                      # unique case id within the task
    fn: Callable                   # the async AI function under test
    kwargs: dict                   # fixed recorded input
    checks: list                   # list of Check
    golden: Optional[str] = None   # recorded raw model text; None => live-only
    note: str = ""                 # what this case guards / why it exists

    @property
    def domain(self) -> str:
        return self.task.split(".", 1)[0]


_CASES: list[EvalCase] = []


def register(case: EvalCase) -> EvalCase:
    if any(c.task == case.task and c.name == case.name for c in _CASES):
        raise ValueError(f"duplicate eval case: {case.task}/{case.name}")
    _CASES.append(case)
    return case


def all_cases() -> list[EvalCase]:
    return list(_CASES)


# --- LLM stub (replay mode) -------------------------------------------------
@contextlib.contextmanager
def _stub_llm(response):
    """Replace _ResilientChat.send_message with a coroutine returning the recorded
    response -- so replay never touches the network, a key, or the DB. Everything
    the function does BEFORE and AFTER the call (render, model_for, _extract_json,
    normalization) still runs for real.

    ``response`` may be a single string (returned for every send_message call) or a
    list of strings returned in sequence -- the latter drives multi-call functions
    like ai_extract's validate-then-repair loop (call 1 = bad, call 2 = corrected).
    The last item is repeated if the function calls more times than provided."""
    from integrations import llm

    seq = list(response) if isinstance(response, (list, tuple)) else [response]
    state = {"i": 0}

    async def _fake_send(self, message):
        i = min(state["i"], len(seq) - 1)
        state["i"] += 1
        # keep telemetry-owning callers (record=False) working: they read last_call
        self.last_call = {"task": self.task, "model": (self.model[1] if self.model else None),
                          "engine": "replay", "prompt_version": None, "tokens_in": 0,
                          "tokens_out": 0, "latency_ms": 0, "tenant_id": None,
                          "session_id": self.session_id, "ok": True}
        return seq[i]

    async def _noop_record(*a, **k):  # keep replay DB-free even for record=False callers
        return None

    # Neutralize telemetry across the modules that hold a bound record_ai_call
    # reference (adapter is bypassed, but callers like ai_extract call it directly).
    import importlib
    patched = []
    for modname in ("core.usage", "core", "integrations.llm", "services.ai.extraction"):
        mod = importlib.import_module(modname)
        if hasattr(mod, "record_ai_call"):
            patched.append((mod, mod.record_ai_call))
            mod.record_ai_call = _noop_record

    orig = llm._ResilientChat.send_message
    llm._ResilientChat.send_message = _fake_send
    try:
        yield
    finally:
        llm._ResilientChat.send_message = orig
        for mod, fn in patched:
            mod.record_ai_call = fn


# --- Results ----------------------------------------------------------------
@dataclass
class CaseResult:
    case: EvalCase
    status: str                    # "pass" | "fail" | "skip"
    checks: list = field(default_factory=list)  # (label, ok, detail)
    error: Optional[str] = None    # unexpected exception (render drift, crash)

    @property
    def failed_checks(self):
        return [(lbl, d) for (lbl, ok, d) in self.checks if not ok]


async def run_case(case: EvalCase, live: bool = False) -> CaseResult:
    if case.golden is None and not live:
        return CaseResult(case, "skip", error="live-only (no recorded golden response)")
    try:
        if live:
            result = await case.fn(**case.kwargs)
        else:
            with _stub_llm(case.golden):
                result = await case.fn(**case.kwargs)
    except Exception as e:  # render drift / crash before checks -> hard fail
        return CaseResult(case, "fail", error=f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}")

    checks = []
    for lbl, fn in case.checks:
        try:
            fn(result)
            checks.append((lbl, True, ""))
        except AssertionError as e:
            checks.append((lbl, False, str(e)))
        except Exception as e:  # a check that itself blows up is a fail, not a crash
            checks.append((lbl, False, f"{type(e).__name__}: {e}"))
    status = "pass" if all(ok for _, ok, _ in checks) else "fail"
    return CaseResult(case, status, checks=checks)


async def run_all(*, task: Optional[str] = None, domain: Optional[str] = None,
                  live: bool = False) -> list[CaseResult]:
    cases = all_cases()
    if task:
        cases = [c for c in cases if c.task == task]
    if domain:
        cases = [c for c in cases if c.domain == domain]
    results = []
    for c in cases:
        results.append(await run_case(c, live=live))
    return results

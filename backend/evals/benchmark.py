"""E3-10.6 -- model-comparison benchmark harness.

Run the golden set against N models (and/or prompt variants) and tabulate
pass-rate + latency, so model-upgrade and prompt-change decisions are made on
DATA, not vibes. It reuses the same registered cases + checks as the eval harness
(evals/base.py) -- a model "wins" a case only if the function's real output passes
that case's shape/invariant checks.

    python -m evals.benchmark --models claude-sonnet,gemini-flash-3 --domain extraction --live
    python -m evals.benchmark --models claude-sonnet,gemini-flash-3 --task extraction.extract --live --json

Comparison is only meaningful with --live (the real model answers). In replay mode
every model returns the recorded golden, so pass-rates are identical -- replay is
there to prove the harness plumbing (route override, tabulation) with zero tokens.
"""
import argparse
import asyncio
import json as _json
import sys
import time

import evals  # noqa: F401 -- registers all cases
from evals.base import all_cases, run_case
from config import MODELS, set_model_overrides


async def benchmark_models(models, *, task=None, domain=None, live=True):
    """Run the (filtered) golden set against each model; return a per-model report.

    Each model is forced by overriding every in-scope case's task route to that
    catalog model (config.set_model_overrides), so `model_for(task)` resolves to
    it for the duration of that model's run. Overrides are always cleared after.
    """
    cases = [c for c in all_cases()
             if (not task or c.task == task) and (not domain or c.domain == domain)]
    if not cases:
        raise ValueError(f"no eval cases match task={task!r} domain={domain!r}")
    for m in models:
        if m not in MODELS:
            raise ValueError(f"unknown model {m!r}; known: {sorted(MODELS)}")

    report = {}
    for model in models:
        set_model_overrides({c.task: model for c in cases})
        try:
            rows = []
            for c in cases:
                t0 = time.perf_counter()
                r = await run_case(c, live=live)
                rows.append({
                    "task": c.task, "name": c.name, "status": r.status,
                    "latency_ms": (time.perf_counter() - t0) * 1000.0,
                    "failed_checks": [lbl for (lbl, ok, _) in r.checks if not ok],
                    "error": r.error,
                })
        finally:
            set_model_overrides({})   # never leak a route override past this model

        ran = [x for x in rows if x["status"] != "skip"]
        passed = sum(1 for x in ran if x["status"] == "pass")
        report[model] = {
            "model": model, "model_id": MODELS[model][1],
            "cases": len(rows), "ran": len(ran), "passed": passed,
            "skipped": len(rows) - len(ran),
            "pass_rate": (passed / len(ran)) if ran else 0.0,
            "avg_latency_ms": (sum(x["latency_ms"] for x in rows) / len(rows)) if rows else 0.0,
            "rows": rows,
        }
    return report


def rank(report):
    """Models ordered best-first: higher pass-rate wins, latency breaks ties."""
    return sorted(report.values(),
                  key=lambda r: (-r["pass_rate"], r["avg_latency_ms"]))


def format_report(report, *, live=True):
    ranked = rank(report)
    lines = []
    lines.append(f"\nModel-comparison benchmark  ({'LIVE' if live else 'replay'})  "
                 f"{len(report)} model(s)\n")
    lines.append(f"  {'model':<16} {'model_id':<22} {'pass':>10}  {'pass_rate':>9}  {'avg_ms':>8}")
    lines.append("  " + "-" * 70)
    for i, r in enumerate(ranked):
        tag = "  <- best" if i == 0 and live and len(ranked) > 1 else ""
        lines.append(f"  {r['model']:<16} {r['model_id']:<22} "
                     f"{str(r['passed']) + '/' + str(r['ran']):>10}  "
                     f"{r['pass_rate'] * 100:>7.1f}%  {r['avg_latency_ms']:>7.0f}{tag}")
    if not live:
        lines.append("\n  (replay: pass-rates are identical across models by design -- "
                     "use --live for a real comparison)")
    # per-case disagreements (where models diverged) -- the actionable signal
    if live and len(ranked) > 1:
        by_case = {}
        for r in report.values():
            for row in r["rows"]:
                by_case.setdefault((row["task"], row["name"]), {})[r["model"]] = row["status"]
        diverged = {k: v for k, v in by_case.items() if len(set(v.values())) > 1}
        if diverged:
            lines.append("\n  Cases where models disagreed:")
            for (task, name), verdicts in sorted(diverged.items()):
                lines.append(f"    {task}/{name}: " +
                             ", ".join(f"{m}={s}" for m, s in verdicts.items()))
    return "\n".join(lines) + "\n"


async def _main():
    ap = argparse.ArgumentParser(description="AI model-comparison benchmark (E3-10.6)")
    ap.add_argument("--models", required=True,
                    help="comma-separated catalog model names, e.g. claude-sonnet,gemini-flash-3")
    ap.add_argument("--task", help="only cases for this prompt-registry task")
    ap.add_argument("--domain", help="only cases in this domain")
    ap.add_argument("--live", action="store_true", help="call the real models (needed for a real comparison)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    report = await benchmark_models(models, task=args.task, domain=args.domain, live=args.live)

    if args.json:
        print(_json.dumps(report, indent=2, default=str))
    else:
        print(format_report(report, live=args.live))
    # exit nonzero if any model scored below a perfect pass on the cases it ran
    return 0 if all(r["passed"] == r["ran"] for r in report.values()) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))

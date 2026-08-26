"""CLI for the AI golden-set eval harness (E3-01.4).

    python -m evals.run                     # replay every case (free, deterministic)
    python -m evals.run --live              # re-run against the real model (needs a key)
    python -m evals.run --task extraction.extract
    python -m evals.run --domain extraction
    python -m evals.run --json              # machine-readable summary

Exit code is nonzero if any case fails -- so this drops straight into CI or the
Sprint-1 exit gate.
"""
import argparse
import asyncio
import json as _json
import sys

import evals  # noqa: F401 -- registers all cases
from evals.base import run_all


_C = {"pass": "\033[32m", "fail": "\033[31m", "skip": "\033[90m", "end": "\033[0m",
      "bold": "\033[1m", "dim": "\033[2m"}


def _paint(s, c):
    return f"{_C.get(c, '')}{s}{_C['end']}"


async def _main():
    ap = argparse.ArgumentParser(description="AI golden-set eval harness")
    ap.add_argument("--live", action="store_true", help="call the real model instead of replaying recorded responses")
    ap.add_argument("--task", help="only cases for this prompt-registry task (e.g. extraction.extract)")
    ap.add_argument("--domain", help="only cases in this domain (e.g. extraction)")
    ap.add_argument("--json", action="store_true", help="emit a JSON summary")
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()

    if args.no_color:
        for k in _C:
            _C[k] = ""

    results = await run_all(task=args.task, domain=args.domain, live=args.live)
    mode = "LIVE" if args.live else "replay"

    if args.json:
        out = [{
            "task": r.case.task, "name": r.case.name, "status": r.status,
            "error": r.error,
            "checks": [{"label": lbl, "ok": ok, "detail": d} for (lbl, ok, d) in r.checks],
        } for r in results]
        print(_json.dumps({"mode": mode, "results": out,
                           "summary": _tally(results)}, indent=2))
        return _exit_code(results)

    print(f"\n{_paint('AI golden-set eval', 'bold')}  ({mode})  {len(results)} case(s)\n")
    last_domain = None
    for r in results:
        if r.case.domain != last_domain:
            print(_paint(f"  {r.case.domain}", "dim"))
            last_domain = r.case.domain
        badge = {"pass": _paint("PASS", "pass"), "fail": _paint("FAIL", "fail"),
                 "skip": _paint("SKIP", "skip")}[r.status]
        ok_n = sum(1 for _, ok, _ in r.checks if ok)
        detail = f"{ok_n}/{len(r.checks)} checks" if r.checks else (r.error or "")
        print(f"    {badge}  {r.case.task:<28} {r.case.name:<28} {_paint(detail, 'dim')}")
        if r.status == "fail":
            if r.error:
                print(_paint(f"          ! {r.error.splitlines()[0]}", "fail"))
            for lbl, d in r.failed_checks:
                print(_paint(f"          x {lbl}: {d}", "fail"))

    t = _tally(results)
    print(f"\n  {_paint(str(t['pass']) + ' passed', 'pass')}   "
          f"{_paint(str(t['fail']) + ' failed', 'fail')}   "
          f"{_paint(str(t['skip']) + ' skipped', 'skip')}"
          f"   of {t['total']}\n")
    if t["skip"] and not args.live:
        print(_paint("  (skipped cases are live-only -- run with --live in the preview env)\n", "dim"))
    return _exit_code(results)


def _tally(results):
    return {
        "total": len(results),
        "pass": sum(1 for r in results if r.status == "pass"),
        "fail": sum(1 for r in results if r.status == "fail"),
        "skip": sum(1 for r in results if r.status == "skip"),
    }


def _exit_code(results):
    return 1 if any(r.status == "fail" for r in results) else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))

"""High-risk-module coverage gate (Epic 10 T10-11.7).

Measures coverage of the high-risk modules SINGLE-PROCESS (pytest-cov does not
compose with the suite's -n2 --dist loadscope) and enforces a per-module floor.
Exits non-zero if any measured module is below its floor -- drop it into a
pre-merge check or run it per sprint to track the trend.

    python scripts/coverage_highrisk.py

Only the modules pytest-cov can currently measure are gated; the rest are printed
with the reason they're blocked (see .coveragerc for the full explanation:
core.* crashes on bcrypt/PyO3 re-init; tenancy/ingestion/ledger have no isolated
db-tier tests and are covered via the integration tier).
"""
import re
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PY = BACKEND / ".venv" / "Scripts" / "python.exe"

# module -> (pytest targets that exercise it, floor %). Only MEASURABLE modules.
MEASURABLE = {
    "services.operating_score": (
        ["tests/test_s1_operating_score_unit.py", "tests/test_s1_operating_score_view_unit.py"],
        50,
    ),
}

# module -> why it can't be floored via the offline unit suite yet.
BLOCKED = {
    "core.permissions": "pytest-cov re-imports core -> bcrypt PyO3 'init once' crash",
    "services.tenancy": "no isolated db-tier test; covered via integration tier",
    "services.ingestion": "no isolated db-tier test; covered via integration tier",
    "routers.ledger": "no isolated db-tier test; covered via integration tier",
}


def measure(module: str, targets: list) -> int | None:
    cmd = ([str(PY), "-m", "pytest", *targets,
            f"--cov={module}", "--cov-report=term", "-o", "addopts=", "-p", "no:cacheprovider", "-q"])
    out = subprocess.run(cmd, cwd=BACKEND, capture_output=True, text=True).stdout
    for line in out.splitlines():
        if module.split(".")[-1] in line and "%" in line:
            m = re.search(r"(\d+)%", line)
            if m:
                return int(m.group(1))
    return None


def main() -> int:
    print("High-risk module coverage (T10-11.7), single-process:\n")
    failures = []
    for module, (targets, floor) in MEASURABLE.items():
        pct = measure(module, targets)
        if pct is None:
            print(f"  {module:28} ?    (no data -- check targets)")
            failures.append(module)
            continue
        status = "OK" if pct >= floor else "BELOW FLOOR"
        print(f"  {module:28} {pct:>3}%  floor {floor}%  {status}")
        if pct < floor:
            failures.append(module)
    print("\n  Not yet floored (documented in .coveragerc):")
    for module, why in BLOCKED.items():
        print(f"  {module:28} --   {why}")
    if failures:
        print(f"\nFAIL: below floor / unmeasured: {failures}")
        return 1
    print("\nOK: every measured high-risk module is at or above its floor.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

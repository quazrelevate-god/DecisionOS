#!/usr/bin/env bash
# Local mirror of the backend-lint CI gate (Epic 8 Sprint 8 -- U8-08.5).
# Run from backend/:  bash scripts/lint.sh
# Tree-wide ruff + import-linter (hard gates), then black --check on the files
# you've changed vs HEAD (matches the "enforce forward" policy).
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== ruff =="
ruff check . || fail=1

echo "== import-linter =="
lint-imports || fail=1

echo "== black --check (managed paths) =="
MANAGED=$(grep -vE '^\s*#|^\s*$' .black-managed)
EXISTING=$(for f in $MANAGED; do [ -f "$f" ] && echo "$f"; done)
if [ -n "$EXISTING" ]; then
  black --check $EXISTING || fail=1
else
  echo "(no managed paths)"
fi

# S10 (U8-10.4): the DB-free contract gate -- API-parity + the Epic 8 module
# invariants (lifespan, otp, shim-lock, 0 domain endpoints). The full
# test_iteration* suite needs the shared preview backend and runs there (U8-01.8).
echo "== pytest (API-parity + Epic 8 contract tests) =="
python -m pytest tests/test_api_parity.py tests/test_epic8_s7_modules.py -q -p no:cacheprovider || fail=1

if [ "$fail" -ne 0 ]; then echo "LINT FAILED"; exit 1; fi
echo "LINT OK"

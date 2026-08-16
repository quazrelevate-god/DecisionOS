"""WE-07 (2026-08-16) -- single-writer contract.

Only services/workflow_engine.py may mutate workflows.stage across the
entire backend codebase. Any other writer is a regression that would
resurrect the "silent kanban drag" class of bugs the engine is
supposed to prevent.

Enforcement is a static grep for `.workflows.update` / `.workflows.
update_one` / `.workflows.find_one_and_update` / `.workflows.insert`
with `"stage"` in a nearby span; the allow-list is exactly:
  * services/workflow_engine.py (the writer)
  * server.py::create_workflow (initial insert -- sets stage=stages[0],
    NOT a transition)
  * server.py::_create_workflows (voice-capture initial insert)
  * migrations that $set stage_version but NOT stage
  * demo seeder in server.py (writes fixed stages once at boot)

Everything else that mutates workflows.stage fails this test at CI.
"""
import re
from pathlib import Path

import pytest


BACKEND = Path(__file__).resolve().parent.parent

# Paths that ARE allowed to write workflows.stage (or an equivalent
# initial insert). Path fragments are used because different environments
# see different absolute prefixes.
ALLOWED_WRITERS = {
    # The engine itself is THE writer.
    "services/workflow_engine.py",
    # server.py has two initial-insert sites (POST /api/workflows and the
    # voice-capture _create_workflows). Both set stage=stages[0] at doc
    # creation time -- that is a birth, not a transition -- so they are
    # allowed. They are the ONLY server.py mentions of workflows write +
    # stage; any additional writer added here would fail the test.
    "server.py",
    # scripts/reclassify_purchases.py is a one-shot admin migration and
    # does not touch stage. It is here in case it ever grows a stage
    # write; today grepping it hits nothing.
    "scripts/reclassify_purchases.py",
}


# Excluded from the contract: test files (they legitimately seed
# workflow docs for their own fixtures) and one-shot verification
# scripts under scripts/ (they are ad-hoc DB checkers, not production
# writers). Anything else that touches workflows.stage is a violation.
def _is_test_file(rel_path: str) -> bool:
    return (rel_path.startswith("tests/") or "/tests/" in rel_path
            or rel_path.startswith("scripts/") or "/scripts/" in rel_path)


def _iter_python_files():
    for p in BACKEND.rglob("*.py"):
        if any(part in {".venv", "__pycache__", "node_modules"} for part in p.parts):
            continue
        yield p


# Simple heuristic: match `db.workflows.<op>(` with a nearby `stage`
# inside the same call arg block (up to 4 lines). This catches
# update_one, update_many, find_one_and_update, replace_one, insert_one,
# insert_many, bulk_write. We do NOT flag pure reads (find, find_one,
# count_documents, aggregate). The nearby-stage guard means a query
# like `.workflows.update_one({"id": ...}, {"$set": {"title": "X"}})`
# does NOT trip the test.
WRITER_OP_RE = re.compile(
    r"(?:db|_db)\.workflows\.(update_one|update_many|find_one_and_update|"
    r"find_one_and_replace|replace_one|insert_one|insert_many|bulk_write)\s*\("
)
STAGE_PROXY_RE = re.compile(r'["\']stage["\']|stage_version')


def _writer_hits(text: str, path_str: str) -> list:
    """Return (line_number, snippet) for every stage-writing call in `text`."""
    hits = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = WRITER_OP_RE.search(line)
        if not m:
            continue
        # Look at this line + next 8 lines for a stage-ish key. That is
        # enough to catch multi-line update dicts without false-positive
        # matches on unrelated later code.
        span = "\n".join(lines[i:i + 9])
        if STAGE_PROXY_RE.search(span):
            hits.append((i + 1, line.strip()))
    return hits


def test_only_engine_and_allowed_paths_write_workflows_stage():
    """The single-writer contract. Any hit outside ALLOWED_WRITERS is
    a regression -- either move the write inside services/workflow_engine.py
    or (if it is a legitimate one-shot admin migration) add the file
    to ALLOWED_WRITERS with an explaining comment."""
    violations: list[tuple[str, int, str]] = []
    for f in _iter_python_files():
        rel = str(f.relative_to(BACKEND)).replace("\\", "/")
        if _is_test_file(rel):
            continue
        text = f.read_text(encoding="utf-8", errors="replace")
        hits = _writer_hits(text, rel)
        if not hits:
            continue
        # Allowed only if the relative path startswith any allow-list entry.
        allowed = any(rel == a or rel.endswith(a) for a in ALLOWED_WRITERS)
        if allowed:
            continue
        for line_no, snippet in hits:
            violations.append((rel, line_no, snippet))
    if violations:
        msg = ["WE-07 single-writer contract violated. Move stage writes into "
               "services/workflow_engine.py OR add file to ALLOWED_WRITERS "
               "with rationale.\n"]
        for rel, ln, snippet in violations:
            msg.append(f"  {rel}:{ln}  {snippet}")
        pytest.fail("\n".join(msg))


def test_server_py_stage_writes_are_only_initial_inserts():
    """Belt+braces: even though server.py is in the allow-list, no NEW
    stage-transition writer should be added there. Every server.py
    hit must be an insert_one (workflow creation) or the demo
    seeder's insert_many. update_* on workflows with stage in the
    span is disallowed -- that would be a transition, which must go
    through the engine."""
    server_py = BACKEND / "server.py"
    text = server_py.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    forbidden: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = WRITER_OP_RE.search(line)
        if not m:
            continue
        op = m.group(1)
        span = "\n".join(lines[i:i + 9])
        if not STAGE_PROXY_RE.search(span):
            continue
        # Allowed ops on workflows in server.py:
        #   insert_one / insert_many : create + demo seeder (initial writes)
        #   update_many with only stage_version : the WE-09 backfill migration
        if op in ("insert_one", "insert_many"):
            continue
        if op == "update_many" and "stage_version" in span and '"stage":' not in span and "'stage':" not in span:
            continue
        forbidden.append((i + 1, line.strip()))
    if forbidden:
        msg = ["server.py contains a workflows.update / find_one_and_update "
               "that mentions 'stage' in its arg block. That is a transition "
               "and MUST go through services/workflow_engine.advance.\n"]
        for ln, snippet in forbidden:
            msg.append(f"  server.py:{ln}  {snippet}")
        pytest.fail("\n".join(msg))


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

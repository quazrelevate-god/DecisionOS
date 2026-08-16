"""Regression guard: WE-EPIC5-BUG-3 (2026-08-17).

Voice-created + manual-created workflow inserts must set stage_version=0
at INSERT time, not later via backfill. Prior gap: `_create_workflows`
(server.py voice path) and manual `POST /workflows` both omitted the
field, so freshly-created workflows had `stage_version: None`. The
WE-06 engine's CAS filter compared prev_version=int(None or 0)=0 to
Mongo's actual `None`, and `find_one_and_update({stage_version: 0})`
missed the doc -- so the WE-06.5 task-close hook fired but never
advanced the workflow.

WE-EPIC5-BUG-2 later widened the engine's filter to `{$in: [0, None]}`
as a defense-in-depth for legacy pre-migration docs, but the correct
fix is at the insert site. Both fixes stand: init at insert AND accept
legacy None.

This test is a grep-level guard, not a live DB test, because the two
inserts in server.py are inline dict literals -- easy to reintroduce
the bug on any refactor. If the grep pattern changes shape, update
this test to match rather than deleting the guard.
"""
from pathlib import Path
import re


SERVER_PY = Path(__file__).resolve().parent.parent / "server.py"


def _read_server():
    return SERVER_PY.read_text(encoding="utf-8")


def test_voice_create_workflows_inits_stage_version():
    """_create_workflows() must set stage_version=0 in its insert dict."""
    src = _read_server()
    # Locate the function body (from def to the next top-level def).
    m = re.search(
        r"async def _create_workflows\(.*?\n(.*?)(?=\nasync def |\ndef |\Z)",
        src, re.DOTALL,
    )
    assert m, "_create_workflows function not found in server.py"
    body = m.group(1)
    assert "db.workflows.insert_one" in body, (
        "_create_workflows no longer contains workflow insert -- "
        "update this test to point at the new location.")
    assert re.search(r'"stage_version"\s*:\s*0', body), (
        "REGRESSION: _create_workflows insert is missing "
        '"stage_version": 0 -- voice-created workflows will have None '
        "and the WE-06.5 task-close hook will fail to auto-advance. "
        "See WE-EPIC5-BUG-3 (2026-08-17).")


def test_manual_post_workflows_inits_stage_version():
    """POST /workflows handler must set stage_version=0 in its insert dict."""
    src = _read_server()
    # The manual create builds a `wf = { ... }` literal and passes to insert_one.
    # Look for that specific pattern near the /workflows POST route.
    # We use a wider window and check both the literal-dict form and the insert
    # call are present within the same route handler.
    m = re.search(
        r'@api\.post\("/workflows"\)\s*\n.*?(?=\n@api\.|\nasync def |\ndef |\Z)',
        src, re.DOTALL,
    )
    assert m, "POST /workflows route handler not found in server.py"
    body = m.group(0)
    assert "db.workflows.insert_one" in body, (
        "POST /workflows no longer inserts a workflow -- "
        "update this test to point at the new location.")
    assert re.search(r'"stage_version"\s*:\s*0', body), (
        "REGRESSION: POST /workflows handler is missing "
        '"stage_version": 0 in its insert dict -- manually-created '
        "workflows will have None and CAS advances will silently miss. "
        "See WE-EPIC5-BUG-3 (2026-08-17).")

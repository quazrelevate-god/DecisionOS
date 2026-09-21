"""What clicking through a new company by hand found (2026-09-21).

docs/BROWSER_SCENARIOS_0921.md — 26 steps in the browser preview, three people,
real log-outs and log-ins. Three things were broken on screen and are pinned
here; the due-date one has its own file (test_due_is_a_day.py).
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"


def _fe(*p):
    return FE.joinpath(*p).read_text(encoding="utf-8")


def test_signup_draws_when_reached_from_the_register_link():
    """Arriving at /signup from another screen mounted it with the session
    already settled; React's dev double-mount cancelled the start-up run and
    the re-run bailed on `started`, so the wizard drew NOTHING. The Playwright
    runs never saw it — they always loaded /signup directly."""
    src = _fe("pages", "Signup.js")
    body = src[src.index("if (authLoading || started.current) return undefined;"):]
    body = body[:body.index("}, [authLoading]);")]
    assert "let live = true" not in body and "if (!live) return;" not in body
    assert "setDraftReady(true);" in body


def test_departments_are_named_not_keyed_on_screen():
    """An AI-designed department's key (`sales_&_order_management`) was printed
    on the workflow card and in the decision review."""
    helper = _fe("lib", "departments.js")
    assert "export function deptName(tenant, key)" in helper
    card = _fe("components", "workflow", "WorkflowDetail.js")
    assert "deptName(tenant, stage.owner_role)" in card
    assert "${stage.owner_role} owns this stage" not in card
    dialog = _fe("components", "DecisionDialog.js")
    assert "deptName(tenant, t.assignee_role)" in dialog
    assert "(${t.assignee_role} team)" not in dialog

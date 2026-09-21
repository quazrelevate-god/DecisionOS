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


def test_the_seat_limit_is_said_where_it_bites():
    """#2 (2026-09-21): the trial holds a real team, the seat count is on the
    Team header, and a refusal sits on the Add member dialog — not in a toast
    that vanished while the filled-in form stayed open."""
    from services.plans import PLAN_DEFINITIONS, PLAN_TRIAL
    assert PLAN_DEFINITIONS[PLAN_TRIAL]["seat_limit"] == 15
    team = _fe("pages", "Team.js")
    assert 'data-testid="team-seats"' in team and "{seatPlan.seats_used} of {seatPlan.seat_limit} seats" in team
    assert 'if (detail?.code === "seat_limit_reached") setSeatWall(detail);' in team
    assert 'data-testid="member-seat-wall"' in team
    assert "What you've typed here is kept." in team


def test_work_left_behind_is_one_review_everywhere():
    """#1 (2026-09-21): the board's move, the card's Move on, and a decision's
    jump all ask about open work with the same list; Keep is the default."""
    review = _fe("components", "workflow", "LeftoverReview.js")
    assert 'export const choiceOf = (value, id) => (value && value[id]) || "keep";' in review
    board = _fe("pages", "Workflows.js")
    assert "api.get(`/workflows/${wf.id}/leftover`)" in board
    assert 'data-testid="wf-leftover-dialog"' in board
    assert 'ctx.choices[t.id] || "keep"' in board, "every open task is answered; unchosen = keep"
    card = _fe("components", "workflow", "WorkflowDetail.js")
    assert 'data-testid="wf-detail-move-on"' in card
    dialog = _fe("components", "DecisionDialog.js")
    assert "api.get(`/decisions/${decisionId}/moves`)" in dialog
    assert "{ resolutions: leftChoices }" in dialog

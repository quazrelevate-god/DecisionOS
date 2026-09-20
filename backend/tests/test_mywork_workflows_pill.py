"""My Work has its Workflows pill back (2026-09-19).

Yokesh: "check whether there is a workflow pill in the My Work page — it got
removed in some iteration by mistake; bring it back." ASK-42 C (2026-09-17)
took it out when /workflows became a page of its own, and on desktop nothing
else reached that page. It is back as a way IN, not a second copy of the
board: a pill on desktop, an entry in the phone's view menu, both opening
/workflows, gated like the More menu's tile.
"""
from pathlib import Path

PAGE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "pages" / "MyWork.js"


def _src():
    return PAGE.read_text(encoding="utf-8")


def test_gate_matches_the_workflows_permission():
    s = _src()
    assert 'const canSeeWorkflows = user?.role === "owner" || userPerms(user).includes("workflows");' in s


def test_the_desktop_pill_is_gone_again_and_that_is_the_founders_call():
    """ASK-52 (Chinmay, 2026-09-20, 8f0369c) removed it a second time: the way
    into the boards from a working screen is the Desk's Workflows card, which
    says what needs attention rather than only where the boards are. This file
    was written when the pill came back (7902351) — it now records the decision
    that replaced it, so the history of this control stays readable rather than
    the test simply disappearing. The phone keeps its entry: there is no KPI
    grid there to carry the card."""
    s = _src()
    assert 'data-testid="work-open-workflows"' not in s


def test_phone_view_menu_has_a_workflows_entry():
    s = _src()
    i = s.index('key: "workflows"')
    entry = s[s.rindex("...(canSeeWorkflows ?", 0, i):i + 200]
    assert 'navigate("/workflows")' in entry
    assert "leaves: true" in entry, "marked as a way out of the list, not a filter"

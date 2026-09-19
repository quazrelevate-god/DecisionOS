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


def test_desktop_pill_opens_the_workflows_page():
    s = _src()
    i = s.index('data-testid="work-open-workflows"')
    block = s[s.rindex("{canSeeWorkflows && (", 0, i):i + 400]
    assert '<Link to="/workflows"' in block
    assert 't("mywork.view_workflows", "Workflows")' in block, "a labelled pill, not a bare icon"


def test_phone_view_menu_has_a_workflows_entry():
    s = _src()
    i = s.index('key: "workflows"')
    entry = s[s.rindex("...(canSeeWorkflows ?", 0, i):i + 200]
    assert 'navigate("/workflows")' in entry
    assert "leaves: true" in entry, "marked as a way out of the list, not a filter"

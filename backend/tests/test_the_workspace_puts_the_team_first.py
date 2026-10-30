"""2026-10-30 (founder, from a client) — desktop My Work becomes the Workspace.

Source-level pins for frontend/src/pages/MyWork.js and pages/mywork/: the
status fence, the work tree, the owner's team board (and what it counts), and
the desktop task card it opens onto. The phone keeps its own My Work.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
MYWORK = (FE / "pages" / "MyWork.js").read_text(encoding="utf-8")
HUB = (FE / "pages" / "mywork" / "WorkspaceHub.jsx").read_text(encoding="utf-8")
DECK = (FE / "pages" / "mywork" / "WorkDeck.jsx").read_text(encoding="utf-8")


def test_desktop_only_and_not_the_approvals_page():
    assert "const deskHub = !isMobile && !approvalsPage;" in MYWORK
    # The phone returns its own tree before the desktop one is built.
    assert MYWORK.index('<div data-testid="mywork-phone">') < MYWORK.index('data-testid="workspace-hub"')


def test_the_title_is_workspace():
    assert 't("mywork.workspace", "Workspace")' in MYWORK
    assert 'data-testid="workspace-title"' in MYWORK


def test_status_is_a_fence_of_every_status():
    assert "<StatusFence options={STATUS_FILTER_OPTIONS}" in MYWORK
    for key in ('"todo"', '"in_progress"', '"waiting"', '"approval"', '"overdue"', '"due_today"', '"no_date"', '"completed"'):
        assert f"{{ key: {key}," in MYWORK
    # The server sends at most 500 finished tasks; the tile says so.
    assert "capped={{ completed: 500 }}" in MYWORK


def test_the_tree_holds_the_old_switcher_with_its_addresses():
    assert "<WorkTree person={meCard} branches={deskBranches} />" in MYWORK
    for tid in ("work-scope-mine", "work-scope-asked", "work-scope-all", "work-view-requests", "work-view-approvals"):
        assert f'testid: "{tid}"' in MYWORK
    # The desktop switcher and its three dropdowns are gone from the header.
    assert 'data-testid="work-view-segment"' not in MYWORK
    assert 'testid="work-filter-department"' not in MYWORK
    assert 'testid="work-filter-status"' not in MYWORK


def test_the_owner_opens_on_the_team_board():
    assert '(deskHub && isOwner && canSeeAll && !rawView ? "all" : savedScope)' in MYWORK
    assert "const boardOn = deskHub && isOwner && onAll && view === \"mywork\" && !personFilter && !filters.status && !showingCompleted;" in MYWORK
    # All Tasks always lands on the board for the owner; a person opens their cards.
    assert 'onClick: () => (isOwner ? goBoard() : goView("all"))' in MYWORK
    assert "onPick={setPersonFilter}" in MYWORK
    assert "<PersonBar person={drilledPerson}" in MYWORK


def test_department_lives_on_all_tasks_only():
    assert 'const deptTab = deskHub && !onAll ? "all" : tab;' in MYWORK
    assert 'testid="work-dept"' in MYWORK


def test_a_persons_numbers():
    for part in (
        "const open = mine.filter((t) => !fx.isTerminal(t));",
        "const recent = done.filter((t) => stamp(t.completed_at) >= since);",
        "const onTime = dated.filter((t) => stamp(t.completed_at) <= deadline(t.due_date)).length;",
        'fx.statusMatches(t, "waiting") || fx.statusMatches(t, "approval")',
    ):
        assert part in HUB
    for label in ('label="Open"', 'label="Overdue"', 'label="Done · 30 days"', 'label="On time"'):
        assert label in HUB
    # The team line counts tasks once, not once per person on them.
    assert "const open = tasks.filter((t) => !fx.isTerminal(t)).length;" in HUB
    assert "{ key: \"delivered\", label: \"Delivered\" }" in HUB


def test_the_desktop_card():
    # No Next action box or buttons; a click anywhere opens the task.
    assert 'onClick={desk ? (e) => { if (!e.target.closest("button, a, input, label")) onOpen?.(); } : undefined}' in DECK
    # The steps as one bar, the title and the description two lines each.
    assert "function StepProgress(" in DECK
    assert '${desk ? "line-clamp-2" : "line-clamp-3"}' in DECK
    assert 'data-testid={`deck-desc-${t.id}`}' in DECK
    # Priority is a glow along the bottom edge, inside the card.
    assert "const PRIO_GLOW = {" in DECK
    assert 'data-testid={`priority-glow-${t.id}`}' in DECK
    assert "priority-stripe" not in DECK
    assert "<TaskSummaryCard t={t} kit={deck.kit} members={cp.members} roleOptions={cp.roleOptions} desk" in MYWORK

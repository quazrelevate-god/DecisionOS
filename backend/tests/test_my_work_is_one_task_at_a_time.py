"""My Work on a phone, one task at a time (founder, 2026-10-29).

The founder's redesign of the phone's My Work: the Desk's split — the filters
as KPI-style tiles on the sky, the work in a black sheet — every task a
summary card the height of its own content, the page scrolling as usual (the
one-card-per-screen deck was tried and dropped the same day). Opening a task gives the full task view: the
assignees three at a time, Dex's guide, and Steps / Documents / Activity /
Details tabs, the checklist drawn as a numbered flow.

These pin the decisions in the source, the way the other My Work tests do.
"""
from pathlib import Path

FE = Path(__file__).resolve().parents[2] / "frontend" / "src"
MW = (FE / "pages" / "MyWork.js").read_text(encoding="utf-8")
DECK = (FE / "pages" / "mywork" / "WorkDeck.jsx").read_text(encoding="utf-8")


def test_the_phone_has_its_own_tree_and_the_desktop_is_untouched():
    assert "if (isMobile && !approvalsPage && view !== \"approvals\") {" in MW
    assert '<div data-testid="mywork-phone">' in MW
    # The Approvals page keeps its own layout on a phone.
    assert "!approvalsPage" in MW.split('<div data-testid="mywork-phone">')[0].rsplit("if (isMobile", 1)[1]


def test_the_filters_are_tiles_in_categories():
    for testid in ("work-tile-view", "work-tile-status", "work-tile-department", "work-tile-person"):
        assert f'testid="{testid}"' in MW, testid
    assert 'category="Showing"' in MW and 'category="Status"' in MW and 'category="Department"' in MW
    # The options open in the app's glass list, never an OS dropdown.
    assert "<select" not in DECK
    assert "GLASS_MENU" in DECK


def test_the_priority_bands_are_the_phones_default_view():
    assert "loadedPrefs.aiPriorityM ?? true" in MW, "on by default on a phone"
    assert "...(isMobile ? { aiPriorityM: aiPriority } : { aiPriority })" in MW, "a separate setting from the desktop's"
    assert 'data-testid="mywork-priority-bands"' in MW
    # Everyone gets the bands; only those who may run the AI ranking get the ranking.
    assert "const bandsOn = aiPriority && !showingCompleted && view === \"mywork\";" in MW
    assert "staleTime: 5 * 60 * 1000" in MW, "scoring is an AI call; not on every visit"


def test_every_task_is_a_card_in_a_list_that_scrolls_as_usual():
    # 2026-10-29, second look: no one-card-per-screen, no stretched cards, no
    # drag-to-expand. The sheet is part of the page and the page scrolls.
    assert 'data-testid={`${testid}-list`}' in DECK
    for gone in ("snap-mandatory", "scrollSnapStop", "Swipe up for next task", "dragControls", "h-full min-h-0 flex-col rounded-[1.75rem]"):
        assert gone not in DECK, gone
    # It runs edge to edge and under the dock, and reaches the screen's foot.
    assert "[margin-bottom:calc(-1*(1rem+var(--dock-h)+3rem+var(--sa-bottom)+var(--dex-notice-space,0px)))]" in DECK
    assert "style={{ minHeight: minH || undefined }}" in DECK


def test_the_card_carries_what_the_founder_asked_for():
    assert "AvatarStack people={people} max={3}" in DECK, "three faces, then +N"
    assert "Assigned {agoWords(assigned)}" in DECK, "how long ago it was assigned, in words"
    assert "Next action" in DECK
    # The next action is the first checklist step not yet ticked.
    assert "const i = steps.findIndex((s) => !s.done);" in DECK
    assert 'label: "Mark as Doing", icon: Play, run: () => patch({ status: "in_progress" }' in DECK
    assert "Open task" in DECK


def test_the_task_view_has_the_four_tabs_and_the_flow():
    for key in ("steps", "documents", "activity", "details"):
        assert f'{{ key: "{key}", label:' in MW, key
    assert "<ExecutionPlan flow t={t}" in MW
    assert 'data-testid={`exec-flow-${t.id}`}' in MW
    # Ticking a step fills its node, then the line down to the next one.
    assert "style={{ transform: `scaleY(${s.done ? 1 : 0})`" in MW
    # The timeline lives in the Activity tab now, not at the foot.
    assert "openTrigger={trailOpen}" in MW
    assert "<AssigneesEditor compact" in MW and "{showAll ? \"Show less\" : \"View all\"}" in MW
    assert 'data-testid={`task-ask-dex-${t.id}`}' in MW

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


def test_the_filters_are_status_tiles_and_one_row_of_views():
    # 2026-10-31 (founder's reference) — the four category dropdown tiles became
    # two rows of status tiles and one row of view pills.
    assert "<StatusTiles value={filters.status} onPick={setStatusFilter}" in MW
    assert "<ViewPills pills={phonePills} />" in MW
    assert 'const TILE_SLOTS = ["", "todo", "in_progress", "waiting", "approval", "overdue", "completed", "when"];' in DECK
    # Ten statuses, eight tiles: the three about WHEN share the last tile,
    # Schedule — a name and a caret, no count — whose list has the counts.
    assert 'const WHEN = ["due_today", "no_date", "repeating"];' in DECK
    assert 'data-testid="work-status-schedule"' in DECK and "<span className=\"truncate\">Schedule</span>" in DECK
    # Asked by me and My team live in Assigned to me; Department and Person in
    # All Tasks; Approvals opens its own page.
    assert '{ key: "asked", label: t("mywork.asked_by_me", "Asked by me"), go: () => goView("asked") },' in MW
    assert "menu: [...deptMenu, ...personMenu]" in MW
    assert 'onClick: () => navigate("/approvals")' in MW
    # Department only narrows All Tasks, on the phone as on desktop.
    assert 'const deptTab = !approvalsPage && !onAll ? "all" : tab;' in MW
    # The options open in the app's glass list, never an OS dropdown.
    assert "<select" not in DECK
    assert "GLASS_MENU" in DECK
    assert "FilterTile" not in DECK


def test_the_priority_bands_are_the_phones_only_view():
    # 2026-10-31 (founder) — the bands are always on, on the phone; the sparkle
    # that turned them off, and the AI ranking with its "Priority score" panel,
    # are gone from phone and desktop alike.
    assert "const aiPriority = isMobile;" in MW
    assert 'data-testid="mywork-priority-bands"' in MW
    assert "const bandsOn = aiPriority && !showingCompleted && view === \"mywork\";" in MW
    for gone in ("setAiPriority", "ai-priority-toggle", 'data-testid="work-mobile-priority"', "PriorityScoreBars",
                 "/tasks/prioritize", "scoreMap", "function TaskPriorityColumns(", "<TaskPriorityColumns"):
        assert gone not in MW, gone


def test_the_phone_page_is_the_workspace_with_no_summary_line():
    assert 't("mywork.workspace", "Workspace")}</h1>' in MW and 'data-testid="workspace-title-mobile"' in MW
    assert 'data-testid="mywork-mobile-summary"' not in MW
    # What narrows the list still says so, with a way out.
    assert 'data-testid="mywork-mobile-filtered"' in MW


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
    # 2026-10-29, second pass: Details gave way to Notes (kept on the phone).
    for key in ("steps", "documents", "activity", "notes"):
        assert f'{{ key: "{key}", label:' in MW, key
    assert "<TaskNotes taskId={t.id} userId={user?.id} />" in MW
    assert "<ExecutionPlan flow t={t}" in MW
    assert 'data-testid={`exec-flow-${t.id}`}' in MW
    # Ticking a step fills its node, then the line down to the next one.
    assert "style={{ transform: `scaleY(${s.done ? 1 : 0})`" in MW
    # The timeline lives in the Activity tab, with no form of its own: logging,
    # handing off and escalating are the slider's left end, and the card
    # rises from just above it.
    assert "<TaskTrail formless t={t}" in MW
    assert "<TaskActionSlider testid={`task-slider-${t.id}`}" in MW
    assert "onUpdate={() => setUpdateOpen(true)}" in MW
    phone_view = MW[MW.index("const mobileTaskView = () =>"):MW.index("const buildDrawer = () =>")]
    for gone in ("upload-file-m-", "photo-m-", "voice-m-", "note-m-"):
        assert gone not in phone_view, gone
    slider = (FE / "pages" / "mywork" / "TaskActionSlider.jsx").read_text(encoding="utf-8")
    assert "ng-slider-well" in slider and "ng-slider-knob" in slider, "the Dex slider's own materials"
    assert "<AssigneesEditor compact" in MW and "{showAll ? \"Show less\" : \"View all\"}" in MW
    assert 'data-testid={`task-ask-dex-${t.id}`}' in MW

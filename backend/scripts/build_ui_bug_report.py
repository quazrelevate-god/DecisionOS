"""Build the standard UI/UX bug-report workbook.

One workbook for the whole UI audit, section by section. Each run rewrites the
sheets from the FINDINGS/COVERAGE/NON_ISSUES tables below, so the file is always
reproducible from source rather than hand-edited.

    .venv/Scripts/python.exe scripts/build_ui_bug_report.py

Output: docs/DecisionOS_UI_Bug_Report.xlsx
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

REPO = Path(__file__).resolve().parent.parent.parent
OUT = REPO / "docs" / "DecisionOS_UI_Bug_Report.xlsx"

INK = "1A1A1A"
HEAD_BG = "1A1A1A"
HEAD_FG = "FFFFFF"
SEV = {
    "Critical": "C0392B",
    "High": "E8590C",
    "Medium": "B58900",
    "Low": "6B7280",
    "Nit": "9CA3AF",
}
STATUS_FILL = {
    "Open": "FDE7E7",
    "To do": "FDE7E7",
    "Awaiting decision": "FFF4E5",
    "Parked - needs design": "F3F4F6",
    "Not a defect": "E8F3EC",
    "By design": "E8F3EC",
    "Fixed": "E8F3EC",
    "Won't fix": "EFEFEF",
}
PASS_FILL = {"PASS": "E8F3EC", "FAIL": "FDE7E7", "BLOCKED": "FFF4E5", "N/A": "F3F4F6"}

# ---------------------------------------------------------------------------
# 1. BUG LOG
# ---------------------------------------------------------------------------
BUG_COLS = [
    ("ID", 11), ("Section", 11), ("Screen / Component", 24), ("Viewport", 13),
    ("Persona", 12), ("Severity", 10), ("Status", 11), ("Area", 13),
    ("What we tested", 40), ("Expected", 40), ("Actual (observed)", 52),
    ("Evidence", 34), ("Root cause", 54), ("Proposed solution", 62),
    ("Code location", 34), ("Found on", 11),
]

FINDINGS = [
    dict(
        id="MW-08", section="My Work", screen="Task card - Update / Escalate",
        viewport="Desktop", persona="Owner / assignee", severity="Critical", status="Open",
        area="Crash",
        tested="Pressed 'Update / Escalate' on an expanded task to log a progress note - "
               "the work trail and hand-off flow.",
        expected="The update form opens so a note can be written and handed off.",
        actual="The app CRASHES. A ReferenceError is thrown while rendering the form, the "
               "form never appears, and the whole React tree unmounts - the page is gone, "
               "not just the form. Recovery needs a reload. The work trail, hand-off and "
               "escalation flow is therefore completely unusable.",
        evidence="Uncaught ReferenceError: CTRL_ON is not defined, thrown from UpdateForm "
                 "during render. After the click the React root has no children "
                 "(root alive = false).",
        cause="Commit 5fb96f2 ('KR-11.3 - Workflows and Leave join the material') deleted "
              "the CTRL_ON and CTRL_OFF constants and restyled the toolbar call sites, but "
              "missed the one inside UpdateForm. That line still references both constants, "
              "so the component throws the moment it renders. The removed values were "
              "CTRL_ON = 'border-kr-ink text-foreground' and CTRL_OFF = "
              "'border-kr-ink/55 text-foreground/65 hover:text-foreground/85'.",
        fix="Restyle that one button to the segmented-control treatment the rest of the "
            "toolbar moved to in the same commit (kr-pressed / kr-pop, as the priority "
            "bands use), or simply restore the two constants. Then stop the class "
            "recurring: craco narrows ESLint to react-hooks rules only, which drops "
            "eslint-config-react-app's no-undef - the rule that would have failed the "
            "build on this exact line.",
        code="pages/MyWork.js:147 (UpdateForm); constants removed in 5fb96f2; "
             "lint narrowed at craco.config.js:74",
        found="2026-09-12",
    ),
    dict(
        id="MW-09", section="My Work", screen="Task card - 'Log update or hand off' (mobile)",
        viewport="Mobile", persona="Owner / assignee", severity="High", status="Open",
        area="Dead control",
        tested="Tapped 'Log update or hand off' on an expanded task on mobile.",
        expected="The update form opens, as the label promises.",
        actual="Nothing happens at all - no form, no navigation, no error. The button is "
               "inert. Combined with MW-08 on desktop, there is no working way to log a "
               "task update or hand a task off on either viewport.",
        evidence="Tapped the control: no page error, no update form rendered, page state "
                 "unchanged. The element is a <button type='button'> with styling and a "
                 "label but no onClick handler.",
        cause="The mobile button was given markup but never wired to the state that opens "
              "the form - unlike its desktop twin, which does call setOpen(true).",
        fix="Wire it to the same handler its desktop counterpart uses so it opens "
            "UpdateForm - and fix MW-08 first, or the newly working button will simply "
            "crash the page instead of doing nothing.",
        code="pages/MyWork.js:1496-1505 (log-update-m button, no onClick)",
        found="2026-09-12",
    ),
    dict(
        id="MW-10", section="Global", screen="Application shell",
        viewport="Mobile + Desktop", persona="All", severity="High", status="Open",
        area="Resilience",
        tested="Checked what the user sees when a component throws during render, using "
               "the real crash from MW-08 as the trigger.",
        expected="A contained failure - the broken area degrades, the rest of the app "
                 "keeps working, and the user is offered a way to recover.",
        actual="One component throwing takes down the entire application. After the "
               "MW-08 crash the React root is left with no children, so the user is "
               "looking at a blank page with no message and no recovery except a manual "
               "reload. Any future render error anywhere will behave the same way.",
        evidence="No error boundary exists anywhere in the frontend - no componentDidCatch, "
                 "no getDerivedStateFromError, no ErrorBoundary component. After the MW-08 "
                 "crash, document root children = 0.",
        cause="React unmounts the whole tree when an error reaches the root uncaught. "
              "Nothing in the app catches it. In development CRA's overlay hides how bad "
              "this is; in a production build the user simply gets a blank screen.",
        fix="Add an error boundary around the routed page area - it should show a short "
            "apology, a Reload action, and report the error - so a single broken component "
            "costs one panel rather than the whole product. Worth a second boundary around "
            "the app shell as a backstop.",
        code="frontend/src/App.js (route tree) and components/Layout.js (shell)",
        found="2026-09-12",
    ),
    dict(
        id="MW-01", section="My Work", screen="Task card - status control",
        viewport="Mobile + Desktop", persona="Owner (all)", severity="High", status="Open",
        area="State / data",
        tested="Change a task's status through the whole lifecycle: todo, in_progress, "
               "waiting, review. Desktop uses the status dropdown; mobile uses the "
               "status pills. Repeated 8 consecutive transitions on one task. The same "
               "check was then repeated for the progress percentage.",
        expected="The card shows the new status immediately after the change is saved.",
        actual="The save succeeds (PATCH returns 200 with the new status) and a success "
               "toast appears, but the card keeps showing the PREVIOUS status. The list "
               "refetch that follows returns the pre-change value, which overwrites the "
               "UI. The correct status only appears after a full page reload. "
               "Reproduced 8 out of 8 attempts; mobile pills stay unpressed the same way. "
               "The progress percentage behaves identically: setting 50% stores 50 on the "
               "server while the card still reads 0 until reloaded.",
        evidence="8/8 transitions: PATCH=new value, GET /tasks?mine= returns the previous "
                 "value, UI renders the previous value. Reload then shows the correct one.",
        cause="setStatus PATCHes and then calls onChange -> refresh(), which only "
              "invalidates the tasks query. The refetch is issued immediately and comes "
              "back with pre-change data, so React Query overwrites the card with a stale "
              "row. Nothing reconciles the authoritative PATCH response that already "
              "holds the correct task.",
        fix="Write the PATCH response straight into the cache instead of trusting the "
            "refetch: qc.setQueryData(['tasks', mine], rows => rows.map(r => r.id === t.id "
            "? data : r)) using the object the PATCH already returns, then invalidate. "
            "That is the standard React Query update-from-response pattern and removes the "
            "race entirely. If the refetch must stay authoritative, the list read needs "
            "read-your-writes consistency instead.",
        code="pages/MyWork.js:1127 setStatus / 1134 setProgress; refresh() at 2102",
        found="2026-09-12",
    ),
    dict(
        id="MW-02", section="My Work", screen="Task card - detail dialog",
        viewport="Mobile + Desktop", persona="Owner (all)", severity="High", status="Open",
        area="Dead feature",
        tested="Looked for a way to delete a task, and for the task detail view. Expanded "
               "a card on both viewports and enumerated every control rendered on it.",
        expected="A task can be deleted from My Work, and the detail view (proof gallery, "
                 "source reference, AI insight) is reachable.",
        actual="There is NO delete control anywhere in My Work, on either viewport, and "
               "the task detail dialog never opens. The dialog and its Delete button exist "
               "in the code but are unreachable, so the proof gallery, the source-reference "
               "panel and the AI insight panel are all dead UI too.",
        evidence="Enumerated all 34 test-ids on an expanded card, mobile and desktop: no "
                 "delete-task-*, no task-detail-*. DELETE /api/tasks/<id> returns 200, so "
                 "the backend supports it - only the UI has no path to it.",
        cause="detailOpen is created with useState(false) and setDetailOpen is passed only "
              "to the dialog's own onOpenChange. Nothing in the codebase ever calls "
              "setDetailOpen(true), so TaskDetailDialog can never be opened.",
        fix="Give the card a way in: an overflow / more menu on the summary row, or make "
            "the title open details, calling setDetailOpen(true). If the detail dialog is "
            "genuinely retired, delete the component and move the Delete action onto the "
            "inline expanded card instead - either way a task must be deletable.",
        code="pages/MyWork.js:986 (state), 1837 (render), 737-890 (the dialog + delete)",
        found="2026-09-12",
    ),
    dict(
        id="MW-03", section="Global", screen="Header - global search (Cmd+K)",
        viewport="Desktop", persona="All", severity="Medium", status="Open",
        area="Accessibility",
        tested="Opened the global search dialog from the header and inspected its "
               "accessibility tree and console output.",
        expected="The dialog has an accessible name so a screen reader can announce it.",
        actual="The dialog exposes aria-labelledby pointing at an element id that does not "
               "exist, so it is announced with no name. Radix logs an error every time it "
               "opens. Reproduces on My Work and on Finance, so it affects every screen.",
        evidence="Console: 'DialogContent requires a DialogTitle for the component to be "
                 "accessible for screen reader users.' aria-labelledby resolves to null.",
        cause="CommandDialog renders DialogContent without a DialogTitle. The shadcn "
              "template it came from adds a visually hidden title; this copy omits it.",
        fix="Inside CommandDialog, wrap a DialogTitle (and a DialogDescription) in the "
            "VisuallyHidden primitive so the dialog is named for assistive tech without "
            "changing the visual design.",
        code="components/ui/command.jsx:19 (used at components/Layout.js:599)",
        found="2026-09-12",
    ),
    dict(
        id="MW-04", section="Global", screen="Dex FAB picker (mobile)",
        viewport="Mobile", persona="All", severity="Medium", status="Open",
        area="Accessibility",
        tested="Opened the Dex floating action button menu on mobile and tried to dismiss "
               "it with Escape, then with a tap outside.",
        expected="Escape closes the menu, as it does for the app's other overlays.",
        actual="Escape does nothing - the menu stays open and its full-screen scrim keeps "
               "blocking the page underneath. Only a pointer tap outside closes it. There "
               "is also no focus trap, so keyboard focus walks behind the open menu.",
        evidence="With the menu open, the element at the centre of the screen is the scrim "
                 "button both before and after pressing Escape; a tap at (8,8) clears it.",
        cause="The scrim is a plain motion.button with tabIndex -1 and an onClick handler. "
              "It is not a dialog and has no key handling, so no Escape and no focus trap. "
              "This is inconsistent with the app's own convention: BottomSheet.jsx is built "
              "on Radix Dialog specifically for 'focus trap, Escape, aria', and "
              "AllAppsPanel documents Escape as a dismiss path.",
        fix="Close the picker on Escape - either a keydown listener while picker is open, "
            "or render it inside a Radix DismissableLayer / Popover so dismissal, focus "
            "trapping and aria come from the same primitive the other sheets already use.",
        code="components/mobile/DexFab.jsx:70-82",
        found="2026-09-12",
    ),
    dict(
        id="MW-11", section="My Work", screen="Toolbar in the Leave / Workflows views",
        viewport="Desktop", persona="All", severity="Medium", status="Open",
        area="Information architecture",
        tested="Switched into the Leave view and the Workflows view and catalogued which "
               "toolbar controls remain on screen, then pressed one of them.",
        expected="The toolbar shows the controls that apply to what is on screen.",
        actual="Four task-only controls stay visible in both views - New Task, My Tasks, "
               "All Tasks and AI Priority - none of which mean anything for leave or for "
               "pipelines. Worse, pressing My Tasks, All Tasks or AI Priority silently "
               "throws you back to the task list, losing the view you were in with no "
               "warning. In the Leave view 'New Task' is also the largest, darkest button "
               "on screen, and it creates a task, not a leave request.",
        evidence="In both views work-scope-mine, work-scope-all and ai-priority-toggle are "
                 "still visible; clicking All Tasks returns mywork-list. Confirmed on both "
                 "the Leave and Workflows views at 1440x900.",
        cause="The view toggle swaps only the body. The toolbar above it is rendered "
              "unconditionally, and the scope / priority handlers each call setView"
              "('mywork') as a side effect, so pressing them doubles as an exit.",
        fix="Render the task-scope controls only while view === 'mywork'. Leave the view "
            "toggle itself (Workflows / Leave) in place, since that is how you get back. "
            "If a scope control must stay, it should not silently change view - that side "
            "effect is what makes it feel broken.",
        code="pages/MyWork.js:2429-2515 (mywork-controls / work-view-toggle); "
             "handlers at 2442, 2448, 2463",
        found="2026-09-12",
    ),
    dict(
        id="MW-12", section="My Work", screen="Leave and Workflows entry points",
        viewport="Mobile", persona="All", severity="Medium", status="Open",
        area="Information architecture",
        tested="Looked for the Leave and Workflows views from My Work on a phone.",
        expected="The same two views are reachable from My Work on mobile as on desktop.",
        actual="Neither toggle is reachable on mobile - both are in the DOM but hidden, so "
               "from My Work there is no way into Leave or Workflows on a phone. They are "
               "reachable, but from somewhere else entirely: the 'More' panel lists them "
               "as their own destinations. So the same two features are sub-views of My "
               "Work on desktop and separate destinations on mobile.",
        evidence="At 390x844 work-view-leave and work-view-workflows are present in the "
                 "DOM with 0 visible matches. The More panel lists 'Workflows' and "
                 "'Leave' as tiles, and /leave loads as its own route.",
        cause="The view toggle group is desktop-only, and mobile was given the More panel "
              "instead. Both were built; neither was reconciled with the other.",
        fix="Pick one home per feature and use it on both viewports. Given Leave already "
            "has its own route and its own mobile tile, the cheaper and more consistent "
            "direction is to make the standalone page the home on desktop too - see the "
            "note on MW-11 about how little of Leave actually belongs in My Work.",
        code="pages/MyWork.js:2476 (work-view-toggle); components/mobile/AllAppsPanel.jsx",
        found="2026-09-12",
    ),
    dict(
        id="MW-13", section="My Work", screen="Workflows view - pipeline cards",
        viewport="Desktop", persona="All", severity="Low", status="Open",
        area="Accessibility",
        tested="Catalogued every control in the embedded Workflows view and compared their "
               "accessible names.",
        expected="Controls that do different things are distinguishable by name.",
        actual="Five separate buttons are all named exactly 'Delete card', and two are "
               "both named 'Advance to Delivered'. Sighted users tell them apart by which "
               "card they sit on; a screen-reader user hears the same phrase five times "
               "with nothing to say which shipment is about to be deleted. Deletion is "
               "the most destructive action in the view, which is what lifts this above "
               "cosmetic.",
        evidence="Control inventory of workflows-hub: 'Delete card' x5, "
                 "'Advance to Delivered' x2, across 21 controls.",
        cause="The buttons carry a static label and rely on visual position within their "
              "card for meaning.",
        fix="Give each an aria-label that names its card, e.g. 'Delete card: Dispatch 100 "
            "sales items today'. The card title is already to hand where the button is "
            "rendered.",
        code="pages/Workflows.js (delete-workflow-* and advance-workflow-* buttons)",
        found="2026-09-12",
    ),
    dict(
        id="MW-14", section="My Work", screen="Page heading in the Leave / Workflows views",
        viewport="Desktop", persona="All", severity="Nit", status="Open",
        area="Orientation",
        tested="Read the page heading while the Leave view and the Workflows view were "
               "open.",
        expected="The heading names what is on screen.",
        actual="The heading stays 'My Work' with the eyebrow 'YOUR DAY, SIMPLIFIED' even "
               "when the body is entirely leave requests or delivery pipelines. Nothing "
               "above the fold says which of the three views is active except the small "
               "toggle pill.",
        evidence="Screenshot of the Leave view at 1440x900: heading reads 'My Work' above "
                 "a leave-request list.",
        cause="The header is rendered once, outside the view switch.",
        fix="Swap the heading with the view - 'Leave' or 'Workflows' - or append the view "
            "name. Only worth doing if the views stay inside My Work at all; see MW-12.",
        code="pages/MyWork.js (page header, above the view switch at 2527)",
        found="2026-09-12",
    ),
    dict(
        id="MW-05", section="My Work", screen="Task list - bento grid",
        viewport="Desktop", persona="All", severity="Low", status="Open",
        area="Visual / alignment",
        tested="Measured the vertical offset of each card's title against its own card top, "
               "across the first four rows of the desktop grid.",
        expected="Cards sitting in the same row start their titles on the same line.",
        actual="Titles in one row start at different heights - the spread was 39px, 17px, "
               "11px and 17px across the first four rows. A short title sinks toward the "
               "middle of its card while a long one starts at the top, so the row reads as "
               "ragged. The checkboxes stay aligned, which makes it more obvious.",
        evidence="Row 1: titleTop +56 / +17 / +17 with all three cards 161px tall.",
        cause="The summary is a <button> with display:block that the grid stretches to the "
              "row height. A button's anonymous content box is centred vertically by the "
              "browser, so content shorter than the stretched button drifts to the middle.",
        fix="Make the button a column flex container and pin content to the top - add "
            "'flex flex-col justify-start' to its className. Verified live in the browser: "
            "all three titles then start at 17px.",
        code="pages/MyWork.js:1181 (the task-summary button className)",
        found="2026-09-12",
    ),
    dict(
        id="MW-06", section="My Work", screen="Category tab bar",
        viewport="Desktop", persona="Owner", severity="Nit", status="Open",
        area="Loading state",
        tested="Switched the scope from My Tasks to All Tasks and watched the tab counters "
               "during the roughly 3 second fetch.",
        expected="While loading, the counter shows nothing, or a placeholder.",
        actual="The tab reads 'All 0' for the whole fetch, which states a count of zero "
               "rather than an unknown one. The card skeletons underneath are correct, so "
               "the count is the only misleading element.",
        evidence="t+300ms to t+1500ms: 16 skeletons rendered, tab text 'All 0'; at t+2500ms "
                 "it becomes 'All 134'.",
        cause="The counter renders the length of an empty list while the query is in flight "
              "instead of branching on the loading state.",
        fix="While the tasks query is loading, render a dash or omit the count, matching "
            "the skeleton treatment already used for the cards below.",
        code="pages/MyWork.js:2556-2566 (work-tabs counts)",
        found="2026-09-12",
    ),
    dict(
        id="MW-07", section="My Work", screen="Task card - Complete (evidence required)",
        viewport="Mobile + Desktop", persona="Owner / assignee", severity="Nit",
        status="By design", area="Affordance",
        tested="Created a task with 'evidence required', then pressed Complete with no "
               "proof attached, and checked whether the task completed.",
        expected="Completion is blocked until proof is attached.",
        actual="Completion IS correctly blocked - the task stays in the active list and an "
               "explanatory toast appears. The only nit is that the button looks available "
               "and only explains itself after it is pressed.",
        evidence="Toast: 'This task requires proof - add a photo, voice note, or file "
                 "before completing.' Task remained in the active list afterwards.",
        cause="complete() guards on evidence_required and returns a toast instead of the "
              "button carrying a disabled state.",
        fix="Optional polish only: disable Complete while proof is missing and put the "
            "reason in a tooltip or helper line, so the constraint is visible before the "
            "click rather than after it. Current behaviour is safe and correct.",
        code="pages/MyWork.js:1107-1119",
        found="2026-09-12",
    ),
]

# ---------------------------------------------------------------------------
# 2. TEST COVERAGE
# ---------------------------------------------------------------------------
COV_COLS = [
    ("ID", 10), ("Section", 11), ("Screen / Flow", 30), ("Viewport", 18),
    ("Persona", 16), ("Test case", 60), ("Type", 15), ("Result", 10),
    ("Observed", 52), ("Linked bug", 12),
]

COVERAGE = [
    # --- layout / responsiveness ---
    ("T-001", "My Work", "Page shell", "Mobile 390x844", "Owner",
     "No horizontal overflow anywhere on the page", "Responsive", "PASS",
     "scrollWidth 390 = clientWidth 390", ""),
    ("T-002", "My Work", "Page shell", "Desktop 1440x900", "Owner",
     "No horizontal overflow anywhere on the page", "Responsive", "PASS",
     "scrollWidth 1440 = clientWidth 1440", ""),
    ("T-003", "My Work", "All controls", "Mobile 390x844", "Owner",
     "Every interactive control meets the 24px minimum tap target", "Accessibility",
     "PASS", "0 of 67 under 24px once the clickable label wrapper is measured", ""),
    ("T-004", "My Work", "All controls", "Both", "Owner",
     "No clipped text, no offscreen controls, no unnamed buttons or links",
     "Visual", "PASS", "0 clipped, 0 offscreen, 0 unnamed, 0 images missing alt", ""),
    ("T-005", "My Work", "Task list - bento grid", "Desktop 1440x900", "Owner",
     "Cards in the same row align their titles on one line", "Visual", "FAIL",
     "Title top offsets differ by up to 39px within a row", "MW-05"),
    ("T-006", "My Work", "Task card (expanded)", "Mobile 390x844", "Owner",
     "Expanding a task does not introduce sideways scrolling", "Responsive", "PASS",
     "scrollWidth stays 390 with the body open", ""),

    # --- navigation / routing ---
    ("T-010", "My Work", "Sidebar / dock navigation", "Both", "Owner",
     "Every nav destination routes correctly and the active item is marked",
     "Routing", "PASS",
     "inbox, my-work, ops, crm, team, brain, finance all resolve; aria-current=page set", ""),
    ("T-011", "My Work", "Route /my-work", "Both", "Owner",
     "The route loads My Work directly without redirecting", "Routing", "PASS",
     "Landed on /my-work on both viewports", ""),
    ("T-012", "My Work", "View toggles", "Desktop 1440x900", "Owner",
     "Workflows and Leave toggles switch the surface and return", "Routing", "PASS",
     "work-view-workflows shows workflows-hub; Leave renders; return works", ""),

    # --- filters and lenses ---
    ("T-020", "My Work", "Scope: My Tasks / All Tasks", "Both", "Owner",
     "All Tasks widens the set and My Tasks narrows it back", "Functional", "PASS",
     "mine=28, all=134, restore=28; skeletons shown during the ~3s fetch", ""),
    ("T-021", "My Work", "Category tabs", "Desktop 1440x900", "Owner",
     "Each category tab filters to its own subset", "Functional", "PASS",
     "All 28, Sales 1, Logistics 1, HR 1, Completed 5", ""),
    ("T-022", "My Work", "AI priority toggle", "Mobile 390x844", "Owner",
     "Grouping by priority keeps the same tasks and opens on the High band",
     "Functional", "PASS", "28 tasks group into High 5 / Medium 22 / Low 1", ""),
    ("T-023", "My Work", "Priority band lens", "Mobile 390x844", "Owner",
     "Each band shows exactly the number of tasks it advertises", "Functional", "PASS",
     "High shows 5/5, Medium 22/22, Low 1/1", ""),
    ("T-024", "My Work", "Status lens", "Mobile 390x844", "Owner",
     "Each status filters to a subset of the loaded tasks", "Functional", "PASS",
     "todo / in_progress / waiting / review all return subsets", ""),
    ("T-025", "My Work", "Tab counters while loading", "Desktop 1440x900", "Owner",
     "Counters do not state a wrong number while the list is loading", "Visual", "FAIL",
     "Reads 'All 0' for the whole fetch before becoming 'All 134'", "MW-06"),

    # --- task lifecycle ---
    ("T-030", "My Work", "New Task dialog", "Desktop 1440x900", "Owner",
     "A task can be created with title, description, assignee, priority and due date",
     "Functional", "PASS", "POST /api/tasks returns 200; the card appears in the list", ""),
    ("T-031", "My Work", "New Task dialog", "Desktop 1440x900", "Owner",
     "The dialog closes itself once the task is created", "Functional", "PASS",
     "Dialog dismissed without needing the close button", ""),
    ("T-032", "My Work", "Task card - status", "Desktop 1440x900", "Owner",
     "Moving through todo, in_progress, waiting, review updates the card",
     "Functional", "FAIL",
     "Saved correctly but the card keeps the previous status until a reload", "MW-01"),
    ("T-033", "My Work", "Task card - status pills", "Mobile 390x844", "Owner",
     "Tapping a status pill marks it as the active status", "Functional", "FAIL",
     "Pill never becomes pressed; the value only appears after reload", "MW-01"),
    ("T-034", "My Work", "Task card - progress", "Desktop 1440x900", "Owner",
     "Setting progress to 50% is stored", "Functional", "PASS",
     "Server records progress=50, and the card shows it after a reload", ""),
    ("T-034b", "My Work", "Task card - progress", "Desktop 1440x900", "Owner",
     "The card reflects the new progress without needing a reload", "Functional", "FAIL",
     "Card still reads 0% after the save - the same stale render as the status control",
     "MW-01"),
    ("T-035", "My Work", "Task card - Update / Escalate", "Desktop 1440x900", "Owner",
     "An update can be logged and appears in the task's trail", "Functional", "FAIL",
     "Opening the form throws 'CTRL_ON is not defined' and unmounts the whole app",
     "MW-08"),
    ("T-035b", "My Work", "Task card - log update", "Mobile 390x844", "Owner",
     "The mobile 'Log update or hand off' button opens the update form",
     "Functional", "FAIL", "Button is inert - no handler, nothing happens", "MW-09"),
    ("T-035c", "Global", "Application shell", "Both", "All",
     "A component that throws degrades locally instead of killing the app",
     "Stability", "FAIL",
     "No error boundary exists; the MW-08 crash left the React root empty", "MW-10"),
    ("T-036", "My Work", "Task card - Complete", "Desktop 1440x900", "Owner",
     "Completing a task removes it from the active list", "Functional", "PASS",
     "Task leaves the active list and is found under the Completed tab", ""),
    ("T-037", "My Work", "Task card - Reopen", "Desktop 1440x900", "Owner",
     "A completed task can be reopened back into active work", "Functional", "PASS",
     "Reopen control present on completed tasks and returns the task", ""),
    ("T-038", "My Work", "Task card - Delete", "Both", "Owner",
     "A task can be deleted from the UI", "Functional", "FAIL",
     "No delete control exists on either viewport; the detail dialog never opens", "MW-02"),

    # --- gates ---
    ("T-040", "My Work", "Evidence gate", "Desktop 1440x900", "Owner",
     "A task marked 'evidence required' cannot be completed without proof",
     "Functional", "PASS",
     "Completion blocked with an explanatory toast; the task stayed active", "MW-07"),
    ("T-041", "My Work", "Approval gate", "Desktop 1440x900", "Owner",
     "A task needing approval shows Pending Approval and offers Approve / Reject",
     "Functional", "PASS",
     "Status chip reads 'Pending Approval'; approve / reject / clarify all render", ""),
    ("T-042", "My Work", "Approval gate", "Desktop 1440x900", "Owner",
     "Approving clears the pending state", "Functional", "PASS",
     "Approval actions correctly gone after approve plus reload", "MW-01"),

    # --- assignment / hand-off ---
    ("T-050", "My Work", "Assignment scope", "Desktop 1440x900", "Owner",
     "A task assigned to somebody else stays out of the creator's My Tasks",
     "Permissions", "PASS", "Absent from My Tasks, present under All Tasks", ""),
    ("T-051", "My Work", "Owner to assignee hand-off", "Desktop 1440x900",
     "Owner then Production",
     "A task assigned to a colleague reaches that colleague's own My Work",
     "Permissions", "PASS",
     "Assigned to Amit Verma (production@sharma.com); the task stores the right "
     "assignee and appears in his My Work on login", ""),
    ("T-052", "My Work", "Assignee accepts the work", "Desktop 1440x900", "Production",
     "The assignee can move their own task to In Progress", "Permissions", "PASS",
     "Server confirms status=in_progress after the assignee changes it", ""),
    ("T-053", "My Work", "Assignee can finish", "Desktop 1440x900", "Production",
     "The assignee is offered Complete on their own task", "Permissions", "PASS",
     "Complete control present for the assignee", ""),

    # --- bulk ---
    ("T-060", "My Work", "Bulk selection", "Desktop 1440x900", "Owner",
     "Selecting rows reveals the bulk action bar with complete, reassign and clear",
     "Functional", "PASS", "Bar appears; all three actions offered", ""),
    ("T-061", "My Work", "Bulk clear", "Desktop 1440x900", "Owner",
     "Clearing the selection dismisses the bulk bar", "Functional", "PASS",
     "Bar removed after clear", ""),
    ("T-062", "My Work", "Bulk complete", "Desktop 1440x900", "Owner",
     "Bulk complete marks every selected task done", "Functional", "PASS",
     "Ran on two throwaway tasks: server reports both done; the bulk bar clears itself",
     ""),
    ("T-063", "My Work", "Bulk reassign", "Desktop 1440x900", "Owner",
     "Bulk reassign moves every selected task to the chosen person", "Functional", "PASS",
     "Ran on two throwaway tasks: both assignee_ids became the selected user (Priya Nair)",
     ""),

    # --- sub-views: Workflows and Leave ---
    ("T-090", "My Work", "Workflows view (embedded)", "Desktop 1440x900", "Owner",
     "The Workflows toggle opens the pipelines hub", "Functional", "PASS",
     "workflows-hub renders, 21 controls, 6 stage pipelines with counts", ""),
    ("T-091", "My Work", "Workflows view (embedded)", "Desktop 1440x900", "Owner",
     "No horizontal overflow and every control has an accessible name",
     "Responsive", "PASS", "1440 = 1440; 0 unnamed controls", ""),
    ("T-092", "My Work", "Workflows view (embedded)", "Desktop 1440x900", "Owner",
     "No dead controls among the non-destructive ones", "Functional", "PASS",
     "6 exercised, all changed state; 10 destructive catalogued not fired", ""),
    ("T-093", "My Work", "Workflows view - card actions", "Desktop 1440x900", "Owner",
     "Controls that do different things are distinguishable by name",
     "Accessibility", "FAIL",
     "'Delete card' x5 and 'Advance to Delivered' x2 share identical names", "MW-13"),
    ("T-094", "My Work", "Leave view (embedded)", "Desktop 1440x900", "Owner",
     "The Leave toggle opens the leave surface", "Functional", "PASS",
     "My Leave / Approvals tabs, Request Leave, Report Absence, settings all render", ""),
    ("T-095", "My Work", "Leave view (embedded)", "Desktop 1440x900", "Owner",
     "No horizontal overflow and every control has an accessible name",
     "Responsive", "PASS", "1440 = 1440; 0 unnamed controls", ""),
    ("T-096", "My Work", "Leave view (embedded)", "Desktop 1440x900", "Owner",
     "No dead controls among the non-destructive ones", "Functional", "PASS",
     "10 exercised, all changed state; 1 destructive catalogued not fired", ""),
    ("T-097", "My Work", "Toolbar in Leave / Workflows", "Desktop 1440x900", "Owner",
     "The toolbar only offers controls that apply to the active view",
     "Information architecture", "FAIL",
     "New Task, My Tasks, All Tasks and AI Priority all remain; three of them eject "
     "you back to the task list when pressed", "MW-11"),
    ("T-098", "My Work", "Leave / Workflows entry points", "Mobile 390x844", "Owner",
     "Both views are reachable from My Work on a phone", "Information architecture",
     "FAIL",
     "Neither toggle is visible on mobile; both live in the 'More' panel as separate "
     "destinations instead", "MW-12"),
    ("T-099", "My Work", "Page heading", "Desktop 1440x900", "Owner",
     "The heading names the view that is on screen", "Orientation", "FAIL",
     "Heading stays 'My Work' over a leave-request list", "MW-14"),
    ("T-100", "Leave", "Standalone /leave route", "Mobile 390x844", "Owner",
     "Leave is usable on mobile through its own route", "Routing", "PASS",
     "/leave renders the user's leave records directly", ""),

    # --- personas ---
    ("T-070", "My Work", "Page load", "Desktop 1440x900", "Owner",
     "Owner sees all tasks, can create, and gets the All Tasks scope",
     "Permissions", "PASS",
     "28 tasks; create yes; all-scope yes; tabs all/sales/logistics/hr/completed", ""),
    ("T-071", "My Work", "Page load", "Desktop 1440x900", "Sales",
     "Sales sees their own work and no cross-tenant scope switch", "Permissions", "PASS",
     "29 tasks; create yes; all-scope no; tabs all/sales/finance/completed", ""),
    ("T-072", "My Work", "Page load", "Desktop 1440x900", "Production",
     "Production sees a narrowed set scoped to their role", "Permissions", "PASS",
     "12 tasks; create yes; all-scope no; tabs all/production/finance", ""),
    ("T-073", "My Work", "Page load", "Desktop 1440x900", "Finance",
     "Finance sees a narrowed set scoped to their role", "Permissions", "PASS",
     "13 tasks; create yes; all-scope no; tabs all/finance", ""),
    ("T-074", "My Work", "Page load", "Desktop 1440x900", "All four",
     "No uncaught page errors for any persona", "Stability", "PASS",
     "0 page errors across owner, sales, production and finance", ""),

    # --- errors / console ---
    ("T-080", "My Work", "Console + network", "Both", "Owner",
     "No application console errors and no failing API calls in normal use",
     "Stability", "PASS",
     "Only the pre-login 401 on /auth/me, which is the app discovering it has no "
     "session yet", ""),
    ("T-081", "Global", "Global search dialog", "Desktop 1440x900", "Owner",
     "Opening global search logs no accessibility errors", "Accessibility", "FAIL",
     "Radix logs a missing DialogTitle error on every open", "MW-03"),
    ("T-082", "Global", "Dex FAB picker", "Mobile 390x844", "Owner",
     "The picker closes on Escape", "Accessibility", "FAIL",
     "Escape is ignored; only a pointer tap dismisses it", "MW-04"),
    ("T-083", "My Work", "Control sweep", "Mobile 390x844", "Owner",
     "Every non-destructive control responds without breaking the page",
     "Stability", "PASS", "13 controls exercised, 0 click failures, page never blanked", ""),
    ("T-084", "My Work", "Control sweep", "Desktop 1440x900", "Owner",
     "Every non-destructive control responds without breaking the page",
     "Stability", "PASS", "24 controls exercised, 0 click failures, page never blanked", ""),
]

# ---------------------------------------------------------------------------
# 3. VERIFIED NON-ISSUES  (kept so they are not re-raised)
# ---------------------------------------------------------------------------
NON_COLS = [
    ("ID", 10), ("Section", 11), ("Initial observation", 46),
    ("Why it is NOT a bug", 74), ("How it was verified", 56),
]

NON_ISSUES = [
    ("N-01", "My Work",
     "Bulk-select checkboxes measure only 16x16, below the 24px tap-target minimum.",
     "The checkbox is wrapped in a padded label that is itself clickable, so the real "
     "tap area is 44x114 - comfortably above both the WCAG minimum and the 44px "
     "touch guidance.",
     "Measured the effective hit box by walking up to the clickable wrapper: own 16x16, "
     "hit 44x114."),
    ("N-02", "My Work",
     "The bottom dock and Dex button overlap task cards on mobile.",
     "They are fixed chrome floating above a scroll container that carries matching "
     "bottom padding, so any card can always be scrolled clear of them. This is the "
     "intended mobile pattern, not a collision.",
     "Scrolled to the end of the list: vertical overlap with the last card is 0px, and "
     "the scroller carries a pb-dock padding class."),
    ("N-03", "Global",
     "Console error: a span cannot be a child of an option, with a hydration warning.",
     "This comes from the Emergent visual-edits dev tooling, which wraps dynamic text in "
     "a span. Craco only enables it when NODE_ENV is not production, so it never reaches "
     "a build and users never see it.",
     "Inspected the offending nodes - they carry the tool's own data-ve-dynamic and "
     "x-excluded attributes - and confirmed the craco gate isDevServer."),
    ("N-04", "My Work",
     "Clicking the nav item for the page you are already on does nothing.",
     "That is the correct behaviour, and the active page is properly exposed to assistive "
     "technology, so nothing is missing.",
     "Confirmed aria-current=page is set on dock-work and on nav-my-work while on "
     "/my-work."),
    ("N-05", "My Work",
     "The priority bands appeared to do nothing - High, Medium and Low each showed all "
     "28 tasks.",
     "The bands do filter correctly. The measurement was wrong: the inactive bands are "
     "hidden with display:none rather than unmounted, so counting DOM nodes counts all "
     "three bands at once.",
     "Re-counted only visible cards: High 5, Medium 22, Low 1, matching the counts each "
     "band advertises; desktop correctly shows all three columns."),
    ("N-06", "My Work",
     "Switching to All Tasks appeared to return zero tasks.",
     "All Tasks works and returns 134 tasks. The fetch takes about 3 seconds and the "
     "first reads were taken too early; skeleton loaders are displayed throughout.",
     "Polled the list after the switch: 0 cards with 16 skeletons at 300-1500ms, then "
     "134 cards at 2500ms."),
    ("N-07", "My Work",
     "The Complete button is enabled on a task that requires proof.",
     "Completion is genuinely blocked - pressing it explains what is missing and the task "
     "stays active. Only the affordance could be clearer, which is logged as the nit "
     "MW-07 rather than a defect.",
     "Pressed Complete with no proof: toast shown, and the task was still in the active "
     "list afterwards."),
]

# ---------------------------------------------------------------------------
# 5. ACTION LIST -- everything to be done: the founder's asks plus every defect
# ---------------------------------------------------------------------------
ACT_COLS = [
    ("ID", 10), ("Source", 13), ("Section", 12), ("Item", 34), ("Type", 17),
    ("Priority", 10), ("What to change", 62), ("Why / evidence", 62),
    ("Where (code)", 34), ("Depends on", 13), ("Status", 13),
]

ASKS = [
    dict(
        id="ASK-1", section="Workflows", item="Stage-not-ready override dialog",
        type="Change request", prio="Medium",
        what="Redesign the 'Stage not ready' override popup. It is a plain centred modal "
             "with a mono-styled textarea; it should carry the same material as the rest "
             "of the redesign, and Override should read as the consequential action.",
        why="Founder review of the override flow. Forcing a reason is right -- it goes "
            "into workflow history and the audit log -- but the styling predates the "
            "current design language and the two actions carry equal visual weight.",
        code="pages/Workflows.js (stage override dialog)",
        dep="", status="To do",
    ),
    dict(
        id="ASK-2", section="Workflows", item="'Delete card' does nothing",
        type="Bug fix", prio="High",
        what="Replace window.confirm with the in-app confirmation dialog, matching the "
             "delete-task-confirm pattern used elsewhere. RBAC needs no change.",
        why="VERIFIED: as owner, clicking Delete produces no dialog, removes no card and "
            "issues no DELETE request at all. The handler is wired correctly but sits "
            "behind window.confirm, which silently returns false in some browser and "
            "embedded contexts -- the exact failure FUP-49 already documented when it "
            "removed window.confirm from My Work's Complete button for looking like 'a "
            "silent no-op'. Workflows still carries the old pattern. RBAC was checked "
            "across all four logins and is already correct: only the owner sees Delete "
            "(5 buttons); sales, production and finance see none.",
        code="pages/Workflows.js:340 (del handler); precedent at pages/MyWork.js:1108",
        dep="", status="To do",
    ),
    dict(
        id="ASK-3", section="My Work", item="'+ New Task' placement",
        type="Change request", prio="Medium",
        what="Move New Task below the header and stop rendering it outside the task list "
             "-- it should not appear while the Leave or Workflows view is open.",
        why="Founder: it 'appears all over the place'. Confirmed by MW-11: in the Leave "
            "view New Task is the largest, darkest button on screen, and it creates a "
            "task rather than a leave request.",
        code="pages/MyWork.js:2429-2515 (mywork-controls)",
        dep="MW-11", status="To do",
    ),
    dict(
        id="ASK-4", section="Leave", item="Remove per-card 'AI Impact Analysis'",
        type="Change request", prio="Medium",
        what="Remove the AI Impact Analysis button from the individual leave card.",
        why="Founder: impact is not a per-request question. Analysing one request in "
            "isolation cannot answer what actually matters -- what the combined leave "
            "does to cover across the team. Removed now; the global version is ASK-5.",
        code="pages/Leave.js (leave card actions)",
        dep="", status="To do",
    ),
    dict(
        id="ASK-5", section="Leave", item="Global AI leave-impact analysis",
        type="Future scope", prio="Low",
        what="Reintroduce impact analysis at SECTION level, scoped by period -- this "
             "week, this financial year, or just what is pending approval -- so it can "
             "answer what the combined leave does to cover.",
        why="Founder: the useful question is aggregate, not per-request. Explicitly "
            "parked -- not yet ideated, so this is scope to design before it is built.",
        code="(design first)",
        dep="ASK-4", status="Parked - needs design",
    ),
    dict(
        id="ASK-6", section="Leave / Team", item="Move Leave into Team",
        type="Product decision", prio="High",
        what="Move the Leave surface out of My Work into Team. Only 'Request Leave' stays "
             "reachable from a person's own work surface; the register, history and "
             "per-department configuration live in Team.",
        why="Founder decision, and it matches what the audit found independently. Leave "
            "is an HR request-and-approval flow, not task execution: MW-11 shows four "
            "task-only controls bleeding into the Leave view with three of them ejecting "
            "you, and MW-12 shows the product already disagrees with itself -- on mobile "
            "Leave is not in My Work at all, but a separate destination in the More panel.",
        code="pages/MyWork.js (view switch), pages/Leave.js, pages/Team.js",
        dep="MW-11, MW-12", status="To do",
    ),
    dict(
        id="ASK-7", section="Decision Desk", item="Leave approvals move to the Desk",
        type="Product decision", prio="High",
        what="Move the leave Approvals queue out of Leave and into the Decision Desk, "
             "alongside the rest of the approvals.",
        why="Founder decision. Consistent with the audit: an approvals queue carrying 5 "
            "pending items currently sits inside a page titled 'My Work', while every "
            "other approval in the product is handled on the Desk.",
        code="pages/Leave.js (leave-tab-approvals), pages/Desk.js",
        dep="ASK-6", status="To do",
    ),
    dict(
        id="ASK-8", section="Leave / Settings",
        item="DELETE 'Leave Approvers by Department' (do not move it)",
        type="Product decision", prio="Medium",
        what="Founder asked whether this setting is needed at all, given the approver is "
             "already chosen when a team member is added. VERIFIED ANSWER: it is not. "
             "Recommendation is now to DELETE the screen and the tenant mapping behind "
             "it, not relocate it into Settings. Keep the two tiers that carry real "
             "meaning -- the member's reporting manager, then the owner.",
        why="The resolver runs reporting manager, then the department mapping, then the "
            "owner (services/leave.py:_resolve_leave_approver). Team.js:144 already has "
            "a Reporting Manager picker on both add and edit, so tier 1 is set where the "
            "person is created. Measured against live data: of 12 members, 1 has a "
            "reporting manager and the tenant mapping is EMPTY, so 11 of 12 resolve "
            "straight to the owner and the middle tier is used by nobody. A settings "
            "screen that configures a tier no one reaches is a third place to express "
            "the same decision, and the most likely outcome of keeping it is a mapping "
            "that quietly disagrees with the org chart. If some department genuinely "
            "needs an approver who is not the member's manager, the honest fix is to set "
            "that person as their reporting manager.",
        code="services/leave.py:_resolve_leave_approver; pages/Team.js:144 "
             "(member-manager-select); pages/Leave.js:387-417 + :500-510 (to remove); "
             "routers/calendar.py:24 (PATCH /tenant/leave-approvers)",
        dep="ASK-6", status="Awaiting decision",
    ),
    dict(
        id="ASK-9", section="My Work", item="Redesign the expanded task card (whole surface)",
        type="Change request", prio="High",
        what="Rework the UI and UX of the expanded task card end to end, not control by "
             "control. Today it stacks description, a status line, a progress rail, a "
             "status dropdown, a '% manually' disclosure, a Complete button, an Attach "
             "row, a plan row and an activity footer -- nine bands with no grouping, and "
             "the one action that records what happened is a quiet text link in the "
             "bottom-right corner. Group it into what the task IS, where it stands, and "
             "what you do next. ASK-11 and ASK-12 are the two specific decisions inside "
             "this redesign.",
        why="Founder review. Reinforced by what the audit already found on this exact "
            "surface: the log / hand-off control crashes the app (MW-08), its mobile "
            "twin is inert (MW-09), and the status and progress controls do not reflect "
            "their own changes until a reload (MW-01).",
        code="pages/MyWork.js:1295-1800 (expanded body, mobile + desktop)",
        dep="MW-01, MW-08, MW-09", status="To do",
    ),
    dict(
        id="ASK-10", section="My Work", item="Multi-select bar: contrast + wording",
        type="Change request", prio="High",
        what="Two fixes. (1) Readability: re-theme the bar's actions for its dark ground. "
             "(2) Wording: 'Reassign' here and 'hand off' on the task card are the same "
             "act -- give the work to someone else -- so settle on ONE verb and use it in "
             "both places, in the bulk bar, on the card, and in the activity trail.",
        why="MEASURED. The bar is near-black (bg-kr-ink) with white text. 'Complete' was "
            "re-themed for that ground (black on a white pill, 19.6:1) and reads fine. "
            "The other two were left on light-theme tokens: 'Reassign' uses bg-nm / "
            "nm-btn -- a light grey #E9EAEC surface -- while inheriting the bar's white "
            "text, giving white-on-light-grey at 1.2:1; 'Clear' uses "
            "text-muted-foreground, a light-theme grey #585551, on the near-black bar at "
            "2.64:1. WCAG AA wants 4.5:1. 'Clear' is also only 45x16px, under the 24px "
            "hit minimum. Counting and pluralisation are correct ('2 selected / Complete "
            "2'), so none of this is logic -- the dark-bar treatment reached one button "
            "out of three. On wording, the founder's point stands: the product currently "
            "calls the same action 'Reassign' in bulk and 'hand off' on the card.",
        code="pages/MyWork.js:918-962 (bulk-action-bar; bulk-reassign :946, "
             "bulk-clear :955); card wording at :195/:207",
        dep="", status="To do",
    ),
    dict(
        id="ASK-11", section="My Work", item="'Complete' exists twice -- button and dropdown",
        type="Change request", prio="Medium",
        what="Take the terminal states out of the desktop status dropdown. It currently "
             "offers Completed and Cancelled alongside the four in-flight states, while "
             "Complete is also its own button and Cancel is its own button -- two routes "
             "to the same ending, and the dropdown route gives none of the confirmation "
             "or the proof prompt the button does.",
        why="Founder asked why Complete appears in both places. The team already decided "
            "this once, for mobile: MyWork.js:1594 records that Completed and Cancelled "
            "were removed from the mobile status pills because both are TERMINAL, so "
            "choosing either 'removed the task from the list the bar was sitting in -- "
            "the control deleted its own context', noting Complete already has its own "
            "button. That reasoning was applied to the mobile pills and never carried "
            "across to the desktop dropdown, which still lists all six. Tested for a "
            "worse version of this -- whether the dropdown lets you finish a task that "
            "requires proof -- and it does not: both routes correctly refused to "
            "complete an evidence-required task. So this is redundancy and inconsistency, "
            "not a hole.",
        code="pages/MyWork.js:79-86 (STATUS_OPTIONS), :1602 (desktop select), "
             ":102-108 + :1594 (the mobile decision and its reasoning)",
        dep="ASK-9", status="To do",
    ),
    dict(
        id="ASK-12", section="My Work", item="Put logging where the work is",
        type="Change request", prio="Medium",
        what="Move logging up next to Attach, so the row reads as one act: attach a "
             "photo, a file, a voice note -- or write what happened. Escalate and hand "
             "off then become choices WITHIN that one flow rather than separate controls "
             "elsewhere on the card, which is what the underlying form already models.",
        why="Founder direction, and the code already agrees. UpdateForm takes an action "
             "of exactly this shape -- a note plus a choice of update, escalate or hand "
             "off, with a person picker appearing for hand-off -- so the three are "
             "already one flow in the data model and only look like separate features on "
             "screen. Today the entry point sits far from Attach, in the footer, as the "
             "lightest control on the card despite recording the most important thing.",
        code="pages/MyWork.js:111-166 (UpdateForm + its ACTIONS), :1740-1780 (attach "
             "row), :195/:207 (current entry point)",
        dep="ASK-9", status="To do",
    ),
]

# ---------------------------------------------------------------------------
# 4. HOW TO USE
# ---------------------------------------------------------------------------
LEGEND = [
    ("Purpose", ""),
    ("", "One workbook for the whole DecisionOS UI audit. Every screen is tested on "
         "mobile and desktop, across personas, and every finding lands here with the "
         "evidence that proves it and the fix that would close it."),
    ("", ""),
    ("Sheets", ""),
    ("Bug Log", "Confirmed defects. One row per defect, with root cause and a proposed "
                "solution. This is the sheet to work from."),
    ("Test Coverage", "Everything that was tested and how it came out, so the gaps are "
                      "as visible as the failures."),
    ("Verified Non-Issues", "Things that looked like defects and were disproved. Kept on "
                            "purpose so nobody spends the afternoon re-finding them."),
    ("", ""),
    ("Severity", ""),
    ("Critical", "Data loss, a security hole, or the section cannot be used at all."),
    ("High", "A core action is broken, silently wrong, or entirely missing."),
    ("Medium", "Works, but a real group of users is blocked or misled - accessibility "
               "failures live here."),
    ("Low", "Visible imperfection with no functional cost."),
    ("Nit", "Polish. Safe to close as won't-fix if priorities are elsewhere."),
    ("", ""),
    ("Status", ""),
    ("Open", "Confirmed and not yet fixed."),
    ("By design", "Behaviour is intentional; any row here is a suggestion, not a defect."),
    ("Fixed", "Corrected and re-tested - record the re-test in Test Coverage."),
    ("Won't fix", "Accepted as-is. Say why in the row."),
    ("", ""),
    ("Result values (Test Coverage)", ""),
    ("PASS", "Behaved as expected."),
    ("FAIL", "Did not - must link to a Bug Log ID."),
    ("BLOCKED", "Could not be judged because another defect got in the way."),
    ("N/A", "Deliberately not run - say why (for example destructive against shared data)."),
    ("", ""),
    ("Ground rules", ""),
    ("Evidence", "Every FAIL carries a measurement, a response body, or a screenshot. No "
                 "finding is filed on impression alone."),
    ("Disprove first", "Anything that looks wrong is re-measured before it is filed. The "
                       "Verified Non-Issues sheet is the record of that step."),
    ("Shared data", "Destructive actions are never fired blind against the shared dev "
                    "database. Test rows are tagged and deleted afterwards."),
    ("Regenerating", "This file is rebuilt from backend/scripts/build_ui_bug_report.py. "
                     "Edit the tables in that script, not the spreadsheet, so the two "
                     "never drift apart."),
    ("", ""),
    ("Artifacts", ""),
    ("Screenshots", ".audit-artifacts/ux/<section>/<viewport>/"),
    ("Raw reports", ".audit-artifacts/ux/<section>/report.json"),
    ("Harness", "backend/scripts/ux_audit.py (layout, a11y, console, control sweep)"),
    ("", "backend/scripts/ux_flow_mywork.py (filters and lenses do the right thing)"),
    ("", "backend/scripts/ux_lifecycle_mywork.py (create to delete, every persona)"),
]


# ---------------------------------------------------------------------------
def style_header(ws, ncols):
    thin = Side(style="thin", color="D6D6D6")
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True, color=HEAD_FG, size=10)
        cell.fill = PatternFill("solid", fgColor=HEAD_BG)
        cell.alignment = Alignment(vertical="center", horizontal="left", wrap_text=True)
        cell.border = Border(bottom=thin)
    ws.row_dimensions[1].height = 30
    ws.freeze_panes = "A2"


def write_sheet(wb, title, cols, rows, sev_col=None, status_col=None, result_col=None):
    ws = wb.create_sheet(title)
    ws.append([c[0] for c in cols])
    for i, (_, w) in enumerate(cols, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    style_header(ws, len(cols))

    thin = Side(style="thin", color="EDEDED")
    for r in rows:
        ws.append(list(r))
        row = ws.max_row
        ws.row_dimensions[row].height = 82
        for c in range(1, len(cols) + 1):
            cell = ws.cell(row=row, column=c)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            cell.font = Font(size=9, color=INK)
            cell.border = Border(bottom=thin)
        if sev_col:
            cell = ws.cell(row=row, column=sev_col)
            cell.font = Font(size=9, bold=True, color=SEV.get(cell.value, INK))
        if status_col:
            cell = ws.cell(row=row, column=status_col)
            fill = STATUS_FILL.get(cell.value)
            if fill:
                cell.fill = PatternFill("solid", fgColor=fill)
            cell.font = Font(size=9, bold=True, color=INK)
        if result_col:
            cell = ws.cell(row=row, column=result_col)
            fill = PASS_FILL.get(cell.value)
            if fill:
                cell.fill = PatternFill("solid", fgColor=fill)
            cell.font = Font(size=9, bold=True, color=INK)
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{ws.max_row}"
    return ws


def main():
    wb = Workbook()
    wb.remove(wb.active)

    bug_rows = [
        [f["id"], f["section"], f["screen"], f["viewport"], f["persona"], f["severity"],
         f["status"], f["area"], f["tested"], f["expected"], f["actual"], f["evidence"],
         f["cause"], f["fix"], f["code"], f["found"]]
        for f in FINDINGS
    ]
    write_sheet(wb, "Bug Log", BUG_COLS, bug_rows, sev_col=6, status_col=7)
    write_sheet(wb, "Test Coverage", COV_COLS, COVERAGE, result_col=8)
    write_sheet(wb, "Verified Non-Issues", NON_COLS, NON_ISSUES)

    # ---- Action List: the founder's asks first, then every defect by severity ----
    PRIO_RANK = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Nit": 4}
    act_rows = [
        [a["id"], "Founder review", a["section"], a["item"], a["type"], a["prio"],
         a["what"], a["why"], a["code"], a["dep"], a["status"]]
        for a in ASKS
    ]
    for f in sorted(FINDINGS, key=lambda x: PRIO_RANK.get(x["severity"], 9)):
        act_rows.append([
            f["id"], "UI audit", f["section"], f["screen"],
            "By design" if f["status"] == "By design" else "Bug fix",
            f["severity"], f["fix"], f["actual"], f["code"], "",
            "Not a defect" if f["status"] == "By design" else "To do",
        ])
    write_sheet(wb, "Action List", ACT_COLS, act_rows, sev_col=6, status_col=11)

    ws = wb.create_sheet("How to use")
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 108
    ws.append(["DecisionOS - UI / UX audit standard", ""])
    ws["A1"].font = Font(bold=True, size=13, color=INK)
    ws.append(["", ""])
    for k, v in LEGEND:
        ws.append([k, v])
        r = ws.max_row
        ws.cell(row=r, column=1).font = Font(bold=True, size=10, color=INK)
        ws.cell(row=r, column=1).alignment = Alignment(vertical="top")
        ws.cell(row=r, column=2).alignment = Alignment(vertical="top", wrap_text=True)
        ws.cell(row=r, column=2).font = Font(size=10, color=INK)
        if v and len(v) > 90:
            ws.row_dimensions[r].height = 30

    # summary block at the top of the Bug Log
    counts = {}
    for f in FINDINGS:
        counts[f["severity"]] = counts.get(f["severity"], 0) + 1
    passes = sum(1 for c in COVERAGE if c[7] == "PASS")
    fails = sum(1 for c in COVERAGE if c[7] == "FAIL")
    blocked = sum(1 for c in COVERAGE if c[7] == "BLOCKED")
    na = sum(1 for c in COVERAGE if c[7] == "N/A")
    ws.append(["", ""])
    ws.append(["Run summary - My Work", ""])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=11, color=INK)
    for k, v in [
        ("Checks run", f"{len(COVERAGE)} ({passes} pass, {fails} fail, "
                       f"{blocked} blocked, {na} not run)"),
        ("Defects", ", ".join(f"{v} {k}" for k, v in counts.items())),
        ("Non-issues disproved", str(len(NON_ISSUES))),
        ("Viewports", "Mobile 390x844 and Desktop 1440x900"),
        ("Personas", "Owner, Sales, Production, Finance"),
        ("Audited on", "2026-09-12, branch karma-redesign"),
    ]:
        ws.append([k, v])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True, size=10, color=INK)
        ws.cell(row=ws.max_row, column=2).font = Font(size=10, color=INK)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT)
    print(f"wrote {OUT.relative_to(REPO)}")
    print(f"  Bug Log            : {len(FINDINGS)} rows")
    print(f"  Test Coverage      : {len(COVERAGE)} rows "
          f"({passes} pass / {fails} fail / {blocked} blocked / {na} n-a)")
    print(f"  Verified Non-Issues: {len(NON_ISSUES)} rows")


if __name__ == "__main__":
    main()

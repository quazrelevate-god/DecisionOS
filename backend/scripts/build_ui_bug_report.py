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
    "Assigned - Yokesh": "E6EEFB",
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
    ("Code location", 34), ("Found on", 11), ("Verification", 58),
]

FINDINGS = [
    dict(
        id="MW-08", section="My Work", screen="Task card - Update / Escalate",
        viewport="Desktop", persona="Owner / assignee", severity="Critical", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: Update / Escalate opens the form; app stays alive; 0 CTRL_ON errors.",
        code="pages/MyWork.js:147 (UpdateForm); constants removed in 5fb96f2; "
             "lint narrowed at craco.config.js:74",
        found="2026-09-12",
    ),
    dict(
        id="MW-09", section="My Work", screen="Task card - 'Log update or hand off' (mobile)",
        viewport="Mobile", persona="Owner / assignee", severity="High", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: mobile 'Log update or hand off' now opens the update form.",
        code="pages/MyWork.js:1496-1505 (log-update-m button, no onClick)",
        found="2026-09-12",
    ),
    dict(
        id="MW-10", section="Global", screen="Application shell",
        viewport="Mobile + Desktop", persona="All", severity="High", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: frontend/src/components/ErrorBoundary.jsx exists.",
        code="frontend/src/App.js (route tree) and components/Layout.js (shell)",
        found="2026-09-12",
    ),
    dict(
        id="MW-01", section="My Work", screen="Task card - status control",
        viewport="Mobile + Desktop", persona="Owner (all)", severity="High", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: status change now reflects on the card without a reload (set 'waiting', card read 'waiting').",
        code="pages/MyWork.js:1127 setStatus / 1134 setProgress; refresh() at 2102",
        found="2026-09-12",
    ),
    dict(
        id="MW-02", section="My Work", screen="Task card - detail dialog",
        viewport="Mobile + Desktop", persona="Owner (all)", severity="High", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: overflow menu > View details opens task-detail-<id> with Delete visible.",
        code="pages/MyWork.js:986 (state), 1837 (render), 737-890 (the dialog + delete)",
        found="2026-09-12",
    ),
    dict(
        id="MW-03", section="Global", screen="Header - global search (Cmd+K)",
        viewport="Desktop", persona="All", severity="Medium", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: global search dialog's aria-labelledby now resolves to 'Search'; 0 Radix warnings.",
        code="components/ui/command.jsx:19 (used at components/Layout.js:599)",
        found="2026-09-12",
    ),
    dict(
        id="MW-04", section="Global", screen="Dex FAB picker (mobile)",
        viewport="Mobile", persona="All", severity="Medium", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: Dex FAB scrim present after opening, gone after Escape.",
        code="components/mobile/DexFab.jsx:70-82",
        found="2026-09-12",
    ),
    dict(
        id="MW-11", section="My Work", screen="Toolbar in the Leave / Workflows views",
        viewport="Desktop", persona="All", severity="Medium", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: no task-only controls visible in the Leave view.",
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
        viewport="Desktop", persona="All", severity="Low", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: delete controls now named per card, e.g. 'Delete card: Toyota Order Dispatch'.",
        code="pages/Workflows.js (delete-workflow-* and advance-workflow-* buttons)",
        found="2026-09-12",
    ),
    dict(
        id="MW-14", section="My Work", screen="Page heading in the Leave / Workflows views",
        viewport="Desktop", persona="All", severity="Nit", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: headings read ['My Work', 'Leave'] in the Leave view.",
        code="pages/MyWork.js (page header, above the view switch at 2527)",
        found="2026-09-12",
    ),
    dict(
        id="MW-20", section="My Work", screen="Task drawer - every click inside closes it",
        viewport="Mobile + Desktop", persona="All", severity="Critical", status="Fixed",
        area="Regression / broken flow",
        tested="On the newest code (after 78d01df), opened a task drawer at 1440x900 and "
               "390x844 and clicked five harmless targets inside it, reopening before "
               "each: the title, empty space at the bottom, the status control, 'Log "
               "update or hand off', and 'Add manually'. Writes were blocked.",
        expected="Clicking inside the drawer uses the drawer.",
        actual="Every click closes it, on both viewports - 10 of 10. The drawer is now "
               "the only place a task can be worked (status, progress, Complete, "
               "Attach, Log update, hand off), so none of that is usable. On mobile the "
               "status pill tap fired its PATCH before the drawer shut, so the action "
               "happens but the user is thrown back to the list without seeing it. "
               "Likely also (from the code, not testable while the form cannot be "
               "opened): pressing Space or Enter in any drawer field hits the card's "
               "onKeyDown, which calls preventDefault and toggles the drawer - so a "
               "user could not type a space in an update note.",
        evidence="Drawer still open after click: title False, empty body False, status "
                 "False, Log update False (update-form 0), Add manually False - at both "
                 "1440 and 390. Mobile: 1 mutation aborted by the harness on the status "
                 "tap. Before 78d01df the same drawer stayed open and Log update worked "
                 "on desktop (T-119).",
        cause="78d01df moved the click handler to the card root (role=button, onClick "
              "toggles the drawer). The Sheet is rendered INSIDE that card component. "
              "React propagates synthetic events through portals along the component "
              "tree, not the DOM tree, so a click anywhere in the portalled drawer "
              "bubbles to the card's onClick and toggles it shut. The commit notes that "
              "the checkbox and workflow chip stopPropagation - the drawer does not.",
        fix="Stop propagation at the drawer boundary: onClick={(e) => "
            "e.stopPropagation()} and onKeyDown={(e) => e.stopPropagation()} on "
            "SheetContent. Or, better, render the Sheet as a SIBLING of the card root "
            "rather than a child, so the drawer is outside the clickable element in the "
            "component tree. Also guard the root handler with "
            "e.currentTarget.contains(e.target) - that is a DOM check, which a portal "
            "click fails. Add the five-click test to the verify script.",
        verified='VERIFIED FIXED 2026-09-13 (0a57743): clicking the title, empty space, status, Log update and Add manually leaves the drawer open - 5 of 5 at 1440 and 5 of 5 at 390.',
        code="pages/MyWork.js:1242-1255 (card root onClick / onKeyDown), the <Sheet> "
             "rendered inside the same component (~:1360)",
        found="2026-09-13",
    ),
    dict(
        id="MW-21", section="My Work", screen="Task - Delete",
        viewport="Mobile + Desktop", persona="Owner", severity="High", status="Fixed",
        area="Regression / missing function",
        tested="Searched the list page and the open drawer for any Delete, View details "
               "or overflow control, and searched the code for what opens the task "
               "detail dialog that holds Delete.",
        expected="An owner can still delete a task (T-038 passed on 2026-09-12).",
        actual="There is no way to delete a task. The detail dialog still contains "
               "'Delete task' with its confirmation, but nothing opens that dialog any "
               "more. Its only entry point was 'View details' in the card's ••• menu, "
               "and 98b43f4 removed that menu on the reasoning that 'the drawer already "
               "exposes every detail action' - but the drawer has no Delete.",
        evidence="No visible Delete / View details control on the list or in the drawer "
                 "at 1440 or 390. setDetailOpen is declared (:1074) and passed as "
                 "onOpenChange (:1941) but never called with true anywhere.",
        cause="98b43f4 removed the overflow menu without moving its one unique action.",
        fix="Put 'Delete task' in the drawer - a quiet destructive button at the foot of "
            "the drawer, keeping the existing confirm step - or restore a 'View "
            "details' entry. Owner-only, as it was.",
        verified="VERIFIED FIXED 2026-09-13 (0a57743): 'View details' at the foot of the drawer opens the detail dialog; Delete task is there and asks for confirmation before any DELETE is sent (1440 and 390).",
        code="pages/MyWork.js:782-940 (TaskDetailDialog + delete), :1074 and :1941 "
             "(detailOpen with no opener)",
        found="2026-09-13",
    ),
    dict(
        id="MW-15", section="My Work", screen="Task drawer - close (mobile)",
        viewport="Mobile", persona="All", severity="High", status="Fixed",
        area="Navigation / dead end",
        tested="Opened a task on a 390x844 phone viewport (script and browser preview), "
               "located every close control in the drawer and hit-tested its centre; then "
               "tapped outside the drawer and pressed browser Back.",
        expected="A phone user can close the task and return to the list.",
        actual="There is no way to close it. The drawer is w-full, so it covers the whole "
               "screen and there is no scrim left to tap. The new left-edge close tab sits "
               "at x=-43, entirely off-screen. The stock Radix close is at top-right but "
               "the sticky title bar paints over it - only a sliver of its focus ring "
               "peeks out. Escape closes it, but phones have no Escape key. Browser Back "
               "does not close the drawer either: it leaves My Work for the previous "
               "route. A phone user who opens a task is stuck.",
        evidence="Close tab rect [-43, 20, 44, 44]; stock close rect [330, 16, 44, 44] with "
                 "elementFromPoint = H2 (the title). Drawer rect [0, 0, 390, 844]. Tap at "
                 "(4, 300): drawer still open. Back: url /my-work -> /inbox. Screenshot "
                 "verify_0913/mob390_drawer.png; reproduced in the browser preview at "
                 "375x812.",
        cause="c70508b / e5c9151 / 2a17592 placed the close with -translate-x-full so it "
              "protrudes into the scrim. That works while the drawer is narrower than the "
              "screen (sm:max-w-2xl), but below sm the drawer is w-full and the scrim is "
              "0px wide, so the tab is pushed off the left edge. Nothing on mobile "
              "replaces it.",
        fix="Below sm, put the close INSIDE the drawer header (a 44px X at the right of "
            "the sticky title bar, or a back chevron at its left) and keep the protruding "
            "tab for sm and up: e.g. 'right-3 top-3 sm:left-0 sm:right-auto "
            "sm:-translate-x-full'. Alternatively leave a strip of scrim on phones "
            "(w-[92%]) so tapping outside works. Either way, test on a phone width "
            "before shipping a change to the drawer frame.",
        verified='VERIFIED FIXED 2026-09-13 (0a57743, 89ed015): at 390px the close sits in the drawer header, 44x44 and tappable; the drawer is 92% wide so tapping the strip beside it closes it; Escape still closes.',
        code="pages/MyWork.js:1427-1441 (SheetContent w-full + SheetClose -translate-x-full)",
        found="2026-09-13",
    ),
    dict(
        id="MW-16", section="My Work", screen="Task drawer - 'Log update or hand off' (mobile)",
        viewport="Mobile", persona="All", severity="High", status="Fixed",
        area="Regression",
        tested="In the drawer on a 390x844 viewport, tapped 'Log update or hand off' and "
               "looked for the update form it opens.",
        expected="The update form opens, as MW-09's fix made it do.",
        actual="Nothing appears. The button is visible and tappable, and the form IS "
               "mounted - but inside the desktop body, which is display:none below lg. "
               "This is MW-09 back: the one control that records what happened is inert "
               "on phones again. Desktop is unaffected (form opens, no crash).",
        evidence="After tap: one update-form node, 0x0, hidden by ancestor "
                 "#task-card-body-<id> (the 'hidden lg:block' desktop body). Screenshot "
                 "verify_0913/mob390_after_log_update_tap.png.",
        cause="MW-09 was fixed by expanding the card and bumping trailOpenTrigger so "
              "TaskTrail opens its form. ff3139f moved both bodies into the Sheet, but "
              "TaskTrail is still rendered only once, inside the desktop body, so on a "
              "phone the trigger opens a form nobody can see.",
        fix="Render TaskTrail (or at least its UpdateForm) outside the lg-gated body, "
            "shared by both layouts, or mount a second instance inside the mobile body. "
            "Add the MW-09 check to the verify script so the next drawer change cannot "
            "regress it silently.",
        code="pages/MyWork.js:1658-1662 (mobile trigger), :1679 (desktop body 'hidden "
             "lg:block'), :1960 (the only <TaskTrail>)",
        dep="MW-09, MW-20",
        verified='VERIFIED FIXED 2026-09-13 (0a57743): on a phone, Log update opens a visible update form inside the drawer.',
        found="2026-09-13",
    ),
    dict(
        id="MW-17", section="My Work", screen="Task drawer - two close buttons, invisible focus",
        viewport="Mobile + Desktop", persona="All", severity="Medium", status="Fixed",
        area="Accessibility",
        tested="Listed the close controls inside the open drawer, hit-tested each, and "
               "read document.activeElement straight after opening.",
        expected="One close control, visible, and focus lands somewhere the user can see.",
        actual="Every drawer carries TWO close buttons: the new 'Close task' tab and the "
               "stock shadcn 'Close' that SheetContent always renders. The stock one is "
               "covered by the sticky title bar, yet Radix focuses it on open - so "
               "keyboard focus starts on a control nobody can see, and a screen reader "
               "announces 'Close' and 'Close task' as two separate buttons.",
        evidence="Desktop 1440: stock close [1408, 16, 16, 16], elementFromPoint = H2; "
                 "activeElement on open = that button. Same at 1920 and on mobile.",
        cause="components/ui/sheet.jsx:50-54 hard-codes a SheetPrimitive.Close in every "
              "SheetContent. The new close tab was added alongside it rather than "
              "replacing it, and the sticky header (z-10, opaque) was laid over it.",
        fix="Give SheetContent a hideClose prop (default false, so other sheets are "
            "unchanged) and pass it here; set onOpenAutoFocus to focus the title or the "
            "close tab. That also resolves which close MW-15 should keep.",
        verified="VERIFIED FIXED 2026-09-13 (0a57743): one close control ('Close task') at 1440 and 390, and focus lands on it when the drawer opens.",
        code="components/ui/sheet.jsx:46-58; pages/MyWork.js:1427-1445",
        found="2026-09-13",
    ),
    dict(
        id="MW-18", section="Global", screen="Application shell at wide widths",
        viewport="Desktop 1920", persona="All", severity="Medium", status="Fixed",
        area="Layout / side effect",
        tested="Loaded Finance, CRM, Team, My Work and Decision Desk at 1920x1080 after "
               "da83b34 and screenshotted each once data had loaded.",
        expected="Removing the width cap for My Work leaves other pages as they were.",
        actual="The cap was removed in the shared Layout, so EVERY page now runs "
               "edge-to-edge. On Finance each KPI tile is ~610px wide with its value at "
               "the far left and its arrow ~550px away; the Capture bar is 1,856px wide "
               "holding three small buttons; AI brief rows put the 'Urgent' tag ~1,700px "
               "from the sentence it qualifies. On Team each member card is ~610px wide "
               "with the name and '6 permissions' at opposite ends. Nothing overflows - "
               "it just reads as sparse and makes the eye travel.",
        evidence="main width 1920px on all five routes; screenshots "
                 "verify_0913/wide1920_loaded_finance.png and _team.png.",
        cause="da83b34 dropped lg:max-w-[1400px] from the app-shell div in "
              "components/Layout.js:634 - a global container - to satisfy a My Work ask.",
        fix="Restore the cap in Layout and lift it only where wanted: give My Work its "
            "own page-level wrapper (or a data-wide flag the shell reads). If wider is "
            "wanted everywhere, cap at ~1600px rather than none, and constrain the "
            "Finance tiles and AI brief rows internally.",
        verified='VERIFIED FIXED 2026-09-13 (0a57743): at 1920 /finance and /team are capped at 1400px again; /my-work keeps the full 1920.',
        code="components/Layout.js:634 (app-shell className)",
        found="2026-09-13",
    ),
    dict(
        id="MW-19", section="My Work", screen="Department filter dropdown",
        viewport="Desktop", persona="Owner", severity="Low", status="Fixed",
        area="Usability",
        tested="Opened the new Department dropdown, read every option, and picked one "
               "with a zero count.",
        expected="The dropdown lists departments, and picking one filters to it.",
        actual="Three problems. (1) 'Completed 7' is listed as a Department - it is a "
               "state, and the Status dropdown beside it is where it belongs. (2) Six of "
               "the nine options read 0 (Sales 0, Production 0, Quality Control 0, "
               "Inventory 0, Finance 0, HR 0) - the old chip strip hid empty categories "
               "on a founder ask (U7-05.9). (3) Picking an empty one is silently undone: "
               "the trigger still reads 'Department: All 26' and nothing tells the user "
               "why.",
        evidence="Items: All 26, Sales 0, Production 0, Quality Control 0, Inventory 0, "
                 "Finance 0, Logistics 1, HR 0, Completed 7. Picked 'Sales 0' -> cards "
                 "26 -> 26, trigger 'Department: All 26'.",
        cause="FilterDropdown maps every WORK_TABS entry, including 'completed' and "
              "zero-count ones, while the U7-05.9 effect still snaps an empty selection "
              "back to 'all'.",
        fix="Filter options to count > 0 (keep All), or render zero-count ones disabled; "
            "move Completed into the Status dropdown.",
        verified="VERIFIED FIXED 2026-09-13 (0a57743): Department lists only departments holding work ('All 25', 'Logistics 1'); Completed moved to the Status filter.",
        code="pages/MyWork.js:2042-2075 (FilterDropdown), :2735-2743 (Department "
             "options), :2288-2298 (snap-back effect)",
        found="2026-09-13",
    ),
    dict(
        id="TM-01", section="Team", screen="Add member - login method toggle",
        viewport="Mobile + Desktop", persona="Owner", severity="Low", status="Open",
        area="Accessibility",
        tested="Opened Add member and pressed both halves of the Password login / Mobile "
               "OTP toggle, checking what each exposes to assistive technology.",
        expected="The selected login method is announced, as the permission toggles in "
                 "the same dialog already are.",
        actual="Neither half carries aria-pressed. The selection is conveyed only by a "
               "class swap (kr-pressed against kr-pop), so a sighted user sees which "
               "method is active and a screen-reader user hears two identical unlabelled "
               "buttons. Choosing between a password and an OTP decides how that person "
               "will sign in for good, so it is worth announcing.",
        evidence="Team.js:165 gives every perm-<key> toggle aria-pressed={on}; the two "
                 "login-method buttons at :123 and :125 set className only. Pressing the "
                 "already-active half produced no detectable state change of any kind.",
        cause="The toggle was styled as a segmented control but never given the ARIA the "
              "rest of the same file uses.",
        fix="Add aria-pressed to both buttons, and wrap them in a role='group' with an "
            "accessible label such as 'Login method' - matching the permission grid "
            "immediately below it.",
        verified="RE-CHECKED 2026-09-13 (desktop 1440 + mobile 390): still open - "
                 "aria-pressed is null on both halves of the toggle.",
        code="pages/Team.js:122-127 (login-method-toggle); the pattern to copy is at :165",
        found="2026-09-12",
    ),
    dict(
        id="TM-05", section="Team", screen="Member profile - ACCESS block",
        viewport="Mobile + Desktop", persona="All", severity="Medium", status="Open",
        area="Information disclosure",
        tested="Signed in as each of the four roles in turn and opened ANOTHER person's "
               "member card, to see how much of their access is readable.",
        expected="A person's permission set is visible to those who administer access, "
                 "not to every colleague.",
        actual="Every role can read every other member's complete permission matrix. "
               "Production and Finance -- who hold neither team_manage nor people -- can "
               "open Priya Nair's card and see '6 permissions', then inside: '6 of 14 "
               "areas', the granted chips, and the full denial list naming every area "
               "she cannot reach. Only the Edit access BUTTON is gated to the owner; "
               "viewing is not gated at all.",
        evidence="owner / sales / production / finance all returned ACCESS block=True, "
                 "areaCount=True, denialList=True on a colleague's profile; only "
                 "editAccess differed (owner True, the rest False).",
        cause="canManageTeam gates the edit control, but the ACCESS section and the card "
              "count render unconditionally.",
        fix="Gate the whole ACCESS section, not just its button. This is the same change "
            "the founder asked for in ASK-13 and ASK-15, so treat them as one piece of "
            "work: hide access on the roster, and show the section only to people who "
            "hold the permission that governs it.",
        verified="RE-CHECKED 2026-09-13 signed in as Sales, on a COLLEAGUE's profile "
                 "(TEST Limited), desktop and mobile: the 'n of 14 areas' block and the "
                 "'No access to ...' list are both still visible.",
        code="pages/Team.js:411 + :441 (card count), :580-606 (ACCESS block, "
             "granted-perms and the denial list)",
        found="2026-09-12",
    ),
    dict(
        id="TM-06", section="Team", screen="Add member - all form fields",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Accessibility",
        tested="Inspected every input and select in the Add member dialog for a "
               "programmatic label, in the live preview.",
        expected="Each field is named for assistive technology, and keeps its name once "
                 "the user has typed into it.",
        actual="Not one of the six fields has a programmatic label. Name, Email, Temp "
               "password and Mobile number are placeholder-only, so the field name "
               "disappears the moment anything is typed -- a sighted user who tabs away "
               "and back cannot tell which box is which. Role and Reporting Manager LOOK "
               "labelled, but their text is not associated with the control, so a screen "
               "reader gets nothing from them either.",
        evidence="Every field returns labelled:false -- no for/id pairing, no wrapping "
                 "label, no aria-label. The visible 'Role' and 'Reporting Manager (for "
                 "leave approvals)' text is rendered as a bare label element with no for "
                 "attribute.",
        cause="The form was built with placeholders standing in for labels, and the two "
              "later fields got visual labels that were never wired to their inputs.",
        fix="Give all six a real label with htmlFor pointing at the input's id. Keep "
            "placeholders for examples ('e.g. 98765 43210'), not for the field name. "
            "This is part of the ASK-14 redesign but is worth doing even if that "
            "redesign is deferred -- it is a few lines and it is the difference between "
            "the form being usable with a screen reader and not.",
        code="pages/Team.js:120, :121, :129, :132 (placeholder-only), "
             ":137-138 and :143-144 (unassociated labels)",
        verified="RE-CHECKED 2026-09-13 (desktop 1440 + mobile 390): still open - all "
                 "six fields have no label, aria-label or aria-labelledby.",
        found="2026-09-12",
    ),
    dict(
        id="TM-07", section="Team", screen="Member profile dialog - closing",
        viewport="Desktop", persona="All", severity="Low", status="Open",
        area="Accessibility",
        tested="Focused a member card with the keyboard, pressed Enter to open the "
               "profile, pressed Escape, and read document.activeElement. Repeated as "
               "Owner and as Sales.",
        expected="Focus returns to the card that opened the dialog, so a keyboard user "
                 "carries on from where they were.",
        actual="Focus drops to <body>. A keyboard or screen-reader user who opens the "
               "fifth card and closes it is thrown back to the top of the page and has "
               "to Tab through the header, search and every earlier card to get back. "
               "On a 12-person roster that is a nuisance; on the larger teams the search "
               "box is built for, it makes the roster hard to work through.",
        evidence="Enter on team-member-<id> opens the dialog (pass); after Escape "
                 "activeElement = BODY, as Owner and as Sales.",
        cause="The profile dialog has no DialogTrigger - it is opened by setting "
              "profileUser state - and MemberProfileDialog returns null the moment u is "
              "cleared, so the dialog is unmounted before Radix can restore focus to "
              "where it came from.",
        fix="Keep the Dialog mounted with open={!!u} and render only its content "
            "conditionally, so Radix's own focus return runs; or remember the opening "
            "card and focus it in onCloseAutoFocus.",
        code="pages/Team.js:450 (onOpen sets profileUser), :541-542 (openChange, "
             "'if (!u) return null')",
        found="2026-09-13",
    ),
    dict(
        id="TM-08", section="Global", screen="Default close button on every dialog",
        viewport="Desktop", persona="All", severity="Low", status="Open",
        area="Accessibility / tap target",
        tested="Measured the close control inside Add member on desktop and mobile.",
        expected="A close control is at least 24x24px (WCAG 2.5.8).",
        actual="On desktop the close X is 16x16px - the bare icon with no padding. On "
               "mobile the same control measures 44x44, so the fault is desktop-only. "
               "It comes from the shared dialog component, so it applies to every "
               "dialog that keeps the default close: Add member, Edit access, the invite "
               "link modal, and the rest of the app's dialogs that use it. The Team "
               "profile dialog avoids it by hiding the default and drawing its own 36px "
               "close.",
        evidence="Add member close: 16x16 at 1440x900, 44x44 at 390x844.",
        cause="components/ui/dialog.jsx renders DialogPrimitive.Close as a bare "
              "h-4 w-4 icon with no padding or minimum size.",
        fix="Give the default close a hit area: 'grid h-8 w-8 place-items-center' "
            "around the icon (32px), keeping the icon at 16px. One change fixes every "
            "dialog at once.",
        code="components/ui/dialog.jsx:37-41",
        found="2026-09-13",
    ),
    dict(
        id="CR-01", section="CRM", screen="Scope chips (Buyers / Suppliers)",
        viewport="Desktop", persona="All", severity="Low", status="Open",
        area="Accessibility",
        tested="Compared the desktop scope chips with their mobile counterparts, and "
               "confirmed the filtering itself works.",
        expected="The selected scope is exposed to assistive technology on both "
                 "viewports.",
        actual="The desktop chips carry no aria-pressed at all, while the mobile twins "
               "of the same control set it correctly (true on Buyers, false on "
               "Suppliers). So the identical control is announced properly on a phone "
               "and not on a laptop. The filtering itself is correct - Buyers shows 11, "
               "Suppliers shows 6, and switching back restores 11.",
        evidence="crm-scope-customers and crm-scope-suppliers both report "
                 "aria-pressed=None; crm-scope-mobile-customers reports 'true' and "
                 "crm-scope-mobile-suppliers 'false'.",
        cause="The desktop chip row was built separately from the mobile segmented "
              "control and did not carry the ARIA across.",
        fix="Add aria-pressed to the desktop chips, mirroring the mobile pair, and give "
            "the row a role='group' with a label. Same family as TM-01.",
        code="pages/CRM.js:819-836 (crm-scope-chips, desktop); the correct pattern is "
             "at :794-805 (crm-scope-mobile)",
        found="2026-09-12",
    ),
    dict(
        id="CR-02", section="CRM", screen="Add contact dialog - all fields",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Accessibility",
        tested="Opened Add customer and inspected every field for a programmatic label.",
        expected="Each field is named for assistive technology and keeps its name after "
                 "the user types.",
        actual="None of the six fields has a label of any kind - the dialog contains no "
               "label elements at all. Name, Company, Phone and Email are "
               "placeholder-only, and the two selects have nothing naming them. This is "
               "the same defect as TM-06 in Team, in a different dialog, which makes it "
               "a pattern across the app rather than a one-off.",
        evidence="All six fields report labelled:false and the dialog's label count is "
                 "zero. Four of the six also carry no data-testid, which makes them hard "
                 "to assert on.",
        cause="Placeholders are being used as labels throughout the app's forms.",
        fix="Associate a real label with every field here and in Team's Add member "
            "(TM-06). Worth doing as one pass over both dialogs rather than twice, and "
            "worth adding a lint rule or a test so the next form starts labelled.",
        code="pages/CRM.js:282 (crm-contact-name), :313 (lifecycle), and the four "
             "unlabelled inputs between them",
        found="2026-09-12",
    ),
    dict(
        id="CR-03", section="CRM", screen="Add contact dialog - dismiss controls",
        viewport="Desktop", persona="Owner", severity="Nit", status="Open",
        area="Redundancy",
        tested="Listed the buttons in the Add contact dialog.",
        expected="One way to back out of the dialog.",
        actual="Two: a 'Cancel' button beside Add contact, and a separate 'Close' X. "
               "Team's profile dialog has the same duplication (TM-04), so it is worth "
               "settling once for the app rather than per dialog.",
        evidence="Dialog buttons: Customer, Dealer, Supplier, More details, Cancel, "
                 "Add contact, Close.",
        cause="A footer Cancel was added while the dialog primitive still renders its "
              "own close control.",
        fix="Pick one convention for the whole app - most products keep the X and drop "
            "the Cancel, or keep Cancel on destructive-ish forms only - and apply it to "
            "both this dialog and TM-04.",
        code="pages/CRM.js:242-365 (crm-contact-dialog footer)",
        found="2026-09-12",
    ),
    dict(
        id="CR-04", section="CRM", screen="Add contact menu (mobile)",
        viewport="Mobile", persona="Owner", severity="High", status="Open",
        area="Responsive / layout",
        tested="Tapped the + button in the CRM header on a 375px phone and measured "
               "where the menu it opens actually lands.",
        expected="The menu opens inside the screen with its options readable.",
        actual="Four fifths of the menu is off-screen. It opens anchored to the + button "
               "and runs off the right edge, so all the user sees is a 55px strip "
               "carrying three anonymous icons -- every label is cut off. 'New Buyer', "
               "'New Supplier' and 'Import from spreadsheet' are all invisible, so "
               "adding a contact on a phone means guessing which icon to press.",
        evidence="Viewport 375px; the menu spans x=315 to x=615, width 300px, "
                 "overflowing the right edge by 240px -- 80 per cent clipped. Each item "
                 "is 290px wide starting at x=320, leaving 55px visible.",
        cause="The menu is right-anchored to its trigger with a fixed 300px width and no "
              "collision handling, which is fine beside a desktop toolbar and wrong "
              "beside a button that already sits at the right edge of a phone.",
        fix="Give the popover collision-aware placement so it flips and clamps inside "
            "the viewport, or on mobile present the same three choices as a bottom "
            "sheet -- the pattern the app already uses elsewhere for phone menus.",
        code="pages/CRM.js:405-480 (crm-add-menu popover)",
        found="2026-09-12",
    ),
    dict(
        id="CR-05", section="CRM", screen="Filter button (mobile)",
        viewport="Mobile", persona="Owner", severity="High", status="Open",
        area="Dead control",
        tested="Tapped the Filter control in the CRM header on a 375px phone and "
               "compared the page before and after.",
        expected="It reveals the status and sort controls, which desktop shows inline.",
        actual="Nothing happens at all. Not a single thing changes -- same text, same "
               "element count, no dialog, no menu, no sheet. Meanwhile the status filter "
               "and the sort control both exist in the DOM at zero size, so on a phone "
               "there is no way to filter by status or change the sort order.",
        evidence="Before and after the tap: body text 746 chars both times, 356 elements "
                 "both times, 0 dialogs, 0 menus, 0 sheets. crm-status-filter and "
                 "crm-sort are present but measure 0x0.",
        cause="The control was given an icon and an aria-label but never wired to the "
              "state that reveals the filter row.",
        fix="Wire it to a sheet or popover containing the status filter and sort that "
            "desktop shows inline. Both controls already exist and only need somewhere "
            "to be shown.",
        code="pages/CRM.js:739 (crm-mobile-filter); the controls it should reveal are "
             "at :858 (crm-status-filter) and :869 (crm-sort)",
        found="2026-09-12",
    ),
    dict(
        id="CR-06", section="CRM", screen="Contact cards (mobile)",
        viewport="Mobile", persona="All", severity="Medium", status="Open",
        area="Responsive / layout",
        tested="Measured the card grid and every text node inside it at 375px.",
        expected="On a phone a contact list is readable, and a customer's name is not "
                 "cut off.",
        actual="The grid stays two columns on a 375px screen, giving each card 161px. "
               "Eight text nodes truncate as a result, including the customer names "
               "themselves -- 'Krishna Garments Pvt Ltd' needs 144px and gets 114, "
               "'Anand Fabrics' needs 88 and gets 76. Supporting lines like '6 open "
               "complaints' and 'Touched 29 days ago' wrap onto two lines, and the card "
               "heights go ragged. Team's roster drops to a single column on the same "
               "screen and reads cleanly, so the app already has the better answer.",
        evidence="grid-template-columns resolves to '160.5px 160.5px' at a 375px "
                 "viewport; 8 leaf text nodes have scrollWidth greater than clientWidth.",
        cause="The grid keeps two columns below the breakpoint where the content stops "
              "fitting.",
        fix="Go single column under about 480px, matching Team. If two columns are "
            "wanted on larger phones, drop the company line and the touched line to keep "
            "the name whole.",
        code="pages/CRM.js:940-1050 (contact card grid)",
        found="2026-09-12",
    ),
    dict(
        id="CR-07", section="CRM", screen="Contact profile - Log activity",
        viewport="Desktop", persona="All", severity="Low", status="Open",
        area="Design system",
        tested="Measured the colour of every primary button on the contact profile page "
               "and compared it with primaries elsewhere in the app.",
        expected="One primary colour across the product.",
        actual="The Log button on the contact profile is indigo, rgb(55,58,205), while "
               "every other primary action in the app -- Add contact, Add member, "
               "Complete, Approve -- is the near-black ink colour. Contrast is fine at "
               "7.93:1; the problem is that it reads as a different product for a "
               "moment. The contact profile also sits on a strong amber gradient while "
               "the CRM list it came from is neutral grey, which compounds the shift.",
        evidence="Log button background rgb(55,58,205) with white text; the app's "
                 "primaries elsewhere measure rgb(12,12,13).",
        cause="An indigo accent from a different design direction survived on this "
              "screen when the rest of the app settled on ink.",
        fix="Repaint Log with the standard primary, and check the contact profile's "
            "background against the list it is reached from -- a detail page changing "
            "ground colour makes the two feel like separate apps.",
        code="pages/ContactProfile.js (Log button and page background)",
        found="2026-09-12",
    ),
    dict(
        id="CR-08", section="CRM", screen="Contact profile (mobile) - In progress list",
        viewport="Mobile", persona="All", severity="Medium", status="Open",
        area="Data leak to UI",
        tested="Read the 'In progress' accordion on a contact profile where some "
               "pending deliveries have no due date.",
        expected="A missing due date is either omitted or says something a person can "
                 "read.",
        actual="The literal word 'undefined' is printed to the user: two rows read "
               "'Due undefined - Rs 1' and 'Due undefined - Rs 6,00,000'. It is the "
               "kind of thing a customer screenshots.",
        evidence="ContactProfileMobile.jsx:215 renders "
                 "{humanDate(d.due_date) || `Due ${d.due_date}`}. humanDate is "
                 "dueLabel(iso)?.text || null, so a missing date returns null and the "
                 "fallback interpolates the undefined value straight into the string.",
        cause="The fallback was written for a date the humaniser cannot PARSE, but it "
              "also catches a date that is simply ABSENT, and prints it.",
        fix="Guard on the value, not on the humaniser: render the human date when there "
            "is one, the raw date only when the value exists but will not parse, and "
            "nothing at all when there is no date. Worth grepping for the same "
            "`|| \`... ${value}\`` shape elsewhere -- this pattern fails the same way "
            "wherever it appears.",
        code="pages/mobile/ContactProfileMobile.jsx:215 (fallback), :24 (humanDate)",
        found="2026-09-12",
    ),
    dict(
        id="OP-01", section="Ops", screen="Team execution panel",
        viewport="Mobile + Desktop", persona="Owner", severity="High", status="Open",
        area="Truthfulness",
        tested="Read the panel's own caption, then checked the service that produces "
               "the numbers underneath it.",
        expected="A page that states a time window applies it.",
        actual="The panel says 'Last 30 days - open anyone to see their full ops'. The "
               "service applies no date filter anywhere: tasks, decisions, invoices and "
               "the per-employee leaderboard are all queried for the whole tenant with "
               "no window at all. So an owner reads a colleague's score believing it "
               "reflects the last month, when it carries every task since the workspace "
               "opened -- somebody who was slow in August can never recover from it, "
               "and somebody who has improved this month does not show it.",
        evidence="services/operating_score.py contains no created_at, no timedelta, no "
                 "days= and no since; the only match for '30' is .to_list(3000). Live "
                 "data spans 2026-08-08 to 2026-09-09 and all of it is counted.",
        cause="The caption was written for an intended windowed metric that was never "
              "implemented, or was implemented and later dropped.",
        fix="Decide which is true and make them agree. A rolling window is the more "
            "useful of the two -- an operating score should recover when the business "
            "recovers -- so filter each query to the last 30 days and keep the caption. "
            "If all-time is deliberate, the caption has to say so.",
        code="services/operating_score.py (all queries); the caption is in "
             "pages/OperatingScore.js, team-execution section",
        found="2026-09-13",
    ),
    dict(
        id="OP-02", section="Ops", screen="'Do these first' on mobile",
        viewport="Mobile", persona="Owner", severity="High", status="Open",
        area="Responsive / layout",
        tested="Measured the page's primary call to action against the fixed dark band "
               "beneath it on a 375x812 phone.",
        expected="The list of what to do first is readable on a phone.",
        actual="It is 90 per cent hidden. 'Do these first' occupies y=425 to 710, and a "
               "fixed black 'Team execution' band is pinned from y=454 to the bottom of "
               "the screen -- 374px, 46 per cent of the viewport -- covering 256 of its "
               "285px. Scrolling does not help: the document itself does not scroll "
               "(scrollHeight equals clientHeight), and the element that does scroll is "
               "the dark band, not the page. So the three actions the page exists to "
               "recommend are permanently reduced to one visible line.",
        evidence="Band: position fixed, z-index 20, top 454, height 374 of an 812px "
                 "viewport. Overlap with 'Do these first' measured at 256px. Document "
                 "scrollHeight 812 = clientHeight 812.",
        cause="A section styled as a full-bleed dark band on desktop keeps position "
              "fixed at mobile widths, where there is not room for both it and the "
              "content above it.",
        fix="On mobile the band should flow with the page rather than being pinned, so "
            "the score, the actions and the team list scroll as one column. If it must "
            "stay pinned, it needs to collapse to a handle the user can pull up.",
        code="pages/OperatingScore.js (kr-dark-band team-execution section)",
        found="2026-09-13",
    ),
    dict(
        id="OP-03", section="Ops", screen="Operating score model",
        viewport="Mobile + Desktop", persona="Owner", severity="High", status="Open",
        area="Metric design",
        tested="Recomputed all four legs from the raw records and compared with the API.",
        expected="A score meant to guide the next action responds when that action is "
                 "taken.",
        actual="Two of the four legs are pinned at the floor and carry no information. "
               "Execution reads 0 and Responsiveness reads 0. Responsiveness actually "
               "computes to -296 before clamping (100 - 16 complaints x 12 - 68 overdue "
               "x 3), so it would take closing 8 complaints AND clearing 33 overdue "
               "tasks before the number moves off zero by a single point. The page's "
               "own advice is 'Close 16 open complaints' -- doing all of that would "
               "leave the score exactly where it is. The owner gets no gradient at "
               "precisely the moment they most need one.",
        evidence="API: overall 19, execution 0, finance 57, sales 22, responsiveness 0. "
                 "Recomputed from 148 tasks: done 11, open 130, overdue 68, completion "
                 "0.078; execution = clamp(7.8 - 20.9) = 0. Responsiveness = "
                 "clamp(100-192-204) = 0.",
        cause="Both legs subtract unbounded absolute penalties from 100 and then clamp "
              "at zero, so any moderately messy workspace saturates.",
        fix="Score each leg as a bounded rate rather than a penalty subtracted from a "
            "constant, so the number always has somewhere to move. Where a leg really "
            "is at the floor, say 'below floor' rather than printing a 0 that looks "
            "like an empty metric. See ASK-19 for the wider redesign.",
        code="services/operating_score.py:_score_execution and the responsiveness "
             "expression in _company_operating_view",
        found="2026-09-13",
    ),
    dict(
        id="OP-04", section="Ops", screen="'Sales' category",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Truthfulness",
        tested="Read what the Sales leg is computed from.",
        expected="A category called Sales reflects selling.",
        actual="It is the share of DECISIONS that have been approved -- "
               "approved/total x 100 -- and contains no revenue, no orders, no pipeline "
               "and no customer. On live data it reads 22 because 17 of 77 decisions "
               "are approved. An owner could sell nothing all month and lift 'Sales' by "
               "approving decisions, or have a record month and watch it fall because "
               "approvals are backed up. The number is real and useful; the label is "
               "the wrong one.",
        evidence="_score_sales(decisions) = approved/total*100. API Sales = 22 with "
                 "total_decisions 77, approved 17.",
        cause="The leg was named for the business area it was meant to represent rather "
              "than the quantity actually available to compute.",
        fix="Rename it to what it measures -- Decision velocity, or Approvals -- which "
            "is a genuinely good metric for a decision OS. If a real Sales leg is "
            "wanted, invoices already carry the data for revenue this period against "
            "last.",
        code="services/operating_score.py:_score_sales",
        found="2026-09-13",
    ),
    dict(
        id="OP-05", section="Ops", screen="Operating score model",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Metric design",
        tested="Traced where a single overdue task lands in the model.",
        expected="Each fact is counted once.",
        actual="One overdue task is charged twice: it raises the overdue ratio inside "
               "Execution (x40 of the ratio) and is also subtracted directly from "
               "Responsiveness (x3 per task). Those two legs are 35 and 20 per cent of "
               "the overall score, so lateness quietly drives 55 per cent of it. On the "
               "live tenant that is -20.9 on one leg and -204 on the other.",
        evidence="_score_execution applies overdue_ratio*40; the responsiveness "
                 "expression applies overdue*3.",
        cause="The two legs were designed independently and both reached for the same "
              "signal.",
        fix="Pick one home for lateness. Execution is the natural one; Responsiveness "
            "should be about complaints and reply time, which is what its name promises.",
        code="services/operating_score.py:_score_execution and _company_operating_view",
        found="2026-09-13",
    ),
    dict(
        id="OP-06", section="Ops", screen="Operating score model",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Metric design",
        tested="Checked how the penalties behave as a business grows.",
        expected="The same performance scores the same at any size.",
        actual="Three penalties are absolute rather than proportional: complaints x12, "
               "overdue x3, overdue invoices x5. A five-person shop with 9 open "
               "complaints scores 0 on Responsiveness; so does a 500-person company "
               "with 9. As a tenant grows, the score falls for reasons that have "
               "nothing to do with how well it is run, and the metric stops being "
               "comparable with its own past.",
        evidence="responsiveness = 100 - open_complaints*12 - overdue*3; "
                 "finance = collected*100 - overdue_inv*5.",
        cause="Fixed point-costs were chosen against an assumed small tenant.",
        fix="Express each as a rate against the relevant denominator -- complaints per "
            "active customer, overdue as a share of open work, overdue invoices as a "
            "share of open invoices -- so the score means the same thing at any size.",
        code="services/operating_score.py:_company_operating_view",
        found="2026-09-13",
    ),
    dict(
        id="OP-07", section="Ops", screen="Operating score - empty workspace",
        viewport="Mobile + Desktop", persona="Owner", severity="Low", status="Open",
        area="Metric design",
        tested="Read what each leg returns when its denominator is zero.",
        expected="A workspace with no data reads as unknown, not as a grade.",
        actual="Completion, approval rate and collection rate each fall back to 0.7 "
               "when there is nothing to divide by, so a brand-new tenant that has done "
               "nothing at all scores about 70 out of 100 and is told it is doing "
               "reasonably well. There is an enough_data flag in the payload, so the "
               "page can already tell the difference -- the default just makes the "
               "number look earned.",
        evidence="completion, approved_rate and collected all default to 0.7; "
                 "enough_data = actionable >= 3 or inv_count > 0.",
        cause="A neutral default was chosen so an empty tenant would not look alarming.",
        fix="Keep the neutral internal default if it helps the maths, but let the UI "
            "show 'not enough data yet' rather than a score, using the enough_data flag "
            "that is already computed and sent.",
        code="services/operating_score.py (the 0.7 defaults, enough_data)",
        found="2026-09-13",
    ),
    dict(
        id="OP-08", section="Ops", screen="Category cards",
        viewport="Desktop", persona="Owner", severity="Low", status="Open",
        area="Information design",
        tested="Looked at how a zero-scoring category is drawn.",
        expected="A bad score and a missing score look different.",
        actual="Execution and Responsiveness both render '0 / 100' above a completely "
               "empty progress bar, which is pixel-identical to how an unmeasured "
               "category would look. Two of the four cards on the page therefore read "
               "as 'nothing here' when they actually mean 'this is as bad as it gets'.",
        evidence="Desktop screenshot: Execution 0/100 and Responsiveness 0/100 with "
                 "unfilled tracks, beside Finance 57 and Sales 22 with filled ones.",
        cause="The bar encodes only the value, and zero has no visual form.",
        fix="Give a floored score its own treatment -- a filled track in the warning "
            "colour, or an explicit 'at floor' marker -- so it reads as a measured bad "
            "result rather than an absent one.",
        code="pages/OperatingScore.js (category card progress track)",
        found="2026-09-13",
    ),
    dict(
        id="OP-09", section="Ops", screen="'View all' links and the formula panel (mobile)",
        viewport="Mobile", persona="Owner", severity="Medium", status="Open",
        area="Responsive / accessibility",
        tested="Measured every remaining mobile control on the Ops page.",
        expected="Links are big enough to tap, unobstructed, and the whole page is "
                 "reachable.",
        actual="Three problems, all downstream of the page not scrolling on mobile. The "
               "two 'View all' links measure 61x20, under the 24px minimum, and the "
               "first of them is physically covered by the floating Dex button. The "
               "'How is this calculated' formula panel sits at y=1153 on an 812px "
               "screen and cannot be reached at all, so the one place that explains "
               "where the score comes from is invisible on a phone -- which matters "
               "more than usual here, given two of the four legs read 0.",
        evidence="View all: 61x20 at y=751, elementFromPoint returns dex-fab; second at "
                 "y=947, outside the viewport. operating-formula-toggle: 223x44 at "
                 "y=1153, inViewport false, and the automated sweep could not click it.",
        cause="The same fixed-band layout as OP-02: the document does not scroll, so "
              "anything below the fold is unreachable rather than merely below.",
        fix="Fixing OP-02 -- letting the page scroll as one column on mobile -- makes "
            "the formula panel reachable on its own. The View all links still need to "
            "grow to 24px minimum and to sit clear of the Dex button's safe area.",
        code="pages/OperatingScore.js (View all links, operating-formula-toggle)",
        found="2026-09-13",
    ),
    dict(
        id="OP-10", section="Ops", screen="Ops page when the request fails",
        viewport="Mobile + Desktop", persona="All", severity="High", status="Open",
        area="Error handling / dead end",
        tested="Opened /operating-score?user=<id> where the API refuses or cannot find "
               "the person: as the Owner with an id that does not exist, and as Sales, "
               "Production and Finance with the Owner's id. Waited 9-10 seconds each "
               "time, on 1440 and 390, and again in the browser preview.",
        expected="The page says what went wrong and offers a way back, as /coach "
                 "already does for exactly the same two errors.",
        actual="The loading skeleton stays on screen forever, with aria-busy=true and "
               "no text at all. The API answered in milliseconds - 404 'Team member not "
               "found' for the owner, 403 for the three other roles - but the page never "
               "shows it. The user cannot tell a slow page from a broken link or a "
               "refused one, and there is no way back except the browser. Any stale "
               "shared link (a person who has left, a link forwarded to a teammate) "
               "lands here.",
        evidence="8 of 8 attempts: skeleton present after 9s, main text empty. API: "
                 "404 {'detail': 'Team member not found'} (owner), 403 (sales, "
                 "production, finance). Browser preview at 375x812: skeleton=true, "
                 "busy=true after 10s. Screenshots ops_0913/*_view_as_unknown.png, "
                 "*_self_forbidden.png.",
        cause="OperatingScore reads only { data, isLoading } from useQuery and renders "
              "the skeleton whenever data is missing - 'if (isLoading || !data) return "
              "<OperatingScoreSkeleton />'. A failed query has no data, so it is "
              "indistinguishable from loading. WorkCoach.js handles isError with a "
              "403 / other message; this page never got the same branch.",
        fix="Read isError and error from the query and render a message: 403 -> 'Only "
            "the owner can view another person's operating page', 404 -> 'This person "
            "is no longer on the team', otherwise 'Couldn't load'. Each with a link to "
            "/operating-score. WorkCoach.js:36-57 is the pattern to copy. Also set "
            "retry: false for 4xx so the error shows at once.",
        code="pages/OperatingScore.js:85-92 (useQuery + the skeleton fallback); "
             "pages/WorkCoach.js:36-57 (the working pattern)",
        found="2026-09-13",
    ),
    dict(
        id="OP-11", section="Ops", screen="Personal (self) view - bottom band (mobile)",
        viewport="Mobile", persona="Sales / Production / Finance", severity="Medium",
        status="Open", area="Layout",
        tested="Opened Ops as a non-owner on a 375-390px phone, scrolled to the bottom, "
               "and measured the dark band and the dock.",
        expected="Content that is pinned to the screen earns the space it takes.",
        actual="A 176px near-black band is pinned to the bottom of every non-owner's "
               "phone screen - over a fifth of the viewport - and it holds ONE sentence: "
               "'Among your sales peers you are ranked 2 of 7.' That sentence sits "
               "behind the floating dock, so it is only partly readable, and the band "
               "does not move when the page scrolls. It reads as a black rendering "
               "fault rather than a panel.",
        evidence="operating-self-band: position fixed, rect [0, 652, 375, 176], text "
                 "'Among your sales peers you are ranked 2 of 7.'; floating-dock fixed at "
                 "[16, 724, 267, 72] on top of it. Screenshot ops_0913 and preview "
                 "capture.",
        cause="KM-33 made .kr-dark-band a fixed bottom sheet below lg, on the founder's "
              "call, because on the OWNER view it holds the decisions to act on and "
              "should not scroll away. The self view reuses the same class for a single "
              "peer-ranking line, so it inherits a pinned sheet with nothing to act on.",
        fix="Keep KM-33 for the owner view. In the self view, drop the kr-dark-band "
            "class (or add a variant that stays in the scroll flow) and show the peer "
            "ranking as an ordinary line or card above the open work. If a pinned sheet "
            "is wanted here, it needs content worth pinning and bottom padding that "
            "clears the dock.",
        code="pages/OperatingScore.js (operating-self-band section); index.css:2171-2190 "
             "(.kr-dark-band fixed below lg, KM-33)",
        found="2026-09-13",
    ),
    dict(
        id="OP-12", section="Ops", screen="AI Work Coach - entry point",
        viewport="Mobile + Desktop", persona="All", severity="Medium", status="Open",
        area="Navigation / orphaned feature",
        tested="Looked for any link to /coach on every Ops screen for all four roles, "
               "and searched the frontend for links to the route.",
        expected="A working feature can be reached without typing its URL.",
        actual="Nothing in the app links to the AI Work Coach. It still works - it "
               "loads for all four roles, the owner can open a teammate's coach, the "
               "permission message is right - but the only way in is typing /coach. "
               "On 2026-09-12 the Ops employee card opened the coach (plan item D3); it "
               "now opens that person's Ops page instead, which removed the last route "
               "in. Two of the four demo seats already have coaching generated on "
               "29 Aug, so this is a feature people used.",
        evidence="coach links found on Ops screens: none, for Owner, Sales, Production "
                 "and Finance on both viewports. Frontend references to '/coach': the "
                 "route in App.js:228 and the 'View my coach' link inside WorkCoach's own "
                 "error page.",
        cause="The employee card was repointed to view-as (/operating-score?user=) "
              "without moving the coach link anywhere else.",
        fix="Add 'AI coach' next to 'Back to company' in the view-as banner (owner "
            "coaching a teammate), and 'My AI coach' on the self view and in the More "
            "panel. If the coach is being retired, remove the route and its endpoints "
            "instead of leaving it reachable only by URL.",
        code="App.js:228 (/coach route); pages/OperatingScore.js:931 (employee card "
             "link); pages/OperatingScore.js:119-141 (ViewAsBanner)",
        found="2026-09-13",
    ),
    dict(
        id="OP-13", section="Ops", screen="'Back to company' and 'See all' links",
        viewport="Mobile + Desktop", persona="All", severity="Low", status="Open",
        area="Accessibility / tap target",
        tested="Measured every interactive element on the view-as page and on the self "
               "view for all four roles.",
        expected="Links are at least 24px tall (WCAG 2.5.8).",
        actual="'Back to company' in the view-as banner is 109x16 on desktop and 117x20 "
               "on mobile - and it is the only way out of view-as mode other than the "
               "browser. 'See all' above 'Your open work' is 52x16 on desktop and 55x20 "
               "on mobile, on every non-owner's page. Same pattern as the 'View all' "
               "links in OP-09, on two screens OP-09 did not cover.",
        evidence="Under-24px list: ['Back to company', 109, 16] / [117, 20]; ['See all', "
                 "52, 16] / [55, 20] - Sales, Production and Finance alike.",
        cause="Text links styled with text-xs and no vertical padding.",
        fix="Give both links py-1.5 (or min-h-6 with inline-flex items-center) so the "
            "hit area reaches 24px without changing the look. Fix with OP-09 in one "
            "pass.",
        code="pages/OperatingScore.js:133-139 (Back to company); the 'See all' link in "
             "the self view's open-work header",
        found="2026-09-13",
    ),
    dict(
        id="OP-14", section="Ops", screen="AI Work Coach - error page",
        viewport="Mobile + Desktop", persona="Owner", severity="Low", status="Open",
        area="Copy",
        tested="Opened /coach?user=<id that does not exist> as the Owner.",
        expected="The page title matches what happened.",
        actual="The page is titled 'Access denied' while its body says 'Couldn't load "
               "coaching - Something went wrong.' Nothing was denied: the owner may "
               "view anyone's coach, and the API answered 404 'Employee not found'. The "
               "title blames permissions for a missing person.",
        evidence="Title 'Access denied'; coach-error text 'Couldn't load coaching / "
                 "Something went wrong. Please try again. / View my coach'.",
        cause="PageHeader title is hard-coded to 'Access denied' for every error; only "
              "the body text branches on 403.",
        fix="Branch the title too: 403 -> 'Not allowed', 404 -> 'Person not found', "
            "otherwise 'Couldn't load coaching'.",
        code="pages/WorkCoach.js:36-57",
        found="2026-09-13",
    ),
    dict(
        id="CR-09", section="CRM", screen="Contact profile (mobile) - Score with AI",
        viewport="Mobile", persona="Owner", severity="Low", status="Open",
        area="Feature parity",
        tested="Opened the same contact on 1440 and 390 and looked for the Score with AI "
               "control; pressed it on desktop with the write blocked.",
        expected="An owner can re-score a customer from their phone, or the gap is "
                 "deliberate and known.",
        actual="Desktop has 'Score with AI' (and 'Re-score'); its failure path works - "
               "'Could not score right now', label restored. The mobile contact profile "
               "has no scoring control at all, only a read-only 'Health nn/100' row, so "
               "the score cannot be refreshed from a phone.",
        evidence="Desktop: rescore-contact-btn present, POST blocked -> toast 'Could not "
                 "score right now'. Mobile after 9s: 0 rescore buttons, no visible button "
                 "mentioning score.",
        cause="ContactProfileMobile.jsx was built without the rescore mutation.",
        fix="Add a 'Score with AI' action to the mobile profile's action row, reusing the "
            "same POST /contacts/{id}/rescore mutation - or record that scoring is "
            "desktop-only by design.",
        code="pages/ContactProfile.js:134-137 + :250-273 (desktop); "
             "pages/mobile/ContactProfileMobile.jsx:254 (Health row only)",
        found="2026-09-13",
    ),
    dict(
        id="CR-10", section="CRM", screen="Contact list when loading fails",
        viewport="Mobile + Desktop", persona="Owner", severity="High", status="Open",
        area="Error handling / dead end",
        tested="Made the contact list request fail (network abort on GET /api/contacts) "
               "and watched /crm for 7 seconds at 1440 and 390.",
        expected="The page says the contacts could not be loaded and offers a retry.",
        actual="The loading skeleton stays forever. On desktop the chips read 'Buyers 0' "
               "and 'Suppliers 0' above six blank placeholder cards, so an owner with a "
               "flaky connection sees what looks like a CRM with no customers, still "
               "loading. On mobile it is the same skeleton with nothing else. No toast, "
               "no message, no retry. The same fault as OP-10 on Ops.",
        evidence="After 7s: 0 cards, 18 animate-pulse placeholders, no error or empty "
                 "wording, no toast, on both viewports. Screenshots "
                 "crm_0913/desk1440_list_failed.png, mob390_list_failed.png.",
        cause="CRM reads only { data, isLoading } from the contacts query; a failed query "
              "has no data, so the skeleton branch never ends and the scope counts "
              "compute from an empty list.",
        fix="Read isError from the query and render 'Couldn't load your contacts' with a "
            "Retry that calls refetch(). Show '-' rather than 0 in the scope chips while "
            "loading or failed. Same fix pattern as OP-10 - worth one shared "
            "<QueryError> component.",
        code="pages/CRM.js:524-527 (contacts useQuery), scope-count chips :819-835",
        found="2026-09-13",
    ),
    dict(
        id="CR-11", section="CRM", screen="Contact profile when loading fails",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Copy / misleading error",
        tested="Made the profile request fail (network abort on GET "
               "/api/contacts/<id>/profile) for a contact that exists.",
        expected="A connection failure is reported as a connection failure.",
        actual="The page says 'That contact isn't here. It may have been merged or "
               "removed.' The customer exists; only the request failed. An owner reading "
               "this on a weak phone signal is told a real customer has been deleted or "
               "merged.",
        evidence="Aborted profile request -> 'That contact isn't here. It may have been "
                 "merged or removed. Everyone else is still in People.' on 1440 and 390; "
                 "the same text a genuinely missing id produces.",
        cause="Both profile pages send error and '!data?.contact' down one branch. The "
              "comment at ContactProfile.js:145-150 explains why the empty-body case was "
              "added, but a network error and a missing contact now share its copy.",
        fix="Split the branch: if error has no response (network) or a 5xx, say 'Couldn't "
            "load this contact' with Retry; keep the 'isn't here' copy for a 404 or an "
            "empty body.",
        code="pages/ContactProfile.js:151-160; pages/mobile/ContactProfileMobile.jsx:85-99",
        found="2026-09-13",
    ),
    dict(
        id="CR-12", section="CRM", screen="GET /api/crm/outstanding",
        viewport="n/a (API)", persona="Sales / Production / Finance", severity="Medium",
        status="Open", area="Permissions / data exposure",
        tested="Called the endpoints the CRM page uses while signed in as Sales, who holds "
               "neither the People nor the Finance permission.",
        expected="Per-customer money figures follow the same permission as the contact "
                 "list and the finance profile.",
        actual="GET /api/contacts and GET /api/contacts/<id>/profile correctly refuse "
               "Sales with 403 - but GET /api/crm/outstanding answers 200 with every "
               "customer's receivables, payables, invoice count and days overdue. The "
               "keys are contact ids rather than names, so it is not a full leak on its "
               "own, but it hands money data to roles the rest of the app deliberately "
               "keeps out of finance.",
        evidence="As Sales: /contacts 403, /contacts/<id>/profile 403, /crm/outstanding "
                 "200 {<contact_id>: {receivables: 400000, payables: 0, invoice_count: 1, "
                 "oldest_days: 61}, ...}.",
        cause="outstanding_by_contact depends only on get_current_user - no require_perm.",
        fix="Gate it with require_perm('people') (it only feeds the CRM grid) or "
            "require_perm('finance') to match the profile endpoint.",
        code="routers/crm.py:37-38 (outstanding_by_contact, Depends(get_current_user))",
        found="2026-09-13",
    ),
    dict(
        id="CR-13", section="CRM", screen="Decision Desk 'Complaints' tile -> /crm",
        viewport="Mobile + Desktop", persona="Sales / Production / Finance", severity="Low",
        status="Open", area="Navigation / dead end",
        tested="Signed in as each non-owner role and listed every visible link that leads "
               "into CRM.",
        expected="Roles that cannot open CRM are not offered links into it.",
        actual="CRM itself is correctly hidden and a direct visit shows Access Denied - "
               "but the 'Complaints' KPI tile on Decision Desk links to /crm for all "
               "three roles, on desktop and mobile. Tapping the number lands on 'ACCESS "
               "DENIED'. It is the most prominent link on their home screen to a page "
               "they are not allowed to see.",
        evidence="Sales, Production and Finance: /inbox has one link into CRM - "
                 "kpi-complaints (desktop) / kpi-complaints-m (mobile), href /crm.",
        cause="The Desk KPI tiles hard-code to=\"/crm\" without checking the People "
              "permission that the nav already checks.",
        fix="Only set the link when hasPerm(user, 'people'); otherwise render the tile as "
            "plain (non-link) or point it at a view the role can open.",
        code="pages/Desk.js:569-572 (mobile tile), :614-617 (desktop tile)",
        found="2026-09-13",
    ),
    dict(
        id="CR-14", section="CRM", screen="Contact profile - 'Back to CRM' (desktop)",
        viewport="Desktop", persona="Owner", severity="Low", status="Open",
        area="Accessibility / tap target",
        tested="Measured the interactive elements on the desktop contact profile.",
        expected="Controls are at least 24px tall.",
        actual="'Back to CRM' is 103x20 - the only other interactive element under 24px "
               "on the page. The mobile 'Back to people' is fine.",
        evidence="Under-24px list on the desktop profile: ['Back to CRM', 103, 20].",
        cause="Text link with no vertical padding.",
        fix="py-1 or min-h-6 on the back link.",
        code="pages/ContactProfile.js:205 (profile-back)",
        found="2026-09-13",
    ),
    dict(
        id="FN-01", section="Finance", screen="Every money figure",
        viewport="Mobile + Desktop", persona="All", severity="High", status="Open",
        area="Localisation",
        tested="Read the rendered text of all six Overview tiles and compared it with "
               "what Intl produces for the same number in Indian grouping.",
        expected="An India-first product groups rupees the Indian way, the same way "
                 "everywhere.",
        actual="Finance renders 2685000 as Rs 2,685,000 -- Western thousands grouping. "
               "Indian convention is Rs 26,85,000. Every tile is affected: Asset Value "
               "shows Rs 4,085,000 for what an Indian owner reads as Rs 40,85,000. "
               "Worse than being consistently wrong, it is inconsistent: the AI panels "
               "ON THE SAME PAGE correctly say 'Rs 7.49L' and 'Rs 13.18 L', and CRM "
               "cards elsewhere show 'Rs 4,00,000'. And because the locale is left "
               "undefined, the grouping follows each viewer's browser -- the same "
               "figure renders differently for different people.",
        evidence="Tiles read 'Rs 2,685,000'; Intl.NumberFormat('en-IN') gives "
                 "'Rs 26,85,000'. Ledger.js:61 uses Intl.NumberFormat(undefined, ...).",
        cause="Ledger.js defines its own private fmt() with an undefined locale, "
              "instead of the shared helper. lib/format.js already exports inr(), "
              "which uses en-IN and whose own docstring reads: 'no component formats "
              "currency inline -- everything goes through here.' Finance is the "
              "component that does.",
        fix="Delete the private fmt() and import inr from lib/format. The helper "
            "already exists and already does the right thing, so this is an import "
            "swap rather than a rewrite. Worth a lint rule banning "
            "Intl.NumberFormat with a currency style outside lib/format.js.",
        code="pages/Ledger.js:61-64 (private fmt); lib/format.js:19-30 (inr, and the "
             "rule it states)",
        found="2026-09-13",
    ),
    dict(
        id="FN-02", section="Finance", screen="Net profit hero (mobile)",
        viewport="Mobile", persona="All", severity="High", status="Open",
        area="Truthfulness",
        tested="Compared the number under the 'This month' chip with the API figure and "
               "with the date range of the underlying records.",
        expected="A figure captioned 'This month' covers this month.",
        actual="It is the all-time figure. The hero shows Rs 738,034 beneath a chip "
               "reading 'This month', and 738034 is exactly net_profit from the API, "
               "which is computed with no date filter over records spanning June to "
               "August. So an owner glancing at their phone reads a lifetime number as "
               "a monthly one -- and on a money screen that is the kind of mistake that "
               "gets acted on.",
        evidence="Hero binds {f(net)} where net = tt.net_profit; ledger_summary applies "
                 "no date filter; sales invoices span 2026-06-14 to 2026-08-12.",
        cause="The chip was written for a windowed figure the endpoint does not "
              "provide.",
        fix="Either compute a monthly net and show that, or drop the chip. The backend "
            "already buckets by month for expenses, so half the machinery exists -- it "
            "needs the revenue side to match (see FN-03).",
        code="pages/Ledger.js:1005 (net), :1042 ('This month' chip), :1048 (the value)",
        found="2026-09-13",
    ),
    dict(
        id="FN-03", section="Finance", screen="Revenue and Net profit trend badges (mobile)",
        viewport="Mobile", persona="All", severity="High", status="Open",
        area="Wrong data",
        tested="Traced the series behind each trend percentage and recomputed it.",
        expected="A trend shown beside Revenue describes revenue.",
        actual="Both trend badges are computed from EXPENSES. The Revenue tile reads "
               "'Rs 2,685,000, down 22.1%' -- but that 22.1% is the month-on-month fall "
               "in SPENDING, from Rs 10,77,500 in July to Rs 8,39,469 in August. "
               "Revenue did not fall; costs did, which is usually good news being "
               "reported in red as bad. The Net profit trend is the same number from "
               "the same series.",
        evidence="months = summary.by_month, which ledger_summary builds by summing "
                 "EXPENSES per month. pct(839469, 1077500) = -22.1%, exactly what the "
                 "UI shows. netPoints = months.map(m => Number(m.net ?? m.amount ?? 0)) "
                 "-- by_month carries no 'net' key, so every point silently falls "
                 "through to the expense amount.",
        cause="The frontend was written expecting by_month to carry a net figure per "
              "month. The backend never added one, and the ?? fallback turned a missing "
              "contract into a plausible-looking wrong number instead of an error.",
        fix="Have ledger_summary return revenue and net per month alongside expenses, "
            "and bind each trend to its own series. Until then the honest move is to "
            "hide the badges rather than show a number that means something else -- and "
            "drop the ?? fallback, which is what let this ship silently.",
        code="pages/Ledger.js:1009-1015 (months, netPoints, netTrend), :1061 (revenue "
             "trend); routers/ledger.py:1237-1245 (by_month is expenses only)",
        found="2026-09-13",
    ),
    dict(
        id="FN-04", section="Finance", screen="'Net profit' tile",
        viewport="Mobile + Desktop", persona="All", severity="Medium", status="Open",
        area="Metric design",
        tested="Read what net_profit is composed of and compared it with a cash-basis "
               "calculation from the same records.",
        expected="A figure called net profit is close to what an owner means by it.",
        actual="It is revenue BILLED minus ALL recorded expenses, including expenses "
               "not yet paid. It subtracts no cost of goods and no inventory movement, "
               "and ignores assets entirely -- Rs 40,85,000 of them. On live data it "
               "reports Rs 7,38,034, where the cash-basis figure is Rs 6,44,500, a gap "
               "of Rs 93,534. The arithmetic is right; the name is doing more work than "
               "the formula can support.",
        evidence="net_profit = revenue_billed - total_spend = 2685000 - 1946966 = "
                 "738034, verified against a recomputation. Cash basis "
                 "(received - paid expenses) = 1936000 - 1291500 = 644500.",
        cause="A simple difference was given the accounting term that sits closest to "
              "it.",
        fix="Rename to something the formula actually supports -- 'Billed minus spend', "
            "or 'Gross margin (billed)' -- or compute a real net that accounts for COGS "
            "and inventory. The former is a one-line change and stops the page "
            "overclaiming.",
        code="routers/ledger.py:1257 (net_profit); pages/Ledger.js:566-573 (the tile)",
        found="2026-09-13",
    ),
    dict(
        id="FN-05", section="Finance", screen="All figures",
        viewport="Mobile + Desktop", persona="All", severity="Medium", status="Open",
        area="Metric design",
        tested="Checked ledger_summary for any date filtering.",
        expected="A finance dashboard can show a period.",
        actual="Every figure is all-time and there is no way to change that. Expenses, "
               "invoices, payments, assets and inventory are each queried for the whole "
               "tenant with no window and capped at 5000 records. So the page can tell "
               "an owner what they have billed since the company started, but not what "
               "they billed this month -- which is the question a finance screen is "
               "opened to answer. It is also why FN-02's 'This month' chip has nothing "
               "to bind to.",
        evidence="ledger_summary contains no date filter; every find() is "
                 "{tenant_id} only, .to_list(5000).",
        cause="The endpoint was built to summarise everything, and the period-aware UI "
              "arrived later.",
        fix="Accept a period parameter (this month, this quarter, this FY -- the Indian "
            "financial year matters here) and filter each query by it, defaulting to "
            "the current month. That single change also gives FN-02 and FN-03 the data "
            "they are currently faking.",
        code="routers/ledger.py:1223-1262 (ledger_summary)",
        found="2026-09-13",
    ),
    dict(
        id="FN-06", section="Finance", screen="Delete on expenses, invoices and payments",
        viewport="Mobile + Desktop", persona="Owner / Finance", severity="High",
        status="Open", area="Destructive action / data loss",
        tested="Pressed the delete (trash) control on an expense, a sales invoice and a "
               "received payment, as Owner and as Finance, at 1440 and 390, with the "
               "DELETE request blocked at the network layer.",
        expected="Removing a money record asks first - it changes every total on the "
                 "page and there is no undo.",
        actual="One tap sends the DELETE straight away. No confirmation dialog, no "
               "'are you sure', no undo toast - for all three record types, both "
               "viewports, both roles. The trash icon is a 36px target at the end of "
               "each row, so a stray tap while scrolling a phone ledger deletes a real "
               "invoice or payment and silently changes Revenue, Received and Net "
               "profit. (The harness blocked every DELETE, so nothing was removed.)",
        evidence="DELETE /api/expenses/<id>, /api/revenue/invoice/<id> and "
                 "/api/revenue/payment/<id> each fired on the first click; confirmation "
                 "shown = false in 12 of 12 attempts. With the write blocked the page "
                 "then reports 'Could not delete'.",
        cause="The tables call onDelete(id) directly from the trash button, and "
              "Ledger's del()/delRevenue() call api.delete immediately. Contrast Team's "
              "delete-task, which has a confirm step.",
        fix="Put a confirm step in del() and delRevenue(): an AlertDialog naming the "
            "record and amount ('Delete invoice SBT/25-26/0431 for Rs 2,85,000?'). "
            "Alternatively delete optimistically with an Undo toast and commit after a "
            "few seconds. Either way, one tap must not be final.",
        code="pages/Ledger.js:1541-1549 (del, delRevenue); :886 and :912 (revenue "
             "invoice/payment trash); :1264 (expense trash)",
        found="2026-09-13",
    ),
    dict(
        id="FN-07", section="Finance", screen="Finance for Sales and Production",
        viewport="Mobile + Desktop", persona="Sales / Production", severity="High",
        status="Open", area="Permissions / dead end",
        tested="Signed in as Sales and as Production (neither holds ledger or finance), "
               "opened Finance from the nav / Money dock, and visited every tab.",
        expected="A role either cannot reach Finance, or reaches a version of it that "
                 "works for them and says what they can do.",
        actual="Both roles see Finance in the nav and the Money dock and can open it - "
               "then every ledger request is refused (6 x 403). The Overview sits on "
               "'Loading...' forever. Revenue, Expenses, Assets and Inventory each show "
               "their empty state ('No expenses yet...'), telling the user the company "
               "has no money records rather than that they are not allowed to see them. "
               "Only the capture bar works. So the page misinforms rather than refuses.",
        evidence="Sales and Production, 1440 and 390: /ledger/summary, /expenses, "
                 "/assets, /inventory, /revenue, /payables all 403; "
                 "/captures/pending-count 200; overview text ends 'Loading...'; four tabs "
                 "show empty-state copy.",
        cause="The route admits perms ['ledger','finance','data_input'] (App.js:237) and "
              "the nav/dock use the same list, but the backend's require_ledger accepts "
              "only ledger or finance. Every Sales/Production user has data_input by "
              "default, so they pass the front door and fail every request behind it; "
              "the page has no isError handling to notice.",
        fix="Decide what data_input-only users should get. If it is capture only, show "
            "them the capture bar and Inbox with a line such as 'You can upload bills "
            "here; totals are visible to Finance and the Owner', and hide the money "
            "tabs. If they should not be here at all, drop data_input from the route and "
            "nav perms. In both cases handle 403 in the page (see FN-09).",
        code="App.js:237 (route perms); components/Layout.js:79 (nav perms); "
             "routers/ledger.py:619-625 (require_ledger); pages/Ledger.js:1522-1527 "
             "(queries without isError), :1641-1642 (Loading...)",
        found="2026-09-13",
    ),
    dict(
        id="FN-08", section="Finance", screen="Adding records on a phone",
        viewport="Mobile", persona="Owner / Finance", severity="High", status="Open",
        area="Missing function / dead control",
        tested="At 375-390px, looked for a way to add income, an expense, an asset and "
               "an inventory item on every tab, and tapped the 'Add expense' tile in "
               "the capture card - by script and in the browser preview.",
        expected="An owner can record an expense or income from their phone - the "
                 "capture card itself offers 'Add expense'.",
        actual="There is no way to add a record manually on a phone. The four Add "
               "buttons (Add income / expense / asset / inventory) are rendered but "
               "hidden below lg. The 'Add expense' tile in 'Simplify your finances' does "
               "nothing on any tab: it looks for an element that does not exist. Upload "
               "and scan still work, so a cash expense with no bill cannot be recorded "
               "from the phone at all.",
        evidence="Preview 375x812: tapping finance-hero-add-m opened 0 dialogs on "
                 "Overview and 0 on Expenses. add-income-btn, add-expense-btn, "
                 "add-asset-btn and add-inventory-btn are in the DOM but invisible on "
                 "all four tabs; the only visible 'Add' is the dead tile.",
        cause="The tile's onClick runs "
              "document.querySelector('[data-testid=\"ledger-add-expense\"]')?.click(), "
              "but no element carries that testid - the real trigger is add-expense-btn, "
              "and it sits inside 'hidden lg:block' (Ledger.js:1630).",
        fix="Render the per-tab Add button on mobile too (drop hidden lg:block, or add a "
            "mobile placement), and have the tile open AddExpenseDialog directly through "
            "state rather than clicking a DOM node by testid.",
        code="pages/Ledger.js:1422-1429 (tile + querySelector), :1630 ('hidden lg:block' "
             "addBtn), :1551-1557 (addBtn per tab)",
        found="2026-09-13",
    ),
    dict(
        id="FN-09", section="Finance", screen="Finance when a request fails",
        viewport="Mobile + Desktop", persona="Owner", severity="Medium", status="Open",
        area="Error handling",
        tested="Aborted GET /api/ledger/summary, then separately GET /api/expenses, and "
               "read the page at 1440 and 390.",
        expected="A failed load says so and offers a retry.",
        actual="Summary fails: the Overview says 'Loading...' indefinitely. Expenses "
               "fails: the Expenses tab shows 'No expenses yet - approved purchase bills "
               "and payments show up here automatically, or add one manually', directly "
               "under an AI panel that is still analysing those same expenses. An owner "
               "on a bad connection is told their books are empty. The same missing "
               "branch is behind FN-07.",
        evidence="Summary aborted: text ends 'Loading...' after 5s, both viewports. "
                 "Expenses aborted: 0 rows, 'No expenses yet' shown. Screenshot "
                 "finance_0913/desk_expenses_failed_v2.png.",
        cause="Ledger's six queries read only data / isLoading; tables default to "
              "'data || []' and render their empty state.",
        fix="Check isError on each query and render 'Couldn't load <tab>' with Retry "
            "(403: 'You don't have access to the ledger'). One shared <QueryError> would "
            "serve this, OP-10 and CR-10.",
        code="pages/Ledger.js:1522-1527, :1641-1642, :1657-1659",
        found="2026-09-13",
    ),
    dict(
        id="FN-10", section="Finance", screen="Mobile capture card - 'Export' tile",
        viewport="Mobile", persona="Owner / Finance / Sales / Production", severity="Low",
        status="Open", area="Copy / wrong label",
        tested="Read the four capture tiles on mobile and checked what each does.",
        expected="A tile labelled Export exports.",
        actual="The fourth tile reads 'Export - CSV, Excel' but is a file picker that "
               "UPLOADS a spreadsheet to /ingest/csv. An owner wanting to download their "
               "books for the accountant taps it and gets a file-open dialog. Desktop "
               "labels the same control correctly as 'CSV / Excel' under Capture. There "
               "is no export anywhere on the page.",
        evidence="finance-hero-csv-m text 'Export CSV, Excel'; it wraps <input "
                 "type=file accept='.csv,.xlsx,.xls'> posting to /ingest/csv.",
        cause="Label copied from a reference design that had an export action.",
        fix="Rename it 'Import - CSV, Excel' with an upload icon. If export is wanted, "
            "build it as a separate action.",
        code="pages/Ledger.js:1430-1437",
        found="2026-09-13",
    ),
    dict(
        id="FN-11", section="Finance", screen="Mobile overview - 'View all 3+ action items'",
        viewport="Mobile", persona="Owner / Finance", severity="Low", status="Open",
        area="Accessibility / tap target",
        tested="Measured interactive elements on the mobile Overview.",
        expected="Controls are at least 24px tall.",
        actual="'View all 3+ action items' is 322x20 - wide but under 24px tall. It works "
               "(opens the Revenue tab).",
        evidence="Under-24px list at 390x844: ['View all 3+ action items', 322, 20].",
        cause="Text link with no vertical padding.",
        fix="py-1 on the link.",
        code="pages/Ledger.js:1075 (ledger-mobile-viewall)",
        found="2026-09-13",
    ),
    dict(
        id="TM-02", section="Team", screen="Owner section grid",
        viewport="Desktop", persona="All", severity="Nit", status="Open",
        area="Visual / layout",
        tested="Measured the grid that renders each role group on the team roster.",
        expected="A section holding one person does not leave two thirds of the row empty.",
        actual="The Owner group uses the same three-column grid as every other role but "
               "will almost always hold exactly one card, so 874px of a 1336px row is "
               "blank. It reads as a rendering fault rather than a deliberate space.",
        evidence="grid-template-columns resolves to three 437px tracks with a single "
                 "child; the card occupies 437px of 1336px.",
        cause="One grid definition is applied to every role group regardless of how many "
              "people it can contain.",
        fix="Either let a single-card group span the row, or give the owner its own "
            "treatment at the top of the page - it is a different kind of row from a "
            "department, and looks like one.",
        code="pages/Team.js:366 (team-cards-<role> grid)",
        found="2026-09-12",
    ),
    dict(
        id="TM-03", section="Team", screen="Member cards",
        viewport="Mobile + Desktop", persona="All", severity="Nit", status="Open",
        area="Information design",
        tested="Compared what the page's own eyebrow promises with what the member cards "
               "actually show, for a member who has a reporting manager set.",
        expected="A roster headed EMPLOYEES / ACCESS / REPORTING LINES shows something of "
                 "each at list level.",
        actual="The cards show name, email, status and a permission COUNT. The reporting "
               "line is absent entirely, and access is reduced to a number that says "
               "nothing about what the person can reach. Both exist one click deeper - "
               "the profile dialog reads 'REPORTS TO Sunita Rao' and '13 of 14 areas' "
               "with the areas listed - so the data is there and simply is not surfaced "
               "where the page says it will be.",
        evidence="Card for a member with a manager reads: 'sai / csaicsai300@gmail.com / "
                 "Active / 13 permissions'. Their profile dialog carries the manager and "
                 "the full access list.",
        cause="The card was designed as an identity tile; the eyebrow describes the "
              "section's full remit, which only the dialog delivers.",
        fix="Put the reporting line on the card - one line, 'Reports to Sunita Rao' - and "
            "consider replacing the bare count with the two or three areas that "
            "distinguish this person, keeping the full list in the dialog. Cheapest "
            "alternative: soften the eyebrow so it stops promising what the list does "
            "not show.",
        code="pages/Team.js:417-450 (member card); manager already resolved at :475",
        found="2026-09-12",
    ),
    dict(
        id="TM-04", section="Team", screen="Member profile dialog",
        viewport="Mobile + Desktop", persona="Owner", severity="Nit", status="Fixed",
        area="Accessibility",
        tested="Enumerated the controls in a member profile dialog by accessible name.",
        expected="Each control in a dialog is distinguishable by name.",
        actual="Two separate visible buttons are both named exactly 'Close'. A "
               "screen-reader user tabbing the dialog meets the same name twice with "
               "nothing to separate them.",
        evidence="Control inventory of the profile dialog for Priya Nair: "
                 "['Close', 'Edit access', 'Get invite link', 'Close'].",
        cause="A custom close control was added at Team.js:530 while the dialog "
              "primitive still renders its own.",
        fix="Keep one. If the custom 36px control is the intended one, hide the "
            "primitive's default close for this dialog.",
        verified="VERIFIED FIXED 2026-09-13: the profile dialog now exposes ONE Close "
                 "(36px desktop, 44px mobile) as Owner and as Sales; Team.js:572 hides the "
                 "primitive's default close with [&>button.absolute]:hidden.",
        code="pages/Team.js:497-535 (profile dialog header)",
        found="2026-09-12",
    ),
    dict(
        id="MW-05", section="My Work", screen="Task list - bento grid",
        viewport="Desktop", persona="All", severity="Low", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: max title-top spread across a row is now 0px (was 39px).",
        code="pages/MyWork.js:1181 (the task-summary button className)",
        found="2026-09-12",
    ),
    dict(
        id="MW-06", section="My Work", screen="Category tab bar",
        viewport="Desktop", persona="Owner", severity="Nit", status="Fixed",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: tab counter reads 'All -' while loading, then 'All 134' (was 'All 0').",
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
    dict(
        id='DX-01',
        section='Dex',
        screen='Ask Dex - money questions',
        viewport='Mobile + Desktop',
        persona='Owner',
        severity='High',
        status='Assigned - Yokesh',
        area='Wrong answer (live AI)',
        tested="LIVE run (founder-approved): asked Dex 'How much do customers owe us in total, and who owes the most?' as the owner, and compared with the ledger API. Read the saved query plan (brain_query_cache) to find why.",
        expected='Rs 7,49,000 outstanding, Krishna Garments owing the most (Rs 4,00,000).',
        actual="Dex answered, in bold, 'zero invoices, zero billed amount, and zero outstanding balance - the receivables table is empty', with three KPI tiles reading Invoices 0 / Billed Rs 0 / Outstanding Rs 0, suggested the data 'hasn't been synced', and cited 8 unrelated sources (test tasks, a dispatch, resolved complaints). The ledger holds Rs 26,85,000 billed and Rs 7,49,000 outstanding. An owner asking the most basic money question is told, confidently, that nobody owes them anything.",
        evidence="Plan: primary_entity invoices, status unpaid, group_by contact, date_preset all - correct - but keywords ['outstanding','owe','customers','receivable']. 'outstanding' and 'customers' are stop-words; 'owe' and 'receivable' are not, so retrieval ran {number|contact_name ~ /owe|receivable/i} and matched 0 invoices. 17.0s. Screenshot ai_live_0913/dex_receivables_desk.png.",
        cause="_retrieve turns the planner's keywords into a record filter on invoice number and customer name. The keywords are words from the QUESTION, not names of records, and the _KW_STOP list only catches some of them. Numbers are computed deterministically (good), but from an empty set, so the LLM then narrates zeros.",
        fix="Only apply keywords as a record filter when they look like an entity reference (a customer, vendor or invoice number that exists in the tenant); otherwise ignore them for aggregation intents. At minimum add owe/owes/owed/receivable(s)/payable(s)/dues to _KW_STOP. And when an aggregation over a finance entity returns 0 rows while the collection is non-empty, re-run without keywords rather than answer 'zero'.",
        verified='OWNER: Yokesh (founder call, 2026-09-13) - all Dex issues are his; not to be worked on elsewhere.',
        code='routers/brain.py:172-187 (_KW_STOP, _rx), :294-299 (invoices retrieval), :836-843',
        found='2026-09-13',
    ),
    dict(
        id='DX-02',
        section='Dex',
        screen="Ask Dex - 'What needs my attention today?'",
        viewport='Mobile + Desktop',
        persona='Owner',
        severity='High',
        status='Assigned - Yokesh',
        area='Wrong answer (live AI)',
        tested="LIVE run: asked Dex its own first suggested question, 'What needs my attention today?', as the owner; then asked 'Which tasks are overdue?' and compared.",
        expected='The overdue work, decisions waiting and money at risk - the owner has 24 open and 6 overdue tasks, 53 decisions waiting and 58 items on fire.',
        actual="'Good news - there are no open or overdue tasks requiring your attention right now', followed by a list of things already completed. One question later, 'Which tasks are overdue?' answered 'All 34 matching tasks are overdue'. The page's headline suggestion gives the owner false reassurance.",
        evidence="Plan: entity tasks, status todo, date_preset today, group_by priority. _compute_tasks keeps only tasks created or due TODAY with status exactly 'todo' (in_progress excluded), so overdue work from earlier days is filtered out. 24.1s. Second question plan: status overdue, no date -> 34 rows.",
        cause="'Needs my attention today' is read literally as a date filter, and 'todo' as a status match. Decisions, overdue items and money are never considered, because the planner picks ONE primary entity.",
        fix="Treat 'what needs my attention' as a composite intent served from the Desk's own counters (needs_decision, on_fire, overdue, receivables) rather than a single-entity list; or map it to status overdue|in_progress|todo with no date window. Add it to the planner guardrails in _refine_plan, since it is Dex's first suggested question.",
        verified='OWNER: Yokesh (founder call, 2026-09-13) - all Dex issues are his; not to be worked on elsewhere.',
        code='routers/brain.py:127-141 (_plan), :144+ (_refine_plan), :463-478 (_compute_tasks filters); pages/Brain.js suggestions',
        found='2026-09-13',
    ),
    dict(
        id='FN-12',
        section='Finance',
        screen='Ask AI about your expenses - answer',
        viewport='Mobile + Desktop',
        persona='Owner / Finance',
        severity='Low',
        status='Open',
        area='Rendering',
        tested="LIVE run: asked 'Which supplier do we owe the most right now, and how much?' on the Expenses tab.",
        expected='A readable answer.',
        actual="The answer is correct - Surat Spinners, Rs 4,80,000, matching the data - but it is shown with literal markdown: '**Surat Spinners**' and '**Rs 4,80,000**', asterisks visible.",
        evidence="Screenshot ai_live_0913/finance_ai_desk.png; 7.3s. Dex renders the same model's bold correctly, so it is the Finance panel.",
        cause='ai-answer-* renders the model text as a plain string.',
        fix='Render the answer through the same markdown renderer Dex uses (or strip ** server-side).',
        code='pages/Ledger.js:539 (ai-answer)',
        found='2026-09-13',
    ),
    dict(
        id='FN-13',
        section='Finance',
        screen='Capture - extraction review',
        viewport='Mobile + Desktop',
        persona='Owner / Finance',
        severity='Low',
        status='Open',
        area='Data capture (live AI)',
        tested='LIVE run: uploaded testdata/1.png, a real-format GST invoice (Sleek Bill X33, 24 Feb 2018, due 1 Mar 2018, 3 items + shipping, total Rs 27,625, supplier GSTIN 17ABGSP1111P1Z1). Left the result in review; did NOT file it.',
        expected='The key fields a GST purchase bill needs, and a warning when the bill is years old.',
        actual="Good overall, in 31.9s at 92% confidence: supplier Service TEST 123 with phone and email, number X33, amount 27,625, due 2018-03-01, booked as Inventory, and a 'Pay vendor bill' follow-up task. But the invoice DATE, the supplier GSTIN and the line items are not captured, and nothing warns that the bill fell due eight years ago - filing it would add an overdue payable dated 2018 without comment.",
        evidence='Review panel: Supplier / Purchase bill / Inventory / X33 / 27625 / due 2018-03-01; no date, GSTIN or item rows. Screenshot ai_live_0913/extraction_desk.png. Ingestion 79ed62dd-9114-45cb-8788-0dd5a108538d left in status review.',
        cause='The review schema carries party, number, amount and due date only.',
        fix="Carry invoice date, GSTIN (and GST amount) and line items through to review; flag bills whose date or due date is more than ~12 months old before 'File it'.",
        code='pages/finance/ReviewPanel.js; services/ingestion.py (ai_extract_document)',
        found='2026-09-13',
    ),
    dict(
        id='MW-22',
        section='My Work',
        screen='Task card - bulk-select checkbox (mobile)',
        viewport='Mobile',
        persona='Owner',
        severity='Medium',
        status='Open',
        area='Accessibility / mis-tap',
        tested='Measured the bulk-select checkbox on a 390px phone after the card redesign, and hit-tested taps 10px to its left, above and right.',
        expected='The checkbox has at least a 24px tap area (it had 44x114 through its padded wrapper when N-01 was recorded), and a near-miss does not trigger something else.',
        actual='The checkbox is now 16x16 inside a 16x22 label - nothing larger is clickable. A tap 10px off in any direction lands on the card, and since 78d01df the whole card opens the task drawer. So on a phone, trying to select tasks for a bulk action frequently opens a task instead. 12 checkboxes on the first screen, all the same.',
        evidence='Full control sweep at 390x844: 25 controls under 24px, the bulk-select-* checkboxes at 16x22. Probe: own 16x16, label 16x22; taps at -10px left / top / right hit the card (false, false, false for the checkbox).',
        cause="98b43f4 moved the checkbox to the card's top-left corner and dropped the padded wrapper that gave it the 44x114 hit box N-01 relied on.",
        fix='Give the checkbox a 44x44 hit area again (a padded label around it, or a transparent ::before), and keep stopPropagation on that area so it never opens the drawer.',
        verified='',
        code='pages/MyWork.js (task card summary - bulk-select checkbox, top-left)',
        found='2026-09-13',
    ),
    dict(
        id='GL-01',
        section='Global',
        screen='Desktop header - notification bell',
        viewport='Desktop',
        persona='All',
        severity='Medium',
        area='Broken control',
        tested='Real mouse click on the desktop bell on My Work, Decision Desk, Team and Finance, tracing aria-expanded, the dropdown and document.activeElement every 25ms.',
        expected='The bell opens the notification dropdown and it stays open until dismissed.',
        actual="On Decision Desk, My Work and Team the dropdown opens and then closes on its own about 0.4s later, dropping focus to <body>; nothing was clicked in between. On Finance it stays open. So on the desktop's most-used pages a user clicks the bell, sees a flash, and cannot read or open a notification. (The phone bell works.)",
        evidence='/inbox: pointerdown 20ms -> expanded true + dropdown at 138ms -> expanded false, dropdown gone, focus BODY at 541ms. /finance: opens at 148ms and stays open. elementFromPoint at the bell centre is the bell on every page (nothing covering).',
        cause="Likely a remount: Bellicon is declared as a component INSIDE Layout's render (const Bellicon = (...) => <Popover>...). Every Layout re-render creates a new component type, so React unmounts the open Popover and mounts a closed one. Pages whose data refreshes around the click (Desk polls every 30s, notifications refetch) re-render Layout in that window; Finance happened not to.",
        fix='Move Bellicon to module scope (a real component that takes notif/unread/bellCount as props), or render the Popover JSX inline rather than through an inner component. The same applies to any other component declared inside Layout.',
        code='components/Layout.js:366-424 (Bellicon inside Layout)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='GL-02',
        section='Global',
        screen='Mobile More panel - non-owners',
        viewport='Mobile',
        persona='Sales / Production / Finance',
        severity='Medium',
        area='Navigation parity',
        tested='Signed in as each non-owner at 390px, opened More and listed every tile; searched the Desk for any other link to Ops, Team or Settings.',
        expected='A page a role can open on desktop can be reached on the phone.',
        actual='On a phone, Sales, Production and Finance see only two tiles: Workflows and Leave. They cannot reach Ops, Team or Settings, although all three routes open for them and the desktop nav shows them Ops and Team. Ops was deliberately opened to every role so staff see their own metrics (App.js:222-226) - on mobile that view is unreachable.',
        evidence="More tiles for all three roles: ['Workflows', 'Leave']; visible links on their Desk to /operating-score, /team, /settings: 0, 0, 0. Desktop nav pills for the same users include nav-ops and nav-team.",
        cause="AllAppsPanel filters Ops and Settings with ownerOnly and Team with perm: 'team_manage', while the routes and the desktop nav use looser rules.",
        fix='Align the tile filters with the routes: show Ops to everyone (it already renders a self view), Team to everyone (read-only for non-managers), and Settings to everyone (profile + security for non-owners).',
        code='components/mobile/AllAppsPanel.jsx:70-83 and :127 (tile filters)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='GL-03',
        section='Global',
        screen='/login while signed in',
        viewport='Mobile + Desktop',
        persona='All',
        severity='Low',
        area='Routing',
        tested='Signed in as the owner, then opened /login directly.',
        expected='An already signed-in user is taken into the app.',
        actual="The sign-in form is shown again. A user following an old bookmark or a 'Sign in' link sees a login screen while already logged in.",
        evidence="Owner session, /login -> stays on /login showing 'Sign in - Access your company brain', both viewports.",
        cause='Login.js does not check for an existing session before rendering.',
        fix="If the auth context has a user, <Navigate to='/app' replace/> (the same hand-off Home already uses).",
        code='pages/Login.js (component top)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='DD-01',
        section='Decision Desk',
        screen='/decisions/:id - missing or not yours',
        viewport='Mobile + Desktop',
        persona='All',
        severity='High',
        area='Dead end / misleading error',
        tested='Opened /decisions/does-not-exist as all four roles, and a real pending decision as a non-participant; tried Escape and an outside tap; checked in the browser preview.',
        expected='The page says what went wrong and offers a way back.',
        actual="Full-screen 'Access restricted - You don't have access to this decision.' with no Close, no Back and no link. Escape and outside taps are deliberately ignored on the page variant, so the user is trapped until they find the browser Back button. The message is also wrong for a missing decision (the API said 404 'Not found') and for a network error. Decisions are opened from notifications and pasted links, so this is where stale links land.",
        evidence='All 4 roles x 1440/390: controls inside the dialog = []; Escape leaves = false; outside tap leaves = false. API 404 for the unknown id, 403 for a non-participant. Preview at 375x812 confirms.',
        cause="DecisionDialog's isError branch renders only a title and a sentence - the Close button exists only in the success branch - while variant='page' prevents Escape and outside dismissal (KM-28). isError also does not look at the status code.",
        fix="Give the error branch a 'Back to Decision Desk' button (and the same close control). Branch the copy on status: 403 -> no access, 404 -> 'This decision no longer exists', otherwise 'Couldn't load - Retry'.",
        code='components/DecisionDialog.js:188-218 (error branch, page variant handlers)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='DD-02',
        section='Decision Desk',
        screen='Desk board when loading fails',
        viewport='Mobile + Desktop',
        persona='Owner',
        severity='High',
        area='Error handling / misleading',
        tested='Aborted GET /api/desk?chip=* and read the Desk at 1440 and 390.',
        expected='The Desk says it could not load.',
        actual="It says 'Nothing waiting on you' with Needs your decision 0, On fire 0, Due today 0, Important 0. The real counts at the time were 53 decisions and 58 on fire. An owner on a weak connection is told the desk is clear.",
        evidence="Board text after the abort: 'Decision desk Nothing waiting on you Needs your decision 0 On fire 0 Due today 0 Important 0'. Without the abort: 53 / 58 / 0 / 0.",
        cause='The four useQueries read only data; counters fall back to all-zero when no query has data, and the sections render their empty copy.',
        fix="Check isError on the board queries; render 'Couldn't load your desk - Retry' and keep counts as '-' rather than 0. Same shared <QueryError> as OP-10 / CR-10 / FN-09.",
        code='pages/Desk.js:284-292 (boardQs + zero counters)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='DD-03',
        section='Decision Desk',
        screen='Money tiles for Sales / Production',
        viewport='Mobile + Desktop',
        persona='Sales / Production',
        severity='Medium',
        area='Permissions / endless loading',
        tested='Signed in as Sales and Production and read every KPI tile on the Desk.',
        expected='Tiles a role cannot see are hidden; tiles it can see load.',
        actual="'Net profit' and 'Spend, this month' show '...' forever - their data (ledger summary) is refused with 403 - while 'To collect (overdue) Rs 7.5 L' is shown to these roles, a customer-receivables figure they have no finance permission for. Tapping the money tiles leads to the empty Finance page of FN-07.",
        evidence='Sales desktop tiles: Delayed 20 / Complaints 16 / Score mix - / To collect (overdue) Rs 7.5 L / Net profit ... / Spend, this month .... GET /ledger/summary 403.',
        cause='useDeskMetrics fetches the ledger summary for every role and the tiles render a loading glyph when the data never arrives; the receivables figure comes from an ungated source (see CR-12).',
        fix="Render money tiles only when hasPerm(user,'finance') || hasPerm(user,'ledger'); otherwise show the role's own tiles.",
        code='pages/Desk.js:563-661 (KPI tiles), pages/desk/useDeskMetrics.js',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='DD-04',
        section='Decision Desk',
        screen='Company / You switch (mobile)',
        viewport='Mobile',
        persona='Owner',
        severity='Low',
        area='Missing function',
        tested='At 375-390px, listed the scope controls on the Desk.',
        expected='The owner can switch between the company score and their own on a phone.',
        actual='Both copies of the Company / You pills are in the DOM but invisible at phone width, so the phone only ever shows the company score.',
        evidence='desk-scope-pills and desk-scope-pills-side: width 0 at 375px (preview) and 390px (script); both visible and working at 1440.',
        cause='Both placements are gated to lg and no mobile placement was kept.',
        fix='Show the joined pill pair above the score below lg.',
        code='pages/Desk.js:426 and :470 (scope pill placements)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='DD-05',
        section='Decision Desk',
        screen='Decision review - note mic',
        viewport='Mobile + Desktop',
        persona='Owner',
        severity='Low',
        area='Dead control',
        tested="Pressed the microphone under 'Send a note' on a pending decision.",
        expected="The mic records a voice note, as its helper line promises ('Or tap the mic - speaking is faster than typing').",
        actual="It only shows a toast: 'Voice capture is available from the Dex panel'. The button and the helper line invite an action the page does not do.",
        evidence='Toast text on both viewports; no recording state, no permission prompt.',
        cause='onClick is a placeholder toast.',
        fix='Wire it to the same capture Dex uses, or remove the mic and its helper line until it is.',
        verified='OWNER: Yokesh (founder call, 2026-09-13) - all Dex issues are his; not to be worked on elsewhere.',
        code='components/DecisionDialog.js:421-445',
        found='2026-09-13',
        status='Assigned - Yokesh',
    ),
    dict(
        id='CL-01',
        section='Global',
        screen='Notifications, People, Journal, Calendar when loading fails',
        viewport='Mobile + Desktop',
        persona='Owner',
        severity='Medium',
        area='Error handling / misleading',
        tested="Aborted each page's main GET (notifications, users, journal, calendar) at 1440 and 390.",
        expected='Each page says it could not load.',
        actual="Notifications says 'You're all caught up.' People says 'Members 0 - No team members yet.' Calendar shows every filter at 0. Journal shows only its header and nothing below. None says anything failed. With OP-10, CR-10, FN-09 and DD-02 this is the same fault on nine surfaces.",
        evidence='Text after each abort, both viewports: see T-650..T-653.',
        cause='The pages read only data / isLoading and fall through to their empty states.',
        fix="One shared <QueryError onRetry> used wherever a query's data drives the page; branch 403 vs other errors. Fixing it once fixes OP-10, CR-10, FN-09, DD-02 and this.",
        code='pages/Notifications.js:14, pages/People.js:47-53, pages/Journal.js:185, pages/Calendar.js:62',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='CL-02',
        section='Calendar',
        screen='Calendar events',
        viewport='Mobile + Desktop',
        persona='All',
        severity='Medium',
        area='Dead end',
        tested='Tapped an event in Week view (script at 1440/390 and the browser preview).',
        expected='An event opens what it is - the task, meeting, payment or leave it came from.',
        actual="Nothing happens. Events are plain <div>s with no link or handler, so the calendar shows 'Vendor Call - Next Monday - Overdue' but the user cannot get from it to the task to act on it.",
        evidence='cal-event-*: tag DIV, no href, no role, cursor auto; URL unchanged after a tap; no dialog opened. 9 events in the week, all the same.',
        cause='Calendar renders events for display only.',
        fix='Wrap each event in a Link to its source (task -> /my-work?task=, decision -> /decisions/, invoice -> /finance?tab=revenue, leave -> /team).',
        code='pages/Calendar.js:233 (cal-event)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='CL-03',
        section='Notifications',
        screen='Mark all read',
        viewport='Mobile + Desktop',
        persona='All',
        severity='Low',
        area='Silent failure',
        tested='Pressed Mark all read with the request blocked, on a fresh page.',
        expected='A failed action says so.',
        actual='Nothing happens and nothing is said - no toast, the unread dots stay - so the user cannot tell whether it worked.',
        evidence='POST /notifications/read-all blocked -> toasts [], unread dots 28 -> 28.',
        cause='The mutation has no onError.',
        fix="toast.error('Couldn't mark notifications read') in onError.",
        code='pages/Notifications.js:17-21',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='CL-04',
        section='Settings',
        screen='Operations tab - add links',
        viewport='Desktop',
        persona='Owner',
        severity='Low',
        area='Accessibility / tap target',
        tested='Measured controls on Settings at 1440.',
        expected='Controls are at least 24px tall.',
        actual="'Add operational task' (149x20) and 'Add approval rule' (131x20) are under 24px.",
        evidence='Under-24px list on /settings at 1440.',
        cause='Text buttons without vertical padding.',
        fix='py-1 / min-h-6 on both.',
        code='pages/Settings.js (OperatingModelEditor add buttons)',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='AU-01',
        section='Sign-in',
        screen='Login, sign-up and admin fields',
        viewport='Mobile + Desktop',
        persona='Signed out',
        severity='Low',
        area='Accessibility',
        tested='Checked every input on /login, /signup and /admin for a programmatic label.',
        expected='Each field is named for assistive technology.',
        actual='Login email and password, the sign-up company name, and the admin email and password have no associated label or aria-label. The admin screen shows the words EMAIL and PASSWORD but they are not tied to the inputs.',
        evidence='Unlabelled: login-email-input, login-password-input, signup-input-company_name, admin-email-input, admin-password-input (both viewports; admin also in preview).',
        cause='Placeholder / visual captions instead of <label htmlFor>.',
        fix='Add labels (visually hidden where the design has none). Same fix as TM-06.',
        code='pages/Login.js:298-299, pages/Signup.js (basics), pages/admin/AdminLogin.js:44-57',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='AU-02',
        section='Sign-in',
        screen='Mobile OTP - phone number',
        viewport='Mobile + Desktop',
        persona='Signed out',
        severity='Low',
        area='Validation',
        tested='Entered a 3-digit number on the Mobile OTP tab and pressed Send (request blocked).',
        expected='An obviously invalid number is refused before a code is requested.',
        actual="The 3-digit number is sent to the server; with no provider reachable the user only sees 'Something went wrong. Please try again.', which does not tell them the number is wrong.",
        evidence="POST /auth/otp/request fired for '123'; error 'Something went wrong. Please try again.'",
        cause='No client-side length/format check on otp-phone-input.',
        fix="Require 10 digits (after stripping +91 / spaces) before enabling Send, and say 'Enter a 10-digit mobile number'.",
        code='pages/Login.js:179-190, :317',
        found='2026-09-13',
        status='Open',
    ),
    dict(
        id='AU-03',
        section='Sign-in',
        screen='Login - header links (desktop)',
        viewport='Desktop',
        persona='Signed out',
        severity='Low',
        area='Accessibility / tap target',
        tested='Measured controls on /login at 1440.',
        expected='Links are at least 24px tall.',
        actual="The 'DecisionOS' logo link is 91x21 and 'Need a workspace? Register' is 194x20.",
        evidence='Under-24px list on /login at 1440; both fine on mobile.',
        cause='Inline text links without padding.',
        fix='py-1 on both links.',
        code='pages/Login.js:241-246',
        found='2026-09-13',
        status='Open',
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

    # --- MY WORK re-check after the 2026-09-13 pull (9 commits) ---
    ("T-110", "My Work", "View slider", "Desktop 1440 + 1920", "Owner",
     "My Tasks / All Tasks / Workflows sit on one segmented control, one pressed",
     "Functional", "PASS",
     "3 segments, 40px tall, exactly one aria-pressed; AI Priority sits left of it", ""),
    ("T-111", "My Work", "View slider", "Desktop 1440x900", "Sales",
     "Non-owners get the same control shape", "Functional", "PASS",
     "Segments read Tasks | Workflows", ""),
    ("T-112", "My Work", "View slider - Workflows", "Desktop 1440 + 1920", "Owner",
     "Workflows segment switches view, hides AI Priority, and the slider returns",
     "Routing", "PASS",
     "workflows-hub renders, AI toggle hidden, My Tasks brings the list back", ""),
    ("T-113", "Workflows", "Board frame + stage labels", "Desktop 1440 + 1920", "Owner",
     "Each stage label centred over its column; board frame as the founder wants it",
     "Visual", "PASS",
     "Labels centred (0px offset on all 4 stages). The outer well was removed in c413f32 "
     "and deliberately RESTORED in 21142be on founder call, with per-column gradients "
     "cleared - by design, not a regression", ""),
    ("T-114", "My Work", "Uniform grid", "Desktop 1440 + 1920", "Owner",
     "Cards sit in a uniform grid with no page overflow", "Responsive", "PASS",
     "4 columns at both widths (332px / 452px cards), radius 16px, overflow 0", ""),
    ("T-115", "My Work", "Status filter", "Desktop 1440x900", "Owner",
     "Status dropdown filters the list", "Functional", "PASS",
     "Not Started: 26 -> 18 cards, trigger reads 'Status: Not Started'", ""),
    ("T-116", "My Work", "Department filter", "Desktop 1440x900", "Owner", "Department dropdown lists departments and filters", "Usability", "PASS", "Was: Completed listed as a department + six 0-count options (MW-19). Re-checked after 0a57743: All 25 / Logistics 1; Completed is under Status", "MW-19"),
    ("T-117", "My Work", "Task drawer - open", "Desktop 1440 + 1920", "Owner", "A task opens in a right-side drawer and stays open while used", "Functional", "PASS", "Was: any click inside closed it (MW-20). Re-checked after 0a57743: stays open for all 5 inside clicks", "MW-20"),
    ("T-118", "My Work", "ASK-11 status dropdown", "Desktop 1440 + 1920", "Owner",
     "The status dropdown carries no terminal states", "Functional", "PASS",
     "Not Started / In Progress / Waiting / Under Review only", "ASK-11"),
    ("T-119", "My Work", "Task drawer - log update", "Desktop 1440 + 1920", "Owner", "MW-08 regression check: Log update opens the form without crashing", "Regression", "PASS", "Re-checked after 0a57743: form visible, drawer stays open", "MW-20"),
    ("T-120", "My Work", "Task drawer - close", "Mobile 390x844", "Owner", "A phone user can close the drawer", "Navigation", "PASS", "Was: no reachable close (MW-15). Re-checked after 0a57743 + 89ed015: 44px close in the header, scrim strip tap closes, Escape closes", "MW-15"),
    ("T-121", "My Work", "Task drawer - log update", "Mobile 390x844", "Owner", "MW-09 regression check: Log update opens the form on a phone", "Regression", "PASS", "Was: form inside a hidden body (MW-16). Re-checked after 0a57743: form visible", "MW-16"),
    ("T-122", "My Work", "Task drawer - close controls", "Both", "Owner", "One visible close; focus lands on something visible", "Accessibility", "PASS", "Was: two closes, focus hidden (MW-17). Re-checked after 0a57743: one close, focus on it", "MW-17"),
    ("T-123", "Global", "Shell at 1920", "Desktop 1920x1080", "Owner", "Pages keep a readable width after the My Work width change", "Layout", "PASS", "Was: cap removed globally (MW-18). Re-checked after 0a57743: Finance and Team 1400px, My Work 1920px", "MW-18"),
    ("T-124", "My Work", "Task drawer - clicks inside", "Both", "Owner", "Clicking the title, body, status, Log update or Add manually keeps the drawer open", "Functional", "PASS", "Was: 10 of 10 closed it (MW-20). Re-checked after 0a57743: 10 of 10 stay open", "MW-20"),
    ("T-125", "My Work", "Task - Delete", "Both", "Owner", "An owner can reach Delete task", "Functional", "PASS", "Was: unreachable (MW-21). Re-checked after 0a57743: View details -> Delete task -> confirm step", "MW-21"),

    # --- TEAM ---
    ("T-200", "Team", "Page load", "Desktop 1440x900", "Owner",
     "/team loads directly with the full roster", "Routing", "PASS",
     "12 members grouped by role; no redirect", ""),
    ("T-201", "Team", "Page load", "Mobile 390x844", "Owner",
     "/team loads and reflows to a single column", "Responsive", "PASS",
     "224 visible elements, 20 interactive, no layout break", ""),
    ("T-202", "Team", "Page shell", "Both", "Owner",
     "No horizontal overflow on either viewport", "Responsive", "PASS",
     "desktop 1440=1440, mobile 390=390", ""),
    ("T-203", "Team", "All controls", "Mobile 390x844", "Owner",
     "Every control meets the 24px tap-target minimum", "Accessibility", "PASS",
     "0 under 24px", ""),
    ("T-204", "Team", "All text", "Both", "Owner",
     "All interactive text meets 4.5:1 contrast", "Accessibility", "PASS",
     "0 below 4.5:1 on either viewport", ""),
    ("T-205", "Team", "All controls", "Both", "Owner",
     "Every button and link has an accessible name", "Accessibility", "PASS",
     "0 unnamed; 0 images missing alt", ""),
    ("T-206", "Team", "Control sweep", "Desktop 1440x900", "Owner",
     "Every control can be pressed without crashing the app", "Stability", "PASS",
     "15 pressed incl. every dialog descended into; 0 crashes", ""),
    ("T-207", "Team", "Control sweep", "Mobile 390x844", "Owner",
     "Every control can be pressed without crashing the app", "Stability", "PASS",
     "10 pressed incl. dialogs; 0 crashes, 0 dead controls", ""),
    ("T-208", "Team", "Navigation", "Both", "Owner",
     "Every nav destination routes correctly", "Routing", "PASS",
     "desktop rail and mobile dock both resolve; aria-current set on Team", ""),
    ("T-209", "Team", "Add member dialog", "Both", "Owner",
     "Add member opens a complete form", "Functional", "PASS",
     "6 fields, 18 controls: name, email, login method, password, phone, role, "
     "manager, permission grid, menu preview", ""),
    ("T-210", "Team", "Add member validation", "Desktop 1440x900", "Owner",
     "An empty form is refused with a clear reason", "Functional", "PASS",
     "No API call fired; dialog stayed open; 'Name and email are required'", ""),
    ("T-211", "Team", "Add member - login method", "Both", "Owner",
     "The selected login method is exposed to assistive technology",
     "Accessibility", "FAIL", "No aria-pressed on either half of the toggle", "TM-01"),
    ("T-212", "Team", "Member profile dialog", "Both", "Owner",
     "A member card opens their profile with contact, reporting line and access",
     "Functional", "PASS",
     "Shows CONTACT, REPORTS TO, and ACCESS as 'n of 14 areas' with the list", ""),
    ("T-213", "Team", "Member profile dialog", "Both", "Owner",
     "The dialog has a proper accessible name", "Accessibility", "PASS",
     "sr-only DialogHeader + DialogTitle at Team.js:497 - the pattern MW-03 lacks", ""),
    ("T-214", "Team", "Member profile dialog", "Both", "Owner",
     "Every control in the dialog is distinguishable by name", "Accessibility", "PASS",
     "Was two buttons named 'Close'; re-checked 2026-09-13 - one Close as Owner and as "
     "Sales, both viewports", "TM-04"),
    ("T-215", "Team", "Edit access", "Desktop 1440x900", "Owner",
     "Edit access opens the permission editor in place", "Functional", "PASS",
     "Dialog content grows 1411 to 2299 chars; no error", ""),
    ("T-216", "Team", "Get invite link", "Desktop 1440x900", "Owner",
     "The invite control is present, unobstructed and correctly gated",
     "Functional", "PASS",
     "Rendered only for non-owners who have a phone; clickable and not covered", ""),
    ("T-217", "Team", "Get invite link", "Desktop 1440x900", "Owner",
     "An invite link is generated end to end", "Functional", "N/A",
     "NOT RUN by choice - it would mint a real invite token for a live teammate. "
     "The only disposable accounts have no phone, so the control is correctly "
     "hidden for them. Needs one manual pass.", ""),
    ("T-218", "Team", "Access control", "Desktop 1440x900", "Owner",
     "The owner can add and manage members", "Permissions", "PASS",
     "Add member visible; no view-only banner", ""),
    ("T-219", "Team", "Access control", "Desktop 1440x900", "Sales / Production / Finance",
     "Non-managers see the roster but cannot change it", "Permissions", "PASS",
     "All three: 12 cards visible, Add member hidden, view-only banner shown, "
     "no page errors", ""),
    ("T-220", "Team", "Owner section grid", "Desktop 1440x900", "All",
     "Role groups fill their row", "Visual", "FAIL",
     "Owner group is a 3-column grid holding one card; 874 of 1336px empty", "TM-02"),
    ("T-221", "Team", "Member cards", "Both", "All",
     "The roster shows what its own heading promises", "Information architecture",
     "FAIL",
     "Eyebrow says EMPLOYEES / ACCESS / REPORTING LINES; cards show neither the "
     "reporting line nor what the access is, only a count", "TM-03"),
    ("T-222", "Team", "Console + network", "Both", "Owner",
     "No application errors and no failing API calls", "Stability", "PASS",
     "Only the pre-login 401 on /auth/me", ""),

    ("T-223", "Team", "Member profile - ACCESS", "Desktop 1440x900",
     "Sales / Production / Finance",
     "A colleague's permission set is not readable by people who do not administer it",
     "Permissions", "FAIL",
     "All four roles can read another member's full matrix: count, granted chips "
     "and the complete 'No access to' denial list. Only the Edit button is gated.",
     "TM-05"),

    ("T-224", "Team", "Add member - all fields", "Desktop 1440x900", "Owner",
     "Every form field is programmatically labelled", "Accessibility", "FAIL",
     "All six report labelled:false; four are placeholder-only so the name "
     "vanishes on typing, and the two visible labels are not associated", "TM-06"),
    ("T-225", "Team", "Add member dialog", "Desktop 1440x900", "Owner",
     "The primary action is reachable without hunting", "Usability", "FAIL",
     "Submit is 66x44px, position:static, at the end of 2.17 screens of scroll",
     "ASK-14"),
    ("T-226", "Team", "Add member - login method", "Desktop 1440x900", "Owner",
     "The method toggle gates the fields it governs", "Usability", "FAIL",
     "'Password login' selected, yet 'Mobile number (for OTP login)' still shows",
     "ASK-14"),
    ("T-227", "Team", "Add member - menu preview", "Desktop 1440x900", "Owner",
     "The form shows what the new member will actually see", "Usability", "PASS",
     "'This member will see these menus' renders the resulting nav live, greying "
     "out what is not granted - the strongest part of the form", ""),

    # --- TEAM hands-on pass, 2026-09-13 (desktop 1440 + mobile 390, Owner + Sales, writes blocked) ---
    ("T-230", "Team", "Search", "Both", "Owner + Sales",
     "Search filters by name, email and role, and says when nothing matches",
     "Functional", "PASS",
     "'priya' 1 of 12; 'sharma.com' 5 of 12; 'production' 2 of 12 (role + email); "
     "'zzqq' 0 of 12 with 'Nobody matches \"zzqq\".'; clearing restores all 12", ""),
    ("T-231", "Team", "Member cards", "Both", "Owner + Sales",
     "Every member card opens that member's profile", "Functional", "PASS",
     "12 of 12 on all four passes", ""),
    ("T-232", "Team", "Profile dialog - close", "Both", "Owner + Sales",
     "Close button, Escape and clicking outside all close the profile", "Functional",
     "PASS", "All three close it on both viewports", ""),
    ("T-233", "Team", "Profile dialog - fit + targets", "Both", "Owner + Sales",
     "The dialog fits the screen and every control is at least 24px", "Responsive",
     "PASS", "Desktop 576px wide, mobile full width; Close 36px / 44px, Edit access and "
     "Get invite link 30-44px tall", ""),
    ("T-234", "Team", "Profile dialog - keyboard", "Desktop 1440x900", "Owner + Sales",
     "Enter opens a card and focus returns to it on close", "Accessibility", "FAIL",
     "Enter opens it; after Escape focus is on <body>", "TM-07"),
    ("T-235", "Team", "Edit access - stacking", "Both", "Owner",
     "Edit access opens over the profile, and one Escape returns to the profile",
     "Functional", "PASS", "2 dialogs open, title 'Edit access - Priya Nair'; one Escape "
     "leaves the profile open", ""),
    ("T-236", "Team", "Edit access - permissions", "Both", "Owner",
     "Every permission toggle flips and the menu preview follows it", "Functional",
     "PASS", "14 of 14 toggles flip aria-pressed and back; preview chips for People, "
     "Company Brain, Capture, Workflows and Decision Desk strike and un-strike", ""),
    ("T-237", "Team", "Edit access - promote to Owner", "Both", "Owner",
     "Choosing Owner explains full access and asks before saving", "Functional", "PASS",
     "Grid swaps for the 'Full company access' note; Save asks 'This makes them a "
     "co-owner with FULL control...' (dismissed, nothing sent)", ""),
    ("T-238", "Team", "Edit access - failed save", "Both", "Owner",
     "A failed save says so and keeps the user's changes open", "Functional", "PASS",
     "PATCH blocked -> 'Something went wrong. Please try again.', dialog stays open", ""),
    ("T-239", "Team", "Edit access - Save reachable", "Both", "Owner",
     "Save access is visible without scrolling", "Usability", "FAIL",
     "Desktop: visible. Mobile: off-screen - dialog content 1,309px in a 758px window",
     "ASK-14"),
    ("T-240", "Team", "Add member - validation", "Both", "Owner",
     "Each invalid submit is refused with its own reason", "Functional", "PASS",
     "Empty -> 'Name and email are required'; 3-char password -> 'Set a 6+ char "
     "password...'; OTP with 5-digit phone -> 'A valid mobile number is required...'", ""),
    ("T-241", "Team", "Add member - login method", "Both", "Owner",
     "Mobile OTP hides the password and makes the phone required; Password restores it",
     "Functional", "PASS", "Password field hidden, hint shown, placeholder 'Mobile number "
     "(required for OTP login)'; switching back restores the password field", ""),
    ("T-242", "Team", "Add member - role + manager", "Both", "Owner",
     "Changing role applies that role's default access; manager list is populated",
     "Functional", "PASS", "Defaults: sales 6, production 6, finance 8 areas; manager "
     "select has 12 people + None", ""),
    ("T-243", "Team", "Add member - failed save + reopen", "Both", "Owner",
     "A failed add keeps the form open; reopening starts blank", "Functional", "PASS",
     "POST blocked -> error toast, dialog open; reopened with an empty name field", ""),
    ("T-244", "Team", "Add member - Add reachable", "Both", "Owner",
     "The Add button is visible without scrolling", "Usability", "FAIL",
     "Off-screen on both: content 1,026px in 808px (desktop), 1,535px in 758px (mobile, "
     "about two screens)", "ASK-14"),
    ("T-245", "Global", "Dialog close size", "Desktop 1440x900", "Owner",
     "The dialog close control is at least 24px", "Accessibility", "FAIL",
     "Add member close is 16x16 on desktop (44x44 on mobile)", "TM-08"),
    ("T-246", "Team", "Read-only role", "Both", "Sales",
     "A non-manager sees the roster read-only, with no edit or invite controls",
     "Permissions", "PASS", "Read-only banner shown; no Add member, Edit access or Get "
     "invite link; leave history shown on her own profile, hidden on a colleague's", ""),
    ("T-247", "Team", "Read-only role - colleague access", "Both", "Sales",
     "A colleague's access list is not readable by a non-manager", "Permissions",
     "FAIL", "Sales still reads TEST Limited's 'n of 14 areas' and 'No access to ...'",
     "TM-05"),
    ("T-248", "Team", "Desktop scrolling (after 7d2fabe)", "Desktop 1440x900", "Owner",
     "The roster scrolls and the last member is reachable", "Responsive", "PASS",
     "<main> is now the scroll container (scrollTop 643 after one wheel); last card "
     "reachable; page title scrolls away, which is by design (common.js KM-25)", ""),
    ("T-249", "Team", "Get invite link - pressed", "Both", "Owner",
     "Pressing Get invite link gives feedback and no token is minted by the test",
     "Functional", "PASS", "POST blocked -> 'Something went wrong. Please try again.', "
     "profile stays open. End-to-end generation still not run (see T-217)", ""),

    # --- CRM ---
    ("T-300", "CRM", "Page load", "Desktop 1440x900", "Owner",
     "/crm loads directly with the contact list", "Routing", "PASS",
     "11 buyer cards; no redirect", ""),
    ("T-301", "CRM", "Page load", "Mobile 390x844", "Owner",
     "/crm loads and reflows to a single column", "Responsive", "PASS",
     "207 visible elements, 22 interactive", ""),
    ("T-302", "CRM", "Page shell", "Both", "Owner",
     "No horizontal overflow on either viewport", "Responsive", "PASS",
     "desktop 1440=1440, mobile 390=390", ""),
    ("T-303", "CRM", "All controls", "Mobile 390x844", "Owner",
     "Every control meets the 24px tap-target minimum", "Accessibility", "PASS",
     "0 under 24px", ""),
    ("T-304", "CRM", "All text", "Both", "Owner",
     "All interactive text meets 4.5:1 contrast", "Accessibility", "PASS",
     "0 below 4.5:1 on either viewport", ""),
    ("T-305", "CRM", "All controls", "Both", "Owner",
     "Every button and link has an accessible name", "Accessibility", "PASS",
     "0 unnamed; 0 images missing alt", ""),
    ("T-306", "CRM", "Control sweep", "Desktop 1440x900", "Owner",
     "Every control can be pressed without crashing the app", "Stability", "PASS",
     "17 pressed incl. dialogs descended into; 0 crashes", ""),
    ("T-307", "CRM", "Control sweep", "Mobile 390x844", "Owner",
     "Every control can be pressed without crashing the app", "Stability", "PASS",
     "13 pressed incl. dialogs; 0 crashes", ""),
    ("T-308", "CRM", "Scope chips", "Desktop 1440x900", "Owner",
     "Buyers / Suppliers filter the list correctly", "Functional", "PASS",
     "Buyers 11, Suppliers 6, back to Buyers 11", ""),
    ("T-309", "CRM", "Scope chips", "Desktop 1440x900", "Owner",
     "The selected scope is exposed to assistive technology", "Accessibility",
     "FAIL", "Desktop chips have no aria-pressed; the mobile twins set it", "CR-01"),
    ("T-310", "CRM", "Add contact dialog", "Desktop 1440x900", "Owner",
     "Add customer opens a complete contact form", "Functional", "PASS",
     "Type segmented control, name, company, phone, email, lifecycle, and a "
     "'More details' disclosure for GSTIN", ""),
    ("T-311", "CRM", "Add contact dialog", "Desktop 1440x900", "Owner",
     "The form fits without scrolling", "Usability", "PASS",
     "576x541 with 539px of content - no scroll, unlike Team's 2.17 screens", ""),
    ("T-312", "CRM", "Add contact validation", "Desktop 1440x900", "Owner",
     "An empty form is refused with a clear reason", "Functional", "PASS",
     "No API call; dialog stayed open; 'Name is required'", ""),
    ("T-313", "CRM", "Add contact dialog", "Desktop 1440x900", "Owner",
     "Every field is programmatically labelled", "Accessibility", "FAIL",
     "Zero label elements in the dialog; all six fields placeholder-only", "CR-02"),
    ("T-314", "CRM", "Add contact dialog", "Desktop 1440x900", "Owner",
     "One way to dismiss the dialog", "Redundancy", "FAIL",
     "Both a 'Cancel' button and a separate 'Close' X", "CR-03"),
    ("T-315", "CRM", "Contact profile route", "Desktop 1440x900", "Owner",
     "A contact card opens that contact's profile page", "Routing", "PASS",
     "crm-card-<id> navigates to /contacts/<id>; page renders, no errors", ""),
    ("T-316", "CRM", "Console + network", "Both", "Owner",
     "No application errors and no failing API calls", "Stability", "PASS",
     "Only the pre-login 401 on /auth/me", ""),

    ("T-317", "CRM", "Scope chips", "Desktop 1280x800", "Owner",
     "Switching to Suppliers reloads the list", "Functional", "PASS",
     "Buyers 11 -> Suppliers 6, correct records, chip state flips", ""),
    ("T-318", "CRM", "Sort control", "Desktop 1280x800", "Owner",
     "Sorting by outstanding puts the biggest debtor first", "Functional", "PASS",
     "Krishna Garments Rs 4,00,000 first, then Nashik Traders Rs 64,000", ""),
    ("T-319", "CRM", "Add contact menu", "Desktop 1280x800", "Owner",
     "The menu opens with its three options readable", "Functional", "PASS",
     "aria-expanded flips, role=menu appears: New Buyer, New Supplier, Import", ""),
    ("T-320", "CRM", "Add contact menu", "Mobile 375x812", "Owner",
     "The menu opens inside the screen", "Responsive", "FAIL",
     "80% clipped off the right edge; only a 55px strip of icons is visible", "CR-04"),
    ("T-321", "CRM", "New customer dialog", "Desktop 1280x800", "Owner",
     "The form is grouped and fits one screen", "Usability", "PASS",
     "Sections Type / Identity / Contact / Classification, required marked, "
     "More details disclosure, Cancel beside Add contact, no scrolling", ""),
    ("T-322", "CRM", "Filter control", "Mobile 375x812", "Owner",
     "Filter reveals the status and sort controls", "Functional", "FAIL",
     "Completely inert; status filter and sort exist at 0x0 so neither is "
     "reachable on a phone", "CR-05"),
    ("T-323", "CRM", "Contact cards", "Mobile 375x812", "All",
     "Customer names are readable on a phone", "Responsive", "FAIL",
     "Two-column grid at 160.5px per card truncates 8 text nodes including names",
     "CR-06"),
    ("T-324", "CRM", "Contact profile", "Desktop 1280x800", "Owner",
     "A contact card opens a profile with money and activity", "Functional", "PASS",
     "Outstanding / Total Billed / Total Paid / Open Complaints tiles, AI scoring, "
     "and inline activity logging", ""),
    ("T-325", "CRM", "Contact profile", "Desktop 1280x800", "All",
     "Primary actions use the app's primary colour", "Design system", "FAIL",
     "Log button is indigo rgb(55,58,205); the app's primaries are rgb(12,12,13)",
     "CR-07"),
    ("T-326", "CRM", "Mobile header controls", "Mobile 375x812", "Owner",
     "Header controls meet the 44px touch guideline", "Accessibility", "PASS",
     "Filter 44x44, Add contact 44x44, scope segment 166x44, bell 48x48", ""),

    ("T-327", "CRM", "Contact profile - In progress", "Mobile 375x812", "All",
     "A missing due date does not print raw values to the user", "Data quality",
     "FAIL", "Rows read 'Due undefined - Rs 1' and 'Due undefined - Rs 6,00,000'",
     "CR-08"),
    ("T-328", "CRM", "Contact profile - In progress", "Mobile 375x812", "All",
     "The list distinguishes workflows from deliveries and rows are actionable",
     "Information design", "FAIL",
     "Two entity types share identical styling; titles repeat as bare 'sale'; a "
     "'Delivered' row sits under 'In progress'; no row is tappable", "ASK-18"),

    # --- CRM pass, 2026-09-13 (Owner + Sales/Production/Finance, 1440 + 390, writes blocked) ---
    ("T-329", "CRM", "Cards -> profile -> back", "Both", "Owner",
     "Every contact card opens its profile and Back returns to the list", "Routing",
     "PASS", "11 of 11 open and 11 of 11 return, on both viewports", ""),
    ("T-330", "CRM", "Profile sections + actions (mobile)", "Mobile 390x844", "Owner",
     "Every section expands and collapses; Call and Email are real links", "Functional",
     "PASS", "7 of 7 sections toggle aria-expanded; tel:+919820044558, "
     "mailto:deepak@anandfabrics.in", ""),
    ("T-331", "CRM", "Log activity", "Desktop 1440x900", "Owner",
     "Empty activity is refused; a failed save says so and keeps the text", "Functional",
     "PASS", "Save disabled when empty; 6 kinds; blocked POST -> 'Could not save', text "
     "kept", ""),
    ("T-332", "CRM", "Missing contact", "Both", "Owner",
     "An unknown contact id explains itself with a way back", "Error handling", "PASS",
     "'That contact isn't here...' + 'Back to People' -> /crm", ""),
    ("T-333", "CRM", "List scrolling + slow load", "Both", "Owner",
     "The last card is reachable; a slow list shows loading, not 'empty'", "Responsive",
     "PASS", "Last card within the viewport after scrolling; 18 skeleton placeholders "
     "during a 5s delay", ""),
    ("T-334", "CRM", "Contact list fails", "Both", "Owner",
     "A failed contact list says so", "Error handling", "FAIL",
     "Skeleton forever with 'Buyers 0 / Suppliers 0'; no message, no retry", "CR-10"),
    ("T-335", "CRM", "Profile fails", "Both", "Owner",
     "A failed profile request is reported as a failure", "Error handling", "FAIL",
     "Says the contact 'may have been merged or removed'", "CR-11"),
    ("T-336", "CRM", "Roles - navigation", "Both", "Sales / Production / Finance",
     "CRM is hidden from roles without the People permission", "Permissions", "PASS",
     "No nav-crm on desktop; no /crm in the mobile More panel", ""),
    ("T-337", "CRM", "Roles - direct links", "Both", "Sales / Production / Finance",
     "/crm and /contacts/<id> refuse clearly with a way out", "Permissions", "PASS",
     "Access Denied on both; 'Go to My Work' leaves the page", ""),
    ("T-338", "CRM", "Roles - server", "n/a", "Sales / Finance",
     "The API refuses contact data to roles without the permission", "Permissions",
     "PASS", "GET /contacts 403 for both; /contacts/<id>/profile 403 for Sales (200 for "
     "Finance, which holds the finance permission, though the page itself is refused)", ""),
    ("T-339", "CRM", "Roles - outstanding totals", "n/a", "Sales / Production / Finance",
     "Per-customer money figures are permission-gated", "Permissions", "FAIL",
     "GET /crm/outstanding returns receivables/payables per contact to any signed-in user",
     "CR-12"),
    ("T-340", "CRM", "Roles - links from elsewhere", "Both", "Sales / Production / Finance",
     "No link offers these roles a page they cannot open", "Navigation", "FAIL",
     "Decision Desk 'Complaints' tile links to /crm -> Access Denied", "CR-13"),
    ("T-341", "CRM", "Profile - link size", "Desktop 1440x900", "Owner",
     "Controls are at least 24px tall", "Accessibility", "FAIL",
     "'Back to CRM' is 103x20", "CR-14"),
    ("T-342", "CRM", "CR-08 re-check", "Mobile 375x812", "Owner",
     "Pending deliveries without a due date do not print 'undefined'", "Data leak to UI",
     "FAIL", "Browser preview 2026-09-13: 'Due undefined - Rs 1' and 'Due undefined - "
     "Rs 6,00,000' still shown under In progress", "CR-08"),

    # --- OPS ---
    ("T-400", "Ops", "Page load", "Desktop 1440x900", "Owner",
     "/operating-score loads with the score and all four categories",
     "Routing", "PASS", "Overall 19/100, four category cards, next-moves, quick stats", ""),
    ("T-401", "Ops", "Page load", "Mobile 390x844", "Owner",
     "/operating-score loads and reflows", "Responsive", "PASS",
     "317 visible elements, compact Key scores card", ""),
    ("T-402", "Ops", "Page shell", "Both", "Owner",
     "No horizontal overflow; every control named; images have alt",
     "Responsive", "PASS", "desktop 1440=1440, mobile 390=390, 0 unnamed", ""),
    ("T-403", "Ops", "Control sweep", "Both", "Owner",
     "Every control pressed without crashing the app", "Stability", "PASS",
     "47 checks passed across both viewports; 0 crashes", ""),
    ("T-404", "Ops", "Category breakdown", "Both", "Owner",
     "Each category opens a breakdown that states its weight", "Functional", "PASS",
     "Execution 35%, Finance 25%, Sales 20%, Responsiveness 20% - the model is "
     "disclosed to the user", ""),
    ("T-405", "Ops", "Next-move actions", "Mobile 390x844", "Owner",
     "Each recommended action links somewhere real", "Routing", "PASS",
     "ops-action-overdue -> /my-work?filter=overdue; ops-action-complaints -> /crm", ""),
    ("T-406", "Ops", "Score arithmetic", "n/a", "Owner",
     "The reported legs match a recomputation from raw records", "Data quality",
     "PASS", "Recomputed execution 0 and responsiveness 0 from 148 tasks; both "
     "match the API exactly - the model is implemented as designed", ""),
    ("T-407", "Ops", "Team execution panel", "Both", "Owner",
     "The stated time window is the one applied", "Data quality", "FAIL",
     "Caption says 'Last 30 days'; the service applies no date filter at all", "OP-01"),
    ("T-408", "Ops", "'Do these first'", "Mobile 390x844", "Owner",
     "The primary call to action is readable", "Responsive", "FAIL",
     "256 of its 285px sit behind a fixed band; the document cannot scroll", "OP-02"),
    ("T-409", "Ops", "Score responsiveness", "n/a", "Owner",
     "Acting on the advice moves the score", "Metric design", "FAIL",
     "Responsiveness computes to -296 before clamping; closing all 16 complaints "
     "would leave it at 0", "OP-03"),
    ("T-410", "Ops", "'Sales' category", "n/a", "Owner",
     "The category measures what its label says", "Metric design", "FAIL",
     "It is approved/total decisions; contains no revenue, orders or pipeline", "OP-04"),
    ("T-411", "Ops", "Score model", "n/a", "Owner",
     "Each underlying fact is counted once", "Metric design", "FAIL",
     "Overdue tasks are charged to both Execution and Responsiveness", "OP-05"),
    ("T-412", "Ops", "Score model", "n/a", "Owner",
     "The score means the same at any company size", "Metric design", "FAIL",
     "complaints x12, overdue x3, overdue invoices x5 are absolute, not rates", "OP-06"),
    ("T-413", "Ops", "Empty workspace", "n/a", "Owner",
     "A workspace with no data reads as unknown", "Metric design", "FAIL",
     "Defaults of 0.7 give a brand-new tenant roughly 70/100", "OP-07"),
    ("T-414", "Ops", "Category cards", "Desktop 1440x900", "Owner",
     "A floored score looks different from a missing one", "Information design",
     "FAIL", "0/100 with an empty bar is identical to unmeasured", "OP-08"),
    ("T-415", "Ops", "'View all' + formula panel", "Mobile 390x844", "Owner",
     "Links are tappable and the whole page is reachable", "Accessibility", "FAIL",
     "View all is 61x20 and one is covered by dex-fab; the formula toggle sits at "
     "y=1153 on an 812px screen and cannot be reached", "OP-09"),
    ("T-416", "Ops", "Next-move honesty", "n/a", "Owner",
     "Recommendations do not claim unearned outcomes", "Data quality", "PASS",
     "scoreActions deliberately removed hardcoded '+6 pts' lift estimates because "
     "the score has no history to fit a counterfactual against", ""),
    ("T-417", "Ops", "Finance leg", "n/a", "Owner",
     "Only inbound payments count as money collected", "Data quality", "PASS",
     "payments query filters direction='in'; outbound supplier payments excluded", ""),
    ("T-418", "Ops", "Weighting", "n/a", "Finance-less roles",
     "Weights renormalise when a leg is unavailable", "Functional", "PASS",
     "finance is null without the permission and the remaining weights rescale", ""),

    # --- OPS gap pass, 2026-09-13 (view-as, four roles, AI surfaces; writes blocked) ---
    ("T-419", "Ops", "View-as - open", "Both", "Owner",
     "An employee card opens that person's Ops with a banner naming them", "Routing",
     "PASS", "/operating-score?user=<id>; banner 'Viewing Priya Nair - sales - Back to "
     "company'; her self view renders", ""),
    ("T-420", "Ops", "View-as - leaving", "Both", "Owner",
     "Back to company, browser Back and ?user=<own id> all land on the company view",
     "Routing", "PASS", "All three show the leaderboard with no banner", ""),
    ("T-421", "Ops", "View-as - accuracy", "Both", "Owner + Sales",
     "The owner sees exactly what the person sees on their own login", "Data quality",
     "PASS", "Priya's own page and the owner's view-as both read Completed 1 / Open 29 / "
     "Overdue 20 / Completion 3%; API payloads identical", ""),
    ("T-422", "Ops", "View-as - unknown person", "Both", "Owner",
     "An unknown ?user= id explains itself", "Error handling", "FAIL",
     "API 404 'Team member not found'; page shows the loading skeleton forever", "OP-10"),
    ("T-423", "Ops", "Roles - self view", "Both", "Sales / Production / Finance",
     "Non-owners get their personal view, not the company leaderboard", "Permissions",
     "PASS", "API view=self; no leaderboard, no banner; stats, open work and peer context "
     "render (Production has no peer group)", ""),
    ("T-424", "Ops", "Roles - self view links", "Both", "Sales / Production / Finance",
     "Every link on the self view opens a real screen", "Routing", "PASS",
     "/my-work and /my-work?filter=overdue both load", ""),
    ("T-425", "Ops", "Roles - viewing someone else", "Both", "Sales / Production / Finance",
     "A non-owner who opens another person's Ops is told they cannot", "Error handling",
     "FAIL", "API 403 correctly; page shows the loading skeleton forever with no message",
     "OP-10"),
    ("T-426", "Ops", "Self view - bottom band", "Mobile 390x844",
     "Sales / Production / Finance",
     "Pinned content is worth the space and is not hidden by the dock", "Layout", "FAIL",
     "176px fixed black band holding one sentence, mostly behind the dock", "OP-11"),
    ("T-427", "Ops", "View-as + self view - link size", "Both", "All",
     "Links are at least 24px tall", "Accessibility", "FAIL",
     "'Back to company' 16-20px tall; 'See all' 16-20px tall", "OP-13"),
    ("T-428", "Ops", "AI coach - own", "Both", "All four",
     "/coach loads each person's own coach", "Functional", "PASS",
     "Owner and Finance: 'No coaching yet' with Generate; Sales and Production: cached "
     "review from 29 Aug with Refresh; no overflow", ""),
    ("T-429", "Ops", "AI coach - a teammate's", "Both", "Owner",
     "The owner can open a teammate's coach", "Permissions", "PASS",
     "/coach?user=<Priya> reads 'Priya Nair - sales'", ""),
    ("T-430", "Ops", "AI coach - not allowed", "Both", "Sales / Production / Finance",
     "A non-owner is refused a colleague's coach, with a way back", "Permissions", "PASS",
     "'Not allowed - Only the owner can view another team member's coaching'; 'View my "
     "coach' returns to /coach", ""),
    ("T-431", "Ops", "AI coach - unknown person", "Both", "Owner",
     "An unknown id shows an accurate error", "Copy", "FAIL",
     "Shows an error (good) but titles it 'Access denied' for a 404", "OP-14"),
    ("T-432", "Ops", "AI coach - refresh failure", "Both", "All four",
     "A failed Generate / Refresh says so and recovers", "Error handling", "PASS",
     "POST blocked -> 'Could not refresh coaching'; button label restored", ""),
    ("T-433", "Ops", "AI coach - entry point", "Both", "All four",
     "The coach can be reached from the app", "Navigation", "FAIL",
     "No link to /coach on any Ops screen or anywhere else in the app", "OP-12"),
    ("T-434", "Ops", "AI coach + Score with AI - live generation", "Both", "Owner",
     "A live model run produces a sensible review / score", "AI", "N/A",
     "NOT RUN by choice: refresh overwrites users.coach_summary and rescore overwrites "
     "the contact's AI score, both via a paid model call. Awaiting the founder's go, "
     "ideally on a TEST account and a test contact", ""),
    ("T-435", "CRM", "Score with AI - failure path", "Desktop 1440x900", "Owner",
     "A failed rescore says so and recovers", "Error handling", "PASS",
     "POST blocked -> 'Could not score right now'; label restored to 'Score with AI'", ""),
    ("T-436", "CRM", "Score with AI - mobile", "Mobile 390x844", "Owner",
     "The rescore action exists on the phone", "Feature parity", "FAIL",
     "No scoring control on the mobile contact profile; Health row is read-only", "CR-09"),

    # --- FINANCE ---
    ("T-500", "Finance", "Page load", "Desktop 1280x800", "Owner",
     "/finance loads the Overview with six KPI tiles", "Routing", "PASS",
     "Revenue billed, Received, Net profit, Total Spend, Asset Value, "
     "Inventory Value", ""),
    ("T-501", "Finance", "Tabs", "Desktop 1280x800", "Owner",
     "All six tabs switch content", "Functional", "PASS",
     "Overview, Revenue, Expenses, Assets, Inventory, Inbox all render", ""),
    ("T-502", "Finance", "Arithmetic", "n/a", "Owner",
     "Every reported figure reconciles with a recomputation from raw records",
     "Data quality", "PASS",
     "8 of 8 reconcile to the paisa: billed 26,85,000; received 19,36,000; spend "
     "19,46,966; paid 12,91,500; outstanding 6,55,466; assets 40,85,000; "
     "inventory 13,18,800; net 7,38,034", ""),
    ("T-503", "Finance", "Cross-tab consistency", "Desktop 1280x800", "Owner",
     "The same figure agrees across tabs", "Data quality", "PASS",
     "Overview 'Revenue billed' = Revenue tab 'Billed' = 26,85,000; status "
     "buckets (2 paid + 3 unpaid) sum to sales_count 5", ""),
    ("T-504", "Finance", "Money formatting", "Both", "All",
     "Rupees are grouped the Indian way, consistently", "Localisation", "FAIL",
     "Tiles render Rs 2,685,000 instead of Rs 26,85,000, via a private formatter "
     "with an undefined locale; AI panels on the same page use Rs 7.49L", "FN-01"),
    ("T-505", "Finance", "Net profit hero", "Mobile 375x812", "All",
     "A figure captioned 'This month' covers this month", "Data quality", "FAIL",
     "Shows the all-time 7,38,034 under a 'This month' chip", "FN-02"),
    ("T-506", "Finance", "Trend badges", "Mobile 375x812", "All",
     "A trend beside Revenue describes revenue", "Data quality", "FAIL",
     "Both Revenue and Net profit trends are the month-on-month change in "
     "EXPENSES; pct(839469, 1077500) = -22.1%, exactly what is displayed", "FN-03"),
    ("T-507", "Finance", "'Net profit' definition", "n/a", "All",
     "The label matches the formula", "Metric design", "FAIL",
     "billed minus all expenses; no COGS, no inventory, assets ignored; cash "
     "basis differs by 93,534", "FN-04"),
    ("T-508", "Finance", "Time window", "n/a", "All",
     "The page can show a period", "Metric design", "FAIL",
     "No date filter anywhere; every figure is all-time", "FN-05"),
    ("T-509", "Finance", "Revenue tab", "Desktop 1280x800", "Owner",
     "Billed / Received / Outstanding tiles are correct and unambiguous",
     "Functional", "PASS",
     "26,85,000 / 19,36,000 / 7,49,000 - and 'Outstanding' here is receivables, "
     "distinct from the payables figure which is not shown as a tile", ""),
    ("T-510", "Finance", "Mobile quick actions", "Mobile 375x812", "Owner",
     "The capture row offers upload, scan, add and export", "Functional", "PASS",
     "Upload bill, Scan receipt, Add expense, Export all render", ""),

    ("T-511", "Finance", "Control sweep", "Both", "Owner",
     "Every control pressed without crashing the app", "Stability", "PASS",
     "37 checks passed across both viewports; 0 crashes; 8 mutations blocked "
     "including POST ledger/ai/brief/refresh", ""),
    ("T-512", "Finance", "KPI tiles as links", "Both", "Owner",
     "Each KPI tile navigates to its tab", "Routing", "PASS",
     "mkpi-revenue is an <a href='/finance?tab=revenue'>; clicking moves the URL "
     "from '' to '?tab=revenue'. The sweep first flagged all 14 tiles as dead - "
     "a false positive from comparing only the path, now fixed in the harness", ""),
    ("T-513", "Finance", "Mobile tab strip", "Mobile 375x812", "Owner",
     "The six tabs are reachable on a phone", "Responsive", "PASS",
     "Horizontally scrollable strip: scrollWidth 639 > clientWidth 446, "
     "overflow-x auto. The sweep first reported a 130px spill - a false positive "
     "on a deliberately scrollable strip, now excluded in the harness", ""),

    # --- FINANCE pass, 2026-09-13 (Owner, Finance, Sales, Production; 1440 + 390; writes blocked) ---
    ("T-514", "Finance", "Tabs by role", "Both", "Owner / Finance",
     "All six tabs open without crashing or overflowing", "Functional", "PASS",
     "Overview, Revenue, Expenses, Assets, Inventory, Inbox - 0 crashes, 0 overflow", ""),
    ("T-515", "Finance", "Capture - uploads", "Both", "Owner / Finance",
     "Upload bill, Photo / Scan receipt and CSV report a failed upload and recover",
     "Error handling", "PASS", "Blocked POST /ingest/document and /ingest/csv -> error "
     "toast each; 'Extracting...' clears (checked on fresh pages)", ""),
    ("T-516", "Finance", "Add dialogs - validation", "Desktop 1440x900", "Owner / Finance",
     "Empty income / expense / asset / inventory forms are refused before sending",
     "Functional", "PASS", "'Add a title, customer or amount', 'Add a title/amount or "
     "attach a bill', 'Add a name or attach a bill', 'Add an item or attach a bill'; no "
     "request sent", ""),
    ("T-517", "Finance", "Add dialogs - failed save", "Desktop 1440x900", "Owner / Finance",
     "A failed save says so and keeps the form open", "Error handling", "PASS",
     "'Could not record income' / 'Failed'; dialog stays open", ""),
    ("T-518", "Finance", "Delete", "Both", "Owner / Finance",
     "Deleting a money record asks first", "Destructive action", "FAIL",
     "Expense, invoice and payment DELETE fire on the first tap; no confirmation",
     "FN-06"),
    ("T-519", "Finance", "Revenue filters", "Both", "Owner / Finance",
     "Each status filter narrows the invoice list", "Functional", "PASS",
     "all 5 / awaiting 3 / partial 0 / paid 2 / overdue 3", ""),
    ("T-520", "Finance", "AI analysis", "Both", "Owner / Finance",
     "Refresh and Ask report failure and keep the question", "Error handling", "PASS",
     "'Could not refresh analysis'; 'AI is busy, try again' with the question kept", ""),
    ("T-521", "Finance", "Mobile quick links", "Mobile 390x844", "Owner / Finance",
     "View all and the Inbox arrow go where they say", "Routing", "PASS",
     "View all -> ?tab=revenue; Inbox arrow selects the Inbox tab", ""),
    ("T-522", "Finance", "Mobile - add a record", "Mobile 390x844", "Owner / Finance",
     "Income, expenses, assets and inventory can be added on a phone", "Functional",
     "FAIL", "All four Add buttons hidden below lg; the 'Add expense' tile is dead",
     "FN-08"),
    ("T-523", "Finance", "Mobile - capture labels", "Mobile 390x844", "All",
     "Each capture tile's label matches its action", "Copy", "FAIL",
     "'Export - CSV, Excel' uploads a spreadsheet", "FN-10"),
    ("T-524", "Finance", "Mobile - link size", "Mobile 390x844", "Owner / Finance",
     "Controls are at least 24px tall", "Accessibility", "FAIL",
     "'View all 3+ action items' is 20px tall", "FN-11"),
    ("T-525", "Finance", "Finance role", "Both", "Finance",
     "The Finance login gets the full ledger", "Permissions", "PASS",
     "All ledger calls 200; same tabs, dialogs and filters as the Owner", ""),
    ("T-526", "Finance", "Sales / Production", "Both", "Sales / Production",
     "A role without ledger access is refused clearly, not shown empty books",
     "Permissions", "FAIL", "Money in nav/dock; page opens; 6 ledger calls 403; overview "
     "'Loading...' forever; four tabs say 'No ... yet'", "FN-07"),
    ("T-527", "Finance", "Failed loads", "Both", "Owner",
     "A failed summary or expenses request says so", "Error handling", "FAIL",
     "Summary: 'Loading...' forever. Expenses: 'No expenses yet'", "FN-09"),
    ("T-528", "Finance", "FN-01 / FN-02 re-check", "Mobile 375x812", "Owner",
     "Rupees grouped the Indian way; 'This month' shows a monthly figure", "Localisation",
     "FAIL", "Preview 2026-09-13: still Rs 738,034 under 'This month', Revenue Rs 2,685,000",
     "FN-01"),

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
    ('T-600', 'Global', 'Signed-out access', 'Desktop 1440x900', 'Signed out', 'Every protected route sends a signed-out visitor to sign-in', 'Permissions', 'PASS', '15 of 15 redirect to /login', ''),
    ('T-601', 'Global', 'Role x route matrix', 'Desktop 1440x900', 'All four', 'Each role gets Access Denied exactly where its permissions say', 'Permissions', 'PASS', 'Journal owner-only and CRM needs People: Access Denied for Sales, Production and Finance; everything else opens', ''),
    ('T-602', 'Global', 'Redirects', 'Desktop 1440x900', 'All four', 'Every retired route lands on its new home', 'Routing', 'PASS', '13 of 13: /brief, /dashboard, /leave, /review, /ingest, /tasks, /priorities, /meetings, /ledger, /ask, /contacts, /inbox-legacy, unknown path', ''),
    ('T-603', 'Global', 'Desktop nav + search + user menu', 'Desktop 1440x900', 'All four', 'Nav pills route and mark current; search (button + Ctrl+K) hands to Dex; Settings only for owner', 'Functional', 'PASS', '0 problems across 4 roles; language switcher shows 3 options', ''),
    ('T-604', 'Global', 'Mobile dock + More', 'Mobile 390x844', 'All four', 'Every dock item and More tile opens a page the role can use', 'Routing', 'PASS', 'Owner 7 tiles, others 2; 0 dead ends', ''),
    ('T-605', 'Global', 'Desktop notification bell', 'Desktop 1440x900', 'All', 'The bell dropdown opens and stays open', 'Functional', 'FAIL', 'Closes itself ~0.4s after opening on Desk, My Work and Team; stays on Finance', 'GL-01'),
    ('T-606', 'Global', 'Mobile notification bell', 'Mobile 375x812', 'Owner', 'The bell dropdown opens on a phone', 'Functional', 'PASS', "Preview: dropdown with 7 items and '28 new'", ''),
    ('T-607', 'Global', 'Mobile reach - non-owners', 'Mobile 390x844', 'Sales / Production / Finance', 'Ops, Team and Settings are reachable on a phone', 'Navigation', 'FAIL', 'More shows only Workflows and Leave; no other link', 'GL-02'),
    ('T-608', 'Global', '/login while signed in', 'Both', 'Owner', 'A signed-in user is taken into the app', 'Routing', 'FAIL', 'Sign-in form shown again', 'GL-03'),
    ('T-620', 'Decision Desk', 'Desk load', 'Both', 'All four', 'The Desk loads with its KPI tiles and sections', 'Functional', 'PASS', 'Owner 53 decisions / 58 on fire; 0 overflow; 0 undersized controls', ''),
    ('T-621', 'Decision Desk', 'Scope pills', 'Desktop 1440x900', 'Owner', 'Company / You switches the score', 'Functional', 'PASS', '19 <-> 4', ''),
    ('T-622', 'Decision Desk', 'Scope pills', 'Mobile 390x844', 'Owner', 'Company / You is available on a phone', 'Missing function', 'FAIL', 'Pills hidden at phone width', 'DD-04'),
    ('T-623', 'Decision Desk', 'KPI tiles', 'Both', 'Owner', 'Every KPI tile opens its page', 'Routing', 'PASS', '6 desktop / 4 mobile tiles, 0 dead ends', ''),
    ('T-624', 'Decision Desk', 'KPI tiles - non-owners', 'Both', 'Sales / Production', 'Money tiles load or are hidden', 'Permissions', 'FAIL', "Net profit and Spend stay '...'; receivables shown", 'DD-03'),
    ('T-625', 'Decision Desk', 'Card action Review', 'Desktop 1440x900', 'Owner', 'Review opens the decision page; Close returns to the Desk', 'Routing', 'PASS', '-> /decisions/<id>; Close -> /inbox (re-checked on a fresh page)', ''),
    ('T-626', 'Decision Desk', 'Approve / Reject / note', 'Both', 'Owner', 'Reject needs a second tap; failures report and keep the page', 'Functional', 'PASS', "Reject warning first; 'Could not reject' / 'Could not approve' / 'Could not post note'; Send note disabled while empty", ''),
    ('T-627', 'Decision Desk', 'Leave approvals', 'Both', 'Owner', 'Approve, Reject and Info each respond', 'Functional', 'PASS', "Approve sends (blocked -> 'Action failed'); Reject and Info open a note with Send / Cancel", ''),
    ('T-628', 'Decision Desk', 'Decision - missing or not yours', 'Both', 'All four', 'The page explains itself and offers a way back', 'Dead end', 'FAIL', "'Access restricted', no controls, Escape and outside tap disabled", 'DD-01'),
    ('T-629', 'Decision Desk', 'Desk - failed load', 'Both', 'Owner', 'A failed board load says so', 'Error handling', 'FAIL', "'Nothing waiting on you' with zeros", 'DD-02'),
    ('T-630', 'Decision Desk', 'Decision - note mic', 'Both', 'Owner', 'The mic records a note', 'Dead control', 'FAIL', 'Toast only', 'DD-05'),
    ('T-640', 'Dex', 'Ask Dex', 'Both', 'All four', 'A failed question is reported in the chat and not left spinning', 'Error handling', 'PASS', "'AI service error. Please try again.'; Clear resets; mic says 'Microphone not available'; /brain?q= asks", ''),
    ('T-641', 'Dex', 'Documents', 'Both', 'All four', 'Documents panel loads; Add is owner-only; empty upload refused; delete asks first', 'Functional', 'PASS', "'No documents in the Brain yet' (preview); add button owner only; submit disabled when empty", ''),
    ('T-642', 'Journal', 'Journal', 'Both', 'Owner', "Views, week navigation, day selection, search and a decision's timeline work", 'Functional', 'PASS', 'Timeline/Calendar views; Aug <-> Sep; timeline dialog with events; no-match copy', ''),
    ('T-643', 'Calendar', 'Calendar', 'Both', 'All four', 'Modes, week navigation and filters work', 'Functional', 'PASS', 'Day/Week; filters change counts (meetings 2, tasks 5, leave 2)', ''),
    ('T-644', 'Calendar', 'Calendar events', 'Both', 'All four', 'An event opens its source', 'Dead end', 'FAIL', 'Events are plain divs; tap does nothing', 'CL-02'),
    ('T-645', 'Notifications', 'Notifications list', 'Both', 'All four', 'The list loads with unread markers', 'Functional', 'PASS', 'Owner 100 / 28 unread; Sales 66', ''),
    ('T-646', 'Notifications', 'Mark all read failure', 'Both', 'All four', 'A failed Mark all read says so', 'Silent failure', 'FAIL', 'No toast, dots unchanged', 'CL-03'),
    ('T-647', 'Settings', 'Settings', 'Both', 'All four', 'Owner tabs open and deep-link; others get Profile + Security; saves report failure', 'Functional', 'PASS', "4 tabs with ?tab=; Business/Operations/Money/Account saves report 'Could not save' etc. (Money re-checked on a fresh page); theme toggles", ''),
    ('T-648', 'Settings', 'Settings add links', 'Desktop 1440x900', 'Owner', 'Controls are at least 24px tall', 'Accessibility', 'FAIL', "'Add operational task' and 'Add approval rule' 20px", 'CL-04'),
    ('T-649', 'People', 'People tabs', 'Both', 'All four', 'Tabs switch; non-managers see a read-only banner', 'Permissions', 'PASS', 'Employees / Buyers / Suppliers; banner names the missing permission', ''),
    ('T-650', 'Global', 'Failed loads - Notifications / People / Journal / Calendar', 'Both', 'Owner', 'Each page says it could not load', 'Error handling', 'FAIL', "'You're all caught up' / 'No team members yet' / header only / all 0", 'CL-01'),
    ('T-670', 'Sign-in', 'Login validation', 'Both', 'Signed out', 'Empty and malformed sign-ins are refused before sending', 'Validation', 'PASS', 'Browser validation on email and password; no request', ''),
    ('T-671', 'Sign-in', 'Login failures', 'Both', 'Signed out', 'A failed sign-in, demo seat or OTP send is reported', 'Error handling', 'PASS', "'Something went wrong. Please try again.' each time; stays on /login", ''),
    ('T-672', 'Sign-in', 'Invite link', 'Both', 'Signed out', 'A bad invite link says it is invalid', 'Error handling', 'PASS', "'This invite link is invalid or has already been used'; no SMS request", ''),
    ('T-673', 'Sign-in', 'Sign-up validation', 'Both', 'Signed out', 'Empty company name is refused before anything is created', 'Validation', 'PASS', "'Tell us your company name', focus moved to the field (preview)", ''),
    ('T-674', 'Sign-in', 'Field labels', 'Both', 'Signed out', 'Every sign-in field is labelled', 'Accessibility', 'FAIL', 'Login, sign-up company name and admin fields unlabelled', 'AU-01'),
    ('T-675', 'Sign-in', 'OTP number', 'Both', 'Signed out', 'An invalid mobile number is refused before sending', 'Validation', 'FAIL', '3-digit number sent', 'AU-02'),
    ('T-126', 'My Work', 'Full control sweep', 'Mobile 390x844 + Desktop 1440x900', 'Owner', 'Every non-destructive control responds without breaking the page (writes blocked)', 'Stability', 'PASS', "Re-run after the drawer repair: mobile 36 controls, 13 clicked, desktop 43 controls, 20 clicked; 0 click failures, 0 overflow, 0 page errors. Console errors were the harness's own blocked writes. An 'overlay not dismissed by Escape' flag did not reproduce - More and the Dex picker both close on Escape", ''),
    ('T-127', 'My Work', 'Bulk-select checkbox', 'Mobile 390x844', 'Owner', 'The checkbox has a 24px tap area and near-misses do not open the task', 'Accessibility', 'FAIL', '16x22 hit area; taps 10px away open the drawer', 'MW-22'),
    ('T-717', 'My Work', 'Approvals - the rule', 'Desktop 1440x900', 'Owner', 'The feed holds only tasks that still need approval and are not finished', 'Data', 'PASS', 'GET /tasks?view=approvals: 7 (6 pending + 1 changes requested), 0 break the rule', 'ASK-28'),
    ('T-718', 'My Work', 'Approvals - one button, with count', 'Desktop 1440x900', 'Owner', 'One Approvals button in the switcher, showing how many wait', 'Views', 'PASS', 'My Tasks | Asked by me | All Tasks | Approvals (6) | Workflows; no duplicate', 'ASK-28'),
    ('T-719', 'My Work', 'Approvals - Tasks tab', 'Desktop 1440x900', 'Owner', 'The Tasks tab is exactly what waits on me, oldest request first', 'Views', 'PASS', '6 cards = 6 pending from the server rule; 14 Aug first, 20 Aug last; tab reads Tasks 6', 'ASK-28'),
    ('T-720', 'My Work', 'Approvals - drawer actions', 'Desktop 1440x900', 'Owner', 'Opening a waiting task offers Approve, Request changes, Ask clarification', 'Flow', 'PASS', 'All three shown; Approve sends POST /tasks/{id}/approve (answered by the test)', 'ASK-28'),
    ('T-721', 'My Work', 'Approvals - notification link', 'Desktop 1440x900', 'Owner', 'An approval-requested notification opens the task inside Approvals', 'Flow', 'PASS', '/my-work?view=approvals&task=<id> shows the Approvals view with the drawer and its approval box', 'ASK-28'),
    ('T-722', 'Decision Desk', 'Task approvals card', 'Desktop 1440x900', 'Owner', 'The Desk card and My Work Approvals count the same thing', 'Data', 'PASS', 'Desk card 6 = Approvals 6 (both read /tasks?view=approvals)', 'ASK-28'),
    ('T-723', 'My Work', 'Approvals - no access', 'Desktop 1440x900', 'Finance', 'Someone who can approve nothing gets no Approvals button and an empty feed', 'Permissions', 'PASS', 'No button; API returns 0', 'ASK-28'),
    ('T-724', 'My Work', 'Approvals - named approver', 'Desktop 1440x900', 'Sales (mocked list)', 'A non-owner named as approver, without approval access, sees the view and can approve', 'Permissions', 'PASS', 'Button with badge 1; card in the Tasks tab; approval box; Approve POST sent (list mocked)', 'ASK-28'),
    ('T-725', 'My Work', 'Approvals - phone link', 'Mobile 390x844', 'Owner', 'A link to Approvals on a phone shows the same tasks', 'Views', 'PASS', '6 / 6 cards; no overflow', 'ASK-28'),
    ('T-708', 'My Work', 'Asked by me - switcher', 'Desktop 1440x900', 'Owner + Sales', 'Asked by me sits in the view switcher for every role', 'Views', 'PASS', 'Owner: My Tasks | Asked by me | All Tasks | Workflows; Sales sees it too', 'ASK-28'),
    ('T-709', 'My Work', 'Asked by me - the rule', 'Desktop 1440x900', 'Owner', 'Only tasks I created that are not mine to do', 'Data', 'PASS', 'GET /tasks?view=asked: 60 tasks, 0 break the rule; 53 open = 53 cards', 'ASK-28'),
    ('T-710', 'My Work', 'Asked by me - filters', 'Desktop 1440x900', 'Owner', 'Person (without Me) and Status narrow the list with matching counts', 'Filters', 'PASS', 'Person -> 9 cards = API 9; Status Overdue 13 = 13 cards', 'ASK-28'),
    ('T-711', 'My Work', 'Asked by me - URL and default', 'Desktop 1440x900', 'Owner', 'View survives refresh, other views clear it, plain /my-work does not reopen on it', 'Flow', 'PASS', '?view=asked kept on reload; My Tasks clears it; not saved as default', 'ASK-28'),
    ('T-712', 'My Work', 'Asked by me - AI priority', 'Desktop 1440x900', 'Owner', "AI priority is not offered on other people's work", 'Views', 'PASS', 'AI toggle hidden on Asked by me', 'ASK-28'),
    ('T-713', 'My Work', 'Asked by me - empty', 'Desktop 1440x900', 'Sales', 'Someone who has asked for nothing sees an explanation, not the decisions text', 'Empty state', 'PASS', "'Nothing you've asked for is open - Tasks you create for other people show up here, with their live status.'", 'ASK-28'),
    ('T-714', 'My Work', 'Asked by me - requester note', 'Desktop 1440x900', 'Sales (mocked list)', 'The person who asked can leave a note but not hand off or escalate', 'Permissions', 'PASS', 'Update form offers only Log note; server allows a note from the creator (unit-tested)', 'ASK-28'),
    ('T-716', 'My Work', 'Asked by me - requester drawer', 'Desktop 1440x900', 'Sales (mocked list)', "The person who asked sees progress and a note box, not the doer's status, plan, complete or attach controls", 'Permissions', 'PASS', "Status, Complete, Attach, Reopen hidden; hint 'You asked for this task, so <doer> does the work. Leave a note below to follow up.'", 'ASK-28'),
    ('T-715', 'My Work', 'Asked by me - phone link', 'Mobile 390x844', 'Owner', 'A link to Asked by me on a phone shows that list, not My Tasks', 'Views', 'PASS', '53 / 53 cards; My Tasks not pressed; no overflow', 'ASK-28'),
    ('T-700', 'My Work', 'New Task - quick part', 'Desktop 1440x900', 'Owner', 'Only title, Department, Assign to and Due show before More options', 'Form', 'PASS', 'Visible: Task title, Department, Assign to, Due; Operational category and Supporting employee gone', 'ASK-29'),
    ('T-701', 'My Work', 'New Task - More options', 'Desktop 1440x900', 'Owner', 'Priority, helpers, description, time, result, approval, proof, files wait under More; closed section says how many are set', 'Form', 'PASS', "Collapsed by default; '5 set' after choosing priority, helper, time, approval, proof", 'ASK-29'),
    ('T-702', 'My Work', 'New Task - title required', 'Desktop 1440x900', 'Owner', 'Create without a title shows an inline error and sends nothing', 'Validation', 'PASS', "'Give the task a title' under the field; clears on typing; no request", 'ASK-29'),
    ('T-703', 'My Work', 'New Task - Assign to', 'Desktop 1440x900', 'Owner', 'One control lists people and teams; a team explains where it goes', 'Form', 'PASS', "12 people + Sales, Production, Finance teams; hint 'Goes to whoever in Sales has the least open work'", 'ASK-29'),
    ('T-704', 'My Work', 'New Task - due presets', 'Desktop 1440x900', 'Owner', 'Today / Tomorrow / In a week set the date without a picker', 'Form', 'PASS', "Tomorrow -> 'Due Tue 15 Sept'; Today -> due_date = today, no time", 'ASK-29'),
    ('T-705', 'My Work', 'New Task - payload (person)', 'Desktop 1440x900', 'Owner', 'The form sends exactly what was chosen and nothing removed', 'Data', 'PASS', 'task_type sales, lead + 1 helper, high, tomorrow 16:30, approval (anyone), proof; no op_category / support_id', 'ASK-29'),
    ('T-706', 'My Work', 'New Task - payload (team)', 'Desktop 1440x900', 'Owner', 'A team task sends the role, no person and no helpers', 'Data', 'PASS', 'assignee_role sales, assignee_id null, co_assignee_ids [], due today', 'ASK-29'),
    ('T-707', 'My Work', 'New Task - after create', 'Desktop 1440x900', 'Owner', 'Dialog closes, reopens empty with More collapsed, My Work still renders', 'Flow', 'PASS', 'Closed; reopened clean; 25 cards; no page errors', 'ASK-29'),
    ('T-690', 'My Work', 'All Tasks - filter row', 'Desktop 1440x900', 'Owner', 'All Tasks shows Department, Person, Status; My Tasks hides Person', 'Filters', 'PASS', 'Row shows all three with counts (131); My Tasks shows two (25)', 'ASK-24'),
    ('T-691', 'My Work', 'All Tasks - Person filter', 'Desktop 1440x900', 'Owner', 'Picking a person shows only their tasks, count matches the API', 'Filters', 'PASS', 'Priya Nair: 29 cards = trigger 29 = API 29; URL ?person=; name line hidden on cards; menu has Me, people busiest first with role, Unassigned (6), Production team (5); no duplicate rows', 'ASK-24'),
    ('T-692', 'My Work', 'All Tasks - Status options', 'Desktop 1440x900', 'Owner', 'Pending Approval, Overdue and Completed are filterable with correct counts', 'Filters', 'PASS', 'Pending Approval 40, Overdue 68, Completed 17, Not Started 78 - all equal the API', 'ASK-24'),
    ('T-693', 'My Work', 'All Tasks - Priority filter removed', 'Desktop + Mobile', 'Owner', 'No Priority filter (founder call 2026-09-13); an old ?priority= link does not narrow the list', 'Filters', 'PASS', 'No Priority dropdown on desktop, no Priority chips in the phone sheet; ?person=Priya&status=overdue&priority=high shows the same 20 as without it', 'ASK-24'),
    ('T-694', 'My Work', 'All Tasks - combined counts', 'Desktop 1440x900', 'Owner', "Each menu's counts reflect the other active filters", 'Filters', 'PASS', "With Priya + Overdue, Department 'All' reads 20 = cards = API", 'ASK-24'),
    ('T-695', 'My Work', 'All Tasks - refresh, Clear, no match', 'Desktop 1440x900', 'Owner', 'Filters survive refresh; Clear resets; empty result explains itself', 'Filters', 'PASS', "Reload keeps 20 cards + URL; Clear -> 131, URL clean; Priya x Under Review -> 'No tasks match these filters' with Clear", 'ASK-24'),
    ('T-696', 'My Work', 'All Tasks - person search, links', 'Desktop 1440x900', 'Owner', 'Search narrows the menu; Desk overdue link and task deep link behave', 'Filters', 'PASS', "'pri' -> Priya Nair only; ?filter=overdue -> Status: Overdue 68; ?task= with filters set clears them and shows the card", 'ASK-24'),
    ('T-697', 'My Work', 'Phone - filter sheet', 'Mobile 390x844', 'Owner', 'The phone reaches every filter and sees what is active', 'Filters', 'PASS', "Sheet with Department / Person / Status; Priya + Overdue -> 'Show 20 tasks' = 20 cards; caption 'Showing Priya Nair - Overdue' with Clear; buttons 44px, reachable; no overflow", 'ASK-24'),
    ('T-698', 'My Work', 'Phone - My Tasks / Status without AI', 'Mobile 390x844', 'Owner', 'Person hidden on My Tasks; a Status filter is visible even with AI priority off', 'Filters', 'PASS', 'Sheet on My Tasks has no Person; ?status=overdue shows the caption', 'ASK-24'),
    ('T-699', 'My Work', 'Sales - no Person filter', 'Desktop + Mobile', 'Sales', 'Roles without All Tasks never see Person; ?person= is ignored', 'Permissions', 'PASS', 'Desktop row has no Person; phone sheet has no Person; ?person=anyone ignored, own 29 cards', 'ASK-24'),
    ('T-680', 'Dex', 'LIVE - receivables question', 'Desktop 1440x900', 'Owner', "Dex answers how much customers owe with the ledger's figure", 'AI accuracy', 'FAIL', 'Said zero invoices / Rs 0 outstanding; ledger has Rs 7,49,000 outstanding (17.0s)', 'DX-01'),
    ('T-681', 'Dex', 'LIVE - what needs my attention', 'Desktop 1440x900', 'Owner', 'Dex surfaces the overdue work and pending decisions', 'AI accuracy', 'FAIL', 'Said nothing open or overdue; owner has 24 open / 6 overdue (24.1s)', 'DX-02'),
    ('T-682', 'Dex', 'LIVE - global search hand-off', 'Desktop 1440x900', 'Owner', 'A question from global search is answered on arrival', 'AI flow', 'PASS', "'Which tasks are overdue?' answered on /brain?q= with a task list (17.5s)", ''),
    ('T-683', 'Ops', 'LIVE - coach refresh', 'Desktop 1440x900', 'Owner', 'Generate coaching produces a review grounded in the stats', 'AI flow', 'PASS', "TEST_member: 'AI coach updated' in 8.7s; strengths / improvements reference the 13 actionable tasks and plan use", ''),
    ('T-684', 'CRM', 'LIVE - Score with AI', 'Desktop 1440x900', 'Owner', 'Rescore updates the relationship card sensibly', 'AI flow', 'PASS', "E2E Test Co: 'Relationship scored by AI' in 7.8s; Relationship 12 / Risk 78, reason cites 4 open complaints and no billing - matches the record", ''),
    ('T-685', 'Finance', 'LIVE - AI analysis refresh', 'Desktop 1440x900', 'Owner', 'Refresh produces an analysis grounded in the ledger', 'AI accuracy', 'PASS', "'Analysis refreshed' in 20.6s; Rs 6.6L outstanding (ledger 6,55,466), Surat Spinners Rs 4.8L unpaid 33 days (correct), duplicates flagged", ''),
    ('T-686', 'Finance', 'LIVE - Ask AI', 'Desktop 1440x900', 'Owner', 'The answer is correct and readable', 'AI accuracy', 'FAIL', 'Correct (Surat Spinners Rs 4,80,000, 7.3s) but literal ** markdown shown', 'FN-12'),
    ('T-688', 'Dex', 'LIVE - owner on a phone', 'Mobile 390x844', 'Owner', 'Dex answers on mobile and the answer fits the screen', 'AI flow', 'PASS', "'53 decisions pending approval across 77' - correct; 17.6s; no overflow", ''),
    ('T-689', 'Dex', 'LIVE - Sales asks money questions', 'Desktop 1440x900', 'Sales', 'Dex refuses finance answers to a role the finance API refuses', 'Permissions', 'PASS', "Receivables and profit questions both refused ('You do not have permission to access financial...'), 5.8s / 1.6s; no figures leaked", ''),
    ('T-687', 'Finance', 'LIVE - bill extraction', 'Desktop 1440x900', 'Owner', 'A GST bill is extracted into a reviewable record with the key fields', 'AI accuracy', 'FAIL', 'Party, number, amount, due date, category and follow-up correct (31.9s, 92%); date, GSTIN, items missing; no stale-date warning. Left in review, not filed', 'FN-13'),
    ('T-676', 'Admin', 'Admin portal gating', 'Both', 'Signed out / Owner', 'Only platform admins reach the portal', 'Permissions', 'PASS', 'Signed out and tenant owner both get the admin sign-in; /admin/me 401; deep link /admin/tenants too', ''),
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
     "Bulk-select checkboxes measure only 16x16, below the 24px tap-target minimum. "
     "[SUPERSEDED 2026-09-13: true when recorded; the card redesign (98b43f4) removed the "
     "padded wrapper - see MW-22.]",
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
    ('N-08', 'Sign-in', "The OTP flow auto-fills a 'Dev OTP' returned by the server - looks like a leaked login code.", 'The server only includes dev_otp when a separate DEV_OTP_IN_RESPONSE flag is on AND no SMS provider is configured (FIX-006-C / S0-04). It cannot happen silently in production.', 'Read services/otp.py:152-163 and config.py:167-170.'),
    ('N-09', 'Decision Desk', 'Sales, Production and Finance see every Desk section at 0 while Ops shows them 20 overdue tasks.', "By design: for non-owners 'On fire' and 'Due today' list work they are waiting on from OTHER people; their own tasks live on My Work (desk.py docstrings).", "Read routers/desk.py:499-601; Priya's overdue tasks appear on /my-work?filter=overdue."),
    ('N-10', 'Admin', 'Is the admin console reachable by a signed-in company owner?', 'No. /admin has its own session; a tenant owner sees the admin sign-in and GET /api/admin/me answers 401.', 'Scripted at 1440 and 390 and checked in the browser preview.'),
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: delete opens an in-app confirm (0->1 dialogs), no native window.confirm.",
        code="pages/Workflows.js:340 (del handler); precedent at pages/MyWork.js:1108",
        dep="", status="Fixed",
    ),
    dict(
        id="ASK-3", section="My Work", item="'+ New Task' placement",
        type="Change request", prio="Medium",
        what="Move New Task below the header and stop rendering it outside the task list "
             "-- it should not appear while the Leave or Workflows view is open.",
        why="Founder: it 'appears all over the place'. Confirmed by MW-11: in the Leave "
            "view New Task is the largest, darkest button on screen, and it creates a "
            "task rather than a leave request.",
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: New Task sits below the heading and above the list.",
        code="pages/MyWork.js:2429-2515 (mywork-controls)",
        dep="MW-11", status="Fixed",
    ),
    dict(
        id="ASK-4", section="Leave", item="Remove per-card 'AI Impact Analysis'",
        type="Change request", prio="Medium",
        what="Remove the AI Impact Analysis button from the individual leave card.",
        why="Founder: impact is not a per-request question. Analysing one request in "
            "isolation cannot answer what actually matters -- what the combined leave "
            "does to cover across the team. Removed now; the global version is ASK-5.",
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: 0 'AI Impact Analysis' buttons remain on Leave.",
        code="pages/Leave.js (leave card actions)",
        dep="", status="Fixed",
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
        what="PARKED - Yogesh is taking this decision himself, later. Do not action it. "
             "The reasoning is written up in full on the 'Notes & Decisions' sheet. "
             "Summary of the recommendation as it stands: founder asked whether this "
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
        dep="ASK-6", status="Deferred - founder",
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
        verified="VERIFIED FIXED 2026-09-13 by re-running the original measurement: all three bulk-bar actions now measure 19.55:1 (was 1.2 and 2.64).",
        code="pages/MyWork.js:918-962 (bulk-action-bar; bulk-reassign :946, "
             "bulk-clear :955); card wording at :195/:207",
        dep="", status="Fixed",
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
             ":102-108 + :1594 (the mobile decision and its reasoning). VERIFIED "
             "FIXED 2026-09-13 (5105ed1): the desktop status dropdown now offers only "
             "Not Started / In Progress / Waiting / Under Review, checked at 1440 and "
             "1920 inside the new task drawer.",
        dep="ASK-9", status="Fixed",
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
    dict(
        id="ASK-13", section="Team", item="Stop showing access on the Team roster",
        type="Change request", prio="High",
        what="Take the access read-out off the Team surface. It appears in three places: "
             "the 'N permissions' line on every card, the 'n of 14 areas' count in the "
             "profile dialog, and the full 'No access to ...' denial list beneath it.",
        why="Founder direction, and the audit found it is also an exposure. Verified "
            "across all four logins: every role can open any colleague's card and read "
            "their complete permission matrix, including everything they are denied. "
            "Only the Edit button is gated; the display is not. See TM-05.",
        code="pages/Team.js:411 + :441 (card), :580-606 (dialog ACCESS block)",
        dep="TM-05", status="To do",
    ),
    dict(
        id="ASK-14", section="Team", item="Redesign the Add team member dialog",
        type="Change request", prio="Medium",
        what="Rework the Add member form. PLAN, in priority order: (1) give all six "
             "fields real associated labels -- see TM-06, worth doing on its own; "
             "(2) stop rendering Name and Email in IBM Plex Mono, which reads as an "
             "identifier rather than a person -- keep mono for IDs and amounts; (3) make "
             "the login-method toggle actually gate its fields, since choosing Password "
             "login still shows 'Mobile number (for OTP login)' -- or rename it 'Primary "
             "sign-in method' and mark mobile always-optional; (4) put the submit in a "
             "sticky footer, because today it is a 66x44px 'Add' at the end of 2.17 "
             "screens of scroll; (5) add three section headers for identity, sign-in, "
             "and placement; (6) collapse the fourteen-checkbox Access grid behind "
             "'Customise access - n of 14 areas', since Role already sets a sensible "
             "default and most additions will not deviate. Together (4) and (6) turn a "
             "two-screen form into roughly one screen for the common case. KEEP the "
             "'This member will see these menus' preview exactly as it is. MODEL TO COPY: CRM's own Add contact dialog already does most of this right -- it fits one screen with no scrolling at all, uses the body face rather than mono, and hides GSTIN and the rest behind a 'More details' disclosure. Team's Add member should look like that dialog, not the other way round.",
        why="Founder review, then measured in the live preview. Dialog is 512x538 with "
            "1163px of content -- 2.17 screens of scroll. All six fields report "
            "labelled:false. Name and Email render in IBM Plex Mono 16px. Password and "
            "mobile fields are both visible at once despite the method toggle. Submit is "
            "66x44px, position:static, at the very bottom. The one thing that is "
            "genuinely strong is the menu preview: it turns fourteen abstract "
            "permissions into what the person will actually see on login, greying out "
            "what they will not get. That is rare and should survive the redesign.",
        code="pages/Team.js:118-196 (member form); placeholder-only inputs at "
             ":120, :121, :129, :132; real labels at :137 and :143",
        dep="", status="To do",
    ),
    dict(
        id="ASK-15", section="Team", item="Gate Edit access on the People permission",
        type="Change request", prio="High",
        what="Show Edit access to holders of the 'people' permission (People / Contacts), "
             "rather than to team_manage alone as it does today.",
        why="Founder direction. Note for whoever picks this up: 'people' is currently "
            "described in the code as opt-in because the contact list is sensitive, and "
            "it is NOT in any role's default set -- so on today's data this would show "
            "the control to nobody but the owner, who passes through the role check "
            "anyway. Worth confirming whether the intent is to REPLACE the team_manage "
            "gate with people, or to allow either.",
        code="pages/Team.js:232 (canManageTeam), :571 (edit-access-<id>); "
             "lib/perms.js:5 (the 'people' key) and :21-23 (why it is opt-in)",
        dep="ASK-13", status="To do",
    ),
    dict(
        id="ASK-16", section="Team", item="Org chart from reporting lines and department",
        type="Future scope", prio="Low",
        what="Render the team as an organisation chart -- grouped by department and wired "
             "by reporting line -- in the style of Microsoft Teams, alongside or instead "
             "of the current flat role groups.",
        why="Founder idea, marked 'if needed'. The data already exists: members carry "
            "reporting_manager_id and a role, and the profile dialog already resolves "
            "and displays 'REPORTS TO'. It also answers TM-03, where the page promises "
            "REPORTING LINES and the roster never shows them. Worth noting before "
            "building: only 1 of 12 members currently has a reporting manager set, so a "
            "chart drawn today would be one line and eleven orphans -- the chart is only "
            "as good as the reporting data behind it. SEQUENCING: do ASK-17 first. "
            "Putting the reporting line on every card is what makes its absence visible "
            "and creates the pressure to fill it in; once most members have a manager, "
            "the chart draws itself. Building the chart first would just render the gap "
            "at a larger size.",
        code="pages/Team.js:475 (manager already resolved); "
             "reporting_manager_id on the user record",
        dep="TM-03", status="Parked - needs design",
    ),
    dict(
        id="ASK-17", section="Team", item="Show the team data that actually answers a question",
        type="Change request", prio="Medium",
        what="Rework what a member card carries. THREE CHANGES. (1) Replace the status "
             "pill: every one of the twelve members reads 'Active', including six "
             "placeholder accounts that have never signed in, so the field distinguishes "
             "nobody. accepted_at and invited_at are both on the record -- show 'Joined "
             "17 Aug' or 'Invited - not yet signed in', which is the question an owner "
             "actually has. (2) Put the reporting line where the permission count is: "
             "'6 permissions' is a number nobody can act on, and per ASK-13 access "
             "should not be on the roster at all, while the page header promises "
             "REPORTING LINES and never delivers them. (3) Surface the invite blocker: "
             "only 4 of 12 members have a phone, and for the other 8 the Get invite link "
             "button simply does not render with no explanation -- say 'No mobile - "
             "cannot send invite' on the card so the owner can fix it.",
        why="The API already returns fourteen fields per member and the card uses four "
            "of them, two of which say nothing. reporting_manager_id, phone, "
            "passwordless, invited_at and accepted_at are all available and all unused. "
            "Also worth revisiting the grouping: twelve people across five roles gives "
            "five sections, several holding a single card, with the Owner row leaving "
            "two thirds of its width empty (TM-02). Under about thirty people a single "
            "sorted list with the role as a chip would scan better; group by department "
            "once the org chart exists.",
        code="pages/Team.js:411 (accessLabel), :417-450 (card), :475 (manager already "
             "resolved); the user record carries invited_at, accepted_at, phone, "
             "passwordless",
        dep="ASK-13, TM-02, TM-03", status="To do",
    ),
    dict(
        id="ASK-18", section="CRM", item="Iterate the 'In progress' / task listing",
        type="Change request", prio="Medium",
        what="Rework the In progress list on the contact profile. FIVE THINGS. "
             "(1) Fix the 'Due undefined' leak first -- that is CR-08 and it is visible "
             "to customers. (2) The list silently mixes two different kinds of thing: "
             "workflows, whose second line is a STAGE ('Delivered', 'In transit', "
             "'Ordered'), and pending deliveries, whose second line is a DATE AND "
             "AMOUNT. They share identical typography with nothing separating them, so "
             "the reader has to infer which is which from the shape of the text. Split "
             "them into labelled groups, or give each row a type marker. (3) Titles are "
             "not doing their job -- three rows read simply 'sale', which identifies "
             "nothing when there are three of them; fall back to something "
             "distinguishing (the order, the amount, the date) rather than the bare "
             "record type. (4) A row showing stage 'Delivered' sits under a heading "
             "that says In progress, which contradicts itself -- either exclude "
             "terminal stages or rename the group to something like 'Open with them'. "
             "(5) Nothing in the list is tappable: these are plain list items, so a "
             "user who sees an order they care about cannot open it. Make each row "
             "navigate to its workflow or delivery.",
        why="Founder review of the In progress card. Everything above is visible in one "
            "screenshot of five rows, which is the tell -- a list this short should not "
            "have this many ways to confuse. The underlying data is fine; it is the "
            "presentation layer that needs the pass.",
        code="pages/mobile/ContactProfileMobile.jsx:199-222 (the In progress accordion)",
        dep="CR-08", status="To do",
    ),
    dict(
        id="ASK-19", section="Ops", item="Rework the operating score around what an SME owner asks",
        type="Product decision", prio="High",
        what="The four legs answer 'how tidy is the workspace', not 'how is the "
             "business doing'. PROPOSED SET, with the reasoning. (1) CASH, heaviest "
             "weight: collection rate plus receivables ageing. For an India-first SME "
             "this is the question -- am I getting paid -- and half of it already "
             "exists as the finance leg. (2) EXECUTION, rewritten as a rate over a "
             "window: work completed in the last 30 days against work created, plus the "
             "median age of what is still open. The current all-time completion ratio "
             "can only fall. (3) CUSTOMER: complaints per active customer and time to "
             "first response -- rates, so they survive growth. (4) DECISION VELOCITY: "
             "median time from a decision being raised to it being settled, and the "
             "share still pending past a threshold. That is the honest name for what "
             "the Sales leg already computes, and for a product called a decision OS it "
             "may be the most defensible metric on the page. Add a real SALES leg only "
             "if wanted -- invoices already carry revenue this period against last. "
             "MECHANICS that matter as much as the choice of legs: score every leg as a "
             "bounded rate so it always has somewhere to move (OP-03); count lateness "
             "once (OP-05); use rates not fixed point-costs so the score means the same "
             "at any size (OP-06); apply the rolling window the UI already claims "
             "(OP-01); and show 'not enough data yet' instead of a defaulted 70 "
             "(OP-07).",
        why="Founder asked whether the KPIs are the right ones. Measured against live "
            "data the answer is that the model is well built but measuring the wrong "
            "things: overall 19 out of 100, with two of the four legs pinned at the "
            "floor and giving no feedback, one leg labelled Sales that contains no "
            "sales, and a caption promising a 30-day window that is never applied. An "
            "owner following the page's own advice to the letter would watch the score "
            "not move. Worth saying what is good, because it should survive any "
            "rewrite: the weights renormalise correctly when a leg is unavailable, the "
            "finance leg correctly counts only inbound payments, the next-move list is "
            "derived from real figures, and somebody deliberately removed fabricated "
            "'+6 pts' lift estimates because the score has no history to justify them. "
            "That is the right instinct, and it is the same instinct that should now "
            "drive giving the score a time window so it can have a history at all.",
        code="services/operating_score.py (the whole model); "
             "pages/OperatingScore.js (cards, captions, delta chip)",
        dep="OP-01, OP-03, OP-04, OP-05, OP-06, OP-07", status="To do",
    ),
    dict(
        id='ASK-20',
        section='Global',
        item='One load-error pattern for every page (root cause 1 of 3)',
        type='Change request',
        prio='High',
        what="Build ONE shared <QueryError> (message + Retry) and use it wherever a query's data drives the page. It must branch on the failure: 403 -> 'You don't have access to this' (with who to ask), 404 -> 'This no longer exists' (with a way back), network / 5xx -> 'Couldn't load - Retry'. While loading or failed, counts show '-', never 0. Rule for code review: a page may not render its empty state unless the query SUCCEEDED with zero rows.",
        why="The audit found the same fault on every major page: the page reads only data / isLoading, so a failed request falls through to the empty state or an endless skeleton. An owner on a weak connection is told 'Nothing waiting on you' (DD-02), 'No expenses yet' (FN-09), 'You're all caught up' (CL-01), or watches a skeleton that never ends (OP-10, CR-10). A missing decision traps the user with no way out (DD-01). Staff refused by the ledger see fake empty books (FN-07, DD-03). Fixing it once, in one component, closes nine findings.",
        code='pages/Desk.js:284-292, pages/OperatingScore.js:85-92, pages/CRM.js:524-527, pages/Ledger.js:1522-1527, pages/ContactProfile.js:151-160, components/DecisionDialog.js:188-218, pages/Notifications.js, pages/People.js, pages/Journal.js, pages/Calendar.js; pattern to copy: pages/WorkCoach.js:36-57',
        dep='OP-10, CR-10, CR-11, FN-07, FN-09, DD-01, DD-02, DD-03, CL-01',
        status='To do',
    ),
    dict(
        id='ASK-21',
        section='Global',
        item='One permission map for route, nav and API (root cause 2 of 3)',
        type='Change request',
        prio='High',
        what="Define each surface's access rule ONCE - e.g. finance: needs 'finance' or 'ledger'; crm: needs 'people'; ops: everyone (self view); team: everyone (read-only without team_manage) - and have App.js routes, Layout.js nav pills, AllAppsPanel.jsx tiles, the Desk's KPI tiles and the backend require_* guards all read from it. Add a test that walks every role x route and fails if the page opens while its data 403s, or if a nav/tile/link points at a page the role is refused. Decide separately whether data_input-only users get a capture-only Finance.",
        why="The rules have drifted apart in five places. The Finance route admits data_input but its API needs ledger/finance, so Sales and Production open an empty Finance (FN-07). /crm/outstanding checks nothing and serves per-customer money totals to any signed-in user (CR-12). The Desk links non-CRM roles to Access Denied (CR-13) and fetches ledger data it is refused (DD-03). The mobile More panel hides Ops, Team and Settings that the routes allow (GL-02). Every colleague can read every other colleague's access matrix (TM-05). Each fix done alone will drift again.",
        code='App.js:187-254 (Protected perms), components/Layout.js:58-84 (nav perms), components/mobile/AllAppsPanel.jsx:54-128 (tile filters), pages/Desk.js:563-661, lib/perms.js, routers/ledger.py:619-625, routers/crm.py:37-38, routers/finance.py',
        dep='FN-07, CR-12, CR-13, DD-03, GL-02, TM-05; ASK-13, ASK-15',
        status='To do',
    ),
    dict(
        id='ASK-22',
        section='Global',
        item='Phone parity: no desktop-only actions (root cause 3 of 3)',
        type='Change request',
        prio='High',
        what="Adopt a rule: any action available on desktop must have a reachable, tappable (24px+) equivalent below lg, or be deliberately marked desktop-only in the code. Audit every 'hidden lg:*' / 'lg:block' control against it. Immediate cases: Add income / expense / asset / inventory on Finance (FN-08), the CRM add menu and filter (CR-04, CR-05), Score with AI on the contact profile (CR-09), Company / You on the Desk (DD-04), Ops / Team / Settings for staff (GL-02), and a 44px bulk-select checkbox that does not open the task on a near-miss (MW-22).",
        why="DecisionOS is used from the owner's phone first, yet six findings are actions that exist on desktop and vanish, clip or shrink on a phone - most often because a control was wrapped in 'hidden lg:block' with no mobile placement. A cash expense with no bill cannot be recorded from a phone at all (FN-08).",
        code='pages/Ledger.js:1422-1437, :1630; pages/CRM.js (mobile add + filter); pages/mobile/ContactProfileMobile.jsx; pages/Desk.js:426, :470; components/mobile/AllAppsPanel.jsx; pages/MyWork.js (bulk-select checkbox)',
        dep='FN-08, CR-04, CR-05, CR-09, DD-04, GL-02, MW-22',
        status='To do',
    ),
    dict(
        id='ASK-23',
        section='Dex',
        item='Dex answers what it is asked - taken over by Yokesh',
        type='Change request',
        prio='High',
        what="OWNER: YOKESH - all Dex issues are taken over by him (founder call, 2026-09-13); do not action them outside his work. SCOPE, from the live AI runs: (1) DX-01 - money questions answered with zeros: the planner's question words ('owe', 'receivable') are applied as an invoice-name filter, so 'How much do customers owe us?' returns Rs 0 against a real Rs 7,49,000. Only filter by keywords that match real records, extend the stop-word list, and never answer 'zero' from an empty filtered set when the collection has rows. (2) DX-02 - 'What needs my attention today?' (Dex's own first suggestion) reads 'today' as a created/due-today filter and 'todo' as an exact status, so it tells the owner nothing is open or overdue while 24 are open and 6 overdue. Serve it from the Desk's counters (decisions, on fire, overdue, receivables). (3) DD-05 - the decision-note mic only toasts 'Voice capture is available from the Dex panel'; wire it to Dex capture or remove it. ACCEPTANCE: re-run backend/scripts/ux_ai_live_0913.py - both questions must match the ledger / task counts, and the Sales refusal must still hold.",
        why="Dex is the product's answer surface; an owner who asks it the two most basic questions gets confident, wrong answers with KPI tiles reading Rs 0. What already works and must survive: numbers are computed in code, not by the model; Sales is refused money questions; mobile answers render; global search hands off. Finance AI (analysis + ask), coach, rescore and extraction were checked separately and are NOT in this ask.",
        code='routers/brain.py:127-187 (_plan, _refine_plan, _KW_STOP, _rx), :241-309 (_retrieve), :463-478 (_compute_tasks), :836-843; components/DecisionDialog.js:421-445 (note mic)',
        dep='DX-01, DX-02, DD-05',
        status='Assigned - Yokesh',
    ),
    dict(
        id='ASK-24',
        section='My Work',
        item='All Tasks: add a Person filter and complete the filter row (options + UI)',
        type='Change request',
        prio='High',
        what="UPDATE 2026-09-13: the Priority filter was REMOVED on a founder call after it shipped - the AI-priority view already splits tasks into High / Medium / Low, so the row is Department, Person, Status. Old ?priority= links are ignored.\nBUILT 2026-09-13 - pages/MyWork.js; acceptance 33/33 PASS on desktop 1440 + phone 390, owner and Sales, writes blocked (backend/scripts/ux_person_filter_0913.py, .audit-artifacts/ask24_person_filter/). Notes on the build: Department stays in the saved per-user prefs rather than the URL (it already persisted there); a saved Completed tab and the Desk ?filter=overdue|completed links now convert to the visible Status filter; people who share a display name carry their email handle so the menu can tell them apart; opening a task by link clears filters that would hide it; dismissing AI priority no longer clears Status.\nFounder request 2026-09-13, tracked here for traction. On My Work > All Tasks (desktop and phone):\n(1) PERSON filter - a new 'Person: All' dropdown between Department and Status, same pill as the others. Shown only on All Tasks (on My Tasks every card is yours). Options, each with an open-task count: 'All people'; 'Me'; every person who holds work in the list, busiest first, with their role under the name (e.g. Priya Nair - Sales); 'Unassigned'; and a 'Teams' group for tasks given to a role with no person (the cards' 'Sales team' line). Names come from /users, already loaded as members. With more than 8 people, a type-to-search box sits at the top of the menu.\n(2) COMPLETE STATUS OPTIONS - add 'Pending Approval' (status blocked - the grey chip on most cards, which cannot be filtered today) and 'Overdue' (the orange chip; a lens like Completed). Order: All statuses, Not Started, In Progress, Waiting, Pending Approval, Under Review, Overdue, Completed. Show counts like Department does.\n(3) PRIORITY dropdown - the ASK-13 comment says Priority was added, but only Department and Status render. Add 'Priority: All / High / Medium / Low' with counts.\n(4) FILTERS COMBINE - Department x Person x Priority x Status apply together, and every count in every menu reflects the OTHER active filters (today Department counts ignore Status).\n(5) FILTER UI - a filter that is not 'All' shows as pressed (kr-pressed) so the reader can see the list is narrowed; a 'Clear filters' text button appears at the end of the row only when one or more is set; when nothing matches, show 'No tasks match these filters' with Clear, not the 'Tasks appear here once decisions are approved' empty state; filters live in the URL (?person=&dept=&priority=&status=) so they survive a refresh and a Team or Desk link can open one person's tasks; changing a filter clears bulk selection (it resets only on scope/tab/view today); with Person set, cards drop the assignee line, as KM-30 drops the status chip.\n(6) PHONE (ASK-22) - the filter circle on the phone opens the same four filters (a bottom sheet with four sections, or grouped menu sections), and the caption row names what is active, e.g. 'Priya Nair - Overdue'.\nACCEPTANCE: as owner on All Tasks, pick Priya Nair -> only her cards, and the trigger count equals the cards shown; add Status Overdue -> only her overdue cards; Unassigned and a Team entry work; refresh keeps the filters; Clear resets all four; My Tasks hides Person; the same on a 390px phone; Sales / Production (no All Tasks) never see Person.",
        why="With 131 tasks under 'Department: All 131', the owner cannot see one person's load - who is overdue, what is waiting on whom - without reading the name line on every card. The two chips that fill the screen, Pending Approval and Overdue, are not filter options at all, and the Priority filter the code comments promise is missing. This is the owner's daily review of the team.",
        code='pages/MyWork.js:2042-2075 (FilterDropdown), :2150-2157 (STATUS_FILTER_OPTIONS), :2216 (statusFilter), :2240 (selection reset), :2251-2262 (scope, /users members), :2308-2343 (list filtering), :2403-2410 (departmentOptions, mobile tabs), :2514-2530 (phone filter menu), :2756-2781 (desktop filter row), :2802-2811 (empty state), :100-122 (STATUS_LABEL, isOverdue); routers/team.py:130 (/users)',
        dep='ASK-13, ASK-22, MW-19, KM-30',
        status='Fixed',
    ),
    dict(
        id='ASK-25',
        section='My Work',
        item="My Work cards on the founder's reference, and profile photos from Team",
        type='Change request',
        prio='Medium',
        what="Registered after the fact: shipped in 513b9f0 (Chinmay sai, 2026-09-13) without a tracker row. Priority is the card's left stripe (red/blue/grey), status is a tinted pill with a progress ring, due date is a pill top-right, assignees are faces bottom-right (two, then +N). Team gets a profile photo (POST/DELETE /api/users/{id}/avatar; JPG/PNG/WebP by magic bytes, 2MB). VERIFY: the author's note says it was checked against a mocked database only, not a live backend.",
        why="Cards were 121-139px and carried a 'Medium' chip on almost every task; faces make ownership readable at a glance.",
        code='pages/MyWork.js (TaskCard face, STATUS_TONE, StatusRing), components/karma/PersonAvatar.jsx, pages/Team.js (AvatarEditor), routers/team.py (avatar), routers/files.py',
        dep='ASK-19, ASK-26',
        status='Fixed',
    ),
    dict(
        id='ASK-26',
        section='My Work',
        item='More than one person on a task (lead + helpers)',
        type='Change request',
        prio='Medium',
        what="Registered after the fact: shipped in e47fea6 (Chinmay sai, 2026-09-13) without a tracker row. assignee_id stays the lead; co_assignee_ids (max 10) are helpers. Helpers see the task in My Tasks, count in the Person filter and Desk delayed count, get approve/reject/comment alerts, and are removed on deprovision. Only owner, team manager, creator or lead may change the list. VERIFY: the author's note says it was checked against a mocked database only, not a live backend.",
        why='Small-business work is often done by two or three people; before, only one could be named.',
        code='routers/tasks.py (create/update/reassign), services/tasks.py (clean_co_assignees, assignee_ids_of), routers/desk.py, routers/brief.py, services/deprovisioning.py, pages/Tasks.js, pages/MyWork.js (AssigneesEditor)',
        dep='ASK-25',
        status='Fixed',
    ),
    dict(
        id='ASK-27',
        section='Decision Desk',
        item='Decision Desk redesign: decisions only, approvals card, access-based sections and KPIs',
        type='Change request',
        prio='High',
        what='Brief: https://claude.ai/code/artifact/2bc9f47e-3a01-470f-bea5-1069f290a596. Decisions box shows only decisions (decisions_approve); task approvals become a card with count + top 3; leave becomes a chip; On fire and Due today show top 3 and link to My Work filtered; Important box removed; money tiles only for owner and finance/ledger; each section shown only to people who can act on it.',
        why="The Desk is the owner's first screen of the day. Today it shows 111 items in four boxes, one of which can never fill, and sends company money figures to every role.",
        code='pages/Desk.js, pages/desk/useDeskMetrics.js, routers/desk.py (/desk/summary gating, task approvals feed)',
        dep='ASK-20, ASK-21, ASK-28, DD-02, DD-03, CR-13',
        status='To do',
    ),
    dict(
        id='ASK-28',
        section='My Work',
        item='Task views: Asked by me, Waiting for my approval, My team, links always land',
        type='Change request',
        prio='High',
        what='PROGRESS 2026-09-14 - TK-02 Waiting for my approval BUILT (desktop), merged into the Approvals view that 3c23e49 added to My Work: GET /tasks?view=approvals (approval required, not approved, not finished; owner sees all, a named approver sees tasks naming them, an Approve Tasks holder also sees tasks naming nobody - the same rule as _can_approve_task) now feeds that view's Tasks tab AND the Desk's Task approvals card (both read /tasks?mine=false before, which for a non-owner is their own lane only, so a named approver outside it saw nothing). The Approvals button carries the pending count and also shows for a named approver without approval access; list is oldest first; the approval-requested notification opens /my-work?view=approvals&task=<id> inside Approvals. Acceptance 21/21 (backend/scripts/ux_task_approvals_0914.py, writes blocked, Approve answered by the script) + 8 unit tests (backend/tests/test_task_view_approvals.py). NOT proven live: a non-owner approver approving a real task - no demo user holds approval access or is named on a task, so that path was checked with a mocked list.\nPROGRESS 2026-09-14 - TK-01 Asked by me BUILT (desktop): GET /tasks?view=asked (created by me, not mine to do: I am neither the doer nor a helper); My Work switcher gets Asked by me (owner: My Tasks | Asked by me | All Tasks; staff: My Work | Asked by me), kept in the URL (?view=asked) and never saved as the default; Department, Person (no Me option) and Status filters work on it; AI priority is off there; its own empty state; the person who asked can leave a note on the task (server + form), hand-off and escalate stay with the doer; a phone link lands on the list. Acceptance 20/20 (backend/scripts/ux_task_asked_0914.py, writes blocked) + 13 unit tests (backend/tests/test_task_view_asked.py). NOT proven live: a non-owner creating a task and then seeing it - no non-owner in the demo company has created one, and creating one writes to the production database; the note-only form was checked with a mocked list. TK-02..TK-04 still to do.\nPlan: docs/TASK_MANAGEMENT_PLAN.md Phase 1; checklist: https://claude.ai/code/artifact/53a2b23e-66a5-4eeb-bfb3-52a87ce08043. TK-01 Asked by me (tasks I created for others). TK-02 Waiting for my approval (named approver, or anyone with approvals when none is named). TK-03 My team (doer or helper reports to me, via reporting_manager_id). TK-04 /my-work?task= opens the task even when it is not in the current view.',
        why='My Work lists only tasks assigned to you. A non-owner creator loses the task on Create, a non-owner approver cannot reach Approve, a supporting employee never sees it, and managers cannot see their team.',
        code='routers/tasks.py (list_tasks view=), pages/MyWork.js (view switcher, focus task), lib/notif.js',
        dep='ASK-26, ASK-27, ASK-29',
        status='To do',
    ),
    dict(
        id='ASK-29',
        section='My Work',
        item='New Task form: what, department, who, when - the rest under More options',
        type='Change request',
        prio='High',
        what="BUILT 2026-09-14, desktop; acceptance 16/16 PASS (backend/scripts/ux_newtask_form_0914.py, writes blocked, POST /api/tasks answered by the script so the payload is checked). Quick part: title (inline error), Department (the task's own department, kept on founder call - a sales task can be given to anyone in a small company and still counts as Sales; it feeds the Department filter), one Assign to control (people, or a team routed to its least busy member), Due presets No date / Today / Tomorrow / In a week / Pick a date. More options (collapsed, shows how many are set): priority, helpers, description, due time, expected result, needs approval + approver, needs proof, reference files. Removed: Operational category (stored, never read) and Supporting employee (never shown or notified). Opens on the Department My Work is filtered to. Also fixed: a date-only due date counted as overdue from 05:30 IST on its own day (isOverdue compared a UTC midnight); it now compares calendar days. PHONE: same component renders full-screen; its layout pass is the next step.",
        why="15 fields up front for a task that is usually 'Ravi, call Krishna Garments by Friday'. Two fields did nothing, and staff skip heavy forms and go back to WhatsApp.",
        code='pages/Tasks.js (NewTaskDialog, EMPTY_FORM, DUE_PRESETS), pages/MyWork.js (isOverdue, defaultType)',
        dep='ASK-26, ASK-28',
        status='Fixed',
    ),
]

# ---------------------------------------------------------------------------
# 6. NOTES & DECISIONS -- the reasoning behind parked calls, written to be
#    picked up cold weeks later
# ---------------------------------------------------------------------------
NOTES = [
    ("HEAD", "ASK numbers in commit messages do not match this workbook"),
    ("META", "Found 2026-09-13 while verifying the 9 commits pulled that day. No "
             "decision needed - a bookkeeping hazard to fix before it causes a wrong "
             "status change."),
    ("", ""),
    ("Q", "WHAT HAPPENED"),
    ("", "Only 5105ed1 (ASK-11) uses this workbook's numbering. The other commits label "
         "their work ASK-13, ASK-14, ASK-15, ASK-16 and ASK-17, but in this workbook "
         "those IDs are TEAM asks (stop showing access, redesign Add member, gate Edit "
         "access, org chart, member card data). The commits are all My Work / Workflows "
         "changes - uniform grid and dropdowns, the segmented slider, the task drawer, "
         "the Workflows board, the drawer close tab - taken from a different list of "
         "founder asks."),
    ("So", "The Team asks ASK-13 to ASK-17 are still To do; nothing in those commits "
           "touches Team.js. Anyone matching commits to this sheet by ID would wrongly "
           "close five Team items."),
    ("Suggest", "Use this workbook as the one numbering source, or prefix the other "
                "list (e.g. FA-13) so the two cannot collide."),
    ("Dex owner", "Founder call 2026-09-13: every Dex issue (DX-01, DX-02, DD-05 and anything "
                  "found later in Dex) is taken over by Yokesh - tracked as ASK-23 with status "
                  "'Assigned - Yokesh'. Do not work on them outside his work; Finance AI, coach, "
                  "rescore and extraction are not part of that hand-over."),
    ("ASK clash 14 Sep (2)", "Commit 3c23e49 (Decision Desk redesign + Approvals inside My Work) says ASK-25, "
                             "but this workbook uses ASK-25 for the My Work cards + photos (513b9f0). The Desk "
                             "redesign is ASK-27 here; the Approvals view it added is where ASK-28 TK-02 now lives."),
    ("ASK clash 14 Sep", "Commit 5096520 (task drawer rebuilt, activity timeline, grayscale My Work) and its code "
                         "comments say ASK-27..ASK-31, but this workbook already uses ASK-27 = Decision Desk redesign, "
                         "ASK-28 = task views, ASK-29 = New Task form (9b88efc). Those comments do NOT refer to these "
                         "rows. The drawer/timeline work has no row of its own yet; give it the next free number."),
    ("Update", "Still happening. Later commits label ASK-18 (Workflows well), ASK-19 (card "
               "summary), ASK-20 (My Work scroll) and ASK-21 (New Task dialog) from the other "
               "list. In this workbook ASK-18 is the CRM In-progress list, ASK-19 the operating "
               "score KPIs, and ASK-20 / ASK-21 / ASK-22 are the three root causes from the "
               "full audit (load errors, permission map, phone parity). Match commits to this "
               "sheet by content, not by number."),
    ("", ""),
    ("HEAD", "Leave approvals: who approves, and is the Settings screen needed?"),
    ("META", "Raised 2026-09-12 by Yogesh - Owner. Status: DEFERRED, Yogesh deciding. "
             "Relates to ASK-8. Nothing is to be built from this note until that call "
             "is made."),
    ("", ""),

    ("Q", "THE QUESTION"),
    ("", "Leave approval is mostly done by either the owner or a manager. The approver "
         "is already chosen when a team member is added. So does the 'Leave Approvers by "
         "Department' settings screen need to exist at all?"),
    ("", ""),

    ("Q", "HOW APPROVAL IS DECIDED TODAY"),
    ("", "When someone requests leave the system asks three questions IN ORDER and stops "
         "at the first that answers. The code is services/leave.py, "
         "_resolve_leave_approver."),
    ("Tier 1", "Does this person have a Reporting Manager? If yes, that manager approves. "
               "The Reporting Manager is chosen in Team when the member is added or "
               "edited (pages/Team.js:144, the member-manager-select dropdown; stored as "
               "reporting_manager_id)."),
    ("Tier 2", "Otherwise: is there a department rule for their role? If yes, that person "
               "approves. THIS IS THE SETTINGS SCREEN under discussion - the gear in the "
               "Leave section, which opens 'Leave Approvers by Department' with one "
               "dropdown per department and a Save button."),
    ("Tier 3", "Otherwise the Owner approves."),
    ("", ""),

    ("Q", "WHAT THE LIVE DATA SHOWS"),
    ("", "Measured against the dev workspace on 2026-09-12, not assumed:"),
    ("Members", "12 team members in the workspace."),
    ("Tier 1 used", "1 member has a Reporting Manager set (sai, finance)."),
    ("Tier 2 used", "0. The tenant leave_approvers mapping is EMPTY - every department "
                    "reads 'Owner (default)'."),
    ("Tier 3 used", "11 of 12 members fall through to the Owner, Rajesh Sharma."),
    ("So", "The Settings screen currently decides leave for NOBODY. It configures a tier "
           "that no request reaches."),
    ("", ""),

    ("Q", "WHAT THE THREE PIECES ARE"),
    ("", "They are three layers of one feature. Removing one without the others leaves "
         "either a screen that cannot save or an endpoint nothing calls."),
    ("The gear", "The small round icon beside the My Leave / Approvals tabs. It is the "
                 "only way into the screen. pages/Leave.js:500-510."),
    ("The panel", "'Leave Approvers by Department' - a dropdown per department plus a "
                  "Save approvers button. pages/Leave.js:387-417."),
    ("The endpoint", "PATCH /tenant/leave-approvers, which writes the leave_approvers "
                     "field on the tenant record. routers/calendar.py:24."),
    ("", ""),

    ("Q", "OPTION A - DELETE TIER 2  (the current recommendation)"),
    ("What changes", "Remove the gear, the panel and the endpoint. Approval becomes: "
                     "reporting manager, else owner."),
    ("Effect today", "NONE. Every one of the 12 members resolves to exactly the same "
                     "approver before and after, because nothing uses tier 2."),
    ("Argument for", "The approver is already chosen once, in Team, when the person is "
                     "added. A second screen expressing the same decision in different "
                     "words - and silently losing to the first one - mostly creates the "
                     "chance for the two to disagree with the org chart."),
    ("", ""),

    ("Q", "OPTION B - KEEP TIER 2"),
    ("What it buys", "One place to say 'all Sales leave goes to Priya' without making "
                     "Priya anyone's reporting manager."),
    ("Cost of A", "To get that same outcome after deleting, Priya would have to be set "
                  "as the reporting manager of each Sales person individually, in Team."),
    ("If kept", "Then the fix is not to move it into Settings but to make it visible - "
                "today it is hidden behind an unlabelled gear inside a work surface, "
                "which is why it has stayed empty."),
    ("", ""),

    ("Q", "THE ONE QUESTION THAT DECIDES IT"),
    ("", "Is 'who approves your leave' always the same person as 'who you report to'?"),
    ("Yes", "They are always the same -> Option A. Tier 2 is pure duplication."),
    ("No", "They can differ - for example a department lead signs off leave while people "
           "report to a project manager -> Option B, and the work is to surface the "
           "screen properly rather than hide it."),
    ("Read", "For an SME the answer is usually yes, which is why A is the standing "
             "recommendation - but this is a business call, not a technical one, which "
             "is why it is parked rather than filed as a defect."),
    ("", ""),

    ("Q", "IF OPTION A IS CHOSEN, THE WORK IS"),
    ("1", "Delete the gear and the settings tab from pages/Leave.js (:500-510)."),
    ("2", "Delete the LeaveApproverConfig block from pages/Leave.js (:387-417)."),
    ("3", "Delete PATCH /tenant/leave-approvers from routers/calendar.py (:24) and the "
          "LeaveApproverMapInput model."),
    ("4", "Drop the tier-2 lookup from _resolve_leave_approver in services/leave.py, "
          "leaving reporting manager then owner."),
    ("5", "Leave the leave_approvers field on existing tenant records alone, or clear it "
          "in the migration - it is empty in practice either way."),
    ("6", "Make sure Team makes the consequence visible: the Reporting Manager dropdown "
          "should say that this person also approves their leave, since after this "
          "change that is the only place the decision is made."),
    ("Note", "This depends on ASK-6. If Leave moves into Team first, the gear disappears "
             "with it and steps 1 and 2 become part of that move rather than separate "
             "work."),
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
    ("Action List", "Everything to be done in one list - the founder's change asks first, "
                    "then every defect by severity."),
    ("Notes & Decisions", "The reasoning behind calls that were parked rather than taken, "
                          "written so they can be picked up cold weeks later."),
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
         f["cause"], f["fix"], f["code"], f["found"], f.get("verified", "")]
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

    # ---- Notes & Decisions: reasoning for calls that were parked ----
    wsn = wb.create_sheet("Notes & Decisions")
    wsn.column_dimensions["A"].width = 16
    wsn.column_dimensions["B"].width = 116
    for key, body in NOTES:
        wsn.append(["" if key in ("HEAD", "META", "Q", "") else key, body])
        r = wsn.max_row
        a, bcell = wsn.cell(row=r, column=1), wsn.cell(row=r, column=2)
        a.alignment = Alignment(vertical="top")
        bcell.alignment = Alignment(vertical="top", wrap_text=True)
        if key == "HEAD":
            bcell.font = Font(bold=True, size=13, color=INK)
            wsn.row_dimensions[r].height = 24
        elif key == "META":
            bcell.font = Font(italic=True, size=10, color="6B7280")
            wsn.row_dimensions[r].height = 30
        elif key == "Q":
            bcell.font = Font(bold=True, size=11, color=INK)
            bcell.fill = PatternFill("solid", fgColor="EFEFEF")
            a.fill = PatternFill("solid", fgColor="EFEFEF")
            wsn.row_dimensions[r].height = 20
        else:
            a.font = Font(bold=True, size=10, color=INK)
            bcell.font = Font(size=10, color=INK)
            if body and len(body) > 105:
                wsn.row_dimensions[r].height = 15 * (len(body) // 105 + 1)
    wsn.freeze_panes = "A2"

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

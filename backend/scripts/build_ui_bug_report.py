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
        found="2026-09-12",
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
        viewport="Mobile + Desktop", persona="Owner", severity="Nit", status="Open",
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
        code="pages/Team.js:497-535 (profile dialog header)",
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
     "Every control in the dialog is distinguishable by name", "Accessibility", "FAIL",
     "Two visible buttons both named 'Close'", "TM-04"),
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
]

# ---------------------------------------------------------------------------
# 6. NOTES & DECISIONS -- the reasoning behind parked calls, written to be
#    picked up cold weeks later
# ---------------------------------------------------------------------------
NOTES = [
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

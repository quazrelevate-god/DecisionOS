# DecisionOS Mobile — Next Screens & Bug Fixes Prompt

You are continuing work on a **Flutter mobile app** in the `mobile/` folder of the DecisionOS project. Three screens are already built: **Desk**, **Work**, and **Ops**. Your job now is to fix two bugs, learn the app's real feature surface from the web frontend, connect the app to the backend, and build every remaining screen at the same design quality.

**Hard rules:**
- Edit ONLY files inside `mobile/`. Never touch `frontend/`, `backend/`, or any other folder.
- Do not restart from scratch — extend what exists: the theme in `mobile/lib/theme/app_theme.dart`, the shared widgets in `mobile/lib/widgets/`, and the shell in `mobile/lib/main.dart` are the source of truth for styling.
- Match the existing screen layout style (warm cream background, floating pill bottom nav, `SoftCard` for every card, `PillChip` for filters, `_ViewAll` and `StatusPill` patterns, Inter type scale via `AppText`).

---

## PART 1 — Bugs to fix first

### Bug 1: The filter button is gone from the My Work screen

**File:** `mobile/lib/screens/work_screen.dart` → `_TabRow`

**What went wrong:** The tab row was rewritten to use `Wrap` so pill labels ("My Tasks", "All Tasks", "Workflows", "Leave") no longer clip. But when the total width of the 4 pills exceeds the row width, the trailing filter icon (tune icon) wraps to a new line where it may end up scrolled off-screen or visually detached from the tab strip.

**Requirement:** The tune/filter icon MUST always be visible on the screen, aligned to the right edge of the tab strip, on the same visual line as the first row of pills.

**Approach:** Two-part layout —
1. A fixed right-hand slot containing the 42×42 tune icon (right-aligned in the row).
2. A flexible left area that holds ONLY the pills. The pills go into a horizontally-scrolling `SingleChildScrollView` (with `physics: BouncingScrollPhysics()`) so if all 4 don't fit they scroll horizontally, but the filter icon stays pinned right and never disappears.

Do NOT use `ListView.builder` here (it produced the clipping bug earlier). Do NOT use `Wrap` (it lets the filter icon fall to a new line). Use `Row(children: [Expanded(SingleChildScrollView(Row(pills))), SizedBox, filterIcon])` and add a subtle right-edge gradient fade over the scroll area if the last pill is partially cut — that signals "scrollable" without hiding the filter.

Keep pill padding at `horizontal: 14, vertical: 8` and pill font at 13. Verify on the 411dp Android emulator that all four pills fit on one row with the filter icon; if not, horizontal scroll kicks in.

### Bug 2: The screen stretches when scrolled (overscroll)

**Where:** Every screen — Desk, Work, Ops, and any new one — uses a `SingleChildScrollView` inside a `Column` inside a `Stack + Offstage` shell in `mobile/lib/main.dart`.

**What went wrong:** On Android, Material overscroll shows a stretch effect (Android 12+) that visibly deforms cards near the top or bottom of the scroll view. This looks like a "bug" because the cream background pulls up/down along with the content, revealing the darker surface behind.

**Requirement:** Disable the Material overscroll stretch effect app-wide.

**Approach:** In `mobile/lib/main.dart`, wrap the `MaterialApp` (or apply on `ThemeData`) with a `ScrollBehavior` override:
```dart
class _NoStretchScrollBehavior extends MaterialScrollBehavior {
  @override
  Widget buildOverscrollIndicator(BuildContext context, Widget child, ScrollableDetails details) => child;
  @override
  ScrollPhysics getScrollPhysics(BuildContext context) => const ClampingScrollPhysics();
}
```
Then pass `scrollBehavior: _NoStretchScrollBehavior()` to `MaterialApp`. This kills the stretch overscroll and gives clean clamped scrolling that matches the aesthetic of a native iOS-style app.

Also verify: the `SoftCard` widget has no `Transform` or `Matrix4` translations applied by any parent — those combined with overscroll produce compounding stretch.

---

## PART 2 — Read the frontend to understand what to build

Before writing new screens, read these files in the frontend to learn the feature surface, the exact data shapes, and the copy/tone. **Read, do not edit.**

### Route map (start here)
- `frontend/src/App.js` — the full route table showing every page and its path. This is the source-of-truth list of screens the mobile app should eventually cover.
- `frontend/src/components/Layout.js` — the nav item list with permission gates. Every entry maps to a mobile destination (top-level tab, drawer item, or deep-linked screen).
- `frontend/src/lib/perms.js` — permission keys used to gate nav items. Mirror this on mobile so the same user sees the same screens.

### Existing screens (compare against)
- `frontend/src/pages/Desk.js` — Decision Desk sections (`needs_decision`, `on_fire`, `due_today`, `important`). Already mirrored on mobile Desk.
- `frontend/src/pages/OperatingScore.js` — the Operating Score page, source for the Ops screen you already have. Look here for the exact category names, weighting explainer, and "Do these first" logic.
- `frontend/src/pages/MyWork.js` (or similar) — the tasks list, filter tabs, and task detail. Source for the mobile Work screen.

### Screens still to build (find them, read them, then port them)
Read each of these in `frontend/src/pages/` to understand:
- **CEO Brief / Today's read** — the AI insight card feed. Home for the "Dex" persona.
- **People / Contacts** (`People.js`, `Contacts.js` or similar) — team roster with roles, phone numbers, execution stats per person. When tapped, opens a member detail with their tasks, complaints, and ops score.
- **Finance / Ledger** (`Ledger.js`, `Money.js`) — cash position, receivables (invoices past due), payables, transactions timeline. Grouped by client/vendor.
- **Company Brain** (`Brain.js` or `Dex.js`) — the AI capture surface. Voice recorder with the "orb" state (idle → recording → thinking → result). Post-capture, shows extracted decisions/tasks/notes with soft-rise entrance.
- **Capture / Ingest** — the entry point for pasting docs, uploading files, or forwarding email into the system. Not always shown on mobile — check permissions.
- **Meeting notes** — recorded meetings list with summaries and extracted actions.
- **Settings** — profile, company, team, notifications, language switcher (EN/HI/TA), theme toggle, billing.
- **Task detail** — opened from a Work list row. Shows the full task with proof upload, status change, comments, and history.
- **Decision detail** — opened from a Decision Desk row. Shows the pending decision with context, three action buttons (Approve / Reject / Defer), and a reason field.
- **Person detail** — opened from a People row.
- **Login / Signup / Onboarding** — the pre-auth flow. Match the wizard style from the web.
- **Notifications** — the bell popover on web. On mobile this is a full screen when the bell is tapped in the header.
- **All Apps** — the launcher grid.

For each web page, note down before porting:
- The API endpoints it calls (grep for `axios`, `fetch`, `queryFn`, `useQuery`).
- The i18n keys it uses (search for `t('...')`).
- The exact copy for empty states, section titles, and buttons.
- The status/priority values that appear in badges (feed them into the `StatusPill` palette).

---

## PART 3 — Connect the mobile app to the backend

The web frontend talks to a FastAPI backend. The mobile app should use the same API surface.

### Steps
1. **Add dependencies** to `mobile/pubspec.yaml`:
   - `dio: ^5.7.0` (HTTP client with interceptors)
   - `flutter_secure_storage: ^9.2.4` (for the JWT)
   - `riverpod: ^2.6.1` and `flutter_riverpod: ^2.6.1` (state management — pick one and stick with it; do not mix with `provider`)
   - `freezed_annotation: ^2.4.4`, `json_annotation: ^4.9.0` and dev deps `build_runner`, `freezed`, `json_serializable` for typed API models

2. **Config:** create `mobile/lib/config.dart` exposing `AppConfig.apiBaseUrl` — default to `http://10.0.2.2:8000` for Android emulator (that IP maps to host `localhost`). Allow override via `--dart-define=API_BASE_URL=...`.

3. **API client:** create `mobile/lib/data/api_client.dart` — one `Dio` instance with:
   - Base URL from `AppConfig`.
   - Request interceptor that reads the JWT from `flutter_secure_storage` and adds `Authorization: Bearer <token>`.
   - Response interceptor that catches 401 and clears the token, sending the user back to Login.
   - JSON content-type default.

4. **Auth:** create `mobile/lib/data/auth_repository.dart` mirroring the web auth flow (`/api/auth/login`, `/api/auth/me`, `/api/auth/signup`). Store the JWT securely. Expose `authStateProvider` (Riverpod) with three states: `Unauthenticated`, `Authenticating`, `Authenticated(user)`.

5. **Models:** for each entity (Task, Decision, Person, Invoice, Score, etc.) create a `freezed` class in `mobile/lib/models/` matching the backend response shape. Generate with `flutter pub run build_runner build`.

6. **Repositories:** one repository per feature (`tasks_repository.dart`, `decisions_repository.dart`, `people_repository.dart`, `finance_repository.dart`, `ops_repository.dart`). Each exposes typed methods that return the freezed models.

7. **Riverpod providers:** wrap each repository call in a `FutureProvider` or `AsyncNotifierProvider` so screens can render loading / error / data states declaratively.

8. **Router:** add `go_router: ^14.6.2` and define named routes for every screen. Deep links from notifications point to specific detail routes.

9. **Loading / error / empty states:** create reusable widgets in `mobile/lib/widgets/`:
   - `LoadingCard` — a skeleton `SoftCard` with a shimmer effect
   - `ErrorState` — icon + message + retry button
   - `EmptyState` — icon + heading + subtext + optional CTA (match the empty-state pattern from `frontend/src/pages/Desk.js`)

10. **Environment guard:** if the backend is unreachable, every screen should render the empty/loading state gracefully — never crash. Test by killing the backend and hot-reloading.

---

## PART 4 — Build the remaining screens

Build each screen listed below at the same fidelity as Desk / Work / Ops. Follow this checklist for every new screen:

- [ ] Uses `AppHeader` at the top (with the same left menu, wordmark rules as sibling screens)
- [ ] Content is in a `SingleChildScrollView` with `padding: EdgeInsets.fromLTRB(16, 0, 16, 120)` (the 120 clears the floating bottom nav)
- [ ] Every card uses `SoftCard` (white on cream, or `AppColors.surfaceDark` for hero cards)
- [ ] Every list has an empty state
- [ ] Every network call has loading + error states
- [ ] All text uses `AppText.*` styles — no ad-hoc `TextStyle` with hardcoded sizes
- [ ] All colors come from `AppColors` — no hardcoded hex
- [ ] All radii come from `AppRadius`
- [ ] All spacing comes from `AppSpacing`
- [ ] Deprecated `withOpacity` is not used — always `withValues(alpha: …)`
- [ ] Screen tested on 375dp width (iPhone SE) and 411dp (Pixel emulator) — no `RenderFlex overflowed` messages in the log

### Screens to add

1. **Login** (`mobile/lib/screens/auth/login_screen.dart`)
   Wordmark centered, email + password fields, "Sign in" primary CTA (dark filled pill, full width), "Forgot password?" link, "Don't have an account? Sign up" link. Language switcher in top corner. Full-screen — no bottom nav.

2. **Signup / Onboarding wizard** (`mobile/lib/screens/auth/signup_screen.dart`)
   Multi-step wizard: company name → basics → interview → confirmation. One question per step. Progress dots at top. Dark filled "Continue" pill button at bottom (56px tall, money-committing tier). Full-screen.

3. **CEO Brief / Today's read** — a dedicated screen for the AI insight cards. Reuses the `_DexCard` pattern from `desk_screen.dart` but as a scrollable feed of insights across days. Add to a new tab or nest under Desk.

4. **People** (`mobile/lib/screens/people_screen.dart`)
   Header + search bar + optional filter chips (by role/department). Vertical list of `SoftCard` rows: avatar circle (initial), name, role, phone, small status dot for online/offline. Tap → person detail.

5. **Person detail** (`mobile/lib/screens/person_detail_screen.dart`)
   Header with back arrow. Large avatar + name + role + phone/email. Then a `_KeyScoresCard`-style row of that person's execution stats (Tasks done / Open / Overdue / Complaints). Below: their tasks list (same `_TaskCard` widget as Work), their assigned decisions.

6. **Finance / Money** (`mobile/lib/screens/money_screen.dart`)
   Top: 4 KPI tiles like Desk (Cash, Receivables, Payables, Net profit — currency in tabular-nums with `₹` prefix). Then a tab row: Transactions / Receivables / Payables. Each tab is a scrollable list of `SoftCard` rows with amount right-aligned in tabular-nums, colored green for income / red for expense, badge chip for status.

7. **Money detail** (invoice / transaction)
   Full detail of one item — client, amount breakdown, due date, status timeline, attached files, action buttons (Send reminder / Mark paid / Dispute).

8. **Dex / Brain** (`mobile/lib/screens/dex_screen.dart`)
   Full-screen immersive layout. Large circular orb at center with the `dex-orb-ring`-style breathing animation (use `AnimatedContainer` + `Curves.easeInOut` on a `Container` scale). Below the orb: "Ask Dex anything" hint and a text input with a mic button. Tapping mic switches to recording state — orb pulses red, wave-bars visualize input. On stop, transitions to "thinking" state (constellation-spin backdrop, thinking-glow text), then to a result view showing extracted decisions/tasks with `soft-rise` entrance animation.

9. **Task detail** (`mobile/lib/screens/task_detail_screen.dart`)
   Header with back. Task title (h1) + description. Metadata block: assignee, due date, priority chip. Proof upload block (camera icon → attach photo/file). Status changer (dropdown or segmented pill). Comments / history at the bottom.

10. **Decision detail** (`mobile/lib/screens/decision_detail_screen.dart`)
    Header with back. Decision title, context/description, waiting time, who submitted it. Three action buttons stacked full-width at bottom: Approve (primary dark pill), Reject (destructive outline), Defer (ghost). Optional reason `TextField` above the buttons.

11. **Calendar** (`mobile/lib/screens/calendar_screen.dart`)
    Week view horizontal date strip at top (7 days, tap to select). Below: chronological list of events for the selected day as `SoftCard` rows with time, title, participants. FAB (+) to add event.

12. **Settings** (`mobile/lib/screens/settings_screen.dart`)
    Sections as `SoftCard`s: Profile (avatar, name, email, phone), Company (name, industry, size), Notifications (row of `Switch` toggles), Language (radio row: English / हिन्दी / தமிழ்), Appearance (theme toggle), Billing (plan + usage), Sign out (destructive text button at bottom).

13. **Notifications** (`mobile/lib/screens/notifications_screen.dart`)
    Opened by tapping the bell in `AppHeader`. Full-screen list of notification `SoftCard` rows, each with icon, title, body, timestamp. Group by "Today" / "This week" / "Earlier" section headers.

14. **All Apps** (`mobile/lib/screens/all_apps_screen.dart`)
    Grid of app tiles (2 columns on phone). Each tile is a `SoftCard` with icon (36px) + name + one-line description. Grouped by category (Operations, Finance, People, Intelligence). Locked apps: muted colors + small lock icon overlay.

15. **More screen redesign** (`mobile/lib/screens/more_screen.dart`)
    Replace the current placeholder with a real "More" hub showing rows for: CEO Brief, People, Money, Calendar, Notifications, All Apps, Settings, Sign out. Each row is a tap target that pushes the corresponding screen.

### Routing

Update `mobile/lib/main.dart` to use `go_router`. Root path shows the bottom-nav shell with Desk/Work/Ops/More. Auth-gated routes redirect to `/login` when `authStateProvider.state` is `Unauthenticated`. Every detail screen is a full-screen push with a back button in the header — no bottom nav visible while a detail is open.

---

## PART 5 — Verification checklist before you're done

Run each of these and confirm no errors:

- [ ] `flutter analyze --no-fatal-infos` — 0 errors, no `withOpacity` deprecations, no unused imports
- [ ] `flutter test` — all widget tests pass
- [ ] `flutter run -d <emulator>` — app builds and installs without red errors in the log
- [ ] Open every screen; watch the console for `RenderFlex overflowed`, `LayoutBuilder` assertions, or "another exception was thrown" messages
- [ ] Confirm the filter icon on Work is always visible even when all 4 pills are present
- [ ] Confirm no rubber-band stretch when scrolling past the top or bottom of any screen
- [ ] Kill the backend and confirm every screen renders its empty/error state without crashing
- [ ] Rotate the emulator to landscape — the layout adapts (or is gracefully locked to portrait — decide and be explicit in `main.dart`)
- [ ] Test tab-switching in the bottom nav — scroll position is preserved per tab (that's why we use `Stack + Offstage`, not conditional rendering)

If anything on this list fails, fix it before declaring the task complete. Do not silently work around a rendering error by hiding the offending widget — fix the underlying layout.

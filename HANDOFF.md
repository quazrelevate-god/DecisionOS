# DecisionOS — design system & UX handoff

Written for a session with **no memory of the previous conversation**. Everything
here is verified against the branch as of `0e25fe2`.

Read this with `MIGRATION-FOLLOWUPS.md`, which is the standing backlog and the
backend spec sheet. This file is the state of play; that one is the work queue.

---

## 1. Where we are

| | |
|---|---|
| Branch | `design-system-migration` (off `design-system`, off `main`) |
| HEAD | `0e25fe2`, pushed |
| Latest tag | `ux-frontend-batch` |
| `origin/main` | **`da5b238` — untouched. Nothing has been merged.** |
| Tests | 136 passing, 7 suites |
| DS components | 23 in `frontend/src/components/ds/` |

**Done and pushed:**

- **Design system** — tokens generated from `src/lib/tokens.js` (single source of
  truth; `src/index.css` is generated, never hand-edited), 23 components, lint
  enforcement, contrast tests in both themes.
- **Full app migration** — ~1,455 legacy styling hits swept across 38 files, the
  legacy `.dark` compatibility shim deleted, completion test run and its residual
  recorded.
- **Palette override** — indigo is the brand and accent everywhere. No identity
  red. Red exists only as `danger`.
- **Type + radius** — all-caps removed app-wide (723 classes), label tier rebuilt;
  one curved radius scale, zero sharp bordered boxes.
- **Frontend UX batch** — render-layer guard, empty states, Operating Score
  demoted, duplicate rows collapsed, My Work urgency grouping.

**Tags, oldest to newest:** `ds-base`, `ds-phase-1..4b`, `mig-m2`, `mig-m3`,
`mig-m6`, `mig-m7`, `mig-palette-closed`, `ds-type-radius`, `ux-frontend-batch`.

**Backups:** `~/Documents/decisionos-ds-backups/` holds per-phase `git bundle`
files (verified restorable) plus the screenshot tooling — `tools/shoot.js`
captures 42 shots across 17 routes in both themes, `tools/diff.js` byte-compares
two sets. Branch protection was skipped by decision, so the bundles are the
safety net rather than a backup.

---

## 2. In flight

### Already built this session (contrary to any earlier plan that lists them as pending)

- **Raw-palette cleanup — DONE.** 35 instances (not the 26 first estimated) across
  9 files, worst on CEO Brief where each of nine counters had its own hue. Zero
  raw palette remains. `scripts/sweep.js` now detects palette usage
  **prefix-agnostically** — four separate misses in this migration were all "rule
  written for one prefix, codebase used another".
- **Collapsed task-card chrome — DONE.** Measured 340px → 132px collapsed, 394px
  expanded. Page 1,455px → 1,035px on three tasks; projected 5.7 screens instead
  of 14.7 at thirty-nine. Overdue opens by default. "View details" deliberately
  sits outside the collapsed body.
- **Editorial layer — DONE, not yet consumed by any screen.**
  `frontend/src/lib/whatMatters.js`, 13 tests. This is the load-bearing piece of
  the Desk redesign and it is finished and green.

### Approved, NOT yet built — the Decision Desk redesign

The user approved all of this; it is implementation work, not a proposal.

| Change | Detail |
|---|---|
| **Today-line** | One sentence from `summarise()`, e.g. *"2 decisions need you, 3 overdue and 1 due today."* |
| **Top 3** | `whatMatters()` output, each card showing its `reason` |
| **Capture collapse** | 515px of three simultaneous inputs (Speak/Type/Upload) becomes one primary **"Capture a decision"**. The mic stays the visible primary — speak-first is the product thesis and must survive |
| **Approval summary** | Show the top one; the waiting count must be **LOUD** — *"2 decisions still need you"* in the today-line and the nav badge. Not a subtle "2 more" |
| **Feed default** | Overdue + Today only, with **`Show everything (31)` always visible** |

**The tier rule (approved):** pending-approval → escalated-to-me → overdue (worst
first, amount breaks ties) → due-today. Everything else is "not today". Tiers, not
a score, because every item must be able to say *why* it placed where it did.

**Measured problem this solves** (from the UX report, real DOM at 1440×900):

- `/inbox` first viewport is **57% capture block** (154→669px) — the founder's
  morning screen opens on three ways to type something in and **nothing about
  their business**.
- First approval card starts at 669px; filters at 1,253px; feed at 1,301px, all
  below the fold. 84 interactive controls on one page.
- Page is 2.2 screens on a 6-item fixture; ~6 screens at real volume.

**Open question the next session should raise before building:** the preview
fixture has only 2 pending decisions and 3 tasks, so a top-3 will look
under-populated. Ask whether to enrich the fixture (≈6 approvals, 12 tasks across
all four tiers) so the user rules on behaviour under real load.

---

## 3. Waiting on the user's ruling — do not build

1. **Desk vs Brief — HOLD.** The user's lean is Desk becomes the morning surface
   and `/brief` becomes the deeper weekly/monthly review it already has tabs for.
   **Explicitly not final.** Build the Desk as a morning surface without changing
   what `/brief` is for.
2. **App-wide rollout — approved in principle, sequenced after the Desk.** My Work
   collapsed rows (partly done), Ledger headline KPI, CEO Brief as a sentence plus
   the two or three non-zero counters. Prove the pattern on the Desk first.
3. **Operating Score remediation** — demotion shipped; "the three things that
   would move this" is product work needing backend ranking. Not started.
4. **Brand artifacts** — the app icon, investor deck and `design_guidelines.json`
   still carry the old red identity and are now out of step with the indigo app.
   Brand task, not app work.

---

## 4. Working rules that must carry forward

**Colour**
- **Red = danger only.** Overdue, errors, destructive actions. Never identity,
  accent, emphasis or decoration. There is no identity red — indigo is the brand,
  including the wordmark and the Landing hero.
- **Colour never encodes a category.** A colour per *kind of thing* is the disease
  this project removed; classifications are neutral, and an icon or a label
  carries the category instead.
- Roles are `brand`, `danger`, `caution`, `success`, `neutral`. Add values to
  `src/lib/tokens.js` and run `node scripts/gen-tokens.js` — never hand-edit
  `src/index.css`.

**Type and shape**
- **No uppercase anywhere.** Title Case. The label tier reads as labels through
  size + weight + colour (12px / 600 / tertiary against 15px / 400 body), not
  through caps and tracking.
- **One curved radius scale** — `rounded-sm/md/lg/xl/pill` only. No sharp
  bordered boxes.
- Monospace exists in exactly one place: `components/ds/TerminalBlock.jsx`.

**Information design**
- **Default to the decision; keep the data one tap behind it; always show the
  count of what is hidden.** Subtraction must never become concealment. This is a
  hard rule across every collapse, filter default and summary.
- **Busy ≠ unavailable.** A loading control keeps its variant; only genuinely
  disabled goes neutral. Enforced by `components/ds/states.js` and its tests.
- Grouping is not prioritisation. Use `whatMatters()` for the second.

**Enforcement already in place — don't reinvent it**
- `yarn lint:ds` bans raw hex, legacy `brand-*` and `font-mono` inside
  `components/ds/**`.
- `yarn verify:ds` = token drift check + ds lint + the full `lib/__tests__` suite.
- `src/lib/safeText.js` is an axios response interceptor scrubbing internal
  strings (env identifiers, UUIDs, stack frames, unresolved `answer_0`
  placeholders) before they reach a screen. Extend it rather than patching call
  sites.

**Process rails — these were earned**
- **Per-concern commits.** One idea per commit, with the reasoning in the message.
- **Before/after screenshots for every visual change.** `tools/shoot.js` +
  `tools/diff.js`.
- **Testid check BEFORE each commit**, not after. It caught silently dropped
  testids on three separate screens.
- **"Compiled successfully" does not mean it works.** Three edits silently
  no-op'd in one batch (a failed `cd` short-circuiting `&&`), and one corrupted an
  import by matching `Pencil` inside `PencilSimple` — taking the page down with a
  runtime error while the build stayed green. **Screenshot-verify everything.**
- Measure rather than assert. The strongest findings this project produced came
  from reading computed styles and DOM geometry, not from looking at screenshots.

---

## 5. Backend handoff

`MIGRATION-FOLLOWUPS.md` carries four written specs for the client's backend team,
each with symptom, root cause and acceptance criteria:

- **B1 — contradictory counts.** "96 delayed / 0 completed", "All 23" vs
  "Completed 27". Root cause found: `/brief`, `/tasks?mine=true` and `/inbox` are
  **three endpoints with three definitions of "a task that counts"**, disagreeing
  on cancelled/archived inclusion, user-vs-tenant scope, and whether "completed"
  includes cancelled. **This is a data-integrity bug, not a display bug.**
- **B2 — Ledger ₹0.** The frontend renders six named keys off `/ledger/summary`
  with no client-side aggregation; the question is what the endpoint returns.
- **B3 — duplicate ingestion.** Display half shipped (rows collapse with an `n×`
  count); source-level dedup outstanding, and it likely inflates B1.
- **B4 — bulk triage has no endpoints.** Checked: only per-id routes exist.
  Select-all / archive-completed / merge-duplicates cannot be built honestly
  client-side. Logged rather than faked.

**Coupling that matters:** the Desk presentation work is coupled to B1 and B3. A
calm, confident Desk sitting on wrong counts makes the trust problem *worse*,
because it earns confidence the numbers have not got. Ship the presentation, but
say plainly that it is not "done" until the counts are trustworthy. **Do not let
beautiful imply correct.**

---

## 6. Deploy

The client (**Yokesh**) is deploying this branch on **Railway**.

- **App root is `frontend/`** — not the repo root. The repo also contains a
  FastAPI backend in `backend/`.
- Build: Create React App via CRACO. `yarn build`, output `frontend/build/`.
- **Required env vars** (all `REACT_APP_*`, baked in at build time by CRA):
  - `REACT_APP_BACKEND_URL` — backend origin; the client calls `${it}/api`.
  - `REACT_APP_PREVIEW_MOCK` — `1` enables the dev-only API stub in
    `src/dev/previewMock.js`, which lets screens render with no backend. **Must be
    unset or `0` for a real deployment.** It is guarded by
    `NODE_ENV !== "production"` as well, so it cannot activate in a production
    build, but do not rely on that alone.
- `frontend/.env.local` is gitignored — Railway needs these set in its own env,
  they will not arrive from the repo.
- Node 24 builds cleanly. There is no lockfile committed (deliberate — the repo
  never had one); `yarn install` resolves from `package.json`.

---

## 7. How to work with this user

- **Report-and-propose on anything that changes behaviour or hides information.**
  Collapsing input, defaulting a feed to a subset, demoting a card, converting
  buttons into a segmented control — all product decisions. Bring a proposal,
  wait for the ruling, then build. This has been the working pattern throughout
  and it has caught real errors.
- **Recolour, don't restructure.** If a structural improvement is right, log it in
  `MIGRATION-FOLLOWUPS.md` as a follow-up with its own before/after, rather than
  smuggling it inside another change.
- **Never paper over a data problem with presentation.** A papered-over wrong
  count is worse than a visible one.
- Be honest about what is not verified. "Layout verified" is not "screen
  verified"; a screen checked against a blank baseline is not checked.
- The user reads the reasoning, not just the result. Commit messages and code
  comments should say *why*, especially where a choice looks arbitrary.
- Bracketed placeholders in their messages are sometimes left unfilled by
  accident. If a decision is genuinely theirs, ask again rather than inferring —
  except where they have explicitly delegated it.

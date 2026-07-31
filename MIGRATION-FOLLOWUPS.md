# Migration follow-ups

Improvements identified during the design-system migration that were **deliberately
not made inside it**. The migration's guarantee is "nothing changed how it works" —
that guarantee is what makes a 25-file colour batch reviewable, and it only holds if
interaction changes are sequenced out of it.

Each item below is a separate commit after the migration lands, with its own
before/after, reviewed on its own terms. Noted, not buried.

---

## MyWork toolbar → segmented control

**Found:** M4. **Status:** logged, recoloured in place.

The seven toolbar controls are three semantically different things wearing one
visual language:

| Control | What it actually is |
|---|---|
| `NEW TASK` | an action |
| `MY TASKS` / `ALL TASKS` | a view filter |
| `MY WORK` / `WORKFLOWS` / `LEAVE` | sub-view navigation |
| `AI PRIORITY` | a toggle (re-sorts by AI score) |

This is the same disease as the category-hue chips: visual weight applied without
semantic logic. The migration recoloured them — `NEW TASK` primary indigo, the rest
on the selected/unselected treatment — which fixes the colour problem without
touching affordance.

The structural fix is to render the filter group and the nav group as
`SegmentedControl`, which is what they behave like. That changes interaction
affordance, so it waits.

## MyWork progress → interactive quarters

**Found:** Phase 3 planning. **Status:** logged, display-only in the migration.

`ProgressQuarters` ships with an interactive variant that would replace the
`SET PROGRESS` dropdown, letting someone click a quarter directly. Ruled
display-only for the migration because changing how progress is *set* is a
behaviour change, not a visual one.

## LanguageSwitcher → DS LanguageSwitch

**Found:** M2. **Status:** logged, left legacy.

`components/LanguageSwitcher.js` holds the i18n wiring; the DS `LanguageSwitch`
does not. Swapping means moving that wiring, which is a functional change wearing
a migration's clothes. It is still the black-bordered globe in the header.

## Fixtures for ledger / operating-score / coach

**Found:** M0. **Status:** open, blocks M5 for Ledger.

Three routes do not mount under the preview mock, so their screenshot baselines are
blank. A screen verified against a blank baseline is not verified — fixtures must
land before those screens are swept.

## Ledger fixture keys → real numbers

**Found:** M5. **Status:** open, must be closed before "done".

The Ledger preview renders ₹0 in every KPI tile because the fixture's `totals`
keys do not match what `KpiRow` reads. The *layout* is verified; the *screen* is
not. That distinction matters here more than anywhere else: ₹0-everywhere was the
original trust-killing symptom, and a migration that leaves it looking like that in
preview is one screenshot away from being mistaken for the real thing.

**Before this work is called finished:** open the real Ledger against real data and
confirm the numbers are real. "Layout verified" is not "screen verified".

## OperatingScore — a content problem the recolour does not fix

**Found:** M6. **Status:** logged, out of scope.

The original product analysis flagged: *17/100 with no remediation path — judgment
without guidance.* The migration makes that screen use the system's colours. It does
not give the score a path to act on, which is the actual problem.

Recorded here so "now indigo" is never mistaken for "now fixed". The score needs
remediation guidance — what to do about a low score — and that is product work, not
a sweep.

## WorkCoach — RESOLVED, now verified

**Found:** M6. **Status:** closed. Fourth fixture round did it — the missing piece
was `summary.strengths`, alongside `target` and `stats`. `/coach` mounts and its
sweep is visually verified like every other screen.

## Ledger numbers — preview fixed, real data still unconfirmed

**Found:** M5. **Status:** partially closed.

The fixture keys now match what `KpiRow` reads (`revenue_billed`, `total_spend`,
`net_profit`, `asset_value`, `inventory_value`, `revenue_received`), so the preview
shows real figures instead of ₹0 everywhere. That removes the false impression.

**Still open:** these are stubbed numbers. Nobody has yet seen the real Ledger,
against a real backend, showing real values. Layout verified and numbers plausible
is not the same as the screen being correct, and ₹0-everywhere was the original
trust symptom — so this stays open until someone opens it for real.

## The gallery is now protected from blanket sweeps

**Found:** M6. **Status:** closed.

A blanket `font-mono` rule stripped monospace from the Company Brain terminal
preview during the M6 sweep; the screenshot diff caught it and it was reverted. Two
fixes so it cannot recur:

1. The gallery's terminal preview now renders the real `TerminalBlock` component
   rather than hand-rolled markup, so the only monospace outside the lint-protected
   `components/ds/` is the type-scale specimen — which is annotated as the subject
   of that row, not a stray usage.
2. `scripts/sweep.js` carries a `PROTECTED` list covering `src/pages/DesignSystem.js`
   and `components/ds/`, and refuses to touch them.

This was the second blanket-rule overreach (the first was `Chip`'s `className`
override silently defeating M1's neutralisation on Inbox). Both were caught by
looking at output rather than trusting the rule — which is the argument for the
screenshot diff existing at all.

## M7 completion test — result and residual

**Run:** M7. **Method:** identical app code, screenshotted with the legacy `.dark`
shim present and absent, 42 shots each. Noise floor measured first by shooting the
same code twice: **max 0.15%, 6/42 non-identical** (chart animation, antialiasing).

**Result: 11/42 screens exceed the noise floor, none by more than 0.35%.**

The test worked — it found three real things a deletion-only M7 would have shipped:

1. **`src/lib/notif.js` was never swept.** `src/lib/` was outside every sweep glob,
   so eight notification kinds still carried `text-black`, `bg-purple-600`,
   `bg-orange-500` and friends. With the shim present they rendered; with it gone
   the REMINDER chips went dark-grey-on-dark and became illegible. Now mapped to
   tones.
2. **Overdue badges had been flattened to indigo** by an over-broad `bg-brand-red →
   bg-primary` rule in the M7 prep pass. Overdue is the canonical danger case; the
   diff caught it on MyWork, and the same fix applied to CEO Brief, Ingest and
   Tasks. Restored to the overdue tokens.
3. **The shim was not purely a legacy patch.** It also carried the only dark-mode
   styling for the app's ~35 remaining raw `<select>`/`<input>` elements and the
   dark scrollbar thumb. Deleting it would have silently taken those with it; they
   are re-homed onto tokens in the base layer and retire as those controls move to
   the DS Input/Select.

**Residual:** 11 screens differ by 0.15–0.35% — sub-pixel scrollbar and form-control
rendering, concentrated in dark mode and on Ledger (34 raw controls). Explainable
and small, but not zero, so it is recorded rather than rounded away. The honest
reading is that the class sweep is complete and the last differences come from
element-level rendering the shim used to pin.


## Hero / wordmark brand ruling — REVERSED (indigo, no identity red)

**Superseded** by the palette override below. The KEEP analysis is kept for the
record because the evidence was real; the decision went the other way.

## Brand artifacts are now out of step with the product

**Found:** palette override. **Status:** open — brand task, not a code task.

The product now has zero identity red: indigo carries the wordmark, the hero and
every accent, and red means danger only. The brand artifacts still carry the old
red identity:

- `frontend/public/icon-*.png` and `favicon.ico` — the app icon is a red tile.
- `brochure_assets/` — the investor deck's palette is near-black plus red
  (`#FF2D20`, 16 uses), no indigo.
- `design_guidelines.json` — still states *"retaining the core Red/Black identity
  as the hero signature"*.

A red logo sitting on an indigo app reads as unfinished. **Update the brand
artifacts to the indigo identity** — icon set, deck, guidelines doc. That is design
work outside this codebase, and it also settles the two-reds discrepancy below by
making it moot.

## Hero / wordmark brand ruling — the superseded KEEP analysis

**Ruled:** post-M7. **Evidence:** the brand artifacts in this repo, checked directly.

- `frontend/public/icon-512.png` and every other icon size: the shipped app logo is
  a **red tile with a white D**. That is the mark on every home screen and tab.
- `brochure_assets/brochure.html` (the investor deck): palette is `#111111` (20
  uses) and **red `#FF2D20` (16 uses)**, plus two greys. **No indigo at all.**
- `brochure_assets/hero.png`: red is the dominant accent throughout.
- `design_guidelines.json`, in-repo: *"Retaining the core Red/Black identity as the
  hero signature."*

So red **is** DecisionOS brand identity. The Framer system reference putting indigo
in its own wordmark slot was the UI system demoing itself — a palette ruling about
product chrome, not a brand ruling. On brand surfaces, brand wins.

**Applied:** `brand.red` deleted. `brandIdentity` in tokens.js now feeds two vars,
`--brand-mark` (wordmark) and `--brand-hero` (hero copy, eyebrows, rules, quote
bars), so they cannot drift and neither moves if the danger scale is retuned. Red
is legal in exactly those two places; everywhere else red is danger.

**Discrepancy worth someone's attention:** the deck's red is `#FF2D20` and the app's
is `#FF3B30`. Close, but not the same red. Nobody has reconciled them, and the
brand should probably pick one.

## Command palette (⌘K) — a real gap, but a feature

**Found:** shadcn adoption review. **Status:** open, needs its own scoping.

Thirty routes and no search. For a founder who lives on the Desk, jump-to-
decision / jump-to-task / jump-to-screen is a genuine capability, and Command
is the one registry component that is hard to hand-roll well — filtering,
keyboard loop, and the focus behaviour are the whole component.

Deliberately **not** taken as part of the Desk finish. It is a new feature,
not a finish-line task: it needs a decision about what is searchable, what
ranking it uses (and whether that is `whatMatters()` or something else), and
what happens on an empty query. `cmdk` also brings its own DOM with
`[cmdk-*]` selectors, so the skinning is more than a class swap.

## Sheet vs MobileDrawer — one of them should go

**Found:** shadcn adoption review. **Status:** open, resolve by deleting.

`Layout` opens the mobile nav with shadcn `ui/sheet`, and the design system
also ships a hand-built `ds/MobileDrawer` with focus-trap and scroll-lock
tests. Two answers to one question.

The tested one is `MobileDrawer`, so the likely resolution is to move Layout
onto it and delete `ui/sheet` — but that is a behaviour change to the mobile
navigation and wants its own before/after. **Resolve by deleting one, not by
adopting a third.**

## The 36 unused registry primitives

**Found:** shadcn adoption review. **Status:** open, recommend deletion.

`components/ui/` holds 44 shadcn primitives. Five are wired (dialog, popover,
sheet, sonner, tooltip). The other 39 are imported by nothing.

They are not free. Sixteen carry `lucide-react` imports against a Phosphor
app, which is why the Lucide ban in `eslint.config.mjs` needs an explicit
sixteen-file exemption list — dead code forcing a hole in live enforcement.
The token bans do apply to them.

**Recommendation: delete them.** They can be re-added from the registry in
one command whenever they are genuinely wanted, and re-adding is the moment
the skinning work should happen anyway. Left in place, the next person
reasonably assumes they are usable as-is.

## `border-2` is off the border token scale

**Found:** border-hairline fix. **Status:** open, small.

The border scale is `hairline: 1px` and `focus: 2px`. Three sites use
`border-2`/`border-l-4` with `hairline-strong`, which is a colour-only token,
so those genuinely render 2px and 4px — off the scale. Not urgent, and not
folded into the border fix because that commit's claim was pixel-neutrality.

## My Work mobile is not deterministic

**Found:** Desk batch. **Status:** open, blocks byte-diffing that one screen.

`/my-work` at 390×844 measured 6402px, 6374px and 6374px across three
identical runs with no code change between them — a 28px swing. Every other
screen is stable. Until it is understood, a byte diff on my-work mobile
cannot distinguish a regression from noise, which is a hole in the one
safety net this project relies on.

---

# Backend-blocked — specs for handoff

These are **not** fixable in the frontend, and a frontend fix would make them
worse by hiding inconsistent data behind a plausible-looking number. Written up
so they can be handed to whoever owns the backend.

## B1. Contradictory counts across the app

**Symptom, as observed:**

- CEO Brief: **"96 delayed / 0 completed"** — 96 tasks past due while zero have
  ever completed, which cannot be true of a live workspace.
- My Work: filter reads **"All 23"** while **"Completed 27"** — a subset larger
  than its superset.
- My Work department filters (Operational, Sales, Purchase, Production, Finance,
  HR) all read **0** while 23 tasks are open.

**What is actually wrong:** these counters are computed by different endpoints
over different filter sets, and nothing reconciles them.

- `/brief?period=…` returns `counters.{fires,delayed,completed}`.
- `/tasks?mine=true` returns the task list the "All" count is derived from.
- `/inbox` returns `counts` per classification.

Three sources, three definitions of "a task that counts". At least one of them
disagrees with the others about (a) whether cancelled/archived tasks are
included, (b) whether the scope is the current user or the whole tenant, and (c)
whether "completed" means `status === "done"` or includes `cancelled`.

**What needs to happen at source:** one definition of the task universe, shared
by every counter — the same scope, the same status set, the same tenant filter.
Then every count derives from it. Until that exists, any frontend reconciliation
is a guess dressed as a fact.

**Acceptance:** for a given workspace, `completed ≤ all`, the sum of the
department filters equals the unfiltered open count, and `delayed > 0` with
`completed === 0` is either impossible or explainable.

## B2. Ledger shows ₹0 with real data behind it

**Symptom:** every KPI tile on Finance/Ledger renders ₹0 and the tabs show "no
financial data found", on workspaces that do have financial records.

**What the frontend does:** `KpiRow` reads `summary.totals.{revenue_billed,
revenue_received, total_spend, net_profit, asset_value, inventory_value}` from
`GET /ledger/summary`. It renders exactly what it is given; there is no
client-side aggregation to get wrong.

**So the question is at source:** does `/ledger/summary` return that shape, with
those key names, populated for a tenant that has expenses/revenue rows? The
frontend's preview fixture had to be corrected twice to match those key names —
if the backend emits a different shape (or a correct shape with an empty tenant
filter), every tile is ₹0 while the underlying rows exist.

**Why this matters more than it looks:** ₹0-everywhere was the original
trust-killing symptom of this product. A finance screen that reports nothing on a
business with money moving through it is not a cosmetic bug.

**Acceptance:** open the real Ledger for a workspace with known revenue and
expenses; the six tiles show those numbers.

## B3. Duplicate ingestion (the half that is not display)

**Status:** the display half shipped — residual duplicates collapse into one row
with an `n×` count.

**Still open at source:** the same invoice parsed twice, or a task captured from
both a voice note and the WhatsApp forward of it, still creates multiple records.
The frontend collapse tidies the feed; it does not stop the rows being created,
and anything counting rows still counts them twice — which likely feeds B1.

**What needs to happen:** deduplicate at ingestion on a content key (vendor +
amount + document date for invoices; normalised text + window for captures).

## B4. Bulk triage has no endpoints

**Checked, does not exist.** The backend exposes only per-id operations —
`PATCH /tasks/{id}`, `POST /tasks/{id}/approve|reject|clarify`,
`POST /inbox/{id}/status`. There is no bulk/batch/archive/merge route and nothing
accepting a list of ids.

Select-all, archive-completed and merge-duplicates therefore cannot be built
honestly in the frontend: fanning out N single calls gives no atomicity, partial
failure with no rollback, and N× the load. **Needs `POST /tasks/bulk` (or
equivalent) taking ids + an action.** Logged rather than faked.

## Finance empty states cannot carry an action yet

**Found:** UX batch. **Status:** open, small.

The EmptyState shim now forwards `actionLabel`/`onAction`, but Finance's
add-entry controls are `DialogTrigger` components that own their own open state.
Wiring "Add an expense" from the empty state needs that state lifted out of them
— a structural change, not a copy fix, so it did not ride inside the batch.

## Operating Score remediation

**Found:** M6, decided in the UX batch. **Status:** open, product work.

The composite is demoted out of the hero slot, which removes the
judgement-without-guidance problem today. It does not add guidance. The score
still cannot say *"here are the three things that would move this"* — that needs
backend logic to identify the highest-leverage gaps and rank them, and product
thinking about what a founder should actually do about a low score.

Demotion was the honest interim. Remediation is a feature to design, not a patch.

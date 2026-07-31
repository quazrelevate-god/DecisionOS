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

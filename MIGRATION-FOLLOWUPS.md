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

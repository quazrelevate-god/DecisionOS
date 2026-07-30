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

## WorkCoach — swept but NOT visually verified

**Found:** M6. **Status:** open, blocks sign-off on that one screen.

`/coach` still fails to mount under the preview mock after three rounds of fixture
work (`target`, `stats`, `summary` supplied; it now fails on a further `.map`).
WorkCoach.js received the mechanical sweep along with the rest of the long tail, so
it carries changes whose visual result nobody has seen.

Per the blank-baseline rule this screen is not verified. Either fixture it properly
or open it against a real backend before sign-off. It is the only screen in the
batch in this state.

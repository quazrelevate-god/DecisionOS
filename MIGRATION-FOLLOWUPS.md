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

# Ops (Operating Score) — end-to-end validation plan

Route `/operating-score` · page `frontend/src/pages/OperatingScore.js` (1,206 lines)
Service `backend/services/operating_score.py` · router `backend/routers/operating_score.py`

Written before execution so the pass is complete rather than remembered.
Each item is ticked only when it has evidence behind it.

---

## A · Structure and model

- [x] **A1** Map the page: company view vs self view, mobile vs desktop variants
- [x] **A2** Map the score model: the four legs, their weights, their defaults
- [x] **A3** Map the AI surfaces: work coach, Score-with-AI, what each calls
- [x] **A4** Map every route out of the page (next-moves, drill-downs, employee → coach)

**A2 findings so far — the model as built**

| Leg | Weight | Formula |
|---|---|---|
| execution | 0.35 | `completion% − overdueRatio×40` |
| finance | 0.25 | `collected% − overdueInvoices×5` (null without finance permission) |
| sales | 0.20 | `approvedDecisions / totalDecisions × 100` |
| responsiveness | 0.20 | `100 − openComplaints×12 − overdueTasks×3` |

Weights renormalise across whichever legs are available. Empty inputs default to
`0.7` (= 70) rather than 0. Cache TTL 90s. All queries are all-time and capped
at `.to_list(2000)`.

## B · Automated sweep (press every control, mutations blocked)

- [x] **B1** Desktop 1440×900 — every control, descend into dialogs
- [x] **B2** Mobile 390×844 — same
- [x] **B3** Layout: overflow, tap targets, contrast, unnamed controls, alt text

## C · Hands-on preview pass

- [x] **C1** Desktop: click every element myself, screenshot each state
- [x] **C2** Mobile: same — this is where CRM's two Highs were hiding
- [x] **C3** Category drill-downs, leaderboard sort + search, formula panel

## D · Routing

- [x] **D1** Every `ops-action-*` next-move link resolves to a real screen
- [x] **D2** `?user=` view-as another person, and the banner that says so (2026-09-13)
- [x] **D3** Employee card → work coach — *superseded 2026-09-13: the card now opens
      view-as, and nothing in the app links to `/coach` any more (OP-12)*

## E · Roles

- [x] **E1** Owner, Sales, Production, Finance — company view vs self view (2026-09-13)
- [x] **E2** Finance leg correctly absent without the finance permission

## F · AI

- [~] **F1** Work coach: read paths, permissions and the refresh FAILURE path done
      2026-09-13. A live refresh is NOT run: it overwrites `users.coach_summary`
      via a model call — waiting on the founder's go.
- [~] **F2** Score-with-AI: desktop FAILURE path done; missing on mobile (CR-09).
      A live rescore is NOT run: it overwrites the contact's AI score via a model
      call — waiting on the founder's go.

## G · KPI validation — the headline question

- [x] **G1** Does each leg measure what its label claims?
- [x] **G2** Empty-state defaults: is 70/100 for a brand-new workspace right?
- [x] **G3** Double counting, absolute-vs-rate penalties, missing time window
- [x] **G4** Recommendation: are these the right KPIs for an India-first SME
      decision OS, and what would serve better?

## H · Report

- [x] **H1** File findings + asks in `DecisionOS_UI_Bug_Report.xlsx`
- [x] **H2** Commit, push, hand back

---

## Outcome

Nine findings (OP-01…09, three High) plus ASK-19, the KPI redesign. Filed in
`DecisionOS_UI_Bug_Report.xlsx`; 19 coverage rows added (T-400…418).

**Still not covered**, and honest about it:

- **D2** — `?user_id=` view-as another person, and the banner that announces it.
  Not exercised; needs a second real user and a deliberate pass.
- **E1** — the four personas on Ops. Only the owner's company view was driven;
  the self view that Sales/Production/Finance get was not.
- **F1/F2** — the work coach (`/work-coach`, `/work-coach/refresh`) and
  Score-with-AI. Both make live model calls, so they were left for a run where
  that cost is intended.

### Gap pass — 2026-09-13

D2 and E1 are now covered, and F1/F2 up to the point of a live model call
(script `backend/scripts/ux_ops_gaps_0913.py`, 8 passes: four roles × 1440 / 390,
writes blocked; plus the browser preview at 375×812).

- **Works:** view-as opens from the leaderboard with a clear banner; Back to
  company, browser Back and `?user=<own id>` all return cleanly; the owner's
  view-as matches the person's own page exactly. Sales, Production and Finance
  all get the self view. The coach loads for all four roles, the owner can open a
  teammate's, non-owners are refused with a way back, and a failed refresh or
  rescore says so.
- **New findings:** OP-10 High (a refused or unknown person leaves the skeleton on
  screen forever), OP-11 Medium (the fixed black band on the mobile self view),
  OP-12 Medium (nothing links to the coach any more), OP-13 Low (Back to company
  and See all under 24px), OP-14 Low (coach error titled 'Access denied' for a
  404), CR-09 Low (no Score with AI on mobile).
- **Still not run:** a live coach refresh and a live rescore. Each overwrites
  stored data (`users.coach_summary`, the contact's AI score) through a paid model
  call, so they wait for the founder's go — ideally on a TEST account and a test
  contact.

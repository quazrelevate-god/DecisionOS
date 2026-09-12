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
- [ ] **D2** `?user_id=` view-as another person, and the banner that says so
- [x] **D3** Employee card → work coach

## E · Roles

- [ ] **E1** Owner, Sales, Production, Finance — company view vs self view
- [x] **E2** Finance leg correctly absent without the finance permission

## F · AI

- [ ] **F1** Work coach: what it returns, how it fails
- [ ] **F2** Score-with-AI on the contact/ops surface

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

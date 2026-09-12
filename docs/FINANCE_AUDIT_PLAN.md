# Finance — end-to-end audit plan

Route `/finance` · page `frontend/src/pages/Ledger.js` (1,672 lines)
Sub-panels `pages/finance/ReviewPanel.js`, `pages/finance/WhatsAppCard.js`
Totals `backend/routers/ledger.py:1223 ledger_summary`

Six tabs: **Overview · Revenue · Expenses · Assets · Inventory · Inbox**

Written before execution. Desktop first, then mobile, then the numbers.

---

## A · Structure

- [x] **A1** Tabs, KPI tiles, and which endpoint feeds each
- [x] **A2** Per-tab controls: filters, tables, row actions, dialogs
- [ ] **A3** The Inbox / review flow and the WhatsApp card

**A1 — the money model as built** (`ledger_summary`)

| Figure | Computed as |
|---|---|
| `total_spend` | Σ all expenses (paid *and* unpaid) |
| `paid` | Σ expenses with `status == paid` |
| `outstanding` | `total_spend − paid` — money **we owe** |
| `revenue_billed` | Σ invoices where `type == sales_invoice` |
| `revenue_received` | Σ payments where `direction == in` |
| `revenue_outstanding` | Σ remaining on unpaid sales invoices — money **owed to us** |
| `net_profit` | `revenue_billed − total_spend` |
| `asset_value` | Σ `purchase_amount` |
| `inventory_value` | Σ `value` |

All queries all-time, each capped `.to_list(5000)`.

## B · Desktop — every category, every button

- [x] **B1** Overview tab: six KPI tiles, each one's link target
- [x] **B2** Revenue tab: All / Awaiting / Partial / Received / Overdue filters, table, row actions
- [x] **B3** Expenses tab
- [x] **B4** Assets tab
- [x] **B5** Inventory tab
- [x] **B6** Inbox tab (review panel)
- [ ] **B7** Automated sweep: press every control, descend into dialogs

## C · Mobile

- [x] **C1** Mobile tab bar and mobile KPI tiles
- [ ] **C2** Same six categories at 390×844
- [ ] **C3** Layout: overflow, tap targets, contrast, anything clipped or covered

## D · Do the numbers add up — the headline

- [x] **D1** Recompute every KPI from raw records and compare with the API
- [x] **D2** Cross-tab consistency: does the Revenue tab's Billed match the
      Overview tile? Do the status filter counts sum to All?
- [x] **D3** `net_profit` — is `billed − spend` what a user reads "net profit" as?
- [x] **D4** Two different "Outstanding" figures (we owe / owed to us) — are they
      distinguishable on screen?
- [x] **D5** Currency and rounding: formatting, negatives, large values
- [x] **D6** Time window: is any of this "this month", or all-time like Ops?

## E · Buttons

- [ ] **E1** Every button pressed, both viewports, mutations blocked
- [ ] **E2** Row actions (mark paid, match payment, edit, delete)
- [ ] **E3** Every dialog opened and its fields checked

## F · Report

- [x] **F1** File findings in `DecisionOS_UI_Bug_Report.xlsx`
- [x] **F2** Commit, push, hand back

---

## Outcome

**The arithmetic is correct.** All eight headline figures reconcile to the paisa
against a recomputation from raw records, and the same figure agrees across
tabs. All six tabs work.

Five findings, three of them High, and all three are about what the numbers are
*called* rather than how they are computed:

- **FN-01** rupees grouped the Western way (`Rs 2,685,000` not `Rs 26,85,000`),
  via a private formatter with an undefined locale — so it also varies by the
  viewer's browser. `lib/format.js` already exports the correct helper and its
  docstring already forbids exactly what Ledger.js does.
- **FN-02** the mobile hero shows the all-time net profit under a "This month" chip.
- **FN-03** the Revenue and Net-profit trend badges are computed from the monthly
  **expense** series. "Revenue down 22.1%" is spending falling.
- **FN-04** "Net profit" is billed minus all expenses — no COGS, no inventory,
  assets ignored.
- **FN-05** no time window anywhere, which is what leaves FN-02 nothing to bind to.

**Still open:** the automated control sweep (B7 / E1-E3) was still running when
this was written; row actions and dialogs are therefore catalogued from source
but not yet pressed. C2/C3 mobile per-tab detail also pending that run.

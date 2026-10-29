# Finance periods follow your financial year

Epic 11 · Sprint 9 · Feature · 2026-10-29

## What's new (announcement)

**Finance now works in your company's financial year.**

- **Finance › Overview opens on your financial year** (FY 2026–27), not the last 30 days. Every record dated in the year counts — including invoices you enter today with an older date.
- **Pick any quarter or half.** One tap on the period button opens a panel: choose *Financial year*, *Half year*, *Quarter*, *Last 30 days*, *Custom range* or *All time*, then which one — Q1, Q2, Q3, Q4 · H1, H2 · this year or last year · your own From–To dates.
- **Look back at earlier years.** The ◀ FY 2026–27 ▶ switcher steps back through every year you have records for, so last year's Q4 is one tap away on 1 April.
- **Set when your year starts.** Settings › Company details › *Financial year starts in* (April unless you change it). Quarters, halves and labels follow it: a January year reads "FY 2026" with Q1 = Jan–Mar.
- **Fair comparisons.** The up / down figure on each tile compares like with like: a quarter still running against the same point of the last quarter; a finished quarter against the whole of the one before.
- **It rolls over by itself.** At midnight on the last day of the year, Finance moves to the new year — no setting to change, even with the page left open.
- **One period for all of Finance.** Pick it on Overview, Revenue or Expenses and all three follow: the lists and the Billed / Received figures show that period. Assets, Inventory and the Inbox — what you own and what's waiting — always show everything.
- **Money owed is never hidden.** Outstanding and Overdue always count every unpaid invoice, whatever its date; when a period leaves some out, Revenue says so ("1 unpaid invoice (₹40,000) dated outside this period") with *Show all dates*. Bills to pay and payments to match are never filtered.

## Also in this sprint: a bill is read, then confirmed (2026-10-30)

In **Add income / expense / asset / stock**, attaching a bill no longer files whatever the AI reads. The AI reads it as soon as it's attached and **fills in the form** — each value it found is highlighted and tagged **AI** until you change it, and a note says how many fields it filled (or why it couldn't, for example when AI is switched off). Check, correct, then **Save**: the record is exactly what's on the form, with the bill attached. Nothing reaches the books unchecked.

How: `POST /ledger/read-bill` stores and reads the bill and returns the fields — it saves no record. Save sends the checked values with the stored bill's path (`attachment_path`), so it's attached without being read again; only this company's ledger uploads can be named. `ai_read=false` attaches a bill sent with Save without reading it. Older app builds that send the file on Save still have it read as before. Frontend: `useBillReader` and `BillNote` in `pages/finance/FinanceForms.jsx`. Tests: `backend/tests/test_finance_bills_are_read_then_confirmed.py`.

## Why

A client added records and "nothing changed" on Revenue, Received or Profit. The records were saved: the Overview defaulted to *Last 30 days* and counts a record by the date written on it, so an invoice entered today but dated in July sat outside the window. Businesses think in financial years, quarters and halves; the page now does too.

## How it works

Frontend only, plus one company setting.

| Piece | Where |
|---|---|
| Company setting `fy_start_month` (1–12, unset = April) | `models/tenant.py` `TenantUpdateInput`, saved by `PATCH /tenant` (`routers/tenant_settings.py`); Settings › Company details (`components/CompanyDetails.js`) |
| Period values | `fy` (the current year — relative, so it rolls over), `fy:YYYY`, `q1..q4:YYYY`, `h1|h2:YYYY` (a year-stamped pick keeps meaning that period), `30d`, `all`, `custom:FROM:TO`. Values saved by older versions (`q3`, `half`, `90d` …) still open. |
| The window for a value | `periodWindow(value, fyStartMonth, now)` in `pages/finance/ledgerMath.js`: start, end (today for a running window; the window's own end for a finished one), the comparison window, the label ("Q2 FY 2026–27"), the date range |
| The figures | `financeMetrics` sums each tile over the window; asset and stock value for a finished window are what they stood at when it ended |
| The picker | `pages/finance/PeriodPicker.jsx`: kind, then which one; a year switcher back to the oldest record (`periodChoices`, `oldestRecord`); periods that haven't started are shown but can't be picked; a custom range can't pass today |
| Rollover | nothing names a year; `Ledger.js` `useToday()` notices the date changing (every minute and on returning to the tab); a choice lasts the visit (`sessionStorage`), every new visit opens on the current year |

| One period across tabs | `Ledger.js` `PERIOD_TABS` (overview, revenue, expenses) show the picker; the window goes to `RevenueTab` / `ExpensesTab` (`FinanceRecords.jsx`), which filter with `inPeriod`; `PeriodLine` says which period, how much of the list, unpaid invoices outside it, *Show all dates* |
| Boundaries | a period includes its first moment and stops before its end (an invoice dated 1 April is in the year that starts that day); a running quarter counts everything dated inside it, next week's invoice included |

Invoice numbering keeps the April–March GST year regardless of the setting.

## Tests

- `backend/tests/test_finance_period_dates.py` — runs the real period code under Node on fixed dates: the change at midnight on 31 March (and last year's Q4 complete and pickable on 1 April), January and July years, a leap-year February, old saved choices, a custom range capped at today, each period counting only its own records.
- `backend/tests/test_finance_periods_follow_the_financial_year.py` — the setting's range and save, the picker's kinds and year switcher, the page wiring.
- Checked in the browser on the demo workspace (desktop and phone): every kind, Q1–Q4, H1–H2, last year's quarters through the switcher, a custom range, the Settings field relabelling the periods.

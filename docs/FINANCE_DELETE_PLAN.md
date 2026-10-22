# Finance delete — plan (client request, 2026-10-22)

**Status:** Built and checked 2026-10-22, pushed with the Epic 11 trackers. Tracked as **Epic 11 — New Features, Sprint 5**, `docs/DecisionOS_Epic11_New_Features.xlsx` (NF-5.1 … NF-5.8) — 8 of 8. The bugs the old delete had are **Sprint 4 — Bugs**, NF-4.11.

**As built — worth knowing:**
- Every Finance delete — one row, a selection, an import undone, everything — goes through `backend/services/finance_trash.py` (its header holds the rules) and `routers/finance_trash.py`. The old `DELETE /expenses|assets|inventory|revenue/...` endpoints are kept and route through it.
- Nothing is lost: rows are copied into `finance_trash_rows` under one batch before they leave the books, and **Recently deleted** puts a batch back for **30 days**; the scheduler empties older ones (`purge_expired`).
- Checked in the browser at phone size on the local copy, and on the Android emulator: undo a made-up Tally import and put it back; select two invoices, delete, Undo from the toast; Delete everything's dialog (download, then type the name).

## The ask (client)

The client imported records from Tally that were wrong and needed to re-import them, but there was no way to delete in Finance except one record at a time — they asked us to delete from the backend. Founder: owner or Finance should be able to delete — select and delete, or delete all.

## What happened before (checked in the code)

- One tap on the bin deleted the row on the spot: no question, no undo, no record of who.
- A deleted payment left its invoice marked **received**; a deleted invoice deleted a payment **split across other invoices**, leaving those marked paid; a deleted expense left its supplier bill in **Bills to pay** and its asset behind; Dex kept quoting deleted records (Brain notes).
- Supplier bills and payments made could not be deleted at all.
- `_next_number` is the highest number + 1, so deleting the latest issued invoice handed its number to the next one.
- Re-importing from Tally without deleting first counts everything twice (no duplicate check on CSV).

## What it does

1. **Ask first.** `POST /api/finance/delete/preview` says what goes with what was picked (a bill's expense and stock, an expense's asset, a payment applied only to invoices that go) and what changes on what stays (an invoice owed again, a payment back to Needs matching, a request told its expense was deleted). The sheet shows it; Delete then `POST /api/finance/delete`.
2. **Select and delete** on every Finance list (sales invoices, payments received, expenses, payments made, assets, stock): Select, tick, a bar above the dock. A supplier bill has its own bin.
3. **Undo this import** on each filed upload (Money › Inbox › Filed): everything the import filed — invoices, bills, payments and their matches, the expenses and stock booked from bills, contacts it added that nothing else uses, follow-up tasks nobody started. The card then says Undone, with Put back.
4. **Recently deleted** (Finance › ⋯) lists the last 30 days with Put back; the toast after a delete has Undo.
5. **Delete all Finance records** (owner only): a copy first — a one-time link to the books as a spreadsheet — then the company's name typed. Contacts, tasks and requests are not touched.
6. **Issued GST invoices are left alone** by default: one raised in DecisionOS is a tax document already with the buyer; cancel it with a credit note. The owner can override; the number is retired and never issued again. Imported invoices are copies of another system's books and go freely.
7. Owner and Finance only, as for every Finance record; an activity row and an audit row per delete.

## Tests

`backend/tests/test_finance_records_can_be_deleted_and_put_back.py` — a payment's invoice owed again and put back; a split payment keeps its other invoice; a bill-backed expense takes the bill and asset; issued GST invoices kept, owner-only override, the number never reissued; an import undone and put back (contacts used elsewhere kept); delete everything needs owner, copy and name; 30 days then 410 and purge; every route behind the Finance gate; and the screens.

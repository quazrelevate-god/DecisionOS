# Everything links to CRM — Epic 11 Sprint 12

**Founder, 2026-10-31:** "From the Decision Desk it has to be connected with CRM, Finance, the team, the calendar … when they say something about a supplier or a customer it should be connected … if data is missing we let them know and ask them to add it." The approach was agreed: create the record automatically, marked **Needs details**, and ask for the rest.

## Where it stood (dev data, 2026-10-31)

| | Linked to a CRM record |
|---|---|
| Finance (invoices, payments, bills) | Nearly all (Tracole 594 of 597 invoices) — a bill finds or makes the contact |
| Workflows | Rarely (Tracole 3 of 122; 114 have the party typed as text) |
| Decisions | Never (0 of 486) |
| Tasks | Never (0 of 2,009; Tracole has 647 whose title names a CRM party) |
| Calendar meetings | Never |

The customer/supplier page found tasks and decisions by searching titles for the name (so "Ravi Traders" picked up the employee Ravi's tasks) and opened only with Finance access.

## The eight pieces

| # | What | Where |
|---|---|---|
| NF-12.1 | **One matcher** decides "who is this?" for Dex, New Task, the old-data review — and Finance's bill import falls back to it, so a party is never made twice | `services/parties.py` |
| NF-12.2 | **Dex names the party** of every task, meeting and workflow, and its kind (customer, dealer, supplier, prospect); the task's own words are scanned for CRM names as well | `prompts/extraction` 1.5, `services/voice.build_proposal` |
| NF-12.3 | **The review shows it** — "Kumar Exports · Customer" / "New: Kumar Exports · Customer · details needed" / "Which Kumar?" — and the party dialog changes it | `DecisionDialog`, `DexReview`, `components/party/*`, `PATCH /decisions/{id}/proposal/party` |
| NF-12.4 | **Approval links everything** — tasks, meetings, the workflow card, the decision; a new party becomes one CRM record marked Needs details; nothing is created on reject | `services/parties.settle` |
| NF-12.5 | **Needs details** — a Desk card, a prompt when the task is finished, a CRM filter; the flag clears when a phone number is saved or the person says it is done | Desk, My Work, CRM |
| NF-12.6 | **New Task's "Customer / supplier" field** — search, or add new right there; the title is read as it is typed and the party offered in one tap; the drawer can change it | `NewTaskDialog`, task drawer |
| NF-12.7 | **The customer/supplier page reads links, not names**, and opens for CRM access (money stays Finance-only); party chips on tasks and decisions open it | `contact_profile`, `ContactProfile`, chips |
| NF-12.8 | **Old data: a review list** — "these tasks name Nippon Audiotronix — link them?", approved in one go, never silently | `GET/POST /crm/link-suggestions`, CRM page |

## Every edge case, and how the user stays in control

The rule throughout: **Dex proposes, the person decides, and nothing new reaches CRM without passing the review.** Every guess is shown with what it was based on, and every guess can be changed in one tap.

| Edge case | What Dex does | What the person sees and can do |
|---|---|---|
| **Name variants** — "Toyota" for "Toyota Kirloskar Pvt Ltd", "Kumar Exports" for "Kumar Exports Pvt. Ltd.", "M/s", "Ltd", spacing | Normalises (drops Pvt/Ltd/M/s/the…) and matches whole words; one firm containing the other's identifying words is the same firm; a close spelling (≥ 0.86 alike) counts | The chip says the CRM name, with "matched from 'Toyota'" so a wrong match is visible; tap to pick another |
| **Mishearing / a new name** | Not in CRM → **New**, never silently created | Amber chip "New: … · details needed"; the dialog searches CRM as you type, so "Kumar Export House" is found if it is really "Kumar Exports" |
| **Two or more matches** ("Kumar" with Kumar Exports and Kumar Textiles) | Does not guess: **Which one?** with the candidates, the same kind first | The dialog lists them with their kind and phone; one tap picks; "Neither — add new" is there too |
| **Generic words only** ("the exporters", "Traders") | Generic words (exports, traders, mills, industries…) never match on their own | No chip; nothing wrong is linked |
| **An employee with the same name** (Ravi vs Ravi Traders) | A name that is one of the team (and says nothing more) is the team, not a party; a CRM record whose whole name is just a team member's name is never matched from free text | No chip for "tell Ravi"; "Ravi Traders" still links |
| **Our own company named** | Never a party (the same guard Finance uses) | — |
| **One company that is both customer and supplier** | Links the record that exists; does not make a second | The chip notes "in CRM as a supplier"; nothing else to do |
| **Several parties in one task** ("collect from these 4 customers") | Marks it **several** with each name found | "4 customers named — Split into 4 tasks" (one tap: one task per customer, each linked) or pick one |
| **A person at a company** ("call Sajith from MK Associates") | Links MK Associates; Sajith is offered as a contact person there | The dialog shows "Sajith — save as a contact at MK Associates" (on by default, can be turned off) |
| **A prospect** ("met a new buyer at the expo") | Kind = prospect → a customer record with status Lead | The kind picker: Customer · Dealer · Supplier · Prospect |
| **Wrong kind** (Dex said supplier, it is a dealer) | — | The kind picker in the dialog; it changes what the new record is |
| **Not a customer or supplier at all** ("fix the AC at the Erode office") | Internal work gets no party | "Not a customer or supplier" in the dialog removes the chip |
| **The same new name in several tasks** | One party key per name in the decision | Resolving it once resolves it on every task naming it; one CRM record is made |
| **Approving with a question left open** (Which one? / several) | Approval never stops silently | A dialog before approving lists the open questions: "Pick now" or "Approve and link later" (those tasks stay unlinked and appear in the old-data review) |
| **Rejected decision** | Nothing is created in CRM | — |
| **Approved twice / two people at once** | The record is found again at approval (by the matcher), so a second approval links, never duplicates | — |
| **A task Dex reuses** ("Use that task") | Gets the party if it had none; never changes one it has | — |
| **Somebody without CRM access** creates work for a customer | Can search names to link work (name and kind only); a new party still becomes a Needs-details record | The owner and CRM people see it in Needs details |
| **Missing details** | The record is marked Needs details, with what was said (name, kind, the person, which decision made it) | Desk card "3 new customers/suppliers need details"; a prompt when the task is done ("Add Kumar Exports' phone and GST?" — fill it there, or later); CRM filter; the flag clears when a phone number is saved, or "Done" |
| **Renaming a contact later** | Linked tasks, meetings and workflows follow the new name | — |
| **Old data** | Suggests links only where the whole CRM name appears (never an employee name) | One review list grouped by customer/supplier, all ticked; untick any; Link |

## Not in this sprint
Merging two CRM records that turn out to be one firm; a WhatsApp message to the new party asking for their details.

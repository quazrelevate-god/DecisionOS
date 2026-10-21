# Requests — build plan (web first)

**Status:** Web build shipped 2026-10-21 (58ce262). Tracked as its own epic — **Epic 11, Requests (new feature)**, `docs/DecisionOS_Epic11_Requests.xlsx`: 14 of 18, the 4 open items are Phase 3. (First filed as Epic 6 Sprint 26; moved the same day.) Client-facing version: `DecisionOS_Dossier/feature-plans/Requests_Feature_Plan.png`.

**As built — worth knowing:**
- **A General request is not financial** (Yokesh, 2026-10-21). It needs a yes and nothing else: the form has no amount, any amounts sent are dropped, and **approval closes it** — no expense is booked, Finance is not told, never lists it ("To pay") and cannot open it, and Mark paid is refused. On the card it reads "Approved" (not "Approved · to pay") and sits with the closed ones. Every other type still books the expense on approval.
- The expense category is matched in the **company's own words** (`services/staff_requests.pick_category`): a company whose AI-written list says "Raw Materials" or "Machine Maintenance" gets those, not "Other". Travel only takes a category that says travel (staff travel is not freight).
- There is **no high-value rule** (client decision: no amount condition). Finance's existing J7 owner-approval threshold applies to expenses typed into Finance, not to ones a request books — the request already had its yes. Revisit if the client wants a second approval above a value.
- Checked in the browser on a scratch database (Sharma demo): raise as a member → manager's Desk card → owner approves in Approvals → expense in Finance → Mark paid with stock in → request done, both items in inventory at the right unit cost.

## What it is

An employee asks for something they need — material, a reimbursement, an advance, travel, equipment, a repair, or anything else — in **one request with one or many items**. The person they choose approves it. On approval **an expense is created in Finance automatically**, and Finance marks it done when it is paid or bought.

A request is not a task (work to do) and not a decision (a directive from above): it is a bottom-up ask that needs a yes and then fulfilment.

## Decisions (client, 2026-10-21)

| Question | Answer |
|---|---|
| Who approves | The requester picks in the form: **reporting manager (default)** or **owner**. No amount rule. |
| Fulfilment | Approval **creates the expense** in Finance, linked to the request. |
| Types | Purchase & materials · Expense reimbursement · Advance · Travel · Equipment & assets · Repairs & services · General request |
| Items | Many items per request; the total is the sum. |
| Commercials | Out of scope for this plan. |

## Flow

```
pending ──approve──► approved ──fulfil / expense paid──► fulfilled      (money types)
pending ──approve──► approved  (General: the end — nothing goes to Finance)
   │  ▲
   │  └─respond── info_requested ◄─request-info──┘
   ├──reject (reason required)──► rejected
   └──withdraw (requester, before a decision)──► cancelled
```

An **owner's own request** is recorded already approved (nobody above them), the same rule leave follows.

## Backend

| Piece | Where | Notes |
|---|---|---|
| Models | `models/staff_requests.py` | create input (type, title, items[], needed_by, reason, approver_choice, attachment_ids), note input, fulfil input |
| Rules | `services/staff_requests.py` | types + their expense-category hint, approver resolution (`manager` → reporting manager, falling to owner; `owner` → an owner who is not the requester), who may read / approve / fulfil, request numbering (`REQ-0001`, atomic per tenant), close-from-expense hook |
| HTTP | `routers/staff_requests.py` | `GET /api/requests?view=mine|approvals|fulfil|all`, `GET /api/requests/approver-options`, `GET /api/requests/{id}`, `POST /api/requests`, `POST …/{id}/approve|reject|request-info|respond|withdraw|fulfil` |
| Expense on approval | `routers.ledger.create_expense` (router → router, no new layering debt) | `source: "request"`, `request_id` stored on the expense; equipment uses `Asset Purchase` so a tracked asset is created too |
| Expense paid closes the request | `routers/ledger.py update_expense` | status → `paid` on an expense with `request_id` marks the request fulfilled |
| Stock in | fulfil with `add_to_stock` | purchase items with a quantity become inventory rows |
| Attachments | existing `POST /api/files` + `attachment_ids` | `routers/files.may_read_file` gains a request branch |
| Live refresh | `routers/pulse.py` | new `requests` signature |
| Indexes | `bootstrap/lifecycle.py` | tenant+created, tenant+requester, tenant+approver+status, tenant+status, unique tenant+number |
| Erasure | `services/tenant_wipe.py` | `requests` added on day one |
| Notifications | `push_notification` | approver on submit / answer; requester on approve / reject / question / fulfil; Finance on approval |

**Access.** Requester: their own. Approver (or their delegate): requests routed to them. Owner: every request, and may act on any pending one. Finance permission: approved and fulfilled requests (to pay or buy). Everyone else: 404.

## Web

| Piece | Where |
|---|---|
| `+` in My Work asks **New task** or **New request** (glass menu, the CRM add-menu pattern) | `pages/MyWork.js`, `components/requests/NewWorkMenu.jsx` |
| New request form: type chips, item rows with add/remove, live total, needed-by, reason, attach bill/photo, approver choice (manager default / owner) | `components/requests/NewRequestDialog.jsx` |
| Requests page: Mine · To approve · To fulfil · All, cards, detail sheet with timeline and the actions each person may take | `pages/Requests.js`, `components/requests/*` |
| Approvals hub gets a **Requests** tab; the Desk gets a **Requests** card when something waits on you | `pages/MyWork.js`, `pages/Desk.js` |
| Route, phone More tile, notification links, pulse keys | `App.js`, `components/mobile/AllAppsPanel.jsx`, `lib/notif.js`, `hooks/usePulse.js` |

## Verification

- `tests/test_staff_requests.py`: routing, access, numbering, approve → expense, atomic approve, reject needs a reason, respond / withdraw rules, fulfil → expense paid + stock, expense paid → request fulfilled, owner auto-approval, file access.
- Read-gate inventory, API-parity baseline, wipe-list drift test updated.
- Full suite green before any push; browser walk on a scratch database with messaging off.

## Later (not in this build)

Raise by voice through Dex · reimbursement read from a bill photo · spend reports · WhatsApp · the native app's own polish.

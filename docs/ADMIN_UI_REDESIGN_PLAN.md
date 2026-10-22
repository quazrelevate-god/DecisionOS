# Admin console — UI/UX audit and redesign plan

**Status:** All four phases (A–D) built and checked 2026-10-22 — Epic 11 Sprint 6, 18 of 20 items Done (see "What shipped" at the end). Screenshots before and after (1440 px, plus phone width) are in `docs/admin-ui-audit/` (`before-*.png`, `after-*.png`).
**Do not commit `docs/admin-ui-audit/`:** the AI Keys screenshot shows masked key fragments.

## What is there today

One page, `/admin`, with **17 tabs** in a single row of pills (`pages/admin/AdminPortal.js`, 13 section files, ~2,300 lines):

| Tab | What it does |
|---|---|
| Overview | 8 count tiles (workspaces, users, decisions, tasks, captures, workflows, people, tasks done) |
| Tenant 360 | Search workspaces/users → workspace detail (counts, AI spend, entitlements, health, members, recent activity, "View as tenant") |
| Impersonation | Live/past view-as sessions (started from Tenant 360) |
| Support | Support tickets, status filter |
| Reports | In-app reports (Google Play requirement), status filter |
| Billing | MRR, ARR, paying tenants, revenue, plan mix, reconciliation, every workspace with a plan dropdown |
| Observability | AI calls, error/fallback rate, latency, by provider/task, recent errors, outage timeline |
| Config | Sarvam voice stack, feature flags, AI model route per task (25) |
| Admins | My account (enable 2FA), add admin (email/name/role/password), admin list with role dropdown and remove |
| Announce | New announcement (title, body, level, audience, dismissible), list |
| Compliance | Find a workspace (export/DSAR/erasure), retention sweep (dry run / purge now) |
| Usage | AI calls, tokens, cost by provider and by workspace, period and provider filters |
| AI Keys | Provider keys (masked), update, test all |
| Workspaces | Table of every workspace with Suspend and Delete on each row |
| Users | Table of every user with Suspend and Reset access on each row |
| Audit Log | Admin actions |
| Health | Database, scheduler, Emergent key, key source per provider |

## What's wrong — findings

### Navigation and structure
1. **17 flat tabs in one scrolling row.** At 1440 px only 10 fit; Compliance through Health are off-screen and you have to scroll the bar to find them. No grouping, no order a newcomer could guess. *(every screenshot)*
2. **The open tab isn't in the address.** Refresh → back to Overview; you can't link a colleague to "this workspace" or "this ticket"; Back leaves the console.
3. **Workspaces are in four places**: Workspaces table, Tenant 360 search, Billing's workspace list, Compliance's "find a workspace". Users in two (Users, Tenant 360). AI health in three (Health, Observability, AI Keys — key source shown twice). AI cost in two (Usage, Observability) and in Tenant 360.
4. **Overview isn't an overview.** Eight raw counts, no trend, nothing that says what needs you: open tickets, reports to review, live impersonations, an outage, trials ending, failed payments, new sign-ups. *(before-01, before-00)*

### Visual language
5. **Monospace body text everywhere** — empty states, descriptions, table cells, labels ("No tickets.", "Changes apply with no redeploy…"). It's the retired brutalist style left behind; it reads like a debug tool next to the app's Urbanist. *(before-03/04/08/14/15/16)*
6. **The operating-system dropdown** for every select (plans, roles, status filters, model routes, Sarvam) — the rest of the app uses its own glass list (`GlassSelect`).
7. **Raw keys instead of words**: `super_admin`, `trial`, `grandfathered`, `brain.answer`, `request_approved`, `NOT_SET`, `ENV`, full UUIDs. *(before-06/08/09/17, before-02c)*
8. **The provider alert banner is full-size on every tab** (and a second copy inside Observability) — 70 px of red above everything, all day.
9. **Empty states say nothing useful** — bare "No tickets." / "No announcements." with no next step.
10. **Money in two currencies** — AI cost in $, billing in ₹.
11. **Contradictory numbers** — Tenant 360 shows "0 members", "4 users", "6 people" and a members list of 4 for the same workspace. *(before-02c)*

### Safety
12. **Destructive buttons on every row** — Suspend + Delete on all 21 workspace rows, Suspend + Reset on all 37 user rows; one slip on a long list deletes a company. Admin remove is a bare red icon. "Purge now" sits next to "Dry run".
13. **Plan changes straight from a dropdown in a list** (Billing) — no confirm, no reason, easy to change the wrong row.
14. **Admins**: adding an admin means typing a password for someone else (it then lives in chat/WhatsApp); 2FA is optional, offered as one small button.
15. **The login page's placeholder is a real-looking admin address** (`admin@decisionos.biz`) — it tells an attacker what to try.

### Scale
16. **No search, sort, filter or paging** on Workspaces and Users — fine for 21 workspaces on the scratch DB, not for the 105 in production. **Test workspaces (`TEST_*`) are mixed with customers** in Usage, Workspaces, Users and Billing, with no way to hide them.
17. **Phone**: the pill row scrolls sideways; the wide tables (Workspaces, Users, Usage) would overflow.

## Proposal

### 1. A console shell: grouped sidebar + addresses (17 tabs → 13 places in 6 groups)

| Group | Places | Merges |
|---|---|---|
| — | **Overview** | Overview |
| Customers | **Workspaces** (list → workspace page), **Users** | Workspaces + Tenant 360 + Billing's list + Compliance's search + Impersonation start |
| Support | **Support desk**, **Reports**, **Announcements** | — (Impersonation sessions move into the workspace page and Audit log) |
| Money | **Billing**, **AI usage** | Usage + the cost half of Observability |
| Platform | **Health**, **AI keys**, **Config** | Health + the reliability half of Observability |
| Security | **Admins**, **Audit log**, **Compliance** | — |

- Every place has an address: `/admin/workspaces/<id>`, `/admin/support/<ticket>` — refresh, Back and sharing work.
- **Find (Ctrl K)** — jump to any workspace or user by name, email or phone from anywhere.
- The provider alert becomes **one line in the shell** with a count on Health, not a banner on every page.

### 2. One workspace page instead of four lists
Workspaces list with search, sort, filters (plan, status, active in 7 days) and **Hide test workspaces** (on by default). Opening one gives a page with sections: Summary (health, last activity, counts that agree with each other), People, Billing (plan change with confirm + reason), AI usage, Data & compliance (export, DSAR, erasure), Activity, and **View as tenant**. Suspend/Delete live in a "⋯" menu with a typed confirmation.

### 3. An Overview that leads with what needs you
"Needs attention" (outages, open tickets, reports, trials ending, failed payments, live impersonations) → "Last 7 days" with change vs the week before (active workspaces, sign-ups, MRR, AI spend) → most active / most at-risk workspaces. Test workspaces excluded.

### 4. The app's own design language, finished
Urbanist for text (mono only for ids and keys), `GlassSelect` for every list, status chips in the app's chip recipe, human labels for roles/plans/tasks/events, ₹ everywhere (with $ in small print where the provider bills in $), empty states that say what to do next, one shared table (search, sort, paging, row → page, actions in a "⋯" menu).

### 5. Safety
Typed confirmation for delete/purge/erase; reason required for suspend and plan change (written to the audit log); admin **invite link** instead of a typed password; 2FA prompted on every sign-in until enabled (optionally required for super admins); neutral login placeholder.

## Phases (each ships on its own)

| Phase | What | Backend |
|---|---|---|
| A — Shell | Sidebar groups, addresses, Find, one-line alert, mono → Urbanist, GlassSelect, human labels, neutral login placeholder | none |
| B — Customers | Workspaces list (search/sort/filter/hide test/paging) + workspace page; Users directory; confirmations in "⋯" menus | small: list paging/filter params; a `is_test` mark for workspaces |
| C — Overview + Platform | Needs-attention Overview with 7-day deltas; Health merged with Observability; AI usage in ₹ | one summary endpoint |
| D — Safety | Typed confirms, reasons to the audit log, admin invites, 2FA prompt | invites + reason fields |

Rough size: A ≈ 1 day, B ≈ 2 days, C ≈ 1.5 days, D ≈ 1 day, each with tests and a browser check on a scratch database.

## What shipped (2026-10-22, Epic 11 Sprint 6)

| Phase | Shipped |
|---|---|
| A — Shell | `AdminPortal.js` rebuilt: sidebar of 13 places in 6 groups, an address for every place (`/admin/workspaces/<id>`, `/admin/support/<ticket>`), old tab names redirect, Find (Ctrl K), a one-line provider alert with counts on the sidebar, a phone menu. `adminUi.jsx` (shared table, chips, dialogs, Find) and `adminLabels.js` (every key in words). No `<option>` left in the console. |
| B — Customers | `services/admin_workspaces.py` decides which workspaces are ours; `POST /api/admin/tenants/{id}/test-flag`; test workspaces hidden by default. Workspaces list (search, status, plan, sort, paging), `WorkspacePage.js` (replaces Tenant 360; billing, AI, retention, exports, per-person data, view-as in one place; counts agree), Users directory. |
| C — Overview + Platform | `GET /api/admin/overview` (needs attention, 7-day deltas, customer-only MRR, most active, gone quiet, trials ending). Health carries Observability; Audit log carries view-as sessions. AI cost in rupees from runtime `usd_inr` (Config → Currency, default 84). |
| D — Safety | Reasons for suspend / plan change / view-as written to the audit log; typed-name delete with a copy first; `window.prompt` gone; delete is super-admin only; admin invite links (`/api/invites/admin/{token}`); the 2FA sign-in step that never appeared; backup codes that were never accepted; deactivated admins refused at sign-in; a 2FA prompt on every password-only sign-in; read-only admins see no write controls. |

**Found and fixed on the way:** the admin 2FA sign-in hung on "Loading console…"; admin backup codes were stored but never read; any admin could delete a workspace; Find passed what was typed to the database as a pattern.

**Still open:** (1) "View as" records an audited session and returns a token, but nothing in the UI uses the token, so an admin still can't see the workspace — it needs the tenant app to accept the read-only session. (2) Requiring two-step sign-in for super admins.

**Checks:** `tests/test_admin_redesign.py` (25 tests), admin route count 71 → 75, read-gate, API baseline; a browser flow on the scratch database passed 28/28 (2FA on / code / backup code / off; an invite accepted by a Support admin who is not offered Delete; suspend and plan change with reasons, then undone; typed delete; reasons in the audit log; mark as test and back; old addresses; refresh on a workspace page).

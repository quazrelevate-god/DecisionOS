# Admin console v2 — audit, ideas and plan

**Status:** Epic 11 Sprint 7. The founder approved the recommendations on 2026-10-23 (section 8 answered as proposed). **P1 data foundations built 2026-10-23** (F1–F4: sign-ins including the phone code, daily presence, the daily count per workspace kept for good, lifecycle events, milestones and activation), pushed in `1ea398d`. **P2 customers built 2026-10-23** (health score and stage, the customer list with views, columns, bulk actions and CSV, the customer page in tabs with timeline, usage, notes, tags, owner and follow-up), pushed in `a6a8215`. **P3 analytics built 2026-10-23** (Home with a ranked "needs you today", KPIs with trends and health movers from a daily health snapshot; Growth with the activation funnel and trial-to-paid; Engagement with daily/weekly/monthly active people and adoption by area; Retention cohorts; Revenue rebuilt month by month from plan changes with its movement and payments to chase; AI economics with cost against revenue), awaiting push; P4–P5 not started. Follows the first redesign (Epic 11 Sprint 6, `b6008d0`, see `docs/ADMIN_UI_REDESIGN_PLAN.md`).
**Asked for:** "ideate the complete application of the admin panel — elements, fonts, what is missing, what is required for managing all our customers, analytics. First audit, then UI, then plan."

The first redesign fixed how the console *looks and behaves* (sidebar, addresses, one workspace page, safer actions). This plan is about what it *knows*: today it can show a customer, but it cannot tell you which customers are healthy, which are slipping, whether new sign-ups ever reach value, or what each customer costs against what they pay. That is what an operator needs to run the business, and most of it needs data the platform does not record yet.

---

## 1. Who uses the console, and for what

| Who | Their questions |
|---|---|
| Founder / ops (super admin) | How is the business doing this week? Who is about to churn? Who should we call today? Are trials converting? Is AI eating the margin? |
| Support | Who is this person, what workspace, what did they just do, what went wrong? Reply fast, see the history. |
| Billing | Who paid, who failed, who is overdue, who is on a comp plan and why? |
| Read only (investor, advisor) | The numbers, without the buttons. |

Every screen below answers one of these.

---

## 2. Audit of the console today (after Sprint 6)

### What works
- One place per job, real addresses, Find (Ctrl K), safe actions with reasons in the audit log, test workspaces hidden, invites, 2FA that works.
- A workspace page that shows people, billing, AI spend, retention and activity together.

### What is weak in the interface
1. **Numbers without shape.** Every figure is a single number. There is no chart anywhere in the console — no trend line, no sparkline, no funnel, no cohort. "Active workspaces: 7" means nothing without last month beside it.
2. **The Overview ranks by raw action count.** "Most active" is a count of activity rows; one busy owner beats a whole team.
3. **Lists can't be shaped.** No column choice, no saved views ("trials ending", "paying but quiet"), no bulk actions, no CSV export.
4. **The workspace page is a long scroll.** Seven panels stacked; no timeline of what happened when; no notes; no tags; no owner (account manager).
5. **The fonts drifted.** The app moved to Nunito Sans on 2026-10-12 (Urbanist read too thin on a phone); the console inherits it but its sizes and weights were tuned for Urbanist, and numbers don't use tabular figures consistently.
6. **No dark mode, no density switch.** An ops console is kept open all day; a compact density and a dark theme are expected.
7. **Empty Overview on quiet weeks.** With few customers most tiles show 0; the page should fall back to a 30-day view and say so.

### What is missing to *manage customers*
| Need | Today |
|---|---|
| A health score per customer | none |
| Lifecycle stage (trial → activated → paying → at risk → churned) | only `plan` |
| Activation: did they reach first value (first decision, first task done, first teammate invited)? | not recorded |
| Logins / last seen per person | **not recorded for phone-OTP sign-in** (the main login path) |
| Daily / weekly / monthly active users, stickiness | not possible (sessions expire after ~7 days) |
| Which features each customer uses (Desk, Dex, Brain, Finance, Requests, WhatsApp…) | only write events in `activity` |
| Plan history, MRR movement (new / expansion / churn), trial conversion | plan is overwritten; no history |
| Failed-payment follow-up (dunning) | failures only logged |
| Notes, tags, account owner, next follow-up date | none |
| Customer timeline (sign-up, invites, plan changes, tickets, admin actions in one stream) | spread over 5 places |
| Support SLAs (first response, time to resolve) | not recorded |
| Feedback / NPS | none |
| Outbound messages sent to a customer (email, SMS, WhatsApp, push) | **not logged anywhere** |
| AI cost per customer against what they pay (margin) | cost yes, margin no |
| Seat usage vs plan limit | counted from `users`, not `memberships` (can be wrong for multi-company people) |

### Data that will be lost if nothing changes
Per-workspace retention can purge `activity`, `usage_events`, `notifications`, `voice_notes`, `brain_audit` after 30–365 days, and sign-up drafts expire after 30 days. Any trend we want to show for last year has to be **rolled up before it is purged**.

---

## 3. Data foundations (build these first — every chart depends on them)

| # | Foundation | What it records | Where |
|---|---|---|---|
| F1 | **Sign-in and last-seen** | Write `login_success` for phone-OTP sign-in too, record the session; requests only refresh their session (as before) and the scheduler turns sessions into presence days and `last_seen_at` stamps every 3 hours, so a request costs nothing extra | `routers/auth_otp.py`, `core/deps.py`, `services/auth/session_tracking.py` |
| F2 | **Daily roll-up** | One row per workspace per day: active people, sign-ins, actions by area (tasks, decisions, captures, finance, requests, Dex, Brain, WhatsApp), AI calls and cost, seats used, plan. Written by the scheduler at night; **never purged by retention** | new `tenant_daily` collection + `services/rollups.py` |
| F3 | **Lifecycle events** | `plan_changes` (from, to, by, reason, source: payment/admin/expiry), `suspended_at`/reason on the tenant, churn (plan → none or payment halted N days), trial expiry | `routers/billing.py`, `routers/admin_billing.py`, `routers/admin.py` |
| F4 | **First-value milestones** | On the tenant: `milestones.{first_decision_at, first_task_done_at, first_invite_at, first_capture_at, first_whatsapp_at, first_finance_at, first_brain_doc_at}`, set once | small hook in `log_activity` |
| F5 | **Who used the AI** | `user_id` and a real `feature` name on `usage_events` / `ai_calls` | `core/usage.py` callers |
| F6 | **Outbound message log** | Every email / SMS / WhatsApp / push sent: channel, template, tenant, user, status, created_at (no message body) | `services/email.py`, `services/otp.py`, `services/push_fcm.py`, `services/whatsapp.py` |
| F7 | **Support SLA stamps** | `first_response_at`, `resolved_at` on tickets | `routers/admin_support.py` |
| F8 | **Customer notes and tags** | `customer_notes` (author, text, pinned), `tenants.tags[]`, `tenants.owner_admin_id`, `tenants.next_follow_up_at` | new admin routes |
| F9 | **Feedback (optional)** | A one-question in-app NPS every 90 days per person, stored per tenant | new `feedback` collection |

F1–F4 unlock almost every analytics screen; F5–F9 deepen them. All are additive (no data migration), and F2 can **backfill** from whatever `activity` and `usage_events` still exist.

---

## 4. Information architecture v2

```
Home                       today: what needs you, the week in numbers, who to call
Customers
  All customers            list with health, stage, MRR, seats, last seen; saved views; bulk
  Customer page            Overview · Timeline · People · Usage · Billing · Support · Data · Notes
  People                   everyone with a sign-in, last seen, role, workspace
  Segments                 saved filters shared across the team ("Paying, quiet 14 days")
Analytics
  Growth                   sign-ups, activation funnel, trial → paid
  Engagement               DAU / WAU / MAU, stickiness, feature adoption
  Retention                weekly cohorts, logo and revenue retention
  Revenue                  MRR, MRR movement, ARPA, dunning
  AI economics             AI cost per customer vs revenue, by feature and provider
Support
  Inbox · Reports · Announcements · Outbound log
Platform
  Health · AI keys · Config · Jobs (scheduler, roll-ups)
Security
  Admins · Audit log · Compliance
```

---

## 5. The screens

### 5.1 Home (replaces Overview)
- **Needs you today** — one ranked list mixing: failed payments, trials ending in 3 days with low health, paying customers silent 7+ days, urgent tickets past SLA, provider outages, reports to review. Each row has the action next to it (Open, Email owner, Snooze).
- **This week** — KPI row with sparklines: MRR, paying customers, weekly active workspaces, new sign-ups, activation rate, AI cost / revenue.
- **Movers** — health went up most / down most this week.
- **Range control** (7 / 30 / 90 days) on everything; quiet weeks fall back to 30 days with a note.

### 5.2 All customers
- Columns (choosable): name, health (0–100 with a colored chip), stage, plan, MRR, seats used / limit, active people (7d), last seen, AI cost (30d), owner, tags, created.
- **Saved views** shared by the team: Trials ending, Activated but not paying, Paying and quiet, At risk, Over seat limit, High AI cost vs revenue.
- **Bulk**: tag, assign owner, mark as test, export CSV, email owners (asks first).
- Row hover shows a mini timeline; click opens the customer page.

### 5.3 Customer page (tabs, not one long scroll)
- **Header**: name, health dial, stage, plan, MRR, owner, tags, next follow-up; actions in "More".
- **Overview**: health breakdown (why the score is what it is), activation checklist (milestones with dates), 30-day activity chart, seat meter, open tickets.
- **Timeline**: one stream — sign-up, people invited/joined, plan changes, payments, tickets, announcements seen, admin actions, AI errors — filterable.
- **People**: each person's role, last seen, sign-ins (30d), what they use; invite status.
- **Usage**: feature adoption grid (Desk, Tasks, Decisions, Dex, Brain, Finance, Requests, WhatsApp, Captures) × weeks; AI usage by feature.
- **Billing**: plan history, payments, invoices, failed attempts, comp/discount with reason; change plan.
- **Support**: tickets, reports, complaints, outbound messages sent to them.
- **Data**: retention, exports, DSAR, erasure.
- **Notes**: pinned notes, call log, follow-up date.

### 5.4 Analytics
| Screen | Charts |
|---|---|
| Growth | sign-ups per week (bars); **activation funnel**: signed up → finished setup → first decision → invited a teammate → 3 active days in week 2 → paying; trial-to-paid rate by week |
| Engagement | DAU / WAU / MAU lines; stickiness (DAU/MAU); **feature adoption heatmap** (feature × week, % of active workspaces); top workspaces by active people (not raw actions) |
| Retention | **weekly cohort grid** (sign-up week × weeks since, % still active); logo retention and net revenue retention |
| Revenue | MRR line; **MRR movement** bars (new, expansion, contraction, churn); ARPA; plan mix over time; dunning list |
| AI economics | AI cost vs revenue per customer (scatter, flag where cost > 30% of revenue); cost by feature and provider over time; cost per active person |

### 5.5 Health score (first version, explainable)
Score 0–100 from five parts, each shown on the customer page so nobody has to trust a black box:
| Part | Weight | Signal |
|---|---|---|
| Activity | 30 | active people in the last 7 days vs seats |
| Breadth | 20 | features used in the last 14 days (of 8) |
| Momentum | 20 | this 14 days vs the previous 14 |
| Setup | 15 | milestones reached |
| Friction | 15 | minus open tickets, failed payments, AI errors |

Bands: 70+ healthy (green), 40–69 watch (amber), below 40 at risk (red). Weights live in Config so they can be tuned.

---

## 6. Design system for the console

### Fonts
| Role | Face | Notes |
|---|---|---|
| Interface and headings | **Nunito Sans** (the app's face since 2026-10-12) | weights 400 / 600 / 700; headings 600, not 700 |
| Numbers in tiles and tables | Nunito Sans with **tabular figures** (`font-variant-numeric: tabular-nums`) | columns line up; the KPI number 28–32 px |
| IDs, keys, money columns in exports, log lines | **IBM Plex Mono** (already loaded) | 12–13 px, never for body text |

Type scale (px): 12 caption · 13 table · 14 body · 16 section · 20 page title · 28/32 KPI. Labels in sentence case (the current uppercase micro-labels go), 0.01em tracking.

### Color
- Neutral greys with a cool bias (the app's ground), **one accent for actions** (ink), and the **console red kept only for the mark and for danger** so it never looks like a tenant screen.
- Semantic: green healthy, amber watch, red at risk / failed, blue information — always with a word or icon, never color alone.
- Charts: one hue for single series (sequential), a fixed categorical order for multi-series, grey for context.

### Layout and density
- Sidebar 240 px (collapsible to icons), page max 1440 px, 12-column grid, 24 px gutters.
- **Density switch**: comfortable (default) / compact (tables 36 px rows) — remembered per admin.
- **Dark mode**, because the console stays open all day.
- Right-hand **detail drawer** for quick looks (a person, a ticket, a payment) without leaving the list.

### Components to add (on top of `adminUi.jsx`)
KPI tile with sparkline and delta · trend chart (line/area, range control) · stacked bar · funnel · cohort heatmap · adoption heatmap · health dial and chip · meter (seats, quota) · timeline · saved-view tabs with counts · column chooser · bulk-action bar · detail drawer · notes editor · CSV export. Charts with **recharts** (already in the app), no new library.

---

## 7. Plan (proposed as the next Epic 11 sprint, after checking the latest sprint number on origin)

| Phase | What | Backend | Size |
|---|---|---|---|
| **P1 — Data foundations** | F1 sign-in + last seen (incl. phone OTP), F2 daily roll-up with backfill, F3 plan/suspension history, F4 milestones | yes | 3 days |
| **P2 — Customers v2** | health score, stage, all-customers columns + saved views + bulk + CSV, customer page tabs with timeline and activation checklist, notes / tags / owner (F8) | yes | 4 days |
| **P3 — Analytics** | Growth, Engagement, Retention, Revenue (MRR movement), AI economics; Home with "needs you today" and sparklines | roll-up queries | 4 days |
| **P4 — Support depth** | F6 outbound message log, F7 SLA stamps, SLA in the inbox, customer's messages on their page; optional F9 NPS | yes | 2 days |
| **P5 — Polish** | density switch, dark mode, detail drawer, keyboard shortcuts, empty/quiet states | no | 2 days |

Each phase ships on its own, with tests, the API baseline, a browser check on the scratch database, and the trackers updated in the same push.

---

## 8. Decisions needed from the founder
1. **Health score weights** — accept the first version above, or change them?
2. **Activation** — which milestone means "this customer got value"? (Proposal: first decision approved **and** a teammate invited, within 14 days.)
3. **Churn definition** — plan ends, payment halted for N days, or no sign-in for N days?
4. **Account owners** — do we assign an admin to each customer?
5. **NPS** — ask customers inside the app (F9), or not yet?
6. **Retention vs analytics** — keep the daily roll-up forever even when a customer's retention purges the detail (proposal: yes; it holds counts only, no content).
7. **Order** — P1 → P2 → P3 as above, or analytics before customer management?

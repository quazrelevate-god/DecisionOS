# DecisionOS — Page & Feature Map

> Compiled from a walkthrough of every React page under `frontend/src/pages/` cross-referenced against `App.js` routes and the API calls each page actually makes. As of **2026-08-13** (post FIX-FUP-51).

**How to read this doc**
- Each page block lists **route + gate**, **what the user does there**, and **backend endpoints hit**.
- "Gate" reflects both `App.js` `Protected` wrappers and inline `hasPerm(...)` checks inside the page.
- Endpoints under `/api/*` are shown without the `/api` prefix for brevity — every call actually goes through `axios` → `/api/…`.

---

## 1 · Public / Unauthenticated

### Landing — `/`
Public marketing site. Brand hero, "10-second wow" section, three-step story (Capture → Execute → Remember), proactive-intelligence teasers, AI-departments grid, footer CTA. Buttons only — sign in, sign up, download PDF vision doc.
**Endpoints** — none

### Login — `/login`
- Two-tab sign-in: **Email + Password**, or **Mobile OTP** (6-box entry, 30 s resend cooldown, "change number" reset).
- Handles `?invite=<token>` deep-link: auto-loads invite metadata, auto-sends OTP, autofills dev OTP.
- Dark-mode toggle + four one-tap **Sharma demo logins** (owner / sales / production / finance).
**Endpoints**
- `POST /auth/login`, `POST /auth/otp/request`, `POST /auth/otp/verify`
- `GET  /auth/invite/:token`, `POST /auth/invite/:token/start`

### Signup — `/signup`
Four-phase founder onboarding with an animated phase bar. On finish → routes to `/brief`.

| Phase | Sub-page | What happens |
|---|---|---|
| 1 | **BasicsFlow** | 6-step conversational form (company, founder, email, password, phone, team size) |
| 2 | **WebsiteIntel** | URL scan → confirm extracted summary/highlights/products, or manual industry + B2B/B2C fallback |
| 3 | **VoiceInterview** | 11 Sarvam Indic voices; "Dex" AI COO conducts a spoken interview with pause/resume/mute/back/skip |
| 4 | **BuildReveal** | Generates OS blueprint (departments, workflows, tasks, approval rules, products); voice/text refine loop; commit → register → reveal animation |

**Endpoints**
- Phase 1: `POST /signup/check-email`
- Phase 2: `POST /signup/website-intel`
- Phase 3: `POST /signup/interview/start | /answer | /back`, `POST /signup/tts`, `POST /signup/stt`
- Phase 4: `POST /signup/interview/blueprint`, `POST /onboarding/os-blueprint` (fallback), `POST /signup/interview/refine`, `POST /auth/register`

---

## 2 · Bottom-nav — everyday surfaces

These are what most users see day-to-day. Bottom-nav order: **Desk · Brief · Work · People · Brain**.

### CEOBrief (BRIEF tab) — `/brief`
**Gate** — logged in
- Period tabs (**Morning / Evening / Weekly / Monthly**), auto-refresh every 30 s.
- **Owner grid** — 9 KPI cards: delayed tasks · completed · awaiting approval · absent · complaints · payment overdue · overdue receivables · supplier bills to pay · unmatched payments. Plus a "Fires today" hero card and shortcuts to Operating-Score + CEO Journal.
- **Employee grid** — 6 KPI cards: overdue · in-progress · to-do · completed · escalated to me · handed to me. Plus AI-Coach shortcut.
- Tap any KPI → drill-down dialog. Owner can **approve/reject decisions inline**, sales/owner can **resolve complaints**, every item deep-links to the underlying task / decision / workflow / ledger / leave.

**Endpoints**
- `GET  /brief?period=…`, `GET /brief/details?key=…&period=…`
- `POST /decisions/:id/approve`, `POST /decisions/:id/reject`
- `PATCH /complaints/:id/resolve`

### Inbox (DESK tab) — `/inbox`
**Gate** — `perm="inbox"`
- **Three capture ways** (for users with `voice_capture` or owner):
  1. **Mic recorder** — pause/resume/finalise/cancel, language auto-detect, attach files & photos.
  2. **Text directive** — with pre-submit AI clarify Q&A round-trip.
  3. **Multi-file / photo upload** — "Analyse & structure".
- Live "Thinking" overlay + "Structuring" sticky banner while notes process. Execution-summary popover on completion with "Review & assign".
- **Owner-only "Decision approvals" grid** — pending decisions with inline reassign (per member/role), attach reference, require-proof toggle, "Add team member/task" mini-form, Approve / Reject, "Discuss" opens DecisionDialog.
- "Needs attention" grid — escalations & handoffs with inline reply.
- Unified activity feed with class chips (customer / supplier / invoice / payment / complaint / task / approval / reminder), swipe-to-dismiss on mobile, quick actions (Approve · Board · View · Done · Dismiss). Deep-links: `?focus=approval:<id>`, `?attention:<id>`, `?decision=<id>`.

**Endpoints**
- Reads: `GET /voice-notes`, `GET /inbox`, `GET /decisions`, `GET /tasks?mine=true`, `GET /users`
- Capture: `POST /voice-notes` (multipart), `POST /voice-notes/text`, `POST /capture/clarify`, `POST /files`
- Decisions: `POST /decisions/:id/approve|reject`, `POST /decisions/:id/tasks`
- Tasks: `POST /tasks/:id/reassign|respond|attachment`, `PATCH /tasks/:id`, `POST /inbox/:id/status`

### MyWork (WORK tab) — `/my-work`
**Gate** — logged in
- **Three top-level views**: **My Work** (task list) · **Workflows** (Pipelines + Task Board sub-tabs, gated by owner or `workflows` perm) · **Leave** (embeds Leave page).
- **Task list features**: category tabs from tenant operating model + Completed; owner scope toggle (My/All); **AI-Priority** sort with inline score bars.
- **Task card** — rich status + progress dropdowns; **evidence upload** (photo, file, voice recording with pause/cancel/discard); reference block with AI-read insights; activity & handoff trail with escalate / handoff / note; approval flow (Approve / Request changes / Ask clarification); **AI Execution Plan** (generate / manual / add / reorder / edit / accept; per-step "Ask AI" + step-level Update / Handoff / Escalate); full-details dialog with photo lightbox; owner-only delete.
- Deep-links: `?task=<id>` scrolls & highlights; `?view=board|workflows|leave`.

**Endpoints**
- Reads: `GET /tasks?mine=…`, `GET /tasks/:id`, `GET /users`
- Prioritise: `POST /tasks/prioritize`
- Task actions: `POST /tasks/:id/updates|approve|reject|clarify|attachment`
- Execution plan: `POST /tasks/:id/execution-plan/generate`, `POST /tasks/:id/steps/ask`, `PATCH /tasks/:id/execution-plan`, `DELETE /tasks/:id/execution-plan`
- CRUD: `PATCH /tasks/:id`, `DELETE /tasks/:id`

### People (PEOPLE tab) — `/contacts`
**Gate** — `perm="people"` *(opt-in as of FIX-FUP-51 — even sales/finance need explicit grant; owner always passes)*

Three-tab People page (labels personalised via tenant lexicon):

| Tab | Renders | Who sees it |
|---|---|---|
| **Employees** | TeamPanel (see below) | `team_manage` perm only |
| **Customers** | ContactsPanel (types = customer, dealer) | anyone with `people` |
| **Suppliers / Vendors** | ContactsPanel (type = vendor) | anyone with `people` |

**ContactsPanel** — card grid filtered by type / status / search.
- Owner + sales can add / edit / delete contacts.
- Owner + sales can **Log complaint** on a customer via ComplaintDialog.
- Finance + owner (`finance` perm) get an Eye button → `/contacts/:id`.

**TeamPanel** — member list with role chip, absent chip (from `/attendance`), permission count.
- `team_manage`: Add Member dialog (name, email, password OR passwordless-OTP toggle, phone, role, reporting manager, per-permission grid + live "menu preview"); Edit Access dialog; per-row **Invite** (opens WhatsApp/shareable link modal), Mark absent/present toggle; owner-promotion/demotion confirmations.

**Endpoints**
- Contacts: `GET /contacts?type=&status=&q=…`, `POST /contacts`, `PATCH /contacts/:id`, `DELETE /contacts/:id`, `POST /complaints`
- Team: `GET /users`, `POST /users`, `PATCH /users/:id`, `POST /users/:id/invite`, `GET /attendance`, `POST /attendance`

### ContactProfile — `/contacts/:id`
**Gate** — `perm="people"` (route) + `perm="finance"` (page body)

360° dossier for a single contact:
- Header + financial stat tiles (outstanding · billed · paid · open complaints).
- **AI Relationship Intelligence** card with Score-with-AI / Re-score (relationship + risk scores, signals, reasons).
- Tables of invoices · payments · vendor-only pending deliveries & price history · follow-up tasks · complaints · linked decisions.

**Endpoints** — `GET /contacts/:id/profile`, `POST /contacts/:id/rescore`

### Brain (BRAIN tab) — `/brain`
**Gate** — `perm="brain"`

Three sub-tabs:

- **Ask** (AskPanel) — conversational AI with suggested prompts, streaming answer that may render KPI grid + data table (≤100 rows), clickable sources with deep-links, follow-up chips, export bar (CSV / Excel / PDF), permission-denied and insufficient-data variants, mic dictate, "clear conversation".
  **Endpoints** — `POST /ask`, `POST /brain/export`
- **Search** — four-column semantic search over decisions / tasks / workflows / contacts + optional memory notes; finance-restricted banner when applicable.
  **Endpoints** — `GET /brain/search?q=…`
- **Documents** (DocumentsPanel) — search + kind filter. Owner + `team_manage` can Add document (file, title, kind, tags, visibility: public/dept/private, department, roles-allowed, summary). Card grid with visibility indicator, download for anyone with access, delete for owner or uploader.
  **Endpoints** — `GET /brain/documents?q=…&kind=…`, `POST /brain/documents`, `GET /brain/documents/:id/download`, `DELETE /brain/documents/:id`

---

## 3 · Owner-heavy surfaces (not in bottom-nav — reached via cards, deep-links, or Settings menu)

### Journal — `/journal`
**Gate** — owner only

Searchable **decision diary** grouped by day (Today / Yesterday / date). Shows decisions and notes per day. Tapping a decision opens a git-style timeline dialog (created / approved / rejected / assigned / task / event).

**Endpoints** — `GET /journal?q=…`, `GET /decisions/:id/timeline`

### OperatingScore — `/operating-score`
**Gate** — owner only

Company health score (0–100) with category bars (Execution · Finance · Sales · Responsiveness), or a "not enough data yet" placeholder. Quick stats (done / open / overdue / open complaints); **Team Execution leaderboard** ranking employees by score, tap-through to `/coach?user=<id>`.

**Endpoints** — `GET /operating-score`

### WorkCoach — `/coach`
**Gate** — logged in (personal); `?user=<id>` variant is owner-only server-side

Personal (or teammate) performance dashboard: completion / open / overdue counts + rates, proof-upload rate, plans used, photos, voice updates. **Generate coaching** / **Refresh** produces AI headline, strengths, improvements, single recommendation, timestamp.

**Endpoints** — `GET /work-coach[?user_id=<id>]`, `POST /work-coach/refresh[?user_id=<id>]`

### Ledger — `/ledger`
**Gate** — `perms=["ledger", "finance"]` (either allows entry)

Five tabs — the finance nerve centre.

| Tab | Content |
|---|---|
| **Overview** | KPI row · AI brief · monthly-spend bar chart · category pie · top-vendors bars |
| **Revenue** | Billed / received / outstanding KPIs · "needs matching" for unmatched inbound payments (pick invoice or mark standalone-income) · AI panel · sales invoices table · payments received table |
| **Expenses** | "needs matching" for supplier payments · AI panel · expenses table |
| **Assets** | AI panel · assets table |
| **Inventory** | AI panel · inventory table |

- **Add dialogs** (Income / Expense / Asset / Inventory) each with attach bill (PDF/image, 15 MB cap), AI-suggest-category for expenses, AI file-reader autofill.
- **AI panel** per scope: headline, ranked insights with per-insight "Create task" dialog + "Ask AI", refresh; plus a per-scope ask input showing the answer inline.
- **Owner-only "Fix old purchases"** — re-runs AI classification on filed purchase bills.
- Deep-link `?tab=revenue|expenses|assets|inventory|overview`.

**Endpoints**
- Reads: `GET /ledger/summary`, `GET /expenses|/assets|/inventory|/revenue|/payables`, `GET /ledger/ai/:scope`, `GET /users`
- Adds (multipart): `POST /expenses/with-file`, `POST /assets/with-file`, `POST /inventory/with-file`, `POST /revenue/with-file`
- AI helpers: `POST /expenses/suggest-category`, `POST /ledger/ai/:scope/refresh`, `POST /ledger/ask`
- Matching: `POST /revenue/payment/:id/match|standalone`, `POST /payables/payment/:id/match|standalone`
- Owner-only: `POST /ledger/reclassify-purchases`
- Task-from-insight: `POST /tasks`
- Deletes: `DELETE /expenses/:id`, `/assets/:id`, `/inventory/:id`, `/revenue/invoice/:id`, `/revenue/payment/:id`

### Ingest — `/ingest`
**Gate** — `perm="data_input"`

Two main tabs — **Import** and **Review Queue**.

**Import** — upload PDF/photo OR CSV/Excel drop zones; WhatsApp QR card + owner-only inbound logs; in-progress review panel with per-record edit / delete for contacts / invoices / payments / tasks; required Expense/Asset/Inventory bucketing for purchase bills; own-company warning; "File it" commit. Plus "Recent uploads" list with resume/failure info and filed-records tables (Invoices/Bills, Payments) with type/direction chips.

**Review Queue** — embeds CaptureReview (see below).

**Endpoints**
- Reads: `GET /captures/pending-count`, `GET /ingest`, `GET /invoices`, `GET /payments`, `GET /whatsapp/status`, `GET /whatsapp/logs`
- Commits: `POST /ingest/document`, `POST /ingest/csv`, `POST /ingest/:id/commit`
- Plus every endpoint under CaptureReview below.

**CaptureReview** (embedded in Ingest → Review Queue tab)
Status tabs (Pending / Needs Attention / Clarification / Filed / Rejected). Each capture card shows classification / reviewer / priority / confidence / AI-routing rationale, opens original WhatsApp file inline, requires per-purchase Expense/Asset/Inventory bucketing before Approve. Actions: Approve · Edit · Reassign · Clarify (round-trip WhatsApp) · Reject. Escalated items are blocked for non-owners.

**Endpoints** — `GET /captures?status=…`, `GET /users`, `PATCH /captures/:id`, `POST /captures/:id/approve|reject|clarify|reassign`

### Settings — `/settings`
**Gate** — logged in (Profile card + Password/Security card visible to all)

Owner (or `team_manage`) additionally sees: **Company Details · Business Vocabulary editor · Operating Model editor · Finance Categories editor · Language · Money & Approvals** (default currency, high-value threshold, owner-signoff toggle).

**Endpoints** — `PATCH /tenant/settings`. Individual card endpoints live in their own components under `frontend/src/components/*` (profile, password, company details, vocabulary, operating model, finance categories, language).

### Calendar — `/calendar`
**Gate** — logged in

45-day agenda grouped by day with type filter chips (meetings, payments, tasks, deliveries, complaints, birthdays, leave). Overdue badge on past-dated items. Clicking an event with a `contact_id` opens that contact profile.

**Endpoints** — `GET /calendar?days=45`

### Meetings — `/meetings`
**Gate** — logged in

- **Recorder card**: tap to record → uploads on stop; auto-refresh while processing; "Paste transcript instead" fallback.
- **Past meetings grid**: opening a card fetches the meeting and shows summary, key points, decisions, action items, expandable full transcript.

**Endpoints** — `GET /meetings`, `GET /meetings/:id`, `POST /meetings` (multipart audio), `POST /meetings/text`

### Notifications — `/notifications`
**Gate** — logged in

Reverse-chronological list with unread dot, click-to-open deep-link, per-row "Read" and "Mark all read". Auto-refresh every 20 s.

**Endpoints** — `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`

---

## 4 · Embedded surfaces (no direct route, reached from inside another page)

### Workflows kanban — reached from `/my-work?view=workflows`
Pipeline tabs from tenant operating model; brutalist horizontal-scroll kanban of stages per pipeline (orders, purchases, dispatches, payments, etc.). Cards show counterparty + amount; each has an **Advance (→ next stage)** button and, for owner, a **Delete** button. New Workflow dialog with per-pipeline contact-type picker (customer for sales; vendor for purchase), counterparty, amount, detail. Deep-link `?wf=<id>&wf_type=<pipeline>`.

**Endpoints** — `GET /workflows?type=<pipeline>`, `GET /contacts?type=<customer|vendor>`, `POST /workflows`, `PATCH /workflows/:id/advance`, `DELETE /workflows/:id`

### Task Board — reached from `/my-work?view=board`
4-column kanban (**Pending Approval / To Do / In Progress / Done**). Non-owner sees only their role lane; owner can toggle My / All. Per-card reassign select and **Move to `<next>`** advance button.

**Endpoints** — `GET /tasks?mine=…`, `GET /users`, `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/attachment`

### NewTaskDialog — used by MyWork and Task Board
Shared "New Task" modal: title, description, task-type from operating model, operational category, assignee + supporting employee (or by role), priority, due date/time, expected output, approval-required + approver picker, evidence-required, multi-file reference attachments.

**Endpoints** — `POST /tasks` and `POST /tasks/:id/attachment` (if references attached at create time)

### Leave — reached from `/leave` (redirect) or `/my-work?view=leave`
Tabs — **My Leave** (grid of user's requests) · **Approvals** (approver-only; count badge; approve / reject / request-info; auto-opens AI Impact Analysis after approve) · **Settings** (`team_manage` only; per-role default approver mapping).

Dialogs — Request Leave (type, from/to dates, full/half-day, reason) · Report Absence Today (reason, note) · **Leave Impact Analysis** (per approved leave: AI lists affected tasks with per-task recommendations — reassign to teammate / extend due date / monitor / "Apply all recommended").

Deep-link `?leave=<id>` highlights a card.

**Endpoints**
- Reads: `GET /leaves?scope=mine`, `GET /leaves?scope=approvals`, `GET /leaves/:id/impact`, `GET /users`
- Actions: `POST /leaves`, `POST /leaves/absence`, `POST /leaves/:id/approve|reject|request-info`
- Impact-apply: `PATCH /tasks/:id` (reassign or extend)
- Approver map: `PATCH /tenant/leave-approvers`

---

## 5 · Admin Portal (`/admin` — separate session, not user login)

### AdminPortal — `/admin` and `/admin/*`
Boots by calling `GET /admin/me`. Unauthenticated → **AdminLogin** (dark login screen, `POST /admin/login`). Top bar (admin email + Logout), tabbed nav renders one of 8 sections. Alert banner at top when active AI-provider alerts exist (polls every 60 s).

**Endpoints (portal shell)** — `GET /admin/me`, `GET /admin/alerts`, `POST /admin/logout`

| Section | Purpose | Key endpoints |
|---|---|---|
| **Overview** | Platform metrics grid (workspaces, users, decisions, tasks, captures, workflows, contacts, tasks done) + suspended-user note | `GET /admin/metrics` |
| **Usage** | 7d/30d/90d + provider filter (sarvam/anthropic/openai/gemini/all); totals (calls, tokens, est. cost) + by-provider + per-workspace table | `GET /admin/usage?range=…&provider=…` |
| **AI Keys** | Per-provider (sarvam/anthropic/openai/gemini/whatsapp) key display, edit, save, revert; "Test all" checks live status | `GET /admin/ai-keys`, `GET /admin/ai-keys/status`, `PUT /admin/ai-keys` |
| **Tenants** | Workspace table (users/decisions/tasks/created/status); Suspend / Reactivate / Permanent-delete (name-typed confirm) | `GET /admin/tenants`, `POST /admin/tenants/:id/suspend\|reactivate`, `DELETE /admin/tenants/:id` |
| **Users** | Cross-tenant user table with Suspend / Reactivate / Reset-access (owner protected from suspend) | `GET /admin/users`, `POST /admin/users/:id/suspend\|reactivate\|reset-access` |
| **Audit Log** | Chronological admin action log with typed icons | `GET /admin/audit` |
| **Health** | Database, follow-up scheduler, Emergent LLM key status + per-provider "key source" grid | `GET /admin/health` |
| **Maintenance** | Cross-tenant "Fix mis-booked purchases" job with live progress bar (bills reviewed, to Asset/Inventory, re-categorised, matched, settled/partial, needs manual review) | `GET /admin/reclassify-purchases/status`, `POST /admin/reclassify-purchases` |

---

## 6 · Redirect-only routes (in `App.js`, no page component)

| From | To |
|---|---|
| `/dashboard` | `/brief` |
| `/leave` | `/my-work?view=leave` |
| `/review` | `/ingest` |
| `/workflows` | `/my-work?view=workflows` |
| `/tasks` | `/my-work` |
| `/priorities` | `/my-work` |
| `/finance` | `/ledger` |
| `/ask` | `/brain` |
| `/team` | `/contacts` |
| `/` (logged-in) | `/inbox` if user has `inbox` perm, else `/my-work` |
| `*` (unknown) | `/` |

---

## 7 · Header actions (present on every logged-in page via `Layout.js`)

- **Language switcher** — English / Hindi (हिन्दी) / Tamil (தமிழ்) — persists in localStorage; UI copy re-localised via i18n.
- **Theme toggle** — light / dark.
- **Notifications bell** — badge count; opens a popover previewing latest 5 unread; "View all" → `/notifications`.
- **Send Daily Digest** *(owner only)* — one-click email of the current CEO Brief (pending approvals, open tasks, overdue tasks, active workflows + pending-decisions and overdue-tasks lists) to the owner's own email. Endpoint: `POST /brief/send-digest`. i18n: EN / HI / TA.
- **Signed-in-as chip** with role badge (desktop only) — read-only header text.
- **Mobile hamburger** → drawer with full nav + Sign out + mobile Send Digest button (owner only).

---

## Notes

- **Permission model** — Owner passes every gate via the all-perms shortcut. Non-owner roles inherit `_BASE_PERMS = {inbox, data_input, workflows, tasks, brain, ask}` (see `backend/core.py`). `people` was removed from base in **FIX-FUP-51** and is now opt-in; `finance` and `ledger` are added to the finance-role default; `voice_capture`, `approvals`, `decisions_approve`, `leave_approve`, `team_manage`, `brain_export` all require explicit grant.
- **All endpoints are tenant-scoped** — every backend handler filters by `user["tenant_id"]`; cross-tenant reads are impossible via the API.
- **Silent-fail follow-ups** — FUP-45 / 46 / 49 track UI paths that swallow 4xx responses (currently: DPDP-consent 451, register 422, task-complete button). Fixing these gives the rest of this map "no dead buttons" quality.

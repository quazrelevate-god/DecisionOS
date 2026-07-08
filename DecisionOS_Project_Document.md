# DecisionOS — Complete Project Document

**Tagline:** *Speak the decision. We run the company.*
**What it is:** An AI operating system ("operational brain") for founder-led SMEs. Founders capture decisions by voice or text; AI turns them into structured, assigned, trackable tasks and workflows. Everyone works from one shared source of truth.

> This document explains the end-to-end product: architecture, the complete user flow, every screen/feature, the data model, the API, authentication, AI/integrations, and what's live vs. pending. Desktop and mobile screens are shown in the chat alongside this document.

---

## 1. Product Overview

| | |
|---|---|
| **Who it's for** | Founders / owners of small & mid-size businesses (the demo is *Sharma Textiles Pvt Ltd*, a textile manufacturer) and their teams (Sales, Production, Finance, and custom roles). |
| **Core promise** | A founder speaks or types an instruction → AI extracts the decision, creates tasks, assigns owners, sets deadlines, and tracks execution — surfacing "fires" the founder must handle. |
| **Model** | Multi-tenant SaaS. Each company = one **tenant**. Users belong to a tenant with a **role** and granular **permissions** (module-level RBAC). |
| **Design language** | Neo-brutalist: sharp black borders, hard shadows, red (`brand-red`) + yellow + blue accents, monospace labels, high-contrast. Fully responsive (desktop sidebar + mobile bottom-nav & drawer). |

---

## 2. Tech Stack & Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  React (CRA) + TailwindCSS + shadcn/ui + Phosphor icons        │
│  React Router · @tanstack/react-query · Axios · sonner toasts  │
│  AuthContext (JWT in localStorage)                             │
└───────────────▲───────────────────────────────┬───────────────┘
                │  REST /api/*  (Bearer JWT)     │
┌───────────────┴───────────────────────────────▼───────────────┐
│  FastAPI (server.py)  ·  Motor (async MongoDB)                 │
│  RBAC guards: require_perm() / require_role()                  │
│  AI pipeline via emergentintegrations + Emergent LLM Key       │
└───────────────▲───────────────────────────────┬───────────────┘
                │                                │
        ┌───────┴────────┐              ┌────────▼─────────┐
        │  MongoDB        │              │  AI providers    │
        │  (tenants,      │              │  Whisper (STT)   │
        │  users, tasks,  │              │  Claude (extract)│
        │  decisions,...) │              │  Gemini (OCR)    │
        └────────────────┘              └──────────────────┘
```

- **Frontend** talks to backend only via `REACT_APP_BACKEND_URL` and every route is prefixed `/api`.
- **Backend** uses `MONGO_URL` / `DB_NAME` from env. All datetimes are timezone-aware UTC.
- **Auth**: JWT Bearer tokens; three sign-in methods (see §6).
- **AI**: OpenAI Whisper (speech→text), Claude Sonnet (decision/task extraction), Gemini Vision (document/PDF OCR) — all through the Emergent LLM Key.

**Frontend structure**
```
frontend/src/
├── context/AuthContext.js     # login / register / loginWithOtp / refreshTenant
├── lib/perms.js               # PERMISSIONS, role defaults, hasPerm(), userPerms()
├── components/Layout.js       # sidebar (desktop) + drawer & bottom-nav (mobile)
└── pages/
    ├── Login.js               # sign in / 7-step onboarding / invite deep-link
    ├── Inbox.js               # "Decision Desk"
    ├── CEOBrief.js            # CEO Brief / My Brief
    ├── MyWork.js + Tasks.js   # My Work board + AI Priority
    ├── People.js (Team.js + Contacts.js)  # Employees / Customers / Vendors
    ├── Brain.js (+AskAI.js)   # Company Brain: Ask + Search
    ├── Ingest.js              # "Capture" data ingestion
    ├── Workflows.js           # Order Fulfilment / Procurement kanban
    ├── Meetings.js            # Meeting Notes
    ├── OperatingScore.js      # Owner-only company health
    ├── WorkCoach.js, Journal.js, Notifications.js, ContactProfile.js
```

---

## 3. Roles & RBAC (module-level access)

Every screen and API is guarded. Owners see everything; employees see only the modules their permissions allow. Blocked routes render a dedicated **Access Denied** view.

**Permission keys** (`lib/perms.js` ↔ backend `require_perm`):
`inbox` (Decision Desk), `people`, `brain`, `ask`, `data_input` (Capture), `workflows`, `team_manage`.

**Always available to everyone:** CEO Brief (role-aware), My Work, Meeting Notes.
**Owner-only:** Operating Score, voice/text capture on Decision Desk, CEO Journal.

Backend enforcement examples: `contacts→people`, `workflows→workflows`, `brain/ask→brain/ask`, `ingest→data_input`, `operating-score→owner`, `/users→team_manage`.

---

## 4. The Complete User Flow

### 4.1 Onboarding (new workspace) — `Login.js`, 7 steps
1. **About company** — name, your name, work email, password, mobile, industry, GST, branches.
2. **Business scale** — team size, currency, monthly sales/purchases, # customers/suppliers, region.
3. **Current software** — Excel / Tally / Zoho / Others.
4. **AI-suggested team & offerings** — AI proposes roles + products for your industry (`POST /api/onboarding/suggest`); edit freely, then **Create workspace** (`POST /api/auth/register`).
5. **Connect data** — upload Excel/CSV (customers, invoices, payments) via the ingestion pipeline; Tally/Zoho shown "coming soon".
6. **Invite team** — add employee mobile numbers.
7. **AI learns your business** — animated setup, then enter DecisionOS.

### 4.2 Daily loop (owner)
```
Speak/type a directive (Decision Desk)
      │  Whisper → Claude extraction
      ▼
Decision + Tasks created (assignee, role, due date)
      │
      ▼
Approve / Reject on Decision Desk  →  Tasks land in team members' "My Work"
      │
      ▼
CEO Brief shows counts + "fires to put out"  ←  drill-downs into source screens
      │
      ▼
Send Daily Digest / review Operating Score
```

### 4.3 Employee loop
Sign in (password or mobile OTP) → **My Work** (AI Execution Guide, complete tasks, upload photo/voice proof, escalate/handoff) → **My Brief** (personal CEO Brief + AI Coach) → **Meeting Notes**.

---

## 5. Screen-by-Screen Feature Guide

> Screens below correspond to the desktop and mobile screenshots shared in chat.

### 5.1 Login / Sign-in *(desktop + mobile shown)*
- **Email & Password** tab and **Mobile OTP** tab.
- One-tap **Sharma demo** buttons (Owner / Sales / Production / Finance).
- Handles **invite deep-links** (`/login?invite=<token>`) — see §6.3.

### 5.2 Decision Desk (Inbox) *(desktop + mobile shown)* — perm `inbox`
- **Tap to speak a decision** (Auto / EN / தமிழ் / Tanglish language modes) + **Type a directive** box → **Structure it**.
- **Decision Approvals**: AI-structured directives awaiting Approve/Reject, each showing the auto-assigned team/role; "Add team member / task" inline.
- **Tasks & Activity** feed with filters (Customer, Supplier, Invoice, Payment, Complaint, Task, Approval, Reminder) and uploaded-document cards.
- Employees see a note that capture is owner-only but still get the company inbox feed.

### 5.3 CEO Brief / My Brief *(desktop + mobile shown)* — always available (role-aware)
- Period toggle: **Morning / Evening / Weekly / Monthly**.
- Clickable counter cards: **delayed tasks, completed, waiting for approval, employees absent, customer complaints, payments overdue** — each opens a drill-down modal with in-place actions (approve/reject, resolve complaint, review purchase) and deep-links into the source screen.
- **"Fires to put out today"** red banner for owners (escalation count).
- Owner: company-wide brief + **CEO Journal**. Employee: personal brief + **AI Coach**. Auto-refreshes every 30s.

### 5.4 My Work *(desktop shown)* — always available
- **My Work** vs **Board** (kanban) toggle; **AI Priority** toggle re-orders tasks by AI score (Impact/Revenue/Risk/Urgency).
- Per-task **AI Execution Guide** (generated step checklist with per-step "Ask AI" + "Update"), **Complete**, **Photo/Voice proof**, **Activity & Handoffs**, **Update / Escalate**.
- **Messages** rail: escalations addressed to you, owner alerts for overdue tasks.

### 5.5 People *(desktop + mobile shown)* — Employees perm `team_manage`; Customers/Vendors perm `people`
- Tabs: **Employees / Customers / Vendors**.
- **Employees**: member list with role, access-count, **Access** editor (role + granular permissions + live "menus this member will see" preview), **Mark absent/present**, and **Invite** (generates a passwordless invite link — §6.3). **Add Member** dialog supports **Password** or **Mobile OTP (passwordless)** members.
- **Customers/Vendors**: CRM-lite contacts; each opens a **360° Contact Profile** with auto-calculated financials (invoices, payments, balance) and AI health re-scoring.

### 5.6 Company Brain *(desktop shown)* — perm `brain`/`ask`
- **Ask** tab: RAG chat grounded in your company data (`POST /api/ask`) with suggested prompts ("What purchases need my approval?", "Which tasks are overdue?", "Summarise open sales orders", "What did I decide about festive stock?").
- **Search** tab: deterministic keyword record browser (`GET /api/brain/search`) that traces any founder decision to the tasks/workflows it created.

### 5.7 Capture (Ingest) *(desktop shown)* — perm `data_input`
- **PDF / Photo** → OCR (Gemini Vision) extracts invoices/bills/receipts/POs.
- **CSV / Excel** → columns auto-detected → preview → commit (creates contacts/invoices/payments).
- **WhatsApp forwarding** — "coming soon" (same pipeline).
- **Recent uploads** list with per-file counts (Contacts / Invoices / Payments / Tasks) and FILED status.

### 5.8 Workflows *(desktop shown)* — perm `workflows`
- Two flagship pipelines as kanban boards:
  - **Order Fulfilment**: Order Received → Confirmed → In Production → Ready → Dispatched → Delivered.
  - **Procurement**: Purchase → Payment.
- Cards carry customer, amount, and an **Advance** action to move stages.

### 5.9 Meeting Notes — always available
- Record/transcribe a meeting → AI writes minutes: **Key Points**, **Decisions**, **Action Items** (assignable to members).

### 5.10 Operating Score *(desktop shown)* — owner-only
- **Company Health /100** with pillar bars: **Execution, Finance, Sales, Responsiveness**.
- Headline metrics: Tasks Done, Open Tasks, Overdue, Open Complaints.
- **Team Execution** leaderboard (done/open/overdue per member) with per-member **Coach** button (opens their Work Coach).

### 5.11 Notifications — always available
- Reminders & escalations feed; mark-read / read-all; follow-up engine.

---

## 6. Authentication

### 6.1 Email + Password
`POST /api/auth/login` → JWT. `POST /api/auth/register` creates the tenant + owner.

### 6.2 Mobile OTP login *(DEV mode)*
`POST /api/auth/otp/request` finds the user by last-10-digits of phone, generates a 6-digit code (hashed, 5-min TTL, 5-attempt max, 30s resend cooldown) and returns it as `dev_otp` (real SMS pending — see §8). `POST /api/auth/otp/verify {phone, code}` → JWT. Wiring for Twilio already exists; flipping the provider on requires only credentials.

### 6.3 Passwordless members + auto invite links *(new)*
- Owners can add an employee with **no password** (People → Add Member → **Mobile OTP** toggle). Such users have `passwordless: true`; email/password login is rejected — they sign in only via OTP.
- Adding a member (with a phone) returns an **`invite_token`**; the owner gets a **one-tap invite link** (`<origin>/login?invite=<token>`) with **Copy** and **WhatsApp share**, plus a per-row **Invite** button that regenerates a link (`POST /api/users/{id}/invite`).
- Opening the link auto-selects the OTP tab, shows a welcome banner (name / company / masked phone), texts the code (dev: auto-fills it), and one **Verify & sign in** lands the member in the app. Links expire in 7 days.
- Endpoints: `GET /api/auth/invite/{token}` (welcome info), `POST /api/auth/invite/{token}/start` (send OTP). `invite_token` is never leaked in `GET /api/users`.

---

## 7. Data Model (MongoDB, key collections)

| Collection | Key fields |
|---|---|
| `tenants` | name, industry, company_size, region, currency, gst, branches, roles[], products[], business_scale, invited_employees[] |
| `users` | id, tenant_id, name, email, phone, role, permissions[], password_hash, `passwordless`, `invite_token`/`invite_expires_at` |
| `decisions` | id, tenant_id, text, dtype, owner_id, status |
| `tasks` | id, tenant_id, title, description, status, assignee_id, assignee_role, due_date, steps[], execution_plan, updates[], parent_task_id, raised_by, priority_score |
| `contacts` | id, tenant_id, type (customer/dealer/vendor), name, company, phone, email, tax_id, tags[], status, assigned_id |
| `invoices` / `payments` | linked to contacts; power 360° profiles & financial pillars |
| `workflows` | pipeline, stage, customer, amount |
| `meetings` | transcript, key_points, decisions, action_items |
| `otp_codes` | phone, code_hash, expires_at, attempts |
| `notifications`, `attendance`, `complaints`, `memory`, `ingestions`, `voice_notes` | supporting operational data |

---

## 8. AI & Third-Party Integrations — status

| Integration | Purpose | Status |
|---|---|---|
| OpenAI **Whisper** | Speech → text (voice capture) | ✅ Live (Emergent LLM Key) |
| **Claude Sonnet** | Decision & task extraction, Ask AI | ✅ Live (Emergent LLM Key) |
| **Gemini Vision** | PDF/photo OCR in Capture | ✅ Live (Emergent LLM Key) |
| **SMS OTP delivery** | Real invite/login codes | ⏳ DEV mode — backend generates & verifies; SMS send mocked. Awaiting APM Technologies verify/send-SMS endpoint **or** Twilio keys. |
| **WhatsApp Business Cloud** | Inbound/outbound ingestion | ⏳ Pending keys (webhook scaffolded) |
| **Zoho Books** | Customers/invoices/payments sync | ⏳ Pending keys |
| **Resend** | Email daily digest | ⏳ Pending keys |
| **Tally** | Read-only financials | 🔭 Future (needs local agent) |

> APM Technologies note: the shared doc only exposes `/Registration` and `/ForgotPassword`, which generate APM's *own* OTP with no verify endpoint and no custom-message send — incompatible with our backend-verified OTP until APM provides a `/Verify` or a generic Send-SMS endpoint.

---

## 9. API Reference (grouped)

**Auth & tenant**
`POST /api/auth/register` · `POST /api/auth/login` · `GET /api/auth/me` · `PATCH /api/tenant` · `POST /api/onboarding/suggest`
`POST /api/auth/otp/request` · `POST /api/auth/otp/verify`
`GET /api/auth/invite/{token}` · `POST /api/auth/invite/{token}/start`

**Users & invites**
`GET/POST /api/users` · `PATCH /api/users/{id}` · `POST /api/users/{id}/invite` · `GET/POST /api/invites`

**Capture / voice / meetings**
`POST /api/voice-notes` · `POST /api/voice-notes/text` · `POST /api/capture/clarify` · `GET /api/voice-notes[/{id}]`
`POST /api/meetings[/text]` · `GET /api/meetings[/{id}]`
`POST /api/ingest/document` · `POST /api/ingest/csv` · `POST /api/ingest/{id}/commit` · `GET /api/ingest[/{id}]`

**Decisions & tasks**
`GET /api/decisions[/{id}][/timeline]` · `GET /api/journal`
`POST /api/decisions/{id}/tasks|approve|reject`
`GET/POST /api/tasks` · `PATCH /api/tasks/{id}` · `POST /api/tasks/{id}/execution-plan/generate` · `PATCH .../execution-plan`
`POST /api/tasks/{id}/steps/ask|updates|respond|attachment` · `POST /api/tasks/prioritize`

**Brain, brief, workflows, contacts, ops**
`POST /api/ask` · `GET /api/brain/search`
`GET /api/brief` · `GET /api/brief/details` · `POST /api/brief/send-digest` · `GET /api/dashboard`
`GET/POST /api/workflows` · `PATCH /api/workflows/{id}/advance`
`GET/POST /api/contacts` · `PATCH/DELETE /api/contacts/{id}` · `GET /api/contacts/{id}/profile` · `POST .../rescore`
`GET /api/invoices` · `GET /api/payments` · `GET /api/inbox` · `POST /api/inbox/{id}/status`
`GET /api/operating-score` · `GET /api/work-coach` · `POST /api/work-coach/refresh`
`GET /api/notifications` · `POST /api/notifications/{id}/read|read-all` · `POST /api/follow-up/run`
`GET/POST /api/attendance` · `GET/POST /api/complaints` · `PATCH /api/complaints/{id}/resolve`
`GET/POST /api/memory` · `GET /api/calendar` · `GET/POST /api/webhooks/whatsapp`

---

## 10. Mobile Experience *(screens shown)*
- **Bottom tab bar**: Desk · Brief · Work · People · Brain.
- **Hamburger drawer**: full menu + company details + **Send Daily Digest** (owner) + **Sign out** (clears the fixed bottom-nav overlap).
- All screens are single-column responsive; cards, filters and drill-downs adapt to small viewports.

---

## 11. Demo Credentials
- Owner: `owner@sharma.com` / `demo1234`
- Sales: `sales@sharma.com` · Production: `production@sharma.com` · Finance: `finance@sharma.com` (all `demo1234`)
- OTP demo phones (dev): Owner `9820010001`, Sales `9820010002`, Production `9820010003`, Finance `9820010004`.

---

## 12. Roadmap (pending)
- **P0/P1 — Real SMS**: enable APM Technologies (needs verify/send endpoint) or Twilio → auto-deliver invite/login codes.
- **P1**: WhatsApp Business Cloud ingestion, Zoho Books sync, Resend email digest (all need keys).
- **P2**: Tally read-only connector (local agent).
- **Enhancement idea**: "Pending invites" widget on CEO Brief (who's invited vs. activated, one-tap resend) to close the onboarding loop.

---
*Document generated from the live application (Sharma Textiles demo). Desktop and mobile screenshots accompany this document in the chat.*

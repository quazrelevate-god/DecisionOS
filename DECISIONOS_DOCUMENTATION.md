# DecisionOS — Product Documentation (Start to End)

*The AI operating brain for founder-led SMEs — capture decisions, turn them into structured work, and give the team one shared source of truth.*

Version: MVP • Last updated: 2026-07-03

---

## 1. What DecisionOS Does (in one line)

A founder speaks or forwards something (a voice note, a typed directive, an invoice PDF, an Excel sheet, or later a WhatsApp message). DecisionOS **understands it with AI**, turns it into **structured records** (decisions, tasks, invoices, payments, contacts, complaints, reminders), **assigns the work** to the right person, and surfaces everything in **one Inbox + a daily CEO Brief + a searchable Company Brain**.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         FRONTEND (React)                       │
│  Mobile-first UI · Tailwind · Shadcn · Phosphor icons          │
│  Auth context (JWT) · React Query · role/permission gating     │
└───────────────┬────────────────────────────────────────────────┘
                │  HTTPS, all calls prefixed with /api
                │  Authorization: Bearer <JWT>
┌───────────────▼────────────────────────────────────────────────┐
│                        BACKEND (FastAPI)                        │
│  Routes · Auth · Permissions · AI pipelines · Webhooks          │
└───────┬───────────────────────────┬─────────────────────────────┘
        │                           │
   ┌────▼─────┐              ┌───────▼────────────────────────────┐
   │ MongoDB  │              │  AI via Emergent LLM key            │
   │ (Motor)  │              │  • OpenAI Whisper (speech→text)     │
   │ 16 cols  │              │  • Claude Sonnet (extraction/Q&A)   │
   └──────────┘              │  • Gemini 2.5 Flash (doc/image OCR) │
                             └─────────────────────────────────────┘
```

- **Multi-tenant:** every record carries a `tenant_id`; users only ever see their own workspace.
- **Environment-driven:** URLs, DB, secrets and API keys come from `.env` only.
- **AI is provider-agnostic:** all AI runs through the built-in **Emergent LLM key** (no separate OpenAI/Anthropic/Google keys needed).

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, React Router, React Query, TailwindCSS, Shadcn UI, Phosphor icons, Sonner (toasts) |
| Backend | FastAPI, Motor (async MongoDB), Pydantic |
| Database | MongoDB (16 collections) |
| Auth | JWT (email + password), bcrypt hashing |
| AI | Emergent LLM key → OpenAI Whisper, Anthropic Claude Sonnet, Google Gemini 2.5 Flash |
| Files/Media | Local upload store served at `/api/files/{name}` |
| Integrations (wired) | WhatsApp Cloud API (Meta) — awaiting keys; Resend (email) — optional key |

---

## 4. Data Model (MongoDB collections)

| Collection | Purpose | Key fields |
|---|---|---|
| `tenants` | The company/workspace | name, industry, company_size, region, currency, gst, branches, business_scale, current_software, roles[], products[], invited_employees[] |
| `users` | Team members | tenant_id, name, email, password_hash, role, **permissions[]** |
| `voice_notes` | Raw voice/text captures | tenant_id, kind (audio/text), transcript, language, status, source |
| `decisions` | AI-structured directives | tenant_id, title, summary, items[], dtype, confidence, status (pending_approval/approved/rejected), task_ids[] |
| `tasks` | Actionable work | tenant_id, title, **assignee_id**, **assignee_role**, priority, status (blocked/todo/in_progress/done), due_date, source |
| `workflows` | Multi-stage processes | tenant_id, type (sales_dispatch/purchase_payment), stage, contact_id |
| `contacts` | CRM: customers & vendors | tenant_id, type, name, company, phone, email, address, tax_id, tags, status |
| `invoices` | Sales invoices & purchase bills | tenant_id, type, number, contact_id, amount, currency, status, line_items[] |
| `payments` | Money in/out | tenant_id, direction (in/out), amount, method, reference, contact_id |
| `complaints` | Customer complaints | tenant_id, customer_id, text, severity, status |
| `inbox` | Unified feed items | tenant_id, source, **classification**, title, ref_type, ref_id, status |
| `ingestions` | Upload/OCR jobs | tenant_id, source, kind, filename, doc_type, records{}, status |
| `attendance` | Present/absent marks | tenant_id, user_id, status, date |
| `notifications` | In-app alerts | tenant_id, user_id, message, type, is_read |
| `memory` | Company memory notes | tenant_id, text, tag |
| `activity` | Audit trail of actions | tenant_id, actor, kind, message, entity |

---

## 5. Roles & Permissions

- **Roles** are per-tenant and industry-aware (Owner + AI-suggested roles like Sales, Production, Finance).
- **Owner** always has full access.
- **Module-level permissions** per user: `inbox, data_input, people, finance, workflows, tasks, brain, ask, team_manage`.
- Users with no explicit permissions fall back to **role defaults**:
  - Sales → base + data_input + people
  - Finance → base + data_input + finance
  - Others → base (inbox, people, workflows, tasks, brain, ask)
- Enforcement is **both** frontend (hidden nav/actions) **and** backend (`require_perm`) for the sensitive areas: Finance (money), Data Input (uploads), Team management.

---

## 6. End-to-End User Flow

### 6.1 Onboarding — the "Digital Executive Office" (7 steps)
1. **About your company** — company name, owner account (name/email/password), industry, GST (optional), branches.
2. **Business scale** — team size, currency, monthly sales/purchases, # customers/suppliers, region.
3. **Current software** — Excel / Tally / Zoho / Others.
4. **AI Team & Products** — once industry is known, AI proposes team roles + products/services; owner edits, then **workspace is created** (authenticated from here on).
5. **Connect business** — upload Excel/CSV now (auto-imported); Tally/Zoho shown as "coming soon".
6. **Invite employees** — by mobile number (stored as pending invites; real SMS once Twilio connected).
7. **AI learns business** — animated setup (Company Brain, import, index, dashboard) → **Enter DecisionOS**.

### 6.2 Daily working loop
```
Capture ──▶ AI structures ──▶ Owner reviews/approves ──▶ Work assigned ──▶ Tracked ──▶ Reported
  │             │                    │                       │              │           │
 voice        Whisper +           Inbox +                 tasks to        Tasks/       CEO Brief
 text         Claude/Gemini       decision cards          member/role     My Work      + Company Brain
 upload                                                                   Workflows
 whatsapp
```

**Step-by-step:**
1. **Capture** — Owner taps the mic or types in the **Inbox**, or uploads a PDF/CSV in **Data Input**, or (when live) forwards a document on **WhatsApp**.
2. **AI understanding** — Whisper transcribes audio; Claude extracts decisions/tasks/reminders/memory; Gemini reads invoices/images. A **specific team member named** in the directive is auto-assigned; otherwise the task is auto-assigned **by role**.
3. **Unified Inbox** — every item appears in one feed, **auto-classified** as Customer / Supplier / Invoice / Payment / Complaint / Task / Approval / Reminder. Owner can mark done/dismiss.
4. **Approve** — decisions start as *pending approval*; tasks are *blocked* until the owner approves (then they become actionable).
5. **Execute** — team members see their work in **My Work** and the **Tasks** kanban (To Do → In Progress → Done); anyone can reassign.
6. **Track processes** — **Workflows** handle multi-stage flows (sales dispatch, purchase→payment) with stage advancement.
7. **Report** — the **CEO Brief** shows the box-style dashboard (delayed, completed, awaiting approval, absent, complaints, overdue payments); the **Company Brain** lets you search everything and **Ask AI** natural-language questions.

---

## 7. Screens (Frontend Pages)

| Page | Route | What it does |
|---|---|---|
| Login / Onboarding | `/login` | Sign in + 7-step registration wizard |
| **Inbox (home)** | `/` | Unified capture + AI-classified feed + pending approvals |
| Daily Brief (Dashboard) | `/dashboard` | Operational overview counters |
| CEO Brief | `/brief` | Box-style KPI dashboard (Morning/Evening/Weekly/Monthly) |
| Data Input | `/ingest` | Upload PDF/image/CSV → review → file; view invoices/payments |
| Workflows | `/workflows` | Multi-stage process kanban |
| People | `/contacts` | CRM list of customers/vendors |
| 360° Profile | `/contacts/:id` | Full customer/supplier view (owner+finance) |
| Tasks | `/tasks` | Kanban; assign/reassign to members |
| My Work | `/my-work` | An employee's own tasks |
| Company Brain | `/brain` | Keyword search across all records |
| Ask AI | `/ask` | Natural-language Q&A with citations |
| Team | `/team` | Members, roles, per-user access control, invites |
| Notifications | `/notifications` | In-app alerts |

---

## 8. AI Features (the intelligent core)

### 8.1 Voice & Text → Structured work
- **Whisper** transcribes voice notes in **English, Tamil, and Tanglish** (code-mixed).
- **Claude Sonnet** converts the transcript into a **decision** + **tasks** + **reminders** + **memory notes**, all output in clean English.
- **Named-person assignment:** if the directive says "tell Priya…", the task is assigned to that member; otherwise it's assigned by **role** inferred from the work.

### 8.2 Document & Data Ingestion (OCR)
- **Gemini 2.5 Flash (vision)** reads invoice/bill/payment **PDFs and images**, extracting parties, amounts, dates, line items — and auto-creates follow-up tasks.
- **CSV/Excel auto-detect:** Claude classifies a spreadsheet (customers/vendors/invoices/payments) and maps every row — no manual column mapping.
- All ingestion flows through one pipeline → editable **review** → **file** into the database.

### 8.3 Unified Inbox auto-classification
- Every incoming item (voice, upload, complaint, WhatsApp) is tagged into one of 8 categories automatically, so the owner has a single screen to work from.

### 8.4 Company Brain — Search & Ask AI
- **Search** tokenizes your query and matches across decisions, tasks, workflows, contacts, invoices and memory.
- **Ask AI** answers natural-language questions grounded ONLY in your company data, returning **citations**. For Owner/Finance it also answers money questions ("who owes more than ₹5 lakh?", "which customer hasn't paid in 30 days?", "yesterday's sales") using invoices, payments, per-party outstanding and today's date.

### 8.5 Industry-aware onboarding
- Given the industry, AI proposes suitable **team roles** and **products/services** to pre-populate the workspace.

### 8.6 CEO Brief & Follow-up engine
- Aggregates delayed/completed/awaiting-approval tasks, absent employees, open complaints and overdue payments; a follow-up/escalation engine raises in-app notifications.

---

## 9. Key API Endpoints (grouped)

- **Auth:** `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- **Onboarding:** `POST /api/onboarding/suggest`, `GET/POST /api/invites`
- **Capture & AI:** `POST /api/voice-notes` (audio), `POST /api/voice-notes/text`, `GET /api/voice-notes`, `POST /api/ask`, `GET /api/brain/search`
- **Decisions:** `GET /api/decisions`, `POST /api/decisions/{id}/approve|reject`
- **Tasks:** `GET/POST /api/tasks`, `PATCH /api/tasks/{id}`, `POST /api/tasks/{id}/attachment`
- **Ingestion:** `POST /api/ingest/document`, `POST /api/ingest/csv`, `POST /api/ingest/{id}/commit`, `GET /api/ingest`
- **Money:** `GET /api/invoices`, `GET /api/payments`, `GET /api/contacts/{id}/profile`
- **CRM & complaints:** `GET/POST /api/contacts`, `PATCH/DELETE /api/contacts/{id}`, `GET/POST /api/complaints`
- **Inbox:** `GET /api/inbox`, `POST /api/inbox/{id}/status`
- **Workflows:** `GET/POST /api/workflows`, `PATCH /api/workflows/{id}/advance`
- **Team:** `GET/POST /api/users`, `PATCH /api/users/{id}`, `GET/POST /api/attendance`
- **Dashboards:** `GET /api/dashboard`, `GET /api/brief`, `POST /api/brief/send-digest`
- **Notifications:** `GET /api/notifications`, `POST /api/notifications/{id}/read`, `POST /api/follow-up/run`
- **WhatsApp:** `GET/POST /api/webhooks/whatsapp`

---

## 10. Integrations Status

| Integration | Status | Notes |
|---|---|---|
| AI (Whisper, Claude, Gemini) | ✅ Live | via Emergent LLM key |
| WhatsApp Cloud API (Meta) | 🟡 Wired, awaiting keys | webhook verify + media OCR + auto-file + reply implemented |
| Resend (email digest) | 🟡 Optional | mocked/logged until key added |
| Twilio (SMS invites) | 🔵 Planned | invites stored as pending |
| Zoho Books | 🔵 Planned | needs Client ID/Secret |
| Tally | 🔵 Planned | needs a local bridge (no cloud API) |

---

## 11. Security & Multi-tenancy

- JWT bearer auth on every `/api` call; passwords bcrypt-hashed.
- Every query is scoped by `tenant_id` — no cross-company data leakage.
- Sensitive modules (money, uploads, team management) enforced server-side via permissions.
- WhatsApp webhook validates Meta's `X-Hub-Signature-256` when the app secret is set.

---

## 12. Glossary

- **Decision** — an AI-structured directive from the owner, awaiting approval.
- **Task** — an actionable item, assigned to a member or a role, tracked on the kanban.
- **Workflow** — a multi-stage business process (e.g., dispatch, purchase→payment).
- **Ingestion** — an uploaded/forwarded document processed by AI into records.
- **Company Brain** — the searchable + askable knowledge layer over all your data.

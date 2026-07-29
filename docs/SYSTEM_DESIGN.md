# DecisionOS — System Design Document

> **DecisionOS** is an AI operating system for founder‑led SMEs. It captures spoken/typed/photographed
> decisions, uses AI to structure them into tasks / workflows / approvals, and gives the team a shared
> operational brain (Company Brain, CEO Brief, My Work, Leave, Finance Ledger, People/CRM).

This document explains the architecture, the multi‑tenant model, how a company is provisioned,
the data & file storage, the AI pipeline, security, and the key runtime flows.
UML diagrams live in **`UML_DIAGRAMS.md`** (Mermaid — renders on GitHub / VS Code / mermaid.live).

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React (CRA), TailwindCSS, shadcn/ui, react‑query, react‑i18next (en/hi/ta) |
| Backend | FastAPI (Python, async), Uvicorn, managed by Supervisor |
| Database | **MongoDB** (document store) via **Motor** (async driver) |
| File / Object storage | **Emergent Object Storage** (S3‑like HTTP API); DB is the source of truth for metadata |
| Auth | JWT in **HttpOnly cookies** (tenant users) + a separate cookie/JWT for platform super‑admins; OTP (SMS) login |
| AI — reasoning/text | **Anthropic Claude Sonnet** (`claude_chat` wrapper) |
| AI — speech‑to‑text | **OpenAI** `gpt-4o-transcribe` (Whisper fallback) |
| AI — vision / OCR | **Google Gemini** (`gemini-2.5-flash`) — invoices *and* general image/PDF reading |
| AI resiliency | **Emergent Universal LLM key** auto‑fallback when a provider key is empty/out‑of‑credits |
| Messaging ingest | Meta/WhatsApp Cloud API webhook |

### Service topology (this environment)
- Backend runs internally on `0.0.0.0:8001`; all API routes are prefixed **`/api`** and reach the backend through the ingress.
- Frontend runs on `:3000`; it always calls the backend via `REACT_APP_BACKEND_URL`.
- Both are Supervisor‑managed with hot reload.
- Config comes only from `.env` (`MONGO_URL`, `DB_NAME`, `EMERGENT_LLM_KEY`, provider keys, `REACT_APP_BACKEND_URL`).

---

## 2. Multi‑Tenancy — how a "schema" is created per company

### 2.1 There is **no per‑company SQL schema / DDL**
MongoDB is **schemaless**. DecisionOS does **not** create a new database or new tables per company.
Instead it uses **row‑level (shared‑collection) multi‑tenancy**:

- Every business collection (`tenants`, `users`, `tasks`, `decisions`, `workflows`, `contacts`, …) is **shared**.
- **Every document carries a `tenant_id`.** All reads/writes are scoped by `tenant_id`, which is derived
  from the authenticated user's JWT and enforced in every query (`{"tenant_id": user["tenant_id"], …}`).
- A request‑scoped `contextvar` also stamps the active tenant for AI‑usage attribution.

### 2.2 The "schema" = a per‑tenant **configuration document**
The closest thing to a per‑company schema is the **`tenants` document**, provisioned at sign‑up. It stores the
company's AI‑generated **Operating System** — a *data‑driven* structure that then drives the whole app:

```jsonc
// tenants (one per company)
{
  "id": "<tenant_id>",
  "name": "Acme Textiles",
  "industry": "Textile Manufacturing",
  "description": "…what the business does…",
  "company_size": "…", "region": "…", "currency": "INR", "gst": "…",
  "roles": [ {"key": "sales", "label": "Sales"}, … ],          // ← becomes RBAC departments
  "operating_model": {                                          // ← drives Workflows board + task categories
    "pipelines": [ {"key","label","sub","approval_stage","stages":[{"key","label"}]} ],
    "task_categories": [ {"key","label"} ]
  },
  "lexicon": { "customer": {"one","many"}, "vendor": {"one","many"} }, // ← vocabulary per industry
  "workflow_templates": [...], "operational_task_templates": [...], "approval_rules": [...],
  "products": [...],
  "created_at": "…"
}
```

**Why this design:** two salons and a textile factory need *different* pipelines, departments and vocabulary.
Rather than hard‑coding, DecisionOS asks **Claude** to generate an industry‑specific `operating_model`,
`lexicon` and department `roles` from the founder's industry + free‑text description. Everything is fully
editable afterwards in Settings, and existing tenants are non‑destructively back‑filled on first load.

### 2.3 Provisioning flow at registration (`POST /api/auth/register`)
1. Validate email uniqueness.
2. (During onboarding) `POST /api/onboarding/os-blueprint` → Claude proposes departments/workflows/approval rules.
3. On register, the app builds the **tenant document**:
   - departments → `roles` (single source of truth for RBAC),
   - `ai_generate_lexicon(industry, size, roles, description)` → `lexicon`,
   - `ai_generate_operating_model(industry, size, roles, description)` → `operating_model`,
   - templates/products/currency stored.
4. Insert `tenants` doc → insert the **owner** `users` doc (bcrypt password) → issue JWT (HttpOnly cookie).
5. Indexes are ensured at startup (see §3.2). No per‑tenant collections are created.

> Isolation model: **logical isolation by `tenant_id`** in shared collections (not physical DB‑per‑tenant).
> A super‑admin can suspend an entire workspace (`tenant.suspended`), after which `get_current_user` 403s its users.

---

## 3. Data Store (MongoDB)

### 3.1 Collections (grouped by domain)

**Tenant & identity**
- `tenants` — per‑company config / Operating System (see §2.2)
- `users` — owner + members: `{tenant_id, name, email, phone, password_hash, role, permissions, language}`
- `otp_codes`, `platform_login_attempts` — OTP + brute‑force lockout

**Capture → Decision → Execution**
- `voice_notes` — raw capture: `{tenant_id, kind: audio|text|file, transcript, language, reference_file_ids[], status: queued→transcribing→structuring→done|failed, execution_summary, decision_id}`
- `decisions` — structured output: `{tenant_id, title, summary, items[], workflow_events[], dtype, status: pending_approval|approved|rejected, task_ids[], timeline[]}`
- `tasks` — work items: `{tenant_id, title, description, assignee_id/role, status, priority, due_date, decision_id, evidence_required, attachments[], reference_insights[], execution_plan, updates[], approval_required/approver_id}`
- `workflows` — pipeline (kanban) cards: `{tenant_id, type, title, stage, stages[], history[], amount, counterparty, contact_id}`
- `calendar_events`, `meetings` — scheduled meetings
- `inbox` — unified inbox feed items
- `memory` — Company Brain lasting notes/policies
- `activity` — activity log / audit trail

**Files**
- `files` — object‑storage metadata: `{id, tenant_id, storage_path, original_filename, content_type, size, kind: reference|evidence|photo|voice, task_id, uploaded_by, is_deleted, created_at}`

**People / CRM**
- `contacts` — customers & vendors, `complaints`

**Finance (Ledger)**
- `expenses`, `assets`, `inventory`, `invoices`, `payments`, `ledger_ai` (cached AI finance briefs)

**HR**
- `leaves`, `attendance`

**Ingest (WhatsApp / documents)**
- `capture_drafts`, `ingestions`, `wa_events`, `command`

**Platform (Super‑Admin console)**
- `platform_admins`, `platform_settings` (runtime AI keys id=`ai_keys`), `platform_audit`, `platform_alerts`

**Ops**
- `notifications` — per‑user notifications
- `usage_events` — AI usage/cost tracking `{tenant_id, feature, provider, tokens_in/out, cost_estimate, created_at}`

### 3.2 Indexes (ensured on startup)
```
users.email                       (unique)
platform_admins.email             (unique)
decisions.tenant_id
tasks.tenant_id
workflows.tenant_id
files.(tenant_id, task_id)
usage_events.(tenant_id, created_at desc), usage_events.created_at
```
All other access patterns are tenant‑scoped equality filters on `tenant_id`.

### 3.3 Document conventions
- IDs are app‑generated UUID strings (`id`), not Mongo `ObjectId`, so responses are JSON‑serialisable and never leak `_id`.
- Timestamps are ISO‑8601 UTC strings.

---

## 4. File System / Object Storage

DecisionOS uses **Emergent Object Storage** (an S3‑like HTTP service), not local disk (survives redeploys).

- `obj_store.py` initialises a storage session with `EMERGENT_LLM_KEY` and uploads/downloads by a UUID path
  `decisionos/<tenant_id>/<file_id>.<ext>`.
- The **DB `files` collection is the source of truth** — it holds metadata + `storage_path`; the bytes live in object storage.
- Upload: `POST /api/files` (stages a file, `kind=reference`) or `POST /api/tasks/{id}/attachment` (attaches to a task).
- Download/inline view: `GET /api/files/{file_id}/download` (tenant‑scoped; streams bytes back with the stored content‑type).
- Limits: allowed extensions (images, pdf, doc/docx, xls/xlsx, csv, txt); max 25 MB.

---

## 5. AI Pipeline

### 5.1 Providers & routing
- **Claude** (`claude_chat`) — all structuring/reasoning (`ai_extract`, execution plans, coach, Company‑Brain Q&A, onboarding OS generation).
- **OpenAI STT** (`transcribe_audio`) — converts recorded audio → transcript.
- **Gemini vision** — two readers:
  - `ai_extract_document` (`_DOC_SYSTEM`) — invoice/bill/receipt OCR → structured finance records.
  - **`ai_read_image_general`** (`_IMAGE_READ_SYSTEM`) — *general* transcription of ANY image/PDF (business cards, lists, notes, screenshots). Used by the capture‑reference pipeline so non‑invoice images are actually read.
- **Emergent Universal key** — automatic fallback for Claude/Gemini when the tenant's own key is missing or out‑of‑credits (`_ResilientChat`). Keeps the app working and is logged as an outage alert to the super‑admin.

### 5.2 Multi‑input capture (Decision Desk — 3 ways)
1. **Speak** + optional attachment(s)
2. **Type** + optional attachment(s)
3. **Upload image/file** (file is the primary input — no voice/type)

All three can attach **multiple files/pages** (front & back of a card, multi‑page order). Pipeline:
1. Files are staged via `POST /api/files` (`kind=reference`) → `file_ids`.
2. Capture posts `file_ids` with the audio/text (`/api/voice-notes`, `/api/voice-notes/text`).
3. `process_voice_note` (FastAPI **BackgroundTask**):
   - transcribe audio (if any),
   - **read every attachment** via `_read_reference_text` (images/PDF → `ai_read_image_general`; xlsx/csv → pandas; docx → python‑docx; txt → decode) and concatenate into `extra_context`,
   - `ai_extract(transcript, extra_context, …)` → Claude returns `{summary, decisions, tasks, workflow_events, reminders, meeting_events, memory_notes}` scoped to the tenant's real pipelines/roles,
   - create the `decision` (status `pending_approval`) + blocked `tasks` + `workflow` cards + calendar meetings + memory notes,
   - **attach the uploaded reference file(s) to ALL produced tasks** and store an `execution_summary`.
4. Owner reviews in **Review & Approve** (can reassign, attach more references, flag "require proof"), then approves → tasks unblock.

### 5.3 Usage tracking
Every AI call logs a `usage_events` row (feature, provider, token estimates/reals, cost estimate), aggregated in the Super‑Admin **Usage** tab by workspace and provider.

---

## 6. Security & RBAC

- **Auth:** login/register/OTP set an **HttpOnly, Secure, SameSite=None** cookie (`dos_token`, 7d). `get_current_user`
  reads the cookie first, falls back to `Authorization: Bearer`. Passwords hashed with **bcrypt**.
- **Super‑Admin:** a separate console (`/admin`) with its own collection (`platform_admins`), its own cookie
  (`dos_admin_token`) and JWT type, 5‑attempt/15‑min lockout, and an audit log (`platform_audit`).
- **RBAC:** the tenant's `roles` are the departments. Members carry granular **permissions**
  (e.g. `voice_capture`, `decisions_approve`, `team_manage`, `approvals`, `ledger/finance`, `brain`). Endpoints are
  gated by `require_perm(...)` / `require_role("owner")`. Owner implicitly has all permissions.
- **Tenant isolation:** enforced on every query by `tenant_id`; suspended tenants/users are 403'd centrally.
- **Evidence gate:** a task flagged `evidence_required` cannot be marked done until ≥1 non‑reference (proof) attachment exists (enforced server‑side).

---

## 7. Key Runtime Flows (summary; sequence diagrams in UML doc)

1. **Company provisioning** — signup → Claude generates OS → tenant doc + owner user (§2.3).
2. **Capture → decision → tasks** — 3‑way capture + multi‑page reading → AI structure → review/approve (§5.2).
3. **Execution & evidence** — assignee works a task, uploads proof, completion gate enforced.
4. **WhatsApp ingest** — inbound message/media → `wa_events`/`ingestions` → same extraction pipeline → inbox/review.
5. **Finance OCR** — bill/receipt upload → Gemini `ai_extract_document` → expense/asset/payment records + AI brief.
6. **Daily CEO Brief & follow‑ups** — a background scheduler sweeps tenants, emails digests and outage alerts.

---

## 8. Scaling & Notes / Trade‑offs
- **Logical multi‑tenancy** (shared collections + `tenant_id`) is simple and cost‑effective; for very large tenants,
  hot collections (`tasks`, `decisions`, `usage_events`) already have `tenant_id` indexes and can be sharded on `tenant_id`.
- **AI is generate‑once / cache‑refresh** where possible (e.g. finance briefs in `ledger_ai`) to control cost.
- **Background tasks** keep capture non‑blocking; the UI polls note `status` and reveals the Execution Summary on completion.
- **Fallbacks everywhere** (provider key → Emergent key) so a single expired key never takes the product down.

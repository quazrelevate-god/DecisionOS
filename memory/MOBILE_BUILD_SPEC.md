# DecisionOS — Mobile App Build Spec (handoff for Emergent Mobile Agent)

Purpose: build a native mobile app (Expo / React Native) that **reuses the existing
FastAPI + MongoDB backend** already powering the web app. No backend rewrite — the
mobile app is a new client against the same API. This doc is the contract.

---

## 0. Backend reuse — READ FIRST
- The mobile app must talk to the SAME backend. Do NOT create a new backend/DB.
- Base URL (production): `https://decisionos.biz`  → all API routes are prefixed `/api`.
  - Example: `POST https://decisionos.biz/api/auth/login`
- Put the base URL in an Expo env var (e.g. `EXPO_PUBLIC_API_URL`); never hardcode.
- The backend is confirmed mobile-ready: JWT Bearer auth, RBAC, multi-tenant, origin-reflecting CORS (native clients bypass CORS anyway).

## 1. Auth (token-based — already works for mobile)
- **Login:** `POST /api/auth/login` `{ email, password }` → `{ token, user, tenant }`.
- **Register (new workspace):** `POST /api/auth/register` (fields incl. `company_name, name, email, password, industry, description, company_size`). Returns `{ token, user, tenant }`.
- **Send the token** on every request as header `Authorization: Bearer <token>`.
  (The web uses an HttpOnly cookie; mobile should use the Bearer header — the backend supports both.)
- **Store the token** in `expo-secure-store` (not AsyncStorage).
- **Bootstrap on app open:** `GET /api/auth/me` → `{ user, tenant }`. Use this to restore session and to load the tenant's dynamic config (see §2). If it 401s, send user to Login.
- **Logout:** clear secure-store token (optionally `POST /api/auth/logout`).
- OTP login also exists: `POST /api/auth/otp/request`, `POST /api/auth/otp/verify` (optional for v1).

## 2. Dynamic per-workspace config (IMPORTANT — do not hardcode labels)
The app is multi-industry. `tenant` (from `/auth/me`) carries two structures the UI MUST read:
- `tenant.lexicon` → vocabulary: `customer_singular/plural`, `vendor_singular/plural`.
- `tenant.operating_model`:
  - `pipelines: [{ key, label, sub, approval_stage, stages: [{key,label}] }]` — drives the Workflows board (tabs = pipelines, columns = stages).
  - `task_categories: [{ key, label }]` — drives My Work task filter tabs and the task-type picker.
Mirror the web behavior: render tabs/columns/labels from these, with sensible fallbacks.
(Reference web helpers: `frontend/src/lib/lexicon.js`, `frontend/src/lib/operatingModel.js`.)

## 3. RBAC
- `user.role` (e.g. owner/sales/finance/operations/…) + permission keys drive visibility.
- Owner/approver-only actions: decision approve/reject, task reassign, delete task/workflow, tenant settings, lexicon/operating-model edit, invites.
- Employees primarily use: My Work, capture, notifications, their tasks.
- Hide/disable actions the role can't perform (backend still enforces 403 — handle gracefully with a toast).

---

## 4. MVP screens (priority order) + exact endpoints

### P0 — Auth & shell
- Login / Register screens (§1).
- Tab navigator + push-notification-ready notification bell.
- Notifications: `GET /api/notifications`, `POST /api/notifications/{nid}/read`, `POST /api/notifications/read-all`.

### P0 — Capture (the signature feature: speak a decision)
- Voice capture: record audio → `POST /api/voice-notes` (multipart: `file`, `language`). Returns a note id that is processed by AI in the background.
- Text capture: `POST /api/voice-notes/text` `{ text }`.
- Dictation-to-text helper (fill any input by voice): `POST /api/transcribe` (multipart `file`, `language`) → `{ text }`.
- Poll the created note: `GET /api/voice-notes/{note_id}` to show "structured" result.

### P0 — Decision Desk / Inbox (review & approve)
- List pending: `GET /api/decisions?status=pending_approval` (each decision has `tasks[]`).
- Approve/Reject: `POST /api/decisions/{id}/approve`, `POST /api/decisions/{id}/reject`.
- Add task to a decision: `POST /api/decisions/{id}/tasks`.
- Reassign a task's assignee (member OR role): `POST /api/tasks/{id}/reassign` `{ assignee_id }` or `{ assignee_role }`.
- Comment: `POST /api/decisions/{id}/comment`.

### P0 — My Work (tasks)
- List: `GET /api/tasks` (filter client-side by `task_type` using `operating_model.task_categories`; "completed" = terminal status).
- Task detail: `GET /api/tasks/{id}`.
- Update status/progress: `PATCH /api/tasks/{id}` and `POST /api/tasks/{id}/updates`.
- Create: `POST /api/tasks` (task_type from tenant categories).
- Respond / attach proof: `POST /api/tasks/{id}/respond`, `POST /api/tasks/{id}/attachment` (multipart).
- Execution plan (AI): `POST /api/tasks/{id}/execution-plan/generate`, `PATCH .../execution-plan`.

### P1 — Workflows board (pipelines)
- List by pipeline: `GET /api/workflows?type=<pipeline_key>`.
- Create: `POST /api/workflows`. Advance stage: `PATCH /api/workflows/{id}/advance` `{ stage, note }`.
- Tabs = `operating_model.pipelines`; columns = that pipeline's `stages`.

### P1 — CEO Brief (owner)
- Summary counts: `GET /api/brief`. Drill-down: `GET /api/brief/details?key=<row>`.
- Deep-link items to their record (task → task detail, purchase/payment → workflow card, complaint → contact).

### P1 — Company Brain
- Ask (AI answer): `POST /api/ask` `{ question }` → `{ answer, citations }`.
- Search (records): `GET /api/brain/search?q=...`.
- Both should offer a mic button (reuse `POST /api/transcribe`).

### P2 — People, Leave, Finance, Meetings (mirror web)
- People/contacts: `GET/POST /api/contacts`, `GET /api/users`.
- Leave: `GET /api/leaves`, `POST /api/leaves`, approve/reject endpoints.
- Finance ledger: `GET /api/invoices|payments|expenses` (role-gated).
- Meetings: `GET/POST /api/meetings`, `POST /api/meetings/text`.

---

## 5. File uploads (mobile)
- Use `expo-image-picker` / `expo-document-picker` + `FileSystem` → multipart POST.
- Chunk large files; show progress. Endpoints: voice-notes, task attachment, ingest/document.

## 6. Notes / gotchas
- Always read tenant `lexicon` + `operating_model` before rendering labels/tabs.
- Handle 401 globally (interceptor) → clear token, go to Login.
- Handle 403 gracefully (role restriction) with a toast, not a crash.
- Dates are ISO 8601 UTC.
- Reference web pages for parity: `Login.js`, `Inbox.js` (Decision Desk), `MyWork.js`, `Workflows.js`, `CEOBrief.js`, `Brain.js`/`AskAI.js`, `People.js`, `Leave.js`, `Ledger.js`.

## 7. Suggested v1 scope (fastest path to value)
Auth → Capture (voice/text) → Decision Desk (approve) → My Work → Notifications.
Everything else (Workflows, Brain, Finance, Leave) as v1.1.

# DecisionOS — PRD & Build Log

## Original Problem Statement
AI operating system for founder-led SMEs that captures spoken decisions, turns them into structured tasks, and gives teams a shared operational brain. Voice-first owner inbox, AI extraction pipeline, Company Brain, Ask AI, flagship workflows (Purchase→Payment, Sales→Dispatch), multi-tenant role-based access (Owner, Sales, Production, Finance), daily brief dashboard, async voice-note processing, email digest (Resend), Sharma-style demo seed.

## Architecture
- **Frontend**: React 19 + Tailwind (Brutalist "Swiss/High-Contrast" theme: Chivo + IBM Plex Mono, red/blue/yellow accents, rounded-none, hard offset shadows). Phosphor icons. React Query. Bearer-token auth in localStorage.
- **Backend**: FastAPI (single `server.py`), all routes under `/api`. JWT Bearer auth, bcrypt. Async voice pipeline via BackgroundTasks.
- **DB**: MongoDB (uuid string ids, ISO datetimes, `_id` excluded). Collections: tenants, users, decisions, tasks, workflows, voice_notes, activity.
- **AI**: Emergent Universal Key — Claude Sonnet 4.6 (extraction + Ask AI), OpenAI whisper-1 (transcription).
- **Email**: Resend (ready-to-plug; RESEND_API_KEY empty → digest returns mocked preview HTML).

## User Personas
- **Owner**: records/types directives, approves decisions & purchases, sends digest, manages team.
- **Sales / Production / Finance**: execute tasks, advance workflows in their lane, review Company Brain, Ask AI.

## Core Requirements (static)
Multi-tenant isolation, role-based access, voice+text capture, AI structuring with approval gating & task unblocking, linked-record Company Brain, natural-language Ask AI, two flagship workflows with stage gates, daily brief.

## Implemented (2026-07-01)
- JWT email/password auth; register creates tenant+owner; demo Sharma workspace auto-seeded (owner/sales/production/finance @sharma.com / demo1234).
- **Industry-aware onboarding**: 3-step registration wizard captures industry, company size, region, currency; AI (`/api/onboarding/suggest`) proposes team roles + products/services (editable). Roles are now **dynamic per tenant** (validated via `tenant_role_keys`); Owner implicit. Company profile shown on Team page; currency-aware amount formatting; workflows relabeled generically (Order Fulfilment / Procurement).
- Owner Inbox: in-browser mic recording (whisper) + text fallback; async job feed; owner-only posting.
- AI extraction: transcript → Decision (pending_approval) + linked blocked Tasks (assignee_role constrained to tenant roles); owner approve unblocks, reject cancels.
- Tasks board, Workflows kanban (next-stage-only, owner-gated purchase approval), Company Brain search, Ask AI, Daily Brief dashboard, mocked Resend digest, Team management.
- Fully responsive mobile app-style shell (top bar + drawer + bottom tab nav).
- **Contacts CRM** (`/contacts`): combined customers & vendors with company/phone/email/address/GST/tags/status/assigned-owner/notes; Owner+Sales manage (finance/production read-only); linked into workflows via contact picker; searchable in Company Brain and queryable via Ask AI.
- **Multilingual voice**: Owner Inbox language selector (Auto / English / Tamil / Tanglish); Whisper transcription (language/prompt) + Claude extraction understand all three and output structured English tasks.
- Tested: backend 58/58 pytest, frontend 100% across 7 iterations. No product bugs (one cosmetic hydration warning on an `<option>`, non-functional).

## Implemented (2026-07-02) — Data Input + Unified Inbox + 360° + Premium Onboarding
- **Data ingestion pipeline** (`/ingest`): PDF/image invoice OCR via Gemini vision (`gemini-2.5-flash`) and CSV/Excel import with AI auto-detect (Claude). Upload → AI extraction → editable **review panel** → File it → creates Contacts, Invoices/Bills, Payments + auto follow-up Tasks. New collections: `invoices`, `payments`, `ingestions`. Endpoints: `POST /api/ingest/document|csv`, `POST /api/ingest/{id}/commit`, `GET /api/ingest`, `/invoices`, `/payments`. Filed invoices searchable in Company Brain. WhatsApp webhook stub (`/api/webhooks/whatsapp`) ready, returns not_configured until keys added.
- **Unified Inbox** = the new PRIMARY home screen (`/`). Merges voice/text capture + uploads + incoming items; every item AI-classified into Customer/Supplier/Invoice/Payment/Complaint/Task/Approval/Reminder. Filter chips w/ open counts, mark done/dismiss, plus owner Pending-Approvals. New `inbox` collection + `add_inbox_item` helper wired into voice processing, ingestion (open→done on commit), complaints. Endpoints: `GET /api/inbox`, `POST /api/inbox/{id}/status`. Old Daily Brief dashboard moved to `/dashboard`.
- **360° Customer/Supplier profile** (`/contacts/:id`, Owner+Finance only): aggregates contact details, sales/purchase bills, payments, **outstanding** (Σ billed − Σ paid), follow-ups, complaints, tasks, decisions; suppliers add pending deliveries + price history. `GET /api/contacts/{id}/profile`.
- **Owner-level Ask AI over money** (Owner+Finance): `/api/ask` context extended with invoices, payments, per-party outstanding, company currency and today's date — answers "who owes the most", "not paid in 30 days", "yesterday's sales". Money data withheld from Sales/Production.
- **Premium 6-step onboarding** ("Digital Executive Office"): Step1 company+account+GST+branches, Step2 business scale, Step3 current software, Step4 connect (Excel live via ingestion; Tally/Zoho coming-soon), Step5 invite employees by mobile (pending invites), Step6 animated "AI learns business". Workspace is created at end of Step3 so Steps 4-5 run authenticated. Tenant now stores gst/branches/business_scale/current_software/invited_employees. Endpoints: `GET/POST /api/invites`.
- Tested: iterations 11-13 — backend 47/47 (+regression), frontend E2E across owner/finance/sales/production. No product bugs.

## Backlog / Next
- **P0 (needs user keys)**: WhatsApp Document Ingestion — Meta WhatsApp Cloud API webhook to auto-file forwarded invoices/screenshots via existing `ingest_document` pipeline. Awaiting WHATSAPP_TOKEN / phone-number-id / verify token.
- **P1 (needs user keys)**: Real SMS employee invites (Twilio) — wire into `POST /api/invites`. Zoho Books connector (customers/invoices/payments/bills) — needs Zoho Client ID/Secret.
- **P2**: Tally connector (read-only, local agent bridge). Real Resend digest send. Retry/backoff for transient LLM budget errors. Cursor pagination; split server.py into routers. Auto-mark invoices paid when payments reconcile against them.

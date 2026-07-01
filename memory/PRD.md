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

## Backlog / Next
- **P1**: Real Resend send (plug RESEND_API_KEY); scheduled/cron daily digest.
- **P1**: Retry/backoff for transient LLM "budget exceeded" in `process_voice_note`.
- **P2**: Cursor-based pagination for high-volume lists; split server.py into routers.
- **P2**: Purchase→Payment optional Stripe integration; WhatsApp/SMS alerts (post-MVP open questions).
- **P2**: Brute-force protection / password strength; explicit CORS origins for production.

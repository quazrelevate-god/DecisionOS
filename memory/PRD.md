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
- Owner Inbox: in-browser mic recording (MediaRecorder→whisper) + text fallback; async job status feed; owner-only posting.
- AI extraction: transcript → Decision (pending_approval) + linked blocked Tasks; owner approve unblocks tasks, reject cancels.
- Tasks board (blocked/todo/in_progress/done), manual create, mine filter.
- Workflows kanban: Sales→Dispatch & Purchase→Payment, next-stage-only advance, owner-gated purchase approval.
- Company Brain search across decisions/tasks/workflows with linked context.
- Ask AI command-line UI grounded in tenant data.
- Daily Brief dashboard (stats, pending approvals, overdue, activity) + mocked Resend digest.
- Team management (owner adds members).
- Tested: backend 100% (27 pytest), frontend 100% (15 flows). No product bugs.

## Backlog / Next
- **P1**: Real Resend send (plug RESEND_API_KEY); scheduled/cron daily digest.
- **P1**: Retry/backoff for transient LLM "budget exceeded" in `process_voice_note`.
- **P2**: Cursor-based pagination for high-volume lists; split server.py into routers.
- **P2**: Purchase→Payment optional Stripe integration; WhatsApp/SMS alerts (post-MVP open questions).
- **P2**: Brute-force protection / password strength; explicit CORS origins for production.

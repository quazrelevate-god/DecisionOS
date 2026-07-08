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
- Tested: iterations 11-14 — backend 62/62 (+regression), frontend E2E across owner/finance/sales/production. No product bugs.

## Task allocation to team members (2026-07-03)
- Tasks can be assigned to a specific person (assignee_id), not just a role. New Task dialog has a member picker + role fallback; each task card shows the assignee (person chip / role / Unassigned) and a "Reassign to…" dropdown. Backend validates assignee_id against tenant users and auto-derives assignee_role from the member; status-only PATCH preserves the assignee (exclude_unset).
- Voice/text directives resolve named people: `ai_extract` receives team member names and emits `assignee_name`; `match_member_by_name` (exact → first-name/token) maps it to a member so the task is assigned to that exact person, else falls back to role-based auto-assignment. Verified iterations 16 (47/47) & 17 (55/55).

## WhatsApp Cloud API ingestion (2026-07-02)
- Live Meta WhatsApp Business Cloud API webhook wired into the ingestion pipeline. `GET /api/webhooks/whatsapp` (verify handshake) + `POST /api/webhooks/whatsapp` (X-Hub-Signature-256 validated when WA_APP_SECRET set; processing in BackgroundTasks, returns 200 immediately).
- Incoming image/PDF → download media via Graph API (`v21.0`) → `ai_extract_document` → auto-`commit_ingestion_records` → ingestion + inbox item (source=whatsapp) → confirmation reply to sender. Text messages → structured via `process_voice_note`.
- Tenant resolution: sender phone matched against `tenants.invited_employees`, else `WA_TENANT_ID` env. Owner user used as created_by.
- Env (backend/.env): WA_ACCESS_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET, WA_TENANT_ID, GRAPH_API_VERSION. Empty until user provides → endpoint returns not_configured.
- Verified: GET verify returns challenge; POST text message created a whatsapp-sourced note structured into inbox. Media path reuses already-tested ingestion pipeline (not exercised live pending real creds).
- **Module-level per-employee permissions**: 9 access keys — inbox, data_input, people, finance, workflows, tasks, brain, ask, team_manage. Team "Add member" and per-member "Access" dialogs let the owner pick exactly what each employee can open/use (role-select pre-fills sensible defaults, editable). Endpoints: `POST /api/users` (permissions), `PATCH /api/users/{id}` (role+permissions), gated by `team_manage`.
- Enforcement: owner bypass; users with no `permissions` fall back to ROLE_DEFAULT_PERMS (sales→+data_input+people; finance→+data_input+finance; others→base). Backend `require_perm` guards Finance (`/invoices`,`/payments`,`/contacts/{id}/profile`, Ask-AI money), Data Input (`/ingest/*`), Team management (`/users`,`/invites`). Frontend hides nav items (Layout) and page actions (Ingest/Contacts/Inbox/ContactProfile) via `lib/perms.js` `hasPerm`.

## Feature — Add team members to a pending decision before approving (2026-07-08)
On the owner's Pending Approvals (Inbox), each decision now lists its tasks with the exact assignee (person chip or role) and an "Add team member / task" control. New endpoint `POST /api/decisions/{id}/tasks` (owner-only, TaskCreateInput) links a task to the decision: status `blocked` while the decision is pending (unblocks on approve), `todo` if already approved, `cancelled` if rejected; pushes into `decision.task_ids`, logs a timeline "Task added for X" event. `enrich_decision(s)` now runs tasks through `enrich_tasks` so assignee names show. Verified: adding a member to the pending "Chennai counter" decision created a blocked task for Amit Verma; approve unblocked all tasks to todo.

## Bug fix — Role-scoped Tasks visibility (2026-07-08)
Reported: logging in as Production showed ALL tasks (Sales + Finance too). Root cause: `GET /api/tasks` returned every tenant task to any user unless `?mine=true`; the Tasks board defaulted to `mine=false`. Fix: non-owners are now always scoped to their lane (`assignee_id == me OR assignee_role == my role`) in both `list_tasks` and `prioritize_tasks`; owner retains full visibility + optional `?mine` view. Because person-assigned tasks derive `assignee_role` from the member, a Production user sees the whole Production team lane (role tasks + any production member's tasks). Frontend: Tasks page shows a "<role> LANE" badge for non-owners (All/My toggle kept for owner only). Verified via curl (owner 263 all-roles; production 45 production-only; sales/finance likewise) + Production UI screenshot showing the Nylon99 production task in-lane.

## Operational Brain Roadmap — Phases 1-4 (2026-07-08)
Implemented all 4 phases of the user's 8-point "operational brain" expansion. All backend AI uses Emergent LLM Key (Claude Sonnet 4.6). Tested: iteration_18 (Phase 1&2, 55/55 backend + 100% FE) and iteration_19 (Phase 3&4, 12/12 backend + 100% FE).

- **Phase 1 — Decision Timeline & CEO Journal**: Every decision carries a git-style `timeline` array (`add_decision_event` helper) with events on capture/approve/reject/task-status. `GET /api/decisions/{id}/timeline`. CEO Journal (`GET /api/journal?q=`) groups decisions + memory notes by day, newest first. Frontend: `/journal` (nav "CEO Journal", brain perm) with date sections, "Today you decided…", and a Timeline dialog per decision.
- **Phase 2 — AI Task Prioritization**: `POST /api/tasks/prioritize?force=&limit=25` scores open tasks on 4 axes (business_impact, revenue, risk, urgency) + blended priority_score + reason via `ai_score_tasks` (chunks of 25, ~30s for a full batch). Scores CACHED on task docs (`ai_scores`, `scored_at`); non-forced calls skip already-scored. Frontend: `/priorities` (nav "Priorities", tasks perm) ranked list with score + 4 axis bars + Re-prioritize button.
- **Phase 3 — AI Relationship Graph & Business Calendar**: `POST /api/contacts/{id}/rescore` (finance) computes relationship_score + risk_score + reason + signals via `ai_score_contact`, cached on contact (`ai_relationship`), surfaced in profile. `GET /api/calendar?days=45` unifies payment-due (finance-only), task deadlines, deliveries, complaints, birthdays into a date-grouped agenda with overdue flags. Contacts now have optional `birthday`. Frontend: ContactProfile "Relationship Intelligence" card + `/calendar` (nav "Calendar") with type-filter chips.
- **Phase 4 — AI Meeting Notes & Operating Score**: `POST /api/meetings` (audio→Whisper) / `/api/meetings/text` → background `process_meeting` → Claude minutes (title/summary/key_points/decisions/action_items) + auto-creates tasks (source=meeting) assigned by name. `GET /api/meetings`, `/api/meetings/{id}`. `GET /api/operating-score` returns deterministic company score (execution/finance/sales/responsiveness, weighted) + per-employee execution leaderboard; finance category & outstanding hidden (null) for non-finance roles. Frontend: `/meetings` (mic + paste transcript + detail dialog) and `/operating-score` (company gauge + category bars + team leaderboard).

## Backlog / Next
- **P0 (needs user keys)**: WhatsApp Document Ingestion — Meta WhatsApp Cloud API webhook to auto-file forwarded invoices/screenshots via existing `ingest_document` pipeline. Awaiting WHATSAPP_TOKEN / phone-number-id / verify token.
- **P1 (needs user keys)**: Real SMS employee invites (Twilio) — wire into `POST /api/invites`. Zoho Books connector (customers/invoices/payments/bills) — needs Zoho Client ID/Secret.
- **P2**: Tally connector (read-only, local agent bridge). Real Resend digest send. Retry/backoff for transient LLM budget errors. Cursor pagination; split server.py (now ~2730 lines) into routers. Auto-mark invoices paid when payments reconcile against them. Backfill 'created' timeline events on pre-timeline decisions.


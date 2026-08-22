# DecisionOS Backend — Architecture

## Target structure (Phase B goal)

```
backend/
├── main.py                     # FastAPI app entry point (today: server.py)
├── config.py                   # ✅ env vars, LLM ids, roles/permissions constants
├── database.py                 # ✅ AsyncMongoClient + shared `db`
├── dependencies.py             # ⏳ get_current_user, require_perm, require_role
│
├── models/                     # 🟡 Pydantic request/response, grouped by domain
│   ├── tasks.py                # ✅ TaskCreateInput, TaskUpdateInput, TaskReassignInput, TaskRejectInput, ExecStep, ExecPlanInput, StepAskInput, TaskUpdateNoteInput, RespondInput
│   ├── inbox.py                # ✅ INBOX_CLASSES, InboxStatusInput
│   ├── auth.py, tenants.py, brain.py, ledger.py, signup.py, admin.py  # ⏳
│
├── routers/                    # 🟡 FastAPI endpoint groups (partial)
│   ├── auth.py                 # ✅ /api/auth/register /login /logout /me /profile /change-password
│   ├── tasks.py                # ✅ ALL 17 /api/tasks/* endpoints (list, get, delete, create, patch, reassign, approve, reject, clarify, execution-plan/* × 3, steps/ask, updates, respond, prioritize, attachment)
│   ├── decisions.py            # ✅ /api/decisions/*, /api/journal
│   ├── inbox.py                # ✅ /api/inbox, /inbox/{id}/status
│   ├── team.py                 # ✅ /api/users, /api/leaves, /api/attendance (15 endpoints)
│   ├── brief.py                # ✅ /api/brief, /api/brief/details, /api/brief/send-digest, /api/notifications (× 3)
│   ├── ledger.py               # ✅ invoices, expenses, payments
│   ├── signup.py               # ✅ voice interview
│   ├── admin.py                # ✅ superadmin
│   ├── onboarding.py           # ✅
│   └── brain/                  # 🟡 Company Brain surface
│       ├── ask.py              # ✅ routers/brain.py — /api/ask
│       ├── documents.py        # ✅ routers/brain_docs.py
│       ├── agent.py            # ✅ routers/brain_router.py
│       ├── context.py          # ✅ routers/brain_context_api.py
│       └── rbac.py             # ✅ services/brain_rbac.py
│
├── services/                   # 🟡 third-party integrations + business services
│   ├── obj_store.py            # ✅ (compat shim: backend/obj_store.py)
│   ├── brain_context.py        # ✅ (compat shim: backend/brain_context.py)
│   ├── brain_rbac.py           # ✅ (compat shim: backend/brain_rbac.py)
│   ├── tasks.py                # ✅ enrich_task, enrich_tasks, _can_work_task, TASK_STATUSES, _plan_progress, _tenant_industry, _attach_reference_ids, _derive_task_type, _task_activity
│   ├── llm.py                  # ⏳ Claude chat helper
│   ├── sarvam.py               # ⏳ STT/TTS
│   ├── ai_keys.py              # ⏳ runtime AI key management
│   └── usage.py                # ⏳ LLM usage / cost telemetry
│
├── utils/                      # ⏳ tiny cross-cutting helpers
│   ├── ids.py                  # new_id, slug
│   ├── time.py                 # now_iso, iso_to_dt
│   └── strings.py              # sanitizers, keyword extraction
│
└── tests/                      # 🟡 pytest suites (partial)
```

Legend: ✅ done · 🟡 partial · ⏳ pending

## Phase A — Foundation split (DONE, this pass)

- **`config.py`** — reads env vars once, exports LLM model ids, JWT settings, role/permission constants, AI provider keys.
- **`database.py`** — creates the single `AsyncMongoClient` and shared `db` handle.
- **`models/`, `services/`, `utils/`** folders scaffolded with `__init__.py` docstrings ready for Phase B fills.
- **`core.py`** now re-exports from `config` + `database` so **every existing `from core import X` continues to work**. 606 lines (down from 638 — mostly deduped constants). Every consumer imports through `core` today; migration is opt-in per router.

Behaviour change: **none**. Every endpoint, every helper, every dependency continues to resolve. Testing agent's 46-test regression suite passes unchanged.

## Phase B — Endpoint extraction (POST-LAUNCH, one domain per PR)

Order (safest → hardest):

1. **auth** — `/api/auth/register`, `/login`, `/logout`, `/me` → `routers/auth.py` ✅
2. **tasks** — `/api/tasks/*` (largest single domain, ~600 lines) → `routers/tasks.py` ✅ (all 17 endpoints extracted; helpers in services/tasks.py; inputs in models/tasks.py)
3. **services relocation** — `obj_store`, `brain_context`, `brain_rbac` → `services/` with compat shims ✅
4. **decisions** — `/api/decisions/*` + `/api/journal` → `routers/decisions.py` ✅
5. **inbox** — `/api/inbox`, `/inbox/{id}/status` → `routers/inbox.py` ✅
6. **team** — `/api/users`, `/api/leaves`, `/api/attendance` → `routers/team.py` ✅
7. **brief** — `/api/brief`, `/api/notifications` → `routers/brief.py` ✅
8. **finance/ledger** — extract remaining pieces still in server.py ⏳
9. **misc** — voice, calendar, meetings, complaints, workflows ⏳

For each PR:
- Move `@api.post/get/...` handlers verbatim into the new router.
- Move any private helpers the handler uses into the same router file OR into `services/`.
- Add `app.include_router(...)` in `main.py`.
- Delete the moved code from `server.py`.
- Testing agent runs full regression before merging.

## Conventions when adding a new endpoint

- **Never import from `server.py`** — it's the app entry, not a library. Import from `core`, `services/*`, or `routers/*`.
- **Every write to a tenant collection** must scope by `tenant_id` in the Mongo filter.
- **Every read of financial/HR/sales data** goes through `brain_rbac` before returning.
- **Use `now_iso()` and `new_id()`** — never `datetime.utcnow()` or bare `uuid4()`.
- **Fire-and-forget audit writes** (`brain_context.record_context`, `log_activity`) go inside `try/except` so a Brain write can't 500 the parent request.

## Epic 8 — Backend optimization & modularization (in progress)

Finishes the Phase A/B migration. The target stays a **flat `backend/` root**
(not a nested `app/`), so `server:app` and every `from core import ... /
from services import ...` keep working — no big-bang import rename. New
organizing packages are added as siblings of the existing `routers/`,
`services/`, `models/`, `utils/`:

```
backend/
├── server.py         # entry (server:app). Shrinks toward ~0 as domains move out.
├── bootstrap/        # ✅ S1: app assembly (routing, middleware); later: lifespan, seed, migrations
├── integrations/     # ⏳ S6: one adapter per external provider
├── workers/          # ⏳ S7: background jobs (schedulers, follow-ups)
├── shared/           # ⏳ S5: tiny stateless helpers (ids, json, normalizers)
├── core/             # ⏳ S2: core.py split into config / db / security / deps / ...
├── routers/  services/  models/  utils/    # existing (Phase A/B)
```

Layering (enforced from Sprint 8):

```
integrations  ->  (external SDKs only)
core          ->  config, integrations
shared        ->  core
routers / services / modules  ->  core, shared, integrations   (never each other's internals)
workers       ->  core, shared, integrations, service fns
bootstrap     ->  anything ;  nothing imports bootstrap except server.py
```

### Sprint 1 — modular foundation (DONE)

- Stood up `bootstrap/`, `integrations/`, `workers/`, `shared/` package skeletons.
- Extracted app assembly out of `server.py`:
  - `bootstrap/routing.py` → `register_api_routers(app, api)` (the `include_router` block).
  - `bootstrap/middleware.py` → `register_middleware(app)` (CORS + CSRF, order-preserving).
  - `server.py` now calls these two; the entry point stays `server:app`.
- **Verified byte-identical**: route table = 260 routes, same SHA-256 fingerprint; middleware stack `[CSRF, CORS]` unchanged.
- **Not touched this sprint** (deliberately): the 86 in-file `api` endpoints (Sprint 3), the `@app.on_event` startup/shutdown and `_bootstrap` (Sprint 7).

### Sprint 2 — core decomposition (in progress)

Splitting the 775→ `core.py` kitchen sink. Done as small, individually-verified slices; `core` keeps re-exporting every symbol so no caller changes.

- **Slice 1 (done):** pure normalizers → `shared/normalizers.py` (`normalize_os_blueprint` / `normalize_lexicon` / `normalize_operating_model` + helpers, `DEFAULT_OPERATING_MODEL` / `DEFAULT_LEXICON`). `core.py` 917 → 628 lines. Verified byte-identical: normalizer golden hash + 260-route fingerprint unchanged. Pure functions, no db/auth — safe without the integration suite.
- **Deferred until the full regression suite is runnable** (auth/security/db-critical): `security.py` (hashing/JWT/cookies), `deps.py` + `permissions.py` (`get_current_user` / `require_perm` / `user_perms`), `usage.py` + `integrations/llm.py` (telemetry + resilient chat), then `core.py` → `core/` package and shim retirement.
- **Slice 2..8 (done):** `core.py` fully decomposed into a `core/` package (`config`, `db`, `security`, `deps`, `permissions`, `ai_keys`, `usage`) plus `shared/` (ids, json, normalizers) and `integrations/llm.py`. Every symbol re-exported from `core`; all 11 compat shims retired (call sites rewritten to real paths). 260-route fingerprint held; login→logout→revoked live-verified.

### Sprint 3 — domain router extraction (COMPLETE)

All **86 inline `@api` endpoints** moved out of `server.py`'s God router into 21 focused modules under `routers/` (workflows, meetings, captures, contacts, complaints, brain_search, operating_score, calendar, voice_notes, dashboard, auth_otp, tenant_settings, finance, whatsapp, files, health). The in-file `api = APIRouter(...)` object and its `include_router` were deleted; `register_api_routers(app)` now mounts only the domain routers. `server.py` went 7333 → ~4938 lines with **zero `@api` endpoints** left. Route fingerprint held at **260** across every single extraction; each router live-smoked. Handlers still reach shared business logic via **deferred `from server import ...`** — those helpers move to `services/` in Sprint 4.

### Sprint 4 — service-layer isolation (COMPLETE)

Pulled the business logic that still lived in `server.py` into **16 domain services**, so routers (and future workers/CLIs) call a service instead of importing from `server`. Strangler-safe: each helper was moved verbatim to a `services/*` module importing only `core` / `shared` / other leaf services at module top (any residual `from server import ...` stays **deferred** inside functions to avoid an import cycle), and `server.py` **re-exports** the moved names so every existing call site keeps resolving. Route fingerprint asserted **260** before/after every slice; each slice was import-resolution-checked and live-smoked (including the full voice pipeline end-to-end).

Services created (in dependency order, leaf-first):

| Module | Contents |
|---|---|
| `services/email.py` | `send_email`, `_smtp_send_sync`, `SMTP_*` |
| `services/notifications.py` | `push_notification`, `dispatch_owner_alert`, `_owner_ids`/`_approver_ids`/`_finance_user_ids`, `NOTIF_LEVELS` |
| `services/enrich.py` | `enrich_contacts`, `enrich_decision`, `enrich_decisions` |
| `services/ai/extraction.py` | `ai_extract`, `ai_score_tasks`, `ai_score_contact`, `ai_meeting_notes`, `ai_execution_plan`, `ai_step_assist` |
| `services/transcription.py` | Sarvam/OpenAI/Whisper STT, lang helpers, `_log_stt_usage`, STT client factory |
| `services/vision.py` | Gemini OCR client, `_gemini_doc_sync`/`_gemini_read_sync`, `ai_read_image_general` |
| `services/operating_score.py` | company/self operating views, `compute_employee_stats`, `ai_work_coach`, `_score_*` |
| `services/meetings.py` | `process_meeting` |
| `services/voice.py` | `process_voice_note` + `_create_*` + member matching/assignment |
| `services/ai/generators.py` | lexicon / operating-model / finance-cat generators, `tenant_operating_model`, `backfill_operating_model`, `lang_directive` |
| `services/ingestion.py` | document AI extract + purchase classify + `commit_ingestion_records` engine |
| `services/finance_signals.py` | `run_followup` escalation + `run_finance_actions` engine + money helpers |
| `services/captures.py` | WhatsApp Smart-Capture triage + review-draft engine |
| `services/whatsapp.py` | WA Cloud API infra + inbound image/doc/text/voice pipeline |
| `services/files.py` | reference-file store + AI analysis + text extraction |
| `services/leave.py` | leave approver resolution + request + AI impact |

`server.py` **4,938 → 2,297 lines**. What remains there is genuinely not S4: shared constants (`WORKFLOW_STAGES`, `CONTACT_TYPES`, …), inline Pydantic models (→ S5), `add_inbox_item`, the OTP infra, and `_bootstrap`/seed/migrations/lifecycle + the scheduler loops (→ S7). Routers were repointed: every module-top `from server import <business helper>` now imports from the owning service; the only module-top `from server import` left in routers are models (S5), shared constants, OTP infra, and `add_inbox_item`. Deferred in-function imports remain the sanctioned lazy pattern and now resolve through `server`'s re-exports, which delegate to the services.

### Sprint 5 — schema & model consolidation (COMPLETE)

Gathered **all 88 request/response Pydantic models** — 13 inline in `server.py` and 68 scattered across routers — into a **per-domain `models/` package (20 files)**. A detection pass first proved every inline model was self-contained (no references to module-level constants, no `re`, no custom validators), so the moves were pure text relocation; the route fingerprint stayed **260** automatically (models don't touch routing) and behaviour was confirmed with an HTTP validation smoke (bad payload → 422, valid → 200) across ten domains.

- **Dead duplicates deleted** from `server.py`: `RegisterInput`, `LoginInput` (the live versions live in `routers/auth.py` → now `models/auth.py`), `UserCreateInput`, `UserUpdateInput`, `AttendanceInput` (live in `models/team.py`).
- **Deduped shared shapes**: `RoleItem` / `ProductItem` live once in `models/tenant.py` and are re-used by `models/auth.py`; `ProfileUpdateInput` / `ChangePasswordInput` live once in `models/auth.py` and are imported by `tenant_settings`.
- **`models/__init__.py`** is now the domain index (was stale "empty scaffolding").
- `server.py` **2,297 → 2,209 lines** and defines **zero** models; it re-exports the handful of moved shapes that tests still import via `from server import <Model>`. Every router imports from `models.<domain>`; no model is defined inline anywhere.

What remains in `server.py` is now purely Sprint 7 territory: shared constants, `add_inbox_item`, the OTP infra, `_bootstrap` / seed / migrations / lifecycle, and the scheduler loops.

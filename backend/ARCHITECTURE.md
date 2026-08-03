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
ow()` or bare `uuid4()`.
- **Fire-and-forget audit writes** (`brain_context.record_context`, `log_activity`) go inside `try/except` so a Brain write can't 500 the parent request.

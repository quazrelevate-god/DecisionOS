# Epic 8 · Sprint 1 — Backend Modularization Analysis

**DecisionOS backend · FastAPI**
Author: engineering · Date: 2026-08-20 · Branch: `Backend_optimization`
Status: **Analysis for sign-off** (no code moved yet)

---

## 1. Executive summary

The DecisionOS backend works, ships, and is feature-rich — but it is a **half-finished migration**.
A prior effort ("Phase A", "Phase B") pulled the database layer and ~19 domains out into
`routers/` and `services/`, then stopped. The result is a codebase split down the middle:

- **Half is modular** — 19 routers, a `services/` package with `auth/` and `ai/` sub-packages, a clean `config.py`.
- **Half is still a monolith** — `server.py` is **6,665 lines** holding **86 API endpoints**, **35 Pydantic models**, all the AI/transcription/finance/WhatsApp business logic, and a **~900-line `_bootstrap`** — while `core.py` (775 lines) is a kitchen sink of infra + auth + AI + billing telemetry + domain normalizers.

Sprint 1's job is **not** to move code yet. It is to (a) map the real current state, (b) name the
structural problems precisely, (c) agree the **SaaS-ready, domain-modular target architecture**, and
(d) fix the migration order so every later sprint is a safe, test-guarded, behavior-preserving step.

> **The one-line goal of Epic 8:** take the backend from *"works but only its authors can navigate it"*
> to *"a new engineer finds any endpoint in 30 seconds and changes it without fear."* No change to
> external API behavior along the way.

---

## 2. How we got here

This is not greenfield. The tree carries visible archaeology of an interrupted refactor:

| Evidence | What it tells us |
|---|---|
| `database.py` docstring: *"Split out of core.py in Phase A"* | DB layer was already extracted — good, keep it. |
| `obj_store.py`, `brain_context.py`, `brain_rbac.py` are 4–15 line **compat shims** | A move was started (`import obj_store` → `services/obj_store`) but downstream imports were never finished, so stubs linger. |
| `tests/test_iteration80_phaseb_refactor.py`, `..81_tasks_router`, `..82_inbox_brain_refactor`, `..83_brief_team_refactor` | Router extraction happened in named waves — and then stalled with `server.py` still huge. |
| 3 late imports (`from routers.ledger import ...` *inside function bodies*, lines 1315 / 4426 / 4578) | Circular dependencies are being dodged by hand — a symptom of blurred layering. |

**Epic 8 finishes what Phase A/B started.** We are completing a migration, not inventing one.

---

## 3. Current-state map

### 3.1 The big files (application code, excludes `.venv` and `tests/`)

| Lines | File | What lives here |
|------:|------|-----------------|
| **6,665** | `server.py` | App assembly **+** 86 inline endpoints **+** 35 models **+** AI/STT/voice pipeline **+** ingestion/finance **+** WhatsApp **+** capture/triage **+** ~900-line bootstrap |
| 1,256 | `routers/auth.py` | Auth endpoints (already extracted, but fat) |
| 1,210 | `routers/ledger.py` | Finance ledger (expenses/assets/inventory/reconcile) |
| 876 | `routers/brain.py` | Brain / RAG endpoints |
| 828 | `routers/tasks.py` | My Work / tasks |
| **775** | `core.py` | Kitchen sink (see §4.2) |
| 622 | `routers/desk.py` | Decision Desk |
| 564 | `services/workflow_engine.py` | Workflow state machine |
| 562 | `routers/signup.py` | Signup / dynamic interview |
| 555 | `routers/admin.py` | Superadmin portal |
| 539 | `routers/team.py` | Team / people |
| 243 | `config.py` | **Clean** — typed-ish settings, the one file to emulate |

### 3.2 Anatomy of `server.py` — what the monolith actually contains

Reading top to bottom, `server.py` is **nine unrelated concerns stacked in one file**:

1. **35 Pydantic models** (lines 57–231 + ~20 more declared inline next to their endpoints)
2. **AI/LLM helpers** — `ai_extract`, `ai_score_tasks`, `ai_score_contact`, `ai_meeting_notes`, `ai_execution_plan`, `ai_step_assist` (279–563)
3. **Speech-to-text** — OpenAI / Gemini / Sarvam clients, `transcribe_audio*` (563–868)
4. **Voice-note pipeline** — `process_voice_note` and its `_create_*` fan-out (874–1200)
5. **Operating-model / lexicon AI** (1206–1400)
6. **86 HTTP endpoints** across auth, settings, roles, CRM, voice notes, meetings, operating score, work coach, workflows, brain, dashboard, HR, files, ingestion, finance, leave, WhatsApp, capture
7. **Integrations inline** — SMTP email, WhatsApp send/receive, media download
8. **Capture / triage engine** (5594–5998)
9. **`_bootstrap` (~900 lines, 6328–7228)** + seed + migrations + startup/shutdown

**Endpoint split (the headline metric):**

```
Endpoints still inline in server.py : 86   (35 GET · 31 POST · 12 PATCH · 5 DELETE · 2 PUT · 1 app.get)
Endpoints already in routers/        : ~19 routers wired via app.include_router(...)
```

Roughly **half the public API surface is still defined in the file that is supposed to only assemble the app.**

### 3.3 Folder tree — as it stands today

```
backend/
  server.py          6665  ← app assembly + giant "api" router + business logic + bootstrap
  core.py             775  ← kitchen sink (infra + auth + authz + AI + usage + normalizers)
  config.py           243  ← settings (clean)
  database.py          14  ← real DB module (Phase A)
  obj_store.py         15  ← COMPAT SHIM → services/obj_store
  brain_context.py     12  ← COMPAT SHIM → services/ai/brain_context
  brain_rbac.py        11  ← COMPAT SHIM → services/ai/brain_rbac
  routers/    (19 files)   ← split by HTTP layer, not by domain
  services/   (flat + auth/ + ai/)   ← business logic, partially populated
      auth/   (9 files)   ← the best-organized corner of the codebase
      ai/     (6 files)
  models/     (4 files, ~123 lines total)   ← nearly empty; models live in server.py instead
  utils/      (__init__ only, 5 lines)      ← empty placeholder
  scripts/    (verification scripts)
  tests/      (60+ test_iteration*.py)
  uploads/    (runtime data)
```

---

## 4. The structural problems (why this hurts)

### 4.1 `server.py` is a God module
6,665 lines, 86 endpoints, 35 models, and business logic all in one file. Consequences: merge
conflicts on almost every backend PR, no way to reason about one domain in isolation, and a 900-line
`_bootstrap` that must be read to understand startup.

### 4.2 `core.py` is a kitchen sink
"Core" should be a thin foundation. Today it mixes **seven** responsibilities: Mongo handle (infra),
AI provider keys + rates (config), the resilient LLM chat wrapper (an integration), usage/cost
telemetry (billing), CSRF/auth/admin cookies + password/JWT (security), `get_current_user` /
`require_role` / `require_perm` (auth deps), and blueprint/lexicon/operating-model **normalizers**
(domain logic). Everything imports `core`, so everything transitively depends on all of it.

### 4.3 Circular dependencies dodged by hand
`server.py` imports from `routers.ledger`, and `routers` import from `core`, and `server` imports
routers at the bottom — so three call sites do **late imports inside function bodies** to break the
cycle. That is the layering telling us it is inverted: shared logic (finance categories, reconcile)
lives in a *router* instead of a *service*.

### 4.4 Schemas are scattered
**35 `BaseModel` classes in `server.py`** plus more inline in routers; meanwhile `models/` holds ~123
lines across 4 files. There is no single place to see a domain's request/response contract.

### 4.5 Folders are split by technical layer, not domain
`routers/` + `services/` + `models/` is "package by kind." To change *Finance* you touch
`routers/ledger.py`, business logic in `server.py`, models in `server.py`, and `services/*`. A
**"package by feature"** layout puts everything for Finance in one folder.

### 4.6 Compat-shim debt
`obj_store.py`, `brain_context.py`, `brain_rbac.py` and several 4-line `services/*.py` are stubs whose
own docstrings say *"will be removed once every downstream import has been migrated."* They never were.

### 4.7 Business logic welded to transport
AI calls, transcription, the voice pipeline, document ingestion, WhatsApp, SMTP, and the capture engine
all live in the endpoint file. They cannot be unit-tested without spinning up FastAPI, and cannot be
reused by a worker or a CLI.

---

## 5. Target — SaaS-ready, domain-modular architecture

**Principle: package by feature.** Each business domain gets one self-contained module owning its
router, schemas, service (business logic), and dependencies. Cross-cutting concerns live in thin,
clearly named shared layers. This is the widely-adopted FastAPI-at-scale layout (domain modules +
`core` + `integrations`).

```
backend/
  app/
    main.py            # ONLY: create FastAPI, add middleware, include module routers
    lifespan.py        # startup/shutdown (replaces @app.on_event)

    core/              # thin foundation — no domain logic
      config.py        # typed Settings (pydantic BaseSettings) — absorbs today's config.py
      db.py            # Mongo client + db handle (today's database.py)
      security.py      # password hashing, JWT, auth/admin/CSRF cookies
      deps.py          # get_current_user, require_role, require_perm, platform-admin
      permissions.py   # PERMISSION_KEYS, user_perms, clean_perms
      logging.py       # logger + usage/cost telemetry
      errors.py        # shared HTTP error envelope

    shared/            # tiny stateless helpers, reused everywhere
      ids.py           # now_iso, new_id
      json.py          # _extract_json
      normalizers.py   # blueprint / lexicon / operating-model normalizers
      schemas.py       # base & shared pydantic models

    modules/           # ← the product, one folder per domain
      auth/            router.py  schemas.py  service.py  deps.py
      onboarding/      router.py  schemas.py  service.py
      tenant/          router.py  schemas.py  service.py     # settings, roles, perms, AI keys, consent, audit
      capture/         router.py  schemas.py  service.py  pipeline.py   # voice/text/meeting + transcription
      decisions/       router.py  schemas.py  service.py     # decisions, desk, dex
      tasks/           router.py  schemas.py  service.py
      workflows/       router.py  schemas.py  service.py  engine.py
      crm/             router.py  schemas.py  service.py     # contacts, complaints, profile/scoring
      finance/         router.py  schemas.py  service.py  ingestion.py  classify.py  # ledger, invoices, payments
      brain/           router.py  schemas.py  service.py  retrieval.py  rbac.py  context.py
      operating_score/ router.py  service.py               # score + work coach
      brief/           router.py  service.py               # dashboard / CEO brief
      people/          router.py  schemas.py  service.py    # team, leave, attendance, memory
      whatsapp/        router.py  service.py  webhook.py
      billing/         router.py  service.py               # Razorpay
      admin/           router.py  schemas.py  service.py

    integrations/      # every external provider behind one adapter each
      llm.py           # claude_chat / resilient wrapper + provider keys
      openai_stt.py    gemini.py     sarvam.py
      whatsapp_api.py  razorpay.py   email_smtp.py
      obj_store.py     ssrf_guard.py

    workers/           # background, no HTTP
      scheduler.py     # _followup_scheduler_loop
      followups.py     # run_followup, run_finance_actions
      leader_lock.py

    bootstrap/         # one-time setup, out of the request path
      seed.py          # seed_demo, write_test_credentials, seed_platform_admin
      migrations.py    # migrate_tenants, uploads→obj_store, fixup_demo_tenant
      bootstrap.py     # today's ~900-line _bootstrap, decomposed

  tests/               # mirrors modules/ one-to-one
  scripts/             # keep (standalone verification scripts)
```

**What each layer may import** (the rule that kills circular deps):

```
integrations  →  (external SDKs only)
core          →  config, integrations
shared        →  core
modules/*     →  core, shared, integrations         (never another module's internals)
workers       →  core, shared, integrations, module services
bootstrap     →  everything
app/main      →  wires it all together
```

A module never reaches into another module's files — if two modules need the same logic, it moves to
`shared/` or a service they both import. That single rule makes the dependency graph a DAG and the
late-import hacks disappear.

---

## 6. Migration strategy — safe, incremental, behavior-preserving

We use the **strangler-fig** pattern: stand the new structure up *beside* the old, move one domain at
a time, keep the app running and green after every step.

1. **Parallel structure, not big-bang.** `app/` grows next to today's files. Nothing is deleted until
   its replacement is wired and tests pass.
2. **One domain per PR.** Move Finance, prove it, merge. Then CRM. Small, reviewable diffs.
3. **Keep the shim pattern working *during* transition, then delete it.** The existing compat-shim
   trick (re-export from the old path) is exactly how we keep old imports alive mid-move — the
   difference is Epic 8 *finishes* by deleting every shim, not leaving them.
4. **API parity is the contract.** Same routes, same status codes, same payloads before and after —
   proven by contract tests (Sprint 10). External behavior does not change in this epic.
5. **Test-guarded seams.** The 60+ `test_iteration*` tests are the safety net; each move runs the full
   suite before merge.

**Sprint sequence (the whole epic, dependency-ordered):**

```
S1  Modular foundation & this analysis      →  agree target, stand up app/ skeleton + app-assembly split
S2  Core decomposition & typed settings     →  core.py → core/ ; kill shims
S3  Domain router extraction                →  86 inline endpoints → modules/*/router.py
S4  Service-layer isolation                 →  business logic out of routers → services
S5  Schema & model consolidation            →  35+ models → modules/*/schemas.py
S6  Integration adapters                     →  OpenAI/Gemini/Sarvam/WhatsApp/Razorpay/SMTP → integrations/
S7  Background jobs & bootstrap lifecycle    →  _bootstrap + schedulers → workers/ + bootstrap/
S8  Code review & readability pass           →  naming, types, docstrings, dead code, lint/format
S9  Performance & data-access optimization   →  N+1, Mongo indexes, async correctness, pagination
S10 Test restructure, API-parity gate & CI   →  tests mirror modules; contract tests; CI exit gate
```

---

## 7. What "readable" means (the standard we hold to)

Definition-of-readable, enforced from Sprint 8 (and not regressed after):

- **Size ceilings.** No file > ~400 lines; no function > ~50 lines without a reason in a comment.
- **One file, one concern.** A reader should predict a file's contents from its path.
- **Full type hints** on every public function signature; `mypy`/`pyright` clean on new code.
- **Docstrings** on every module and every non-trivial public function — *what and why*, not *how*.
- **Consistent errors.** One error envelope; no bare `except:`; no silent `pass`.
- **Import hygiene.** No late imports inside function bodies; no wildcard imports; import order enforced.
- **Formatter + linter in CI.** `ruff` + `black` (or equivalent); the build fails on drift.

---

## 8. Scope of Sprint 1 (only this sprint)

Sprint 1 is **foundation and agreement**, deliberately low-risk:

- ✅ This analysis (current-state map + problem inventory + target architecture) — **for sign-off**.
- ⏭ Stand up the empty `app/` skeleton (`core/`, `shared/`, `modules/`, `integrations/`, `workers/`,
  `bootstrap/`) with `__init__.py` and READMEs, importing nothing yet.
- ⏭ Split **app assembly only** out of `server.py` into `app/main.py` + `app/lifespan.py` (move the
  `FastAPI()` creation, middleware, `include_router` calls, and startup/shutdown — **no endpoints**).
- ⏭ Adopt the layering-import rule (§5) and wire a CI check that forbids cross-module imports.

**No endpoint, model, or business function is relocated in Sprint 1.** Those are Sprints 2–7, one
domain at a time. This keeps Sprint 1 reviewable and reversible.

---

## 9. Risks & guardrails

| Risk | Guardrail |
|---|---|
| Import cycles during the move | The §5 layering rule + a CI import-linter; shared logic goes to `shared/`, not sideways. |
| Behavior drift (a route quietly changes) | API-parity contract tests (S10) + full `test_iteration*` suite green on every PR. |
| Big-bang temptation | One domain per PR; `app/` runs beside old code until each domain is proven. |
| Shims left behind again | "Delete the shim" is an explicit exit criterion of the sprint that migrates its callers — tracked, not optional. |
| Refactor stalls half-done (like Phase A/B) | Epic-level exit gate (S10): zero endpoints in `server.py`, zero compat shims, CI import rule enforced. |

---

*Prepared for founder sign-off before any code is moved. On approval, Sprint 1 proceeds to the
skeleton + app-assembly split; Epic 8 tracker holds the sprint plan (task-level backlog is filled in
per sprint as each is picked up).*

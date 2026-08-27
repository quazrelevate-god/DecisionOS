# Epic 8 · Sprint 8 — Code Review & Readability Audit

_Kickoff of the enforced readability standard: ruff + black + import-linter, wired into CI._

## Tooling now in place

| Tool | Config | Scope | Gate |
|---|---|---|---|
| **ruff** 0.16.4 | `backend/pyproject.toml` `[tool.ruff]` | whole tree | **hard** — `ruff check .` is green |
| **black** 26.5.1 | `backend/pyproject.toml` `[tool.black]` | `.black-managed` allowlist | **hard** on managed paths |
| **import-linter** 2.13 | `backend/.importlinter` | whole tree | **hard** — 5/5 contracts KEPT |

CI: `.github/workflows/backend-lint.yml` (runs on PRs + pushes touching `backend/`).
Local mirror: `bash backend/scripts/lint.sh`. Dev install: `pip install -r backend/requirements-dev.txt`.

**Line length = 120** (covers p99 of the existing tree, so black is a light touch).
Ruff runs `E, W, F`; `E501` deferred to black, and `E402/E701/E702/E741` accepted as the
codebase's established style. The valuable **F-codes (pyflakes) stay on**.

## Real bugs found by the review (fixed)

Ruff's `F821`/`F601`/`F811` surfaced genuine latent defects — the same class Sprint 7 hit:

1. **`routers/files.py`** — `UPLOAD_DIR` used at two endpoints (legacy file serve, brochure
   download) but **never imported** → `NameError` when either path is hit.
2. **`routers/finance.py`** — `DOC_MIME` used in the finance document-upload endpoint but
   **missing from the ingestion import** → `NameError` on every finance PDF/image upload.
3. **`bootstrap/migrations.py`** — `{"$ne": None, "$ne": ""}` duplicate dict key: `$ne: None`
   silently dropped (only `""` filtered). Fixed to `{"$nin": [None, ""]}`.
4. **`routers/tasks.py`** — `_tenant_industry` imported *and* redefined locally (import was
   dead); removed the dead import.
5. **`routers/crm.py`** — redundant in-function `datetime` re-import (shadowed module import).
6. **Dead assignments** removed: `routers/desk.py` (`last`), `services/auth/session_tracking.py`
   (`now_dt`), `scripts/we06_engine_verify.py` (`result`).

Plus **`UPLOAD_DIR` centralized** to `config.py` (single source; it had been copy-defined in
`server.py`, re-derived in `bootstrap/migrations.py`, and missing in `routers/files.py`).

## Import hygiene

`ruff check --fix` removed ~130 genuinely-unused imports across ~50 router/service modules
(dead `typing`/`fastapi`/`pydantic`/stdlib names left over from the Epic 8 extractions).
Verified safe: full compile + 135-module import-sweep + route-fingerprint parity, all green.

## Layering contracts (import-linter)

Five contracts, all **KEPT**:
1. Routers must not import app-assembly (`bootstrap`/`workers`).
2. Services must not import app-assembly.
3. Integrations must not import routers or app-assembly (adapters are leaf).
4. `models` is a pure schema leaf.
5. `shared` is a pure helper leaf.

**Known layering debt** (catalogued in `.importlinter`, target for S9/S10 — not yet paid down):
- 5 `services → routers` edges (cross-domain helpers still living in a router:
  `brain_retrieval→brain_docs`, `generators→ledger`, `finance_signals→access`,
  `ingestion→ledger`, `workflow_engine→ledger`).
- `core.deps → services.auth.*`, `core.usage → services.ai.pii`, `core → integrations.llm`
  (claude_chat facade), and `integrations.llm → services.ai.{llm_limits,pii}` (guarded_llm is
  intentional cross-cutting policy). `server` stays an unconstrained re-export hub (S10 "0 shims").

## Oversized-file audit (standard: < 400 lines)

Import hygiene, one error envelope (`HTTPException`), and typed handler signatures are the norm
across the tree. **File size is the one standard not yet met**: 15 non-test app modules exceed
400 lines. These are cohesive domain modules; splitting them is S3-style extraction (own effort,
real breakage risk) and is **deferred as tracked debt**, not attempted in this readability pass.

| Lines | File | Split candidate |
|---|---|---|
| 1363 | `routers/ledger.py` | expenses / assets / inventory / invoices sub-routers |
| 1267 | `routers/auth.py` | login+register / password / profile |
| 999 | `routers/brain.py` | ask / query / enrichment |
| 995 | `bootstrap/lifecycle.py` | `_bootstrap` index/seed sections (inherently large) |
| 893 | `routers/tasks.py` | task CRUD / handoff / AI-assist |
| 760 | `routers/desk.py` | summary / narrative / finance rollups |
| 643 | `routers/admin.py` | tenants / observability / AI-quality |
| 625 | `services/workflow_engine.py` | stage engine / side-effects |
| 615 | `routers/tenant_settings.py`, 595 `routers/team.py`, 595 `services/ingestion.py` | — |
| 558 | `routers/signup.py`, 485 `bootstrap/seed.py`, 448 `routers/brain_router.py`, 412 `services/voice.py` | — |

`server.py` (412) is the thin assembly hub (imports + re-exports + `/health` + registration) —
not a split candidate.

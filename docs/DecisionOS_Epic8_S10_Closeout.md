# Epic 8 · Sprint 10 — Test Restructure, API-Parity Gate & Close-Out

_The finish line: make the "zero API change" promise executable, cover the new modules,
retire the server-import shims, and lock it all behind a CI gate._

## The API-parity gate (U8-10.1)

`tests/test_api_parity.py` is the whole-epic promise made permanent: it asserts the app's
**route surface (every method+path) and middleware stack** against a committed baseline
(`tests/fixtures/api_route_baseline.json` — 266 method-rows, sha `2d443ae0`, `[CSRF, CORS]`).
Any endpoint moved/renamed/dropped, or a middleware reordered, fails here with an explicit
added/removed diff. When a change is *intended*, `python tests/regen_api_baseline.py`
regenerates the baseline so the diff is reviewed, never silent. Runs with no database.

## Tests for the Sprint 7 modules (U8-10.2)

`tests/test_epic8_s7_modules.py` covers what shipped with only per-slice smokes:
- **lifespan** — entering schedules `_bootstrap` + the follow-up loop; exiting awaits
  `client.close()` (mocked, no DB).
- **otp** — `_hash_otp` is deterministic + salted; policy constants present.
- **schedulers** — the `_followup_last_run` bugfix (same map object as `finance_signals`).
- **migrations** — `UPLOAD_DIR` is core's single source (S8 centralization).
- **exit invariants** — server.py owns 0 domain endpoints (only `/health`); 0 server-import
  shims in app code (see below).

New tests follow the "mirror the module" convention; the legacy `test_iteration*` suite is
grandfathered.

## Shim sweep — 0 `from server import` in application code (U8-10.3)

The whole modularization used `server.py` as a backward-compat re-export hub: routers/services
reached moved helpers via **deferred** `from server import ...` (the circular-dep dodge). This
sprint retired that surface from application code.

- **55 import statements across 22 files** repointed to each name's **real home** (mapped by
  where it is actually defined). Because every one was a deferred in-function import, retargeting
  is cycle-safe.
- Relocated the last server-owned pieces: contact vocab (`CONTACT_TYPES`/`CONTACT_STATUS`/
  `LIFECYCLE_STAGES`) → `models/contacts.py`; `_mask_phone` → `services/whatsapp.py`.
- **Fixed a latent ImportError:** `routers/team.py` did `from server import _mask_phone`, but
  server never defined or re-exported `_mask_phone` — it would have raised on the member-phone
  display path.
- Result: **`routers/`, `services/`, `bootstrap/`, `workers/` contain zero `from server import`**
  — locked by `test_no_server_import_shims_in_app_code`. `server.py` keeps a re-export surface
  only for the grandfathered `test_iteration*` suite.

Verified live: all repointed endpoints (`/brief`, `/brief/details`, `/decisions`, `/tasks`,
`/contacts`, `/workflows`, `/desk/summary`) return 200 with no ImportError — proving the
deferred imports resolve at call time.

## CI exit gate (U8-10.4)

`.github/workflows/backend-lint.yml` + `scripts/lint.sh` now run, on every backend change:
1. **ruff** — lint (real bugs + import hygiene), tree-wide.
2. **import-linter** — 5 layering contracts.
3. **black** — format check on the `.black-managed` allowlist.
4. **pytest** — API-parity + the Epic 8 contract tests (DB-free).

**Types (mypy):** deliberately *not* gated. The codebase is largely untyped; a strict pass would
flood CI with pre-existing errors and block on noise. Handler signatures are typed and readable;
a gradual typed rollout is future work, not an Epic 8 exit blocker.

## Epic 8 exit criteria

| Criterion | Status |
|---|---|
| 0 domain endpoints in `server.py` | ✅ only `/health` (app-level), asserted by test |
| 0 `from server import` shims in app code | ✅ locked by test |
| API parity (same routes/middleware) | ✅ committed baseline + gate test |
| Layering enforced (cross-module import rule) | ✅ import-linter, 5 contracts KEPT |
| Lint + format enforced in CI | ✅ ruff + black gate |
| Tests mirror modules | ◑ new tests do; legacy `test_iteration*` grandfathered |
| **Full regression green in CI (U8-01.8)** | ⏳ **pending** — the `test_iteration*` suite is pinned to the shared **preview backend** (`pytest.ini -n 2 --dist loadscope`) and can't run on the dev box; it's a preview/CI step, tracked honestly as open |

**server.py: 6,665 lines (Epic 8 kickoff) → 412 lines** — a thin assembly hub (imports,
re-exports for tests, `/health`, `register_api_routers`/`register_middleware`, `FastAPI(lifespan=…)`).

## Residual (honest)

- **U8-01.8** — full `test_iteration*` regression on the preview backend (external dependency).
- **Layering debt** catalogued in `.importlinter`: 5 `services → routers` cross-domain-helper
  edges + a few `core → services` (auth/pii) couplings. Pre-existing, not server-shim related.
- **server.py re-export surface** kept for the grandfathered tests; retire when those are
  restructured.
- The CI **workflow file** needs a `workflow`-scoped push (or GitHub-UI add) — the local gate
  (`scripts/lint.sh`) is fully functional today.

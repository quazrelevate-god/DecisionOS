# Test tiers (T10-11.2)

Every test is auto-tiered by convention in `conftest.py::pytest_collection_modifyitems`
— no per-file tagging. Pick a tier with `-m`.

| Tier | What it needs | How it's detected | Count |
|------|---------------|-------------------|------:|
| `unit` | nothing (offline) | default — no DB, no server | ~1200 |
| `db` | an isolated Mongo (same server, throwaway DB) | test consumes the `with_test_db` fixture | ~22 |
| `integration` | a live HTTP server | module resolved its URL via `integration_base.base_url()` | ~850 |

The runner pins `-n 2 --dist loadscope` via `pytest.ini` (do **not** change `addopts`).

## Running each tier

```bash
# from backend/, using the project venv interpreter

# unit — the offline gate (what CI blocks on)
python -m pytest -m unit

# db — isolated per-test databases; SKIPS cleanly if MONGO_URL is unset
python -m pytest -m db

# integration — boots an isolated-DB server, points the suite at it, runs, drops the DB
python tests/_live_harness.py                       # whole integration tier
python tests/_live_harness.py tests/test_x.py       # one file
python tests/_live_harness.py -m integration tests/test_x.py::TestY   # scoped
```

## Why the harness exists

The `integration` files are HTTP tests (`requests` against a base URL). They resolve
that URL **only** through `integration_base.base_url()`, which reads
`REACT_APP_BACKEND_URL` and **skips the module if it is unset** — the suite can never
silently fall back to a shared/hosted environment. `tests/_live_harness.py` boots
`uvicorn server:app` against a throwaway `dos_test_live_*` database (never
`founder-os-58`), lets bootstrap self-seed the demo tenant + admin, waits for the
seed via a direct DB poll, exports `REACT_APP_BACKEND_URL`, runs the target, and
drops the DB.

## CI (`.github/workflows/tests.yml`)

- **unit** — blocking merge gate; dummy env, provider keys blanked so a stray real
  call fails loudly.
- **db** — runs `-m db`; skips cleanly without the `MONGO_URL` secret.
- **integration** — runs the harness; non-blocking until P3 makes cross-test data
  isolation deterministic. Needs `MONGO_URL` (+ `JWT_SECRET`, `EMERGENT_LLM_KEY`) secrets.

`config.py` reads `MONGO_URL` / `DB_NAME` / `JWT_SECRET` / `EMERGENT_LLM_KEY` at import
(emergentintegrations is still the LLM transport), so every job sets them.

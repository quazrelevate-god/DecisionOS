# Epic 8 · Sprint 9 — Performance & Data-Access Audit

_Behavior-preserving perf pass: N+1 audit, index gaps, blocking I/O, pagination, hot-read caching._

## Findings up front

The codebase was already in good shape on the two biggest risks:
- **`enrich_*` fan-outs are batched** — they collect ids and issue one `$in` query, not a
  `find_one` per item. No N+1 there.
- **No sync HTTP in async handlers** — Sprint 6 had already moved provider SDKs behind
  threaded adapters.

So S9 is targeted fixes, not a rewrite.

## What changed

### U8-09.1 — N+1: `pick_least_loaded_member` (the auto-assign hot path)
`services/voice.py` ran **one `count_documents` per member** to find the least-loaded person —
and this runs on *every* auto-assign (voice notes + agent-proposed tasks, E3-13). Replaced the
per-member loop with **a single aggregation** (`$match` members + `$group` by assignee → counts),
preserving the exact `(load, id)` deterministic tiebreak. Members with zero open tasks default
to 0. **Verified:** the E3-13 auto-assign test (8 edge cases: 0/1/many, ties, named,
named-not-found, deprovisioned) still passes unchanged.

Not changed (deliberately): the per-item `find_one`/`count` loops in `routers/ledger.py`
(reclassify) and `routers/team.py` (leave-impact) sit next to an **LLM call per item** — the
model call dominates, the DB call is noise, and both are low-frequency paths.

### U8-09.2 — Index gap-fill
Four list endpoints filtered by `tenant_id` and sorted by `created_at` with no supporting index
(tenant scan + in-memory sort). Added:
- `workflows (tenant_id, created_at)` and `(tenant_id, type, stage)`
- `expenses (tenant_id, created_at)` — was indexed on `date`, but the list sorts by `created_at`
- `assets (tenant_id, created_at)`, `inventory (tenant_id, created_at)` — had **no** index

`create_index` is idempotent; these apply on next boot via `_bootstrap`.

### U8-09.3 — Kill blocking disk I/O
Four upload paths staged bytes to a temp file with a synchronous `open(...).write(...)` inside
async handlers, blocking the event loop for the write. Added `services.uploads.awrite_bytes`
(`asyncio.to_thread(Path.write_bytes)`) and routed all four through it
(`uploads.download_to_temp`, `files._analyze_reference_file` ×2, `voice_notes` dictation).

### U8-09.4 — Pagination on hot list endpoints
`GET /api/expenses`, `/api/assets`, `/api/inventory` did `.to_list(1000)` with no bound. Added
optional `limit` (1–2000, default 1000) + `offset` query params. **Defaults reproduce the prior
response exactly** (newest up to 1000) — no client change required — and the sort is now
index-backed (U8-09.2).

### U8-09.5 — Shared short-TTL cache for `operating_score`
`_company_operating_view` runs several full-tenant collection scans
(tasks/decisions/invoices/payments) on **every** dashboard/desk load. It's a derived score that
tolerates seconds of staleness, so it's cached in **Mongo** (`operating_score_cache`) — not
process memory — keyed by `(tenant_id, can_finance)` with a **90-second TTL**.

- **Shared, not in-process:** consistent across replicas + survives restarts (the app stays
  stateless — same rationale as the scheduler leader-lock). Same pattern as the Desk narrative
  cache (E3-06).
- Replaces several `to_list(2000)` scans with **one `_id`-keyed `find_one`**.
- Bounded: ≤2 docs per tenant (upserted), so no cleanup/TTL-index needed.
- TTL-only invalidation (bump-on-write is a future option). Best-effort: any cache error falls
  through to a live recompute.
- **Verified:** cache-hit payload is byte-identical to a live recompute; freshness logic correct.

## Guardrails held

Every slice: `py_compile` + 135-module import-sweep + **route-fingerprint parity (266, sha
2d443ae0)** + `ruff` green + import-linter 5/5 KEPT. Live boot smoke: `/operating-score` 200×2,
paginated `/expenses`/`/assets` 200. The auto-assign regression test passes. All changes are
behavior-preserving (identical responses; cache within TTL equals a live compute).

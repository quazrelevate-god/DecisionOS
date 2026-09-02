# Data Migration Plan (S5-05)

**Policy: additive + idempotent.** Every schema change DecisionOS has introduced
(Sprints 0-3) is either a new **index** or a new **additive field** — no
destructive column renames-in-place, no data rewrites that can lose rows.

## How migrations are applied

Schema changes are applied **idempotently at every app boot** by
`backend/bootstrap/lifecycle.py::_bootstrap` (indexes via `create_index`, the
`brain_contexts`→`brain_query_cache` collection-name fix, and the
`none`-language text-index rebuild). Re-running it is a no-op when the schema is
already current.

For a deploy, run the same bootstrap **as an explicit pre-deploy step** so a
failed index build fails the pipeline instead of the first live request:

```bash
cd backend && MONGO_URL=... DB_NAME=... python scripts/migrate.py
```

This is wired into `ops/ci/deploy.yml (install to .github/workflows/)` (the `migrate` job, gated on
tests, before any deploy).

## Inventory of schema changes (Sprints 0-3)

- **Indexes** (~40): `users.email` unique; `(tenant_id, role)`, `(tenant_id,
  created_at)` and status/date compounds on decisions/tasks/invoices/inbox/
  usage_events/activity/notifications/voice_notes/memory; `memberships` unique +
  lookup; auth token/session/revocation uniques; `scheduler_locks` TTL. Full list
  in `bootstrap/lifecycle.py`.
- **Additive fields**: `membership.status/permissions`; `tenant.plan/seats_used/
  operating_model`; `task.workflow_id/stage_key/execution_plan`; `decision.
  source/timeline`; `*.brain linkage`. All default-safe when absent.
- **Rename handled in code**: `brain_contexts`→`brain_query_cache` (the singular/
  plural collision fix) — bootstrap ensures the new name; old rows are stale
  cache only (safe to drop).

## Freeze + verify procedure (before GA)

1. **Freeze** the model: no new index/field lands without an entry here.
2. On **staging** (S5-01) restored from a production snapshot, run
   `scripts/migrate.py`; confirm exit 0 and spot-check `db.<coll>.getIndexes()`.
3. Run the app against that DB; confirm no runtime index errors in logs.
4. Only then promote (S5-09 staged rollout).

## Rollback

Indexes and additive fields are **forward-safe** — an older app version ignores
a newer index/field, so a code rollback (see `ROLLBACK.md`) needs **no schema
downgrade**. Never write a migration that drops a column the previous version
still reads.

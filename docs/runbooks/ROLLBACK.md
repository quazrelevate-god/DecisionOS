# Rollback Procedure (S5-07)

**Goal:** revert a bad deploy in **< 10 minutes**, safely, without a schema
downgrade. Rehearse this on staging before GA.

## When to roll back

Error rate or p95 latency breaches SLO after a deploy, a new 5xx spike in Sentry
(S5-03), or a broken core flow (login / capture / desk). Decide fast — rolling
back and investigating later beats debugging in production.

## Steps

1. **Announce** in the ops channel: "Rolling back <service> from <bad> to <good>."
2. **Revert the code:**
   - Platform one-click: redeploy the previous successful build (Railway/Render
     "Rollback to this deployment"), OR
   - Git: `git revert <bad-sha>` (or reset the deploy branch to `<good-sha>`) →
     push → the `deploy.yml` pipeline re-runs the gate + redeploys the good build.
3. **Schema is forward-safe** (see `MIGRATION_PLAN.md`): migrations are additive +
   idempotent, so the older build runs against the newer schema with **no schema
   downgrade**. Never write a migration that would break this.
4. **Verify:** `/api/health` 200, a login, a desk read, and Sentry/error-rate back
   to baseline. Confirm `X-Request-ID` correlation works for spot checks.
5. **Freeze** further deploys until the root cause is understood.

## Guardrails that make rollback safe

- Deploys are **gated on the test suite** (`tests.yml`) — a red build never ships.
- **Staged rollout** (S5-09): staging first, then production behind a manual
  approval — most bad deploys are caught in staging before they reach anyone.
- **Graceful shutdown** (Dockerfile `--timeout-graceful-shutdown 60`) lets
  in-flight requests finish on the swap, so a rollback doesn't 502 users.

## Post-incident

Write a short post-mortem (what, blast radius, why the gate missed it, the test
that would have caught it) within 48h and add that test.

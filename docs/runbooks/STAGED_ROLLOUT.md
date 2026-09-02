# Staged Rollout Plan (S5-09)

**Do not flip on 100 tenants cold.** Expand in tiers, each with a monitoring
checkpoint and an explicit go/no-go before the next step. This mirrors the
Testing-Plan rollout milestones (Internal Alpha → Closed Beta → Staged Open Beta
→ GA).

| Stage | Tenants | Hold | Advance only if (exit bar) |
|---|---|---|---|
| Internal alpha | team only | 1-2 wk | Zero open P0/P1 after a full manual walkthrough; automated suite green |
| Closed beta | 3-5 design partners | 2-4 wk | No P0 incidents; daily active usage; SLO held |
| Staged open beta | **5 → 20 → 50** | 3-6 wk tiered | Error rate < 1% + p95 < 500ms **held at each tier** for ≥ 48h; no scheduler/cron duplication; no shared-LLM-key 429s |
| GA / self-serve | 100+ | ongoing | Go-Live Checklist all TRUE; go/no-go signed (S5-10) |

## Mechanics

- **Enforced in CI/CD**: `deploy.yml` deploys `staging` automatically and gates
  `production` behind a GitHub **Environment required-reviewer** approval — the
  human checkpoint between tiers.
- **At each tier**, before advancing, review the checkpoint dashboard:
  error rate (Sentry, S5-03), p95 latency, LLM cost/quota, seat/scheduler health.
- **Roll back** (see `ROLLBACK.md`) instead of pushing through a breached SLO.

## Checkpoint dashboard (what to watch)

- App error rate + new Sentry issues (target < 1%).
- p95 latency on desk/operating-score/capture (target < 500ms read / < 1.5s capture).
- Per-tenant LLM cost vs budget (E3-08.3) and any provider 429s.
- Scheduler: exactly-once follow-ups (no duplicate escalations across replicas).

## Abort criteria

Any tier that breaches the SLO for > 30 min, or any P0 incident, halts the
rollout and triggers a go/no-go re-review before resuming.

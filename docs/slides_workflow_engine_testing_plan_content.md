# Deck B — "The workflow, as an engine" · Testing Plan (separate)
Slide-ready content. Design to be applied separately. 12 slides.
Scope: verifies the workflow-engine rebuild described in Deck A, phase by phase.

---

## Slide 1 — Title
**Kicker:** Test Plan · Internal
**Title:** Proving the engine — a testing plan for the workflow rebuild
**Subtitle:** How we verify each phase ships green, existing tenants are untouched, and the card only ever moves through one audited path.

Meta strip:
- **Owner** — Engineering / QA
- **Covers** — Data model · engine · migrations · UI · rollout
- **Gate** — Each phase has an explicit exit checklist
- **Baseline** — 553 existing tests must stay green throughout

---

## Slide 2 — What we're testing for
**Kicker:** Objectives
**Title:** Four things must be true when this ships

1. **One path moves the card.** `workflows.stage` is only ever written by the engine — never by a raw UI drag or a stray endpoint.
2. **Backward compatible.** Empty stage templates reproduce today's behaviour exactly; no live tenant sees a change until they opt in by editing stages.
3. **Migrations are exactly-once & safe on replica restart.** Backfills are idempotent, join keys are correct, and no data is lost.
4. **Tasks and workflows share one lifecycle.** Closing the last stage task advances the card; the card advancing spawns the next stage's tasks.

---

## Slide 3 — Test surfaces & levels
**Kicker:** Strategy
**Title:** Where each behaviour is proven

| Level | What it covers |
|---|---|
| **Unit** | `on_stage_enter`, `check_stage_ready`, `advance`; stage-contract evaluation; task-spawn from templates |
| **Integration** | Task-closer → engine → card transition → next task spawn; approval recording → gate release |
| **Migration** | Backfill correctness, idempotency, replica-restart replay, rollback safety |
| **Contract / API** | Only the engine writes `stage`; manual advance requires `override` + reason |
| **UI / E2E** | Settings Operations tab, stage chips on My Work, inline task lists, manual-advance reason prompt |
| **Regression** | Full existing suite (553) + ad-hoc tasks (null `workflow_id`) still work |

---

## Slide 4 — Phase 1 tests · Unify the model
**Kicker:** Phase 1 · ~1 week
**Title:** Drop the ghosts, add the links — behaviour unchanged

**Migration / data:**
- Backfill sets `tasks.workflow_id` + `tasks.stage_key` correctly via `decision_id` join.
- Tasks with **no** matching workflow keep both fields `null` and still load/edit/close.
- Re-running the backfill changes nothing (idempotent).
- `tenant.workflow_templates` + `lexicon.workflows` removed; no reader errors on their absence.

**Behaviour (must be identical to today):**
- Voice capture still creates the same card + same tasks.
- My Work, Workflows tab, counters render unchanged.

**UI:**
- Settings renders as **four tabs**; every old card's fields reachable, each Save hits the correct endpoint.

**Exit gate:** full suite green · zero behaviour diff · both ghost collections gone.

---

## Slide 5 — Phase 2 tests · The engine (core)
**Kicker:** Phase 2 · ~2 weeks
**Title:** `on_stage_enter` · `check_stage_ready` · `advance`

**`on_stage_enter`:**
- Spawns exactly the stage's template tasks, assigned to the named roles.
- Records a timeline entry; dispatches notifications.
- Empty template → spawns nothing (back-comp path).

**`check_stage_ready`:**
- False while any stage task is open.
- False while any required approval is missing.
- True only when **all tasks done AND all required approvals present**.
- No approval required → gate passes on tasks alone.

**`advance`:**
- On pass → transitions to next stage → re-enters `on_stage_enter` (chained spawn).
- On terminal stage → fires side-effects → marks card done.
- On fail → no state change, returns a clear reason.

---

## Slide 6 — Phase 2 tests · Engine guarantees
**Kicker:** Phase 2
**Title:** One path, always audited

- **Single writer:** assert no code path other than the engine mutates `workflows.stage` (contract test scanning writers).
- **Manual advance** routes through the engine with `override=true` and a required reason; the override is written to history/audit.
- **Idempotent transitions:** calling `advance` twice on a satisfied stage doesn't double-spawn the next stage's tasks or skip a stage.
- **Concurrency:** two tasks closing near-simultaneously trigger exactly one transition (no double-advance, no lost update).
- **Side-effects fire once** on entry/exit — e.g. the procurement-terminal → awaiting-bill expense creates exactly one expense.

---

## Slide 7 — Phase 2 tests · Stage-object migration
**Kicker:** Phase 2 · Migration
**Title:** Flat strings → stage objects, non-destructively

- Each old string stage becomes `{key, label, tasks:[], approval:null}` with a stable, unique `key`.
- `label` preserves the original display string; ordering preserved.
- Empty `tasks`/`approval` → engine spawns nothing, gate passes trivially → **today's behaviour preserved** until owners edit templates in.
- In-flight cards (mid-pipeline at migration time) keep their current stage and advance correctly afterward.
- Idempotent + replica-restart-safe via the ledger; dry-run diff reviewed before apply.

---

## Slide 8 — Phase 3 tests · The joined view
**Kicker:** Phase 3 · ~1 week
**Title:** Two lenses, one truth

**My Work:**
- Every task shows a **stage chip** ("Order #4821 · Confirmed"); chip click opens the correct parent card.
- Ad-hoc tasks (null `workflow_id`) show **no** chip and behave as before.

**Workflow board:**
- Each card lists its **current stage's** open tasks inline, with assignee avatars.
- Closing an inline task updates both the card and My Work without a manual refresh.

**Manual advance:**
- Clicking Advance prompts for a **reason**; empty reason is rejected; reason is stored in history.
- Retired "Board" sub-tab is gone and no longer linked.

---

## Slide 9 — End-to-end scenario: the Kapoor order
**Kicker:** E2E
**Title:** The golden-path test that proves the whole thing

Steps asserted end to end:
1. Voice capture "Kapoor Retail, 500m cotton, ₹80k, Friday" → card at **Booked** + task "Confirm with customer" (Sales).
2. Sales closes the task → engine advances to **Confirmed** → "Prepare invoice" (Finance) spawns + Owner approval pending.
3. Finance closes task **and** Owner approves → advance to **Dispatched** → "Pack & ship" (Ops) spawns.
4. Ops closes task → advance to **Paid** (terminal) → side-effect marks invoice paid → card done.
5. History shows every transition; no manual advance was needed.

---

## Slide 10 — Regression & backward-compat
**Kicker:** Safety net
**Title:** Existing tenants must not feel this

- **553 baseline tests** stay green at every phase boundary.
- Tenants who never edit stage templates see **identical** behaviour post-migration.
- Ad-hoc tasks (no workflow) create, assign, edit, complete exactly as today.
- Counters, dashboards, notifications unchanged until a stage template is populated.
- Rollback: each phase's migration has a tested reverse or a forward-fix path; app stays shippable if a phase is paused.

---

## Slide 11 — Exit gates per phase
**Kicker:** Go / no-go
**Title:** A phase isn't done until its gate is green

| Phase | Exit gate |
|---|---|
| **1** | Ghosts removed · backfill idempotent · zero behaviour diff · 4-tab Settings verified · suite green |
| **2** | Engine unit + integration green · single-writer contract holds · stage-object migration replica-safe · side-effects fire once · suite green |
| **3** | Stage chips + inline tasks verified · manual advance requires reason · Board sub-tab retired · E2E golden path green · suite green |

---

## Slide 12 — Out of scope for this test cycle
**Kicker:** Not tested now
**Title:** Deliberately excluded — matches the build's non-goals

- Cross-pipeline dependencies
- SLA timers
- Workload balancing
- Forecast reports

**Closing line:** We test that the board can be trusted again — not features we haven't built yet. Ship the engine, watch it run, then scope the next test cycle.

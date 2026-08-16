# Workflow Engine — Rollback Runbook (WE-16, 2026-08-16)

Epic 5 shipped five migrations across three phases. This doc gives ops
a tested, written-down path to revert any of them fast if a deploy goes
sideways, keeping the app shippable per the Testing Plan (slide 11).

Every migration is **idempotent by construction** (see
`services/migrations.py` — the ledger's belt, plus per-migration
guards as braces). This means:

* **Forward re-run**: safe. If a rollback wipes the ledger row but the
  data is already in the new shape, the next boot's re-application is
  a no-op.
* **Reverse revert**: each migration below has a documented reverse
  query. All reverses are tested against a synthetic tenant before
  being included here.

Contract for every entry:
1. **What it did** — the delta on disk.
2. **Revert query** — a Mongo shell one-liner that undoes it.
3. **Post-revert check** — one query you run to confirm the revert
   worked.
4. **Blast radius** — what breaks if you revert this after the code
   that depends on it has already shipped.

## Sprint 1 — Data model

### `stage_objects_extend_v1` (WE-03)

* **What it did**: walked every `tenants.operating_model.pipelines[].stages[]`
  entry and added the three WE-03 fields (`tasks: []`, `approval: null`,
  `side_effects: []`) if they were missing. Idempotent — only wrote
  when at least one stage lacked a field. Touched 2/2 tenants at
  ship time; duration ~905ms.
* **Revert query** (removes ONLY the three extension fields, keeps
  `{key, label}`):
  ```javascript
  db.tenants.updateMany(
      { "operating_model.pipelines": { $exists: true } },
      { $unset: {
          "operating_model.pipelines.$[].stages.$[].tasks": "",
          "operating_model.pipelines.$[].stages.$[].approval": "",
          "operating_model.pipelines.$[].stages.$[].side_effects": ""
      }}
  );
  db.migrations_applied.deleteOne({ name: "stage_objects_extend_v1" });
  ```
* **Post-revert check**: `db.tenants.findOne({}, { "operating_model.pipelines.0.stages.0": 1 })`
  should return a stage with only `{key, label}`.
* **Blast radius**: **HIGH after Sprint 2 ships.** The workflow engine
  (WE-06) reads `stage.tasks[]` and `stage.approval` to decide when to
  spawn template tasks and when to gate advance. Reverting this
  migration without also reverting WE-06/07 will make every stage look
  "empty templates → no auto-spawn, no gate" — which is the same as
  today's pre-engine behaviour, so cards will just stop auto-advancing.
  Safe as a partial revert if you're rolling ALL of Sprint 2 back too.

### `backfill_task_workflow_link_v1` (WE-01)

* **What it did**: walked every task with `decision_id` set and no
  `workflow_id`, looked up the tenant's workflow with a matching
  `decision_id`, and if exactly one matched, set
  `{workflow_id, stage_key: initial_stage_of_workflow}` on the task.
  Ambiguous matches (0 or >1 workflows per decision) left the task
  unlinked. Touched 1/10 scanned tasks at ship time.
* **Revert query**:
  ```javascript
  db.tasks.updateMany(
      { workflow_id: { $exists: true } },
      { $unset: { workflow_id: "", stage_key: "" } }
  );
  db.migrations_applied.deleteOne({ name: "backfill_task_workflow_link_v1" });
  // Optional: drop the compound index (safe on rollback)
  db.tasks.dropIndex("tasks_tenant_workflow_stage");
  ```
* **Post-revert check**: `db.tasks.countDocuments({ workflow_id: { $exists: true } })`
  should return 0.
* **Blast radius**: **HIGH after Sprint 3 ships.** MyWork stage chips
  (WE-11) and workflow-card inline task lists (WE-12) read
  `task.workflow_id` and `task.stage_key`. Without them, chips
  disappear (no crash — the render guards on null) and the workflow
  cards render "No open tasks at this stage" for everything. Also,
  the engine's `check_stage_ready` (WE-06) uses this linkage; without
  it, `advance()` unconditionally returns `ready=True` because no
  tasks match the query. Safe as a partial revert if you're rolling
  ALL of Sprint 2/3 back too.

### `drop_ghost_workflow_collections_v1` (WE-02)

* **What it did**: `$unset` on `tenant.workflow_templates` (dead
  brainstorm list) and `tenant.lexicon.workflows` (dead label
  overrides). Nothing consumed either output post-WE-02, so this is
  purely a cleanup. Touched workflow_templates on 1 tenant,
  lexicon.workflows on 2 tenants at ship time.
* **Revert query**: **Do NOT restore either field.** They are dead
  outputs; restoring them accomplishes nothing useful and reintroduces
  Settings clutter. If you truly need the field structure back
  temporarily (unlikely), a placeholder `$set` restores the key:
  ```javascript
  // ONLY if a legacy admin tool absolutely requires the field to exist.
  db.tenants.updateMany(
      { workflow_templates: { $exists: false } },
      { $set: { workflow_templates: [] } }
  );
  db.migrations_applied.deleteOne({ name: "drop_ghost_workflow_collections_v1" });
  ```
* **Post-revert check**: `db.tenants.countDocuments({ workflow_templates: { $exists: true } })`
  should match your tenant count.
* **Blast radius**: **LOW.** The Settings UI in WE-04 already stops
  editing this field, and the frontend `lex()` helper no longer merges
  `L.workflows`. Restoring the fields is a pure no-op for the app.

## Sprint 2 — Backend engine

### `backfill_procurement_side_effect_v1` (WE-08)

* **What it did**: for every tenant with a procurement pipeline
  (identified by `approval_stage` set OR legacy `purchase_payment`
  key), appended `{kind: "create_expense", params: {status:
  "awaiting_bill"}}` to the terminal stage's `side_effects[]` if not
  already present. Preserves the FIX-001-B behaviour after the inline
  code was removed from `advance_workflow`. Touched 2/2 tenants at
  ship time.
* **Revert query**:
  ```javascript
  db.tenants.updateMany(
      { "operating_model.pipelines.stages.side_effects.kind": "create_expense" },
      { $pull: {
          "operating_model.pipelines.$[].stages.$[].side_effects": {
              kind: "create_expense"
          }
      }}
  );
  db.migrations_applied.deleteOne({ name: "backfill_procurement_side_effect_v1" });
  ```
* **Post-revert check**: `db.tenants.countDocuments({ "operating_model.pipelines.stages.side_effects.kind": "create_expense" })`
  should return 0.
* **Blast radius**: **HIGH.** Reverting this alone breaks the
  procurement -> Finance handoff for every tenant. The engine will
  still transition workflows to their terminal stage, but no expense
  will be auto-created — Finance will not see a bill-upload prompt.
  If you must revert, either re-inline the FIX-001-B block in
  `advance_workflow` OR bind the side-effect back manually per
  tenant via Settings > Operations.

### `backfill_stage_version_v1` (WE-09)

* **What it did**: `$set stage_version: 0` on every existing workflow
  that lacked the field. Initialises the optimistic-lock counter the
  engine's `find_one_and_update` CAS uses to prevent double-advance
  under concurrent writers. Initialised 13 workflows at ship time.
* **Revert query** (only makes sense if you're also reverting WE-06):
  ```javascript
  db.workflows.updateMany({}, { $unset: { stage_version: "" } });
  db.migrations_applied.deleteOne({ name: "backfill_stage_version_v1" });
  ```
* **Post-revert check**: `db.workflows.countDocuments({ stage_version: { $exists: true } })`
  should return 0.
* **Blast radius**: **HIGH after WE-06 ships.** Without `stage_version`,
  `engine.advance` will find_one_and_update on
  `{stage_version: 0, ...}` and match no documents on the second boot
  — every advance will return `already_advanced=True` even for
  first-timers. If you revert this, revert WE-06 too. If you can
  ONLY roll back WE-09 (unlikely), set every workflow back to
  stage_version=0 as a rescue:
  ```javascript
  db.workflows.updateMany(
      { stage_version: { $exists: false } },
      { $set: { stage_version: 0 } }
  );
  ```

## Sprint 3 — UI join

No new migrations. UI changes (WE-11 stage chips, WE-12 inline task
lists, WE-13 override dialog, WE-14 Board sub-tab retirement) are
pure frontend renders — deploying an older frontend bundle reverts
them instantly.

## Per-phase exit gate replay (WE-16 regression pass)

To confirm the codebase is still shippable after any rollback:

```bash
# Backend + frontend syntax check
python -c "import ast; ast.parse(open('backend/server.py',encoding='utf-8').read())"

# WE-01/03 unit + Sprint 1 regression
cd backend
.venv/Scripts/python.exe -m pytest -q \
    tests/test_we01_task_workflow_link.py \
    tests/test_we03_stage_objects.py \
    tests/test_workflows_dynamic.py \
    tests/test_workflow_finance_link.py \
    tests/test_migrations_ledger.py

# WE-06 engine + WE-07 single-writer + WE-15 golden path
.venv/Scripts/python.exe -m pytest -q tests/test_we07_single_writer_contract.py
.venv/Scripts/python.exe scripts/we06_engine_verify.py    # 13 scenarios
.venv/Scripts/python.exe scripts/we15_golden_path_kapoor.py  # golden + negative
```

Expected: 71+ pytest pass, 13/13 engine scenarios pass, golden path
+ negative case both pass. Any deviation blocks the rollback until
the failing gate is understood.

## Migration ledger cheatsheet

```javascript
// List every migration applied, oldest first
db.migrations_applied.find({}, { name: 1, applied_at: 1, status: 1 }).sort({ applied_at: 1 });

// Force a specific migration to re-run on next boot (deletes its row;
// the boot will re-execute the migration function)
db.migrations_applied.deleteOne({ name: "<migration_name_v1>" });

// See a failed migration's error (if any)
db.migrations_applied.find({ status: "failed" });
```

All migration bodies live in `backend/server.py::_bootstrap` (search for
`_apply_migration`). Each is a small inline coroutine — the migration
function itself is the authoritative record of the change.

# Workflows + Tasks: making it one continuous engine

**Yokesh, 2026-09-21.** *"A person will create a workflow but couldn't add the task
to it. The workflow should be continuous. When I see the workflow I have to know
what is going on in the company. That is the goal of the product."*

This is the plan that closes that. It is written for a company of 10–15 people whose
owner opens one board in the morning and needs to know, without asking anyone, what
is moving and what is not.

---

## What the audit found

The engine underneath is real and good. The **human half is missing**.

| What works | Verified at |
|---|---|
| Stage gate: a card will not advance while a task at its stage is open | `workflow_engine.check_stage_ready` |
| Closing the last task advances the card and spawns the next stage's tasks | `tasks.py:_after_task_done` → `advance` → `on_stage_enter` |
| Evidence on close, two-stage approvals, helpers, least-loaded auto-assign | `routers/tasks.py` |
| Overdue escalation doer → waited-on → manager → owner | leader-locked sweep |
| Stuck / late / needs-you is already computed per card | `pages/desk/workflowAttention.js` |

| What is broken or absent | Why it hurts |
|---|---|
| **A person cannot attach a task to a workflow.** No UI ever sends `workflow_id` | The exact thing Yokesh reported |
| **A board-created card is born empty** — `POST /workflows` never fires `on_stage_enter` | Stage 1 has no tasks, so its gate passes instantly. The card looks alive and is hollow |
| **The stage-approval gate is a dead end** — `record_stage_approval` has no route, no UI | Settings offers the gate; configuring it traps the card |
| **A due date can never be changed** — no `due_date` on `TaskUpdateInput` | The most common daily act in any operation |
| **A workflow card cannot be edited** — no `PATCH /workflows/{id}` | A typo in amount or party is permanent |
| **You only ever see the CURRENT stage's tasks** | You cannot see what is going on — only the one slice |
| **Blocked work is relabelled "To do"** | Work that *can't* start looks like work nobody bothered with |
| **No recurring work.** `operational_task_templates` is stored and never read | GST, salaries, stock counts retyped every cycle |
| **Nothing warns before a deadline** — only after | |
| **Stuck/late never reaches the board** — computed, rendered only on the Desk | |

---

## The shape we are building

```
Decision  ─┐
           ├─→  WORKFLOW (card)  ─→ stage ─→ stage ─→ stage
Board "New"┘         │                │
                     │                ├─ tasks (template + hand-added)
                     │                ├─ approval gate
                     │                └─ side effects
                     └─ ONE detail view that shows all of it at once
```

Three rules the build holds to:

1. **Nothing is created empty.** Every workflow, however it is born, arrives with its
   first stage's work on it.
2. **Every machine link has a human door.** If the engine can set it, a person can set it.
3. **One screen answers "what is going on".** Not a slice — the whole card.

---

## The checklist

Status: `[ ]` to do · `[~]` in progress · `[x]` done and tested

### Phase A — Continuity: a workflow is never born hollow

- [x] **A1. A board-created workflow gets its stage-1 tasks.**
      `POST /workflows` calls `on_stage_enter` after the insert, the same call the
      decision path makes. Card returns with its tasks already on it.
      *Files:* `routers/workflows.py`
- [x] **A2. `GET /workflows/{id}` — the whole card.**
      Every stage, every task on every stage (not only the current one) with owner,
      due date and status, the approval state of each stage, the history, and what is
      blocking the next move. One request.
      *Files:* `routers/workflows.py`
- [x] **A3. The stage approval gate gets its door.**
      `POST /workflows/{id}/approve-stage` wiring the already-written
      `record_stage_approval`, with the role check it already enforces, plus the
      button in the detail view for the person whose role it is.
      *Files:* `routers/workflows.py`, detail view
- [x] **A4. `PATCH /workflows/{id}` — correct a card.**
      Title, detail, amount, counterparty, contact. Not stages, not stage (that is
      `advance`'s job alone). Logged like every other change.
      *Files:* `routers/workflows.py`, `models/workflows.py`
- [x] **A5. Two people moving one card tell the truth.**
      `already_advanced` stops being dropped at the route; the UI says "Priya moved
      this first" instead of a false success.
      *Files:* `routers/workflows.py`, `pages/Workflows.js`

### Phase B — The person can drive it

- [x] **B1. Add a task to a workflow stage, by hand.**
      From the detail view: pick the stage, write the task, assign it. Sends
      `workflow_id` + `stage_key` to the `POST /tasks` that has always accepted them.
      This is the headline fix.
      *Files:* detail view, `pages/Workflows.js`
- [x] **B2. A task's due date can be changed.**
      `due_date` + `due_time` on `TaskUpdateInput`, honoured by `PATCH /tasks/{id}`,
      logged to the task timeline. Reschedule control in My Work and the detail view.
      *Files:* `models/tasks.py`, `routers/tasks.py`, `pages/MyWork.js`
- [x] **B3. Blocked reads as blocked.**
      Stop relabelling `blocked` as "To do". A blocked task says what it waits on —
      an approval, a person, another task — in My Work and on the card.
      *Files:* `pages/MyWork.js`, task row components

### Phase C — Visibility: "when I see the workflow I have to know"

- [x] **C1. The workflow detail view.**
      Opening a card shows the stage rail with each stage's progress (`3 of 5 done`),
      every task under its stage with who holds it and when it is due, overdue in red,
      blocked marked, the approval each stage waits on, and the full history. This is
      the screen the product's goal names.
      *Files:* new `components/workflow/WorkflowDetail.js`, `pages/Workflows.js`
- [x] **C2. The board says what needs attention.**
      `workflowAttention` — already written, already tested, used only by the Desk —
      reaches the board: a card carries `Stuck 6d` / `3 days late` / `Needs you` /
      `Waiting on approval`, and the pipeline pills carry the count.
      *Files:* `pages/Workflows.js`, `pages/desk/workflowAttention.js`
- [x] **C3. Stage progress on the card.**
      `2 of 4 done at this stage` on the face of the card, so the board reads as
      progress and not just position.
      *Files:* `routers/workflows.py` (counts in `with_tasks`), `pages/Workflows.js`
- [x] **C4. Who is holding what.**
      The board header answers, for the whole company: how many are running, how many
      need attention, and who the work is sitting with.
      *Files:* `pages/Workflows.js`

### Phase D — Continuous operations

- [x] **D1. Recurring work exists.**
      A task can repeat (daily / weekly / monthly / every N days, with an end).
      The leader-locked sweep creates the next one when the last is closed or its
      date passes. `operational_task_templates` — collected at signup and read by
      nothing — becomes the seed for this.
      *Files:* `models/tasks.py`, `routers/tasks.py`, new `services/recurrence.py`,
      the sweep worker, Settings → Operations
- [x] **D2. A warning before it is late, not only after.**
      Due-soon notice to the doer (and, for a workflow task, the card) at the
      tenant's own lead time. Bills already get this; tasks get nothing.
      *Files:* the reminder sweep, `services/notifications.py`
- [x] **D3. A task can wait on another task.**
      `depends_on` within a workflow: the dependent task is `blocked` until its
      predecessor closes, then opens by itself and its owner is told.
      *Files:* `models/tasks.py`, `routers/tasks.py`, `services/workflow_engine.py`

### Phase E — Proof

- [x] **E1. Tests for every item above** — backend per route, frontend per screen.
- [x] **E2. Full suite green** (`pytest -q` + each single-process file on its own) and
      `CI=true npm run build`.
- [x] **E3. Live browser run on a throwaway DB**: create a workflow from the board →
      it has its stage-1 tasks → add one by hand → reschedule it → approve a stage →
      close them → the card advances by itself → the detail view shows all of it.
- [x] **E4. Tracker rows in the same push** (Epic 6 UX sheet), per the standing rule.

---

## Deliberately out of scope

- **Cycle time and export.** Real gaps, but reporting, not operations — its own pass
  once tasks carry a completion timestamp (D1 adds it).
- **Saved views, @mentions, attachments on workflows.** Convenience, not continuity.
- **Editing a card's stage list after creation.** Changing the rails under a running
  card is a migration problem, not a form.
- **Start dates and SLAs per stage.** Wait until C2's stuck/late has been lived with.

---

## What the live run found that the plan did not

Walking it in a browser turned up a twentieth item, and it was the one that
mattered most. **Stages have been able to carry their own work since WE-03** —
the normalizer keeps `tasks[]` per stage, the engine spawns them the moment a
card lands — and `generators.operating_model` **never asked the model for any**.
Every tenant's stages came back empty, so `on_stage_enter` had nothing to create
for anybody and A1 would have been a fix to a mechanism that had never once
fired. The prompt (v1.1) now asks for 1–3 real pieces of work per stage, phrased
as instructions, with the department that does each.

*Existing tenants keep their empty stage templates until their operating model
is regenerated or an owner edits it in Settings → Operations.*

## Order of work

A1 → A2 → A4 → A5 → A3 → C1 → B1 → B2 → B3 → C2 → C3 → C4 → D2 → D1 → D3, then E.

A2 and C1 come early because everything after them has somewhere to live: once the
detail view exists, "add a task", "approve this stage" and "reschedule" are controls
on a screen rather than new screens of their own.

# Deck A — "The workflow, as an engine" (Product Spec)
Slide-ready content. Design to be applied separately. 15 slides.
Each slide: **Kicker** · **Title** · body (bullets / table / flow) · optional footer note.

---

## Slide 1 — Title / masthead
**Kicker:** Product Spec · Internal
**Title:** The workflow, as an engine
**Subtitle:** A short review of what our task and workflow model does today, why founders lose trust in it, and the smallest shape of the rebuild that fixes it.

Meta strip (4 chips):
- **Author** — Engineering
- **Audience** — Founder · Product · Backend · Frontend
- **Status** — Draft for discussion
- **Length** — ~10 min read

---

## Slide 2 — The problem, in one line
**Kicker:** 01 · The current model
**Title:** Two parallel worlds share a page and a name — but never a lifecycle
**Body (one big statement):**
- That's the whole bug, dressed up in three different Settings cards.
- A **task** and a **workflow** look related on screen. Underneath, they never touch.

Footer note: *Everything that follows is a symptom of this one gap.*

---

## Slide 3 — Tasks and workflows are strangers
**Kicker:** 01.1
**Title:** Tasks and workflows are strangers

Two-column compare:

| Task | Workflow |
|---|---|
| A thing to do | One instance of a business process (one order, one purchase) |
| Assignee, due date, status (todo → in_progress → done) | Stage, frozen stage list, title, amount, counterparty |
| A story: *"Priya, call the vendor about the missing shipment"* | A card moving across pipeline stages |
| Lives in `tasks` | Lives in `workflows` |

**The consequence (callout):**
- Advancing a workflow stage does **not** create, assign, or close any task.
- Completing a task does **not** advance any workflow.
- They're linked only by a shared `decision_id` when spawned from the same voice capture. Nothing else touches them together.
- Founder sees a kanban that never moves on its own; employee sees a task list that never rolls up.

---

## Slide 4 — Configuration is scattered
**Kicker:** 01.2
**Title:** Three cards, three shapes, one concept

Settings is one long unnavigated scroll of eight cards. Three describe the **same** thing — *what pipelines does this business run?* — three different ways, each with its own Save button to a different endpoint.

| Concept | Company Details | Business Vocabulary | Operating Model |
|---|---|---|---|
| **Workflows** | Free-text names → `workflow_templates` | Three fixed labels → `lexicon.workflows` | Full pipelines w/ stages + approval gates → `operating_model.pipelines` |
| **Task categories** | Fixed enum | Six fixed labels | Dynamic list |
| **Approvals** | Free-text rules | — | Per-pipeline owner sign-off stage |

**Punchline:** All three feel authoritative; only **Operating Model** actually drives behaviour — and it's the least discoverable.

---

## Slide 5 — Concrete: the Kapoor order (today)
**Kicker:** 01.3
**Title:** "500m cotton, ₹80k, deliver by Friday" — what happens now

Quote: *"We got an order from Kapoor Retail for 500m cotton, ₹80k, deliver by Friday."*

**What the AI creates today:**
- A workflow card **"Order — Kapoor Retail"** at stage **Booked** in the Sales pipeline.
- Two tasks — **"Confirm order with Kapoor"** (Sales), **"Prepare invoice"** (Finance).

**What happens next:**
- The card sits at Booked until someone opens Workflows and clicks **Advance**.
- Tasks flow todo → done on My Work, entirely independent of the card.
- Priya closing her task doesn't move the card; the founder dragging the card doesn't close Priya's task.
- **The board and the work are two views of two different truths.**

---

## Slide 6 — The vision
**Kicker:** 02 · The vision
**Title:** One lifecycle, one view
**Body:**
- The **workflow becomes the engine.**
- Each stage owns the tasks and approvals that define what "being at this stage" means.
- Completing them moves the card.
- The founder configures **once** and watches the business run itself through the model they described.

---

## Slide 7 — A stage is a contract
**Kicker:** 02.1 · Principle
**Title:** A stage is a contract, not a label

Each stage declares four things:

1. **Which tasks fire on entry** — a stage template. Tasks are created for the named roles and become the current work.
2. **Who must approve to leave** — a role, a specific owner, or nobody. Skipping the gate is impossible; "who signs off?" ambiguity disappears.
3. **What advances the card** — default: *all stage tasks done* **AND** *all approvals recorded*. Manual override stays for edge cases, and it's audited.
4. **What side-effects fire on entry/exit** — the procurement-terminal → awaiting-bill expense we already have is the pattern; it generalises to any stage.

---

## Slide 8 — The Kapoor order (tomorrow)
**Kicker:** 02.2
**Title:** Same capture, same first stage — now the card owns the work

Pipeline flow (left → right):

```
Booked                Confirmed              Dispatched          Paid
├ task: Confirm  →    ├ task: Prepare   →    ├ task: Pack   →    └ side-effect:
  with customer         invoice                & ship (Ops)         mark invoice
  (Sales)             ├ approval: Owner                            paid
```

**The shift:** tasks aren't siblings, they're **children** of the card.
- Priya closing "Confirm with customer" fires the transition check → card moves to Confirmed → next task appears in Finance's queue.
- My Work stops asking "which task next?" — it just shows the tasks the pipeline is currently generating.

---

## Slide 9 — Backend: the data model
**Kicker:** 03.1 · The engine
**Title:** Three changes to the data model — everything else is deletion

| Today | Proposed |
|---|---|
| `tasks`: no link to a workflow | `tasks.workflow_id`, `tasks.stage_key` — every task knows its parent card + stage |
| `workflows.stages[]`: flat list of strings | `pipelines[].stages[]` becomes objects: `{key, label, tasks:[{title, role, evidence_required}], approval:{role, required}, side_effects:[...]}` |
| `tenant.workflow_templates`: dead brainstorm list | **removed** |
| `lexicon.workflows`: three hardcoded labels | **removed** |
| `operating_model.pipelines`: real, but not linked to tasks | **The Operating Model is the single source of truth** |

---

## Slide 10 — The transition engine
**Kicker:** 03.2
**Title:** One module, three operations — `services/workflow_engine.py`

| Function | Fires when | Does |
|---|---|---|
| `on_stage_enter` | Card arrives at a new stage | Spawns the stage's tasks for named roles, records timeline entry, dispatches notifications |
| `check_stage_ready` | A task is closed, or an approval is recorded | Returns true **only if** every stage task is done **AND** every required approval is present |
| `advance` | Called by task closer, approver, or manual button | Runs `check_stage_ready`; on pass, transitions to next stage + re-enters `on_stage_enter`. On terminal stage, fires side-effects + marks card done |

**Guarantee:** the engine is the **only** path that writes `workflows.stage`. Manual advance still exists but goes through the engine with an audited `override=true`. No more silent kanban drags.

---

## Slide 11 — Migration through the ledger
**Kicker:** 03.3
**Title:** Three migrations — one-time, exactly-once, replica-safe

All shape changes route through the migration ledger we already have.

1. **Backfill** `tasks.workflow_id` + `tasks.stage_key` using `decision_id` as the join key where a matching workflow exists. Tasks without a workflow keep both fields null and continue as ad-hoc tasks.
2. **Convert** `pipelines[].stages[]` from flat strings to objects `{key, label, tasks:[], approval:null}`. Empty `tasks`/`approval` preserve today's behaviour until owners edit them in.
3. **Drop** `tenant.workflow_templates` + `lexicon.workflows`. Nothing writes them; no reader depends on them.

Footer note: *Backward-compatible by construction — empty templates = today's behaviour.*

---

## Slide 12 — UI: Settings, tabbed
**Kicker:** 04.1 · UI
**Title:** Eight scattered cards → four tabs

| Tab | What lives here |
|---|---|
| **Business** | Company profile, products, industry, team roles |
| **Operations** | **Pipelines.** Each shows its stages inline; each stage shows its task templates + approval rule. *The only place workflow config lives.* |
| **Money** | Finance categories, high-value approval threshold, currency |
| **Account** | Language, profile, security |

**Biggest change — Operations tab:** one screen, one hierarchy — **Pipeline → Stages → Tasks + Approval.** Add a task template inline on the stage row. Set an approval via dropdown. No more three-cards-for-one-concept.

---

## Slide 13 — UI: My Work + Workflow, joined
**Kicker:** 04.2
**Title:** Same data, two lenses

| Today | Proposed |
|---|---|
| My Work → tasks with no context about which card they belong to | Every task carries a **stage chip** — "Order #4821 · Confirmed". Click to open the parent card |
| Workflows tab → cards with no context about the tasks inside | Every card lists its current stage's open tasks inline, with the assignee's avatar |
| Two views, two truths | Same data, two lenses |

**Advance button:** stays, but rarely needed — cards advance themselves when the stage contract is satisfied. Manual click asks for a **reason** (recorded in history) so the audit trail knows why the engine was overridden.

---

## Slide 14 — Rollout: three phases
**Kicker:** 05 · Rollout
**Title:** No big-bang — each phase is valuable and reversible, app stays green

| Phase | Duration | What ships |
|---|---|---|
| **1 · Unify the model, drop the ghosts** | ~1 week | Kill `workflow_templates` + `lexicon.workflows`. Add `workflow_id` + `stage_key` to tasks with backfill. Ship Settings tab redesign. **Behaviour unchanged; confusion gone.** |
| **2 · Introduce the engine** | ~2 weeks | Ship `workflow_engine.py`, migrate stages to object shape, wire `on_stage_enter` + `advance`. Existing cards keep working (empty templates → no auto-spawn); new cards start using the engine as owners fill in templates. |
| **3 · The joined view** | ~1 week | Stage chips on My Work tasks. Inline task lists on cards. Manual advance requires a reason. Retire the redundant "Board" sub-tab. |

---

## Slide 15 — Scope discipline / close
**Kicker:** 05 · Not now
**Title:** What we're deliberately NOT doing in this rebuild

Out of scope (each is real; none needed to earn back trust in the board):
- Cross-pipeline dependencies
- SLA timers
- Workload balancing
- Forecast reports

**Closing line:** Ship the engine, watch what happens, then decide what deserves the next investment.

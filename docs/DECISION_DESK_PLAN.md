# Decision Desk and the decision AI flow — plan

Owner: Yokesh. Started 2026-09-15. Scope: **only** the Decision Desk and the flow
*capture (voice / text / file / WhatsApp) → AI → decision → approval → what gets created*.
Task views, My Work and Finance review are out of scope.

Numbers below are from the live owner company (Sharma), read-only, 2026-09-15.

---

## Where it stands today

**The flow**

1. Capture: voice (Sarvam speech-to-text, translated to English), typed text, WhatsApp. A file or photo sent through Dex is only stored — nothing is read from it.
2. The AI extracts: summary, decisions (directive / approval / policy / observation), tasks, workflow events, reminders, meetings, memory notes, confidence.
3. **Immediately, before anyone approves**: a pending decision, blocked tasks, **live workflows**, **calendar events**, **reminder tasks (active)**, **memory notes**.
4. Approve: blocked tasks → To do; only procurement workflows move to their approval stage. Nobody is notified.
5. Reject: permanently deletes the decision's tasks, workflows and calendar events (even work already under way); reminders and memory notes stay.

**What the data says**

| | |
|---|---|
| Decisions | 79 — 54 waiting, 18 approved, 7 rejected |
| Waiting with nothing to do (no task, no workflow) | **23** — questions and greetings ("Profit inquiry for current month", "Founder said hello…") |
| Flagged "needs review" by the AI | 24 — never shown |
| Tagged to a workflow | **8 of 79** (9 workflows; 6 are the same "Approve payment to Kumar Fabrics" captured 6 times) |
| Decision tasks linked to a workflow | 9 of 53 |
| Created a workflow while still unapproved | 8 |
| Captures failed | 15 of 92 — 14 because AI consent was not given (`ai_consent_required`); no screen says so |
| Named approver | 3 of 54 waiting; 51 go to "any owner" |

**Who can reach it**

- Every role has `inbox` (the Desk) by default. Only the owner, and anyone given `decisions_approve` (today Sunita), can approve.
- The approver is named only when the person capturing can approve; otherwise it goes to every owner, and the person who captured it cannot see it on their Desk.
- Routing checks the `approvals` permission, but approving needs `decisions_approve` — someone can be routed a decision they can't approve.

**What the approval popup shows**: title, summary, type, status, raised by, timeline, tasks (title, doer, status dot). Approve / Reject / Comment.
**Never shown**: what was said (transcript, audio, typed text, files), who decides, confidence and review reasons, every decision after the first, the workflows, calendar events, reminders and memory notes it created, task due dates / priority, the result after approval, failed captures.

---

## Decisions to confirm before building

- [x] **DD1 · Nothing goes live before approval** — tasks, workflows, calendar events, reminders and memory notes are held as a *proposal* on the decision and created only on Approve. *(Yokesh, 2026-09-15: "then only the task will be created — that's for sure". Built in Phase 1.)*
- [x] **DD2 · Who decides** — always name one person: the person who captured it if they can approve; else their reporting manager if the manager can approve; else the owner. One permission for routing and approving (`decisions_approve`). *(Yokesh, 2026-09-15: the Decide flow is for the owner and, in some cases, managers; the person who captures is the approver. Phase 2.)*
- [x] **DD3 · Questions are not decisions** — a capture with nothing to act on gets a "Nothing to decide" reply and no decision card. *(Default taken in Phase 1.)*
- [x] **DD4 · Reject cancels, it doesn't erase** — reject only while undecided; proposed items are simply not created; for older decisions, waiting tasks are cancelled and only untouched auto-created work is removed. *(Default taken in Phase 1.)*
- [x] **DD5 · Approve with edits** — the approver can change tasks (doer, due date, priority), drop an item, and change / remove the workflow before approving. *Default: yes.*
- [x] **DD6 · Workflow tagging** — first match an **existing** workflow (same counterparty / order) and attach or move it; create a new one only when none matches; the approver sees and can change it. *Default: yes.*
- [x] **DD7 · Duplicates** — the same capture within 24 hours is flagged "Looks like a repeat of …" instead of silently creating another decision. *(Flag, not block — built in Phase 1.)*

---

## Phase 1 — Stop the harm (P0)

*Built 2026-09-15 as ASK-32. Browser checks ran with real saves in a throwaway database (`dos_uicheck_ask32`, email and WhatsApp mocked), never production.*

- [x] **1.1 Hold proposals until approval** *(DD1)*: the decision stores `proposal {tasks, workflows, meetings, reminders, memory_notes}` — who each task goes to and when, which pipeline and stage a workflow joins, the meeting date — and nothing else is written. Approve creates it all (`services/voice.materialize_proposal`) and links tasks to their workflow. Desk card: "On approval: 1 task, 1 workflow" and the amount; popup lists every item and "Nothing below is created until it's approved".
- [x] **1.2 Blocked decision tasks are really locked** — older decisions created their tasks blocked; those cannot be started before the decision is approved (server 403 naming the decision; My Work banner "Waiting for a decision" with a link to it). New decisions have no tasks until approved.
- [x] **1.3 Approve / reject guards** *(DD4)*: only while undecided (409 after); only the named approver or an owner (or a `decisions_approve` holder when nobody is named) (403 naming who decides); the decision records `decided_by`. Reject creates nothing; for older decisions it cancels waiting tasks and removes only untouched auto-created work. The named approver can now open the decision.
- [x] **1.4 No decision for "nothing to decide"** *(DD3)*: no tasks, workflows, meetings, reminders or notes → no decision and no inbox item (voice note `outcome: nothing_to_decide`); Dex replies "Nothing to decide in that". A failed capture says why (e.g. AI switched off).
- [x] **1.5 Repeat captures flagged** *(DD7, flag)*: the same thing within 24 hours → "Possible repeat" on the Desk card, a warning in the popup, needs-review reason.
- [x] **1.6 Phone bugs**: a spoken decision is held (`hold=1`), its words come back for review and are sent as one note (`POST /voice-notes/{id}/submit`) — one decision, not two; Attach opens a picker and a photo or file is read with the decision; the Send tap after a recording works first time (it was swallowed); desktop /brain keeps an attached file for the next note.
- [x] **1.7 Decision notification opens the decision** (`/inbox?decision=<id>`).
- [x] **1.8 WhatsApp approve uses the same approve path** (`services/decision_flow.approve_decision_flow`): reviewer choices apply to the proposed tasks, then the normal approval runs.
- [x] **1.9 `/dex/capture` checks the voice capture permission** (it called the handlers directly and skipped it).
- [x] Desk decisions sorted oldest first (it sorted the text "Waiting N days").

## Phase 2 — Who decides and who is told

*Built 2026-09-15 as ASK-32 Phase 2.*

- [x] **2.1 Always name the approver** *(DD2)* at capture (`services/decision_flow.route_approver`, stored with `approver_route`): the person who captured it when they may approve decisions → their reporting manager when the manager may → the owner. A company with several owners keeps it with every owner, so naming one does not hide it from the others. **Backfill:** waiting decisions captured before routing existed get an approver by the same rule — boot migration `name_waiting_decision_approvers_v1`; run on the dev database 2026-09-15 (59 named, all captured by owners → themselves).
- [x] **2.2 One permission** for routing and approving: `decisions_approve` (owner, or the effective permissions — own list, else company role settings). Routing used to check `approvals`.
- [x] **2.3 Notify**: the person who decides when a decision arrives (not the person who captured it); on approval, each person a task went to ("Work assigned to you") and the person who raised it ("… approved your decision"); on rejection, the person who raised it. A WhatsApp capture the reviewer approves on the spot tells nobody it waits.
- [x] **2.4 The person who captured it can follow it**: their Desk lists it as "Waiting on Sunita" (not counted in their Decisions number); the popup shows who decides and no Approve / Reject; Dex's reply says "Sent to Sunita to decide".
- [x] **2.5 Change who decides** from the popup — an owner or the person it waits on picks from the people who may decide (`GET/POST /decisions/{id}/approver(s)`); the timeline says "Sent to … to decide" and the new person is told.

## Phase 3 — The decision screen, kept simple

*Yokesh, 2026-09-15: only the decision screen (the popup from the Desk's Decisions column). Show the work plainly, like normal tasks — no "what the AI understood", no confidence. If the name is unclear, let them pick. Allow changing person, due date, removing a task; show what was said. Built 2026-09-15 as ASK-32 Phase 3.*

- [x] **3.1 What was said** — the typed words or the voice note's words, "Voice note · Tanglish" / "Typed" / "WhatsApp", a **Play the voice note** button (`GET /voice-notes/{id}/audio`), and the files sent with it.
- [x] **3.2 The work as plain rows** — each task: what, who, due, priority, and "Part of Toyota order" when it belongs to a workflow; workflows, meetings, reminders and notes as simple lines. The type chip ("Approval", "Directive") is gone.
- [x] **3.3 Change before approving** *(DD5)* — whoever decides picks **who does it** (a task Dex could not match to a person asks "Pick who does this"), changes the **due date**, or **removes** a task / workflow / meeting / reminder / note (`PATCH /decisions/{id}/proposal/tasks/{key}`, `DELETE /decisions/{id}/proposal/{kind}/{key}`). The person picker follows the task assignment rule (yourself, your team, your reports; anyone for the owner). Each change is on the timeline.
- [x] **3.4 After approving** — the popup stays open: each created task and the workflows it created or moved are links.
- Not built (not wanted): confidence, review reasons, every decision point, "Ask the person" as a separate action (Send a note already exists).

### 3.5 Sign-off on decision tasks (planned)

*Yokesh, 2026-09-15: keep the decision screen simple. One choice per task, "needs approval before done". No approval before start (the decision is already approved). No proof switch, because finance tasks should always carry proof.*

**Checked on dev data, 2026-09-15: proof is not automatic today.** Of 23 Finance tasks, 0 need proof (20 came from voice, 3 from Finance). `evidence_required` is only ever set in two places: the "Needs proof" box on New Task and a workflow stage's template tasks. Nothing turns it on because a task is a Finance task.

- [ ] **3.5 Needs sign-off before done**: one checkbox on each task row, shown only to whoever decides, while the decision is waiting.
  - Stored on the proposal task as `signoff`. The existing `PATCH /decisions/{id}/proposal/tasks/{key}` takes it, and the change goes on the timeline.
  - On approval the task is created with `approval_required=True`, `approval_stage="close"` and `approver_id` = the person who approved the decision.
  - Nothing new is needed on the task side. The close sign-off flow already exists (ASK-28 TK-05): the doer marks it done, it goes to Under review, the approver is told and closes it.
  - Dex ticks it in advance for money work (a Finance task, or an amount at or above the company's high-value threshold, ₹50,000 by default). Whoever decides can untick it.
- *3.5 is being built by another team (Yokesh, 2026-09-15).*
- Not in it: approval before start, a proof switch, a per-task approver picker (the decision's approver signs off), automatic proof on Finance tasks (not needed, Yokesh 2026-09-15).
- **Proof stays once the work is completed** (built 2026-09-15): nobody, the owner included, removes proof from a task that is done or sent for sign-off. Reopen the task to change it. Reference material stays removable.

## Phase 4 — Workflows go by themselves

*Yokesh, 2026-09-15: when proposing, check what is already on the board so nothing is duplicated; tag a task with a workflow when it belongs to one; ad hoc tasks stay plain; the workflow should move automatically, not by hand. Built 2026-09-15 as ASK-32 Phase 4.*

- [x] **4.1 Match existing workflows** *(DD6)* — before proposing a workflow, Dex looks at the open cards on the board (not at their last stage) of that type; the same customer/supplier ("Toyota" = "Toyota Kirloskar Pvt Ltd") or the same contact makes it **the existing card**: "Toyota order (already on the board) · moves from Ready To Dispatch to Dispatched" when a later stage is named, else it stays where it is and the tasks join it. Approving moves that card; no duplicate. Otherwise a new card is proposed.
- [x] **4.2 Tasks join the right workflow by themselves** — a task that names a customer/supplier joins the workflow this decision proposes for them, else their open card on the board, at its current stage. A task about nobody in particular stays a plain task (the old "join the first workflow" fallback is gone). *Recurring tasks: the app has none yet, so nothing to cover there.*
- [x] **4.3 Approval moves workflows** — a workflow the decision creates fires its first stage's automation (template tasks, side-effects — this was skipped); an existing card named in the proposal steps forward to the named stage; a workflow of this decision right before its pipeline's approval stage moves into it — every pipeline, not only procurement, and a manager's approval no longer fails silently. What moved (or could not) is on the timeline.
- [x] **4.4 Links both ways** — the task drawer says "From decision: …" and the workflow card on the board says "From decision: …", both links.
- [x] **4.5 Dex agent proposals follow the same rule** — `propose_task` stores a proposal (named approver, timeline, the approver is told); nothing is created until approved.

<details><summary>Earlier notes for 4.1–4.5</summary>

- **4.1 Match existing workflows** *(DD6)* by counterparty / title before creating one; attach the tasks to its current stage. *Founder scenario (2026-09-15): one message holds several things — "buy 50 spindles from Rajesh Traders, tell Kapoor the new date, Amit packs the Kapoor order by Friday, move the Toyota order to dispatched". Today every workflow event becomes a NEW workflow at its first stage, so "move the Toyota order" makes a second Toyota card instead of moving the one on the board. The proposal should say "Toyota order (existing): ready to dispatch → dispatched" and approving should move that card, with the approver able to pick a different card or "create new". To discuss before building.*
- **4.2 Suggest a pipeline** when tasks clearly belong to one and let the approver accept or remove it.
- **4.3 Approval moves any pipeline** that has an approval stage and runs the stage's automatic tasks.
- **4.4 Show the link both ways**: the workflow card and the task drawer name the decision they came from.
- **4.5 Dex agent proposals follow the same rule**: `propose_task` created a decision AND a blocked task at once — the old shape.

</details>

## Desk and My Work tidy-up

*Yokesh, 2026-09-15: decisions are approved on the Desk only, so they do not belong in My Work's Needs approval. Built 2026-09-15.*

- [x] **Needs approval is task approvals only**: the My Work filter lists tasks waiting for approval before work starts (sent back included) or for sign-off. It no longer includes tasks waiting for a decision (32 of the 39). Those tasks still show in All tasks with "Waiting for a decision" and a link to it.
- [x] **The decision card says who raised it and who decides**: "Raised by Priya · You decide · Waiting 13 days · Unblocks 2 tasks", or "Raised by you · Sunita decides · …" for the person following it.
- [x] **Old test data cleared** from the Sharma company (dev data): 60 test tasks (TEST_…, TESTIT57…, QA_NOTIF_TEST…), 22 decisions with nothing to act on ("No actionable directive", "said hello"…), and their 62 notifications and 113 activity entries. Everything is copied to `cleanup_archive` first and can be restored (`scripts/cleanup_test_data_0915.py --restore <run>`).
- [ ] **Approver on every approval task**: checked. New Task still offers "Anyone with approval access", and the backend accepts no approver, so a task with no named approver can still be created. Only 3 old test tasks had none (now cleared). Until a name is required, the owner's Desk Approvals button (My approvals) can miss those tasks.

## Phase 5 — Capture feedback and history

*Later — Yokesh, 2026-09-15: not now, we will do it later.*

- [ ] **5.1 Result after capture** (desktop and phone): "Decision ready for Sunita: 2 tasks, 1 workflow" with a link; or "Nothing to decide" with the answer.
- [ ] **5.2 Failures say why** — e.g. "AI is off for this company — turn on AI consent in Settings" (14 of today's 15 failures) — with Retry.
- [ ] **5.3 My captures** — a list with processing / ready / failed / decided.
- [x] **5.4 Files and photos through Dex are read** — done in Phase 1 (1.6): attached files ride with the note on the phone and on /brain, and the pipeline reads them.

## Every phase, before it is called done

- [ ] Desktop and phone, checked in the browser (the local database is dev data — saving while testing is fine, Yokesh 2026-09-15)
- [ ] Real-save journeys in an isolated test database
- [ ] Full backend suite
- [ ] Tracker row and coverage in the same push; pull before push

## Not in this plan

- Dex answers (planner, retrieval, money questions: DX-01, DX-02)
- My Work task views and approvals (docs/TASK_MANAGEMENT_PLAN.md)
- Finance document review (ingest / Captures tab) beyond 1.8

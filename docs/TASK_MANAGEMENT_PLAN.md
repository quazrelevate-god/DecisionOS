# Task Management Rework — Plan

Owner: Yogesh · Branch: `karma-redesign` · Started: 2026-09-14
Source: product review of New Task, My Work and task access (2026-09-13/14).

Work one phase at a time. Each phase ships on its own, is checked on desktop
and phone, and updates `docs/DecisionOS_UI_Bug_Report.xlsx` in the same push.

## Order we're working in (founder call, 2026-09-14)

1. **New Task form — desktop** (Phase 5) · ASK-29 · ✅ built 2026-09-14
2. **Task views — desktop** (Phase 1) · ASK-28 · checklist: https://claude.ai/code/artifact/53a2b23e-66a5-4eeb-bfb3-52a87ce08043
3. **Phone** for the form and the views · ✅ 2026-09-14
4. Phases 2, 3, 4, 6, 7

Tracker numbers: ASK-25 cards + photos and ASK-26 helpers (registered after
shipping), ASK-27 Decision Desk redesign, ASK-28 task views, ASK-29 New Task form.

---

## Goal

A small business runs on 3 questions: *what do I have to do, what did I ask
others to do, and what is waiting on me.* Today only the first works. The
people who ask for work, approve it or manage others lose sight of it once it
is assigned.

**Target model**

| | Today | Target |
|---|---|---|
| People on a task | Lead, also assigned, supporting, approver, created by | **Doer** (1) + **Helpers** · **Asked by** (auto) · **Approver** (optional) |
| Stages | Not Started, In Progress, Waiting, Under Review, Pending Approval, Completed, Cancelled | **To do → Doing → Done** (or Cancelled) |
| Flags | mixed into status | ⏳ **Waiting on** someone · 🔒 **Needs approval** · 🔴 **Overdue** |
| Approval | before starting only | **before starting** or **before closing** |
| My Work views | My Tasks, All Tasks (owner) | **My tasks · Asked by me · Waiting for my approval · My team · Everything** |
| Form | 15 fields up front | **Quick add** (title, doer, due) + **More** |

---

## Decisions (defaults proposed — confirm before the phase that needs them)

- [ ] **D1 · Assigning outside your team** — Default: staff assign to themselves and their own team/role; owner and managers assign to anyone. *(Phase 6)*
- [x] **D2 · Approval moment** — Creator chooses *before work starts* or *before it's marked done* per task. *(founder call 2026-09-14, built as ASK-28 TK-05)*
- [x] **D3 · Managers see their team** — Yes, through the existing Reporting Manager field: the owner keeps All Tasks, a manager gets My team. *(founder call 2026-09-14, built as TK-03)*
- [x] **D4 · Supporting employee** — Removed everywhere (form, server, drawer, phone app); helpers cover it. *(decided 2026-09-14, done in Phase 2)*
- [x] **D5 · Expected output** — Kept, as "Expected result" under More options. *(2026-09-14)*
- [x] **D8 · Department on a task** — Kept as the task's own field, not the doer's department: in a small company anyone can be given a Sales task and it still counts as Sales. Drives the Department filter. *(founder call 2026-09-14)*
- [ ] **D6 · Statuses** — Default: change labels and flags in the UI first, keep stored statuses as they are; migrate data only later if needed. *(Phase 3)*
- [ ] **D7 · Overdue reminders for Waiting / Under review / Pending approval tasks** — Default: yes, remind the person they are waiting on or the approver. *(Phase 7)*

---

## Phase 0 — Before any code

- [ ] **0.1 Separate the local database from production.** Local `MONGO_URL` points at production, so any test that saves data changes real data. Blocker for testing Phases 1–7 with real clicks.
- [ ] **0.2 Top up or switch off the local AI key.** When AI calls fail, the backend stops answering Desk and My Work data requests.
- [ ] **0.3 Tracker numbering.** Register what shipped without a row: ASK-25 (My Work cards + photos, `513b9f0`), ASK-26 (more than one person on a task, `e47fea6`). Then ASK-27 = Decision Desk redesign, ASK-28 = this plan (sub-items TK-01…).
- [ ] **0.4 "Before" snapshot.** Read-only script: for owner, finance, sales, production and a user with `approvals`, record which tasks each can see in My Work, and whether the approver / creator / supporting employee of a sample task can see it. Becomes the acceptance baseline.
- [ ] **0.5 Check the Flutter app** (`mobile/`) for its own task screens and `/tasks` calls, so API changes don't break it.

---

## Phase 1 — Everyone can see the work they're part of (P0)

- [x] **1.1 "Asked by me" view** *(TK-01, desktop, 2026-09-14)*
  - [x] Backend: `GET /tasks?view=asked` — tasks I created that aren't mine to do (`services/tasks.task_list_query`, unit-tested).
  - [x] My Work: Asked by me in the desktop switcher, kept in the URL, not saved as default; Department, Person and Status filters work on it; AI priority off; own empty state. Phone link lands on the list (the phone switcher comes with the mobile pass).
  - [x] The person who asked can leave a note (not hand off or escalate) — server and form.
  - [x] Acceptance: a non-owner creates a task for someone else and still sees it — **real saves** in an isolated test database, `tests/test_task_management_e2e.py` (2026-09-14); browser checks read-only: owner 53/53 vs API, sales empty state, note-only form mocked.
- [x] **1.2 "Waiting for my approval" view** *(TK-02, desktop, 2026-09-14)*
  - [x] Backend: `GET /tasks?view=approvals` — approval required, not yet approved (changes requested still counts), not finished, and I may approve: owner all; named approver their own; `approvals` holder also the unnamed ones. Unit-tested against the `_can_approve_task` rule.
  - [x] My Work: merged into the Approvals view from 3c23e49 (Tasks | Leave tabs, All / My approvals). Its Tasks tab and the Desk's Task approvals card now read the server rule instead of `/tasks?mine=false`; the Approvals button carries the pending count and shows for a named approver without approval access; oldest first; Approve / Request changes / Ask clarification reachable.
  - [x] Approval-requested notification opens `/my-work?view=approvals&task=<id>`.
  - [x] Acceptance: a non-owner named approver approves a real task — **real saves** in an isolated test database, `tests/test_task_management_e2e.py` (2026-09-14); browser checks: owner 7/7 vs API, no-access user, named approver with a mocked list, Approve click path.
- [x] **1.3 "My team" view** *(TK-03, desktop, 2026-09-14)*
  - [x] Backend: `GET /tasks?view=team` — tasks where the doer or a helper reports to me (direct reports only). Unit-tested.
  - [x] My Work: shown only to a non-owner with direct reports (the owner keeps All Tasks); in the URL, not saved as default; Person filter lists the team; AI priority off; own empty state; a link opened without reports lands on My Tasks.
  - [x] The manager can open a report's task and activity and leave a note; outside their own department the drawer is note-only, inside it the department rule still gives full controls.
  - [x] Acceptance: a manager sees their reports' tasks and no one else's — **real data** (Sunita Rao → sai, 16 tasks), 21/21, writes blocked.
- [x] **1.4 Opening a task by link always works.** *(TK-04, 2026-09-14)* `/my-work?task=<id>` (and the older `?focus=task:<id>`) opens the drawer whatever the view — from the single-task request when the task isn't in the list; opens again when followed while My Work is open; closing clears the link. A missing task says so; a refused one keeps Access restricted; both can be dismissed. Every view is in `?view=` and survives refresh, Back and Forward. Checked on real data with writes blocked, 23/23.
- [x] **1.5 Desk hook.** The Decision Desk "Task approvals" card (ASK-27) reads from 1.2. *(done with TK-02: the card reads `/tasks?view=approvals`; counts agree, T-722)*
- [ ] Tracker rows + coverage; full backend tests; API parity baseline regenerated (routes change).

## Phase 2 — Who is on a task (P1)

A task has four kinds of people: **Doer** (one), **Helpers** (optional), **Asked by** (automatic), **Approver** (optional). *(founder call 2026-09-14, built as ASK-28 TK-06)*

- [x] **2.1 Supporting employee removed** — no stored task used it (0 of 185, read-only check), so nothing to copy. The server no longer saves it or lets it open a task; older app builds that still send it are not refused (the field is ignored); gone from the web drawer and the Flutter New Task form. Helpers are the one way to add people.
- [x] **2.2 "Asked by"** in the drawer's people section ("You" when it was you).
- [x] **2.3 The approver** in the drawer, with the moment: "Approval before work starts / before it's marked done: Sunita" (or "anyone with approval access").
- [x] **2.4 Say where team tasks went** — the server records `auto_assigned` when a team task is routed to the member with the fewest open tasks; New Task says "Assigned to Priya: fewest open tasks in Sales"; the drawer says "Picked automatically: fewest open tasks in Sales"; any later reassign clears it.
- [x] **2.5 Helpers get the same notifications** — create, approved, changes requested, clarification and comments already did; status changes and overdue reminders now reach everyone on the task too (real-save tested).

## Phase 3 — Stages and flags (P1)

- [ ] **3.1 Three stages in the UI** *(needs D6)*: To do (`todo`), Doing (`in_progress`), Done (`done`), Cancelled.
- [ ] **3.2 "Waiting on" flag** — who or what (person or free text like a supplier) and since when; replaces the Waiting status.
- [ ] **3.3 Approval as a 🔒 flag** on the card, not a status pill.
- [ ] **3.4 Under review** folds into approval before closing (Phase 4).
- [ ] **3.5 Update everything that reads status:** Status filter, card pills, phone progress bar, Desk counts, Brief, Operating Score. Dex's status handling belongs to Yokesh — hand him the mapping, don't change it here.

## Phase 4 — Approval as a step (P1)

- [x] **4.1 Approval moment** *(D2 confirmed 2026-09-14)*: New Task → More options → Needs approval: No / Before work starts / Before it's marked done. Stored as `approval_stage` ("start" | "close"); older approval tasks read as "start". *(ASK-28 TK-05, desktop)*
- [x] **4.2 Before closing:** work starts straight away; Complete (proof still required) moves it to Under review with approval pending and tells the approver; Approve → Done (workflow advance, Brain record and invoice draft run then); Request changes → back to In progress with the reason shown to the doer; moving the status back withdraws the request; a person who may approve closes it directly. Same through a checklist reaching 100%.
- [x] **4.3 Server checks the approver** actually has approval access. *(2026-09-14)* `POST /tasks` refuses (400, names the person) an approver who isn't the owner and has no `approvals` through their own permissions or the company's role settings; someone outside the company is still dropped. Real-save tested.
- [x] **4.4 Notifications and counts** for both moments feed the Approvals view and the Desk card: "Approval needed to close" notification opens Approvals; a before-done task counts only while it waits. Cards say "Approval to start" / "Approval to close" / "Needs approval to close".
- [x] Acceptance with real saves — `tests/test_task_management_e2e.py` in an isolated test database (2026-09-14): complete → sign-off → changes → complete → approve → reopen, and the approver who completes. Browser: 19/19 with made-up tasks and writes blocked, 17 unit tests.

## Phase 5 — The New Task form (P1)

- [x] **5.1 Quick add (desktop):** title with inline error, Department, one Assign to (people or a team → least busy member), due presets No date / Today / Tomorrow / In a week / Pick a date. *(ASK-29, 2026-09-14)*
- [x] **5.2 "More options" (desktop):** priority, helpers, description, due time, expected result, needs approval + approver, needs proof, reference files; closed section shows how many are set. Approval moment (before closing) waits for Phase 4.
- [x] **5.3 Dropped from the form:** Operational category (stored data kept), Supporting employee.
- [x] **5.3b Due "Today" no longer reads Overdue the same morning** (date-only due dates compare as calendar days).
- [x] **5.4 Phone:** same form as a full-screen sheet (0eaa411 opens it in full; there is no More row any more). Checked at 390x844 on 2026-09-14: nothing past the edge, Create in reach, the approval choice now wraps instead of cutting off. My Work views on the phone: one view pill for everyone opening a sheet of that person's views (My Tasks, Asked by me, My team, All Tasks, Approvals with its count).
- [ ] **5.5 Doer list respects access** (Phase 6): only people this user may assign to.

## Phase 6 — Access rules for tasks (P2)

- [ ] **6.1 New permissions** in both `backend/config.py` `PERMISSION_KEYS` and `frontend/src/lib/perms.js`: `tasks_assign_any`, `tasks_view_all`. Add them to Settings → Roles. (Also sync `brain_export`, which the frontend list is missing.)
- [ ] **6.2 Enforce creating:** `POST /tasks` requires `tasks` (on by default for every role).
- [ ] **6.3 Enforce assigning** *(needs D1)*: outside own team/role needs `tasks_assign_any`; server rejects, form hides.
- [ ] **6.4 "Everything" view** for `tasks_view_all`, not only the owner.
- [ ] **6.5 One rule list** used by My Work views, the Desk and routes (first slice of ASK-21).
- [ ] **6.6 Role × view check:** owner, finance, sales, production, a manager, an approver, an owner with a permission removed — desktop and phone, no refused requests.

## Phase 7 — "Stuck" signals cleanup (P2)

- [ ] **7.1 Automatic reminders go to the right person:** day 2–3 "Manager escalation" goes to the reporting manager, not the owner; day 3+ owner alert stays.
- [ ] **7.2 Reminders cover Waiting on / Needs approval tasks** *(needs D7)* — nudge the person waited on, or the approver.
- [ ] **7.3 One place for stuck work:** Escalate button, automatic reminders and the Desk's Slipping list all read the same rule.

---

## Every phase, before it is called done

- [ ] Works on desktop (1440) and phone (390), checked in the browser preview
- [ ] Acceptance script passes for each role in the phase
- [ ] Full backend test suite passes (backend phases)
- [ ] API parity baseline regenerated if routes changed
- [ ] Tracker row and coverage rows updated in the same push
- [ ] Pull before push

## Not in this plan

- Dex (voice capture, answers) — owned by Yokesh
- Decision Desk layout — tracked separately as ASK-27 (shares the approvals feed from 1.2)
- Workflow stage approvals and onboarding approval rules — parked

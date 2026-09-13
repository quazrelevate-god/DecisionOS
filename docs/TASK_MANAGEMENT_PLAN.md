# Task Management Rework — Plan

Owner: Yogesh · Branch: `karma-redesign` · Started: 2026-09-14
Source: product review of New Task, My Work and task access (2026-09-13/14).

Work one phase at a time. Each phase ships on its own, is checked on desktop
and phone, and updates `docs/DecisionOS_UI_Bug_Report.xlsx` in the same push.

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
- [ ] **D2 · Approval moment** — Default: creator chooses *before starting* or *before closing* per task. *(Phase 4)*
- [ ] **D3 · Managers see their team** — Default: yes, through the existing Reporting Manager field. *(Phase 1)*
- [ ] **D4 · Supporting employee** — Default: merge into Helpers. *(Phase 2)*
- [ ] **D5 · Expected output** — Default: show it in the task drawer (keep the field, under More). *(Phase 5)*
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

- [ ] **1.1 "Asked by me" view**
  - [ ] Backend: `GET /tasks?view=asked` — tasks I created that aren't mine to do.
  - [ ] My Work: new view on desktop and phone; Person and Status filters work on it.
  - [ ] Acceptance: a non-owner creates a task for someone else and still sees it, with its live status.
- [ ] **1.2 "Waiting for my approval" view**
  - [ ] Backend: `GET /tasks?view=approvals` — approval required, not yet approved, and I may approve (named approver, or anyone with `approvals` when none is named, or owner).
  - [ ] My Work: view with a count; Approve / Request changes / Ask clarification reachable.
  - [ ] Acceptance: a non-owner named approver approves from the app.
- [ ] **1.3 "My team" view** *(needs D3)*
  - [ ] Backend: `GET /tasks?view=team` — tasks where the doer or a helper reports to me.
  - [ ] My Work: view shown only to people with direct reports; Person filter lists the team.
  - [ ] Acceptance: a manager sees their reports' tasks and no one else's.
- [ ] **1.4 Opening a task by link always works.** `/my-work?task=<id>` opens the drawer even when the task isn't in the current view (today the notification link lands on a list without it).
- [ ] **1.5 Desk hook.** The Decision Desk "Task approvals" card (ASK-27) reads from 1.2.
- [ ] Tracker rows + coverage; full backend tests; API parity baseline regenerated (routes change).

## Phase 2 — Who is on a task (P1)

- [ ] **2.1 Merge Supporting employee into Helpers** *(needs D4)* — copy `support_id` into `co_assignee_ids`, remove the field from the form, keep reading old data.
- [ ] **2.2 Show "Asked by"** on the card drawer (the creator is already stored).
- [ ] **2.3 Show the approver** in the drawer's people section.
- [ ] **2.4 Say where team tasks went** — "Auto-assigned to Priya (least busy in Sales)" instead of a silent pick.
- [ ] **2.5 Helpers get the same notifications** as the doer (check create, approve, reject, comment, overdue).

## Phase 3 — Stages and flags (P1)

- [ ] **3.1 Three stages in the UI** *(needs D6)*: To do (`todo`), Doing (`in_progress`), Done (`done`), Cancelled.
- [ ] **3.2 "Waiting on" flag** — who or what (person or free text like a supplier) and since when; replaces the Waiting status.
- [ ] **3.3 Approval as a 🔒 flag** on the card, not a status pill.
- [ ] **3.4 Under review** folds into approval before closing (Phase 4).
- [ ] **3.5 Update everything that reads status:** Status filter, card pills, phone progress bar, Desk counts, Brief, Operating Score. Dex's status handling belongs to Yokesh — hand him the mapping, don't change it here.

## Phase 4 — Approval as a step (P1)

- [ ] **4.1 Approval moment** *(needs D2)*: *before starting* (today's lock) or *before closing*.
- [ ] **4.2 Before closing:** Complete sends it to the approver instead of Done; Approve → Done; Request changes → back to Doing with the reason.
- [ ] **4.3 Server checks the approver** actually has approval access (today it only checks they're in the company).
- [ ] **4.4 Notifications and counts** for both moments feed the "Waiting for my approval" view and the Desk card.

## Phase 5 — The New Task form (P1)

- [ ] **5.1 Quick add:** title, doer, due date (Today / Tomorrow / This week / pick), Create.
- [ ] **5.2 "More" section:** priority, department, helpers, approval (moment + approver), proof required, description, files, expected output *(D5)*.
- [ ] **5.3 Drop from the form:** Operational category (keep stored data), Supporting employee (merged in 2.1).
- [ ] **5.4 Phone:** same quick add as a full-screen sheet; nothing moves when More opens.
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

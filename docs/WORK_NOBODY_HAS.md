# Work nobody has finds its person

Epic 11 · Sprint 11 · Feature · 2026-10-30

## What's new (announcement)

**A task no longer sits with nobody.** This covers tasks from a decision, a workflow stage, New Task, and Finance's own follow-ups.

- **A person is named → that person.** Same as before.
- **The team has one person → that person.** Nobody has to pick.
- **The team has several people → the team's queue.** Everyone in the team, its managers included, sees the task in My Work with **Take it**. The first person to tap it gets it. Anyone after them is told who has it.
- **High priority → the team's nearest managers are asked to assign it straight away.** It stays in the queue too, so anyone in the team can still take it.
- **No team, or nobody in the team → the owner is asked to assign it.**
- **Nobody is picked by how few tasks they have.** That rule is gone everywhere, Finance follow-ups included.
- **It climbs the reporting line, one level a day, the owner last.**
  - Day 1: the team's nearest managers (for example the team leads).
  - Day 2: the next level up (for example the department head).
  - Last: the owner.

  Each step is **one** message per person, however many tasks it covers. The step length is in Settings › Deadlines › *Work nobody has* (1 day).
- **Needs a person, on the Desk.** Owners see every task that has nobody; a team's managers see their own team's. Each row says where the task is waiting and for how long, and can be assigned on the spot or taken. The "assign it" notifications open this list.
- **The Decide review says where each task will go**, before you approve it: "Sales queue — anyone in Sales can take it", "Divya assigns it — high priority", "The owner assigns it — no team named". The decision's timeline says the same after approval.

## Why

The complaint: "From the decision it is creating a task — the task is mostly getting unassigned." In the dev data, 93 of 148 open decision and workflow tasks (63%) had nobody on them, and nobody was ever told. Tasks for a team went to whoever had the fewest open tasks; the founder rejected that rule ("That's not the right way"). Reminders climb the reporting line instead of going straight to the owner, so the owner isn't flooded with notifications.

## Who the team's managers are

Managers come from Team › *Reports to*. There is no manager setting yet; the founder will add one once a client confirms.

- **A team's managers:** anyone in the team who reports straight to the owner (the head), or has people reporting to them.
- **Their level:** how far they are from the owner. Level 1 reports to the owner, level 2 reports to a level 1, and so on.
- **The ladder:** the team's managers grouped by level, deepest level first, then the owner. Two managers at the same level are both asked; whoever acts first settles it.
- **Missing links:** if someone has people reporting to them but their own *Reports to* never reaches the owner, they count as level 1.
- **No managers:** the ladder is just the owner.

## How it works

| Piece | Where |
|---|---|
| The rule: where a task with nobody goes, the managers and their levels, the ladder | `backend/services/task_pickup.py`: `route`, `Company.managers` / `level` / `ladder`, `place`, `announce`, `warn_unpicked`, `needs_person`, `take` |
| What a waiting task records | `pickup_route` (queue / manager / owner), `pickup_why` (no_team / nobody_in_team / no_head = no managers), `pickup_since`, `pickup_level` (0 placed · 1 the queue told · 1+n: n ladder steps asked). All four are cleared the moment the task has a person or is finished. |
| Decisions | `services/voice.py` `build_proposal` (a team of one is that person, else the team's); `services/decision_flow.py` `approve_decision_flow` places and tells; `task_assigned_line` says where each task waits |
| Every other place work is made | workflow stages (`services/workflow_engine.py`), New Task for a team (`routers/tasks.py` `create_task`), a task added to an approved decision (`routers/decisions.py`), a task moved to another team (`reassign`), someone leaving with their work handed to nobody (`services/deprovisioning.py` keeps the team; the next sweep tells it), **Finance follow-ups** (`services/finance_signals.py` `run_finance_actions`: chase an overdue invoice, pay a bill) |
| Take it | `POST /api/tasks/{id}/take`. Only the team (or an owner) can take a task; one write wins and the other gets a 409 naming who took it. The nearest managers are told, plus anyone the ladder already asked. My Work drawer: `TakeItBar` |
| Needs a person | `GET /api/tasks/needs-person` (owner: all; any manager of the team: that team; others: empty). Desk card + `pages/desk/NeedsPersonSheet.jsx`; any manager of the team may assign from its queue (`reassign` rule) |
| Reminders | `warn_unpicked`, on the leader-locked follow-up tick (`services/finance_signals.run_followup`). Only the step now due is asked, so a task found late does not set off every level at once. Work already waiting on the owner is not chased again; it stays on the Desk. Setting: `pickup_step_days` (1). |
| Older work | Tasks that already had nobody join their queue quietly the first time the sweep sees them. Their days start then, so a backlog doesn't land on anyone at once, and nothing is handed out silently. |
| Who counts as here | Active people only, judged per person: a membership row that isn't active leaves someone out; someone with no row (from before memberships) counts. A pending invite never counts. |

## Tests

- `backend/tests/test_work_nobody_has_finds_its_person.py` (32 cases):
  - **Where a task goes:** every kind of team (one person, several, high priority with and without managers, no team, nobody in the team), two heads, never by load.
  - **Decide review and approval:** the review labels; approval end to end, with one message per person and the approver not told.
  - **Take it:** team only, owner for no team, finished, two at once → one wins.
  - **Reminders:** each step, one message for many tasks, no repeats, a team with no managers, high priority a day sooner, owner work not chased, the company's own days.
  - **The reporting tree:** a three-level Sales team (team leads → head → owner, a day apart); high priority starting with the team leads; any manager seeing and assigning its queue; a chain that never reaches the owner.
  - **Other places work is made:** older work joining quietly; tasks that found a person or finished; New Task, workflow stages, someone leaving, a task added to a decision; Finance follow-ups (the Finance queue, a team of one, no Finance team → owner).
  - **Needs a person:** owner, manager and member views; moving a task to another team.
  - **Also:** settings; people from before memberships; the screens.
- Checked in the browser on the demo workspace (scratch database), with three extra Sales people: Karthik (reports to the owner), Divya (reports to Karthik) and Esha (reports to Divya):
  - the review labels ("Divya assigns it — high priority");
  - approval placing all four tasks and telling the right people;
  - the Desk card and sheet, assigning from it;
  - Priya taking a task from the Sales queue in My Work, a second take refused.

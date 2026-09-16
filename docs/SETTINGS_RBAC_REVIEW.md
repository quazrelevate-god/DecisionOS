# Settings, Team and access (RBAC): review

*Yokesh asked on 2026-09-15 to check Settings, Team and role-based access, one section at a time, focusing on how they affect task creation and decisions. This is a read-only review. Nothing below has been changed yet. Go through it and mark each item **keep / fix / later**.*

Checked by reading the code (file:line). The items marked ✔ were confirmed a second time directly in the code.

---

## 1. How access works today (the model)

- **17 permissions.** Keys are in `backend/config.py:341`; their screen labels are only in `frontend/src/lib/perms.js`.
- **Roles.** The fixed roles are owner, sales, operations and finance. The owner can add custom roles in Settings › Business › Team Roles.
- **A person's access is worked out in this order** (`backend/core/permissions.py:30-82`):
  1. **Owner:** everything, minus any "owner exclusions".
  2. **The person's own permission list**, when it isn't empty. It **replaces** everything below.
  3. The company's permissions for that role.
  4. The built-in default for the role (sales and finance have their own; everyone else gets the base set: Decision Desk, data input, workflows, tasks, Company Brain, Ask).
  5. Temporary grants are added on top.
- **Reports to** (reporting manager) is a field on the person, not a permission. It decides:
  - "My team"
  - who a manager may give work to and edit
  - where overdue work escalates
  - who decides a decision
  - who approves a task when nobody is picked (built 2026-09-15)
  - who approves leave

## 2. Settings page (`frontend/src/pages/Settings.js`)

Owners and people with **Manage team** see all tabs. Everyone else sees only Profile, Password and Sign out.

| Tab | What's there | Who can save |
|---|---|---|
| Business | Company details, WhatsApp code, **Team Roles** (add, rename, delete), Rules & templates, Business vocabulary | Manage team |
| Operations | Pipelines and stages with an approval gate per stage; leave approvers by department | Manage team |
| Money | Currency, high-value threshold, owner sign-off; finance categories | Threshold card: **owner only** |
| Account | Language, theme, profile, password | Self |

**Findings**
- [x] **P0:** Someone with Manage team who isn't an owner sees the Money card, but saving it fails with a 403 (`tenant_settings.py:186`). *Fixed 2026-09-15: only owners see the card.*
- [x] **P1:** *(Fixed 2026-09-16: Settings › Business › AI processing shows whether it's on and who agreed; an owner turns it on or off; the "AI is off" message links straight to it. Teammates see the status read-only. Also fixed: turning AI off always failed with a server error.)* No AI consent section. The "AI is off" message links to `/settings#ai-consent`, which doesn't exist (`api.js:128`).
- [x] **P1:** "Approval rules" is free text that nothing enforces. Either enforce it or remove it. *Removed 2026-09-16 (Yokesh): gone from Settings (now "Task templates") and the onboarding summary; approvals live on each task and on workflow stages.*
- [x] **P2:** Currency is set in two places. *Fixed 2026-09-16: only on the Money card.*
- [x] **P2:** People without Manage team don't get Language or Theme. *Fixed 2026-09-16.*
- [x] **P2:** Features the backend already has but the owner can't see: plan and seats used, audit log, owner exclusions, the company's own AI keys. *Fixed 2026-09-16: Settings › Workspace (owner only). AI keys are set one at a time (new `PATCH /tenant/ai-keys/{provider}`, so the others stay); owners can't be excluded from Manage team.*
- [x] **P2:** Escalation days (2 days → manager, 4 → owner) and notification preferences are fixed in code. *Fixed 2026-09-16: Settings › Operations › Overdue work (owner) sets the manager and owner days and whether owners also get the alert by email. Notifications are otherwise in-app only, so that email is the one preference there is.*
- Note: the high-value threshold only affects invoices and payments, not tasks or decisions.

## 3. Team page (`frontend/src/pages/Team.js`)

**What works:** an org tree by role and manager, search, and a "Currently out" strip. **Add member** asks for name, email, title, mobile, sign-in method, Team (role), Reports to and 16 permission toggles, and shows a preview of the menus they'll see. It checks the seat limit and whether the person is being made an owner. A mobile number gives a 7-day invite link.

**Findings**
- [x] **P0: No way to remove or deactivate someone.** *Fixed 2026-09-15: the owner opens a profile → Remove from company. It shows what the person holds (open tasks, tasks they help on, approvals, decisions waiting on them, reports, contacts) and asks who takes over. Open work, contacts and reports go to that person; approvals and decisions go to them when they're allowed, otherwise to the owner; finished tasks keep who did them. A pending invite gets Cancel invite instead. Also fixed: removed people still showed in the member list, and could still sign in through the old-account fallback.* Was: The backend already has `POST /users/{id}/deprovision`, which revokes access and reassigns their tasks, and `/uninvite`, but nothing in the app calls them. Before building on it, check what happens to decisions waiting on that person.
- [x] **P1:** Changing someone's role keeps their old permission list instead of taking the new role's defaults (`Team.js:146`). *Fixed 2026-09-15: someone who follows their role gets the new role's access.*
- [x] **P1:** Name and email can't be edited. *Fixed 2026-09-16: anyone who manages the team corrects a name; only an owner changes an email (it's how they sign in), and it must not belong to another account.*
- [x] **P1:** *(Fixed 2026-09-16: after adding someone with a password, a welcome message to copy or send on WhatsApp — where to sign in and with which email, never the password. "Get invite link" only shows for an invite not yet accepted — superseded the same day by Sakthivel's Team redesign (8b60707), where the invite icon sits beside the name for every member but an owner, and opens their form to add a mobile number when they have none.)* People who sign in with a password get no invite or hand-off. "Get invite link" also shows for people who are already active.
- [x] **P1:** *(Fixed 2026-09-15.)* The Reports to help text only mentions leave. It should say it also decides who approves their tasks and decisions and where their overdue work goes.
- [x] **P1:** On the phone, the Team tile is hidden without Manage team, but the page is open to everyone. *Fixed 2026-09-16: the tile shows for everyone.*
- [x] **P2:** Owner promote and demote use the browser's plain confirm box instead of the app's own dialog. *Fixed 2026-09-16.*
- [x] **P2:** `/people` duplicates Team, uses the old design and has no menu link. Remove it. *Removed 2026-09-16; old links land on Team.*

## 4. Roles and permissions

- [x] **P0: Role permissions can't be managed.** *Fixed 2026-09-15: Settings › Business › Team roles › Access (owner only) sets what each role can open, with "Use the built-in default" and an option to make people who have their own access follow the role. In Add/Edit member, "Use the role's access" is on by default, so people follow their role unless you untick it. The member list now returns each person's real access, so approver lists and profiles match the server.* Was:
  - There's no screen to set a role's permissions (the API exists: `PATCH /tenant/roles/{key}/permissions`).
  - Add member always saves a personal list, which permanently overrides the role (`Team.js:123,175`, `permissions.py:58-61`) ✔.
  - Result: changing a role never reaches anyone added through the app.
  - Fix: a per-role permission editor, and people follow their role unless you deliberately override it.
- [x] **P0: Manage team can give itself any permission** ✔ — *fixed 2026-09-15: nobody but an owner changes their own role or access; a non-owner gives only access they hold, the person already has, or that person's role defaults (members, temporary grants); only an owner changes what a role can do. The Team dialog greys out access you can't give.* Was: its own list (`team.py:361,386`), temporary grants (`access.py:137`) and role permissions. In practice it's close to owner. Stop self-changes, or make those owner-only.
- [x] **P1:** An empty list means "use the role defaults", so a person can't be given no access at all. *Fixed 2026-09-16: "Use the role's access" is stored on its own (`permissions_custom`), so their own access with nothing ticked is No access.*
- [x] **P1:** *(Fixed 2026-09-16: People access, on the server and the screens.)* Contacts, CRM and complaints check the role *name* (owner or sales) instead of a permission (`contacts.py:45,70,137`, `complaints.py:31,59`, `crm.py:114`). A custom role with People access gets refused, even though the buttons show.
- [x] **P2** *(fixed 2026-09-16, one open)*:
  - One idea has four names: Team Roles / Team / department / departments. *"Team" on screen everywhere.*
  - The "Inbox" permission is the Decision Desk. *Labelled Decision Desk.*
  - "Approve tasks" also approves WhatsApp captures. *Labelled "Approve tasks & WhatsApp captures".*
  - Brain export has no toggle. *Added: "Export Company Brain".*
- [ ] **Open:** Finance and ledger can't be separated. The Finance page has no per-tab permission and 31 ledger endpoints accept either permission, so splitting them needs the Finance tabs gated one by one. Kept as its own item.

## 5. Task access (My Work)

| Action | Rule today | OK? |
|---|---|---|
| Create a task | Tasks permission (`tasks.py:444`) | Yes |
| Give work to a person or team | Yourself, your team, your direct reports; anyone with Assign to anyone | Yes |
| See all tasks | See all tasks permission. **Without it you still see every task in your role.** | Check if wanted |
| My team | Your direct reports (one level) | Yes |
| Approve / reject | Named approver or owner. Since 2026-09-15 every approval task names someone. | Yes |
| Change a task | Doer, helpers, asker, manager, owner (item 7) | Yes |
| Remove proof | Uploader, asker or owner, and never once done | Yes |

**Findings**
- [x] **P0: Anyone can attach proof to any task** ✔ (*fixed 2026-09-15: only the people who may work the task add files*), even tasks they can't open. There's no access check (`tasks.py:1333`).
- [x] **P0: The checklist can close someone else's task without proof.** *Fixed 2026-09-15: the checklist follows the task's rules; ticking every step completes it only for someone who may finish it, and only with its proof. Otherwise it stays in progress at 100%.* Anyone in the same role can save a checklist, which marks the task done at 100%. That skips the "who may finish" rule and the proof rule (`tasks.py:1032-1067`, `services/tasks.py:206`).
- [x] **Approval with nobody picked** (fixed 2026-09-15): the creator's manager if they can approve, else the owner.
- [x] **P1:** *(Fixed 2026-09-16, Yokesh: owners exempt. A non-owner can't approve a task they do, help on or asked for; naming them is refused, the default skips a manager who is on the task, and a "before done" task they complete goes for sign-off.)* Creators and doers with "Approve tasks" can approve their own task. Completing a "sign-off before done" task approves it at once when the doer can approve.
- [x] **P1:** *(Fixed 2026-09-16: both use each person's real access.)* The New Task Approver list, and anyone notified about unnamed approvals, only look at personal permission lists, not role permissions (`Tasks.js:127`, `notifications.py:23`) ✔. Less important now that every task names an approver.
- [x] **P2** *(fixed 2026-09-16)*:
  - `/tasks/{id}/reassign` is unused and has its own conflicting rule. *Now the same people rule as editing a task, then the assign rules.*
  - Hand-off skips the assign rules. *Follows them now (escalation still goes to your manager).*
  - The AI-priority toggle shows for everyone but works only with Manage team. *Shown only to owners and Manage team.*

## 6. Decision access (Decision Desk)

- **Who decides:** owner, the named approver, or anyone with Approve decisions. Routing: the person who raised it if they can decide, else their manager, else the owner.
- [x] **P0: Approving a WhatsApp capture approves its decision** *(fixed 2026-09-15: it approves the decision only when the reviewer may decide it; otherwise the decision waits for the person it names, who is told, and WhatsApp replies "waiting for a decision")* with only "Approve tasks". The named decider and Approve decisions are skipped (`captures.py:148` → `services/captures.py:270`) ✔.
- [x] **P1:** *(Fixed 2026-09-16: only decisions you can open; helpers on its tasks count as on it.)* The decisions list returns every decision's title to anyone, even decisions they can't open (`decisions.py:58`).
- [x] **P1:** *(Fixed 2026-09-16.)* Adding a task to a decision skips the participant check and the assign rules (`decisions.py:120`).
- [x] **P1:** *(Fixed 2026-09-16: routing, the deciders list, task approver checks and approval notifications use membership, role settings, temporary grants and owner exclusions.)* Deciders are looked up from old user records: temporary grants and owner exclusions are ignored, so routing and the approve check can disagree.
- [x] **P2** *(fixed 2026-09-16)*:
  - "Approve on my behalf while I'm away" (delegation) is stored but never used. *Settings › Account › While you're away: the person picked approves tasks and decides decisions that wait on you, sees them in Approvals and on the Desk, and is told when new ones arrive.*
  - Helpers on a task aren't counted as decision participants. *Counted (with P1).*
  - `/transcribe` has no permission check. *Needs Ask AI or Voice capture.*

---

## Suggested order

1. **Close the holes (P0 access):**
   - capture approval
   - proof upload check
   - checklist closing
   - Manage team self-escalation
   - Money card 403
2. **Let the owner run access by role:**
   - role permission editor
   - people follow their role unless overridden
   - role change applies the new defaults
3. **Team lifecycle:**
   - remove / deactivate with task and decision hand-over
   - revoke invite
   - edit name and email
   - invites for password members
4. **Clarity:**
   - one name for Team / Role
   - Reports to explained
   - AI consent section
   - rename Inbox → Decision Desk
5. **Later (P2):**
   - configurable escalation and notifications
   - delegation
   - plan / seats / audit log
   - retire `/people`

Dev data note: 7 test users remain (six "TEST Limited", one TEST_member). Only Sai has a manager (Sunita), so every approval task currently defaults to Rajesh (owner).

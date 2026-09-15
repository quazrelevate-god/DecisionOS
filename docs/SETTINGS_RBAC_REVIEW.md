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
- [ ] **P0:** Someone with Manage team who isn't an owner sees the Money card, but saving it fails with a 403 (`tenant_settings.py:186`).
- [ ] **P1:** No AI consent section. The "AI is off" message links to `/settings#ai-consent`, which doesn't exist (`api.js:128`).
- [ ] **P1:** "Approval rules" is free text that nothing enforces. Either enforce it or remove it.
- [ ] **P2:** Currency is set in two places.
- [ ] **P2:** People without Manage team don't get Language or Theme.
- [ ] **P2:** Features the backend already has but the owner can't see: plan and seats used, audit log, owner exclusions, the company's own AI keys.
- [ ] **P2:** Escalation days (2 days → manager, 4 → owner) and notification preferences are fixed in code.
- Note: the high-value threshold only affects invoices and payments, not tasks or decisions.

## 3. Team page (`frontend/src/pages/Team.js`)

**What works:** an org tree by role and manager, search, and a "Currently out" strip. **Add member** asks for name, email, title, mobile, sign-in method, Team (role), Reports to and 16 permission toggles, and shows a preview of the menus they'll see. It checks the seat limit and whether the person is being made an owner. A mobile number gives a 7-day invite link.

**Findings**
- [ ] **P0: No way to remove or deactivate someone.** The backend already has `POST /users/{id}/deprovision`, which revokes access and reassigns their tasks, and `/uninvite`, but nothing in the app calls them. Before building on it, check what happens to decisions waiting on that person.
- [ ] **P1:** Changing someone's role keeps their old permission list instead of taking the new role's defaults (`Team.js:146`).
- [ ] **P1:** Name and email can't be edited.
- [ ] **P1:** People who sign in with a password get no invite or hand-off. "Get invite link" also shows for people who are already active.
- [ ] **P1:** The Reports to help text only mentions leave. It should say it also decides who approves their tasks and decisions and where their overdue work goes.
- [ ] **P1:** On the phone, the Team tile is hidden without Manage team, but the page is open to everyone.
- [ ] **P2:** Owner promote and demote use the browser's plain confirm box instead of the app's own dialog.
- [ ] **P2:** `/people` duplicates Team, uses the old design and has no menu link. Remove it.

## 4. Roles and permissions

- [ ] **P0: Role permissions can't be managed.**
  - There's no screen to set a role's permissions (the API exists: `PATCH /tenant/roles/{key}/permissions`).
  - Add member always saves a personal list, which permanently overrides the role (`Team.js:123,175`, `permissions.py:58-61`) ✔.
  - Result: changing a role never reaches anyone added through the app.
  - Fix: a per-role permission editor, and people follow their role unless you deliberately override it.
- [ ] **P0: Manage team can give itself any permission** ✔: its own list (`team.py:361,386`), temporary grants (`access.py:137`) and role permissions. In practice it's close to owner. Stop self-changes, or make those owner-only.
- [ ] **P1:** An empty list means "use the role defaults", so a person can't be given no access at all.
- [ ] **P1:** Contacts, CRM and complaints check the role *name* (owner or sales) instead of a permission (`contacts.py:45,70,137`, `complaints.py:31,59`, `crm.py:114`). A custom role with People access gets refused, even though the buttons show.
- [ ] **P2:**
  - One idea has four names: Team Roles / Team / department / departments.
  - The "Inbox" permission is the Decision Desk.
  - "Approve tasks" also approves WhatsApp captures.
  - Brain export has no toggle.
  - Finance and ledger can't be separated.

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
- [ ] **P0: Anyone can attach proof to any task** ✔, even tasks they can't open. There's no access check (`tasks.py:1333`).
- [ ] **P0: The checklist can close someone else's task without proof.** Anyone in the same role can save a checklist, which marks the task done at 100%. That skips the "who may finish" rule and the proof rule (`tasks.py:1032-1067`, `services/tasks.py:206`).
- [x] **Approval with nobody picked** (fixed 2026-09-15): the creator's manager if they can approve, else the owner.
- [ ] **P1:** Creators and doers with "Approve tasks" can approve their own task. Completing a "sign-off before done" task approves it at once when the doer can approve.
- [ ] **P1:** The New Task Approver list, and anyone notified about unnamed approvals, only look at personal permission lists, not role permissions (`Tasks.js:127`, `notifications.py:23`) ✔. Less important now that every task names an approver.
- [ ] **P2:**
  - `/tasks/{id}/reassign` is unused and has its own conflicting rule.
  - Hand-off skips the assign rules.
  - The AI-priority toggle shows for everyone but works only with Manage team.

## 6. Decision access (Decision Desk)

- **Who decides:** owner, the named approver, or anyone with Approve decisions. Routing: the person who raised it if they can decide, else their manager, else the owner.
- [ ] **P0: Approving a WhatsApp capture approves its decision** with only "Approve tasks". The named decider and Approve decisions are skipped (`captures.py:148` → `services/captures.py:270`) ✔.
- [ ] **P1:** The decisions list returns every decision's title to anyone, even decisions they can't open (`decisions.py:58`).
- [ ] **P1:** Adding a task to a decision skips the participant check and the assign rules (`decisions.py:120`).
- [ ] **P1:** Deciders are looked up from old user records: temporary grants and owner exclusions are ignored, so routing and the approve check can disagree.
- [ ] **P2:**
  - "Approve on my behalf while I'm away" (delegation) is stored but never used.
  - Helpers on a task aren't counted as decision participants.
  - `/transcribe` has no permission check.

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

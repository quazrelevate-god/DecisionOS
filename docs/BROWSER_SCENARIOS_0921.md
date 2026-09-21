# Browser scenarios — clicked by hand in the preview (2026-09-21)

Yokesh: *"test it in a browser itself… different users, log in, log out, log in,
log out and do things… create a complete step by step scenario and do it."*

Driven by clicking in the app's browser preview (not a script), against a
throwaway database (codes appear on screen — dev mode). One company, three
people, one cookie jar: every change of person is a real **log out → log in**.

**Company:** Nila Garments (garment maker, Tiruppur) · **People:**
Kavya (owner) · Priya (sales) · Anand (can approve)

| # | Who | Step | Expect | Result |
|---|---|---|---|---|
| 1 | Kavya | Sign up: mobile + code, name, company, email, team size, industry, **type** the COO interview, build, enter | Lands on the Desk of her new company | ✅ Wizard, code auto-filled, 5 interview answers TYPED, 4 departments + 8 routines built. **Bug fixed on the way:** reaching /signup from the Register link drew a blank page |
| 2 | Kavya | Team → Add member: Priya (sales) · Anand (approvals on) | Each gets an invite link | ✅ Both invited; links issued. Accounts dept's default access lacks Finance (noted) |
| 3 | Kavya | Workflows → New workflow | Card arrives **with its first stage's work** | ✅ Card arrived with 2 Inquiry tasks, "0 of 2 done". **Bug fixed:** card said `sales_&_order_management` instead of the department name |
| 4 | Kavya | Open the card | Every stage, its work, why it can't move | ✅ Every stage, work, "Held here: 2 task(s) still open" |
| 5 | Kavya | On the card: add a task to the stage for Priya, **starting after** another task | Task on the card; it starts blocked | ✅ On the card, Priya's, Blocked · Waits for earlier work; gate went to 3 |
| 6 | Kavya | On the card: correct the amount | Amount changes; history kept | ✅ ₹1,250,000 → ₹1,310,000 (Western digit grouping on the card — noted) |
| 7 | Kavya | My Work → New Task, **repeats every week**, for Priya | Task shows "Every week" | ✅ "Every week" pill |
| 8 | Kavya | My Work → New Task for Priya, **approval before start** by Anand | Task locked, waiting on Anand | ✅ "Approval to start" |
| 9 | Kavya | Desk → type a decision → Review → Approve | Workflow + tasks created, to real people | ✅ Recognised the existing card (no duplicate), made a Buyer Payments workflow + 3 tasks. **Bug fixed:** decision review showed `production_&_quality`. **Design gap:** the jump left 5 tasks open on Inquiry/Sampling and spawned Sampling work only to skip it |
| 10 | Kavya | **Log out** | Back at sign-in | ✅ (Sign out is 4 taps deep on a phone — noted) |
| 11 | Priya | Open her invite link → code → welcome | Signed in as Priya | ✅ "Welcome, Priya Nair — invited to Nila Garments", welcome card saved |
| 12 | Priya | My Work | Her tasks; the locked one says it waits for approval; the dependent one waits for earlier work | ✅ Locked / waiting / weekly all labelled. **Bug fixed:** a decision's "today" task was Overdue on arrival (stored as the instant Dex read it) |
| 13 | Priya | Complete the weekly task | Next week's appears by itself | ✅ Done → next week's appeared by itself (5 Oct, same series) |
| 14 | Priya | Complete the task the dependent waits on | The dependent opens by itself | ✅ Dependent opened itself: "Unblocked by 'Send initial pricing…'" |
| 15 | Priya | Try to move a due date | Refused — only the asker/manager/owner moves it | ✅ Priya gets no date control at all |
| 16 | Priya | **Log out** | | ✅ |
| 17 | Anand | Invite link → sign in → Desk | The approval waits on **his** Desk | ✅ On Anand's Desk: Approvals 1; he also sees his team's queued invoice work |
| 18 | Anand | Approve it | Approved | ✅ "Task approved" · "Nothing waiting for your sign-off" |
| 19 | Anand | **Log out** | | ✅ |
| 20 | Priya | **Log in by mobile** (not the link) | Signed in | ✅ Mobile code only, no link |
| 21 | Priya | Open the once-locked task → start it | Now allowed | ✅ "Status: Doing" |
| 22 | Priya | **Log out** | | ✅ |
| 23 | Kavya | **Log in by mobile** | Signed in to Nila Garments | ✅ Owner, by mobile |
| 24 | Kavya | Workflows board | Summary strip + "N of M done" on the card | ✅ "1 running · nothing is waiting · 1 moved today", card at Order Confirmed with its people |
| 25 | Kavya | Open the card → move a task's due date | Moved, and on the task's timeline | ✅ "Due Wed, 23 Sept"; timeline "Due date moved from … to …" |
| 26 | Kavya | Settings → Operations | No "stages have no work" banner (new company) | ✅ No banner; 34 stage templates |


## Found while clicking, beyond the steps

| | Status |
|---|---|
| /signup opened from the Register link drew **nothing** (dev double-mount cancelled the only start-up run) | **Fixed** (Signup.js) |
| Department KEYS on screen (`sales_&_order_management`) on the card and the decision review | **Fixed** (lib/departments.js) |
| "In N days" stored as an instant, so a task due today is overdue the moment it is made — 7 code paths | **Fixed** (shared/due.py) |
| Short screens (a phone held sideways): the Desk's Dex panel collapses to 0px and its buttons sit on the tabs — taps hit the tabs | Backlog — a careful phone-layout change |
| The phone Desk's typing box closes itself 2.5 s after opening if nothing is typed yet | Backlog |
| A decision that jumps a card several stages leaves those stages' work open, and creates work for stages it only passes through | **Decision needed** |
| Sign-in opens on Email & Password although founders now have no password | Backlog |
| Sign out is four taps deep on a phone (More → Settings → Account → scroll) | Backlog |
| The build screen promises the 8 routines ("makes sure Selvam's machines never miss their weekly service") — they are not live tasks | Backlog |
| An "Accounts & Buyer Payments" department's default access has no Finance | Backlog |
| Workflow card shows ₹1,250,000; the decision shows ₹12,50,000 | Backlog |
| New Task labels the task category "Department" | Backlog |
| Copy: "Nila Garments's OS" · "Every week … every 1 week" · approver list shows "You" and "Kavya Raman" · My Work empty state says tasks only come from decisions · "Spawned by workflow … entering stage" | Backlog |

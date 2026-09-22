# JOURNEY-1: every finding, and where it stands

*22 September 2026 · branch `karma-redesign` · the story behind these is in
[REPORT.md](REPORT.md)*

The testers filed **94** findings. This is all 94, sorted by what happens next.
Merged duplicates are shown on one line with both ids.

| Where it stands | Findings |
|---|---|
| **1 · Fixed and committed** | **21**, in 16 commits |
| **2 · Still to fix** | **1** (a bug we could not fix blind) |
| **3 · Waiting on your decision** | **23** (works as built; may be the wrong design) |
| **4 · Polish, listed and not fixed** | **30** |
| **5 · Already in the bug report** | **9** |
| **6 · Dropped** (test artifacts, retracted, duplicates) | **10** |
| | **94** |

The testers filed these as 14 P0, 42 P1 and 38 P2. After merging duplicates and
re-checking each serious one, they stand at **3 P0 · 15 P1 bugs · 20 decisions
· 30 polish** (a finding that turned out to be someone else's or a test's fault
is in section 6). Where a severity came down, the line says why.

---

## 1 · Fixed and committed (21 findings · 16 commits)

Nothing is deployed. The four `backend:` commits carry `with_test_db` tests
and are for Yokesh to review.

| Finding(s) | Sev | What was wrong | Commit |
|---|---|---|---|
| **J8-02**, **J8p-02** | P0 | No screen anywhere could log a complaint against a buyer — desktop or phone | `0c9d07c` |
| **J8-03** | P0 | A buyer could not be edited after being added, not even moved off "Lead" | `0c9d07c` |
| **J3-04**, **J7-05** | P0 | The Desk's "To collect (overdue)" (₹6.8L) and the Finance page it opens (₹4L) used different rules | `49d37d1` (backend, the one rule) + `2e93525` (the page shows it) |
| **J1-08** | P1 | A decision's timeline named a team by its internal key, `order_intake_&_customer_coordination` | `040183a` (backend) |
| **J10-01** | P1 | A production worker's Desk briefing told him to chase the company's receivables, in dollars | `d2b4495` (backend) |
| **J12-08** | P1 *(filed P0)* | A removed person could still sign in, and landed on a Desk that never loaded. Re-checked: every request was refused, so nothing leaked — it looked broken rather than decided | `6b2b0e3` (backend) |
| **J2-09** | P1 | The Operating Score page showed notes written for programmers ("not wired", "lands with the backend", "no denominator") | `c0e690d` |
| **J6-01** | P1 | My Work's "All statuses" left out finished work, for the worker and for the owner | `19cff89` |
| **J12-02**, **J12-03** | P1 | A task reassigned or deleted while being typed on: a bare refusal, or no message at all, and the drawer stayed stale | `f0a24e7` |
| **J7-06** | P1 *(filed P0)* | "Net profit" (30 days) and the brief's "Estimated profit" (all time) disagreed 6× on one screen, and the second didn't say it was all-time | `b048d3e` |
| **J2-05** | P1 | The AI Finance brief said "books appear completely empty" beside a real loss, into the next day | `b048d3e` |
| **J8-05** | P1 | The New workflow buyer list came up silently empty for someone without CRM access | `b118346` |
| **J12-04**, **J12-06** | P1 *(J12-04 filed P0)* | Signing out on a shared phone left the person's unsent typing and their filters on the device. Priya could not see them on screen — they are stored under his id — but they were there | `b69af4e` |
| **J13a-01** | P1 | On a slow line the phone Desk showed the saved copy's numbers as if they were live | `a78e92f` |
| **J13a-02** | P1 | The on-screen keyboard pushed the task-update field off screen | `1b7e31a` |
| **J13a-03** | P1 | A new version never told anyone it had arrived | `90b59cd` |
| **J13b-05** | P1 | At 150% text a money figure was cut mid-digit ("₹22,85,0…") | `6874a0f` |

Each was re-walked on a fresh copy of the company with a new production
build; the checks and their results are in REPORT.md under *Fixes*.

---

## 2 · Still to fix (1)

| Finding | Sev | What is wrong | Why it is not fixed |
|---|---|---|---|
| **J5-01** | P1 bug | A decision with a PDF bill attached takes **5 min 46 s** to build. The Desk stops waiting after ~90 s and says it will appear in Decisions later | The server log shows 1 min 41 s inside the Gemini document-OCR call alone, then several model steps. That is model latency in the capture pipeline, not a screen bug, and fixing it blind would be guesswork. For Yokesh, with the evidence in REPORT.md |

---

## 3 · Waiting on your decision (23 findings · 20 decisions)

Each works as built. The recommendation for every one is in REPORT.md under
*For you to decide*.

| Finding(s) | Sev | The question |
|---|---|---|
| **J7-04**, **J8-01**, **J8p-01** *(all filed P0)* | P1 judgment | CRM is closed to Sales and Finance by default (your change of 13 Aug, FIX-FUP-51), so Priya can't add a buyer and Sunita can't add a supplier |
| **J3-01** | P1 judgment | Non-owners cannot talk to Dex until an owner turns capture on |
| **J1-01** | P1 judgment | The phone opens on "Sign in"; an unknown number is refused with no way to sign up |
| **J2-08**, **J1-12**, **J10-03** | P1 judgment | The Desk's score dial has no name, doesn't open, and on the phone non-owners can't reach the page that explains it |
| **J12-09** *(filed P0)* | P1 judgment | A seat counts only once a person signs in, so invites are unlimited ("0 of 15 seats" with 23 invited). The code does this on purpose, so an invited person is never locked out |
| **J7-02** | P1 judgment | No way to record a part payment against an open invoice |
| *(lead)* | P1 judgment | The high-value approval threshold applies only to WhatsApp captures: a ₹6,00,000 expense entered by hand went through with no approval |
| **J2-06** | P1 judgment | Buying stock shows as a loss on a wholesaler's first day |
| **J1-10** | P1 judgment | One ₹85,000 bill on day one sets off three red "Urgent" AI alarms |
| **J11-01** | P1 judgment | "Allowed to approve" is three look-alike checkboxes; only one routes decisions |
| **J11-04** | P1 judgment | Rejecting a decision offers no way to say why |
| **J9-03** | P1 judgment | Hindi and Tamil translate the nav and titles; the controls stay English |
| **J2-12** | P1 judgment | Settings says the founder agreed to send their words to AI providers; no sign-up screen asked |
| **J2-04** | P1 judgment | A supplier typed on an expense never becomes a supplier, and the supplier's page counts bills only |
| **J8-09** | P1 judgment | The Operating Score lags the Desk by up to 90 s after a change (a server cache). Already raised in PILOT-1 D |
| **J1-05** | P1 judgment | An "Accounts & GST" team built by the AI at sign-up gets no Finance access |
| **J13b-02** | P1 judgment | A cold sign-in on a slow Android takes ~22 s with nothing shown while it waits |
| **J13b-04**, **J13b-06** *(filed P1 bugs)* | P1 judgment | At 150% text the phone Desk's greeting is cut to "Good …", "Show all" prints over a row, and More's labels are cut. The Desk is built to be exactly one screen (your ASK-42/43/46/47), so something has to give — which is a design choice |
| **J11-02** | recorded | Leave doesn't move a manager's waiting decisions or escalations — the open question with Yokesh (ASK-5) |

---

## 4 · Polish, listed and not fixed (30)

| Finding(s) | What |
|---|---|
| **J1-02**, **J2-01**, **J7-03**, **J8-06**, **J8-11** | Five OS-drawn dropdowns, against the standing rule: sign-up Industry, Settings currency, leave type, CRM activity kind, contact Call/Meeting/Note |
| **J1-03**, **J2-02** | Sign-up speaks software: "workspace", "B2B/D2C", "OS", "Multi-tenant", an unexplained "Dex" |
| **J1-04**, **J2-03** | A second confirm screen after "Enter DecisionOS", with competing buttons and numbers that disagree |
| **J2-11** | Settings shows team slugs, raw keys and a long WhatsApp code |
| **J1-09** | A decision preview leaves "[current period]" in |
| **J1-06** | The invite sheet mentions an "SMS provider" |
| **J1-07** | A task made for someone else shows only under "Asked by me" |
| **J1-13** | The empty "Type instead" box on the Desk closes itself after ~2 s (also on Yokesh's backlog) |
| **J9-02** *(filed P0)* | Back in the middle of New Task gives no warning. Re-checked: the typing **is** kept and comes back when the form reopens, on desktop and phone — so it is wording, not loss |
| **J4-03** | The Dex well keeps an unsent decision but doesn't say so |
| **J8-07** | A leave outcome needs a reload to appear |
| **J12-01** | The hand-off picker offers people it will always refuse (the refusal itself is clear) |
| **J1-11** | An approved purchase leaves no trace in Money |
| **J7-07** | The same bill is booked as an Expense by one route and an Asset by the other |
| **J2-07** | Suppliers live under "CRM" and start as "Lead"; ISO dates on the page |
| **J3-03** | Decision and approval row titles cut off mid-word |
| **J2-14** | The bell says "3 need you" while the Desk shows nothing waiting |
| **J10-04** | The Desk's top row is company-wide for every role |
| **J2-10** | The business words (vocabulary) are buried in Settings and don't reach every screen |
| **J5-02** | "Next Wednesday", said on a Tuesday, was read as the week after |
| **J2-13** | Next-day sign-in opens on Email & Password for someone who has no password |
| **J12-05** | Sign-out doesn't purge the phone's saved screen data (the service worker does it when the logout request passes through) |
| **J12-07** | Nobody tells the person who inherits a removed colleague's task |
| **J13b-07** | The New Task sheet's only close button is 35 px, under the 44 px floor |

---

## 5 · Already in the bug report — not re-filed (9)

| Finding(s) | Known as |
|---|---|
| **J9-01**, **J10-02** | FN-07 — Finance is in the nav for people whose ledger calls are refused |
| **J9p-01**, **J9p-02**, **J9p-03** | GL-02 — the phone More panel has no way into Ops for non-owners |
| **J9-04** | DD-03 — a receivables figure on a Sales person's Desk |
| **J8-04** | CR-13 — the Desk's Complaints tile links to CRM, which Sales can't open |
| **J8-08** | ASK-5 — nobody is told who covers someone on leave |
| **J5p-01** | DX-01 — the phone dock's Ask can't find receivables that exist |

---

## 6 · Dropped (10)

| Finding | Why |
|---|---|
| **J3p-01** | The decision popup "overlapping" the Desk was a screenshot 100 ms into its fade-in; clean at 300 ms |
| **J11-05** | The phone bell is a link, not a button — both scripts looked for the wrong control; it works |
| **J4-01**, **J4-02** | Phone sign-in failing was seed data (the demo people had no normalised number); fixed in the test setup, and worth fixing in `bootstrap/seed.py` |
| **J6-02** | A duplicate task came from the demo seeder being run twice |
| **J11-03** | Retracted by its own tester after a clean re-check (J8-10 was retracted the same way, before it reached the list) |
| **J7-01** | A duplicate of J7-04 |
| **J13b-01** | WebKit couldn't sign in over this setup's plain http; production is HTTPS |
| **J13b-03** | Trend chips under the dock only when resting at the top; scrolling brings them clear |
| **J3-02** | A measurement (a decision reached the owner's Desk in ~25 s without a reload), not a fault |

---

## What this adds up to

- Every confirmed **P0 is fixed** (3 of 3).
- **14 of the 15 confirmed P1 bugs are fixed**; the one left is the PDF decision's six minutes, which needs Yokesh.
- The **20 decisions** are the real backlog: most of what a customer hits first
  is a choice we made, not a defect — CRM closed to Sales and Finance, Dex off
  for everyone but the owner, the phone opening on "Sign in", and the score
  dial nobody can open.

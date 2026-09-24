# JOURNEY-1: every finding, and where it stands

*22 September 2026 · branch `karma-redesign` · the story behind these is in
[REPORT.md](REPORT.md)*

The testers filed **94** findings. This is all 94, sorted by what happens next.
Merged duplicates are shown on one line with both ids.

**Every row carries a number in the first column, 1–76, running straight
through the document.** They are unique across all six sections, so a reply of
"7 fix, 8 skip" is unambiguous — no section prefix needed.

**The *Call* column is the founder's answer, given 24 September**, on rows
19–67 (1–18 were already fixed, 68–76 were dropped):

| Call | Means | Count |
|---|---|---|
| **FIXED** | Fix it — **all of them are done**, commit on the row | 36 |
| **ANSWERED** | Explained; nothing to change (44, 55) | 2 |
| **HOLD** | Understood; not now | 7 |
| **IGNORE** | Not a problem; leave it | 3 |

**The eleven EXPLAIN rows were answered on 25 September**, and the founder's
calls on them are folded in above: **19, 26, 37, 39, 64 and 65 are now fixed**
too; **44 and 55 needed no change** (see below); **28 and 56 are on hold**;
and 62–63's neighbours are unchanged.

- **44** — a task made for Priya DOES reach her My Tasks; only the creator's
  own view needed explaining, and the filing was right.
- **55** — the Desk's top row stays company-wide. The founder's call: the
  Decision Desk is for the people who make decisions, and a per-person Desk
  is a phase-two change. Recorded here so it is not lost.
- **56** — the business vocabulary: held until everything else is pushed.
- **28** — the three approve checkboxes: held.

**All 30 of the first round are fixed, in six commits** (24 September): `45dd4a7` the polish,
`4b49148` the way in and who sees what, `986522c` consent and kept words,
`6f8f950` seats, the stale score, a team's first day and next Wednesday,
`b229776` the money and who is told about it. Each row carries its own. The
backend changes come with 50 new tests; the suites nearest them (brain
retrieval, deprovisioning, finance permissions and parties, finance math,
plans, seats, concurrency) were re-run and pass.

| Where it stands | Rows | Findings |
|---|---|---|
| **1 · Fixed and committed** | 1–17 | **21**, in 16 commits |
| **2 · Still to fix** | 18 | **1** (a bug we could not fix blind) |
| **3 · Waiting on your decision** | 19–37 | **23** (works as built; may be the wrong design) |
| **4 · Polish, listed and not fixed** | 38–61 | **30** |
| **5 · Already in the bug report** | 62–67 | **9** |
| **6 · Dropped** (test artifacts, retracted, duplicates) | 68–76 | **10** |
| | 76 rows | **94** |

The testers filed these as 14 P0, 42 P1 and 38 P2. After merging duplicates and
re-checking each serious one, they stand at **3 P0 · 15 P1 bugs · 20 decisions
· 30 polish** (a finding that turned out to be someone else's or a test's fault
is in section 6). Where a severity came down, the line says why.

---

## 1 · Fixed and committed (21 findings · 16 commits)

Nothing is deployed. The four `backend:` commits carry `with_test_db` tests
and are for Yokesh to review.

| # | Call | Finding(s) | Sev | What was wrong | Commit |
|---|---|---|---|---|---|
| **1** | — | **J8-02**, **J8p-02** | P0 | No screen anywhere could log a complaint against a buyer — desktop or phone | `0c9d07c` |
| **2** | — | **J8-03** | P0 | A buyer could not be edited after being added, not even moved off "Lead" | `0c9d07c` |
| **3** | — | **J3-04**, **J7-05** | P0 | The Desk's "To collect (overdue)" (₹6.8L) and the Finance page it opens (₹4L) used different rules | `49d37d1` (backend, the one rule) + `2e93525` (the page shows it) |
| **4** | — | **J1-08** | P1 | A decision's timeline named a team by its internal key, `order_intake_&_customer_coordination` | `040183a` (backend) |
| **5** | — | **J10-01** | P1 | A production worker's Desk briefing told him to chase the company's receivables, in dollars | `d2b4495` (backend) |
| **6** | — | **J12-08** | P1 *(filed P0)* | A removed person could still sign in, and landed on a Desk that never loaded. Re-checked: every request was refused, so nothing leaked — it looked broken rather than decided | `6b2b0e3` (backend) |
| **7** | — | **J2-09** | P1 | The Operating Score page showed notes written for programmers ("not wired", "lands with the backend", "no denominator") | `c0e690d` |
| **8** | — | **J6-01** | P1 | My Work's "All statuses" left out finished work, for the worker and for the owner | `19cff89` |
| **9** | — | **J12-02**, **J12-03** | P1 | A task reassigned or deleted while being typed on: a bare refusal, or no message at all, and the drawer stayed stale | `f0a24e7` |
| **10** | — | **J7-06** | P1 *(filed P0)* | "Net profit" (30 days) and the brief's "Estimated profit" (all time) disagreed 6× on one screen, and the second didn't say it was all-time | `b048d3e` |
| **11** | — | **J2-05** | P1 | The AI Finance brief said "books appear completely empty" beside a real loss, into the next day | `b048d3e` |
| **12** | — | **J8-05** | P1 | The New workflow buyer list came up silently empty for someone without CRM access | `b118346` |
| **13** | — | **J12-04**, **J12-06** | P1 *(J12-04 filed P0)* | Signing out on a shared phone left the person's unsent typing and their filters on the device. Priya could not see them on screen — they are stored under his id — but they were there | `b69af4e` |
| **14** | — | **J13a-01** | P1 | On a slow line the phone Desk showed the saved copy's numbers as if they were live | `a78e92f` |
| **15** | — | **J13a-02** | P1 | The on-screen keyboard pushed the task-update field off screen | `1b7e31a` |
| **16** | — | **J13a-03** | P1 | A new version never told anyone it had arrived | `90b59cd` |
| **17** | — | **J13b-05** | P1 | At 150% text a money figure was cut mid-digit ("₹22,85,0…") | `6874a0f` |

Each was re-walked on a fresh copy of the company with a new production
build; the checks and their results are in REPORT.md under *Fixes*.

---

## 2 · Still to fix (1)

| # | Call | Finding | Sev | What is wrong | Why it is not fixed |
|---|---|---|---|---|---|
| **18** | — | **J5-01** | P1 bug | A decision with a PDF bill attached takes **5 min 46 s** to build. The Desk stops waiting after ~90 s and says it will appear in Decisions later | The server log shows 1 min 41 s inside the Gemini document-OCR call alone, then several model steps. That is model latency in the capture pipeline, not a screen bug, and fixing it blind would be guesswork. For Yokesh, with the evidence in REPORT.md |

---

## 3 · Waiting on your decision (23 findings · 20 decisions)

Each works as built. The recommendation for every one is in REPORT.md under
*For you to decide*.

| # | Call | Finding(s) | Sev | The question |
|---|---|---|---|---|
| **19** | FIXED (25 Sep) | **J7-04**, **J8-01**, **J8p-01** *(all filed P0)* | P1 judgment | CRM is closed to Sales and Finance by default (your change of 13 Aug, FIX-FUP-51), so Priya can't add a buyer and Sunita can't add a supplier |
| **20** | IGNORE | **J3-01** | P1 judgment | Non-owners cannot talk to Dex until an owner turns capture on |
| **21** | FIXED `45dd4a7` | **J1-01** | P1 judgment | The phone opens on "Sign in"; an unknown number is refused with no way to sign up |
| **22** | FIXED `4b49148` | **J2-08**, **J1-12**, **J10-03** | P1 judgment | The Desk's score dial has no name, doesn't open, and on the phone non-owners can't reach the page that explains it |
| **23** | FIXED `6f8f950` | **J12-09** *(filed P0)* | P1 judgment | A seat counts only once a person signs in, so invites are unlimited ("0 of 15 seats" with 23 invited). The code does this on purpose, so an invited person is never locked out |
| **24** | HOLD | **J7-02** | P1 judgment | No way to record a part payment against an open invoice |
| **25** | FIXED `b229776` | *(lead)* | P1 judgment | The high-value approval threshold applies only to WhatsApp captures: a ₹6,00,000 expense entered by hand went through with no approval |
| **26** | FIXED (25 Sep) | **J2-06** | P1 judgment | Buying stock shows as a loss on a wholesaler's first day |
| **27** | EXPLAIN | **J1-10** | P1 judgment | One ₹85,000 bill on day one sets off three red "Urgent" AI alarms |
| **28** | HOLD | **J11-01** | P1 judgment | "Allowed to approve" is three look-alike checkboxes; only one routes decisions |
| **29** | HOLD | **J11-04** | P1 judgment | Rejecting a decision offers no way to say why |
| **30** | HOLD | **J9-03** | P1 judgment | Hindi and Tamil translate the nav and titles; the controls stay English |
| **31** | FIXED `986522c` | **J2-12** | P1 judgment | Settings says the founder agreed to send their words to AI providers; no sign-up screen asked |
| **32** | FIXED `b229776` | **J2-04** | P1 judgment | A supplier typed on an expense never becomes a supplier, and the supplier's page counts bills only |
| **33** | FIXED `6f8f950` | **J8-09** | P1 judgment | The Operating Score lags the Desk by up to 90 s after a change (a server cache). Already raised in PILOT-1 D |
| **34** | FIXED `6f8f950` | **J1-05** | P1 judgment | An "Accounts & GST" team built by the AI at sign-up gets no Finance access |
| **35** | HOLD | **J13b-02** | P1 judgment | A cold sign-in on a slow Android takes ~22 s with nothing shown while it waits |
| **36** | IGNORE | **J13b-04**, **J13b-06** *(filed P1 bugs)* | P1 judgment | At 150% text the phone Desk's greeting is cut to "Good …", "Show all" prints over a row, and More's labels are cut. The Desk is built to be exactly one screen (your ASK-42/43/46/47), so something has to give — which is a design choice |
| **37** | FIXED (25 Sep) | **J11-02** | recorded | Leave doesn't move a manager's waiting decisions or escalations — the open question with Yokesh (ASK-5) |

---

## 4 · Polish, listed and not fixed (30)

| # | Call | Finding(s) | What |
|---|---|---|---|
| **38** | FIXED `45dd4a7` | **J1-02**, **J2-01**, **J7-03**, **J8-06**, **J8-11** | Five OS-drawn dropdowns, against the standing rule: sign-up Industry, Settings currency, leave type, CRM activity kind, contact Call/Meeting/Note |
| **39** | FIXED (25 Sep) | **J1-03**, **J2-02** | Sign-up speaks software: "workspace", "B2B/D2C", "OS", "Multi-tenant", an unexplained "Dex" |
| **40** | FIXED `4b49148` | **J1-04**, **J2-03** | A second confirm screen after "Enter DecisionOS", with competing buttons and numbers that disagree |
| **41** | HOLD | **J2-11** | Settings shows team slugs, raw keys and a long WhatsApp code |
| **42** | FIXED `45dd4a7` | **J1-09** | A decision preview leaves "[current period]" in |
| **43** | FIXED `45dd4a7` | **J1-06** | The invite sheet mentions an "SMS provider" |
| **44** | ANSWERED | **J1-07** | A task made for someone else shows only under "Asked by me" |
| **45** | FIXED `45dd4a7` | **J1-13** | The empty "Type instead" box on the Desk closes itself after ~2 s (also on Yokesh's backlog) |
| **46** | FIXED `45dd4a7` | **J9-02** *(filed P0)* | Back in the middle of New Task gives no warning. Re-checked: the typing **is** kept and comes back when the form reopens, on desktop and phone — so it is wording, not loss |
| **47** | FIXED `986522c` | **J4-03** | The Dex well keeps an unsent decision but doesn't say so |
| **48** | FIXED `986522c` | **J8-07** | A leave outcome needs a reload to appear |
| **49** | FIXED `986522c` | **J12-01** | The hand-off picker offers people it will always refuse (the refusal itself is clear) |
| **50** | FIXED `b229776` | **J1-11** | An approved purchase leaves no trace in Money |
| **51** | FIXED `b229776` | **J7-07** | The same bill is booked as an Expense by one route and an Asset by the other |
| **52** | FIXED `986522c` | **J2-07** | Suppliers live under "CRM" and start as "Lead"; ISO dates on the page |
| **53** | FIXED `45dd4a7` | **J3-03** | Decision and approval row titles cut off mid-word |
| **54** | FIXED `4b49148` | **J2-14** | The bell says "3 need you" while the Desk shows nothing waiting |
| **55** | ANSWERED | **J10-04** | The Desk's top row is company-wide for every role |
| **56** | HOLD | **J2-10** | The business words (vocabulary) are buried in Settings and don't reach every screen |
| **57** | FIXED `6f8f950` | **J5-02** | "Next Wednesday", said on a Tuesday, was read as the week after |
| **58** | FIXED `4b49148` | **J2-13** | Next-day sign-in opens on Email & Password for someone who has no password |
| **59** | FIXED `986522c` | **J12-05** | Sign-out doesn't purge the phone's saved screen data (the service worker does it when the logout request passes through) |
| **60** | FIXED `b229776` | **J12-07** | Nobody tells the person who inherits a removed colleague's task |
| **61** | FIXED `45dd4a7` | **J13b-07** | The New Task sheet's only close button is 35 px, under the 44 px floor |

---

## 5 · Already in the bug report — not re-filed (9)

| # | Call | Finding(s) | Known as |
|---|---|---|---|
| **62** | FIXED `4b49148` | **J9-01**, **J10-02** | FN-07 — Finance is in the nav for people whose ledger calls are refused |
| **63** | FIXED `4b49148` | **J9p-01**, **J9p-02**, **J9p-03** | GL-02 — the phone More panel has no way into Ops for non-owners |
| **64** | FIXED (25 Sep) | **J9-04** | DD-03 — a receivables figure on a Sales person's Desk |
| **65** | FIXED (25 Sep) | **J8-04** | CR-13 — the Desk's Complaints tile links to CRM, which Sales can't open |
| **66** | IGNORE | **J8-08** | ASK-5 — nobody is told who covers someone on leave |
| **67** | FIXED `b229776` | **J5p-01** | DX-01 — the phone dock's Ask can't find receivables that exist |

---

## 6 · Dropped (10)

| # | Call | Finding | Why |
|---|---|---|---|
| **68** | — | **J3p-01** | The decision popup "overlapping" the Desk was a screenshot 100 ms into its fade-in; clean at 300 ms |
| **69** | — | **J11-05** | The phone bell is a link, not a button — both scripts looked for the wrong control; it works |
| **70** | — | **J4-01**, **J4-02** | Phone sign-in failing was seed data (the demo people had no normalised number); fixed in the test setup, and worth fixing in `bootstrap/seed.py` |
| **71** | — | **J6-02** | A duplicate task came from the demo seeder being run twice |
| **72** | — | **J11-03** | Retracted by its own tester after a clean re-check (J8-10 was retracted the same way, before it reached the list) |
| **73** | — | **J7-01** | A duplicate of J7-04 |
| **74** | — | **J13b-01** | WebKit couldn't sign in over this setup's plain http; production is HTTPS |
| **75** | — | **J13b-03** | Trend chips under the dock only when resting at the top; scrolling brings them clear |
| **76** | — | **J3-02** | A measurement (a decision reached the owner's Desk in ~25 s without a reload), not a fault |

---

## What this adds up to

- Every confirmed **P0 is fixed** (3 of 3).
- **14 of the 15 confirmed P1 bugs are fixed**; the one left is the PDF decision's six minutes, which needs Yokesh.
- The **20 decisions** are the real backlog: most of what a customer hits first
  is a choice we made, not a defect — CRM closed to Sales and Finance, Dex off
  for everyone but the owner, the phone opening on "Sign in", and the score
  dial nobody can open.

# DecisionOS — end-to-end product audit (2026-10-08)

Founder ask: walk the whole product in the browser, from sign-up through every
section, as every kind of person, with edge cases — **note everything, fix
nothing**.

## Ground rules

- **Database:** the existing test database `dos_engine_0921c` (the "old DB" all
  browser checks use). No new database is created.
- **Backend:** `win-backend-scratch` — SMS, email and WhatsApp keys are blank
  (dev one-time codes come back in the response), rate limits off. Nothing can
  reach a real person.
- **Test identities:** a new company, **Audit Textiles**, created through the
  real sign-up. Test phones are `+91 90000 1xxxx`; emails are `@example.test`.
- **Findings only.** Each one gets an ID, a severity, where it is, what happened
  and what should happen.

Severity: **P0** broken / data or trust risk · **P1** a real user gets stuck or
misled · **P2** friction or missing piece · **P3** polish.

## Plan

### A. Sign-up and onboarding (new company)
1. Landing / login: what a first-time visitor sees; the ways in (phone code,
   email + password, demo).
2. Sign-up, every step, the happy path: phone → code → company basics → website
   scan → interview → build → land on the Desk.
3. Edge cases:
   - Back button at every step; browser refresh mid-flow (is the draft kept?).
   - A wrong code; resending too soon; an invalid phone or email; an empty
     required field.
   - A phone or email that already exists; skipping optional steps.
   - The website scan with no website or a bad URL; leaving and coming back.
4. First landing: what an empty company sees on the Desk and every page.

### B. Owner — set the company up
5. Settings, every tab:
   - Business: profile, products, AI consent, vocabulary.
   - Team & access: create a **new team / section**, permissions, leave approvers.
   - Operations: pipelines, stages, templates, approval gates.
   - Money: threshold, currency, categories.
   - Account: language, profile, password, delegate.
   - Workspace: plan / seats, keys, audit log.

   For each: what is **missing** for a real SME.
6. Team: invite an **HR manager**, a **finance person** and a **sales person**;
   the org view; editing and removing a person.

### C. Owner — run the business (one scenario per section)
7. Scenario: *Audit Textiles takes an export order from a new buyer.*
   - **CRM:** add the buyer and a supplier; contact page; a complaint.
   - **Workflows:** the order card moves through stages.
   - **My Work:** tasks for the team (assign, due dates, statuses, plan, proof).
   - **Decisions:** tell Dex a decision; approve it; check the tasks it creates.
   - **Finance:** invoice, payment received, expense with a bill photo, asset,
     stock, CSV import, finance brief, Ask about finances.
   - **Dex / Company Brain:** ask questions; add a policy document and a note;
     Journal.
   - **Ops (operating score), Coach, Calendar, Notifications, Leave.**
8. Edge cases per section:
   - Empty input; very long text; double submit.
   - Delete / undo; back navigation; refresh.
   - Phone width for the main pages.

### D. Each role, signed in as that person
9. **HR manager:** team, leave approvals, what they can and cannot open.
10. **Finance person:** finance sections, approvals, what is hidden.
11. **Sales person:** CRM, their tasks, a leave request, Dex limits (no money).
12. Cross-checks:
    - A member opens an owner-only URL directly.
    - A member's view of someone else's task.
    - Switching between two companies.

### E. Write-up
13. All findings ranked, then "what we have to do" grouped by area.

## Findings

### A. Sign-in and sign-up

| ID | Sev | Where | What happened | What should happen |
|---|---|---|---|---|
| A-01 | P1 | Sign-up, resume after reload | Reloaded on step 02 ("And your name?", left empty). The page said "Welcome back — we kept your answers" and resumed at step 03 (company name), skipping the unanswered name step. Back showed the name still empty. | Resume at the first step with a missing answer, never past it. |
| A-02 | P2 | Sign-up, browser Back | The browser's Back button on a sign-up step leaves sign-up entirely (it went to /login); the steps are not in the browser history. | Back moves to the previous step (push each step into history), or the in-page Back is the only way and the browser Back confirms before leaving. |
| A-03 | P2 | Sign-in, mobile tab | An unregistered number gets "No account is registered with this mobile number". Anyone can test which numbers have accounts (account enumeration). The email tab correctly says "Invalid email or password" for both cases. | Same reply either way ("If this number has an account, we've sent a code"), with "Start a new company" offered. |
| A-04 | P2 | Sign-up, mobile | "Enter a 10-digit Indian mobile number" — only Indian numbers are accepted. | Country code picker, at least for Gulf, UK, US, Singapore (export SMEs work with them). |
| A-05 | P3 | Sign-in, email | `name@example.test` (a valid address shape) is refused as "That email address does not look right". Only reserved test domains hit this, but the message is wrong for a valid-looking address. | Low priority; message could say the domain can't receive mail. |
| A-06 | P3 | Sign-up / sign-in wording | "Incorrect OTP", "Send OTP", "Mobile OTP" while the same screens say "code". No count of attempts left after a wrong code. | "That code isn't right — 4 tries left." Use "code" everywhere. |
| A-07 | P3 | Login footer | "Workflow as an engine · Decision Desk · Dex" — internal names on the first screen a visitor sees. | A plain promise ("Your team's work and decisions in one place"). |
| A-08 | P3 | Sign-up code entry (to re-check on a phone) | Typing the six digits fast (automated typing) submitted a wrong code once; filling all six at once (SMS autofill) worked. Possibly an automation artefact. | Re-check by hand on Android/iPhone with a fast typist. |
| A-09 | Info | Sign-up, existing number | A number that already owns a company can start sign-up again (allowed: one person, many companies) — checked further below. | — |
| A-10 | P2 | Sign-up interview, reload | Reloaded at question 3 of the interview: it went back to the language picker and then restarted at question 1. Both typed answers were lost (the steps before it were kept). | Keep interview answers in the draft like every other step; resume at the next question. |
| A-11 | P2 | Sign-up, "Here's how Audit Textiles will run" | The review shows teams and recurring tasks only. The approval rules given in the interview (orders over ₹5 lakh, discounts over 5%, rework over ₹50,000, peak-season leave to the owner, HR manager approves leave) and the order pipeline are not shown, so the owner cannot check them before entering. | Show "Approvals" and "How an order moves" sections in the review, each editable. |
| A-12 | P3 | Sign-up review | After "Add a workflow" the counter said 9 recurring tasks but 8 were listed; "Monthly export invoice reconciliation" disappeared from the list. | Counter and list agree; say when an earlier item was replaced. |
| A-13 | P3 | Sign-up review | The six department chips are stacked one per line in a wide card. | Chips wrap across the card. |
| A-14 | P3 | Sign-up interview | A "Why we ask" line read "Reveals founder's real daily touchpoints and approval habit" — internal wording, about the person in the third person. | Address them: "So Dex knows what you check each week." |
| A-15 | P2 | Sign-up interview language | The interview offers 11 languages; the app itself is English, Hindi and Tamil only (checked in i18n). A founder who interviews in Bengali lands in an English app with no warning. | Say "the app is in English, Hindi or Tamil for now", or narrow the list, or carry the choice into the app language where it exists. |
| A-16 | P1 | After sign-up | No step invites the team, and the first screens (welcome card, Desk empty state) never mention it. A company of one gets little from the product. | A "Bring your team in" step at the end of sign-up and a Desk card until the first person is invited. |
| A-17 | P3 | Desk empty state | The example decision is "Tell Suresh to ship the indigo lot before Friday" — Suresh is not in this company. | Use one of the company's own department names, or a neutral example. |
| A-18 | Info | Website step | A bad address ("hello world") falls back gracefully to two manual questions; the server-side fetch has an SSRF guard (services/ssrf_guard.py). | — |
| A-19 | Info | Sign-up review | "Add a workflow" worked well: one typed sentence added the QC-agent inspection and the discount rule to the summary. The interview questions were specific and good. | — |
| A-20 | Info | After sign-up | What sign-up built is genuinely good: 4 pipelines (Order Fulfillment, Raw Material Procurement, Buyer Sampling, Workforce Management) with 3 concrete tasks per stage on the right team, tailored expense/asset categories, vocabulary (Buyer / Supplier) and the product filled in. | — |

### B. Settings (owner)

| ID | Sev | Where | What happened | What should happen |
|---|---|---|---|---|
| B-01 | P1 | Interview → setup | None of the interview's approval rules reached the setup. Sales confirming orders up to ₹5 lakh became "Order Confirmed: only the owner can advance" (the owner must confirm every order). Leave approver stayed "Owner (default)" for every team, though the HR manager was named. The high-value threshold is a generic ₹50,000 (₹1 lakh POs and ₹5 lakh orders were given). Rework over ₹50,000 and discounts over 5% went nowhere. "Peak-season leave approval" became a recurring task instead of a rule. | Interview answers about who approves what become approval settings, shown on the review screen (A-11) for the owner to confirm. |
| B-02 | P1 | Settings → Team, Business, Operations | Three different "department" lists with different names: Teams (Sales & Buyer Management, Production, Quality, Logistics & Shipping, Accounts, HR), Business vocabulary "task type / department labels" (Operations, Sales & Buyer, Procurement, Production, Accounts, HR) and Operations "task categories" (Buyer Coordination, Production, Quality Control, Logistics & Shipping, Finance & Accounts, Inventory & Materials, HR & Workforce). An owner cannot tell which one decides what. | One list of teams; categories, if kept, clearly named as task kinds and derived from it. |
| B-03 | P2 | Operations → stage approvals | An approval to leave a stage is yes/no per stage. There is no "only above ₹X" condition, so "sales confirms up to ₹5 lakh, owner above" cannot be set. | Value-based approval on a stage (amount on the card ≥ threshold → owner). |
| B-04 | P1 | Workspace → Plan and seats | "Trial · ends 22 Oct 2026 · 1 of 10 seats used" — no upgrade or payment, and nothing says what happens on the 22nd. The monthly AI allowance (300,000 trial tokens) is not shown anywhere; the owner learns it ran out when AI stops. | Upgrade (Razorpay), what the trial end means, and an AI-use meter with the reset date. |
| B-05 | P1 | Workspace → AI and WhatsApp keys | Offers the company's own Anthropic / Gemini / OpenAI / Sarvam / Voyage keys and a WhatsApp Business token. Per the AI audit (AB-02) the WhatsApp token is never used, and company AI keys are not used at runtime either. The card promises what does not happen. | Hide it until per-company keys/WhatsApp are real (AB-02 / AB-04). |
| B-06 | P2 | Business → Company details | Company mobile and email are empty though sign-up collected both; Region is empty though the interview said Tiruppur. | Pre-fill from sign-up. |
| B-07 | P2 | Business → "WhatsApp workspace code" | Shows the company's internal ID with "share this with your WhatsApp integrator… so messages from unknown numbers land in this workspace" — internal plumbing, tied to the WA_TENANT_ID routing (AB-01). | Remove until per-company WhatsApp exists. |
| B-08 | P2 | Account → Password | "You sign in with your mobile… there's no password", yet the login page has an Email & Password tab a new owner can never use. If the phone or SMS fails there is no way in. | Let an owner set a password (or a backup sign-in), or drop the email tab for OTP-only accounts. |
| B-09 | P2 | Team & access → HR defaults | HR can approve leave but has Manage Team off, so the HR manager cannot add or edit employees. | HR gets Manage Team by default (or offer it when creating the HR team). |
| B-10 | P2 | Team & access → What owners can open | Areas can be switched off for "all owners, you included" — a single owner can switch off Finance for themselves. Not tried here (to avoid locking the test company); worth a guard. | Warn when the only owner switches an area off for themselves; keep a way back. |
| B-11 | P3 | Team & access → add team | A duplicate team name says "A role with this name already exists" (the screen says team). Adding a team gives no confirmation. | "There's already a Production team." / "Design & Sampling added." |
| B-12 | P2 | Settings — missing for an Indian SME | Not found anywhere: GST rates and invoice numbering; bank details and logo on invoices; default payment terms; financial year (Apr–Mar); working days / holidays (the "stuck after N working days" rule needs them); leave types and balances; notification preferences (email / WhatsApp / push); integrations (Tally, Zoho Books, Google). | Decide which belong in v1; GST/invoice basics and leave types are the most asked for. |
| B-13 | Info | Settings | Good: audit log, AI processing switch with who agreed and when, deadline escalation (warn N days before, manager after N, owner after N), approval handover while away, delete account with "what we hold". | — |

### C. Team, CRM and Workflows (owner)

| ID | Sev | Where | What happened | What should happen |
|---|---|---|---|---|
| C-01 | P2 | Team vs Settings | Team page says "1 of 15 seats"; Settings → Plan says "1 of 10 seats used". | One number from one source. |
| C-02 | P2 | Add member → "They will see these menus" | For an HR member the preview lists CRM and "Finance (upload only)", while HR's access has CRM and Finance off (her profile says "No access to … CRM … Finance"). To confirm when signed in as HR (section D). | The preview matches the access. |
| C-03 | P3 | Team tree vs profile | The tree draws all three members under Meera; each profile says "Reports to: No one". The coloured dot on invited members has no legend. | Same answer in both; label "Invited". |
| C-04 | P3 | Add member | Nothing is sent to the new member, even with an email given; the owner must share the link. Clear on screen, but an email invite would save a step. Duplicate email says only "Email already registered" (duplicate phones name the person). | Optional email invite; say whose email it is. |
| C-05 | P2 | CRM → buyer | The same buyer name can be added twice with no warning ("Northwind Apparel" ×2). | "There's already a buyer called Northwind Apparel — open it?" |
| C-06 | P2 | CRM → GSTIN | "ABC123" is accepted as a GSTIN. | Validate the 15-character GSTIN format (and state code). |
| C-07 | P2 | CRM → export buyer | No country, currency, payment terms, credit limit or multiple contact people on a contact; a UK buyer's page shows money in ₹. | Country + currency + payment terms on the contact; amounts in that currency. |
| C-08 | P3 | CRM wording | The contact page labels the buyer "Customer" and the empty state says "a customer, a partner or a supplier" although the company's word is Buyer. Delete sits inside Edit only. | Use the vocabulary everywhere; a visible Delete in the page menu. |
| C-09 | P2 | Workflows → advance / create | Creating a card and advancing a stage each took ~4–10 s with no spinner or "Moving…" state; the create form stayed open with no feedback. | A busy state on the button; close the form at once and show the card as "saving". |
| C-10 | P2 | Workflows → "Move on" dialog | Tasks set to require evidence (Settings shows "evidence" on each stage task) can be closed as "It was done — close it" from the move dialog with no proof. | Ask for the proof, or mark them "done without proof". |
| C-11 | Info | Workflows | Good: the board, auto-created stage tasks, stage due dates and target date, and the "Move on? say what happens to each open task (Done / Not needed / Keep)" dialog. The server refuses an advance with open tasks. | — |
| C-12 | Info | CRM | Good: delete asks first and explains what stays as history; Import from spreadsheet exists; duplicate phone/email are blocked when adding team members. | — |
| C-13 | P1 | Decisions (Dex) → task due date | Decision said "Rahul to send the revised pro-forma invoice by Friday" (today Thu 8 Oct, so Fri 9 Oct). The task was created due **Mon 12 Oct** — the order card's stage due date, not Friday. "Arun to confirm the advance before production starts" got **no due date** at all. | Use the date the person said; when none, say "no date — set one" in the review instead of saving without one. |
| C-14 | P2 | Decisions → duplicates | The order card already had "Raise the pro-forma invoice…" and "Verify advance payment or LC…" (on the Accounts team). Dex created "Send revised pro-forma invoice" (Rahul) and "Confirm 30% advance payment received" (Arun) beside them — the order now carries both pairs. | When a decision names work the card already has, assign/re-date that task instead of adding a twin. |
| C-15 | P2 | Decisions → after Approve | "Approved — 2 tasks created" toast after ~10 s, but the dialog stayed open showing the pre-approval "Decision ready for you" screen (buttons gone). It looks like nothing happened. | Close, or switch to "Approved — here's what was created" with links. |
| C-16 | P3 | Decisions review | The company-note line shows a raw tag "buyer_terms". | Show the note's words only, or a friendly label. |
| C-17 | Info | Decisions (Dex) | The decision flow is the product at its best: one typed sentence → recognised Rahul and Arun, linked the existing NW-001 card, proposed tasks + a company note, and nothing was created until Approve. The progress dialog ("Sending… Queued… Working out who does what") can be closed while it works. | — |
| C-18 | P2 | My Work → routines | "Set them up" starts routines with a frequency but no "who": all three were assigned to the owner, including "Monthly export invoice reconciliation with Accounts". Took ~8 s with no busy state. | Pick an assignee (or team) per routine, defaulting from its department. |
| C-19 | P3 | My Work → new task | Assigning to someone whose invite is still pending gives no hint they cannot see it yet. An empty title is only a red outline (no words). | "Rahul hasn't joined yet — they'll see it once they do." / "Give the task a title." |
| C-20 | P2 | My Work → new task "Department" | The task form's Department list is the task categories (Buyer Coordination…), not the teams — B-02 seen in daily use. | One list (see B-02). |

### F. Finance (owner)

| ID | Sev | Where | What happened | What should happen |
|---|---|---|---|---|
| F-01 | P0 | Finance → Ask AI about your finances | Asked "How much do we owe suppliers and when is it due?" The answer: "there are no outstanding payables… ₹0… [the yarn] appears to already be fully paid for." A ₹1,68,000 purchase bill from Sri Lakshmi Yarn Mills is stored **unpaid, due 5 Nov** (checked via the API). Purchase bills booked as stock are left out of what the AI is given. A confident wrong answer about money. | Payables (all unpaid purchase bills, whatever they were booked as) in the finance context; tests for "what do we owe". |
| F-02 | P1 | Finance → record a payment | An invoice row's only action is "Delete invoice"; "Add record" offers Income / Expense / Asset / Inventory — no "Payment received" or "Mark paid / part-paid". Payments only arrive via WhatsApp or an uploaded receipt. An owner who got a bank transfer cannot record it. | "Record payment" on each invoice and bill (amount, date, mode), part-payments, and a payment record type. |
| F-03 | P1 | Finance → sales invoice | "Income" records a sale (what for, amount, buyer, number, dates) but cannot produce an invoice: no line items, GST, HSN, bank details or PDF to send; no currency for an export sale (GBP/USD) — amounts are ₹ only. | Generate a GST invoice / export invoice (line items, tax, currency, PDF); at minimum a currency per invoice. |
| F-04 | P1 | Finance → Overview "Net profit" and payables | Net profit shows ₹11,50,000 = the whole sale, though ₹1,68,000 of yarn went into it (stock bought, cost never reaches profit). No "to pay" figure anywhere on Overview; the ₹1,68,000 owed is invisible unless you open the bill list. The AI brief itself says "P&L looks artificially perfect". | A "To pay" tile beside "To collect"; profit that counts stock used (or label it "before cost of goods"). |
| F-05 | P2 | Bill reading → GST | The bill showed the supplier's GSTIN and CGST 2.5% + SGST 2.5%; neither was captured (contact GSTIN stays empty; no tax split). Stock unit cost was set to ₹336/kg = price **including** GST, which is normally claimable input credit. | Read GSTIN and the tax split; keep GST out of stock cost and track input credit. |
| F-06 | P3 | Finance overview | The AI Finance Brief ran on a brand-new company with no data ("No financial data found… Zero records across all financial categories") — AI allowance spent to say nothing. Two "Ask about your finances" boxes on the same page. Amounts carry hidden zero-width characters (copying "₹11,50,000" into a sheet brings them along). "Filed: 0 contacts · 1 invoices · 0 payments · 1 tasks" (plurals). | Skip the brief until there is data; one ask box; plain digits; "1 bill · 1 task". |
| F-07 | Info | Bill reading | Good: a supplier tax invoice (image) was read in ~28 s at 98% confidence — supplier, number, ₹1,68,000, due date, "book as Inventory", a "Pay vendor bill" task; it matched the existing supplier instead of duplicating; stock got 500 kg. The brief rewrote itself from the real figures after the books changed. | — |

### G. Dex, Company Brain and the other pages (owner)

| ID | Sev | Where | What happened | What should happen |
|---|---|---|---|---|
| G-01 | P0 | Dex → "What do we owe suppliers, and when is it due?" | Dex listed the supplier bill correctly (₹1,68,000, due 5 Nov) **and** Northwind's sales invoice (money owed *to* us) as a "supplier/vendor invoice", answering "2 outstanding supplier invoices totalling Rs 13,18,000". The truth is ₹1,68,000. Together with F-01, the two money AIs give two different wrong answers to the same question. | When the question is about suppliers/payables, only purchase bills; when about buyers/receivables, only sales invoices. Add both to the eval golden set. |
| G-02 | P2 | Ops (operating score) | Day one: "Finance 0/100" because no cash has come in yet (a new company is penalised for being new); "Sales 100/100" is described as "Rate at which raised decisions get a green light" — that is approvals, not sales. "Do these first: Nothing urgent" while the score says "Some key areas need attention". | Don't score an area with nothing to measure ("not enough yet"); rename Sales; when the score is low, say what to do first. |
| G-03 | Info | Dex / Brain / Journal | Good: "Where is NW-001 and what is pending?" — right stage, both pending tasks from the decision, the discount note, 5 linked sources. A leave policy uploaded to the Company Brain answered "how many sick days / when is a certificate needed" correctly with the document cited and three good follow-ups. The Journal shows the decision with a timeline. Notifications already carried a due-tomorrow reminder. | — |
| G-04 | P2 | Leave vs Company Brain | The leave policy (12 casual / 8 sick / 15 earned, carry-forward) lives only as a document Dex can quote. The Leave form has types (Casual, Sick, Earned, Permission, WFH, Other) but no allowances or balances ("Days off in 2026: 1"), so nobody can see how many days they have left and approvers can't see if someone is over. | Allowance per type (Settings) and a balance on Leave and on the approval card. |

### D. Signed in as each person

| ID | Sev | Who / where | What happened | What should happen |
|---|---|---|---|---|
| D-01 | P1 | HR (Kavitha) → Settings → Workspace tab | Opening `/settings?tab=workspace` as a member crashes the panel: "Something broke here — Maximum update depth exceeded" (a render loop). Reproduced on a fresh load. After it, every other Settings tab shows the same crash until a full reload. | A member asking for an owner-only tab lands on their own Account tab. |
| D-02 | P2 | Every member → Dex box on the Desk | HR and Sales both see "Dex — Ask an owner to turn on capture": Voice Box is off by default for every team, so the product's main action (tell Dex a decision) is unavailable to the whole team until the owner finds the switch. | Capture on by default for team members (decisions still need approval), or prompt the owner during setup. |
| D-03 | P2 | Invite link → privacy | The invite page masks the number ("•••• 0002"), but the invite's start response returns the full phone number and name to anyone holding the link (the link is meant to be shared over WhatsApp). | Return only the masked number. |
| D-04 | P3 | Leave request (Sales) | Rahul's request went to "Approver: Meera Iyer" (owner) because every team's leave approver is the owner by default (see B-01); dates show as "2026-10-15 → 2026-10-16". | Readable dates ("15–16 Oct"); approvers from setup. |
| D-05 | Info | Access control | Holds up well. HR: CRM and Journal show "This page isn't open to you"; Finance shows the upload inbox only; Team is a clearly labelled read-only view; the API refuses invoices/contacts/expenses/ledger with 403. Sales: Dex refuses money ("invoices, payments and balances aren't part of your access") and still answers what Sales can see. Accounts sees all of Finance. Members get their own welcome ("check the details your team added"). Proof-required tasks cannot be completed without a file. | — |
| D-06 | Info | Phone width (375 px) | Desk, My Work, Finance, CRM, Team and Settings have no sideways scroll. | — |

## What we have to do

Grouped by area, most important first. IDs point to the rows above.

**1. Money answers must be right (P0)**
- Finance AI and Dex both get "what do we owe suppliers?" wrong, in different ways (F-01, G-01). Include every unpaid purchase bill in the finance context; keep payables and receivables apart; add both questions to the eval golden set.

**2. Close the money loop (P1)**
- Record a payment against an invoice or bill — full or part (F-02).
- A "To pay" figure beside "To collect"; profit that counts stock used (F-04).
- Make a real invoice: line items, GST, currency, PDF (F-03); read GSTIN and the CGST/SGST split from bills (F-05).

**3. Make the setup match what the founder said (P1)**
- Interview approval rules become settings: order limits, leave approver, thresholds (B-01, A-11).
- Value-based stage approvals ("over ₹5 lakh → owner") (B-03).
- One list of teams instead of three (B-02, C-20).
- Prefill company mobile, email and region from sign-up (B-06).

**4. Fix the bugs found (P1)**
- Decisions: "by Friday" saved as Monday; a missing date saved as none (C-13).
- Settings crash for members on the Workspace tab (D-01).
- Sign-up resume skips the unanswered name step (A-01).

**5. Getting a team in (P1/P2)**
- Invite the team at the end of sign-up, with a Desk card until someone joins (A-16).
- Team capture on by default (D-02); HR gets Manage Team (B-09).
- Routines pick an assignee (C-18); decisions don't duplicate card tasks (C-14).

**6. Trial, plan and AI allowance (P1)**
- Upgrade and payment, what happens at trial end, and an AI-use meter (B-04).
- Hide per-company keys and the WhatsApp code until they're real (B-05, B-07).

**7. Trust and privacy (P2)**
- Sign-in mustn't reveal which numbers have accounts (A-03); the invite response returns only the masked number (D-03).
- A backup sign-in for owners (B-08); a guard against an owner switching off their own access (B-10).

**8. Speed and feedback (P2)**
- Creating or moving a card, approving a decision and starting routines take 4–15 s with no busy state (C-09, C-15, C-18).

**9. Smaller product gaps (P2)**
- CRM: duplicate warning, GSTIN check, country/currency/terms on a contact (C-05, C-06, C-07).
- Leave allowances and balances (G-04).
- Ops score on day one (G-02).
- Interview: languages beyond the app's three (A-15); answers lost on reload (A-10).
- Browser Back in sign-up (A-02).
- Indian-SME settings: GST, financial year, holidays, notifications, integrations (B-12).

**10. Polish (P3)**
- A-05 to A-08, A-12 to A-14, A-17, B-11, C-03, C-04, C-08, C-16, C-19, D-04, F-06.

## What worked well

- Sign-up's interview builds a believable operating model for the business (A-20).
- Decisions from one sentence — people, linked order, tasks, nothing created until approved (C-17).
- Bill reading (F-07), Dex answers with sources (G-03), the stage "move on" dialog (C-11).
- Access control (D-05) and proof-required tasks.

## Test data left in the test database

Company **Audit Textiles** in `dos_engine_0921c`:
- **People:** owner Meera Iyer, plus Kavitha Rao (HR), Arun Kumar (Accounts) and Rahul Menon (Sales). All signed in through their invites; test numbers +91 90000 10001–10004.
- **CRM:** buyer Northwind Apparel and supplier Sri Lakshmi Yarn Mills.
- **Workflow:** order card NW-001 (Order Confirmed).
- **Finance:** sales invoice AT/26-27/001 (₹11,50,000); purchase bill SLY/2026/0412 (₹1,68,000); 500 kg yarn in stock.
- **Other:** one approved decision, the leave policy document, one approved leave, three routines and a few tasks.

Nothing was sent to anyone: SMS, email and WhatsApp are blank on this backend, and every code came back to the page.

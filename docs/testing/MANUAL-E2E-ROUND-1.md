# Manual end-to-end test · Round 1

*Three people, five accounts, one company, desktop and phone mixed.*

This is a **script, not a feature list**. You are going to run one real
business through DecisionOS for three days of its life, with each of you
playing different people in it, and write down everything that makes you stop,
squint or explain. A bug is anything that would make the person you are
playing put their phone down.

---

## 1 · Before you start

| | |
|---|---|
| **Where** | The staging build — **never** the pilot client's live company. Fill in the URL here: `________________` |
| **Sign-in codes** | Members sign in with a mobile number and a texted code. Either (a) set `DEV_OTP_IN_RESPONSE=1` on staging, and the code fills itself in with a toast — use obviously fake numbers; or (b) wire a real SMS provider and use five real numbers. **Never set that flag on production.** |
| **Email** | Only the founder needs one. Use `+tag` addresses on one inbox: `you+vetri.raj@…` etc. |
| **Browsers** | Chrome and Safari between you. One person on an iPhone, one on Android, if you have both. |
| **Screenshots** | Every failure gets one. Name it `R<round>-<check>-<what>.png`, e.g. `R4-12-approve-does-nothing.png`. |
| **Don't help each other** | If you have to lean over and explain a screen to the person beside you, that is a finding. Write it down *before* you explain. |

**One company, five accounts.** Everybody joins the same workspace. That is the
whole point — most of what breaks in this app breaks between people, not
inside one screen.

---

## 2 · The company

**Vetri Engineering Works**, Coimbatore. A sheet-metal and machining job shop,
18 people. Makes brackets, housings and frames for pump and motor companies.
Buys steel, hydraulics and transport. The founder does everything and the shop
runs on his memory, three WhatsApp groups and a notebook.

Use **exactly these figures** — several checks compare totals, and they only
work if all three of you type the same numbers.

### Who they sell to (buyers)

| Name | Kind | What |
|---|---|---|
| Ashok Pumps | Customer | ₹4,20,000 invoice, raised **40 days ago**, due **10 days ago** → must read **overdue** |
| Lakshmi Motors | Customer | ₹1,80,000 invoice, raised 5 days ago, due in 25 days → **not** overdue |
| Sri Balaji Traders | Dealer | no invoice yet |

### Who they buy from (suppliers)

| Name | What |
|---|---|
| Anand Steels | ₹86,400 — **raw material** (steel sheet) |
| Coimbatore Hydraulics | ₹6,00,000 — a **press brake**, an asset |
| KSB Transport | ₹12,400 — freight |

### The company's own money

| | |
|---|---|
| Rent | ₹45,000 |
| Wages | ₹2,20,000 |
| High-value approval threshold | set it to **₹1,00,000** in Settings (Round 2) |

### What the numbers should come to

Work these out yourself before you look at the screen — if the app disagrees
with this table, that is a finding, and if this table is wrong, that is one too.

| Figure | Expected | Why |
|---|---|---|
| Revenue billed | ₹6,00,000 | 4,20,000 + 1,80,000 |
| To collect (overdue) | ₹4,20,000 | only Ashok Pumps is a week past its due date |
| Total spend | ₹9,63,800 | everything, including stock and the machine |
| **Net profit** | **₹3,22,600** | revenue − what it costs to RUN the place (rent + wages + freight). **Stock and the press brake are not a loss** |
| Stock bought | ₹86,400 | shown on its own |

---

## 3 · The cast, and who plays whom

| # | Person | Their job | Access they should have | Main device | Played by |
|---|---|---|---|---|---|
| 1 | **Rajkumar** | Founder | Everything | **Desktop**, phone as well | **A** |
| 2 | **Deepa** | Sales | Desk, work, workflows, **customers only** | **Phone** | **B** |
| 3 | **Suresh** | Accounts & GST | Desk, work, **Finance**, **suppliers only** | **Desktop** | **C** |
| 4 | **Murugan** | Production | Desk, work, workflows — nothing else | **Phone only** | **B** |
| 5 | **Karthik** | Plant manager *(invited on day 2)* | Approvals, decisions, leave | **Phone first**, then desktop | **A** |

**B and C each run two people. Use two different browsers or a private
window** — not two tabs of the same profile, or you will be signed in as one
person in both and half the findings will be wrong.

---

## 4 · How to log a finding

Copy this into a shared sheet. One row per finding, however small.

| Field | Example |
|---|---|
| **ID** | `F-014` |
| **Check** | `R4-12` |
| **Who / device** | Deepa · iPhone 13, Safari |
| **Screen** | My Work → task drawer |
| **What I did** | Tapped Approve on Murugan's task |
| **What happened** | Spinner, then nothing. Task still says "waiting" |
| **What I expected** | The task moves to Done and the count drops by one |
| **How bad** | Blocks me / Slows me down / Looks wrong / Just ugly |
| **Screenshot** | `R4-12-approve-does-nothing.png` |

**How bad** is the only rating that matters. Don't argue about severity — say
whether you could carry on.

---

## Round 0 · The founder signs up  *(A, alone, ~20 min)*

Desktop, in a **private window**, so nothing is remembered from before.

| # | Device | Do this | It should |
|---|---|---|---|
| 0-1 | Desktop | Open the app's front door | Land on the landing page, not a sign-in form |
| 0-2 | Desktop | Press **Start free** | Go to sign-up |
| 0-3 | Desktop | Enter Rajkumar's mobile, ask for the code | Say where it went, mask the number |
| 0-4 | Desktop | Enter the code | Accept it; a wrong code should say so plainly, not "error" |
| 0-5 | Desktop | Company name, your name, email, team size | Ask in words a workshop owner uses. **Flag any jargon you would not say out loud** |
| 0-6 | Desktop | Industry + "you sell to" | Both should be the app's own dropdown, **never the phone/OS one**. "You sell to" should be in plain words, not B2B/D2C |
| 0-7 | Desktop | Answer the interview in your own words — "sheet metal job work, brackets and housings, we buy steel and sell to pump companies" | Come back with departments and workflows that sound like *this* shop |
| 0-8 | Desktop | Read the build screen | Count the departments, workflows and rules. **Write the numbers down** |
| 0-9 | Desktop | Read the line under the button about Dex and AI | It should say what pressing it turns on, and where to turn it off |
| 0-10 | Desktop | Press **Looks good — Enter DecisionOS** | Land **in the app**. There must be **no second screen** asking you to enter again |
| 0-11 | Desktop | Look at the Desk | Greeting by name, a score with a **name** next to it, tiles, Dex at the bottom |
| 0-12 | Desktop | Click the score | Open the Operating Score page. Read it — **no programmer words** ("not wired", "no denominator") |
| 0-13 | Desktop | Settings → check the departments the AI built | Real names, no `under_scores` or raw keys on screen |
| 0-14 | Desktop | Settings → is there anything saying you agreed to AI processing? | It should match what screen 0-9 told you. If it claims an agreement you never saw, that is a finding |

---

## Round 1 · The founder's first hour  *(A, desktop, ~30 min)*

| # | Device | Do this | It should |
|---|---|---|---|
| 1-1 | Desktop | Settings → set currency to **INR**, high-value approval to **₹1,00,000** | Save, and say it saved |
| 1-2 | Desktop | Settings → business words: call a customer a **"party"** | Then check the Desk, CRM and Finance. **Note every screen that still says "customer"** |
| 1-3 | Desktop | Tell Dex, by voice: *"We are buying a second press brake from Coimbatore Hydraulics, six lakh rupees, Suresh to arrange the payment"* | Come back inside ~15s with a decision you recognise |
| 1-4 | Desktop | Read the proposal before approving | Task, owner, due date. **No `[square brackets]` or blanks left in the text** |
| 1-5 | Desktop | Approve it | Say what it created. The timeline should name the **team in words**, never `order_intake_&_customer_coordination` |
| 1-6 | Desktop | Tell Dex, by typing: *"Arrange the vendor call next Wednesday"* | The meeting lands on **the coming Wednesday**, not the week after. Check the calendar |
| 1-7 | Desktop | Open the empty "type instead" box and wait 10 seconds without typing | It must **stay open**. If it closes itself, that is a finding |
| 1-8 | Desktop | Type half a decision, go to another page, come back | The words should be there, with a line saying they were kept |
| 1-9 | Desktop | Attach a photo of a bill to Dex | It should get on with it and tell you where it went. **Time it** — anything past a minute, write the number down |
| 1-10 | Desktop | Workflows page | The boards the AI built, with stages that match the shop |
| 1-11 | Desktop | Desk → Workflows tile → **Open workflow** | Open the boards. The pill should be a pill, not a mystery arrow |
| 1-12 | Desktop | Journal | The day's history, owner-only |

---

## Round 2 · Building the team  *(A, desktop, ~25 min)*

| # | Device | Do this | It should |
|---|---|---|---|
| 2-1 | Desktop | Team → add **Deepa**, role Sales | Ask for a mobile number, not a password |
| 2-2 | Desktop | Read the invite sheet | It should tell you to **send the link yourself**. It must not blame "your SMS provider" |
| 2-3 | Desktop | Send Deepa's link to B on WhatsApp | — |
| 2-4 | Desktop | Add **Suresh** (Accounts & GST), **Murugan** (Production) the same way | — |
| 2-5 | Desktop | Team → Access → check what Sales gets by default | **Customers, not suppliers** |
| 2-6 | Desktop | Access → what Accounts gets | **Finance and suppliers, not customers** |
| 2-7 | Desktop | Access → what Production gets | Desk, work, workflows. **No money, no contacts** |
| 2-8 | Desktop | Settings → seats | It should count **the invitations too**, not only people who have signed in |
| 2-9 | Desktop | Invite people until you hit the seat limit | The refusal should tell you that cancelling an unused invitation gives the seat back |
| 2-10 | Desktop | Cancel one of those invitations | The seat comes back, and you can invite again |
| 2-11 | Desktop | Team → Leave approvers | Set who signs off leave |

---

## Round 3 · Everybody's first sign-in  *(all three, phones, ~25 min)*

Do these **at the same time**, on your own devices.

| # | Who / device | Do this | It should |
|---|---|---|---|
| 3-1 | Deepa · phone | Open the app cold | Open on **Mobile number**, not Email & password |
| 3-2 | Deepa · phone | Enter a number the app does not know | Offer to **start a new company with that number** — not just refuse |
| 3-3 | Deepa · phone | Open the invite link, enter the code | In. Her name and company should greet her |
| 3-4 | Deepa · phone | Read her Desk without tapping anything | **Write down every number she cannot act on.** No "To collect", no company spend |
| 3-5 | Deepa · phone | Tap the score dial | Open the score page and explain itself |
| 3-6 | Deepa · phone | More → what is in the panel | CRM, her work, workflows, team, leave, **Ops**. Labels must not be cut off |
| 3-7 | Deepa · phone | CRM | **Customers only.** No supplier tab at all |
| 3-8 | Deepa · phone | Add **Ashok Pumps** and **Lakshmi Motors** as customers, **Sri Balaji Traders** as a dealer | She can, without asking anybody |
| 3-9 | Deepa · phone | Try to reach a supplier list any way you can | She should not be able to, and the refusal should say *suppliers*, not "access denied" |
| 3-10 | Suresh · desktop | Sign in, open Finance | Straight to the ledger, everything loads. **No refused figures** |
| 3-11 | Suresh · desktop | CRM | **Suppliers only** |
| 3-12 | Suresh · desktop | Add Anand Steels, Coimbatore Hydraulics, KSB Transport as suppliers | He can |
| 3-13 | Murugan · phone | Sign in, read his Desk | His work. **No money tile, no complaints tile** |
| 3-14 | Murugan · phone | Read his briefing line | About HIS work, in **rupees** if it mentions money at all — never dollars, never the company's receivables |
| 3-15 | Murugan · phone | Try Finance and CRM from the More panel | They should not be offered. If offered, they must open and work |
| 3-16 | All | Everybody speak one decision into Dex | Owner: works. **Note exactly what the other three are told** if it is not turned on for them |

---

## Round 4 · A working day  *(all three, mixed, ~40 min)*

| # | Who / device | Do this | It should |
|---|---|---|---|
| 4-1 | Rajkumar · desktop | New Task: *"Cut and fold 40 brackets for Ashok Pumps"* → Murugan, due tomorrow, needs approval | Created, and say where it went |
| 4-2 | Rajkumar · desktop | Look for that task in **My Tasks** | It will not be there — it is Murugan's. **Is anything on screen telling you where it went?** |
| 4-3 | Rajkumar · desktop | Start a New Task, type a title, press Escape | Ask whether to **keep or discard** — not silently vanish |
| 4-4 | Rajkumar · desktop | Choose Keep, reopen New Task | The words come back, with a line saying they were kept |
| 4-5 | Murugan · phone | Within a minute of 4-1 | The task should arrive **without a reload** |
| 4-6 | Murugan · phone | Open it, write an update, switch apps, come back | The words are still there |
| 4-7 | Murugan · phone | Post the update, mark it done | It asks for approval; he is told it is waiting |
| 4-8 | Murugan · phone | Hand a task off — open the picker | **Only people he may actually hand to.** Nobody who will be refused |
| 4-9 | Rajkumar · desktop | Approve Murugan's work | Counts move by exactly one. Check the number on the Desk before and after |
| 4-10 | Deepa · phone | CRM → Ashok Pumps → log a complaint: *"Two brackets bent on the last lot"* | She can do it **from the phone**, without a desktop |
| 4-11 | Deepa · phone | Edit Ashok Pumps — change the status off "Lead" | She can |
| 4-12 | Deepa · phone | Log a call activity on Lakshmi Motors | The Call/Meeting/Note picker is the **app's own list**, not the phone's |
| 4-13 | Rajkumar · desktop | Desk → Complaints tile | Opens something he can read, with the complaint in it |
| 4-14 | Murugan · phone | Raise leave: two days next week | Goes to his approver, and he is told |
| 4-15 | Rajkumar · desktop | Approve it | The card changes **without a reload** |
| 4-16 | All | Check the bell | The count should match what is actually waiting on you. **A number over an empty Desk is a finding** |

---

## Round 5 · Money, end to end  *(Suresh desktop + Rajkumar desktop, ~35 min)*

| # | Who / device | Do this | It should |
|---|---|---|---|
| 5-1 | Suresh · desktop | Finance → add the **Ashok Pumps** invoice, ₹4,20,000, raised 40 days ago, due 10 days ago | Saved; the date reads like a date (**22 Sep 2026**, not 2026-09-22) |
| 5-2 | Suresh · desktop | Add the **Lakshmi Motors** invoice, ₹1,80,000 | — |
| 5-3 | Suresh · desktop | Add the **Anand Steels** expense, ₹86,400, category Raw Material | — |
| 5-4 | Suresh · desktop | On that form, type a supplier name that is **not** in the list | Offer to **add them as a supplier** right there, and link it |
| 5-5 | Suresh · desktop | Add rent ₹45,000, wages ₹2,20,000, freight ₹12,400 | — |
| 5-6 | Suresh · desktop | Add the **press brake**, ₹6,00,000 — over the threshold | It should be **saved and held for approval**, not refused and not silently booked |
| 5-7 | Suresh · desktop | Look at the expense list | It says **waiting for approval**, and it is **not** in the totals |
| 5-8 | Rajkumar · desktop | You should have been told | Approve it |
| 5-9 | Suresh · desktop | Refresh | Now it counts |
| 5-10 | Both | Finance → Overview. Compare with §2 | **Net profit ₹3,22,600.** Stock and the machine are not a loss, and the tile says so |
| 5-11 | Both | Desk → To collect (overdue) → click it | **₹4,20,000**, and the page it opens says the **same figure** |
| 5-12 | Suresh · desktop | Photograph a bill for a machine and file it through Finance → Inbox | It should reach **both** the money and the asset register — not one or the other |
| 5-13 | Suresh · desktop | Supplier page for Anand Steels | It should count what you **paid** them, not only bills with a document |
| 5-14 | Rajkumar · desktop | Finance → Expenses, look for the press brake decision from 1-5 | An approved purchase should leave a trace — **approved, not yet billed** |
| 5-15 | Rajkumar · desktop | Read the AI finance brief | It must not say the books are empty next to real numbers, and it should say when it was written |
| 5-16 | Rajkumar · desktop | Ask Dex: *"How much do customers owe us in total, and who owes the most?"* | **₹4,20,000 · Ashok Pumps.** "Nothing outstanding" is a serious finding |

---

## Round 6 · The chain of command  *(A + B, mixed, ~30 min)*

| # | Who / device | Do this | It should |
|---|---|---|---|
| 6-1 | Rajkumar · desktop | Invite **Karthik** as plant manager, with approvals, decisions and leave | — |
| 6-2 | Rajkumar · desktop | Read the three "allowed to approve" boxes | **Can you tell what each one does?** If not, say so |
| 6-3 | Rajkumar · desktop | Team → make Karthik the reporting manager for Murugan and Deepa | — |
| 6-4 | Karthik · phone | Sign in from the invite | Welcomed by name, into the right company |
| 6-5 | Murugan · phone | Speak a decision into Dex | It should go to **Karthik**, not straight to the founder |
| 6-6 | Karthik · phone | Approve one, reject another | Both should stick. **Is there anywhere to say why you rejected it?** |
| 6-7 | Murugan · phone | Look at the rejected one | Does he learn why? |
| 6-8 | Karthik · phone | Raise leave for three days — you should be asked **who covers your approvals** | Pick Rajkumar |
| 6-9 | Rajkumar · desktop | Approve Karthik's leave | Rajkumar should be **told he is covering** |
| 6-10 | Murugan · phone | While Karthik is away, raise another decision | It should reach **Rajkumar**, not sit on Karthik |
| 6-11 | Karthik · phone | Escalate a task | It goes up to his manager or the owner, and says who |
| 6-12 | Rajkumar · desktop | Remove Murugan from the team, hand his work to Deepa | It should say how many tasks moved |
| 6-13 | Deepa · phone | Check | She should be **told** the tasks came to her, and why |
| 6-14 | Murugan · phone | Try to use the app | Turned away with a sentence he can understand — not a broken, empty screen |

---

## Round 7 · At the same time  *(all three at once, ~20 min)*

Count down out loud and do these **together**.

| # | Who | Do this | It should |
|---|---|---|---|
| 7-1 | A + C | Both approve the **same** decision at the same moment | One wins; the other is told plainly. No double-approval, no crash |
| 7-2 | A | Reassign a task **while** B is typing an update on it | B is told, and B's words are not lost |
| 7-3 | A | Delete a task **while** B has it open | B is told it is gone, not left on a dead screen |
| 7-4 | B + C | Both add a contact with the **same name** at the same moment | Whatever happens, it must be the same on both screens after a refresh |
| 7-5 | B | Sign out on the phone, hand it to C, C signs in | **Nothing of B's is left** — no half-typed words, no filters with B's name |
| 7-6 | A | Change the company's currency while others have Finance open | Everyone lands on the same answer after a refresh |

---

## Round 8 · The installed phone app  *(B and C, phones, ~30 min)*

| # | Device | Do this | It should |
|---|---|---|---|
| 8-1 | Phone | Install it (Add to home screen) | Be offered, and the prompt should be readable |
| 8-2 | Phone | Open from the home screen | **Full screen**, no browser bar |
| 8-3 | Phone | Turn on aeroplane mode, open the app | Show what it has, and **say it is offline** |
| 8-4 | Phone | Offline: speak a decision into Dex | Take it and say it will go when you are back |
| 8-5 | Phone | Turn the network on | It should go, and you should be told |
| 8-6 | Phone | Throttle to slow 3G, open the Desk | The numbers must **say they are the saved copy**, not pretend to be live |
| 8-7 | Phone | Tap into a task update field | The keyboard must **not** cover what you are typing |
| 8-8 | Phone | Ship a new build while the app is open | It should say a new version arrived, not change under your hands |
| 8-9 | Phone | Settings → text size 125%, then 150% | Note every cut word. The Desk greeting, "Show all", the More labels |
| 8-10 | Phone | Switch to Hindi, then Tamil | Note what is still English — buttons, filters, chips |
| 8-11 | Phone | New Task sheet → the close button | Big enough to hit with a thumb, first time |
| 8-12 | Phone | Every sheet: scroll inside it | The page behind must not scroll with it |
| 8-13 | Phone | The phone's own Back button, with a dialog open | Closes the dialog, not the app |
| 8-14 | Phone | Double-tap Save on anything | One record, not two |
| 8-15 | iPad, if you have one | Open it portrait, then landscape | Both should be usable |

---

## Round 9 · Who sees what  *(all three, 15 min — do this last)*

Fill this in by trying, not by reading the code. **One row per person.**

| Screen | Rajkumar | Deepa (Sales) | Suresh (Accounts) | Murugan (Production) | Karthik (Manager) |
|---|---|---|---|---|---|
| Decision Desk | | | | | |
| My Work | | | | | |
| Workflows | | | | | |
| CRM — customers | | | | | |
| CRM — suppliers | | | | | |
| Finance | | | | | |
| Team | | | | | |
| Leave | | | | | |
| Operating Score | | | | | |
| Journal | | | | | |
| Settings | | | | | |
| Dex | | | | | |

Write **opens / refused / opens but empty / offered but refused**. The last one
is the finding: a door that is shown and then shut.

---

## Round 10 · The thirty-six fixes  *(A, 20 min, fast pass)*

These all went in on 24–25 September. Each should now be true. If any one is
not, say so — it means a fix did not land.

| # | Check | Where |
|---|---|---|
| 10-1 | Every dropdown is the app's own list, never the phone's | Sign-up industry, Settings currency, leave type, CRM activity |
| 10-2 | No `[current period]` or blanks in an AI decision | Any Dex decision |
| 10-3 | The invite sheet does not mention an SMS provider | Team → invite |
| 10-4 | The Dex typing box does not close itself | Desk |
| 10-5 | Leaving New Task asks keep-or-discard | My Work |
| 10-6 | Long decision titles take a second line on desktop | Desk |
| 10-7 | New Task's close button is thumb-sized | Phone |
| 10-8 | Sign-in opens on mobile + code | Signed-out phone |
| 10-9 | An unknown number is offered sign-up | Sign-in |
| 10-10 | The score has a name and opens | Desk, both devices |
| 10-11 | Ops is reachable on the phone by a non-owner | More panel |
| 10-12 | Finance shows only what you can open | Suresh vs Deepa |
| 10-13 | The bell counts only what needs you | All accounts |
| 10-14 | One confirm screen at sign-up | Round 0 |
| 10-15 | AI consent is stated before you press | Round 0 |
| 10-16 | The Dex well says it kept a draft | Desk |
| 10-17 | A leave outcome shows without a reload | Leave |
| 10-18 | The hand-off picker only offers people it can hand to | Task |
| 10-19 | A supplier is not filed as a "Lead" | CRM |
| 10-20 | Finance dates read as dates | Finance |
| 10-21 | Sign-out clears the phone | Round 7-5 |
| 10-22 | Invitations take seats | Round 2-8 |
| 10-23 | The score page matches the Desk within seconds | Desk vs Ops |
| 10-24 | A money team can open Money on day one | Suresh |
| 10-25 | "Next Wednesday" is the coming Wednesday | Round 1-6 |
| 10-26 | A high-value expense waits for the owner | Round 5-6 |
| 10-27 | A supplier can be added from the expense form | Round 5-4 |
| 10-28 | An approved purchase shows as not-yet-billed | Round 5-14 |
| 10-29 | A photographed machine bill lands in both books | Round 5-12 |
| 10-30 | Whoever inherits a leaver's work is told | Round 6-13 |
| 10-31 | Dex answers the receivables question | Round 5-16 |
| 10-32 | CRM opens one side at a time | Round 3-7 / 3-11 |
| 10-33 | Buying stock is not a loss | Round 5-10 |
| 10-34 | Leave hands the approvals over | Round 6-9 |
| 10-35 | No "Multi-tenant" or B2B/D2C anywhere a founder reads | Sign-in footer, sign-up |
| 10-36 | No tile you cannot open | Round 3-4 / 3-13 |

---

## When you finish

Each of you writes **three sentences**, no more:

1. The moment you would have stopped, if this were your own company.
2. The thing that surprised you most — good or bad.
3. The one thing you would fix before anybody else sees this.

Then bring the sheet back and we will sort it into what to fix now, what to
decide, and what to leave.

# Google Play store listing — ready to paste

**Prepared 2026-10-09 for build 1.0.4, carried to 1.0.7 (versionCode 8) on 2026-10-10.** Everything on this page
goes into Play Console as written. The graphics are in this folder. The
questionnaire answers are in [CONSOLE_ANSWERS.md](CONSOLE_ANSWERS.md). The
running order is in [../PLAY_STORE_LAUNCH_TRACKER.md](../PLAY_STORE_LAUNCH_TRACKER.md).

Play's listing rules this copy was written against: no emojis, no ALL CAPS, no
rankings ("best", "#1"), no prices or offers, no testimonials, and nothing the
app does not do. That is why the "trusted by" logos and the "dangerously
organised" line from the website are not here.

---

## Main store listing (Grow → Store presence → Main store listing)

### App name (30 characters max)

```
DecisionOS
```

### Short description (80 characters max; this is 67)

```
Speak a decision once. Dex assigns it, tracks it and follows it up.
```

### Full description (4,000 characters max; this is 2,346)

```
DecisionOS is the operating brain for founder-led businesses. Say a decision out loud, and Dex, the assistant built into DecisionOS, turns it into a decision with an owner, tasks and due dates. Then it follows the work up until it is done.

Your Desk
Open the app to one screen: the decisions waiting on you, the approvals you need to sign, what is slipping, and the numbers that matter today. That means delayed work, complaints and money still to collect.

Speak to decide
Slide right and talk. Dex drafts the decision, the tasks it creates, who does them and what needs approval. Nothing is created until you approve it. You can also save it as a draft or reject it.

Ask Dex
Slide left and ask about your business in plain words, such as "Who has the most overdue tasks?" or "What is late this week?". Answers come from your own company's records.

My Work
Everyone in the company opens one list showing only what is theirs, with due dates, approvals and a record of what was done.

Approvals and leave
Approve spending and leave requests from your phone, and see who is away.

Money
Upload a bill or a photo of a receipt, track invoices, payments, expenses and what customers still owe. See revenue billed, money received and spend at a glance.

Workflows
Follow orders and jobs stage by stage, and see straight away what is stuck and why.

Decision Journal
Every decision is kept: what was decided, by whom, and what came of it.

Operating Score
A score out of 100 for how the company is running, across execution, finance, decisions and responsiveness, with the gaps to fix first.

Team and roles
Invite your team by mobile number. Each person sees what their role allows.

Built for
Founders and owners of small and growing companies, and the operations, sales and finance leads who run the work with them.

AI, privacy and your data
Dex uses AI services to transcribe speech and draft decisions and answers. AI processing starts only after your workspace has agreed to it. AI can make mistakes, so every AI answer can be reported from inside the app. Your data travels encrypted, and you can delete your account at any time from Settings, or at decisionos.biz/delete-account.

Getting started
Sign in with your mobile number or with email and a password. Create a workspace for your company in the app, or join one your company already uses.
```

### App icon, feature graphic, screenshots

| Asset | File | Spec checked |
|---|---|---|
| App icon | `app-icon-512.png` | 512 × 512 PNG, the same mark as the launcher icon |
| Feature graphic | `feature-graphic-1024x500.png` | 1024 × 500 PNG, no transparency |
| Phone screenshots (8) | `screenshots/01-…08-*.png` | 1242 × 2208 PNG, 9:16, no transparency, each side within 320–3840 px |

Upload the screenshots **in file order**. The order tells the story: the Desk,
speaking a decision, what Dex made of it, asking Dex, then the rest of the app.

| # | File | What it shows |
|---|---|---|
| 1 | `01-desk.png` | The Desk: numbers, and the decisions waiting on you |
| 2 | `02-speak-a-decision.png` | Decide recording: the dock is listening (the microphone, a native feature) |
| 3 | `03-decision-ready.png` | What Dex made: decision, tasks, people, approvals; Approve / Save as draft / Reject |
| 4 | `04-ask-dex.png` | Ask Dex: a question and its answer, with suggested follow-ups |
| 5 | `05-my-work.png` | My Work |
| 6 | `06-money.png` | Money: bill upload, revenue, received |
| 7 | `07-operating-score.png` | Operating Score |
| 8 | `08-decision-journal.png` | Decision Journal |

All data in the screenshots is the app's own fictional demo workspace
(Sharma Textiles). No real customer appears. Optional captioned or
device-framed versions can come later, and the raw screens meet the
requirement.

---

## Store settings (Grow → Store presence → Store settings)

| Field | Value |
|---|---|
| App category | **Business** (Productivity is the alternative; Business fits a company tool better) |
| Tags (pick up to 5 from Play's list) | Business management · Task management · Productivity · Team collaboration · Finance / accounting (choose the closest names Play offers) |
| Email | `support@decisionos.biz`. **It must deliver before you publish.** |
| Website | `https://www.decisionos.biz` |
| Phone | optional; leave blank unless you want calls |
| External marketing | your choice |

---

## Release notes (the "What's new" text for 1.0.7)

```
<en-IN>
First test release of DecisionOS for Android.
- The Desk: decisions, approvals and today's numbers on one screen
- Speak a decision: slide right and talk; Dex drafts the decision and tasks for you to approve
- Ask Dex: slide left and ask about your business
- Cancel a recording by sliding the handle back to the centre
</en-IN>
```

(Use `<en-US>` instead if the listing's default language is English (US).)

---

## App access instructions (Policy → App access)

**The app has no demo sign-in** (2026-10-10, founder: no demo login in the
mobile app; the store build leaves the "Try DecisionOS on a live workspace"
seats out entirely). So reviewers get a **dedicated reviewer account**, and it
has to exist before you send a release for review.

**Set it up once (founder):**
1. On decisionos.biz or in the app, **Register** a separate workspace for
   review, for example "DecisionOS Review", with an **email and password** you
   control. Sign-up confirms a mobile number by code; use your own.
2. Sign in to it once and give it a little real-looking work: speak or type two
   or three decisions to Dex, add a task and a teammate. A reviewer who opens an
   empty Desk sees an app that "does nothing".
3. Keep the password unchanged until the review is approved.

Then choose **"All or some functionality is restricted"** and paste:

```
1. Open the app. On the sign-in screen, tap "Email & Password".
2. Email: <reviewer email>   Password: <reviewer password>
3. You land on the Desk of a workspace set up for review.
To try voice: slide the round handle in the middle of the bottom bar to the right to record a decision, or to the left to ask Dex a question. Allow the microphone when asked.
```

Sign-in by mobile is an OTP to an Indian number, which a reviewer abroad cannot
receive. That is why the reviewer signs in with email and password.

---

## Message to testers (internal or closed test)

```
Hi <name>,

I'm getting DecisionOS ready for the Play Store, and Google needs a small group to use it for two weeks first. Would you help?

1. Open this link on your Android phone and tap "Become a tester": <opt-in link from Play Console>
2. Install DecisionOS from the Play Store page that opens.
3. Keep it installed and stay opted in for the full 14 days. Leaving early restarts Google's clock for everyone.
4. Use it a few times a week: speak a decision, ask Dex something, check the Desk.
5. Tell me anything that breaks, confuses you or feels slow. A screenshot is perfect.

Thank you!
```

The tester needs a Google account (Gmail) on the phone, and the email you add
to the test must be **that** account.

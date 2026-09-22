# JOURNEY-1 — walk DecisionOS the way our customers do

Started 2026-09-22 on `karma-redesign` (after pulling Yokesh's 4 commits, `fda0b66`).
Lead: this session. Testers: subagents (`.claude/agents/journey-walker.md`,
`.claude/agents/first-timer.md`). This file is the run's memory — it is ticked
as the run goes, so it survives a context compaction.

**Why:** PILOT-1's five problems lived *between* screens, people and days. Our
checks look at one control at a time; this walks whole jobs, with real saves.

**The phone comes first.** Customers use the phone app more than anything else,
so the report gives the phone its own section near the top, and every phone
finding says which phone: iPhone engine / Android / small (360) / big text / iPad.

---

## 1 · Read first (done)

- [x] `docs/DECISIONOS_FULL_AUDIT_PLAN.md` — control-by-control audit, writes blocked. We check whole jobs.
- [x] `docs/BROWSER_SCENARIOS_0921.md` — 26 steps, 3 people, clicked by hand → our smoke test.
- [x] `docs/DecisionOS_UI_Bug_Report.xlsx` — known issues; testers mark "already known", the lead drops them in the merge.
- [x] `docs/DecisionOS_Page_Feature_Map.md` — coverage check.
- [x] `backend/scripts/ux_login.py`, `frontend/scripts/lib/auth.mjs`, `backend/scripts/ux_engine_multiuser_0921.py` — sign-in and wizard patterns, reused in the kit.
- [x] PILOT-1 commits + `docs/PILOT1_OPERATING_SCORE_FOR_CLIENT.md`.

## 2 · The test setup (built once, shared)

Everything lives under `.audit-artifacts/journey-1/` (git-ignored).

| Piece | What | Where |
|---|---|---|
| MongoDB | **A local container** (`dos-journey-mongo`, mongo:7, port 27777). Never Atlas, never `founder-os-58`. | `docker ps` |
| Baseline DB | `dos_journey_base` — `seed_demo` (Sharma Textiles, 4 people, AI consent granted by the seed) + `scripts/seed-demo-data.mjs` + 5 AI-captured decisions. Dates relative to today. | snapshot |
| Worlds | **One private copy of the baseline per journey that saves** — DB `dos_journey_wNN`, backend `:81NN`, frontend `:51NN` (production build, forwards `/api` to its backend). Numbers can't be moved by another tester. | `kit/world.sh N` |
| Shared world | `:5100` → `:8100`, DB `dos_journey_audit` (smoke test runs here) | `kit/backend.sh`, `kit/serve.mjs` |
| Backend env | `DEV_OTP_IN_RESPONSE=1`, rate limits off (default), and **every messaging key blanked for the process**: APM SMS, Twilio, WhatsApp, SMTP, Resend, Sentry. `backend/.env` is **not edited** (process env wins — `load_dotenv` does not override). No push provider exists in the backend. | `kit/world.sh` |
| Frontend | `npm run build` (production, service worker included), served locally; `build-rel` calls `/api` on its own origin. | `build/`, `build-rel/` |
| Kit | `signIn(person)` (demo seat) · `signInByPhone(phone)` (the real way: number + dev code) · `open(surface)` desktop / phone390 / phone360 (touch, isMobile) · `j.step(page, name)` screenshot + console errors + failed/4xx/5xx + overflow + taps under 44 design-px + cut-off text + under-the-dock + time · `j.stepAtBottom` · `j.finding({...})` · `apiAs(person)` for reading numbers · `throttle(page)` | `kit/journey.mjs` |

Deviations from the brief, and why:
- **Smoke test:** `backend/scripts/ux_engine_multiuser_0921.py` (Yokesh's scripted version of the same three-person scenario, written the same day) runs as the smoke test instead of re-scripting the 26 hand-clicked steps: it covers sign-up + typed interview + build, invites, decision → workflow + tasks, member completes a task, approval-before-start, a second industry. Steps it does not cover (weekly repeat, dependent task, date move refused, sign-in by mobile) are covered by J6/J10/J12.
- **Python Playwright** had no browser installed; the smoke run borrows the JS Playwright's Chromium through a one-file shim (`kit/pw_shim`). Nothing downloaded for it.
- **Fair numbers:** instead of "one company per saving journey" or strict ordering, each saving journey gets its **own full copy of the seeded world** (same company, same four people, same demo seats). A count finding still has to reproduce on a fresh copy with nobody else saving before it goes in the report.
- **Tester types:** the two definitions are written to `.claude/agents/`, but a session only loads agent types when it starts, so this run spawns `general-purpose` agents with the same model (sonnet for walkers, opus for first-timers) and has each read its definition file first as standing instructions. The effort level cannot be set per spawn from here.
- **MongoDB open files:** the container hit "Too many open files" while copying worlds (each world is ~44 collections); recreated on the same data volume with `--ulimit nofile=1048576`. No data lost.
- Local-only boot note (not a product finding): `write_test_credentials` fails on `/app/memory` (an Emergent path) — it is the last boot step, nothing after it is skipped.

- [x] MongoDB container up
- [x] Backend on the throwaway DB, messaging blanked, seeded
- [x] Demo data + decisions seeded; baseline snapshot `dos_journey_base`
- [x] Production build served; kit self-test passes (desktop + phone, a private world)
- [x] Smoke test (`ux_engine_multiuser_0921.py` on :5100): PASS through sign-up → typed interview → build (pipelines fit a textile mill, 16/19 stages carry work) → 2 people added → invite sign-in. Then the **harness** crashed (Python Playwright driver vs the borrowed Chromium: `TargetClosedError` on a new page) — not the app. The rest (decision → approve, approval-before-start, repeat, dependent) is walked by J3/J5/J6. The seeded AI captures (5 decisions) and the kit self-test confirm capture, Desk and sign-in work.
- [x] WebKit installed for the iPhone engine (J13): `npx playwright install webkit` (62.8 MiB) succeeded

## 3 · Testers and waves

`journey-walker` (sonnet, medium): scripted Playwright journey, then reads its
screenshots a handful at a time and asks the nine questions.
`first-timer` (opus, medium): J1, J2 — walked by LOOKING (screenshot → decide → tap).
Up to 5 at once; drop to 3 if pages time out. 30 minutes per journey; what is not
walked in time is listed as "not covered".

Each journey with a desktop main path **re-runs the same script on the phone**
(390×844, key screens at 360×640) in a fresh world: phone world = 20 + N.

| Wave | Journeys (world) |
|---|---|
| 1 | J1 (1) · J2 (2) · J3 + phone (3, 23) · J6 (6) · J7 + phone (7, 27) |
| 2 | J4 (4) · J5 + phone (5, 25) · J8 + phone (8, 28) · J9 + phone (9, 29) · J10 (10) |
| 3 | J11 (11) · J12 (12) · J13 (13, plus sub-worlds 30+) |

- [x] Walks (rolling, 5 at a time) — all 13 walked: J1, J2, J3 (+phone), J4, J5 (+phone), J6, J7 (+phone), J8 (+phone), J9 (+phone), J10, J11, J12, J13a (installed-app mechanics), J13b (iPhone engine, slow Android, big text, Hindi/Tamil 360, iPad, touch). J6, J12 and J13b ran past the box and were asked to wrap up; what they didn't reach is in the report as not covered.
- [x] Setup fix mid-run: seeded people had no normalised phone (seed-only; `phone_norm` backfilled in every world) — phone sign-in works
- [x] Setup artifact: the demo seeder was run twice (the second time for AI decisions) and duplicated 2 tasks + 1 complaint in the baseline — findings about those duplicates are dropped
- [ ] Wave 2 walked
- [ ] Wave 3 walked

## 4 · The journeys

Desktop = 1440×900. Phone = real mobile emulation (touch, isMobile) at 390×844;
key screens again at 360×640.

- **J1 · First day, phone** (first-timer). Sign up from the phone: code, company, interview, build → Desk. Unprompted: add two people, give one a task, tell Dex a decision, find where money goes. Every screen: would they know what to do next?
- **J2 · First day, desktop** (first-timer). Another newcomer, another company. Add a supplier + an expense against it; find and understand the Operating Score; change a category; change the business words (vocabulary). Next day (new session): does it pick up where they left off?
- **J3 · Rajesh's morning, desktop** (+ phone main path). Every number on the Desk against the page it leads to: Due today, Slipping, Decisions, Task approvals, Workflows, every KPI tile, the score and its explanation. Decide decisions from the row and from the popup; approve and reject tasks; counts move; each outcome shows in the Journal.
- **J4 · Rajesh's morning, phone.** Tabbed black card, Show all, the Dex well opening in place, dock, More, notifications, settings, sign out and back in. PILOT-1 typing test: start a task update, switch away 2 min, come back; again with a reload between.
- **J5 · Dex end to end** (+ phone: the phone's well and the dock's Ask). Type a decision → build → review → approve; tasks exist with the right people and dates, and those people see them. A decision with a file (visiting-card image, invoice PDF). A note with nothing to decide. A failure (AI consent off for that company): does it say why and offer a way forward? Voice with a fake microphone WAV (or up to the prompt, rest "not covered"). A few real questions on Dex's page, judged as an owner.
- **J6 · The task loop** (Rajesh, Amit on the phone, an approver). Task with deadline + approve-before-start → Amit sees + is notified, can't start, knows why → approver approves → Amit starts, updates, waiting-on, hand-off, escalate, proof, finish; Rajesh sees each step. Rename, reschedule, finish a repeating task (next appears), a task that waits on another. After every step, both Desks' counts right.
- **J7 · Money** (Sunita, then Rajesh; + phone: Sunita photographs a bill). Supplier in CRM (or a clear refusal); expense with that supplier + a new category on the spot; bill upload + AI read (is it right?); invoice to a buyer, part payment, one left overdue; Rajesh's To collect and Net profit match; an expense over the high-value threshold goes where it should.
- **J8 · Buyers, complaints, workflows, leave** (Priya, Rajesh; + phone: Priya on the road). Add a buyer, log a complaint, move the buyer's stages; complaint visible to Rajesh and in the score; start a workflow (target date), move work, let one get stuck; mark leave, approve it.
- **J9 · Who sees what** (all four + the invited person; + phone: the More panel for each of the four). Every page and every notification link per person; refusals explained; nothing leaked. Hindi and Tamil on the main screens. Very long names; ₹1,00,00,000 and ₹0. Double-tap a save; back button mid-form. Throttled network: progress or frozen?
- **J10 · A team member's own day** (Amit phone, Priya desktop — **sign in by mobile + code**). Non-owner Desk: what's on it, own score and due today make sense, decisions only when they should. My Work, notifications. What they can't open, and whether that's explained. Sign out. Does it feel made for them, or the owner's app with parts hidden?
- **J11 · The invited person and the middle manager** (**mobile + code**). Rajesh invites Karthik Iyer (Production Manager, can approve; fake number, example.com), Amit reports to him. Karthik's first time via the link. Amit's Dex decision goes to Karthik, not Rajesh; Karthik approves one, rejects one; Amit sees both. Amit escalates → reaches Karthik first. Karthik on leave: record what happens to things waiting on him (record only — open question with Yokesh). Karthik's Desk / My Work show his team's work; Rajesh still sees everything.
- **J12 · Together, and at the same time** (**mobile + code**). Priya hands part of a task to Amit → Amit marks it waiting on Sunita → Sunita answers; each sees the right thing. Two browsers side by side: Rajesh reassigns while Amit types an update; two people approve the same item; a task deleted while open. Shared phone: Amit types + signs out, Priya signs in — nothing of Amit's visible. Removing a person with open tasks: where does the work go, who is told. The seat limit: what Rajesh sees when he reaches it.
- **J13 · The installed app** (phone). Reuse `npm run verify:pwa` and `audit:mobile` for mechanics. Standalone mode + notch / home-bar insets (nothing under the status/home bar; dock clears the home bar; every sheet's Save reachable). Install prompt: appears on the third visit, dismissable, doesn't nag, never covers the dock or a Save; name, icon, colours right. Keyboard: every phone form with the height halved on focus — field + Save visible. No signal mid-journey: what shows; a save while offline (task update, expense) queued or refused; network back → exactly once (background-sync queue specifically). Old numbers: 24h cache, 3s network timeout — does a slow Desk show old numbers without saying so? A new version swapped in mid-form. Leaving and coming back on Amit's task (J6) and Sunita's expense form (J7). **iPhone engine**: J4's and J6's phone steps in WebKit (iPhone profile) if installable. **Mid-range Android**: CPU 4× slower + slow 4G — time to usable Desk, typing delay in the Dex well, stutter; >3s without progress is a finding. **Bigger text** 125% / 150%. **Hindi and Tamil at 360.** **iPad** 820×1180 (phone layout) and 1180×820 (desktop layout). **Touch**: sheet scroll vs page scroll, sheets close as a thumb expects, back closes the sheet, double tap doesn't zoom or save twice.

## 5 · On every screen — the nine questions

1. Within five seconds, do I know where I am and what this screen is for?
2. Can I see what I came for? Anything cut off, overlapping, under the dock, too small?
3. Do the numbers agree with each other and with the screen I came from?
4. Did my action visibly work? Did it land where I'd look — for me and for the other person?
5. If I got it wrong, can I fix it?
6. A dead end: a button that does nothing, a link to an empty page, developer words?
7. Would a 45-year-old owner understand every word?
8. More than two seconds without showing it was working?
9. Did I lose anything I typed?

## 6 · Finding format

id · severity (P0 / P1 / P2) · who · surface (desktop / phone 390 / phone 360 / iPhone engine / Android slow / big text / iPad) · journey + step · did / expected / happened · why a real user would care (one sentence, their words) · screenshot(s) · code (if obvious) · bug or judgment call. Known issues from the bug report are marked "already known".

## 7 · Merge, report, fix

- [x] Merge all findings; dedupe; drop already-known — 94 filed → 3 P0 · 18 P1 bugs · 18 P1 judgment · 29 P2; 10 test artifacts, 9 known (lead re-checks so far: J9-02 not reproduced → P2; J3p-01 was a mid-fade screenshot → dropped; J4-01 seed data → setup; J3-04 = J7-05 confirmed in code)
- [x] Re-look at every P0/P1 screenshot; re-run anything that could be the test (timing, stale page, another tester) on a fresh world
- [x] `docs/audit/JOURNEY-1/REPORT.md` — top: journeys walked / finished end to end, the ten things a customer hits first; **the phone app section**; each journey as a short story; not covered
- [x] Commit the report + P0/P1 screenshots only (≤ ~150 KB each); full set stays in `.audit-artifacts/journey-1/`
- [ ] Fix every confirmed P0 and every P1 bug — one commit each; backend fixes `backend:` with `with_test_db` tests; parallel where files don't overlap
- [ ] Judgment calls and P2s listed with a recommendation, not fixed
- [ ] Re-walk the journeys that had fixes; mark each finding fixed / still open
- [ ] Put the stack away: stop worlds + container; `backend/.env` untouched (verify `DB_NAME=founder-os-58` unchanged and not committed)

## 8 · Rules that still hold

Never the pilot's live database. No real messages (every provider blanked; fake
7000xxxxxx numbers; example.com emails). No real payments. AI only where a
journey needs it. Design laws: no `sm:`/`md:` inside `.app-shell`; touch floors
44/48/56; `index.css` owns every value; chips take `--badge-*` triples; visible
focus ring; `.nm-field` inputs. Don't regenerate the desktop pixel baseline.
`mobile/` stays out of every commit. Commit; push only when told.

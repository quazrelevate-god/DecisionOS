# ASK-33 — Dex becomes the Decide door, on the Desk and on the phone

**Branch:** `karma-redesign` · **Built on:** `bb0a9e8` (2026-09-15, current tip of `origin/karma-redesign`)
**Depends on:** `9dcb046` — ASK-32, and `docs/DECISION_DESK_PLAN.md` (Yokesh, 2026-09-15)
**Scope:** Frontend only — the Dex well on `/inbox` at every width, and the Dex FAB on the mobile PWA
**Status:** Awaiting backend developer sign-off, then ready to build

---

## Part 1 — For the backend developer

*This part is the whole review. Two minutes.*

### Bottom line: ASK-33 requests no backend changes

Three things were on the table that would have touched the backend. All three have been withdrawn:

| Originally proposed | Outcome | Why |
|---|---|---|
| Stop the AI reading attached files on the **decide** channel | **Withdrawn.** Plan item 5.4 / ASK-32 1.6 stays exactly as built. | A visiting card attached to "set up a meeting with this company" is precisely the case the feature exists for. The AI must read it. |
| Filter self-raised decisions out of the Decisions column | **Withdrawn.** No change to the column, the query, or `approver_route`. | Already handled — plan item 2.4 puts a capturer's own decision on their Desk as "Waiting on Sunita", not counted in their Decisions number. What was being seen was stale data in the running app. |
| Change where a decision gets approved | **Withdrawn.** Approval keeps the existing endpoints and rules. | The new composer is a second *entry point* to the same flow, not a second flow. |

**What remains is the unbuilt Phase 5 of your own plan, plus a UI rearrangement.** No endpoint, schema, permission, routing rule or AI pipeline is altered.

### ASK-33 builds Phase 5 of `DECISION_DESK_PLAN.md`

Your Phases 1–4 are shipped. Phase 5 is unticked and is almost entirely frontend:

| Plan item | ASK-33 | Note |
|---|---|---|
| **5.1** Result after capture, desktop **and** phone | **Phases 3 and 4** | Both halves, both surfaces |
| **5.2** Failures say why, with Retry | **Phases 3 and 4** | Your own data: 14 of 15 failures were `ai_consent_required` and no screen said so |
| **5.3** My captures — processing / ready / failed / decided | **Out of scope** | Its own ticket later; it is a new view, not a state of an existing one |
| **5.4** Files and photos are read | **Already done** — unchanged by ASK-33 | |

### Why this matters, in your own numbers

From the live-company table in your plan: **15 of 92 captures failed**, and **23 of 79 decisions had nothing to do**. Roughly two captures in five land on a path that currently has no screen. ASK-33 gives all three outcomes a face on both surfaces.

### What ASK-33 consumes — please don't break these

- `POST /voice-notes`, `POST /voice-notes/{id}/submit`, `POST /voice-notes/text`, `POST /transcribe`, `POST /files`
- The BackgroundTask walk `queued → transcribing → structuring → done`, polled every 1200ms, 90s timeout
- The `proposal {tasks, workflows, meetings, reminders, memory_notes}` shape from 1.1
- Approve / reject guards from 1.3, approver routing from 2.1, the `decisions_approve` permission from 2.2
- The `/inbox?decision=<id>` deep link from 1.7
- The `ask` / `decide` channel split, and `dictate` vs `capture` in `useDexCapture`
- Attachments riding with the note **and being read** (1.6 / 5.4)

### Two questions for you

1. **Field names for the three outcomes.** Item 1.4 built `outcome: nothing_to_decide` on the voice note, and "a failed capture says why". ASK-33 renders both. Please confirm the exact fields the client receives for: the success case, the nothing-to-decide case (including the answer text to show), and the failure case (including a machine-readable reason such as `ai_consent_required` so we can link straight to Settings).
2. **The summary counts.** Phase 3 renders "2 tasks, 1 workflow" — the same string item 1.1 already puts on the Desk card. Can the client count these from the proposal payload, or should it use whatever 1.1 uses? We would rather reuse than recount.

### Sign-off

- [ ] Confirmed: no backend change is being requested
- [ ] Confirmed: the dependency list above is accurate and stable
- [ ] Answered: outcome field names
- [ ] Answered: summary counts
- [ ] Noted: DD5 and DD6 are still unticked in "Decisions to confirm", though Phases 3.3 and 4.1 that implement them are ticked — worth closing

---

## Part 2 — What we decided

### The idea in one line

**Decide lives in the well. Ask lives in the Dex icon.** One rule, both surfaces. The Dex well on `/inbox` becomes the place you state a decision — speak or type, attach files, see what came of it, review it — and the Dex FAB on the phone becomes Ask-only.

### The one cost of this, recorded deliberately

On the phone, decision capture now requires being on `/inbox`. In a meeting on `/crm`, the founder taps the Desk in the dock first, then speaks — one extra tap and a page change. This was chosen knowingly, in exchange for the two doors collapsing into one clear rule. Revisit if it bites in real use.

### Four things already exist and get reused, not rebuilt

1. **The channels are built.** KM-54 shipped `channel = "ask" | "decide"` across `Layout.js`, `DexFab`, `DexChat` and `useDexConversation`. ASK-33 removes the *picker*, not the channels — both are still needed, just reached from different places.
2. **The field-that-becomes-a-wave is built.** `FloatingDock.jsx` swaps an input for `<DexWave>` on `(dexMode === "type" || dexDraft || dexTranscribing)`. Port it; don't redraw it.
3. **The review UI is built.** ASK-32 Phase 3 shipped plain task rows with who/due/priority, change-person, change-due-date, remove-item, what-was-said with voice playback, and links to what was created. `DecisionDialog` already opens as a popup on the Desk at 70% of screen.
4. **The phone's expanded surface is built.** `DexSheet.jsx` has idle / recording / understanding states (MPWA-12e §5.6) and already takes a `channel` prop.

### Agreed behaviour — the well, at every width

At rest the well keeps today's exact geometry on both breakpoints. Only the contents change: the `Dex` label, one muted prompt line, and a composer row on the floor — `[+]` · composer · `[mic]`. "Today's read" is commented out, not deleted.

**Desktop:** send expands the well in place, up to the top of the KPI tile grid, and the three outcomes render inside it.

**Mobile:** the well is the **input**; `DexSheet` is the **output**. Send opens the existing sheet in decide mode, and the same three outcomes render in its understanding state. Nothing new is drawn, and the desktop expansion is not ported.

### Agreed behaviour — the mobile FAB

The two-door picker is removed. A tap opens Dex in **Ask** mode directly.

### Explicitly out of scope

- The backend, in every respect
- The Decisions column, its query, and approver routing
- Plan item 5.3, "My captures" — its own ticket
- The `mobile/` Flutter app
- `/brain` itself, beyond remaining reachable

---

## Part 3 — The prompt

*Paste everything between the lines into the Claude Code session, after running `git pull`.*

---

```
ASK-33 — Dex becomes the Decide door, on the Desk and on the phone

Five phases. ONE per commit. Stop after each and wait for my go.

BEFORE ANYTHING: `git pull`. Build on bb0a9e8, the current tip of
origin/karma-redesign.

THIS IS A FRONTEND-ONLY TICKET. No endpoint, schema, permission, routing
rule or AI pipeline changes. If you believe a backend change is required,
STOP and tell me — do not make it.

THE RULE THIS TICKET ESTABLISHES
  Decide lives in the Dex well on /inbox, at every width.
  Ask lives in the Dex icon — /brain on desktop, the FAB on the phone.
One rule, both surfaces. The two-door picker exists because that rule did
not exist; it goes away because now it does.

READ FIRST
  · docs/DECISION_DESK_PLAN.md — the whole file. Phases 1-4 are SHIPPED;
    this ticket builds its Phase 5 (items 5.1, 5.2) and leaves 5.3 out.
    The live-data table is why: 15 of 92 captures failed and 23 of 79
    decisions had nothing to do.
  · pages/Desk.js — the ASK-25 header comment, the hero layout, and where
    InsightWell sits at BOTH breakpoints (order-4 min-h-[150px] on the
    phone, lg:flex-1 in the desktop column)
  · components/karma/InsightWell.jsx — the container being repurposed
  · components/mobile/FloatingDock.jsx ~190-235 — the composer to PORT
  · components/mobile/DexSheet.jsx — the phone's three states
  · components/mobile/DexFab.jsx — the KM-54 picker being removed
  · components/DecisionDialog.js — ASK-32 Phase 3 shipped the review UI
    here. Read it BEFORE Phase 3 and tell me what it already covers.
  · hooks/useDexCapture.js — KM-51 onTranscript, KM-60 meterState,
    ASK-32 1.6 attachments
  · hooks/useDexConversation.js — the ask/decide channels
  · components/Layout.js ~290-340 and ~796-845 — the FAB, the picker and
    the sheet wiring

============================== PHASE 1 · the composer row, BOTH breakpoints

REMOVE "today's read". COMMENT OUT the deskInsight wiring in Desk.js and
InsightWell — do not delete it, do not touch lib/deskInsight.js. Leave a
comment saying ASK-33 retired the call site and the ranker is kept for
possible reuse.

THE RESTING STATE — same geometry as today, at BOTH breakpoints. The well
keeps lg:flex-1 on desktop and order-4 min-h-[150px] on the phone. Only
the contents change:
  · the "Dex" label at the top
  · one muted line: "Tell Dex what you decided — speak or type."
  · the composer row on the floor
Do NOT resize, reflow or restyle the well at rest on either breakpoint. A
screenshot of the resting Desk should differ from today's only in the text
inside this box.

THE FLOOR ROW. Today it is two controls:
  desk-insight-cta — the "Chase it →" Link (kr-pop pill, h-10)
  desk-insight-dex — the circular Brain Link to /brain (kr-pop, h-10 w-10)

It becomes, left to right:
  [+]   [ ————— composer, flex-1 ————— ]   [mic]

  · [+]  a kr-pop circle, 40px like the others. Tapping it reveals TWO
         circles stacked ABOVE it — attach a file, and toggle type/voice
         mode. They animate in; they are not always on screen.
  · composer  the old "Chase it" pill stretched to fill the row. Type
         mode: a text input. Voice mode: <DexWave>. PORT the exact swap
         from FloatingDock, including its KM-51 and KM-53 reasoning — the
         field also appears when a draft exists or while transcribing, and
         is readOnly while transcribing.
  · [mic] the Brain circle becomes the mic, toggling record/stop.

WIDTH IS THE RISK ON THE PHONE. At 360px the row is two 40px circles, two
gaps and the field. Confirm the field still takes a readable sentence and
that nothing overlaps; if it cannot, raise it with me rather than
shrinking a touch target below 44px.

THIS WELL IS THE DECIDE DOOR. useDexCapture on the capture/decide channel;
useDexConversation with channel="decide". On desktop, /brain stays in the
sidebar (nav-brain) so removing the brain shortcut strands nothing.

ATTACHMENTS — behaviour UNCHANGED from plan item 1.6 / 5.4. Any file type.
The ids ride with the note and the AI READS THEM; deliberate, do not
alter. The only new thing is presentation: each attached file shows as a
small removable preview chip in the well.

PERFORMANCE — read KM-60 first. This hook lives inside the Desk component,
which renders an ArcGauge, six StatTiles and three columns. Writing mic
levels to React state ~18x/sec re-renders all of it. Use meterState:false
and pass levelsRef to DexWave, exactly as Layout.js does for the dock.

NOTHING RESIZES IN THIS PHASE, on either breakpoint.

=================================================== PHASE 2 · the expansion

DESKTOP ONLY. On SEND — and only on send — the well becomes the workspace.

  · It grows until its TOP meets the TOP of the right-hand StatTile grid
    (data-testid="desk-kpi-grid"). That grid is the constraint.
  · Everything above it in the left column fades out as it grows:
    desk-brief-greeting, desk-scope, desk-score, desk-gauge.
  · The motion carries inertia — it settles, it does not jump. The fade
    and the growth are one orchestrated move.
  · While the proposal builds, the new space holds a thinking state.
    Surface the REAL stages the note walks — queued, transcribing,
    structuring — from useDexCapture's poll. Do not run a generic spinner
    over a known state machine.
  · It collapses back to resting size when the decision is finished, and
    on Later, restoring the faded elements in reverse.
  · prefers-reduced-motion: no growth, no fade; the expanded state is
    simply painted. Follow the convention at index.css:1972.
  · Below lg NOTHING here applies. The phone's expanded surface is
    DexSheet — Phase 4.

============================================ PHASE 3 · the three outcomes, desktop

This is DECISION_DESK_PLAN items 5.1 and 5.2 for the desktop. A capture
has THREE possible endings and today only one of them has a screen.

FIRST, BEFORE WRITING ANYTHING: open components/DecisionDialog.js and
report back what ASK-32 Phase 3 already covers — plain task rows, change
the person, change the due date, remove an item, what-was-said with voice
playback, and links to what was created after approving. I expect the
review UI is DONE and that this phase only has to summarise and hand off
to it. Confirm before building a second review surface.

OUTCOME A · READY
  · The expanded well shows a summary in the shape of plan item 5.1 —
    "Decision ready for Sunita · 2 tasks, 1 workflow" — plus a small grid
    of counts (tasks, people assigned, approvals, meetings).
  · Derive the counts client-side. Item 1.1 already renders "On approval:
    1 task, 1 workflow" on the Desk card — reuse that logic rather than
    writing a second counter. If neither is possible, STOP and tell me;
    do not request a new backend field.
  · A REVIEW action opens the EXISTING DecisionDialog on this page.
  · A LATER action collapses the well. The decision stays undecided and
    remains reachable through the Decisions column and /inbox?decision=
    <id>, both unchanged — verify that path, do not rebuild it.

OUTCOME B · NOTHING TO DECIDE — plan item 1.4 / DD3
  · No tasks, workflows, meetings, reminders or notes, so no decision
    card exists. The note carries the nothing-to-decide outcome.
  · The expanded well shows Dex's ANSWER, plainly, with a single way out
    that collapses the well. No approve, no review, no empty grid.
  · This is not an error state and must not look like one.

OUTCOME C · FAILED — plan item 5.2
  · Show WHY, in the founder's words, with a Retry.
  · 14 of the 15 real failures were AI consent not given. For that reason
    specifically: "AI is off for this company — turn on AI consent in
    Settings", linking straight to the right Settings tab. Other reasons
    print their own message.
  · Retry re-sends the same capture. Do not make the founder say it again.

Ask me for the exact outcome field names before wiring these — a question
is outstanding with the backend developer. If the answer has not arrived,
build against a clearly-marked adapter function with one place to change,
and say so.

================================= PHASE 4 · the phone — one door, and the sheet

FOUR-A · THE FAB BECOMES ASK-ONLY
Remove the two-door picker from DexFab. A tap opens Dex in ASK mode
directly — no picker, no scrim, no second tap.
  · Delete the PICKS array and the picker branch; remove dexPicker and
    its Escape handler from Layout.js; set the channel to "ask" on open.
  · The CHANNELS STAY. useDexCapture keeps dictate/capture and
    useDexConversation keeps ask/decide — the well needs decide. Only the
    picker goes.
  · REWRITE the KM-54 comment rather than deleting it. It records a
    founder decision and the reasoning that produced it; replace it with
    an ASK-33 note saying the doors collapsed because Decide now has a
    permanent home in the well, and that the consequence — decision
    capture on the phone requires being on /inbox — was accepted
    knowingly. That comment is how the next person understands the
    trade-off instead of re-litigating it.
  · DexSheet's CHIPS are currently a mix of questions and decisions —
    "Tell Suresh to ship the indigo lot before Friday" is a decision.
    With the sheet now reached only by Ask, every chip must be a
    QUESTION. Move the decision-shaped ones out; they belong in the
    well's placeholder, not here.
  · The voice_capture permission check stays exactly as it is.

FOUR-B · THE WELL SENDS, THE SHEET SHOWS
On the phone the well is the INPUT and DexSheet is the OUTPUT. Do NOT
port the desktop expansion, and do NOT redesign the sheet.
  · Sending from the well opens the existing DexSheet with channel
    "decide" — it already takes a channel prop (Layout.js ~841).
  · Its UNDERSTANDING state expresses the SAME three outcomes as
    Phase 3:
      A · READY — the structure echo it already renders, plus the 5.1
          line "Decision ready for Sunita · 2 tasks, 1 workflow". The
          existing Looks right / Fix affordances stay. Review opens the
          decision the way the phone already opens one.
      B · NOTHING TO DECIDE — Dex's answer, one way out. Not an error,
          not an empty structure echo.
      C · FAILED — the reason and a Retry, with the AI consent case
          linking to Settings.
  · SHARE the copy and the outcome adapter with Phase 3. Two surfaces
    printing two different sentences for the same failure is the thing
    this phase exists to prevent.

Everything else in components/mobile/* stays as it is. FloatingDock,
DexChat, DexWave and BottomSheet are read and copied from, not modified,
unless an outcome above genuinely requires it — and if one does, tell me
which and why before changing it.

===================================== PHASE 5 · mobile visual QA and repair

Look at what you built on a phone, find what it broke, and fix it. This
phase is allowed to change layout; the four before it were not.

RUN THE HARNESS
  · `npm run audit:mobile` — every in-scope route at 390x844 AND
    360x640. /inbox is a primary route, so the well's new contents WILL
    move this baseline. That is expected; read the diffs, do not
    regenerate.
  · `npm run verify:dex` — the sheet's three states, driven with
    Chromium's fake audio device.
  · `npm run verify:nav` — the dock and the FAB, which Phase 4 changed.
  · `npm run verify:brief` — the Desk.

THEN LOOK. Screenshot /inbox and the Dex sheet in every outcome state at
390x844 and 360x640, light and dark, and check by eye:

  · NO horizontal scroll anywhere. The audit tracks this at warn level;
    treat it as a failure on the surfaces this ticket touched.
  · The composer row at 360: two 40px circles plus the field, nothing
    overlapping, the field still usable, the mic never clipped.
  · Nothing overlaps in the sheet: the waveform must not run under the
    stop button; outcome text must not collide with the actions; the
    summary counts must not collide at 360.
  · Nothing is clipped. Long text wraps or scrolls in its own container.
    A truncated failure reason is a bug — that message is the whole
    point of Outcome C.
  · Touch targets hold at 44px minimum (min-h-touch, MPWA-01 §5.1);
    56px for anything that commits (Approve, Retry).
  · Safe areas hold: the sheet clears the home indicator, scroll
    containers keep the dock clearance index.css already defines (KM-32,
    7.5rem). Use the numbers already there; do not invent new ones.
  · The sheet never exceeds the viewport at 360x640 WITH THE KEYBOARD
    OPEN in type mode. That is the tightest case and the most likely to
    be broken.
  · The FAB with no picker: it must not look like a dead button. Check
    its pressed and recording states still read correctly.
  · Dark mode, specifically on the outcome states — a failure message is
    exactly the kind of thing that gets a light-mode-only colour.

FIX WHAT YOU FIND by resizing, wrapping, stacking or scrolling within the
existing design language — the radius scale, the touch tiers, the surface
recipes. Do not introduce a new breakpoint; `sm:` and `md:` are banned
inside .app-shell (tailwind.config.js lines 1-40), so use `xs:` (400) or
restructure.

REPORT what you found and what you changed, with before/after
screenshots. If something needs a design decision rather than a repair,
STOP and show me instead of guessing.

============================================================== ALL FIVE PHASES

DO NOT
  · change anything in the backend
  · change the Decisions column, its query, or approver routing
  · change how the AI treats attachments
  · remove the ask/decide CHANNELS — only the picker goes
  · build plan item 5.3 ("My captures") — separate ticket
  · redesign DexSheet, or port the desktop expansion to the phone
  · build a second review UI when DecisionDialog already has one
  · touch the mobile/ Flutter app
  · delete lib/deskInsight.js
  · remove an existing data-testid. New nodes get new ones:
    desk-dex-composer, desk-dex-plus, desk-dex-mic, desk-dex-attach,
    desk-dex-mode, desk-dex-summary, desk-dex-review,
    dex-outcome-ready, dex-outcome-nothing, dex-outcome-failed,
    dex-outcome-retry
  · add a dependency

DONE WHEN (per phase)
  1. eslint clean on every file touched
  2. npm run build succeeds
  3. npm run audit:mobile — Phase 1 should NOT move either baseline
     beyond the text inside the well, so investigate any larger diff.
     Phases 2-5 move things ON PURPOSE: report the failures and do NOT
     regenerate the baseline in the same run. I approve first.
  4. Desktop, 1440, end to end: speak, stop, read the transcript back,
     edit it, send, watch the expansion, get Outcome A, review, approve,
     watch it collapse. Then by typing. Then with a file attached,
     confirming the AI DID read the file.
  5. Force Outcome B (say something with nothing to act on) and Outcome C
     (turn AI consent off) on desktop and confirm both have a real screen
     and a way out.
  6. Press Later instead of approving, reload, reopen from the Decisions
     column.
  7. Phone, 390x844 and 360x640: the FAB opens Ask with no picker; the
     well captures a decision; the sheet shows all three outcomes;
     nothing overlaps or clips; keyboard-up tested.
  8. npm run verify:dex and npm run verify:nav pass.
```

---

## Appendix — what was read to write this

Current tip `bb0a9e8` of `origin/karma-redesign`, verified 2026-09-15. Nothing pushed after it.

- `docs/DECISION_DESK_PLAN.md` — the full plan, the live-company data table, the unbuilt Phase 5
- ASK-32 (`9dcb046`) commit body, Phases 1–4
- `bb0a9e8` commit body
- `frontend/src/pages/Desk.js` — hero layout, well placement at both breakpoints
- `frontend/src/components/karma/InsightWell.jsx`
- `frontend/src/components/mobile/FloatingDock.jsx` — the composer
- `frontend/src/components/mobile/DexSheet.jsx` — the three states, the contextual chips
- `frontend/src/components/mobile/DexFab.jsx` — the KM-54 two-door picker
- `frontend/src/components/Layout.js` — the FAB/picker/sheet wiring, `meterState:false`
- `frontend/src/hooks/useDexCapture.js`, `useDexConversation.js`
- `frontend/scripts/audit-mobile.mjs` — the in-scope route list and widths
- `frontend/scripts/verify-dex.mjs` — the three-state gate

---

## Progress

*Written 2026-09-16 before a context compaction, so the working state does not
depend on a conversation summary. Branch `karma-redesign`, built on `bb0a9e8`.*

### Committed (local only — NOT pushed; Railway deploys on push)

| Phase | Commit | What |
|---|---|---|
| 1 | `e40aff4` | The Desk's Dex well becomes the Decide composer ([+] · composer · mic, chips, still-at-rest wave, [+] inline swap below lg) |
| 2 | `db09b42` | On send, the desktop well grows to the KPI grid's top; real stages; reduced motion painted |
| 3 | `e638b86` | The three endings on desktop (ready / nothing / failed), Review → existing DecisionDialog, Retry; carries two fixes below |
| — | `c32e7bd` | This Progress section |
| 4-B | `b6965fd` | The well sends, DexChat shows: the hand-off and its guard, endings as transcript messages, the split late-ending toast, `verify-dex.mjs` rewritten with `npm run verify:dex`, five stale DexSheet comments corrected; carries the DexChat stuck-sheet fix |
| 4-A | `ee53663` | The FAB opens Ask directly: KM-54's picker removed from DexFab and Layout, its reasoning rewritten as the ASK-33 note, verify-nav's Dex section rewritten against DexChat; the end-of-Phase-4 build, full audit and route comparison |
| 5 | `0beffcb` | Phone QA: the failure notice that never covers a control, dark mode removed, measured touch sizes, the draft behind [+], the two-line field, long reasons, chip spacing; the framer-motion write-up |
| 33.1 | the commit that adds this row | The dock says which Dex it is, one capture at a time, no dead Settings link, the desktop baseline regenerated on `0beffcb`, and the note's shape confirmed from the backend |

**Nothing is pushed** — the founder decides when this goes to Railway.

### The two fixes carried by `e638b86` (Phase 3)

**[+] pointer-events fix — a Phase 1 defect.** (RETIRED 2026-09-16: the new
composer row has no reveal — see "Outstanding, next session".) The shut [+] reveal's two
circles had `pointer-events-none`, but the absolutely positioned `<div>` that
holds them did not, and it keeps their layout size. On desktop that box sits
over the area above [+] — exactly where an outcome's actions (Got it, Review,
Later, Retry) render — and on a phone (inline swap) it sits over the composer's
left edge, so a tap there never reached the text field. Fix in
`pages/desk/DeskDexWell.jsx`: the container is `pointer-events-none`, and
`POP_OPEN` adds `pointer-events-auto` so the circles opt back in only while
open. Found by a real Playwright pointer click; a scripted `element.click()`
walks straight past overlays and had passed.

**Chip-slot fix — a Phase 2 gap exposed by Phase 3.** Phase 2 set
`prompt = growing ? null : …`, hiding the whole prompt slot (attachment chips
included) while the well is expanded. That was harmless while the well always
collapsed at an ending; Phase 3 keeps it open on an outcome, so a file attached
for the next capture became invisible. Fix: chips render whenever
`chat.pendingFiles` is non-empty; only the prompt line gives way while expanded.

### Fixes inside `e40aff4` (Phase 1) that the diff does not explain

- **[+] containment invariant** (founder, 2026-09-15; RETIRED 2026-09-16 with
  the reveal itself): the reveal must stay
  inside the well at every width. Phone well is 150px and [+] sits ~73px from
  its top, so a vertical stack of two 44px circles escapes onto the KPI strip
  → **below lg the circles swap inline into the composer's slot** (the pill
  fades); **from lg they stack upward** (~147px of room above [+] for 96px).
- **Still-at-rest wave.** At rest the composer draws DexWave's ink hairline
  once; `<DexWave>` mounts only while listening or thinking. The animated idle
  wave made the mobile audit hang forever (see "Harness facts") and ran a frame
  loop all day on a Desk left open.
- **No `before:` pseudo hit areas.** Below lg the app's own rule
  (`index.css` `--control-h-sm`, on `button`, `a[data-testid]`, inputs) already
  makes the circles 44px; the extra `before:-inset-0.5` stuck 2px out and the
  audit counted horizontal overflow (3 new findings per /inbox route at 390,
  3 more at 360). Removed.

### Phase 5 list (accumulated — do not lose)

*All of this is now done or retired — Phase 5 addressed the rest, ASK-33.1 did
the dock's placeholder (the last open one), and three entries were retired with
the [+] itself (see the note under the list). Kept as the record of what was
found and why.*

1. **Composer field grows to at most TWO lines** so the founder can read back
   the sentence before sending. It is a resize, so it belongs to Phase 5.
   Keep [+] visible while typing (attach mid-compose is the read-the-file flow).
   Today at 360px the field holds ~150px of text at the phone's forced 16px —
   about half of "Tell Suresh to ship the indigo lot before Friday".
2. **Dark mode on the well and on every outcome state** — not yet looked at.
3. **Outcome C with a non-consent reason** prints the backend's raw
   `str(exception)`; only the consent message has been checked for wrapping.
   Check a long technical reason wraps/scrolls in its container, and whether it
   needs friendlier copy (may be a copy decision — stop and ask if so).
4. **Attachment chips on the phone**: the remove button becomes 44×44 via the
   global rule, so a chip grows to its 176px max quickly — check spacing and the
   horizontal scroll of several chips at 360.
5. **Touch tiers on the phone's outcomes** (4-B, DexChat): Review, Retry, Got it
   and Not now are h-11 (44px); the ticket wants 56px for anything that commits
   (Retry). Desktop outcome buttons are h-10. The Settings link in the ink
   bubble is inline text that the global `a[data-testid]` rule makes 44px tall —
   check it by eye.
6. ~~Harness: `npm run verify:dex` missing~~ — resolved in 4-B. The script was
   testing the unmounted DexSheet; it was rewritten against DexChat and the npm
   entry landed with it.
7. **Dark mode on the sheet's outcome messages and the late-ending toasts**
   (4-B): the ink bubble is the same in both themes, but the rose warning glyph,
   the white Review/Retry pill and Sonner's error toast need a look.
8. **Late-ending toasts at 360** (4-B): Sonner draws them at the top. Seen at
   360x640: the persistent failure toast (a three-line reason) wraps cleanly
   but sits over the score row and the notification bell until it is
   dismissed. Whether that is acceptable, or the toast belongs elsewhere on a
   phone, is a design call — ask.
9. **The dock's placeholder contradicts the one-door rule** (seen after 4-A;
    done in ASK-33.1):
    on the Ask sheet the dock's text field reads "Ask Dex, or state a
    decision…", but a decision stated there goes to POST /ask and creates
    nothing — Decide is the Desk's well now. FloatingDock is outside ASK-33's
    edits, so it was not changed. A copy decision: a placeholder per channel, or
    plain "Ask Dex…".

**RETIRED by the new composer row (founder, 2026-09-16).** Three entries existed
only because [+] expanded, and the row that replaces it has no reveal at all —
attach is its own circle (see "Outstanding, next session"):
- the [+] circles overlapping the KPI strip on the phone (Phase 1's inline swap,
  and the containment invariant that produced it);
- the [+] pointer-events / invisible-hitbox fix (carried by `e638b86`);
- the typed draft hidden while [+] is open on a phone (was item 4 of this list;
  Phase 5's draft peek).
The records of each stay below as history — there is simply nothing left in them
to do, and the code they describe goes when the row is rebuilt.

### Phase 4 — the split (revised 2026-09-16 against the REAL sheet)

- **The premise was corrected before building.** `DexSheet` is **not mounted
  anywhere**: `<DexSheet>` left Layout in `97c2bfc` (KM-23). Layout imports and
  renders only `DexFab` and `DexChat` (Layout.js ~41-42, ~796, ~836), confirmed in
  the running app at 390 and 360 (FAB → picker → Decide → `dex-chat`, never
  `dex-sheet`). The only reference left is the re-export in
  `components/mobile/index.js`. **DexSheet and that re-export are kept** —
  deleting them is a separate founder decision. The live sheet has no
  "understanding state": DexChat is a transcript, the dock is its composer and
  the FAB its mic/send. The five comments that described DexSheet as live
  (DexFab.jsx, useDexCapture.js, DexCaptureBar.js, fixtures/mobile/_shared.js,
  DeskDexWell.jsx) were corrected in 4-B.
- **4-B ADDITIVE — built; see "Phase 4-B as built" below.** The two-door picker
  is still there, so nothing was taken away. Commit.
- **4-A DESTRUCTIVE — built.** DexFab lost PICKS, the picker branch, its scrim
  and the MW-04 Escape handler that existed only to dismiss the picker (it lived
  in DexFab.jsx, not Layout). Layout lost `dexPicker` and `onPick`; closed, the
  FAB sets the channel to "ask" and opens the sheet in one tap. Channels
  untouched; the `voice_capture` check unchanged. KM-54's comments were
  rewritten, not deleted: DexFab.jsx carries the ASK-33 note (the founder's
  two-door instruction and its reasoning, why the doors collapsed, and the
  consequence accepted knowingly — capturing a decision on the phone requires
  /inbox); Layout.js's two KM-54 notes and DexChat's header note point to it.
  No chips to move (DexChat has no chip list). `scripts/verify-nav.mjs`'s Dex
  section was rewritten against DexChat; its inherited All Apps failures were
  left alone, so `npm run verify:nav` still stops at line 203 before reaching
  that section, which is therefore also run on its own from a scratch harness.
  **Test ids removed: `dex-pick-ask`, `dex-pick-decide`** — the picker's own
  circles. The ticket both says "delete the PICKS array and the picker branch"
  and "do not remove an existing data-testid"; the explicit deletion was
  followed, and nothing else was removed. DexChat's empty-transcript Decide copy
  ("Say or type the decision.") is now unreachable, since a Decide sheet always
  opens with an adopted capture — left as is.
- **HARD STOP:** if at any point the phone loses Dex — the FAB no longer opens
  Ask, or the well no longer reaches a sheet that shows Decide outcomes, on
  390×844 or 360×640 — stop, do not commit, and report.

### Phase 4-B as built (founder decisions, 2026-09-16)

- **On the phone the well is the input and DexChat is the output.** Below lg
  the well sends the capture itself (held recording, words, files — unchanged)
  without following it, and hands `{ channel: "decide", noteId, text, files,
  error }` to Layout on the existing `dos:open-dex` event. Layout's
  `chat.adopt()` puts the words and "Reading it now…" into the sheet's
  transcript and follows the note with Layout's Dex; then the sheet opens on
  Decide. A send that never reached the pipeline is handed over as a failed
  ending with Retry.
- **Endings are transcript messages** — not a state the sheet switches into
  (KM-23's ghost-card precedent), not a pinned result. `useDexConversation`
  writes each Decide ending as `{ role: "dex", text, outcome }` and DexChat draws
  it in the ink bubble: READY = the 5.1 line, the echo, Review (closes the sheet
  and replaces to `/inbox?decision=<id>`, which the Desk opens in
  DecisionDialog); NOTHING = Dex's answer, Got it; FAILED = the reason
  (role=alert, wraps), the Settings link, Retry, Not now. One copy for both
  surfaces: `lib/dexOutcome.js` (`readyLine()` is now the only 5.1 builder; the
  old `captureError` consent sentence is gone). Each failure keeps its own
  capture, so Retry on an older message re-sends that one, and the message then
  stops offering Retry. Testids reused: `dex-outcome-ready|nothing|failed|retry`;
  new: `dex-outcome-review`, `dex-outcome-dismiss`, `dex-outcome-settings`,
  `dex-outcome-reason`.
- **THE GUARD (founder).** The hand-off counts only when Layout calls
  `preventDefault()` on the event, which it does after `adopt()` has put the
  capture in the transcript and started following its note, and after telling
  the sheet to open. Unacknowledged — no listener, not the mobile shell, or
  Layout still reading another note — the well keeps Phase 1's behaviour: it
  follows the note itself and reports the ending as a toast. The phone toast is
  gone only on the success path.
- **ONE NOTE AT A TIME.** `useDexCapture.follow()` follows a single note: a new
  follow retires the one in flight (a recording's transcript poll shares the
  same generation). So `adopt()` and `retry()` refuse while that hook is reading
  a note, recording or transcribing (`isReading()` in lib/dexOutcome), and a toast
  Retry pressed then keeps its toast and says "Dex is still reading your last
  one — retry once it's done." verify-dex E sends two overlapping captures and
  expects both endings reported.
- **Late endings (founder).** An ending that lands after the sheet is closed is
  a toast, never a sheet that re-opens itself (KM-23). READY and NOTHING TO
  DECIDE are transient: a ready decision is not lost (the Decisions column,
  `/inbox?decision=<id>`, and ASK-32 2.3 notifies the decider), and nothing is at
  stake in the other. **FAILED is a persistent toast** — no auto-dismiss — with
  the reason, Retry and Dismiss, until the founder dismisses it: a failed capture
  creates no decision, so nothing else records it. **This persistent toast
  stands in for plan item 5.3 ("My captures") until 5.3 is built; 5.3 is its
  proper home.** (`lib/dexOutcomeToast.js`; the well's kept captures use the same
  helper.)
- **Layout refreshes the Desk at every Decide ending** (`onEnding` →
  `refreshAfterCapture`), since the well no longer polls a handed-off note.
- **FIX carried by 4-B — a pre-existing DexChat defect, found by the 4-B gate.**
  See "The framer-motion exit trap" below for the full write-up.
- **Known limit, NOT changed — needs a founder call.** The single-note follow
  also bites where 4-B added no guard: a second send from the desktop well
  while the first is still being read (Phases 1-3), or from the dock while an
  open Decide sheet is still reading (KM-54's door) — the earlier note then
  stops being polled and its ending is not reported. Options: block the send
  while reading, or let useDexCapture follow several notes.

### Phase 5 as built (the founder's order, 2026-09-16)

**Must fix**

1. **The persistent failure no longer sits over the score row and the bell.**
   Phase 4's no-auto-dismiss Sonner toast did, at 360, indefinitely. Sonner
   cannot place one toast apart from the rest, so a failed capture is now a
   notice from a small store (`lib/dexFailureNotices.js`), drawn by
   `components/mobile/DexFailureNotice.jsx`:
   - **Sheet closed:** docked just above the dock (`bottom: 6.25rem` + safe
     area, inside the shell's gutters, z-40 so dialogs and sheets always cover
     it). Its height + 12px is published as `--dex-notice-space`, which
     `.pb-dock` adds to the page's bottom clearance. Measured on the fixtures:
     390x844 — notice 606–744 (139px), dock at 756, FAB at 764; 360x640 —
     402–540, dock at 552, FAB at 560. Never over the header, the bell, the
     score row, the dock or the FAB. Scrolled to the end, the lowest control on
     the page ends above the notice (390: 541 vs 606; 360: 337 vs 402).
   - **At rest it does sit over the lower Decisions rows** (390: rows d_1–d_4;
     360: row d_0), the way the dock already does — they scroll clear of it, but
     they are under it until then. If "never covers anything interactive" has to
     hold at rest as well, the alternative is an in-flow banner at the top of
     the page (AnnouncementBanner's slot): it covers nothing, but it can scroll
     out of sight. A founder call.
   - **Sheet open:** the notice moves into DexChat's own flow, between the
     transcript and the plus, and covers nothing there.
   - Retry 56px, Dismiss 44px. A Retry pressed while Dex is still reading
     another capture keeps the notice and says why. Late READY and
     NOTHING-TO-DECIDE endings stay transient Sonner toasts.
   - **Found while looking, fixed:** a failure that landed while the sheet was
     closed was ALSO left in the transcript, so the next Ask sheet showed it
     twice — the message and the notice, two Retries for one capture. An ending
     Layout reports elsewhere (a toast, the notice) is now not written into the
     transcript (`onEnding` returns true), and a Retry from the notice with the
     sheet closed is quiet: no "Reading it again…" into a transcript no one is
     reading, and if that re-send fails before reaching Dex, the failure comes
     back as a notice.
2. **Dark mode removed** (founder: dark mode was not intended; remove the
   functionality and the switch). Gone: `hooks/useTheme.js`; Settings → Account's
   Appearance card (`settings-theme-card`, `settings-theme-toggle`); the Login
   page's switch (`login-theme-toggle`); AllAppsPanel's dead theme branch, props
   and icons; `index.js`'s pre-paint "dark" (it now clears a saved
   `decisionos-theme` instead); `offline.html`'s `prefers-color-scheme: dark`
   block; and the toast renderer's "system" theme (now always light — a dark-OS
   phone was getting dark toasts). **Kept:** the Dex room. `/brain` and `/dex`
   still set their own `dark` class (NM-17 / KR-5, "inside the ink") — a page
   design, not a mode — so the `.dark` CSS it relies on stays. The well and
   every outcome now render light only.
3. **Touch sizes, measured at 390 and 360:** Review 56, Retry 56 (the sheet's and
   the notice's), Approve 56 and Reject 56 (DecisionDialog: `h-14` below lg,
   `h-12` from lg); Not now 44, Got it 44, Dismiss 44, the Settings link 44.
4. **The draft behind [+].** Focusing or typing into the field puts the [+]
   circles away — so on iOS, where tapping [+] does not take focus from the
   field, the next keystroke brings the field straight back — and while the
   circles are out, the end of the draft shows in the prompt line
   (`desk-dex-draft-peek`).

**If they came easily — they did**

5. **The composer field grows to at most two lines.** The well's field is a
   `<textarea rows=1>` sized from its own computed line height and padding, so
   the phone's 16px text and the desktop's 14px both stop at exactly two lines
   and scroll inside after that; Enter still sends. The pill takes the field's
   height while typing (fixed 40px while it draws the wave) and rounds less at
   two lines. On a phone the well grows by the extra line while two lines are
   typed — the one place Phase 5 moves layout.
6. **Long non-consent failure reasons wrap.** A new dev-only fixture ending,
   `dos_fixture_capture = "failed_long"`, fails with a raw exception string
   carrying unbroken URL / object tokens. Checked in the desktop well, the
   sheet's message and the docked notice at 390 and 360: it wraps (no ellipsis,
   no line clamp, no horizontal overflow). The copy stays the backend's raw
   text — making it friendlier is a separate copy decision. Found while
   looking, fixed: in the desktop well a nine-line reason pushed Retry and Not
   now half under the composer, so the reason now scrolls inside its own block
   and the actions stay whole beneath it; and the docked notice caps a long
   reason at six scrolling lines, so it stays compact on a 640px screen.
7. **Chip spacing.** Attachment chips sit on the 8px `touch-gap` token (was
   6px); three chips at 360 scroll inside the well, each remove clears 44px,
   and the well keeps its size.

**Gates (Phase 5, on the fixtures)**

- `npm run verify:dex` 112/112 at 390 and 360 (now covering the notice: above
  the dock, clear of the FAB, its scroll clearance, its move into the sheet, no
  duplicate). The Phase 5 scratch checks all pass at 390 and 360 (and 1440 where
  it applies); the Phase 1–3 scratch checks all pass; verify-nav's Dex section
  passes.
- Scoped audits: `--only inbox` 40 failing + 2 warnings, no count changed from
  4-B, the same 6 desktop diffs, 0 console errors; `--only settings` 7 findings
  as in the clean full run, 0 desktop diffs. Baseline not regenerated.
- `npm run build` succeeds with the same warnings as at the end of Phase 4.
- Inherited and left alone: `verify:nav`'s All Apps checks (stops at line 203)
  and `verify:brief` (stops at line 34, see above).

### ASK-33.1 (founder, 2026-09-16)

1. **The notice stays above the dock** — accepted as is: it only appears after a
   failed capture, and covering a few Decisions rows during an exception state
   until dismissed is what the dock already does. No top banner: something that
   scrolls out of sight is the silent failure this was built to prevent.
2. **The dock's placeholder is channel-aware.** Ask: "Ask Dex anything…";
   Decide (the well's hand-off): "Tell Dex what you decided…", with the
   aria-label to match. One string for both ("Ask Dex, or state a decision…")
   promised the two doors ASK-33 removed. Nothing else in the dock or the FAB
   implies a second door (checked: no `dex-pick-*`, and DexFab's KM-54 note is
   the ASK-33 rewrite).
3. **One capture at a time, enforced.** No concurrent polling: a second send is
   REFUSED while Dex is still reading, in the founder's words ("Dex is still
   reading your last one — send this when it's done"), and released the moment
   the first note ends. Why it matters: the capture would still be sent, so a
   decision lands in the Decisions column either way — but a FAILURE has nowhere
   to land, so the second send could swallow the first one's failure, which is
   plan item 5.2 through a side door. Enforced in `useDexConversation.ask` (the
   sheet's own composer says it in the transcript) and in the Desk well's
   `send()` (a toast). The well asks Layout whether the SHEET's Dex is reading
   over a `dos:dex-state` event — the same way the hand-off is taken — because
   below lg the note being read belongs to Layout's hook, not the well's.
4. **The dead Settings link is gone — the link, not the reason.** Chosen: plain
   words that name no screen ("AI is off for this company — an owner has to turn
   on AI consent before Dex can read anything"), because Settings has no
   AI-consent section, so pointing at Settings generally moves the dead end one
   tap further in rather than removing it. `AI_CONSENT_HREF` and the link copy
   stay in `lib/dexOutcome.js` with a note to restore the link in
   `failureReason()` once the screen exists. `lib/api.js`'s own 451 toast carried
   the same dead anchor ("Open Settings" → `/settings#ai-consent`) and lost it
   too, with matching words.
5. **Desktop baseline regenerated** on the committed Phase 5 code — see
   "Inherited audit numbers".
6. **/brain's dark room stays** — the page's design, not a mode.

**Seen while verifying 3, and NOT changed — a founder call.** The app's toasts
are top-anchored and sit above everything (Sonner's own layer), so a transient
ending toast covers the Dex sheet's close X for its four seconds on a phone.
That is true of any overlay's close button in this app, not just the sheet, and
it is exactly why the persistent failure is a notice instead. Options if it
bothers you: move the phone's toasts to the bottom (they would then have to
clear the dock, the FAB and the notice), or leave it. Nothing was changed.

### The note's shape, confirmed (read from the backend, 2026-09-16)

Part 1's question 1 answered by reading the pipeline rather than waiting.
READ ONLY — nothing under `backend/` was touched. Sources: `routers/voice_notes.py`
(the endpoint), `services/voice.py` (`process_voice_note`), `services/ai_consent.py`
and `services/ai/llm_limits.py` (the consent gate), `integrations/llm.py`.

**The endpoint the client polls** is `GET /voice-notes/{note_id}`
(`routers/voice_notes.py:192`). It returns **the stored note document itself**,
with only `_id` and `audio_path` projected away — there is no response model, so
every field the pipeline writes is visible.

**The full JSON, by the path that wrote it**

| Key | Written by | Notes |
|---|---|---|
| `id`, `tenant_id`, `created_by`, `created_at` | POST /voice-notes or /voice-notes/text | |
| `kind` | the same | `"audio"` · `"text"` · `"file"` (text POST with only files) |
| `language` | the same | as sent; `"auto"` by default |
| `reference_file_ids` | the same, and /submit | **the attachments** — ids only |
| `held` | POST /voice-notes | true when `hold=1` (ASK-32 1.6) |
| `status` | throughout | `queued` → `transcribing` → (`transcribed` when held) → `structuring` → `done` \| `failed` |
| `transcript` | POST, or the STT step | |
| `detected_language`, `detected_language_name`, `language_probability`, `stt_engine` | the STT step (audio only) | |
| `transcribed_at` | the held stop | |
| `edited`, `submitted_at` | POST /voice-notes/{id}/submit | `edited` = the words were changed before sending |
| `outcome` | the two `done` endings | **`"decision"` \| `"nothing_to_decide"`** — the only two values written anywhere (`services/voice.py:523` and `:582`) |
| `decision_id` | ready (`:582`), and explicitly `null` on nothing-to-decide (`:523`) | |
| `execution_summary` | ready only | `{tasks, assignees, approvals, workflows, meetings, reminders}` (`summarize_proposal`) |
| `summary` | nothing-to-decide only | **the answer text we show** — the AI's own `extracted["summary"]`; can be `""` |
| `error` | failure only (`:587`) | `str(exception)` |
| `processed_at` | both `done` endings | |
| WhatsApp captures add `source`, `wa_from`, `raised_by_name` (`services/captures.py`) | | the same GET returns them |

**Which field distinguishes the three endings:** `status` first — `failed` is the
failure. Between the two `done` endings it is **`outcome`**, and the plan's
`nothing_to_decide` is confirmed, with exactly one sibling: `decision`. There is
no third value anywhere in the backend. (`decision_id` is a reliable second
signal: set on ready, explicitly `null` on nothing-to-decide.)

**Where the "nothing to decide" answer comes from:** `summary` on the note,
written as `extracted.get("summary", "")` when `proposal_is_empty(proposal)`.

**Where a failure's reason lives:** only `error`, and only as text. The pipeline's
single `except` writes `str(e)`. For the consent case the exception is
`HTTPException(451, detail={"code": "ai_consent_required", "message": …,
"current_version", "granted_version", "needs_reconsent"})`, raised by
`require_ai_consent` inside `guarded_llm`, which wraps **every** LLM turn
(`integrations/llm.py:86`, and the fallback at `:117`) — which is why 14 of 15
real failures are this one. Starlette 1.3.1 renders that exception as
`"451: {'code': 'ai_consent_required', 'message': 'This AI feature is unavailable
until your workspace owner grants consent for AI data processing.', …}"`, so
**the literal string `ai_consent_required` is confirmed** — but only as a
substring of a Python dict repr inside `error`. There is **no machine-readable
code field** on the note.

**Attachments in that response:** yes — `reference_file_ids` (ids only; no names,
sizes or urls). The client does not read them.

**Diff against `lib/dexOutcome.js`: no mismatches.** Field by field:

| The client reads | The backend writes | Verdict |
|---|---|---|
| `status` | same values | ✅ |
| `outcome === "nothing_to_decide"` | `:523` | ✅ |
| ready = `status "done"` + `decision_id` (outcome `"decision"`) | `:582` | ✅ |
| `said` ← note `summary` | the nothing-to-decide answer | ✅ |
| `error` contains `ai_consent_required` | the 451 dict repr | ✅ confirmed literal |
| `summary` ← note `execution_summary` (counts) | `{tasks, assignees, approvals, workflows, meetings, reminders}` — `executionSummaryCounts` maps `assignees` → people | ✅ |
| `"slow"` | never written by the backend — the client's own poll timeout | ✅ by design |
| — | `reference_file_ids`, `held`, `edited`, `submitted_at`, `language_probability`, `stt_engine`, `processed_at` | read by nobody; harmless |

**Nothing is ambiguous enough to ask Yokesh.** Two remarks, neither blocking:
- A consent refusal is identifiable only by substring-matching a Python dict
  repr. If the detail shape or the wrapper ever changes, ASK-33's consent ending
  silently degrades to the generic failure sentence. A `error_code` field on the
  note would make it robust — a request to make when 5.3 is built, not now.
- `_ResilientChat.send_message` retries the consent 451 across every key and
  fallback model before giving up (`integrations/llm.py:79-138`), so a
  consent-blocked capture spends several attempts before failing. Backend's call.

### The framer-motion exit trap (found in 4-B — NOT ASK-33's bug)

The most useful thing this ticket found, and it will bite again wherever
`AnimatePresence` wraps children that animate their layout.

- **Symptom.** After closing the phone's Dex sheet, `dex-chat` stayed in the
  DOM — `fixed inset-0 z-[9990]`, fully transparent (opacity 0), still taking
  pointer events. Every tap on the page landed on the invisible sheet (its
  full-screen "Close Dex" scrim button); only the dock and the FAB, which sit
  above it at z 10000, still worked. To the founder the app would look frozen.
- **It predates ASK-33.** The same close reproduced it on the Ask path —
  FAB → Ask → type → answer lands → close — with no ASK-33 code involved
  (KM-23's DexChat, framer-motion 11.18.0). ASK-33 made it more likely: a
  Retry re-flows the transcript, and an ending lands just as a founder reaches
  for the X.
- **Mechanism.** DexChat renders `<AnimatePresence>{open && <motion.div exit=…>}`
  and each message is a `<motion.div layout>`. Every motion component inside the
  exiting child registers with its `PresenceContext` (`usePresence`), and the
  child is removed only when ALL of them have called `safeToRemove`. A layout
  node (framer's `MeasureLayout`) calls it from `componentDidUpdate` only when
  `!projection.currentAnimation`; otherwise it waits for that layout
  animation's `animationComplete`. Close the sheet while a bubble's layout
  animation is still running — a message just arrived, the transcript just
  re-flowed — and that completion never comes once the exit has begun, so
  `onExitComplete` never fires and the sheet's opacity reaches 0 but it is
  never unmounted.
- **Fix** (`components/mobile/DexChat.jsx`). The transcript is wrapped in
  `<PresenceContext.Provider value={null}>`. With a null context `usePresence`
  returns `[true]` without registering, so the bubbles no longer take part in
  the sheet's exit; they still fade with it, so nothing on screen changes.
  `PresenceContext` is a public export of framer-motion.
- **Measured** (fixtures, 390x844, close the moment the new content lands, four
  trials each): Ask path 4/4 stuck → 0/4; Retry then close 4/4 → 0/4; ready or
  failed ending then close 0/4 before and after. verify-dex C ("the Settings
  link leaves the sheet for Settings") was 98/100 → 100/100.
- **Where else to look.** Any `AnimatePresence` whose exiting child contains
  `layout` / `layoutId` motion nodes that can still be animating when it exits.
  At `ee53663`: `pages/onboarding/BuildReveal.js` (`AnimatePresence
  mode="wait"` around count tiles with `layoutId`) is the other candidate;
  `pages/Login.js` uses `AnimatePresence mode="wait"` without layout nodes.
  Neither was changed. A generic guard: detach layout children from an exiting
  overlay with a null `PresenceContext`, or give the overlay a key and unmount it
  on `onExitComplete` with a timeout fallback.

### Inherited breakage from KM-23 (recorded, NOT fixed)

KM-23 (`97c2bfc`) unmounted DexSheet; these harness files still wait for its
`dex-sheet`, so the next person finds them here rather than by crashing into
them:
- `frontend/scripts/verify-empty.mjs:148` — counts `[data-testid="dex-sheet"]`.
- `frontend/scripts/_review-shots.mjs:75` — `waitForSelector('[data-testid="dex-sheet"]')`
  after tapping the FAB.
- `frontend/scripts/verify-nav.mjs`, the Dex section — rewritten in 4-A against
  DexChat. The rest of its failures are inherited and stay: "dock is 64px tall"
  (it is 72px), "backdrop is blurred" (none), "tiles are >= 88x88" (77x100),
  "Send Daily Digest is not adjacent to Sign out" and "Sign out is last in the
  utility strip" fail, then the run crashes at line 203 waiting for
  `allapps-tile-coach`, before the Dex section. None of ASK-33's commits touch
  FloatingDock.jsx or AllAppsPanel.jsx, and its only index.css change is the
  `.kr-dex-grow` / `.kr-dex-fade` rules. (The 4-B-era note listed only the last
  two failures: that run's output had been cut to its final 25 lines.)
- `frontend/scripts/verify-brief.mjs:34` — waits for `[data-testid="desk-mobile"]`
  after the `/brief` redirect; that id left the app in `1cf1dbf` (KR-8), before
  ASK-33, so `npm run verify:brief` stops there. Found in Phase 5.
- `frontend/scripts/verify-dex.mjs` was the fourth: rewritten in 4-B against
  DexChat and the Desk well, landing together with the new `npm run verify:dex`.

### Standing constraints (every phase)

- Audits scoped: `npm run audit:mobile -- --base-url http://localhost:3007 --only inbox`
  (add `--skip-desktop` / `--skip-mobile` when one side is enough). The FULL
  audit runs exactly once, at the end of Phase 4, together with the production
  build and the route-by-route comparison against the inherited numbers.
- **Never regenerate `.audit-desktop-baseline`** during Phases 2–4 without the
  founder's go (it is gitignored, per working copy).
- **Never touch `backend/.env` or a real database.** Verify against fixtures:
  `?fixture=busy` in the app and `npm run fixture-api` (fixture server on
  **:8000**; the dev server "frontend-alt" is on **:3007**; both are in the
  untracked `.claude/launch.json`).
- Per-phase gates: `git diff --name-only` scope check · eslint on touched
  files · the scoped audit · look at /inbox at 1440, 390 and 360.
- One commit per phase; no push. Never commit `.bridge-write-test`, `.claude/`,
  `New decisionos logo.png`, `frontend/public/sky-v1/`.

### Inherited audit numbers (record, do not fix)

- Full mobile audit on unchanged code at `bb0a9e8`: **307 failing + 34
  warnings across 24 routes** (88 touch-target-min-44, 124 text-below-13px,
  23 horizontal-overflow, 38 non-indian-inr-grouping, 12 block-variety,
  10 density-floor, 12 progress-element; warn 4 horizontal-scroll-strip,
  30 uppercase-text). Two clean runs matched rule by rule.
- Scoped `--only inbox` (covers /inbox, ?scope=morning, ?scope=week and
  /finance?tab=inbox): **40 failing + 2 warnings** on clean code and unchanged
  through Phases 1, 2 and 3.
- Desktop, against the baseline regenerated on clean code: **6 diffs**, all
  /inbox — lg-1024 14,924 px (1.475%), xl-1280 16,823 px (1.183%) — identical
  in Phases 1–3 (the audit captures the resting state).
- **Desktop baseline REGENERATED 2026-09-16 on `0beffcb`** (the committed Phase
  5 code), with the founder's go: the six approved /inbox diffs are folded into
  it, and a scoped `--only inbox` run against it is now **0 desktop diffs**. That
  is the reference the next ticket starts from; the numbers below are the history
  that led to it.
- **End of Phase 4 (4-A), the one full run:** mobile **307 failing + 34
  warnings across 24 routes — identical to the clean run rule by rule and route
  by route**; nothing worse, nothing better. Console errors: the same four
  `out.map is not a function` ErrorBoundary reports (390, 360) as the clean run.
  The scoped `--only inbox` run after 4-B was 40 + 2, unchanged. Desktop: **8
  diffs** — the six /inbox captures above plus `/brief` at lg and xl with
  identical pixel counts (`/brief` redirects to `/inbox?scope=morning`).
  Regenerating the desktop baseline now that Phase 4 is done is recommended —
  with the founder's go.

### Things the diff will not tell you

- **The local database is PRODUCTION.** `backend/.env` MONGO_URL is a Railway
  TCP proxy with `DB_NAME=founder-os-58` (the live company). The plan's "local
  database is dev data" line is false for this working copy. For a real
  end-to-end run change `DB_NAME` ONLY to `dos_uicheck_ask33`, revert after,
  never commit `.env`. Real-backend checks (done-when 4–6: real speech +
  approve, Outcome C by turning consent off, Later → reload → reopen) have NOT
  been run.
- **Outcome field names are unconfirmed.** `lib/dexOutcome.js` reads them from
  `backend/services/voice.py` at `bb0a9e8`: done + `outcome: "decision"` +
  `decision_id` + `execution_summary`; done + `outcome: "nothing_to_decide"` +
  `summary` (Dex's answer); `status: "failed"` + `error` (consent refusal
  carries `ai_consent_required`). `readNote()` is the one place to change.
  `useDexCapture.follow()` reports done-without-decision as status `"nothing"`,
  and `useDexConversation` clears the understanding in the same render the
  ending arrives, so the well reads the outcome in that render.
- **AI consent has no UI.** Settings tabs are business / operations / money /
  account; `/settings#ai-consent` (used by Outcome C and by `lib/api.js`'s own
  consent toast) is a dead anchor. Backend endpoints exist:
  `GET/POST /tenant/ai-consent` (`routers/tenant_settings.py` ~301/311).
  `AI_CONSENT_HREF` is the constant to change. Needs a founder decision.
- **The regenerated desktop baseline's /inbox is itself odd:** the clean
  capture shows the Decisions column overflowing its card (six rows at lg, the
  "N more waiting" floor and Review pill out of view, the right-hand stack
  stretched and cut off); the Phase 1+ capture shows the board fitted. So the
  6 desktop diffs include the board, not only the well. Both captures are
  deterministic. Recommend regenerating after Phase 4, with approval.
- **Harness facts that cost hours:**
  - `audit-mobile.mjs` freezes the page clock (`ctx.clock.setFixedTime`) while
    `settle()`'s `waitForVectorsStable` / `waitForTextStable` time out via
    `Date.now()` — which never advances. Any perpetual animation on a route
    hangs the mobile audit forever (CPU near idle). Wrap runs in a watchdog:
    `perl -e 'alarm 360; exec @ARGV' node scripts/audit-mobile.mjs …`.
  - Don't `pkill chromium_headless_shell` in one chain while another Playwright
    job runs — it kills that job's browser too. Run browser jobs in series.
  - A hidden Browser pane draws no frames: rAF and CSS transitions pause, so
    the expansion looks stuck on its first frame. Trust headless Playwright.
  - eslint: the repo's eslint 9 CLI crashes on the react-app config. Use the
    build's own eslint 8 with a legacy config whose only content is
    `{"root": true, "extends": ["<frontend>/node_modules/eslint-config-react-app/index.js"]}`:
    `NODE_ENV=development BABEL_ENV=development node node_modules/react-scripts/node_modules/eslint/bin/eslint.js --no-eslintrc -c <that file> --resolve-plugins-relative-to node_modules/eslint-config-react-app <files>`.
  - zsh: quote `--include='*.js'`; a `$VAR` holding several paths is not
    word-split (list paths explicitly); `curl … | grep -q` under `pipefail`
    reports a false negative (download to a file, then grep).
- **Fixtures added for verification (dev-only):** POST `/files` and
  `/voice-notes/{id}/submit` answer with ids; every new capture replays the
  stage walk; sessionStorage `dos_fixture_capture` = `nothing` | `consent` |
  `failed` forces the other endings (default is a ready decision for Sunita
  Rao with a two-task, one-workflow proposal).
- **Scratch verification scripts** (not committed; session scratchpad
  `…/scratchpad/ask33/`): `verify-well.mjs` (Phase 1, fake mic, 1440/390/360),
  `verify-p23.mjs 2|3` (expansion; endings, with real pointer clicks),
  `diff-bbox.mjs` (desktop diff confinement), `hang-probe.mjs`. Rebuild from
  this section if the scratchpad is gone.
- **Layout facts:** `sm:`/`md:` are banned inside `.app-shell`; phones get 44px
  controls and 16px inputs from `index.css` (`@media (max-width: 1023.98px)`,
  `--control-h-sm`). The app has a desktop CSS zoom (UI-SCALE), so
  `getBoundingClientRect` is in visual px while `offsetHeight` is local px —
  the expansion's `measure()` converts with that ratio. The ticket's
  `index.css:1972` reduced-motion pointer is stale (it is a CRM sky rule); the
  file's convention is per-class `@media (prefers-reduced-motion: reduce)`
  blocks.
- **Counts:** DecisionDialog's "Approving creates …" wording moved verbatim to
  `lib/decisionProposal.js` (checked against the original for 7 combinations);
  the Desk card's "On approval: N tasks" string is built server-side in
  `desk.py`, so there was no client counter to reuse there. People/approvals
  follow `services/voice.summarize_proposal`.
- **Retry** re-sends via `POST /voice-notes/text` with the last text and
  file ids, even when the original was a held voice note.
- The Phase 1 interim toast (Dex's reply text) is still how a phone sees an
  ending until 4-B lands.

---

## Outstanding, next session — ALL ADDRESSED in ASK-33.2 (see the section after it)

*Recorded 2026-09-16 at the founder's instruction, after ASK-33.1 (`6c1b6e6`).
Nothing here was started. Nothing is pushed — the founder decides when the eight
ASK-33 commits go to Railway.*

### 1 · The greeting does not render at rest on desktop — UNVERIFIED, verify first

The screenshots that raised this compared **production data** (tenant "Rajesh
Sharma") against **fixtures** (tenant "Rajesh Kumar"), so it may be a fixture
artifact rather than a bug.

**First job of the session, before any fix:** screenshot the resting Desk at 1440
on `bb0a9e8` and on HEAD **against the same fixture data**, Company scope, and
describe in words what differs. **Only fix it if the greeting renders on
`bb0a9e8` and not on HEAD.** (Phase 1 commented out the `deskInsight` wiring in
`pages/Desk.js`, and Phase 2 fades `desk-brief-greeting` via `.kr-dex-fade` while
the well is the workspace — both are places to look if it is real.)

### 2 · The well's resting height — a consequence of 1, almost certainly

ASK-25 gives the well `lg:flex-1`, so it absorbs whatever the left column has
left over. Railway: greeting ~90px, well ~155px. The build: greeting 0, well
~265px — the difference is the greeting. **Do not hardcode a height.** Re-measure
after 1 is settled; if the greeting comes back, this should follow it.

### 3 · The composer field must be SUNKEN, not raised — real regardless of data

It inherited `.kr-pop` from the "Chase it" button it replaced, and KM-62 / KM-65
both reserve that raised recipe for things you press. An input takes the sunken
recipe. `[attach]` and the mic stay raised. Desktop and phone. **Do this together
with the new composer row below — they are the same row.**

### The composer row, rebuilt — SUPERSEDES the [+] design from Phase 1

Three elements, no expansion:

    [attach]   [ ——— text field ——— ]   [mic / stop / send]

1. **Delete [+] and everything it revealed.** The attach icon takes its place
   directly — a `.kr-pop` circle, one tap opens the file picker. No circles
   animating above it, no reveal container, no inline swap.
2. **The field is a text field by default**, sunken (item 3). Tap it and type.
   There is no "type mode" to switch into.
3. **The right icon has three states**, following DexFab's existing `intent`
   pattern — read it and match it, do not invent a second one:
   - empty and not recording → **mic** (tap starts recording)
   - recording → **stop** (tap stops; the transcript lands in the field for
     review, KM-51)
   - the field has text → **send**
   Tapping the mic turns the field into the DexWave surface while recording, and
   back into the text field when it stops.
4. **Delete the type/voice mode toggle entirely** — the mic is the mode switch
   now. Remove `desk-dex-mode` and `desk-dex-plus`; keep `desk-dex-attach` and
   `desk-dex-mic`. Record both removed test ids in the commit message.
5. **Three Phase 5 entries retire with it** — already struck from the list above,
   with the reason.
6. **Attachment chips are unchanged** — they still appear, still removable.

Keep the regression tests that cover the composer row itself; delete the ones
that only tested the reveal (`verify-well.mjs`'s [+] reveal checks, the Phase 3
tap-the-composer's-left-edge check, and the draft-peek checks in
`verify-p5.mjs`). Desktop and phone both, the same four gates, then report.
Do not push.

### For Yokesh — not for us to fix

- **`error_code` on the note.** A consent refusal is currently identified by
  substring-matching a stringified Python dict inside `error`
  (`"451: {'code': 'ai_consent_required', …}"`). That is 14 of 15 real failures
  riding on an exception's `repr()`. A first-class `error_code` on the voice note
  would change exactly one place in the client: `failureReason()` in
  `frontend/src/lib/dexOutcome.js` (the `raw.includes(AI_CONSENT_CODE)` test),
  with `readNote()` carrying the new field through.
- **The 451 is definitive, but it is retried.** `_ResilientChat.send_message`
  (`backend/integrations/llm.py:79-138`) retries every key and then every
  fallback model before giving up, so a consent-blocked capture spends the whole
  retry ladder on an answer that cannot change.

### Decided, not to be revisited

- **Phone toasts stay where they are.** Top-anchored, above everything, so a
  transient ending toast covers an overlay's close X for its four seconds. That
  is app-wide behaviour, outside this ticket, and the persistent notice already
  covers the case that mattered. The note stays in "ASK-33.1" as the record.

---

## ASK-33.2 — the composer row rebuilt, and the greeting answered (2026-09-16)

### 1 · The greeting — a FIXTURE ARTIFACT, not a regression. Nothing changed.

The founder's suspicion was right. Evidence, in the order it settles the
question:

- The greeting comes from **`GET /desk/summary`**, through
  `pages/desk/useDeskMetrics.js`: `greeting: summaryQ.data?.greeting || ""`.
- **That file is byte-identical to `bb0a9e8`** (`git diff bb0a9e8 --
  frontend/src/pages/desk/useDeskMetrics.js` is empty), and so is the line in
  `Desk.js` that reads it. Phase 1 commented out the `deskInsight` ranker, which
  is a different thing entirely; Phase 2 only added the fade wrapper, which is
  `data-dex-faded="false"` at rest.
- **The fixtures never serve `/desk/summary`** — their greeting lives on
  `/brief`, which this page does not read for it. So under fixture data the
  greeting is `""` on `bb0a9e8` and on HEAD alike.
- Probed at 1440 on HEAD: the element is present, `opacity: 1`, its parent not
  faded, and its text is a single space — the `{greeting || " "}` fallback. It
  renders; there is simply nothing to render.

On Railway, with the real backend, `/desk/summary` returns the greeting and it
shows. **Not fixed, because there is nothing broken.** Adding a greeting to the
fixtures would make local screenshots representative, but it would also move the
desktop baseline that was just regenerated — left alone deliberately.

### 2 · The well's resting height — the consequence, confirmed. Nothing changed.

ASK-25 gives the well `lg:flex-1`, so it takes whatever the left column has
left. With the greeting empty (item 1) the column has ~90px more to give, and
the well measures 218px at 1440 under fixtures. On Railway, where the greeting
takes its height, the well settles back to roughly the ~155px the founder
measured. **No height was hardcoded and nothing was changed** — as instructed,
this was only to be touched if it was still wrong with the greeting back, and
the greeting was never gone.

### 3 · The composer row — three elements, no expansion

    [attach]   [ ——— text field ——— ]   [mic / stop / send]

- **[+] is deleted**, with the reveal container, both revealed circles, the
  outside-tap and Escape handling, and the swap/stack animation constants.
  **Attach is its own `.kr-pop` circle** — one tap opens the file picker.
- **The field is a text field by default and SUNKEN.** It wore `.kr-pop`,
  inherited from the "Chase it" button it replaced; KM-62 / KM-65 keep that
  raised recipe for things you press, and an input is not one. It now wears
  **`nm-inset`**, the recipe every other field in the app uses
  (`components/ui/input.jsx`, `textarea.jsx`). The circles either side stay
  raised, because they are pressed. The two-line growth, the placeholder and the
  read-only-while-transcribing behaviour (KM-53) are unchanged.
- **The mic carries three states**, DexFab's own `intent` pattern: empty and not
  recording → mic; recording → stop (the words land in the field for review,
  KM-51); the field has text → send. Tapping the mic turns the field into the
  DexWave surface while recording and back into the field when it stops — so the
  wave still mounts only while recording, which is what keeps the mobile audit
  settling.
- **The type/voice toggle is gone.** The mic is the mode switch.
- **Test ids removed: `desk-dex-plus`, `desk-dex-mode`.** Kept:
  `desk-dex-attach`, `desk-dex-mic`, `desk-dex-composer`.
- **Attachment chips are unchanged.** Desktop and phone both.

### 4 · The checks that only tested the reveal are deleted

Removed: the [+]-then-attach dance in `verify-dex.mjs`, `verify-well.mjs`,
`verify-p23.mjs`, `verify-p5.mjs`, `verify-p5b.mjs` and `verify-p331.mjs`; the
Phase 3 "a tap on the composer's left edge reaches the field" check (it existed
because the shut reveal's box sat over the field); and Phase 5's draft-peek
checks (the draft can no longer be hidden). Added to `verify-well.mjs`: the field
is sunken while the circles stay raised, the two removed ids are gone, and the
field is a text field at rest. Everything covering the row itself — the
recording, the transcript landing, send, the chips, the heights — stays.

The three Phase 5 entries retired with the [+] stay retired; the code they
described is now gone rather than merely unused.

### Gates (ASK-33.2)

- eslint clean on `pages/desk/DeskDexWell.jsx`; `npm run build` succeeds with
  unchanged warnings; `npm run verify:dex` 114/114 at 390 and 360;
  `verify-well.mjs` passes at 1440, 390 and 360, including the new checks that
  the field is sunken while the circles stay raised and that `desk-dex-plus` and
  `desk-dex-mode` are gone.
- Looked at /inbox at 1440, 390 and 360. The row measures attach 40 · field ·
  mic 40 on desktop and 44px circles on both phones; the mic reads mic → stop →
  send, with the wave in the field while recording and the transcript landing
  back in it.
- `npm run audit:mobile -- --only inbox`: mobile 42 findings (40 failing + 2
  warnings), no rule, route or viewport count changed; 0 console errors.
  **Desktop: 3 diffs** against the baseline regenerated at `0beffcb` — /inbox,
  ?scope=morning and ?scope=week at xl-1280, 683 px each (0.048%) — which is the
  field's recipe going from raised to sunken. Expected; **the baseline was not
  regenerated** (that needs a go).

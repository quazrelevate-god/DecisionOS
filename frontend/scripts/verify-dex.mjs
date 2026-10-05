#!/usr/bin/env node
/**
 * PILOT-2 A verification — the Desk's Dex capture happens in ONE pop-up.
 *
 * REWRITTEN A THIRD TIME, and the reason is still the point of the file. The
 * last cut verified ASK-35 G2 / ASK-47: the well itself became the workspace —
 * the forge inside it, the ending inside it, the actions pinned inside it. The
 * pilot client's voice note moved all of that into a pop-up (step 1 what you
 * said, step 2 Dex reading it, step 3 what Dex made), and the well went back to
 * being the door. Every check that asserted "the ending lands in the well"
 * would now fail for being right, so they are gone; the rules they protected —
 * the well never moves, one capture at a time, the sheet is Ask-only, a
 * failure says why and offers Retry — are asserted against the pop-up instead.
 *
 * At 1440x950, 390x844 and 360x640, against the fixtures:
 *   A  speak into the well (Chromium's fake audio device), stop: the pop-up
 *      opens on STEP 1 with the whole transcript (a long one) in a real field,
 *      the well's pill never holds it; Next: STEP 2 in the same pop-up — the
 *      forge, with the stages on desktop and alone on a phone; then STEP 3 with
 *      no extra press — the counts, DecisionDialog's breakdown under them, and
 *      Approve / Save as draft / Reject pinned at the foot and on screen.
 *      Approve issues it; Done gives the well back.
 *   B  type, NOTHING TO DECIDE: a typed capture skips step 1, and the ending is
 *      the pop-up's last step — Dex's answer, one way out, not an error
 *   C  attach a file, AI-consent FAILURE: the file goes with the capture; the
 *      reason untruncated, the Settings link at the touch floor, Retry reads it
 *      again in the same pop-up
 *   D  every way out (Got it, Not now, Save as draft, Done) gives the well back
 *      to the ripple, and the well is the same box throughout
 *   E  closing the pop-up while Dex reads cancels nothing: the well says it is
 *      still reading, a second capture is refused in plain words (ASK-33.1),
 *      the first still reaches its ending, and the pop-up opens again on it
 *   G  closed on step 1, the words are KEPT: the well offers them back (never
 *      in its pill), they survive a reload, Open brings step 1 back, Discard
 *      lets them go
 *   F  THE SHEET IS ASK-ONLY: no decide path opens it; the FAB still opens it
 *
 * The fixtures walk a note queued -> transcribing -> structuring -> done;
 * sessionStorage "dos_fixture_capture" (nothing | consent | failed) picks the
 * ending and "dos_fixture_transcript" what the recording said
 * (src/fixtures/mobile/_shared.js) — no LLM call is spent per run.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';
/* DEX-SLIDER Part 5 — on a phone the well's testids moved BEHIND A DOOR.
 *
 * Nothing here was deleted and nothing was renamed: the ripple, the keyboard,
 * the attach circle, the kept-capture note and the status are the same nodes,
 * rendered on the overlay surface instead of in the well (DeskDexWell
 * `surface`). So every check below still means what it meant — the suite just
 * has to open the door first, the way a person now does. Desktop never has a
 * door, and with the flag off the phone has none either; `door` is that
 * difference and the only one. */
import { DEX_SLIDER } from '../src/lib/flags.js';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const READY = /^Decision ready for Sunita Rao · 2 tasks, 1 workflow$/;
const CONSENT = 'AI is off for this company — an owner has to turn on AI consent before Dex can read anything';
const LONG = 'Okay, so this is about the Ashok Pumps order. Suresh, ship the indigo lot to Ashok Pumps before Friday, and make sure the packing is double-layered, because last time two cartons came back damaged. Deepa, call Ashok Pumps tomorrow morning and tell them the revised dispatch date, and also ask them to clear the pending payment of two lakh forty thousand before we send the next lot. Murugan, the press brake needs servicing on Monday; book the technician from Coimbatore Hydraulics and keep the old die ready for inspection. Karthik, raise a purchase order for two tonnes of steel sheet from Sri Lakshmi Steels, but only if they match last month\'s rate, otherwise hold it and tell me. I want a meeting with Suresh and Deepa on Thursday at eleven to review all the pending dispatches for October. Also approve forty-two thousand rupees for the courier charges on this shipment, and put a reminder for me to check the Ashok Pumps payment next Wednesday. If the payment doesn\'t come in by then, we stop further dispatches to them until it is cleared. That\'s all for now.';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};
const clip = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const until = async (fn, timeout = 25000, step = 250) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function open(viewport) {
  const phone = viewport.width < 1024;
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'], ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  const signedIn = await signIn(page, BASE);
  await gotoDesk(page);
  return { ctx, page, errors, signedIn };
}

/* Is Dex behind the slider's door on this viewport? */
const behindDoor = (page) => DEX_SLIDER && page.viewportSize().width < 1024;

/** The box the well's own checks measure: the well, or the door it moved into. */
/** The control that stops a recording: the well's mic, or — on the slider —
 *  the handle, which parks at the stop and becomes the send. */
const stopControl = (page) => page.getByTestId(behindDoor(page) ? 'dex-slider-handle' : 'voice-ripple-mic');

/** Start a capture the way a person does: the full drag right, released at the
 *  stop. Short of the stop nothing happens by design, so this cannot be a
 *  gentle nudge.
 *
 *  THE DOOR IS GONE (2026-10-02). There is no full screen any more — the
 *  slider's own track becomes the recording surface, the handle parks at the
 *  stop and turns into a send, and the whole capture happens in the control.
 *  So "open the door" is now "put the track into capture", and the thing to
 *  wait for is the handle's own label changing. No-op off the slider. */
async function openDoor(page) {
  if (!behindDoor(page)) return;
  const capturing = async () => ((await page.locator('[data-testid="dex-slider-handle"]')
    .getAttribute('aria-label')) || '').toLowerCase().includes('stop');
  if (await capturing()) return;
  const track = await page.locator('[data-testid="dex-slider"] .kr-slider-well').boundingBox();
  const h = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  const cy = h.y + h.height / 2;
  await page.mouse.move(h.x + h.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width - 2, cy, { steps: 16 });
  await page.mouse.up();
  await until(capturing, 8000);
  await page.waitForTimeout(300);
}

async function gotoDesk(page) {
  await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(behindDoor(page) ? 'dex-slider' : 'desk-insight').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await openDoor(page);
}

const setEnding = (page, v) => page.evaluate((x) => {
  if (x) sessionStorage.setItem('dos_fixture_capture', x);
  else sessionStorage.removeItem('dos_fixture_capture');
}, v);
const setSaid = (page, v) => page.evaluate((x) => sessionStorage.setItem('dos_fixture_transcript', x), v);
const sheet = (page) => page.getByTestId('dex-chat');
const popup = (page) => page.getByTestId('dex-popup');
const stepOf = (page) => popup(page).getAttribute('data-step').catch(() => null);
const atStep = (page, s, t = 25000) => until(async () => (await stepOf(page)) === s, t);
const popupGone = (page, t = 4000) => until(async () => (await popup(page).count()) === 0, t);
const toasts = (page, text) => page.locator('[data-sonner-toast]').filter({ hasText: text });

/* The field is behind a door (ASK-47): the keyboard circle opens it.
 *
 * TWO PLACES IT CAN LAND (2026-09-30). On a phone the composer now lifts out
 * of the collapsing well and is PORTALLED TO THE BODY as a floating bar above
 * the keyboard — `desk-dex-floating` — while the desktop one stays inside the
 * well as `desk-dex-composer`. `floating = phone && fieldOpen`, so at 390 and
 * 360 the in-well testid never appears at all and this helper sat waiting for
 * it until it threw, taking all 193 checks with it. Look for either. */
const composerIn = (page) =>
  page.locator('[data-testid="desk-dex-composer"], [data-testid="desk-dex-floating"]');

/** A field to type a capture into, on whichever surface this is.
 *
 *  THE WELL still works the way it always did: press the keyboard and a
 *  composer opens in the well's floor.
 *
 *  THE SLIDER has no keyboard — the track is the recording surface and it
 *  carries exactly one control, the handle. Typing a decision there is: start a
 *  capture, stop it straight away, and type into the pop-up's transcript, which
 *  is empty when nothing was said. So "a field" on that surface IS the pop-up's
 *  transcript, and if one is already open this hands that back rather than
 *  starting a second capture underneath it.
 */
async function openField(page) {
  /* ALREADY SOMEWHERE TO TYPE? Hand it back. This has to come first: section C
     attaches a file from the pop-up and then types, and starting a fresh
     capture under an open pop-up means clicking a handle that is behind it. */
  if (await page.getByTestId('dex-popup-transcript').count()) {
    return page.getByTestId('dex-popup-transcript');
  }
  if (await composerIn(page).count()) return composerIn(page).first().locator('textarea');

  /* A KEPT CAPTURE OWNS THE NEXT PRESS: `kept` is draft text with no field
     open, and the surface then offers those words back in the pop-up rather
     than opening an empty one. That is the state after a REFUSED send
     (9959478). Clear them when the suite wants a fresh field; a person would
     press the same Discard. It lives on the DESK now, so it is dealt with
     before anything covers it. */
  {
    const d = page.getByTestId('dex-well-draft-discard');
    if (await d.count()) { await d.click(); await page.waitForTimeout(300); }
  }

  if (!behindDoor(page)) {
    await page.getByTestId('desk-dex-keyboard').click();
    await composerIn(page).first().waitFor({ timeout: 4000 });
    return composerIn(page).first().locator('textarea');
  }

  await openDoor(page);
  await stopControl(page).click();
  /* WHICHEVER ARRIVES. Normally the drag starts a capture and stopping lands in
     the pop-up's transcript. But when Dex is still reading the last note the
     capture is refused outright (ASK-33.1) and the handle goes home, so there
     is nothing to stop and nothing opens — waiting only for the transcript
     would make this suite assert a guard it does not mean to test here. */
  await until(async () =>
    (await page.getByTestId('dex-popup-transcript').count()) > 0
    || (await composerIn(page).count()) > 0, 8000);
  if (await page.getByTestId('dex-popup-transcript').count()) {
    return page.getByTestId('dex-popup-transcript');
  }
  return composerIn(page).first().locator('textarea');
}

/** Start a recording, whichever surface this is. The slider starts one with
 *  the drag itself; the well needs the mic pressed. */
async function micPress(page) {
  await openDoor(page);
  if (behindDoor(page)) return;        // the drag itself started it
  await page.getByTestId('voice-ripple-mic').click();
}

/** Be on the Desk. Nothing to step out of any more — the capture happens in
 *  the track and the Desk was never covered — but the places that mean "be on
 *  the Desk now" still say so, and this reads as a deliberate retirement
 *  rather than as something forgotten. */
async function toDesk(page) {}

async function typeAndSend(page, words) {
  const input = await openField(page);
  await input.fill(words);
  /* Enter sends from the composer; the pop-up's first step sends with Next,
     which is the button beside the field the words are already in. */
  if (behindDoor(page) && (await page.getByTestId('dex-popup-transcript').count())) {
    await page.getByTestId('dex-popup-next').click();
    return;
  }
  await input.press('Enter');
}

/* The well's box, in CSS px. PILOT-2 A — the well is the door and nothing
   else, so the assertion across every step is that nothing about it moves. */
const geometry = (page) => page.evaluate((sel) => {
  const T = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const well = document.querySelector(sel);
  if (!well) return null;                       // the door is shut: see wayOut
  const box = well.getBoundingClientRect();
  return {
    wellTop: Math.round(box.top), wellHeight: Math.round(box.height),
    boardTop: T('[data-testid="desk-board"]'),
    floorTop: T('[data-testid="desk-dex-keyboard"]'),
    ripple: !!document.querySelector('[data-testid="desk-dex-ripple"]'),
  };
}, '[data-testid="desk-insight"]');   // the well's own box; the slider has wayOut
/* WHAT "GIVES THE WELL BACK" MEANS ON EACH SURFACE.
   In the well it is literal: the pop-up goes and the ripple is in the box it
   was always in, unmoved. Behind the door it cannot be, because the door shuts
   itself when the pop-up takes over — so the claim becomes the one that is
   actually worth making there: the pop-up is gone, you are back on the Desk
   with the slider at rest, and the way back in still works. Both are "nothing
   is stranded and nothing moved"; only the surface differs. */
async function wayOut(page, rest) {
  if (!behindDoor(page)) {
    const g = await restingBox(page);
    return { back: g?.ripple === true, same: sameBox(g, rest) };
  }
  const slider = page.getByTestId('dex-slider');
  const label = (await page.locator('[data-testid="dex-slider-handle"]').getAttribute('aria-label')) || '';
  const back = (await slider.count()) === 1 && !label.toLowerCase().includes('stop');
  const handle = await page.locator('[data-testid="dex-slider-handle"]').boundingBox().catch(() => null);
  const track = await page.locator('[data-testid="dex-slider"] .kr-slider-well').boundingBox().catch(() => null);
  const centred = !!handle && !!track
    && Math.abs((handle.x + handle.width / 2) - (track.x + track.width / 2)) <= 3;
  return { back, same: centred };
}

const sameBox = (a, b) => !!a && !!b && a.wellTop === b.wellTop && a.wellHeight === b.wellHeight && a.floorTop === b.floorTop;

/* MEASURE IT WHEN IT HAS STOPPED MOVING. The well animates back as a pop-up
   closes, and reading its box the instant the pop-up node leaves the DOM caught
   it mid-transition: "the same box it has been throughout" and "unmoved" failed
   roughly one run in three, only at 1440, only straight after a close, and
   never for a reason that existed in the product. Two identical reads in a row
   is the honest wait — a fixed sleep would just be a longer guess. */
const restingBox = async (page) => {
  /* THREE reads at 200ms, not two at 100. The two-read rule caught a plateau:
     the Desk lays out once with the query layer still loading, holds that for
     a moment, and only then — when the Workflows tile fills — does the hero
     shrink and the well drop into its real place. The baseline was being taken
     during that plateau, so "the well has not moved" compared a loading layout
     against a loaded one and failed with a 91px delta, about one run in four.
     Probed at 1440 directly: the well is 387/97 both before the pop-up opens
     and after, so the product does not move and this is purely when the suite
     chooses to look. */
  /* WAIT FOR THE DATA, THEN FOR THE PIXELS. Settling alone was not enough: the
     Desk lays out with the query layer still in flight and HOLDS that layout
     long enough to look settled, so three stable reads could still land on a
     loading page. The Workflows tile's count is the honest signal that the
     Desk's data has arrived — it renders "…" until it has — and the hero's
     height depends on that tile. After it, settle as before. */
  await until(async () => {
    const t = await page.getByTestId('kpi-workflows-count').textContent().catch(() => null);
    return !!t && t.trim() !== '…';
  }, 15000);
  let last = await geometry(page);
  let stable = 0;
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(200);
    const now = await geometry(page);
    stable = sameBox(now, last) ? stable + 1 : 0;
    last = now;
    if (stable >= 2) return now;
  }
  return last;
};

/** MPWA-01 §5.1 / ASK-43 — every control in `testid` is a 44px target in the
 *  app's own pixels, and is whole, on the glass and uncovered (the point in its
 *  middle IS it). */
const touchAndFold = (page, testid, viewport) => page.evaluate(([t, vh]) => {
  const el = document.querySelector(`[data-testid="${t}"]`);
  if (!el) return false;
  const btns = [...el.querySelectorAll('button,a')];
  return btns.length > 0 && btns.every((b) => {
    if (b.offsetHeight < 44) return false;
    const r = b.getBoundingClientRect();
    if (r.bottom > vh || r.top < 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (b === hit || b.contains(hit));
  });
}, [testid, viewport.height]);
const onGlass = (page, testid, viewport) => page.evaluate(([t, vh]) => {
  const b = document.querySelector(`[data-testid="${t}"]`);
  if (!b || b.offsetHeight < 44) return false;
  const r = b.getBoundingClientRect();
  if (r.bottom > vh || r.top < 0) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (b === hit || b.contains(hit));
}, [testid, viewport.height]);

async function run(viewport) {
  const w = `${viewport.width}`;
  const phone = viewport.width < 1024;
  const { ctx, page, errors, signedIn } = await open(viewport);
  check(`${w}: signed in`, signedIn);
  const mic = page.getByTestId('voice-ripple-mic');
  const rest = behindDoor(page) ? null : await restingBox(page);
  /* On the slider there is no well to open and no ripple to open it on: the
     Desk rests with a slider at its centre and nothing is capturing. That is
     the same claim — the Desk does not greet you with a form. */
  check(`${w}: the Desk rests on the control, not a form`,
    behindDoor(page)
      ? (await page.getByTestId('dex-slider').count()) === 1
        && (await page.getByTestId('desk-dex-composer').count()) === 0
      : rest.ripple === true);

  // ----------------------------------------------- A · SPOKEN, READY, APPROVED
  await setEnding(page, null);
  await setSaid(page, LONG);
  await micPress(page);
  await page.waitForTimeout(1500);
  check(`${w} A: the ripple records`, behindDoor(page)
    ? ((await page.locator('[data-testid="dex-slider-handle"]').getAttribute('aria-label')) || '').toLowerCase().includes('stop')
    : (await mic.getAttribute('aria-pressed')) === 'true');
  await stopControl(page).click();
  check(`${w} A: stopping opens the pop-up on step 1`, await atStep(page, 'said', 4000));
  const field = page.getByTestId('dex-popup-transcript');
  await until(async () => (await field.inputValue()).length > 100, 20000);
  const said = await field.inputValue().catch(() => '');
  check(`${w} A: the whole transcript is in it`, said === LONG, `${said.split(/\s+/).filter(Boolean).length} words`);
  check(`${w} A: … and the well's pill does not hold it`, (await page.getByTestId('desk-dex-composer').count()) === 0);
  const room = await field.evaluate((el) => {
    const cs = getComputedStyle(el);
    return Math.floor((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight));
  });
  check(`${w} A: the field has room for six lines at least`, room >= 6, `${room} lines`);
  check(`${w} A: it can be edited`, !(await field.evaluate((el) => el.readOnly || el.disabled)));
  check(`${w} A: Next, Discard and close are whole and in reach`,
    await onGlass(page, 'dex-popup-next', viewport) && await onGlass(page, 'dex-popup-discard', viewport) && await onGlass(page, 'dex-popup-close', viewport));
  if (!behindDoor(page)) {
    const at1 = await geometry(page);
    check(`${w} A: the well has not moved`, sameBox(at1, rest), `${rest.wellTop}/${rest.wellHeight} -> ${at1.wellTop}/${at1.wellHeight}`);
  }

  await page.getByTestId('dex-popup-next').click();
  check(`${w} A: Next goes to step 2 in the same pop-up`, await atStep(page, 'reading', 4000) && (await popup(page).count()) === 1);
  check(`${w} A: … and the Dex sheet does NOT open`, (await sheet(page).count()) === 0);
  const reading = await page.evaluate(() => ({
    forge: !!document.querySelector('[data-testid="dex-popup"] [data-testid="desk-dex-forge"]'),
    stages: !!document.querySelector('[data-testid="dex-popup"] [aria-label="What Dex is doing"]'),
    quote: !!document.querySelector('[data-testid="dex-popup-sent"]'),
  }));
  check(`${w} A: while it reads, the forge is drawn`, reading.forge);
  check(phone ? `${w} A: … alone, on a phone` : `${w} A: … with the stages and what was said beside it`,
    phone ? (!reading.stages && !reading.quote) : (reading.stages && reading.quote));

  check(`${w} A: step 3 follows with no extra press`, await atStep(page, 'made', 25000));
  await page.getByTestId('dex-popup-counts').waitFor({ timeout: 10000 }).catch(() => {});
  const headline = clip(await page.getByTestId('desk-dex-summary').textContent().catch(() => ''), 120);
  check(`${w} A: it leads with the 5.1 line`, READY.test(headline), headline);
  const counts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="dex-popup-count-"]')].map((e) => e.dataset.testid.replace('dex-popup-count-', '')));
  check(`${w} A: the counts across the top`, ['decisions', 'tasks'].every((k) => counts.includes(k)), counts.join(', '));
  check(`${w} A: … and directly under them the decision's own breakdown`,
    await page.getByTestId('decision-panel-title').isVisible().catch(() => false)
    && (await page.locator('[data-testid^="decision-timeline-task-"]').count()) === 2
    && (await page.locator('[data-testid^="decision-task-person-"]').count()) === 2);
  check(`${w} A: the counts-only screen and its Review are gone`, (await page.getByTestId('desk-dex-review').count()) === 0);
  check(`${w} A: Approve, Save as draft and Reject are pinned and in reach`,
    await touchAndFold(page, 'decision-panel-actions', viewport)
    && (await page.getByTestId('desk-dex-later').innerText()).trim() === 'Save as draft');
  await page.getByTestId('decision-panel-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  check(`${w} A: … still in reach at the bottom of the breakdown`, await touchAndFold(page, 'decision-panel-actions', viewport));
  check(`${w} A: nothing is toasted while the pop-up shows it`, (await page.locator('[data-sonner-toast]').count()) === 0);
  await page.getByTestId('decision-approve').click();
  check(`${w} A: Approve issues it`, await until(async () => (await toasts(page, 'Approved').count()) > 0, 8000));
  check(`${w} A: … and the foot becomes Done`, await until(async () => (await page.getByTestId('decision-panel-done').count()) === 1, 8000));
  await page.getByTestId('decision-panel-done').click({ timeout: 5000 }).catch(() => page.getByTestId('dex-popup-close').click());
  { const o = await popupGone(page) && await wayOut(page, rest);
    check(`${w} D: Done gives the well back to the ripple`, o && o.back);
    check(`${w} D: … the same box it has been throughout`, o && o.same); }
  await gotoDesk(page);

  // ---------------------------------------------------- B · NOTHING TO DECIDE
  await setEnding(page, 'nothing');
  await typeAndSend(page, 'How much profit did we make this month?');
  check(behindDoor(page)
    ? `${w} B: a typed capture is typed IN step 1 and sent from it`
    : `${w} B: a typed capture skips step 1`, await atStep(page, 'reading', 4000));
  check(`${w} B: NOTHING TO DECIDE is the pop-up's last step`, await atStep(page, 'nothing'));
  const nothing = page.getByTestId('dex-outcome-nothing');
  const nothingText = clip(await nothing.textContent().catch(() => ''), 200);
  check(`${w} B: Dex's answer is shown`, /question, not a decision/.test(nothingText), nothingText.slice(0, 80));
  check(`${w} B: exactly one way out`,
    (await page.getByTestId('dex-popup-gotit').count()) === 1 && (await page.getByTestId('dex-outcome-retry').count()) === 0);
  check(`${w} B: not styled as an error`, (await nothing.getAttribute('role')) !== 'alert' && (await nothing.locator('svg').count()) === 0);
  check(`${w} B: its control is in reach`, await onGlass(page, 'dex-popup-gotit', viewport));
  await page.getByTestId('dex-popup-gotit').click();
  { const o = await popupGone(page) && await wayOut(page, rest);
    check(`${w} D: "Got it" gives the well back`, o && o.back);
    check(`${w} D: … unmoved`, o && o.same); }

  // ------------------------------------------- C · FAILED, with a file attached
  await setEnding(page, 'consent');
  /* ATTACH MOVED INTO THE POP-UP on the slider (2026-10-02): you attach to a
     decision after you have said it, not before. So the file is chosen from the
     words, which means getting to step 1 first. The well is unchanged. */
  let chooser;
  if (behindDoor(page)) {
    await openDoor(page);
    await stopControl(page).click();
    await page.getByTestId('dex-popup-attach').waitFor({ timeout: 10000 });
    [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.getByTestId('dex-popup-attach').click(),
    ]);
  } else {
    [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }),
      page.getByTestId('desk-dex-attach').click(),
    ]);
  }
  await chooser.setFiles({ name: 'indigo-po.png', mimeType: 'image/png', buffer: PNG });
  /* The chips follow the paperclip: in the well on desktop, in the door on a
     phone, because that is the surface whose floor you pressed. */
  const chips = page.locator('ul[aria-label="Attached files"] li');
  await chips.first().waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} C: the file is attached in the well`, (await chips.count()) === 1);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await page.waitForTimeout(1200);
  check(`${w} C: the file goes with the capture`, (await chips.count()) === 0);
  check(`${w} C: the FAILED ending is the pop-up's last step`, await atStep(page, 'failed'));
  const failed = page.getByTestId('dex-outcome-failed');
  check(`${w} C: it is announced`, (await failed.getAttribute('role')) === 'alert');
  const reason = page.getByTestId('dex-outcome-reason');
  const reasonText = clip(await reason.textContent().catch(() => ''), 200);
  check(`${w} C: the consent reason, in the Desk's words`, reasonText === CONSENT, reasonText);
  const whole = await reason.evaluate((el) => el.scrollWidth <= el.clientWidth + 1
    && getComputedStyle(el).textOverflow !== 'ellipsis').catch(() => false);
  check(`${w} C: the reason is not truncated`, whole);
  const link = page.getByTestId('dex-outcome-settings');
  check(`${w} C: it links to the AI-consent screen`,
    (await link.getAttribute('href').catch(() => '')) === '/settings?tab=business#ai-consent');
  check(`${w} C: … and that link is a 44px target`, (await link.evaluate((e) => e.offsetHeight).catch(() => 0)) >= 44);
  check(`${w} C: Retry and Not now are in reach`,
    await onGlass(page, 'dex-outcome-retry', viewport) && await onGlass(page, 'dex-popup-notnow', viewport));
  await page.getByTestId('dex-outcome-retry').click();
  check(`${w} C: Retry reads it again, in the same pop-up`, await atStep(page, 'reading', 6000));
  check(`${w} C: the re-sent capture reaches its own ending`, await atStep(page, 'failed'));
  await page.getByTestId('dex-popup-notnow').click();
  check(`${w} D: "Not now" gives the well back too`, await popupGone(page) && (await wayOut(page, rest)).back);
  await gotoDesk(page);

  // ------------------------- E · closing is not cancelling; one note at a time
  await setEnding(page, null);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await atStep(page, 'reading', 4000);
  await page.getByTestId('dex-popup-close').click();
  check(`${w} E: the pop-up closes while Dex reads`, await popupGone(page));
  check(`${w} E: … and the well says it is still reading`,
    (await page.getByTestId('dex-well-status').getAttribute('data-status').catch(() => null)) === 'reading');
  /* THE SECOND CAPTURE IS A DRAG on the slider, because that is what starting
     one is there — there is no field to type into until a capture exists. The
     refusal has to be the same either way: plain words, and nothing opened. */
  if (behindDoor(page)) {
    await openDoor(page);
  } else {
    await typeAndSend(page, 'Ask Priya to book the Tirupur truck for Thursday');
  }
  await page.waitForTimeout(1200);
  check(`${w} E: a second capture meanwhile is refused in plain words`,
    (await toasts(page, 'Dex is still reading your last one').count()) >= 1 && (await popup(page).count()) === 0);
  check(`${w} E: the first still reaches its ending`,
    await until(async () => (await page.getByTestId('dex-well-status').getAttribute('data-status').catch(() => null)) === 'ready'));
  check(`${w} E: … and says so, since the pop-up was closed`, (await toasts(page, 'Decision ready').count()) >= 1);
  await toDesk(page);
  await page.getByTestId('dex-well-status').click();
  check(`${w} E: opening it again shows where it got to`, await atStep(page, 'made', 5000));
  await page.getByTestId('desk-dex-later').click();
  check(`${w} D: Save as draft gives the well back`, await popupGone(page) && (await wayOut(page, rest)).back);
  /* 2026-09-27 — ON THE DECISION, NOT IN THIS BROWSER. The mark was a list of
     ids in localStorage when PILOT-2 B shipped the rename; it is a field on the
     decision now (POST /decisions/:id/draft, lib/decisionDrafts), so that it
     reaches the founder's phone too. Asserting the old key here would be
     asserting last week's design. */
  check(`${w} D: … and marks the decision a draft, on the decision`,
    await until(async () => (await page.evaluate(() => (window.__DOS_FIXTURE_CALLS || [])
      .some((c) => c.method === 'POST' && /\/decisions\/dec_fixture\/draft$/.test(c.url)))), 6000));
  /* typeAndSend, not a hand-rolled fill-and-Enter: Enter sends from the
     composer but the pop-up's first step sends with Next, and this is the one
     place that still spelled it out itself. */
  await typeAndSend(page, 'Ask Priya to book the Tirupur truck for Thursday');
  check(`${w} E: and the next send goes through once it has`, await atStep(page, 'reading', 8000));
  check(`${w} F: no decide path opened the sheet, all run long`, (await sheet(page).count()) === 0);
  await atStep(page, 'made');
  await page.getByTestId('dex-popup-close').click();
  await popupGone(page);

  // ----------------------------------------- G · the words are kept, not lost
  await setSaid(page, LONG);
  await micPress(page);
  await page.waitForTimeout(1200);
  await stopControl(page).click();
  await atStep(page, 'said', 4000);
  await until(async () => (await field.inputValue()).length > 100, 20000);
  await page.getByTestId('dex-popup-close').click();
  await popupGone(page);
  await toDesk(page);
  const note = page.getByTestId('dex-well-draft');
  check(`${w} G: closed on step 1, the well says the words are kept`, await note.isVisible().catch(() => false));
  check(`${w} G: … and offers them back, not in its pill`,
    (await page.getByTestId('dex-well-draft-open').count()) === 1 && (await page.getByTestId('desk-dex-composer').count()) === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId(behindDoor(page) ? 'dex-slider' : 'desk-insight').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  /* NO openDoor here, deliberately. A reload closes the door, and the kept
     words are offered on the DESK now rather than inside it — which is the
     point of moving that note out: closing the door must never be able to hide
     unsent words. */
  check(`${w} G: they survive a reload`, /Kept from before/.test(await note.textContent().catch(() => '')));
  await page.getByTestId('dex-well-draft-open').click();
  check(`${w} G: Open brings step 1 back with them`,
    await atStep(page, 'said', 4000) && (await field.inputValue().catch(() => '')) === LONG);
  await page.getByTestId('dex-popup-discard').click();
  check(`${w} G: Discard lets them go`, await popupGone(page) && (await note.count()) === 0);

  // ------------------------------------------------- F · the sheet is Ask-only
  if (phone) {
    /* ONE TAP, OR ONE DRAG. The Ask circle was the Desk's way into the sheet;
       with the slider it is the track's left end, and the circle is gone from
       this page on purpose (it is still beside the dock everywhere else —
       verify:nav measures it there). What is being asserted is unchanged: the
       way in from the Desk opens the ASK sheet, and no decide path did. */
    if (DEX_SLIDER) {
      check(`${w} F: the Desk has no Ask circle while the slider is there`,
        (await page.getByTestId('dex-fab').count()) === 0);
      /* Nothing to dismiss before the left drag any more — the capture lives in
         the track, and the track is where this drag starts. */
      const track = await page.locator('[data-testid="dex-slider"] .kr-slider-well').boundingBox();
      const h = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
      const cy = h.y + h.height / 2;
      await page.mouse.move(h.x + h.width / 2, cy);
      await page.mouse.down();
      await page.mouse.move(track.x + 2, cy, { steps: 16 });
      await page.mouse.up();
    } else {
      await page.getByTestId('dex-fab').click();
    }
    /* 2026-10-06 — ASK OPENS IN THE BAR, on every page. The Desk's in-sheet
       chat is gone with the Desk's slider: there is one control and one place
       the conversation appears, which is the dock grown into a panel. From the
       FAB (flag off) it is still the sheet over the page. */
    if (DEX_SLIDER) {
      const pane = page.getByTestId('dock-ask-panel');
      await pane.waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      check(`${w} F: the slider's left end opens Ask in the dock`, (await pane.count()) === 1);
      check(`${w} F: … and it is ASK`, /\bAsk\b/i.test(await pane.innerText().catch(() => '')),
        clip(await pane.innerText().catch(() => ''), 60));
      check(`${w} F: … and no sheet was raised over the page`, (await sheet(page).count()) === 0);
      check(`${w} F: … and the composer is the slider, not a plus menu`,
        (await page.getByTestId('dex-slider-plus').count()) === 0);
      await page.getByTestId('dock-ask-close').click();
    } else {
      await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(700);
      check(`${w} F: the FAB still opens the sheet in one tap`, (await sheet(page).count()) === 1);
      check(`${w} F: … and it is ASK`, /\bAsk\b/i.test(await sheet(page).innerText().catch(() => '')),
        clip(await sheet(page).innerText().catch(() => ''), 60));
      await page.getByTestId('dex-chat-close').click();
    }
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${w}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
  check(`${w}: no page errors`, errors.length === 0, errors[0] || '');
  await ctx.close();
}

await run({ width: 1440, height: 950 });
await run({ width: 390, height: 844 });
await run({ width: 360, height: 640 });
await browser.close();

const failedChecks = results.filter((r) => !r.pass);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
if (failedChecks.length) {
  console.log('\nfailed:');
  for (const f of failedChecks) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failedChecks.length ? 1 : 0);

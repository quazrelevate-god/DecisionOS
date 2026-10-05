/* DEX-SLIDER — the phone Desk's slider, its door, and Ask.
 *
 * Runs against whichever way the flag is set: ON it asserts the slider's
 * contract, OFF it asserts the Desk is the well's again and gets out of the
 * way (verify-dex.mjs owns that side and passes 193/193 on it). Both paths
 * stay alive, so both have to keep passing.
 *
 *   AUDIT_BASE=http://localhost:3000 npm run verify:slider
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';
import { DEX_SLIDER } from '../src/lib/flags.js';

/* Poll until a condition holds. verify-dex has its own; this file had no need
   of one until the door started listening by itself, which is a state that
   arrives a frame or two after the drag rather than with it. */
const until = async (fn, timeout = 8000, step = 150) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const WIDTHS = [[390, 844], [360, 640]];

let pass = 0, fail = 0;
const check = (n, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${got !== undefined ? ` — ${got}` : ''}`);
  ok ? pass++ : fail++;
};

/* A fake microphone, because the door starts listening by itself now and a
   getUserMedia that is never answered is indistinguishable from a door that
   does not listen — which is the check right below. */
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

if (!DEX_SLIDER) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  const page = await ctx.newPage();
  await signIn(page, BASE);
  await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="desk-board"]', { timeout: 25000 });
  await page.waitForTimeout(1500);
  console.log('\nflag OFF — the Desk is the well\'s again');
  check('no slider', (await page.locator('[data-testid="dex-slider"]').count()) === 0);
  check('the well is back', (await page.locator('.kr-well').count()) >= 1);
  check('and the Ask circle with it', (await page.locator('[data-testid="dex-fab"]').count()) === 1);
  await ctx.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}

for (const [w, h] of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await signIn(page, BASE);
  await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dex-slider"]', { timeout: 25000 });
  await page.waitForTimeout(1500);
  console.log(`\n${w}x${h}`);

  // ── the Desk's order, and that it still fits ───────────────────────────────
  const box = async (t) => (await page.locator(`[data-testid="${t}"]`).boundingBox());
  const [kpi, board, dex] = [await box('desk-kpi-grid'), await box('desk-board'), await box('desk-insight')];
  check('tiles, then the card, then the control', kpi.y < board.y && board.y < dex.y);
  check('the card sits directly on the control', dex.y - (board.y + board.height) <= 16,
    `${Math.round(dex.y - (board.y + board.height))}px`);
  check('the page does not scroll',
    await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 2));
  check('no horizontal overflow',
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  check('the Desk has no Ask circle', (await page.locator('[data-testid="dex-fab"]').count()) === 0);

  // ── the slider ────────────────────────────────────────────────────────────
  const track = await page.locator('[data-testid="dex-slider"] .kr-slider-well').boundingBox();
  const rest = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  const cy = rest.y + rest.height / 2;
  check('the handle rests at the centre',
    Math.abs((rest.x + rest.width / 2) - (track.x + track.width / 2)) <= 2);
  check('both ends are named in words',
    /ask/i.test(await page.locator('[data-testid="dex-slider"]').innerText()));
  /* The system owns the first few points of either edge. The handle starts in
     the middle, which is why a drag here is never read as a back gesture. */
  check('the handle starts clear of the edge gestures',
    rest.x > 24 && (w - (rest.x + rest.width)) > 24,
    `${Math.round(rest.x)}px / ${Math.round(w - (rest.x + rest.width))}px`);

  /* 2026-10-01, the founder's own review of the control on a phone. Three
     claims that can only be checked mid-drag, which is why they live here and
     not in a screenshot: the handle fills the well, it travels to the wall,
     and the words get out of its way on the approach. */
  const handleBox = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  check('the handle fills the well, bar a hair',
    (track.height - handleBox.height) / 2 <= 6 && (track.height - handleBox.height) / 2 >= 2,
    `${Math.round((track.height - handleBox.height) / 2)}px above and below`);

  const drag = async (toX, release = true) => {
    await page.mouse.move(rest.x + rest.width / 2, cy);
    await page.mouse.down();
    await page.mouse.move(toX, cy, { steps: 16 });
    if (release) { await page.mouse.up(); await page.waitForTimeout(600); }
  };

  // short of the end: springs back, nothing happens
  await drag(track.x + track.width - 70, false);
  const moved = (await page.locator('[data-testid="dex-slider-handle"]').boundingBox()).x;
  check('the handle follows the finger', moved > rest.x + 20, `${Math.round(moved - rest.x)}px`);
  await page.mouse.up();
  await page.waitForTimeout(500);
  check('released short of the end, it springs back',
    Math.abs((await page.locator('[data-testid="dex-slider-handle"]').boundingBox()).x - rest.x) <= 3);
  check('and nothing opened',
    (await page.locator('[data-testid="dex-chat"], [data-testid="dex-decide-overlay"]').count()) === 0);

  // ── it goes all the way, and the words step aside ────────────────────────
  const labelOpacity = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="dex-slider"] span[aria-hidden="true"]')]
      .filter((e) => /^(Ask|Decide)$/.test(e.textContent.trim()))
      .map((e) => Number(getComputedStyle(e).opacity)));

  const rest0 = await labelOpacity();
  check('at rest the ends are named, legibly', rest0.length === 2 && rest0.every((o) => o > 0.9));

  await drag(track.x + track.width / 2 + 40, false);     // part way, held
  const mid = await labelOpacity();
  await page.mouse.move(track.x + track.width - 2, cy, { steps: 8 });
  /* Let the last of the eight moves actually render. Without this the box is
     read somewhere around the sixth step and the handle looks ~29px short of a
     wall it does reach — a measurement artefact, not the control. */
  await page.waitForTimeout(200);
  const far = await labelOpacity();
  const atEnd = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  check('the words fade progressively on the approach',
    mid.every((o) => o < 0.95) && far.every((o) => o < mid[0]),
    `${rest0[0].toFixed(2)} -> ${mid[0].toFixed(2)} -> ${far[0].toFixed(2)}`);
  check('…and are gone by the time it commits', far.every((o) => o <= 0.05));
  check('the handle reaches the wall, with nothing held back',
    Math.abs((atEnd.x + atEnd.width) - (track.x + track.width)) <= 1,
    `${Math.round((track.x + track.width) - (atEnd.x + atEnd.width))}px short`);
  await page.mouse.up();
  await page.waitForTimeout(600);

  /* ── right: THE TRACK IS THE RECORDING SURFACE ───────────────────────────
     The full-screen door is gone (2026-10-02). It was the Desk blurred behind
     a centred mic with attach and a keyboard in the corners; the founder's
     redesign repurposes the slider itself, which is the same move the dock
     already makes for Ask — the bar you already have becomes Dex rather than a
     second one being drawn over it (KM-26). So there is no overlay to assert,
     no screen to measure and nothing to dismiss: the handle parks at the stop,
     the track draws DexWave, and pressing the handle stops and sends.
     RETIRED HERE: dex-decide-overlay, dex-decide-close, and the door's copies
     of desk-dex-ripple / desk-dex-attach / desk-dex-keyboard. The well still
     carries all of those and verify:dex measures them there. */
  await drag(track.x + track.width - 2);
  check('a full drag right starts a capture, with no screen over the Desk',
    (await page.locator('[data-testid="dex-decide-overlay"]').count()) === 0
    && await until(async () =>
      (await page.locator('[data-testid="dex-slider-handle"]').getAttribute('aria-label') || '')
        .toLowerCase().includes('stop'), 6000));
  check('it is listening without a second press',
    await until(async () => (await page.locator('[data-testid="dex-slider"] canvas, [data-testid="dex-slider"] svg path').count()) > 0, 4000));

  const parked = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  check('the handle is parked at the stop, not loose on the track',
    Math.abs((parked.x + parked.width) - (track.x + track.width)) <= 1,
    `${Math.round((track.x + track.width) - (parked.x + parked.width))}px from the wall`);
  /* The VISIBLE ends, not the text content: the track also carries an sr-only
     live region that says what the control is doing, and that is supposed to
     speak louder while recording, not go quiet. */
  const visibleEnds = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="dex-slider"] span[aria-hidden="true"]')]
      .filter((e) => /^(Ask|Decide)$/.test(e.textContent.trim())).length);
  check('the ends are no longer offered while it records', (await visibleEnds()) === 0);

  /* Dragging is OFF, not merely ignored: a stray finger must not be able to
     scrub a live recording back to the middle. */
  await page.mouse.move(parked.x + parked.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width / 2, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const stillParked = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  check('a drag cannot move the handle while it is recording',
    Math.abs(stillParked.x - parked.x) <= 1);

  await page.locator('[data-testid="dex-slider-handle"]').click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ timeout: 12000 });
  check('pressing the handle stops and hands over to the pop-up',
    (await page.locator('[data-testid="dex-popup"]').getAttribute('data-step')) === 'said');
  check('attach is offered WITH the words, not before them',
    (await page.locator('[data-testid="dex-popup-attach"]').count()) === 1);
  check('…and the recording surface carries no paperclip of its own',
    (await page.locator('[data-testid="dex-slider"] [data-testid="desk-dex-attach"]').count()) === 0);
  check('the transcript is editable, which is where typing happens now',
    (await page.locator('[data-testid="dex-popup-transcript"]').count()) === 1);

  await page.locator('[data-testid="dex-popup-discard"]').click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ state: 'detached', timeout: 8000 });
  await page.waitForTimeout(700);
  const settled = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  check('the handle returns to the middle once the capture is done',
    Math.abs((settled.x + settled.width / 2) - (track.x + track.width / 2)) <= 3,
    `${Math.round((settled.x + settled.width / 2) - (track.x + track.width / 2))}px off centre`);
  check('and the ends are named again', (await visibleEnds()) === 2);

  /* ── left: Ask, IN THE SHEET ───────────────────────────────────────────────
     2026-10-05 — the left end no longer raises a sheet over the Desk. The
     founder's redesign clears the board and talks in it: the transcript takes
     the sheet, the KPI grid folds away, and this control becomes the composer.
     So the check is the same question asked of the new place. */
  await drag(track.x + 2);
  await page.waitForTimeout(600);
  check('a full drag left opens Ask in the sheet',
    (await page.locator('[data-testid="desk-ask-pane"]').count()) === 1);
  check('…and not as a sheet over the Desk',
    (await page.locator('[data-testid="dex-chat"]').count()) === 0);
  check('the KPI grid folds away to make room',
    (await page.locator('[data-testid="desk-kpi-grid"]').count()) === 0);
  /* 2026-10-05 second pass — the plus and the in-slider text field are GONE.
     Ask behaves as Decide does: the handle parks left, pressing it ends the
     listening and raises a review card, and all the typing, attaching and
     editing happens in there. */
  check('the control carries no plus and no field',
    (await page.locator('[data-testid="dex-slider-plus"]').count()) === 0
    && (await page.locator('[data-testid="dex-slider-field"]').count()) === 0);
  await page.locator('[data-testid="desk-ask-close"]').click();
  await page.waitForTimeout(700);
  check('closing Ask gives the Desk back',
    (await page.locator('[data-testid="desk-kpi-grid"]').count()) === 1);
  check('the handle is back at centre after a door closes',
    Math.abs((await page.locator('[data-testid="dex-slider-handle"]').boundingBox()).x - rest.x) <= 2);

  check('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);

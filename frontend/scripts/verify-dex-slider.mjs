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

  // ── right: the decision door ──────────────────────────────────────────────
  await drag(track.x + track.width - 2);
  check('a full drag right opens the door', (await page.locator('[data-testid="dex-decide-overlay"]').count()) === 1);
  const ov = await box('dex-decide-overlay');
  check('it is the whole screen', ov.width >= w - 1 && ov.height >= h - 1);
  const inOverlay = (t) => page.locator(`[data-testid="dex-decide-overlay"] [data-testid="${t}"]`).count();
  check('the mic and its ripple are the centre', (await inOverlay('desk-dex-ripple')) === 1);
  check('attach kept its testid', (await inOverlay('desk-dex-attach')) === 1);
  check('the keyboard kept its testid', (await inOverlay('desk-dex-keyboard')) === 1);
  check('there is an X to cancel', (await page.locator('[data-testid="dex-decide-close"]').count()) === 1);
  /* env(safe-area-inset-top) is 0 in a browser, so a pixel threshold would only
     ever measure the base padding. What is checkable here is that the inset is
     in the expression at all; the notch itself needs a device. */
  const padTop = await page.locator('[data-testid="dex-decide-overlay"] > div:nth-child(2)')
    .evaluate((el) => getComputedStyle(el).paddingTop);
  check('the X sits below the safe-area inset', padTop === '12px', `${padTop} with no notch`);
  /* THE DOOR OPENS LISTENING — reversed on 2026-10-01 at the founder's word.
     It used to assert the opposite, and the component's own note explained why
     (a screen that is already listening startles people). They have used it and
     disagree: reaching this screen already costs a full deliberate drag, and
     having to hunt for the mic afterwards makes that drag feel like it did
     nothing. The drag is the press. Asserted on aria-pressed, which is the same
     thing a screen reader is told, rather than on any glyph. */
  check('the door opens listening',
    await until(async () => (await page.locator('[data-testid="voice-ripple-mic"]').getAttribute('aria-pressed')) === 'true', 6000));
  check('…and the mic is held down, not swapped for a stop square',
    (await page.locator('[data-testid="dex-decide-overlay"] [data-testid="voice-ripple-mic"] svg').count()) === 1);
  /* Put it back where the rest of this section expects to find it: stopped,
     the words thrown away, the door open again. Waits are on STATE, not on a
     stopwatch — stopping hands over to the pop-up, which shuts the door, and
     each of those takes as long as it takes. */
  await page.locator('[data-testid="voice-ripple-mic"]').click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ timeout: 8000 });
  await page.locator('[data-testid="dex-popup-discard"]').click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ state: 'detached', timeout: 8000 });
  await page.locator('[data-testid="dex-slider"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await drag(track.x + track.width - 2);
  await page.locator('[data-testid="dex-decide-overlay"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  /* THE TYPING FALLBACK, on a door that is already listening. The brief calls
     this a backup path that is rarely used and must work; the auto-start made
     the button disabled for the whole life of the recording, which would have
     meant it did not. It is enabled on this surface now, and it stops and hands
     the words over as editable text rather than opening an empty field — which
     is the better answer anyway: you type from what you already said. */
  const kb = page.locator('[data-testid="dex-decide-overlay"] [data-testid="desk-dex-keyboard"]');
  check('the keyboard is reachable while the door listens', await kb.isEnabled());
  await kb.click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ timeout: 8000 });
  check('…and it stops and offers what you said, editable',
    (await page.locator('[data-testid="dex-popup"]').getAttribute('data-step')) === 'said'
    && (await page.locator('[data-testid="dex-popup-transcript"]').count()) === 1);
  await page.locator('[data-testid="dex-popup-discard"]').click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ state: 'detached', timeout: 8000 });
  await page.locator('[data-testid="dex-slider"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await drag(track.x + track.width - 2);
  await page.locator('[data-testid="dex-decide-overlay"]').waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);

  /* THE DOOR STANDS ASIDE FOR THE POP-UP — reported from the founder's iPhone
     and the reason this check exists: they spoke, pressed stop, and the blurred
     mic screen simply stayed while step 1, the reading and the review all ran
     BEHIND it, unreachable. The pop-up is a dialog at z-50 and the door is
     9500, so it was underneath; and the door has no job once the words exist.
     Asserted on the SPOKEN path now, which is the path the founder was on when
     they reported it: the door is already listening, so stopping is the whole
     gesture. It used to type instead, because the door did not record on open
     and a fake microphone was more machinery than the check needed. */
  await page.locator('[data-testid="voice-ripple-mic"]').click();
  await page.locator('[data-testid="dex-popup"]').waitFor({ timeout: 10000 }).catch(() => {});
  check('sending hands over to the pop-up', (await page.locator('[data-testid="dex-popup"]').count()) === 1);
  check('…and the door stands aside rather than burying it',
    (await page.locator('[data-testid="dex-decide-overlay"]').count()) === 0);
  await page.locator('[data-testid="dex-popup-discard"]').click()
    .catch(() => page.locator('[data-testid="dex-popup-close"]').click().catch(() => {}));
  await page.waitForTimeout(800);
  check('closing the pop-up leaves you on the Desk, not in the door',
    (await page.locator('[data-testid="dex-slider"]').count()) === 1
    && (await page.locator('[data-testid="dex-decide-overlay"]').count()) === 0);

  await drag(track.x + track.width - 2);   // open it again, so "back" has a door to close
  await page.goBack();
  await page.waitForTimeout(700);
  check('back closes the door', (await page.locator('[data-testid="dex-decide-overlay"]').count()) === 0);

  // ── left: Ask, unchanged ──────────────────────────────────────────────────
  await drag(track.x + 2);
  check('a full drag left opens Ask', (await page.locator('[data-testid="dex-chat"]').count()) === 1);
  await page.goBack();
  await page.waitForTimeout(700);
  check('the handle is back at centre after a door closes',
    Math.abs((await page.locator('[data-testid="dex-slider-handle"]').boundingBox()).x - rest.x) <= 2);

  check('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);

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

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const WIDTHS = [[390, 844], [360, 640]];

let pass = 0, fail = 0;
const check = (n, ok, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${n}${got !== undefined ? ` — ${got}` : ''}`);
  ok ? pass++ : fail++;
};

const browser = await chromium.launch();

if (!DEX_SLIDER) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
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
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
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
  check('nothing is recording on open',
    !(await page.locator('[data-testid="dex-decide-overlay"]').innerText()).toLowerCase().includes('recording'));
  await page.locator('[data-testid="dex-decide-overlay"] [data-testid="desk-dex-keyboard"]').click();
  await page.waitForTimeout(600);
  check('the keyboard opens a composer',
    (await page.locator('[data-testid="desk-dex-floating"], [data-testid="desk-dex-composer"]').count()) >= 1);
  /* Put it away before anything else is tried. The floating composer brings a
     fixed inset-0 scrim with it, and a scrim left up swallows the next drag —
     which is how this suite first "proved" that a left swipe did not open Ask. */
  await page.locator('[data-testid="desk-dex-floating-scrim"]').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(400);
  check('tapping away puts the composer away',
    (await page.locator('[data-testid="desk-dex-floating-scrim"]').count()) === 0);

  /* THE DOOR STANDS ASIDE FOR THE POP-UP — reported from the founder's iPhone
     and the reason this check exists: they spoke, pressed stop, and the blurred
     mic screen simply stayed while step 1, the reading and the review all ran
     BEHIND it, unreachable. The pop-up is a dialog at z-50 and the door is
     9500, so it was underneath; and the door has no job once the words exist.
     Typed words take exactly the same path as spoken ones, which is why this
     can be asserted here without a microphone. */
  await page.getByTestId('desk-dex-keyboard').click();
  const composer = page.locator('[data-testid="desk-dex-floating"], [data-testid="desk-dex-composer"]').first();
  await composer.waitFor({ timeout: 5000 });
  await composer.locator('textarea').fill('Tell Suresh to ship the indigo lot before Friday');
  await composer.locator('textarea').press('Enter');
  await page.locator('[data-testid="dex-popup"]').waitFor({ timeout: 10000 }).catch(() => {});
  check('sending hands over to the pop-up', (await page.locator('[data-testid="dex-popup"]').count()) === 1);
  check('…and the door stands aside rather than burying it',
    (await page.locator('[data-testid="dex-decide-overlay"]').count()) === 0);
  await page.locator('[data-testid="dex-popup-close"]').click().catch(() => {});
  await page.waitForTimeout(600);
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

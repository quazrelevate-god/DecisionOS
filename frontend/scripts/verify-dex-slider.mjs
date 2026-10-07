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
  const rowType = {};

  // ── the Desk's order, and that it still fits ───────────────────────────────
  const box = async (t) => (await page.locator(`[data-testid="${t}"]`).boundingBox());
  /* 2026-10-06 — THE CONTROL LEFT THE PAGE. It is the dock now, on every
     screen, so the Desk's order is tiles then card then the BAR — and the bar
     is `fixed`, not a row in the column, so "sits directly on" is measured
     against it rather than against a sibling. */
  const [kpi, board, dex] = [await box('desk-kpi-grid'), await box('desk-board'), await box('dock-slider')];
  check('tiles, then the card, then the control', kpi.y < board.y && board.y < dex.y);
  check('the card sits directly on the control', dex.y - (board.y + board.height) <= 24,
    `${Math.round(dex.y - (board.y + board.height))}px`);
  check('the page does not scroll',
    await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 2));
  check('no horizontal overflow',
    (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  check('the Desk has no Ask circle', (await page.locator('[data-testid="dex-fab"]').count()) === 0);

  /* ── THE SHEET'S THREE TABS ARE ONE LIST ──────────────────────────────────
     2026-10-06, founder: the rows should use "the entire space" of the card,
     the Watch cards "scaled up to fill the entire space it has", approvals
     "the same type of card height", and none of them "overlap or compressed in
     any situation". Every one of those is a measurement, so here they are —
     at 390x844 and at 360x640, which is the screen where the room runs out.
     What the numbers caught when they were first taken: Watch drew three 42px
     cards and left 190px of black under them; Decisions drew three 14px
     slivers of sliced type at 360x640; Watch's third card ran out of the sheet
     and under the dock there. */
  for (const tab of ['decisions', 'watch', 'approvals']) {
    await page.locator(`[data-testid="desk-tab-${tab}"]`).click();
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="desk-phone-card-card"]');
      const list = card && card.firstElementChild;
      if (!list) return null;
      const rows = [...list.querySelectorAll('[data-row]')];
      const lb = list.getBoundingClientRect();
      const boxes = rows.map((r) => r.getBoundingClientRect());
      const more = document.querySelector('[data-testid="desk-phone-more"]');
      return {
        rows: rows.length,
        /* clipped: the row is drawn shorter than the content inside it. 2px of
           slack for sub-pixel line-heights at a fractional --desk-row-scale. */
        clipped: rows.filter((r) => r.scrollHeight > r.clientHeight + 2).length,
        /* the foot of the last row against the foot of the list it is in */
        slack: boxes.length ? Math.round(lb.bottom - boxes[boxes.length - 1].bottom) : null,
        overlap: boxes.some((b, i) => i > 0 && b.top < boxes[i - 1].bottom - 1),
        escapes: boxes.some((b) => b.bottom > lb.bottom + 1 || b.top < lb.top - 1),
        title: rows.length ? getComputedStyle(rows[0].querySelector('.kr-desk-row-title')).fontSize : null,
        more: more ? Math.round(more.getBoundingClientRect().height) : 0,
        empty: !!document.querySelector('[data-testid="desk-phone-card-empty"]'),
      };
    });
    if (!m || (m.rows === 0 && m.empty)) { check(`${tab}: the tab is empty, nothing to fit`, true); continue; }
    check(`${tab}: it has rows`, m.rows > 0, `${m.rows}`);
    check(`${tab}: nothing is compressed`, m.clipped === 0, `${m.clipped} clipped`);
    check(`${tab}: nothing overlaps or leaves the card`, !m.overlap && !m.escapes);
    /* FILLS IT: the last row ends at the foot of the list, bar the slack a
       capped row count leaves (one row's worth is the most that can be left
       over before a row would have fitted). */
    check(`${tab}: the rows use the whole card`, m.slack !== null && m.slack <= 24, `${m.slack}px left under them`);
    rowType[tab] = m.title;
  }
  /* ONE TYPE ACROSS THE TABS, to within the scale. The tabs are not always
     given the same height — a tab with more than three rows spends 44-56px of
     its card on the Show all control and the others do not — so the fit can
     land a tab a few per cent apart. Within half a point is "the same size" to
     an eye; a tab drawn at a different SIZE (the 15px Watch cards against the
     17px rows beside them, before this) is 2px out and fails. */
  {
    const sizes = Object.values(rowType).filter(Boolean).map((v) => parseFloat(v));
    const spread = sizes.length ? Math.max(...sizes) - Math.min(...sizes) : 0;
    check('one type across the three tabs', spread <= 0.75,
      Object.entries(rowType).map(([k, v]) => `${k} ${v}`).join(', '));
  }

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
  /* …and WHICH word it is, because only one of them may appear at a time now.
     Keyed by the word rather than by DOM order: in the dock the two labels
     print on the opposite side from the end they name, and an index would be
     asserting that swap rather than the rule. */
  const labelsByWord = () => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('[data-testid="dex-slider"] span[aria-hidden="true"]')]
      .filter((e) => /^(Ask|Decide)$/.test(e.textContent.trim()))
      .map((e) => [e.textContent.trim(), Number(getComputedStyle(e).opacity)])));

  /* 2026-10-06 — THE ENDS INVERT IN THE DOCK. On the Desk's old in-sheet
     control they were named at rest and got out of the way as the handle
     arrived; the bar already carries four destinations, so they ARRIVE as those
     leave. Same number driving both, opposite direction. */
  const rest0 = await labelOpacity();
  check('at rest the bar shows destinations, not ends',
    rest0.length === 2 && rest0.every((o) => o < 0.05), `${rest0.map((o) => o.toFixed(2)).join(' / ')}`);

  await drag(track.x + track.width / 2 + 40, false);     // part way, held
  const mid = await labelOpacity();
  const midWord = await labelsByWord();
  await page.mouse.move(track.x + track.width - 2, cy, { steps: 8 });
  /* Let the last of the eight moves actually render. Without this the box is
     read somewhere around the sixth step and the handle looks ~29px short of a
     wall it does reach — a measurement artefact, not the control. */
  await page.waitForTimeout(200);
  const far = await labelOpacity();
  const farWord = await labelsByWord();
  const atEnd = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  /* 2026-10-06 (founder) — ONE WORD, AND IT IS THE ONE THIS DRAG IS GOING TO.
     Both used to arrive together, which meant a drag to the right lit "Decide"
     on the left AND "Ask" on the right — and the word at the end you are
     travelling toward then says the opposite of what will happen: "people will
     confuse because we are swiping towards the Ask when we swipe right as the
     text indicates". The other word is not dimmed, it is absent. */
  check('the word for where this drag is going arrives progressively',
    midWord.Decide > 0.05 && farWord.Decide > midWord.Decide,
    `Decide ${rest0[0].toFixed(2)} -> ${midWord.Decide.toFixed(2)} -> ${farWord.Decide.toFixed(2)}`);
  check('…and is fully there by the time it commits', farWord.Decide >= 0.95);
  check('…while the word for the OTHER end never appears',
    midWord.Ask === 0 && farWord.Ask === 0, `Ask ${midWord.Ask} / ${farWord.Ask}`);
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
  /* ── left: Ask, IN THE DOCK ────────────────────────────────────────────────
     2026-10-06 — the sheet is a sheet again. Ask moved off this page entirely:
     the dock is the control on every screen and the conversation grows out of
     the bar, so what the left end opens is the dock's own panel. */
  await drag(track.x + 2);
  await page.waitForTimeout(900);
  check('a full drag left opens Ask in the dock',
    (await page.locator('[data-testid="dock-ask-panel"]').count()) === 1);
  check('…and not as a sheet over the page',
    (await page.locator('[data-testid="dex-chat"]').count()) === 0);
  check('the Desk keeps its KPI grid',
    (await page.locator('[data-testid="desk-kpi-grid"]').count()) === 1);
  check('the control carries no plus and no field',
    (await page.locator('[data-testid="dex-slider-plus"]').count()) === 0
    && (await page.locator('[data-testid="dex-slider-field"]').count()) === 0);
  await page.locator('[data-testid="dock-ask-close"]').click();
  await page.waitForTimeout(800);
  check('closing gives the bar its destinations back',
    (await page.locator('[data-testid="dock-slider-items"] [data-testid^="dock-"]').count()) === 4);

  check('no page errors', errs.length === 0, errs[0]);
  await ctx.close();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
await browser.close();
process.exit(fail ? 1 : 0);

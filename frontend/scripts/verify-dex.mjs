#!/usr/bin/env node
/**
 * MPWA-12e verification — the Dex sheet's three states (§5.6).
 *
 * Launched with Chromium's fake audio device so getUserMedia actually resolves
 * and the AnalyserNode sees a real signal — a waveform test that stubs the
 * amplitude would pass on an animation of random numbers, which is precisely the
 * thing §5.6 says a waveform must not be.
 *
 * Runs against the fixtures: the understanding state depends on the backend's
 * BackgroundTask walking a note queued -> transcribing -> structuring -> done,
 * and the fixture simulates that walk deterministically (and without spending an
 * LLM call per run).
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  permissions: ['microphone'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));

const openDex = async (route) => {
  await page.goto(`${BASE}${route}${route.includes('?') ? '&' : '?'}fixture=busy`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dex-fab"]', { timeout: 12000 });
  await page.waitForTimeout(700);
  await page.locator('[data-testid="dex-fab"]').click();
  await page.waitForSelector('[data-testid="dex-sheet"]', { timeout: 6000 });
  await page.waitForTimeout(500);
};
const stage = () => page.locator('[data-testid="dex-sheet-stage"]').getAttribute('data-stage');

// ------------------------------------------------------------------- idle
await openDex('/inbox');
check('opens in the idle state', (await stage()) === 'idle', await stage());

const mic = await page.locator('[data-testid="dex-mic-record"]').boundingBox();
check('the mic is the hero at 64px',
  Math.round(mic.width) === 64 && Math.round(mic.height) === 64,
  `${Math.round(mic.width)}x${Math.round(mic.height)}`);
const sheetBox = await page.locator('[data-testid="dex-sheet"]').boundingBox();
check('the mic is centred',
  Math.abs((mic.x + mic.width / 2) - (sheetBox.x + sheetBox.width / 2)) <= 2,
  `mic centre ${Math.round(mic.x + mic.width / 2)} vs sheet centre ${Math.round(sheetBox.x + sheetBox.width / 2)}`);
check('idle sits around 45% height, not the tall sheet',
  sheetBox.height / 844 < 0.62, `${Math.round((sheetBox.height / 844) * 100)}%`);

const placeholder = await page.locator('[data-testid="dex-text-input"]').getAttribute('placeholder');
check('typing is offered as the alternative', /type instead/i.test(placeholder), placeholder);

// §5.6: "Horizontal pills, not a vertical stack of four full-width buttons."
const pills = await page.locator('[data-testid="dex-suggestion"]').all();
check('there are suggestion chips', pills.length >= 3, `${pills.length} chips`);
const boxes = await Promise.all(pills.map((p) => p.boundingBox()));
const tops = new Set(boxes.map((b) => Math.round(b.y)));
check('chips are one horizontal row, not a vertical stack', tops.size === 1, `${tops.size} row(s)`);
check('chips are pills, not full-width buttons',
  boxes.every((b) => b.width < 390 * 0.9), `widest ${Math.round(Math.max(...boxes.map((b) => b.width)))}px`);
for (const b of boxes) {
  check(`chip clears 44px`, b.height >= 44, `${Math.round(b.height)}px`);
}
const chipRow = await page.locator('[data-testid="dex-chips"]').evaluate((el) => ({
  scrolls: el.scrollWidth > el.clientWidth + 1,
  overflowX: getComputedStyle(el).overflowX,
}));
check('the chip row scrolls horizontally', chipRow.overflowX === 'auto', JSON.stringify(chipRow));

const sendBox = await page.locator('[data-testid="dex-send"]').boundingBox();
check('Send is not clipped at the right edge', sendBox.x + sendBox.width <= 390 - 4,
  `right edge at ${Math.round(sendBox.x + sendBox.width)}`);

// §5.6: suggestions are contextual to the screen Dex was opened from.
const deskChips = (await page.locator('[data-testid="dex-suggestion"]').allInnerTexts()).join(' | ');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await openDex('/finance');
const moneyChips = (await page.locator('[data-testid="dex-suggestion"]').allInnerTexts()).join(' | ');
check('chips differ between Desk and Money', deskChips !== moneyChips,
  `desk: ${deskChips.slice(0, 40)}… / money: ${moneyChips.slice(0, 40)}…`);
check('Money offers a money phrase', /payment|owes|late/i.test(moneyChips), moneyChips.slice(0, 60));
check('Desk offers a decision phrase', /approve|waiting/i.test(deskChips), deskChips.slice(0, 60));
await openDex('/crm');
const crmChips = (await page.locator('[data-testid="dex-suggestion"]').allInnerTexts()).join(' | ');
check('CRM offers a relationship phrase', /call|customer|credit/i.test(crmChips), crmChips.slice(0, 60));
check('no chip set is reused verbatim across all three screens',
  new Set([deskChips, moneyChips, crmChips]).size === 3);

// tapping a chip fills the box rather than sending blind
await openDex('/inbox');
await page.locator('[data-testid="dex-suggestion"]').first().click();
await page.waitForTimeout(300);
const filled = await page.locator('[data-testid="dex-text-input"]').inputValue();
check('a chip fills the input instead of firing immediately', filled.length > 0, filled.slice(0, 50));

// -------------------------------------------------------------- recording
await page.locator('[data-testid="dex-mic-record"]').click();
await page.waitForSelector('[data-testid="dex-recording"]', { timeout: 8000 });
await page.waitForTimeout(400);
check('the mic starts the recording state', (await stage()) === 'recording', await stage());

const wave = page.locator('[data-testid="dex-waveform"]');
check('a waveform is shown, not a bare timer', await wave.isVisible());
const growBox = await page.locator('[data-testid="dex-sheet"]').boundingBox();
check('the sheet expands while recording', growBox.height / 844 >= 0.78,
  `${Math.round((growBox.height / 844) * 100)}%`);

// The bars must actually move with the input. Sample the geometry twice.
const shape = () => wave.evaluate((el) =>
  Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().height)).join(','));
const before = await shape();
await page.waitForTimeout(1400);
const after = await shape();
check('the waveform reacts to input amplitude', before !== after,
  `${before.slice(0, 40)}… -> ${after.slice(0, 40)}…`);
const amp = Number(await wave.getAttribute('data-amplitude'));
check('the amplitude read is non-zero on a live mic', amp > 0, String(amp));
const bars = await wave.evaluate((el) => new Set(Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().height))).size);
check('bars differ from each other (a signal, not a block)', bars > 1, `${bars} distinct heights`);

// Elapsed time present but secondary.
const elapsed = page.locator('[data-testid="dex-elapsed"]');
check('elapsed time is shown', /\d+:\d\d/.test((await elapsed.innerText()).trim()), (await elapsed.innerText()).trim());
const [eFs, wFs] = await Promise.all([
  elapsed.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  wave.evaluate((el) => el.getBoundingClientRect().height),
]);
check('elapsed time is secondary to the waveform', eFs <= 16 && wFs > eFs * 3,
  `${eFs}px text vs ${Math.round(wFs)}px waveform`);
const elapsedBox = await elapsed.boundingBox();
const waveBox = await wave.boundingBox();
check('elapsed time sits beneath the waveform', elapsedBox.y > waveBox.y + waveBox.height - 2,
  `elapsed y=${Math.round(elapsedBox.y)}, waveform bottom=${Math.round(waveBox.y + waveBox.height)}`);

const stopBox = await page.locator('[data-testid="dex-mic-stop"]').boundingBox();
check('the stop control is large', stopBox.height >= 64 && stopBox.width >= 64,
  `${Math.round(stopBox.width)}x${Math.round(stopBox.height)}`);
check('the idle chips are gone while recording',
  (await page.locator('[data-testid="dex-suggestion"]').count()) === 0);

// ---------------------------------------------------------- understanding
await page.locator('[data-testid="dex-mic-stop"]').click();
await page.waitForSelector('[data-testid="dex-understanding"]', { timeout: 15000 });
check('stopping goes straight to the understanding state', (await stage()) === 'understanding', await stage());

// §5.6: "It must not happen silently behind a 'structuring…' banner." The
// progression is visible, and it ends on structure.
const seen = new Set();
for (let i = 0; i < 24; i++) {
  const st = await page.locator('[data-testid="dex-understanding"]').getAttribute('data-status');
  seen.add(st);
  if (st === 'done' || st === 'failed' || st === 'slow') break;
  await page.waitForTimeout(500);
}
check('the pipeline is shown progressing, not hidden', seen.size >= 2, [...seen].join(' -> '));
check('it reaches a structured result', seen.has('done'), [...seen].join(' -> '));

check('Dex echoes back what it heard',
  /indigo/i.test(await page.locator('[data-testid="dex-heard"]').innerText()),
  (await page.locator('[data-testid="dex-heard"]').innerText()).replace(/\n/g, ' ').slice(0, 70));
const structured = page.locator('[data-testid="dex-structured"]');
check('the extraction is echoed as a structured card', await structured.isVisible());
const sText = (await structured.innerText()).replace(/\s+/g, ' ');
check('the card names what it became', sText.length > 30, sText.slice(0, 90));
const taskRows = await page.locator('[data-testid^="dex-task-"]').count();
check('the tasks it produced are listed', taskRows > 0, `${taskRows} task(s)`);
check('extracted fields are labelled (for / by)', /\bfor\b/.test(sText) || /\bby\b/.test(sText), sText.slice(0, 90));

const lr = await page.locator('[data-testid="dex-looks-right"]').boundingBox();
check('"Looks right" is offered', !!lr);
check('"Looks right" is on the 56px tier', lr.height >= 56, `${Math.round(lr.height)}px`);
const fx = await page.locator('[data-testid="dex-fix"]').boundingBox();
check('"Fix" is offered beside it', !!fx);
check('"Fix" clears 44px', fx.height >= 44, `${Math.round(fx.height)}px`);
check('"Looks right" and "Fix" are >= 8px apart',
  fx.x - (lr.x + lr.width) >= 7.5, `${Math.round(fx.x - (lr.x + lr.width))}px`);

// Fix hands the words back so he can restate them.
await page.locator('[data-testid="dex-fix"]').click();
await page.waitForTimeout(1200);
check('"Fix" returns to idle', (await stage()) === 'idle', await stage());
const back = await page.locator('[data-testid="dex-text-input"]').inputValue();
check('"Fix" hands the words back to be restated', /indigo/i.test(back), back.slice(0, 60));

// Typing is the other route into understanding.
await page.locator('[data-testid="dex-text-input"]').fill('Ask Priya about the Krishna payment');
await page.locator('[data-testid="dex-send"]').click();
await page.waitForSelector('[data-testid="dex-understanding"]', { timeout: 10000 });
check('typed capture reaches the understanding state too', (await stage()) === 'understanding');
for (let i = 0; i < 20; i++) {
  if ((await page.locator('[data-testid="dex-understanding"]').getAttribute('data-status')) === 'done') break;
  await page.waitForTimeout(500);
}
await page.locator('[data-testid="dex-looks-right"]').click();
await page.waitForTimeout(900);
check('"Looks right" closes the sheet',
  (await page.locator('[data-testid="dex-sheet"]').count()) === 0);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

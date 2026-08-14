#!/usr/bin/env node
/**
 * MPWA-06 verification — drives the Decision Desk.
 *
 * §8's done-when: cold open -> the top item is readable without scrolling; six
 * decisions clearable without leaving the sheet; page under 2,500px.
 */
import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await ctx.clock.setFixedTime(new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`));
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-mobile"]', { timeout: 15000 });
await page.waitForTimeout(900);

// ------------------------------------------------------------ page structure
const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
check('page is under 2,500px', h < 2500, `${h}px`);

const subline = (await page.locator('[data-testid="desk-subline"]').innerText()).trim();
check('leads with a written sentence, not a tile', /decisions? waiting on you/.test(subline), subline);

// §2: no chip may render a zero
const chipCounts = await page.locator('[data-testid^="desk-chip-"]').evaluateAll((els) =>
  els.map((e) => ({ id: e.getAttribute('data-testid'), text: e.innerText.replace(/\s+/g, ' ').trim() }))
);
check('zero-count chips do not render',
  !chipCounts.some((c) => / 0$/.test(c.text)),
  chipCounts.map((c) => c.text).join(' | '));
check('the "Important" chip (count 0) is hidden',
  !chipCounts.some((c) => c.id === 'desk-chip-important'),
  chipCounts.map((c) => c.id).join(', '));

// §5.2.1: chips wrap, they do not scroll
const chipRow = await page.locator('[data-testid="desk-chips"]').evaluate((el) => ({
  wrap: getComputedStyle(el).flexWrap,
  overflowX: getComputedStyle(el).overflowX,
  clipped: el.scrollWidth > el.clientWidth + 1,
  rows: new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
}));
check('chip row wraps rather than scrolls',
  chipRow.wrap === 'wrap' && !chipRow.clipped && ['visible', 'clip'].includes(chipRow.overflowX),
  JSON.stringify(chipRow));
check('chips actually wrap onto multiple rows at 390px', chipRow.rows > 1, `${chipRow.rows} rows`);

for (const c of await page.locator('[data-testid^="desk-chip-"]').all()) {
  const b = await c.boundingBox();
  const id = await c.getAttribute('data-testid');
  check(`${id} clears 44px`, b.height >= 44, `${Math.round(b.height)}px`);
}

// §8: cap the list at 5, rest behind "See all"
const cards = await page.locator('[data-testid^="desk-card-"]').count();
check('list is capped at 5 cards', cards === 5, `${cards} shown`);
check('the rest sit behind "See all"', await page.locator('[data-testid="desk-see-all"]').isVisible());
const seeAll = (await page.locator('[data-testid="desk-see-all"]').innerText()).trim();
check('"See all" names the real total', /6/.test(seeAll), seeAll);

// cold open: the top item readable without scrolling
const firstCard = await page.locator('[data-testid^="desk-card-"]').first().boundingBox();
check('top card is fully visible without scrolling',
  firstCard.y + firstCard.height <= 844, `card bottom at ${Math.round(firstCard.y + firstCard.height)}`);

// §5.3: Indian grouping, right-aligned, tabular
const body = await page.locator('[data-testid="desk-mobile"]').innerText();
const amounts = body.match(/₹[\d,]+/g) || [];
const badGrouping = amounts.filter((a) => {
  const parts = a.slice(1).split(',');
  if (parts.length === 1) return false;
  return !(parts[parts.length - 1].length === 3 &&
           parts.slice(1, -1).every((p) => p.length === 2) &&
           parts[0].length <= 2);
});
check('every amount uses Indian grouping', badGrouping.length === 0,
  badGrouping.join(', ') || amounts.slice(0, 4).join(', '));
const amtStyle = await page.locator('[data-testid^="desk-card-"] span.tabular-nums').first()
  .evaluate((el) => ({ align: getComputedStyle(el).textAlign, ff: getComputedStyle(el).fontVariantNumeric }));
check('amounts are right-aligned and tabular', amtStyle.align === 'right' && /tabular-nums/.test(amtStyle.ff),
  JSON.stringify(amtStyle));

// §5.2.4: one tap target per card
const nested = await page.locator('[data-testid^="desk-card-"]').first()
  .evaluate((el) => el.querySelectorAll('a,button,[role="button"]').length);
check('card is one tap target, no nested controls', nested === 0, `${nested} nested`);

// §8: capture must NOT be on this page
check('no capture bar on the Desk',
  (await page.locator('[data-testid="dex-capture-bar"]').count()) === 0);

// -------------------------------------------------------- the decision sheet
await page.locator('[data-testid^="desk-card-"]').first().click();
await page.waitForSelector('[data-testid="decision-sheet"]', { timeout: 5000 });
await page.waitForTimeout(700);

const sheetText = await page.locator('[data-testid="decision-sheet"]').innerText();
check('sheet shows the exact amount', /₹4,80,000/.test(sheetText));
check('sheet gives a plain-language rationale',
  /Surat Spinners quoted|₹40\/kg/.test(sheetText), sheetText.slice(0, 90).replace(/\n/g, ' '));
check('sheet says what it unblocks', /What this unblocks/i.test(sheetText));
check('sheet says what happens next', /What happens next/i.test(sheetText));
check('sheet offers a note instead',
  await page.locator('[data-testid="decision-note-toggle"]').isVisible());
check('sheet shows an "N of M" counter', /1 of 6/.test(sheetText),
  (sheetText.match(/\d+ of \d+/) || ['none'])[0]);

const approveBox = await page.locator('[data-testid="decision-approve"]').boundingBox();
check('Approve is on the 56px tier', approveBox.height >= 56, `${Math.round(approveBox.height)}px`);
const approveText = await page.locator('[data-testid="decision-approve"]').innerText();
check('amount is inside the Approve button above the threshold',
  /₹4,80,000/.test(approveText), approveText.replace(/\n/g, ' '));
const rejectBox = await page.locator('[data-testid="decision-reject"]').boundingBox();
check('Approve and Reject are >= 8px apart',
  rejectBox.x - (approveBox.x + approveBox.width) >= 7.5,
  `${Math.round(rejectBox.x - (approveBox.x + approveBox.width))}px`);

// ------------------------------------------------- auto-advance through all 6
let counters = [];
for (let i = 0; i < 6; i++) {
  const t = await page.locator('[data-testid="decision-sheet"]').innerText();
  const m = t.match(/(\d+) of (\d+)/);
  if (m) counters.push(m[0]);
  const doneVisible = await page.locator('[data-testid="decision-sheet-done"]').count();
  if (doneVisible) break;
  await page.locator('[data-testid="decision-approve"]').click();
  await page.waitForTimeout(650);
}
check('sheet auto-advances through the queue', counters.length >= 5, counters.join(' -> '));
check('reaches a Done state without leaving the sheet',
  (await page.locator('[data-testid="decision-sheet-done"]').count()) > 0);
check('never left the sheet while clearing six',
  (await page.locator('[data-testid="decision-sheet"]').count()) > 0);

// §5.5: undo, not a confirm dialog
const undoSeen = await page.locator('[data-testid="undo-snackbar"]').count();
check('an undo snackbar fired for a high-value approval', undoSeen > 0,
  undoSeen ? await page.locator('[data-testid="undo-snackbar"]').innerText() : 'none');

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

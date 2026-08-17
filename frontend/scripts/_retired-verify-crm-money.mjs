#!/usr/bin/env node
/**
 * RETIRED 2026-08-17 — do not run.
 *
 * Every check here targets a bespoke mobile screen that no longer exists.
 * /inbox, /crm, /finance, /my-work and /operating-score render the DESKTOP tree
 * on every viewport by explicit decision: a second mobile implementation is how
 * the desktop/mobile feature gap opened, so there is now one implementation.
 *
 * Kept rather than deleted because the phone-layout rules encoded here (touch
 * floors, density ceilings, block composition, empty-state contracts) are the
 * best written record of what "good on a phone" meant for this product, and the
 * design-system pass will want to re-read them.
 *
 * Nothing imports this and no runner globs it — the leading underscore keeps it
 * out of scripts/verify-*.mjs.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await ctx.clock.setFixedTime(new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`));
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));

// ==================================================================== §5.5 CRM
await page.goto(`${BASE}/crm?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="crm-grid"]', { timeout: 15000 });
await page.waitForTimeout(1300);

const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
check('the CRM is under 2,500px with a full book', h < 2500, `${h}px`);

const tiles = await page.locator('[data-testid^="crm-grid-tile-"]').all();
check('relationships render as a grid, not rows', tiles.length > 0, `${tiles.length} tiles`);
const boxes = await Promise.all(tiles.slice(0, 6).map((t) => t.boundingBox()));
check('the grid is 2-up', new Set(boxes.map((b) => Math.round(b.x))).size === 2,
  [...new Set(boxes.map((b) => Math.round(b.x)))].join(', '));
// §5.5's tile is 116px; the block's own floor is 7.25rem = 116px.
check('tiles are ~116px, not ~125px rows',
  boxes.every((b) => b.height >= 112 && b.height <= 150),
  boxes.map((b) => Math.round(b.height)).join(', '));

// Twelve per screen instead of five (§5.5).
const perScreen = boxes.length
  ? await page.locator('[data-testid^="crm-grid-tile-"]').evaluateAll((els) =>
      els.filter((e) => e.getBoundingClientRect().top < 844 && e.getBoundingClientRect().bottom <= 900).length)
  : 0;
check('more relationships fit a screen than the five it replaced', perScreen >= 6, `${perScreen} above the fold`);

const first = tiles[0];
const tileText = (await first.innerText()).replace(/\s+/g, ' ');
// A tile shows what they owe only when they owe something — a ₹0 on 60 tiles is
// the noise §8 removes. So the assertion is that the ones with a balance show it.
const withMoney = await page.locator('[data-testid^="crm-grid-tile-"]')
  .evaluateAll((els) => els.filter((e) => /₹[\d,]+/.test(e.innerText)).length);
check('tiles carry the outstanding amount where there is one', withMoney > 0,
  `${withMoney} of ${tiles.length} tiles show a balance`);
check('a tile carries the last touch', /(today|yesterday|\d+[dwm]o? ago)/.test(tileText), tileText.slice(0, 60));
check('a tile shows initials, not a full status chip',
  (await first.locator('span.rounded-pill').count()) >= 1);
// §5.5: status is a coloured dot on the avatar, and never colour alone (§3.5).
const dotInfo = await first.evaluate((el) => {
  const dot = el.querySelector('span[title]');
  const sr = el.querySelector('.sr-only');
  return { title: dot?.getAttribute('title') || null, sr: sr?.textContent || null };
});
check('the stage dot names itself for a screen reader',
  !!dotInfo.title && !!dotInfo.sr, JSON.stringify(dotInfo));

// L1 / L3
const blocks = await page.locator('[data-block]').evaluateAll((els) =>
  [...new Set(els.map((e) => e.getAttribute('data-block')))]);
check('CRM is composed from >= 3 distinct block types', blocks.length >= 3, blocks.join(', '));
const prog = await page.locator('[data-progress]').evaluateAll((els) => els.map((e) => e.getAttribute('data-progress')));
check('exactly one progress element on the CRM', prog.length === 1, prog.join(', ') || 'none');
check('the CRM progress element is relationships warmed',
  prog[0] === 'relationships-warmed', prog[0] || 'none');
const pulseText = (await page.locator('[data-testid="crm-pulse"]').innerText()).replace(/\s+/g, ' ');
check('the Pulse pairs what is owed with what was warmed',
  /Outstanding|We owe/.test(pulseText) && /Warmed this week/.test(pulseText), pulseText.slice(0, 70));

// §5.5: the second chip row folds into a sheet.
const filterRows = await page.locator('[data-testid="crm-filters"] [data-testid^="crm-filters-"]')
  .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
check('the filters are one chip row, not two', filterRows <= 1, `${filterRows} rows`);
check('the old status chip row is gone',
  (await page.locator('[data-testid="crm-status-filters"]').count()) === 0);
await page.locator('[data-testid="crm-filters-filter"]').click();
await page.waitForSelector('[data-testid="crm-filter-sheet"]', { timeout: 5000 });
await page.waitForTimeout(500);
check('the Filter chip opens a sheet', await page.locator('[data-testid="crm-filter-sheet"]').isVisible());
for (const b of await page.locator('[data-testid^="crm-status-"]').all()) {
  const bb = await b.boundingBox();
  check('a status option clears 44px', bb.height >= 44, `${Math.round(bb.height)}px`);
}
await page.locator('[data-testid="crm-status-lead"]').click();
await page.waitForTimeout(900);
check('choosing a status closes the sheet',
  (await page.locator('[data-testid="crm-filter-sheet"]').count()) === 0);
check('the Filter chip then names the active status',
  /lead/i.test(await page.locator('[data-testid="crm-filters-filter"]').innerText()),
  (await page.locator('[data-testid="crm-filters-filter"]').innerText()).trim());

// §5.5: "Tapping a tile → navigate to /contacts/:id. That is a place, not an act."
await page.goto(`${BASE}/crm?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid^="crm-grid-tile-"]', { timeout: 12000 });
await page.waitForTimeout(1100);
await page.locator('[data-testid^="crm-grid-tile-"]').first().click();
await page.waitForTimeout(1000);
check('a tile navigates rather than opening a Focus View',
  /^\/contacts\//.test(new URL(page.url()).pathname)
    && (await page.locator('[data-testid="focus-view"]').count()) === 0,
  new URL(page.url()).pathname);

// The Grid cap keeps a long book scannable and says what it is hiding.
await page.goto(`${BASE}/crm?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="crm-grid"]', { timeout: 12000 });
await page.waitForTimeout(1200);
const more = page.locator('[data-testid="crm-grid-see-all"]');
if (await more.count()) {
  const label = (await more.innerText()).trim();
  check('the cap says how many are hidden and of what total', /Show \d+ more of \d+/.test(label), label);
  const before = await page.locator('[data-testid^="crm-grid-tile-"]').count();
  await more.evaluate((el) => el.click());
  await page.waitForTimeout(700);
  const after = await page.locator('[data-testid^="crm-grid-tile-"]').count();
  check('"Show more" reveals more tiles', after > before, `${before} -> ${after}`);
}

// ================================================================== §5.3 Money
await page.goto(`${BASE}/finance?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="finance-mobile"]', { timeout: 15000 });
await page.waitForTimeout(1600);

// §5.3: ONE row, fade mask, peeking sixth chip.
const strip = page.locator('[data-testid="finance-tabs"]');
const chipRows = await strip.locator('[data-testid^="finance-tabs-"]')
  .evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
check('the Money tab strip is ONE row', chipRows === 1, `${chipRows} rows`);
const stripScroll = await strip.locator('div').first().evaluate((el) => ({
  overflowX: getComputedStyle(el).overflowX,
  scrolls: el.scrollWidth > el.clientWidth + 1,
}));
check('the strip scrolls rather than wrapping',
  stripScroll.overflowX === 'auto' && stripScroll.scrolls, JSON.stringify(stripScroll));
const peeking = await strip.locator('[data-testid^="finance-tabs-"]').evaluateAll((els) =>
  els.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.left < 390 && r.right > 390;
  }).length);
check('a chip peeks past the right edge, so the row reads as scrollable',
  peeking >= 1, `${peeking} peeking`);

// §5.3's strata, in order.
const order = await page.locator('[data-block]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-block')));
check('Money leads with the Verdict, then Pulse, then Grid',
  order.indexOf('verdict') < order.indexOf('pulse') && order.indexOf('pulse') < order.indexOf('grid'),
  order.join(' -> '));
const vText = (await page.locator('[data-testid="finance-verdict"] h1').innerText()).trim();
check('the AI finance sentence is the hero, not buried below tiles',
  vText.length > 10 && /\.$/.test(vText), vText);
const vBox = await page.locator('[data-testid="finance-verdict"]').boundingBox();
check('the verdict is above the fold', vBox.y + vBox.height <= 844,
  `bottom at ${Math.round(vBox.y + vBox.height)}`);

const mProg = await page.locator('[data-progress]').evaluateAll((els) => els.map((e) => e.getAttribute('data-progress')));
check('exactly one progress element on Money', mProg.length === 1, mProg.join(', ') || 'none');
check('the Money progress element is the received trend',
  mProg[0] === 'money-received', mProg[0] || 'none');
// §3's table: "received-this-week trend, up-arrow when positive".
const spark = await page.locator('[data-testid="finance-pulse"] svg path').count();
check('Received carries a real sparkline', spark > 0, `${spark} path(s)`);

// §5.3: the composition tiles show composition.
const bars = await page.locator('[data-testid="finance-kpis"] [role="img"]').count();
check('the Grid tiles show their share, not just a number', bars > 0, `${bars} share bars`);
const barLabel = await page.locator('[data-testid="finance-kpis"] [role="img"]').first().getAttribute('aria-label');
check('the share bar says what it means', /% of the largest/.test(barLabel || ''), barLabel || 'none');
const kpiText = await page.locator('[data-testid="finance-kpis"]').innerText();
check('no tile reads ₹0', !/₹0(?!\d)/.test(kpiText), (kpiText.match(/₹0(?!\d)/) || ['none'])[0]);

// §5.3: tapping Outstanding opens a Focus View, in place.
await page.locator('[data-testid="finance-pulse-1"]').click();
await page.waitForSelector('[data-testid="focus-view"]', { timeout: 6000 });
await page.waitForTimeout(700);
const fu = new URL(page.url());
check('Outstanding opens a routed Focus View',
  fu.pathname === '/finance' && fu.searchParams.get('focus') === 'money:outstanding',
  fu.pathname + fu.search);
const focusText = (await page.locator('[data-testid="focus-view"]').innerText()).replace(/\s+/g, ' ');
check('the Focus View lists what is owed', /₹[\d,]+/.test(focusText), focusText.slice(0, 80));
const chases = await page.locator('[data-testid^="focus-chase-"]').count();
check('each row offers a Chase action', chases > 0, `${chases} chase button(s)`);
check('"Open Money" sits at the foot',
  (await page.locator('[data-testid="focus-open-full"]').count()) === 1);
await page.goBack();
await page.waitForTimeout(700);
check('back closes it and stays on Money',
  (await page.locator('[data-testid="focus-view"]').count()) === 0
    && new URL(page.url()).pathname === '/finance');

// The ledger tabs stay under the ceiling with a busy book.
for (const t of ['revenue', 'expenses']) {
  await page.goto(`${BASE}/finance?tab=${t}&fixture=busy`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-testid="finance-list-${t}"]`, { timeout: 12000 });
  await page.waitForTimeout(1200);
  const th = await page.evaluate(() => document.scrollingElement.scrollHeight);
  check(`the ${t} tab is under 2,500px`, th < 2500, `${th}px`);
  const moreBtn = page.locator(`[data-testid="finance-list-${t}-more"]`);
  if (await moreBtn.count()) {
    const label = (await moreBtn.innerText()).trim();
    check(`the ${t} tab says what it is holding back`, /Show \d+ more of \d+/.test(label), label);
  }
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

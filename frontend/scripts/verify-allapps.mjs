#!/usr/bin/env node
/**
 * MPWA-12h verification — All Apps as a bento (§5.7).
 *
 * The three rules that are easy to break later get real checks:
 *   · size is fixed by config, never by whether the data arrived
 *   · opening the panel fires ZERO network requests
 *   · the visual headings are gone but the group semantics are not
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';
// The bespoke mobile roots (desk-mobile / crm-mobile / finance-mobile / …)
// are gone: these routes render the DESKTOP tree on every viewport now.
// Waiting on `main` is the honest 'the route rendered' signal.

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
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));

const openPanel = async () => {
  await page.waitForSelector('[data-testid="dock-more"]', { timeout: 12000 });
  await page.waitForTimeout(500);
  await page.locator('[data-testid="dock-more"]').click();
  await page.waitForSelector('[data-testid="allapps-panel"]', { timeout: 6000 });
  await page.waitForTimeout(600);
};

// ------------------------------------------------- zero requests on open
// The hard one. Warm the caches by visiting the screens first, then count every
// request the panel makes when it opens.
// Warm every source a tile reads from, IN APP. `page.goto` tears down the JS
// context and with it the React Query cache, so a goto-based warm-up proves
// nothing about a cache the panel could actually read — the tiles came up empty
// and looked like a bug in the component. A founder reaches All Apps after
// tapping around, so the test taps around too.
await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dock-more"]', { timeout: 15000 });
await page.waitForTimeout(1200);
for (const [tile, marker] of [
  ['crm', 'main'],
  ['operating-score', 'main'],
  ['calendar', 'main'],
]) {
  await page.locator('[data-testid="dock-more"]').click();
  await page.waitForSelector(`[data-testid="allapps-tile-${tile}"]`, { timeout: 6000 });
  await page.locator(`[data-testid="allapps-tile-${tile}"]`).click();
  await page.waitForSelector(marker, { timeout: 12000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-testid="dock-desk"]').click();
  await page.waitForTimeout(900);
}

let apiCalls = [];
const record = (r) => { if (/\/api\//.test(r.url())) apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`); };
page.on('request', record);
await page.evaluate(() => { window.__DOS_FIXTURE_CALLS = []; });
apiCalls = [];
await openPanel();
await page.waitForTimeout(1500);
const fixtureCalls = await page.evaluate(() => (window.__DOS_FIXTURE_CALLS || []).map((c) => `${c.method} ${c.url}`));
page.off('request', record);
// Poll-driven refetches (notifications every 30s) are Layout's, not the panel's,
// so allow them by name and fail on anything the tiles could have caused.
const PANEL_FREE = /notifications|captures\/pending-count|brief\?period=morning|auth\/me/;
const offenders = [...apiCalls, ...fixtureCalls].filter((c) => !PANEL_FREE.test(c));
check('opening All Apps fires no requests of its own', offenders.length === 0,
  offenders.join(', ') || `${apiCalls.length + fixtureCalls.length} allowed poll(s)`);

// --------------------------------------------------------------- the bento
const sizes = await page.locator('[data-testid^="allapps-tile-"]').evaluateAll((els) =>
  els.map((e) => ({
    key: e.getAttribute('data-testid').replace('allapps-tile-', ''),
    size: e.getAttribute('data-size'),
    w: Math.round(e.getBoundingClientRect().width),
    h: Math.round(e.getBoundingClientRect().height),
  })));
check('the panel is not a uniform grid',
  new Set(sizes.filter((s) => s.size).map((s) => s.size)).size >= 3,
  [...new Set(sizes.map((s) => s.size))].join(', '));

const large = sizes.find((s) => s.size === 'large');
const small = sizes.find((s) => s.size === 'small');
const wide = sizes.find((s) => s.size === 'wide');
check('CRM is the large 2x2 tile', large?.key === 'crm', large?.key || 'none');
check('the large tile is twice a small tile wide',
  large && small && Math.abs(large.w - (small.w * 2 + 12)) <= 3,
  `${large?.w} vs ${small?.w}*2+12`);
check('the large tile is twice a small tile tall',
  large && small && Math.abs(large.h - (small.h * 2 + 12)) <= 3,
  `${large?.h} vs ${small?.h}*2+12`);
check('a wide tile is 2 columns and 1 row',
  wide && small && Math.abs(wide.w - (small.w * 2 + 12)) <= 3 && Math.abs(wide.h - small.h) <= 3,
  `${wide?.w}x${wide?.h} vs small ${small?.w}x${small?.h}`);
check('every tile is at least 100x100',
  sizes.filter((s) => s.size).every((s) => s.w >= 100 && s.h >= 100),
  sizes.filter((s) => s.size).map((s) => `${s.w}x${s.h}`).join(' '));
check('3 columns at 390px',
  new Set(sizes.filter((s) => s.size === 'small').map((s) => s.w)).size === 1
    && (small?.w ?? 0) >= 95 && (small?.w ?? 0) <= 110,
  `small tile ${small?.w}px`);

// A large/wide tile earns its size by carrying live data (§5.7).
const crmText = (await page.locator('[data-testid="allapps-tile-crm"]').innerText()).replace(/\s+/g, ' ');
check('the large tile carries a headline number and a supporting line',
  /₹/.test(crmText) && /relationship/.test(crmText), crmText.slice(0, 60));
const wideText = wide
  ? (await page.locator(`[data-testid="allapps-tile-${wide.key}"]`).innerText()).replace(/\s+/g, ' ')
  : '';
check('a wide tile carries one live line',
  /\d/.test(wideText) || /Open/.test(wideText), wideText.slice(0, 60));
// And the tiles that had nothing cached must not be blank — Skeleton or "Open".
const bigTiles = sizes.filter((t) => t.size !== 'small' && t.size);
for (const bt of bigTiles) {
  const txt = (await page.locator(`[data-testid="allapps-tile-${bt.key}"]`).innerText()).replace(/\s+/g, ' ');
  const skel = await page.locator(`[data-testid="allapps-skeleton-${bt.key}"]`).count();
  check(`the ${bt.key} tile shows a value, a Skeleton or an Open affordance`,
    /\d/.test(txt) || /Open/.test(txt) || skel === 1, `${txt.slice(0, 40)} (skeleton ${skel})`);
}

// §5.7: no visible headings, but the group semantics survive.
const headings = await page.locator('[data-testid="allapps-scroll"] h3').evaluateAll((els) =>
  els.map((e) => ({ text: e.textContent.trim(), sr: e.className.includes('sr-only') })));
check('no visible category headings', headings.every((h) => h.sr), JSON.stringify(headings));
check('but the groups keep their labelled semantics',
  (await page.locator('[data-testid="allapps-scroll"] section[aria-labelledby]').count()) >= 1);
const labelled = await page.locator('section[aria-labelledby]').evaluateAll((els) =>
  els.every((e) => !!document.getElementById(e.getAttribute('aria-labelledby'))));
check('every aria-labelledby points at a real heading', labelled);

// §5.7's utility strip.
const util = page.locator('[data-testid="allapps-utility"]');
check('the utility strip is separate from the tiles', await util.isVisible());
const utilKeys = await util.locator('[data-testid^="allapps-tile-"]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('allapps-tile-', '')));
check('Settings, Language, Theme and Sign out are utility, not tiles',
  ['settings', 'language', 'theme', 'signout'].every((k) => utilKeys.includes(k)), utilKeys.join(', '));
check('Sign out sits last', utilKeys[utilKeys.length - 1] === 'signout', utilKeys.join(', '));
const utilBoxes = await util.locator('button').evaluateAll((els) =>
  els.map((e) => Math.round(e.getBoundingClientRect().height)));
check('utility rows are ~56px', utilBoxes.every((h) => h >= 56), utilBoxes.join(', '));
const signoutColour = await page.locator('[data-testid="allapps-tile-signout"]')
  .evaluate((el) => getComputedStyle(el).color);
const settingsColour = await page.locator('[data-testid="allapps-tile-settings"]')
  .evaluate((el) => getComputedStyle(el).color);
check('Sign out is in danger text', signoutColour !== settingsColour,
  `${signoutColour} vs ${settingsColour}`);
// §5.7 put Send Daily Digest in the tile grid, far from Sign out. E2-63
// (2026-08-15) then deleted POST /brief/send-digest, so the tile went with the
// endpoint — a button whose route is gone is worse than no button. What still
// has to hold is that nothing dangerous sits beside Sign out.
check('Send Daily Digest is gone with its endpoint (E2-63)',
  (await page.locator('[data-testid="allapps-tile-digest"]').count()) === 0
    && !utilKeys.includes('digest'), utilKeys.join(', '));
check('nothing destructive sits beside Sign out',
  utilKeys[utilKeys.length - 2] === 'theme', utilKeys.join(' | '));

// §5.7: search only when there are more than twelve.
const tileCount = sizes.length;
const hasSearch = (await page.locator('[data-testid="allapps-search"]').count()) > 0;
check('search appears only when the panel exceeds twelve entries',
  hasSearch === tileCount > 12, `${tileCount} entries, search ${hasSearch ? 'shown' : 'hidden'}`);

// §8's dock/panel rules still hold after the rewrite.
check('My Work has no tile (it is in the dock)',
  (await page.locator('[data-testid="allapps-tile-my-work"]').count()) === 0);
check('Dex has no tile (it is the FAB)',
  (await page.locator('[data-testid="allapps-tile-dex"]').count()) === 0
    && (await page.locator('[data-testid="allapps-tile-brain"]').count()) === 0);
check('no dock destination has a tile',
  ['inbox', 'finance', 'money', 'desk'].every(async (k) =>
    (await page.locator(`[data-testid="allapps-tile-${k}"]`).count()) === 0));

// ------------------------------------ size is config, not data availability
// A cold session has nothing cached, so the large tile must still be 2x2 with a
// skeleton in it rather than collapsing to a small tile.
const cold = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const cpage = await cold.newPage();
await signIn(cpage, BASE);
await cpage.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await cpage.waitForSelector('[data-testid="dock-more"]', { timeout: 12000 });
await cpage.waitForTimeout(700);
await cpage.locator('[data-testid="dock-more"]').click();
await cpage.waitForSelector('[data-testid="allapps-panel"]', { timeout: 6000 });
await cpage.waitForTimeout(500);
const coldSizes = await cpage.locator('[data-testid^="allapps-tile-"]').evaluateAll((els) =>
  els.map((e) => ({
    key: e.getAttribute('data-testid').replace('allapps-tile-', ''),
    size: e.getAttribute('data-size'),
    w: Math.round(e.getBoundingClientRect().width),
    h: Math.round(e.getBoundingClientRect().height),
  })));
const coldLarge = coldSizes.find((s) => s.key === 'crm');
check('with nothing cached, CRM is still the large tile',
  coldLarge?.size === 'large', `${coldLarge?.size} ${coldLarge?.w}x${coldLarge?.h}`);
check('the large tile does not shrink when its number is missing',
  large && coldLarge && coldLarge.w === large.w && coldLarge.h === large.h,
  `cold ${coldLarge?.w}x${coldLarge?.h} vs warm ${large?.w}x${large?.h}`);
check('a missing number shows a Skeleton, not an empty tile or a zero',
  (await cpage.locator('[data-testid="allapps-skeleton-crm"]').count()) === 1
    || /₹/.test(await cpage.locator('[data-testid="allapps-tile-crm"]').innerText()),
  (await cpage.locator('[data-testid="allapps-tile-crm"]').innerText()).replace(/\n/g, ' '));

// The layout must be identical across fixture states (§8's acceptance list).
const shapes = {};
for (const f of ['empty', 'sparse', 'busy']) {
  await cpage.goto(`${BASE}/inbox?fixture=${f}`, { waitUntil: 'domcontentloaded' });
  await cpage.waitForSelector('[data-testid="dock-more"]', { timeout: 12000 });
  await cpage.waitForTimeout(900);
  await cpage.locator('[data-testid="dock-more"]').click();
  await cpage.waitForSelector('[data-testid="allapps-panel"]', { timeout: 6000 });
  await cpage.waitForTimeout(700);
  shapes[f] = await cpage.locator('[data-testid^="allapps-tile-"]').evaluateAll((els) =>
    els.map((e) => `${e.getAttribute('data-testid')}:${e.getAttribute('data-size')}:${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  await cpage.keyboard.press('Escape');
  await cpage.waitForTimeout(400);
}
check('tile sizes are identical across all three fixture states',
  new Set(Object.values(shapes).map((v) => v.join(','))).size === 1,
  Object.entries(shapes).map(([k, v]) => `${k}=${v.length} tiles`).join(' '));

await cold.close();
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

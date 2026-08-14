#!/usr/bin/env node
/**
 * MPWA-03 verification — drives the dock and the All Apps panel.
 *
 * §8's done-when: every destination reachable in <= 2 taps; no destination in
 * both the dock and All Apps; the panel locks scroll and restores position;
 * the dock clears the home indicator; desktop sidebar untouched.
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

// ------------------------------------------------------------------ mobile
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));
check('signed in', await signIn(page, BASE));
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="floating-dock"]', { timeout: 15000 });
await page.waitForTimeout(600);

// the old navigation is gone
check('old 5-item tab bar is gone',
  (await page.locator('[data-testid="mobile-bottom-nav"]').count()) === 0);
check('hamburger drawer button is gone',
  (await page.locator('[data-testid="mobile-menu-button"]').count()) === 0);
// NB: both headers are in the DOM at 390px — the desktop one is display:none
// via lg:flex — so this must test visibility, not presence.
check('theme toggle is off the mobile header',
  (await page.locator('header [data-testid="theme-toggle"]:visible').count()) === 0);
check('language switcher is off the mobile header',
  (await page.locator('header [data-testid="language-switcher"]:visible').count()) === 0);

// the dock
const dockItems = await page.locator('[data-testid^="dock-"]:not([data-testid$="-badge"])').all();
check('dock has exactly 4 slots', dockItems.length === 4,
  (await Promise.all(dockItems.map((d) => d.getAttribute('data-testid')))).join(', '));
for (const d of dockItems) {
  const box = await d.boundingBox();
  const id = await d.getAttribute('data-testid');
  check(`${id} is >= 56x56 (§8)`, box.width >= 56 && box.height >= 56,
    `${Math.round(box.width)}x${Math.round(box.height)}`);
  const label = (await d.innerText()).trim();
  check(`${id} carries a visible label`, label.length > 0, `"${label}"`);
}

// dock is a floating pill, detached from the edges, above the home indicator
const pill = await page.locator('[data-testid="floating-dock"] > div').boundingBox();
const vh = page.viewportSize().height;
const vw = page.viewportSize().width;
check('dock floats off the bottom edge', vh - (pill.y + pill.height) >= 12,
  `${Math.round(vh - (pill.y + pill.height))}px gap`);
check('dock floats off the left edge', pill.x >= 12, `${Math.round(pill.x)}px`);
check('dock is 64px tall', Math.round(pill.height) === 64, `${Math.round(pill.height)}px`);

// Dex FAB — separate circle, bottom-right, same baseline, 12px+ from the pill
const fab = await page.locator('[data-testid="dex-fab"]').boundingBox();
check('Dex FAB is 64px', Math.round(fab.width) === 64 && Math.round(fab.height) === 64,
  `${Math.round(fab.width)}x${Math.round(fab.height)}`);
check('Dex FAB is bottom-right', vw - (fab.x + fab.width) <= 20 && fab.x > vw / 2,
  `${Math.round(vw - (fab.x + fab.width))}px from right`);
check('Dex FAB shares the dock baseline',
  Math.abs((fab.y + fab.height) - (pill.y + pill.height)) <= 2,
  `fab bottom ${Math.round(fab.y + fab.height)} vs pill bottom ${Math.round(pill.y + pill.height)}`);
check('Dex FAB clears the pill by >= 12px', fab.x - (pill.x + pill.width) >= 12,
  `${Math.round(fab.x - (pill.x + pill.width))}px`);
check('Dex FAB is labelled "Dex" for screen readers',
  (await page.locator('[data-testid="dex-fab"]').getAttribute('aria-label')) === 'Dex');

// active state uses three cues: fill weight + colour + label
const active = page.locator('[data-testid="dock-desk"]');
const cue = await active.evaluate((el) => ({
  colour: getComputedStyle(el).color,
  label: el.innerText.trim(),
  filled: !!el.querySelector('svg'),
  current: el.getAttribute('aria-current'),
}));
const inactiveColour = await page.locator('[data-testid="dock-work"]').evaluate((el) => getComputedStyle(el).color);
check('active slot differs in colour from inactive', cue.colour !== inactiveColour,
  `${cue.colour} vs ${inactiveColour}`);
check('active slot still shows its label', cue.label.length > 0, `"${cue.label}"`);
check('active slot is marked aria-current', cue.current === 'page');

// ------------------------------------------------------- All Apps panel
await page.evaluate(() => window.scrollTo(0, 800));
await page.waitForTimeout(250);
const beforeY = await page.evaluate(() => Math.round(window.scrollY));
await page.locator('[data-testid="dock-more"]').click();
await page.waitForSelector('[data-testid="allapps-panel"]', { timeout: 5000 });
await page.waitForTimeout(500);

check('panel is not a bottom sheet (floats, inset from edges)', await page.locator('[data-testid="allapps-panel"]').evaluate((el) => {
  const r = el.getBoundingClientRect();
  return r.top > 8 && r.bottom < window.innerHeight - 8 && r.left >= 8;
}));
const backdrop = await page.locator('[data-testid="allapps-backdrop"]').evaluate((el) => ({
  bg: getComputedStyle(el).backgroundColor,
  filter: getComputedStyle(el).backdropFilter,
}));
const [br, bg, bb] = backdrop.bg.match(/\d+/g).map(Number);
check('backdrop is neutral, not tinted', Math.max(br, bg, bb) - Math.min(br, bg, bb) <= 12, backdrop.bg);
check('backdrop is blurred', /blur\(\s*20px\s*\)/.test(backdrop.filter), backdrop.filter);

check('search is NOT autofocused', await page.evaluate(() =>
  document.activeElement?.getAttribute('data-testid') !== 'allapps-search'
), await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName));

const panelMaxH = await page.locator('[data-testid="allapps-panel"]').evaluate(
  (el) => Math.round(el.getBoundingClientRect().height / window.innerHeight * 100)
);
check('panel is at most 80vh', panelMaxH <= 80, `${panelMaxH}vh`);

// grid geometry
const tile = await page.locator('[data-testid="allapps-tile-calendar"]').boundingBox();
check('tiles are >= 88x88', tile.width >= 88 && tile.height >= 88,
  `${Math.round(tile.width)}x${Math.round(tile.height)}`);
const cols = await page.locator('[data-testid="allapps-group-account"] > div').evaluate(
  (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length
);
check('3 columns at 390px', cols === 3, `${cols} columns`);

// nothing appears in both the dock and All Apps (§8)
// MPWA-12c: Work replaced Brief in the dock, so /my-work is now the route
// that must NOT also have a tile.
const dockRoutes = ['/inbox', '/my-work', '/finance'];
const tileKeys = await page.locator('[data-testid^="allapps-tile-"]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-testid').replace('allapps-tile-', ''))
);
const overlap = tileKeys.filter((k) => dockRoutes.some((r) => r.slice(1) === k));
check('no dock destination also has an All Apps tile', overlap.length === 0, overlap.join(', ') || 'none');
check('Dex has no All Apps tile (it is the FAB)', !tileKeys.includes('dex') && !tileKeys.includes('brain'),
  tileKeys.join(', '));
check('Meeting Notes is not in the grid', !tileKeys.some((k) => /meeting/i.test(k)));

// Send Daily Digest must not be adjacent to Sign out (§8)
const acct = await page.locator('[data-testid="allapps-group-account"] [data-testid^="allapps-tile-"]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('allapps-tile-', '')));
const di = acct.indexOf('digest');
const si = acct.indexOf('signout');
check('Send Daily Digest is not adjacent to Sign out',
  di === -1 || si === -1 || Math.abs(di - si) > 1,
  `order: ${acct.join(' | ')}`);

// search filters live
await page.locator('[data-testid="allapps-search"]').fill('cal');
await page.waitForTimeout(300);
const shown = await page.locator('[data-testid^="allapps-tile-"]').count();
check('search filters tiles live', shown === 1, `${shown} tile(s) match "cal"`);
await page.locator('[data-testid="allapps-search"]').fill('');
await page.waitForTimeout(250);

// scroll lock + restore
const refBefore = await page.evaluate(() => Math.round(document.body.getBoundingClientRect().top));
await page.mouse.wheel(0, 500);
await page.waitForTimeout(250);
const refAfter = await page.evaluate(() => Math.round(document.body.getBoundingClientRect().top));
check('panel locks background scroll', refBefore === refAfter, `${refBefore} -> ${refAfter}`);

await page.keyboard.press('Escape');
await page.waitForTimeout(700);
check('Escape closes the panel', (await page.locator('[data-testid="allapps-panel"]').count()) === 0);
const afterY = await page.evaluate(() => Math.round(window.scrollY));
check('panel restores scroll position', Math.abs(afterY - beforeY) <= 2, `${beforeY} -> ${afterY}`);

// ------------------------------------------------- 2 taps to every destination
const DESTINATIONS = [
  // /my-work moved to the dock in MPWA-12c — asserted as a 1-tap below.
  ['/calendar', 'allapps-tile-calendar'],
  ['/crm', 'allapps-tile-crm'],
  ['/team', 'allapps-tile-team'],
  ['/coach', 'allapps-tile-coach'],
  ['/journal', 'allapps-tile-journal'],
  ['/operating-score', 'allapps-tile-operating-score'],
  ['/notifications', 'allapps-tile-notifications'],
  ['/settings', 'allapps-tile-settings'],
];
for (const [route, testid] of DESTINATIONS) {
  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dock-more"]', { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.locator('[data-testid="dock-more"]').click();          // tap 1
  await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 5000 });
  await page.locator(`[data-testid="${testid}"]`).click();          // tap 2
  await page.waitForTimeout(700);
  const at = new URL(page.url()).pathname;
  check(`${route} reachable in 2 taps`, at === route, `landed on ${at}`);
}

// --------------------------------------------- MPWA-12c · the promoted slot
// §2.1: "The dock becomes Desk · Work · Money · More + Dex FAB."
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="floating-dock"]', { timeout: 8000 });
await page.waitForTimeout(400);
const dockLabels = await page.locator('[data-testid^="dock-"]:not([data-testid$="-badge"])')
  .evaluateAll((els) => els.map((e) => e.innerText.trim()));
check('dock reads Desk · Work · Money · More',
  dockLabels.join(' · ') === 'Desk · Work · Money · More', dockLabels.join(' · '));
check('Brief no longer occupies a dock slot',
  (await page.locator('[data-testid="dock-brief"]').count()) === 0);
await page.locator('[data-testid="dock-work"]').click();                 // tap 1
await page.waitForTimeout(800);
check('/my-work is 1 tap from the dock', new URL(page.url()).pathname === '/my-work',
  new URL(page.url()).pathname);

// §2.1: /brief is a permanent redirect, and it must not resurrect a dock slot.
await page.goto(`${BASE}/brief`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-mobile"]', { timeout: 10000 });
await page.waitForTimeout(600);
const briefLanding = new URL(page.url());
check('/brief lands on the Desk\'s morning scope',
  briefLanding.pathname === '/inbox' && briefLanding.searchParams.get('scope') === 'morning',
  briefLanding.pathname + briefLanding.search);
check('the Desk slot is the active one after the redirect',
  (await page.locator('[data-testid="dock-desk"]').getAttribute('aria-current')) === 'page');

// Dex FAB opens the sheet, which hosts the EXISTING capture bar
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dex-fab"]', { timeout: 8000 });
await page.waitForTimeout(300);
await page.locator('[data-testid="dex-fab"]').click();
await page.waitForSelector('[data-testid="dex-sheet"]', { timeout: 5000 });
await page.waitForTimeout(400);
check('Dex FAB opens DexSheet', await page.locator('[data-testid="dex-sheet"]').isVisible());
// MPWA-12e replaced the sheet's presentation (§5.6: it "looks like a support
// form, and Dex is the product's personality") while keeping the behaviour —
// hooks/useDexCapture holds the recorder and the same Sprint 5 endpoints, and
// DexCaptureBar still renders it verbatim on desktop /brain.
check('DexSheet opens on the idle state',
  (await page.locator('[data-testid="dex-sheet-stage"]').getAttribute('data-stage')) === 'idle');
check('DexSheet offers speak, type and attach',
  (await page.locator('[data-testid="dex-mic-record"]').isVisible())
    && (await page.locator('[data-testid="dex-text-input"]').isVisible())
    && (await page.locator('[data-testid="dex-file-upload"]').isVisible()));
check('the old capture-bar form is gone from the sheet',
  (await page.locator('[data-testid="dex-sheet"] [data-testid="dex-capture-bar"]').count()) === 0);
check('DexSheet offers "Open Dex"',
  await page.locator('[data-testid="dex-sheet-open-full"]').isVisible());
const sendBox = await page.locator('[data-testid="dex-send"]').boundingBox();
check('Dex send button is not clipped at the right edge',
  sendBox.x + sendBox.width <= vw - 4,
  `right edge at ${Math.round(sendBox.x + sendBox.width)} of ${vw}`);
const micBox = await page.locator('[data-testid="dex-mic-record"]').boundingBox();
check('Dex mic is >= 56px', micBox.height >= 56, `${Math.round(micBox.height)}px`);
check('Dex mic is the sheet\'s hero, not one control in a row', micBox.height >= 64,
  `${Math.round(micBox.width)}x${Math.round(micBox.height)}`);
await page.locator('[data-testid="dex-sheet-open-full"]').click();
await page.waitForTimeout(700);
check('"Open Dex" navigates to /brain', new URL(page.url()).pathname === '/brain',
  new URL(page.url()).pathname);
await ctx.close();

// ----------------------------------------------------------------- desktop
const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dpage = await dctx.newPage();
check('signed in on desktop', await signIn(dpage, BASE));
await dpage.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await dpage.waitForTimeout(1200);
check('desktop sidebar still present', await dpage.locator('aside').isVisible());
check('desktop keeps its theme toggle',
  await dpage.locator('[data-testid="theme-toggle"]').isVisible());
check('dock is hidden on desktop',
  !(await dpage.locator('[data-testid="floating-dock"]').isVisible()));
check('Dex FAB is hidden on desktop',
  !(await dpage.locator('[data-testid="dex-fab"]').isVisible()));
const sidebarLinks = await dpage.locator('aside a[data-testid^="nav-"]').count();
check('desktop sidebar nav intact', sidebarLinks >= 7, `${sidebarLinks} entries`);
await dctx.close();

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

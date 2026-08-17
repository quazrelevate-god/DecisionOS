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

// the dock. MPWA-14 added the raised Dex button to the same testid family, so
// the DESTINATION slots are counted separately from it — "four slots plus Dex,
// permanently" is still the rule, Dex is just inside the pill now. Dex is also
// the one dock control with no visible label: it is an icon button carrying an
// aria-label, exactly as the FAB it replaced was, and the label loop below
// covers the four destinations that do make the §3.5 promise.
const dockItems = await page.locator(
  '[data-testid^="dock-"]:not([data-testid$="-badge"]):not([data-testid="dock-dex"])'
).all();
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

// MPWA-14: Dex is the dock's raised centre, not a separate bottom-right circle.
// The geometry checks moved with it — centred rather than right-aligned, raised
// above the pill rather than sharing its baseline. Full coverage in verify-dex.
check('the separate Dex FAB is retired', (await page.locator('[data-testid="dex-fab"]').count()) === 0);
const dexBtn = await page.locator('[data-testid="dock-dex"]').boundingBox();
check('Dex is centred in the pill',
  Math.abs((dexBtn.x + dexBtn.width / 2) - (pill.x + pill.width / 2)) <= 2,
  `dex mid ${Math.round(dexBtn.x + dexBtn.width / 2)} vs pill mid ${Math.round(pill.x + pill.width / 2)}`);
check('Dex is raised above the pill', dexBtn.y < pill.y,
  `${Math.round(pill.y - dexBtn.y)}px proud`);
check('Dex clears the 56px touch floor', dexBtn.width >= 56 && dexBtn.height >= 56,
  `${Math.round(dexBtn.width)}x${Math.round(dexBtn.height)}`);
check('Dex is labelled "Dex" for screen readers',
  (await page.locator('[data-testid="dock-dex"]').getAttribute('aria-label')) === 'Dex');

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
// MPWA-12h replaced the four category sections with one bento grid, so the
// column count is read from that grid rather than from a per-category one.
const cols = await page.locator('[data-testid="allapps-group-destinations"] > div').evaluate(
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

// Send Daily Digest must not be adjacent to Sign out (§8). 12h settles this
// structurally: Digest is a tile in the bento, Sign out lives in the utility
// strip, so they are never neighbours regardless of ordering.
const utilKeys = await page.locator('[data-testid="allapps-utility"] [data-testid^="allapps-tile-"]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('allapps-tile-', '')));
check('Send Daily Digest is not adjacent to Sign out',
  !utilKeys.includes('digest') && utilKeys.includes('signout'), `utility: ${utilKeys.join(' | ')}`);
check('Sign out is last in the utility strip',
  utilKeys[utilKeys.length - 1] === 'signout', utilKeys.join(' | '));

// §5.7: search renders only above twelve entries, so with twelve it is absent.
const tileTotal = await page.locator('[data-testid^="allapps-tile-"]').count();
const searchShown = (await page.locator('[data-testid="allapps-search"]').count()) > 0;
check('search appears only when it would earn its row',
  searchShown === tileTotal > 12, `${tileTotal} entries, search ${searchShown ? 'shown' : 'hidden'}`);
if (searchShown) {
  await page.locator('[data-testid="allapps-search"]').fill('cal');
  await page.waitForTimeout(300);
  const shown = await page.locator('[data-testid^="allapps-tile-"]').count();
  check('search filters tiles live', shown === 1, `${shown} tile(s) match "cal"`);
  await page.locator('[data-testid="allapps-search"]').fill('');
  await page.waitForTimeout(250);
}

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
  // /team has no tile below lg any more — the roster moved into Ops as the
  // member grid, so a Team tile would be a second door to the same people.
  // Reaching the team is asserted below, through Ops, instead.
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

// ------------------------------------------- the team moved inside Ops
// Removing the Team tile only counts if the people it reached are still
// reachable. Assert both halves: the tile is gone, and the roster answers on
// Ops with the three management actions on each member.
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dock-more"]', { timeout: 8000 });
await page.waitForTimeout(300);
await page.locator('[data-testid="dock-more"]').click();
await page.waitForTimeout(500);
// Team went back to being its own page (U7-09: card grid + click-through
// profile), so the tile is back in More and the roster is reachable from it
// again. It had been folded into Ops for a while; this asserts the reversal.
check(
  'Team has its own tile again',
  (await page.locator('[data-testid="allapps-tile-team"]').count()) === 1
);
await page.keyboard.press('Escape');

await page.goto(`${BASE}/operating-score`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="ops-employees"]', { timeout: 12000 }).catch(() => {});
const tiles = await page.locator('[data-testid^="ops-emp-"]').count();
check('Ops carries the roster as a grid', tiles > 0, `${tiles} member box(es)`);

if (tiles > 0) {
  await page.locator('[data-testid^="ops-emp-"]').first().click();
  await page.waitForSelector('[data-testid="member-card"]', { timeout: 8000 });
  check('a member box opens the expanded card', true, 'member-card visible');
  // The three management pills moved back to the Team page with the rest of
  // team management. The card is a read now — no writes hanging off it.
  check(
    'the member card carries no management pills',
    (await page.locator('[data-testid^="member-pill-"]').count()) === 0
  );
  // The four tiles that were asked to be dropped must not come back.
  const cardText = (await page.locator('[data-testid="member-card"]').innerText()).toLowerCase();
  for (const gone of ['proof', 'plans used', 'photos', 'voice']) {
    check(`the card omits "${gone}"`, !cardText.includes(gone));
  }
  await page.locator('[data-testid="member-card-close"]').click();
  await page.waitForTimeout(300);
}

// --------------------------------------------- MPWA-12c · the promoted slot
// §2.1 as amended by MPWA-14: Desk · Work · [Dex] · Money · More, with Dex
// as the raised centre rather than a separate circle.
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="floating-dock"]', { timeout: 8000 });
await page.waitForTimeout(400);
const dockLabels = await page.locator(
  '[data-testid^="dock-"]:not([data-testid$="-badge"]):not([data-testid="dock-dex"])'
).evaluateAll((els) => els.map((e) => e.innerText.trim()));
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

// MPWA-14: the centre button navigates instead of opening a sheet. The sheet
// offered speak / type / attach in front of the screen that offers exactly
// those three; /brain is now a conversation and the sheet is retired. The
// screen's own contract is verified in verify-dex.
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dock-dex"]', { timeout: 8000 });
await page.waitForTimeout(300);
await page.locator('[data-testid="dock-dex"]').click();
await page.waitForTimeout(900);
check('the dock\'s Dex button navigates to /brain', new URL(page.url()).pathname === '/brain',
  new URL(page.url()).pathname);
check('no Dex sheet is opened on the way',
  (await page.locator('[data-testid="dex-sheet"]').count()) === 0);
await page.waitForSelector('[data-testid="dex-mobile"]', { timeout: 10000 });
check('Dex opens as a conversation, with one composer',
  (await page.locator('[data-testid="dex-composer"]').count()) === 1);
check('the dock is still reachable over Dex',
  (await page.locator('[data-testid="floating-dock"]').count()) === 1);
await ctx.close();

// ----------------------------------------------------------------- desktop
const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dpage = await dctx.newPage();
check('signed in on desktop', await signIn(dpage, BASE));
await dpage.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
// Wait for the sidebar itself, not a fixed 1200ms. The app's auth bootstrap got
// heavier and the sleep started landing before the layout rendered, which read
// as "the desktop sidebar is gone" — a false alarm on the one thing this whole
// track promises not to touch.
await dpage.waitForSelector('aside a[data-testid^="nav-"]', { timeout: 15000 });
await dpage.waitForTimeout(500);
check('desktop sidebar still present', await dpage.locator('aside').isVisible());
check('desktop keeps its theme toggle',
  await dpage.locator('[data-testid="theme-toggle"]').isVisible());
check('dock is hidden on desktop',
  !(await dpage.locator('[data-testid="floating-dock"]').isVisible()));
check('the mobile Dex screen is hidden on desktop',
  !(await dpage.locator('[data-testid="dex-mobile"]').isVisible().catch(() => false)));
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

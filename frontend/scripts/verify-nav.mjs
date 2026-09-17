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

/* ASK-43 — THESE SIZES ARE MEASURED IN THE APP'S OWN PIXELS. The phone shell is
   CSS-zoomed to 0.8 (hooks/useUiScale), so getBoundingClientRect returns VISUAL
   pixels: a compliant 64px dock read back as 51 and every size check here
   failed on a bar that had not changed. The 56px and 64px numbers are design-
   system rules about the app's own pixels — the same numbers the CSS writes —
   so they are read with offsetWidth/offsetHeight. Distances BETWEEN elements
   are converted with the scale the app publishes. */
const own = (loc) => loc.evaluate((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));
const toOwn = (page) => page.evaluate(() => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
  return v > 0 ? 1 / v : 1;
});

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
/* ASK-38 brought CRM DOWN from the More panel — "it was a tile behind the dots,
   which is two taps and a panel for the screen an owner opens to look somebody
   up" — so an owner's dock is five slots, not four. The rule §8 was written for
   still holds: four destinations plus More, and nothing in both places. */
check('dock has five slots for an owner: four destinations plus More', dockItems.length === 5,
  (await Promise.all(dockItems.map((d) => d.getAttribute('data-testid')))).join(', '));
for (const d of dockItems) {
  const box = await own(d);
  const id = await d.getAttribute('data-testid');
  check(`${id} is >= 56x56 (§8)`, box.w >= 56 && box.h >= 56, `${box.w}x${box.h}`);
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
/* ASK-41 — 72, not 64. The founder's highlight "covers the icon, which is not a
   standard way to do it": it fills the whole slot, text and all, as a squircle,
   and the bar grew by the padding that takes. */
const pillOwn = await own(page.locator('[data-testid="floating-dock"] > div'));
check('dock is 72px tall', pillOwn.h === 72, `${pillOwn.h}px`);

// Dex FAB — separate circle, bottom-right, same baseline, 12px+ from the pill
const fab = await page.locator('[data-testid="dex-fab"]').boundingBox();
const fabOwn = await own(page.locator('[data-testid="dex-fab"]'));
check('Dex FAB is 64px', fabOwn.w === 64 && fabOwn.h === 64, `${fabOwn.w}x${fabOwn.h}`);
check('Dex FAB is bottom-right', vw - (fab.x + fab.width) <= 20 && fab.x > vw / 2,
  `${Math.round(vw - (fab.x + fab.width))}px from right`);
/* ASK-41 again: the bar is 72 and the circle is 64, so they cannot share a
   baseline any more without the circle hanging low. They share a CENTRE. */
const K = await toOwn(page);
const centreGap = ((fab.y + fab.height / 2) - (pill.y + pill.height / 2)) * K;
check('Dex FAB is centred on the dock', Math.abs(centreGap) <= 2, `${centreGap.toFixed(1)}px off`);
check('Dex FAB clears the pill by >= 12px', (fab.x - (pill.x + pill.width)) * K >= 12,
  `${((fab.x - (pill.x + pill.width)) * K).toFixed(1)}px`);
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
/* KM-8 then KM-9 — NO BLUR, and a slight dim. The founder wants the app still
   legible behind the menu; a frosted light panel separates itself without the
   page being blurred to make room for it, and 22% black is what settles the
   background under it. Asserting a blur here asserted the opposite of the
   ticket. */
check('backdrop does not blur the page behind it', !/blur/.test(backdrop.filter), backdrop.filter);
check('backdrop dims it slightly instead', /0\.22|, 0\.22\)/.test(backdrop.bg) || (br + bg + bb) / 3 < 40, backdrop.bg);

check('search is NOT autofocused', await page.evaluate(() =>
  document.activeElement?.getAttribute('data-testid') !== 'allapps-search'
), await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName));

const panelMaxH = await page.locator('[data-testid="allapps-panel"]').evaluate(
  (el) => Math.round(el.getBoundingClientRect().height / window.innerHeight * 100)
);
check('panel is at most 80vh', panelMaxH <= 80, `${panelMaxH}vh`);

// grid geometry
/* ASK-42 took Calendar and Notifications out of this panel — the calendar is
   reached from the Journal's "Events desk" pill now, and the bell lives in the
   Desk's top bar. The tile this measures is Journal, which is in the same grid
   and is the destination that replaced it. */
const tile = await own(page.locator('[data-testid="allapps-tile-journal"]'));
/* ASK-40 — THE TILES ARE PILLS NOW, not squares: "make the more menu card
   compact from square to pill by removing the body text… keep the two column
   grid". So the claim is no longer 88x88; it is that a pill is still a
   comfortable target, on the 44px floor, and full width of its column. */
check('tiles clear the 44px floor', tile.h >= 44, `${tile.w}x${tile.h}`);
// MPWA-12h replaced the four category sections with one bento grid, so the
// column count is read from that grid rather than from a per-category one.
const cols = await page.locator('[data-testid="allapps-group-destinations"] > div').evaluate(
  (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length
);
// ASK-38 — "two up, equal, no dense packing", and ASK-40 kept that grid.
check('2 columns at 390px', cols === 2, `${cols} columns`);

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

/* §8 asked that Send Daily Digest never sit next to Sign out. KM-5 answered it
   outright: Language, Theme and Sign out left this panel for Settings -> Account
   — "a nav menu is a list of PLACES; a theme switch and a session-ending action
   are neither" — and the digest is not a tile either. Settings is the whole
   utility strip now, so the two can no longer be neighbours anywhere. The check
   is kept, pointed at what actually guarantees it. */
const utilKeys = await page.locator('[data-testid="allapps-utility"] [data-testid^="allapps-tile-"]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('allapps-tile-', '')));
check('neither Send Daily Digest nor Sign out is in this panel at all',
  !utilKeys.includes('digest') && !utilKeys.includes('signout')
  && !tileKeys.includes('digest') && !tileKeys.includes('signout'),
  `utility: ${utilKeys.join(' | ')}`);
check('Settings is the utility strip', utilKeys.join(' | ') === 'settings', utilKeys.join(' | '));

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
  /* This table is the panel as it stands, tile for tile. It had fallen behind:
     /crm and /coach have no tile any more, and ASK-42 moved the calendar behind
     the Journal's "Events desk" pill and the bell into the Desk's own top bar —
     both of those doors are asserted on their own below. Approvals and
     Workflows are here because ASK-42 made them rooms rather than views inside
     My Work. Leave lands on /team, which is where the register lives. */
  ['/approvals', 'allapps-tile-approvals'],
  ['/workflows', 'allapps-tile-workflows'],
  ['/journal', 'allapps-tile-journal'],
  ['/operating-score', 'allapps-tile-operating-score'],
  ['/team', 'allapps-tile-team'],
  ['/team', 'allapps-tile-leave'],
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

/* ASK-42 · the two that left the panel, each through the door it left by. */
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-topbar-bell"]', { timeout: 8000 });
await page.locator('[data-testid="desk-topbar-bell"]').click();
await page.waitForTimeout(700);
check('/notifications is one tap from the Desk top bar',
  new URL(page.url()).pathname === '/notifications', `landed on ${new URL(page.url()).pathname}`);

await page.goto(`${BASE}/journal`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="journal-events-desk"]', { timeout: 8000 });
await page.locator('[data-testid="journal-events-desk"]').click();
await page.waitForTimeout(700);
check('the calendar is one tap from the Journal\'s Events desk pill',
  new URL(page.url()).pathname === '/calendar', `landed on ${new URL(page.url()).pathname}`);

// --------------------------------------------- MPWA-12c · the promoted slot
// §2.1: "The dock becomes Desk · Work · Money · More + Dex FAB."
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="floating-dock"]', { timeout: 8000 });
await page.waitForTimeout(400);
const dockLabels = await page.locator('[data-testid^="dock-"]:not([data-testid$="-badge"])')
  .evaluateAll((els) => els.map((e) => e.innerText.trim()));
// ASK-38 seated CRM in the dock; More is still last.
check('dock reads Desk · Work · Money · CRM · More',
  dockLabels.join(' · ') === 'Desk · Work · Money · CRM · More', dockLabels.join(' · '));
check('Brief no longer occupies a dock slot',
  (await page.locator('[data-testid="dock-brief"]').count()) === 0);
await page.locator('[data-testid="dock-work"]').click();                 // tap 1
await page.waitForTimeout(800);
check('/my-work is 1 tap from the dock', new URL(page.url()).pathname === '/my-work',
  new URL(page.url()).pathname);

// §2.1: /brief is a permanent redirect, and it must not resurrect a dock slot.
await page.goto(`${BASE}/brief`, { waitUntil: 'domcontentloaded' });
/* KR-8 rebuilt this screen and `desk-mobile` went with it; the board is the
   element that says the Desk has rendered. */
await page.waitForSelector('[data-testid="desk-board"]', { timeout: 10000 });
await page.waitForTimeout(600);
const briefLanding = new URL(page.url());
check('/brief lands on the Desk\'s morning scope',
  briefLanding.pathname === '/inbox' && briefLanding.searchParams.get('scope') === 'morning',
  briefLanding.pathname + briefLanding.search);
check('the Desk slot is the active one after the redirect',
  (await page.locator('[data-testid="dock-desk"]').getAttribute('aria-current')) === 'page');

// ASK-33 Phase 4 — ONE TAP ON THE DEX FAB OPENS DEX IN ASK.
// This section used to drive MPWA-12e's DexSheet (an idle stage, a 64px mic in
// the sheet, "Open Dex" to /brain). DexSheet was removed from Layout in 97c2bfc
// (KM-23) and is not mounted: the live sheet is DexChat, a transcript whose
// composer is the dock and whose mic and send is the FAB. KM-54's two-door
// picker went in ASK-33 — Ask is the FAB, Decide is the Desk's Dex well
// (scripts/verify-dex.mjs covers that side).
const dexBadge = async () =>
  (await page.locator('[data-testid="dex-chat"] span.rounded-pill').first().innerText().catch(() => '')).trim().toLowerCase();
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="dex-fab"]', { timeout: 8000 });
await page.waitForTimeout(300);
await page.locator('[data-testid="dex-fab"]').click();
await page.waitForSelector('[data-testid="dex-chat"]', { timeout: 5000 });
await page.waitForTimeout(400);
check('one tap on the Dex FAB opens the Dex sheet', await page.locator('[data-testid="dex-chat"]').isVisible());
check('no two-door picker', (await page.locator('[data-testid^="dex-pick-"]').count()) === 0);
check('the sheet opens on Ask', (await dexBadge()) === 'ask', await dexBadge());
check('the dock becomes the composer',
  (await page.locator('[data-testid="dock-dex-wave"]').isVisible())
    && !(await page.locator('[data-testid="dock-desk"]').isVisible()));
check('the FAB offers to speak',
  (await page.locator('[data-testid="dex-fab"]').getAttribute('aria-label')) === 'Speak to Dex');
await page.locator('[data-testid="dex-plus"]').click();
await page.waitForTimeout(400);
check('the plus offers type, attach and photo',
  (await page.locator('[data-testid="dex-action-type"]').isVisible())
    && (await page.locator('[data-testid="dex-action-file"]').isVisible())
    && (await page.locator('[data-testid="dex-action-photo"]').isVisible()));
await page.locator('[data-testid="dex-action-type"]').click();
await page.waitForTimeout(400);
check('Type turns the dock into a text field', await page.locator('[data-testid="dock-dex-input"]').isVisible());
const fabBox = await page.locator('[data-testid="dex-fab"]').boundingBox();
check('the Dex FAB is not clipped at the right edge', fabBox.x + fabBox.width <= vw - 4,
  `right edge at ${Math.round(fabBox.x + fabBox.width)} of ${vw}`);
// ASK-43's own pixels again — 64 CSS px reads back as 51 under the 0.8 zoom.
const fabOwn2 = await own(page.locator('[data-testid="dex-fab"]'));
check('the Dex FAB stays >= 56px as the composer\'s button', fabOwn2.h >= 56,
  `${fabOwn2.w}x${fabOwn2.h}`);
await page.locator('[data-testid="dex-chat-close"]').click();
await page.waitForTimeout(800);
check('closing gives the dock its destinations back',
  (await page.locator('[data-testid="dex-chat"]').count()) === 0
    && (await page.locator('[data-testid="dock-desk"]').isVisible()));
await page.locator('[data-testid="dex-fab"]').click();
await page.waitForSelector('[data-testid="dex-chat"]', { timeout: 5000 });
await page.waitForTimeout(400);
check('the next tap opens Ask again, still with no picker',
  (await page.locator('[data-testid^="dex-pick-"]').count()) === 0 && (await dexBadge()) === 'ask');
await ctx.close();

// ----------------------------------------------------------------- desktop
const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dpage = await dctx.newPage();
check('signed in on desktop', await signIn(dpage, BASE));
await dpage.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
// Wait for the navigation itself, not a fixed 1200ms. The app's auth bootstrap
// got heavier and the sleep started landing before the layout rendered, which
// read as "the desktop navigation is gone" — a false alarm on the one thing
// this whole track promises not to touch.
/* KR-5 moved desktop navigation into the header as a centred pill strip and
   deleted the aside with it: "NavItems and RailItems are DELETED, not parked…
   the rail is gone with its aside." What §8 promises is that the mobile work
   leaves desktop navigation alone — so that is what is asserted, at the place
   desktop navigation now lives. */
await dpage.waitForSelector('[data-testid="header-pill-nav"] a[data-testid^="nav-"]', { timeout: 15000 });
await dpage.waitForTimeout(500);
check('desktop navigation still present', await dpage.locator('[data-testid="header-pill-nav"]').isVisible());
/* ASK-33 removed the theme switch from the app entirely — there is one
   surface now, and the mobile check above ("theme toggle is off the mobile
   header") is satisfied on desktop for the same reason. What this line is
   really for is that the desktop header is still the desktop header, so it
   asks for the thing that is actually there: the workspace's own user menu. */
check('desktop keeps its header user menu',
  await dpage.locator('[data-testid="rail-user-menu"]').isVisible());
check('dock is hidden on desktop',
  !(await dpage.locator('[data-testid="floating-dock"]').isVisible()));
check('Dex FAB is hidden on desktop',
  !(await dpage.locator('[data-testid="dex-fab"]').isVisible()));
const sidebarLinks = await dpage.locator('[data-testid="header-pill-nav"] a[data-testid^="nav-"]').count();
check('desktop nav intact', sidebarLinks >= 6, `${sidebarLinks} entries`);
await dctx.close();

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

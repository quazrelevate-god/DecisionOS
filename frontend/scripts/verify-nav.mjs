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

/* DEX-SLIDER — the suite asserts whichever contract the flag is on, because
   both paths stay alive and both have to keep passing. flags.js is plain ESM
   with no JSX and no CSS, so it imports straight into node. */
import { DEX_SLIDER } from '../src/lib/flags.js';

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
/* 2026-10-06 — THE BAR HAS TWO NAMES. With DEX_SLIDER on it is DockSlider on
   every page; with the flag off it is FloatingDock. Every geometry check below
   is about "the bar at the bottom", so it asks for whichever one is there. */
const BAR = '[data-testid="dock-slider"], [data-testid="floating-dock"]';
await page.waitForSelector(BAR, { timeout: 15000 });
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
/* The SLOTS, not every element whose testid starts with "dock-" — the slider
   bar is itself `dock-slider` and carries a `dock-slider-items` wrapper. */
const dockItems = await page.locator('[data-testid^="dock-"]:not([data-testid$="-badge"])'
  + ':not([data-testid="dock-slider"]):not([data-testid="dock-slider-items"])').all();
/* ASK-38 brought CRM DOWN from the More panel — "it was a tile behind the dots,
   which is two taps and a panel for the screen an owner opens to look somebody
   up" — so an owner's dock is five slots, not four. The rule §8 was written for
   still holds: four destinations plus More, and nothing in both places. */
/* 2026-10-06 — FOUR WITH THE SLIDER, five without. The handle took the middle
   of the bar and CRM went back to the More panel to make room, so an owner's
   bar is Desk · Work │ handle │ Money · More. */
check(DEX_SLIDER ? 'dock has four slots either side of the handle' : 'dock has five slots for an owner: four destinations plus More',
  dockItems.length === (DEX_SLIDER ? 4 : 5),
  (await Promise.all(dockItems.map((d) => d.getAttribute('data-testid')))).join(', '));
for (const d of dockItems) {
  const box = await own(d);
  const id = await d.getAttribute('data-testid');
  check(`${id} is >= 56x56 (§8)`, box.w >= 56 && box.h >= 56, `${box.w}x${box.h}`);
  const label = (await d.innerText()).trim();
  check(`${id} carries a visible label`, label.length > 0, `"${label}"`);
}

// dock is a floating pill, detached from the edges, above the home indicator
const pill = await page.locator(`${BAR}`).first().locator('> div').boundingBox();
const vh = page.viewportSize().height;
const vw = page.viewportSize().width;
/* THE RULE, NOT A NUMBER (2026-10-02). This was `>= 12`, which was really the
   old 1rem lift wearing a threshold. The founder measured 47pt of dead space
   under the bar on an iPhone 13 mini — 34 of mandatory home-indicator inset and
   13 the app was adding on top — and the lift went to 0. What has to be true is
   not a pixel count: the bar is detached from the edge wherever there is no
   indicator, and it clears the indicator entirely wherever there is one. Both
   are asserted, the second by simulating the inset the way index.css derives
   it, because no browser reports one. */
check('dock floats off the bottom edge', vh - (pill.y + pill.height) > 0,
  `${Math.round(vh - (pill.y + pill.height))}px gap`);
{
  const k = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue('--ui-scale')) || 1);
  await page.evaluate((s) => document.documentElement.style
    .setProperty('--sa-bottom', `calc(34px / ${s})`), k);
  await page.waitForTimeout(250);
  const lifted = await page.locator(`${BAR}`).first().locator('> div').boundingBox();
  const gap = vh - (lifted.y + lifted.height);
  check('…and clears the home indicator, without sitting on it',
    gap >= 34 && gap < 44, `${Math.round(gap)}pt above the edge, indicator is 34`);
  await page.evaluate(() => document.documentElement.style.removeProperty('--sa-bottom'));
  await page.waitForTimeout(250);
}
check('dock floats off the left edge', pill.x >= 12, `${Math.round(pill.x)}px`);
/* ASK-41 — 72, not 64. The founder's highlight "covers the icon, which is not a
   standard way to do it": it fills the whole slot, text and all, as a squircle,
   and the bar grew by the padding that takes. */
const pillOwn = await own(page.locator(`${BAR}`).first().locator('> div'));
/* The slider bar is the slider's own height (6rem = 96 own px); the original
   bar is 72. Both are "the bar is the height it is meant to be". */
check('dock is the bar\'s own height', pillOwn.h === (DEX_SLIDER ? 96 : 72), `${pillOwn.h}px`);

/* DEX-SLIDER Part 1 — THE CIRCLE IS NOT ON THE DESK ANY MORE. The slider's
   left end is Ask there, so a second door to the same room was one too many.
   It is unchanged on every other phone page, so its geometry is measured on
   one of those, and the Desk gets its own two checks below. */
const pillRightGap = vw - (pill.x + pill.width);
if (DEX_SLIDER) {
  check('the Desk has no Ask circle', (await page.locator('[data-testid="dex-fab"]').count()) === 0);
  /* With no circle beside it the bar takes the width back, symmetrically. */
  check('the Desk dock is centred', Math.abs(pillRightGap - pill.x) <= 2,
    `${Math.round(pill.x)}px left vs ${Math.round(pillRightGap)}px right`);
  /* 2026-10-06 — AND THERE IS NOWHERE LEFT FOR IT TO LIVE. The founder's call:
     off the Desk the dock IS the slider, so "remove the dex button entirely in
     other pages". The circle is gone from the product on this flag; what the
     checks below measured about it is measured about the bar instead. */
  await page.goto(`${BASE}/my-work`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dock-slider"]', { timeout: 10000 });
  await page.waitForTimeout(500);
  check('off the Desk there is no Ask circle either',
    (await page.locator('[data-testid="dex-fab"]').count()) === 0);
  check('off the Desk the dock is the slider',
    (await page.locator('[data-testid="dex-slider-handle"]').count()) === 1);
  check('…with two slots each side of the handle',
    /* Not `a`: More is a button, not a destination. */
    (await page.locator('[data-testid="dock-slider-items"] [data-testid^="dock-"]').count()) === 4);
} else {
  check('the Desk keeps its Ask circle', (await page.locator('[data-testid="dex-fab"]').count()) === 1);
  check('the Desk dock holds the circle its clearance', pillRightGap > pill.x,
    `${Math.round(pill.x)}px left vs ${Math.round(pillRightGap)}px right`);
}

/* 2026-10-06 — THE CIRCLE'S GEOMETRY, on the flag-off path only. With
   DEX_SLIDER on there is no circle anywhere: the dock is the control on every
   page and the Desk has its slider on its sheet. These checks are kept rather
   than deleted because the flag still has an off position and this is what it
   must look like there. */
if (!DEX_SLIDER) {
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
  const pillHere = await page.locator(`${BAR}`).first().locator('> div').boundingBox();
  check('Dex FAB clears the pill by >= 12px', (fab.x - (pillHere.x + pillHere.width)) * K >= 12,
    `${((fab.x - (pillHere.x + pillHere.width)) * K).toFixed(1)}px`);
  check('Dex FAB is labelled "Dex" for screen readers',
    (await page.locator('[data-testid="dex-fab"]').getAttribute('aria-label')) === 'Dex');
}

/* Back to the Desk: everything below is about the active slot, and the active
   slot is the page you are on. */
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector(BAR, { timeout: 10000 });
await page.waitForTimeout(400);

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

// ------------------------------------------------------- the More menu
/* 2026-10-06 — THE MENU IS THE DOCK NOW, on the slider path. The founder:
   "instead of a separate pop-up card floating, the entire dock should increase
   its height… place all the nine menu pills inside it… no need of an additional
   card inside this expanded dock sheet, only the pills." So the claims change
   shape: there is no panel to float, no backdrop to be neutral and nothing to
   dim — there is a bar that got taller. What survives unchanged is everything
   that was ever about the MENU rather than about the card it came in: the nine
   destinations, two columns, the 44px floor, nothing that is already in the
   dock, and Settings as the one utility.
   The old dock keeps the old panel and the old checks; both paths ship. */
await page.evaluate(() => window.scrollTo(0, 800));
await page.waitForTimeout(250);
const beforeY = await page.evaluate(() => Math.round(window.scrollY));
const dockShut = await page.locator('[data-testid="dex-slider"] .kr-slider-well, [data-testid="dock"]').first().boundingBox();
await page.locator('[data-testid="dock-more"]').click();
await page.waitForSelector(DEX_SLIDER ? '[data-testid="dock-more-panel"]' : '[data-testid="allapps-panel"]', { timeout: 5000 });
await page.waitForTimeout(500);

if (DEX_SLIDER) {
  const g = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="dock-slider"]');
    const well = document.querySelector('[data-testid="dex-slider"] .kr-slider-well');
    const panel = document.querySelector('[data-testid="dock-more-panel"]');
    const pills = [...panel.querySelectorAll('[data-testid^="allapps-tile-"]')];
    const box = (e) => { const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; };
    /* HOW MANY SURFACES BETWEEN A PILL AND THE BAR. The founder's correction:
       "there is another sheet appeared, and in that sheet the dock was there as
       a cutout inside it… the exact dock black container should expand." So the
       claim is not that a panel exists above the bar — it is that the bar IS
       the panel, and that walking up from a pill to the well passes through
       nothing that paints a surface of its own. */
    let nested = 0;
    for (let n = pills[0] && pills[0].parentElement; n && n !== well; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.borderTopWidth !== '0px' || cs.boxShadow !== 'none') nested += 1;
    }
    return {
      nav: box(nav), well: box(well), panel: box(panel),
      cols: getComputedStyle(panel.querySelector('[data-testid="dock-more-grid"]')).gridTemplateColumns.split(' ').length,
      rows: new Set(pills.map((p) => Math.round(p.getBoundingClientRect().top))).size,
      pills: pills.length,
      minH: Math.min(...pills.map((p) => p.offsetHeight)),
      bg: getComputedStyle(pills[0]).backgroundColor,
      ink: getComputedStyle(pills[0]).color,
      menuInWell: well.contains(panel),
      handleInWell: !!well.querySelector('[data-testid="dex-slider-handle"]'),
      navInWell: !!well.querySelector('[data-testid="dock-slider-items"]'),
      cards: nested,
      floating: document.querySelectorAll('[data-testid="allapps-panel"]').length,
      backdrop: document.querySelectorAll('[data-testid="allapps-backdrop"]').length,
      pageScroll: document.documentElement.scrollHeight - window.innerHeight,
    };
  });
  check('More grows the dock rather than floating a card over the page',
    g.floating === 0 && g.backdrop === 0 && g.well.bottom === g.nav.bottom,
    `well ${g.well.top}→${g.well.bottom}, dock ${g.nav.top}→${g.nav.bottom}`);
  check('…and it is the bar\'s OWN container that grew', dockShut && g.well.h > dockShut.height + 100,
    `${Math.round(dockShut.height)} → ${g.well.h}`);
  check('…with the menu, the handle and the destinations all inside that one box',
    g.menuInWell && g.handleInWell && g.navInWell);
  check('the nine menu pills are in it, two up in five rows',
    g.pills === 9 && g.cols === 2 && g.rows === 5, `${g.pills} pills, ${g.cols} cols, ${g.rows} rows`);
  check('the pills clear the 44px floor', g.minH >= 44, `${g.minH}px`);
  /* "The colour of the pills should be white-ish": a light fill with dark type
     on it, which is the pair that makes it a pill on the ink rather than
     another dark card on a dark bar. */
  const rgb = g.bg.match(/\d+/g).map(Number);
  const ink = g.ink.match(/\d+/g).map(Number);
  check('the pills are white-ish, with dark type on them',
    Math.min(rgb[0], rgb[1], rgb[2]) >= 230 && Math.max(ink[0], ink[1], ink[2]) <= 80, `${g.bg} on ${g.ink}`);
  check('no second sheet between the pills and the bar', g.cards === 0, `${g.cards} surface(s)`);
  check('the page behind does not scroll', g.pageScroll <= 0, `${g.pageScroll}px`);
}

// the menu's CONTENTS — the same claims on both paths
const tileKeys = await page.locator('[data-testid^="allapps-tile-"]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-testid').replace('allapps-tile-', '')));
// MPWA-12c: Work replaced Brief in the dock, so /my-work is now the route
// that must NOT also have a tile.
const dockRoutes = ['/inbox', '/my-work', '/finance'];
const overlap = tileKeys.filter((k) => dockRoutes.some((r) => r.slice(1) === k));
check('no dock destination also has a menu pill', overlap.length === 0, overlap.join(', ') || 'none');
check('Dex has no menu pill (it is the control)', !tileKeys.includes('dex') && !tileKeys.includes('brain'),
  tileKeys.join(', '));
check('Meeting Notes is not in the menu', !tileKeys.some((k) => /meeting/i.test(k)));
/* §8 asked that Send Daily Digest never sit next to Sign out. KM-5 answered it
   outright: Language, Theme and Sign out left this menu for Settings -> Account
   — "a nav menu is a list of PLACES; a theme switch and a session-ending action
   are neither". Settings is the whole utility now, so the two can no longer be
   neighbours anywhere. */
check('neither Send Daily Digest nor Sign out is in the menu at all',
  !tileKeys.includes('digest') && !tileKeys.includes('signout'), tileKeys.join(' | '));
check('Settings is the one utility', tileKeys.filter((k) => k === 'settings').length === 1,
  tileKeys.join(' | '));

/* Closing it: the same press on More puts the bar back on the slider path; the
   floating panel has Escape. Either way the page is where it was. */
if (DEX_SLIDER) {
  /* 2026-10-07 (founder) — THE WAYS OUT ARE THE BAR'S OWN. No close button:
     press More again, tap anywhere off the bar, or pick something. */
  check('the menu carries no close button of its own',
    (await page.locator('[data-testid="dock-more-close"]').count()) === 0);
  const urlBefore = page.url();
  await page.mouse.click(Math.round(page.viewportSize().width / 2), 180);   // on the page behind
  await page.waitForTimeout(700);
  check('a tap off the bar collapses the menu',
    (await page.locator('[data-testid="dock-more-panel"]').count()) === 0);
  /* …and that tap does nothing ELSE. Stopping the pointerdown does not stop the
     click, and without swallowing it the tap that dismissed the menu also
     opened whatever it landed on. */
  check('…and does not act on what it landed on', page.url() === urlBefore,
    `${urlBefore} -> ${page.url()}`);
  await page.locator('[data-testid="dock-more"]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-testid="dock-more"]').click();
  await page.waitForTimeout(700);
  check('pressing More again puts the bar back',
    (await page.locator('[data-testid="dock-more-panel"]').count()) === 0
    && (await page.locator('[data-testid="dex-slider"]').count()) === 1);
  /* ONE SHAPE IN BOTH STATES. The founder compared the shut bar with the
     expanded one and read the corners as different; they are the bar's own
     radius everywhere now — half its height, at every corner, in both. */
  /* offsetHeight, not the rect: a radius resolves in the element's OWN pixels
     and the phone draws them at 0.8 (--ui-scale), so comparing "48px" against a
     77px rect is the visual-vs-CSS mix-up this file warns about elsewhere. */
  const shut = await page.evaluate(() => {
    const w = document.querySelector('.kr-slider-well');
    const cs = getComputedStyle(w);
    return { h: w.offsetHeight, tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius };
  });
  await page.locator('[data-testid="dock-more"]').click();
  await page.waitForTimeout(700);
  const grown = await page.evaluate(() => {
    const w = document.querySelector('.kr-slider-well');
    const cs = getComputedStyle(w);
    return { h: w.offsetHeight, tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius };
  });
  /* The shut bar specifies 9999px, which the browser resolves to half its
     height; the grown one asks for that number outright, because 9999 on a
     334px box would clamp to half the WIDTH and draw a lozenge. */
  check('the expanded bar wears the shut bar\'s corner radius, on every corner',
    grown.tl === grown.bl && Math.abs(parseFloat(grown.tl) - shut.h / 2) <= 1,
    `shut ${shut.h}px tall (${shut.tl}) → grown ${grown.tl}`);
  await page.locator('[data-testid="dock-more"]').click();
  await page.waitForTimeout(500);
} else {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  check('Escape closes the panel', (await page.locator('[data-testid="allapps-panel"]').count()) === 0);
}
const afterY = await page.evaluate(() => Math.round(window.scrollY));
check('the menu leaves the page where it was', Math.abs(afterY - beforeY) <= 2, `${beforeY} -> ${afterY}`);

// ------------------------------------------------- 2 taps to every destination
const DESTINATIONS = [
  // /my-work moved to the dock in MPWA-12c — asserted as a 1-tap below.
  /* This table is the panel as it stands, tile for tile. It had fallen behind:
     /crm and /coach have no tile any more, and ASK-42 moved the calendar behind
     the Journal's "Events desk" pill and the bell into the Desk's own top bar —
     both of those doors are asserted on their own below. Approvals and
     Workflows are here because ASK-42 made them rooms rather than views inside
     My Work. Leave has its own page again (fe25b43, "Leave has a page of your
     own again"), so its tile lands on /leave. */
  ['/approvals', 'allapps-tile-approvals'],
  ['/workflows', 'allapps-tile-workflows'],
  ['/journal', 'allapps-tile-journal'],
  ['/operating-score', 'allapps-tile-operating-score'],
  ['/team', 'allapps-tile-team'],
  ['/leave', 'allapps-tile-leave'],
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
await page.waitForSelector(BAR, { timeout: 8000 });
await page.waitForTimeout(400);
const dockLabels = await page.locator('[data-testid^="dock-"]:not([data-testid$="-badge"])'
  + ':not([data-testid="dock-slider"]):not([data-testid="dock-slider-items"])')
  .evaluateAll((els) => els.map((e) => e.innerText.trim()));
/* ASK-38 seated CRM in the dock; 2026-10-06 sent it back to the More panel so
   the handle could have the middle. More is still last either way. */
check(DEX_SLIDER ? 'dock reads Desk · Work · Money · More' : 'dock reads Desk · Work · Money · CRM · More',
  dockLabels.join(' · ') === (DEX_SLIDER ? 'Desk · Work · Money · More' : 'Desk · Work · Money · CRM · More'),
  dockLabels.join(' · '));
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
/* ASK, FROM WHEREVER IT IS REACHED. (Rewritten 2026-10-06.)
   With DEX_SLIDER on there is no circle and no sheet off the Desk: the dock IS
   the control, and Ask opens INSIDE it — the bar grows into the conversation,
   the destinations fade out as the ends fade in, and a close button puts it
   back. With the flag off it is the old circle and the old sheet, unchanged. */
if (DEX_SLIDER) {
  await page.goto(`${BASE}/my-work`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="dock-slider"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  const well = await page.locator('[data-testid="dock-slider"] .kr-slider-well').boundingBox();
  const h = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  const cy = h.y + h.height / 2;
  /* Halfway: the swap must be UNDER WAY in both directions at once, which is
     the thing the founder asked for and the thing a duration would get wrong. */
  await page.mouse.move(h.x + h.width / 2, cy);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 40, cy, { steps: 6 });
  /* 2026-10-06 — THE END THAT ARRIVES IS THE ONE THIS DRAG IS GOING TO, and
     only that one: the founder asked for the other word to be absent rather
     than dim, so reading "the first label in the DOM" now reads whichever word
     is deliberately hidden half the time. This drag goes LEFT, which is Ask. */
  const mid = await page.evaluate(() => {
    const items = document.querySelector('[data-testid="dock-slider-items"]');
    /* Descendants, not direct children: the track is a row inside the well
       since More grew that same container (DexSlider's `menu`), so the labels
       are one level deeper than they were. */
    const ends = [...document.querySelectorAll('[data-testid="dock-slider"] .kr-slider-well span')]
      .filter((e) => /^(Ask|Decide)$/.test(e.textContent.trim()));
    const ask = ends.find((e) => e.textContent.trim() === 'Ask');
    const decide = ends.find((e) => e.textContent.trim() === 'Decide');
    return { nav: +getComputedStyle(items).opacity,
      end: ask ? +getComputedStyle(ask).opacity : 0,
      other: decide ? +getComputedStyle(decide).opacity : 0 };
  });
  check('the destinations fade as the end this drag names arrives',
    mid.nav < 1 && mid.end > 0 && mid.other === 0,
    `nav ${mid.nav.toFixed(2)} · ends ${mid.end.toFixed(2)}`);
  await page.mouse.move(well.x + 2, cy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  check('a full drag left turns the dock into the conversation',
    (await page.locator('[data-testid="dock-ask-panel"]').count()) === 1);
  check('…and raises no sheet over the page',
    (await page.locator('[data-testid="dex-chat"]').count()) === 0);
  check('the conversation can be closed back to a dock',
    (await page.locator('[data-testid="dock-ask-close"]').count()) === 1);
  await page.locator('[data-testid="dock-ask-close"]').click();
  await page.waitForTimeout(700);
  check('closing gives the destinations back',
    (await page.locator('[data-testid="dock-slider-items"] [data-testid^="dock-"]').count()) === 4);
} else {
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
  await page.locator('[data-testid="dex-plus"]').click();
  await page.waitForTimeout(400);
  check('the plus offers type, attach and photo',
    (await page.locator('[data-testid="dex-action-type"]').isVisible())
      && (await page.locator('[data-testid="dex-action-file"]').isVisible())
      && (await page.locator('[data-testid="dex-action-photo"]').isVisible()));
  await page.locator('[data-testid="dex-action-type"]').click();
  await page.waitForTimeout(400);
  check('Type turns the dock into a text field', await page.locator('[data-testid="dock-dex-input"]').isVisible());
  await page.locator('[data-testid="dex-chat-close"]').click();
}
await page.waitForTimeout(800);
check('closing gives the dock its destinations back',
  (await page.locator('[data-testid="dex-chat"]').count()) === 0
    && (await page.locator('[data-testid="dock-desk"]').isVisible()));
/* Opening it a SECOND time, by whichever way in this flag has. The claim is
   that nothing is left behind by the first close — not that a particular
   control exists. */
if (DEX_SLIDER) {
  const well2 = await page.locator('[data-testid="dock-slider"] .kr-slider-well').boundingBox();
  const h2 = await page.locator('[data-testid="dex-slider-handle"]').boundingBox();
  const cy2 = h2.y + h2.height / 2;
  await page.mouse.move(h2.x + h2.width / 2, cy2);
  await page.mouse.down();
  await page.mouse.move(well2.x + 2, cy2, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(1100);
  check('the next swipe opens Ask again, in the dock',
    (await page.locator('[data-testid="dock-ask-panel"]').count()) === 1);
} else {
  await page.locator('[data-testid="dex-fab"]').click();
  await page.waitForSelector('[data-testid="dex-chat"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  check('the next tap opens Ask again, still with no picker',
    (await page.locator('[data-testid^="dex-pick-"]').count()) === 0 && (await dexBadge()) === 'ask');
}
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

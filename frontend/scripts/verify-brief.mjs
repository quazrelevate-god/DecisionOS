#!/usr/bin/env node
/**
 * MPWA-07 + MPWA-12c verification — the Brief, now a *mode* of the Desk.
 *
 * MPWA-12c §2.1 merged /brief into /inbox?scope=morning, so this suite proves
 * three things at once:
 *   1. the permanent redirect works and lands on the narrative scope,
 *   2. MPWA-07's original done-when still holds there (verdict sentence above
 *      the fold, no zero tiles, under 2,500px),
 *   3. switching scope is a param change, not a page load.
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

// ------------------------------------------------- 1. the permanent redirect
await page.goto(`${BASE}/brief`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-mobile"]', { timeout: 15000 });
await page.waitForTimeout(1100);
const landed = new URL(page.url());
check('/brief redirects to the Desk', landed.pathname === '/inbox', landed.pathname);
check('…on the morning scope', landed.searchParams.get('scope') === 'morning',
  landed.search || '(no query)');
// `replace` — a bookmark to /brief must not trap him behind his own back
// button. Going back must leave /brief entirely rather than bounce off the
// redirect forever.
const beforeBack = page.url();
await page.goBack().catch(() => {});
await page.waitForTimeout(700);
check('the redirect replaces rather than stacks history',
  new URL(page.url()).pathname !== '/brief'
    && !(page.url() === beforeBack && new URL(page.url()).searchParams.get('scope') === 'morning'),
  `back from the redirect landed on ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
await page.goto(`${BASE}/brief`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-mobile"]', { timeout: 15000 });
await page.waitForTimeout(900);
check('the page names the mode, not the route',
  /morning brief/i.test(await page.title()), await page.title());

const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
check('page is under 2,500px', h < 2500, `${h}px`);

// ------------------------------------------------- 2. MPWA-07's done-when
const verdict = page.locator('[data-testid="desk-verdict"] h1');
const vText = (await verdict.innerText()).trim();
const vBox = await verdict.boundingBox();
check('leads with a written verdict sentence', /\.$/.test(vText) && vText.split(/\s+/).length >= 5, vText);
check('verdict is visible without scrolling', vBox.y + vBox.height <= 844,
  `bottom at ${Math.round(vBox.y + vBox.height)}`);
check('verdict is a sentence about money or work, not a bare count',
  /₹[\d,]+|\b(decision|task|thing)s?\b/i.test(vText), vText);
check('verdict carries the mode label as its eyebrow',
  /morning brief/i.test((await page.locator('[data-testid="desk-verdict"]').innerText()).trim()));

// §5.2.3: the control sits ABOVE the content it filters.
const scopesBox = await page.locator('[data-testid="desk-scopes"]').boundingBox();
check('scope switcher is above the content it filters', scopesBox.y < vBox.y,
  `switcher y=${Math.round(scopesBox.y)}, verdict y=${Math.round(vBox.y)}`);
const scopeBtns = await page.locator('[data-testid="desk-scopes"] button').all();
check('all five scopes are offered', scopeBtns.length === 5, `${scopeBtns.length} scopes`);
for (const b of scopeBtns) {
  const bb = await b.boundingBox();
  check(`scope "${(await b.innerText()).trim()}" clears 44px`, bb.height >= 44, `${Math.round(bb.height)}px`);
}

// §8: max 3 fires, each with amount / days late / person / one tap target.
const fireRows = page.locator('[data-testid^="brief-fires-row-"]');
const fires = await fireRows.count();
check('at most 3 fires', fires <= 3, `${fires} shown`);
if (fires) {
  const first = (await fireRows.first().innerText()).replace(/\s+/g, ' ');
  check('fire shows the amount', /₹[\d,]+/.test(first), first.slice(0, 90));
  check('fire shows how late it is', /\d+ days? late/.test(first), first.slice(0, 90));
  check('each fire row is one tap target, not a row plus a button',
    (await fireRows.first().evaluate((el) => el.tagName === 'BUTTON' && el.querySelectorAll('button,a[href]').length === 0)));
}

// §8: the money line, received vs outstanding, as a Pulse.
const money = (await page.locator('[data-testid="desk-money-pulse"]').innerText()).replace(/\s+/g, ' ');
check('money line shows received and outstanding',
  /Received/.test(money) && /Outstanding/.test(money), money.slice(0, 80));
const received = (await page.locator('[data-testid="desk-money-pulse"]').getByText(/^₹/).first().innerText()).trim();
check('received is a real figure, not a permanent skeleton', /^₹[\d,.]+(Cr|L)?$/.test(received), received);

// §5.2: the numbers are expanded when <= 4, and a zero never renders.
const gridTiles = page.locator('[data-testid^="brief-numbers-tile-"]');
const toggle = page.locator('[data-testid="brief-numbers-toggle"]');
if (await toggle.count()) {
  check('collapsed only when there are more than 4 numbers',
    (await gridTiles.count()) === 0, `${await gridTiles.count()} tiles while collapsed`);
  await toggle.click();
  await page.waitForTimeout(400);
}
const rows = await gridTiles.evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
check('numbers are shown', rows.length > 0, `${rows.length} tiles`);
check('no number reads zero', !rows.some((r) => /(^|\s)0(\s|$)/.test(r)), rows.join(' | ').slice(0, 200));

const bodyText = await page.locator('[data-testid="desk-mobile"]').innerText();
check('deliberate zero counters are absent from the page',
  !/\b0 (rejected|stalled|absconding)/i.test(bodyText));

// §5.2.4: one tap target per destination — no chevron AND a "View details" link
check('nothing carries both a chevron and a "View details" link',
  !/view details/i.test(bodyText));

// Indian grouping everywhere on the screen
const amounts = bodyText.match(/₹[\d,]+(?!\s?(?:Cr|L))/g) || [];
const bad = amounts.filter((a) => {
  const p = a.slice(1).split(',');
  if (p.length === 1) return false;
  return !(p[p.length - 1].length === 3 && p.slice(1, -1).every((x) => x.length === 2) && p[0].length <= 2);
});
check('every amount uses Indian grouping', bad.length === 0, bad.join(', ') || amounts.slice(0, 5).join(', '));

// ------------------------------------------- 3. scope switching, no page load
await page.evaluate(() => { window.__deskAlive = true; });
for (const [label, expected, wantsChips] of [
  ['Week', 'week', false], ['Now', null, true], ['Evening', 'evening', false],
]) {
  await page.locator('[data-testid="desk-scopes"]').getByText(label, { exact: true }).click();
  await page.waitForTimeout(900);
  const u = new URL(page.url());
  check(`"${label}" switches scope without a page load`,
    await page.evaluate(() => window.__deskAlive === true));
  check(`"${label}" is a param change, not a route change`, u.pathname === '/inbox', u.pathname);
  check(`"${label}" sets scope=${expected ?? '(absent)'}`,
    u.searchParams.get('scope') === expected, u.search || '(no query)');
  const chips = await page.locator('[data-testid="desk-chips"]').count();
  check(`the 4 chips exist only in "now" — ${label}`, wantsChips ? chips === 1 : chips === 0,
    `${chips} chip strip(s)`);
  check(`"${label}" names itself in the tab title`,
    (await page.title()).toLowerCase().includes(label.toLowerCase())
      || (label === 'Now' && /desk/i.test(await page.title())),
    await page.title());
}

// The old page is gone as a *page*, not as content.
check('CEOBriefMobile is no longer mounted anywhere',
  (await page.locator('[data-testid="brief-mobile"]').count()) === 0);

await ctx.close();

// ------------------------------------------------------ desktop is untouched
const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dpage = await dctx.newPage();
check('signed in on desktop', await signIn(dpage, BASE));
await dpage.goto(`${BASE}/brief`, { waitUntil: 'domcontentloaded' });
await dpage.waitForTimeout(1400);
check('desktop /brief does NOT redirect', new URL(dpage.url()).pathname === '/brief',
  new URL(dpage.url()).pathname);
check('desktop /brief still renders its own page',
  (await dpage.locator('[data-testid="desk-mobile"]').count()) === 0);
await dctx.close();

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

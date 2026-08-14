#!/usr/bin/env node
/**
 * MPWA-07 verification — CEO Brief.
 *
 * §8's done-when: the verdict sentence is visible without scrolling; no zero
 * tiles render; page under 2,500px.
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
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await ctx.clock.setFixedTime(new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`));
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

await page.goto(`${BASE}/brief`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="brief-mobile"]', { timeout: 15000 });
await page.waitForTimeout(1100);

const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
check('page is under 2,500px', h < 2500, `${h}px`);

// §8: hero verdict, one written sentence, visible without scrolling.
const verdict = await page.locator('[data-testid="brief-verdict"] h1');
const vText = (await verdict.innerText()).trim();
const vBox = await verdict.boundingBox();
check('leads with a written verdict sentence', /\.$/.test(vText) && vText.split(/\s+/).length >= 5, vText);
check('verdict is visible without scrolling', vBox.y + vBox.height <= 844,
  `bottom at ${Math.round(vBox.y + vBox.height)}`);
check('verdict names money, not a count', /₹[\d,]+/.test(vText), vText);
check('verdict has exactly one action',
  (await page.locator('[data-testid="brief-verdict-action"]').count()) === 1);

// §5.2.3: the control sits ABOVE the content it filters.
const periodsBox = await page.locator('[data-testid="brief-periods"]').boundingBox();
check('period switcher is above the content it filters', periodsBox.y < vBox.y,
  `switcher y=${Math.round(periodsBox.y)}, verdict y=${Math.round(vBox.y)}`);
for (const b of await page.locator('[data-testid^="brief-period-"]').all()) {
  const bb = await b.boundingBox();
  const id = await b.getAttribute('data-testid');
  check(`${id} clears 44px`, bb.height >= 44, `${Math.round(bb.height)}px`);
}

// §8: max 3 fires, each with amount / days late / person / one action.
const fires = await page.locator('[data-testid^="brief-fire-"]:not([data-testid*="action"])').count();
check('at most 3 fires', fires <= 3, `${fires} shown`);
if (fires) {
  const first = await page.locator('[data-testid^="brief-fire-"]:not([data-testid*="action"])').first().innerText();
  check('fire shows the amount', /₹[\d,]+/.test(first), first.split('\n')[1] || first);
  check('fire shows how late it is', /\d+ days? late/.test(first));
  check('fire names the person', /Priya|Suresh|Anita|Mohan/.test(first));
  const actions = await page.locator('[data-testid^="brief-fire-action-"]').count();
  check('each fire has exactly one action', actions === fires, `${actions} actions / ${fires} fires`);
}

// §8: "Waiting on you — 6 ›" linking to /inbox
check('shows what is waiting on him', await page.locator('[data-testid="brief-waiting"]').isVisible());
const waitText = (await page.locator('[data-testid="brief-waiting"]').innerText()).trim();
check('"Waiting on you" carries the count', /Waiting on you — \d+/.test(waitText), waitText);

// §8: the money line, received vs outstanding
const money = (await page.locator('[data-testid="brief-money"]').innerText()).replace(/\s+/g, ' ');
check('money line shows received and outstanding',
  /Received/.test(money) && /Outstanding/.test(money), money.slice(0, 80));
const received = (await page.locator('[data-testid="brief-received"]').innerText()).trim();
check('received is a real Indian-grouped figure, not a skeleton',
  /^₹[\d,]+$/.test(received) && /,\d{2},|^₹\d{1,2},\d{3}$/.test(received), received);

// §8: collapsed numbers, zero-value entries hidden entirely
const collapsedBefore = await page.locator('[data-testid^="brief-number-"]').count();
check('numbers block starts collapsed', collapsedBefore === 0, `${collapsedBefore} rows visible`);
await page.locator('[data-testid="brief-numbers-toggle"]').click();
await page.waitForTimeout(400);
const rows = await page.locator('[data-testid^="brief-number-"]').evaluateAll((els) =>
  els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
);
check('numbers expand on tap', rows.length > 0, `${rows.length} rows`);
check('no row reads zero', !rows.some((r) => /^0\b/.test(r)), rows.join(' | ').slice(0, 200));

// The API sends three deliberate zeros; none may appear.
const bodyText = await page.locator('[data-testid="brief-mobile"]').innerText();
check('deliberate zero counters are absent from the page',
  !/\b0 (rejected|stalled|absconding)/i.test(bodyText));

// §5.2.4: one tap target per destination — no chevron AND a "View details" link
const doubleTargets = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid^="brief-number-"], [data-testid="brief-waiting"]')];
  return rows.filter((r) => /view details/i.test(r.innerText)).length;
});
check('no row carries both a chevron and a "View details" link', doubleTargets === 0);

// Indian grouping everywhere on the screen
const amounts = bodyText.match(/₹[\d,]+/g) || [];
const bad = amounts.filter((a) => {
  const p = a.slice(1).split(',');
  if (p.length === 1) return false;
  return !(p[p.length - 1].length === 3 && p.slice(1, -1).every((x) => x.length === 2) && p[0].length <= 2);
});
check('every amount uses Indian grouping', bad.length === 0, bad.join(', ') || amounts.slice(0, 5).join(', '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

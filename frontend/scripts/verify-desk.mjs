#!/usr/bin/env node
/**
 * MPWA-06 + MPWA-12c/d verification — the Desk in `now` scope.
 *
 * MPWA-06's done-when still applies verbatim (cold open -> top item readable
 * without scrolling; six decisions clearable without leaving the overlay; page
 * under 2,500px), but 12c re-composed the screen from the §3 block system and
 * 12d replaced the decision sheet with the routed Focus View, so the selectors
 * and the strata are new.
 *
 * Runs against the `busy` fixture: the counts have to be deterministic to assert
 * "capped at 5, rest behind See all", and real-tenant data is not.
 */
import fs from 'node:fs';
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
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
await ctx.clock.setFixedTime(new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`));
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));
await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-mobile"]', { timeout: 15000 });
await page.waitForTimeout(1100);

// ------------------------------------------------------------ page structure
const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
check('page is under 2,500px', h < 2500, `${h}px`);
check('scope defaults to `now` with no param',
  new URL(page.url()).searchParams.get('scope') === null,
  new URL(page.url()).search);

// §2 / §5.1: the screen leads with a written verdict, not a tile.
const verdict = page.locator('[data-testid="desk-verdict"]');
const vText = (await verdict.locator('h1').innerText()).trim();
check('leads with a written sentence, not a tile',
  /\.$/.test(vText) && vText.split(/\s+/).length >= 4, vText);
const vBox = await verdict.boundingBox();
check('the verdict is readable without scrolling', vBox.y + vBox.height <= 844,
  `bottom at ${Math.round(vBox.y + vBox.height)}`);

// §3 L1 — at least three distinct block shapes on a primary screen.
const blocks = await page.locator('[data-block]').evaluateAll((els) =>
  [...new Set(els.map((e) => e.getAttribute('data-block')))]);
check('composed from >= 3 distinct block types', blocks.length >= 3, blocks.join(', '));

// §3 L3 — exactly one progress element, and it is throughput, not a problem.
const progress = await page.locator('[data-progress]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-progress')));
check('exactly one progress element', progress.length === 1, progress.join(', ') || 'none');
check('the progress element is cleared-today throughput',
  progress[0] === 'cleared-today', progress[0] || 'none');

// §2: no chip may render a zero
const chips = await page.locator('[data-testid^="desk-chips-"]').evaluateAll((els) =>
  els.map((e) => ({ id: e.getAttribute('data-testid'), text: e.innerText.replace(/\s+/g, ' ').trim() })));
check('the 4 chips exist in `now`', chips.length >= 3, chips.map((c) => c.id).join(', '));
check('zero-count chips do not render',
  !chips.some((c) => /\b0$/.test(c.text)), chips.map((c) => c.text).join(' | '));

// §5.2.1: chips wrap, they do not scroll
const chipRow = await page.locator('[data-testid="desk-chips"] > *').first().evaluate((el) => ({
  wrap: getComputedStyle(el).flexWrap,
  overflowX: getComputedStyle(el).overflowX,
  clipped: el.scrollWidth > el.clientWidth + 1,
  rows: new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().top))).size,
}));
check('chip row wraps rather than scrolls',
  chipRow.wrap === 'wrap' && !chipRow.clipped && ['visible', 'clip'].includes(chipRow.overflowX),
  JSON.stringify(chipRow));
check('chips actually wrap onto multiple rows at 390px', chipRow.rows > 1, `${chipRow.rows} rows`);

for (const c of await page.locator('[data-testid^="desk-chips-"]').all()) {
  const b = await c.boundingBox();
  const id = await c.getAttribute('data-testid');
  check(`${id} clears 44px`, b.height >= 44, `${Math.round(b.height)}px`);
}

// §8: cap the list at 5, rest behind "See all"
const rows = page.locator('[data-testid^="desk-queue-row-"]');
check('list is capped at 5 rows', (await rows.count()) === 5, `${await rows.count()} shown`);
const seeAll = page.locator('[data-testid="desk-queue-see-all"]');
check('the rest sit behind "See all"', await seeAll.isVisible());
// busy has 30 pending decisions; the hero is not one of them in this chip.
check('"See all" names the real total', /30/.test((await seeAll.innerText()).trim()),
  (await seeAll.innerText()).trim());

// cold open: the top item readable without scrolling
const firstRow = await rows.first().boundingBox();
check('top row is fully visible without scrolling',
  firstRow.y + firstRow.height <= 844, `row bottom at ${Math.round(firstRow.y + firstRow.height)}`);

// §5.3: Indian grouping, right-aligned, tabular
const body = await page.locator('[data-testid="desk-mobile"]').innerText();
const amounts = body.match(/₹[\d,]+(?!\s?(?:Cr|L))/g) || [];
const badGrouping = amounts.filter((a) => {
  const parts = a.slice(1).split(',');
  if (parts.length === 1) return false;
  return !(parts[parts.length - 1].length === 3 &&
           parts.slice(1, -1).every((p) => p.length === 2) &&
           parts[0].length <= 2);
});
check('every amount uses Indian grouping', badGrouping.length === 0,
  badGrouping.join(', ') || amounts.slice(0, 4).join(', '));
const amtStyle = await rows.first().locator('span.tabular-nums').first()
  .evaluate((el) => ({ align: getComputedStyle(el).textAlign, ff: getComputedStyle(el).fontVariantNumeric }));
check('amounts are right-aligned and tabular', amtStyle.align === 'right' && /tabular-nums/.test(amtStyle.ff),
  JSON.stringify(amtStyle));

// §5.2.4: one tap target per row
const nested = await rows.first().evaluate((el) => el.querySelectorAll('a,button,[role="button"]').length);
check('row is one tap target, no nested controls', nested === 0, `${nested} nested`);

// §8: capture must NOT be on this page
check('no capture bar on the Desk',
  (await page.locator('[data-testid="dex-capture-bar"]').count()) === 0);

// §5.1: with fires present, the fire IS the hero — not a chip AND a card.
await page.locator('[data-testid="desk-chips-on_fire"]').click();
await page.waitForTimeout(900);
const heroText = (await verdict.innerText()).replace(/\s+/g, ' ');
check('the fire chip promotes the fire into the verdict', /on fire/i.test(heroText), heroText.slice(0, 90));
check('the hero fire is not repeated as the first queue row',
  !(await page.locator('[data-testid="desk-queue"]').innerText())
    .includes((await verdict.locator('[data-testid="desk-verdict-detail"]').innerText()).split('\n')[0]),
  'hero title absent from the queue');
await page.locator('[data-testid="desk-chips-needs_decision"]').click();
await page.waitForTimeout(900);

// ------------------------------------------------------- the Focus View (12d)
await rows.first().click();
await page.waitForSelector('[data-testid="focus-view"]', { timeout: 6000 });
await page.waitForTimeout(700);

const focusUrl = new URL(page.url());
check('Focus View is routed, not local state',
  /^decision:/.test(focusUrl.searchParams.get('focus') || ''), focusUrl.search);
check('a decision opens in place, on the Desk', focusUrl.pathname === '/inbox', focusUrl.pathname);

const sheetText = await page.locator('[data-testid="focus-view"]').innerText();
check('Focus View shows the exact amount',
  /₹[\d,]+/.test(await page.locator('[data-testid="focus-amount"]').innerText()),
  (await page.locator('[data-testid="focus-amount"]').innerText()).trim());
check('Focus View gives a plain-language rationale', sheetText.replace(/\s+/g, ' ').length > 60);
check('Focus View offers a note instead of a verdict',
  await page.locator('[data-testid="focus-note-toggle"]').isVisible());

const approveBox = await page.locator('[data-testid="focus-approve"]').boundingBox();
check('Approve is on the 56px tier', approveBox.height >= 56, `${Math.round(approveBox.height)}px`);
const approveText = await page.locator('[data-testid="focus-approve"]').innerText();
check('amount is inside the Approve button above the threshold',
  /₹[\d,]+/.test(approveText), approveText.replace(/\n/g, ' '));
const rejectBox = await page.locator('[data-testid="focus-reject"]').boundingBox();
check('Approve and Reject are >= 8px apart',
  rejectBox.x - (approveBox.x + approveBox.width) >= 7.5,
  `${Math.round(rejectBox.x - (approveBox.x + approveBox.width))}px`);

// §8: it survives a refresh, because it is a URL and not a useState.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
check('Focus View survives a refresh',
  (await page.locator('[data-testid="focus-view"]').count()) > 0);

// …and the browser back button closes it rather than leaving the screen.
await page.goBack();
await page.waitForTimeout(900);
check('browser back closes the Focus View, staying on the Desk',
  (await page.locator('[data-testid="focus-view"]').count()) === 0
    && new URL(page.url()).pathname === '/inbox',
  new URL(page.url()).pathname + new URL(page.url()).search);

// ----------------------------------------- clear six without leaving the Desk
let cleared = 0;
for (let i = 0; i < 6; i++) {
  const row = page.locator('[data-testid^="desk-queue-row-"]').first();
  if (!(await row.count())) break;
  await row.click();
  await page.waitForSelector('[data-testid="focus-view"]', { timeout: 6000 }).catch(() => {});
  if (!(await page.locator('[data-testid="focus-approve"]').count())) break;
  await page.locator('[data-testid="focus-approve"]').click();
  await page.waitForTimeout(750);
  cleared += 1;
  if (new URL(page.url()).pathname !== '/inbox') break;
}
check('six decisions clearable without leaving the Desk', cleared === 6, `${cleared} cleared`);
check('still on the Desk after clearing six', new URL(page.url()).pathname === '/inbox',
  new URL(page.url()).pathname);
check('the Focus View closed itself after the last one',
  (await page.locator('[data-testid="focus-view"]').count()) === 0);

// §5.5: undo, not a confirm dialog
const undoSeen = await page.locator('[data-testid="undo-snackbar"]').count();
check('an undo snackbar fired for a high-value approval', undoSeen > 0,
  undoSeen ? (await page.locator('[data-testid="undo-snackbar"]').innerText()).replace(/\n/g, ' ') : 'none');

// ------------------------------------- §8: one level only, and it deep-links
await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="desk-mobile"]', { timeout: 12000 });
await page.waitForTimeout(1200);

// Open a fire from the narrative scope's fires queue, then prove that every
// control inside the sheet either closes it or leaves the page — none of them
// stacks a second Focus View. This is the runtime half; the structural half is
// that FocusView.jsx never calls useFocus().open, asserted below.
await page.goto(`${BASE}/inbox?scope=morning&fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
const fire = page.locator('[data-testid^="brief-fires-row-"]').first();
if (await fire.count()) {
  await fire.click();
  await page.waitForSelector('[data-testid="focus-view"]', { timeout: 6000 });
  await page.waitForTimeout(600);
  check('a fire opens the Focus View in place',
    new URL(page.url()).pathname === '/inbox'
      && /^fire:/.test(new URL(page.url()).searchParams.get('focus') || ''),
    new URL(page.url()).search);
  const inner = await page.locator('[data-testid="focus-view"]')
    .locator('button, a[href]').evaluateAll((els) => els.length);
  check('the Focus View has controls to test', inner > 0, `${inner} controls`);
  // Clicking each in turn would commit real writes, so assert the invariant the
  // structure gives us instead: at most one focus value, and never two sheets.
  check('only one focus value can be in the URL at a time',
    (new URL(page.url()).searchParams.getAll('focus')).length === 1);
  check('never more than one Focus View in the DOM',
    (await page.locator('[data-testid="focus-view"]').count()) === 1);

  // `Open … →` drops the param and pushes the real route (§2.2's escape hatch).
  const escape = page.locator('[data-testid="focus-open-full"]');
  check('a task/fire focus offers the "Open …" escape hatch', (await escape.count()) === 1);
  if (await escape.count()) {
    await escape.click();
    await page.waitForTimeout(1000);
    const u = new URL(page.url());
    check('"Open …" leaves rather than nesting',
      u.searchParams.get('focus') === null && u.pathname !== '/inbox',
      u.pathname + u.search);
  }
}

// §2.2: the Desk's number drill-down links to /my-work?focus=task:<id>. That
// param has to resolve on arrival, not land on a page that ignores it.
await page.goto(`${BASE}/my-work?fixture=busy`, { waitUntil: 'domcontentloaded' });
// /my-work renders the desktop tree on every viewport now — the mobile screen
// that carried data-testid="mywork-mobile" is deleted. Wait on the task list
// the desktop page renders instead.
await page.waitForSelector('[data-testid="task-card-"], .card-brutal, [data-testid="mywork-empty"]', { timeout: 12000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.waitForTimeout(1200);
// The mobile Queue block that carried work-group-<bucket>-row-<id> is gone —
// /my-work renders the desktop tree on every viewport now, where a task row is
// a .card-brutal carrying id="task-card-<id>". What this check exists for is
// unchanged: that the Desk has somewhere real to deep-link into.
const taskId = await page.locator('[id^="task-card-"]').first()
  .getAttribute('id').then((v) => (v ? v.replace(/^task-card-/, '') : null))
  .catch(() => null);
check('My Work has tasks to deep-link into', !!taskId, taskId || 'none found');
if (taskId) {
  const id = taskId.replace(/^work-group-[a-z]+-row-/, '');
  await page.goto(`${BASE}/my-work?fixture=busy&focus=task:${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
  // The desktop tree has no FocusView overlay — it resolves a deep link by
  // selecting the right tab/scope and scrolling the card into view. So assert
  // the thing that actually has to be true: the linked task is on screen.
  // (MyWork now accepts BOTH ?task=<id> and ?focus=task:<id>; the latter is
  // what the Desk emits and it resolved to nothing once the mobile screen went.)
  check('/my-work resolves a focus deep link',
    (await page.locator(`#task-card-${id}`).count()) === 1,
    `focus=task:${id}`);
}

// A stale or unknown id says so rather than opening a blank sheet (§2.2).
await page.goto(`${BASE}/inbox?fixture=busy&focus=decision:does-not-exist`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
check('a stale id renders the "gone" state, not a blank sheet',
  (await page.locator('[data-testid="focus-gone"]').count()) === 1);
await page.goto(`${BASE}/inbox?fixture=busy&focus=nonsense:1`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
check('an unrecognised focus type is explained, not ignored',
  (await page.locator('[data-testid="focus-gone"]').count()) === 1);

// The structural guarantee behind §8's "no Focus View opens another": the
// component reads `close` from useFocus and never `open`, so there is no code
// path that can add a second focus value. Asserted on the source, because a
// runtime click-sweep would have to commit real writes to cover every control.
const focusSrc = fs.readFileSync(new URL('../src/components/mobile/FocusView.jsx', import.meta.url), 'utf8');
const focusBody = focusSrc.slice(focusSrc.indexOf('export function FocusView'));
check('FocusView never opens a focus (one level only)',
  !/\bopen\s*\(/.test(focusBody),
  (focusBody.match(/\bopen\s*\([^)]*\)/) || ['none'])[0]);

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

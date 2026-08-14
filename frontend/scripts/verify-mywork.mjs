#!/usr/bin/env node
/**
 * MPWA-12f verification — My Work as a flow (§5.4).
 *
 * "A founder's work is a FLOW; rendering it as a to-do list is the biggest
 * regression from v2." So: the Workflows view is a snap stage board moved by
 * long-press, and the Tasks view is three grouped Queues with a ring per card.
 *
 * Runs against the fixtures — the board's geometry and the bucket counts have to
 * be deterministic.
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

// ============================================================ the stage board
await page.goto(`${BASE}/my-work?view=workflows&fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="workflow-board"]', { timeout: 15000 });
await page.waitForTimeout(1200);

check('workflows render as a board, not a list of cards',
  (await page.locator('[data-testid="workflow-board"]').count()) === 1);
check('the board declares its block type',
  (await page.locator('[data-testid="workflow-board"]').getAttribute('data-block')) === 'board');

const cols = await page.locator('[data-testid^="workflow-board-col-"]').all();
check('there is more than one stage column', cols.length > 1, `${cols.length} columns`);
for (const c of cols) {
  const box = await c.boundingBox();
  const key = await c.getAttribute('data-testid');
  check(`${key} is 232px wide`, Math.round(box.width) === 232, `${Math.round(box.width)}px`);
  const snap = await c.evaluate((el) => getComputedStyle(el).scrollSnapAlign);
  check(`${key} snaps to start`, snap.startsWith('start'), snap);
}
const scroller = page.locator('[data-testid="workflow-board-scroller"]');
const snapType = await scroller.evaluate((el) => getComputedStyle(el).scrollSnapType);
check('the board is scroll-snap-type: x mandatory', /x\s+mandatory/.test(snapType), snapType);

// Column header: stage name · count · completion ring (§5.4)
const head = page.locator('[data-testid^="workflow-board-head-"]').first();
const headText = (await head.innerText()).replace(/\s+/g, ' ').trim();
check('the column header names the stage and its count', /\S+.*\d/.test(headText), headText);
check('the column header carries a completion ring',
  (await head.locator('svg circle').count()) >= 2, `${await head.locator('svg circle').count()} circles`);
for (const h of await page.locator('[data-testid^="workflow-board-head-"]').all()) {
  const b = await h.boundingBox();
  check('a board tap target clears 44px', b.height >= 44, `${Math.round(b.height)}px`);
}

// §5.4: dot indicator plus a thin progress rail under the board
check('a dot indicator sits under the board',
  (await page.locator('[data-testid="workflow-board-dots"]').count()) === 1);
const dots = await page.locator('[data-testid="workflow-board-dots"] > *').count();
check('one dot per stage', dots === cols.length, `${dots} dots / ${cols.length} columns`);

// L3: exactly one progress element, and it reports throughput
const prog = await page.locator('[data-progress]').evaluateAll((els) => els.map((e) => e.getAttribute('data-progress')));
check('exactly one progress element on the board view', prog.length === 1, prog.join(', ') || 'none');
const rail = await page.locator('[data-progress="stage-completion"] [role="img"]').getAttribute('aria-label');
check('the rail reports cleared work, not scroll position', /\d+ of \d+ cleared/.test(rail || ''), rail || 'none');

// §5.4: "Do not attempt desktop drag-and-drop on a phone."
const draggables = await page.locator('[data-testid="workflow-board"] [draggable="true"]').count();
check('no HTML5 drag-and-drop on the board', draggables === 0, `${draggables} draggable nodes`);

// swiping between columns moves the active dot
const beforeDot = await page.locator('[data-testid="workflow-board-dots"] > *').first()
  .evaluate((el) => el.className);
await scroller.evaluate((el) => { el.scrollLeft = 244; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(400);
const afterDot = await page.locator('[data-testid="workflow-board-dots"] > *').first()
  .evaluate((el) => el.className);
check('scrolling the board updates the stage indicator', beforeDot !== afterDot);
await scroller.evaluate((el) => { el.scrollLeft = 0; el.dispatchEvent(new Event('scroll')); });
await page.waitForTimeout(300);

// ------------------------------------------- advance by long-press, then tap
const firstCard = page.locator('[data-testid^="workflow-card-"]').first();
const cardTitle = (await firstCard.innerText()).split('\n')[0];
const cardBox = await firstCard.boundingBox();
check('cards are MobileCards inside the columns', !!cardBox, cardTitle.slice(0, 40));

// A short press must NOT lift — that is a tap, and a tap opens the record.
await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 20);
await page.mouse.down();
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(400);
check('a short press does not lift the card',
  (await page.locator('[data-testid="workflow-board-lifted"]').count()) === 0);
if (await page.locator('[data-testid="workflow-sheet"]').count()) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// A long press lifts it and the other stages become targets.
await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + 20);
await page.mouse.down();
await page.waitForTimeout(700);
check('a long press lifts the card',
  (await page.locator('[data-testid="workflow-board-lifted"]').count()) === 1);
const liftMsg = (await page.locator('[data-testid="workflow-board-lifted"]').innerText()).replace(/\s+/g, ' ');
check('the lift says what is moving and how to cancel',
  /moving/i.test(liftMsg) && /cancel/i.test(liftMsg), liftMsg.slice(0, 80));
await page.mouse.up();
await page.waitForTimeout(300);
check('releasing the finger keeps the card lifted, waiting for a target',
  (await page.locator('[data-testid="workflow-board-lifted"]').count()) === 1);

const targetKeys = await page.locator('[data-testid^="workflow-board-head-"]')
  .evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid'), disabled: e.disabled })));
const enabled = targetKeys.filter((t) => !t.disabled);
check('the other stages become tappable targets', enabled.length === cols.length - 1,
  `${enabled.length} of ${cols.length} enabled`);
check('the stage it is already in is not a target',
  targetKeys.filter((t) => t.disabled).length === 1);

// In fixture mode the call never reaches the network — the adapter is
// short-circuited — so read the dev-only call log instead of a request listener.
await page.evaluate(() => { window.__DOS_FIXTURE_CALLS = []; });
await page.locator(`[data-testid="${enabled[0].id}"]`).click();
await page.waitForTimeout(1200);
const moveCall = await page.evaluate(() =>
  (window.__DOS_FIXTURE_CALLS || []).find((c) => /\/workflows\/[^/]+\/advance/.test(c.url)) || null);
check('tapping a stage moves the card', moveCall !== null, JSON.stringify(moveCall));
check('the move is a PATCH with the target stage in the body',
  moveCall?.method === 'PATCH' && !!(moveCall?.body?.stage || /"stage"\s*:/.test(String(moveCall?.body || ''))),
  `${moveCall?.method} ${JSON.stringify(moveCall?.body)}`);
check('the lift clears after the move',
  (await page.locator('[data-testid="workflow-board-lifted"]').count()) === 0);

// cancelling a lift
const c2 = await page.locator('[data-testid^="workflow-card-"]').first().boundingBox();
await page.mouse.move(c2.x + c2.width / 2, c2.y + 20);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.waitForTimeout(300);
await page.locator('[data-testid="workflow-board-lifted"] button').click();
await page.waitForTimeout(300);
check('a lift can be cancelled',
  (await page.locator('[data-testid="workflow-board-lifted"]').count()) === 0);

// ============================================================== the tasks tab
await page.goto(`${BASE}/my-work?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="mywork-list"]', { timeout: 15000 });
await page.waitForTimeout(1400);

const h = await page.evaluate(() => document.scrollingElement.scrollHeight);
check('the tasks screen is under 2,500px', h < 2500, `${h}px`);

// §5.4: grouped Today / This week / Later with section counts
const groupIds = await page.locator('[data-block="queue"]').evaluateAll((els) =>
  els.map((e) => e.getAttribute('data-testid')));
check('tasks are grouped, not one flat list', groupIds.length >= 2, groupIds.join(', '));
const labels = await page.locator('[data-block="queue"] h2').allInnerTexts();
check('the groups are Today / This week / Later',
  labels.every((l) => /Today|This week|Later/.test(l)), labels.map((l) => l.replace(/\s+/g, ' ')).join(' | '));
check('each group shows its count',
  labels.every((l) => /\d/.test(l)), labels.map((l) => l.replace(/\s+/g, ' ')).join(' | '));

// A ring per card, not a percentage in text.
const rings = await page.locator('[data-testid*="-ring-"]').count();
check('progress is a ring, not "% done" text', rings > 0, `${rings} rings`);
const bodyText = await page.locator('[data-testid="mywork-list"]').innerText();
check('no "% done" text remains on a card', !/\d+% done/.test(bodyText),
  (bodyText.match(/\d+% done/) || ['none'])[0]);
const ringLabel = await page.locator('[data-testid*="-ring-"]').first().getAttribute('aria-label');
check('the ring is still readable to a screen reader', /\d+% done/.test(ringLabel || ''), ringLabel || 'none');

// L1 / L3 on the primary screen
const blocks = await page.locator('[data-block]').evaluateAll((els) =>
  [...new Set(els.map((e) => e.getAttribute('data-block')))]);
check('composed from >= 3 distinct block types', blocks.length >= 3, blocks.join(', '));
const tProg = await page.locator('[data-progress]').evaluateAll((els) => els.map((e) => e.getAttribute('data-progress')));
check('exactly one progress element on the tasks view', tProg.length === 1, tProg.join(', ') || 'none');
check('the progress element is work finished, not a vanity metric',
  tProg[0] === 'tasks-done-today', tProg[0] || 'none');

// The shipped swipe gesture survived the move onto the block.
const row = page.locator('[data-testid^="task-row-"]').first();
check('rows still carry the swipe wrapper', (await row.count()) === 1);
const rowBox = await row.boundingBox();
await page.evaluate(() => { window.__DOS_FIXTURE_CALLS = []; });
await page.mouse.move(rowBox.x + rowBox.width - 30, rowBox.y + rowBox.height / 2);
await page.mouse.down();
await page.mouse.move(rowBox.x + 40, rowBox.y + rowBox.height / 2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(900);
const snoozeBtn = page.locator('[data-testid^="task-row-"] button', { hasText: /tomorrow/i });
const snoozeCall = await page.evaluate(() =>
  (window.__DOS_FIXTURE_CALLS || []).find((c) => c.method === 'PATCH' && /\/tasks\//.test(c.url)) || null);
check('swiping a row still reveals push-to-tomorrow',
  (await snoozeBtn.count()) > 0 || snoozeCall !== null,
  snoozeCall ? JSON.stringify(snoozeCall.body) : `${await snoozeBtn.count()} action(s) revealed`);

// Per-group See all expands only its own group.
// Reload first: the swipe above leaves a row mid-translate, and a scroll-locked
// body from that state makes Playwright's click hit-test fail on a button it can
// see perfectly well.
await page.goto(`${BASE}/my-work?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="mywork-list"]', { timeout: 12000 });
await page.waitForTimeout(1400);
const seeAll = page.locator('[data-testid$="-see-all"]').first();
if (await seeAll.count()) {
  const owner = (await seeAll.getAttribute('data-testid')).replace('-see-all', '');
  const before = await page.locator(`[data-testid^="${owner}-row-"]`).count();
  const otherIds = groupIds.filter((g) => g !== owner);
  const otherBefore = otherIds.length
    ? await page.locator(`[data-testid^="${otherIds[0]}-row-"]`).count() : 0;
  await seeAll.scrollIntoViewIfNeeded().catch(() => {});
  await seeAll.evaluate((el) => el.click());
  await page.waitForTimeout(700);
  const after = await page.locator(`[data-testid^="${owner}-row-"]`).count();
  const otherAfter = otherIds.length
    ? await page.locator(`[data-testid^="${otherIds[0]}-row-"]`).count() : 0;
  check('"See all" expands its own group', after > before, `${before} -> ${after}`);
  check('"See all" leaves the other groups alone', otherBefore === otherAfter,
    `${otherBefore} -> ${otherAfter}`);
}

// The sparse state must still group correctly rather than dumping everything in
// one bucket — the buckets are the whole point of the tab.
await page.goto(`${BASE}/my-work?fixture=sparse`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="mywork-list"]', { timeout: 12000 });
await page.waitForTimeout(1200);
const sparseGroups = await page.locator('[data-block="queue"] h2').allInnerTexts();
check('sparse data still lands in named buckets', sparseGroups.length >= 1,
  sparseGroups.map((l) => l.replace(/\s+/g, ' ')).join(' | '));
check('an empty bucket does not render a heading with 0',
  !sparseGroups.some((l) => /\b0\b/.test(l)), sparseGroups.join(' | '));

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

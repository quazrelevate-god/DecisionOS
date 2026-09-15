#!/usr/bin/env node
/**
 * ASK-33 Phase 4 verification — the phone's Dex sheet shows what a decision
 * capture came to.
 *
 * REWRITTEN. This file used to verify MPWA-12e's DexSheet: a 64px mic, contextual
 * chips, a recording stage and an "understanding" stage with Looks right / Fix.
 * DexSheet was removed from Layout in 97c2bfc (KM-23) and is not mounted, so the
 * old run waited for a `dex-sheet` that never appears and crashed on its first
 * open. The live sheet is DexChat — a transcript — and on the phone a decision is
 * captured in the Desk's Dex well, which hands what it sent to that sheet.
 *
 * At 390x844 and 360x640, against the fixtures:
 *   A  speak into the well (Chromium's fake audio device), read the words back,
 *      send: the sheet opens on Decide and the READY ending lands as a message —
 *      the 5.1 line, the echo, Review — and Review opens DecisionDialog
 *   B  type, NOTHING TO DECIDE: Dex's answer, one way out, not an error
 *   C  attach a file, AI-consent FAILURE: the reason untruncated, the Settings
 *      link, Retry re-sends that capture and a new ending arrives
 *   D  endings that land after the sheet is closed: READY is a toast that goes
 *      away; FAILED is a notice docked above the dock that stays, with Retry and
 *      Dismiss, never over the dock or the FAB, and moves into the sheet's flow
 *      while the sheet is open (ASK-33 Phase 5)
 *   E  one note at a time: a second capture sent while the sheet is still
 *      reading the first is kept by the well, and both endings are reported
 *   F  the guard: when nothing takes the hand-off, the well keeps the capture —
 *      it polls the note itself and reports the ending
 *
 * The fixtures walk a note queued -> transcribing -> structuring -> done, and
 * sessionStorage "dos_fixture_capture" (nothing | consent | failed) picks the
 * ending (src/fixtures/mobile/_shared.js) — no LLM call is spent per run.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const READY = /^Decision ready for Sunita Rao · 2 tasks, 1 workflow$/;
const CONSENT = 'AI is off for this company — turn on AI consent in Settings';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};
const clip = (s, n = 80) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const until = async (fn, timeout = 25000, step = 250) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, step));
  }
};

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function open(viewport, { blockHandoff = false } = {}) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, permissions: ['microphone'] });
  if (blockHandoff) {
    // Heard first (capture, registered before the app's own listener), so
    // nothing takes the hand-off — as if the sheet could not.
    await ctx.addInitScript(() => {
      window.addEventListener('dos:open-dex', (e) => {
        if (e.detail?.channel === 'decide') e.stopImmediatePropagation();
      }, true);
    });
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  const signedIn = await signIn(page, BASE);
  await gotoDesk(page);
  return { ctx, page, errors, signedIn };
}

async function gotoDesk(page) {
  await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('desk-insight').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
}

const setEnding = (page, v) => page.evaluate((x) => {
  if (x) sessionStorage.setItem('dos_fixture_capture', x);
  else sessionStorage.removeItem('dos_fixture_capture');
}, v);
const sheet = (page) => page.getByTestId('dex-chat');
const toasts = (page, text) => page.locator('[data-sonner-toast]').filter({ hasText: text });
const sheetGone = (page) => until(async () => (await sheet(page).count()) === 0, 3000);

/** Type into the well and press Enter, switching it to typing first if needed. */
async function typeAndSend(page, words) {
  const composer = page.getByTestId('desk-dex-composer');
  if ((await composer.getAttribute('data-mode')) !== 'type') {
    await page.getByTestId('desk-dex-plus').click();
    await page.waitForTimeout(300);
    await page.getByTestId('desk-dex-mode').click();
    await page.waitForTimeout(300);
  }
  const input = composer.locator('textarea');
  await input.fill(words);
  await input.press('Enter');
}

async function closeSheet(page) {
  await page.getByTestId('dex-chat-close').click();
  return sheetGone(page);
}

async function run(viewport) {
  const w = `${viewport.width}`;
  const { ctx, page, errors, signedIn } = await open(viewport);
  check(`${w}: signed in`, signedIn);
  const well = page.getByTestId('desk-insight');
  const wellRest = await well.boundingBox();

  // ------------------------------------------------------------ A · READY
  await setEnding(page, null);
  const mic = page.getByTestId('desk-dex-mic');
  await mic.click();
  await page.waitForTimeout(1500);
  check(`${w} A: the well records`, (await mic.getAttribute('data-intent')) === 'stop');
  await mic.click();
  const field = page.getByTestId('desk-dex-composer').locator('textarea');
  await until(async () => (await field.inputValue()).length > 0, 20000);
  const said = await field.inputValue().catch(() => '');
  check(`${w} A: the words come back into the well to be read first`, said.length > 0, clip(said, 60));
  await mic.click();
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} A: sending from the well opens the Dex sheet`, await sheet(page).isVisible().catch(() => false));
  check(`${w} A: the sheet says it is Decide`,
    (await sheet(page).locator('span.rounded-pill', { hasText: /^decide$/i }).count()) === 1);
  check(`${w} A: what was said is in the transcript`, (await sheet(page).textContent()).includes(said.slice(0, 24)));
  const ready = sheet(page).getByTestId('dex-outcome-ready');
  await ready.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${w} A: the READY ending lands as a message`, await ready.isVisible().catch(() => false));
  const headline = clip(await ready.locator('p').first().textContent().catch(() => ''), 120);
  check(`${w} A: it leads with the 5.1 line`, READY.test(headline), headline);
  const readyText = clip(await ready.textContent().catch(() => ''), 400);
  check(`${w} A: the echo says what it became`,
    /Ship the indigo lot to Tirupur before Friday/.test(readyText) && /Nothing is created until it's approved/.test(readyText),
    readyText.slice(0, 90));
  check(`${w} A: nothing is toasted while the sheet shows it`, (await page.locator('[data-sonner-toast]').count()) === 0);
  const wellNow = await well.boundingBox();
  check(`${w} A: the well stays at rest (no desktop expansion)`, Math.round(wellNow.height) === Math.round(wellRest.height),
    `${Math.round(wellRest.height)} -> ${Math.round(wellNow.height)}`);
  check(`${w} A: the field is clear for the next one`, (await field.inputValue().catch(() => '')) === '');
  const rb = await ready.boundingBox();
  check(`${w} A: the ending sits inside the screen`, !!rb && rb.x >= 0 && rb.x + rb.width <= viewport.width,
    rb ? `${Math.round(rb.x)}..${Math.round(rb.x + rb.width)}` : 'no box');
  await ready.getByTestId('dex-outcome-review').click();
  await page.getByTestId('decision-dialog').waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} A: Review closes the sheet`, await sheetGone(page));
  check(`${w} A: … and opens the decision in DecisionDialog`,
    await page.getByTestId('decision-dialog').isVisible().catch(() => false)
      && new URL(page.url()).searchParams.get('decision') === 'dec_fixture',
    new URL(page.url()).search);
  await page.getByTestId('decision-close').click().catch(() => {});
  await until(async () => (await page.getByTestId('decision-dialog').count()) === 0, 5000);
  await page.waitForTimeout(500);

  // ---------------------------------------------------- B · NOTHING TO DECIDE
  await setEnding(page, 'nothing');
  await typeAndSend(page, 'How much profit did we make this month?');
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  const nothing = sheet(page).getByTestId('dex-outcome-nothing');
  await nothing.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${w} B: NOTHING TO DECIDE lands as a message`, await nothing.isVisible().catch(() => false));
  const nothingText = clip(await nothing.textContent().catch(() => ''), 200);
  check(`${w} B: Dex's answer is shown`, /Nothing to decide in that/.test(nothingText) && /question, not a decision/.test(nothingText), nothingText.slice(0, 90));
  check(`${w} B: exactly one way out`, (await nothing.getByRole('button').count()) === 1);
  check(`${w} B: not styled as an error`,
    (await nothing.getAttribute('role')) !== 'alert' && (await nothing.locator('svg').count()) === 0);
  await nothing.getByTestId('dex-outcome-dismiss').click();
  check(`${w} B: the way out closes the sheet`, await sheetGone(page));

  // ------------------------------------------- C · FAILED, with a file attached
  await setEnding(page, 'consent');
  await page.getByTestId('desk-dex-plus').click();
  await page.waitForTimeout(300);
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.getByTestId('desk-dex-attach').click(),
  ]);
  await chooser.setFiles({ name: 'indigo-po.png', mimeType: 'image/png', buffer: PNG });
  const chips = well.locator('ul[aria-label="Attached files"] li');
  await chips.first().waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} C: the file is attached in the well`, (await chips.count()) === 1);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} C: the file goes with the capture`, (await chips.count()) === 0);
  const failed = sheet(page).getByTestId('dex-outcome-failed');
  await failed.first().waitFor({ timeout: 25000 }).catch(() => {});
  check(`${w} C: the FAILED ending lands as a message`, await failed.first().isVisible().catch(() => false));
  check(`${w} C: it is announced`, (await failed.first().getAttribute('role')) === 'alert');
  const reason = failed.first().getByTestId('dex-outcome-reason');
  check(`${w} C: the consent reason, in the Desk well's words`, (await reason.textContent().catch(() => '')) === CONSENT,
    clip(await reason.textContent().catch(() => '')));
  const whole = await reason.evaluate((el) => el.scrollWidth <= el.clientWidth + 1
    && el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).textOverflow !== 'ellipsis').catch(() => false);
  check(`${w} C: the reason is not truncated`, whole);
  check(`${w} C: it links to Settings`,
    (await failed.first().getByTestId('dex-outcome-settings').getAttribute('href').catch(() => '')) === '/settings#ai-consent');
  await failed.first().getByTestId('dex-outcome-retry').click();
  check(`${w} C: Retry re-sends without asking to say it again`,
    await until(async () => (await sheet(page).getByText('Reading it again…').count()) > 0, 5000));
  check(`${w} C: the retried ending stops offering Retry`,
    (await failed.first().getByTestId('dex-outcome-retry').count()) === 0);
  check(`${w} C: the re-sent capture reaches its own ending`,
    await until(async () => (await failed.count()) === 2));
  await failed.last().getByTestId('dex-outcome-settings').click();
  check(`${w} C: the Settings link leaves the sheet for Settings`,
    (await sheetGone(page)) && new URL(page.url()).pathname === '/settings', new URL(page.url()).pathname);
  await gotoDesk(page);

  // ------------------------------------- D · endings after the sheet is closed
  await setEnding(page, null);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} D: the sheet can be closed before the note ends`, await closeSheet(page));
  const readyToast = toasts(page, 'Decision ready for Sunita Rao');
  check(`${w} D: a READY ending that lands after closing is toasted`, await until(async () => (await readyToast.count()) === 1));
  // Sonner marks both buttons data-button; the action is data-action, the cancel data-cancel.
  check(`${w} D: … with Review`, (await readyToast.first().locator('[data-action]').textContent().catch(() => '')) === 'Review');
  check(`${w} D: … and it goes away on its own`, await until(async () => (await readyToast.count()) === 0, 12000));

  await setEnding(page, 'failed');
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  await closeSheet(page);
  // Phase 5 — a failure is not a toast: a notice docked above the dock.
  const notice = page.getByTestId('dex-failure-notice');
  check(`${w} D: a FAILED ending that lands after closing is a notice`, await until(async () => (await notice.count()) === 1));
  check(`${w} D: … with the reason`, /structuring service did not answer/.test(await notice.textContent().catch(() => '')),
    clip(await notice.textContent().catch(() => '')));
  check(`${w} D: … Retry and Dismiss`,
    (await notice.getByTestId('dex-failure-retry').count()) === 1 && (await notice.getByTestId('dex-failure-dismiss').count()) === 1);
  check(`${w} D: … and no toast for it`, (await toasts(page, "That didn't go through").count()) === 0);
  await page.waitForTimeout(9000);
  check(`${w} D: … and it stays until dismissed`, (await notice.count()) === 1);
  const nb = await notice.boundingBox();
  const dockBox = await page.getByTestId('floating-dock').boundingBox();
  const fabBox = await page.getByTestId('dex-fab').boundingBox();
  check(`${w} D: … above the dock and the FAB, never over them`,
    !!nb && nb.y + nb.height <= Math.min(dockBox.y, fabBox.y),
    nb ? `notice ends ${Math.round(nb.y + nb.height)} · dock ${Math.round(dockBox.y)} · FAB ${Math.round(fabBox.y)}` : 'no box');
  const clearance = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-app-scroller]')).paddingBottom));
  check(`${w} D: … and the page gains its height as scroll clearance`, !!nb && clearance >= 120 + nb.height,
    `padding-bottom ${Math.round(clearance)} for a ${Math.round(nb?.height || 0)}px notice`);
  await page.getByTestId('dex-fab').click();
  await sheet(page).waitFor({ timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(500);
  const inline = sheet(page).getByTestId('dex-failure-notice');
  const ib = await inline.boundingBox();
  const plusBox = await page.getByTestId('dex-plus').boundingBox();
  check(`${w} D: … and the failure is not shown twice there`,
    (await sheet(page).getByTestId('dex-outcome-failed').count()) === 0 && (await sheet(page).getByTestId('dex-failure-notice').count()) === 1);
  check(`${w} D: with the sheet open it sits in the sheet's flow, clear of the plus`,
    (await page.locator('[data-testid="dex-failure-notice"][data-placement="dock"]').count()) === 0
      && !!ib && !!plusBox && ib.y + ib.height <= plusBox.y,
    ib && plusBox ? `notice ends ${Math.round(ib.y + ib.height)} · plus ${Math.round(plusBox.y)}` : 'no box');
  await closeSheet(page);
  await notice.getByTestId('dex-failure-retry').click();
  const retried = await until(async () => (await notice.count()) === 0, 4000);
  check(`${w} D: Retry from the notice re-sends it, and its ending is reported again`,
    retried && (await until(async () => (await notice.count()) === 1)) && (await sheet(page).count()) === 0);
  await notice.getByTestId('dex-failure-dismiss').click().catch(() => {});
  check(`${w} D: Dismiss clears it`, await until(async () => (await notice.count()) === 0, 4000));
  const settled = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-app-scroller]')).paddingBottom));
  check(`${w} D: … and gives the clearance back`, settled < clearance, `${Math.round(clearance)} -> ${Math.round(settled)}`);

  // --------------------------------------------------- E · one note at a time
  await setEnding(page, null);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  await closeSheet(page);
  await typeAndSend(page, 'Ask Priya to book the Tirupur truck for Thursday');
  await page.waitForTimeout(1000);
  check(`${w} E: a second capture while the sheet still reads the first is not taken over it`, (await sheet(page).count()) === 0);
  check(`${w} E: both endings are reported`,
    await until(async () => (await toasts(page, 'Decision ready for Sunita Rao').count()) >= 2));

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${w}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
  check(`${w}: no page errors`, errors.length === 0, errors[0] || '');
  await ctx.close();

  // ------------------------------------------------------------- F · the guard
  const g = await open(viewport, { blockHandoff: true });
  await setEnding(g.page, null);
  await typeAndSend(g.page, 'Tell Suresh to ship the indigo lot before Friday');
  await g.page.waitForTimeout(1500);
  check(`${w} F: nothing took the hand-off, so no sheet`, (await sheet(g.page).count()) === 0);
  check(`${w} F: the well kept polling and reported the ending`,
    await until(async () => (await toasts(g.page, 'Decision ready for Sunita Rao').count()) === 1));
  await until(async () => (await toasts(g.page, 'Decision ready').count()) === 0, 12000);
  await setEnding(g.page, 'failed');
  await typeAndSend(g.page, 'Tell Suresh to ship the indigo lot before Friday');
  const kept = g.page.getByTestId('dex-failure-notice');
  check(`${w} F: a failure the well kept is reported too`, await until(async () => (await kept.count()) === 1));
  await g.page.waitForTimeout(9000);
  check(`${w} F: … and it stays until dismissed`, (await kept.count()) === 1);
  check(`${w} F: no page errors`, g.errors.length === 0, g.errors[0] || '');
  await g.ctx.close();
}

await run({ width: 390, height: 844 });
await run({ width: 360, height: 640 });
await browser.close();

const failedChecks = results.filter((r) => !r.pass);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
if (failedChecks.length) {
  console.log('\nfailed:');
  for (const f of failedChecks) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failedChecks.length ? 1 : 0);

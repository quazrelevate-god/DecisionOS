#!/usr/bin/env node
/**
 * PILOT-2 A verification — the Desk's Dex capture happens in ONE pop-up.
 *
 * REWRITTEN A THIRD TIME, and the reason is still the point of the file. The
 * last cut verified ASK-35 G2 / ASK-47: the well itself became the workspace —
 * the forge inside it, the ending inside it, the actions pinned inside it. The
 * pilot client's voice note moved all of that into a pop-up (step 1 what you
 * said, step 2 Dex reading it, step 3 what Dex made), and the well went back to
 * being the door. Every check that asserted "the ending lands in the well"
 * would now fail for being right, so they are gone; the rules they protected —
 * the well never moves, one capture at a time, the sheet is Ask-only, a
 * failure says why and offers Retry — are asserted against the pop-up instead.
 *
 * At 1440x950, 390x844 and 360x640, against the fixtures:
 *   A  speak into the well (Chromium's fake audio device), stop: the pop-up
 *      opens on STEP 1 with the whole transcript (a long one) in a real field,
 *      the well's pill never holds it; Next: STEP 2 in the same pop-up — the
 *      forge, with the stages on desktop and alone on a phone; then STEP 3 with
 *      no extra press — the counts, DecisionDialog's breakdown under them, and
 *      Approve / Save as draft / Reject pinned at the foot and on screen.
 *      Approve issues it; Done gives the well back.
 *   B  type, NOTHING TO DECIDE: a typed capture skips step 1, and the ending is
 *      the pop-up's last step — Dex's answer, one way out, not an error
 *   C  attach a file, AI-consent FAILURE: the file goes with the capture; the
 *      reason untruncated, the Settings link at the touch floor, Retry reads it
 *      again in the same pop-up
 *   D  every way out (Got it, Not now, Save as draft, Done) gives the well back
 *      to the ripple, and the well is the same box throughout
 *   E  closing the pop-up while Dex reads cancels nothing: the well says it is
 *      still reading, a second capture is refused in plain words (ASK-33.1),
 *      the first still reaches its ending, and the pop-up opens again on it
 *   G  closed on step 1, the words are KEPT: the well offers them back (never
 *      in its pill), they survive a reload, Open brings step 1 back, Discard
 *      lets them go
 *   F  THE SHEET IS ASK-ONLY: no decide path opens it; the FAB still opens it
 *
 * The fixtures walk a note queued -> transcribing -> structuring -> done;
 * sessionStorage "dos_fixture_capture" (nothing | consent | failed) picks the
 * ending and "dos_fixture_transcript" what the recording said
 * (src/fixtures/mobile/_shared.js) — no LLM call is spent per run.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const READY = /^Decision ready for Sunita Rao · 2 tasks, 1 workflow$/;
const CONSENT = 'AI is off for this company — an owner has to turn on AI consent before Dex can read anything';
const LONG = 'Okay, so this is about the Ashok Pumps order. Suresh, ship the indigo lot to Ashok Pumps before Friday, and make sure the packing is double-layered, because last time two cartons came back damaged. Deepa, call Ashok Pumps tomorrow morning and tell them the revised dispatch date, and also ask them to clear the pending payment of two lakh forty thousand before we send the next lot. Murugan, the press brake needs servicing on Monday; book the technician from Coimbatore Hydraulics and keep the old die ready for inspection. Karthik, raise a purchase order for two tonnes of steel sheet from Sri Lakshmi Steels, but only if they match last month\'s rate, otherwise hold it and tell me. I want a meeting with Suresh and Deepa on Thursday at eleven to review all the pending dispatches for October. Also approve forty-two thousand rupees for the courier charges on this shipment, and put a reminder for me to check the Ashok Pumps payment next Wednesday. If the payment doesn\'t come in by then, we stop further dispatches to them until it is cleared. That\'s all for now.';
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

async function open(viewport) {
  const phone = viewport.width < 1024;
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'], ...(phone ? { isMobile: true, hasTouch: true } : {}) });
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
const setSaid = (page, v) => page.evaluate((x) => sessionStorage.setItem('dos_fixture_transcript', x), v);
const sheet = (page) => page.getByTestId('dex-chat');
const popup = (page) => page.getByTestId('dex-popup');
const stepOf = (page) => popup(page).getAttribute('data-step').catch(() => null);
const atStep = (page, s, t = 25000) => until(async () => (await stepOf(page)) === s, t);
const popupGone = (page, t = 4000) => until(async () => (await popup(page).count()) === 0, t);
const toasts = (page, text) => page.locator('[data-sonner-toast]').filter({ hasText: text });

/* The field is behind a door (ASK-47): the keyboard circle opens it. */
async function openField(page) {
  if ((await page.getByTestId('desk-dex-composer').count()) === 0) {
    await page.getByTestId('desk-dex-keyboard').click();
    await page.getByTestId('desk-dex-composer').waitFor({ timeout: 4000 });
  }
  return page.getByTestId('desk-dex-composer').locator('textarea');
}
async function typeAndSend(page, words) {
  const input = await openField(page);
  await input.fill(words);
  await input.press('Enter');
}

/* The well's box, in CSS px. PILOT-2 A — the well is the door and nothing
   else, so the assertion across every step is that nothing about it moves. */
const geometry = (page) => page.evaluate(() => {
  const T = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const well = document.querySelector('[data-testid="desk-insight"]');
  const box = well.getBoundingClientRect();
  return {
    wellTop: Math.round(box.top), wellHeight: Math.round(box.height),
    boardTop: T('[data-testid="desk-board"]'),
    floorTop: T('[data-testid="desk-dex-keyboard"]'),
    ripple: !!document.querySelector('[data-testid="desk-dex-ripple"]'),
  };
});
const sameBox = (a, b) => a.wellTop === b.wellTop && a.wellHeight === b.wellHeight && a.floorTop === b.floorTop;

/** MPWA-01 §5.1 / ASK-43 — every control in `testid` is a 44px target in the
 *  app's own pixels, and is whole, on the glass and uncovered (the point in its
 *  middle IS it). */
const touchAndFold = (page, testid, viewport) => page.evaluate(([t, vh]) => {
  const el = document.querySelector(`[data-testid="${t}"]`);
  if (!el) return false;
  const btns = [...el.querySelectorAll('button,a')];
  return btns.length > 0 && btns.every((b) => {
    if (b.offsetHeight < 44) return false;
    const r = b.getBoundingClientRect();
    if (r.bottom > vh || r.top < 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (b === hit || b.contains(hit));
  });
}, [testid, viewport.height]);
const onGlass = (page, testid, viewport) => page.evaluate(([t, vh]) => {
  const b = document.querySelector(`[data-testid="${t}"]`);
  if (!b || b.offsetHeight < 44) return false;
  const r = b.getBoundingClientRect();
  if (r.bottom > vh || r.top < 0) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (b === hit || b.contains(hit));
}, [testid, viewport.height]);

async function run(viewport) {
  const w = `${viewport.width}`;
  const phone = viewport.width < 1024;
  const { ctx, page, errors, signedIn } = await open(viewport);
  check(`${w}: signed in`, signedIn);
  const mic = page.getByTestId('voice-ripple-mic');
  const rest = await geometry(page);
  check(`${w}: the well opens on the ripple, not a form`, rest.ripple === true);

  // ----------------------------------------------- A · SPOKEN, READY, APPROVED
  await setEnding(page, null);
  await setSaid(page, LONG);
  await mic.click();
  await page.waitForTimeout(1500);
  check(`${w} A: the ripple records`, (await mic.getAttribute('aria-pressed')) === 'true');
  await mic.click();
  check(`${w} A: stopping opens the pop-up on step 1`, await atStep(page, 'said', 4000));
  const field = page.getByTestId('dex-popup-transcript');
  await until(async () => (await field.inputValue()).length > 100, 20000);
  const said = await field.inputValue().catch(() => '');
  check(`${w} A: the whole transcript is in it`, said === LONG, `${said.split(/\s+/).filter(Boolean).length} words`);
  check(`${w} A: … and the well's pill does not hold it`, (await page.getByTestId('desk-dex-composer').count()) === 0);
  const room = await field.evaluate((el) => {
    const cs = getComputedStyle(el);
    return Math.floor((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight));
  });
  check(`${w} A: the field has room for six lines at least`, room >= 6, `${room} lines`);
  check(`${w} A: it can be edited`, !(await field.evaluate((el) => el.readOnly || el.disabled)));
  check(`${w} A: Next, Discard and close are whole and in reach`,
    await onGlass(page, 'dex-popup-next', viewport) && await onGlass(page, 'dex-popup-discard', viewport) && await onGlass(page, 'dex-popup-close', viewport));
  const at1 = await geometry(page);
  check(`${w} A: the well has not moved`, sameBox(at1, rest), `${rest.wellTop}/${rest.wellHeight} -> ${at1.wellTop}/${at1.wellHeight}`);

  await page.getByTestId('dex-popup-next').click();
  check(`${w} A: Next goes to step 2 in the same pop-up`, await atStep(page, 'reading', 4000) && (await popup(page).count()) === 1);
  check(`${w} A: … and the Dex sheet does NOT open`, (await sheet(page).count()) === 0);
  const reading = await page.evaluate(() => ({
    forge: !!document.querySelector('[data-testid="dex-popup"] [data-testid="desk-dex-forge"]'),
    stages: !!document.querySelector('[data-testid="dex-popup"] [aria-label="What Dex is doing"]'),
    quote: !!document.querySelector('[data-testid="dex-popup-sent"]'),
  }));
  check(`${w} A: while it reads, the forge is drawn`, reading.forge);
  check(phone ? `${w} A: … alone, on a phone` : `${w} A: … with the stages and what was said beside it`,
    phone ? (!reading.stages && !reading.quote) : (reading.stages && reading.quote));

  check(`${w} A: step 3 follows with no extra press`, await atStep(page, 'made', 25000));
  await page.getByTestId('dex-popup-counts').waitFor({ timeout: 10000 }).catch(() => {});
  const headline = clip(await page.getByTestId('desk-dex-summary').textContent().catch(() => ''), 120);
  check(`${w} A: it leads with the 5.1 line`, READY.test(headline), headline);
  const counts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="dex-popup-count-"]')].map((e) => e.dataset.testid.replace('dex-popup-count-', '')));
  check(`${w} A: the counts across the top`, ['decisions', 'tasks'].every((k) => counts.includes(k)), counts.join(', '));
  check(`${w} A: … and directly under them the decision's own breakdown`,
    await page.getByTestId('decision-panel-title').isVisible().catch(() => false)
    && (await page.locator('[data-testid^="decision-timeline-task-"]').count()) === 2
    && (await page.locator('[data-testid^="decision-task-person-"]').count()) === 2);
  check(`${w} A: the counts-only screen and its Review are gone`, (await page.getByTestId('desk-dex-review').count()) === 0);
  check(`${w} A: Approve, Save as draft and Reject are pinned and in reach`,
    await touchAndFold(page, 'decision-panel-actions', viewport)
    && (await page.getByTestId('desk-dex-later').innerText()).trim() === 'Save as draft');
  await page.getByTestId('decision-panel-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  check(`${w} A: … still in reach at the bottom of the breakdown`, await touchAndFold(page, 'decision-panel-actions', viewport));
  check(`${w} A: nothing is toasted while the pop-up shows it`, (await page.locator('[data-sonner-toast]').count()) === 0);
  await page.getByTestId('decision-approve').click();
  check(`${w} A: Approve issues it`, await until(async () => (await toasts(page, 'Approved').count()) > 0, 8000));
  check(`${w} A: … and the foot becomes Done`, await until(async () => (await page.getByTestId('decision-panel-done').count()) === 1, 8000));
  await page.getByTestId('decision-panel-done').click({ timeout: 5000 }).catch(() => page.getByTestId('dex-popup-close').click());
  check(`${w} D: Done gives the well back to the ripple`, await popupGone(page) && (await geometry(page)).ripple === true);
  check(`${w} D: … the same box it has been throughout`, sameBox(await geometry(page), rest));
  await gotoDesk(page);

  // ---------------------------------------------------- B · NOTHING TO DECIDE
  await setEnding(page, 'nothing');
  await typeAndSend(page, 'How much profit did we make this month?');
  check(`${w} B: a typed capture skips step 1`, await atStep(page, 'reading', 4000));
  check(`${w} B: NOTHING TO DECIDE is the pop-up's last step`, await atStep(page, 'nothing'));
  const nothing = page.getByTestId('dex-outcome-nothing');
  const nothingText = clip(await nothing.textContent().catch(() => ''), 200);
  check(`${w} B: Dex's answer is shown`, /question, not a decision/.test(nothingText), nothingText.slice(0, 80));
  check(`${w} B: exactly one way out`,
    (await page.getByTestId('dex-popup-gotit').count()) === 1 && (await page.getByTestId('dex-outcome-retry').count()) === 0);
  check(`${w} B: not styled as an error`, (await nothing.getAttribute('role')) !== 'alert' && (await nothing.locator('svg').count()) === 0);
  check(`${w} B: its control is in reach`, await onGlass(page, 'dex-popup-gotit', viewport));
  await page.getByTestId('dex-popup-gotit').click();
  check(`${w} D: "Got it" gives the well back`, await popupGone(page) && (await geometry(page)).ripple === true);
  check(`${w} D: … unmoved`, sameBox(await geometry(page), rest));

  // ------------------------------------------- C · FAILED, with a file attached
  await setEnding(page, 'consent');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.getByTestId('desk-dex-attach').click(),
  ]);
  await chooser.setFiles({ name: 'indigo-po.png', mimeType: 'image/png', buffer: PNG });
  const chips = page.getByTestId('desk-insight').locator('ul[aria-label="Attached files"] li');
  await chips.first().waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} C: the file is attached in the well`, (await chips.count()) === 1);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await page.waitForTimeout(1200);
  check(`${w} C: the file goes with the capture`, (await chips.count()) === 0);
  check(`${w} C: the FAILED ending is the pop-up's last step`, await atStep(page, 'failed'));
  const failed = page.getByTestId('dex-outcome-failed');
  check(`${w} C: it is announced`, (await failed.getAttribute('role')) === 'alert');
  const reason = page.getByTestId('dex-outcome-reason');
  const reasonText = clip(await reason.textContent().catch(() => ''), 200);
  check(`${w} C: the consent reason, in the Desk's words`, reasonText === CONSENT, reasonText);
  const whole = await reason.evaluate((el) => el.scrollWidth <= el.clientWidth + 1
    && getComputedStyle(el).textOverflow !== 'ellipsis').catch(() => false);
  check(`${w} C: the reason is not truncated`, whole);
  const link = page.getByTestId('dex-outcome-settings');
  check(`${w} C: it links to the AI-consent screen`,
    (await link.getAttribute('href').catch(() => '')) === '/settings?tab=business#ai-consent');
  check(`${w} C: … and that link is a 44px target`, (await link.evaluate((e) => e.offsetHeight).catch(() => 0)) >= 44);
  check(`${w} C: Retry and Not now are in reach`,
    await onGlass(page, 'dex-outcome-retry', viewport) && await onGlass(page, 'dex-popup-notnow', viewport));
  await page.getByTestId('dex-outcome-retry').click();
  check(`${w} C: Retry reads it again, in the same pop-up`, await atStep(page, 'reading', 6000));
  check(`${w} C: the re-sent capture reaches its own ending`, await atStep(page, 'failed'));
  await page.getByTestId('dex-popup-notnow').click();
  check(`${w} D: "Not now" gives the well back too`, await popupGone(page) && (await geometry(page)).ripple === true);
  await gotoDesk(page);

  // ------------------------- E · closing is not cancelling; one note at a time
  await setEnding(page, null);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await atStep(page, 'reading', 4000);
  await page.getByTestId('dex-popup-close').click();
  check(`${w} E: the pop-up closes while Dex reads`, await popupGone(page));
  check(`${w} E: … and the well says it is still reading`,
    (await page.getByTestId('dex-well-status').getAttribute('data-status').catch(() => null)) === 'reading');
  await typeAndSend(page, 'Ask Priya to book the Tirupur truck for Thursday');
  await page.waitForTimeout(800);
  check(`${w} E: a second capture meanwhile is refused in plain words`,
    (await toasts(page, 'Dex is still reading your last one').count()) >= 1 && (await popup(page).count()) === 0);
  check(`${w} E: the first still reaches its ending`,
    await until(async () => (await page.getByTestId('dex-well-status').getAttribute('data-status').catch(() => null)) === 'ready'));
  check(`${w} E: … and says so, since the pop-up was closed`, (await toasts(page, 'Decision ready').count()) >= 1);
  await page.getByTestId('dex-well-status').click();
  check(`${w} E: opening it again shows where it got to`, await atStep(page, 'made', 5000));
  await page.getByTestId('desk-dex-later').click();
  check(`${w} D: Save as draft gives the well back`, await popupGone(page) && (await geometry(page)).ripple === true);
  check(`${w} D: … and marks the decision a draft`,
    (await page.evaluate(() => JSON.parse(localStorage.getItem('dos_deferred_decisions') || '[]'))).includes('dec_fixture'));
  const typed = await openField(page);
  await typed.fill('Ask Priya to book the Tirupur truck for Thursday');
  await typed.press('Enter');
  check(`${w} E: and the next send goes through once it has`, await atStep(page, 'reading', 8000));
  check(`${w} F: no decide path opened the sheet, all run long`, (await sheet(page).count()) === 0);
  await atStep(page, 'made');
  await page.getByTestId('dex-popup-close').click();
  await popupGone(page);

  // ----------------------------------------- G · the words are kept, not lost
  await setSaid(page, LONG);
  await mic.click();
  await page.waitForTimeout(1200);
  await mic.click();
  await atStep(page, 'said', 4000);
  await until(async () => (await field.inputValue()).length > 100, 20000);
  await page.getByTestId('dex-popup-close').click();
  await popupGone(page);
  const note = page.getByTestId('dex-well-draft');
  check(`${w} G: closed on step 1, the well says the words are kept`, await note.isVisible().catch(() => false));
  check(`${w} G: … and offers them back, not in its pill`,
    (await page.getByTestId('dex-well-draft-open').count()) === 1 && (await page.getByTestId('desk-dex-composer').count()) === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('desk-insight').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  check(`${w} G: they survive a reload`, /Kept from before/.test(await note.textContent().catch(() => '')));
  await page.getByTestId('dex-well-draft-open').click();
  check(`${w} G: Open brings step 1 back with them`,
    await atStep(page, 'said', 4000) && (await field.inputValue().catch(() => '')) === LONG);
  await page.getByTestId('dex-popup-discard').click();
  check(`${w} G: Discard lets them go`, await popupGone(page) && (await note.count()) === 0);

  // ------------------------------------------------- F · the sheet is Ask-only
  if (phone) {
    await page.getByTestId('dex-fab').click();
    await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(700);
    check(`${w} F: the FAB still opens the sheet in one tap`, (await sheet(page).count()) === 1);
    check(`${w} F: … and it is ASK`, /\bAsk\b/i.test(await sheet(page).innerText().catch(() => '')),
      clip(await sheet(page).innerText().catch(() => ''), 60));
    await page.getByTestId('dex-chat-close').click();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${w}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
  check(`${w}: no page errors`, errors.length === 0, errors[0] || '');
  await ctx.close();
}

await run({ width: 1440, height: 950 });
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

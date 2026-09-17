#!/usr/bin/env node
/**
 * ASK-35 Group 2 verification — the phone's Dex answers where it was asked.
 *
 * REWRITTEN AGAIN, and the reason is the point of the file. The first cut
 * verified MPWA-12e's DexSheet, which KM-23 had already deleted. The second
 * (ASK-33 Phase 4) verified the HAND-OFF: the Desk's well sent a decision and
 * DexChat showed what it came to. ASK-35 G2 reverses that — the well expands in
 * place on a phone exactly as it does on a desktop — so every check that
 * asserted "sending from the well opens the Dex sheet" was encoding a rule the
 * product no longer has. A gate that tests last week's design is worse than no
 * gate: it fails for being right.
 *
 * At 390x844 and 360x640, against the fixtures:
 *   A  speak into the well (Chromium's fake audio device), read the words back,
 *      send: THE WELL EXPANDS — it grows to the top of the hero, the composer
 *      does not move, the greeting and the KPI strip fade — the stages are
 *      printed while it reads, and the READY ending lands in the workspace with
 *      the 5.1 line and Review, which opens DecisionDialog
 *   B  type, NOTHING TO DECIDE: Dex's answer, one way out, not an error
 *   C  attach a file, AI-consent FAILURE: the reason untruncated, the Settings
 *      link at the phone's touch floor, Retry re-sends that capture
 *   D  the three ways out — Later, Got it, Not now — collapse the workspace back
 *      to its resting height and leave the composer ready for the next capture
 *   E  one capture at a time (ASK-33.1): a second send while the first is still
 *      being read is refused in plain words, the first still reports its ending,
 *      and the next send goes through once it has
 *   F  THE SHEET IS ASK-ONLY NOW: no decide path opens it, and the FAB still
 *      opens it on Ask in one tap
 *
 * The fixtures walk a note queued -> transcribing -> structuring -> done, and
 * sessionStorage "dos_fixture_capture" (nothing | consent | failed) picks the
 * ending (src/fixtures/mobile/_shared.js) — no LLM call is spent per run.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const READY = /^Decision ready for Sunita Rao · 2 tasks, 1 workflow$/;
const CONSENT = 'AI is off for this company — an owner has to turn on AI consent before Dex can read anything';
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

/** Type into the well and press Enter. ASK-33.2 — the field is a text field by
    default: there is no mode to switch into, and no [+] to open first. */
/* ASK-47 — the field is behind a door on a phone: voice is the default and the
   keyboard circle is what opens a place to type. Everything below that used to
   reach straight for the textarea goes through here. */
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

/* The handful of numbers this suite turns on, all in CSS px.
   ASK-47 — the well no longer GROWS, so what these numbers are for has flipped:
   they used to prove the pane reached the top of the hero, and they now prove
   that nothing about the well's box changes between resting, listening,
   working and ended. `floorTop` is the row of controls at its foot — the
   keyboard circle, which is the one control that is always there. */
const geometry = (page) => page.evaluate(() => {
  const T = (s) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const well = document.querySelector('[data-testid="desk-insight"]');
  const box = well.getBoundingClientRect();
  return {
    wellTop: Math.round(box.top), wellHeight: Math.round(box.height),
    boardTop: T('[data-testid="desk-board"]'),
    floorTop: T('[data-testid="desk-dex-keyboard"]'),
    ripple: !!document.querySelector('[data-testid="desk-dex-ripple"]'),
    working: !!document.querySelector('[data-testid="desk-dex-working"]'),
  };
});

/** MPWA-01 §5.1 — every control in an ending is a real target, and none of them
 *  is below the fold on the shortest phone we support. */
/* ASK-43 — THE FLOOR IS MEASURED IN THE APP'S OWN PIXELS, the fold in the
   screen's. The app is CSS-zoomed (hooks/useUiScale: 0.8 on a phone, 1.2 on a
   1920 monitor), so getBoundingClientRect returns VISUAL pixels and offsetHeight
   the element's own. The 44px floor is a design-system rule about the app's own
   pixels — the same number the CSS writes — and at 0.8 the rect made every
   compliant control read as 35 and every check fail. "Stays on screen" is the
   opposite: it is about the glass, so it keeps the rect. One check, two spaces,
   each measured where it means something. */
/* ASK-47 — AND "ON SCREEN" IS ASKED OF THE GLASS, NOT OF THE COORDINATES. The
   well is a fixed box now and an ending is taller than it, so a control can sit
   inside the viewport by its rect and still be scrolled out of sight inside the
   well's own pane — which is exactly what happened to Review and Later, and
   this check passed them. The question a founder asks is "can I see it and can
   I hit it", so that is what is asked here: the point in the middle of the
   control is the control. It catches clipping, covering and the fold at once,
   at every width, 360 included — the well gives an ending the whole box while
   it is showing, so there is no width where the way out is out of reach. */
const touchAndFold = (page, testid, viewport) => page.evaluate(([t, vh]) => {
  const el = document.querySelector(`[data-testid="${t}"]`);
  if (!el) return false;
  return [...el.querySelectorAll('button,a')].every((b) => {
    if (b.offsetHeight < 44) return false;
    const r = b.getBoundingClientRect();
    if (r.bottom > vh || r.top < 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (b === hit || b.contains(hit));
  });
}, [testid, viewport.height]);

async function closeSheet(page) {
  await page.getByTestId('dex-chat-close').click();
  return sheetGone(page);
}

async function run(viewport) {
  const w = `${viewport.width}`;
  const { ctx, page, errors, signedIn } = await open(viewport);
  check(`${w}: signed in`, signedIn);
  const well = page.getByTestId('desk-insight');
  const field = page.getByTestId('desk-dex-composer').locator('textarea');
  // ASK-47 — the microphone IS the ripple at the centre of the well.
  const mic = page.getByTestId('voice-ripple-mic');
  const rest = await geometry(page);
  check(`${w}: the well opens on the ripple, not a form`, rest.ripple === true);

  // ------------------------------------------------------------ A · READY
  await setEnding(page, null);
  await mic.click();
  await page.waitForTimeout(1500);
  check(`${w} A: the ripple records`, (await mic.getAttribute('aria-pressed')) === 'true');
  await mic.click();
  await until(async () => (await page.getByTestId('desk-dex-composer').count()) > 0
    && (await field.inputValue()).length > 0, 20000);
  const said = await field.inputValue().catch(() => '');
  check(`${w} A: the words come back into the well to be read first`, said.length > 0, clip(said, 60));
  /* ASK-47 — and they come back into a field that was not there a moment ago:
     the transcript is one of the three things that open it. */
  check(`${w} A: … in a field the transcript brought with it`,
    (await page.getByTestId('desk-dex-composer').count()) === 1);
  check(`${w} A: … with the circle beside it now offering to send`,
    (await page.getByTestId('desk-dex-keyboard').getAttribute('data-intent')) === 'send');
  await page.getByTestId('desk-dex-keyboard').click();
  await page.waitForTimeout(1600);
  const open1 = await geometry(page);

  /* ASK-47 — THE WELL IS STILL THE WORKSPACE, AND IT NO LONGER MOVES. ASK-35
     grew the pane to the top of the hero; the founder's rearrangement puts a
     card that pops in that half of the screen and makes this half a fixed box.
     So the assertion is the reverse of the one it replaces: sending changes
     what the well SHOWS and nothing about where it is. */
  check(`${w} A: sending leaves the well exactly where it was`,
    open1.wellTop === rest.wellTop && open1.wellHeight === rest.wellHeight,
    `${rest.wellTop}/${rest.wellHeight} -> ${open1.wellTop}/${open1.wellHeight}`);
  check(`${w} A: … and the Dex sheet does NOT open`, (await sheet(page).count()) === 0);
  check(`${w} A: the row of controls does not move`, open1.floorTop === rest.floorTop, `${rest.floorTop} -> ${open1.floorTop}`);
  check(`${w} A: nothing below it shifts`, open1.boardTop === rest.boardTop, `${rest.boardTop} -> ${open1.boardTop}`);

  /* ASK-47 — WHAT IT SHOWS WHILE IT READS IS THE FORGE, alone. The founder:
     "remove everything and just use that dex forge building animating element
     in the center that's it and give the result." So: no quote of what was
     said, no list of stages, and the ripple stands down while it works. */
  check(`${w} A: while it reads, the forge is what it shows`, open1.working === true);
  check(`${w} A: … and the ripple stands down`, open1.ripple === false);
  const stacked = await page.evaluate(() => {
    const fg = document.querySelector('[data-testid="desk-dex-forge"]');
    const body = document.querySelector('[data-testid="desk-dex-working"]');
    if (!fg || !body) return null;
    return { h: fg.offsetHeight, scrolls: body.scrollHeight > body.clientHeight + 1,
      stages: !!document.querySelector('[aria-label="What Dex is doing"]'),
      quote: /[\u201C\u201D]/.test(document.querySelector('[data-testid="desk-insight"]').innerText) };
  });
  const forgeFloor = viewport.width >= 390 ? 72 : 36;
  check(`${w} A: the forge is drawn whole`, !!stacked && stacked.h >= forgeFloor, stacked ? `${stacked.h}px tall` : 'not drawn');
  check(`${w} A: … with no stage list beside it`, !!stacked && stacked.stages === false);
  check(`${w} A: … and nothing quoted back`, !!stacked && stacked.quote === false);
  check(`${w} A: … and the body is not a nested scroller`, !!stacked && stacked.scrolls === false);

  const ready = well.getByTestId('dex-outcome-ready');
  await ready.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${w} A: the READY ending lands in the workspace`, await ready.isVisible().catch(() => false));
  const headline = clip(await ready.getByTestId('desk-dex-summary').textContent().catch(() => ''), 120);
  check(`${w} A: it leads with the 5.1 line`, READY.test(headline), headline);
  check(`${w} A: nothing is toasted while the workspace shows it`, (await page.locator('[data-sonner-toast]').count()) === 0);
  /* ASK-47 — the field is not merely clear, it is gone: sent, the well goes
     back to being an invitation with the ripple in the middle of it. */
  check(`${w} A: the field is put away for the next one`,
    (await page.getByTestId('desk-dex-composer').count()) === 0
    || (await field.inputValue().catch(() => '')) === '');
  check(`${w} A: the ending's controls clear the touch floor and stay on screen`,
    await touchAndFold(page, 'dex-outcome-ready', viewport));
  await ready.getByTestId('desk-dex-review').click();
  await page.getByTestId('decision-dialog').waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} A: Review opens the decision in DecisionDialog`,
    await page.getByTestId('decision-dialog').isVisible().catch(() => false));
  await page.getByTestId('decision-close').click().catch(() => {});
  await until(async () => (await page.getByTestId('decision-dialog').count()) === 0, 5000);
  await gotoDesk(page);

  // ---------------------------------------------------- B · NOTHING TO DECIDE
  await setEnding(page, 'nothing');
  await typeAndSend(page, 'How much profit did we make this month?');
  const nothing = well.getByTestId('dex-outcome-nothing');
  await nothing.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${w} B: NOTHING TO DECIDE lands in the workspace`, await nothing.isVisible().catch(() => false));
  const nothingText = clip(await nothing.textContent().catch(() => ''), 200);
  check(`${w} B: Dex's answer is shown`,
    /Nothing to decide in that/.test(nothingText) && /question, not a decision/.test(nothingText), nothingText.slice(0, 90));
  check(`${w} B: exactly one way out`, (await nothing.getByRole('button').count()) === 1);
  check(`${w} B: not styled as an error`,
    (await nothing.getAttribute('role')) !== 'alert' && (await nothing.locator('svg').count()) === 0);
  check(`${w} B: its control clears the touch floor and stays on screen`,
    await touchAndFold(page, 'dex-outcome-nothing', viewport));

  /* D · the way out puts the well back to the invitation, checked on this
     ending. ASK-47 — there is no height to come back to any more, so what is
     checked is that the ripple returns and the box never moved at all. */
  await nothing.getByRole('button').click();
  check(`${w} D: "Got it" gives the well back to the ripple`,
    await until(async () => (await geometry(page)).ripple === true, 6000));
  check(`${w} D: … and the well is the same box it has been throughout`,
    await until(async () => {
      const g = await geometry(page);
      return g.wellHeight === rest.wellHeight && g.wellTop === rest.wellTop;
    }, 4000), `${rest.wellTop}/${rest.wellHeight}`);
  check(`${w} D: … with the controls still where they were`, (await geometry(page)).floorTop === rest.floorTop);

  // ------------------------------------------- C · FAILED, with a file attached
  await setEnding(page, 'consent');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }),
    page.getByTestId('desk-dex-attach').click(),
  ]);
  await chooser.setFiles({ name: 'indigo-po.png', mimeType: 'image/png', buffer: PNG });
  const chips = well.locator('ul[aria-label="Attached files"] li');
  await chips.first().waitFor({ timeout: 8000 }).catch(() => {});
  check(`${w} C: the file is attached in the well`, (await chips.count()) === 1);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await page.waitForTimeout(1200);
  check(`${w} C: the file goes with the capture`, (await chips.count()) === 0);
  const failed = well.getByTestId('dex-outcome-failed');
  await failed.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${w} C: the FAILED ending lands in the workspace`, await failed.isVisible().catch(() => false));
  check(`${w} C: it is announced`, (await failed.getAttribute('role')) === 'alert');
  const reasonText = clip(await failed.locator('span.break-words').first().textContent().catch(() => ''), 200);
  check(`${w} C: the consent reason, in the Desk well's words`, reasonText === CONSENT, reasonText);
  const whole = await failed.locator('span.break-words').first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1
    && el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).textOverflow !== 'ellipsis').catch(() => false);
  check(`${w} C: the reason is not truncated`, whole);
  const link = failed.getByTestId('dex-outcome-settings');
  check(`${w} C: it links to the AI-consent screen`,
    (await link.getAttribute('href').catch(() => '')) === '/settings?tab=business#ai-consent');
  /* ASK-35 2.6 — it was a 20px line of text; it is a tap target below lg.
     ASK-43 — measured in the app's own pixels, like touchAndFold above. */
  const linkBox = { height: await link.evaluate((e) => e.offsetHeight).catch(() => 0) };
  check(`${w} C: … and that link is a 44px target on a phone`, !!linkBox && linkBox.height >= 44,
    linkBox ? `${Math.round(linkBox.height)}px` : 'no box');
  check(`${w} C: the failure's controls clear the touch floor and stay on screen`,
    await touchAndFold(page, 'dex-outcome-failed', viewport));
  await failed.getByTestId('dex-outcome-retry').click();
  check(`${w} C: Retry re-sends without asking to say it again, and thinks again`,
    await until(async () => (await geometry(page)).working === true, 6000));
  check(`${w} C: the re-sent capture reaches its own ending`,
    await until(async () => (await failed.count()) === 1, 25000));
  await failed.getByRole('button', { name: 'Not now' }).click();
  check(`${w} D: "Not now" gives the well back to the ripple too`,
    await until(async () => (await geometry(page)).ripple === true, 6000));
  await gotoDesk(page);

  // --------------------------------------------------- E · one note at a time
  await setEnding(page, null);
  await typeAndSend(page, 'Tell Suresh to ship the indigo lot before Friday');
  await page.waitForTimeout(1200);
  await typeAndSend(page, 'Ask Priya to book the Tirupur truck for Thursday');
  await page.waitForTimeout(1000);
  /* ASK-33.1 — the second send is REFUSED while Dex is still reading the first.
     It would still reach the pipeline, so its decision would land in the
     Decisions column — but it retires the first note's poll, and a failure has
     nowhere else to land (plan 5.2). */
  check(`${w} E: a second capture while the first is still being read is refused`,
    (await toasts(page, 'Dex is still reading your last one').count()) === 1);
  check(`${w} E: the first capture still reaches its ending`,
    await until(async () => (await well.getByTestId('dex-outcome-ready').count()) === 1));
  await well.getByRole('button', { name: 'Later' }).click();
  check(`${w} D: "Later" gives it back as well`,
    await until(async () => (await geometry(page)).ripple === true, 6000));
  await page.waitForTimeout(800);
  await typeAndSend(page, 'Ask Priya to book the Tirupur truck for Thursday');
  check(`${w} E: and the next send goes through once it has`,
    await until(async () => (await geometry(page)).working === true, 8000));

  // ------------------------------------------------- F · the sheet is Ask-only
  check(`${w} F: no decide path opened the sheet, all run long`, (await sheet(page).count()) === 0);
  await until(async () => (await well.getByTestId('dex-outcome-ready').count()) === 1);
  await well.getByRole('button', { name: 'Later' }).click();
  await page.waitForTimeout(700);
  await page.getByTestId('dex-fab').click();
  await sheet(page).waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  check(`${w} F: the FAB still opens the sheet in one tap`, (await sheet(page).count()) === 1);
  check(`${w} F: … and it is ASK`, /\bAsk\b/i.test(await sheet(page).innerText().catch(() => '')),
    clip(await sheet(page).innerText().catch(() => ''), 60));
  await closeSheet(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${w}: no horizontal overflow`, overflow <= 0, `${overflow}px`);
  check(`${w}: no page errors`, errors.length === 0, errors[0] || '');
  await ctx.close();
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

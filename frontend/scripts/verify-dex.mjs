#!/usr/bin/env node
/**
 * MPWA-14 verification — Dex is a screen, not a sheet.
 *
 * This file used to verify the DexSheet's three states. That sheet is gone: it
 * was a menu offering speak / type / attach, rendered in front of the screen
 * that offers exactly those three, and the dock's centre button now navigates
 * to /brain instead of opening it. What is verified here is the contract that
 * replaced it — one thread, one composer, and none of the duplication the old
 * /brain carried (two text fields, two submit buttons, a three-way tab strip).
 *
 * Still launched with Chromium's fake audio device: the composer's mic uses the
 * same recorder the sheet did, and a mic that silently fails getUserMedia would
 * otherwise look identical to one that works.
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  permissions: ['microphone'],
});
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));

// ───────────────────────────── the dock's centre button
await page.goto(`${BASE}/inbox?fixture=busy`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="floating-dock"]', { timeout: 12000 });
await page.waitForTimeout(600);

check('the retired Dex FAB is gone', (await page.locator('[data-testid="dex-fab"]').count()) === 0);

const dex = await page.locator('[data-testid="dock-dex"]').boundingBox();
const pill = await page.locator('[data-testid="floating-dock"] > div').boundingBox();
check('Dex sits in the dock', !!dex);
check('Dex is horizontally centred in the pill',
  Math.abs((dex.x + dex.width / 2) - (pill.x + pill.width / 2)) <= 2,
  `dex mid ${Math.round(dex.x + dex.width / 2)} vs pill mid ${Math.round(pill.x + pill.width / 2)}`);
check('Dex is raised above the pill', dex.y < pill.y, `dex y ${Math.round(dex.y)} < pill y ${Math.round(pill.y)}`);
check('Dex clears the 56px touch floor', dex.width >= 56 && dex.height >= 56,
  `${Math.round(dex.width)}x${Math.round(dex.height)}`);
check('Dex is labelled for screen readers',
  (await page.locator('[data-testid="dock-dex"]').getAttribute('aria-label')) === 'Dex');

// Two destinations either side of it.
const dockItems = await page.locator('[data-testid^="dock-"]:not([data-testid$="-badge"]):not([data-testid="dock-dex"])').count();
check('four destinations flank Dex', dockItems === 4, `${dockItems} items`);

await page.locator('[data-testid="dock-dex"]').click();
await page.waitForTimeout(900);
check('Dex navigates to /brain, it does not open a sheet',
  new URL(page.url()).pathname === '/brain', `landed on ${new URL(page.url()).pathname}`);
check('no bottom sheet was opened', (await page.locator('[data-testid="dex-sheet"]').count()) === 0);

// ───────────────────────────── the screen itself
await page.waitForSelector('[data-testid="dex-mobile"]', { timeout: 10000 });
await page.waitForTimeout(600);

check('the three-way tab strip is gone', (await page.locator('[data-testid="brain-tabs"]').count()) === 0);

// The defect that motivated the rebuild: one input, one submit.
const inputs = await page.locator('[data-testid="dex-mobile"] input:not([type="file"]), [data-testid="dex-mobile"] textarea').count();
check('exactly one text field on the screen', inputs === 1, `${inputs} field(s)`);

check('the composer offers attach', (await page.locator('[data-testid="dex-attach"]').count()) === 1);
check('the composer offers voice', (await page.locator('[data-testid="dex-mic-record"]').count()) === 1);
check('Send is absent until there is something to send',
  (await page.locator('[data-testid="dex-send"]').count()) === 0);

// Mic and Send share one slot, so a composer never shows two primary buttons.
await page.locator('[data-testid="dex-input"]').fill('What needs my decision today?');
await page.waitForTimeout(300);
check('typing swaps the mic for Send', (await page.locator('[data-testid="dex-send"]').count()) === 1);
check('the mic yields its slot rather than stacking',
  (await page.locator('[data-testid="dex-mic-record"]').count()) === 0);

const send = await page.locator('[data-testid="dex-send"]').boundingBox();
check('Send is not clipped at the right edge', send.x + send.width <= 390,
  `right edge at ${Math.round(send.x + send.width)} of 390`);
check('Send clears the touch floor', send.height >= 40, `${Math.round(send.height)}px`);

await page.locator('[data-testid="dex-input"]').fill('');
await page.waitForTimeout(300);
check('clearing the field restores the mic', (await page.locator('[data-testid="dex-mic-record"]').count()) === 1);

// ───────────────────────────── the empty state
check('the empty state names what Dex is for',
  /ask your company anything/i.test(await page.locator('[data-testid="dex-mobile"]').innerText()));
const rotator = await page.locator('[data-testid="dex-rotator"]').innerText();
check('the rotating line offers a verb and the memory promise',
  /(speak|type|ask|search)/i.test(rotator) && /remembers everything/i.test(rotator), rotator.replace(/\n/g, ' '));
const prompts = await page.locator('[data-testid="dex-prompt"]').count();
check('starter prompts are offered', prompts >= 3, `${prompts} prompts`);

// ───────────────────────────── a turn round-trips
await page.locator('[data-testid="dex-prompt"]').first().click();
await page.waitForSelector('[data-testid="dex-turn-user"]', { timeout: 6000 });
check('tapping a prompt posts a user turn', true);
check('the empty state gives way to the thread',
  (await page.locator('[data-testid="dex-turns"]').count()) === 1);

// /ask may answer or fail (this workspace's AI consent gate returns 502) — what
// must hold either way is that a turn resolves and never strands the thread on
// a spinner.
await page.waitForSelector('[data-testid="dex-turn-dex"]', { timeout: 45000 }).catch(() => {});
check('Dex always answers the turn, success or failure',
  (await page.locator('[data-testid="dex-turn-dex"]').count()) === 1);
check('the thinking indicator is cleared',
  (await page.locator('[data-testid="dex-thinking"]').count()) === 0);
const answer = await page.locator('[data-testid="dex-turn-dex"]').innerText();
check('the answer is never an empty bubble', answer.trim().length > 0, `${answer.trim().length} chars`);
// The failure copy must not promise a retry that cannot work — see DexMobile.
check('failure copy does not promise a futile retry',
  !/please try again/i.test(answer) || !/could not reach/i.test(answer), answer.slice(0, 60));

// ───────────────────────────── the orb actually reacts to audio
// The orb's whole claim is that it moves BECAUSE of the audio, and that is not
// falsifiable from a screenshot — a keyframe loop and a spectrum analyser look
// identical in a still. So drive the engine with a real Web Audio graph
// (oscillator -> MediaStreamDestination -> the same attachStream path a mic
// uses) and assert the metrics track it.
//
// Timing is NOT asserted here. The loopback stream buffers on the order of a
// second, so attack/release measured through it says more about the harness
// than the engine; what is asserted is that the signal reaches the metrics and
// that the frequency bands separate.
const audio = await page.evaluate(async () => {
  const e = window.__dexEngine;
  if (!e) return { ok: false, reason: 'no engine handle' };
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ac = new Ctx();
  const dest = ac.createMediaStreamDestination();
  const gain = ac.createGain(); gain.gain.value = 0.0001; gain.connect(dest);
  const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = 120;
  osc.connect(gain); osc.start();
  const attached = e.attachStream(dest.stream);
  await ac.resume().catch(() => {});
  const settle = async (ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      e.sample(performance.now());
      await new Promise((r) => setTimeout(r, 8));
    }
    return { ...e.metrics };
  };
  await settle(400);
  gain.gain.value = 0.45; osc.frequency.value = 120;
  const low = await settle(1400);
  osc.frequency.value = 5200;
  const high = await settle(1400);
  e.detachSource(); osc.stop(); ac.close();
  return { ok: true, attached, low, high };
});

check('the audio engine is reachable and accepts a stream', audio.ok && audio.attached, audio.reason || '');
if (audio.ok) {
  check('a live signal moves the volume metric off zero', audio.low.volume > 0.05,
    `volume ${audio.low.volume.toFixed(3)}`);
  check('a low tone registers in the low band', audio.low.low > 0.15,
    `low ${audio.low.low.toFixed(3)}`);
  // The regression this guards: bands were plain means, so the 257-bin high
  // band read ~0.01 for a tone that pinned its peak bin at 255, and the
  // sparkle could never fire on speech.
  check('a high tone registers in the high band', audio.high.high > 0.15,
    `high ${audio.high.high.toFixed(3)} (was ~0.01 before the band fix)`);
  check('the high band is quiet for a low tone', audio.low.high < 0.1,
    `high-on-low ${audio.low.high.toFixed(3)}`);
  check('bands are comparable in scale, not width-biased',
    Math.abs(audio.high.high - audio.low.low) < 0.45,
    `low-band ${audio.low.low.toFixed(2)} vs high-band ${audio.high.high.toFixed(2)}`);
}

// ───────────────────────────── the dock is still the way out
check('the dock stays reachable over Dex',
  (await page.locator('[data-testid="floating-dock"]').count()) === 1);
const back = await page.locator('[data-testid="dex-back"]').count();
check('Dex offers a way back', back === 1);

// ───────────────────────────── desktop is untouched
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE}/brain`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
check('desktop /brain keeps its tab strip',
  (await page.locator('[data-testid="brain-tabs"]').count()) === 1);
check('the mobile Dex screen is hidden on desktop',
  (await page.locator('[data-testid="dex-mobile"]').isVisible().catch(() => false)) === false);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

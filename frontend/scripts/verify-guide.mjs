/* verify:guide — every phone in the user guide shows the RIGHT screen, painted,
 * with its ring on the right control (2026-10-13).
 *
 * Written for the founder's report: "the mockup doesn't change when I click a
 * step until I refresh, and on the phone some screens are blank". The cause was
 * the stage phone's two-image swap running twice for cached screens; see
 * public/guide/guide.js setPhone. This walks every chapter the way a reader
 * does, on a computer (cold visit AND warm reload; forwards, backwards,
 * A→B→A, rapid clicks, rapid hovers) and on a phone (every step's own screen,
 * after a fast fling; and after switching from desktop width to phone width),
 * in Chromium and WebKit.
 *
 *   AUDIT_BASE=http://localhost:3000 npm run verify:guide [-- chromium|webkit [desktop|phone|resize]]
 */
import { chromium, webkit } from 'playwright';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const URL = `${BASE}/guide/index.html`;
const engines = { chromium, webkit };
const which = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : ['chromium', 'webkit'];
const views = process.argv[3] ? [process.argv[3]] : ['desktop', 'phone', 'resize'];

/* What a phone shows: the visible image(s), whether painted, and where its ring is
   (as fractions of the screen) so it can be compared with the shot's own box. */
const SHOWN = (phone) => {
  const scr = phone.querySelector('.screen');
  const sr = scr.getBoundingClientRect();
  const imgs = [...scr.querySelectorAll('img')];
  const vis = imgs.filter((i) => parseFloat(getComputedStyle(i).opacity) > 0.5 && i.getAttribute('src'));
  const ring = scr.querySelector('.ring');
  const rr = ring.getBoundingClientRect();
  return {
    imgs: vis.map((i) => ({ shot: (i.getAttribute('src') || '').split('/').pop().replace(/\.webp.*$/, ''), ok: i.complete && i.naturalWidth > 0 })),
    ring: parseFloat(getComputedStyle(ring).opacity) > 0.5 ? [(rr.left - sr.left) / sr.width, (rr.top - sr.top) / sr.height] : null,
  };
};

let failures = 0, checks = 0;
const fail = (m) => { failures++; console.log('  FAIL', m); };

async function verify(p, where, phoneLoc, shot, target, boxes) {
  checks++;
  const s = await phoneLoc.evaluate(SHOWN);
  if (s.imgs.length !== 1) return fail(`${where}: ${s.imgs.length} visible images ${JSON.stringify(s.imgs)} (want ${shot})`);
  if (s.imgs[0].shot !== shot) return fail(`${where}: shows ${s.imgs[0].shot}, want ${shot}`);
  if (!s.imgs[0].ok) return fail(`${where}: ${shot} is blank (not painted)`);
  // The ring must sit on this shot's control (7px pad, 390x844 screen).
  const b = target.split('+').map((k) => boxes[shot]?.[k]).filter(Boolean);
  if (!b.length) return;
  const x = Math.max(7, Math.min(...b.map((v) => v[0]))) - 7, y = Math.max(7, Math.min(...b.map((v) => v[1]))) - 7;
  if (!s.ring) return fail(`${where}: no ring`);
  if (Math.abs(s.ring[0] - x / 390) > 0.03 || Math.abs(s.ring[1] - y / 844) > 0.03) fail(`${where}: ring at ${s.ring.map((v) => v.toFixed(3))}, want ${(x / 390).toFixed(3)},${(y / 844).toFixed(3)}`);
}

for (const eng of which) for (const view of views) {
  const b = await engines[eng].launch();
  const phoneCtx = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: eng === 'chromium', hasTouch: true };
  const ctx = await b.newContext(view === 'phone' ? phoneCtx : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const boxes = (await (await fetch(`${BASE}/guide/shots.json?audit=${Date.now()}`)).json()).shots;
  const chaptersOf = () => p.$$eval('.chapter', (cs) => cs.filter((c) => c.querySelector('.step'))
    .map((c) => ({ id: c.id, steps: [...c.querySelectorAll('.step')].map((s) => ({ shot: s.dataset.shot || '', target: s.dataset.target || '' })) })));

  for (const pass of view === 'desktop' ? ['cold', 'warm reload'] : ['cold']) {
    if (pass === 'cold') await p.goto(URL, { waitUntil: 'domcontentloaded' }); else await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1500);
    if (view === 'resize') { await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600); }
    const chapters = await chaptersOf();
    console.log(`== ${eng} ${view} (${pass}): ${chapters.length} chapters, ${chapters.reduce((a, c) => a + c.steps.length, 0)} steps`);

    if (view === 'desktop') {
      for (const ch of chapters) {
        await p.mouse.move(2, 2);   // park the pointer: hovering a step selects it by design
        await p.click(`.rail a[data-ch="${ch.id}"]`);
        await p.mouse.move(2, 2);
        await p.waitForTimeout(800);
        const stage = p.locator(`#${ch.id} .stage .phone`);
        const at = async (i, where) => { await p.waitForTimeout(450); await verify(p, `${ch.id} ${where}`, stage, ch.steps[i].shot, ch.steps[i].target, boxes); };
        await verify(p, `${ch.id} on arrival`, stage, ch.steps[0].shot, ch.steps[0].target, boxes);
        const n = ch.steps.length;
        const order = [...Array(n).keys(), ...[...Array(n).keys()].reverse()];
        for (let i = 0; i + 1 < n; i++) order.push(i + 1, i, i + 1);
        for (const i of order) { await p.click(`#${ch.id} .step >> nth=${i}`); await at(i, `step ${i + 1}`); }
        // Rapid-fire clicks with no pause, then check where it lands.
        for (let k = 0; k < 3; k++) for (const i of [n - 1, 0, Math.floor(n / 2), n - 1]) await p.click(`#${ch.id} .step >> nth=${i}`, { delay: 0 });
        await p.waitForTimeout(250); await at(n - 1, 'after rapid clicks');
        // Rapid hover across the list, resting on step 1.
        for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) await p.hover(`#${ch.id} .step >> nth=${i}`);
        await p.hover(`#${ch.id} .step >> nth=0`); await at(0, 'after rapid hovering');
      }
    } else {
      // Fling to the bottom first (a fast scroll past everything), then walk every step.
      await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300);
      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
      for (const ch of chapters) {
        for (let i = 0; i < ch.steps.length; i++) {
          const phone = p.locator(`#${ch.id} .step >> nth=${i}`).locator('.step-phone .phone');
          await phone.scrollIntoViewIfNeeded();
          await p.waitForTimeout(300);
          await verify(p, `${ch.id} step ${i + 1}`, phone, ch.steps[i].shot, ch.steps[i].target, boxes);
        }
      }
      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400);
      await verify(p, 'hero', p.locator('.hero-stage .phone'), 'desk', 'dex-slider-handle', boxes);
    }
  }
  if (errs.length) fail(`${eng} ${view}: page errors: ${errs.join(' | ')}`);
  await b.close();
}
console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);

#!/usr/bin/env node
/**
 * MPWA-12i verification — the empty-state sweep (§5.3, §8).
 *
 * §8's acceptance row is "Empty states containing a primary action: 100%", and
 * the audit enforces that structurally. This suite checks the part a structural
 * rule cannot: whether the words are any good, and whether an empty *screen* is
 * composed rather than a card floating in white space.
 *
 * "Same treatment everywhere — a sentence and a button, never a full stop."
 */
import { chromium } from 'playwright';
import { signIn } from './lib/auth.mjs';

const BASE = process.env.AUDIT_BASE || 'http://localhost:3000';
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

// Every mobile route that can be empty. The composed ones are marked: those must
// carry the full stratum set, not just a card.
const ROUTES = [
  { path: '/inbox', composed: true },
  { path: '/inbox?scope=morning', composed: true, explains: true },
  { path: '/my-work', composed: true, explains: true },
  { path: '/my-work?view=leave' },
  { path: '/my-work?view=workflows' },
  { path: '/crm', composed: true, explains: true },
  { path: '/team' },
  { path: '/finance', composed: true, explains: true },
  { path: '/finance?tab=revenue' },
  { path: '/finance?tab=expenses' },
  { path: '/finance?tab=assets' },
  { path: '/finance?tab=inventory' },
  { path: '/finance?tab=inbox' },
  { path: '/calendar' },
  { path: '/notifications' },
  { path: '/journal' },
];

// Words that mean "nothing here" and stop there. §7: "Never a bare 'No data'."
const DEAD_ENDS = [/\bno data\b/i, /\bn\/a\b/i, /^—$/, /\bnothing to show\b/i, /\bempty\b/i];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await ctx.clock.setFixedTime(new Date(`${new Date().toISOString().slice(0, 10)}T09:12:00.000Z`));
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message.split('\n')[0]));

check('signed in', await signIn(page, BASE));

for (const route of ROUTES) {
  const url = `${BASE}${route.path}${route.path.includes('?') ? '&' : '?'}fixture=empty`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const seen = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('[data-testid$="empty-state"], [data-empty-state], [data-empty-screen]')
    );
    return nodes.map((el) => ({
      id: el.getAttribute('data-testid') || 'empty-screen',
      text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      actions: el.querySelectorAll('button, a[href], [role="button"]').length,
      // The claim is not always the first line: a composed empty screen leads
      // with the Verdict's eyebrow ("People"), and the sentence is under it. So
      // collect the lines and let the assertion look for a sentence among them.
      lines: (el.innerText || '').split('\n').map((x) => x.trim()).filter(Boolean),
      first: (el.innerText || '').trim().split('\n')[0].trim(),
    }));
  });

  if (!seen.length) {
    // Not every screen has an empty state to show even in fixture A (a Verdict
    // can say it instead) — that is fine, and the composed check below covers it.
    check(`${route.path} · renders something in the empty state`,
      (await page.evaluate(() => (document.querySelector('main')?.innerText || '').trim().length)) > 40);
  }

  for (const s of seen) {
    check(`${route.path} · ${s.id} offers a primary action`, s.actions > 0,
      s.first.slice(0, 60));
    const sentence = s.lines.find((l) => /[.?!]$/.test(l) && l.split(/\s+/).length >= 3);
    check(`${route.path} · ${s.id} says something, not just a label`,
      !!sentence, (sentence || s.lines.join(' / ')).slice(0, 70));
    check(`${route.path} · ${s.id} is not a dead end`,
      !DEAD_ENDS.some((re) => re.test(sentence || s.first)), (sentence || s.first).slice(0, 60));
  }

  if (route.composed) {
    const blocks = await page.locator('[data-block]').evaluateAll((els) =>
      [...new Set(els.map((e) => e.getAttribute('data-block')))]);
    check(`${route.path} · empty screen is still composed from >= 3 blocks`,
      blocks.length >= 3, blocks.join(', '));
    const prog = await page.locator('[data-progress]').count();
    check(`${route.path} · empty screen keeps exactly one progress element`,
      prog === 1, `${prog}`);
    // §8's white-gap rule, on the screen the founder actually sees first.
    const gap = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return 0;
      const ROW = 8;
      const bandTop = Math.max(0, Math.round(main.getBoundingClientRect().top));
      const rows = Math.floor((844 - bandTop) / ROW);
      const cov = new Array(rows).fill(false);
      const leaves = Array.from(main.querySelectorAll('*')).filter(
        (el) => el.children.length === 0 || /^(P|H1|H2|H3|SPAN|BUTTON|A|LI|IMG|SVG|INPUT|TEXTAREA)$/.test(el.tagName)
      );
      for (const el of leaves) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        for (let i = Math.max(0, Math.floor((r.top - bandTop) / ROW)); i <= Math.min(rows - 1, Math.floor((r.bottom - bandTop) / ROW)); i++) cov[i] = true;
      }
      let run = 0;
      let worst = 0;
      for (const c of cov) { run = c ? 0 : run + 1; worst = Math.max(worst, run); }
      return worst * ROW;
    });
    check(`${route.path} · no white gap over 120px`, gap <= 120, `${gap}px`);
    // Where the strata alone left a gap, the screen explains what will appear —
    // that explanation IS the content that replaced the white space. Screens
    // whose own blocks already fill the viewport do not need one, and adding it
    // for symmetry would be the filler this rule exists to prevent.
    if (route.explains) {
      const lands = await page.locator('[data-testid$="-lands"]').count();
      check(`${route.path} · explains what will land here`, lands >= 1, `${lands} explanation grid(s)`);
    }
  }
}

// A primary action has to be a real target, not decoration.
await page.goto(`${BASE}/crm?fixture=empty`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
const act = page.locator('[data-testid="crm-empty-verdict-action"]');
check('the CRM empty screen has a working primary action', (await act.count()) === 1);
if (await act.count()) {
  const box = await act.boundingBox();
  check('the primary action clears 44px', box.height >= 44, `${Math.round(box.height)}px`);
  await act.click();
  await page.waitForTimeout(900);
  // MPWA-14: the dos:open-dex event used to raise a sheet; Dex is a route now,
  // so "opens Dex" means landing on it with a composer ready.
  check('it opens Dex rather than doing nothing',
    new URL(page.url()).pathname === '/brain'
      && (await page.locator('[data-testid="dex-composer"]').count()) === 1,
    new URL(page.url()).pathname);
}

// And on a screen where Dex cannot help, the action must not pretend it can.
await page.goto(`${BASE}/team?fixture=empty`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1600);
// Fixture A still ships a team (a workspace has an owner), so this state only
// renders on a tenant with nobody in it. Assert it when it is there.
const teamEmpty = page.locator('[data-testid="team-empty"]');
if (await teamEmpty.count()) {
  const teamText = (await teamEmpty.innerText()).replace(/\s+/g, ' ');
  check('the Team empty state does not promise a capability that is not there',
    !/invite/i.test(teamText), teamText.slice(0, 90));
} else {
  check('the Team screen has people to show in fixture A',
    (await page.locator('[data-testid^="team-card-"]').count()) > 0);
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

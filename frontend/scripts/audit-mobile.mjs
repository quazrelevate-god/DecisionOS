#!/usr/bin/env node
/**
 * MPWA-00 — mobile audit harness.
 *
 * Walks every in-scope route (spec §6) at 390×844 and 360×640 and fails on the
 * rules in §5. Also captures a desktop baseline at `lg` (1024) and `xl` (1280)
 * so every later slice can prove it did not move desktop (§9.2).
 *
 *   npm run audit:mobile                      # audit + desktop diff
 *   npm run audit:mobile -- --update-desktop  # (re)capture the desktop baseline
 *   npm run audit:mobile -- --json out.json   # machine-readable report
 *
 * Failing rules are exactly the set §8 MPWA-00 names. Two extra rules run at
 * warn level (horizontal scroll strips, uppercase text) because they are §3/§5
 * laws worth tracking without changing the pass/fail contract.
 *
 * Requires the app on --base-url (default http://localhost:3000). Auth: clicks
 * the Owner demo button on /login when the session is not already live, so this
 * works against a real backend as well as the fixture server.
 */
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : def;
};
const BASE = String(flag('base-url', 'http://localhost:3000')).replace(/\/$/, '');
const UPDATE_DESKTOP = Boolean(flag('update-desktop', false));
const JSON_OUT = flag('json', null);
const ONLY = flag('only', null); // substring filter on route path
const SKIP_MOBILE = Boolean(flag('skip-mobile', false));
const SKIP_DESKTOP = Boolean(flag('skip-desktop', false));
// MPWA-12a/§8: composition checks must run against ALL THREE fixture states.
// `--fixture sparse` audits one; `--fixtures` sweeps empty+sparse+busy. Without
// either, the audit runs against whatever the API actually returns.
const ONE_FIXTURE = flag('fixture', null);
const SWEEP = Boolean(flag('fixtures', false));
// §9.2's desktop diff is a LAYOUT test, so it needs deterministic DATA. Captured
// against whatever the live API happened to hold, every baseline rotted the
// moment the tenant changed — the first run after switching from the fixture
// server to the real backend reported 42 "moved" screens, none of which was a
// layout change. Pinned to a fixture state instead; --desktop-fixture off opts
// back out.
const DESKTOP_FIXTURE = (() => {
  const v = flag('desktop-fixture', 'busy');
  return v === 'off' || v === false ? null : String(v);
})();
const FIXTURE_STATES = SWEEP
  ? ['empty', 'sparse', 'busy']
  : (typeof ONE_FIXTURE === 'string' ? [ONE_FIXTURE] : [null]);
// Frozen page clock, shared with the fixture server's anchor (midnight UTC
// today + 9h12m). Keeps every relative date string — and therefore every
// screenshot — byte-stable across runs. Override with --anchor 2026-08-14.
const ANCHOR_DAY = String(flag('anchor', new Date().toISOString().slice(0, 10)));
const FROZEN_NOW = new Date(`${ANCHOR_DAY}T09:12:00.000Z`);
const BASELINE_DIR = path.join(FRONTEND, '.audit-desktop-baseline');
const ARTIFACT_DIR = path.join(FRONTEND, '.audit-artifacts');

const MOBILE_VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x640', width: 360, height: 640 },
];
const DESKTOP_VIEWPORTS = [
  { name: 'lg-1024', width: 1024, height: 800 },
  { name: 'xl-1280', width: 1280, height: 900 },
];

// In-scope routes, spec §6. Out-of-scope (admin/**, onboarding/**, Landing,
// Signup, Inbox.js at /inbox-legacy, Meetings) deliberately absent.
// `primary: true` marks the screens §3's three laws apply to — the ones a
// founder lives in, assembled from blocks. A detail page (contact 360) or a
// row-list (settings) is not composed and is exempt.
const ROUTES = [
  { path: '/inbox', label: 'Desk · now', primary: true },
  // MPWA-12c: the Brief is a scope of the Desk, so each narrative mode is its
  // own composed screen and carries the §3 L1/L2/L3 rules. /brief stays in the
  // sweep because desktop still renders CEOBrief there and mobile must prove
  // the redirect target is clean.
  { path: '/inbox?scope=morning', label: 'Desk · morning brief', primary: true },
  { path: '/inbox?scope=week', label: 'Desk · this week', primary: true },
  // Epic 2 Sprint 6 (E2-47) + MPWA-12c: /brief is a redirect for every viewport
  // now, so landing elsewhere is the correct behaviour rather than a leak.
  { path: '/brief', label: 'Brief (redirects to the Desk)', redirects: true },
  // { path: '/my-work', label: 'My Work', primary: true },   // retired: renders the desktop tree on mobile
  // { path: '/my-work?view=leave', label: 'My Work · leave' },   // retired: renders the desktop tree on mobile
  // { path: '/my-work?view=workflows', label: 'My Work · workflows' },   // retired: renders the desktop tree on mobile
  { path: '/crm', label: 'CRM', primary: true },
  { path: '/contacts/c_1', label: 'Contact profile' },
  { path: '/team', label: 'Team' },
  { path: '/finance', label: 'Finance · overview', primary: true },
  { path: '/finance?tab=revenue', label: 'Finance · revenue' },
  { path: '/finance?tab=expenses', label: 'Finance · expenses' },
  { path: '/finance?tab=assets', label: 'Finance · assets' },
  { path: '/finance?tab=inventory', label: 'Finance · inventory' },
  { path: '/finance?tab=inbox', label: 'Finance · inbox' },
  { path: '/brain', label: 'Dex' },
  { path: '/calendar', label: 'Calendar' },
  { path: '/notifications', label: 'Notifications' },
  { path: '/settings', label: 'Settings' },
  { path: '/journal', label: 'Journal' },
  // { path: '/operating-score', label: 'Operating Score' },   // retired: renders the desktop tree on mobile
  { path: '/coach', label: 'Work Coach' },
  { path: '/login', label: 'Login', anon: true },
].filter((r) => !ONLY || r.path.includes(String(ONLY)));

const RULES = {
  'touch-target-min-44': { level: 'fail', desc: 'Interactive element under 44px in either dimension (§5.1)' },
  'text-below-13px': { level: 'fail', desc: 'Rendered text below the 13px mobile floor (§3.4)' },
  'horizontal-overflow': { level: 'fail', desc: 'Content clipped at the right edge (§5.2.1)' },
  'native-select-in-scroll': { level: 'fail', desc: 'Native <select> inside a scroll path (§5.2.5)' },
  'screen-over-2500px': { level: 'fail', desc: 'Screen taller than ~2,500px (§5.2.7)' },
  'leaked-system-string': { level: 'fail', desc: 'Env var / table / field / HTTP status on screen (§5.4)' },
  'non-indian-inr-grouping': { level: 'fail', desc: 'Currency not in Indian digit grouping (§5.3)' },
  'runtime-error': { level: 'fail', desc: 'Route threw at runtime (dev-server error overlay present)' },
  // MPWA-12b §3/§8 — composition rules, checked on primary screens only.
  'block-variety': { level: 'fail', desc: 'L1 — fewer than 3 distinct data-block types (§3)' },
  'density-floor': { level: 'fail', desc: 'L2 — first viewport under 85% filled (§3)' },
  'white-gap': { level: 'fail', desc: 'Vertical white gap over 120px (§8)' },
  'progress-element': { level: 'fail', desc: 'L3 — not exactly one data-progress element (§3)' },
  'empty-state-action': { level: 'fail', desc: 'Empty state without a primary action (§8)' },
  'density-note': { level: 'warn', desc: 'First viewport under 85% filled in a state §8 does not gate on (empty/busy)' },
  'horizontal-scroll-strip': { level: 'warn', desc: 'Horizontally scrolling strip — needs fade mask + peeking item (§5.2.2)' },
  'uppercase-text': { level: 'warn', desc: 'text-transform: uppercase (§3.4 forbids uppercase)' },
};

// ---------------------------------------------------------------------------
// In-page rule evaluation. Runs inside the browser; returns plain data.
// ---------------------------------------------------------------------------
/* eslint-disable no-undef */
function collectViolations(opts = {}) {
  const { primary = false, viewportHeight = 844, densityFloor = true } = opts;
  const out = [];
  const MAXTEXT = 90;
  const push = (rule, detail, extra = {}) => out.push({ rule, detail, ...extra });

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().slice(0, 70) : '';
    const tid = el.getAttribute?.('data-testid');
    const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, MAXTEXT);
    return [
      el.tagName.toLowerCase(),
      tid ? `[data-testid="${tid}"]` : '',
      cls ? `.${cls.split(/\s+/).slice(0, 4).join('.')}` : '',
      txt ? ` — “${txt}”` : '',
    ].join('');
  };

  const INTERACTIVE = 'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],[role="menuitem"],[onclick],[tabindex]:not([tabindex="-1"])';

  // ---- 1. touch targets -------------------------------------------------
  const interactives = Array.from(document.querySelectorAll(INTERACTIVE));
  for (const el of interactives) {
    if (!visible(el)) continue;
    // Only leaf targets: a wrapper that contains another interactive is not
    // itself the tap target.
    if (el.querySelector(INTERACTIVE)) continue;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width * 10) / 10;
    const h = Math.round(r.height * 10) / 10;
    if (w < 44 || h < 44) push('touch-target-min-44', `${w}×${h}px — ${describe(el)}`);
  }

  // ---- 2. text size + uppercase ----------------------------------------
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const hasOwnText = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0
    );
    if (!hasOwnText || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 12.999) push('text-below-13px', `${Math.round(fs * 100) / 100}px — ${describe(el)}`);
    if (cs.textTransform === 'uppercase') push('uppercase-text', describe(el));
  }

  // ---- 3. horizontal overflow / scroll strips ---------------------------
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    push('horizontal-overflow', `page scrollWidth ${doc.scrollWidth} > viewport ${doc.clientWidth}`);
  }
  // §5.2.1 is about content *clipped at the right edge* — content he cannot
  // read or reach. Three things overhang a box without ever being clipped:
  //
  //   1. an out-of-flow descendant (a count badge pinned with -top-2 -right-2, a
  //      dropdown, a tooltip) — designed to overhang;
  //   2. a deliberate full-bleed (`-mx-4 px-4` on the Verdict hero) — in flow,
  //      wider than its parent's content box, still inside the box that clips;
  //   3. anything inside a horizontally scrollable strip — reachable by
  //      scrolling, and the strip itself is reported as horizontal-scroll-strip.
  //
  // (3) is why the clipper cannot be found by walking UP from the container: the
  // scope strip's `overflow-x:auto` sits BELOW the Desk's root, so a container
  // holding a 419px-wide chip row read as 29px of clipped content on every Desk
  // route in every state — 40 findings, none of them real.
  //
  // So: per overhanging descendant, walk up to the container. A scrollable
  // ancestor on the way means reachable. Otherwise the nearest hidden/clip
  // ancestor (or the viewport) is what would cut it off.
  const overflowIsHarmless = (el) => {
    let sawOverhang = false;
    const box = el.getBoundingClientRect();
    for (const d of el.querySelectorAll('*')) {
      const r = d.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right <= box.right + 1 && r.left >= box.left - 1) continue;
      sawOverhang = true;

      let node = d.parentElement;
      let outOfFlow = ['absolute', 'fixed'].includes(getComputedStyle(d).position);
      let reachable = false;
      let clipL = 0;
      let clipR = window.innerWidth;
      let seenContainer = false;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (!seenContainer && ['absolute', 'fixed'].includes(cs.position)) outOfFlow = true;
        if (['auto', 'scroll'].includes(cs.overflowX)) { reachable = true; break; }
        if (cs.overflowX !== 'visible') {
          const cr = node.getBoundingClientRect();
          clipL = Math.max(clipL, cr.left);
          clipR = Math.min(clipR, cr.right);
        }
        if (node === el) seenContainer = true;
        node = node.parentElement;
      }
      if (outOfFlow || reachable) continue;
      if (r.right > clipR + 1 || r.left < clipL - 1) return false; // genuinely cut off
    }
    return sawOverhang;
  };

  for (const el of all) {
    if (!visible(el)) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.clientWidth === 0) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll') {
      push('horizontal-scroll-strip', `${el.scrollWidth}>${el.clientWidth} — ${describe(el)}`);
    } else if (ox === 'visible' && !overflowIsHarmless(el)) {
      // visible overflow on a constrained box = content spilling past the edge
      push('horizontal-overflow', `${el.scrollWidth}>${el.clientWidth} (overflow-x:visible) — ${describe(el)}`);
    }
  }

  // ---- 4. native <select> in a scroll path ------------------------------
  const pageScrolls = doc.scrollHeight > doc.clientHeight + 1;
  for (const sel of Array.from(document.querySelectorAll('select'))) {
    if (!visible(sel)) continue;
    let node = sel.parentElement;
    let scrollAncestor = null;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if (['auto', 'scroll'].includes(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) {
        scrollAncestor = node;
        break;
      }
      node = node.parentElement;
    }
    if (scrollAncestor || pageScrolls) {
      push('native-select-in-scroll', `${describe(sel)} (in ${scrollAncestor ? 'scroll container' : 'scrolling page'})`);
    }
  }

  // ---- 5. screen height -------------------------------------------------
  if (doc.scrollHeight > 2500) push('screen-over-2500px', `${doc.scrollHeight}px tall`);

  // ---- 6. leaked system strings ----------------------------------------
  const text = document.body.innerText || '';
  const LEAKS = [
    [/WA_[A-Z0-9_]+/g, 'env var'],
    [/\btenant_id\b/g, 'db field'],
    [/\breviewer_perm\b/g, 'permission key'],
    [/(?<![\d,₹.])403(?![\d,])/g, 'HTTP status'],
    [/\bundefined\b/g, 'undefined'],
    [/\bNaN\b/g, 'NaN'],
  ];
  for (const [re, kind] of LEAKS) {
    const seen = new Set();
    for (const m of text.matchAll(re)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ');
      push('leaked-system-string', `${kind} “${m[0]}” — …${ctx}…`);
    }
  }

  // ---- 7. Indian digit grouping ----------------------------------------
  // Valid: ₹480 · ₹32,000 · ₹4,80,000 · ₹1.84Cr · ₹4.8L
  // Invalid: ₹480,000 · ₹2,200,000
  const seenAmt = new Set();
  for (const m of text.matchAll(/₹\s?(\d[\d,]*)(?!\s?(?:Cr|L\b))/g)) {
    const raw = m[1];
    if (!raw.includes(',') || seenAmt.has(raw)) continue;
    seenAmt.add(raw);
    const parts = raw.split(',');
    const last = parts[parts.length - 1];
    const middles = parts.slice(1, -1);
    const head = parts[0];
    const ok =
      last.length === 3 &&
      middles.every((p) => p.length === 2) &&
      head.length >= 1 && head.length <= 2;
    if (!ok) {
      const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ');
      push('non-indian-inr-grouping', `₹${raw} — …${ctx}…`);
    }
  }

  // ---- 8. MPWA-12b composition rules (§3, §8) ------------------------------
  // Primary screens only: these are laws about how a screen is *composed*, and
  // a detail page or a settings row-list is not composed from blocks.
  if (primary) {
    const main = document.querySelector('main') || document.body;

    // L1 — shape variety
    const blockEls = Array.from(document.querySelectorAll('[data-block]'));
    const types = [...new Set(blockEls.map((b) => b.getAttribute('data-block')))];
    if (types.length < 3) {
      push('block-variety', `${types.length} distinct block type(s): ${types.join(', ') || 'none'}`);
    }

    // L2 — density floor, and the largest white gap.
    // Measured in 8px rows over the first viewport: a row counts as filled if
    // any visible leaf element covers it. Coverage rather than a bounding box,
    // because a tall empty container would otherwise read as "filled".
    //
    // The band starts at the top of <main>, not at y=0. The app bar sits above
    // main and is not composed from blocks, so counting its 72px as "empty"
    // charged every screen a flat 9% (11% at 640px) it could never earn back —
    // which is how a screen that genuinely fills its content area reported 80%.
    const ROW = 8;
    const mainTop = Math.max(0, Math.round(main.getBoundingClientRect().top));
    const bandTop = Math.min(mainTop, viewportHeight - ROW);
    const rows = Math.max(1, Math.floor((viewportHeight - bandTop) / ROW));
    const covered = new Array(rows).fill(false);
    const leaves = Array.from(main.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 || /^(P|H1|H2|H3|SPAN|BUTTON|A|LI|IMG|SVG|INPUT|TEXTAREA)$/.test(el.tagName)
    );
    for (const el of leaves) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const from = Math.max(0, Math.floor((r.top - bandTop) / ROW));
      const to = Math.min(rows - 1, Math.floor((r.bottom - bandTop) / ROW));
      for (let i = from; i <= to; i++) covered[i] = true;
    }
    const inkPct = Math.round((covered.filter(Boolean).length / rows) * 100);

    // §8 asks for "first-viewport CONTENT FILL >= 85%". The first cut measured
    // INK — the union of leaf text and graphics — which is a stricter thing than
    // it says, and unreachable by construction: a screen built from the §3 blocks
    // spends 16-20% of the viewport on the 12px gaps between them and the padding
    // inside them. Five separately-composed screens all measured 79-84%, and the
    // only way past that is to shrink the design system's breathing room or add
    // filler. Both are worse than reading the rule as written.
    //
    // So: fill is the fraction of the band a CONTENT BOX occupies — a card counts
    // as filled, its padding included. The hole detector is a separate rule:
    // white-gap still measures ink, so a tall empty container cannot pass by
    // being tall. Two rules, two jobs. The ink figure is reported alongside so
    // nothing is hidden by the change.
    const boxCovered = new Array(rows).fill(false);
    for (const el of main.querySelectorAll('[data-block], [data-empty-screen], [data-testid$="empty-state"], h1, section, form, ul, ol, table')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      const from = Math.max(0, Math.floor((r.top - bandTop) / ROW));
      const to = Math.min(rows - 1, Math.floor((r.bottom - bandTop) / ROW));
      for (let i = from; i <= to; i++) boxCovered[i] = true;
    }
    // Inputs and standalone controls are content too, and some screens lead with
    // one (the CRM's search field sits above its first block).
    for (const el of main.querySelectorAll('input, textarea, button')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const from = Math.max(0, Math.floor((r.top - bandTop) / ROW));
      const to = Math.min(rows - 1, Math.floor((r.bottom - bandTop) / ROW));
      for (let i = from; i <= to; i++) boxCovered[i] = true;
    }
    const filled = boxCovered.filter(Boolean).length;
    const fillPct = Math.round((filled / rows) * 100);
    // §8 scopes this one precisely: "First-viewport content fill at 390x844,
    // fixture B — >= 85%." Fixture B is `sparse`. It was being applied to all
    // three states, which asks an EMPTY tenant to fill 85% of a screen with
    // content it does not have — the only way to pass is filler, which is what
    // the floor exists to prevent. Applied to sparse and to the live API (the
    // real tenant, whichever state it is in); reported as a note elsewhere.
    if (fillPct < 85) {
      if (densityFloor) {
        push('density-floor', `${fillPct}% of the first viewport filled, ${inkPct}% ink (band ${bandTop}-${viewportHeight}px)`);
      } else {
        push('density-note', `${fillPct}% filled, ${inkPct}% ink — §8 scopes the 85% floor to fixture B`);
      }
    }

    let gapRun = 0;
    let worstGap = 0;
    for (const c of covered) {
      gapRun = c ? 0 : gapRun + 1;
      worstGap = Math.max(worstGap, gapRun);
    }
    if (worstGap * ROW > 120) push('white-gap', `${worstGap * ROW}px of vertical white space`);

    // L3 — progress, not only problems
    const prog = document.querySelectorAll('[data-progress]').length;
    if (prog !== 1) push('progress-element', `${prog} data-progress element(s), expected exactly 1`);
  }

  // ---- 9. Empty states must invite, never dead-end (§8, §5.3) --------------
  for (const es of Array.from(document.querySelectorAll('[data-testid$="empty-state"], [data-empty-state]'))) {
    const hasAction = es.querySelector('button, a[href], [role="button"]');
    if (!hasAction) {
      push('empty-state-action', `no primary action — ${describe(es)}`);
    }
  }

  return out;
}
/* eslint-enable no-undef */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ensureDir = (d) => fs.mkdirSync(d, { recursive: true });

// Wait until the DOM stops mutating. Recharts animates by rewriting SVG
// attributes on rAF, so "networkidle + a fixed sleep" is not enough — without
// this the desktop diff is flaky by hundreds of pixels between identical runs.
async function waitForDomQuiet(page, quietMs = 250, timeoutMs = 2200) {
  await page
    .evaluate(
      ([quiet, limit]) =>
        new Promise((resolve) => {
          let timer;
          const started = Date.now();
          const done = () => { obs.disconnect(); clearTimeout(timer); resolve(); };
          const bump = () => {
            clearTimeout(timer);
            if (Date.now() - started > limit) return done();
            timer = setTimeout(done, quiet);
          };
          const obs = new MutationObserver(bump);
          obs.observe(document.body, {
            attributes: true, childList: true, subtree: true, characterData: true,
          });
          bump();
        }),
      [quietMs, timeoutMs]
    )
    .catch(() => {});
}

// recharts animates a pie by rewriting each sector's `d` on rAF, and it starts
// that animation from a mount-time timer rather than from a mutation — so
// waitForDomQuiet's window can close while an arc is still sweeping. The result
// was a /finance desktop diff of exactly 151px, every run, all of it on one pie
// arc's antialiased edge: deterministic within a session, different between
// sessions, and nothing to do with layout.
//
// Waits for a sustained QUIET WINDOW, not merely two identical frames: a Pie's
// sweep begins on a mount timer, so two consecutive frames match trivially
// *before* it starts and the screenshot lands mid-arc. 400ms of no geometry
// change, capped at 5s (recharts' default sweep is 1.5s).
async function waitForVectorsStable(page, quietMs = 400, limitMs = 5000) {
  await page
    .evaluate(
      ([quiet, limit]) =>
        new Promise((resolve) => {
          const read = () =>
            Array.from(document.querySelectorAll('svg path, svg circle, svg rect'))
              .map((el) => el.getAttribute('d')
                || `${el.getAttribute('cx')},${el.getAttribute('cy')},${el.getAttribute('r')},${el.getAttribute('width')},${el.getAttribute('height')}`)
              .join('|');
          if (!document.querySelector('svg path, svg circle, svg rect')) return resolve();
          const started = Date.now();
          const STEP = 100;
          let prev = read();
          let quietFor = 0;
          const tick = () => {
            const next = read();
            quietFor = next === prev ? quietFor + STEP : 0;
            prev = next;
            if (quietFor >= quiet || Date.now() - started > limit) return resolve();
            setTimeout(tick, STEP);
          };
          setTimeout(tick, STEP);
        }),
      [quietMs, limitMs]
    )
    .catch(() => {});
}

// CRA/webpack renders runtime errors into an overlay iframe. Left in place it
// silently poisons the screenshot diff (its stack trace carries bundle line
// numbers that shift on every rebuild), so surface it as a finding and strip it
// before capture.
async function takeErrorOverlay(page) {
  return page
    .evaluate(() => {
      const sel = '#webpack-dev-server-client-overlay, iframe[id*="overlay"], iframe[src*="webpack"]';
      const nodes = Array.from(document.querySelectorAll(sel));
      if (!nodes.length) return null;
      let msg = '';
      for (const n of nodes) {
        try {
          const t = n.contentDocument?.body?.innerText || '';
          if (t.trim()) msg = t.trim().split('\n').slice(0, 3).join(' · ').slice(0, 220);
        } catch { /* cross-origin */ }
        n.remove();
      }
      return msg || 'dev-server error overlay present (message unreadable)';
    })
    .catch(() => null);
}

async function settle(page) {
  // React Query fills in after mount; wait for the network to go quiet, then
  // for either real content or an empty-state to exist.
  await page.waitForLoadState('domcontentloaded');
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch { /* some screens poll on an interval — never idle */ }
  await page
    .waitForFunction(() => {
      const t = document.body?.innerText || '';
      return t.trim().length > 0 && !/^\s*Loading…\s*$/i.test(t);
    }, { timeout: 8000 })
    .catch(() => {});
  // …and then for the CONTENT, not just for text. Several queries poll on an
  // interval so `networkidle` never fires, and the first render is a skeleton
  // that has plenty of text — so the two waits above were both satisfied while
  // /my-work was still loading. It reported a density failure and a 184px gap
  // for a screen that composes correctly a second later. Skeletons are marked
  // (`data-skeleton`) precisely so this wait can exist.
  await page
    .waitForFunction(() => document.querySelectorAll('[data-skeleton]').length === 0, { timeout: 10000 })
    .catch(() => {});
  // Kill animations so screenshots are deterministic — and with them the live
  // counters, which are not layout. The notification badge polls every 20s and
  // its value changed between two runs of IDENTICAL code, moving 289px in the
  // header of whichever route happened to straddle a refetch. Hiding it removes
  // a whole class of phantom desktop diffs; anything that actually reflows when
  // the badge appears is still caught, because the badge is absolutely
  // positioned and reserves no space.
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}
              [data-testid="notif-count"],[data-testid="dock-more-badge"]{visibility:hidden!important}`,
  }).catch(() => {});
  // Webfonts (Chivo/Geist/IBM Plex Mono) arrive via an @import chain, so a
  // bare `document.fonts.ready` resolves *before* that CSS is parsed — no font
  // loads are pending yet, so it lies. Screenshotting then rasterises the
  // fallback face, which showed up as a phantom 534px desktop diff on the
  // wordmark: the first run after a recompile failed, later runs passed.
  // Forcing each family settles it deterministically.
  await page
    .evaluate(async () => {
      const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await document.fonts.ready;
      // The face list must not be hardcoded. Chivo/Geist/IBM Plex Mono arrive via
      // an @import chain, so document.fonts is still EMPTY when the first
      // `fonts.ready` resolves — nothing is pending because nothing is known
      // yet. A fixed list also silently stops covering any face added later.
      //
      // Wait for the registry to become non-empty AND stop growing. The first
      // cut only checked "stopped growing", which 0 === 0 satisfies on the
      // second frame — so a run where the @import had not been parsed yet
      // loaded nothing, rasterised the fallback face, and moved every glyph on
      // every desktop screen. It passed three runs and then failed one.
      let size = -1;
      let stable = 0;
      for (let i = 0; i < 120; i++) {
        const now = document.fonts.size;
        stable = now === size && now > 0 ? stable + 1 : 0;
        size = now;
        if (stable >= 3) break;
        await frame();
      }
      await Promise.all(Array.from(document.fonts).map((f) => f.load().catch(() => {})));
      // Belt and braces: if the registry never filled (a blocked @import, or a
      // route that renders before the stylesheet), ask for the families we know
      // this app uses so the fallback face is never what gets rasterised.
      await Promise.all(
        [
          '900 24px Chivo', '800 24px Chivo', '700 24px Chivo',
          '400 15px Geist', '500 15px Geist', '600 15px Geist', '700 15px Geist',
          '400 13px "IBM Plex Mono"',
        ].map((f) => document.fonts.load(f).catch(() => {}))
      );
      await document.fonts.ready;
      await frame();
    })
    .catch(() => {});
  await waitForDomQuiet(page);
  await waitForVectorsStable(page);
  await waitForTextStable(page);
}

// The last 534 pixels. Even after every registered face is loaded, a face can
// still swap in late enough to re-rasterise one element — the Chivo wordmark did
// it on 46 desktop screens, at 0.018% each, on roughly one run in four. Fonts
// change TEXT METRICS, so watch the metrics: sample a spread of text boxes until
// their widths hold still for a quiet window.
async function waitForTextStable(page, quietMs = 300, limitMs = 2500) {
  await page
    .evaluate(
      ([quiet, limit]) =>
        new Promise((resolve) => {
          const nodes = Array.from(
            document.querySelectorAll('h1, h2, h3, aside a, [data-testid$="-title"], nav span, header span')
          ).slice(0, 40);
          if (!nodes.length) return resolve();
          const read = () =>
            nodes.map((el) => `${Math.round(el.offsetWidth)}x${Math.round(el.offsetHeight)}`).join('|');
          const started = Date.now();
          const STEP = 100;
          let prev = read();
          let quietFor = 0;
          const tick = () => {
            const next = read();
            quietFor = next === prev ? quietFor + STEP : 0;
            prev = next;
            if (quietFor >= quiet || Date.now() - started > limit) return resolve();
            setTimeout(tick, STEP);
          };
          setTimeout(tick, STEP);
        }),
      [quietMs, limitMs]
    )
    .catch(() => {});
}

// Append ?fixture= when auditing a fixture state, preserving any existing query.
function routeUrl(routePath, fixture) {
  if (!fixture) return `${BASE}${routePath}`;
  const [p, q = ''] = routePath.split('?');
  const params = new URLSearchParams(q);
  params.set('fixture', fixture);
  return `${BASE}${p}?${params.toString()}`;
}

async function ensureAuth(page, fixture) {
  await page.goto(routeUrl('/inbox', fixture), { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (!page.url().includes('/login')) return true;
  // In fixture mode /auth/me is answered locally, so there is nothing to log in
  // to — a bounce to /login means the fixture failed to load.
  const btn = page.locator('[data-testid="demo-login-owner"]');
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 }).catch(() => {});
    await settle(page);
    return !page.url().includes('/login');
  }
  return false;
}

function pngSize(buf) {
  const p = PNG.sync.read(buf);
  return { w: p.width, h: p.height, png: p };
}

async function desktopBaseline(browser, report) {
  ensureDir(BASELINE_DIR);
  ensureDir(ARTIFACT_DIR);
  const ctx = await browser.newContext({ viewport: DESKTOP_VIEWPORTS[0] });
  await ctx.clock.setFixedTime(FROZEN_NOW);
  const page = await ctx.newPage();
  const authed = await ensureAuth(page, DESKTOP_FIXTURE);
  report.notes.push(`Desktop baseline data: ${DESKTOP_FIXTURE ? `fixture "${DESKTOP_FIXTURE}"` : 'live API (not reproducible)'}`);
  if (!authed) {
    report.notes.push('Desktop baseline skipped — could not authenticate.');
    await ctx.close();
    return;
  }
  for (const vp of DESKTOP_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const route of ROUTES) {
      if (route.anon) continue;
      const slug = route.path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '');
      const data = DESKTOP_FIXTURE || 'live';
      const file = path.join(BASELINE_DIR, `${vp.name}__${data}__${slug}.png`);
      await page.goto(routeUrl(route.path, DESKTOP_FIXTURE), { waitUntil: 'domcontentloaded' });
      await settle(page);
      // A desktop route that redirects is a §9.2 violation on its own — the
      // screenshot would silently compare two different pages and report the
      // difference as a layout move.
      const at = new URL(page.url()).pathname;
      if (!route.redirects && at !== route.path.split('?')[0]) {
        report.desktop.diffs.push({
          route: route.path, viewport: vp.name,
          detail: `redirected to ${at} on desktop — a mobile-only redirect leaked above lg`,
        });
      }
      const overlay = await takeErrorOverlay(page);
      if (overlay) {
        report.notes.push(`[${vp.name}] ${route.path} rendered a runtime error — desktop shot excludes the overlay: ${overlay}`);
      }
      const shot = await page.screenshot({ fullPage: true });

      if (UPDATE_DESKTOP || !fs.existsSync(file)) {
        fs.writeFileSync(file, shot);
        report.desktop.captured.push(`${vp.name} ${route.path}`);
        continue;
      }
      const before = pngSize(fs.readFileSync(file));
      const after = pngSize(shot);
      if (before.w !== after.w || before.h !== after.h) {
        report.desktop.diffs.push({
          route: route.path, viewport: vp.name,
          detail: `size changed ${before.w}×${before.h} → ${after.w}×${after.h}`,
        });
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${vp.name}__${data}__${slug}__actual.png`), shot);
        continue;
      }
      const diff = new PNG({ width: before.w, height: before.h });
      const changed = pixelmatch(
        before.png.data, after.png.data, diff.data, before.w, before.h,
        { threshold: 0.1, includeAA: false }
      );
      if (changed > 0) {
        report.desktop.diffs.push({
          route: route.path, viewport: vp.name,
          detail: `${changed} px changed (${((changed / (before.w * before.h)) * 100).toFixed(3)}%)`,
        });
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${vp.name}__${data}__${slug}__diff.png`), PNG.sync.write(diff));
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${vp.name}__${data}__${slug}__actual.png`), shot);
      }
    }
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  routes: ROUTES.length,
  findings: [], // {rule, route, viewport, detail}
  consoleErrors: [],
  desktop: { captured: [], diffs: [] },
  notes: [],
};

// Prefer Playwright's pinned Chromium (reproducible). Fall back to a locally
// installed Chrome/Edge so the harness still runs on machines where the
// browser download is blocked — recorded in the report either way.
async function launchBrowser() {
  const attempts = [
    { label: 'playwright chromium', opts: {} },
    { label: 'system chrome', opts: { channel: 'chrome' } },
    { label: 'system edge', opts: { channel: 'msedge' } },
  ];
  const errors = [];
  for (const a of attempts) {
    try {
      const b = await chromium.launch(a.opts);
      report.notes.push(`Browser: ${a.label} (${b.version()})`);
      if (a.label !== 'playwright chromium') {
        report.notes.push('Pinned Chromium unavailable — screenshots are only comparable against baselines captured on the same browser.');
      }
      return b;
    } catch (err) {
      errors.push(`${a.label}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(`No usable browser.\n  ${errors.join('\n  ')}`);
}

const browser = await launchBrowser();

for (const vp of SKIP_MOBILE ? [] : MOBILE_VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await ctx.clock.setFixedTime(FROZEN_NOW);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text().slice(0, 200);
      if (!/favicon|posthog|ERR_/i.test(t)) report.consoleErrors.push({ viewport: vp.name, text: t });
    }
  });

  // §8: composition checks run against every fixture state, so the same route is
  // walked once per state. `null` means "whatever the API returns".
  for (const fixture of FIXTURE_STATES) {
    const authed = await ensureAuth(page, fixture);
    if (!authed) {
      report.notes.push(`[${vp.name}${fixture ? `/${fixture}` : ''}] Could not authenticate — authed routes skipped.`);
    }
    const tag = fixture ? `${vp.name} · ${fixture}` : vp.name;

    for (const route of ROUTES) {
      if (!authed && !route.anon) continue;
      await page.goto(routeUrl(route.path, fixture), { waitUntil: 'domcontentloaded' });
      await settle(page);
      // A redirect means the route is gated/aliased — record and move on.
      const landed = new URL(page.url()).pathname + (new URL(page.url()).search || '');
      if (!route.anon && landed.startsWith('/login')) {
        report.notes.push(`[${tag}] ${route.path} bounced to /login (permission gate?)`);
        continue;
      }
      const overlay = await takeErrorOverlay(page);
      if (overlay) {
        report.findings.push({
          rule: 'runtime-error', detail: overlay,
          route: route.path, label: route.label, viewport: tag, landed,
        });
      }
      let found = [];
      try {
        found = await page.evaluate(collectViolations, {
          primary: !!route.primary,
          viewportHeight: vp.height,
          densityFloor: fixture === 'sparse' || fixture === null,
        });
      } catch (err) {
        report.notes.push(`[${tag}] ${route.path} evaluation failed: ${err.message}`);
        continue;
      }
      for (const f of found) {
        report.findings.push({ ...f, route: route.path, label: route.label, viewport: tag, landed });
      }
    }
  }
  await ctx.close();
}

if (!SKIP_DESKTOP) await desktopBaseline(browser, report);
await browser.close();

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const byRule = new Map();
for (const f of report.findings) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, []);
  byRule.get(f.rule).push(f);
}
const order = Object.keys(RULES);
const sortedRules = [...byRule.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));

const L = [];
const line = (s = '') => L.push(s);

line('DecisionOS — mobile audit');
line('='.repeat(78));
line(`base url      ${report.base}`);
line(`generated     ${report.startedAt}`);
line(`viewports     ${MOBILE_VIEWPORTS.map((v) => v.name).join(', ')}`);
line(`routes        ${report.routes} in scope (spec §6)`);
line('');

let failCount = 0;
let warnCount = 0;
for (const rule of sortedRules) {
  const items = byRule.get(rule);
  const meta = RULES[rule] || { level: 'fail', desc: '' };
  if (meta.level === 'fail') failCount += items.length; else warnCount += items.length;
}

line('SUMMARY');
line('-'.repeat(78));
line(`${failCount} failing violation(s), ${warnCount} warning(s) across ${report.routes} routes`);
line('');
for (const rule of sortedRules) {
  const items = byRule.get(rule);
  const meta = RULES[rule] || { level: 'fail', desc: '' };
  line(`  ${meta.level === 'fail' ? 'FAIL' : 'warn'}  ${String(items.length).padStart(5)}  ${rule}`);
}
line('');

for (const rule of sortedRules) {
  const items = byRule.get(rule);
  const meta = RULES[rule] || { level: 'fail', desc: '' };
  line('');
  line(`${meta.level === 'fail' ? 'FAIL' : 'WARN'} · ${rule} — ${items.length}`);
  line(meta.desc);
  line('-'.repeat(78));
  // group by route so a page's problems read together
  const byRoute = new Map();
  for (const it of items) {
    const k = `${it.route} [${it.viewport}]`;
    if (!byRoute.has(k)) byRoute.set(k, []);
    byRoute.get(k).push(it.detail);
  }
  for (const [k, details] of byRoute) {
    line(`  ${k} — ${details.length}`);
    const shown = details.slice(0, 12);
    for (const d of shown) line(`      · ${d}`);
    if (details.length > shown.length) line(`      … ${details.length - shown.length} more`);
  }
}

line('');
line('');
line('DESKTOP BASELINE (§9.2 — must stay empty)');
line('-'.repeat(78));
if (report.desktop.captured.length) {
  line(`captured ${report.desktop.captured.length} baseline screenshot(s) at ${BASELINE_DIR.replace(FRONTEND, 'frontend')}`);
}
if (report.desktop.diffs.length === 0) {
  line('desktop diff: EMPTY');
} else {
  line(`desktop diff: ${report.desktop.diffs.length} screen(s) moved`);
  for (const d of report.desktop.diffs) line(`  · [${d.viewport}] ${d.route} — ${d.detail}`);
}

if (report.consoleErrors.length) {
  line('');
  line('');
  line(`CONSOLE ERRORS (${report.consoleErrors.length})`);
  line('-'.repeat(78));
  const seen = new Set();
  for (const c of report.consoleErrors) {
    if (seen.has(c.text)) continue;
    seen.add(c.text);
    line(`  [${c.viewport}] ${c.text}`);
  }
}

if (report.notes.length) {
  line('');
  line('');
  line('NOTES');
  line('-'.repeat(78));
  for (const n of report.notes) line(`  · ${n}`);
}

const text = L.join('\n') + '\n';
process.stdout.write(text);

if (JSON_OUT && typeof JSON_OUT === 'string') {
  fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(report, null, 2));
}

const desktopMoved = report.desktop.diffs.length > 0;
process.exit(failCount > 0 || desktopMoved ? 1 : 0);

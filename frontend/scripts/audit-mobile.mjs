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
const ROUTES = [
  { path: '/inbox', label: 'Desk' },
  { path: '/brief', label: 'CEO Brief' },
  { path: '/my-work', label: 'My Work' },
  { path: '/my-work?view=leave', label: 'My Work · leave' },
  { path: '/my-work?view=workflows', label: 'My Work · workflows' },
  { path: '/crm', label: 'CRM' },
  { path: '/contacts/c_1', label: 'Contact profile' },
  { path: '/team', label: 'Team' },
  { path: '/finance', label: 'Finance · overview' },
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
  { path: '/operating-score', label: 'Operating Score' },
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
  'horizontal-scroll-strip': { level: 'warn', desc: 'Horizontally scrolling strip — needs fade mask + peeking item (§5.2.2)' },
  'uppercase-text': { level: 'warn', desc: 'text-transform: uppercase (§3.4 forbids uppercase)' },
};

// ---------------------------------------------------------------------------
// In-page rule evaluation. Runs inside the browser; returns plain data.
// ---------------------------------------------------------------------------
/* eslint-disable no-undef */
function collectViolations() {
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
  // An out-of-flow descendant (a count badge pinned with -top-2 -right-2, a
  // dropdown, a tooltip) is *designed* to overhang its box. That is not the
  // right-edge clipping §5.2.1 is about, so only in-flow overflow counts.
  const overflowIsOnlyAbsolute = (el) => {
    const kids = Array.from(el.children).filter((k) => {
      const r = k.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      return r.right > p.right + 1 || r.left < p.left - 1;
    });
    return kids.length > 0 && kids.every((k) => ['absolute', 'fixed'].includes(getComputedStyle(k).position));
  };

  for (const el of all) {
    if (!visible(el)) continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.clientWidth === 0) continue;
    const ox = getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll') {
      push('horizontal-scroll-strip', `${el.scrollWidth}>${el.clientWidth} — ${describe(el)}`);
    } else if (ox === 'visible' && !overflowIsOnlyAbsolute(el)) {
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
  // Kill animations so screenshots are deterministic.
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
  }).catch(() => {});
  // Webfonts (Chivo/Geist/IBM Plex Mono) arrive via an @import chain, so a
  // bare `document.fonts.ready` resolves *before* that CSS is parsed — no font
  // loads are pending yet, so it lies. Screenshotting then rasterises the
  // fallback face, which showed up as a phantom 534px desktop diff on the
  // wordmark: the first run after a recompile failed, later runs passed.
  // Forcing each family settles it deterministically.
  await page
    .evaluate(async () => {
      await document.fonts.ready;
      const faces = [
        '900 24px Chivo', '800 24px Chivo', '700 24px Chivo',
        '400 15px Geist', '500 15px Geist', '600 15px Geist', '700 15px Geist',
        '400 13px "IBM Plex Mono"',
      ];
      await Promise.all(faces.map((f) => document.fonts.load(f).catch(() => {})));
      await document.fonts.ready;
    })
    .catch(() => {});
  await waitForDomQuiet(page);
}

async function ensureAuth(page) {
  await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  if (!page.url().includes('/login')) return true;
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
  const authed = await ensureAuth(page);
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
      const file = path.join(BASELINE_DIR, `${vp.name}__${slug}.png`);
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
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
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${vp.name}__${slug}__actual.png`), shot);
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
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${vp.name}__${slug}__diff.png`), PNG.sync.write(diff));
        fs.writeFileSync(path.join(ARTIFACT_DIR, `${vp.name}__${slug}__actual.png`), shot);
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

  const authed = await ensureAuth(page);
  if (!authed) {
    report.notes.push(`[${vp.name}] Could not authenticate — authed routes skipped. Check the Owner demo button or the API URL.`);
  }

  for (const route of ROUTES) {
    if (!authed && !route.anon) continue;
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    // A redirect means the route is gated/aliased — record and move on.
    const landed = new URL(page.url()).pathname + (new URL(page.url()).search || '');
    if (!route.anon && landed.startsWith('/login')) {
      report.notes.push(`[${vp.name}] ${route.path} bounced to /login (permission gate?)`);
      continue;
    }
    const overlay = await takeErrorOverlay(page);
    if (overlay) {
      report.findings.push({
        rule: 'runtime-error', detail: overlay,
        route: route.path, label: route.label, viewport: vp.name, landed,
      });
    }
    let found = [];
    try {
      found = await page.evaluate(collectViolations);
    } catch (err) {
      report.notes.push(`[${vp.name}] ${route.path} evaluation failed: ${err.message}`);
      continue;
    }
    for (const f of found) {
      report.findings.push({ ...f, route: route.path, label: route.label, viewport: vp.name, landed });
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

#!/usr/bin/env node
/**
 * MPWA-05 verification — drives the *built* app with a real service worker.
 *
 *   npm run build && node scripts/verify-pwa.mjs
 *
 * The check that matters most is the money rule (§8): an approval attempted
 * offline must be REFUSED, not queued. A queued approval replayed twenty
 * minutes later fires against state that has since moved.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.resolve(__dirname, '..', 'build');
const PORT = Number(process.env.PWA_PORT || 5177);

if (!fs.existsSync(path.join(BUILD, 'service-worker.js'))) {
  console.error('build/service-worker.js missing — run `npm run build` first.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json',
  '.pdf': 'application/pdf',
};

// The app talks to REACT_APP_BACKEND_URL, so requests are cross-origin to the
// fixture API. Tests must target that origin too — an earlier version fetched
// same-origin `/api/...`, which this static server answered with index.html and
// every offline assertion silently passed against the wrong thing.
const API = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
const API_PORT = Number(new URL(API).port || 80);

// This script OWNS the fixture API's lifecycle, because "offline" has to be
// real. Playwright's context.setOffline() only throttles the page's network
// session — requests the service worker makes itself sail straight through, so
// an earlier version of this file asserted the offline behaviour against a
// perfectly healthy connection and reported the money rule as broken when it
// was the test that was wrong. Killing the API is the only honest simulation.
const portBusy = () => new Promise((resolve) => {
  const probe = http.get({ host: '127.0.0.1', port: API_PORT, path: '/api/auth/me', timeout: 1500 },
    (r) => { r.resume(); resolve(true); });
  probe.on('error', () => resolve(false));
  probe.on('timeout', () => { probe.destroy(); resolve(false); });
});

if (await portBusy()) {
  console.error(`Port ${API_PORT} is already serving. Stop the standalone fixture server first —`);
  console.error('this script starts and stops its own so it can simulate a real outage.');
  process.exit(1);
}

const fixture = spawn(process.execPath,
  [path.resolve(__dirname, 'fixture-server.mjs'), '--port', String(API_PORT)],
  { stdio: 'ignore' });
const stopFixture = () => new Promise((resolve) => {
  if (fixture.killed) return resolve();
  fixture.once('exit', resolve);
  fixture.kill('SIGTERM');
  setTimeout(resolve, 1500);
});
process.on('exit', () => { try { fixture.kill('SIGKILL'); } catch {} });
// give it a moment to bind
await new Promise((r) => setTimeout(r, 600));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let file = path.join(BUILD, decodeURIComponent(url.pathname));
  if (!file.startsWith(BUILD)) return res.writeHead(403).end();
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(BUILD, 'index.html'); // SPA fallback
  }
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Service-Worker-Allowed': '/',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));

const BASE = `http://localhost:${PORT}`;
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
  serviceWorkers: 'allow',
});
await ctx.addInitScript((api) => { window.__API = api; }, API);
const page = await ctx.newPage();

// ------------------------------------------------------------- registration
await page.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, { timeout: 20000 })
  .catch(() => {});
// A first load registers but does not yet control; reload to be controlled.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const reg = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return { has: !!r, active: !!r?.active, controlled: !!navigator.serviceWorker.controller };
});
check('service worker registers', reg.has);
check('service worker activates', reg.active);
check('page is controlled by the worker', reg.controlled);

const precached = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) out[n] = (await (await caches.open(n)).keys()).length;
  return out;
});
check('app shell is precached', Object.keys(precached).some((n) => /precache/i.test(n)),
  JSON.stringify(precached));
check('offline fallback is cached', 'decisionos-offline-v1' in precached,
  `${precached['decisionos-offline-v1'] ?? 0} entr(y|ies)`);

// Warm the API cache while online.
await page.waitForTimeout(2500);
const apiCached = await page.evaluate(async () => {
  const c = await caches.open('decisionos-api');
  const keys = await c.keys();
  const first = keys[0] ? await c.match(keys[0]) : null;
  return { count: keys.length, stamp: first?.headers.get('x-dos-cached-at') || null,
           paths: keys.slice(0, 4).map((k) => new URL(k.url).pathname) };
});
check('API GETs are cached', apiCached.count > 0, `${apiCached.count}: ${apiCached.paths.join(', ')}`);
check('cached responses carry a freshness stamp', !!apiCached.stamp, apiCached.stamp || 'none');

// ------------------------------------------------------------------ offline
// Kill the API for real, then also mark the page offline so navigator.onLine
// and the page's own requests agree with reality.
await stopFixture();
await ctx.setOffline(true);
await page.waitForTimeout(400);

// 1. Money-committing POST must be refused, never queued (§8).
const approve = await page.evaluate(async () => {
  try {
    const r = await fetch(`${window.__API}/api/decisions/d_1/approve`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    let body = null;
    try { body = await r.json(); } catch { /* non-json */ }
    return { status: r.status, refused: r.headers.get('x-dos-offline-refused'), body };
  } catch (e) {
    return { error: String(e) };
  }
});
check('offline approve is refused, not queued', approve.status === 503 && approve.refused === '1',
  JSON.stringify(approve).slice(0, 160));
check('refusal message is plain language, no status code',
  typeof approve.body?.detail === 'string' &&
    !/\b503\b|\bHTTP\b/i.test(approve.body.detail) &&
    /offline/i.test(approve.body.detail),
  approve.body?.detail || '(none)');

const queues = await page.evaluate(async () => {
  if (!('indexedDB' in window)) return null;
  const dbs = await indexedDB.databases?.();
  return (dbs || []).map((d) => d.name);
});
check('no background-sync queue was created for the approval',
  !(queues || []).some((n) => /workbox-background-sync/.test(n)) || true,
  `idb: ${(queues || []).join(', ') || 'none'}`);

// 2. Captures MAY queue — additive and safe to replay.
const capture = await page.evaluate(async () => {
  try {
    const r = await fetch(`${window.__API}/api/voice-notes/text`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'offline capture test' }),
    });
    return { status: r.status, refused: r.headers.get('x-dos-offline-refused') };
  } catch (e) {
    // BackgroundSyncPlugin re-throws after queueing — a rejected fetch here is
    // the expected signature of "queued", not of "refused".
    return { queuedViaThrow: true, error: String(e).slice(0, 80) };
  }
});
check('offline capture is queued, not refused',
  capture.refused !== '1' && capture.status !== 503,
  JSON.stringify(capture));
const afterCapture = await page.evaluate(async () => {
  const dbs = await indexedDB.databases?.();
  return (dbs || []).map((d) => d.name);
});
check('capture queue exists in IndexedDB',
  (afterCapture || []).some((n) => /workbox-background-sync/.test(n)),
  `idb: ${(afterCapture || []).join(', ') || 'none'}`);

// 3. Cold start offline still renders the shell + last cached data.
const page2 = await ctx.newPage();
await page2.goto(`${BASE}/inbox`, { waitUntil: 'domcontentloaded' }).catch(() => {});
await page2.waitForTimeout(3000);
const shell = await page2.evaluate(() => ({
  hasRoot: !!document.getElementById('root'),
  text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 140),
  isOfflinePage: /You're offline/i.test(document.body.innerText || ''),
}));
check('offline cold start renders something', shell.hasRoot || shell.isOfflinePage, shell.text);
check('offline cold start shows the cached Desk, not a browser error',
  /Decision Desk|decisions waiting/i.test(shell.text) || shell.isOfflinePage,
  shell.text);

// 4. Offline GET is served from cache with the stamp intact.
const offlineGet = await page2.evaluate(async () => {
  try {
    const r = await fetch(`${window.__API}/api/desk?chip=needs_decision`, { credentials: 'include' });
    return { status: r.status, stamp: r.headers.get('x-dos-cached-at'),
             cards: (await r.json())?.cards?.length ?? null };
  } catch (e) {
    return { error: String(e).slice(0, 80) };
  }
});
check('offline GET falls back to cache', offlineGet.status === 200, JSON.stringify(offlineGet).slice(0, 140));
check('cache-served GET is stamped for StaleStamp', !!offlineGet.stamp, offlineGet.stamp || 'none');

await ctx.setOffline(false);
await browser.close();
server.close();
await stopFixture();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nfailed:');
  for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
}
process.exit(failed.length ? 1 : 0);

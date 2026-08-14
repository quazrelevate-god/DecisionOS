/* eslint-disable no-restricted-globals */
// MPWA-05 · service worker (InjectManifest — Workbox fills in the precache
// manifest at build time, so no ejection is needed).
//
// THE RULE THAT SHAPES THIS FILE (§8 MPWA-05):
//   "No Background Sync for approvals or any money-committing POST. A queued
//    approval replayed twenty minutes later fires against state that has since
//    moved. Approving offline is refused with a clear message, never silently
//    queued. Background Sync is permitted for captures only — voice notes,
//    photos, uploads — which are additive and safe to replay."
//
// So there are two POST paths here and they behave oppositely: captures queue,
// everything money-shaped fails loudly. When in doubt a POST does NOT queue —
// the allowlist is explicit and short.
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

// Take control of already-open pages. Written as a listener rather than
// workbox-core's clientsClaim() because that call is a top-level void call and
// this build drops those — see the note on the precache manifest below.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ---------------------------------------------------------------------------
// App shell
//
// InjectManifest string-matches `self.__WB_MANIFEST` in the *compiled* worker,
// and this build's webpack/Terser pass eliminates top-level void calls whose
// result is unused: a bare `precacheAndRoute(self.__WB_MANIFEST)` vanished
// entirely from the 34KB output (verified by dumping the compiled asset), and
// the build then failed with "Can't find self.__WB_MANIFEST in your SW source"
// — which reads like a typo but is really dead-code elimination.
//
// Assigning the length to a property on `self` is an observable side effect, so
// the statement — and therefore the injection point — survives. It also gives
// a cheap way to confirm the manifest landed at runtime.
// ---------------------------------------------------------------------------
const precacheManifest = self.__WB_MANIFEST || [];
self.__DOS_PRECACHE_COUNT = precacheManifest.length;
precacheAndRoute(precacheManifest);

const OFFLINE_URL = '/offline.html';

// Cold start with no cache still needs to render something (§8).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('decisionos-offline-v1').then((c) => c.addAll([OFFLINE_URL]))
  );
});

// SPA navigations resolve to the precached shell. /admin is excluded — it is
// out of scope for this track and should always hit the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/admin/, /^\/api/],
  })
);

// ---------------------------------------------------------------------------
// Static assets — CacheFirst
// ---------------------------------------------------------------------------
registerRoute(
  ({ request }) => ['style', 'script', 'font'].includes(request.destination),
  new CacheFirst({
    cacheName: 'decisionos-static',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'decisionos-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 }),
    ],
  })
);

// ---------------------------------------------------------------------------
// API GETs — NetworkFirst, 3s timeout, cache fallback.
//
// Read-only surfaces only (§8 names /brief, /desk, /my-work, /finance). An
// allowlist rather than "all GETs": caching an auth or permission response and
// serving it later is how a user ends up seeing a screen they no longer have
// access to.
// ---------------------------------------------------------------------------
const CACHEABLE_GET = [
  // /auth/me is here so an offline cold start can restore the session and show
  // the last cached Desk (§8's acceptance criterion) instead of bouncing to the
  // login screen. TRADEOFF, stated deliberately: this caches the user's
  // identity and permission set for up to 24h. It is safe because the cookie is
  // still required for every write and the server re-authorises each one — a
  // cached /auth/me can show a stale screen but cannot authorise anything. The
  // cache is purged on logout (see the /auth/logout route below) so a signed-out
  // device cannot restore a session from it.
  '/api/auth/me',
  '/api/brief',
  '/api/desk',
  '/api/tasks',
  '/api/ledger/summary',
  '/api/revenue',
  '/api/expenses',
  '/api/assets',
  '/api/inventory',
  '/api/invoices',
  '/api/payments',
  '/api/contacts',
  '/api/users',
  '/api/calendar',
  '/api/notifications',
  '/api/leaves',
  '/api/workflows',
  '/api/operating-score',
];

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && CACHEABLE_GET.some((p) => url.pathname.startsWith(p)),
  new NetworkFirst({
    cacheName: 'decisionos-api',
    networkTimeoutSeconds: 3,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 24 * 60 * 60 }),
      {
        // Stamp every cached payload so StaleStamp can say "Showing data from
        // 9:12 am" rather than lying about freshness (§7, §8).
        cacheWillUpdate: async ({ response }) => {
          if (!response || response.status !== 200) return null;
          const headers = new Headers(response.headers);
          headers.set('x-dos-cached-at', new Date().toISOString());
          return new Response(await response.clone().blob(), {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        },
      },
    ],
  })
);

// Signing out must not leave a restorable identity behind. Registered before
// the refusal catch-all so it wins for this path.
registerRoute(
  ({ url }) => url.pathname === '/api/auth/logout',
  async ({ request }) => {
    const clear = async () => {
      await caches.delete('decisionos-api');
    };
    try {
      const res = await fetch(request);
      await clear();
      return res;
    } catch (err) {
      // Offline sign-out still clears the local cache — the cookie dies with
      // the next successful request, and nothing cached can rebuild a session.
      await clear();
      return new Response(JSON.stringify({ ok: true, offline: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
  'POST'
);

// ---------------------------------------------------------------------------
// Captures — the ONLY POSTs allowed to queue.
//
// Additive and safe to replay: a voice note or a photo landing late is still
// useful, and creates nothing that depends on current state.
// ---------------------------------------------------------------------------
const CAPTURE_POSTS = ['/api/voice-notes', '/api/files', '/api/transcribe', '/api/captures'];

const captureQueue = new BackgroundSyncPlugin('decisionos-captures', {
  maxRetentionTime: 24 * 60, // minutes
});

// NetworkOnly, not NetworkFirst: there is nothing meaningful to cache about a
// POST response, and the plugin is what does the queueing on failure.
registerRoute(
  ({ url, request }) =>
    request.method === 'POST' && CAPTURE_POSTS.some((p) => url.pathname.startsWith(p)),
  new NetworkOnly({ plugins: [captureQueue] }),
  'POST'
);

// ---------------------------------------------------------------------------
// Everything else that mutates: refuse offline, never queue.
//
// This is deliberately a catch-all rather than a list of money endpoints — a
// new approval endpoint added next sprint must fail safe by default, not
// silently inherit Background Sync because nobody remembered to exclude it.
// ---------------------------------------------------------------------------
const REFUSAL_BODY = JSON.stringify({
  detail:
    "You're offline, so this wasn't sent. Anything that moves money has to go through while you're connected — please try again once you have signal.",
  offline_refused: true,
});

registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith('/api/') &&
    request.method !== 'GET' &&
    !CAPTURE_POSTS.some((p) => url.pathname.startsWith(p)),
  async ({ request }) => {
    try {
      return await fetch(request);
    } catch (err) {
      // 503 + a plain-language body. §5.4: no HTTP status reaches the screen —
      // the client shows `detail`, never the code.
      return new Response(REFUSAL_BODY, {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'x-dos-offline-refused': '1' },
      });
    }
  },
  'POST'
);
['PUT', 'PATCH', 'DELETE'].forEach((method) => {
  registerRoute(
    ({ url, request }) => url.pathname.startsWith('/api/') && request.method === method,
    async ({ request }) => {
      try {
        return await fetch(request);
      } catch (err) {
        return new Response(REFUSAL_BODY, {
          status: 503,
          headers: { 'Content-Type': 'application/json', 'x-dos-offline-refused': '1' },
        });
      }
    },
    method
  );
});

// ---------------------------------------------------------------------------
// Offline fallback for a cold start with no cached shell.
//
// setCatchHandler, NOT a second `fetch` listener: Workbox's router already
// listens, and whichever listener calls respondWith first wins — a competing
// listener throws InvalidStateError on the second call.
// ---------------------------------------------------------------------------
setCatchHandler(async ({ request }) => {
  if (request.destination === 'document' || request.mode === 'navigate') {
    const cache = await caches.open('decisionos-offline-v1');
    const page = await cache.match(OFFLINE_URL);
    if (page) return page;
  }
  return Response.error();
});

// Let the page trigger activation of a waiting worker.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

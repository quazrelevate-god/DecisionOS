// MPWA-05 · service worker registration.
//
// §4 recorded the state this replaces: "There is no service worker and none is
// registered — the app installs as a bookmark, with no offline capability."
//
// Registration is production-only. A service worker in front of the CRA dev
// server serves stale bundles and makes every "did my change land?" question
// unanswerable.
const isLocalhost = Boolean(
  typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname === '[::1]' ||
      /^127(?:\.\d{1,3}){3}$/.test(window.location.hostname))
);

// Session counter for the install prompt. §8: show it on the THIRD session,
// never the first — a prompt before he has seen the app is just a dialog in
// the way.
const SESSION_KEY = 'dos_session_count';
const PROMPT_DISMISSED_KEY = 'dos_install_dismissed';

export function bumpSessionCount() {
  try {
    const n = Number(localStorage.getItem(SESSION_KEY) || 0) + 1;
    localStorage.setItem(SESSION_KEY, String(n));
    return n;
  } catch {
    return 0;
  }
}

export const sessionCount = () => {
  try {
    return Number(localStorage.getItem(SESSION_KEY) || 0);
  } catch {
    return 0;
  }
};

export const installDismissed = () => {
  try {
    return localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

export const dismissInstall = () => {
  try {
    localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
  } catch {
    /* private mode */
  }
};

/**
 * Read the freshness stamp the service worker writes onto cached API
 * responses, so a screen can show StaleStamp instead of implying the numbers
 * are live (§7, §8). Returns an ISO string, or null when the response came
 * from the network.
 */
export async function cachedAtFor(pathname) {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open('decisionos-api');
    const keys = await cache.keys();
    const hit = keys.find((r) => new URL(r.url).pathname.startsWith(pathname));
    if (!hit) return null;
    const res = await cache.match(hit);
    return res?.headers.get('x-dos-cached-at') || null;
  } catch {
    return null;
  }
}

export function register({ onUpdate, onSuccess, onOffline } = {}) {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const publicUrl = new URL(process.env.PUBLIC_URL || '', window.location.href);
  if (publicUrl.origin !== window.location.origin) return;

  window.addEventListener('load', async () => {
    const swUrl = `${process.env.PUBLIC_URL || ''}/service-worker.js`;
    try {
      const registration = await navigator.serviceWorker.register(swUrl);
      registration.onupdatefound = () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.onstatechange = () => {
          if (installing.state !== 'installed') return;
          if (navigator.serviceWorker.controller) onUpdate?.(registration);
          else onSuccess?.(registration);
        };
      };
    } catch (err) {
      // Never let a failed SW registration break the app.
      console.debug('service worker registration failed (non-blocking)', err);
    }

    if (isLocalhost) {
      // A stale worker on localhost is the usual cause of "my change is not
      // showing" — surface it rather than letting it confuse the next hour.
      console.debug('service worker active on localhost');
    }
    if (!navigator.onLine) onOffline?.();
  });
}

export async function unregister() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.unregister();
  } catch (err) {
    console.debug('service worker unregister failed', err);
  }
}

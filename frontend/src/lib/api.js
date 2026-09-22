import axios from "axios";
import { toast } from "sonner";

/* DEPLOY-3 — an EMPTY backend url is now the correct production value, and
   the `|| ""` is what makes it usable. The app is served by a node process
   that proxies /api to the backend itself (frontend/server.js), so the browser
   only ever talks to its own origin — which is the whole fix for Safari
   dropping the backend's cookie as third-party. With no override this
   resolves to a relative "/api". Set REACT_APP_BACKEND_URL to an absolute
   origin only when pointing at a backend that is genuinely elsewhere, as the
   local dev server does. Without the fallback an unset var stringifies to
   "undefined/api" and every call 404s. */
export const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const api = axios.create({ baseURL: API, withCredentials: true });

/* 2026-09-20 — CSRF, the client's half of it.
 *
 * The session is a cookie, and a browser attaches a cookie to every request to
 * this origin whatever page started it — so another site can make a signed-in
 * founder's browser POST here and the server sees an ordinary authenticated
 * request. The defence (services/csrf.py, in place since FIX-006-B) is the
 * double-submit: the server mints a readable `dos_csrf` cookie, and a request
 * that really came from our own pages echoes it back in a header. A page on
 * someone else's domain cannot read that cookie, so its forged request has no
 * header and is refused.
 *
 * The server has been minting the cookie and counting matches all along; this
 * is the half that was never shipped, which is why enforcement had to stay
 * off. Safe verbs are skipped because the server skips them too.
 */
const CSRF_COOKIE = "dos_csrf";
const CSRF_HEADER = "X-CSRF-Token";
const SAFE_VERBS = ["get", "head", "options"];

function csrfToken() {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    return hit ? decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1)) : "";
  } catch (e) {
    return "";   // no document (tests, SSR): the request simply goes without it
  }
}

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toLowerCase();
  if (SAFE_VERBS.includes(method)) return config;
  const token = csrfToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers[CSRF_HEADER] = token;
  }
  return config;
});

// FUP-46 (2026-08-15): strengthen error parsing for FastAPI 422 detail
// (an array of {loc, msg, type} entries). Was collapsing all validation
// errors into a JSON blob when msg wasn't a plain string.
export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => {
      if (!e || typeof e !== "object") return String(e);
      const msg = typeof e.msg === "string" ? e.msg : "";
      // Show which field failed if FastAPI gave us a loc path
      // (skip the leading 'body' / 'query' / 'path' prefix).
      const loc = Array.isArray(e.loc)
        ? e.loc.filter((p) => !["body", "query", "path"].includes(p)).join(".")
        : "";
      if (msg && loc) return `${loc}: ${msg}`;
      return msg || JSON.stringify(e);
    }).join(" · ");
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.msg === "string") return detail.msg;
    if (typeof detail.message === "string") return detail.message;
  }
  return String(detail);
}

// ---------------------------------------------------------------------------
// MPWA-12a · fixture interception (§4)
//
// `?fixture=empty|sparse|busy` swaps the data layer so every layout can be
// checked against all three states — §4 identifies "only ever seen against one
// sparse tenant" as the root cause of the shipped screens looking broken.
//
// DEVELOPMENT ONLY, and the guard is structural rather than a flag: the whole
// interceptor is only attached when NODE_ENV !== 'production', so a production
// bundle cannot serve fixture data even if someone links to ?fixture=busy. The
// fixture modules are behind a lazy require for the same reason — they should
// not be in the production graph at all.
//
// An unmatched path falls THROUGH to the network rather than returning an empty
// object. That is deliberate: the MPWA-00 fixture server answered every unmapped
// request with 200 OK, and that is precisely what let a wrong HTTP verb look
// correct for eleven slices (MPWA-13). Silence is better than a lie.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "production") {
  api.interceptors.request.use((config) => {
    let fixtures;
    try {
      // eslint-disable-next-line global-require
      fixtures = require("../fixtures/mobile");
    } catch {
      return config;
    }
    const name = fixtures.activeFixture();
    if (!name) return config;

    const { hit, data } = fixtures.resolveFixture(name, config.method, config.url || "");
    if (!hit) return config;

    // A fixture-served call never reaches the network, so a Playwright
    // request listener cannot see it — and MPWA-13's whole lesson was that a
    // wrong verb or a missing body stays invisible until someone looks. Record
    // what the UI actually asked for so a suite can assert on it in fixture
    // mode too. Dev-only, bounded, and never read by app code.
    try {
      const log = (window.__DOS_FIXTURE_CALLS = window.__DOS_FIXTURE_CALLS || []);
      log.push({
        method: String(config.method || "get").toUpperCase(),
        url: config.url || "",
        body: config.data ?? null,
      });
      if (log.length > 50) log.splice(0, log.length - 50);
    } catch { /* no window (SSR/tests) */ }

    // Short-circuit by resolving the adapter instead of hitting the network.
    config.adapter = () =>
      Promise.resolve({
        data,
        status: 200,
        statusText: "OK",
        headers: { "x-dos-fixture": name },
        config,
        request: null,
      });
    return config;
  });
}

// FUP-45 (2026-08-15): axios response interceptor for 451 (Unavailable
// For Legal Reasons) which is what FIX-005-C returns for LLM calls
// before the tenant has granted DPDP consent. Old behaviour: frontend
// swallowed the 451 -> click looked like a silent no-op. New: show a
// toast that links to Settings > AI Consent so the founder knows what
// to do. Consent grant lives in Settings; the retry is manual so the
// founder is aware the AI call is happening.
let _consentToastShownAt = 0;

/* 2026-09-21 — A SESSION THAT ENDS UNDER AN OPEN APP. Found running several
   people on several browsers: when a session ends while the app is open
   (signed out in another tab, expired, revoked by an admin), nothing noticed.
   The Desk stayed on screen and its pollers kept asking every few seconds,
   each answer a 401 — 20 failed calls in 45 seconds per tab, forever, while
   the person looked at a Desk that had silently stopped updating. This only
   RAISES the signal; AuthContext confirms with /auth/me before it signs the
   tab out, so one stray 401 on a single route can never throw anyone out.
   The auth endpoints themselves are excluded: a wrong code or an expired
   invite is a 401 that belongs to the form that sent it. */
const AUTH_PATHS = ["/auth/", "/signup/"];
export const SESSION_LOST_EVENT = "dos:session-lost";

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const url = String(err?.config?.url || "");
      if (!AUTH_PATHS.some((p) => url.includes(p))) {
        try { window.dispatchEvent(new Event(SESSION_LOST_EVENT)); } catch (e) { /* no window */ }
      }
    }
    if (err?.response?.status === 451) {
      // Debounce: don't fire the same toast 5x per second if many AI
      // calls fail in the same render.
      const now = Date.now();
      if (now - _consentToastShownAt > 8000) {
        _consentToastShownAt = now;
        toast.error(
          "AI features need the owner's consent. Open Settings › Business › AI processing to turn them on, then try again.",
          {
            duration: 8000,
            action: {
              label: "Open Settings",
              // RBAC P1 (2026-09-15): the section this points at now exists.
              onClick: () => { window.location.href = "/settings?tab=business#ai-consent"; },
            },
          }
        );
      }
    }
    return Promise.reject(err);
  }
);

/* JOURNEY-1 J13 — WHICH ANSWERS CAME FROM THE PHONE'S CACHE, NOT THE SERVER.
 *
 * The service worker answers a screen's data from its cache when the network
 * takes more than 3 s (service-worker.js, NetworkFirst), and stamps what it
 * stores with `x-dos-cached-at`. A response straight from the server never
 * carries that header, so its presence is exactly "this is the copy from
 * <time>". On a slow line the Desk showed a Delayed count that had already
 * changed, and nothing on screen said so. Screens read this through
 * useServedFromCache and say "Showing figures from 9:12 am". */
const cachedAnswers = new Map();          // request url -> ISO time it was stored
const cacheListeners = new Set();
const noteCache = (url, at) => {
  const had = cachedAnswers.get(url);
  if (at) cachedAnswers.set(url, at); else cachedAnswers.delete(url);
  if (had !== at) cacheListeners.forEach((fn) => { try { fn(); } catch (e) { /* a listener's own problem */ } });
};
api.interceptors.response.use((res) => {
  const url = String(res?.config?.url || "");
  if (url) noteCache(url, res?.headers?.["x-dos-cached-at"] || null);
  return res;
});
/** The oldest cached time among the answers whose url starts with one of
 *  `prefixes`, or null when every one of them came from the server. */
export function cachedSince(prefixes) {
  let oldest = null;
  cachedAnswers.forEach((at, url) => {
    if (prefixes.some((p) => url.startsWith(p)) && (!oldest || at < oldest)) oldest = at;
  });
  return oldest;
}
export function onCacheChange(fn) {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}

export default api;

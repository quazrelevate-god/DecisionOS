import axios from "axios";
import { showAiConsentToast } from "./aiConsent";

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

/* B04 (2026-09-29) — A REQUEST THAT NEVER ANSWERS MUST STILL END.
   There was no timeout, so axios inherited the browser's, which on a phone
   holding a dead Wi-Fi association can be minutes. Every screen that waits on
   a call sat on its skeleton for that whole time with nothing to press, and
   the cold-start check for the session never resolved either way — which is
   half of why a bad connection looked like being signed out.
   30s, not 15: the founder's phone is on a village 4G cell and the backend is
   in Singapore, and a slow answer is still an answer. The calls that are
   legitimately slower than this — an upload, or anything waiting on the AI —
   pass their own `timeout` at the call site and are unaffected. */
export const API_TIMEOUT_MS = 30000;

const api = axios.create({ baseURL: API, withCredentials: true, timeout: API_TIMEOUT_MS });

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

/* B27 (2026-09-29) — THE TOKEN THE NATIVE APP COULD NEVER READ.
   The double-submit above depends on document.cookie, and inside the Android
   app it is always empty: the page is served from https://localhost and the
   cookie belongs to the backend's own domain, so the platform jar sends it
   faithfully on every request while JS cannot see a thing. Harmless only
   because enforcement is off — the day it is switched on, every POST from the
   app (signing in included) would be refused, and nobody would connect the
   two.
   So the server now also hands the token back in a response header
   (core/security.set_csrf_cookie, and /auth/me for a session that is already
   signed in). This keeps the last one seen, in memory: it is per app run,
   never written to storage, and the cookie still wins wherever it is
   readable, so a browser behaves exactly as it did. */
let csrfFromHeader = "";

function csrfToken() {
  try {
    const hit = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
    if (hit) return decodeURIComponent(hit.slice(CSRF_COOKIE.length + 1));
  } catch (e) {
    /* no document (tests, SSR), or a webview with nothing readable */
  }
  return csrfFromHeader;
}

api.interceptors.response.use(
  (res) => { const t = res?.headers?.[CSRF_HEADER.toLowerCase()]; if (t) csrfFromHeader = t; return res; },
  (err) => {
    const t = err?.response?.headers?.[CSRF_HEADER.toLowerCase()];
    if (t) csrfFromHeader = t;
    return Promise.reject(err);
  }
);

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

/* B04 — AND THE CALLS THAT ARE HONESTLY SLOW KEEP THEIR TIME.
   A 30s ceiling is right for a screen waiting on a list and wrong for a bill
   being read by the AI or a voice note going up a village uplink. Rather than
   ask forty call sites to remember a number, the two shapes that are slow BY
   NATURE are recognised here: anything carrying a file, and the handful of
   endpoints that wait on a model. A call site that sets its own `timeout`
   still wins — that is what the comparison against the instance default is
   for. */
const SLOW_PATHS = ["/ask", "/transcribe", "/voice-notes", "/onboarding/", "/brain/documents", "/ingest/"];
export const SLOW_TIMEOUT_MS = 120000;
api.interceptors.request.use((config) => {
  if (config.timeout !== API_TIMEOUT_MS) return config;   // the caller chose
  const url = config.url || "";
  const carriesFile = typeof FormData !== "undefined" && config.data instanceof FormData;
  if (carriesFile || SLOW_PATHS.some((p) => url.includes(p))) config.timeout = SLOW_TIMEOUT_MS;
  return config;
});

/* WHAT A FOUNDER READS WHEN THE SERVER SAYS NO.
 *
 * FUP-46 (2026-08-15) made this stop collapsing FastAPI's 422 detail — an
 * array of {loc, msg, type} — into a JSON blob, and printed `loc: msg`
 * instead. That was right about the shape and wrong about the words, because
 * `msg` is pydantic talking to a developer. Seen on the signup reveal
 * (2026-09-29), directly under "Couldn't create your workspace":
 *
 *     email: value is not a valid email address: The part after the @-sign
 *     contains invalid characters: '@'.
 *
 * Nobody outside this repository knows what an @-sign rule is, and the one
 * thing the founder needed — go back and fix the address — is the one thing
 * it does not say. This is the only formatter the app has: 139 call sites in
 * 35 files, on every screen that can fail. So the words are written here,
 * once, from the reader's side.
 *
 * TRANSLATED FROM `type`, NOT FROM `msg`. The type is pydantic's stable
 * machine name for what went wrong; the msg is prose that changes between
 * versions and carries the internals. An unknown type still gets a sentence
 * that names the field and tells them to look at it, which is worse than a
 * bespoke line and far better than the parser's diary.
 *
 * A `detail` we wrote ourselves is a STRING and passes through untouched —
 * every deliberate message in this API is already written for the person
 * reading it, and this must never paraphrase those.
 */
const FIELD_WORDS = {
  email: "email address",
  support_email: "email address",
  phone: "mobile number",
  phone_token: "mobile number",
  code: "code",
  otp: "code",
  password: "password",
  company_name: "company name",
  name: "name",
  title: "title",
  amount: "amount",
  due_date: "date",
  date: "date",
  website: "website",
  industry: "industry",
  company_size: "team size",
  currency: "currency",
};

/** The field a founder would call it, or "" when we have no better word. */
function fieldWord(loc) {
  if (!Array.isArray(loc)) return "";
  const path = loc.filter((p) => !["body", "query", "path", "header"].includes(p));
  const last = path.filter((p) => typeof p === "string").pop();
  return (last && FIELD_WORDS[last]) || "";
}

function sentenceFor(entry) {
  const type = typeof entry.type === "string" ? entry.type : "";
  const word = fieldWord(entry.loc);
  const it = word || "that";
  if (type === "missing" || type === "value_error.missing") {
    return word ? `Your ${word} is needed.` : "Something needed was left out.";
  }
  if (word === "email address") return "That email address does not look right.";
  if (word === "mobile number") return "That mobile number does not look right.";
  if (type.startsWith("string_too_short") || type.startsWith("too_short")) {
    return `Your ${it} is too short.`;
  }
  if (type.startsWith("string_too_long") || type.startsWith("too_long")) {
    return `Your ${it} is too long.`;
  }
  if (type.includes("parsing") || type.includes("_type")) {
    return word ? `Check the ${word}.` : "One of the answers is in the wrong format.";
  }
  if (type.startsWith("greater_than") || type.startsWith("less_than")) {
    return word ? `That ${word} is out of range.` : "One of the numbers is out of range.";
  }
  return word ? `Check the ${word}.` : "One of the answers needs a second look.";
}

/* THE SERVER'S OWN VOCABULARY, WHICH IS NOT OURS. (2026-10-02.)
 *
 * Saving company details against a 500 put a toast on screen whose entire
 * text was
 *
 *     Internal Server Error
 *
 * Right mechanism, wrong words: no what-failed, no was-anything-saved, no
 * what-now. It arrives because an unhandled exception leaves FastAPI to answer
 * `{"detail": "Internal Server Error"}` and a string detail is passed straight
 * through -- correct for the sentences we wrote, wrong for the one phrase we
 * did not. Every 5xx in the app read like this.
 *
 * Matched WHOLE and case-insensitively, never as a substring: these are HTTP's
 * reason phrases verbatim, and no message we would write is exactly one of
 * them. A sentence of ours that merely CONTAINS "not found" is still ours.
 */
const FRAMEWORK_PHRASES = {
  "internal server error": "Something broke on our side. Nothing you did caused it — try again in a moment.",
  "bad gateway": "We couldn't reach our own server. Try again in a moment.",
  "service unavailable": "DecisionOS is briefly unavailable. Try again in a moment.",
  "gateway timeout": "Our server took too long to answer. Try again in a moment.",
  "request timeout": "That took too long to answer. Try again.",
  "not found": "We couldn't find that — it may have been deleted.",
  "unauthorized": "Your session has ended. Sign in and we'll bring you back.",
  "not authenticated": "Your session has ended. Sign in and we'll bring you back.",
  "forbidden": "You don't have access to that. Ask the owner if you need it.",
  "not enough permissions": "You don't have access to that. Ask the owner if you need it.",
  "method not allowed": "Something broke on our side. Nothing you did caused it — try again in a moment.",
  "unprocessable entity": "Some of what was sent didn't look right. Check the form and try again.",
  "too many requests": "That was a lot at once. Wait a moment and try again.",
  "payload too large": "That file is too big to send.",
  "request entity too large": "That file is too big to send.",
  "conflict": "Somebody else changed this first. Reload and try again.",
};

/** Our sentence for one of HTTP's reason phrases, or "" when it is not one. */
function humanPhrase(detail) {
  return FRAMEWORK_PHRASES[String(detail).trim().toLowerCase().replace(/\.$/, "")] || "";
}

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") {
    return humanPhrase(detail) || detail;          // ours, already in English
  }
  if (Array.isArray(detail)) {
    /* One sentence per field, and each field only once: a single bad address
       can arrive as two entries (the type rule and the format rule) and
       reading the same correction twice reads like two faults. */
    const seen = new Set();
    const out = [];
    detail.forEach((e) => {
      if (!e || typeof e !== "object") return;
      const line = sentenceFor(e);
      if (seen.has(line)) return;
      seen.add(line);
      out.push(line);
    });
    return out.join(" ") || "Something went wrong. Please try again.";
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string") return detail.message;
    if (typeof detail.msg === "string") return detail.msg;
  }
  return "Something went wrong. Please try again.";
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
    /* 2026-10-02 — THE TRANSLATION HAPPENS HERE, NOT AT THE CALL SITE.
     *
     * formatApiError turns HTTP's reason phrases into sentences, and 141
     * places use it. A census found 88 MORE that read e.response.data.detail
     * and show it raw, so approving a decision against a 500 still put the
     * words "Internal Server Error" on screen — the exact fault that fix was
     * for, surviving in a third of the app.
     *
     * Rewriting the detail once, here, reaches every one of them and every
     * one written tomorrow: by the time any call site sees it, the framework's
     * phrase is already a sentence. Only WHOLE matches are replaced, so our
     * own messages are untouched, and nothing in the app branches on these
     * strings (lib/aiConsent looks for its own code, which is not one).
     * A dict detail -- our {code, message} shape -- is left alone entirely.
     */
    try {
      const d = err?.response?.data;
      if (d && typeof d.detail === "string") {
        const said = humanPhrase(d.detail);
        if (said) d.detail = said;
      }
    } catch (e) { /* never let tidying the words swallow the error itself */ }

    if (err?.response?.status === 401) {
      const url = String(err?.config?.url || "");
      if (!AUTH_PATHS.some((p) => url.includes(p))) {
        try { window.dispatchEvent(new Event(SESSION_LOST_EVENT)); } catch (e) { /* no window */ }
      }
    }
    if (err?.response?.status === 451) {
      /* 2026-09-26 — the words, the debounce and the button now live in
         lib/aiConsent (the same helper the capture and extraction paths use),
         so a refusal reads the same wherever it lands, and an owner is offered
         the switch while everyone else is told who can throw it. */
      showAiConsentToast();
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

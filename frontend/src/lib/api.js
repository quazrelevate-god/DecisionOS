import axios from "axios";
import { toast } from "sonner";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const api = axios.create({ baseURL: API, withCredentials: true });

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
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 451) {
      // Debounce: don't fire the same toast 5x per second if many AI
      // calls fail in the same render.
      const now = Date.now();
      if (now - _consentToastShownAt > 8000) {
        _consentToastShownAt = now;
        toast.error(
          "AI features need your DPDP consent. Open Settings → AI Consent to enable, then try again.",
          {
            duration: 8000,
            action: {
              label: "Open Settings",
              onClick: () => { window.location.href = "/settings#ai-consent"; },
            },
          }
        );
      }
    }
    return Promise.reject(err);
  }
);

export default api;

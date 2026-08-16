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

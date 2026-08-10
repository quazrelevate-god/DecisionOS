import axios from "axios";

import { DEMO_MODE, demoAdapter } from "./demoData";

// An unset REACT_APP_BACKEND_URL used to produce the literal string
// "undefined/api". Falling back to "" yields a relative "/api" instead, which
// is what the CRA dev proxy and same-origin production both expect.
export const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const api = axios.create({ baseURL: API, withCredentials: true });

// Development-only: serve every call from local fixtures so the UI can be
// reviewed with no backend. See lib/demoData.js — this cannot engage in a
// production build.
if (DEMO_MODE) {
  api.defaults.adapter = demoAdapter;
  console.info("[DecisionOS] Demo mode — API calls served from local fixtures.");
}

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;

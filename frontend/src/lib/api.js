import axios from "axios";
import { safeText } from "./safeText";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const api = axios.create({ baseURL: API, withCredentials: true });

/**
 * Sanitise error detail at the boundary rather than at each call site.
 *
 * Most screens surface failures with `toast.error(e.response?.data?.detail)`,
 * reading the backend's message straight through. Patching those one by one
 * fixes the leaks we know about and none of the ones a future endpoint will
 * introduce, so the scrub happens here: every error that reaches any component
 * has already passed through the guard.
 */
api.interceptors.response.use(
  (r) => r,
  (error) => {
    const detail = error?.response?.data?.detail;
    if (typeof detail === "string") {
      error.response.data.detail = safeText(detail);
    }
    return Promise.reject(error);
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return safeText(detail);
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export default api;

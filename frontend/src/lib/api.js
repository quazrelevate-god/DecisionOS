import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const api = axios.create({ baseURL: API, withCredentials: true });

export function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
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

export default api;

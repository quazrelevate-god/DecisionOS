// MPWA-12a · fixture data layer (§4).
//
// §4 names the root cause of the shipped screens looking broken: "The shipped
// screens were only ever seen against one sparse tenant." So every layout is
// checked against three states, and `?fixture=empty|sparse|busy` swaps the data
// layer to reach them.
//
// DEVELOPMENT ONLY. The guard is on NODE_ENV, not on a feature flag, so a
// production bundle cannot serve fixture data even if someone links to
// `?fixture=busy` — see `isFixtureMode()`.
import { EMPTY } from "./empty";
import { SPARSE } from "./sparse";
import { BUSY } from "./busy";

export const FIXTURES = { empty: EMPTY, sparse: SPARSE, busy: BUSY };
export const FIXTURE_NAMES = ["empty", "sparse", "busy"];

export const FIXTURE_LABEL = {
  empty: "A · empty",
  sparse: "B · sparse",
  busy: "C · busy",
};

const isDev = () => process.env.NODE_ENV !== "production";

const STICKY_KEY = "dos_fixture";

/**
 * The active fixture name, or null when the real API should be used.
 *
 * Sticky within the tab: once `?fixture=busy` is seen it survives in-app
 * navigation, so the lab does not need every NavLink rewritten to carry the
 * param. `?fixture=off` clears it. sessionStorage rather than localStorage so a
 * new tab starts on real data — a persistent fixture would be a trap.
 */
export function activeFixture(search = typeof window === "undefined" ? "" : window.location.search) {
  if (!isDev()) return null;
  const v = new URLSearchParams(search).get("fixture");
  try {
    if (v === "off" || v === "none") {
      sessionStorage.removeItem(STICKY_KEY);
      return null;
    }
    if (FIXTURES[v]) {
      sessionStorage.setItem(STICKY_KEY, v);
      return v;
    }
    const stuck = sessionStorage.getItem(STICKY_KEY);
    return FIXTURES[stuck] ? stuck : null;
  } catch {
    return FIXTURES[v] ? v : null;
  }
}

export const isFixtureMode = (search) => activeFixture(search) !== null;

/**
 * Resolve an API path against the active fixture.
 *
 * Returns `{ hit: true, data }` when the fixture answers, `{ hit: false }` when
 * it does not — the caller then falls through to the network. Deliberately NOT
 * a catch-all: the fixture server built for MPWA-00 answered every unmapped
 * path with 200 OK, and that is exactly what let a wrong HTTP verb look correct
 * for eleven slices (see MPWA-13). A fixture that does not know an endpoint
 * should say so.
 */
export function resolveFixture(name, method, url) {
  const set = FIXTURES[name];
  if (!set) return { hit: false };
  const [rawPath, rawQuery = ""] = String(url).split("?");
  const path = rawPath.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const query = new URLSearchParams(rawQuery);

  // Writes are accepted and echoed so a fixture screen stays interactive, but
  // nothing is persisted — a fixture is for looking at layout, not for state.
  //
  // A handful of writes have to answer with a real shape rather than `ok: true`,
  // because the UI's next step reads a field out of the response. Listed
  // explicitly: an echo that silently lacked `id` is how MPWA-13's wrong-verb
  // class of bug survives.
  if (method && method.toUpperCase() !== "GET") {
    for (const w of set.writes || []) {
      if (typeof w.match === "string" ? w.match === path : w.match.test(path)) {
        return { hit: true, data: typeof w.data === "function" ? w.data({ path, query }) : w.data };
      }
    }
    return { hit: true, data: { ok: true, fixture: name } };
  }

  for (const entry of set.routes) {
    const m = typeof entry.match === "string" ? entry.match === path : entry.match.test(path);
    if (!m) continue;
    const data = typeof entry.data === "function" ? entry.data({ path, query, set }) : entry.data;
    return { hit: true, data };
  }
  return { hit: false };
}

/** Preserve `?fixture=` across in-app navigation so the lab stays in its state. */
export function withFixture(to, search = typeof window === "undefined" ? "" : window.location.search) {
  const f = activeFixture(search);
  if (!f) return to;
  const [p, q = ""] = String(to).split("?");
  const params = new URLSearchParams(q);
  params.set("fixture", f);
  return `${p}?${params.toString()}`;
}

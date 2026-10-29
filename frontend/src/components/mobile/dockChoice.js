/* What the phone's dock opens — the person's own choice (founder, 2026-10-29:
 * "a section in Preferences with a mock floating dock showing the current
 * items; tap one, pick another, and it replaces it in the dock").
 *
 * THREE PLACES ARE THEIRS TO CHOOSE. The bar is two destinations, the Dex
 * handle, one destination and More. The handle and More never move — one is
 * how Dex is reached, the other is how everything else is — so the choice is
 * the three slots around them. Out of the box they are what dockSlots has
 * always given this person (Desk · Work │ Money, or Work · CRM │ Money without
 * the Desk), and a choice can only ever name somewhere they may open: the
 * catalogue is built from the same permission checks the bar and the More
 * menu already make. A choice naming a page they have since lost is dropped
 * and the slot falls back to their default.
 *
 * Nothing appears twice: whatever leaves the bar is in More, and whatever
 * joins it leaves More (DockSlider's DockMore reads `rest`).
 *
 * Kept per person on this phone (localStorage), like My Work's own view
 * preferences; a change is announced so the live dock redraws at once.
 */
import * as React from "react";
import { dockSlots } from "./FloatingDock";
import { buildTiles } from "./AllAppsPanel";

export const DOCK_SLOTS = 3;
const EVENT = "dos:dock-changed";
const keyFor = (uid) => `dos:dock:${uid || "anon"}`;

/** Every destination this person may put in the bar, defaults first. */
export function dockCatalogue(user, t) {
  const tiles = buildTiles({ user, t }).map((x) => ({
    id: x.key, to: x.to, label: x.label, icon: x.icon, testid: `dock-${x.key}`,
  }));
  // `id`, not `key`: these are spread into <DockItem {...slot} />.
  const base = dockSlots(user, t).map((s) => ({ ...s, id: s.testid.replace(/^dock-/, "") }));
  const seen = new Set();
  return [...base, ...tiles].filter((s) => (seen.has(s.to) ? false : seen.add(s.to)));
}

export function readDockChoice(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(uid)) || "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch { return null; }
}

export function saveDockChoice(uid, paths) {
  try {
    if (paths) localStorage.setItem(keyFor(uid), JSON.stringify(paths));
    else localStorage.removeItem(keyFor(uid));
  } catch { /* storage blocked: the dock keeps its defaults */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** The three slots as chosen (or the defaults), and everything else (`rest`). */
export function resolveDock(user, t, chosen) {
  const catalogue = dockCatalogue(user, t);
  const byPath = new Map(catalogue.map((c) => [c.to, c]));
  const defaults = dockSlots(user, t).map((s) => s.to);
  const n = Math.min(DOCK_SLOTS, catalogue.length);
  const picked = [];
  const take = (to) => { if (picked.length < n && byPath.has(to) && !picked.includes(to)) picked.push(to); };
  (chosen || []).slice(0, n).forEach(take);
  defaults.forEach(take);
  catalogue.forEach((c) => take(c.to));
  const slots = picked.map((to) => byPath.get(to));
  const rest = catalogue.filter((c) => !picked.includes(c.to));
  return { slots, rest, catalogue, custom: !!chosen };
}

export function useDockChoice(user, t) {
  const uid = user?.id;
  const [chosen, setChosen] = React.useState(() => readDockChoice(uid));
  React.useEffect(() => {
    const sync = () => setChosen(readDockChoice(uid));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [uid]);
  const resolved = React.useMemo(() => resolveDock(user, t, chosen), [user, t, chosen]);
  const choose = React.useCallback((index, to) => {
    const paths = resolved.slots.map((s) => s.to);
    const already = paths.indexOf(to);
    if (already >= 0) paths[already] = paths[index];   // swapping two slots
    paths[index] = to;
    saveDockChoice(uid, paths);
  }, [resolved, uid]);
  const reset = React.useCallback(() => saveDockChoice(uid, null), [uid]);
  return { ...resolved, choose, reset };
}

/* ASK-36 2 · deferredDecisions — the decisions you SAW and walked away from.
 *
 * WHAT THIS IS FOR. Dex finishes reading a capture, the workspace shows what it
 * came to, and the founder presses "Later" instead of Review. The decision is
 * not lost — it sits in the Decisions column with everything else — but it is
 * indistinguishable from the ones that arrived while they were not looking, so
 * "where did that go?" has no answer on screen. This remembers the ones they
 * set aside, and the column draws those rows differently.
 *
 * WHY THE CLIENT AND NOT THE SERVER. There is no such field on a decision, and
 * there should not be one on my say-so: "I looked at this and deferred it" is a
 * fact about this person on this device, not about the decision. backend/ is
 * untouched. localStorage rather than memory, because the whole point is that
 * it survives the reload where the founder comes back looking for it.
 *
 * IT PRUNES ITSELF. A deferred id that no longer appears in the feed has been
 * approved or rejected, so it stops being deferred — pruneDeferred is called
 * with the live ids on every render of the column. Without that the list would
 * grow forever and a re-raised id could inherit an old highlight.
 *
 * Every read and write is wrapped: private windows and cleared site data both
 * throw on access, and a highlight is not worth a white screen.
 */
const KEY = "dos_deferred_decisions";
const listeners = new Set();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}
function write(ids) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* not worth a crash */ }
  listeners.forEach((fn) => fn(ids));
}

export function getDeferred() { return read(); }

/** Called when "Later" is pressed on a ready decision. */
export function deferDecision(id) {
  if (!id) return;
  const ids = read();
  if (ids.includes(id)) return;
  write([...ids, id]);
}

/** Called when the row is acted on — approved, rejected, or opened and decided. */
export function clearDeferred(id) {
  if (!id) return;
  const ids = read();
  if (!ids.includes(id)) return;
  write(ids.filter((x) => x !== id));
}

/** Drop anything that has left the feed. `live` is the ids currently shown. */
export function pruneDeferred(live) {
  const ids = read();
  if (!ids.length) return;
  const set = new Set(live);
  const kept = ids.filter((id) => set.has(id));
  if (kept.length !== ids.length) write(kept);
}

export function subscribeDeferred(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

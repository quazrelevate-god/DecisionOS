/* PILOT-1 A — WHAT A PERSON TYPES IS KEPT UNTIL THEY SEND IT OR THROW IT AWAY.
 *
 * The pilot client's voice note: a team member writes their answer on a task,
 * switches away to check something, comes back, and the answer is gone. Every
 * form in the app held its words in component state, so anything that took
 * the form off the screen took the words with it — a click beside the task
 * drawer, the phone's Back, going to another screen to look something up, and
 * the ones no code can stop: a phone that throws a backgrounded app away, or
 * Chrome discarding a tab to save memory, both of which reload the page.
 *
 * So the words are written down as they are typed, and read back when the form
 * opens again. The rules:
 *   - A draft comes back when its form reopens. Closing by accident is not a
 *     discard.
 *   - It goes on Post / Save, or on an explicit Cancel / Discard.
 *   - It belongs to one person in one company (`scope` = tenant + user), so a
 *     workspace switch or someone else signing in on this browser never sees
 *     it; and every draft is cleared when the person signs out.
 *   - It is kept on this device only, for at most DRAFT_TTL_DAYS: a sentence
 *     half-written a fortnight ago coming back would be a surprise, not a help.
 *
 * Storage is localStorage because it survives a reload AND the phone closing
 * the app; sessionStorage does not survive the second. Every access is guarded:
 * a private window, a full disk or blocked storage simply means no draft, never
 * a broken form.
 */

const PREFIX = "dos:draft:";
export const DRAFT_TTL_DAYS = 7;
const TTL_MS = DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

/** The person-in-a-company a draft belongs to, or null when nobody is signed in. */
export function draftScope(tenant, user) {
  return tenant?.id && user?.id ? `${tenant.id}:${user.id}` : null;
}

const keyOf = (scope, name) => `${PREFIX}${scope}:${name}`;

export function readDraft(scope, name) {
  const s = storage();
  if (!s || !scope || !name) return null;
  try {
    const raw = s.getItem(keyOf(scope, name));
    if (!raw) return null;
    const { v, at } = JSON.parse(raw);
    if (!at || Date.now() - at > TTL_MS) {
      s.removeItem(keyOf(scope, name));
      return null;
    }
    return v ?? null;
  } catch (e) {
    return null;
  }
}

export function writeDraft(scope, name, value) {
  const s = storage();
  if (!s || !scope || !name) return;
  try {
    s.setItem(keyOf(scope, name), JSON.stringify({ v: value, at: Date.now() }));
  } catch (e) { /* storage full or blocked: the form still works, it just forgets */ }
}

export function clearDraft(scope, name) {
  const s = storage();
  if (!s || !scope || !name) return;
  try { s.removeItem(keyOf(scope, name)); } catch (e) { /* nothing to clear */ }
}

export function hasDraft(scope, name) {
  return readDraft(scope, name) != null;
}

/** Is anything kept under this name or below it (`task-update:t_1` finds the
    task's own draft and every step's)? */
export function hasDraftUnder(scope, prefix) {
  const s = storage();
  if (!s || !scope || !prefix) return false;
  const head = keyOf(scope, prefix);
  try {
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && (k === head || k.startsWith(`${head}:`)) && readDraft(scope, k.slice(keyOf(scope, "").length)) != null) return true;
    }
  } catch (e) { /* storage blocked */ }
  return false;
}

/** Sign-out: every draft on this device goes, whoever and wherever it was for. */
export function clearAllDrafts() {
  const s = storage();
  if (!s) return;
  try {
    const doomed = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => s.removeItem(k));
  } catch (e) { /* storage blocked: nothing was kept either */ }
}

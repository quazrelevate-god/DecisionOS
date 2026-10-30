/* NF-4.22 / NF-4.23 (2026-10-31) — how often a task comes back, said one way
   everywhere: the Decision Desk's review, a task's drawer and My Work's filter.
   Mirrors services/recurrence (EVERY, describe) so the app and the server say
   the same words about the same routine.

   A cadence travels as {every, interval}: a task stores it as `recurrence`, a
   proposed task (not created yet) as repeat_every / repeat_interval. The short
   pickers offer the cadences companies actually keep; anything else a task
   already has (every 5 days) is added to the list so it can still be read. */

export function repeatLabel(rec) {
  if (!rec || !rec.every) return "";
  const n = parseInt(rec.interval, 10) || 1;
  return n === 1 ? `Every ${rec.every}` : `Every ${n} ${rec.every}s`;
}

export const proposalRepeat = (t) =>
  (t && t.repeat_every ? { every: t.repeat_every, interval: t.repeat_interval || 1 } : null);

export const isRepeating = (t) => !!(t && t.recurrence && t.recurrence.every);

const COMMON = [
  { every: "day", interval: 1 },
  { every: "week", interval: 1 },
  { every: "week", interval: 2 },
  { every: "month", interval: 1 },
  { every: "month", interval: 3 },
];

export const repeatValue = (rec) => (rec && rec.every ? `${rec.every}:${parseInt(rec.interval, 10) || 1}` : "");

export function repeatOptions(current) {
  const list = [...COMMON];
  if (current && current.every && !list.some((r) => repeatValue(r) === repeatValue(current))) list.push(current);
  return [{ value: "", label: "Just once" }, ...list.map((r) => ({ value: repeatValue(r), label: repeatLabel(r) }))];
}

/* "week:2" -> {every: "week", interval: 2}; "" -> null (just once). */
export function parseRepeatValue(v) {
  if (!v) return null;
  const [every, n] = String(v).split(":");
  return { every, interval: parseInt(n, 10) || 1 };
}

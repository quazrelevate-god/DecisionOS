// KM-10 · the calendar date helpers, extracted.
//
// /calendar minted these; /journal now needs the same week strip, and two
// copies of "what is today, locally" is exactly the kind of duplication that
// drifts — one file gets a timezone fix and the other quietly does not.

/**
 * Local YYYY-MM-DD.
 *
 * NOT toISOString().slice(0,10): that converts to UTC first, so anywhere east
 * of Greenwich "today" becomes yesterday for part of the day and the week strip
 * highlights the wrong cell.
 */
export const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/** Monday-first, matching Indian business practice and the calendar apps this
 *  is compared against. getDay() is Sunday-first, hence the shift. */
export const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));

/** Column headers for a Monday-first week strip. */
export const DOW = ["M", "T", "W", "T", "F", "S", "S"];

/** "Today" / "Tomorrow" / "Yesterday", else a full weekday-and-date. */
export const dayTitle = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  const today = ymd(new Date());
  if (iso === today) return "Today";
  if (iso === ymd(addDays(new Date(), 1))) return "Tomorrow";
  if (iso === ymd(addDays(new Date(), -1))) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
};

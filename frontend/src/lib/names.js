/* What the app calls a person in a greeting (client FEATURE-03, 2026-10-22).
 *
 * The same rule as backend/shared/names.py — change both:
 *   1. their own Preferred name (Settings -> Your profile), if set;
 *   2. else the first word of the name that is not an initial ("S Rhea" -> Rhea,
 *      "K.R.S. Rajesh" -> Rajesh, "SR Karthik" -> Karthik) or a title
 *      ("Dr. Kavya" -> Kavya);
 *   3. else the first word; else the fallback.
 * Two letters in ordinary case are a name (Om, Al) and are kept.
 */
const ONE_LETTER = /^[A-Za-z]\.?$/;
const DOTTED = /^(?:[A-Za-z]\.){2,3}$/;
const CAPITALS = /^[A-Z]{2,3}\.?$/;
const TITLE = /^(?:mr|mrs|ms|miss|dr|prof|er|smt)\.?$/i;

const isInitial = (word, moreFollow) =>
  ONE_LETTER.test(word) || DOTTED.test(word) || (moreFollow && (CAPITALS.test(word) || TITLE.test(word)));

export function greetingName(user, fallback = "") {
  const preferred = String(user?.preferred_name || "").trim();
  if (preferred) return preferred;
  const words = String(user?.name || "")
    .replace(/\b([A-Za-z])\.(?=[A-Za-z])/g, "$1. ")
    .split(/\s+/).map((w) => w.replace(/,+$/, "")).filter(Boolean);
  const found = words.find((w, i) => !isInitial(w, i < words.length - 1));
  return found || words[0] || fallback;
}

export function timeOfDay(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

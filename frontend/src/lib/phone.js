/* What counts as a mobile number we can sign someone in with (2026-09-19).
 *
 * The same rule as backend/services/auth/phone.py `valid_indian_mobile` —
 * keep the two in step (tests/test_founder_mobile_is_confirmed.py checks
 * this file for the pattern). The product is India-first and every
 * consumer of the number agrees: the sign-in lookup keeps the last ten
 * digits, the SMS gateway texts a bare ten-digit number, WhatsApp routing
 * matches on the same key.
 *
 * Ten digits starting 6-9, optionally written with +91, 91 or a leading 0,
 * with any spaces, dashes, brackets or dots. Anything else is refused rather
 * than guessed at: the old signup rule was "8 digits", which let through
 * numbers the OTP sign-in then refused.
 */
const MOBILE = /^[6-9]\d{9}$/;

/** The ten digits if `raw` is an Indian mobile, else "". */
export function normIndianMobile(raw) {
  if (typeof raw !== "string") return "";
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return MOBILE.test(d) ? d : "";
}

/** "+91 98765 43210" — how the number is written back on screen. */
export function displayIndianMobile(norm) {
  return norm && norm.length === 10 ? `+91 ${norm.slice(0, 5)} ${norm.slice(5)}` : norm || "";
}

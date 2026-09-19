/* What a new password has to be (2026-09-19).
 *
 * The same rule as backend/services/auth/passwords.py — keep the two in step.
 * Checked wherever a password is chosen (signup, reset, change, an owner
 * setting theirs), never at sign-in: older passwords keep working until
 * they're changed.
 */
export const PASSWORD_RULE = "Use at least 8 characters, with a letter and a number.";

/** "" when `pw` is acceptable as a new password, else the sentence to show. */
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return PASSWORD_RULE;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return PASSWORD_RULE;
  return "";
}

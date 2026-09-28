/* B11 (2026-09-29) · The dev OTP is a development convenience, and it now
 * behaves like one.
 *
 * A backend running without SMS configured hands the code back in the response
 * (`dev_otp`) so nobody on the team waits on a text. Five screens read that
 * field, auto-filled the boxes and toasted "Dev OTP: 123456 (auto-filled)" —
 * none of them asked which build they were in.
 *
 * That is fine until the production backend ever answers with it: an expired
 * SMS credit, a provider outage, a misread env var. At that moment the shipped
 * app would show anybody the code for ANY number they typed, and sign them in
 * as that person. The server must not send it in production — that is the real
 * fix and it belongs there — but the client should not be the only thing
 * standing between an ops mistake and an account takeover.
 *
 * So: one place, and it answers "" in a production build. `NODE_ENV` is
 * inlined by the bundler at build time, so a production bundle does not merely
 * skip the branch — the code and the toast string are eliminated from it.
 */
export function devOtpFrom(data) {
  if (process.env.NODE_ENV === "production") return "";
  const code = data?.dev_otp;
  return typeof code === "string" && code ? code : "";
}

export default devOtpFrom;

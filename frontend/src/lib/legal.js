/* The versions of what people agree to, and the signup AI consent.
 *
 * 2026-10-08 (Play audit C2, C4). Keep TERMS_VERSION equal to
 * backend/services/legal.py and AI_CONSENT_VERSION equal to
 * CURRENT_CONSENT_VERSION in backend/services/ai_consent.py — the server
 * refuses any other value.
 *
 * Signup runs before there is an account, so its AI consent cannot live on a
 * workspace. It is held here for the page's life (and in sessionStorage, so a
 * reload mid-signup does not ask again) and sent as X-AI-Consent on every
 * /signup/ request by lib/api.js; the AI signup endpoints refuse without it.
 */
export const TERMS_VERSION = "2026-10-08";
export const AI_CONSENT_VERSION = "1.0";

const KEY = "dos.signup.aiConsent";
let signupConsent = null;

export function getSignupConsent() {
  if (signupConsent) return signupConsent;
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v === AI_CONSENT_VERSION) signupConsent = v;
  } catch { /* storage blocked: ask again, which is the safe answer */ }
  return signupConsent;
}

export function giveSignupConsent() {
  signupConsent = AI_CONSENT_VERSION;
  try { window.sessionStorage.setItem(KEY, AI_CONSENT_VERSION); } catch { /* memory copy still holds */ }
}

export const termsAccepted = (user) => user?.terms_accepted?.version === TERMS_VERSION;

/* AI is off for this company — said once, in words, with the way to turn it on.
 *
 * 2026-09-26 (Yokesh, from a migrated customer's screen): the owner of
 * Tracole pressed the mic on the Desk and got
 *
 *     451: {'code': 'ai_consent_required', 'message': 'This AI feature is
 *     unavailable until your workspace owner grants consent for AI data
 *     processing.', 'current_version': '1.0', 'granted_version': None, ...}
 *
 * — a Python dict, printed at him. The words for this case already existed
 * (lib/dexOutcome.js) but only the capture-outcome path used them; every other
 * surface printed whatever the server said. Companies migrated from the old
 * product have no consent record (the feature post-dates their data), so this
 * is the FIRST thing many of them meet.
 *
 * The rule now: nothing prints a consent refusal raw. A refusal reaches a
 * person as one sentence and a button to the screen that fixes it —
 * Settings → Business → AI processing — and it reads differently for an owner
 * (who can turn it on) than for everyone else (who cannot, and should be told
 * to ask rather than sent to a dead end).
 *
 * It arrives in two shapes, both handled here:
 *   * a 451 response — any AI endpoint, through services/ai_consent.require_ai_consent;
 *   * a stored reason on a background job ("451: {'code': …}", from
 *     services/ai_consent.consent_error_detail), because a capture is processed
 *     after the request that started it has gone.
 */
import { toast } from "sonner";

export const AI_CONSENT_CODE = "ai_consent_required";
export const AI_CONSENT_HREF = "/settings?tab=business#ai-consent";

/* Who is looking, for the wording. AuthContext keeps this current; it is a
   module-level flag because the axios interceptor (lib/api.js) is not inside
   React and cannot read the context. Unknown = false: "ask an owner" is the
   safe thing to tell someone whose role we do not know. */
let _viewerIsOwner = false;
export function setViewerIsOwner(isOwner) {
  _viewerIsOwner = !!isOwner;
}

/** Is this a "the company has not agreed to AI" refusal, in any of its shapes? */
export function isAiConsentError(x) {
  if (!x) return false;
  if (x.response?.status === 451 || x.status === 451) return true;
  const detail = x.response?.data?.detail ?? x.detail ?? x;
  if (detail && typeof detail === "object" && detail.code === AI_CONSENT_CODE) return true;
  return typeof detail === "string" && detail.includes(AI_CONSENT_CODE);
}

/** The sentence for the person looking at it. */
export function aiConsentMessage(isOwner = _viewerIsOwner) {
  return isOwner
    ? "AI is off for this company. Turn it on in Settings → AI processing, then try again."
    : "AI is off for this company. An owner has to turn it on in Settings → AI processing.";
}

/* One toast at a time: a screen that fires five AI calls must not stack five
   copies of the same sentence. */
let _shownAt = 0;
const QUIET_MS = 8000;

/**
 * Say it, with the way out. Safe to call from anywhere an AI call can fail.
 * @returns true when this was a consent refusal (so the caller shows nothing else)
 */
export function showAiConsentToast(force = false) {
  const now = Date.now();
  if (!force && now - _shownAt < QUIET_MS) return true;
  _shownAt = now;
  toast.error(aiConsentMessage(), {
    duration: 8000,
    action: {
      // An owner lands on the button that turns it on; anyone else lands on the
      // same card, which says who agreed and that only an owner may change it.
      label: _viewerIsOwner ? "Turn on AI" : "See settings",
      onClick: () => { window.location.href = AI_CONSENT_HREF; },
    },
  });
  return true;
}

/**
 * The one line for "this failed — say why". Use it wherever a raw server
 * reason was being printed.
 * @returns true when it was the consent refusal and has been said properly
 */
export function toastAiConsentOr(error, fallback) {
  if (isAiConsentError(error)) return showAiConsentToast();
  toast.error(fallback);
  return false;
}

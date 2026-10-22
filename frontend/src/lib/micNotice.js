/* Said once, before the microphone or Dex is first used.
 *
 * 2026-10-08 (Play audit W5): the OS asks for the microphone, but cannot say
 * what happens to the audio. That had to be said in the app first.
 *
 * 2026-10-17 (App Store review, Guideline 5.1.2(i)): it said only half of it.
 * The notice named the speech providers (Sarvam or OpenAI) but never the AI
 * that understands a decision or answers a question (Anthropic, OpenAI and
 * Google Gemini), so anyone in a workspace where AI was already on, App
 * Review's account included, used Dex without being told where their words
 * went. And where AI was off, Dex recorded first and refused afterwards, in a
 * toast, with the recording lost. Now:
 *
 *   askBeforeMic()             — the notice, once per device (task proof, etc.)
 *   askBeforeMic({ ai: true }) — for Dex and dictation: if the company has not
 *                                agreed to AI, an owner is asked to, there and
 *                                then, before anything is recorded (anyone else
 *                                is told an owner has to); once it is on, the
 *                                notice, once.
 *
 * The key is new (v2) so everyone who saw the speech-only notice is shown the
 * whole one once. Signup's voice interview does not come through here: its own
 * consent step (pages/onboarding/SignupConsent) already said all of this.
 */
import api from "./api";
import { viewerIsOwner } from "./aiConsent";

const KEY = "dos.ai.noticeSeen.v2";
let pending = null;
let listener = null;
// Reads of the company's consent in flight: the dialog may be about to open.
let checking = 0;
// The company's AI consent, as last seen. The server is the authority (every AI
// endpoint refuses without it); this only saves a read before every recording.
let consent = null;

const seen = () => {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
};
const markSeen = () => {
  try { window.localStorage.setItem(KEY, "1"); } catch { /* asked again next time */ }
};

/** Is the notice or the consent step on screen (or a recording waiting on it)? */
export const isMicNoticeOpen = () => pending !== null || checking > 0;

/** Settings tells us when an owner turns AI on or off there. */
export function noteAiConsent(state) {
  consent = state || null;
}

/** The host registers here; it is told what to show (or null to close). */
export function onMicNotice(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

export function answerMicNotice(yes) {
  if (yes) markSeen();
  const p = pending;
  pending = null;
  listener?.(null);
  p?.resolve(Boolean(yes));
}

/** An owner agreeing from the dialog. Resolves the waiting recording on success;
 *  on failure returns the message to show and leaves the dialog open. */
export async function agreeToAi() {
  try {
    const { data } = await api.post("/tenant/ai-consent", { version: consent?.current_version, acknowledged: true });
    consent = data;
    answerMicNotice(true);
    return null;
  } catch (e) {
    const d = e?.response?.data?.detail;
    return typeof d === "string" && d ? d : "Couldn't turn AI on. Check your connection and try again.";
  }
}

export async function askBeforeMic({ ai = false } = {}) {
  if (!listener) return true;  // no host mounted (tests, isolated screens)
  if (pending) return pending.promise;
  let mode = null;
  if (ai && !consent?.active) {
    // Counted as "asking" while the read is in flight, so a screen waiting on
    // this recording (Decide's door) does not decide nothing started and close.
    checking += 1;
    try {
      const { data } = await api.get("/tenant/ai-consent");
      consent = data;
    } catch {
      consent = null;  // unknown: don't block; the server still refuses if it is off
    } finally {
      checking -= 1;
    }
    if (consent && !consent.active) mode = viewerIsOwner() ? "consent" : "off";
  }
  if (!mode && !seen()) mode = "notice";
  if (!mode) return true;
  if (pending) return pending.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  pending = { promise, resolve };
  listener({ mode, reconsent: !!consent?.needs_reconsent });
  return promise;
}

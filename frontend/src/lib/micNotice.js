/* Said once, before the microphone is first used (2026-10-08, Play audit W5).
 *
 * The microphone permission itself is asked by the OS when somebody taps the
 * mic, which is in context. What the OS prompt cannot say is what happens to
 * the audio: it is kept, with its transcript, in the workspace, and sent to a
 * speech-to-text provider. Google Play's User Data policy wants that said in
 * the app before the data is collected. askBeforeMic() resolves true straight
 * away once the person has seen it; the first time, it waits on the dialog
 * that components/MicNoticeHost draws.
 *
 * Signup's voice interview does not come through here: its own consent step
 * (pages/onboarding/SignupConsent) already said all of this.
 */
const KEY = "dos.mic.noticeSeen";
let pending = null;
let listener = null;

const seen = () => {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
};

/** The host registers here; it is told to open, and answers through `answer`. */
export function onMicNotice(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

export function answerMicNotice(yes) {
  if (yes) {
    try { window.localStorage.setItem(KEY, "1"); } catch { /* asked again next time */ }
  }
  const p = pending;
  pending = null;
  listener?.(false);
  p?.resolve(Boolean(yes));
}

export function askBeforeMic() {
  if (seen()) return Promise.resolve(true);
  if (!listener) return Promise.resolve(true);  // no host mounted (tests, isolated screens)
  if (pending) return pending.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  pending = { promise, resolve };
  listener(true);
  return promise;
}

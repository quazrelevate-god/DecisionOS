/* The one-time AI and microphone notice, and the AI consent step before Dex
   (lib/micNotice.js), drawn once for the app.

   Three faces:
     notice  — once per device: what is recorded, and every provider it goes to
     consent — Dex was asked for and the company has not agreed to AI; an owner
               agrees here, and the recording they started goes ahead
     off     — the same, for someone who is not an owner: who can turn it on */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Microphone, Sparkle } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { onMicNotice, answerMicNotice, agreeToAi } from "../lib/micNotice";
import { settingsName } from "../lib/aiConsent";

const PRIMARY = "flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white disabled:opacity-60";
const QUIET = "text-center text-xs font-semibold text-slate-600 underline underline-offset-2";

function HowWeHandleIt() {
  return (
    <Link to="/privacy" onClick={() => answerMicNotice(false)} data-testid="mic-notice-privacy"
      className="font-medium text-slate-900 underline underline-offset-2">How we handle it</Link>
  );
}

export default function MicNoticeHost() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onMicNotice((s) => { setState(s); setBusy(false); setError(""); }), []);
  if (!state) return null;
  const { mode, reconsent } = state;

  const agree = async () => {
    setBusy(true);
    setError("");
    const err = await agreeToAi();
    if (err) { setError(err); setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) answerMicNotice(false); }}>
      <DialogContent
        className="max-w-sm gap-4 rounded-[1.75rem] border-0 bg-[hsl(226_24%_92%)] p-6 sm:rounded-[1.75rem]"
        data-testid="mic-notice" data-mode={mode}>
        {mode === "notice" ? (
          <Microphone size={28} weight="duotone" className="text-slate-700" aria-hidden="true" />
        ) : (
          <Sparkle size={28} weight="duotone" className="text-slate-700" aria-hidden="true" />
        )}

        {mode === "notice" && (
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900">Before you use Dex</DialogTitle>
            <DialogDescription asChild>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">
                <p>
                  DecisionOS records your voice only while the mic is on. The recording is sent to a
                  speech-to-text provider (Sarvam or OpenAI) to turn it into text.
                </p>
                <p>
                  To understand a decision or answer a question, Dex sends that text and the workspace
                  records involved to DecisionOS&rsquo;s AI providers: <strong className="font-semibold text-slate-900">Anthropic,
                  OpenAI and Google (Gemini)</strong>.
                </p>
                <p>
                  Recordings and what they become are kept in your workspace, where your team can see them.
                  Nothing is used to train AI models and nothing is sold. <HowWeHandleIt />
                </p>
              </div>
            </DialogDescription>
          </div>
        )}

        {mode === "consent" && (
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900">
              {reconsent ? "Agree to AI again" : "Turn on AI for your company"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600" data-testid="mic-notice-consent">
                {reconsent && <p>The terms for AI processing have changed since they were agreed.</p>}
                <p>
                  Dex uses AI. Each feature sends what it needs (your voice recordings, the text you type,
                  the photos and documents you add, and the workspace records involved) to DecisionOS&rsquo;s
                  AI providers: <strong className="font-semibold text-slate-900">Anthropic, OpenAI and Google (Gemini)</strong> for
                  text and documents, and <strong className="font-semibold text-slate-900">Sarvam or OpenAI</strong> to turn
                  speech into text.
                </p>
                <p>
                  Nothing is used to train AI models and nothing is sold. You can turn AI off at any time
                  in {settingsName()} → AI processing. <HowWeHandleIt />
                </p>
              </div>
            </DialogDescription>
          </div>
        )}

        {mode === "off" && (
          <div>
            <DialogTitle className="text-lg font-semibold text-slate-900">AI is off for this company</DialogTitle>
            <DialogDescription asChild>
              <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-600">
                <p>
                  Dex uses AI providers (Anthropic, OpenAI and Google Gemini, and Sarvam or OpenAI for
                  speech), and an owner of your company has to agree to that first, in{" "}
                  {settingsName()} → AI processing.
                </p>
                <p>Ask an owner to turn it on, then try again. <HowWeHandleIt /></p>
              </div>
            </DialogDescription>
          </div>
        )}

        {error && <p className="text-sm font-medium text-rose-700" role="alert" data-testid="mic-notice-error">{error}</p>}

        {mode === "notice" && (
          <>
            <button type="button" onClick={() => answerMicNotice(true)} data-testid="mic-notice-yes" className={PRIMARY}>
              Continue
            </button>
            <button type="button" onClick={() => answerMicNotice(false)} data-testid="mic-notice-no" className={QUIET}>
              Not now
            </button>
          </>
        )}
        {mode === "consent" && (
          <>
            <button type="button" onClick={agree} disabled={busy} data-testid="mic-notice-agree" className={PRIMARY}>
              {busy ? "Turning on…" : "Agree and turn on AI"}
            </button>
            <button type="button" onClick={() => answerMicNotice(false)} disabled={busy} data-testid="mic-notice-no" className={QUIET}>
              Not now
            </button>
          </>
        )}
        {mode === "off" && (
          <button type="button" onClick={() => answerMicNotice(false)} data-testid="mic-notice-ok" className={PRIMARY}>
            OK
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

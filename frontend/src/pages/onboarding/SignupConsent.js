/* Asked before the first AI step of signup (2026-10-08, Play audit C2 + C4).
 *
 * Everything after the basics — the website scan, the voice interview, the
 * spoken questions, the blueprint — sends what the founder types or says to
 * our AI and speech providers. Consent used to be recorded only at the very
 * end, on "Enter DecisionOS", after all of that had already gone. Google
 * Play's User Data policy wants the disclosure first and an affirmative act
 * before any of it is collected, so this stands in front of the first such
 * step, and the server refuses those steps without it (X-AI-Consent).
 *
 * Two separate ticks, on purpose: the policy does not allow the data
 * disclosure to be bundled with unrelated agreements, and the Terms of
 * Service are unrelated to it.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "@phosphor-icons/react";

export function SignupConsent({ onAgree, onBack }) {
  const [ai, setAi] = useState(false);
  const [terms, setTerms] = useState(false);

  return (
    <div className="kr-well mx-auto w-full max-w-xl rounded-[1.75rem] p-6 sm:p-8" data-testid="signup-consent">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Before Dex starts</p>
      <h2 className="mt-2 font-display text-2xl text-foreground">Dex builds your workspace with AI</h2>

      <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground" data-testid="signup-consent-disclosure">
        <p>
          DecisionOS sends <strong className="text-foreground">your answers, your voice recordings and
          your company website</strong> to our AI and speech providers (Anthropic, OpenAI, Google, Sarvam)
          to set up your workspace, during this signup and when you use Dex afterwards.
        </p>
        <p>
          Recordings are turned into text and kept in your workspace. Nothing is used to train AI models,
          nothing is sold, and an owner can switch AI off in Settings at any time. DecisionOS&rsquo;s setup
          is done by AI, so without this we cannot build your workspace.
        </p>
      </div>

      <label className="mt-5 flex items-start gap-3 text-sm text-foreground">
        <input type="checkbox" className="mt-1" checked={ai} onChange={(e) => setAi(e.target.checked)}
          data-testid="signup-consent-ai" />
        <span>I agree to DecisionOS processing this with AI providers as described above.</span>
      </label>

      <label className="mt-3 flex items-start gap-3 text-sm text-foreground">
        <input type="checkbox" className="mt-1" checked={terms} onChange={(e) => setTerms(e.target.checked)}
          data-testid="signup-consent-terms" />
        <span>
          I am 18 or over and agree to the{" "}
          <Link to="/terms" className="font-medium underline underline-offset-2">Terms of Service</Link>
          {" "}and the{" "}
          <Link to="/privacy" className="font-medium underline underline-offset-2">Privacy Policy</Link>.
        </span>
      </label>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} data-testid="signup-consent-back"
          className="flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} weight="bold" /> Back
        </button>
        <button type="button" onClick={onAgree} disabled={!ai || !terms} data-testid="signup-consent-continue"
          className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-6 text-sm font-medium text-white disabled:opacity-40">
          Agree and continue <ArrowRight size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

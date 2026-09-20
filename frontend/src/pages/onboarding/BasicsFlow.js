import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Eye, EyeSlash } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { normIndianMobile, displayIndianMobile } from "../../lib/phone";
import OtpBoxes from "../../components/auth/OtpBoxes";
import { passwordProblem } from "../../lib/password";
// ASK-36 5 — the app's one loading animation.
import { Loader } from "../../components/common";

// KM-19 — rebuilt on the Karma material. The step used to be a black
// underline under a huge heading with a square indigo button beside it; the
// question now sits in a .kr-well pane, the field is a .kr-pressed trough
// (typing into something recessed is the one gesture this material makes
// obvious), and every button is .kr-pop.
const SIZES = ["1-10", "11-50", "51-200", "201-500", "500+"];
const first = (name) => (name || "").trim().split(/\s+/)[0] || "";

const STEPS = [
  {
    key: "company_name", eyebrow: "Your company", type: "text", placeholder: "e.g. Sharma Textiles",
    q: () => "What's your company called?",
    sub: () => "The name your customers know you by.",
    validate: (v) => (v.trim().length >= 2 ? "" : "Tell us your company name"),
  },
  {
    key: "name", eyebrow: "About you", type: "text", placeholder: "Your full name",
    q: (f) => `And who's running ${f.company_name.trim()}?`,
    sub: () => "You'll be the owner of this workspace.",
    validate: (v) => (v.trim().length >= 2 ? "" : "We'd love to know your name"),
  },
  {
    key: "email", eyebrow: "Sign-in", type: "email", placeholder: "you@company.com",
    q: (f) => `Nice to meet you, ${first(f.name)}. Your work email?`,
    sub: () => "This becomes your sign-in — we never spam.",
    validate: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? "" : "That email doesn't look right"),
    checkEmail: true,
  },
  {
    key: "password", eyebrow: "Sign-in", type: "password", placeholder: "8+ characters, a letter and a number",
    q: () => "Set a password for your executive office.",
    sub: () => "As the owner you'll sign in with this or your mobile. Your team signs in with their mobile.",
    // 2026-09-19 — 8+ characters with a letter and a number (lib/password.js).
    validate: (v) => passwordProblem(v),
  },
  /* 2026-09-19 — required, a real Indian mobile, and confirmed by a texted
     code before we move on. It is how the founder signs in on the mobile app
     (Mobile OTP), and WhatsApp from it lands in the workspace as them. It used
     to be optional with an "8 digits" check and stored on trust: a slip locked
     the founder out of Mobile OTP and gave whoever owns the mistyped number an
     owner's sign-in. The email stays the business address for support and
     receipts; this is the phone in their hand. */
  {
    key: "phone", eyebrow: "Mobile sign-in", type: "tel", placeholder: "+91 98765 43210",
    q: () => "Your mobile number?",
    sub: () => "You'll sign in with it on the mobile app. We'll text a code to confirm it's yours.",
    validate: (v) => (normIndianMobile(v) ? "" : "Enter a 10-digit Indian mobile number"),
    confirmByCode: true,
  },
  {
    key: "team_size", eyebrow: "Your team", type: "chips",
    q: (f) => `How many people work at ${f.company_name.trim()}?`,
    sub: () => "We shape your operating system around your size.",
    validate: (v) => (v ? "" : "Pick one"),
  },
];

const variants = {
  enter: { opacity: 0, y: 28 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -24 },
};

/* Which step the email is asked on. Derived, not a literal: the resume check
   below has to know it, and a step inserted above it must not silently move
   what gets re-verified. */
const EMAIL_IDX = STEPS.findIndex((s) => s.key === "email");

/* "taken" | "free" | "unknown" — THREE answers, not two.
   This used to be a try/catch that swallowed everything and carried on, and
   that is how a founder got all the way to the end of onboarding before being
   told the address was taken: /signup/check-email is rate limited (5 per 10s,
   30 an hour per IP) and CAPTCHA-gated, so a 429 or a 400 is an ordinary
   answer from it, not an exception — and both were being read as "fine".
   "unknown" is now a distinct answer the caller has to deal with, rather than
   a silence that looks like a pass. */
async function emailAvailability(email) {
  try {
    const { data } = await api.post("/signup/check-email", { email: String(email || "").trim() });
    return data && data.available === false ? "taken" : "free";
  } catch (e) {
    console.debug("check-email did not answer", e);
    return "unknown";
  }
}

export function BasicsFlow({ form, setForm, onDone, initialIndex = 0, onStepSaved,
                             resumed = false }) {
  const [idx, setIdx] = useState(initialIndex);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // The mobile step's second half: the number a code was texted to (""
  // while the number is still being typed), what they have entered, and
  // the resend clock (30s, the server's own cooldown).
  const [codeFor, setCodeFor] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  /* The address a check could not be run for. A second press on the SAME one
     goes through: an offline founder must not be walled out of their own
     signup, but they should be told once first rather than find out at the
     end. Cleared whenever the address changes. */
  const unverified = useRef("");
  const step = STEPS[idx];
  const value = form[step.key] || "";

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  /* A proof we already hold for exactly this number, with time to spare —
     a resumed signup, or Back then Continue — means no second text. Five
     minutes of margin so it cannot lapse between here and Create. */
  const alreadyConfirmed = (norm) =>
    !!norm && form.phone_verified_norm === norm && !!form.phone_token &&
    (!form.phone_token_expires_at || new Date(form.phone_token_expires_at).getTime() > Date.now() + 5 * 60 * 1000);

  const next = (whole) => {
    setError("");
    onStepSaved?.(step.key, whole[step.key], whole);
    if (idx + 1 >= STEPS.length) onDone();
    else setIdx(idx + 1);
  };

  const sendCode = async (norm) => {
    setSending(true); setError("");
    try {
      const { data } = await api.post("/signup/phone/send-code", { phone: norm });
      setCodeFor(norm);
      setCode(data.dev_otp || "");
      setResendIn(30);
      if (data.dev_otp) toast.info(`Dev OTP: ${data.dev_otp} (auto-filled)`);
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || "Couldn't text a code. Try again in a moment.");
    } finally {
      setSending(false);
    }
  };

  const confirmCode = async (typed) => {
    const c = (typed ?? code).trim();
    if (c.length !== 6 || sending) return;
    setSending(true); setError("");
    try {
      const { data } = await api.post("/signup/phone/verify", { phone: codeFor, code: c });
      const whole = {
        ...form, phone: data.phone, phone_token: data.phone_token,
        phone_verified_norm: codeFor, phone_token_expires_at: data.expires_at,
      };
      setForm(whole);
      setCodeFor(""); setCode(""); setResendIn(0);
      next(whole);
    } catch (e) {
      setCode("");
      setError(formatApiError(e.response?.data?.detail) || "That code didn't work. Try again.");
    } finally {
      setSending(false);
    }
  };

  /* A RESUMED SIGNUP RE-CHECKS THE ADDRESS IT IS ABOUT TO REUSE.

     This is the bug a founder hit: the wizard reopens at the first unanswered
     question, and the password is never saved, so that is ALWAYS the password
     step — one past the email. The saved address was therefore carried through
     the whole of onboarding without ever being checked again, and the
     collision surfaced at register, after the departments and workflows had
     been built. Once a draft existed, every later attempt behaved that way:
     the email step was not shown, so there was nothing to correct.

     So when we open past that step with an address already in hand, we ask
     about it once. If it is taken the founder lands ON the email step with the
     reason, before spending another minute. "unknown" is left alone — it is
     re-asked before the build, and a founder returning on a bad connection
     should not be held at the door. */
  const resumeChecked = useRef(false);
  useEffect(() => {
    if (initialIndex <= EMAIL_IDX) return;
    const email = String(form.email || "").trim();
    if (!email) return;
    /* Once per mount. StrictMode runs an effect twice in development, and
       /signup/check-email allows five requests in ten seconds — spending two
       of them to answer one question would leave a founder who presses Back
       and Continue a couple of times hitting the limit on their own signup. */
    if (resumeChecked.current) return;
    resumeChecked.current = true;
    /* No cancellation flag, deliberately. Pairing one with the ref guard is
       what broke this the first time: StrictMode runs the effect, tears it
       down, and runs it again, so the flag from the FIRST run cancelled the
       only request the guard allowed, and the answer was thrown away. There
       is nothing to leak here — the worst case is a setState on a component
       that has gone, which React 18 ignores. */
    (async () => {
      const verdict = await emailAvailability(email);
      if (verdict !== "taken") return;
      setIdx(EMAIL_IDX);
      setError("This email already has a workspace — sign in instead, or use another address.");
    })();
    // Once, on mount: this answers "what was restored", not "what is typed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(t);
  }, [idx]);

  const advance = async (override) => {
    const v = override !== undefined ? override : value;
    const err = step.validate(v);
    if (err) { setError(err); return; }
    if (step.confirmByCode) {
      const norm = normIndianMobile(v);
      if (alreadyConfirmed(norm)) { next({ ...form, [step.key]: displayIndianMobile(norm) }); return; }
      await sendCode(norm);
      return;
    }
    if (step.checkEmail) {
      setChecking(true);
      const verdict = await emailAvailability(v);
      setChecking(false);
      if (verdict === "taken") {
        setError("This email already has a workspace — sign in instead, or use another address.");
        return;
      }
      if (verdict === "unknown" && unverified.current !== v.trim()) {
        unverified.current = v.trim();
        setError("We couldn't check this address just now. Press continue again to carry on — we'll confirm it before your workspace is built.");
        return;
      }
    }
    setError("");
    // Keep what they typed, step by step, so closing the tab costs nothing.
    onStepSaved?.(step.key, v, { ...form, [step.key]: v });
    if (idx + 1 >= STEPS.length) onDone();
    else setIdx(idx + 1);
  };

  const back = () => {
    if (codeFor) { setCodeFor(""); setCode(""); setError(""); return; }   // back to the number
    if (idx > 0) { setError(""); setIdx(idx - 1); }
  };
  const setVal = (v) => {
    if (step.key === "email" && unverified.current && unverified.current !== String(v).trim()) unverified.current = "";
    setForm((f) => ({ ...f, [step.key]: v }));
    if (error) setError("");
  };

  return (
    <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-basics">
      <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
      {/* 2026-09-17 — a founder who closed the tab reopens here, three answers
          in, with no idea why. Say it once, on the step they land on. */}
      {resumed && idx === initialIndex && (
        <p data-testid="signup-resumed-note" className="mb-5 text-sm text-muted-foreground">
          Welcome back{first(form.name) ? `, ${first(form.name)}` : ""} — we kept your answers.
          Just your password again, and you&apos;re on.
        </p>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step.key} variants={variants} initial="enter" animate="center" exit="exit"
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <p className="mb-3 flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="kr-pressed grid h-6 min-w-[1.75rem] place-items-center rounded-pill px-2 text-[11px] tabular-nums">
              {String(idx + 1).padStart(2, "0")}
            </span>
            {step.eyebrow}
          </p>
          <h1 className="mb-2 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
            {step.confirmByCode && codeFor ? "Enter the code we just texted you." : step.q(form)}
          </h1>
          <p className="mb-7 text-sm text-muted-foreground">
            {step.confirmByCode && codeFor ? "Six digits. It works for five minutes." : step.sub(form)}
          </p>

          {step.type === "chips" ? (
            <div className="flex flex-wrap gap-3" data-testid="signup-team-size-chips">
              {SIZES.map((s, i) => (
                <motion.button key={s} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  data-testid={`team-size-${s}`}
                  onClick={() => { setVal(s); advance(s); }}
                  /* No transition utility here: .kr-pop and .kr-pressed swap
                     outset for inset shadows, which do not interpolate, so a
                     declared transition would stall the swap. */
                  aria-pressed={value === s}
                  whileHover={value === s ? undefined : { y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className={`flex h-12 items-center rounded-pill px-6 text-base font-semibold ${value === s ? "kr-chip-on" : "kr-pop"}`}>
                  {s}
                </motion.button>
              ))}
            </div>
          ) : step.confirmByCode && codeFor ? (
            <div data-testid="signup-phone-code">
              <div className="kr-pressed flex items-center justify-between gap-3 rounded-pill px-4 py-2.5">
                <span className="truncate text-sm">
                  Code sent to <strong data-testid="signup-phone-code-to">{displayIndianMobile(codeFor)}</strong>
                </span>
                <button type="button" onClick={back} data-testid="signup-phone-change"
                  className="shrink-0 text-xs font-semibold text-foreground/80 underline underline-offset-2 hover:text-foreground">
                  Change number
                </button>
              </div>
              <div className="mt-5 max-w-sm">
                <OtpBoxes value={code} disabled={sending} testid="signup-phone-code-boxes"
                  onChange={(v) => { setCode(v); if (error) setError(""); if (v.length === 6) confirmCode(v); }} />
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <motion.button onClick={() => confirmCode()} disabled={sending || code.length !== 6}
                  data-testid="signup-phone-confirm"
                  whileHover={{ y: -2, scale: 1.03 }} whileTap={{ scale: 0.98 }}
                  className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-8 text-sm font-medium text-white disabled:opacity-50">
                  {sending ? <Loader size={18} /> : null}
                  Confirm <ArrowRight size={16} weight="bold" />
                </motion.button>
                {resendIn > 0 ? (
                  <span className="text-xs text-muted-foreground" data-testid="signup-phone-resend-wait">
                    Text it again in <span className="font-semibold tabular-nums">{resendIn}s</span>
                  </span>
                ) : (
                  <button type="button" onClick={() => sendCode(codeFor)} disabled={sending}
                    data-testid="signup-phone-resend"
                    className="text-xs font-semibold text-foreground/80 underline underline-offset-2 hover:text-foreground disabled:opacity-50">
                    Didn&apos;t get it? Text it again
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="relative">
              <input
                ref={inputRef}
                data-testid={`signup-input-${step.key}`}
                type={step.type === "password" && showPw ? "text" : step.type}
                placeholder={step.placeholder}
                value={value}
                onChange={(e) => setVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); advance(); } }}
                /* KM-66 follow-up: focus ring is a thin, softened ink line
                   (foreground/40, ring-1). Full black at ring-2 read as a
                   heavy frame around the field; a single hairline at 40%
                   ink says "focus" without dressing up as a border. */
                className="kr-pressed w-full rounded-2xl bg-transparent px-5 py-4 pr-14 text-xl font-semibold tracking-tight placeholder:font-normal placeholder:text-foreground/25 focus:outline-none focus:ring-1 focus:ring-foreground/40 sm:text-2xl"
              />
              {step.confirmByCode && alreadyConfirmed(normIndianMobile(value)) && (
                <p className="mt-3 text-sm font-medium text-success-600" data-testid="signup-phone-confirmed">
                  Confirmed — no need for another code.
                </p>
              )}
              {step.type === "password" && (
                <button type="button" onClick={() => setShowPw(!showPw)} data-testid="signup-toggle-password"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  /* CENTRED WITHOUT A TRANSFORM, and that is the fix rather
                     than a preference. It used to be `top-1/2 -translate-y-1/2`,
                     and .signup-stage .kr-pop:hover sets `transform:
                     translateY(-2px)` — a whole-property override, so the
                     moment the pointer arrived the centring translate was
                     replaced by the lift and the button dropped half its own
                     height, out from under the cursor. Losing the pointer
                     removed :hover, which put it back, which caught the
                     pointer again: it flickered in place and was very hard to
                     click. inset-y-0 + my-auto centres a fixed-height
                     absolute box with no transform at all, so the hover lift
                     is the only one there is and it composes with nothing. */
                  className="kr-pop absolute inset-y-0 right-2.5 my-auto grid h-9 w-9 place-items-center rounded-full text-muted-foreground">
                  {showPw ? <EyeSlash size={22} weight="bold" /> : <Eye size={22} weight="bold" />}
                </button>
              )}
            </div>
          )}

          {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="signup-basics-error"
            className="mt-3 text-sm font-semibold text-danger-600">{error}</motion.p>}

          {step.type !== "chips" && !(step.confirmByCode && codeFor) && (
            <div className="mt-8 flex items-center gap-4">
              {/* KM-66 follow-up: Continue elevates on hover. -2px lift +
                  1.03 scale via framer whileHover — same grammar as the
                  Login demo pill. No idle animation. */}
              <motion.button onClick={() => advance()} disabled={checking || sending} data-testid="signup-basics-next"
                whileHover={{ y: -2, scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-8 text-sm font-medium text-white disabled:opacity-50">
                {checking || sending ? <Loader size={18} /> : null}
                {step.optional && !value.trim() ? "Skip"
                  : step.confirmByCode && !alreadyConfirmed(normIndianMobile(value)) ? "Text me a code"
                  : "Continue"} <ArrowRight size={16} weight="bold" />
              </motion.button>
              <span className="hidden text-xs text-muted-foreground sm:block">
                press <kbd className="kr-pressed rounded-md px-1.5 py-0.5 text-[11px]">Enter ↵</kbd>
              </span>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {idx > 0 && (
        <button onClick={back} data-testid="signup-basics-back"
          className="kr-pop mt-8 flex h-9 items-center gap-1.5 rounded-pill px-4 text-xs font-medium text-muted-foreground">
          <ArrowLeft size={14} weight="bold" /> Back
        </button>
      )}
      </div>
    </div>
  );
}

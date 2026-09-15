import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Eye, EyeSlash, CircleNotch } from "@phosphor-icons/react";
import api from "../../lib/api";

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
    key: "password", eyebrow: "Sign-in", type: "password", placeholder: "Minimum 6 characters",
    q: () => "Set a password for your executive office.",
    sub: () => "You can also sign in with mobile OTP later.",
    validate: (v) => (v.length >= 6 ? "" : "At least 6 characters, please"),
  },
  {
    key: "phone", eyebrow: "Optional", type: "tel", placeholder: "+91 98765 43210", optional: true,
    q: () => "Your mobile number?",
    sub: () => "For one-tap OTP login and WhatsApp updates. Skip if you like.",
    validate: (v) => (!v.trim() || v.replace(/\D/g, "").length >= 8 ? "" : "That number looks too short"),
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

export function BasicsFlow({ form, setForm, onDone }) {
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const inputRef = useRef(null);
  const step = STEPS[idx];
  const value = form[step.key] || "";

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(t);
  }, [idx]);

  const advance = async (override) => {
    const v = override !== undefined ? override : value;
    const err = step.validate(v);
    if (err) { setError(err); return; }
    if (step.checkEmail) {
      setChecking(true);
      try {
        const { data } = await api.post("/signup/check-email", { email: v.trim() });
        if (!data.available) { setError("This email already has a workspace — sign in instead."); setChecking(false); return; }
      } catch (e) { console.debug("email availability check skipped (network) — register validates later", e); }
      setChecking(false);
    }
    setError("");
    if (idx + 1 >= STEPS.length) onDone();
    else setIdx(idx + 1);
  };

  const back = () => { if (idx > 0) { setError(""); setIdx(idx - 1); } };
  const setVal = (v) => { setForm((f) => ({ ...f, [step.key]: v })); if (error) setError(""); };

  return (
    <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-basics">
      <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
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
            {step.q(form)}
          </h1>
          <p className="mb-7 text-sm text-muted-foreground">{step.sub(form)}</p>

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
              {step.type === "password" && (
                <button type="button" onClick={() => setShowPw(!showPw)} data-testid="signup-toggle-password"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="kr-pop absolute right-2.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground">
                  {showPw ? <EyeSlash size={22} weight="bold" /> : <Eye size={22} weight="bold" />}
                </button>
              )}
            </div>
          )}

          {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="signup-basics-error"
            className="mt-3 text-sm font-semibold text-danger-600">{error}</motion.p>}

          {step.type !== "chips" && (
            <div className="mt-8 flex items-center gap-4">
              {/* KM-66 follow-up: Continue elevates on hover. -2px lift +
                  1.03 scale via framer whileHover — same grammar as the
                  Login demo pill. No idle animation. */}
              <motion.button onClick={() => advance()} disabled={checking} data-testid="signup-basics-next"
                whileHover={{ y: -2, scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-8 text-sm font-medium text-white disabled:opacity-50">
                {checking ? <CircleNotch size={16} className="animate-spin" /> : null}
                {step.optional && !value.trim() ? "Skip" : "Continue"} <ArrowRight size={16} weight="bold" />
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

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Eye, EyeSlash, CircleNotch } from "@phosphor-icons/react";
import api from "../../lib/api";

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
    <div className="w-full max-w-2xl mx-auto" data-testid="signup-basics">
      <AnimatePresence mode="wait">
        <motion.div key={step.key} variants={variants} initial="enter" animate="center" exit="exit"
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <p className="label-mono text-brand-600 mb-3 flex items-center gap-3">
            <span className="tabular-nums text-muted-foreground">{String(idx + 1).padStart(2, "0")}</span>
            {step.eyebrow}
          </p>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-2">
            {step.q(form)}
          </h1>
          <p className="text-sm text-muted-foreground mb-8">{step.sub(form)}</p>

          {step.type === "chips" ? (
            <div className="flex flex-wrap gap-3" data-testid="signup-team-size-chips">
              {SIZES.map((s, i) => (
                <motion.button key={s} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  data-testid={`team-size-${s}`}
                  onClick={() => { setVal(s); advance(s); }}
                  className={`px-6 py-4 border border-border font-heading font-black uppercase tracking-tight text-lg transition-all hover:-translate-y-0.5 ${value === s ? "bg-primary text-primary-foreground" : "bg-white"}`}>
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
                className="w-full bg-transparent border-b-2 border-border py-3 pr-12 font-heading text-2xl sm:text-3xl font-bold tracking-tight placeholder:text-black/20 placeholder:font-normal focus:outline-none focus:border-brand-600 transition-colors"
              />
              {step.type === "password" && (
                <button type="button" onClick={() => setShowPw(!showPw)} data-testid="signup-toggle-password"
                  className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-brand-ink">
                  {showPw ? <EyeSlash size={22} weight="bold" /> : <Eye size={22} weight="bold" />}
                </button>
              )}
            </div>
          )}

          {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="signup-basics-error"
            className="mt-3 text-sm text-danger-600 font-semibold">{error}</motion.p>}

          {step.type !== "chips" && (
            <div className="mt-8 flex items-center gap-4">
              <button onClick={() => advance()} disabled={checking} data-testid="signup-basics-next"
                className="flex items-center gap-2 bg-primary text-primary-foreground font-medium text-sm px-8 py-3.5 border border-border hover:-translate-y-0.5 transition-all disabled:opacity-50">
                {checking ? <CircleNotch size={16} className="animate-spin" /> : null}
                {step.optional && !value.trim() ? "Skip" : "Continue"} <ArrowRight size={16} weight="bold" />
              </button>
              <span className="hidden sm:block text-xs text-muted-foreground font-mono">press <kbd className="border border-border px-1.5 py-0.5">Enter ↵</kbd></span>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {idx > 0 && (
        <button onClick={back} data-testid="signup-basics-back"
          className="mt-10 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-brand-ink transition-colors">
          <ArrowLeft size={14} weight="bold" /> Back
        </button>
      )}
    </div>
  );
}

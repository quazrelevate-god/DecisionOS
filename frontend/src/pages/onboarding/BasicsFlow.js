import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { normIndianMobile, displayIndianMobile } from "../../lib/phone";
import OtpBoxes from "../../components/auth/OtpBoxes";
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
  /* 2026-09-19 — required, a real Indian mobile, and confirmed by a texted
     code before we move on. It is how the founder signs in on the mobile app
     (Mobile OTP), and WhatsApp from it lands in the workspace as them. It used
     to be optional with an "8 digits" check and stored on trust: a slip locked
     the founder out of Mobile OTP and gave whoever owns the mistyped number an
     owner's sign-in. The email stays the business address for support and
     receipts; this is the phone in their hand.

     2026-09-20 — AND IT IS THE FIRST QUESTION OF ALL (Yokesh). A founder may
     run more than one company here: the mobile is the person, the email is one
     per company. It used to be asked third, after a name — so a returning
     founder could type any name they liked and then be greeted, correctly but
     jarringly, as whoever the number belongs to ("type Nitish, hear Welcome
     back Rajesh"). Asking it first means we know WHO before we ask anything
     about them: a number we know is greeted by name and never asked for one,
     and a number we don't goes on to name and company as before. Nothing about
     the number is shown until the code confirms it, so a stranger's number
     still tells the typist nothing. */
  {
    key: "phone", eyebrow: "Mobile sign-in", type: "tel", placeholder: "+91 98765 43210",
    q: () => "Let's start with your mobile number.",
    sub: () => "This is how you sign in — we'll text a code to confirm it's yours.",
    validate: (v) => (normIndianMobile(v) ? "" : "Enter a 10-digit Indian mobile number"),
    confirmByCode: true,
    skipWhenSignedIn: true,
  },
  {
    key: "name", eyebrow: "About you", type: "text", placeholder: "Your full name",
    q: () => "And your name?",
    sub: () => "You'll be the owner of this workspace.",
    validate: (v) => (v.trim().length >= 2 ? "" : "We'd love to know your name"),
    onlyWhenNew: true,
  },
  {
    key: "company_name", eyebrow: "Your company", type: "text", placeholder: "e.g. Sharma Textiles",
    // A founder we already know is greeted by the name on their account — the
    // one thing we are sure of — rather than by anything typed on this screen.
    q: (f, who) => (who ? `Hello ${first(who)} — what's your new company called?`
      : "What's your company called?"),
    sub: () => "The name your customers know you by.",
    validate: (v) => (v.trim().length >= 2 ? "" : "Tell us your company name"),
  },
  /* 2026-09-20 (Yokesh) — NOBODY SETS A PASSWORD TO GET IN HERE. "We don't need
     that password — let them log in by mobile itself." The number was confirmed
     one step ago and it is the whole sign-in, for the founder exactly as for
     every member. The address below is how support and receipts reach them, and
     it is where a password lives IF they ever add one (Settings › Your Profile);
     nothing in signup asks for one. */
  {
    key: "email", eyebrow: "Support", type: "email", placeholder: "you@company.com",
    q: (f) => `Nice to meet you, ${first(f.name)}. Your work email?`,
    sub: () => "For receipts and support. You'll sign in with your mobile.",
    validate: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? "" : "That email doesn't look right"),
    checkEmail: true,
    onlyWhenNew: true,
  },
  /* 2026-09-20 (Yokesh) — a SECOND company still wants an address, just not a
     second sign-in: "I just get the email for the support thing, so there's no
     need for the password asking." So this is the COMPANY's address — support,
     receipts — saved on the workspace, not on their account. It may be the very
     address their first company uses, because it is contact detail and not an
     account, and it can be skipped and filled in later in Settings. The
     password step above is never shown to them. */
  {
    key: "support_email", eyebrow: "Support", type: "email", placeholder: "you@company.com",
    q: (f) => `Where should support reach you about ${f.company_name.trim()}?`,
    sub: () => "For receipts and support about this company. You can skip it and add it in Settings.",
    validate: (v) => (!v.trim() || /^\S+@\S+\.\S+$/.test(v.trim()) ? "" : "That email doesn't look right"),
    optional: true,
    onlyWhenKnown: true,
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

/* The steps this founder is actually asked. A founder whose mobile already
   signs in somewhere is a person we know: they set no second password and pick
   no second sign-in address, so those two steps are not in their wizard at all
   (2026-09-20). Everything below indexes into THIS list, never into STEPS. */
const stepsFor = (identityKnown, signedIn) => STEPS.filter((st) => {
  // Already signed in and creating another company: the session is who they
  // are, so there is no number to confirm and no code to wait for.
  if (signedIn && st.skipWhenSignedIn) return false;
  return identityKnown ? !st.onlyWhenNew : !st.onlyWhenKnown;
});

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

export function BasicsFlow({ form, setForm, onDone, initialStep = "", onStepSaved,
                             resumed = false, identity, onIdentity }) {
  // Which question we are on is held as a KEY, not a number: the list itself
  // changes length once we know who this is.
  const identityKnown = !!identity?.known;
  // `fromSession` — they are signed in and pressed "Add a company", so their
  // mobile was confirmed long ago and register reads it from the session.
  const steps = stepsFor(identityKnown, !!identity?.fromSession);
  const [idx, setIdx] = useState(() => {
    const at = steps.findIndex((st) => st.key === initialStep);
    return at === -1 ? 0 : at;
  });
  /* What this number already reaches, answered by /signup/phone/verify the
     moment the code is confirmed: {workspaces, pending_invites, name}. Null
     until then; a founder whose number is new never sees this panel. */
  const [existing, setExisting] = useState(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  // The mobile step's second half: the number a code was texted to (""
  // while the number is still being typed), what they have entered, and
  // the resend clock (30s, the server's own cooldown).
  const [codeFor, setCodeFor] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  /* The address a check could not be run for. A second press on the SAME one
     goes through: an offline founder must not be walled out of their own
     signup, but they should be told once first rather than find out at the
     end. Cleared whenever the address changes. */
  /* The address a check could not be run for. It is STATE, not a ref, and it
     is cleared by a deliberate click rather than by pressing the same key
     again — see the note where it is set. */
  const [unverified, setUnverified] = useState("");
  const step = steps[idx] || steps[0];
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
    if (idx + 1 >= steps.length) onDone();
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
      /* 2026-09-20 — the number is confirmed, so we can say what it already
         reaches. Companies they are in, and invitations they have not opened.
         Nothing to show means a number we have never seen: carry on and ask
         for an email and a password as before. */
      const runs = data.workspaces || [];
      const invited = data.pending_invites || [];
      if (runs.length || invited.length) {
        setExisting({ workspaces: runs, pending_invites: invited, name: data.name || "", whole });
        return;
      }
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
     should not be held at the door.

     2026-09-20 — a founder we already know has no email step to land on and no
     address to collide with, so there is nothing to ask about. */
  const resumeChecked = useRef(false);
  useEffect(() => {
    const emailIdx = steps.findIndex((st) => st.key === "email");
    if (emailIdx === -1 || idx <= emailIdx) return;
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
      setIdx(steps.findIndex((st) => st.key === "email"));
      setError("This email already has a workspace — sign in instead, or use another address.");
    })();
    // Once, on mount: this answers "what was restored", not "what is typed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 380);
    return () => clearTimeout(t);
  }, [idx]);

  // The email and password steps disappear the moment we know who this is.
  useEffect(() => {
    if (idx > steps.length - 1) setIdx(steps.length - 1);
  }, [idx, steps.length]);

  /* opts.skipEmailCheck is set by ONE caller: the "Continue anyway" button.
     Pressing the key again must never be a way past the notice — see below. */
  const advance = async (override, opts = {}) => {
    const v = override !== undefined ? override : value;
    const err = step.validate(v);
    if (err) { setError(err); return; }
    if (step.confirmByCode) {
      const norm = normIndianMobile(v);
      if (alreadyConfirmed(norm)) { next({ ...form, [step.key]: displayIndianMobile(norm) }); return; }
      await sendCode(norm);
      return;
    }
    if (step.checkEmail && !opts.skipEmailCheck) {
      setChecking(true);
      const verdict = await emailAvailability(v);
      setChecking(false);
      if (verdict === "taken") {
        setError("This email already has a workspace — sign in instead, or use another address.");
        return;
      }
      /* WE COULD NOT CHECK IT — and that needs a DELIBERATE choice, not a
         second press of the key they are already pressing.
         The first version of this said "press continue again to carry on",
         which a founder typing an address and hitting Enter twice — one
         keystroke apart, with the field still focused — went straight
         through without reading. That is how somebody who could have been
         told here still reached the end of onboarding before finding out.
         So the way past is a separate button that Enter does not reach. */
      if (verdict === "unknown") {
        /* AND IT STOPS HERE, every time, however many times the key is
           pressed. The first version let a second press through, which a
           founder hitting Enter twice — one keystroke apart, field still
           focused — never even saw; the third press in a row got past it.
           The only way on is the button beside Continue, which Enter does
           not reach. */
        setUnverified(v.trim());
        setError("We couldn't check whether this address is already in use. Continue anyway, or try again in a moment — we'll confirm it before your OS is built either way.");
        return;
      }
    }
    setError("");
    // Keep what they typed, step by step, so closing the tab costs nothing.
    onStepSaved?.(step.key, v, { ...form, [step.key]: v });
    if (idx + 1 >= steps.length) onDone();
    else setIdx(idx + 1);
  };

  /* THEY ALREADY RUN SOMETHING. Two doors, and both are honest about what
     they do: open what they have (sign in with this number — one fresh code,
     because a signup proof is not a session key), or start another company on
     the same number, which asks for no second email and no second password. */
  const openExisting = (tenantId) => {
    const norm = form.phone_verified_norm || normIndianMobile(form.phone);
    navigate(`/login?phone=${encodeURIComponent(norm)}${tenantId ? `&tenant=${encodeURIComponent(tenantId)}` : ""}`);
  };
  const createAnother = () => {
    const { whole, name } = existing;
    const known = { known: true, name: name || form.name };
    onIdentity?.(known);
    setExisting(null);
    // Their name is the one the account already carries.
    const merged = { ...whole, name: known.name || whole.name };
    setForm(merged);
    next(merged);
  };

  const back = () => {
    if (existing) { setExisting(null); return; }                          // back to the number
    if (codeFor) { setCodeFor(""); setCode(""); setError(""); return; }   // back to the number
    if (idx > 0) { setError(""); setIdx(idx - 1); }
  };
  const setVal = (v) => {
    if (step.key === "email" && unverified && unverified !== String(v).trim()) setUnverified("");
    setForm((f) => ({ ...f, [step.key]: v }));
    if (error) setError("");
  };

  return (
    <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-basics">
      <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
      {/* 2026-09-17 — a founder who closed the tab reopens here, three answers
          in, with no idea why. Say it once, on the step they land on. */}
      {resumed && step.key === initialStep && (
        <p data-testid="signup-resumed-note" className="mb-5 text-sm text-muted-foreground">
          Welcome back{first(form.name) ? `, ${first(form.name)}` : ""} — we kept your answers.
          {identityKnown ? " Carry on where you left off." : " Just your password again, and you're on."}
        </p>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={step.key} variants={variants} initial="enter" animate="center" exit="exit"
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <p className="mb-3 flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="kr-pressed grid h-6 min-w-[1.75rem] place-items-center rounded-pill px-2 text-[11px] tabular-nums">
              {String(idx + 1).padStart(2, "0")}
            </span>
            {existing ? "Your companies" : step.eyebrow}
          </p>
          <h1 className="mb-2 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
            {existing ? (existing.workspaces.length
              ? `Welcome back${first(existing.name) ? `, ${first(existing.name)}` : ""}.`
              : "You've been invited to a workspace.")
              : step.confirmByCode && codeFor ? "Enter the code we just texted you." : step.q(form, identity?.name)}
          </h1>
          <p className="mb-7 text-sm text-muted-foreground">
            {existing ? (existing.workspaces.length
              ? "This number already signs in here. Open what you have, or start another company on the same number."
              : "Open the invite link you were sent to join it — or start a company of your own.")
              : step.confirmByCode && codeFor ? "Six digits. It works for five minutes." : step.sub(form)}
          </p>

          {existing ? (
            <div data-testid="signup-existing-workspaces" className="space-y-3">
              {existing.workspaces.map((w) => (
                <div key={w.tenant_id} data-testid={`signup-existing-${w.tenant_id}`}
                  className="kr-pressed flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold">{w.tenant_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {w.role === "owner" ? "You own this one" : `You're in this one as ${w.role}`}
                    </span>
                  </span>
                  <button type="button" onClick={() => openExisting(w.tenant_id)}
                    data-testid={`signup-open-${w.tenant_id}`}
                    className="kr-pop h-10 shrink-0 rounded-pill px-5 text-sm font-medium">
                    Open
                  </button>
                </div>
              ))}
              {existing.pending_invites.map((p, i) => (
                <p key={i} data-testid="signup-existing-invite"
                  className="kr-pressed rounded-2xl px-4 py-3 text-sm text-muted-foreground">
                  <strong className="font-semibold text-foreground">{p.tenant_name}</strong> invited you —
                  open the invite link they sent to join it the first time.
                </p>
              ))}
              <div className="flex flex-wrap items-center gap-4 pt-3">
                <motion.button onClick={createAnother} data-testid="signup-create-another"
                  whileHover={{ y: -2, scale: 1.03 }} whileTap={{ scale: 0.98 }}
                  className="kr-pop flex h-12 items-center gap-2 rounded-pill bg-kr-ink px-8 text-sm font-medium text-white">
                  Create another company <ArrowRight size={16} weight="bold" />
                </motion.button>
                <span className="text-xs text-muted-foreground">
                  Same number, new company — no second password to remember.
                </span>
              </div>
            </div>
          ) : step.type === "chips" ? (
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
                type={step.type}
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
            </div>
          )}

          {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} data-testid="signup-basics-error"
            className="mt-3 text-sm font-semibold text-danger-600">{error}</motion.p>}

          {step.type !== "chips" && !existing && !(step.confirmByCode && codeFor) && (
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
              {step.checkEmail && unverified === String(value).trim() && unverified ? (
                <button type="button" onClick={() => advance(undefined, { skipEmailCheck: true })} data-testid="signup-continue-unverified"
                  className="kr-pop flex h-12 items-center gap-2 rounded-pill px-6 text-sm font-medium text-foreground">
                  Continue anyway
                </button>
              ) : (
                <span className="hidden text-xs text-muted-foreground sm:block">
                  press <kbd className="kr-pressed rounded-md px-1.5 py-0.5 text-[11px]">Enter ↵</kbd>
                </span>
              )}
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

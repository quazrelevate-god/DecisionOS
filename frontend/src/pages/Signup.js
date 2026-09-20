import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
/* KM-43 — the app's wordmark, not the PNG lockup. Founder: "use the black
   version of decision os logo in the signup page which is used inside the
   inbox page and everywhere in mobile pwa". KarmaLogo is text — "Decision" at
   full ink, "OS" dropped to 55% — which is what the app shell has worn since
   KR-8.2. The PNG (Wordmark.jsx) keeps Landing and Login, the two marketing
   surfaces that still carry the registered artwork. */
import { KarmaLogo } from "../components/karma/Logo";
import { Check } from "@phosphor-icons/react";
import { BasicsFlow } from "./onboarding/BasicsFlow";
import { startOrResume, saveStep, clearDraft, formFromDraft, hasSavedAnswers } from "../lib/onboardingDraft";
import { WebsiteIntel } from "./onboarding/WebsiteIntel";
import { VoiceInterview } from "./onboarding/VoiceInterview";
import { BuildReveal } from "./onboarding/BuildReveal";

const PHASES = [
  { key: "basics", label: "Basics" },
  { key: "website", label: "Your world" },
  { key: "interview", label: "Interview" },
  { key: "build", label: "Your OS" },
];

// KM-19 · the founder onboarding, rebuilt on the Karma material.
//
// WHAT THIS REPLACED. The whole flow was the last stretch of the retired
// brutalist system: a flat `bg-brand-paper` page, `border-b border-border`
// rules, square `bg-primary` buttons in the indigo the brand dropped, and
// hard-edged progress ticks. It was the first screen a founder ever saw and
// the only one that looked nothing like the product behind it.
//
// Every surface is now .kr-well / .kr-pop / .kr-pressed.
//
// ON THE FLAT WHITE GROUND (founder's call). The first pass put signup on
// .app-sky, so it carried the same amber weather as the app and had the
// KM-17 artwork slot. It is a plain white sheet instead: no ::before
// gradient, no artwork layer, no useSkyFade — the hook only existed to stamp
// <html data-page> for a sky this page no longer has.
//
// WHAT THAT COSTS, so the next person knows. Neumorphism needs a ground it
// can be lighter AND darker than: .kr-pop's raised lip and .kr-pressed's
// inner highlight are both white, so against #fff they have nothing to show
// against and only the dark half of each pair survives. The app itself sits
// on --nm-bg, an off-white, for exactly that reason. The panes here still
// read because their dark shadows do the work alone, but they read quieter
// than the same components do inside the app.
export default function Signup() {
  // 2026-09-20 — `login` is gone from here with the password: a lost "Create"
  // press is recovered by register itself now, from the confirmed mobile.
  // `user` is the session, for the founder who pressed "Add a company" while
  // already signed in — see below.
  const { register, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [phase, setPhase] = useState("basics");
  const [form, setForm] = useState({
    company_name: "", name: "", email: "", phone: "", team_size: "",
    // the company's own contact address (a second company asks for it instead
    // of a second sign-in; blank is fine and Settings can fill it in later)
    support_email: "",
    // 2026-09-19 — the proof the mobile was confirmed by a texted code; register
    // refuses a phone without one (services/auth/phone_proof.py).
    phone_token: "", phone_verified_norm: "", phone_token_expires_at: "",
  });
  // 2026-09-17 — signup is saved as it goes, so closing the tab is not starting
  // over. 2026-09-20: there is no password to withhold any more — signing in is
  // the mobile — so a resumed signup simply reopens at the first blank answer.
  const [resumed, setResumed] = useState(false);       // show "picked up where you left off"
  /* The step to reopen at. Empty means "the first question there is" — which
     BasicsFlow decides, because the list itself depends on who this is. Naming
     a step here would pin the wizard to whatever was first when this line was
     written: it said "company_name", and after the mobile moved to the front
     every new founder opened on question three. */
  const [basicsStart, setBasicsStart] = useState("");
  /* 2026-09-20 — WHO THIS IS. A founder whose confirmed mobile already signs
     in somewhere is a person we know: their second company asks for no email
     and no password, and register creates it from the phone proof alone. Set
     when they choose "Create another company" after the code. */
  const [identity, setIdentity] = useState(null);
  /* 2026-09-20 (Yokesh) — "when I create a new company it definitely has the
     catch about being signed in, so why do we have to put the number and get
     the OTP again?" Quite right: a signed-in founder whose mobile was confirmed
     long ago is already identified, better than a 24-hour token identifies
     anyone. Their wizard opens at "Hello Rajesh — what's your new company
     called?" with no number and no code, and register reads the number from
     the session. Someone signed in whose number was never confirmed still gets
     asked, because there would otherwise be nothing to sign in with. */
  const sessionIdentity = user?.phone_verified_at
    ? { known: true, name: user.name || "", fromSession: true }
    : null;
  const [savedBlueprint, setSavedBlueprint] = useState(null);
  const [draftReady, setDraftReady] = useState(false);
  const [world, setWorld] = useState(null); // { industry, business_model, description, website_summary, products }
  const [sessionId, setSessionId] = useState(null);
  const [languageCode, setLanguageCode] = useState("en-IN");
  const phaseIdx = PHASES.findIndex((p) => p.key === phase);

  const interviewProfile = world && {
    company_name: form.company_name, founder_name: form.name, team_size: form.team_size,
    industry: world.industry, business_model: world.business_model,
    description: world.description, website_summary: world.website_summary,
    products: world.products,
  };

  // Resumed straight into the build (their blueprint was saved), there is no
  // `world` from the website step — the draft's own answers stand in.
  const buildPayload = (() => {
    const base = world
      ? { ...form, company_size: form.team_size,
          industry: world.industry, description: world.description, products: world.products }
      : { ...form, company_size: form.team_size,
          industry: form.industry || "General", description: form.description || "", products: [] };
    // A second company carries the confirmed mobile and nothing else: register
    // reads the proof, finds the person it belongs to, and creates the
    // workspace without a second sign-in address or password.
    if (identity?.known) {
      return { ...base, email: "", identity_known: true,
               support_email: (form.support_email || "").trim(),
               // Signed in: register reads the mobile from the session, and
               // there is no proof to send because no code was asked for.
               ...(identity.fromSession ? { phone: "", phone_token: "" } : {}) };
    }
    return base;
  })();

  // Resume (or start) the draft once, before the first step is drawn.
  const started = useRef(false);
  useEffect(() => {
    /* Wait for the session to settle first. /auth/me is still in flight on the
       first render, so deciding here without it would mean a signed-in founder
       who pressed "Add a company" was asked for their number and a code all
       over again — which is the thing this is for. */
    if (authLoading || started.current) return undefined;
    started.current = true;
    let live = true;
    (async () => {
      /* 2026-09-20 — "Add a company" from the profile menu is a NEW company,
         not the half-finished signup this browser may still be holding. Drop
         that draft first so the wizard opens on a blank first question. */
      if (new URLSearchParams(window.location.search).get("add") === "1") {
        clearDraft();
        if (sessionIdentity) {
          setIdentity(sessionIdentity);
          setForm((f) => ({ ...f, name: sessionIdentity.name }));
          setBasicsStart("company_name");
          setDraftReady(true);
          return;   // nothing saved to resume: this is a new company, now
        }
      }
      const { stepData } = await startOrResume();
      if (!live) return;
      if (hasSavedAnswers(stepData)) {
        const saved = formFromDraft(stepData);
        setForm((f) => ({ ...f, ...saved }));
        setSavedBlueprint((stepData.os_blueprint) || null);
        const known = !!(stepData.about || {}).identity_known;
        if (known) setIdentity({ known: true, name: saved.name || "" });
        // Reopen at the first answer that is missing. 2026-09-20 — no password
        // step for anyone now, so nothing in this scan is "never saved": a
        // resumed signup lands on the first answer that is genuinely blank.
        const order = (known
          ? ["company_name", "name", "phone", "team_size"]        // support_email may be skipped
          : ["company_name", "name", "phone", "email", "team_size"]);
        const firstGap = order.find((k) => !String(saved[k] || "").trim());
        setBasicsStart(firstGap || order[0]);
        setResumed(true);
      }
      setDraftReady(true);
    })();
    return () => { live = false; };
    // Once, as soon as the session is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const enterApp = () => {
    clearDraft();
    localStorage.setItem("dos_welcome", (form.name || "").trim().split(/\s+/)[0] || "1");
    navigate("/brief");
  };

  /* `relative isolate` on the root is load-bearing, not decoration. The art
     layer is position:fixed at z-index:-1, and a negative-z child only paints
     above its parent's background if that parent is a STACKING CONTEXT —
     otherwise it escapes to the root one and lands behind the body fill,
     which is invisible. .app-sky carries `position: relative; isolation:
     isolate` for exactly this reason; dropping that class in KM-20 dropped
     the stacking context with it, and the glow rendered as a white page. */
  return (
    /* KM-42 — `signup-stage` is the scoping hook for the desktop treatment,
       and it earns its keep: .kr-well is used on Ledger, Operating Score and
       InsightWell too, all of which sit on the app's pale canvas where the
       neumorphic pane is correct. Only here does it sit on a photograph.
       bg-white stays as the load fallback — the picture covers it once it
       arrives, and a white flash beats a black one. */
    <div className="signup-stage relative isolate flex min-h-[calc(100vh/var(--ui-scale,1))] flex-col bg-white text-foreground">
      {/* The artwork. On a phone it is a glow held above the pane; on desktop
          (>= 1024) it goes full-bleed and becomes the page itself. See
          "KM-21" / "KM-42" in index.css. */}
      <div className="app-sky__art app-sky__art--aside" aria-hidden="true" />

      {/* Top bar — floating glass rather than a ruled band. */}
      {/* KM-50 — ON A PHONE THIS IS JUST THE WORDMARK, CENTRED. Founder: "the
          top navbar is not nice so remove it and show only the DecisionOS logo
          in the center top." They are right about the cause — at 375px the
          glass pill had to carry a wordmark, a four-step rail and a Sign in
          button, and the rail's labels are lg-only precisely because they do
          not fit, so the phone was showing a bar of four unlabelled dots. A
          progress rail nobody can read is chrome, not orientation; the step
          number and its caption inside the card already say where you are.
          Desktop is untouched — it has the width the rail was designed for. */}
      <header className="px-4 pt-4 lg:px-8 lg:pt-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-center gap-4 rounded-pill px-4 py-2.5 lg:kr-frost lg:justify-between lg:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" data-testid="signup-logo">
            <KarmaLogo size="md" />
          </Link>

          {/* The phase rail. Sunken track, raised pill on the live phase —
              the same "selected means pushed in" grammar the app's segmented
              controls use, so progress reads as position rather than colour.
              Labels are lg-only: at 375px four words plus the wordmark plus
              Sign in cannot share a row without truncating something. */}
          {/* KM-62 — THE TRACK IS GONE. Founder: "remove the rectangular bar
              that covers the nav items, and increase the transparency of the
              inside pill that highlights them."

              .kr-pressed drew a sunken trough behind all four phases. On the
              app's pale canvas that reads as a segmented control; on a
              photograph it reads as a slab laid over the picture, and it was
              sitting inside the header's own glass pill as well — a second
              container around a container. The phases now sit directly on the
              header, and only the live one is drawn. */}
          {/* KM-66 follow-up — completed phases now carry a visible done
              state, not a slightly-darker dot that reads identically to
              pending. Three explicit states:

                Live    → gold dot, bold foreground text, glass wash pill
                Done    → filled foreground disc with a white check, ink text
                Pending → hairline dim dot, muted text

              A user moving forward now sees "Basics" close with a check
              rather than just fading to grey. */}
          <div className="hidden items-center gap-1 rounded-pill lg:flex" data-testid="signup-phase-bar">
            {PHASES.map((p, i) => {
              const done = i < phaseIdx;
              const live = i === phaseIdx;
              return (
                <div
                  key={p.key}
                  aria-current={live ? "step" : undefined}
                  title={p.label}
                  className={`flex h-7 items-center gap-2 rounded-pill px-2 lg:px-3 ${
                    live ? "bg-white/35 shadow-[0_1px_3px_-1px_hsl(230_30%_18%/.18)]" : ""
                  }`}
                >
                  {done ? (
                    <span
                      aria-hidden="true"
                      className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-foreground text-background"
                    >
                      <Check size={9} weight="bold" />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        live ? "bg-[hsl(var(--kr-gold))]" : "bg-foreground/15"
                      }`}
                    />
                  )}
                  <span
                    className={`hidden text-[11px] lg:inline ${
                      live ? "font-semibold text-foreground"
                        : done ? "font-medium text-foreground/85"
                        : "text-foreground/50"
                    }`}
                  >
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>

          <Link
            to="/login"
            data-testid="signup-signin-link"
            className="kr-pop hidden h-9 shrink-0 items-center rounded-pill px-4 text-xs font-medium lg:flex"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Stage */}
      <main className="flex flex-1 items-center px-4 py-8 lg:px-8 lg:py-12">
        <AnimatePresence mode="wait">
          <motion.div key={phase} className="w-full"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {phase === "basics" && (
              draftReady ? (
              <BasicsFlow
                form={form} setForm={setForm} initialStep={basicsStart} resumed={resumed}
                identity={identity}
                onIdentity={(who) => {
                  setIdentity(who);
                  /* The whole block, not just the flag: a draft step is
                     REPLACED on save (services/auth/onboarding_drafts.py
                     patch_step), so sending the flag alone would wipe the
                     answers already in it. */
                  saveStep("about", {
                    company_name: form.company_name, name: who.name || form.name,
                    email: form.email, phone: form.phone,
                    phone_token: form.phone_token, phone_verified_norm: form.phone_verified_norm,
                    phone_token_expires_at: form.phone_token_expires_at,
                    support_email: form.support_email,
                    identity_known: true,
                  });
                }}
                onStepSaved={(key, value, whole) => {
                  // What they typed is kept as each step completes; the password
                  // is excluded here and refused by the store besides.
                  if (key === "team_size") saveStep("scale", { team_size: value });
                  else if (key !== "password") {
                    saveStep("about", {
                      company_name: whole.company_name, name: whole.name,
                      email: whole.email, phone: whole.phone,
                      phone_token: whole.phone_token, phone_verified_norm: whole.phone_verified_norm,
                      phone_token_expires_at: whole.phone_token_expires_at,
                      support_email: whole.support_email,
                      // carried on every save: a step REPLACES its block
                      ...(identity?.known ? { identity_known: true } : {}),
                    });
                  }
                }}
                onDone={() => setPhase(savedBlueprint ? "build" : "website")} />
            ) : null
            )}
            {phase === "website" && (
              <WebsiteIntel companyName={form.company_name.trim()} onBack={() => setPhase("basics")} onDone={(w) => { setWorld(w); setPhase("interview"); }} />
            )}
            {phase === "interview" && (
              <VoiceInterview
                profile={interviewProfile}
                /* KM-62 — Back at the interview's first question returns here
                   rather than being inert. Not offered from the reveal screen:
                   VoiceInterview posts /interview/start on mount, so stepping
                   back into it would mint a NEW session and discard every
                   answer already given. The reveal has its own way to change
                   things — "Missing something? Tell Dex" edits the draft in
                   place, which is the safe version of the same intent. */
                onBack={() => setPhase("website")}
                onComplete={(sid, lang) => { setSessionId(sid); setLanguageCode(lang || "en-IN"); setPhase("build"); }}
                onSkip={(sid, lang) => { setSessionId(sid); setLanguageCode(lang || "en-IN"); setPhase("build"); }}
              />
            )}
            {phase === "build" && (
              <BuildReveal
                sessionId={sessionId} languageCode={languageCode} payload={buildPayload}
                register={register} onEnter={enterApp}
                savedBlueprint={savedBlueprint}
                onBlueprint={(bp) => { setSavedBlueprint(bp); saveStep("os_blueprint", bp); }}
                /* The mobile's proof lapsed while they sat on this screen (it
                   lasts a day). Back to that one step, then straight back here
                   to the OS they built — not through the interview again. */
                onFixPhone={() => {
                  setForm((f) => ({ ...f, phone_token: "", phone_verified_norm: "", phone_token_expires_at: "" }));
                  setBasicsStart("phone"); setResumed(false); setPhase("basics");
                }}
                /* The address is taken and they would rather use another. Back
                   to that one step — not through the interview again — and
                   straight back here, because savedBlueprint means the build
                   is restored rather than regenerated. */
                onChangeEmail={() => {
                  setBasicsStart("email"); setResumed(false); setPhase("basics");
                }} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* KM-42 — the footer line gets a ground. Measured on the full-bleed
          picture it read 1.38:1 against a 4.5 requirement: 11px muted type
          printed straight onto a photograph, and the photograph is dark
          exactly there. A glass chip is the fix rather than a colour change —
          it matches the header's own floating pill, and .kr-frost carries the
          darkened --text-secondary re-scope, so the text gets a lighter ground
          AND darker ink from one class. `w-fit` keeps the chip the width of
          the sentence instead of a bar across the page. */}
      <footer className="flex justify-center px-4 pb-5 lg:px-8">
        <p className="kr-frost w-fit max-w-full rounded-pill px-4 py-1.5 text-center text-[11px] text-muted-foreground">
          No credit card · 2 minutes · built around how you actually run
        </p>
      </footer>
    </div>
  );
}

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { useSkyFade } from "../hooks/useSkyFade";
import { Wordmark } from "../components/Wordmark";
import { BasicsFlow } from "./onboarding/BasicsFlow";
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
// It now stands on the same ground as the app: .app-sky paints the weather,
// .app-sky__art gives it the KM-17 artwork slot (drop /sky/signup.webp and
// uncomment its line in index.css and this screen gets a picture like any
// room), and every surface is .kr-well / .kr-pop / .kr-pressed.
//
// useSkyFade is called here for the same reason Layout calls it: it stamps
// <html data-page> from the first path segment, which is what the sky
// palettes and the artwork table key on. Signup is outside Layout, so
// without this the page would inherit whatever room the founder came from.
export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  useSkyFade(location.pathname);

  const [phase, setPhase] = useState("basics");
  const [form, setForm] = useState({ company_name: "", name: "", email: "", password: "", phone: "", team_size: "" });
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

  const buildPayload = world && {
    ...form, company_size: form.team_size,
    industry: world.industry, description: world.description, products: world.products,
  };

  const enterApp = () => {
    localStorage.setItem("dos_welcome", (form.name || "").trim().split(/\s+/)[0] || "1");
    navigate("/brief");
  };

  return (
    <div className="app-sky min-h-screen flex flex-col bg-nm text-foreground">
      <div className="app-sky__art" aria-hidden="true" />

      {/* Top bar — floating glass rather than a ruled band. */}
      <header className="px-4 pt-4 lg:px-8 lg:pt-6">
        <div className="kr-frost mx-auto flex w-full max-w-5xl items-center justify-between gap-4 rounded-pill px-4 py-2.5 lg:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2.5" data-testid="signup-logo">
            <Wordmark size={18} />
          </Link>

          {/* The phase rail. Sunken track, raised pill on the live phase —
              the same "selected means pushed in" grammar the app's segmented
              controls use, so progress reads as position rather than colour.
              Labels are lg-only: at 375px four words plus the wordmark plus
              Sign in cannot share a row without truncating something. */}
          <div className="kr-pressed flex items-center gap-1 rounded-pill p-1" data-testid="signup-phase-bar">
            {PHASES.map((p, i) => {
              const done = i < phaseIdx;
              const live = i === phaseIdx;
              return (
                <div
                  key={p.key}
                  aria-current={live ? "step" : undefined}
                  title={p.label}
                  className={`flex h-7 items-center gap-2 rounded-pill px-2 lg:px-3 ${live ? "kr-pop" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      live ? "bg-[hsl(var(--kr-gold))]" : done ? "bg-foreground/45" : "bg-foreground/15"
                    }`}
                  />
                  <span className={`hidden text-[11px] lg:inline ${live ? "font-semibold text-foreground" : "text-foreground/50"}`}>
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>

          <Link
            to="/login"
            data-testid="signup-signin-link"
            className="kr-pop flex h-9 shrink-0 items-center rounded-pill px-4 text-xs font-medium"
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
              <BasicsFlow form={form} setForm={setForm} onDone={() => setPhase("website")} />
            )}
            {phase === "website" && (
              <WebsiteIntel companyName={form.company_name.trim()} onDone={(w) => { setWorld(w); setPhase("interview"); }} />
            )}
            {phase === "interview" && (
              <VoiceInterview
                profile={interviewProfile}
                onComplete={(sid, lang) => { setSessionId(sid); setLanguageCode(lang || "en-IN"); setPhase("build"); }}
                onSkip={(sid, lang) => { setSessionId(sid); setLanguageCode(lang || "en-IN"); setPhase("build"); }}
              />
            )}
            {phase === "build" && (
              <BuildReveal sessionId={sessionId} languageCode={languageCode} payload={buildPayload} register={register} onEnter={enterApp} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="px-4 pb-5 lg:px-8">
        <p className="mx-auto max-w-5xl text-center text-[11px] text-muted-foreground">
          No credit card · 2 minutes · built around how you actually run
        </p>
      </footer>
    </div>
  );
}

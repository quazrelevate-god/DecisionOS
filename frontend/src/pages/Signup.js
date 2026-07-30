import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext";
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

// The founder onboarding experience: conversational basics → website
// intelligence → adaptive voice interview → personalized OS build & reveal.
export default function Signup() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState("basics");
  const [form, setForm] = useState({ company_name: "", name: "", email: "", password: "", phone: "", team_size: "" });
  const [world, setWorld] = useState(null); // { industry, business_model, description, website_summary, products }
  const [sessionId, setSessionId] = useState(null);
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
    <div className="min-h-screen flex flex-col bg-brand-paper text-brand-ink">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 lg:px-12 py-5 border-b border-black/10">
        <Link to="/" className="flex items-center gap-2.5" data-testid="signup-logo">
          <div className="w-8 h-8 bg-brand-red rounded-lg flex items-center justify-center"><span className="font-logo font-black text-white">D</span></div>
          <span className="font-logo font-black text-lg tracking-tight uppercase leading-none hidden sm:inline">
            <span className="text-foreground">Decision</span><span className="text-brand-red">OS</span>
          </span>
        </Link>
        <div className="flex items-center gap-6" data-testid="signup-phase-bar">
          {PHASES.map((p, i) => (
            <div key={p.key} className="flex items-center gap-2">
              <div className={`w-6 h-1.5 border border-black transition-colors duration-500 ${i < phaseIdx ? "bg-brand-ink" : i === phaseIdx ? "bg-brand-red" : "bg-white"}`} />
              <span className={`hidden md:inline text-[11px] font-semibold uppercase tracking-wider transition-colors ${i === phaseIdx ? "text-brand-ink" : "text-muted-foreground/60"}`}>{p.label}</span>
            </div>
          ))}
        </div>
        <Link to="/login" data-testid="signup-signin-link"
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-brand-ink transition-colors">
          Sign in
        </Link>
      </header>

      {/* Stage */}
      <main className="flex-1 flex items-center px-6 lg:px-12 py-10">
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
                onComplete={(sid) => { setSessionId(sid); setPhase("build"); }}
                onSkip={(sid) => { setSessionId(sid); setPhase("build"); }}
              />
            )}
            {phase === "build" && (
              <BuildReveal sessionId={sessionId} payload={buildPayload} register={register} onEnter={enterApp} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="px-6 lg:px-12 py-4 border-t border-black/10 flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground font-mono">No credit card · 2 minutes · built around how you actually run</p>
        <p className="text-[11px] text-muted-foreground font-mono hidden sm:block">The operational brain for founder-led SMEs</p>
      </footer>
    </div>
  );
}

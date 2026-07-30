import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Microphone, Gauge, Brain, ArrowRight } from "@phosphor-icons/react";

const POINTS = [
  { icon: Microphone, title: "Speak a decision", sub: "We turn it into tasks, owners and deadlines" },
  { icon: Gauge, title: "Your CEO brief", sub: "Cash, fires and follow-ups — every morning" },
  { icon: Brain, title: "Ask your Company Brain", sub: "Any number, any customer, any answer" },
];

// One-time cinematic welcome shown right after a founder finishes onboarding.
export function WelcomeOverlay() {
  const [name, setName] = useState(null);

  useEffect(() => {
    const v = localStorage.getItem("dos_welcome");
    if (v) setName(v === "1" ? "" : v);
  }, []);

  const dismiss = () => { localStorage.removeItem("dos_welcome"); setName(null); };

  return (
    <AnimatePresence>
      {name !== null && (
        <motion.div
          data-testid="welcome-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}
          className="fixed inset-0 z-[100] bg-brand-ink text-white flex items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="label-mono text-brand-red mb-4">Your executive office is ready</motion.p>
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
              className="font-heading text-4xl sm:text-5xl font-black uppercase tracking-tighter leading-[0.98] mb-10">
              Welcome{name ? `, ${name}` : ""}.<br /><span className="text-brand-red">Run the company</span> from here.
            </motion.h1>
            <div className="space-y-3 mb-10">
              {POINTS.map((p, i) => {
                const Icon = p.icon;
                return (
                  <motion.div key={p.title} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.55 + i * 0.15 }}
                    className="flex items-center gap-4 border border-white/20 bg-white/5 px-5 py-4">
                    <Icon size={22} weight="bold" className="text-brand-red shrink-0" />
                    <div>
                      <p className="font-heading font-bold uppercase tracking-tight text-sm">{p.title}</p>
                      <p className="text-xs text-white/60 mt-0.5">{p.sub}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
            <motion.button initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1 }}
              onClick={dismiss} data-testid="welcome-dismiss"
              className="flex items-center gap-2 bg-brand-red text-white font-semibold uppercase tracking-wider px-8 py-4 border border-white/20 hover:-translate-y-0.5 transition-transform">
              Step inside <ArrowRight size={18} weight="bold" />
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

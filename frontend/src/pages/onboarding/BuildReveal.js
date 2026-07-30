import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Buildings, FlowArrow, ListChecks, Stamp, CheckCircle, CircleNotch, Sparkle,
} from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";

const BUILD_STEPS = [
  { label: "Designing your departments", icon: Buildings },
  { label: "Drafting your workflows", icon: FlowArrow },
  { label: "Creating recurring tasks", icon: ListChecks },
  { label: "Setting approval rules", icon: Stamp },
];

// Generates the personalized OS blueprint from the interview, registers the
// workspace, then reveals what was built.
export function BuildReveal({ sessionId, payload, register, onEnter }) {
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null); // { bp, welcome_line }
  const [error, setError] = useState("");
  const ranRef = useRef(false);

  const run = async () => {
    setError(""); setProgress(0);
    const timers = BUILD_STEPS.map((_, i) => setTimeout(() => setProgress((p) => Math.max(p, i + 1)), (i + 1) * 2200));
    try {
      let bp = null, welcome = "";
      if (sessionId) {
        const { data } = await api.post("/signup/interview/blueprint", { session_id: sessionId });
        bp = data; welcome = data.welcome_line || "";
      } else {
        const { data } = await api.post("/onboarding/os-blueprint", {
          industry: payload.industry, company_size: payload.company_size, description: payload.description,
        });
        bp = data;
      }
      const products = (bp.products || payload.products || []).filter((p) => (p.name || "").trim());
      await register({
        company_name: payload.company_name, name: payload.name, email: payload.email,
        password: payload.password, phone: payload.phone,
        industry: payload.industry || "General", description: payload.description,
        company_size: payload.company_size, currency: "INR",
        business_scale: { employees: payload.company_size },
        roles: bp.departments || [],
        products,
        os_blueprint: {
          departments: bp.departments || [],
          workflows: bp.workflows || [],
          operational_tasks: bp.operational_tasks || [],
          approval_rules: bp.approval_rules || [],
        },
      });
      timers.forEach(clearTimeout);
      setProgress(BUILD_STEPS.length);
      setResult({ bp, welcome });
    } catch (e) {
      timers.forEach(clearTimeout);
      setError(formatApiError(e.response?.data?.detail) || "Couldn't finish the build. Please try again.");
    }
  };

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = result ? [
    { n: (result.bp.departments || []).length, label: "Departments" },
    { n: (result.bp.workflows || []).length, label: "Workflows" },
    { n: (result.bp.operational_tasks || []).length, label: "Recurring tasks" },
    { n: (result.bp.approval_rules || []).length, label: "Approval rules" },
  ] : [];

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="signup-build">
      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div key="building" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <p className="label-mono text-brand-red mb-3 flex items-center gap-2"><Sparkle size={14} weight="fill" /> This is the good part</p>
            <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tighter leading-[1.02] mb-8">
              Building {payload.company_name}'s operating system.
            </h1>
            <div className="space-y-2.5">
              {BUILD_STEPS.map((s, i) => {
                const done = progress > i;
                const active = progress === i && !error;
                const Icon = s.icon;
                return (
                  <motion.div key={s.label} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }}
                    data-testid={`build-step-${i}`}
                    className={`flex items-center gap-3 border border-black px-5 py-4 transition-colors duration-500 ${done ? "bg-brand-ink text-white" : "bg-white"}`}>
                    <span className="w-6 h-6 flex items-center justify-center">
                      {done ? <CheckCircle size={20} weight="fill" /> : active ? <CircleNotch size={18} className="animate-spin" /> : <Icon size={18} weight="bold" />}
                    </span>
                    <span className="text-sm font-semibold uppercase tracking-wide">{s.label}</span>
                  </motion.div>
                );
              })}
            </div>
            {!error && <p className="mt-6 text-xs text-muted-foreground font-mono">Built from your answers — not a template. Takes ~20 seconds.</p>}
            {error && (
              <div className="mt-6">
                <p data-testid="build-error" className="text-sm text-brand-red font-semibold mb-3">{error}</p>
                <button onClick={() => { run(); }} data-testid="build-retry"
                  className="bg-brand-ink text-white text-sm font-semibold uppercase tracking-wider px-6 py-3 border border-black hover:shadow-brutal transition-all">
                  Try again
                </button>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="reveal" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <p className="label-mono text-brand-red mb-3">Ready</p>
            <h1 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tighter leading-[1.02] mb-4">
              {payload.company_name} now runs on DecisionOS.
            </h1>
            {result.welcome && <p data-testid="build-welcome-line" className="text-base leading-relaxed mb-8 max-w-xl">{result.welcome}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="build-counts">
              {counts.map((c, i) => (
                <motion.div key={c.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.1 }}
                  className="border border-black bg-white shadow-brutal-sm p-4 text-center">
                  <p className="font-heading text-3xl font-black">{c.n}</p>
                  <p className="label-mono text-muted-foreground mt-1">{c.label}</p>
                </motion.div>
              ))}
            </div>
            {(result.bp.workflows || []).length > 0 && (
              <div className="mb-8">
                <p className="label-mono text-muted-foreground mb-2">Your workflows — named after how you actually work</p>
                <div className="flex flex-wrap gap-1.5">
                  {(result.bp.workflows || []).slice(0, 6).map((w, i) => (
                    <motion.span key={w.name} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 + i * 0.08 }}
                      className="px-3 py-1.5 border border-black bg-brand-yellow/40 text-xs font-mono">{w.name}</motion.span>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onEnter} data-testid="signup-enter-button"
              className="flex items-center gap-2 bg-brand-red text-white font-semibold uppercase tracking-wider px-10 py-4 border border-black hover:shadow-brutal hover:-translate-y-0.5 transition-all">
              Enter DecisionOS <ArrowRight size={18} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

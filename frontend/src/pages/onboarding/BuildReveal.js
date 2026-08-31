import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Sparkle, Microphone, Stop, CircleNotch, PaperPlaneRight, PencilSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { DexMascot } from "./DexMascot";
import { useAnswerRecorder } from "./voice";

// What Dex is "doing" while the real AI build runs (30-60s). Loops until done.
const WAIT_LINES = [
  "Reading everything you told Dex in the interview…",
  "Naming your departments the way you talk about them…",
  "Wiring workflows around how your orders actually move…",
  "Creating recurring tasks so nothing slips through…",
  "Setting up who approves what…",
  "Assembling your workspace — hang tight…",
];

// Small building block for the preview list of what Dex designed.
// `items` may be an array of strings, or of objects with .label / .name — we
// normalize per-item so the caller can pass whatever the backend returned.
const itemText = (it) => (typeof it === "string" ? it : (it?.label || it?.name || ""));

const PreviewBlock = ({ label, items, tint }) => {
  const strs = (items || []).map(itemText).filter(Boolean);
  if (strs.length === 0) return null;
  return (
    <div>
      <p className="label-mono text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {strs.slice(0, 10).map((s, i) => (
          <motion.span
            key={`${label}-${s}-${i}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className={`px-3 py-1.5 border border-border text-xs font-mono ${tint}`}>{s}</motion.span>
        ))}
      </div>
    </div>
  );
};

// Generates the personalized OS blueprint from the interview, lets the founder
// refine it, then registers the workspace and reveals it. Dex keeps the wait alive.
export function BuildReveal({ sessionId, languageCode, payload, register, onEnter }) {
  const [pct, setPct] = useState(0);
  const [line, setLine] = useState(0);
  // stage: 'building' → 'preview' (refine) → 'registering' → 'reveal'
  const [stage, setStage] = useState("building");
  const [bp, setBp] = useState(null);        // current blueprint (may be regenerated)
  const [welcome, setWelcome] = useState("");
  const [error, setError] = useState("");
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const ranRef = useRef(false);

  // Voice input for the refinement — reuses the interview STT.
  const refineRefText = useRef("");
  const recorder = useAnswerRecorder(({ text }) => {
    const merged = (refineRefText.current ? `${refineRefText.current} ${text}` : text).trim();
    refineRefText.current = merged;
    setRefineText(merged);
    setShowRefine(true);
  });

  const generate = async () => {
    setError(""); setPct(0); setLine(0); setStage("building");
    try {
      let data;
      if (sessionId) {
        const r = await api.post("/signup/interview/blueprint", {
          session_id: sessionId, language_code: languageCode || "en-IN",
        });
        data = r.data;
      } else {
        const r = await api.post("/onboarding/os-blueprint", {
          industry: payload.industry, company_size: payload.company_size, description: payload.description,
        });
        data = r.data;
      }
      setBp(data);
      setWelcome(data.welcome_line || "");
      setPct(100);
      setTimeout(() => setStage("preview"), 450);
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || "Couldn't build your OS. Please try again.");
    }
  };

  const submitRefinement = async () => {
    const text = refineText.trim();
    if (!text || refining || !sessionId) return;
    setRefining(true); setError(""); setPct(0); setLine(0); setStage("building");
    try {
      const { data } = await api.post("/signup/interview/refine", {
        session_id: sessionId, refinement: text, language_code: languageCode || "en-IN",
      });
      setBp(data);
      setWelcome(data.welcome_line || welcome);
      setRefineText(""); refineRefText.current = ""; setShowRefine(false);
      setPct(100);
      setTimeout(() => { setStage("preview"); toast.success("Dex rewired your OS with your addition."); }, 400);
    } catch (e) {
      setStage("preview");
      toast.error(e.response?.data?.detail || "Couldn't apply your refinement — try again");
    } finally {
      setRefining(false);
    }
  };

  const confirmAndRegister = async () => {
    if (!bp || stage === "registering") return;
    setStage("registering"); setError("");
    try {
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
      setStage("reveal");
    } catch (e) {
      setStage("preview");
      setError(formatApiError(e.response?.data?.detail) || "Couldn't create your workspace. Please try again.");
    }
  };

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    generate();
  }, []);

  // Progress creeps toward 92% and only hits 100% when the build truly finishes.
  useEffect(() => {
    if (stage !== "building" || error) return;
    const t = setInterval(() => setPct((p) => (p >= 92 ? p : Math.min(92, p + Math.max(0.4, (92 - p) * 0.028)))), 300);
    return () => clearInterval(t);
  }, [stage, error]);

  // Rotate the status line so the wait always feels alive.
  useEffect(() => {
    if (stage !== "building" || error) return;
    const t = setInterval(() => setLine((i) => (i + 1) % WAIT_LINES.length), 3400);
    return () => clearInterval(t);
  }, [stage, error]);

  // NB: the blueprint no longer returns "workflows" — WE-02 (2026-08-16) retired
  // the workflow_templates collection; operating_model.pipelines is the single
  // source of truth for pipelines, and it's generated at register time (not at
  // preview). So a "Workflows" stat here is always 0 — drop it and show the
  // three categories the blueprint actually produces.
  const counts = bp ? [
    { n: (bp.departments || []).length, label: "Departments" },
    { n: (bp.operational_tasks || []).length, label: "Recurring tasks" },
    { n: (bp.approval_rules || []).length, label: "Approval rules" },
  ] : [];

  const workflowNames = (bp?.workflows || []).map((w) => w.name).filter(Boolean);
  const taskTitles = (bp?.operational_tasks || []).map((t) => t.title).filter(Boolean);

  return (
    <div className="w-full max-w-2xl mx-auto" data-testid="signup-build">
      <AnimatePresence mode="wait">
        {/* ------------------------------------------------------ BUILDING */}
        {stage === "building" && (
          <motion.div key="building" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="text-center">
            <p className="label-mono text-brand-600 mb-2 flex items-center justify-center gap-2">
              <Sparkle size={14} weight="fill" /> {refining ? "Dex is rewiring your OS" : "Meet Dex — your build engineer"}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-6">
              {refining ? "Applying your addition…" : `Dex is building ${payload.company_name}'s OS.`}
            </h1>

            <DexMascot />

            {!error && (
              <>
                <div className="mt-8 max-w-md mx-auto">
                  <div className="h-4 border border-border bg-white overflow-hidden" data-testid="build-progress-bar">
                    <motion.div className="h-full bg-brand-600" animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <AnimatePresence mode="wait">
                      <motion.p key={line} data-testid="build-wait-line"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        className="text-xs text-muted-foreground font-mono text-left">
                        {WAIT_LINES[line]}
                      </motion.p>
                    </AnimatePresence>
                    <p className="text-xs font-mono font-bold shrink-0 ml-3">{Math.round(pct)}%</p>
                  </div>
                </div>
                <p className="mt-6 text-xs text-muted-foreground font-mono">
                  Built from your answers — not a template. Dex takes up to a minute.
                </p>
              </>
            )}

            {error && (
              <div className="mt-8">
                <p data-testid="build-error" className="text-sm text-danger-600 font-semibold mb-3">{error}</p>
                <button onClick={generate} data-testid="build-retry"
                  className="bg-primary text-primary-foreground text-sm font-medium px-6 py-3 border border-border transition-all">
                  Try again
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* --------------------------------------------- PREVIEW + REFINE */}
        {stage === "preview" && bp && (
          <motion.div key="preview" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
            data-testid="signup-build-preview">
            <p className="label-mono text-brand-600 mb-3">Draft ready · review before you enter</p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-4">
              Here&apos;s how {payload.company_name} will run on DecisionOS.
            </h1>
            {welcome && <p data-testid="build-welcome-line" className="text-base leading-relaxed mb-6 max-w-xl">{welcome}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="build-counts">
              {counts.map((c, i) => (
                <motion.div key={c.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
                  className="border border-border bg-white shadow-sm p-4 text-center">
                  <p className="font-heading text-3xl font-black">{c.n}</p>
                  <p className="label-mono text-muted-foreground mt-1">{c.label}</p>
                </motion.div>
              ))}
            </div>

            <div className="space-y-5 mb-8">
              <PreviewBlock label="Departments" items={bp.departments || []} tint="bg-white" />
              <PreviewBlock label="Workflows — named after how you actually work" items={workflowNames} tint="bg-caution-50/40" />
              <PreviewBlock label="Recurring tasks Dex will keep on rails" items={taskTitles.slice(0, 8)} tint="bg-brand-paper" />
            </div>

            {/* Refine panel — voice or type */}
            <div className="border border-border bg-white shadow-sm p-4 mb-6" data-testid="build-refine-panel">
              <div className="flex items-center justify-between mb-3">
                <p className="label-mono text-brand-600 flex items-center gap-2">
                  <PencilSimple size={14} weight="bold" /> Missing something? Tell Dex.
                </p>
                {!showRefine && (
                  <button onClick={() => setShowRefine(true)} data-testid="build-refine-open"
                    className="text-[11px] font-medium text-brand-ink underline underline-offset-4 hover:text-brand-600">
                    Add a workflow
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Speak or type any workflow, approval, or team detail Dex missed — he&apos;ll rewire the OS.
              </p>
              {showRefine && (
                <>
                  <textarea
                    data-testid="build-refine-input"
                    rows={3}
                    value={refineText}
                    disabled={refining || recorder.transcribing}
                    onChange={(e) => { setRefineText(e.target.value); refineRefText.current = e.target.value; }}
                    placeholder={recorder.recording
                      ? "Listening… tap Stop when done"
                      : "e.g. Every Monday I review pending orders with production; anything over ₹50k needs my approval."}
                    className="w-full bg-transparent text-sm focus:outline-none resize-none placeholder:text-black/30 border-b border-border pb-2"
                  />
                  <div className="flex items-center justify-between mt-3">
                    <button
                      data-testid="build-refine-mic"
                      onClick={recorder.recording ? recorder.stop : recorder.start}
                      disabled={refining || recorder.transcribing}
                      className={`flex items-center gap-2 px-3 py-2 border border-border text-xs font-medium transition-all disabled:opacity-50 ${recorder.recording ? "bg-brand-600 text-white animate-pulse" : "bg-white hover:bg-accent"}`}>
                      {recorder.transcribing ? <CircleNotch size={14} className="animate-spin" />
                        : recorder.recording ? <Stop size={14} weight="fill" /> : <Microphone size={14} weight="bold" />}
                      {recorder.transcribing ? "Transcribing…" : recorder.recording ? "Stop" : "Speak"}
                    </button>
                    <button
                      data-testid="build-refine-submit"
                      onClick={submitRefinement}
                      disabled={!refineText.trim() || refining}
                      className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 border border-border text-xs font-medium transition-all disabled:opacity-40">
                      {refining ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneRight size={14} weight="bold" />}
                      {refining ? "Rewiring…" : "Apply to my OS"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* FUP-46: prominent error banner so 422/409/429 rejections
                (e.g. reserved TLD like .test) actually catch the eye
                instead of vanishing into a small red line. */}
            {error && (
              <div className="mb-4 border-2 border-danger-600 bg-danger-600/10 p-4 shadow-sm" data-testid="build-error-banner">
                <p className="text-sm font-bold text-brand-600  mb-1">Couldn't create your workspace</p>
                <p className="text-sm text-danger-600 font-semibold" data-testid="build-error">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={confirmAndRegister} disabled={refining} data-testid="build-confirm-button"
                className="flex items-center gap-2 bg-brand-600 text-white font-medium px-8 py-4 border border-border hover:-translate-y-0.5 transition-all disabled:opacity-50">
                Looks good — Enter DecisionOS <ArrowRight size={18} weight="bold" />
              </button>
            </div>
          </motion.div>
        )}

        {/* -------------------------------------------------- REGISTERING */}
        {stage === "registering" && (
          <motion.div key="registering" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="text-center" data-testid="signup-registering">
            <p className="label-mono text-brand-600 mb-2 flex items-center justify-center gap-2">
              <Sparkle size={14} weight="fill" /> Locking it in
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-6">
              Creating your workspace…
            </h1>
            <DexMascot />
          </motion.div>
        )}

        {/* --------------------------------------------------------- REVEAL */}
        {stage === "reveal" && bp && (
          <motion.div key="reveal" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <p className="label-mono text-brand-600 mb-3">Ready</p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.02] mb-4">
              {payload.company_name} now runs on DecisionOS.
            </h1>
            {welcome && <p data-testid="build-welcome-line" className="text-base leading-relaxed mb-8 max-w-xl">{welcome}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6" data-testid="build-counts">
              {counts.map((c, i) => (
                <motion.div key={c.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.1 }}
                  className="border border-border bg-white shadow-sm p-4 text-center">
                  <p className="font-heading text-3xl font-black">{c.n}</p>
                  <p className="label-mono text-muted-foreground mt-1">{c.label}</p>
                </motion.div>
              ))}
            </div>
            {workflowNames.length > 0 && (
              <div className="mb-8">
                <p className="label-mono text-muted-foreground mb-2">Your workflows — named after how you actually work</p>
                <div className="flex flex-wrap gap-1.5">
                  {workflowNames.slice(0, 6).map((n, i) => (
                    <motion.span key={n} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 + i * 0.08 }}
                      className="px-3 py-1.5 border border-border bg-caution-50/40 text-xs font-mono">{n}</motion.span>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onEnter} data-testid="signup-enter-button"
              className="flex items-center gap-2 bg-brand-600 text-white font-medium px-10 py-4 border border-border hover:-translate-y-0.5 transition-all">
              Enter DecisionOS <ArrowRight size={18} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

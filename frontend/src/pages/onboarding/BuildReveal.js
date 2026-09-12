import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Sparkle, Microphone, Stop, CircleNotch, PaperPlaneRight, PencilSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { DexForge } from "./DexForge";
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
      <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {strs.slice(0, 10).map((s, i) => (
          <motion.span
            key={`${label}-${s}-${i}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
            className={`rounded-pill px-3 py-1.5 text-xs ${tint}`}>{s}</motion.span>
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

  // Kept reading `bp.workflows` deliberately, and it is expected to be empty:
  // the BUG-15 note above records that the blueprint stopped returning
  // workflows when WE-02 retired workflow_templates. Both render sites below
  // no-op on an empty list (PreviewBlock returns null; the reveal block is
  // length-gated), so this stays as the one place that lights up again if the
  // field ever comes back, rather than being deleted and re-derived later.
  const workflowNames = (bp?.workflows || []).map((w) => w.name).filter(Boolean);
  const taskTitles = (bp?.operational_tasks || []).map((t) => t.title).filter(Boolean);

  return (
    <div className="kr-well mx-auto w-full max-w-2xl" data-testid="signup-build">
     <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
      <AnimatePresence mode="wait">
        {/* ------------------------------------------------------ BUILDING */}
        {stage === "building" && (
          <motion.div key="building" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="text-center">
            <p className="mb-2 flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkle size={14} weight="fill" className="text-[hsl(var(--kr-gold))]" /> {refining ? "Dex is rewiring your OS" : "Meet Dex — your build engineer"}
            </p>
            <h1 className="mb-7 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
              {refining ? "Applying your addition…" : `Dex is building ${payload.company_name}'s OS.`}
            </h1>

            <DexForge label={`Dex is assembling ${payload.company_name}'s workspace`} />

            {!error && (
              <>
                <div className="mx-auto mt-8 max-w-md">
                  {/* The track is pressed into the sheet and the fill is the
                      gold light — the same pair the forge above uses. */}
                  <div className="kr-pressed h-3 overflow-hidden rounded-pill p-[3px]" data-testid="build-progress-bar">
                    <motion.div
                      className="h-full rounded-pill"
                      style={{ background: "linear-gradient(90deg, hsl(var(--kr-gold) / .85), hsl(var(--kr-gold)))" }}
                      animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <AnimatePresence mode="wait">
                      <motion.p key={line} data-testid="build-wait-line"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        className="text-left text-xs text-muted-foreground">
                        {WAIT_LINES[line]}
                      </motion.p>
                    </AnimatePresence>
                    <p className="shrink-0 text-xs font-semibold tabular-nums">{Math.round(pct)}%</p>
                  </div>
                </div>
                <p className="mt-6 text-xs text-muted-foreground">
                  Built from your answers — not a template. Dex takes up to a minute.
                </p>
              </>
            )}

            {error && (
              <div className="mt-8">
                <p data-testid="build-error" className="text-sm text-danger-600 font-semibold mb-3">{error}</p>
                <button onClick={generate} data-testid="build-retry"
                  className="kr-pop mx-auto flex h-11 items-center rounded-pill bg-kr-ink px-6 text-sm font-medium text-white">
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
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Draft ready · review before you enter</p>
            <h1 className="mb-4 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
              Here&apos;s how {payload.company_name} will run on DecisionOS.
            </h1>
            {welcome && <p data-testid="build-welcome-line" className="text-base leading-relaxed mb-6 max-w-xl">{welcome}</p>}

            <div className="mb-6 grid grid-cols-3 gap-3" data-testid="build-counts">
              {counts.map((c, i) => (
                <motion.div key={c.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.08 }}
                  /* KM-65 — .kr-frost-min: a flat tile drawn by its hairline,
                     with none of .kr-pop's lift. These three are a readout —
                     "2 departments, 4 recurring tasks, 1 approval rule" — and
                     they sat raised, in the same material as "Looks good, Enter
                     DecisionOS" directly below them. */
                  className="kr-frost-min rounded-2xl p-4 text-center">
                  <p className="text-3xl font-semibold tabular-nums">{c.n}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{c.label}</p>
                </motion.div>
              ))}
            </div>

            <div className="space-y-5 mb-8">
              {/* KM-62 — departments become SUNKEN pills like the recurring
                  tasks below, one shade lighter. Founder: "I can't know which
                  one is a clickable button, which one is just a card and
                  pills."

                  They were .kr-pop — the app's RAISED recipe, which everything
                  pressable on this page uses ("Add a workflow", "Looks good",
                  the model chips one screen back). So four unpressable labels
                  were wearing the one visual promise this design reserves for
                  controls. Sunken is the grammar for "this is what Dex found",
                  which is what they are.

                  The lightness carries the distinction the founder asked for:
                  .34 white against the recurring tasks' default .20, so they
                  read as two groups of the same KIND rather than two kinds.
                  The explicit bg- utility is also what defeats
                  `.signup-stage .kr-pressed:not([class*="bg-"])`, which would
                  otherwise force both to the same .20. */}
              <PreviewBlock label="Departments" items={bp.departments || []} tint="kr-pressed bg-white/[.34]" />
              <PreviewBlock label="Workflows — named after how you actually work" items={workflowNames} tint="kr-pressed bg-[hsl(var(--kr-gold)/.22)]" />
              <PreviewBlock label="Recurring tasks Dex will keep on rails" items={taskTitles.slice(0, 8)} tint="kr-pressed" />
            </div>

            {/* Refine panel — voice or type */}
            <div className="kr-frost-min mb-6 rounded-2xl p-4" data-testid="build-refine-panel">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <PencilSimple size={14} weight="bold" /> Missing something? Tell Dex.
                </p>
                {!showRefine && (
                  <button onClick={() => setShowRefine(true)} data-testid="build-refine-open"
                    className="kr-pop flex h-9 shrink-0 items-center rounded-pill px-3.5 text-[11px] font-medium">
                    Add a workflow
                  </button>
                )}
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
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
                    className="w-full resize-none border-b border-white/50 bg-transparent pb-2 text-sm placeholder:text-foreground/30 focus:outline-none"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button
                      data-testid="build-refine-mic"
                      onClick={recorder.recording ? recorder.stop : recorder.start}
                      disabled={refining || recorder.transcribing}
                      className={`flex h-11 items-center gap-2 rounded-pill px-4 text-xs font-medium disabled:opacity-50 ${recorder.recording ? "kr-pressed text-[hsl(var(--kr-gold))]" : "kr-pop"}`}>
                      {recorder.transcribing ? <CircleNotch size={14} className="animate-spin" />
                        : recorder.recording ? <Stop size={14} weight="fill" /> : <Microphone size={14} weight="bold" />}
                      {recorder.transcribing ? "Transcribing…" : recorder.recording ? "Stop" : "Speak"}
                    </button>
                    <button
                      data-testid="build-refine-submit"
                      onClick={submitRefinement}
                      disabled={!refineText.trim() || refining}
                      className="kr-pop flex h-11 items-center gap-2 rounded-pill bg-kr-ink px-5 text-xs font-medium text-white disabled:opacity-40">
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
              <div className="mb-4 rounded-2xl border border-danger-600/40 bg-danger-600/10 p-4" data-testid="build-error-banner">
                <p className="mb-1 text-sm font-bold text-danger-600">Couldn&apos;t create your workspace</p>
                <p className="text-sm text-danger-600 font-semibold" data-testid="build-error">{error}</p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={confirmAndRegister} disabled={refining} data-testid="build-confirm-button"
                className="kr-pop flex h-14 items-center gap-2 rounded-pill bg-kr-ink px-8 font-medium text-white disabled:opacity-50">
                Looks good — Enter DecisionOS <ArrowRight size={18} weight="bold" />
              </button>
            </div>
          </motion.div>
        )}

        {/* -------------------------------------------------- REGISTERING */}
        {stage === "registering" && (
          <motion.div key="registering" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="text-center" data-testid="signup-registering">
            <p className="mb-2 flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkle size={14} weight="fill" className="text-[hsl(var(--kr-gold))]" /> Locking it in
            </p>
            <h1 className="mb-7 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
              Creating your workspace…
            </h1>
            <DexForge label="Creating your workspace" />
          </motion.div>
        )}

        {/* --------------------------------------------------------- REVEAL */}
        {stage === "reveal" && bp && (
          <motion.div key="reveal" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Ready</p>
            <h1 className="mb-4 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
              {payload.company_name} now runs on DecisionOS.
            </h1>
            {welcome && <p data-testid="build-welcome-line" className="text-base leading-relaxed mb-8 max-w-xl">{welcome}</p>}
            <div className="mb-6 grid grid-cols-3 gap-3" data-testid="build-counts">
              {counts.map((c, i) => (
                <motion.div key={c.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.1 }}
                  /* KM-65 — .kr-frost-min: a flat tile drawn by its hairline,
                     with none of .kr-pop's lift. These three are a readout —
                     "2 departments, 4 recurring tasks, 1 approval rule" — and
                     they sat raised, in the same material as "Looks good, Enter
                     DecisionOS" directly below them. */
                  className="kr-frost-min rounded-2xl p-4 text-center">
                  <p className="text-3xl font-semibold tabular-nums">{c.n}</p>
                  <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{c.label}</p>
                </motion.div>
              ))}
            </div>
            {workflowNames.length > 0 && (
              <div className="mb-8">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Your workflows — named after how you actually work</p>
                <div className="flex flex-wrap gap-1.5">
                  {workflowNames.slice(0, 6).map((n, i) => (
                    <motion.span key={n} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 + i * 0.08 }}
                      className="kr-pressed rounded-pill bg-[hsl(var(--kr-gold)/.22)] px-3 py-1.5 text-xs">{n}</motion.span>
                  ))}
                </div>
              </div>
            )}
            <button onClick={onEnter} data-testid="signup-enter-button"
              className="kr-pop flex h-14 items-center gap-2 rounded-pill bg-kr-ink px-10 font-medium text-white">
              Enter DecisionOS <ArrowRight size={18} weight="bold" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
     </div>
    </div>
  );
}

import { createElement, forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, Sparkle, Stop, CircleNotch, PaperPlaneRight, PencilSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatApiError } from "../../lib/api";
import { DexForge } from "./DexForge";
import { useAnswerRecorder, useSynthLevels } from "./voice";
import { DexWave } from "../../components/mobile/DexWave";
import { CountUp } from "../../components/karma";

// What Dex is "doing" while the real AI build runs (30-60s). Loops until done.
const WAIT_LINES = [
  "Reading everything you told Dex in the interview…",
  "Naming your departments the way you talk about them…",
  "Wiring workflows around how your orders actually move…",
  "Creating recurring tasks so nothing slips through…",
  "Setting up who approves what…",
  "Assembling your workspace — hang tight…",
];

// A blueprint entry may be a string, or an object keyed .label (departments),
// .name (workflows) or .title (operational tasks) — the backend is not
// consistent, so every read normalizes per-item.
//
// KM-66 — `.title` was missing, and it silently broke the new-item diff for
// half the screen: a task normalized to "" and was dropped by the filter, so
// adding a recurring task ringed nothing. Caught by adding one and watching
// the department light up while the task did not.
const itemText = (it) =>
  (typeof it === "string" ? it : (it?.label || it?.name || it?.title || ""));

/* ═══════════════════════════════════════════════════════════════════════════
   KM-66 — THE DRAFT ASSEMBLES ITSELF.

   This is the moment the founder first sees their own company modelled back
   at them. It used to arrive as one block: h1, welcome, three tiles, two pill
   clusters, refine panel and CTA, all at once inside one narrow pane. A
   receipt. It should read as being built for them.

   Seconds from the moment the preview branch mounts. Runs ONCE — the branch
   no longer unmounts on a refine (see submitRefinement), so the ref that
   guards it is sufficient on its own and no other guard is needed.
   ═════════════════════════════════════════════════════════════════════════ */
const CHOREO = {
  eyebrow: 0,
  h1: 0.12,
  welcome: 0.55,
  tilesAt: 0.95,     // first tile blooms
  tileGap: 0.38,     // between tiles
  bloom: 0.26,       // centred, scale 1.35, blur out
  hold: 0.18,        // holds while the numeral counts
  travel: 0.42,      // FLIP into its own cell
  sectionsAt: 2.30,  // Departments heading
  betweenSections: 0.22,
  pillStagger: 0.09,
  tail: 0.30,        // refine panel + CTA
  CAP: 3.40,         // the last pill must have landed by here
};

/* The stagger is COMPUTED, not fixed: at a flat 90ms the maximum render (10
   departments and 8 tasks) runs past the cap.

   The budget is what remains of CAP after everything that is NOT stagger, and
   getting that list right matters — the first version of this counted only the
   section gap and was measured at 3.9s against a 3.4s cap. The four fixed
   costs are: reaching the first heading (sectionsAt), the gap between the two
   sections, each heading's lead-in before its first pill, and the last pill's
   own 320ms travel. "Landed by the cap" means finished moving, not started.

     budget = 3.40 - 2.30 - 0.22 - 0.12 - 0.32 = 0.44s
     spread over (n - 1) gaps

   A typical blueprint (2 + 4) keeps ~88ms, indistinguishable from the
   prescribed 90. The maximum tightens to ~26ms. The tile sequence is never
   touched, which is the ticket's instruction. */
const PILL_LEAD = 0.12;   // heading -> its first pill
const PILL_DUR = 0.32;    // a pill's own travel
/* JITTER is measured, not padding-by-feel. Budgeting the cap exactly put the
   last pill of a maximum blueprint at 3.51s against a 3.40s cap: framer-motion
   schedules delays off its own frame loop, and eighteen concurrent animations
   plus three tile FLIPs drift about a tenth of a second. Reserving it is what
   makes the cap true rather than nominally true.

   It also lands the typical blueprint on the ticket's own figure. With 2 + 4
   the last pill STARTS at 2.96s — "total to the final pill approximately
   3.0s", exactly — and finishes inside the cap. */
const JITTER = 0.12;
const pillStaggerFor = (n) => {
  const budget = CHOREO.CAP - JITTER - CHOREO.sectionsAt - CHOREO.betweenSections - PILL_LEAD - PILL_DUR;
  return Math.min(CHOREO.pillStagger, Math.max(0.015, budget / Math.max(1, n - 1)));
};

const prefersReduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Diff key for "is this entry new?" — the model rewords casing and spacing
// between runs, so compare on a normalized form rather than the raw string.
const norm = (v) => itemText(v).trim().toLowerCase().replace(/\s+/g, " ");



/* KM-66 — Rise: a motion element while the sequence runs, a PLAIN one once it
   is over or skipped.

   This exists because of a measured failure. Skipping used to flip `still`,
   which set every transition to {duration: 0} — and nothing happened to the
   pills. framer-motion will not abandon an animation it has already scheduled
   with a delay just because the transition prop changed underneath it, and
   `initial` is only read at mount. Clicking at 1.5s left the tiles jumping to
   their cells (that is plain state) while all eighteen pills stayed at
   opacity 0 until their original delays came round.

   Changing the element TYPE is what makes it instant: React unmounts the
   motion node and mounts a plain one, which paints at its final values with no
   animation to abandon. */
const Rise = forwardRef(function Rise(
  { still, tag = "div", initial, animate, transition, children, ...rest }, ref) {
  if (still) return createElement(tag, { ref, ...rest }, children);
  const M = motion[tag];
  return <M ref={ref} initial={initial} animate={animate} transition={transition} {...rest}>{children}</M>;
});

/* One count tile. Two lives: an invisible spacer holding its cell open, then
   the real thing once it has flown in. They are separate elements on purpose —
   the layoutId can only belong to one of them at a time, and the spacer's job
   is to make sure the row never changes height when they swap. */
function CountTile({ c, index, landed, settled, still, glow }) {
  const body = (
    <>
      <p className="text-3xl font-semibold tabular-nums">
        {/* Before the sequence ends the numeral RAMPS; after it, it is plain
            text. CountUp re-runs from zero whenever `value` changes (its deps
            are [target, delay, duration]), so leaving it mounted would make a
            refinement that adds one department animate 4 -> 0 -> 5 and read as
            a reset. The ring is what announces the change instead. */}
        {settled || still
          ? c.n
          : <CountUp value={c.n} duration={CHOREO.hold * 1000}
              delay={(CHOREO.tilesAt + index * CHOREO.tileGap + CHOREO.bloom) * 1000} />}
      </p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{c.label}</p>
    </>
  );

  if (!landed) {
    // Holds the cell at exactly the tile's height. aria-hidden because the
    // number it contains is about to be announced by the real one.
    return <div aria-hidden="true" className="kr-frost-min invisible rounded-2xl p-4 text-center">{body}</div>;
  }
  return (
    <motion.div
      layoutId={still ? undefined : `count-tile-${c.label}`}
      data-testid="build-count-tile"
      initial={still ? false : { filter: "blur(6px)" }}
      animate={{ filter: "blur(0px)" }}
      /* One transition object for the layout move AND the blur, so the blur
         cannot finish after the tile has already arrived. */
      transition={still ? { duration: 0 } : { duration: CHOREO.travel, ease: [0.16, 1, 0.3, 1] }}
      style={{ willChange: settled ? "auto" : "filter, transform" }}
      className={`kr-frost-min rounded-2xl p-4 text-center ${glow ? "kr-new-glow" : ""}`}>
      {body}
    </motion.div>
  );
}

/* A section of pills, one per row, left-aligned and sized to their content.
   `w-fit` is what stops them stretching to the column; the stack is what stops
   them wrapping into a cluster. */
function PillSection({ label, items, tint, testid, startAt, stagger, still, newKeys, firstNewRef }) {
  const strs = (items || []).map(itemText).filter(Boolean).slice(0, 10);
  if (strs.length === 0) return null;
  let firstNewSeen = false;
  return (
    <div className="kr-well__pane rounded-[1.75rem] p-5 sm:p-6">
      <Rise still={still} tag="p"
        initial={{ opacity: 0, filter: "blur(6px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ delay: startAt, duration: 0.34 }}
        className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Rise>
      <div className="flex flex-col items-start gap-2">
        {strs.map((t, i) => {
          const isNew = newKeys.has(t.trim().toLowerCase().replace(/\s+/g, " "));
          const takeRef = isNew && !firstNewSeen;
          if (takeRef) firstNewSeen = true;
          return (
            <Rise
              key={`${label}-${t}-${i}`}
              still={still}
              tag="span"
              ref={takeRef ? firstNewRef : undefined}
              data-testid={testid}
              /* Transform and opacity only. A blur per pill would put a dozen
                 concurrent filter animations on screen at once; the stagger is
                 what carries the arrival, and the headings above already
                 supply the blur texture. */
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: startAt + PILL_LEAD + i * stagger, duration: PILL_DUR, ease: [0.16, 1, 0.3, 1] }}
              className={`w-fit max-w-full rounded-pill px-3 py-1.5 text-xs ${tint} ${isNew ? "kr-new-glow" : ""}`}>
              {t}
            </Rise>
          );
        })}
      </div>
    </div>
  );
}

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

  /* ── KM-66 choreography state ───────────────────────────────────────────
     `placed` is how many count tiles have flown into their cells. Three
     timers move it; that is three re-renders across two seconds, which is the
     price of a real FLIP (the tile has to actually change parent for
     framer-motion to measure it) and is nothing like a per-frame write.
     `settled` freezes everything at the end so a refine cannot re-animate. */
  const [skipped, setSkipped] = useState(false);
  const [placed, setPlaced] = useState(0);
  const [settled, setSettled] = useState(false);
  const [reduced] = useState(prefersReduced);
  const choreoRef = useRef(false);

  // Normalized keys added by the most recent refinement, and the count tiles
  // whose number moved. Both are held for exactly 5s — see the glow effect.
  const [newKeys, setNewKeys] = useState(() => new Set());
  const [changedTiles, setChangedTiles] = useState(() => new Set());
  const prevBpRef = useRef(null);
  const glowTimerRef = useRef(null);
  const firstNewRef = useRef(null);

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

  /* KM-66 — A REFINE NEVER LEAVES THIS SCREEN.
     It used to setStage("building"), which unmounted the preview and showed
     the forge with its progress bar and rotating wait lines. That is right for
     the FIRST build — 30-60s with nothing else to look at — and wrong for a
     refinement: the founder is mid-review and the thing they are editing
     vanishes underneath them.

     The submit button is now the only loading signal. pct/line are not touched
     either; they belong to the initial build. The panel is deliberately left
     OPEN on success (it used to close): with the screen no longer changing,
     having the editor disappear from under a returning answer was the same
     disorientation in miniature — and the founder is often adding two things
     in a row. */
  const submitRefinement = async () => {
    const text = refineText.trim();
    if (!text || refining || !sessionId) return;
    setRefining(true); setError("");
    try {
      const { data } = await api.post("/signup/interview/refine", {
        session_id: sessionId, refinement: text, language_code: languageCode || "en-IN",
      });
      setBp(data);
      setWelcome(data.welcome_line || welcome);
      setRefineText(""); refineRefText.current = "";
      toast.success("Dex rewired your OS with your addition.");
    } catch (e) {
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
  const deptItems = bp?.departments || [];
  const taskItems = (bp?.operational_tasks || []).map((t) => t.title).filter(Boolean).slice(0, 8);
  const pillStagger = pillStaggerFor(deptItems.length + taskItems.length);
  // `still` means "paint the end state now": either the founder skipped, or
  // they have asked the OS not to animate. Every motion prop below reads it.
  const still = skipped || reduced;

  /* ── the count tiles land ───────────────────────────────────────────────
     One timer per tile rather than one chained setTimeout per step: three
     re-renders total, and the bloom itself is a framer-motion delay on an
     element that is already mounted. */
  useEffect(() => {
    if (stage !== "preview" || !bp || choreoRef.current) return undefined;
    choreoRef.current = true;
    if (still) { setPlaced(3); setSettled(true); return undefined; }
    const timers = counts.map((_, i) =>
      setTimeout(() => setPlaced((n) => Math.max(n, i + 1)),
                 (CHOREO.tilesAt + i * CHOREO.tileGap + CHOREO.bloom + CHOREO.hold) * 1000));
    // Once the last pill has landed the sequence is over for good: CountUp is
    // swapped for a plain numeral so a later refinement changes the number in
    // place instead of ramping it from zero, which would read as a reset.
    timers.push(setTimeout(() => setSettled(true), CHOREO.CAP * 1000));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, bp]);

  /* Any click, tap or key jumps to the end. The CTA is excluded — a founder
     pressing "Looks good" mid-sequence means to leave, not to skip, and
     making that click do two things at once is how you get a mis-read. */
  const skipChoreo = useCallback(() => {
    setSkipped(true); setPlaced(3); setSettled(true);
  }, []);
  useEffect(() => {
    if (stage !== "preview" || still) return undefined;
    const onKey = () => skipChoreo();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [stage, still, skipChoreo]);

  /* ── what arrived with the last refinement ──────────────────────────────
     Diffed against the previous blueprint on normalized text, held for 5s,
     then dropped. The first new node is scrolled to — `block: "nearest"` so a
     change already on screen does not yank the page. */
  useEffect(() => {
    if (!bp) return undefined;
    const prev = prevBpRef.current;
    prevBpRef.current = bp;
    if (!prev) return undefined;            // the first build is not "new"

    const before = new Set([...(prev.departments || []), ...(prev.operational_tasks || [])].map(norm));
    const fresh = new Set(
      [...(bp.departments || []), ...(bp.operational_tasks || [])]
        .map(norm).filter((k) => k && !before.has(k))
    );
    const moved = new Set(
      [["Departments", (prev.departments || []).length, (bp.departments || []).length],
       ["Recurring tasks", (prev.operational_tasks || []).length, (bp.operational_tasks || []).length],
       ["Approval rules", (prev.approval_rules || []).length, (bp.approval_rules || []).length]]
        .filter(([, a, b]) => a !== b).map(([label]) => label)
    );
    if (!fresh.size && !moved.size) return undefined;

    setNewKeys(fresh); setChangedTiles(moved);
    clearTimeout(glowTimerRef.current);
    glowTimerRef.current = setTimeout(() => { setNewKeys(new Set()); setChangedTiles(new Set()); }, 5000);
    const t = setTimeout(() => {
      firstNewRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [bp, reduced]);

  useEffect(() => () => clearTimeout(glowTimerRef.current), []);

  /* KM-66 — the wave in the refine row. `refining` counts as thinking, so the
     pulse spans the whole round-trip; there is no speaking state because Dex
     does not talk on this screen. */
  const waveState = recorder.recording ? "listening"
    : (recorder.transcribing || refining) ? "thinking" : "idle";
  const waveLevelsRef = useSynthLevels(waveState);

  const workflowNames = (bp?.workflows || []).map((w) => w.name).filter(Boolean);
  const taskTitles = (bp?.operational_tasks || []).map((t) => t.title).filter(Boolean);

  const isPreview = stage === "preview" && bp;

  return (
    /* KM-66 — the pane moved INSIDE each stage. It used to wrap all four, so
       the draft could never be anything but one narrow column. building,
       registering and reveal keep the identical wrapper they always had; only
       preview escapes it, widening to max-w-5xl to match the header pill in
       Signup.js and splitting into three bands of its own. */
    <div className={`kr-well mx-auto w-full ${isPreview ? "max-w-5xl" : "max-w-2xl"}`} data-testid="signup-build">
      <AnimatePresence mode="wait">
        {/* ------------------------------------------------------ BUILDING */}
        {stage === "building" && (
          <motion.div key="building" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="kr-well__pane rounded-[1.75rem] p-6 text-center sm:p-9">
            <p className="mb-2 flex items-center justify-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkle size={14} weight="fill" className="text-[hsl(var(--kr-gold))]" /> Meet Dex — your build engineer
            </p>
            <h1 className="mb-7 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
              {/* KM-66 — a refinement no longer enters this stage, so the
                  `refining ?` branches that used to live here and on the
                  eyebrow above were unreachable. Collapsed to the one string
                  each still has. */}
              Dex is building {payload.company_name}&apos;s OS.
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
        {isPreview && (
          <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}
            data-testid="signup-build-preview"
            onClick={still ? undefined : skipChoreo}
            className="space-y-5 lg:space-y-7">

            {/* ── BAND 1 · the header ────────────────────────────────────
                In a pane, and that is the KM-42 contrast finding rather than
                decoration: the eyebrow is 11px muted type and the ground here
                is a photograph that goes dark. Every muted line on this screen
                sits on glass for the same reason. */}
            <div className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
              <Rise still={still} tag="p"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: CHOREO.eyebrow, duration: 0.24 }}
                className="mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Draft ready · review before you enter
              </Rise>
              <Rise still={still} tag="h1"
                initial={{ opacity: 0, y: 12, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ delay: CHOREO.h1, duration: 0.52, ease: [0.16, 1, 0.3, 1] }}
                className="mb-4 font-display text-3xl leading-[1.04] sm:text-4xl lg:text-5xl">
                Here&apos;s how {payload.company_name} will run on DecisionOS.
              </Rise>
              {welcome && (
                <Rise still={still} tag="p" data-testid="build-welcome-line"
                  initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: CHOREO.welcome, duration: 0.42 }}
                  className="max-w-2xl text-base leading-relaxed">{welcome}</Rise>
              )}
            </div>

            {/* ── BAND 2 · the counts ────────────────────────────────────
                Free-standing tiles, no pane of their own — .kr-frost-min IS
                the surface, and it is glass, so the 11px labels inside keep
                their ground. The grid holds all three cells from the first
                frame: a tile that has not landed leaves an invisible spacer of
                exactly its own size behind, so nothing reflows when it
                arrives. */}
            <div className="relative" data-testid="build-counts">
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                {counts.map((c, i) => (
                  <CountTile key={c.label} c={c} index={i} landed={i < placed}
                    settled={settled} still={still}
                    glow={changedTiles.has(c.label)} />
                ))}
              </div>
              {/* The bloom stage. Absolutely positioned over the row and
                  pointer-transparent, so a tile can be centred at 1.35 without
                  the row knowing. When `placed` passes it, the same layoutId
                  mounts in the cell below and framer-motion FLIPs it there —
                  a measured move, not a hand-computed translate. */}
              {!still && placed < counts.length && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  {counts.map((c, i) => (i >= placed ? (
                    <motion.div
                      key={`bloom-${c.label}`} layoutId={`count-tile-${c.label}`}
                      initial={{ opacity: 0, scale: 1.35, filter: "blur(8px)" }}
                      animate={{ opacity: 1, scale: 1.35, filter: "blur(0px)" }}
                      transition={{ delay: CHOREO.tilesAt + i * CHOREO.tileGap, duration: CHOREO.bloom }}
                      style={{ willChange: "filter, transform", gridArea: "1 / 1" }}
                      className="kr-frost-min w-[9.5rem] rounded-2xl p-4 text-center">
                      <p className="text-3xl font-semibold tabular-nums">
                        <CountUp value={c.n} duration={CHOREO.hold * 1000}
                          delay={(CHOREO.tilesAt + i * CHOREO.tileGap + CHOREO.bloom) * 1000} />
                      </p>
                      <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{c.label}</p>
                    </motion.div>
                  ) : null))}
                </div>
              )}
            </div>

            {/* ── BAND 3 · what Dex designed ─────────────────────────────
                Two columns on desktop, one pill per row inside each. The old
                wrapped cluster made a department and a task look like the same
                kind of thing in the same soup. */}
            <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
              <PillSection
                label="Departments" items={deptItems} testid="build-dept-pill"
                tint="kr-pressed bg-white/[.34]"
                startAt={CHOREO.sectionsAt} stagger={pillStagger} still={still}
                newKeys={newKeys} firstNewRef={firstNewRef} />
              <PillSection
                label="Recurring tasks Dex will keep on rails" items={taskItems} testid="build-task-pill"
                tint="kr-pressed"
                startAt={CHOREO.sectionsAt + deptItems.length * pillStagger + CHOREO.betweenSections}
                stagger={pillStagger} still={still}
                newKeys={newKeys} firstNewRef={firstNewRef} />
            </div>

            {/* Deliberately dead: WE-02 retired workflow_templates and the
                blueprint stopped returning workflows. Kept because it is the
                one place that lights up again if the field ever comes back —
                full width, below the pair, so it needs no column of its own. */}
            {workflowNames.length > 0 && (
              <PillSection
                label="Workflows — named after how you actually work" items={workflowNames} testid="build-workflow-pill"
                tint="kr-pressed bg-[hsl(var(--kr-gold)/.22)]"
                startAt={CHOREO.sectionsAt} stagger={pillStagger} still={still}
                newKeys={newKeys} firstNewRef={firstNewRef} />
            )}

            <Rise still={still}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ delay: CHOREO.CAP, duration: CHOREO.tail }}
              className="space-y-5">

              {/* Refine panel — voice or type */}
              <div className="kr-frost-min rounded-2xl p-4 sm:p-5" data-testid="build-refine-panel">
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
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        data-testid="build-refine-mic"
                        onClick={recorder.recording ? recorder.stop : recorder.start}
                        disabled={refining || recorder.transcribing}
                        className={`flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-xs font-medium disabled:opacity-50 ${
                          recorder.recording
                            ? "bg-kr-ink text-[hsl(var(--kr-gold))] shadow-[inset_0_2px_5px_hsl(230_30%_8%/.55),inset_0_-1px_0_hsl(0_0%_100%/.10),0_1px_0_hsl(0_0%_100%/.45)]"
                            : "kr-pop"
                        }`}>
                        {recorder.transcribing ? <CircleNotch size={14} className="animate-spin" />
                          : recorder.recording ? <Stop size={14} weight="fill" /> : <Sparkle size={14} weight="fill" />}
                        {recorder.transcribing ? "Transcribing…" : recorder.recording ? "Stop" : "Speak"}
                      </button>

                      {/* The same surface the interview shows, in the same
                          place for the same reason. min-w-0 is load-bearing:
                          without it the flex child will not shrink and pushes
                          the submit button off a narrow card. */}
                      <div className="mx-1 hidden h-10 min-w-0 flex-1 overflow-hidden sm:block"
                        aria-hidden="true" data-testid="build-refine-wave">
                        <DexWave levelsRef={waveLevelsRef} live={waveState !== "idle"} tone="ink" />
                      </div>

                      <button
                        data-testid="build-refine-submit"
                        onClick={submitRefinement}
                        disabled={!refineText.trim() || refining}
                        className="kr-pop flex h-11 shrink-0 items-center gap-2 rounded-pill bg-kr-ink px-5 text-xs font-medium text-white disabled:opacity-40">
                        {refining ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneRight size={14} weight="bold" />}
                        {refining ? "Applying…" : "Apply to my OS"}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* FUP-46: prominent error banner so 422/409/429 rejections
                  (e.g. reserved TLD like .test) actually catch the eye
                  instead of vanishing into a small red line. */}
              {error && (
                <div className="rounded-2xl border border-danger-600/40 bg-danger-600/10 p-4" data-testid="build-error-banner">
                  <p className="mb-1 text-sm font-bold text-danger-600">Couldn&apos;t create your workspace</p>
                  <p className="text-sm text-danger-600 font-semibold" data-testid="build-error">{error}</p>
                </div>
              )}

              <div className="flex items-center gap-3">
                {/* Excluded from the skip handler above: pressing this means
                    "let me in", not "stop the animation". It is never disabled
                    while the sequence runs. */}
                <button onClick={(e) => { e.stopPropagation(); confirmAndRegister(); }}
                  disabled={refining} data-testid="build-confirm-button"
                  className="kr-pop flex h-14 items-center gap-2 rounded-pill bg-kr-ink px-8 font-medium text-white disabled:opacity-50">
                  Looks good — Enter DecisionOS <ArrowRight size={18} weight="bold" />
                </button>
              </div>
            </Rise>
          </motion.div>
        )}

        {/* -------------------------------------------------- REGISTERING */}
        {stage === "registering" && (
          <motion.div key="registering" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
            className="kr-well__pane rounded-[1.75rem] p-6 text-center sm:p-9" data-testid="signup-registering">
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
          <motion.div key="reveal" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
            className="kr-well__pane rounded-[1.75rem] p-6 sm:p-9">
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
  );
}

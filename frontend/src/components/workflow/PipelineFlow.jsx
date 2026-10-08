import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, CheckCircle, ShieldCheck, UsersThree } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/* HOW WORK MOVES — one picture of a company's pipelines (audit 2026-10-08).
 *
 * An owner's operating model was a form (Settings › Operations: stages as
 * text boxes, roles as dropdowns) and, at sign-up, not shown at all. But the
 * pipeline IS the product's promise: an order moves from enquiry to shipped,
 * each step is owned by a team, each step carries its own work, and somewhere
 * the owner signs off. So it is drawn as a route:
 *
 *   ● ─── ● ─── ◆ ─── ● ─── ●        one station per step, in order
 *   Enquiry  Sampling  Confirmed …    the team that owns it, the work it needs
 *                 ▲ gold: sign-off    "Sales up to ₹5 lakh · above that, you"
 *
 * Pick a station and the work at that step opens below it. The route reads
 * left to right when every step gets room for its name (STATION_MIN_PX each,
 * measured on the space this card actually has -- not a screen breakpoint),
 * and top to bottom as a timeline when it does not: a phone, a narrow
 * card, or a long pipeline. Never a sideways scroll, never a step cut off. Used on the sign-up review (before the founder enters) and in
 * Settings › Operations, so what they were shown is what they find.
 *
 * Props: pipelines (operating_model.pipelines), teams ([{key,label}]),
 * still (no motion), testid. Read-only by design: editing stays in the
 * operating-model editor. */

/** The pipelines with the stage rules laid on (sign-off step and the team that
 *  may clear it up to a value) -- only for rules still listed. Mirrors
 *  services/ai/approval_rules.apply_to_pipelines; returns new objects. */
export function withRules(pipelines, actions, ruleNames) {
  const keep = ruleNames ? new Set(ruleNames) : null;
  const out = (pipelines || []).map((p) => ({ ...p }));
  for (const a of actions || []) {
    if (a.kind !== "stage_limit" && a.kind !== "owner_stage") continue;
    if (keep && !keep.has(a.rule)) continue;
    const p = out.find((x) => x.key === a.pipeline);
    if (!p || !(p.stages || []).some((s) => s.key === a.stage)) continue;
    p.approval_stage = a.stage;
    if (a.kind === "stage_limit") p.approval_delegate = { role: a.team, up_to: a.up_to };
    else delete p.approval_delegate;
  }
  return out;
}

// The room one step needs to read across: its name over two lines, its team chip.
const STATION_MIN_PX = 112;

const inrShort = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `₹${+(v / 1e7).toFixed(2)} crore`;
  if (v >= 1e5) return `₹${+(v / 1e5).toFixed(2)} lakh`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
};

function useTeamLabel(teams) {
  return useMemo(() => {
    const map = Object.fromEntries((teams || []).filter((t) => t?.key).map((t) => [t.key, t.label || t.key]));
    return (key) => (!key ? "" : key === "owner" ? "You" : map[key] || key.replace(/_/g, " "));
  }, [teams]);
}

/** What the sign-off step means, in a sentence. */
function signOffLine(pipeline, teamLabel) {
  const d = pipeline?.approval_delegate;
  if (d?.role && Number(d.up_to) > 0) {
    return `${teamLabel(d.role)} up to ${inrShort(d.up_to)} · above that, you`;
  }
  return "Only you can move work here";
}

function Station({ stage, index, pipeline, selected, onSelect, teamLabel, still, last, vertical }) {
  const signOff = pipeline.approval_stage === stage.key;
  const gate = stage.approval?.role;
  const tasks = stage.tasks || [];
  const Tag = still ? "div" : motion.div;
  const motionProps = still ? {} : {
    initial: { opacity: 0, y: vertical ? 0 : 10, x: vertical ? -10 : 0 },
    animate: { opacity: 1, y: 0, x: 0 },
    transition: { delay: 0.06 * index, duration: 0.32, ease: [0.16, 1, 0.3, 1] },
  };
  return (
    <Tag {...motionProps}
      className={cn("relative", vertical ? "flex gap-3 pb-5 last:pb-0" : "flex min-w-[6.75rem] flex-1 basis-0 flex-col items-center px-1")}>
      {/* the line to the next station */}
      {!last && (
        <span aria-hidden="true"
          className={cn("absolute bg-slate-900/15",
            vertical ? "left-[15px] top-8 bottom-0 w-px" : "left-1/2 top-[15px] h-px w-full")} />
      )}
      <button type="button" onClick={onSelect} aria-pressed={selected}
        aria-label={`Step ${index + 1}: ${stage.label}${signOff ? " — you sign off here" : ""}`}
        data-testid={`flow-station-${stage.key}`}
        className={cn(
          "relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-[transform,box-shadow] duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 motion-reduce:transition-none",
          signOff ? "bg-[hsl(var(--kr-gold))] text-slate-900 shadow-[0_0_0_4px_hsl(var(--kr-gold)/.25)]"
            : selected ? "bg-kr-ink text-white" : "bg-white text-slate-700 ring-1 ring-inset ring-slate-900/15 hover:ring-slate-900/30",
          selected && "scale-110",
        )}>
        {signOff ? <ShieldCheck size={15} weight="fill" aria-hidden="true" /> : index + 1}
      </button>
      <button type="button" onClick={onSelect} tabIndex={-1}
        className={cn("min-w-0 text-left", vertical ? "flex-1 pt-1" : "mt-2.5 w-full text-center")}>
        <span className={cn("block font-semibold leading-snug [overflow-wrap:anywhere]", vertical ? "text-sm" : "text-[13px]",
          selected ? "text-slate-900" : "text-slate-800")}>
          {stage.label}
        </span>
        {stage.role && (
          // The team's whole name: it wraps rather than being cut to "Sales & Merchan…".
          <span className={cn("mt-1 inline-flex max-w-full items-start gap-1 rounded-xl px-2 py-0.5 text-left text-[11px] font-medium leading-snug",
            stage.role === "owner" ? "bg-[hsl(var(--kr-gold)/.22)] text-slate-800" : "bg-slate-900/[0.06] text-slate-600")}>
            <UsersThree size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{teamLabel(stage.role)}</span>
          </span>
        )}
        <span className="mt-1 block text-[11px] text-slate-500">
          {tasks.length ? `${tasks.length} piece${tasks.length === 1 ? "" : "s"} of work` : "No set work"}
        </span>
        {signOff && (
          <span className="mt-1.5 inline-block rounded-xl bg-[hsl(var(--kr-gold)/.18)] px-2 py-1 text-[11px] font-medium leading-snug text-slate-800"
            data-testid="flow-signoff-line">
            {signOffLine(pipeline, teamLabel)}
          </span>
        )}
        {gate && !signOff && (
          <span className="mt-1.5 inline-block text-[11px] text-slate-500">{teamLabel(gate)} approves before it moves on</span>
        )}
      </button>
    </Tag>
  );
}

export function PipelineFlow({ pipelines, teams, still = false, testid = "pipeline-flow", className }) {
  const list = useMemo(() => (pipelines || []).filter((p) => p && (p.stages || []).length), [pipelines]);
  const teamLabel = useTeamLabel(teams);
  const [pi, setPi] = useState(0);
  const p = list[Math.min(pi, Math.max(list.length - 1, 0))];
  const [si, setSi] = useState(0);
  // Across or down: measured on this card's width, and again whenever it changes.
  const boxRef = useRef(null);
  const [across, setAcross] = useState(false);
  const count = (p?.stages || []).length;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const fit = () => setAcross(el.clientWidth >= count * STATION_MIN_PX);
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);
  // A new pipeline opens on its sign-off step if it has one: that is the
  // decision the founder most needs to see; otherwise on the first step.
  useEffect(() => {
    if (!p) return;
    const at = (p.stages || []).findIndex((s) => s.key === p.approval_stage);
    setSi(at >= 0 ? at : 0);
  }, [p]);
  if (!p) return null;
  const stages = p.stages || [];
  const stage = stages[Math.min(si, stages.length - 1)];
  const work = stages.reduce((n, s) => n + (s.tasks || []).length, 0);
  const signOffHere = stage && p.approval_stage === stage.key;

  return (
    <div className={cn("space-y-4", className)} data-testid={testid}>
      {list.length > 1 && (
        <div role="tablist" aria-label="Pipelines" className="flex flex-wrap gap-1.5">
          {list.map((x, i) => (
            <button key={x.key} type="button" role="tab" aria-selected={i === pi} onClick={() => setPi(i)}
              data-testid={`flow-pipeline-${x.key}`}
              className={cn("h-9 rounded-pill px-3.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25",
                i === pi ? "bg-kr-ink text-white" : "bg-white/80 text-slate-700 ring-1 ring-inset ring-slate-900/10 hover:bg-white")}>
              {x.label}
              <span className={cn("ml-1.5 tabular-nums", i === pi ? "text-white/70" : "text-slate-400")}>{(x.stages || []).length}</span>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500" data-testid="flow-summary">
        <span className="font-semibold text-slate-800">{p.label}</span>
        {" · "}{stages[0]?.label} → {stages[stages.length - 1]?.label}
        {" · "}{stages.length} steps{work ? ` · ${work} pieces of work set up for you` : ""}
      </p>

      {/* the route: across when every step has room, down (a timeline) when not */}
      <div ref={boxRef} className="min-w-0">
        {across ? (
          <div className="flex items-start" data-testid="flow-track">
            {stages.map((s, i) => (
              <Station key={s.key} stage={s} index={i} pipeline={p} selected={i === si} onSelect={() => setSi(i)}
                teamLabel={teamLabel} still={still} last={i === stages.length - 1} />
            ))}
          </div>
        ) : (
          <div data-testid="flow-timeline">
            {stages.map((s, i) => (
              <Station key={s.key} stage={s} index={i} pipeline={p} selected={i === si} onSelect={() => setSi(i)}
                teamLabel={teamLabel} still={still} last={i === stages.length - 1} vertical />
            ))}
          </div>
        )}
      </div>

      {/* the step that is open */}
      {stage && (
        <div className="rounded-2xl bg-white/80 p-4 ring-1 ring-inset ring-slate-900/[0.06]" data-testid="flow-detail" aria-live="polite">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            Step {si + 1} of {stages.length}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {stage.label}
            {stage.role && <span className="font-normal text-slate-500"> · {stage.role === "owner" ? "you own this step" : `${teamLabel(stage.role)} owns this step`}</span>}
          </p>
          {signOffHere && (
            <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-[hsl(var(--kr-gold)/.16)] px-2.5 py-2 text-xs text-slate-800">
              <ShieldCheck size={14} weight="fill" aria-hidden="true" className="mt-px shrink-0" />
              <span>Sign-off: {signOffLine(p, teamLabel)}. Nothing moves into this step until it is cleared.</span>
            </p>
          )}
          {(stage.tasks || []).length ? (
            <ul className="mt-3 space-y-1.5" data-testid="flow-detail-work">
              {stage.tasks.map((t, i) => (
                <li key={`${t.title}-${i}`} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckCircle size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    {t.title}
                    {t.role && t.role !== stage.role && (
                      <span className="ml-1.5 text-[11px] text-slate-500">· {teamLabel(t.role)}</span>
                    )}
                    {t.evidence_required && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-slate-500">
                        <Camera size={11} aria-hidden="true" /> needs proof
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">No set work at this step — cards just pass through.</p>
          )}
        </div>
      )}
    </div>
  );
}

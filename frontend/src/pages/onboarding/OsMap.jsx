/* THE REVIEW, AS A MAP (2026-10-29, founder): "each thing shown in the final
 * Your OS section… analysed according to its hierarchy and importance,
 * rearranged and shown in a visually appealing, illustrative, interactive way
 * instead of grids of cards and a form-like list."
 *
 * The draft has a shape, so it is drawn as one: the company at the centre,
 * its teams round it, and — from the pipelines Dex laid out — the hand-offs
 * between them, as arrows from the team that finishes a step to the team that
 * takes the next one. A team is the unit a founder recognises, so the map is
 * the hero and everything else hangs off it: pick a team and the panel says
 * what it owns, where it stands in each workflow, and who it passes work to.
 * Routines follow below as tracks by kind of work, not a list of strings.
 *
 * Motion (DESIGNER'S-PLUGINS/motion-design): the same Premium curve as
 * OsAssembly; teams land in a short stagger (< 400ms total), hand-offs draw in
 * after them, and the arrows carry a slow current — the ambient layer.
 */
import { useMemo, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  UsersFour, ArrowRight, CursorClick, MagnifyingGlass, Briefcase, Wallet, Gear,
  Handshake, ShieldCheck, Truck, ChatCircleText, Circle,
} from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

const EASE = [0.22, 1, 0.36, 1];
const slug = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");
const initials = (name) => {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return w.length ? (w[0][0] + (w[1]?.[0] || "")).toUpperCase() : "OS";
};

export function teamsOf(departments) {
  return (departments || []).map((d) => (typeof d === "string"
    ? { key: slug(d), label: d }
    : { key: d.key || slug(d.label || d.name), label: d.label || d.name || "" }))
    .filter((d) => d.label);
}

/* Who owns which steps, and who hands work to whom, read off the pipelines. */
function readFlow(teams, pipelines) {
  const by = Object.fromEntries(teams.map((t) => [t.key, { steps: [], work: 0, to: new Set(), from: new Set() }]));
  const edges = new Map();
  for (const p of pipelines || []) {
    const st = p.stages || [];
    st.forEach((s, i) => {
      const own = by[s.role];
      if (own) {
        own.steps.push({ pipeline: p.key, stage: s.key, label: s.label, work: (s.tasks || []).length, gate: !!s.approval });
        own.work += (s.tasks || []).length;
      }
      const next = st[i + 1];
      if (next && s.role && next.role && s.role !== next.role && by[s.role] && by[next.role]) {
        const k = `${s.role}>${next.role}`;
        edges.set(k, (edges.get(k) || 0) + 1);
        by[s.role].to.add(next.role);
        by[next.role].from.add(s.role);
      }
    });
  }
  return { by, edges: [...edges].map(([k, n]) => { const [a, b] = k.split(">"); return { a, b, n }; }) };
}

export function OrgMap({ company, departments, pipelines = [], flowReady, counts, isNew }) {
  const reduce = useReducedMotion();
  const teams = useMemo(() => teamsOf(departments), [departments]);
  const flow = useMemo(() => readFlow(teams, pipelines), [teams, pipelines]);
  const [sel, setSel] = useState(null);
  const n = teams.length;
  const ring = typeof window !== "undefined" && window.innerWidth < 640 ? 32 : 36;
  const at = (i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    // 33% keeps a side team's label inside a phone-width map; 36% on wider.
    return { x: 50 + ring * Math.cos(a), y: 50 + ring * Math.sin(a) };
  };
  const pos = Object.fromEntries(teams.map((t, i) => [t.key, at(i)]));
  const lit = (k) => !sel || sel === k;
  const selTeam = teams.find((t) => t.key === sel);
  const label = (k) => teams.find((t) => t.key === k)?.label || k;
  const busiest = [...flow.edges].sort((x, y) => y.n - x.n)[0];

  return (
    <section className="ob-os rounded-[2rem] p-5 sm:p-7" data-testid="build-org-map" aria-label="Your teams and how work passes between them">
      <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-8">
        <div>
        <div className="relative mx-auto aspect-square w-full max-w-[30rem]">
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              <marker id="ob-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
                <path d="M0 0 L6 3 L0 6 z" fill="hsl(230 25% 25% / .5)" />
              </marker>
              <marker id="ob-arrow-gold" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
                <path d="M0 0 L6 3 L0 6 z" fill="hsl(var(--ng-gold))" />
              </marker>
            </defs>
            <circle cx="50" cy="50" r={ring} fill="none" stroke="hsl(230 20% 30% / .10)" strokeWidth=".3" strokeDasharray="1 1.6" />
            {/* 2026-10-29 (founder: "the arrows are not aligned to the circle")
                — HAND-OFFS RUN ALONG THE RING. Each one is an arc of the
                circle the teams sit on, from the team that finishes a step to
                the team that takes the next, the short way round. Clockwise
                hand-offs ride just outside the ring and anticlockwise ones
                just inside, so a two-way pair reads as two lanes, not one. */}
            {flow.edges.map((e, i) => {
              const ia = teams.findIndex((t) => t.key === e.a);
              const ib = teams.findIndex((t) => t.key === e.b);
              const ang = (k) => -Math.PI / 2 + (k * 2 * Math.PI) / Math.max(n, 1);
              let d = ang(ib) - ang(ia);
              while (d > Math.PI) d -= 2 * Math.PI;
              while (d <= -Math.PI) d += 2 * Math.PI;
              const dir = Math.abs(Math.abs(d) - Math.PI) < 1e-6 ? (ia < ib ? 1 : -1) : Math.sign(d);
              const R = ring + dir * 2.6;
              const trim = 8.5 / ring;
              const a0 = ang(ia) + dir * trim;
              const a1 = ang(ia) + dir * (Math.abs(d) - trim);
              const P = (t) => `${(50 + R * Math.cos(t)).toFixed(2)} ${(50 + R * Math.sin(t)).toFixed(2)}`;
              const on = sel && (sel === e.a || sel === e.b);
              return (
                <motion.path key={`${e.a}>${e.b}`} d={`M${P(a0)} A${R} ${R} 0 0 ${dir > 0 ? 1 : 0} ${P(a1)}`} fill="none"
                  stroke={on ? "hsl(var(--ng-gold))" : "hsl(230 25% 25% / .38)"}
                  strokeWidth={on ? ".7" : ".45"} markerEnd={on ? "url(#ob-arrow-gold)" : "url(#ob-arrow)"}
                  className={!reduce ? "ob-handoff" : undefined}
                  initial={reduce ? false : { opacity: 0 }} animate={{ opacity: !sel || on ? 1 : 0.18 }}
                  transition={{ duration: 0.5, delay: reduce ? 0 : 0.5 + i * 0.06 }} />
              );
            })}
          </svg>

          <button type="button" onClick={() => setSel(null)} aria-label={`${company} — show everything`}
            className="absolute left-1/2 top-1/2 grid h-[4.5rem] w-[4.5rem] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[linear-gradient(160deg,hsl(0_0%_26%),hsl(0_0%_6%))] text-white shadow-[0_16px_34px_-14px_hsl(230_30%_10%/.65),inset_0_1px_0_hsl(0_0%_100%/.18)] sm:h-24 sm:w-24">
            <span className="font-display text-xl font-semibold sm:text-3xl">{initials(company)}</span>
          </button>

          {teams.map((t, i) => {
            const p = pos[t.key];
            const st = flow.by[t.key];
            const on = sel === t.key;
            return (
              /* The node's centre ON the ring: a plain wrapper does the placing
                 (half the icon up: 24px, 28px from sm), because framer's own
                 transform on the button would replace any translate class. */
              <div key={t.key} className="absolute w-[5.25rem] -translate-x-1/2 -translate-y-6 sm:w-28 sm:-translate-y-7"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <motion.button type="button" data-testid="build-dept-pill"
                onClick={() => setSel(on ? null : t.key)} aria-pressed={on}
                className="flex w-full flex-col items-center"
                initial={reduce ? false : { opacity: 0, scale: 0.6 }} animate={{ opacity: lit(t.key) ? 1 : 0.45, scale: 1 }}
                transition={{ duration: 0.5, ease: EASE, delay: reduce ? 0 : 0.08 + i * 0.05 }}>
                <span className={cn(
                  "relative grid h-12 w-12 place-items-center rounded-2xl border shadow-[0_10px_24px_-12px_hsl(230_30%_18%/.5)] transition-colors sm:h-14 sm:w-14",
                  on ? "border-transparent bg-[hsl(230_15%_12%)] text-white ring-4 ring-[hsl(var(--ng-gold)/.35)]"
                    : "border-white/80 bg-white/85 text-slate-800 backdrop-blur-md hover:bg-white",
                  isNew?.(t) && "ring-4 ring-[hsl(var(--ng-gold)/.45)]"
                )}>
                  <UsersFour size={22} weight={on ? "fill" : "duotone"} aria-hidden="true" />
                  {flowReady && st?.steps.length > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--ng-gold))] px-1 text-[10px] font-bold tabular-nums text-slate-900"
                      title={`${st.steps.length} steps`}>{st.steps.length}</span>
                  )}
                </span>
                <span className={cn("mt-1.5 line-clamp-2 rounded-lg bg-white/95 px-2 py-0.5 text-center text-[11px] font-medium leading-tight shadow-[0_4px_12px_-8px_hsl(230_30%_18%/.5)] sm:text-[12px]", on ? "text-slate-900" : "text-slate-700")}>
                  {t.label}
                </span>
              </motion.button>
              </div>
            );
          })}
        </div>

        {/* How to read it, in the map's own marks. */}
        <ul className="mx-auto mt-3 flex max-w-[30rem] flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500" data-testid="build-map-legend">
          <li className="flex items-center gap-1.5">
            <span className="grid h-4 w-4 place-items-center rounded-md border border-white bg-white text-slate-700 shadow-sm"><UsersFour size={10} weight="bold" aria-hidden="true" /></span>
            A team
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0 w-5 border-t-[1.5px] border-dashed border-slate-500" />
            <ArrowRight size={10} weight="bold" className="-ml-1.5 text-slate-500" aria-hidden="true" />
            Hands work to
          </li>
          <li className="flex items-center gap-1.5">
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[hsl(var(--ng-gold))] px-1 text-[9px] font-bold text-slate-900">3</span>
            Steps it owns
          </li>
        </ul>
        </div>

        <div className="min-w-0" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {!selTeam ? (
              <motion.div key="all" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: EASE }} data-testid="build-counts">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">At a glance</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                  {counts.map((c) => (
                    <div key={c.label}>
                      <dd className="font-display text-4xl font-semibold leading-none tabular-nums text-slate-900">{c.n}</dd>
                      <dt className="mt-1 text-xs text-slate-500">{c.label}</dt>
                    </div>
                  ))}
                </dl>
                {busiest && (
                  <p className="mt-5 flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                    <span className="text-slate-500">Busiest hand-off</span>
                    <span className="font-medium">{label(busiest.a)}</span>
                    <ArrowRight size={13} weight="bold" className="text-[hsl(var(--ng-gold))]" aria-hidden="true" />
                    <span className="font-medium">{label(busiest.b)}</span>
                  </p>
                )}
                <p className="mt-5 flex items-center gap-2 text-sm text-slate-500">
                  <CursorClick size={16} weight="bold" aria-hidden="true" /> Tap a team to see what it owns.
                </p>
              </motion.div>
            ) : (
              <TeamPanel key={selTeam.key} team={selTeam} st={flow.by[selTeam.key]} pipelines={pipelines}
                flowReady={flowReady} label={label} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

function TeamPanel({ team, st, pipelines, flowReady, label }) {
  const mine = (pipelines || []).filter((p) => (p.stages || []).some((s) => s.role === team.key));
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3, ease: EASE }} data-testid="build-team-panel">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Team</p>
      <h3 className="mt-1 font-display text-2xl leading-tight text-slate-900">{team.label}</h3>
      {!flowReady ? (
        <p className="ng-glow-text mt-3 text-sm">Dex is laying out the work this team owns…</p>
      ) : !st?.steps.length ? (
        <p className="mt-3 text-sm text-slate-500">No steps of its own yet — it can pick up tasks and requests.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Does {st.steps.length} {st.steps.length === 1 ? "step" : "steps"} across {mine.length} {mine.length === 1 ? "workflow" : "workflows"} — the dark ones below.
          </p>
          <div className="mt-4 space-y-4">
            {mine.map((p) => (
              <div key={p.key}>
                <p className="text-[12px] font-semibold text-slate-800">{p.label}</p>
                {/* The whole route by name, in order; this team's steps are the
                    dark ones, so "where do we come in" reads without a key. */}
                <ol className="mt-2 flex flex-wrap items-center gap-1">
                  {(p.stages || []).map((s, i, arr) => (
                    <li key={s.key} className="flex items-center gap-1">
                      <span className={cn("rounded-full px-2.5 py-1 text-[12px] leading-none",
                        s.role === team.key ? "bg-[hsl(230_15%_12%)] font-medium text-white" : "bg-white/70 text-slate-500 ring-1 ring-inset ring-slate-900/[0.06]")}>
                        {s.label}
                      </span>
                      {i < arr.length - 1 && <ArrowRight size={10} weight="bold" className="text-slate-400" aria-hidden="true" />}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
          {(st.to.size > 0 || st.from.size > 0) && (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px]">
              {st.from.size > 0 && <p><span className="text-slate-500">Gets work from </span><span className="font-medium text-slate-800">{[...st.from].map(label).join(", ")}</span></p>}
              {st.to.size > 0 && <p><span className="text-slate-500">Hands work to </span><span className="font-medium text-slate-800">{[...st.to].map(label).join(", ")}</span></p>}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

/* Routines, by kind of work: one track per kind, each task a stop on it. */
const KIND_ICON = [
  [/review|audit|check|inspect/i, MagnifyingGlass],
  [/admin|office|document/i, Briefcase],
  [/financ|account|payment|cash|tax/i, Wallet],
  [/sales|customer|client|buyer/i, Handshake],
  [/complian|legal|safety|quality/i, ShieldCheck],
  [/dispatch|logist|delivery|ship/i, Truck],
  [/communic|meeting|report/i, ChatCircleText],
  [/operat|production|process/i, Gear],
];
const kindIcon = (k) => (KIND_ICON.find(([re]) => re.test(k)) || [null, Circle])[1];

export function Routines({ tasks, isNew }) {
  const reduce = useReducedMotion();
  const rows = useMemo(() => (tasks || [])
    .map((t) => ({ title: (typeof t === "string" ? t : t?.title) || "", kind: (typeof t === "object" && t?.category) || "", raw: t }))
    .filter((r) => r.title), [tasks]);
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 5);
  /* 2026-10-29 (founder: "easy to understand… using actual UI components")
     — the routines as they will arrive: rows in My Work, in the app's own
     task look, so the founder sees the product before they are in it. */
  return (
    <section className="ob-os rounded-[2rem] p-5 sm:p-7" data-testid="build-routines">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-8">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Kept on rails</p>
          <h3 className="mt-1 font-display text-2xl leading-tight text-slate-900">{rows.length} routines, on repeat</h3>
          <p className="mt-2 text-sm text-slate-600">Dex hands these out on schedule. Your team sees them in My Work, like this.</p>
        </div>
        <div className="overflow-hidden rounded-[1.5rem] border border-white/80 bg-white/90 shadow-[0_18px_40px_-24px_hsl(230_30%_18%/.55)]" aria-label="Preview of My Work">
          <div className="flex items-center justify-between gap-3 border-b border-slate-900/[0.06] px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">My Work</p>
            <span className="rounded-full bg-slate-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-600">Recurring</span>
          </div>
          <ul>
            {shown.map((r, i) => {
              const Icon = kindIcon(r.kind);
              return (
                <motion.li key={`${r.title}-${i}`} data-testid="build-task-pill"
                  initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: EASE, delay: reduce ? 0 : 0.1 + i * 0.04 }}
                  className={cn("flex items-center gap-3 border-b border-slate-900/[0.05] px-4 py-3 last:border-b-0",
                    isNew?.(r.raw) && "bg-[hsl(var(--ng-gold)/.12)]")}>
                  <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-slate-300" />
                  <span className="min-w-0 flex-1 text-[14px] leading-snug text-slate-800">{r.title}</span>
                  {r.kind && r.kind !== "Other" && (
                    <span className="hidden shrink-0 items-center gap-1 rounded-full bg-slate-900/[0.05] px-2 py-1 text-[11px] text-slate-600 sm:flex">
                      <Icon size={11} weight="bold" aria-hidden="true" /> {r.kind}
                    </span>
                  )}
                </motion.li>
              );
            })}
          </ul>
          {rows.length > 5 && (
            <button type="button" onClick={() => setAll((v) => !v)} data-testid="build-routines-more"
              className="w-full border-t border-slate-900/[0.06] px-4 py-2.5 text-left text-[13px] font-medium text-slate-600 hover:bg-slate-900/[0.02]">
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

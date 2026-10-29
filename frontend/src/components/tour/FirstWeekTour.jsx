/* THE FIRST-WEEK TOUR — over the real desktop app (2026-10-30, founder).
 *
 * "Show the walkthrough in the actual DecisionOS application, blended with
 * the illustrative elements… templatised, with mock data and mock replies."
 * And then, on seeing a first cut: "many parts showed something else, or
 * invented UI of their own instead of the actual page — check visually what
 * you show against the real app; desktop only — the phone keeps its short
 * walkthrough."
 *
 * So the real page is never drawn over. Each step puts a spotlight on a REAL
 * element of the page it is on — the Desk's board, its numbers, the Decide
 * well, the first column of a workflow's board, the routines bar, the My Work
 * list, the approvals area, the Dex pill, the nav — and the note card beside
 * it carries the moment as a small animated preview, filled from their own
 * company (their sign-off rule as a waiting decision, their words and the
 * tasks Dex drafts, an order walking their workflow, a checklist ticking,
 * the approval, Dex's answer). The previews are mocks: nothing is asked of
 * the server and nothing is written. Their company "at a glance" opens it and
 * the cycle closes it; "Start using DecisionOS" leaves the live app.
 *
 * It plays once, the first time a founder opens the workspace they built
 * (signup keeps the script: lib/firstTour), after the welcome, the Terms and
 * any dialog (Walkthrough's clearToStart); it can be played again from the
 * account menu. Rects are divided by --ui-scale, as the app is CSS-zoomed.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, ArrowCounterClockwise, Check, ShieldCheck, Sparkle, Microphone, Kanban,
  Wallet, AddressBook, UsersThree, Brain, BookOpenText, Gauge, SunHorizon, CalendarBlank, ArrowsClockwise, ListChecks,
} from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { clearToStart } from "@/components/mobile/Walkthrough";
import { INK_PILL, GLASS_PILL } from "@/components/neuglass/glass";
import { readFirstTour, setFirstTourStep, finishFirstTour } from "@/lib/firstTour";
import { buildScenes, typed, rise, short } from "@/pages/onboarding/walkthrough/scenes";
import { span, SCREEN, Still } from "@/pages/onboarding/walkthrough/Player";
import { cn } from "@/lib/utils";

const GOLD = "hsl(44 88% 60%)";
const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;

/* The first selector that is on screen, in CSS px of the zoomed body, held
   inside the window. */
function find(selectors, scroll) {
  const s = uiScale();
  for (const sel of selectors || []) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (scroll) el.scrollIntoView({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const vw = window.innerWidth / s; const vh = window.innerHeight / s;
    const x = Math.max(8, r.left / s); const y = Math.max(8, r.top / s);
    return { x, y, w: Math.min(r.right / s, vw - 8) - x, h: Math.min(r.bottom / s, vh - 8) - y, vw, vh };
  }
  return null;
}

/* ── The previews: the moment, small, inside the note card ──────────────── */

const Frame = ({ children, dark }) => (
  <div className={cn("relative mt-3 overflow-hidden rounded-2xl p-3", dark ? "bg-[hsl(240_4%_9%)] text-white" : "bg-[hsl(225_12%_95%)] ring-1 ring-inset ring-slate-900/[0.05]")}
    aria-hidden="true">{children}</div>
);

function PreviewDecisions({ j, p }) {
  const rows = [
    { t: j.rule?.name || "A purchase above your limit", m: "Needs you · from your rules", hue: "hsl(33 92% 56%)" },
    { t: `${(j.flowsInOrder?.[0] || j.flows?.[0])?.label || "Orders"}: this week`, m: "Draft · Dex", hue: "hsl(210 55% 50%)" },
  ];
  return (
    <Frame dark>
      <p className="flex items-center gap-2 text-[12px] font-medium text-white/80"><span className="h-2 w-2 rounded-full bg-[hsl(33_92%_56%)]" />Decisions</p>
      {rows.map((r, i) => (
        <div key={i} className="mt-2 flex items-center gap-2.5 border-t border-white/[.14] pt-2" style={rise(p, 0.1 + i * 0.25, 0.3 + i * 0.25, 10)}>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.hue }} />
          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-neutral-200">{r.t}</span><span className="block truncate text-[11px] text-neutral-400">{r.m}</span></span>
        </div>
      ))}
    </Frame>
  );
}

function PreviewDraft({ j, p }) {
  const f = j.flowsInOrder?.[0] || j.flow;
  const plan = (f?.stages || []).slice(0, 3).map((s) => ({ task: s.tasks?.[0] || s.label, team: s.gate ? "You" : s.team }));
  return (
    <Frame>
      <div className="flex items-start gap-2 rounded-xl bg-white px-2.5 py-2 text-[12px] leading-snug text-slate-800 ring-1 ring-[hsl(44_88%_60%/.6)]">
        <Microphone size={13} weight="fill" className="mt-0.5 shrink-0 text-amber-500" />
        <span className="min-w-0">{typed(j.said, p, 0.04, 0.38) || " "}</span>
      </div>
      {p > 0.38 && p < 0.48 && <p className="ng-glow-text mt-2 text-[12px] font-medium">Dex is drafting the tasks…</p>}
      <div className="mt-2 space-y-1.5">
        {plan.map((x, i) => (
          <div key={i} className="flex items-center gap-2 rounded-xl bg-white px-2.5 py-1.5" style={rise(p, 0.48 + i * 0.1, 0.6 + i * 0.1, 8)}>
            <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold", INK_PILL)}>{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-800">{x.task}</span>
            <span className="shrink-0 rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-[10px] text-slate-600">{short(x.team, 16)}</span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

function PreviewRoute({ f, p }) {
  const st = (f?.stages || []).slice(0, 6);
  const n = Math.max(1, st.length);
  const k = Math.min(n - 1, Math.floor(span(p, 0.06, 0.94, (x) => x) * n));
  return (
    <Frame>
      <div className="flex items-start">
        {st.map((s, i) => (
          <div key={i} className="relative flex min-w-0 flex-1 flex-col items-center">
            {i < n - 1 && <span className="absolute left-1/2 top-[11px] h-px w-full bg-slate-300" />}
            <span className={cn("relative z-[1] grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold transition-colors",
              i < k ? INK_PILL : i === k ? (s.gate ? "bg-[hsl(44_88%_60%)] text-slate-900" : INK_PILL) : "bg-white text-slate-500 ring-1 ring-slate-300")}
              style={{ boxShadow: i === k ? `0 0 0 4px ${GOLD}55` : undefined }}>
              {s.gate ? <ShieldCheck size={11} weight="fill" /> : i < k ? <Check size={10} weight="bold" /> : i + 1}
            </span>
            <span className={cn("mt-1 line-clamp-2 px-0.5 text-center text-[10px] leading-tight", i === k ? "font-semibold text-slate-900" : "text-slate-500")}>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 rounded-xl bg-white px-2.5 py-2 text-[12px]">
        <span className="font-semibold text-slate-900">Order #1042</span>
        <span className="text-slate-500"> · {st[k]?.gate ? "waiting for your sign-off" : `with ${short(st[k]?.team || "the team", 22)}`}</span>
      </div>
    </Frame>
  );
}

function PreviewRoutines({ j, p }) {
  return (
    <Frame>
      {j.routines.slice(0, 3).map((r, i) => (
        <div key={i} className="mt-1.5 flex items-center gap-2 rounded-xl bg-white px-2.5 py-1.5 first:mt-0" style={rise(p, 0.1 + i * 0.2, 0.28 + i * 0.2, 8)}>
          <ArrowsClockwise size={12} weight="bold" className="shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-slate-800">{r}</span>
        </div>
      ))}
    </Frame>
  );
}

function PreviewTask({ j, p }) {
  // A checklist worth watching: the team's own tasks, or a step from each
  // stage of their first workflow when the team has only one or two.
  const f = j.flowsInOrder?.[0] || j.flow;
  const steps = ((j.memberTasks || []).length >= 3 ? j.memberTasks : (f?.stages || []).map((s) => s.tasks?.[0] || s.label)).slice(0, 5);
  const at = Math.min(steps.length, Math.floor(span(p, 0.15, 0.85, (x) => x) * (steps.length + 1)));
  const done = at >= steps.length;
  return (
    <Frame>
      <div className="rounded-xl bg-white p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{j.memberTeam}</p>
        <div className="mt-1.5 flex items-center">
          {steps.map((_, i) => (
            <span key={i} className="flex items-center">
              <span className={cn("grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold", i < at ? INK_PILL : "bg-white text-slate-500 ring-1 ring-slate-300")}
                style={{ boxShadow: i === at ? `0 0 0 3px ${GOLD}55` : undefined }}>{i < at ? <Check size={10} weight="bold" /> : i + 1}</span>
              {i < steps.length - 1 && <span className="mx-0.5 h-px w-3 bg-slate-300" />}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-[hsl(220_10%_95%)] p-2">
          <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", INK_PILL)}><ListChecks size={12} weight="bold" className="text-amber-300" /></span>
          <span className="min-w-0">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">{done ? "Checklist done" : `Next action · step ${at + 1} of ${steps.length}`}</span>
            <span className="block truncate text-[12px] font-semibold text-slate-900">{done ? "Done — the next team is told" : steps[at]}</span>
          </span>
        </div>
      </div>
    </Frame>
  );
}

function PreviewApproval({ j, p }) {
  const r = j.rule || { name: "Spending above your limit" };
  const ok = p > 0.7;
  return (
    <Frame>
      <div className="rounded-xl bg-white p-2.5" style={rise(p, 0.05, 0.2, 8)}>
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700"><ShieldCheck size={11} weight="fill" /> Needs your approval</p>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-slate-900">{short(r.name, 70)}</p>
        <div className="mt-2 flex gap-1.5">
          <span className={cn("flex h-7 flex-1 items-center justify-center gap-1 rounded-full text-[11px] font-semibold", INK_PILL)}>{ok ? <><Check size={11} weight="bold" /> Approved</> : "Approve"}</span>
          <span className={cn("flex h-7 items-center rounded-full px-3 text-[11px] text-slate-700", GLASS_PILL)}>Reject</span>
        </div>
      </div>
    </Frame>
  );
}

function PreviewAsk({ j, p }) {
  const f = j.flowsInOrder?.[0] || j.flow;
  const q = f ? `Who does what in ${f.label}?` : "Who does what when an order comes in?";
  const a = f
    ? f.stages.slice(0, 3).map((x, i) => `${i === 0 ? "First" : "then"} ${x.gate ? "you sign off" : x.team} (${x.label.toLowerCase()})`).join(", ") + "."
    : `${j.memberTeam} picks it up, and anything over your limit comes to you.`;
  return (
    <Frame dark>
      {typed(q, p, 0.04, 0.26) && <div className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-white px-2.5 py-1.5 text-[12px] text-slate-900">{typed(q, p, 0.04, 0.26)}</div>}
      {p > 0.28 && p < 0.38 && <p className="mt-2 animate-pulse text-[12px] text-white/75">Dex is thinking…</p>}
      {p >= 0.38 && <div className="mt-2 max-w-[95%] rounded-xl rounded-bl-sm bg-white/[0.09] px-2.5 py-1.5 text-[12px] leading-relaxed text-white/90">{typed(a, p, 0.38, 0.9)}</div>}
    </Frame>
  );
}

const MODULES = [
  { icon: Wallet, name: "Finance" }, { icon: Kanban, name: "Ops" }, { icon: AddressBook, name: "CRM" },
  { icon: UsersThree, name: "Team" }, { icon: Brain, name: "Company Brain" }, { icon: BookOpenText, name: "Journal" },
  { icon: CalendarBlank, name: "Calendar" }, { icon: Gauge, name: "Operating Score" }, { icon: SunHorizon, name: "Morning brief" },
];
function PreviewModules({ p }) {
  return (
    <Frame>
      <div className="grid grid-cols-3 gap-1.5">
        {MODULES.map((m, i) => {
          const Icon = m.icon;
          return (
            <span key={m.name} className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[11px] font-medium text-slate-800" style={rise(p, 0.04 + i * 0.07, 0.14 + i * 0.07, 6)}>
              <Icon size={12} weight="duotone" className="shrink-0" /><span className="truncate">{m.name}</span>
            </span>
          );
        })}
      </div>
    </Frame>
  );
}

/* ── The script, from the company's draft ─────────────────────────────── */

export function tourSteps(j) {
  const n = (k) => j.counts.find((c) => c.key === k)?.n || 0;
  const f = j.flowsInOrder?.[0] || j.flow;
  return [
    { key: "glance", interlude: "glance", ms: 6000, title: `Welcome to ${j.company}`,
      body: `Dex set up ${n("teams")} teams, ${n("workflows")} workflows and ${n("routines")} routines from your interview. Here is where each one lives in the app — about a minute.`,
      cta: "Show me around" },
    { key: "desk", route: "/inbox", ms: 5000, target: ['[data-testid="desk-board"]'],
      title: "Everything that needs you lands here",
      body: "Decisions to make, work to sign off, and what's due — the board under your Desk. It is empty today; this is how it fills.",
      preview: (p) => <PreviewDecisions j={j} p={p} /> },
    { key: "numbers", route: "/inbox", ms: 3000, target: ['[data-testid="desk-kpi-grid"]'],
      title: "Your company, in numbers",
      body: `What's late, complaints, money to collect, your ${n("workflows")} workflows and this month's spend — the moment anything moves.` },
    { key: "decide", route: "/inbox", ms: 8000, target: ['[data-testid="desk-insight"]'],
      title: "Decide out loud",
      body: "Press the mic and say what you decided, or type it. Dex drafts the tasks for the right teams; you approve them.",
      preview: (p) => <PreviewDraft j={j} p={p} /> },
    f && { key: "flow", route: "/workflows", ms: 8000, target: ['[data-testid^="stage-column-"]', '[data-testid="workflow-board"]'],
      title: `${f.label}, step by step`,
      body: `Each column is a step with its team, and work moves left to right${f.stages.some((s) => s.gate) ? "; the gold one waits for your sign-off" : ""}. Your ${n("workflows")} workflows are the tabs above.`,
      preview: (p) => <PreviewRoute f={f} p={p} /> },
    j.routines.length > 0 && { key: "routines", route: "/my-work", ms: 5000, target: ['[data-testid="routines-nudge"]'],
      title: "Start your routines",
      body: `Dex found ${j.routines.length} routines in your interview. Set them up here and they come back on their own.`,
      preview: (p) => <PreviewRoutines j={j} p={p} /> },
    { key: "work", route: "/my-work", ms: 7000, target: ['[data-testid^="deck-card-"]', '[data-testid="mywork-list"]'],
      title: `${j.memberTeam} sees just their next step`,
      body: "Every task arrives with a checklist Dex wrote; each card shows only what to do now, and finishing tells the next team.",
      preview: (p) => <PreviewTask j={j} p={p} /> },
    j.rules.length > 0 && { key: "signoff", route: "/approvals", ms: 6000, target: ['[data-testid="approvals-tasks-empty"]', '[data-testid="approvals-controls"]'],
      title: "Only what you chose reaches you",
      body: `Your ${j.rules.length} sign-off ${j.rules.length === 1 ? "rule sends" : "rules send"} things here — approve, reject or ask a question.`,
      preview: (p) => <PreviewApproval j={j} p={p} /> },
    // The pill in the header's own nav: the same test id is used elsewhere too.
    { key: "ask", route: "/inbox", ms: 7000, target: ['[data-testid="header-pill-nav"] [data-testid="nav-brain"]'],
      title: "Ask Dex anything",
      body: "Dex knows your workflows, people, tasks and decisions. Ask in plain words.",
      preview: (p) => <PreviewAsk j={j} p={p} /> },
    { key: "more", route: "/inbox", ms: 5000, target: ['[data-testid="header-pill-nav"]'],
      title: "And everything else",
      body: "Finance, Ops, CRM and the team are along the top; the Company Brain, Journal and Settings are in your account menu.",
      preview: (p) => <PreviewModules p={p} /> },
    { key: "cycle", interlude: "cycle", ms: 7500, title: "That's the whole cycle",
      body: "You decide, Dex plans, your teams do it, you sign off, and you hear when it is done. Your company is ready.",
      cta: "Start using DecisionOS" },
  ].filter(Boolean);
}

/* ── The player ───────────────────────────────────────────────────────── */

function useClock(key, ms, on) {
  const [p, setP] = React.useState(0);
  const [round, setRound] = React.useState(0);
  React.useEffect(() => {
    if (!on) return undefined;
    setP(0);
    let raf = 0; const start = performance.now();
    const tick = (now) => {
      const next = Math.min(1, (now - start) / ms);
      setP(next);
      if (next < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, ms, on, round]);
  return [p, () => setRound((r) => r + 1)];
}

function Interlude({ scene, step, p, onNext, onSkip, first, last }) {
  const size = SCREEN.desktop;
  const w = Math.min(window.innerWidth / uiScale() - 64, 960);
  const h = Math.min((window.innerHeight / uiScale()) * 0.58, w * (size.h / size.w));
  const fit = Math.min(w / size.w, h / size.h);
  return (
    <div className="fixed inset-0 z-[10050] grid place-items-center overflow-y-auto bg-slate-900/50 p-6 backdrop-blur-md" data-testid="first-tour-interlude">
      <div className="w-full max-w-[64rem] rounded-[2rem] bg-[linear-gradient(165deg,hsl(0_0%_97%),hsl(0_0%_92%))] p-6 shadow-[0_40px_90px_-30px_hsl(0_0%_0%/.6)]">
        <div className="relative mx-auto overflow-hidden rounded-[1.4rem] bg-[hsl(225_8%_92%)]" style={{ width: size.w * fit, height: size.h * fit }}>
          <Still scene={scene} p={p} device="desktop" fit={fit} />
        </div>
        <div className="mx-auto mt-5 max-w-2xl text-center">
          <h2 className="font-display text-3xl leading-tight text-slate-900" data-testid="first-tour-title">{step.title}</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{step.body}</p>
          <div className="mt-5 flex items-center justify-center gap-2">
            {first && <button type="button" onClick={onSkip} data-testid="first-tour-skip" className="h-12 rounded-pill px-5 text-sm font-medium text-slate-500 hover:text-slate-800">Skip the tour</button>}
            <button type="button" onClick={onNext} data-testid={last ? "first-tour-start" : "first-tour-next"}
              className={cn("inline-flex h-12 items-center gap-2 rounded-pill px-6 text-[15px] font-semibold", INK_PILL)}>
              {step.cta} <ArrowRight size={15} weight="bold" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FirstWeekTour() {
  const { user } = useAuth();
  const phone = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [saved, setSaved] = React.useState(() => readFirstTour());
  const [running, setRunning] = React.useState(false);
  const [i, setI] = React.useState(() => saved?.step || 0);
  const [box, setBox] = React.useState(null);
  const journey = saved?.journey;
  const steps = React.useMemo(() => (journey ? tourSteps(journey) : []), [journey]);
  const scenes = React.useMemo(() => (journey ? buildScenes(journey, "desktop") : []), [journey]);

  // A replay from the account menu, or a tour saved in another tab.
  React.useEffect(() => {
    const on = () => { const s = readFirstTour(); setSaved(s); if (s?.pending) setI(s.step || 0); };
    window.addEventListener("dos:first-tour", on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener("dos:first-tour", on); window.removeEventListener("storage", on); };
  }, []);

  /* Desktop only — a phone keeps its own short walkthrough. Starts when there
     is a script waiting and nothing else wants the screen. */
  React.useEffect(() => {
    if (phone || running || !saved?.pending || !user || !steps.length) return undefined;
    const timer = setInterval(() => {
      if (!clearToStart(user)) return;
      clearInterval(timer);
      setRunning(true);
    }, 600);
    return () => clearInterval(timer);
  }, [phone, running, saved, user, steps.length]);

  const step = running && !phone ? steps[Math.min(i, steps.length - 1)] : null;
  const [p, replay] = useClock(step?.key, step?.ms || 6000, !!step && (!!step.interlude || !!box));

  // Each step on its own page.
  React.useEffect(() => {
    if (!step?.route) return;
    if (location.pathname !== step.route) navigate(step.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.key]);

  // Keep the spotlight on the step's real element. A step whose element never
  // appears is passed over rather than pointing at nothing.
  React.useLayoutEffect(() => {
    setBox(null);
    if (!step || step.interlude) return undefined;
    let first = true;
    const started = performance.now();
    const update = () => {
      const b = find(step.target, first);
      if (b) first = false;
      setBox(b);
      if (!b && performance.now() - started > 6000) setI((n) => Math.min(steps.length - 1, n + 1));
    };
    update();
    const t = setInterval(update, 300);
    window.addEventListener("resize", update);
    return () => { clearInterval(t); window.removeEventListener("resize", update); };
  }, [step?.key, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { if (running) setFirstTourStep(i); }, [i, running]);

  const finish = React.useCallback((to) => {
    finishFirstTour();
    setSaved(readFirstTour());
    setRunning(false);
    setI(0);
    if (to) navigate(to);
  }, [navigate]);

  React.useEffect(() => {
    if (!running) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, finish, steps.length]);

  // The card's real height, so it is placed where it fits.
  const cardRef = React.useRef(null);
  const [cardH, setCardH] = React.useState(300);
  React.useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 1) setCardH(h);
  }, [cardH, i, box, p]);

  if (!step) return null;
  const last = i === steps.length - 1;
  const next = () => (last ? finish("/inbox") : setI(i + 1));

  if (step.interlude) {
    return createPortal(
      <Interlude scene={scenes.find((s) => s.key === step.interlude)} step={step} p={p}
        first={i === 0} last={last} onNext={next} onSkip={() => finish()} />,
      document.body,
    );
  }
  if (!box) return null;

  const PAD = 8; const GAP = 18; const W = 380;
  const hole = { left: box.x - PAD, top: box.y - PAD, width: box.w + PAD * 2, height: box.h + PAD * 2 };
  const { vw, vh } = box;
  const H = cardH;
  const clampY = (y) => Math.min(Math.max(16, y), vh - H - 16);
  const clampX = (x) => Math.min(Math.max(16, x), vw - W - 16);
  const right = vw - (hole.left + hole.width); const below = vh - (hole.top + hole.height);
  /* Beside the spotlight where it fits, else under it, else over it; a
     spotlight that fills the window takes the card in its lower corner. */
  const card = right >= W + GAP * 2 ? { left: hole.left + hole.width + GAP, top: clampY(hole.top + hole.height / 2 - H / 2) }
    : hole.left >= W + GAP * 2 ? { left: hole.left - W - GAP, top: clampY(hole.top + hole.height / 2 - H / 2) }
    : below >= H + GAP * 2 ? { top: hole.top + hole.height + GAP, left: clampX(hole.left + hole.width / 2 - W / 2) }
    : hole.top >= H + GAP * 2 ? { top: hole.top - H - GAP, left: clampX(hole.left + hole.width / 2 - W / 2) }
    : { top: clampY(hole.top + hole.height - H - GAP), left: clampX(hole.left + hole.width - W - GAP) };

  return createPortal(
    <div className="fixed inset-0 z-[10050]" data-testid="first-tour" aria-live="polite">
      {/* Taps stop here: nothing in the app moves while the tour talks. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} aria-hidden="true" />
      <div aria-hidden="true" data-testid="first-tour-spotlight"
        className="pointer-events-none absolute rounded-[22px] transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={{ ...hole, boxShadow: `0 0 0 2px ${GOLD}, 0 0 0 7px hsl(44 88% 60% / .28), 0 0 0 9999px hsl(240 4% 5% / .6)` }} />
      <div role="dialog" aria-modal="true" aria-labelledby="first-tour-title" data-testid="first-tour-card" ref={cardRef}
        className="absolute w-[380px] rounded-[1.6rem] bg-white p-5 shadow-[0_24px_60px_-20px_hsl(240_20%_8%/.6)] ring-1 ring-white/70"
        style={card}>
        <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
          {steps.map((s, n) => (
            <span key={s.key} className={cn("h-1 rounded-full transition-all duration-300", n === i ? "w-6 bg-[hsl(var(--ng-ink))]" : n < i ? "w-2.5 bg-slate-900/40" : "w-2.5 bg-slate-900/15")} />
          ))}
          <span className="ml-auto text-xs font-medium text-slate-500">{i + 1} of {steps.length}</span>
        </div>
        <h2 id="first-tour-title" className="flex items-center gap-2 text-[17px] font-semibold leading-snug text-slate-900" data-testid="first-tour-title">
          {step.key === "ask" && <Sparkle size={15} weight="fill" className="text-amber-500" />}{step.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.body}</p>
        {step.preview && (
          <div data-testid="first-tour-preview">
            {step.preview(p)}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-slate-400">A preview with your company in it</span>
              <button type="button" onClick={replay} aria-label="Play the preview again" data-testid="first-tour-replay"
                className="ml-auto grid h-7 w-7 place-items-center rounded-full text-slate-500 hover:bg-slate-900/[0.05] hover:text-slate-800">
                <ArrowCounterClockwise size={13} weight="bold" />
              </button>
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => finish()} data-testid="first-tour-skip"
            className="h-11 rounded-pill px-3 text-sm font-medium text-slate-500 hover:text-slate-800">Skip</button>
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} aria-label="Back" data-testid="first-tour-back"
              className={cn("ml-auto grid h-11 w-11 place-items-center rounded-full text-slate-700", GLASS_PILL)}><ArrowLeft size={15} weight="bold" /></button>
          )}
          <button type="button" onClick={next} data-testid="first-tour-next"
            className={cn("inline-flex h-11 items-center gap-1.5 rounded-pill px-5 text-sm font-semibold", INK_PILL, i === 0 && "ml-auto")}>
            Next <ArrowRight size={14} weight="bold" />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* THE FIRST-WEEK TOUR — inside the real app (2026-10-30, founder): "show the
 * walkthrough in the actual DecisionOS application, blended with the
 * illustrative elements… templatised… populate mock data and mock replies so
 * it is quick in all the chapters, with the motion graphics — not just
 * highlights and descriptions — the complete cycle; and the last call to
 * action enters the actual app."
 *
 * It plays once, the first time a founder opens the workspace they just
 * built (signup keeps the script: lib/firstTour), over the REAL pages: it
 * walks Desk → Decide → Ops → My Work → routines → Approvals → Ask Dex → the
 * rest, and on each one a lens sits on the real control and plays that
 * moment as a short motion piece in the app's own material — their sign-off
 * rule arriving as a decision, their words typing into Decide and Dex
 * drafting the tasks, an order walking their workflow, a task ticking its
 * checklist, the approval tick, Dex answering from their setup, the rest of
 * the app. The data in the lenses is a mock filled from their draft (nothing
 * is asked of the server and nothing is written), so every beat is instant.
 * Their company "at a glance" opens it and the cycle closes it, full screen;
 * "Start using DecisionOS" takes the mocks away and leaves the live app.
 *
 * It waits its turn (Walkthrough's clearToStart: the welcome, Terms and any
 * dialog first), counts as the app's walkthrough once done, and can be played
 * again from the account menu. Rects are divided by --ui-scale like
 * Walkthrough, since the app is CSS-zoomed.
 */
import * as React from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, ArrowCounterClockwise, Check, ShieldCheck, Sparkle, Microphone, Kanban, ChatCircleDots,
  PaperPlaneRight, Wallet, AddressBook, UsersThree, Brain, BookOpenText, Gauge, SunHorizon, CalendarBlank, ArrowsClockwise, Clock,
} from "@phosphor-icons/react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useIsMobile } from "@/hooks/useIsMobile";
import { clearToStart, TOUR_VERSION } from "@/components/mobile/Walkthrough";
import { INK_PILL, GLASS_PILL, DRAWER_CARD, DRAWER_LABEL, GLASS_SHEET } from "@/components/neuglass/glass";
import { readFirstTour, setFirstTourStep, finishFirstTour } from "@/lib/firstTour";
import { buildScenes, typed, rise, short, TaskDeckCard } from "@/pages/onboarding/walkthrough/scenes";
import { span, SCREEN, Still } from "@/pages/onboarding/walkthrough/Player";
import { cn } from "@/lib/utils";

const GOLD = "hsl(44 88% 60%)";
const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;

/* The first of the selectors that is on screen, in CSS px of the zoomed body. */
function find(selectors, scroll) {
  const s = uiScale();
  for (const sel of selectors || []) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (scroll) el.scrollIntoView({ block: "center", inline: "nearest" });
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const vw = window.innerWidth / s; const vh = window.innerHeight / s;
    // Held inside the window: a long board is lensed where it is visible.
    const x = Math.max(8, r.left / s); const y = Math.max(8, r.top / s);
    const w = Math.min(r.right / s, vw - 8) - x; const h = Math.min(r.bottom / s, vh - 8) - y;
    return { x, y, w, h, vw, vh };
  }
  return null;
}

/* ── The lenses: each moment as a motion piece in the app's own material ─ */

function DecisionRows({ j, p, phone }) {
  const rows = [
    { t: j.rule?.name || "A purchase above your limit", m: "Needs you · from your rules", hue: "hsl(33 92% 56%)" },
    { t: `${j.flow?.label || "Orders"}: this week`, m: "Draft · Dex", hue: "hsl(210 55% 50%)" },
    { t: short(j.routines[0] || "Weekly review", 46), m: "Due today", hue: "hsl(92 34% 42%)" },
  ];
  return (
    <div className="flex h-full w-full flex-col rounded-[inherit] bg-[hsl(240_4%_9%)] p-5 text-white">
      <p className="flex items-center gap-2.5 text-base font-medium text-white/85">
        <span className="h-3 w-3 rounded-full bg-[hsl(33_92%_56%)]" />Decisions
        <span className="rounded-full bg-white/[.10] px-2 py-0.5 text-xs tabular-nums text-white/70">{Math.round(3 * span(p, 0.1, 0.5))}</span>
      </p>
      <div className={cn("mt-3", phone && "space-y-2")}>
        {rows.map((r, i) => (
          <div key={i} className={cn("flex items-center gap-3", phone ? "rounded-[1.15rem] border border-white/10 bg-white/[0.06] px-3.5 py-3" : "border-t border-white/[.14] py-3.5")}
            style={rise(p, 0.12 + i * 0.12, 0.3 + i * 0.12, 18)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.hue, boxShadow: i === 0 && p > 0.6 ? `0 0 0 5px ${GOLD}44` : undefined }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-neutral-200">{r.t}</p>
              <p className="truncate text-sm text-neutral-400">{r.m}</p>
            </div>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.10] text-white/80"><ArrowRight size={13} weight="bold" /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SaidBar({ j, p }) {
  const words = typed(j.said, p, 0.06, 0.4);
  return (
    <div className="flex h-full w-full items-center gap-3 rounded-[inherit] bg-white px-5 text-[15px] text-slate-900 ring-2 ring-[hsl(44_88%_60%/.7)]">
      <Microphone size={18} weight="fill" className="shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1 truncate">{words}{p < 0.4 && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-slate-500 align-middle" />}</span>
      {p > 0.42 && p < 0.52 && <span className="ng-glow-text shrink-0 text-[14px] font-medium">Dex is reading…</span>}
    </div>
  );
}

function DexDraft({ j, p, phone }) {
  const f = j.flow;
  const plan = (f?.stages || []).slice(0, 3).map((s) => ({ task: s.tasks?.[0] || s.label, team: s.gate ? "You" : s.team }));
  const k = span(p, 0.48, 0.58);
  const done = p > 0.9;
  return (
    <div className={cn(GLASS_SHEET, "relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-[1.75rem] p-5")} style={{ opacity: k, transform: `translateY(${(1 - k) * 18}px)` }}>
      {phone && (
        <div className="rounded-[1.2rem] bg-white/90 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">What you said</p>
          <p className="mt-1 text-[14px] leading-snug text-slate-900">{typed(j.said, p, 0.06, 0.4)}</p>
        </div>
      )}
      <div className="rounded-[1.2rem] bg-white/85 p-4 ring-1 ring-inset ring-white">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">The decision</p>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600">High</span>
        </div>
        <p className="mt-1.5 line-clamp-2 text-[16px] font-semibold leading-snug text-slate-900">{j.said}</p>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tasks created by Dex</p>
      <div className="space-y-2">
        {plan.map((x, i) => (
          <div key={i} className="flex items-center gap-3 rounded-[1.1rem] bg-white/85 px-3.5 py-2.5 ring-1 ring-inset ring-white" style={rise(p, 0.6 + i * 0.07, 0.7 + i * 0.07)}>
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold", INK_PILL)}>{i + 1}</span>
            <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-800">{x.task}</p>
            <span className="shrink-0 rounded-full bg-slate-900/[0.05] px-2.5 py-1 text-[11px] text-slate-600">{short(x.team, 20)}</span>
          </div>
        ))}
      </div>
      <span className={cn("mt-auto flex h-12 items-center justify-center rounded-pill text-[15px] font-semibold", INK_PILL, p > 0.84 && "scale-[0.98]")}>Approve</span>
      <MiniTick k={done ? span(p, 0.9, 1) : 0} text="Approved — tasks sent to your teams" />
    </div>
  );
}

function MiniTick({ k, text }) {
  if (k <= 0) return null;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-[inherit] bg-white/85 backdrop-blur-md" style={{ opacity: Math.min(1, k * 2) }}>
      <div className="text-center" style={{ transform: `scale(${0.7 + 0.3 * span(k, 0, 0.6)})` }}>
        <span className={cn("mx-auto grid h-16 w-16 place-items-center rounded-full", INK_PILL)}><Check size={30} weight="bold" /></span>
        <p className="mt-3 text-[15px] font-semibold text-slate-900">{text}</p>
      </div>
    </div>
  );
}

function FlowLanes({ j, p, phone }) {
  const f = j.flow;
  const st = (f?.stages || []).slice(0, phone ? 5 : 6);
  const n = Math.max(1, st.length);
  const k = Math.min(n - 1, Math.floor(span(p, 0.08, 0.92, (x) => x) * n));
  const local = span(p, 0.08 + (k / n) * 0.84, 0.14 + (k / n) * 0.84);
  const card = (s, i) => (
    <div className="ng-bento p-3" style={{ opacity: local, transform: `translateY(${(1 - local) * 10}px)` }}>
      <p className="text-sm font-semibold text-slate-900">Order #1042</p>
      <span className="mt-1 inline-block rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-[10.5px] font-medium text-slate-600">{s.gate ? "Waiting for you" : short(s.team, 22)}</span>
      <p className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-slate-500"><Clock size={11} /> due in 2 days</p>
      {!phone && (s.tasks.length ? s.tasks : ["Work in this step"]).slice(0, 2).map((x, ti) => (
        <p key={ti} className="mt-1.5 rounded-lg bg-nm-sunken px-2.5 py-1.5 text-[11.5px] leading-snug text-slate-700">{short(x, 60)}</p>
      ))}
      {i < n - 1 && <span className="ng-pop mt-2.5 flex h-9 items-center justify-center rounded-pill text-xs font-medium">Advance to {short(st[i + 1].label, 16)}</span>}
    </div>
  );
  if (phone) {
    return (
      <div className="h-full w-full overflow-hidden rounded-[inherit] bg-[hsl(225_10%_93%)] p-4">
        <p className="font-display text-lg text-slate-900">{f?.label}</p>
        <div className="mt-3 space-y-2">
          {st.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[12px] font-semibold",
                i < k ? INK_PILL : i === k ? (s.gate ? "bg-[hsl(44_88%_60%)] text-slate-900" : INK_PILL) : "bg-white text-slate-500 ring-1 ring-slate-300")}>
                {s.gate ? <ShieldCheck size={14} weight="fill" /> : i < k ? <Check size={13} weight="bold" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <p className="text-[14px] font-semibold text-slate-900">{s.label}</p>
                {i === k && <div className="mt-1.5">{card(s, i)}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="ng-glass-well flex h-full w-full gap-3 overflow-hidden rounded-[inherit] bg-white/40 p-3">
      {st.map((s, i) => (
        <div key={i} className="ng-frost ng-lane flex min-w-0 flex-1 flex-col rounded-[1.4rem] p-3">
          <div className="flex items-center justify-between gap-2 pb-2">
            <p className="truncate text-[13px] font-semibold text-slate-900">{s.label}</p>
            {s.gate && <ShieldCheck size={15} weight="fill" className="shrink-0 text-amber-500" />}
          </div>
          <span className="mb-2 w-fit max-w-full truncate rounded-full bg-white/70 px-2.5 py-1 text-[11px] text-slate-600">{s.gate ? "You" : s.team}</span>
          {i === k && card(s, i)}
        </div>
      ))}
    </div>
  );
}

function WorkCard({ j, p }) {
  return (
    <div className="flex h-full w-full items-start justify-center overflow-hidden rounded-[inherit] bg-[hsl(225_10%_93%/.96)] p-4">
      <div className="w-full max-w-[30rem]"><TaskDeckCard j={j} p={p} w="100%" done={p > 0.86} /></div>
    </div>
  );
}

function RoutineList({ j, p }) {
  return (
    <div className="h-full w-full overflow-hidden rounded-[1.5rem] bg-white shadow-[0_18px_40px_-24px_hsl(230_30%_18%/.55)]">
      <div className="flex items-center justify-between border-b border-slate-900/[0.06] px-4 py-3">
        <p className="text-[15px] font-semibold text-slate-900">My Work</p>
        <span className="flex items-center gap-1 rounded-full bg-slate-900/[0.05] px-2.5 py-1 text-[12px] text-slate-600"><ArrowsClockwise size={12} weight="bold" /> Recurring</span>
      </div>
      {j.routines.slice(0, 5).map((r, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-slate-900/[0.05] px-4 py-3 last:border-b-0" style={rise(p, 0.1 + i * 0.12, 0.22 + i * 0.12)}>
          <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-slate-300" />
          <span className="min-w-0 flex-1 truncate text-[14px] text-slate-800">{r}</span>
          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">Repeats</span>
        </div>
      ))}
    </div>
  );
}

function ApprovalCard({ j, p }) {
  const r = j.rule || { name: "Spending above your limit", description: "Comes to you before it happens." };
  return (
    <div className={cn(DRAWER_CARD, "relative h-full w-full overflow-hidden bg-white/90 p-5")} style={rise(p, 0.05, 0.2, 16)}>
      <p className={DRAWER_LABEL}><ShieldCheck size={13} weight="fill" className="-mt-0.5 mr-1 inline text-amber-600" /> Needs your approval</p>
      <p className="text-[18px] font-semibold leading-snug text-slate-900">{r.name}</p>
      {r.description && <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-slate-600">{r.description}</p>}
      <div className="mt-4 flex gap-2">
        <span className={cn("flex h-11 flex-1 items-center justify-center rounded-pill text-[15px] font-medium", INK_PILL, p > 0.62 && "scale-[0.97]")}>Approve</span>
        <span className={cn("flex h-11 items-center rounded-pill px-5 text-[15px] font-medium text-slate-700", GLASS_PILL)}>Reject</span>
      </div>
      <MiniTick k={span(p, 0.66, 0.82)} text="Approved — work moves on" />
    </div>
  );
}

function AskChat({ j, p }) {
  const f = j.flows[0];
  const q = f ? `Who does what in ${f.label}?` : "Who does what when an order comes in?";
  const a = f
    ? f.stages.slice(0, 4).map((x, i) => `${i === 0 ? "First" : "Then"} ${x.gate ? "you sign off" : x.team} — ${x.label.toLowerCase()}`).join(". ") + "."
    : `${j.memberTeam} picks it up, and anything over your limit comes to you.`;
  const qq = typed(q, p, 0.06, 0.28);
  const aa = typed(a, p, 0.42, 0.88);
  return (
    <div className="ng-dock-chat flex h-full w-full flex-col rounded-[1.75rem] p-4 text-white">
      <div className="flex items-center gap-2.5 border-b border-white/10 pb-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10"><Sparkle size={15} weight="fill" className="text-amber-300" /></span>
        <div><p className="text-[14px] font-semibold">Ask Dex</p><p className="text-[11px] text-white/55">Knows {j.company}</p></div>
      </div>
      <div className="mt-3 flex-1 space-y-3 overflow-hidden">
        {qq && <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-[14px] text-slate-900">{qq}</div>}
        {p > 0.3 && p < 0.42 && <p className="animate-pulse text-[14px] font-medium text-white/80">Dex is thinking…</p>}
        {aa && (
          <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-white/[0.08] px-3.5 py-3 text-[14px] leading-relaxed text-white/90">
            {aa}
            {p > 0.9 && f && <span className="mt-2 flex w-fit items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70"><Kanban size={11} weight="bold" /> From: {f.label}</span>}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2.5 text-[13px] text-white/45">
        <ChatCircleDots size={15} weight="bold" /> Ask about orders, people, money… <PaperPlaneRight size={14} weight="bold" className="ml-auto" />
      </div>
    </div>
  );
}

const MODULES = [
  { icon: Wallet, name: "Finance", line: "What's owed, paid and due" },
  { icon: Kanban, name: "Ops", line: "Every workflow on one board" },
  { icon: AddressBook, name: "CRM", line: "Buyers and suppliers" },
  { icon: UsersThree, name: "Team", line: "People, roles, leave" },
  { icon: Brain, name: "Company Brain", line: "Everything Dex knows" },
  { icon: BookOpenText, name: "Journal", line: "Every decision, and why" },
  { icon: CalendarBlank, name: "Calendar", line: "Dates and routines" },
  { icon: Gauge, name: "Operating Score", line: "How the company runs" },
  { icon: SunHorizon, name: "Morning brief", line: "What needs you today" },
];
function Modules({ p, phone }) {
  return (
    <div className={cn("grid h-full w-full content-start gap-2.5 overflow-hidden rounded-[1.75rem] bg-[hsl(225_10%_94%/.97)] p-4", phone ? "grid-cols-2" : "grid-cols-3")}>
      {MODULES.map((m, i) => {
        const Icon = m.icon;
        return (
          <div key={m.name} className="flex items-center gap-3 rounded-[1.1rem] bg-white p-3 shadow-[0_10px_24px_-18px_hsl(230_30%_18%/.5)]" style={rise(p, 0.04 + i * 0.07, 0.16 + i * 0.07, 12)}>
            <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", INK_PILL)}><Icon size={17} weight="duotone" /></span>
            <span className="min-w-0"><span className="block truncate text-[14px] font-semibold text-slate-900">{m.name}</span><span className="block truncate text-[12px] text-slate-500">{m.line}</span></span>
          </div>
        );
      })}
    </div>
  );
}

/* ── The script, from the company's draft ─────────────────────────────── */

export function tourSteps(j, phone) {
  const f = j.flow;
  const n = (k) => j.counts.find((c) => c.key === k)?.n || 0;
  return [
    { key: "glance", interlude: "glance", title: `Welcome to ${j.company}`,
      body: `Dex set up ${n("teams")} teams, ${n("workflows")} workflows and ${n("routines")} routines from your interview. Here is where each one lives — about a minute.`,
      cta: "Show me around", ms: 6000 },
    { key: "desk", route: "/inbox", ms: 6000,
      target: phone ? ['[data-testid="desk-phone-card"]', '[data-testid="desk-phone-card-card"]', '[data-testid="desk-page"]'] : ['[data-testid="desk-board"]', '[data-testid="desk-page"]'],
      lens: { fill: true, render: (p) => <DecisionRows j={j} p={p} phone={phone} /> },
      title: "Your Desk", body: j.rule ? `Everything that needs you lands here — like “${short(j.rule.name, 48)}”, from your own rules.` : "Everything that needs you lands here first." },
    { key: "decide", route: "/inbox", ms: 9000,
      target: phone ? ['[data-testid="dex-slider-handle"]', '[data-testid="dock-slider"]'] : ['[data-testid="desk-dex-composer"]', '[data-testid="desk-page"]'],
      lens: phone
        ? { popup: { side: "above", w: 360, h: 560 }, render: (p) => <DexDraft j={j} p={p} phone /> }
        : { fill: true, render: (p) => <SaidBar j={j} p={p} />, popup: { side: "below", w: 680, h: 470 }, renderPopup: (p) => <DexDraft j={j} p={p} /> },
      title: "Decide out loud", body: phone ? "Swipe the knob right and say what you decided. Dex drafts the tasks for the right teams; you approve." : "Say or type what you decided. Dex drafts the tasks for the right teams; you approve." },
    f && { key: "flow", route: "/workflows", ms: 9000,
      target: ['[data-testid="workflow-board"]', '[data-testid="workflow-pipelines"]'],
      lens: phone ? { popup: { side: "below", w: 360, h: 520 }, render: (p) => <FlowLanes j={j} p={p} phone /> } : { fill: true, minH: 360, render: (p) => <FlowLanes j={j} p={p} /> },
      title: `${f.label}, step by step`, body: `Each step has its team${f.stages.some((s) => s.gate) ? ", and the gold one waits for your sign-off" : ""}. ${j.flows.length > 1 ? `Your other ${j.flows.length - 1} ${j.flows.length === 2 ? "workflow lives" : "workflows live"} here too.` : ""}` },
    { key: "work", route: "/my-work", ms: 8000,
      target: phone ? ['[data-testid="mywork-mobile-header"]'] : ['[data-testid="mywork-priority-columns"]', '[data-testid="mywork-grid"]'],
      lens: phone ? { popup: { side: "below", w: 360, h: 540 }, render: (p) => <WorkCard j={j} p={p} /> } : { fill: true, minH: 520, render: (p) => <WorkCard j={j} p={p} /> },
      title: `${j.memberTeam} sees just their next step`, body: "Dex writes the checklist; each task shows only what to do now, and completing it tells the next team." },
    j.routines.length > 0 && { key: "routines", route: "/my-work", ms: 6000,
      target: ['[data-testid="routines-nudge"]', phone ? '[data-testid="mywork-mobile-header"]' : '[data-testid="mywork-priority-columns"]'],
      lens: { popup: { side: "below", w: phone ? 360 : 560, h: 300 }, render: (p) => <RoutineList j={j} p={p} /> },
      title: "Your routines", body: `Dex found ${j.routines.length} routines in your interview. Start them here and they come back on their own.` },
    j.rules.length > 0 && { key: "signoff", route: "/approvals", ms: 7000,
      target: ['[data-testid="approvals-header"]', '[data-testid="approvals-hub"]'],
      lens: { popup: { side: "below", w: phone ? 360 : 520, h: 250 }, render: (p) => <ApprovalCard j={j} p={p} /> },
      title: "Only what you chose reaches you", body: `Your ${j.rules.length} sign-off ${j.rules.length === 1 ? "rule sends" : "rules send"} things here — approve, reject or ask.` },
    { key: "ask", route: "/inbox", ms: 8000,
      target: phone ? ['[data-testid="dex-slider-handle"]', '[data-testid="dock-slider"]'] : ['[data-testid="nav-brain"]', '[data-testid="header-pill-nav"]'],
      lens: { popup: { side: phone ? "above" : "below", w: phone ? 360 : 460, h: 460 }, render: (p) => <AskChat j={j} p={p} /> },
      title: "Ask Dex anything", body: phone ? "Swipe the knob left and ask — Dex answers from your company." : "Ask in words — Dex answers from your company's own setup." },
    { key: "more", route: "/inbox", ms: 6000,
      target: phone ? ['[data-testid="dock-more"]'] : ['[data-testid="header-pill-nav"]'],
      lens: { popup: { side: phone ? "above" : "below", w: phone ? 360 : 820, h: phone ? 470 : 270 }, render: (p) => <Modules p={p} phone={phone} /> },
      title: "And everything else", body: phone ? "Money, the team, CRM, your journal and more — all under More." : "Finance, CRM, the team, your journal and more — all a tap away." },
    { key: "cycle", interlude: "cycle", title: "That's the whole cycle",
      body: "You decide, Dex plans, your teams do it, you sign off, and you hear when it is done. Your company is ready.",
      cta: "Start using DecisionOS", ms: 7500 },
  ].filter(Boolean);
}

/* ── The player ───────────────────────────────────────────────────────── */

function useClock(key, ms, playing) {
  const [p, setP] = React.useState(0);
  React.useEffect(() => { setP(0); }, [key]);
  React.useEffect(() => {
    if (!playing) return undefined;
    let raf = 0; const start = performance.now() - p * ms;
    const tick = (now) => {
      const next = Math.min(1, (now - start) / ms);
      setP(next);
      if (next < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Restart only when the step or the play state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms, playing]);
  return [p, setP];
}

function Interlude({ scene, device, step, p, onNext, onSkip, first, last }) {
  const size = SCREEN[device];
  const w = Math.min(window.innerWidth / uiScale() - 32, device === "phone" ? 360 : 980);
  const h = Math.min((window.innerHeight / uiScale()) * 0.56, w * (size.h / size.w));
  const fit = Math.min(w / size.w, h / size.h);
  return (
    <div className="fixed inset-0 z-[10050] grid place-items-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-md" data-testid="first-tour-interlude">
      <div className="w-full max-w-[64rem] rounded-[2rem] bg-[linear-gradient(165deg,hsl(0_0%_97%),hsl(0_0%_92%))] p-4 shadow-[0_40px_90px_-30px_hsl(0_0%_0%/.6)] sm:p-6">
        <div className="relative mx-auto overflow-hidden rounded-[1.4rem] bg-[hsl(225_8%_92%)]" style={{ width: size.w * fit, height: size.h * fit }}>
          <Still scene={scene} p={p} device={device} fit={fit} />
        </div>
        <div className="mx-auto mt-5 max-w-2xl text-center">
          <h2 className="font-display text-2xl leading-tight text-slate-900 sm:text-3xl" data-testid="first-tour-title">{step.title}</h2>
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
  const { user, refreshMe } = useAuth();
  const phone = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [saved, setSaved] = React.useState(() => readFirstTour());
  const [running, setRunning] = React.useState(false);
  const [i, setI] = React.useState(() => saved?.step || 0);
  const [box, setBox] = React.useState(null);
  const [lost, setLost] = React.useState(false);
  const journey = saved?.journey;
  const steps = React.useMemo(() => (journey ? tourSteps(journey, phone) : []), [journey, phone]);
  const scenes = React.useMemo(() => (journey ? buildScenes(journey, phone ? "phone" : "desktop") : []), [journey, phone]);

  // A replay from the account menu, or a tour saved in another tab.
  React.useEffect(() => {
    const on = () => { const s = readFirstTour(); setSaved(s); if (s?.pending) setI(s.step || 0); };
    window.addEventListener("dos:first-tour", on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener("dos:first-tour", on); window.removeEventListener("storage", on); };
  }, []);

  /* Start when there is a script waiting and nothing else wants the screen. */
  React.useEffect(() => {
    if (running || !saved?.pending || !user || !steps.length) return undefined;
    const timer = setInterval(() => {
      if (!clearToStart(user)) return;
      clearInterval(timer);
      setRunning(true);
    }, 600);
    return () => clearInterval(timer);
  }, [running, saved, user, steps.length]);

  const step = running ? steps[Math.min(i, steps.length - 1)] : null;
  const [p, setP] = useClock(step?.key, step?.ms || 6000, !!step);

  // Each step on its own page.
  React.useEffect(() => {
    if (!step?.route) return;
    if (location.pathname !== step.route) navigate(step.route);
    // Navigate once per step, not on every location change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.key]);

  // Find the step's control, keep the lens on it; after a few seconds
  // without it, the moment plays in the middle of the screen instead.
  React.useLayoutEffect(() => {
    setBox(null); setLost(false);
    if (!step || step.interlude) return undefined;
    let first = true;
    const started = performance.now();
    const update = () => {
      const b = find(step.target, first);
      first = false;
      setBox(b);
      if (!b && performance.now() - started > 3500) setLost(true);
    };
    update();
    const t = setInterval(update, 350);
    window.addEventListener("resize", update);
    return () => { clearInterval(t); window.removeEventListener("resize", update); };
  }, [step?.key, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { if (running) setFirstTourStep(i); }, [i, running]);

  const finish = React.useCallback((to) => {
    finishFirstTour();
    setSaved(readFirstTour());
    setRunning(false);
    setI(0);
    // It is the app's walkthrough too, so the phone's short one does not follow it.
    api.post("/auth/tour/done", { version: TOUR_VERSION }).then(() => refreshMe?.()).catch(() => {});
    if (to) navigate(to);
  }, [navigate, refreshMe]);

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

  if (!step) return null;
  const last = i === steps.length - 1;
  const next = () => (last ? finish("/inbox") : setI(i + 1));

  if (step.interlude) {
    return createPortal(
      <Interlude scene={scenes.find((s) => s.key === step.interlude)} device={phone ? "phone" : "desktop"} step={step} p={p}
        first={i === 0} last={last} onNext={next} onSkip={() => finish()} />,
      document.body,
    );
  }

  const vw = window.innerWidth / uiScale(); const vh = window.innerHeight / uiScale();
  // Where the lens sits: on the control, or centred when it is not on screen.
  const anchor = box || (lost ? { x: vw / 2 - 160, y: vh / 2 - 160, w: 320, h: 64 } : null);
  if (!anchor) return null;
  const PAD = 8;
  const fillH = Math.max(anchor.h, step.lens.minH || 0);
  const hole = { left: anchor.x - PAD, top: anchor.y - PAD, width: anchor.w + PAD * 2, height: (step.lens.fill ? Math.min(fillH, vh - anchor.y - 16) : anchor.h) + PAD * 2 };
  const pop = step.lens.popup && (() => {
    const w = Math.min(step.lens.popup.w, vw - 24);
    const h = Math.min(step.lens.popup.h, vh - 32);
    const left = Math.min(Math.max(12, hole.left + hole.width / 2 - w / 2), vw - w - 12);
    let top = step.lens.popup.side === "above" ? hole.top - h - 14 : hole.top + hole.height + 14;
    if (top + h > vh - 12) top = Math.max(12, vh - h - 12);
    if (top < 12) top = 12;
    return { left, top, width: w, height: h };
  })();
  const fillNode = step.lens.fill ? step.lens.render(p) : null;
  const popNode = pop ? (step.lens.renderPopup ? step.lens.renderPopup(p) : !step.lens.fill ? step.lens.render(p) : null) : null;

  /* The note card: beside the lens where there is room, else under or over
     it; on a phone it spans the width at the free edge. */
  const lensBox = pop
    ? { l: Math.min(hole.left, pop.left), t: Math.min(hole.top, pop.top), r: Math.max(hole.left + hole.width, pop.left + pop.width), b: Math.max(hole.top + hole.height, pop.top + pop.height) }
    : { l: hole.left, t: hole.top, r: hole.left + hole.width, b: hole.top + hole.height };
  const CARD_W = 360;
  const card = phone
    ? (lensBox.t > vh - lensBox.b ? { left: 12, right: 12, top: Math.max(12, lensBox.t - 200) } : { left: 12, right: 12, top: Math.min(vh - 210, lensBox.b + 12) })
    : vw - lensBox.r >= CARD_W + 28 ? { left: lensBox.r + 16, top: Math.min(Math.max(16, (lensBox.t + lensBox.b) / 2 - 110), vh - 260) }
    : lensBox.l >= CARD_W + 28 ? { left: lensBox.l - CARD_W - 16, top: Math.min(Math.max(16, (lensBox.t + lensBox.b) / 2 - 110), vh - 260) }
    : { left: Math.min(Math.max(16, (lensBox.l + lensBox.r) / 2 - CARD_W / 2), vw - CARD_W - 16), top: lensBox.b + 260 < vh ? lensBox.b + 14 : Math.max(16, lensBox.t - 250) };

  return createPortal(
    <div className="fixed inset-0 z-[10050]" data-testid="first-tour" aria-live="polite">
      {/* Taps stop here: nothing in the app moves while the tour plays. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} aria-hidden="true" />
      <div aria-hidden="true" className="pointer-events-none absolute rounded-[22px] transition-[left,top,width,height] duration-300 ease-out motion-reduce:transition-none"
        style={{ ...hole, boxShadow: `0 0 0 2px ${GOLD}, 0 0 0 7px hsl(44 88% 60% / .28), 0 0 0 9999px hsl(240 4% 5% / .62)` }} />
      {fillNode && (
        <div className="pointer-events-none absolute overflow-hidden rounded-[20px]" data-testid="first-tour-lens"
          style={{ left: hole.left + 2, top: hole.top + 2, width: hole.width - 4, height: hole.height - 4 }}>{fillNode}</div>
      )}
      {popNode && (
        <div className="pointer-events-none absolute" data-testid="first-tour-popup" style={pop}>{popNode}</div>
      )}
      <div role="dialog" aria-modal="true" aria-labelledby="first-tour-title" data-testid="first-tour-card"
        className={cn("absolute rounded-[1.6rem] bg-white/95 p-5 shadow-[0_24px_60px_-20px_hsl(240_20%_8%/.6)] ring-1 ring-white/70 backdrop-blur-xl", !phone && "w-[360px]")}
        style={card}>
        <div className="mb-3 flex items-center gap-1.5" aria-hidden="true">
          {steps.map((s, n) => (
            <span key={s.key} className={cn("h-1 rounded-full transition-all duration-300", n === i ? "w-6 bg-[hsl(var(--ng-ink))]" : n < i ? "w-2.5 bg-slate-900/40" : "w-2.5 bg-slate-900/15")} />
          ))}
          <span className="ml-auto text-xs font-medium text-slate-500">{i + 1} of {steps.length}</span>
        </div>
        <h2 id="first-tour-title" className="text-[17px] font-semibold leading-snug text-slate-900" data-testid="first-tour-title">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{step.body}</p>
        {/* The moment's own clock, and a way to see it again. */}
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-900/10" aria-hidden="true">
            <div className="h-full rounded-full bg-[hsl(var(--ng-gold))]" style={{ width: `${p * 100}%` }} />
          </div>
          <button type="button" onClick={() => setP(0)} aria-label="Play this again" data-testid="first-tour-replay"
            className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-900/[0.05] hover:text-slate-800">
            <ArrowCounterClockwise size={14} weight="bold" />
          </button>
        </div>
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

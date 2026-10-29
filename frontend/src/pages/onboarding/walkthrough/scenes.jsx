/* THE TOUR'S SCENES — the real app, simplified, playing the new company's
 * first week (see Player.jsx for the why). Each mock wears the app's own
 * material — the ink pills, the white glass, the Desk's black board, the
 * phone's dock, the task card's numbered steps — so what the founder learns
 * here is what they open on day one, and every name in it is theirs.
 *
 * Screens are laid out absolutely, in screen px, so the camera can be told
 * exactly where to look. A scene draws itself from p alone: span(p, a, b)
 * is "how far through the beat from a to b", nothing keeps its own clock.
 */
import {
  Bell, Microphone, CheckCircle, Check, ShieldCheck, Sparkle, ListChecks, ArrowRight,
  Tray, Briefcase, Wallet, DotsThree, CalendarBlank, Play, ArrowsClockwise,
  Kanban, AddressBook, UsersThree, Brain, BookOpenText, Gauge, SunHorizon, ChatCircleDots, PaperPlaneRight,
} from "@phosphor-icons/react";
import { span, lerp, SCREEN } from "./Player";

export const INK = "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white";
export const GLASS = "bg-white/80 ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_6px_16px_-8px_hsl(216_30%_25%/0.35)]";
export const CARD = "rounded-[1.4rem] bg-white/85 ring-1 ring-inset ring-white shadow-[0_12px_30px_-18px_hsl(0_0%_10%/0.32)]";
export const GOLD = "hsl(44 88% 60%)";

export const typed = (text, p, a, b) => text.slice(0, Math.round(text.length * span(p, a, b, (x) => x)));
export const rise = (p, a, b, d = 14) => {
  const k = span(p, a, b);
  return { opacity: k, transform: `translateY(${(1 - k) * d}px)` };
};
export const initials = (s) => String(s || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "OS";
export const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));

/* ── The shells ─────────────────────────────────────────────────────────── */

export function Sky({ children }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[hsl(225_8%_92%)]">
      <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-[hsl(40_60%_85%/.6)] blur-3xl" />
      <div className="absolute -bottom-48 -right-24 h-[520px] w-[520px] rounded-full bg-[hsl(225_40%_85%/.7)] blur-3xl" />
      {children}
    </div>
  );
}

function DShell({ j, active = "Decision Desk", children, dim = 0 }) {
  const nav = ["Decision Desk", "My Work", "Ops", "Team", "Finance"];
  return (
    <Sky>
      <header className="absolute inset-x-0 top-0 flex h-[76px] items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <span className="text-[19px] font-semibold tracking-tight text-slate-900">Decision<span className="opacity-55">OS</span></span>
          <span className="text-[17px] font-light text-slate-900/25">|</span>
          <span className="text-[15px] font-medium text-slate-900/70">{j.company}</span>
        </div>
        <nav className="absolute left-1/2 top-0 flex h-[64px] -translate-x-1/2 items-center gap-1 rounded-b-[2rem] bg-[linear-gradient(180deg,hsl(0_0%_16%),hsl(0_0%_6%))] px-5">
          {nav.map((n) => (
            <span key={n} className={n === active
              ? "rounded-full bg-[#fbfaf6] px-4 py-2 text-[13px] font-semibold text-[#0c0c0d] shadow-[0_2px_12px_-4px_hsl(0_0%_0%/.7)]"
              : "px-3.5 py-2 text-[13px] text-white/75"}>{n}</span>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-900/40 text-slate-800"><Bell size={17} weight="bold" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white text-[13px] font-semibold text-slate-800 shadow-sm">{initials(j.founder)}</span>
        </div>
      </header>
      {children}
      {dim > 0 && <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" style={{ opacity: dim }} />}
    </Sky>
  );
}

function PShell({ title, active = "Desk", children, dock = true, dim = 0, knob = 0 }) {
  return (
    <Sky>
      <p className="absolute left-6 top-[64px] font-display text-[30px] font-semibold text-slate-900">{title}</p>
      {children}
      {dim > 0 && <div className="absolute inset-0 bg-slate-900/40" style={{ opacity: dim }} />}
      {dock && <Dock active={active} knob={knob} />}
    </Sky>
  );
}

/* The phone's dock; `knob` 0..1 is the knob's travel to the Decide end. */
function Dock({ active, knob = 0 }) {
  const items = [["Desk", Tray], ["Work", Briefcase], [null], ["Money", Wallet], ["More", DotsThree]];
  return (
    <div className="absolute inset-x-4 bottom-6 h-[78px] rounded-full bg-[hsl(240_4%_9%)] shadow-[0_20px_40px_-20px_hsl(0_0%_0%/.8)]">
      <div className="flex h-full items-center justify-around px-3" style={{ opacity: 1 - Math.min(1, knob * 3) }}>
        {items.map(([label, Icon], i) => (label ? (
          <span key={label} className={`flex flex-col items-center gap-0.5 text-[11px] font-semibold ${label === active ? "text-white" : "text-white/55"}`}>
            <Icon size={19} weight={label === active ? "fill" : "regular"} />{label}
          </span>
        ) : <span key={i} className="w-16" />))}
      </div>
      {knob > 0 && (
        <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/80" style={{ opacity: Math.min(1, knob * 3) }}>Decide</span>
      )}
      <span className="absolute top-1/2 grid h-[68px] w-[68px] -translate-y-1/2 place-items-center rounded-full bg-[radial-gradient(circle_at_50%_35%,#fff,hsl(0_0%_86%))] shadow-[0_10px_24px_-8px_hsl(0_0%_0%/.6)]"
        style={{ left: `calc(${lerp(50, 82, knob)}% - 34px)` }}>
        <span className="h-9 w-9 rounded-full bg-[radial-gradient(circle_at_50%_60%,hsl(0_0%_92%),hsl(0_0%_80%))] shadow-[inset_0_2px_5px_hsl(0_0%_0%/.25)]" />
      </span>
    </div>
  );
}

/* The full-screen tick the phone shows after an action (Affirmation). */
export function Tick({ k, text }) {
  if (k <= 0) return null;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-[radial-gradient(120%_70%_at_50%_46%,hsl(0_0%_100%/.86),hsl(210_30%_96%/.7))] backdrop-blur-md" style={{ opacity: Math.min(1, k * 2) }}>
      <div className="text-center" style={{ transform: `scale(${0.7 + 0.3 * span(k, 0, 0.6)})` }}>
        <span className={`mx-auto grid h-20 w-20 place-items-center rounded-full ${INK}`}><Check size={38} weight="bold" /></span>
        <p className="mt-4 text-[18px] font-semibold text-slate-900">{text}</p>
      </div>
    </div>
  );
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function DeskRow({ title, meta, hue, style, mock }) {
  return (
    <div className="flex items-center gap-3 border-t border-white/[0.14] py-3.5" style={style} data-mock={mock}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: hue }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-neutral-200">{title}</p>
        <p className="truncate text-[13px] text-neutral-400">{meta}</p>
      </div>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[0.10] text-white/80"><ArrowRight size={13} weight="bold" /></span>
    </div>
  );
}

export function StepRow({ n, at, size = 30 }) {
  return (
    <div className="flex items-center">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center">
          <span className={`grid place-items-center rounded-full text-[12px] font-semibold ${i < at ? INK : "bg-white text-slate-600 ring-1 ring-inset ring-slate-300"}`}
            style={{ width: size, height: size, boxShadow: i === at ? `0 0 0 4px ${GOLD}55` : undefined }}>
            {i < at ? <Check size={13} weight="bold" /> : i + 1}
          </span>
          {i < n - 1 && <span className="mx-1 h-[2px] w-4 bg-slate-300" />}
        </div>
      ))}
    </div>
  );
}

export function TaskDeckCard({ j, p, w, done }) {
  const steps = j.memberTasks.slice(0, 5);
  const at = Math.min(steps.length, Math.floor(span(p, 0.3, 0.75, (x) => x) * steps.length));
  const next = steps[Math.min(at, steps.length - 1)];
  return (
    <div className={`relative flex flex-col rounded-[1.75rem] bg-[linear-gradient(180deg,#fff,hsl(220_14%_97%))] p-5 shadow-[0_30px_60px_-30px_hsl(0_0%_0%/0.6)]`} style={{ width: w }}>
      <div className="flex items-start justify-between">
        <span className="rounded-full bg-sky-50 px-3 py-1.5 text-[13px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">{done ? "Done" : at > 0 ? "Doing" : "To do"}</span>
        <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-[13px] font-semibold text-slate-700"><CalendarBlank size={13} weight="bold" /> Today</span>
      </div>
      <p className="mt-3 text-[22px] font-bold leading-[1.15] tracking-tight text-slate-900">{short(j.flow?.stages?.[0]?.label ? `${j.flow.stages[0].label} — ${j.flow.label}` : steps[0], 60)}</p>
      <p className="mt-3 text-[12px] font-medium text-slate-500">Assigned to</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-[12px] font-semibold text-slate-700">{initials(j.memberTeam)}</span>
        <span className="text-[14px] font-medium text-slate-700">{j.memberTeam}</span>
      </div>
      <div className="mt-4" data-mock="steps"><StepRow n={steps.length} at={done ? steps.length : at} /></div>
      <div className="mt-3 rounded-2xl bg-[linear-gradient(180deg,hsl(220_10%_95%),hsl(220_10%_93.5%))] p-3.5" data-mock="next">
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${INK}`}><ListChecks size={18} weight="bold" className="text-amber-300" /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{done ? "Checklist done" : `Next action · step ${Math.min(at + 1, steps.length)} of ${steps.length}`}</p>
            <p className="mt-0.5 text-[15px] font-semibold leading-snug text-slate-900">{short(done ? "Every step is ticked" : next, 90)}</p>
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <span className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-medium ${INK}`}>
          {at > 0 || done ? <CheckCircle size={16} weight="bold" /> : <Play size={15} weight="fill" />}{at > 0 || done ? "Mark complete" : "Mark as Doing"}
        </span>
        <span className="flex h-12 items-center rounded-full bg-white px-5 text-[15px] font-medium text-slate-800 ring-1 ring-inset ring-slate-200">Open task</span>
      </div>
    </div>
  );
}

/* ── The scenes ─────────────────────────────────────────────────────────── */

export function buildScenes(j, device) {
  const phone = device === "phone";
  const { w: W, h: H } = SCREEN[device];
  const C = { x: W / 2, y: H / 2, s: 1 };
  const rule = j.rule || { name: "Spending above your limit", description: "Comes to you before it happens." };
  const flow = j.flow || { label: "Orders", stages: [{ label: "Received", team: j.memberTeam }, { label: "Done", team: j.memberTeam }] };
  const decisionRows = [
    { title: rule.name, meta: "Needs you · from your rules", hue: "hsl(33 92% 56%)" },
    { title: `${flow.label}: this week`, meta: "Draft · Dex", hue: "hsl(210 55% 50%)" },
    { title: short(j.routines[0] || "Weekly review", 40), meta: "Due today", hue: "hsl(92 34% 42%)" },
  ];
  const plan = flow.stages.slice(0, 3).map((s) => ({ task: s.tasks?.[0] || s.label, team: s.team }));

  const scenes = [];

  /* 1 · Desk */
  scenes.push({
    key: "desk", chapter: "Desk", ms: 7000,
    title: `Everything that needs you lands on your Desk`,
    render: (p) => (phone ? (
      <PShell title="Desk">
        <p className="absolute left-6 top-[108px] text-[14px] text-slate-600" style={rise(p, 0, 0.12)}>Good morning, {j.founder}</p>
        <div className="absolute inset-x-4 top-[150px] rounded-[1.8rem] bg-[hsl(240_4%_9%)] p-4" style={rise(p, 0.05, 0.2, 24)}>
          <div className="flex gap-1 rounded-full bg-white/[0.08] p-1 text-[12px] font-semibold">
            <span className="flex-1 rounded-full bg-white py-1.5 text-center text-slate-900">Decisions 3</span>
            <span className="flex-1 py-1.5 text-center text-white/60">Approvals</span>
            <span className="flex-1 py-1.5 text-center text-white/60">Watch</span>
          </div>
          <div className="mt-3 space-y-2">
            {decisionRows.map((r, i) => (
              <div key={i} className="rounded-[1.15rem] border border-white/10 bg-white/[0.06] px-3.5 py-3" style={rise(p, 0.15 + i * 0.07, 0.3 + i * 0.07)} data-mock={i === 0 ? "row0" : undefined}>
                <p className="truncate text-[14px] font-medium text-white">{r.title}</p>
                <p className="mt-0.5 text-[12px] text-white/55">{r.meta}</p>
              </div>
            ))}
          </div>
        </div>
      </PShell>
    ) : (
      <DShell j={j}>
        <div className="absolute left-10 top-[104px]" style={rise(p, 0, 0.12)}>
          <p className="font-display text-[34px] font-light leading-tight text-slate-900">Good morning, {j.founder}</p>
          <p className="text-[15px] text-slate-500">{j.company} · 3 things need you today</p>
        </div>
        <div className="absolute left-10 top-[200px] h-[56px] w-[1120px] rounded-[1.4rem] bg-white/70 px-5 py-4 text-[15px] text-slate-400 ring-1 ring-inset ring-white" style={rise(p, 0.05, 0.18)}>
          <Sparkle size={16} weight="fill" className="mr-2 inline text-amber-500" /> Type a decision…
        </div>
        <div className="absolute left-10 top-[280px] grid h-[430px] w-[1120px] grid-cols-3 rounded-[1.8rem] bg-[hsl(240_4%_9%)] shadow-[inset_0_2px_10px_hsl(0_0%_0%/.5)]" style={rise(p, 0.08, 0.24, 24)}>
          {[["Decisions", decisionRows, "hsl(33 92% 56%)"], ["Task approvals", [{ title: plan[1]?.task || "Packing check", meta: `${plan[1]?.team || j.memberTeam} · done, needs you`, hue: GOLD }], "hsl(44 88% 60%)"],
            ["Due today", [{ title: short(j.routines[0] || "Stock check", 38), meta: j.memberTeam, hue: "hsl(210 55% 50%)" }], "hsl(210 55% 50%)"]].map(([h, rows, hue], c) => (
            <div key={h} className={`px-6 py-5 ${c ? "border-l border-white/[0.14]" : ""}`}>
              <p className="flex items-center gap-2 text-[16px] font-medium text-white/85">
                <span className="h-3 w-3 rounded-full" style={{ background: hue }} />{h}
                <span className="rounded-full bg-white/[0.10] px-2 text-[12px] text-white/70">{rows.length}</span>
              </p>
              <div className="mt-3">
                {rows.map((r, i) => <DeskRow key={i} {...r} mock={c === 0 && i === 0 ? "row0" : undefined} style={rise(p, 0.18 + (c * 3 + i) * 0.04, 0.32 + (c * 3 + i) * 0.04)} />)}
              </div>
            </div>
          ))}
        </div>
      </DShell>
    )),
    camera: phone
      ? [{ at: 0, ...C }, { at: 0.35, ...C }, { at: 0.6, x: 195, y: 260, s: 1.35 }, { at: 1, x: 195, y: 260, s: 1.35 }]
      : [{ at: 0, ...C }, { at: 0.35, ...C }, { at: 0.6, x: 230, y: 380, s: 1.7 }, { at: 1, x: 230, y: 380, s: 1.7 }],
    notes: [
      { id: "row", target: "row0", at: [0.62, 1],  side: phone ? "bottom" : "right",
        title: "A decision waiting for you", text: `“${short(rule.name, 40)}” came from your own rules. Open it to decide.` },
    ],
  });

  /* 2 · Decide */
  const sayA = 0.1; const sayB = 0.42;
  scenes.push({
    key: "decide", chapter: "Decide", ms: 9000,
    title: "Say what you decided — Dex writes the plan",
    render: (p) => {
      const reviewIn = span(p, 0.52, 0.62);
      const pressed = p > 0.86;
      const review = (
        <div className={`absolute ${phone ? "inset-x-3 top-[96px] bottom-[120px]" : "left-[300px] top-[96px] h-[600px] w-[600px]"} flex flex-col gap-3 rounded-[2rem] bg-[linear-gradient(165deg,hsl(0_0%_96%),hsl(0_0%_91%))] p-5 shadow-[0_30px_80px_-20px_hsl(0_0%_0%/0.45)]`}
          style={{ opacity: reviewIn, transform: `translateY(${(1 - reviewIn) * 30}px)` }}>
          <div className={`${CARD} p-4`}>
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">The decision</p>
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600">High</span>
            </div>
            <p className="mt-1.5 text-[19px] font-semibold leading-snug text-slate-900">{short(j.said, 80)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[["Tasks", plan.length], ["Teams", new Set(plan.map((x) => x.team)).size], ["Approvals", 1]].map(([k, v], i) => (
              <div key={k} className={`rounded-2xl p-3 ${GLASS}`} style={rise(p, 0.6 + i * 0.03, 0.68 + i * 0.03)}>
                <p className="font-display text-[22px] font-semibold text-slate-900">{v}</p><p className="text-[12px] text-slate-500">{k}</p>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tasks created by Dex</p>
          <div className="space-y-2" data-mock="plan">
            {plan.map((x, i) => (
              <div key={i} className={`flex items-center gap-3 px-3.5 py-3 ${CARD}`} style={rise(p, 0.64 + i * 0.05, 0.74 + i * 0.05)} data-mock={`task-${i}`}>
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${INK}`}>{i + 1}</span>
                <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-800">{x.task}</p>
                <span className="shrink-0 rounded-full bg-slate-900/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-600">{short(x.team, 18)}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto">
            <span className={`flex h-14 items-center justify-center rounded-full text-[16px] font-semibold ${INK} ${pressed ? "scale-[0.97]" : ""}`}>Approve</span>
          </div>
        </div>
      );
      const words = typed(j.said, p, sayA, sayB);
      return phone ? (
        <PShell title="Desk" knob={span(p, 0.02, 0.1)} dim={reviewIn * 0.6}>
          {p < 0.62 && (
            <div className="absolute inset-x-4 top-[300px] rounded-[1.6rem] bg-white/90 p-5 shadow-lg" style={rise(p, 0.1, 0.16)} data-mock="say">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">What you said</p>
              <p className="mt-2 min-h-[72px] text-[17px] leading-snug text-slate-900">{words}{p < sayB && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-slate-500 align-middle" />}</p>
              {p > 0.44 && <p className="ng-glow-text mt-2 text-center text-[15px] font-medium">Dex is reading…</p>}
            </div>
          )}
          {review}
          <Tick k={span(p, 0.9, 1)} text="Approved — tasks sent" />
        </PShell>
      ) : (
        <DShell j={j} dim={reviewIn * 0.7}>
          <div className="absolute left-10 top-[104px]">
            <p className="font-display text-[34px] font-light leading-tight text-slate-900">Good morning, {j.founder}</p>
          </div>
          <div className="absolute left-10 top-[200px] flex h-[56px] w-[1120px] items-center gap-3 rounded-[1.4rem] bg-white px-5 text-[15px] ring-2 ring-[hsl(44_88%_60%/.6)]" data-mock="say">
            <Microphone size={18} weight="fill" className="text-amber-500" />
            <span className="min-w-0 flex-1 truncate text-slate-900">{words || <span className="text-slate-400">Type a decision…</span>}</span>
            {p > 0.44 && p < 0.55 && <span className="ng-glow-text shrink-0 text-[14px] font-medium">Dex is reading…</span>}
          </div>
          {review}
          <Tick k={span(p, 0.9, 1)} text="Approved — tasks sent to your teams" />
        </DShell>
      );
    },
    camera: phone
      ? [{ at: 0, ...C }, { at: 0.12, x: 195, y: 380, s: 1.25 }, { at: 0.48, x: 195, y: 380, s: 1.25 }, { at: 0.6, ...C }, { at: 1, ...C }]
      : [{ at: 0, ...C }, { at: 0.1, x: 460, y: 228, s: 1.8 }, { at: 0.46, x: 520, y: 228, s: 1.8 }, { at: 0.58, ...C }, { at: 0.7, ...C }, { at: 0.92, ...C }, { at: 1, ...C }],
    notes: [
      { id: "say", target: "say", at: [0.14, 0.46],  side: phone ? "bottom" : "bottom", title: "Speak or type it", text: "In your own words, any language.", },
      { id: "plan", target: "plan", at: [0.7, 0.88],  side: phone ? "top" : "left", title: "Dex drafts the work", text: "Each task goes to the team that owns that step.", },
    ],
  });

  /* 3 · One chapter per workflow (up to three; the last says how many more
     are waiting in the summary above). */
  const flowScene = (flow, fi, more) => {
  const st = flow.stages.slice(0, phone ? 5 : 6);
  const n = st.length;
  return {
    key: `flow-${fi}`, chapter: short(flow.label, 16), ms: 8000,
    title: `${flow.label}: every step, in order`,
    render: (p) => {
      const k = Math.min(n - 1, Math.floor(span(p, 0.12, 0.92, (x) => x) * n));
      if (phone) {
        return (
          <PShell title="Workflow" active="More">
            <p className="absolute left-6 top-[108px] text-[14px] text-slate-600">{flow.label}</p>
            <div className="absolute inset-x-5 top-[150px]">
              {st.map((s, i) => (
                <div key={i} className="relative flex gap-4 pb-6" data-mock={`stage-${i}`}>
                  {i < n - 1 && <span className="absolute left-[17px] top-9 h-full w-[2px] bg-slate-300" />}
                  <span className={`relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${i < k ? INK : i === k ? (s.gate ? "bg-[hsl(44_88%_60%)] text-slate-900" : INK) : "bg-white text-slate-600 ring-1 ring-slate-300"}`}
                    style={{ boxShadow: i === k ? `0 0 0 5px ${GOLD}55` : undefined }}>
                    {s.gate ? <ShieldCheck size={15} weight="fill" /> : i < k ? <Check size={14} weight="bold" /> : i + 1}
                  </span>
                  <div className="min-w-0 pt-1">
                    <p className={`text-[16px] font-semibold ${i === k ? "text-slate-900" : "text-slate-600"}`}>{s.label}</p>
                    <span className="mt-1 inline-block rounded-full bg-white/80 px-2.5 py-1 text-[12px] text-slate-600">{s.gate ? "You" : s.team}</span>
                    {i === k && (
                      <div className={`mt-2 rounded-2xl p-3 ${CARD}`} style={rise(p, 0.12 + (k / n) * 0.8, 0.18 + (k / n) * 0.8)}>
                        <p className="text-[13px] font-semibold text-slate-900">Order #1042</p>
                        <p className="text-[12px] text-slate-500">{short(s.tasks?.[0] || "Work in this step", 46)}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </PShell>
        );
      }
      const laneW = Math.floor((1120 - (n - 1) * 14) / n);
      return (
        <DShell j={j} active="Ops">
          <p className="absolute left-10 top-[100px] font-display text-[28px] text-slate-900">{flow.label}</p>
          <div className="absolute left-10 top-[150px] flex w-[1120px] items-start">
            {st.map((s, i) => (
              <div key={i} className="relative flex flex-1 flex-col items-center">
                {i < n - 1 && <span className="absolute left-1/2 top-[15px] h-px w-full bg-slate-400/60" />}
                <span className={`relative z-[1] grid h-8 w-8 place-items-center rounded-full text-[12px] font-semibold ${i < k ? INK : i === k ? (s.gate ? "bg-[hsl(44_88%_60%)] text-slate-900" : INK) : "bg-white text-slate-600 ring-1 ring-slate-300"}`}
                  style={{ boxShadow: i === k ? `0 0 0 5px ${GOLD}55` : undefined }}>
                  {s.gate ? <ShieldCheck size={14} weight="fill" /> : i < k ? <Check size={13} weight="bold" /> : i + 1}
                </span>
                <p className="mt-2 text-[13px] font-semibold text-slate-900">{s.label}</p>
                <span className="mt-1 rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] text-slate-600">{s.gate ? "You" : short(s.team, 22)}</span>
              </div>
            ))}
          </div>
          <div className="absolute left-10 top-[250px] flex gap-[14px]">
            {st.map((s, i) => (
              <div key={i} className="h-[460px] rounded-[1.4rem] bg-white/45 p-3 ring-1 ring-inset ring-white/70" style={{ width: laneW }} data-mock={`stage-${i}`}>
                <p className="px-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">{short(s.label, 18)}</p>
              </div>
            ))}
          </div>
          {/* The order, moving lane to lane. */}
          <div className={`absolute top-[300px] p-3.5 ${CARD}`}
            style={{ width: laneW - 24, left: 52 + (laneW + 14) * k, transition: "left 700ms cubic-bezier(.22,1,.36,1)" }}
            data-mock="order">
            <p className="text-[14px] font-semibold text-slate-900">Order #1042</p>
            <p className="mt-0.5 text-[12px] text-slate-500">{short(st[k].tasks?.[0] || "Work in this step", 60)}</p>
            <span className="mt-2 inline-block rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-[11px] text-slate-600">{st[k].gate ? "Waiting for you" : short(st[k].team, 22)}</span>
          </div>
        </DShell>
      );
    },
    camera: phone ? [{ at: 0, ...C }, { at: 1, ...C }] : (() => {
      const laneW = Math.floor((1120 - (n - 1) * 14) / n);
      const keys = [{ at: 0, ...C }, { at: 0.1, x: 40 + laneW / 2, y: 330, s: 1.45 }];
      for (let i = 1; i < n; i++) {
        const at = 0.12 + (i / n) * 0.8;
        keys.push({ at: at - 0.02, x: 40 + (laneW + 14) * (i - 1) + laneW / 2, y: 330, s: 1.45 });
        keys.push({ at: at + 0.05, x: 40 + (laneW + 14) * i + laneW / 2, y: 330, s: 1.45 });
      }
      keys.push({ at: 0.97, ...C });
      keys.push({ at: 1, ...C });
      return keys;
    })(),
    notes: st.map((s, i) => {
      const a = 0.14 + (i / n) * 0.8;
      return {
        id: `st-${i}`, at: [a, a + 0.8 / n - 0.05],
        target: `stage-${i}`,
        side: phone ? "right" : i >= n - 2 ? "left" : "right",
        title: s.gate ? "It waits for you" : `${short(s.team, 24)} takes it`,
        text: s.gate ? "This step needs your sign-off before work moves on." : short(s.label, 40),
      };
    }).concat(more > 0 ? [{ id: "more", target: `stage-${n - 1}`, at: [0.93, 1], side: "left",
      title: `And ${more} more ${more === 1 ? "workflow" : "workflows"}`, text: "Every one is laid out in the summary above." }] : []),
  };
  };
  const shownFlows = j.flows.length ? j.flows.slice(0, 3) : [flow];
  shownFlows.forEach((f, fi) => scenes.push(flowScene(f, fi, fi === shownFlows.length - 1 ? Math.max(0, j.flows.length - 3) : 0)));

  /* 4 · My Work */
  scenes.push({
    key: "mywork", chapter: "My Work", ms: 8000,
    title: `${j.memberTeam} sees just their next step`,
    render: (p) => {
      const done = p > 0.86;
      return phone ? (
        <PShell title="My Work" active="Work">
          <div className="absolute inset-x-0 top-[120px] bottom-0 rounded-t-[2rem] bg-[linear-gradient(180deg,hsl(240_4%_12%),hsl(240_4%_7%)_160px)] px-3 pt-4">
            <p className="px-2 text-[13px] text-white/80">My tasks</p>
            <div className="mt-3" style={rise(p, 0.02, 0.14, 20)}><TaskDeckCard j={j} p={p} w={366} done={done} /></div>
          </div>
          <Tick k={span(p, 0.88, 1)} text="Done — the next team is told" />
        </PShell>
      ) : (
        <DShell j={j} active="My Work">
          <p className="absolute left-10 top-[100px] font-display text-[32px] text-slate-900">My Work</p>
          <p className="absolute left-10 top-[146px] text-[14px] text-slate-500">{j.memberTeam} · 1 open</p>
          <div className="absolute left-[360px] top-[120px]" style={rise(p, 0.02, 0.14, 20)}><TaskDeckCard j={j} p={p} w={480} done={done} /></div>
          <Tick k={span(p, 0.88, 1)} text="Done — the next team is told" />
        </DShell>
      );
    },
    camera: phone
      ? [{ at: 0, ...C }, { at: 0.2, ...C }, { at: 0.32, x: 195, y: 520, s: 1.3 }, { at: 0.78, x: 195, y: 520, s: 1.3 }, { at: 0.86, ...C }, { at: 1, ...C }]
      : [{ at: 0, ...C }, { at: 0.2, ...C }, { at: 0.32, x: 600, y: 440, s: 1.55 }, { at: 0.78, x: 600, y: 440, s: 1.55 }, { at: 0.86, ...C }, { at: 1, ...C }],
    notes: [
      { id: "steps", target: "steps", at: [0.34, 0.6],  side: phone ? "top" : "left", title: "A checklist Dex drafted", text: "Each number is a step. Tap one to read it.", },
      { id: "next", target: "next", at: [0.6, 0.84],  side: phone ? "top" : "right", title: "Only the next step", text: "Nobody has to ask what to do now.", },
    ],
  });

  /* 5 · Sign-off */
  scenes.push({
    key: "signoff", chapter: "Sign-off", ms: 7000,
    title: "Only what you chose reaches you",
    render: (p) => {
      const card = (
        <div className={`${CARD} p-5`} style={{ ...rise(p, 0.05, 0.2, 20), width: phone ? 358 : 600 }} data-mock="rule">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700"><ShieldCheck size={14} weight="fill" /> Needs your approval</p>
          <p className="mt-2 text-[20px] font-semibold leading-snug text-slate-900">{rule.name}</p>
          {rule.description && <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">{short(rule.description, 140)}</p>}
          <div className="mt-4 flex gap-2">
            <span className={`flex h-11 flex-1 items-center justify-center rounded-full text-[15px] font-medium ${INK} ${p > 0.62 ? "scale-[0.97]" : ""}`}>Approve</span>
            <span className={`flex h-11 items-center rounded-full px-5 text-[15px] font-medium text-slate-700 ${GLASS}`}>Reject</span>
          </div>
        </div>
      );
      return phone ? (
        <PShell title="Approvals" active="More">
          <div className="absolute left-4 top-[130px]">{card}</div>
          <Tick k={span(p, 0.66, 0.8)} text="Approved — work moves on" />
        </PShell>
      ) : (
        <DShell j={j} active="My Work">
          <p className="absolute left-10 top-[100px] font-display text-[32px] text-slate-900">Approvals</p>
          <div className="absolute left-[300px] top-[190px]">{card}</div>
          <Tick k={span(p, 0.66, 0.8)} text="Approved — work moves on" />
        </DShell>
      );
    },
    camera: phone
      ? [{ at: 0, ...C }, { at: 0.25, x: 195, y: 260, s: 1.2 }, { at: 0.62, x: 195, y: 260, s: 1.2 }, { at: 0.7, ...C }, { at: 1, ...C }]
      : [{ at: 0, ...C }, { at: 0.25, x: 600, y: 300, s: 1.45 }, { at: 0.62, x: 600, y: 300, s: 1.45 }, { at: 0.7, ...C }, { at: 1, ...C }],
    notes: [
      { id: "rule", target: "rule", at: [0.28, 0.62],  side: phone ? "bottom" : "right", title: "One of your rules", text: "You set these in the interview. Change them any time.", },
    ],
  });

  /* 6 · Routines */
  const routines = (j.routines.length ? j.routines : ["Weekly stock check", "Monthly accounts review"]).slice(0, 4);
  scenes.push({
    key: "routines", chapter: "Routines", ms: 6000,
    title: "Routines arrive on their own",
    render: (p) => {
      const rows = (
        <div className={`overflow-hidden rounded-[1.5rem] bg-white/90 shadow-[0_18px_40px_-24px_hsl(230_30%_18%/.55)]`} style={{ width: phone ? 358 : 720 }} data-mock="routines">
          <div className="flex items-center justify-between border-b border-slate-900/[0.06] px-4 py-3">
            <p className="text-[15px] font-semibold text-slate-900">My Work</p>
            <span className="flex items-center gap-1 rounded-full bg-slate-900/[0.05] px-2.5 py-1 text-[12px] text-slate-600"><ArrowsClockwise size={12} weight="bold" /> Recurring</span>
          </div>
          {routines.map((r, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-slate-900/[0.05] px-4 py-3.5 last:border-b-0" style={rise(p, 0.12 + i * 0.12, 0.24 + i * 0.12)}>
              <span className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-slate-300" />
              <span className="min-w-0 flex-1 truncate text-[15px] text-slate-800">{r}</span>
              <span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">Repeats</span>
            </div>
          ))}
        </div>
      );
      return phone ? (
        <PShell title="My Work" active="Work"><div className="absolute left-4 top-[130px]">{rows}</div></PShell>
      ) : (
        <DShell j={j} active="My Work">
          <p className="absolute left-10 top-[100px] font-display text-[32px] text-slate-900">My Work</p>
          <div className="absolute left-[240px] top-[180px]">{rows}</div>
        </DShell>
      );
    },
    camera: phone ? [{ at: 0, ...C }, { at: 1, ...C }] : [{ at: 0, ...C }, { at: 0.3, x: 600, y: 330, s: 1.25 }, { at: 1, x: 600, y: 330, s: 1.25 }],
    notes: [
      { id: "rt", target: "routines", at: [0.6, 1],  side: phone ? "bottom" : "right", title: "Nobody has to remember", text: "Dex hands these out on schedule.", },
    ],
  });

  /* 0 · At a glance — the company as a picture, before any screen. */
  scenes.push({
    key: "glance", chapter: "At a glance", ms: 6500,
    title: `${j.company}, as Dex built it`,
    render: (p) => {
      const teams = j.teams.slice(0, 8);
      const cx = W / 2; const cy = phone ? 300 : H * 0.38; const R = phone ? 118 : 210;
      return (
        <Sky>
          <svg className="absolute inset-0" width={W} height={H} aria-hidden="true">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="hsl(230 20% 30% / .14)" strokeDasharray="3 5" />
            {teams.map((t, i) => {
              const a = -Math.PI / 2 + (i * 2 * Math.PI) / teams.length;
              const k = span(p, 0.12 + i * 0.05, 0.3 + i * 0.05);
              return <line key={t.key} x1={cx} y1={cy} x2={cx + R * Math.cos(a) * k} y2={cy + R * Math.sin(a) * k} stroke="hsl(230 20% 30% / .18)" />;
            })}
          </svg>
          <div className="absolute" style={{ left: cx, top: cy, transform: "translate(-50%, -50%)" }}>
            <span className={`grid place-items-center rounded-full font-display font-semibold ${INK} ${phone ? "h-20 w-20 text-2xl" : "h-28 w-28 text-4xl"}`}
              style={rise(p, 0, 0.12, 0)}>{initials(j.company)}</span>
          </div>
          {teams.map((t, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / teams.length;
            return (
              <div key={t.key} className="absolute w-28" style={{ left: cx + R * Math.cos(a), top: cy + R * Math.sin(a), transform: "translate(-50%, -22px)" }}>
                <div className="flex flex-col items-center text-center" style={rise(p, 0.15 + i * 0.05, 0.3 + i * 0.05, 10)}>
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-slate-800 shadow-[0_10px_24px_-12px_hsl(230_30%_18%/.5)]"><UsersThree size={20} weight="duotone" /></span>
                  <span className={`mt-1.5 line-clamp-2 rounded-lg bg-white/95 px-2 py-0.5 font-medium leading-tight text-slate-700 shadow-[0_4px_12px_-8px_hsl(230_30%_18%/.5)] ${phone ? "text-[10px]" : "text-[12px]"}`}>{t.label}</span>
                </div>
              </div>
            );
          })}
          <div className={`absolute grid gap-2 ${phone ? "inset-x-4 top-[500px] grid-cols-3" : "w-[960px] grid-cols-6"}`} data-mock="counts"
            style={phone ? undefined : { left: (W - 960) / 2, top: H - 210 }}>
            {j.counts.map((c, i) => (
              <div key={c.key} className={`rounded-2xl p-3 text-center ${GLASS}`} style={rise(p, 0.45 + i * 0.04, 0.58 + i * 0.04)}>
                <p className="font-display text-[26px] font-semibold leading-none text-slate-900">{Math.round(c.n * span(p, 0.45 + i * 0.04, 0.7 + i * 0.04))}</p>
                <p className="mt-1 text-[11px] text-slate-500">{c.label}</p>
              </div>
            ))}
          </div>
        </Sky>
      );
    },
    camera: [{ at: 0, ...C }, { at: 1, ...C }],
    notes: [{ id: "counts", target: "counts", at: [0.72, 1], side: "top", title: "All from your interview", text: "Nothing here is a template — it is how you said you work." }],
  });

  /* Ask Dex — the company brain, answering from this company's own setup. */
  const f0 = j.flows[0];
  // Any workflow name reads in this sentence ("Wholesale Orders", "Raw Spice Buying").
  const askQ = f0 ? `Who does what in ${f0.label}?` : "Who does what when an order comes in?";
  const askA = f0
    ? f0.stages.slice(0, 4).map((x, i) => `${i === 0 ? "First" : "Then"} ${x.gate ? "you sign off" : x.team} — ${x.label.toLowerCase()}`).join(". ") + "."
    : `${j.memberTeam} picks it up, and anything over your limit comes to you.`;
  scenes.push({
    key: "ask", chapter: "Ask Dex", ms: 8000,
    title: "Ask Dex anything about your company",
    render: (p) => {
      const q = typed(askQ, p, 0.08, 0.3);
      const a = typed(askA, p, 0.42, 0.85);
      const panel = (
        <div className={`absolute flex flex-col rounded-[1.8rem] bg-[hsl(0_0%_7%/.96)] p-4 text-white shadow-[0_30px_70px_-24px_hsl(0_0%_0%/.8)] ${phone ? "inset-x-3 top-[110px] bottom-[118px]" : "left-[260px] top-[100px] h-[600px] w-[680px]"}`}>
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10"><Sparkle size={15} weight="fill" className="text-amber-300" /></span>
            <div><p className="text-[14px] font-semibold">Ask Dex</p><p className="text-[11px] text-white/50">Knows {j.company}</p></div>
          </div>
          <div className="mt-4 flex-1 space-y-3 overflow-hidden">
            {q && <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-white px-3.5 py-2.5 text-[14px] text-slate-900" data-mock="ask-q">{q}</div>}
            {p > 0.32 && p < 0.44 && <p className="animate-pulse text-[14px] font-medium text-white/80">Dex is thinking…</p>}
            {a && (
              <div className="max-w-[88%] rounded-2xl rounded-bl-md bg-white/[0.08] px-3.5 py-3 text-[14px] leading-relaxed text-white/90" data-mock="ask-a">
                {a}
                {p > 0.86 && f0 && <span className="mt-2 flex w-fit items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70"><Kanban size={11} weight="bold" /> From: {f0.label}</span>}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2.5 text-[13px] text-white/40">
            <ChatCircleDots size={15} weight="bold" /> Ask about orders, people, money… <PaperPlaneRight size={14} weight="bold" className="ml-auto" />
          </div>
        </div>
      );
      return phone ? <PShell title="Desk" dim={0.5}>{panel}</PShell> : <DShell j={j} dim={0.55}>{panel}</DShell>;
    },
    camera: [{ at: 0, ...C }, { at: 1, ...C }],
    notes: [{ id: "a", target: "ask-a", at: [0.86, 1], side: phone ? "top" : "right", title: "Answers from your own data", text: "Your workflows, tasks, people and decisions — it knows them all." }],
  });

  /* Everything else in DecisionOS, so nobody has to go looking for a guide. */
  const ADDONS = [
    { icon: Wallet, name: "Finance", line: "What's owed, what's paid, what's due" },
    { icon: Kanban, name: "Ops", line: "Every workflow, step by step, on one board" },
    { icon: AddressBook, name: "CRM", line: "Buyers and suppliers, every conversation" },
    { icon: UsersThree, name: "Team", line: "People, roles, leave and requests" },
    { icon: Brain, name: "Company Brain", line: `Everything Dex knows about ${j.company}` },
    { icon: BookOpenText, name: "Journal", line: "Every decision, why, and how it went" },
    { icon: CalendarBlank, name: "Calendar", line: "Due dates and routines in one place" },
    { icon: Gauge, name: "Operating Score", line: "One number for how the company runs" },
    { icon: SunHorizon, name: "Morning brief", line: "What changed, what needs you today" },
  ];
  scenes.push({
    key: "addons", chapter: "Everything else", ms: 8000,
    title: "And the rest of your company, in one place",
    render: (p) => (
      <Sky>
        <div className={`absolute grid gap-3 ${phone ? "inset-x-4 top-[70px] grid-cols-2" : "left-[120px] top-[90px] w-[960px] grid-cols-3"}`}>
          {ADDONS.map((m, i) => {
            const Icon = m.icon;
            return (
              <div key={m.name} className={`rounded-[1.4rem] bg-white/85 ${phone ? "p-3" : "p-5"} shadow-[0_14px_30px_-20px_hsl(230_30%_18%/.55)] ring-1 ring-inset ring-white`}
                style={rise(p, 0.04 + i * 0.05, 0.16 + i * 0.05, 16)} data-mock={`addon-${i}`}>
                <span className={`grid place-items-center rounded-xl ${INK} ${phone ? "h-9 w-9" : "h-11 w-11"}`}><Icon size={phone ? 17 : 20} weight="duotone" /></span>
                <p className={`mt-2.5 font-semibold text-slate-900 ${phone ? "text-[14px]" : "text-[17px]"}`}>{m.name}</p>
                <p className={`mt-0.5 leading-snug text-slate-500 ${phone ? "text-[11.5px]" : "text-[13px]"}`}>{m.line}</p>
              </div>
            );
          })}
        </div>
      </Sky>
    ),
    camera: [{ at: 0, ...C }, { at: 1, ...C }],
    notes: [
      { id: "fin", target: "addon-0", at: [0.6, 0.73], side: phone ? "bottom" : "right", title: "Finance", text: "Invoices and payments sit beside the work that earns them." },
      { id: "brain", target: "addon-4", at: [0.74, 0.87], side: phone ? "top" : "right", title: "Company Brain", text: "Ask it anything — it answers from your company." },
      { id: "jr", target: "addon-5", at: [0.88, 1], side: phone ? "top" : "left", title: "Journal", text: "Every decision you make, kept with its reason." },
    ],
  });

  /* The full cycle — the loop the whole product runs on. */
  const LOOP = [
    { name: "You decide", sub: "Speak or type it" },
    { name: "Dex plans", sub: "Tasks for each team" },
    { name: "Teams do it", sub: "One next step each" },
    { name: "You sign off", sub: "Only what you chose" },
    { name: "Work is done", sub: "Proof kept" },
    { name: "You're told", sub: "And decide again" },
  ];
  scenes.push({
    key: "cycle", chapter: "The cycle", ms: 7500,
    title: "How every day runs, start to finish",
    render: (p) => {
      const cx = W / 2; const cy = phone ? 360 : H / 2 - 10; const R = phone ? 132 : 250;
      const lit = Math.floor(span(p, 0.08, 0.8, (x) => x) * LOOP.length);
      const t = span(p, 0.08, 0.8, (x) => x) * 2 * Math.PI;
      return (
        <Sky>
          <svg className="absolute inset-0" width={W} height={H} aria-hidden="true">
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="hsl(230 20% 30% / .16)" strokeWidth="2" />
            <circle cx={cx} cy={cy} r={R} fill="none" stroke={GOLD} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * R * span(p, 0.08, 0.8, (x) => x)} ${2 * Math.PI * R}`} transform={`rotate(-90 ${cx} ${cy})`} />
            <circle cx={cx + R * Math.cos(t - Math.PI / 2)} cy={cy + R * Math.sin(t - Math.PI / 2)} r="7" fill={GOLD} opacity={p < 0.82 ? 1 : 0} />
          </svg>
          <div className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: cx, top: cy }}>
            <p className={`font-display font-semibold text-slate-900 ${phone ? "text-[20px]" : "text-[28px]"}`}>{j.company}</p>
            <p className="text-[13px] text-slate-500">on DecisionOS</p>
          </div>
          {LOOP.map((x, i) => {
            const a = -Math.PI / 2 + (i * 2 * Math.PI) / LOOP.length;
            const on = i < lit || p > 0.8;
            return (
              <div key={x.name} className={`absolute flex flex-col items-center text-center ${phone ? "w-[6.5rem]" : "w-40"}`}
                style={{ left: cx + R * Math.cos(a), top: cy + R * Math.sin(a), transform: `translate(-50%, ${phone ? -18 : -22}px)` }}>
                <span className={`grid place-items-center rounded-full text-[13px] font-semibold transition-colors ${phone ? "h-9 w-9" : "h-11 w-11"} ${on ? INK : "bg-white text-slate-500 ring-1 ring-slate-300"}`}
                  style={{ boxShadow: i === lit && p < 0.8 ? `0 0 0 6px ${GOLD}55` : undefined }}>{i + 1}</span>
                <div className="mt-1.5 rounded-xl bg-white/95 px-2.5 py-1.5 shadow-[0_6px_16px_-10px_hsl(230_30%_18%/.5)]">
                  <p className={`font-semibold leading-tight ${on ? "text-slate-900" : "text-slate-500"} ${phone ? "text-[12px]" : "text-[14px]"}`}>{x.name}</p>
                  <p className={`leading-tight text-slate-500 ${phone ? "text-[10.5px]" : "text-[12px]"}`}>{x.sub}</p>
                </div>
              </div>
            );
          })}
        </Sky>
      );
    },
    camera: [{ at: 0, ...C }, { at: 1, ...C }],
    notes: [],
  });

  /* The running order, and only what this company has: no sign-off chapter
     without rules, no routines chapter without routines. */
  const ORDER = ["glance", ...shownFlows.map((_, i) => `flow-${i}`), "desk", "decide", "mywork", "signoff", "routines", "ask", "addons", "cycle"];
  const skip = new Set([!j.rules.length && "signoff", !j.routines.length && "routines"].filter(Boolean));
  const ordered = ORDER.filter((k) => !skip.has(k)).map((k) => scenes.find((sc) => sc.key === k)).filter(Boolean);
  scenes.length = 0;
  scenes.push(...ordered);

  /* A phone screen has no width to spare, so its camera holds the whole
     screen and the spotlight does the focusing. */
  if (phone) scenes.forEach((sc) => { sc.camera = [{ at: 0, ...C }, { at: 1, ...C }]; });
  return scenes;
}

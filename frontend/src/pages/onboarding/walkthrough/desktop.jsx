/* THE TOUR ON A DESKTOP, IN THE APP'S OWN CLOTHES (2026-10-30, founder):
 * "show the actual DecisionOS desktop interface, full screen, the same video
 * — use the actual UI components' design, not a simplified UI; the screens
 * can be simpler, but not redesigned components."
 *
 * So these screens are built from the app's own parts at a real laptop size
 * (1440×900): the real wordmark and pill nav on the black dip (NeuGlassLogo,
 * PillNav, .ng-navplate), the real page artwork (/sky/*), the Desk's KPI tiles
 * and black board (.nm-tile .ng-kpi-tile, .ng-desk-board), the Decide well
 * (.ng-well__pane), the Ops lanes and cards (.ng-glass-well, .ng-frost
 * .ng-lane, .ng-bento), the My Work deck card, the drawer's approval card
 * (DRAWER_CARD, INK_PILL, GLASS_PILL). What is left out is only what a given
 * moment does not need. Every name and number is the new company's.
 *
 * The chapters, their order and their timing are the same as the phone's
 * (scenes.jsx); this file swaps in the desktop screen for each, and the
 * illustrated chapters (at a glance, the cycle) are shared as they are.
 */
import {
  Bell, Globe, Microphone, ShieldCheck, Sparkle, ArrowRight, CalendarBlank, ArrowsClockwise,
  Kanban, AddressBook, UsersThree, Brain, BookOpenText, Gauge, SunHorizon, Wallet, ChatCircleDots, PaperPlaneRight, Clock,
} from "@phosphor-icons/react";
import { NeuGlassLogo } from "../../../components/neuglass/Logo";
import { PillNav } from "../../../components/neuglass/PillNav";
import { INK_PILL, GLASS_PILL, DRAWER_CARD, DRAWER_LABEL, DRAWER_TRACK, GLASS_SHEET } from "../../../components/neuglass/glass";
import { span, SCREEN } from "./Player";
import { buildScenes, typed, rise, initials, short, Tick, TaskDeckCard, GOLD } from "./scenes";

const NAV = ["Decision Desk", "My Work", "Ops", "CRM", "Team", "Dex", "Finance"];
const ART = { desk: "/sky/inbox-lg.png", work: "/sky/my-work-lg.webp", ops: "/sky/ops.webp" };

/* The app's shell: the header exactly as Layout draws it at lg, the page's
   own artwork behind, the page under it. The active pill is marked by the
   router (NavLink), so it points at wherever this tour is being watched. */
function Shell({ j, active, art, children, dim = 0 }) {
  const here = typeof window !== "undefined" ? window.location.pathname : "/";
  const items = NAV.map((label, i) => ({ to: label === active ? here : `/__tour/${i}`, end: true, label }));
  return (
    <div className="absolute inset-0 overflow-hidden bg-nm text-foreground">
      {art && <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${art})` }} />}
      <header className="ng-navplate relative grid h-[88px] grid-cols-[minmax(0,1fr)_auto_1fr] items-center gap-4 bg-transparent px-6 pb-[13px]"
        style={{ "--navplate-w": "700px" }}>
        <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
          <NeuGlassLogo className="shrink-0" />
          <span aria-hidden="true" className="shrink-0 select-none text-[17px] font-light leading-none text-foreground/25">|</span>
          <span className="min-w-0 truncate text-[15px] font-medium leading-none text-foreground/70">{j.company}</span>
        </div>
        <PillNav plate items={items} />
        <div className="flex items-center gap-2.5 justify-self-end">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-ng-ink/55 text-foreground/80"><Globe size={17} weight="bold" /></span>
          <span className="grid h-10 w-10 place-items-center rounded-full border border-ng-ink/55 text-foreground/80"><Bell size={17} weight="bold" /></span>
          <span className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-full border border-ng-outline bg-nm-raised text-[13px] font-semibold">{initials(j.founder)}</span>
            <span className="leading-tight"><span className="block text-[13px] font-semibold">{j.founder}</span><span className="block text-[11px] text-foreground/60">Owner</span></span>
          </span>
        </div>
      </header>
      <main className="absolute inset-x-0 bottom-0 top-[88px] px-8 pt-5">{children}</main>
      {dim > 0 && <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-[2px]" style={{ opacity: dim }} />}
    </div>
  );
}

/* The Desk's board: columns on the black, rows parted by hairlines. */
const HUE = { needs: "hsl(33 92% 56%)", flag: "hsl(92 34% 42%)", today: "hsl(210 55% 50%)", fire: "hsl(6 78% 52%)" };
function Column({ hue, title, rows, foot, first, p, at = 0.2 }) {
  return (
    <section className={`flex min-w-0 flex-col px-6 py-5 ${first ? "" : "border-l border-white/[.14]"}`}>
      <h3 className="flex items-center gap-2.5 text-base font-medium text-white/85">
        <span className="h-3 w-3 rounded-full" style={{ background: hue }} />{title}
        <span className="rounded-full bg-white/[.10] px-2 py-0.5 text-xs tabular-nums text-white/70">{rows.length}</span>
      </h3>
      <div className="mt-3 flex-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-white/[.14] py-3.5" style={rise(p, at + i * 0.04, at + 0.14 + i * 0.04)} data-mock={r.mock}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-neutral-300">{r.title}</p>
              <p className="truncate text-sm text-neutral-400">{r.meta}</p>
            </div>
            {r.amount && <span className="font-mono text-sm text-neutral-300">{r.amount}</span>}
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.10] text-white/80"><ArrowRight size={13} weight="bold" /></span>
          </div>
        ))}
      </div>
      {foot && <span className="mt-3 inline-flex h-9 w-fit items-center rounded-pill bg-[hsl(var(--ng-glass-from))] px-4 text-xs font-semibold text-slate-900">{foot}</span>}
    </section>
  );
}

function DeskPage({ j, p, said = "", reading = false, rule, plan }) {
  const decisions = [
    { title: rule?.name || "A purchase above your limit", meta: "Needs you · from your rules", mock: "row0" },
    { title: `${j.flow?.label || "Orders"}: this week`, meta: "Draft · Dex" },
    { title: short(j.routines[0] || "Weekly review", 44), meta: "Due today" },
  ];
  return (
    <>
      <div className="flex items-end justify-between gap-8" style={rise(p, 0, 0.1)}>
        <div>
          <p className="font-display text-[34px] font-light leading-tight">Good morning,</p>
          <p className="font-display text-5xl font-bold leading-tight">{j.founder}</p>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {[["Delayed", "0"], ["Complaints", "0"], ["Workflows", String(j.flows.length || 1)], ["Routines", String(j.routines.length)]].map(([k, v]) => (
            <div key={k} className="nm-tile ng-kpi-tile w-[150px] rounded-[24px] bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{k}</p>
              <p className="mt-1 font-display text-3xl font-semibold">{v}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="ng-well__pane mt-5 flex h-[64px] items-center gap-3 rounded-[1.75rem] px-6 text-[16px]" data-mock="say"
        style={said || reading ? { boxShadow: `0 0 0 2px ${GOLD}` } : undefined}>
        {said || reading ? <Microphone size={18} weight="fill" className="text-amber-500" /> : <Sparkle size={18} weight="fill" className="text-amber-500" />}
        <span className="min-w-0 flex-1 truncate">{said || <span className="text-slate-400">Type a decision…</span>}</span>
        {reading && <span className="ng-glow-text shrink-0 text-[15px] font-medium">Dex is reading…</span>}
      </div>
      <div className="ng-desk-board mt-5 grid h-[470px] grid-cols-3 overflow-hidden rounded-[2rem]" style={rise(p, 0.06, 0.2, 24)}>
        <Column first hue={HUE.needs} title="Decisions" rows={decisions} foot="Review" p={p} />
        <Column hue={HUE.flag} title="Task approvals" foot="Approvals" p={p} at={0.26}
          rows={[{ title: short(plan[1]?.task || "Packing check", 44), meta: `${plan[1]?.team || j.memberTeam} · done, needs you` }]} />
        <Column hue={HUE.today} title="Due today" p={p} at={0.3}
          rows={(j.routines.slice(0, 2).length ? j.routines.slice(0, 2) : ["Stock check"]).map((x) => ({ title: short(x, 44), meta: j.memberTeam }))} />
      </div>
    </>
  );
}

export function desktopScenes(j) {
  const base = buildScenes(j, "desktop");
  const rule = j.rule || { name: "Spending above your limit", description: "Comes to you before it happens." };
  const flow0 = j.flow || { label: "Orders", stages: [{ label: "Received", team: j.memberTeam, tasks: [] }, { label: "Done", team: j.memberTeam, tasks: [] }] };
  const plan = flow0.stages.slice(0, 3).map((s) => ({ task: s.tasks?.[0] || s.label, team: s.gate ? "You" : s.team }));
  const { w: W } = SCREEN.desktop;
  const swap = {};

  /* Desk */
  swap.desk = {
    render: (p) => <Shell j={j} active="Decision Desk" art={ART.desk}><DeskPage j={j} p={p} rule={rule} plan={plan} /></Shell>,
    camera: [{ at: 0 }, { at: 0.35 }, { at: 0.6, target: "row0", s: 1.55 }, { at: 1, target: "row0", s: 1.55 }],
    notes: [{ id: "row", target: "row0", at: [0.62, 1], side: "right",
      title: "A decision waiting for you", text: `“${short(rule.name, 40)}” came from your own rules. Open it to decide.` }],
  };

  /* Decide: the well takes the words; the review opens over the Desk. */
  swap.decide = {
    render: (p) => {
      const reviewIn = span(p, 0.52, 0.62);
      const said = typed(j.said, p, 0.1, 0.42);
      return (
        <Shell j={j} active="Decision Desk" art={ART.desk} dim={reviewIn * 0.75}>
          <DeskPage j={j} p={1} said={said} reading={p > 0.44 && p < 0.55} rule={rule} plan={plan} />
          {reviewIn > 0 && (
            <div className={`${GLASS_SHEET} absolute left-1/2 top-[70px] z-10 grid h-[690px] w-[1040px] -translate-x-1/2 grid-cols-[1fr_1.1fr] gap-6 rounded-[2rem] p-7`}
              style={{ opacity: reviewIn }}>
              <div className="flex min-w-0 flex-col gap-4">
                <div className="rounded-[1.5rem] bg-white/85 p-5 ring-1 ring-inset ring-white shadow-[0_12px_30px_-18px_hsl(0_0%_10%/0.32)]">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">The decision</p>
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600">High</span>
                  </div>
                  <p className="mt-2 text-[21px] font-semibold leading-snug">{short(j.said, 110)}</p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[["Tasks", plan.length], ["Teams", new Set(plan.map((x) => x.team)).size], ["Approvals", 1]].map(([k, v], i) => (
                    <div key={k} className={`rounded-2xl p-4 ${GLASS_PILL}`} style={rise(p, 0.6 + i * 0.03, 0.68 + i * 0.03)}>
                      <p className="font-display text-[26px] font-semibold">{v}</p><p className="text-xs text-slate-500">{k}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-[1.5rem] bg-white/70 p-5 ring-1 ring-inset ring-white">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">What you said</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-slate-700">“{j.said}”</p>
                </div>
              </div>
              <div className="flex min-w-0 flex-col">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Tasks created by Dex</p>
                <div className="mt-3 space-y-2.5" data-mock="plan">
                  {plan.map((x, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-[1.4rem] bg-white/85 px-4 py-3.5 ring-1 ring-inset ring-white shadow-[0_12px_30px_-18px_hsl(0_0%_10%/0.32)]"
                      style={rise(p, 0.64 + i * 0.05, 0.74 + i * 0.05)}>
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${INK_PILL}`}>{i + 1}</span>
                      <p className="min-w-0 flex-1 text-[15px] font-medium leading-snug">{x.task}</p>
                      <span className="shrink-0 rounded-full bg-slate-900/[0.05] px-3 py-1 text-xs font-medium text-slate-600">{short(x.team, 22)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-auto space-y-2.5">
                  <span className={`flex h-14 w-full items-center justify-center rounded-pill text-[16px] font-semibold ${INK_PILL} ${p > 0.86 ? "scale-[0.98]" : ""}`}>Approve</span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <span className={`flex h-12 items-center justify-center rounded-pill text-[15px] font-medium ${GLASS_PILL}`}>Save as draft</span>
                    <span className={`flex h-12 items-center justify-center rounded-pill text-[15px] font-medium ${GLASS_PILL}`}>Reject</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          <Tick k={span(p, 0.9, 1)} text="Approved — tasks sent to your teams" />
        </Shell>
      );
    },
    camera: [{ at: 0 }, { at: 0.1, target: "say", s: 1.7 }, { at: 0.46, target: "say", s: 1.7 }, { at: 0.58 }, { at: 0.68 }, { at: 0.76, target: "plan", s: 1.25 }, { at: 0.88, target: "plan", s: 1.25 }, { at: 0.94 }, { at: 1 }],
    notes: [
      { id: "say", target: "say", at: [0.14, 0.46], side: "bottom", title: "Speak or type it", text: "In your own words, any language." },
      { id: "plan", target: "plan", at: [0.78, 0.9], side: "left", title: "Dex drafts the work", text: "Each task goes to the team that owns that step." },
    ],
  };

  /* One Ops board per workflow: the order card walks the lanes. */
  j.flows.slice(0, 3).forEach((f, fi) => {
    const st = f.stages.slice(0, 6);
    const n = st.length;
    const laneW = Math.min(300, Math.floor((W - 64 - 32 - (n - 1) * 16) / n));
    swap[`flow-${fi}`] = {
      render: (p) => {
        const k = Math.min(n - 1, Math.floor(span(p, 0.12, 0.92, (x) => x) * n));
        const local = span(p, 0.12 + (k / n) * 0.8, 0.18 + (k / n) * 0.8);
        return (
          <Shell j={j} active="Ops" art={ART.ops}>
            <h1 className="font-display text-4xl">Ops</h1>
            <div className="mt-4 flex gap-2">
              {j.flows.slice(0, 5).map((x) => (
                <span key={x.key} className={`flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-medium ${x.key === f.key ? "ng-pressed" : "ng-pop"}`}>
                  {x.label}<span className="font-mono text-xs opacity-60">{x.stages.length}</span>
                </span>
              ))}
            </div>
            <div className="ng-glass-well mt-5 flex gap-4 rounded-[2rem] p-4">
              {st.map((s, i) => (
                <div key={s.key || i} className="ng-frost ng-lane flex h-[560px] shrink-0 flex-col rounded-[1.6rem] p-3" style={{ width: laneW }} data-mock={`stage-${i}`}>
                  <div className="flex items-center justify-between gap-2 px-1 pb-2">
                    <p className="truncate text-[13px] font-semibold">{s.label}</p>
                    {s.gate && <ShieldCheck size={15} weight="fill" className="shrink-0 text-amber-500" />}
                  </div>
                  <span className="mx-1 mb-3 w-fit rounded-full bg-white/70 px-2.5 py-1 text-[11px] text-slate-600">{s.gate ? "You" : short(s.team, 24)}</span>
                  {i === k && (
                    <div className="ng-bento p-3" style={{ opacity: local, transform: `translateY(${(1 - local) * 12}px)` }}>
                      <p className="text-sm font-semibold">Order #1042</p>
                      <span className="mt-1 inline-block rounded-full bg-slate-900/[0.05] px-2 py-0.5 text-[10.5px] font-medium text-slate-600">{s.gate ? "Waiting for you" : short(s.team, 22)}</span>
                      <p className="mt-2 flex items-center gap-1 font-mono text-[11px] text-slate-500"><Clock size={11} /> due in 2 days</p>
                      <div className="mt-2 space-y-1.5">
                        {(s.tasks.length ? s.tasks : ["Work in this step"]).slice(0, 3).map((x, ti) => (
                          <p key={ti} className="rounded-lg bg-nm-sunken px-2.5 py-1.5 text-[11.5px] leading-snug text-slate-700">{short(x, 70)}</p>
                        ))}
                      </div>
                      {i < n - 1 && <span className="ng-pop mt-3 flex h-10 items-center justify-center rounded-pill text-xs font-medium">Advance to {short(st[i + 1].label, 18)}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Shell>
        );
      },
      camera: (() => {
        const keys = [{ at: 0 }, { at: 0.1, target: "stage-0", s: 1.35 }];
        for (let i = 1; i < n; i++) {
          const at = 0.12 + (i / n) * 0.8;
          keys.push({ at: at - 0.02, target: `stage-${i - 1}`, s: 1.35 });
          keys.push({ at: at + 0.05, target: `stage-${i}`, s: 1.35 });
        }
        keys.push({ at: 0.97 }, { at: 1 });
        return keys;
      })(),
      notes: st.map((s, i) => {
        const a = 0.14 + (i / n) * 0.8;
        return { id: `st-${i}`, target: `stage-${i}`, at: [a, a + 0.8 / n - 0.05], side: i >= n - 2 ? "left" : "right",
          title: s.gate ? "It waits for you" : `${short(s.team, 24)} takes it`,
          text: s.gate ? "This step needs your sign-off before work moves on." : short(s.label, 40) };
      }).concat(fi === Math.min(3, j.flows.length) - 1 && j.flows.length > 3 ? [{ id: "more", target: `stage-${n - 1}`, at: [0.93, 1], side: "left",
        title: `And ${j.flows.length - 3} more ${j.flows.length - 3 === 1 ? "workflow" : "workflows"}`, text: "Every one is laid out in the summary." }] : []),
    };
  });

  /* My Work: the deck card in the High column. */
  const workHead = (title, eyebrow) => (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>
      <h1 className="font-display text-4xl">{title}</h1>
      <div className="mt-4 flex gap-2">
        {["Department: All", "Status: All open"].map((x) => <span key={x} className={`flex h-10 items-center rounded-pill px-4 text-sm ${GLASS_PILL}`}>{x}</span>)}
      </div>
    </>
  );
  swap.mywork = {
    render: (p) => {
      const done = p > 0.86;
      return (
        <Shell j={j} active="My Work" art={ART.work}>
          {workHead("My Work", "Your day, simplified")}
          <div className="mt-5 grid grid-cols-3 gap-5">
            {["High", "Medium", "Low"].map((b, bi) => (
              <section key={b}>
                <p className="mb-3 text-sm font-semibold">{b} <span className="font-mono text-xs opacity-55">{bi === 0 ? 1 : 0}</span></p>
                {bi === 0
                  ? <div style={rise(p, 0.02, 0.14, 20)}><TaskDeckCard j={j} p={p} w="100%" done={done} /></div>
                  : <div className="rounded-[24px] border border-dashed border-foreground/15 p-5 text-center text-xs text-muted-foreground">Nothing here</div>}
              </section>
            ))}
          </div>
          <Tick k={span(p, 0.88, 1)} text="Done — the next team is told" />
        </Shell>
      );
    },
    camera: [{ at: 0 }, { at: 0.2 }, { at: 0.32, target: "steps", s: 1.6 }, { at: 0.56, target: "steps", s: 1.6 }, { at: 0.64, target: "next", s: 1.6 }, { at: 0.8, target: "next", s: 1.6 }, { at: 0.87 }, { at: 1 }],
    notes: [
      { id: "steps", target: "steps", at: [0.34, 0.6], side: "right", title: "A checklist Dex drafted", text: "Each number is a step. Tap one to read it." },
      { id: "next", target: "next", at: [0.64, 0.84], side: "right", title: "Only the next step", text: "Nobody has to ask what to do now." },
    ],
  };

  /* Sign-off: the drawer's approval card, on Approvals. */
  swap.signoff = {
    render: (p) => (
      <Shell j={j} active="My Work" art={ART.work}>
        <div className="flex items-end justify-between">
          <h1 className="font-display text-4xl">Approvals</h1>
          <div className={`flex rounded-pill p-1 ${DRAWER_TRACK}`}>
            <span className="rounded-pill bg-white px-4 py-1.5 text-sm font-semibold shadow-sm">All</span>
            <span className="px-4 py-1.5 text-sm text-slate-500">Mine</span>
          </div>
        </div>
        <div className={`mt-4 flex w-fit gap-1 rounded-pill p-1 ${DRAWER_TRACK}`}>
          {[["Tasks", j.rules.length], ["Leave", 0], ["Requests", 0]].map(([k, v], i) => (
            <span key={k} className={`rounded-pill px-4 py-1.5 text-sm ${i === 0 ? "bg-white font-semibold shadow-sm" : "text-slate-500"}`}>{k} <span className="font-mono text-xs opacity-60">{v}</span></span>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-5">
          {j.rules.slice(0, 2).map((r, i) => (
            <div key={i} className={`${DRAWER_CARD} p-5`} style={rise(p, 0.05 + i * 0.06, 0.2 + i * 0.06, 20)} data-mock={i === 0 ? "rule" : undefined}>
              <p className={DRAWER_LABEL}>Needs your approval</p>
              <p className="text-[19px] font-semibold leading-snug">{r.name}</p>
              {r.description && <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">{short(r.description, 160)}</p>}
              <div className="mt-4 flex gap-2">
                <span className={`flex h-11 flex-1 items-center justify-center rounded-pill text-[15px] font-medium ${INK_PILL} ${i === 0 && p > 0.62 ? "scale-[0.97]" : ""}`}>Approve</span>
                <span className={`flex h-11 items-center rounded-pill px-5 text-[15px] font-medium ${GLASS_PILL}`}>Reject</span>
                <span className={`flex h-11 items-center rounded-pill px-5 text-[15px] font-medium ${GLASS_PILL}`}>Ask clarification</span>
              </div>
            </div>
          ))}
        </div>
        <Tick k={span(p, 0.66, 0.8)} text="Approved — work moves on" />
      </Shell>
    ),
    camera: [{ at: 0 }, { at: 0.25, target: "rule", s: 1.35 }, { at: 0.62, target: "rule", s: 1.35 }, { at: 0.7 }, { at: 1 }],
    notes: [{ id: "rule", target: "rule", at: [0.28, 0.62], side: "right", title: "One of your rules", text: "You set these in the interview. Change them any time." }],
  };

  /* Routines: recurring cards, arriving on their own. */
  swap.routines = {
    render: (p) => (
      <Shell j={j} active="My Work" art={ART.work}>
        {workHead("My Work", "Recurring")}
        <div className="mt-5 grid grid-cols-3 gap-5" data-mock="routines">
          {j.routines.slice(0, 6).map((r, i) => (
            <div key={i} className="rounded-[1.75rem] bg-[linear-gradient(180deg,#fff,hsl(220_14%_97%))] p-5 shadow-[0_18px_40px_-26px_hsl(220_30%_20%/0.5)] ring-1 ring-inset ring-slate-900/[0.05]"
              style={rise(p, 0.1 + i * 0.08, 0.22 + i * 0.08, 16)}>
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-sky-50 px-3 py-1.5 text-[13px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">To do</span>
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-medium text-amber-800"><ArrowsClockwise size={12} weight="bold" /> Repeats</span>
              </div>
              <p className="mt-3 text-[19px] font-bold leading-snug">{short(r, 70)}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[13px] text-slate-500"><CalendarBlank size={13} /> Comes back when it is done</p>
            </div>
          ))}
        </div>
      </Shell>
    ),
    camera: [{ at: 0 }, { at: 1 }],
    notes: [{ id: "rt", target: "routines", at: [0.62, 1], side: "bottom", title: "Nobody has to remember", text: "Dex hands these out on schedule." }],
  };

  /* Ask Dex: the conversation, over the Desk. */
  const f0 = j.flows[0];
  const askQ = f0 ? `Who does what in ${f0.label}?` : "Who does what when an order comes in?";
  const askA = f0
    ? f0.stages.slice(0, 4).map((x, i) => `${i === 0 ? "First" : "Then"} ${x.gate ? "you sign off" : x.team} — ${x.label.toLowerCase()}`).join(". ") + "."
    : `${j.memberTeam} picks it up, and anything over your limit comes to you.`;
  swap.ask = {
    render: (p) => {
      const q = typed(askQ, p, 0.08, 0.3);
      const a = typed(askA, p, 0.42, 0.85);
      return (
        <Shell j={j} active="Dex" art={ART.desk} dim={0.4}>
          <DeskPage j={j} p={1} rule={rule} plan={plan} />
          <div className="ng-dock-chat absolute right-8 top-[20px] z-10 flex h-[720px] w-[560px] flex-col rounded-[2rem] p-5 text-white">
            <div className="flex items-center gap-3 border-b border-white/10 pb-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><Sparkle size={16} weight="fill" className="text-amber-300" /></span>
              <div><p className="text-[15px] font-semibold">Ask Dex</p><p className="text-[12px] text-white/55">Knows {j.company}</p></div>
            </div>
            <div className="mt-4 flex-1 space-y-3 overflow-hidden">
              {q && <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-white px-4 py-3 text-[15px] text-slate-900">{q}</div>}
              {p > 0.32 && p < 0.44 && <p className="animate-pulse text-[15px] font-medium text-white/80">Dex is thinking…</p>}
              {a && (
                <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-white/[0.08] px-4 py-3.5 text-[15px] leading-relaxed text-white/90" data-mock="ask-a">
                  {a}
                  {p > 0.86 && f0 && <span className="mt-2 flex w-fit items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[12px] text-white/70"><Kanban size={12} weight="bold" /> From: {f0.label}</span>}
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-3 text-[14px] text-white/45">
              <ChatCircleDots size={16} weight="bold" /> Ask about orders, people, money… <PaperPlaneRight size={15} weight="bold" className="ml-auto" />
            </div>
          </div>
        </Shell>
      );
    },
    camera: [{ at: 0 }, { at: 1 }],
    notes: [{ id: "a", target: "ask-a", at: [0.86, 1], side: "left", title: "Answers from your own data", text: "Your workflows, tasks, people and decisions — it knows them all." }],
  };

  /* Everything else: the rest of the app, by the names on its nav. */
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
  swap.addons = {
    render: (p) => (
      <Shell j={j} active="Decision Desk" art={ART.desk}>
        <h1 className="font-display text-4xl">Everything in {j.company}</h1>
        <div className="mt-6 grid grid-cols-3 gap-5">
          {ADDONS.map((m, i) => {
            const Icon = m.icon;
            return (
              <div key={m.name} className="nm-tile ng-kpi-tile flex items-start gap-4 rounded-[24px] bg-white p-5" style={rise(p, 0.04 + i * 0.05, 0.16 + i * 0.05, 16)} data-mock={`addon-${i}`}>
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${INK_PILL}`}><Icon size={22} weight="duotone" /></span>
                <span className="min-w-0"><span className="block text-[18px] font-semibold">{m.name}</span><span className="mt-0.5 block text-[14px] leading-snug text-slate-500">{m.line}</span></span>
              </div>
            );
          })}
        </div>
      </Shell>
    ),
    camera: [{ at: 0 }, { at: 1 }],
    notes: [
      { id: "fin", target: "addon-0", at: [0.6, 0.73], side: "right", title: "Finance", text: "Invoices and payments sit beside the work that earns them." },
      { id: "brain", target: "addon-4", at: [0.74, 0.87], side: "bottom", title: "Company Brain", text: "Ask it anything — it answers from your company." },
      { id: "jr", target: "addon-5", at: [0.88, 1], side: "left", title: "Journal", text: "Every decision you make, kept with its reason." },
    ],
  };

  return base.map((sc) => (swap[sc.key] ? { ...sc, ...swap[sc.key] } : sc));
}

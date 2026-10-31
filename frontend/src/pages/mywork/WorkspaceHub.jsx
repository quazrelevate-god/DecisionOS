/* THE WORKSPACE (2026-10-30, founder, from a client's ask) — desktop My Work,
 * renamed Workspace and rebuilt round the person reading it.
 *
 *   1. The FILTER PANEL (2026-10-31, founder's reference image): one glass
 *      panel with a soft glow under it, holding two rows split by a hairline.
 *      Top, the STATUS FENCE: every status the list can be narrowed by — All
 *      Open, To Do, Doing, Waiting, Needs Approval, Overdue, Due Today, No Due
 *      Date, Repeating, Done — one tile each, each in its own colour: a white
 *      top fading to that colour at the foot; the name along the top, and
 *      under it the icon and the count in one row, the icon as tall as the
 *      figures. The tile in force is the dark navy one. Bottom, the VIEWS: All Tasks, My Tasks, Asked by me,
 *      My Requests, Approvals as glass pills with icons; the one in use is ink.
 *      (This replaced the work tree — the reader's face with the views hanging
 *      off it on branches — the same day.)
 *   2. The TEAM BOARD: the owner's All Tasks opens on one horizontal card per
 *      person, ranked, before any task. Clicking a person opens their task
 *      cards. The Department filter lives here, as a segment bar, because a
 *      department only narrows the team's work.
 *
 * WHAT A PERSON'S CARD COUNTS, AND WHY (the client's reference counted Total,
 * Completed, In progress and Pending, which overlap, and its bar did not
 * follow from them):
 *   Open      — what they are holding now; the line under it says how many of
 *               those wait on someone else, which is not their delay.
 *   Overdue   — open work past its date: the number an owner acts on.
 *   Done      — finished in the last 30 days: delivery, not a lifetime total.
 *   On time   — of those, the share finished by the due date (dated ones only).
 *   The badge reads the same numbers in a word — Behind (anything overdue),
 *   On track (holding work, none late), Free (nothing open) — and the bar is
 *   how much of everything they have been given is finished. Under the name:
 *   when work last reached them and when they last finished something.
 * Counted from the list the page already holds (open tasks plus the most
 * recent 500 finished ones): no request of its own, and the numbers can never
 * disagree with the cards they open onto.
 */
import { useMemo } from "react";
import {
  ArrowBendUpRight, CalendarDots, CaretLeft, CaretRight, CheckCircle, CheckSquare, Clock, FileText, MinusSquare,
  PlayCircle, Repeat, Stack, Stamp, User, UsersThree, Warning,
} from "@phosphor-icons/react";
import { PersonAvatar } from "../../components/neuglass/PersonAvatar";
import { DRAWER_TRACK, GLASS_PILL, INK_PILL, INK_PLATE } from "../../components/neuglass/glass";
import { roleLabel } from "../../lib/departments";

const CARD = "rounded-[1.5rem] bg-[linear-gradient(180deg,#fff,hsl(220_14%_97%))] ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_18px_40px_-26px_hsl(220_30%_20%/0.5)]";
const DAY = 86400000;

/* ── 1 · The filter panel ─────────────────────────────────────────────── */
/* Each tile's colour, read off the founder's reference and then dialled down
   (2026-10-31, founder: "no need to make a saturated color in our entire UI"):
   `foot` is where its white fades to at the bottom edge, `glow` the softer
   wash in its lower corner, `ink` the icon, `k` how much of its box the
   icon's glyph fills top to bottom (measured), so every icon can be drawn
   exactly as tall as the count's figures. Labels as the reference writes
   them. The tile in force wears the reference's first tile, the navy. */
export const FENCE = {
  "":          { label: "All Open",       Icon: Stack,        k: 0.873, ink: "215 18% 32%", foot: "222 16% 94%", glow: "222 20% 90%" },
  todo:        { label: "To Do",          Icon: CheckSquare,  k: 0.75,  ink: "210 52% 52%", foot: "212 40% 95%", glow: "210 52% 90%" },
  in_progress: { label: "Doing",          Icon: PlayCircle,   k: 0.81,  ink: "207 58% 48%", foot: "214 44% 94.5%", glow: "208 56% 89%" },
  waiting:     { label: "Waiting",        Icon: Clock,        k: 0.81,  ink: "39 56% 50%",  foot: "220 20% 96%", glow: "42 55% 91%" },
  approval:    { label: "Needs Approval", Icon: User,         k: 0.78,  ink: "254 42% 62%", foot: "250 38% 95%", glow: "254 52% 92%" },
  overdue:     { label: "Overdue",        Icon: Warning,      k: 0.78,  ink: "13 56% 50%",  foot: "13 52% 93.5%", glow: "14 60% 89%" },
  due_today:   { label: "Due Today",      Icon: CalendarDots, k: 0.81,  ink: "216 16% 46%", foot: "212 34% 95%", glow: "214 40% 90%" },
  no_date:     { label: "No Due Date",    Icon: MinusSquare,  k: 0.75,  ink: "220 7% 46%",  foot: "222 16% 95%", glow: "222 14% 90%" },
  repeating:   { label: "Repeating",      Icon: Repeat,       k: 0.75,  ink: "169 46% 38%", foot: "176 30% 93.5%", glow: "170 38% 87%" },
  completed:   { label: "Done",           Icon: CheckCircle,  k: 0.81,  ink: "153 44% 39%", foot: "158 36% 93.5%", glow: "152 42% 87%" },
};
export const NAVY = "bg-[linear-gradient(180deg,hsl(218_15%_28%),hsl(220_28%_14%))] text-white ring-1 ring-inset ring-white/[0.08] shadow-[0_18px_32px_-18px_hsl(222_40%_10%/0.8),inset_0_1px_0_hsl(0_0%_100%/0.12)]";
export const RED = "hsl(13 56% 48%)";
export const TILE_REST = "ring-1 ring-inset ring-white/90 shadow-[0_10px_22px_-16px_hsl(220_25%_25%/0.42),0_1px_2px_hsl(220_25%_30%/0.05)]";
// White at the top, the tile's own colour at the foot, a softer wash in its lower corner.
export const tileWash = (f) => ({
  backgroundImage: `radial-gradient(120% 80% at 100% 118%, hsl(${f.glow} / 0.7), transparent 62%), linear-gradient(180deg, #fff 8%, hsl(${f.foot}) 100%)`,
});

/* `capped` — the list holds at most that many of a kind (the server sends the
   500 newest finished tasks), so a count that reaches it reads "500+".

   2026-10-31 (founder) — ONE GRID FOR THE EYE. The name runs along the top,
   flush left; under it, in one row, the icon and then the count. The icon is
   as tall as the count's figures and centred on them, not on the tile.
   Measured in the browser: Urbanist's figures ink 0.715 of the type size
   (18.6px at 26), and in a line box one em tall their middle sits 0.03em
   above the box's middle — so each icon is drawn at CAP / k of the type size
   and lifted by that 0.03em. (CSS text-box trimming would do it for the
   count, but not in every browser the desktop runs in, and a layout that
   differs by browser is the opposite of standard.) */
const FIGURE = 26;   // px, the count
const CAP = 0.715;   // Urbanist figure height, in ems
const LIFT = 0.03;   // ems the figures' middle sits above their box's middle
export function StatusFence({ options, value, counts, onPick, loading, dim = false, capped = {} }) {
  return (
    /* Five to a row until there is room for all ten side by side; side by
       side, each tile is as wide as its name needs and they share the rest. */
    <div role="group" aria-label="Status" data-testid="workspace-status"
      className={`grid grid-cols-5 gap-2 min-[1400px]:flex ${dim ? "opacity-70" : ""}`}>
      {options.map((o) => {
        const on = !dim && value === o.key;
        const n = counts(o.key);
        const f = FENCE[o.key] || FENCE[""];
        const late = o.key === "overdue";
        return (
          <button key={o.key || "all"} type="button" aria-pressed={on} data-testid={`workspace-status-${o.key || "all"}`}
            // The lit tile again means "no filter": tapping it lets go.
            onClick={() => onPick(on && o.key ? "" : o.key)}
            style={on ? undefined : tileWash(f)}
            className={`flex min-h-[80px] min-w-0 flex-col items-start justify-between gap-2.5 rounded-[1.15rem] px-3.5 pb-3.5 pt-3 text-left transition-[box-shadow,transform] duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 min-[1400px]:flex-auto ${
              on ? NAVY : TILE_REST}`}>
            <span className="w-full truncate whitespace-nowrap text-[13px] font-semibold leading-tight"
              style={{ color: on ? "hsl(0 0% 100% / 0.9)" : late ? RED : "hsl(230 30% 14%)" }}>
              {f.label}
            </span>
            <span className="flex items-center gap-2" data-testid={`workspace-status-${o.key || "all"}-row`}>
              <f.Icon size={Math.round((FIGURE * CAP) / f.k * 2) / 2} weight="duotone" aria-hidden="true" className="shrink-0"
                style={{ transform: `translateY(${-LIFT * FIGURE}px)` }}
                color={on ? "#fff" : `hsl(${f.ink})`} />
              <span className="font-display font-bold leading-none tabular-nums"
                style={{ fontSize: FIGURE, color: on ? "#fff" : late && n > 0 ? RED : "hsl(230 40% 8%)" }}>
                {loading ? "–" : capped[o.key] && n >= capped[o.key] ? `${capped[o.key]}+` : n}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* The views, as pills under the fence. `views`: [{key, label, testid, active,
   onClick, count}] — the one in use is the black ink pill. */
const VIEW_ICON = { all: Stack, mine: User, asked: ArrowBendUpRight, team: UsersThree, requests: FileText, approvals: Stamp };
export function WorkViews({ views }) {
  return (
    <nav aria-label="Workspace" data-testid="workspace-views" className="flex flex-wrap items-center justify-center gap-3 xl:gap-5">
      {views.map((v) => { const Icon = VIEW_ICON[v.key]; return (
        <button key={v.key} type="button" onClick={v.onClick} aria-pressed={v.active} data-testid={v.testid}
          className={`flex h-12 min-w-[12.5rem] items-center justify-center gap-2.5 rounded-pill px-8 text-[15px] font-medium transition-[box-shadow,transform] duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
            v.active ? `${INK_PILL} font-semibold`
              : "bg-[linear-gradient(180deg,#fff,hsl(220_22%_97%))] text-[#0b1020] ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_10px_20px_-14px_hsl(220_30%_25%/0.45),inset_0_1px_0_#fff]"}`}>
          {Icon && <Icon size={20} weight={v.active ? "bold" : "regular"} aria-hidden="true" className={v.active ? "text-white" : "text-slate-800"} />}
          <span className="truncate">{v.label}</span>
          {v.count > 0 && (
            <span data-testid={`${v.testid}-count`}
              className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12px] font-semibold tabular-nums leading-none ${
                v.active ? "bg-white text-neutral-900" : "bg-neutral-950 text-white"}`}>
              {v.count}
            </span>
          )}
        </button>
      ); })}
    </nav>
  );
}

/* The two rows in one glass panel, a hairline between them and a soft glow
   under the panel's foot. */
export function FilterPanel({ fence, views }) {
  return (
    <div className="relative" data-testid="workspace-filters">
      <span aria-hidden="true"
        className="pointer-events-none absolute inset-x-[6%] -bottom-4 h-14 rounded-[50%] bg-[hsl(222_45%_70%/0.28)] blur-2xl" />
      <div className="relative rounded-[2rem] bg-[linear-gradient(180deg,hsl(0_0%_100%/0.82),hsl(220_25%_97%/0.72))] p-4 ring-1 ring-inset ring-white/90 shadow-[0_30px_60px_-38px_hsl(222_40%_25%/0.5),0_2px_6px_-2px_hsl(222_30%_30%/0.07),inset_0_1px_0_hsl(0_0%_100%/0.95)] backdrop-blur-xl xl:p-5">
        {fence}
        <div aria-hidden="true" className="mx-1 my-4 h-px bg-slate-900/[0.07] shadow-[0_1px_0_hsl(0_0%_100%/0.85)] xl:my-5" />
        {views}
      </div>
    </div>
  );
}

/* ── Segment bar (Department, Rank by) ────────────────────────────────── */
export function Segments({ options, value, onPick, label, testid, counts }) {
  return (
    <div role="group" aria-label={label} data-testid={testid}
      className={`inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-pill p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${DRAWER_TRACK}`}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" aria-pressed={on} onClick={() => onPick(o.key)} data-testid={`${testid}-${o.key}`}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 ${
              on ? `${GLASS_PILL} font-semibold text-neutral-900` : "font-medium text-neutral-600 hover:text-neutral-900"}`}>
            {o.label}
            {counts && <span className={`tabular-nums text-[11px] ${on ? "text-neutral-500" : "text-neutral-400"}`}>{counts(o.key)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── 3 · The team board ───────────────────────────────────────────────── */
const holds = (t, id) => t.assignee_id === id || (t.co_assignee_ids || []).includes(id);
const stamp = (iso) => { const v = new Date(iso || "").getTime(); return Number.isNaN(v) ? 0 : v; };
// A date with no time is due for the whole of that day (as isOverdue reads it).
const deadline = (due) => {
  if (!due) return null;
  const s = String(due);
  const v = new Date(s.length <= 10 ? `${s}T23:59:59` : s).getTime();
  return Number.isNaN(v) ? null : v;
};

/* "Today, 10:30 AM" · "Yesterday, 4:15 PM" · "Mon, 4:15 PM" · "12 Oct". */
export function whenWords(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / DAY);
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase();
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString("en-IN", { weekday: "short" })}, ${time}`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(days > 300 ? { year: "numeric" } : {}) });
}

/* One person's numbers from the tasks they are on (lead or co-assignee). */
export function personStats(id, tasks, fx) {
  const mine = tasks.filter((t) => holds(t, id));
  const open = mine.filter((t) => !fx.isTerminal(t));
  const done = mine.filter((t) => t.status === "done");
  const since = Date.now() - 30 * DAY;
  const recent = done.filter((t) => stamp(t.completed_at) >= since);
  const dated = recent.filter((t) => deadline(t.due_date) !== null);
  const onTime = dated.filter((t) => stamp(t.completed_at) <= deadline(t.due_date)).length;
  const overdue = open.filter(fx.isOverdue).length;
  const waiting = open.filter((t) => fx.statusMatches(t, "waiting") || fx.statusMatches(t, "approval")).length;
  return {
    open: open.length, overdue, waiting, done30: recent.length,
    onTimePct: dated.length ? Math.round((onTime / dated.length) * 100) : null,
    finishedPct: done.length + open.length ? Math.round((done.length / (done.length + open.length)) * 100) : 0,
    finished: done.length, given: done.length + open.length,
    lastAssigned: Math.max(0, ...mine.map((t) => stamp(t.assigned_at || t.created_at))),
    lastDone: Math.max(0, ...done.map((t) => stamp(t.completed_at))),
  };
}

const HEALTH = {
  behind: { label: "Behind", cls: "bg-ng-accent/10 text-ng-accent ring-ng-accent/20" },
  track: { label: "On track", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/15" },
  free: { label: "Free", cls: "bg-slate-100 text-slate-600 ring-slate-900/[0.06]" },
};
const healthOf = (s) => (s.overdue > 0 ? "behind" : s.open > 0 ? "track" : "free");

export const RANKS = [
  { key: "delivered", label: "Delivered" },
  { key: "ontime", label: "On time" },
  { key: "overdue", label: "Overdue" },
];
const RANK_SORT = {
  delivered: (a, b) => b.s.done30 - a.s.done30 || (b.s.onTimePct ?? -1) - (a.s.onTimePct ?? -1) || a.s.overdue - b.s.overdue,
  ontime: (a, b) => (b.s.onTimePct ?? -1) - (a.s.onTimePct ?? -1) || b.s.done30 - a.s.done30,
  overdue: (a, b) => b.s.overdue - a.s.overdue || b.s.open - a.s.open,
};

function Stat({ label, value, sub, tone = "", testid }) {
  return (
    <div data-testid={testid} className={`flex min-w-0 flex-col justify-center gap-1 rounded-2xl px-3.5 py-2.5 ${DRAWER_TRACK}`}>
      <span className={`font-display text-[22px] font-semibold leading-none tabular-nums ${tone || "text-slate-900"}`}>{value}</span>
      <span className="truncate text-[11px] font-medium text-slate-500">{label}</span>
      {sub !== undefined && <span className="truncate text-[11px] text-slate-400">{sub}</span>}
    </div>
  );
}

export function TeamBoard({ tasks, members, me, roleOptions, fx, onPick, deptBar, rank, onRank, loose = [], onLoose }) {
  const rows = useMemo(() => {
    const people = members.filter((m) => m.id && m.id !== me?.id);
    return people
      .map((m) => ({ m, s: personStats(m.id, tasks, fx) }))
      // On a department, the people with work in it; on All, everyone.
      .filter((r) => !deptBar.narrowed || r.s.given > 0)
      .sort((a, b) => RANK_SORT[rank](a, b) || a.m.name.localeCompare(b.m.name));
  }, [members, me, tasks, fx, deptBar.narrowed, rank]);
  // Counted once per TASK: summing the rows would count a task shared by
  // eighteen people eighteen times.
  const open = tasks.filter((t) => !fx.isTerminal(t)).length;
  const late = tasks.filter((t) => !fx.isTerminal(t) && fx.isOverdue(t)).length;

  return (
    <section data-testid="team-board" aria-labelledby="team-board-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="team-board-title" className="font-display text-[22px] leading-none text-slate-900">Team</h2>
          <p className="mt-1.5 text-[13px] text-slate-500" data-testid="team-board-summary">
            {rows.length} {rows.length === 1 ? "person" : "people"} · {open} open {open === 1 ? "task" : "tasks"}
            {late > 0 && <> · <span className="font-semibold text-ng-accent">{late} overdue</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-slate-500">Rank by</span>
          <Segments options={RANKS} value={rank} onPick={onRank} label="Rank by" testid="team-rank" />
        </div>
      </div>
      {deptBar.node}

      {rows.length === 0 ? (
        <div className={`p-6 text-sm text-slate-600 ${CARD}`} data-testid="team-board-empty">
          {deptBar.narrowed ? "Nobody holds work in this department." : "Nobody else is on the team yet — add people on Team."}
        </div>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="team-board-rows">
          {rows.map(({ m, s }, i) => {
            const h = HEALTH[healthOf(s)];
            const podium = i < 3 && (rank === "overdue" ? s.overdue > 0 : rank === "ontime" ? s.onTimePct !== null : s.done30 > 0);
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onPick(m.id)} data-testid={`team-row-${m.id}`}
                  aria-label={`${m.name}: ${s.open} open, ${s.overdue} overdue, ${s.done30} done in 30 days. Open their tasks.`}
                  className={`group grid w-full grid-cols-[auto_auto_minmax(0,1.15fr)_minmax(0,2.3fr)_minmax(0,1.2fr)_auto] items-center gap-4 p-4 text-left transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-[0_24px_48px_-24px_hsl(220_30%_20%/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${CARD}`}>
                  <span aria-hidden="true"
                    className={`grid h-11 w-11 place-items-center rounded-2xl font-display text-[18px] font-semibold tabular-nums ${
                      podium ? `${INK_PLATE} text-amber-300` : "bg-slate-100 text-slate-500"}`}>
                    {i + 1}
                  </span>
                  <PersonAvatar name={m.name} src={m.avatar_url} size={56} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[17px] font-semibold text-slate-900">{m.name}</span>
                    <span className="truncate text-[12px] text-slate-500">{m.role ? roleLabel(m.role, roleOptions) : "Member"}</span>
                    <span className="mt-1 truncate text-[11px] text-slate-400" data-testid={`team-row-when-${m.id}`}>
                      {s.lastAssigned ? `Last assigned ${whenWords(s.lastAssigned)}` : "Nothing assigned yet"}
                      {s.lastDone ? ` · finished ${whenWords(s.lastDone)}` : ""}
                    </span>
                  </span>
                  <span className="grid min-w-0 grid-cols-4 gap-2">
                    <Stat label="Open" value={s.open} sub={s.waiting ? `${s.waiting} waiting` : "none waiting"} testid={`team-open-${m.id}`} />
                    <Stat label="Overdue" value={s.overdue} tone={s.overdue ? "text-ng-accent" : "text-slate-400"} sub={s.overdue ? "past their date" : "nothing late"} testid={`team-overdue-${m.id}`} />
                    <Stat label="Done · 30 days" value={s.done30} tone={s.done30 ? "" : "text-slate-400"} sub={s.finished ? `${s.finished} all time` : "none yet"} testid={`team-done-${m.id}`} />
                    <Stat label="On time" value={s.onTimePct === null ? "–" : `${s.onTimePct}%`} tone={s.onTimePct === null ? "text-slate-400" : s.onTimePct >= 80 ? "text-emerald-700" : s.onTimePct >= 50 ? "" : "text-ng-accent"}
                      sub={s.onTimePct === null ? "no dated work done" : "of dated work"} testid={`team-ontime-${m.id}`} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-2.5">
                    <span className={`inline-flex w-fit items-center rounded-pill px-3 py-1 text-[12px] font-semibold ring-1 ring-inset ${h.cls}`}
                      data-testid={`team-health-${m.id}`}>{h.label}</span>
                    <span className="flex items-center gap-2.5">
                      <span role="progressbar" aria-label={`${s.finished} of ${s.given} finished`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.finishedPct}
                        className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-900/[0.08]">
                        <span className="block h-full rounded-full bg-neutral-900 transition-[width] duration-500 ease-out" style={{ width: `${s.finishedPct}%` }} />
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-slate-700">{s.finishedPct}%</span>
                    </span>
                    <span className="text-[11px] text-slate-400">{s.finished} of {s.given} finished</span>
                  </span>
                  <CaretRight size={18} weight="bold" aria-hidden="true" className="text-slate-400 transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {loose.length > 0 && (
        /* Work that sits with a team or with nobody is the team's too; it has
           no face to put on a card, so it gets a line and a way in. */
        <div className="flex flex-wrap items-center gap-2 px-1" data-testid="team-board-loose">
          <span className="text-[12px] text-slate-500">Not on a person:</span>
          {loose.map((l) => (
            <button key={l.key} type="button" onClick={() => onLoose(l.key)} data-testid={`team-loose-${l.key}`}
              className={`flex h-8 items-center gap-1.5 rounded-pill px-3 text-[12px] font-medium text-slate-700 hover:text-slate-900 ${GLASS_PILL}`}>
              {l.label} <span className="tabular-nums text-slate-400">{l.n}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* The head of one person's task list, reached from the board. */
/* `person` and `stats` are absent when the board was left by a status tile
   rather than a person: then it is only the way back. */
export function PersonBar({ person, stats, roleOptions, onBack, backLabel = "Team" }) {
  const h = stats ? HEALTH[healthOf(stats)] : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3" data-testid="workspace-person">
      <button type="button" onClick={onBack} data-testid="workspace-back"
        className={`flex h-10 items-center gap-1.5 rounded-pill pl-3 pr-4 text-[13px] font-semibold text-slate-800 hover:text-slate-950 ${GLASS_PILL}`}>
        <CaretLeft size={14} weight="bold" aria-hidden="true" /> {backLabel}
      </button>
      {person && (
        <>
          <PersonAvatar name={person.name} src={person.avatar_url} size={40} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[16px] font-semibold text-slate-900">{person.name}</span>
            <span className="truncate text-[12px] text-slate-500">
              {person.role ? roleLabel(person.role, roleOptions) : "Member"}
              {stats && <> · {stats.open} open · {stats.overdue ? <span className="font-semibold text-ng-accent">{stats.overdue} overdue</span> : "none overdue"} · {stats.done30} done in 30 days{stats.onTimePct !== null ? ` · ${stats.onTimePct}% on time` : ""}</>}
            </span>
          </span>
          {h && <span className={`inline-flex items-center rounded-pill px-3 py-1 text-[12px] font-semibold ring-1 ring-inset ${h.cls}`}>{h.label}</span>}
        </>
      )}
    </div>
  );
}

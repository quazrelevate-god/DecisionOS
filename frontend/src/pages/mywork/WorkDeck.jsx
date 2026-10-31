/* My Work on a phone — the split view and its cards (founder, 2026-10-29).
 *
 * The Desk's shape, on My Work: the page's own sky above, holding the filters
 * as KPI-style tiles (what you are looking at, its status, its department) and
 * the priority bar; a black sheet below, holding every task as a summary card
 * the height of its own content. The sheet is an ordinary part of the page and
 * the page scrolls as every page does. (A first cut showed one card per screen,
 * stretched to fill it, with a drag-up sheet and a snap per swipe; the founder
 * tried it the same day and dropped it — WorkSplit's note says what replaced it.)
 *
 * Measurements are in the app's own pixels: the body is zoomed by --ui-scale
 * on a phone, and every rect is in visual pixels.
 *
 * Helpers that live in pages/MyWork.js reach these components as `kit`, so the
 * two files do not import each other.
 */
import { Fragment, forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowSquareOut, CalendarBlank, CaretDown, CaretRight, CheckCircle, ListChecks,
  LockKey, Paperclip, Play, Sparkle, ArrowClockwise, Hourglass, ShieldCheck, File as FileIcon, Check as CheckIcon,
  ArrowBendUpRight, ListBullets, PaperPlaneTilt, Stamp, User, UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "../../lib/api";
import { agoWords } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { taskEditRights } from "../../lib/taskAccess";
import { AvatarStack } from "../../components/neuglass/PersonAvatar";
import { INK_PILL, INK_PLATE, GLASS_MENU, GLASS_MENU_ITEM, GLASS_MENU_LABEL } from "../../components/neuglass/glass";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "../../components/ui/dropdown-menu";
import { PartyChip } from "../../components/party/PartyChip";
import { FENCE, NAVY, RED, TILE_REST, tileWash } from "./WorkspaceHub";
import { askPartyDetails } from "../../components/party/PartyDetailsPrompt";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
const uiScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;

/* ── The status tiles (2026-10-31, founder's reference) ─────────────────────
   Two rows of four on the sky, the desktop fence's colours and icons, cut to
   the phone: the icon on top, the name, the count. Ten statuses do not fit in
   eight tiles, so the three that are about WHEN rather than where the work
   stands — Due today, No due date, Repeating — share the last tile, SCHEDULE,
   which opens a list with their counts. (2026-10-31, founder: as "Due today"
   with a count it read as one more status; a name and no number, last in the
   grid, reads as the button it is.) Overdue keeps a tile of its own: it is
   the one that needs acting on. The tile in force is the navy one, as on
   desktop. */
const PHONE_LABEL = {
  "": "All open", todo: "To do", in_progress: "Doing", waiting: "Waiting", approval: "Approval",
  overdue: "Overdue", due_today: "Due today", no_date: "No due date", repeating: "Repeating", completed: "Done",
};
const WHEN = ["due_today", "no_date", "repeating"];
const TILE_SLOTS = ["", "todo", "in_progress", "waiting", "approval", "overdue", "completed", "when"];

const StatusTile = forwardRef(function StatusTile({ k, on, n, ...rest }, ref) {
  const f = FENCE[k] || FENCE[""];
  const ink = on ? "#fff" : k === "overdue" && n !== "–" && Number(n) > 0 ? RED : k === "completed" ? "hsl(158 40% 22%)" : "hsl(230 40% 8%)";
  return (
    <button ref={ref} type="button" aria-pressed={on} data-testid={`work-status-${k || "all"}`} {...rest}
      style={on ? undefined : tileWash(f)}
      className={`flex min-h-[5.5rem] min-w-0 flex-col items-start justify-between gap-2 rounded-[1.25rem] p-2.5 text-left transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
        on ? NAVY : TILE_REST}`}>
      <f.Icon size={20} weight="duotone" aria-hidden="true" color={on ? "#fff" : `hsl(${f.ink})`} />
      <span className="flex w-full min-w-0 flex-col gap-1">
        <span className={`flex min-w-0 items-center gap-0.5 text-[12px] font-medium leading-tight ${on ? "text-white/80" : "text-slate-500"}`}>
          <span className="truncate">{PHONE_LABEL[k]}</span>
        </span>
        <span className="font-display text-[21px] font-bold leading-none tabular-nums" style={{ color: ink }}>{n}</span>
      </span>
    </button>
  );
});

/* The Schedule tile: the name and a caret where a count would be, and which
   of its three is in force when one is. */
const ScheduleTile = forwardRef(function ScheduleTile({ on, chosen, ...rest }, ref) {
  const f = FENCE.due_today;
  return (
    <button ref={ref} type="button" aria-pressed={on} data-testid="work-status-schedule" {...rest}
      style={on ? undefined : tileWash(f)}
      className={`flex min-h-[5.5rem] min-w-0 flex-col items-start justify-between gap-2 rounded-[1.25rem] p-2.5 text-left transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
        on ? NAVY : TILE_REST}`}>
      <f.Icon size={20} weight="duotone" aria-hidden="true" color={on ? "#fff" : `hsl(${f.ink})`} />
      <span className="flex w-full min-w-0 flex-col gap-1">
        {on && <span className="truncate text-[12px] font-medium leading-tight text-white/80">{PHONE_LABEL[chosen]}</span>}
        {/* 14px written as rem: the phone steps every text-[Npx] up by 2, and
            "Schedule" at 17.5 does not fit beside its caret in a quarter row. */}
        <span className={`flex items-center gap-[3px] text-[0.875rem] font-bold leading-none ${on ? "text-white" : "text-[hsl(230_40%_8%)]"}`}>
          <span className="truncate">Schedule</span>
          <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded-full ${on ? "bg-white/15" : "bg-slate-900/[0.07]"}`}>
            <CaretDown size={9} weight="bold" />
          </span>
        </span>
      </span>
    </button>
  );
});

export function StatusTiles({ value, counts, onPick, loading, capped = {} }) {
  const shown = (key) => (loading ? "–" : capped[key] && counts(key) >= capped[key] ? `${capped[key]}+` : counts(key));
  return (
    <div role="group" aria-label="Status" data-testid="work-status-tiles" className="grid grid-cols-4 gap-2">
      {TILE_SLOTS.map((slot) => {
        if (slot !== "when") {
          const on = value === slot;
          // The lit tile again means "no filter": tapping it lets go.
          return <StatusTile key={slot || "all"} k={slot} on={on} n={shown(slot)} onClick={() => onPick(on && slot ? "" : slot)} />;
        }
        return (
          <DropdownMenu key="when">
            <DropdownMenuTrigger asChild>
              <ScheduleTile on={WHEN.includes(value)} chosen={value} data-slot="when"
                aria-label={`Schedule${WHEN.includes(value) ? `: ${PHONE_LABEL[value]}` : ""}. Due today, No due date or Repeating`} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className={`${GLASS_MENU} w-56 p-1.5`}>
              <DropdownMenuLabel className={GLASS_MENU_LABEL}>Schedule</DropdownMenuLabel>
              {WHEN.map((k) => {
                const f = FENCE[k];
                return (
                  <DropdownMenuItem key={k} data-testid={`work-status-when-${k}`}
                    onSelect={() => onPick(value === k ? "" : k)} className={`${GLASS_MENU_ITEM} gap-3`}>
                    <f.Icon size={18} weight="duotone" aria-hidden="true" color={`hsl(${f.ink})`} className="shrink-0" />
                    <span className={`min-w-0 flex-1 truncate ${value === k ? "font-semibold text-slate-900" : ""}`}>{PHONE_LABEL[k]}</span>
                    <span className="shrink-0 tabular-nums text-xs opacity-55">{shown(k)}</span>
                    {value === k && <CheckIcon size={14} weight="bold" aria-hidden="true" className="shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </div>
  );
}

/* ── The views (2026-10-31, founder's reference) ─────────────────────────────
   One row of pills under the tiles: All Tasks, Assigned to me, My requests,
   Approvals. The one in use is the ink pill, as on desktop. What used to be
   more pills lives inside the one it belongs to, behind a caret that only
   the pill in use shows: Assigned to me holds Asked by me and My team (the
   three are your relation to the work), All Tasks holds Department and
   Person (they only narrow the team's work). Workflows and Approvals have
   their own pages; Approvals here takes you to it.
   `pills`: [{key, label, active, onClick, count, testid, menu: [{group, key,
   label, sub, count, selected, onSelect}]}] */
const VIEW_ICON = { all: ListBullets, mine: User, asked: ArrowBendUpRight, team: UsersThree, requests: PaperPlaneTilt, approvals: Stamp };
export function ViewPills({ pills }) {
  return (
    /* Measured at 390 wide (UI scale 0.8): 456px of row. The type is the
       phone's 13px floor, written as rem because the phone steps every
       text-[Npx] up by 2 (index.css) and 15px names do not fit four across;
       at 13px these sizes need 445, leaving each pill ~3px so no name is
       cut by a fraction of a pixel. Under 380 wide only the pill in use keeps
       its icon, which buys 57px. */
    <nav aria-label="Work" data-testid="work-views" className="flex items-center gap-1">
      {pills.map((p) => {
        const Icon = VIEW_ICON[p.icon || p.key];
        const menu = p.active && p.menu && p.menu.length ? p.menu : null;
        const cls = `flex h-11 min-w-0 flex-auto items-center justify-center gap-1 rounded-pill px-[5px] text-[0.8125rem] font-semibold transition-transform duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 ${
          p.active ? INK_PILL : "bg-[linear-gradient(180deg,#fff,hsl(220_22%_97%))] text-[hsl(230_40%_8%)] ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_8px_18px_-12px_hsl(220_30%_25%/0.45),inset_0_1px_0_#fff]"}`;
        const inner = (
          <>
            {Icon && <Icon size={15} weight={p.active ? "bold" : "regular"} aria-hidden="true"
              className={`shrink-0 ${p.active ? "" : "max-[379px]:hidden"}`} />}
            <span className="truncate">{p.label}</span>
            {p.count > 0 && (
              <span data-testid={`${p.testid}-count`}
                className={`grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums leading-none ${
                  p.active ? "bg-white text-neutral-900" : "bg-neutral-950 text-white"}`}>{p.count}</span>
            )}
            {menu && <CaretDown size={10} weight="bold" aria-hidden="true" className="shrink-0 opacity-70" />}
          </>
        );
        if (!menu) {
          return (
            <button key={p.key} type="button" onClick={p.onClick} aria-pressed={p.active} data-testid={p.testid} className={cls}>{inner}</button>
          );
        }
        return (
          <DropdownMenu key={p.key}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-pressed data-testid={p.testid} aria-label={`${p.label}: more choices`} className={cls}>{inner}</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6}
              className={`${GLASS_MENU} max-h-[calc(60vh/var(--ui-scale,1))] w-64 overflow-y-auto p-1.5`}>
              {menu.map((o, i) => (
                <Fragment key={`${o.group || ""}:${o.key}`}>
                  {o.group && o.group !== menu[i - 1]?.group && (
                    <DropdownMenuLabel className={GLASS_MENU_LABEL}>{o.group}</DropdownMenuLabel>
                  )}
                  <DropdownMenuItem onSelect={o.onSelect} data-testid={o.testid} className={`${GLASS_MENU_ITEM} justify-between gap-3`}>
                    <span className="min-w-0">
                      <span className={`block truncate ${o.selected ? "font-semibold text-slate-900" : ""}`}>{o.label}</span>
                      {o.sub && <span className="block truncate text-[11px] text-slate-500">{o.sub}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {o.count != null && <span className="tabular-nums text-xs opacity-55">{o.count}</span>}
                      {o.selected && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
                    </span>
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}

/* ── The split: sky above, the black sheet below ────────────────────────────
   2026-10-29, the founder's second look: NOT one card per screen. The sheet is
   an ordinary part of the page — it starts under the filters, runs edge to
   edge and on under the dock, holds every task as a card the height of its
   own content, and the page scrolls the way every page does. With a short
   list it still reaches the bottom of the screen (its minimum height is
   measured off where it starts), so it never stops in mid-air.
   The breakout margins are the ones the Desk's sheet uses (index.css
   .ng-desk-sheet-floor), against this route's own padding: the shell's 1rem
   and main's .pb-dock clearance, which the sheet carries inside instead. */
export function WorkSplit({ top, slides = [], label, children, mode = "deck", tone = "ink", focusId = null, testid = "mywork-split" }) {
  const sheetRef = useRef(null);
  const [minH, setMinH] = useState(0);
  const measure = useCallback(() => {
    const el = sheetRef.current;
    if (!el) return;
    const s = uiScale();
    const scroller = el.closest("[data-app-scroller]");
    const top = (el.getBoundingClientRect().top + (scroller?.scrollTop || 0) * s) / s;
    setMinH(Math.max(0, Math.round(window.innerHeight / s - top)));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    const prev = sheetRef.current?.previousElementSibling;
    if (prev) ro.observe(prev);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [measure]);
  // A task opened by link: bring its card into view.
  useEffect(() => {
    if (!focusId) return undefined;
    const tm = setTimeout(() => document.querySelector(`[data-testid="deck-card-${focusId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
    return () => clearTimeout(tm);
  }, [focusId]);

  const n = slides.filter((x) => !x.notice).length;
  const light = tone === "light";
  return (
    <>
      <div data-testid={`${testid}-top`} className="flex flex-col gap-3">{top}</div>
      <section ref={sheetRef} data-testid={testid} aria-label={label}
        style={{ minHeight: minH || undefined }}
        className={`mt-4 rounded-t-[2rem] pl-[max(1rem,var(--sa-left))] pr-[max(1rem,var(--sa-right))] pt-4
          [margin-left:calc(-1*max(1rem,var(--sa-left)))] [margin-right:calc(-1*max(1rem,var(--sa-right)))]
          [margin-bottom:calc(-1*(1rem+var(--dock-h)+3rem+var(--sa-bottom)+var(--dex-notice-space,0px)))]
          [padding-bottom:calc(var(--dock-h)+3rem+var(--sa-bottom)+var(--dex-notice-space,0px))]
          lg:hidden ${light
            ? "bg-[linear-gradient(180deg,hsl(0_0%_97%),hsl(0_0%_93%))] text-foreground shadow-[0_-24px_60px_-30px_hsl(0_0%_0%/0.35),inset_0_1px_0_#fff]"
            : "bg-[linear-gradient(180deg,hsl(240_4%_12%),hsl(240_4%_7%)_160px,hsl(240_4%_6%))] text-white shadow-[0_-24px_60px_-28px_hsl(0_0%_0%/0.6),inset_0_1px_0_hsl(0_0%_100%/0.12)]"}`}>
        <header className="mb-3 flex h-8 items-center justify-between gap-3 px-1">
          <p className={`min-w-0 truncate font-semibold ${light ? "text-[13px] text-slate-600" : "text-[16px] text-white"}`} data-testid={`${testid}-label`}>{label}</p>
          {mode === "deck" && n > 0 && (
            <span className="shrink-0 rounded-pill bg-white/10 px-3 py-1 text-[12px] font-semibold tabular-nums text-white/85"
              data-testid={`${testid}-count`}>{n} {n === 1 ? "task" : "tasks"}</span>
          )}
        </header>
        {mode === "deck" ? (
          <ul className="flex flex-col gap-3" data-testid={`${testid}-list`}>
            {slides.map((x) => <li key={x.key}>{x.node}</li>)}
          </ul>
        ) : children}
      </section>
    </>
  );
}

/* ── The summary card ─────────────────────────────────────────────────────
   Everything a person needs to decide whether to start this now: its stage,
   when it is due and how long it has been theirs, what it is, who is on it,
   what is attached, and the next step of its checklist — then Mark as Doing
   and Open task. */
const isImage = (a) => a.kind === "photo" || (a.content_type || "").startsWith("image/");
const extOf = (a) => {
  const n = (a.filename || "").split(".");
  return n.length > 1 ? n.pop().slice(0, 4).toUpperCase() : (a.kind === "voice" ? "VOICE" : "FILE");
};

function DueBlock({ t, kit }) {
  const over = kit.isOverdue(t);
  const today = kit.isDueToday(t);
  const assigned = t.assigned_at || t.created_at;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
      {t.due_date ? (
        <span data-testid={`deck-due-${t.id}`}
          className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-semibold ${
            over ? "bg-ng-accent/10 text-ng-accent" : today ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
          <CalendarBlank size={14} weight="bold" aria-hidden="true" />
          {today ? "Today" : kit.dueLabel(t.due_date)}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-slate-100 px-3 py-1.5 text-[13px] font-medium text-slate-500">
          <CalendarBlank size={14} weight="bold" aria-hidden="true" /> No due date
        </span>
      )}
      {assigned && (
        <span className="text-[11px] font-medium text-slate-400" data-testid={`deck-assigned-${t.id}`}>
          Assigned {agoWords(assigned)}
        </span>
      )}
    </div>
  );
}

function Attachments({ t, onOpen }) {
  const atts = t.attachments || [];
  if (!atts.length) {
    return <p className="text-[13px] text-slate-400">No attachments</p>;
  }
  const shown = atts.slice(0, 3);
  const extra = atts.length - shown.length;
  return (
    <button type="button" onClick={onOpen} data-testid={`deck-atts-${t.id}`} className="flex min-w-0 flex-col gap-2 text-left">
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-slate-600">
        <Paperclip size={14} weight="bold" aria-hidden="true" />
        {atts.length} {atts.length === 1 ? "attachment" : "attachments"}
        <CaretRight size={12} weight="bold" aria-hidden="true" className="text-slate-400" />
      </span>
      <span className="flex items-center gap-1.5">
        {shown.map((a) => (
          isImage(a) ? (
            <img key={a.url || a.id} src={`${BACKEND}${a.url}`} alt="" loading="lazy"
              className="h-11 w-11 rounded-xl object-cover ring-1 ring-slate-900/[0.06]" />
          ) : (
            <span key={a.url || a.id} className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[10px] font-bold text-slate-600 ring-1 ring-inset ring-slate-900/[0.05]">
              {extOf(a) === "FILE" ? <FileIcon size={16} aria-hidden="true" /> : extOf(a)}
            </span>
          )
        ))}
        {extra > 0 && (
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-[12px] font-semibold text-slate-600">+{extra}</span>
        )}
      </span>
    </button>
  );
}

/* The checklist as a short path in the card's middle: the steps around the
   one to do now, each a small node on a line — the task view's flow, at the
   size of a glance. */
/* 2026-10-29 (founder), third look — THE STEP NUMBERS ARE ONE ROW, and the
   words are not in it. A line of numbered nodes, left to right, sits just
   above the Next action box: done steps filled with the ink, the chosen one
   ringed with a gold halo. Tapping a number does not tick it — it chooses
   which step the box below shows, in full ("Step 3 of 8"). The flow says how
   far along the checklist is, so there is no separate progress bar. A long
   checklist scrolls sideways and keeps the chosen node in view. */
function StepDots({ t, steps, current, sel, onPick }) {
  const rowRef = useRef(null);
  const selRef = useRef(null);
  useEffect(() => {
    const row = rowRef.current, el = selRef.current;
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({ left: Math.max(0, el.offsetLeft - row.clientWidth / 2 + el.offsetWidth / 2), behavior: "smooth" });
  }, [sel]);
  return (
    <div ref={rowRef} className="-mx-1 mb-3 overflow-x-auto px-1 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid={`deck-path-${t.id}`}>
      <ol className="flex min-w-full items-center" aria-label={`Checklist, ${steps.filter((x) => x.done).length} of ${steps.length} done`}>
        {steps.map((st, idx) => {
          const on = idx === sel;
          const isNext = idx === current;
          return (
            <Fragment key={st.id || idx}>
              {idx > 0 && (
                <span aria-hidden="true" className={`h-[2px] min-w-[6px] flex-1 rounded-full ${steps[idx - 1].done ? "bg-neutral-900" : "bg-slate-300"}`} />
              )}
              <li ref={on ? selRef : null} className="shrink-0">
                <button type="button" aria-pressed={on} data-testid={`deck-step-${t.id}-${idx}`}
                  aria-label={`Show step ${idx + 1}${st.done ? ", done" : isNext ? ", next" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onPick(idx); }}
                  className="grid h-10 w-9 place-items-center focus-visible:outline-none">
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold transition-shadow duration-200 ${
                    st.done ? `${INK_PLATE} text-white` : "bg-white text-slate-600 ring-1 ring-inset ring-slate-300"} ${
                    on ? "ring-2 ring-neutral-900 shadow-[0_0_0_4px_hsl(44_88%_60%/0.35)]" : ""} ${
                    isNext && !on ? "text-slate-900 ring-slate-500" : ""}`}>
                    {st.done ? <CheckCircle size={14} weight="fill" aria-hidden="true" /> : idx + 1}
                  </span>
                </button>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}

/* 2026-10-30 (founder) — ON DESKTOP THE STEPS ARE ONE LINE: how many are
   done out of how many, and a bar that fills to match, in place of the
   numbered row. Clicking it opens the task on its Steps. */
/* `auto` — the company has Dex draft every task's steps (NF-4.18). */
function StepProgress({ t, steps, terminal, onOpen, auto }) {
  const done = steps.filter((s) => s.done).length;
  const waiting = !steps.length && !terminal && drafting(t, auto);
  return (
    <button type="button" onClick={onOpen} data-testid={`deck-progress-${t.id}`} className="block w-full text-left">
      <span className="flex items-baseline justify-between gap-3 text-[12px] font-medium">
        <span className={waiting ? "animate-pulse text-slate-500 motion-reduce:animate-none" : "text-slate-500"}>
          {steps.length ? "Steps" : waiting ? "Dex is drafting the steps…" : "No steps yet"}
        </span>
        {steps.length > 0 && (
          <span className="font-semibold tabular-nums text-slate-900" data-testid={`deck-progress-count-${t.id}`}>
            {done} of {steps.length}
          </span>
        )}
      </span>
      <span role="progressbar" aria-label={`${done} of ${steps.length} steps done`}
        aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}
        className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-slate-900/[0.08]">
        <span className="block h-full rounded-full bg-neutral-900 transition-[width] duration-500 ease-out"
          style={{ width: steps.length ? `${(done / steps.length) * 100}%` : 0 }} />
      </span>
    </button>
  );
}

/* What the checklist says to do next: the first step not yet ticked. */
function nextStep(t) {
  const steps = t.execution_plan?.steps || [];
  const i = steps.findIndex((s) => !s.done);
  return { steps, i, step: i >= 0 ? steps[i] : null };
}
/* 2026-10-29 (founder) — no checklist yet means Dex is writing one: My Work
   asks for every card on screen that has none (POST /tasks/auto-plan), so the
   line says so until the steps land. Only after three failed tries does it
   fall back to asking the person for a first step. */
/* NF-4.18 (2026-10-30) — only when the company has Dex draft every task's
   steps; otherwise a card with no steps asks for its first one. */
const drafting = (t, auto) => !!auto && !t.execution_plan?.steps?.length && Number(t.plan_auto_tries || 0) < 3;

/* 2026-10-30 (founder, from users) — PRIORITY IS A GLOW, NOT A STRIPE. The
   stripe beside the title did not convince; the desktop card now carries its
   priority as a soft light along the inside of its bottom edge, following
   the corners: red high, orange medium, grey low. HSL, for the alphas below. */
const PRIO_GLOW = {
  high: { hue: "0 84% 58%", glow: 0.24, edge: 0.34 },
  medium: { hue: "28 95% 54%", glow: 0.24, edge: 0.34 },
  low: { hue: "220 9% 46%", glow: 0.16, edge: 0.22 },
};

/* `onToggleSelect` / `selected` — desktop's bulk selection (the card is the
   desktop's list card too since 2026-10-29); left out, there is no tick box.
   `desk` — the desktop list's cut (2026-10-30, founder): no Next action box,
   no Mark as Doing / Open task (a click anywhere on the card opens it), the
   numbered steps as one progress bar, every card the same shape, and the
   priority glow above. The phone never passes it. */
export function TaskSummaryCard({ t, kit, members = [], roleOptions = [], onOpen, onPatched, onChange, selected = false, onToggleSelect, desk = false }) {
  const { user, tenant } = useAuth();
  const auto = !!tenant?.auto_plan_steps;
  const [busy, setBusy] = useState(false);
  const rights = taskEditRights(user, t, members);
  const stage = kit.stageOf(t.status);
  const terminal = kit.isTerminal(t);
  const tone = kit.STATUS_TONE[t.status] || kit.STATUS_TONE.todo;
  const people = kit.cardPeople(t, members, roleOptions);
  const { steps, i, step } = nextStep(t);
  // Which step the Next action box shows: the next one to do, until a number
  // in the row above it is tapped.
  // (With every step ticked there is no next one: nothing is chosen, and the
  // box says the checklist is done until a number is tapped.)
  const [sel, setSel] = useState(i);
  useEffect(() => { setSel(i); }, [i, steps.length]);
  const shownStep = sel >= 0 && sel < steps.length ? steps[sel] : null;
  const showingNext = sel === i;
  const apprStart = t.approval_required && t.approval_stage !== "close" && t.approval_status !== "approved";
  const signoff = t.approval_required && t.approval_stage === "close" && t.approval_status === "pending" && !terminal;
  const waitingDecision = t.status === "blocked" && !!t.decision_id && !t.approval_required;
  const waitsForWork = t.status === "blocked" && (t.depends_on || []).length > 0 && !apprStart;
  const hasProof = (t.attachments || []).some((a) => a.kind !== "reference");

  const patch = async (body, said) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/tasks/${t.id}`, body);
      onPatched?.(data);
      if (data?.approval_status === "pending" && data?.status === "review") {
        toast.success(`Sent for approval — ${t.approver_name || "the approver"} will close it.`);
      } else toast.success(said);
      // Epic 11 S12 — finished from the card (the phone's usual way): CRM has
      // only a name for who it was about, so the doer is asked once, as the
      // drawer's slider asks.
      if (body.status === "done" && data?.status === "done") askPartyDetails(t);
      onChange?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not update the task");
    } finally { setBusy(false); }
  };

  // The one thing this card's main button does, for this task, for this person.
  const primary = (() => {
    if (terminal) return rights.finish ? { label: "Reopen", icon: ArrowClockwise, run: () => patch({ status: "in_progress", progress: 0 }, "Task reopened — back in your work") } : null;
    if (apprStart) return { label: "Awaiting approval", icon: LockKey, disabled: true };
    if (waitingDecision) return { label: "Waiting for a decision", icon: LockKey, disabled: true };
    if (signoff) return { label: "Waiting for approval", icon: ShieldCheck, disabled: true };
    if (!rights.work) return null;
    if (waitsForWork) return { label: "Waiting on other work", icon: Hourglass, disabled: true };
    if (stage === "todo") return { label: "Mark as Doing", icon: Play, run: () => patch({ status: "in_progress" }, "Marked as Doing") };
    if (!rights.finish) return null;
    return {
      label: "Mark complete", icon: CheckCircle,
      run: () => (t.evidence_required && !hasProof
        ? (toast.error("This task needs proof first — add a photo, voice note or file."), onOpen?.("documents"))
        : patch({ status: "done" }, "Task completed — reopen it from the task if needed")),
    };
  })();

  const prio = desk && kit.tierOf ? kit.tierOf(t) : null;
  const glow = prio && PRIO_GLOW[prio];

  return (
    <article data-testid={`deck-card-${t.id}`} data-stage={stage} data-priority={prio || undefined}
      // On desktop the card is the way in: a click that did not land on one
      // of its own controls opens the task. (Keyboard: the title is a button.)
      onClick={desk ? (e) => { if (!e.target.closest("button, a, input, label")) onOpen?.(); } : undefined}
      className={`flex flex-col rounded-[1.75rem] bg-[linear-gradient(180deg,#fff,hsl(220_14%_97%))] p-5 text-slate-900 shadow-[0_30px_60px_-30px_hsl(0_0%_0%/0.8)] lg:shadow-[0_18px_40px_-26px_hsl(220_30%_20%/0.5)] lg:ring-1 lg:ring-inset ${selected ? "lg:ring-2 lg:ring-ng-ink" : "lg:ring-slate-900/[0.05]"} ${
        desk ? "relative h-full cursor-pointer transition-shadow duration-200 hover:shadow-[0_24px_48px_-24px_hsl(220_30%_20%/0.6)]" : ""}`}>
      {glow && (
        <>
          {/* Inside the card, under the content's padding: the rounded box
              inherits the card's corners, so the light bends round them. */}
          <span aria-hidden="true" data-testid={`priority-glow-${t.id}`} data-priority={prio}
            className="pointer-events-none absolute inset-0 rounded-[inherit]"
            style={{ boxShadow: `inset 0 -22px 28px -18px hsl(${glow.hue} / ${glow.glow}), inset 0 -1px 0 hsl(${glow.hue} / ${glow.edge})` }} />
          <span className="sr-only">{kit.PRIO_LABEL[prio]} priority.</span>
        </>
      )}
      {/* Desktop: room for the due pill and its "Assigned … ago" line on every card. */}
      <div className={`flex shrink-0 items-start justify-between gap-3 ${desk ? "min-h-[58px]" : ""}`}>
        {onToggleSelect && (
          <label className="-ml-1 mt-1.5 grid shrink-0 cursor-pointer place-items-center" title={selected ? "Deselect" : "Select for bulk action"}>
            <input type="checkbox" checked={selected} onChange={onToggleSelect} data-testid={`bulk-select-${t.id}`}
              aria-label={`Select task ${t.title}`}
              className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-slate-300 bg-[#fff] transition-colors checked:border-ng-ink checked:bg-ng-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ng-ink/40" />
            <CheckIcon size={12} weight="bold" aria-hidden="true" className="pointer-events-none absolute hidden text-white peer-checked:block" />
          </label>
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[13px] font-semibold ring-1 ring-inset ${tone.pill}`}
            data-testid={`deck-status-${t.id}`}>
            <kit.StatusRing status={t.status} tone={tone} />
            {kit.STATUS_LABEL[t.status] || t.status}
          </span>
          {kit.isOverdue(t) && (
            <span className="pl-1 text-[11px] font-semibold text-ng-accent" data-testid={`deck-late-${t.id}`}>
              {kit.latenessText(kit.lateness(t))}
            </span>
          )}
        </div>
        <DueBlock t={t} kit={kit} />
      </div>
      {/* Epic 11 S12 — the customer/supplier it is about; opens their page.
          A line of its own, the card's full width: beside the due date it had
          half the card and cut even "Kumar Exports" short. */}
      {t.contact_summary && (
        <div className="mt-2.5 flex min-w-0 shrink-0">
          <PartyChip party={t.contact_summary} testid={`deck-party-${t.id}`} className="max-w-full" compact />
        </div>
      )}

      <div className="mt-3 flex shrink-0 flex-col">
        {(() => {
          const title = (
            <div className="flex flex-col">
              <button type="button" onClick={() => onOpen?.()} className="text-left" data-testid={`deck-title-${t.id}`}
                title={desk ? t.title : undefined}>
                <h2 className={`${desk ? "line-clamp-2" : "line-clamp-3"} text-[24px] font-bold leading-[1.15] tracking-tight text-slate-900 lg:text-[20px]`}>{t.title}</h2>
              </button>
            </div>
          );
          // 2026-10-30 (founder) — EVERY DESKTOP CARD THE SAME SHAPE: the title
          // takes two lines' room (2 × 23px at 20px / 1.15) whether it needs
          // one or two, and anything longer ends in "…".
          return desk ? <div className="min-h-[46px]">{title}</div> : title;
        })()}
        {desk ? (
          /* The description in a shallow glass well, two lines' room, always
             there — "No description" holds the place, as "No attachments"
             does — so every card's rows line up. */
          <div data-testid={`deck-desc-${t.id}`}
            className="mt-3 rounded-2xl border border-white/80 bg-[linear-gradient(160deg,hsl(220_22%_95%/0.9),hsl(220_22%_97%/0.6))] px-3.5 py-2.5 shadow-[inset_0_2px_6px_hsl(230_24%_30%/0.07),inset_0_-1px_0_hsl(0_0%_100%/0.85)] backdrop-blur-md">
            <p className={`line-clamp-2 min-h-[3.25em] text-[15px] leading-relaxed ${t.description ? "text-slate-500" : "text-slate-400"}`}
              title={t.description || undefined}>
              {t.description || "No description"}
            </p>
          </div>
        ) : t.description && (
          <p className="mt-2 line-clamp-3 text-[15px] leading-relaxed text-slate-500">{t.description}</p>
        )}

        {/* Desktop: the row's tallest case (label + 44px thumbnails), so a card
            with files is no taller than one without. */}
        <div className={`mt-4 grid grid-cols-[auto_1px_minmax(0,1fr)] items-start gap-4 ${desk ? "min-h-[73px]" : ""}`}>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[13px] font-medium text-slate-600">Assigned to</span>
            {people.length ? <AvatarStack people={people} max={3} size={40} testid={`deck-people-${t.id}`} />
              : <span className="text-[13px] text-slate-400">Nobody yet</span>}
          </div>
          <span aria-hidden="true" className="h-full w-px bg-slate-900/[0.08]" />
          <Attachments t={t} onOpen={() => onOpen?.("documents")} />
        </div>
      </div>

      {desk ? (
        <div className="mt-auto shrink-0 pt-5">
          <StepProgress t={t} steps={steps} terminal={terminal} auto={auto} onOpen={() => onOpen?.("steps")} />
        </div>
      ) : (
      <div className="shrink-0 pt-4">
        {steps.length > 0 && <StepDots t={t} steps={steps} current={i} sel={sel} onPick={setSel} />}
        <button type="button" onClick={() => onOpen?.("steps")} data-testid={`deck-next-${t.id}`}
          className="flex w-full items-center gap-3 rounded-2xl bg-[linear-gradient(180deg,hsl(220_10%_95%),hsl(220_10%_93.5%))] p-3.5 text-left ring-1 ring-inset ring-slate-900/[0.04]">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${INK_PLATE} text-amber-300`}>
            {drafting(t, auto) ? <Sparkle size={18} weight="fill" aria-hidden="true" className="animate-pulse" />
              : <ListChecks size={19} weight="bold" aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500" data-testid={`deck-next-label-${t.id}`}>
              {shownStep && !showingNext
                ? `Step ${sel + 1} of ${steps.length}${shownStep.done ? " · done" : ""}`
                : `Next action${step && steps.length > 1 ? ` · step ${i + 1} of ${steps.length}` : ""}`}
            </span>
            {/* The whole step, however long — never cut short. */}
            <span className={`mt-0.5 block whitespace-pre-line break-words text-[16px] font-semibold leading-snug ${
              !steps.length && !terminal && drafting(t, auto) ? "animate-pulse text-slate-500 motion-reduce:animate-none"
                : shownStep?.done && !showingNext ? "text-slate-500" : "text-slate-900"}`}
              data-testid={`deck-next-text-${t.id}`}>
              {shownStep && (!showingNext || step) ? shownStep.text
                : steps.length ? "Every step is done — mark it complete"
                : terminal ? "Done"
                : drafting(t, auto) ? "Dex is drafting the steps…"
                : "Add the first step"}
            </span>
          </span>
          <CaretRight size={16} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
        </button>

        <div className="mt-3 flex items-center gap-2.5">
          {primary && (
            <button type="button" disabled={busy || primary.disabled} onClick={primary.run}
              data-testid={`deck-primary-${t.id}`}
              className={`flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-4 text-[16px] font-semibold disabled:opacity-60 ${
                primary.disabled ? "bg-slate-100 text-slate-500" : INK_PILL}`}>
              <primary.icon size={17} weight="fill" aria-hidden="true" className="shrink-0" />
              <span className="truncate">{busy ? "Saving…" : primary.label}</span>
            </button>
          )}
          <button type="button" onClick={() => onOpen?.()} data-testid={`deck-open-${t.id}`}
            className={`flex h-14 items-center justify-center gap-2 rounded-pill bg-white px-5 text-[16px] font-semibold text-slate-900 ring-1 ring-inset ring-slate-900/10 ${primary ? "shrink-0" : "flex-1"}`}>
            <ArrowSquareOut size={17} weight="bold" aria-hidden="true" /> Open task
          </button>
        </div>
      </div>
      )}
    </article>
  );
}

/* A card-sized message for the sheet: loading, empty, or a band with nothing in it. */
export function DeckNotice({ title, hint, action, onAction, testid, loading = false }) {
  return (
    <div data-testid={testid}
      className="flex flex-col items-center justify-center gap-3 rounded-[1.75rem] bg-white/[0.06] p-8 text-center ring-1 ring-inset ring-white/10">
      {loading ? (
        <div className="w-full space-y-3" aria-hidden="true">
          <div className="h-8 w-28 rounded-pill bg-white/10" />
          <div className="h-7 w-4/5 rounded-xl bg-white/10" />
          <div className="h-7 w-3/5 rounded-xl bg-white/10" />
          <div className="h-24 w-full rounded-2xl bg-white/[0.07]" />
        </div>
      ) : (
        <>
          <p className="text-[18px] font-semibold text-white">{title}</p>
          {hint && <p className="max-w-[18rem] text-[14px] leading-relaxed text-white/60">{hint}</p>}
          {action && (
            <button type="button" onClick={onAction} data-testid={`${testid}-action`}
              className="mt-2 h-11 rounded-pill bg-white px-5 text-[14px] font-semibold text-slate-900">{action}</button>
          )}
        </>
      )}
    </div>
  );
}

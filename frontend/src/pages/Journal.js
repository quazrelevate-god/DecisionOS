// KM-10 (2026-08-28) · /journal, rebuilt.
//
// WHAT THIS REPLACED. The page was still largely the retired brutalist system:
// `card-brutal` decision cards with `shadow-hover`, a `bg-primary` (retired
// indigo) search button, `label-mono` captions, `bg-black/20` and
// `divide-black/10` rules, and `text-brand-blue` links. It also had no way to
// reach a specific day: entries were one long reverse-chronological feed, and
// on a phone that feed was capped at 12 entries with a "show earlier" button —
// so "what did I decide on the 14th" meant expanding everything and scrolling.
//
// WHAT IT IS NOW. Two framings of the same log, on a pressed-track segmented
// control, exactly as /calendar does it:
//   · TIMELINE — the reverse-chronological feed, still the default, because
//     most visits are "what happened lately" rather than "what happened on a
//     date".
//   · CALENDAR — the same week strip /calendar mints (today ringed, selected
//     day sunken, a dot under any day that has entries), and below it only the
//     selected day. Picking a date is now one tap, and an empty day says so
//     rather than silently showing the next day's entries.
//
// The mobile entry cap survives, but only in Timeline: in Calendar a single day
// is bounded by definition, so capping there would hide entries for no reason.
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { ymd, addDays, startOfWeek, DOW, dayTitle } from "../lib/dates";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import {
  MagnifyingGlass,
  Note,
  GitCommit,
  Stamp,
  XCircle,
  UserPlus,
  CheckSquare,
  Circle,
  CaretLeft,
  CaretRight,
  ArrowRight,
} from "@phosphor-icons/react";

const EVENT_ICON = {
  created: GitCommit,
  approved: Stamp,
  rejected: XCircle,
  assigned: UserPlus,
  task: CheckSquare,
  event: Circle,
};

/* Icon colour is identification, not alarm — it is the only thing separating a
   rejection from an approval at a glance in a list of small marks. */
const EVENT_COLOR = {
  created: "text-sky-600",
  approved: "text-green-600",
  rejected: "text-danger-600",
  assigned: "text-foreground",
  task: "text-amber-600",
  event: "text-muted-foreground",
};

function fmtTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

/* KM-10 — the timeline sheet joins the design system: .kr-bento instead of a
   hairline-framed panel, the rail and its nodes drawn with .nm-inset / .kr-pop
   rather than border-border and .nm-tile, and the mono captions gone. */
function TimelineDialog({ decisionId, open, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["timeline", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}/timeline`).then((r) => r.data),
    enabled: !!decisionId && open,
  });
  const events = data?.timeline || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="kr-bento max-w-lg rounded-cardlg border-0" data-testid="timeline-dialog">
        <DialogHeader>
          <DialogTitle className="pr-8 font-display text-xl">
            {data?.title || "Decision timeline"}
          </DialogTitle>
          <DialogDescription className="sr-only">History of this decision</DialogDescription>
        </DialogHeader>

        {data?.status && <Chip value={data.status} className="w-fit" />}

        {isLoading ? (
          <div className="space-y-3 py-2" aria-hidden="true">
            {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-12 rounded-control" />)}
          </div>
        ) : events.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No history recorded yet for this decision.</p>
        ) : (
          <ol className="relative ml-2 mt-2 border-l border-nm-edge/50" data-testid="timeline-events">
            {events.map((e, i) => {
              const Icon = EVENT_ICON[e.kind] || Circle;
              const color = EVENT_COLOR[e.kind] || "text-muted-foreground";
              return (
                <li key={`${e.kind}-${e.ts || i}`} className="mb-5 ml-6" data-testid={`timeline-event-${i}`}>
                  <span className="kr-pop absolute -left-[15px] grid h-7 w-7 place-items-center rounded-full">
                    <Icon size={13} weight="bold" className={color} aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium leading-snug">{e.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {e.actor || "System"} · {fmtTime(e.ts)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One day's decisions and notes, shared by both views so the two framings
 *  cannot drift apart in how an entry looks. */
function DayEntries({ day, onOpen }) {
  return (
    <>
      {day.decisions.length > 0 && (
        <div className="mb-3 grid gap-2.5 lg:grid-cols-2">
          {day.decisions.map((d) => (
            <button
              key={d.id}
              onClick={() => onOpen(d.id)}
              data-testid={`journal-decision-${d.id}`}
              className="kr-bento kr-lift flex flex-col gap-2 rounded-cardlg p-3.5 text-left"
            >
              <div className="flex items-start justify-between gap-2">
                <Chip value={d.dtype} />
                <Chip value={d.status} />
              </div>
              <p className="text-sm font-medium leading-snug">{d.title}</p>
              <span className="mt-auto flex items-center gap-1 text-xs font-semibold text-foreground/70">
                View timeline <ArrowRight size={11} weight="bold" aria-hidden="true" />
              </span>
            </button>
          ))}
        </div>
      )}

      {day.notes.length > 0 && (
        <div className="kr-bento divide-y divide-nm-edge/40 rounded-cardlg" data-testid={`journal-notes-${day.date}`}>
          {day.notes.map((n) => (
            <div key={n.id} className="flex items-start gap-3 p-3.5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-600">
                <Note size={15} weight="regular" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm leading-snug">{n.text}</p>
                {n.tag && <Chip value={n.tag} className="mt-2" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function Journal() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState("timeline");
  const [selected, setSelected] = useState(() => ymd(new Date()));

  const { data, isLoading } = useQuery({
    queryKey: ["journal", term],
    queryFn: () => api.get(`/journal?q=${encodeURIComponent(term)}`).then((r) => r.data),
  });

  const allDays = useMemo(
    () => (data?.days || []).filter((d) => d.decisions.length || d.notes.length),
    [data]
  );
  const hasContent = allDays.length > 0;

  /* date -> day, so the strip and the calendar view can both ask "is there
     anything on this exact date" without scanning the array each time — and so
     a day with no entries is a miss rather than the next day's entries. */
  const byDate = useMemo(() => {
    const m = {};
    allDays.forEach((d) => { m[d.date] = d; });
    return m;
  }, [allDays]);

  // The mobile entry budget. Kept from MPWA-12i: the journal grows without
  // bound and measured 3,166px at 390px with a fortnight of entries. Spent
  // newest-first across the whole list, with a per-day cap as a secondary
  // guard so one very loud day cannot consume all of it.
  // KM-10 — TIMELINE ONLY. In the calendar view a single day is bounded by
  // definition, so capping there would hide entries for nothing.
  const isMobile = useIsMobile();
  const [showAllEntries, setShowAllEntries] = useState(false);
  const PER_DAY_ON_MOBILE = 5;
  const TOTAL_ON_MOBILE = 12;
  const capped = isMobile && !showAllEntries && view === "timeline";
  const { visibleDays, hiddenEntryCount } = useMemo(() => {
    const totalAll = allDays.reduce((n, d) => n + (d.decisions || []).length + (d.notes || []).length, 0);
    if (!capped) return { visibleDays: allDays, hiddenEntryCount: 0 };

    let budget = TOTAL_ON_MOBILE;
    const days = [];
    for (const d of allDays) {
      if (budget <= 0) break;
      const decisions = (d.decisions || []).slice(0, Math.min(PER_DAY_ON_MOBILE, budget));
      budget -= decisions.length;
      const notes = (d.notes || []).slice(0, Math.max(0, Math.min(PER_DAY_ON_MOBILE, budget)));
      budget -= notes.length;
      if (decisions.length || notes.length) days.push({ ...d, decisions, notes });
    }
    const shown = days.reduce((n, d) => n + d.decisions.length + d.notes.length, 0);
    return { visibleDays: days, hiddenEntryCount: Math.max(0, totalAll - shown) };
  }, [allDays, capped]);

  const weekStart = useMemo(() => startOfWeek(new Date(`${selected}T00:00:00`)), [selected]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))), [weekStart]);
  const today = ymd(new Date());
  const shiftWeek = (n) => setSelected(ymd(addDays(new Date(`${selected}T00:00:00`), n * 7)));
  const monthLabel = new Date(`${week[0]}T00:00:00`)
    .toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const selectedDay = byDate[selected];

  return (
    <div data-testid="journal-page">
      <PageHeader eyebrow="Your decision diary" title="CEO Journal" />

      {/* Search — .kr-pressed field and an ink pill, off the retired
          nm-tile + bg-primary pair. */}
      <form
        onSubmit={(e) => { e.preventDefault(); setTerm(q); }}
        className="mb-4 flex max-w-xl items-center gap-2"
      >
        <div className="kr-pressed flex min-w-0 flex-1 items-center rounded-pill">
          <MagnifyingGlass size={16} weight="regular" aria-hidden="true" className="ml-3.5 shrink-0 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="journal-search-input"
            placeholder="Search decisions & notes…"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
          />
        </div>
        <button
          type="submit"
          data-testid="journal-search-btn"
          className="kr-lift flex h-11 shrink-0 items-center rounded-pill bg-kr-ink px-5 text-sm font-medium text-white"
        >
          Search
        </button>
      </form>

      {/* Timeline / Calendar — the same pressed-track control /calendar uses. */}
      <div className="kr-pressed mb-4 flex w-fit items-center gap-1 rounded-pill p-1"
           role="group" aria-label="Journal view" data-testid="journal-view">
        {[{ k: "timeline", l: "Timeline" }, { k: "calendar", l: "Calendar" }].map((v) => (
          <button key={v.k} type="button" onClick={() => setView(v.k)}
            aria-pressed={view === v.k} data-testid={`journal-view-${v.k}`}
            className={`flex h-9 items-center justify-center rounded-pill px-5 text-sm ${
              view === v.k ? "kr-pop font-semibold text-foreground" : "text-foreground/60"
            }`}>
            {v.l}
          </button>
        ))}
      </div>

      {view === "calendar" && (
        /* The week strip, same anatomy as /calendar's: today ringed, the
           selected day sunken, a dot under any day that has entries. */
        <div className="kr-bento mb-4 p-3" data-testid="journal-week-strip">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftWeek(-1)} aria-label="Previous week"
              data-testid="journal-week-prev"
              className="grid h-9 w-9 place-items-center rounded-full text-foreground/70">
              <CaretLeft size={16} weight="bold" aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold" data-testid="journal-month-label">{monthLabel}</span>
            <button type="button" onClick={() => shiftWeek(1)} aria-label="Next week"
              data-testid="journal-week-next"
              className="grid h-9 w-9 place-items-center rounded-full text-foreground/70">
              <CaretRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
          <div className="flex items-stretch gap-1">
            {week.map((iso, i) => {
              const d = byDate[iso];
              const n = d ? d.decisions.length + d.notes.length : 0;
              const isSel = iso === selected;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelected(iso)}
                  aria-pressed={isSel}
                  aria-label={dayTitle(iso)}
                  data-testid={`journal-day-cell-${iso}`}
                  className={`flex flex-1 basis-0 flex-col items-center gap-1 rounded-control py-2 ${
                    isSel ? "kr-pressed font-semibold" : "text-foreground/75"
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wide opacity-60">{DOW[i]}</span>
                  <span className={`grid h-7 w-7 place-items-center rounded-full text-sm tabular-nums ${
                    iso === today && !isSel ? "ring-1 ring-kr-ink/45" : ""
                  }`}>
                    {Number(iso.slice(8, 10))}
                  </span>
                  <span aria-hidden="true"
                    className={`h-1 w-1 rounded-full ${n ? "bg-kr-ink/55" : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-24 rounded-cardlg" />)}
        </div>
      ) : !hasContent ? (
        <EmptyState
          title="Nothing logged yet."
          hint="Decisions you capture and approve appear here, grouped by day."
          ctaLabel="Open Decision Desk"
          ctaTo="/inbox"
        />
      ) : view === "calendar" ? (
        <div data-testid="journal-selected-day">
          <div className="mb-3 flex items-baseline gap-2.5">
            <h2 className="text-sm font-semibold">{dayTitle(selected)}</h2>
            <span className="h-px flex-1 bg-nm-edge/50" />
            {selectedDay && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {selectedDay.decisions.length + selectedDay.notes.length}
              </span>
            )}
          </div>
          {selectedDay
            ? <DayEntries day={selectedDay} onOpen={setOpenId} />
            : (
              <div className="kr-bento rounded-cardlg px-4 py-8 text-center" data-testid="journal-day-empty">
                <p className="text-sm text-muted-foreground">Nothing logged on this day.</p>
              </div>
            )}
        </div>
      ) : (
        <div className="space-y-8" data-testid="journal-days">
          {visibleDays.map((day) => (
            <section key={day.date} data-testid={`journal-day-${day.date}`}>
              <div className="mb-3 flex items-baseline gap-2.5">
                <h2 className="text-sm font-semibold">{dayTitle(day.date)}</h2>
                <span className="h-px flex-1 bg-nm-edge/50" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {day.decisions.length + day.notes.length}
                </span>
              </div>
              <DayEntries day={day} onOpen={setOpenId} />
            </section>
          ))}
          {hiddenEntryCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllEntries(true)}
              data-testid="journal-show-earlier"
              className="kr-pop flex h-11 w-full items-center justify-center rounded-pill text-sm font-semibold text-foreground"
            >
              Show {hiddenEntryCount} earlier {hiddenEntryCount === 1 ? "entry" : "entries"}
            </button>
          )}
        </div>
      )}

      <TimelineDialog decisionId={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

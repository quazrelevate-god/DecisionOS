// KM-3 (2026-08-27) · /calendar, rebuilt.
//
// WHAT THIS REPLACED. The page was the last full survivor of the retired
// brutalist system: `card-brutal` rows with hard `border-border` frames,
// `bg-primary` (the indigo the brand retired), `font-heading font-black
// uppercase` day headers, `label-mono` captions, and a `bg-black/20` rule.
// Eight filter buttons wrapped into a three-row block ~150px tall before any
// content, and the body was one long chronological list — 45 days of it — which
// is a feed, not a calendar. You could not answer "what does Thursday look
// like" without scrolling for it.
//
// WHAT IT IS NOW. A calendar with the two views people expect:
//   · a WEEK STRIP that is always visible — seven cells, today ringed, the
//     selected day sunken, a dot under any day carrying events. This is the
//     navigation, and it is the thing that makes the page feel like a calendar
//     rather than a list with dates in it.
//   · DAY — the selected day alone, its events as full cards.
//   · WEEK — all seven days of the shown week, each day a small heading with
//     its events under it, empty days included so the shape of the week is
//     visible rather than implied.
//
// ON THE ABSENCE OF AN HOUR GRID. /calendar returns day-level buckets:
// `{ days: [{ date, events: [{ type, title, subtitle, overdue, contact_id }] }] }`
// with no time-of-day on an event. A Google-style hour grid would therefore
// have to invent positions, so the day view is a time-less agenda instead.
// When the API grows a time field this is where the grid goes.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, EmptyState } from "../components/common";
import {
  CurrencyCircleDollar, CheckSquare, Truck, Warning, Cake, CalendarBlank,
  UsersThree, AirplaneTakeoff, CaretLeft, CaretRight,
} from "@phosphor-icons/react";

/* Type → label, icon, and the DOT colour used on the week strip and the card's
   icon chip. Colour here is identification, not alarm: it is the only thing
   separating a delivery from a payment at a glance. `overdue` is the one state
   that gets the accent, and it gets it as a word, not just a hue. */
const TYPES = {
  meeting:     { label: "Meetings",   icon: UsersThree,            dot: "bg-sky-500" },
  payment_due: { label: "Payments",   icon: CurrencyCircleDollar,  dot: "bg-orange-500" },
  task:        { label: "Tasks",      icon: CheckSquare,           dot: "bg-indigo-400" },
  delivery:    { label: "Deliveries", icon: Truck,                 dot: "bg-green-600" },
  complaint:   { label: "Complaints", icon: Warning,               dot: "bg-purple-600" },
  birthday:    { label: "Birthdays",  icon: Cake,                  dot: "bg-pink-500" },
  leave:       { label: "Leave",      icon: AirplaneTakeoff,       dot: "bg-teal-600" },
};

const ymd = (d) => {
  // Local, not toISOString(): toISOString() converts to UTC first, so anywhere
  // east of Greenwich "today" becomes yesterday for part of the day and the
  // strip highlights the wrong cell.
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
/* Monday-first, matching Indian business practice and every calendar app the
   founder is comparing this to. getDay() is Sunday-first, hence the shift. */
const startOfWeek = (d) => addDays(d, -((d.getDay() + 6) % 7));

const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function dayTitle(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const today = ymd(new Date());
  const tmr = ymd(addDays(new Date(), 1));
  if (iso === today) return "Today";
  if (iso === tmr) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

export default function Calendar() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [mode, setMode] = useState("day");
  const [selected, setSelected] = useState(() => ymd(new Date()));

  const { data, isLoading } = useQuery({
    queryKey: ["calendar"],
    queryFn: () => api.get("/calendar?days=45").then((r) => r.data),
  });

  const counts = data?.counts || {};

  /* date -> events, filtered. A map rather than the raw array because both
     views and the strip all ask "what is on this specific date", and the API
     only returns days that HAVE events — so a plain .find() would miss the
     empty days the week view deliberately renders. */
  const byDate = useMemo(() => {
    const m = {};
    (data?.days || []).forEach((d) => {
      const evs = d.events.filter((e) => filter === "all" || e.type === filter);
      if (evs.length) m[d.date] = evs;
    });
    return m;
  }, [data, filter]);

  const weekStart = useMemo(() => startOfWeek(new Date(`${selected}T00:00:00`)), [selected]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => ymd(addDays(weekStart, i))), [weekStart]);
  const today = ymd(new Date());

  const shiftWeek = (n) => setSelected(ymd(addDays(new Date(`${selected}T00:00:00`), n * 7)));

  const monthLabel = new Date(`${week[0]}T00:00:00`)
    .toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const FILTERS = [{ key: "all", label: "All", n: data?.total || 0 }]
    .concat(Object.entries(TYPES).map(([key, t]) => ({ key, label: t.label, n: counts[key] || 0 })));

  const daysToRender = mode === "day" ? [selected] : week;
  const hasAnything = daysToRender.some((d) => byDate[d]?.length);

  return (
    <div data-testid="calendar-page">
      <PageHeader eyebrow="Everything with a date, in one place" title="Business Calendar" />

      {/* Day / Week — the same pressed-track segmented control the rest of the
          app uses for "pick one of these framings of the same data". */}
      <div className="kr-pressed mb-3 flex w-fit items-center gap-1 rounded-pill p-1"
           role="group" aria-label="Calendar view" data-testid="cal-mode">
        {[{ k: "day", l: "Day" }, { k: "week", l: "Week" }].map((m) => (
          <button key={m.k} type="button" onClick={() => setMode(m.k)}
            aria-pressed={mode === m.k} data-testid={`cal-mode-${m.k}`}
            className={`flex h-9 items-center justify-center rounded-pill px-5 text-sm ${
              mode === m.k ? "kr-pop font-semibold text-foreground" : "text-foreground/60"
            }`}>
            {m.l}
          </button>
        ))}
      </div>

      {/* THE WEEK STRIP — the navigation, and the thing that makes this read as
          a calendar. Seven equal cells so the week has a shape; today carries a
          ring, the selected day is sunken, and a day with events carries a dot
          under its number. `flex-1 basis-0` rather than a 7-col grid: at 343px
          the cells land at 45px and equal flex basis keeps them even without a
          fixed track that could overflow. */}
      <div className="kr-bento mb-4 p-3" data-testid="cal-week-strip">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => shiftWeek(-1)} data-testid="cal-week-prev"
            aria-label="Previous week"
            className="grid h-9 w-9 place-items-center rounded-full text-foreground/70">
            <CaretLeft size={16} weight="bold" aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold" data-testid="cal-month-label">{monthLabel}</span>
          <button type="button" onClick={() => shiftWeek(1)} data-testid="cal-week-next"
            aria-label="Next week"
            className="grid h-9 w-9 place-items-center rounded-full text-foreground/70">
            <CaretRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-stretch gap-1">
          {week.map((iso, i) => {
            const evs = byDate[iso] || [];
            const isSel = iso === selected;
            const isToday = iso === today;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => { setSelected(iso); setMode("day"); }}
                aria-pressed={isSel}
                aria-label={dayTitle(iso)}
                data-testid={`cal-day-cell-${iso}`}
                className={`flex flex-1 basis-0 flex-col items-center gap-1 rounded-control py-2 ${
                  isSel ? "kr-pressed font-semibold" : "text-foreground/75"
                }`}
              >
                <span className="text-[10px] uppercase tracking-wide opacity-60">{DOW[i]}</span>
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm tabular-nums ${
                  isToday && !isSel ? "ring-1 ring-kr-ink/45" : ""
                }`}>
                  {Number(iso.slice(8, 10))}
                </span>
                {/* One dot for "something is on this day". Not a count: at 45px
                    a number under a number is noise, and the cell already
                    opens the day. */}
                <span aria-hidden="true"
                  className={`h-1 w-1 rounded-full ${evs.length ? "bg-kr-ink/55" : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters — one horizontal rail, not a wrapped block. Eight pills is
          ~560px of content in a 343px column; wrapping them cost three rows
          and ~150px above the calendar. The rail bleeds to the page gutter
          (-mx-4 px-4) so the last pill is cut by the SCREEN rather than
          stopping short of it, which is what tells you it keeps going. */}
      <div className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0"
           style={{ scrollbarWidth: "none" }} data-testid="cal-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            data-testid={`cal-filter-${f.key}`}
            className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-xs ${
              filter === f.key ? "kr-pressed font-semibold text-foreground" : "kr-pop text-foreground/70"
            }`}
          >
            {f.key === "all"
              ? <CalendarBlank size={14} weight="regular" aria-hidden="true" />
              : (() => { const I = TYPES[f.key].icon; return <I size={14} weight="regular" aria-hidden="true" />; })()}
            {f.label}
            <span className="tabular-nums opacity-60">{f.n}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-[76px] rounded-cardlg" />)}
        </div>
      ) : !hasAnything ? (
        <EmptyState
          title={mode === "day" ? "Nothing on this day." : "Nothing this week."}
          hint="Payment due dates, task deadlines, deliveries and complaints appear here."
          ctaLabel="Open Decision Desk"
          ctaTo="/inbox"
        />
      ) : (
        <div className="space-y-6" data-testid="calendar-days">
          {daysToRender.map((iso) => {
            const evs = byDate[iso] || [];
            // Week view keeps empty days so the week has a readable shape; day
            // view never reaches here empty (the empty state above catches it).
            if (mode === "week" && !evs.length) {
              return (
                <section key={iso} data-testid={`cal-day-${iso}`}>
                  <DayHeading iso={iso} today={today} n={0} />
                  <p className="pl-1 text-xs text-muted-foreground">Nothing scheduled</p>
                </section>
              );
            }
            return (
              <section key={iso} data-testid={`cal-day-${iso}`}>
                <DayHeading iso={iso} today={today} n={evs.length} />
                <div className="space-y-2.5">
                  {evs.map((e, i) => {
                    const t = TYPES[e.type] || TYPES.task;
                    const Icon = t.icon;
                    const clickable = !!e.contact_id;
                    return (
                      <div
                        key={e.ref_id || `${e.type}-${i}`}
                        data-testid={`cal-event-${e.type}-${i}`}
                        onClick={() => clickable && navigate(`/contacts/${e.contact_id}`)}
                        role={clickable ? "button" : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onKeyDown={clickable ? (ev) => { if (ev.key === "Enter") navigate(`/contacts/${e.contact_id}`); } : undefined}
                        className={`kr-bento flex items-center gap-3 p-3 ${clickable ? "kr-lift cursor-pointer" : ""}`}
                      >
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-tile text-white ${t.dot}`}>
                          <Icon size={17} weight="regular" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium leading-snug">{e.title}</p>
                          {e.subtitle && (
                            <p className="truncate text-xs text-muted-foreground">{e.subtitle}</p>
                          )}
                        </div>
                        {e.overdue && (
                          <span className="shrink-0 rounded-pill bg-kr-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                            Overdue
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The day heading shared by both views: name on the left, count on the right,
 *  a hairline filling the gap so the days read as separated bands. */
function DayHeading({ iso, today, n }) {
  return (
    <div className="mb-2.5 flex items-baseline gap-2.5">
      <span className={`text-sm font-semibold ${iso < today ? "text-kr-accent" : ""}`}>
        {dayTitle(iso)}
      </span>
      <span className="h-px flex-1 bg-nm-edge/50" />
      {n > 0 && <span className="text-xs tabular-nums text-muted-foreground">{n}</span>}
    </div>
  );
}

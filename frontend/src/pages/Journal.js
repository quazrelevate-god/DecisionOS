import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
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
} from "@phosphor-icons/react";

const EVENT_ICON = {
  created: GitCommit,
  approved: Stamp,
  rejected: XCircle,
  assigned: UserPlus,
  task: CheckSquare,
  event: Circle,
};

const EVENT_COLOR = {
  created: "text-brand-blue",
  approved: "text-green-600",
  rejected: "text-brand-red",
  assigned: "text-brand-ink",
  task: "text-amber-600",
  event: "text-muted-foreground",
};

function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  const yst = new Date();
  yst.setDate(today.getDate() - 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yst)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

function TimelineDialog({ decisionId, open, onClose }) {
  const { data, isLoading } = useQuery({
    queryKey: ["timeline", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}/timeline`).then((r) => r.data),
    enabled: !!decisionId && open,
  });
  const events = data?.timeline || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg rounded-none border-2 border-black" data-testid="timeline-dialog">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-black uppercase tracking-tighter pr-6">
            {data?.title || "Decision Timeline"}
          </DialogTitle>
          <DialogDescription className="sr-only">Git-style history of this decision</DialogDescription>
        </DialogHeader>
        {data?.status && <Chip value={data.status} className="w-fit" />}
        {isLoading ? (
          <p className="font-mono text-sm py-6">Loading timeline…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">No history recorded yet for this decision.</p>
        ) : (
          <ol className="mt-4 relative border-l-2 border-black/20 ml-2" data-testid="timeline-events">
            {events.map((e, i) => {
              const Icon = EVENT_ICON[e.kind] || Circle;
              const color = EVENT_COLOR[e.kind] || "text-muted-foreground";
              return (
                <li key={i} className="mb-6 ml-6" data-testid={`timeline-event-${i}`}>
                  <span className="absolute -left-[13px] flex items-center justify-center w-6 h-6 bg-white border-2 border-black">
                    <Icon size={13} weight="bold" className={color} />
                  </span>
                  <p className="text-sm font-medium leading-tight">{e.label}</p>
                  <p className="label-mono text-muted-foreground mt-1">
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

export default function Journal() {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [openId, setOpenId] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["journal", term],
    queryFn: () => api.get(`/journal?q=${encodeURIComponent(term)}`).then((r) => r.data),
  });

  const days = data?.days || [];
  const visibleDays = useMemo(() => days.filter((d) => d.decisions.length || d.notes.length), [days]);
  const hasContent = visibleDays.length > 0;

  return (
    <div>
      <PageHeader eyebrow="Your decision diary" title="CEO Journal" />

      <form
        onSubmit={(e) => { e.preventDefault(); setTerm(q); }}
        className="flex gap-2 mb-8 max-w-xl"
      >
        <div className="flex-1 flex items-center border border-black bg-white">
          <MagnifyingGlass size={18} weight="bold" className="ml-3 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="journal-search-input"
            placeholder="Search decisions & notes…"
            className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
          />
        </div>
        <button
          type="submit"
          data-testid="journal-search-btn"
          className="px-5 py-2.5 text-sm font-semibold uppercase tracking-wider bg-brand-ink text-white hover:bg-brand-red transition-colors"
        >
          Search
        </button>
      </form>

      {isLoading ? (
        <p className="font-mono text-sm">Loading journal…</p>
      ) : !hasContent ? (
        <EmptyState title="Nothing logged yet" hint="Decisions you capture and approve will appear here, grouped by day." />
      ) : (
        <div className="space-y-10" data-testid="journal-days">
          {visibleDays.map((day) => (
            <section key={day.date} data-testid={`journal-day-${day.date}`}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="font-heading text-xl font-black uppercase tracking-tight">{fmtDay(day.date)}</h2>
                <div className="flex-1 h-px bg-black/20" />
                <span className="label-mono text-muted-foreground">
                  {day.decisions.length} decision{day.decisions.length !== 1 ? "s" : ""}
                </span>
              </div>

              {day.decisions.length > 0 && (
                <>
                  <p className="text-sm text-muted-foreground mb-3">Today you decided…</p>
                  <div className="grid gap-3 sm:grid-cols-2 mb-4">
                    {day.decisions.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setOpenId(d.id)}
                        data-testid={`journal-decision-${d.id}`}
                        className="card-brutal p-4 text-left shadow-hover flex flex-col gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <Chip value={d.dtype} />
                          <Chip value={d.status} />
                        </div>
                        <p className="text-sm font-medium leading-tight">{d.title}</p>
                        <span className="label-mono text-brand-blue mt-auto">View timeline →</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {day.notes.length > 0 && (
                <div className="card-brutal divide-y divide-black/10" data-testid={`journal-notes-${day.date}`}>
                  {day.notes.map((n) => (
                    <div key={n.id} className="p-4 flex items-start gap-3">
                      <Note size={18} weight="bold" className="text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm leading-tight">{n.text}</p>
                        {n.tag && <Chip value={n.tag} className="mt-2" />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <TimelineDialog decisionId={openId} open={!!openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

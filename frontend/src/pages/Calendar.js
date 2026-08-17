import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, EmptyState } from "../components/common";
import {
  CurrencyCircleDollar, CheckSquare, Truck, Warning, Cake, CalendarBlank, UsersThree, AirplaneTakeoff,
} from "@phosphor-icons/react";

const TYPES = {
  meeting: { label: "Meetings", icon: UsersThree, color: "bg-primary", text: "text-brand-ink" },
  payment_due: { label: "Payments", icon: CurrencyCircleDollar, color: "bg-orange-500", text: "text-orange-600" },
  task: { label: "Tasks", icon: CheckSquare, color: "bg-brand-blue", text: "text-brand-blue" },
  delivery: { label: "Deliveries", icon: Truck, color: "bg-green-600", text: "text-green-600" },
  complaint: { label: "Complaints", icon: Warning, color: "bg-purple-600", text: "text-purple-600" },
  birthday: { label: "Birthdays", icon: Cake, color: "bg-brand-600", text: "text-brand-600" },
  leave: { label: "Leave", icon: AirplaneTakeoff, color: "bg-teal-600", text: "text-teal-600" },
};

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  const today = new Date();
  const tmr = new Date(); tmr.setDate(today.getDate() + 1);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, tmr)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export default function Calendar() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["calendar"],
    queryFn: () => api.get("/calendar?days=45").then((r) => r.data),
  });

  const days = (data?.days || [])
    .map((d) => ({ ...d, events: d.events.filter((e) => filter === "all" || e.type === filter) }))
    .filter((d) => d.events.length);
  const counts = data?.counts || {};

  return (
    <div>
      <PageHeader eyebrow="Everything with a date, in one place" title="Business Calendar" />

      <div className="flex flex-wrap gap-2 mb-8">
        <button
          onClick={() => setFilter("all")}
          data-testid="cal-filter-all"
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border transition-colors ${filter === "all" ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}
        >
          <CalendarBlank size={15} weight="bold" /> All ({data?.total || 0})
        </button>
        {Object.entries(TYPES).map(([key, t]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            data-testid={`cal-filter-${key}`}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border transition-colors ${filter === key ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}
          >
            <t.icon size={15} weight="bold" /> {t.label} ({counts[key] || 0})
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="font-mono text-sm">Loading calendar…</p>
      ) : days.length === 0 ? (
        // MPWA-12i: completing E2-13's sweep — this list surface never got its CTA.
        <EmptyState
          title="Nothing scheduled."
          hint="Payment due dates, task deadlines, deliveries and complaints appear here."
          ctaLabel="+ Open Decision Desk"
          ctaTo="/inbox"
        />
      ) : (
        <div className="space-y-8" data-testid="calendar-days">
          {days.map((day) => (
            <section key={day.date} data-testid={`cal-day-${day.date}`}>
              <div className="flex items-center gap-3 mb-3">
                <span className={`font-heading text-lg font-black uppercase tracking-tight ${day.date < new Date().toISOString().slice(0, 10) ? "text-brand-600" : ""}`}>
                  {fmtDay(day.date)}
                </span>
                <span className="label-mono text-muted-foreground">{day.date}</span>
                <div className="flex-1 h-px bg-black/20" />
              </div>
              <div className="space-y-2">
                {day.events.map((e, i) => {
                  const t = TYPES[e.type] || TYPES.task;
                  return (
                    <div
                      key={e.ref_id || `${e.type}-${i}`}
                      data-testid={`cal-event-${e.type}-${i}`}
                      onClick={() => e.contact_id && navigate(`/contacts/${e.contact_id}`)}
                      className={`card-brutal p-3 flex items-center gap-3 ${e.contact_id ? "cursor-pointer shadow-hover" : ""}`}
                    >
                      <div className={`w-9 h-9 flex items-center justify-center border border-border text-white shrink-0 ${t.color}`}>
                        <t.icon size={17} weight="bold" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-tight truncate">{e.title}</p>
                        {e.subtitle && <p className="label-mono text-muted-foreground truncate">{e.subtitle}</p>}
                      </div>
                      {e.overdue && <span className="px-2 py-0.5 text-xs  font-semibold border border-border bg-danger-600 text-white shrink-0">Overdue</span>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

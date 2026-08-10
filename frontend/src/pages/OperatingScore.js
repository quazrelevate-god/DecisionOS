import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Zap, CircleDollarSign, TrendingUp, MessagesSquare, Trophy, Sparkles,
  ChevronRight, Gauge, MoreHorizontal,
} from "lucide-react";

import api from "../lib/api";
import { Skeleton } from "../components/common";
import {
  Donut, Legend, SectionHead, Row, IconTile, StatTriple, RoundButton, Pill,
} from "../components/studio";
import { cn } from "../lib/utils";

/* Reference screen 2: a thick donut with value pills on the rim, a three-column
   legend underneath, then a ranked list. Each category owns one accent. */
const CATS = [
  { key: "execution", label: "Execution", icon: Zap, accent: "peri" },
  { key: "finance", label: "Finance", icon: CircleDollarSign, accent: "butter" },
  { key: "sales", label: "Sales", icon: TrendingUp, accent: "sage" },
  { key: "responsiveness", label: "Responsiveness", icon: MessagesSquare, accent: "peri" },
];

export default function OperatingScore() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["operating-score"],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });

  const ranked = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data]
  );

  const company = data?.company;
  const stats = data?.stats;
  // A payload without `company` (or without stats) is the not-ready state,
  // not a crash — older tenants and partial responses both hit this.
  const enough = !!company && !!stats && company.enough_data !== false;

  // The donut reads the three categories that actually have a score, so the
  // ring always sums to something meaningful rather than padding with zeroes.
  const segments = useMemo(() => {
    if (!company) return [];
    return CATS.filter((c) => company.categories?.[c.key] != null)
      .slice(0, 3)
      .map((c) => ({ key: c.key, label: c.label, value: company.categories[c.key], accent: c.accent }));
  }, [company]);

  const segTotal = segments.reduce((n, s) => n + s.value, 0) || 1;

  if (isLoading || !data || !stats) {
    return (
      <div className="mx-auto max-w-3xl pb-4">
        <Skeleton className="h-8 w-48 rounded-full" />
        <Skeleton className="mx-auto mt-8 h-56 w-56 rounded-full" />
        <Skeleton className="mt-8 h-20 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl pb-4">
      {/* Title row — mirrors the reference's "Monthly Profits" header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-extrabold tracking-tight">Operating Score</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {enough ? `Company health at ${company.overall} of 100` : "Still learning your business"}
          </p>
        </div>
        <RoundButton icon={MoreHorizontal} accent="plain" label="Score options" onClick={() => navigate("/coach")} />
      </div>

      {enough ? (
        <>
          <div className="rounded-3xl bg-card px-4 py-8 shadow-sm" data-testid="operating-overall">
            <Donut
              segments={segments}
              total={company.overall}
              totalLabel="Overall"
              format={(v) => `${v}`}
              size={224}
              thickness={30}
            />
            <p
              data-testid="operating-overall-score"
              className="sr-only"
            >
              {company.overall}
            </p>

            <Legend
              className="mt-8"
              items={segments.map((s) => ({
                key: s.key,
                label: s.label,
                percent: Math.round((s.value / segTotal) * 100),
                accent: s.accent,
              }))}
            />
          </div>

          {/* Any category the donut couldn't show still gets a readout */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            {CATS.map((c) => {
              const v = company.categories?.[c.key];
              return (
                <div
                  key={c.key}
                  data-testid={`operating-cat-${c.key}`}
                  className="flex items-center gap-2.5 rounded-2xl bg-card p-3.5 shadow-sm"
                >
                  <IconTile icon={c.icon} accent={c.accent} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-muted-foreground">{c.label}</span>
                    <span data-numeric className="block text-lg font-extrabold tracking-tight">
                      {v ?? "—"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-3xl bg-card p-6 shadow-sm" data-testid="operating-not-ready">
          <div className="flex items-center gap-3">
            <IconTile icon={Gauge} accent="peri" size="lg" />
            <div className="min-w-0">
              <p className="text-[17px] font-bold tracking-tight">We're still learning your business</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                The score starts once there's real activity — roughly 3+ actionable tasks or your first invoices.
              </p>
            </div>
          </div>
          <StatTriple
            className="mt-6"
            items={[
              { key: "tasks", label: "Actionable", value: stats.done + stats.open, icon: Zap, accent: "peri" },
              { key: "done", label: "Completed", value: stats.done, icon: TrendingUp, accent: "sage" },
              { key: "dec", label: "Decisions", value: stats.total_decisions, icon: Sparkles, accent: "butter" },
            ]}
          />
        </div>
      )}

      {/* Quick figures */}
      <div className="mt-6 grid grid-cols-4 gap-2">
        {[
          { label: "Done", value: stats.done, accent: "sage" },
          { label: "Open", value: stats.open, accent: "peri" },
          { label: "Overdue", value: stats.overdue, urgent: stats.overdue > 0 },
          { label: "Complaints", value: stats.open_complaints, urgent: stats.open_complaints > 0 },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl bg-card p-3 text-center shadow-sm">
            <p
              data-numeric
              className={cn("text-xl font-extrabold tracking-tight", s.urgent && "text-destructive")}
            >
              {s.value}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Team execution */}
      <div className="mt-8">
        <SectionHead
          title="Team execution"
          subtitle="Tap anyone for their full activity and AI coaching"
          action={<Pill tone="sage">{ranked.length} people</Pill>}
        />
        <div className="divide-y divide-border rounded-3xl bg-card px-4 shadow-sm" data-testid="operating-employees">
          {ranked.map((e, i) => (
            <Row
              key={e.id}
              onClick={() => navigate(`/coach?user=${e.id}`)}
              data-testid={`operating-emp-${e.id}`}
              leading={
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-sm font-extrabold text-muted-foreground">
                  {i + 1}
                </span>
              }
              title={e.name}
              subtitle={`${e.role} · ${e.done} done · ${e.open} open${e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}`}
              amount={e.score != null ? e.score : "—"}
              trailing={<ChevronRight size={16} strokeWidth={2} className="ml-1 shrink-0 text-muted-foreground" />}
            />
          ))}
          {ranked.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No team activity to rank yet.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <IconTile icon={Trophy} accent="butter" size="sm" />
        <p className="text-xs text-muted-foreground">
          Scores update as work is completed and money moves.
        </p>
      </div>
    </div>
  );
}

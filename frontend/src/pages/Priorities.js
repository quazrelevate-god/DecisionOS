import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { Sparkle, TrendUp, CurrencyCircleDollar, Warning, Timer } from "@phosphor-icons/react";

const AXES = [
  { key: "business_impact", label: "Impact", icon: TrendUp, color: "bg-brand-blue" },
  { key: "revenue", label: "Revenue", icon: CurrencyCircleDollar, color: "bg-green-600" },
  { key: "risk", label: "Risk", icon: Warning, color: "bg-brand-red" },
  { key: "urgency", label: "Urgency", icon: Timer, color: "bg-orange-500" },
];

function ScoreBar({ label, value, color, Icon }) {
  return (
    <div className="flex items-center gap-2" data-testid={`score-${label.toLowerCase()}`}>
      <Icon size={13} weight="bold" className="text-muted-foreground shrink-0" />
      <span className="label-mono w-16 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-black/10 border border-black/20">
        <div className={`h-full ${color}`} style={{ width: `${value || 0}%` }} />
      </div>
      <span className="label-mono w-7 text-right">{value || 0}</span>
    </div>
  );
}

export default function Priorities() {
  const qc = useQueryClient();
  const [ranked, setRanked] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["priorities"],
    queryFn: () => api.post("/tasks/prioritize").then((r) => r.data),
    onSuccess: (d) => setRanked(d.tasks),
  });

  const rerank = useMutation({
    mutationFn: () => api.post("/tasks/prioritize?force=true").then((r) => r.data),
    onSuccess: (d) => {
      setRanked(d.tasks);
      qc.setQueryData(["priorities"], d);
      toast.success(`Re-scored ${d.scored} task(s) with AI`);
    },
    onError: () => toast.error("Could not re-prioritize right now"),
  });

  const tasks = ranked || data?.tasks || [];

  return (
    <div>
      <PageHeader eyebrow="AI-ranked by what matters most" title="Priorities">
        <button
          onClick={() => rerank.mutate()}
          disabled={rerank.isPending}
          data-testid="reprioritize-btn"
          className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider bg-brand-yellow hover:shadow-brutal-sm transition-all disabled:opacity-50"
        >
          <Sparkle size={16} weight="bold" /> {rerank.isPending ? "Scoring…" : "Re-prioritize"}
        </button>
      </PageHeader>

      {isLoading ? (
        <p className="font-mono text-sm">AI is prioritizing your work…</p>
      ) : tasks.length === 0 ? (
        <EmptyState title="No open tasks" hint="Tasks you capture will be ranked here by AI." />
      ) : (
        <div className="space-y-4" data-testid="priorities-list">
          {tasks.map((t, i) => {
            const s = t.ai_scores || {};
            const score = s.priority_score;
            return (
              <div key={t.id} data-testid={`priority-task-${t.id}`} className="card-brutal p-5 flex flex-col lg:flex-row gap-5">
                <div className="flex items-center gap-4 lg:w-56 shrink-0">
                  <div className="font-heading text-3xl font-black tracking-tighter text-black/30 w-8">{i + 1}</div>
                  <div className="w-16 h-16 flex flex-col items-center justify-center border-2 border-black bg-brand-ink text-white shrink-0">
                    <span className="font-heading text-2xl font-black leading-none" data-testid={`priority-score-${t.id}`}>
                      {score != null ? score : "—"}
                    </span>
                    <span className="text-[9px] uppercase tracking-wider">score</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Chip value={t.priority} />
                    <Chip value={t.status} />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight">{t.title}</p>
                  {s.reason && <p className="text-xs text-muted-foreground mt-1 italic">{s.reason}</p>}
                  <p className="label-mono text-muted-foreground mt-2">
                    {t.assignee_name || t.assignee_role || "Unassigned"}
                    {t.due_date && ` · due ${t.due_date.slice(0, 10)}`}
                  </p>
                </div>

                <div className="lg:w-72 shrink-0 space-y-1.5">
                  {AXES.map((a) => (
                    <ScoreBar key={a.key} label={a.label} value={s[a.key]} color={a.color} Icon={a.icon} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

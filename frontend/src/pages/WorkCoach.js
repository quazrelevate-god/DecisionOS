import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, Link } from "react-router-dom";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import { toast } from "sonner";
import {
  Sparkle, CheckCircle, TrendUp, Lightbulb, Trophy, Target, SealCheck, Camera, Microphone, ShieldWarning,
} from "@phosphor-icons/react";

function Stat({ label, value, suffix = "", accent = "" }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4" data-testid={`coach-stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <p className="text-label uppercase text-text-secondary">{label}</p>
      <p className={` text-3xl font-black tracking-tight mt-1 ${accent}`}>{value}{suffix}</p>
    </div>
  );
}

export default function WorkCoach() {
  const [params] = useSearchParams();
  const userId = params.get("user");
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["work-coach", userId],
    queryFn: () => api.get(`/work-coach${userId ? `?user_id=${userId}` : ""}`).then((r) => r.data),
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: () => api.post(`/work-coach/refresh${userId ? `?user_id=${userId}` : ""}`).then((r) => r.data),
    onSuccess: (d) => { qc.setQueryData(["work-coach", userId], d); toast.success("AI coach updated"); },
    onError: () => toast.error("Could not refresh coaching"),
  });

  if (isError) {
    const status = error?.response?.status;
    return (
      <div>
        <PageHeader eyebrow="AI Work Coach" title="Access denied" />
        <div className="rounded-lg border border-hairline bg-surface p-8 text-center" data-testid="coach-error">
          <ShieldWarning size={32} weight="bold" className="text-primary-text mx-auto mb-3" />
          <p className="text-lg font-extrabold uppercase tracking-tight">
            {status === 403 ? "Not allowed" : "Couldn't load coaching"}
          </p>
          <p className="text-sm text-text-secondary mt-1">
            {status === 403
              ? "Only the owner can view another team member's coaching. You can always view your own."
              : "Something went wrong. Please try again."}
          </p>
          <Link to="/coach" className="inline-block mt-4 border border-hairline px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-surface-hover transition-colors">
            View my coach
          </Link>
        </div>
      </div>
    );
  }
  if (isLoading || !data) return <div className="text-label uppercase text-sm py-20 text-center">Loading your coach…</div>;

  const { target, stats, summary } = data;
  const s = refresh.data?.summary || summary;

  return (
    <div>
      <PageHeader eyebrow={`${target.name} · ${target.role}`} title="AI Work Coach">
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="coach-refresh-btn"
          className="flex items-center gap-2 border border-hairline px-4 py-2 text-sm font-semibold uppercase tracking-wider bg-status-pending-bg hover:shadow-xs transition-all disabled:opacity-50">
          <Sparkle size={16} weight="bold" /> {refresh.isPending ? "Analyzing…" : s ? "Refresh" : "Generate coaching"}
        </button>
      </PageHeader>

      {/* Performance stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Completed Tasks" value={stats.completed} accent="text-status-completed-fg" />
        <Stat label="Open" value={stats.open} />
        <Stat label="Overdue" value={stats.overdue} accent={stats.overdue > 0 ? "text-primary-text" : ""} />
        <Stat label="Completion" value={stats.completion_rate} suffix="%" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <div className="rounded-lg border border-hairline bg-surface p-4 flex items-center gap-3">
          <SealCheck size={22} weight="bold" className="text-primary-text" />
          <div><p className="text-label uppercase text-text-secondary">Proof uploads</p><p className="text-xl font-black">{stats.proof_upload_rate}%</p></div>
        </div>
        <div className="rounded-lg border border-hairline bg-surface p-4 flex items-center gap-3">
          <Target size={22} weight="bold" className="text-primary-text" />
          <div><p className="text-label uppercase text-text-secondary">Plans used</p><p className="text-xl font-black">{stats.plans_used}</p></div>
        </div>
        <div className="rounded-lg border border-hairline bg-surface p-4 flex items-center gap-3">
          <Camera size={22} weight="bold" className="text-text" />
          <div><p className="text-label uppercase text-text-secondary">Photos</p><p className="text-xl font-black">{stats.photos_uploaded}</p></div>
        </div>
        <div className="rounded-lg border border-hairline bg-surface p-4 flex items-center gap-3">
          <Microphone size={22} weight="bold" className="text-text" />
          <div><p className="text-label uppercase text-text-secondary">Voice updates</p><p className="text-xl font-black">{stats.voice_updates}</p></div>
        </div>
      </div>

      {/* AI review */}
      {!s ? (
        <div className="rounded-lg border border-hairline bg-surface p-8 text-center" data-testid="coach-empty">
          <Trophy size={32} weight="bold" className="text-primary-text mx-auto mb-3" />
          <p className="text-lg font-extrabold uppercase tracking-tight">No coaching yet</p>
          <p className="text-sm text-text-secondary mt-1">Generate an AI performance review based on the stats above.</p>
        </div>
      ) : (
        <div className="space-y-5" data-testid="coach-summary">
          <div className="rounded-lg border border-hairline bg-surface p-6 bg-primary text-primary-foreground">
            <p className="flex items-start gap-3 text-lg font-bold leading-snug">
              <Sparkle size={22} weight="fill" className="text-brand-yellow shrink-0 mt-0.5" /> {s.headline}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-lg border border-hairline bg-surface p-5" data-testid="coach-strengths">
              <div className="flex items-center gap-2 mb-3">
                <TrendUp size={18} weight="bold" className="text-status-completed-fg" />
                <h2 className="font-extrabold uppercase tracking-tight">Strengths</h2>
              </div>
              <ul className="space-y-2">
                {s.strengths.map((it, i) => (
                  <li key={`str-${i}-${it.slice(0, 24)}`} className="flex items-start gap-2 text-sm">
                    <CheckCircle size={16} weight="fill" className="text-status-completed-fg shrink-0 mt-0.5" /> {it}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-hairline bg-surface p-5" data-testid="coach-improvements">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb size={18} weight="bold" className="text-status-pending-fg" />
                <h2 className="font-extrabold uppercase tracking-tight">Areas to improve</h2>
              </div>
              <ul className="space-y-2">
                {s.improvements.map((it, i) => (
                  <li key={`imp-${i}-${it.slice(0, 24)}`} className="flex items-start gap-2 text-sm">
                    <span className="text-status-pending-fg font-bold shrink-0">→</span> {it}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-lg border border-hairline bg-surface p-5 border-l-4 border-l-brand-red" data-testid="coach-recommendation">
            <p className="text-label uppercase text-primary-text mb-1">AI Recommendation</p>
            <p className="text-sm font-medium leading-relaxed">{s.recommendation}</p>
          </div>

          {s.generated_at && <p className="text-label uppercase text-text-secondary">Updated {new Date(s.generated_at).toLocaleString()}</p>}
        </div>
      )}
    </div>
  );
}

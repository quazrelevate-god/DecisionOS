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
    <div className="card-brutal p-4" data-testid={`coach-stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className={`font-heading text-3xl font-black tracking-tight mt-1 ${accent}`}>{value}{suffix}</p>
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
        <div className="card-brutal p-8 text-center" data-testid="coach-error">
          <ShieldWarning size={32} weight="bold" className="text-brand-600 mx-auto mb-3" />
          <p className="text-base font-medium">
            {status === 403 ? "Not allowed" : "Couldn't load coaching"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {status === 403
              ? "Only the owner can view another team member's coaching. You can always view your own."
              : "Something went wrong. Please try again."}
          </p>
          <Link to="/coach" className="inline-block mt-4 border border-border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
            View my coach
          </Link>
        </div>
      </div>
    );
  }
  if (isLoading || !data) return <div className="font-mono text-sm py-20 text-center">Loading your coach…</div>;

  const { target, stats, summary } = data;
  const s = refresh.data?.summary || summary;

  return (
    <div>
      <PageHeader eyebrow={`${target.name} · ${target.role}`} title="AI Work Coach">
        <button onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="coach-refresh-btn"
          className="flex items-center gap-2 border border-border px-4 py-2 text-sm font-medium bg-caution-50 transition-all disabled:opacity-50">
          <Sparkle size={16} weight="bold" /> {refresh.isPending ? "Analyzing…" : s ? "Refresh" : "Generate coaching"}
        </button>
      </PageHeader>

      {/* Performance stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Completed Tasks" value={stats.completed} accent="text-green-600" />
        <Stat label="Open" value={stats.open} />
        <Stat label="Overdue" value={stats.overdue} accent={stats.overdue > 0 ? "text-danger-600" : ""} />
        <Stat label="Completion" value={stats.completion_rate} suffix="%" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <div className="card-brutal p-4 flex items-center gap-3">
          <SealCheck size={22} weight="bold" className="text-brand-blue" />
          <div><p className="label-mono text-muted-foreground">Proof uploads</p><p className="font-heading text-xl font-black">{stats.proof_upload_rate}%</p></div>
        </div>
        <div className="card-brutal p-4 flex items-center gap-3">
          <Target size={22} weight="bold" className="text-brand-600" />
          <div><p className="label-mono text-muted-foreground">Plans used</p><p className="font-heading text-xl font-black">{stats.plans_used}</p></div>
        </div>
        <div className="card-brutal p-4 flex items-center gap-3">
          <Camera size={22} weight="bold" className="text-brand-ink" />
          <div><p className="label-mono text-muted-foreground">Photos</p><p className="font-heading text-xl font-black">{stats.photos_uploaded}</p></div>
        </div>
        <div className="card-brutal p-4 flex items-center gap-3">
          <Microphone size={22} weight="bold" className="text-brand-ink" />
          <div><p className="label-mono text-muted-foreground">Voice updates</p><p className="font-heading text-xl font-black">{stats.voice_updates}</p></div>
        </div>
      </div>

      {/* AI review */}
      {!s ? (
        <div className="card-brutal p-8 text-center" data-testid="coach-empty">
          <Trophy size={32} weight="bold" className="text-brand-600 mx-auto mb-3" />
          <p className="text-base font-medium">No coaching yet</p>
          <p className="text-sm text-muted-foreground mt-1">Generate an AI performance review based on the stats above.</p>
        </div>
      ) : (
        <div className="space-y-5" data-testid="coach-summary">
          <div className="card-brutal p-6 bg-primary text-primary-foreground">
            <p className="flex items-start gap-3 text-lg font-medium leading-snug">
              <Sparkle size={22} weight="fill" className="text-brand-yellow shrink-0 mt-0.5" /> {s.headline}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div className="card-brutal p-5" data-testid="coach-strengths">
              <div className="flex items-center gap-2 mb-3">
                <TrendUp size={18} weight="bold" className="text-green-600" />
                <h2 className="font-medium">Strengths</h2>
              </div>
              <ul className="space-y-2">
                {s.strengths.map((it, i) => (
                  <li key={`str-${i}-${it.slice(0, 24)}`} className="flex items-start gap-2 text-sm">
                    <CheckCircle size={16} weight="fill" className="text-green-600 shrink-0 mt-0.5" /> {it}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card-brutal p-5" data-testid="coach-improvements">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb size={18} weight="bold" className="text-amber-600" />
                <h2 className="font-medium">Areas to improve</h2>
              </div>
              <ul className="space-y-2">
                {s.improvements.map((it, i) => (
                  <li key={`imp-${i}-${it.slice(0, 24)}`} className="flex items-start gap-2 text-sm">
                    <span className="text-amber-600 font-bold shrink-0">→</span> {it}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card-brutal p-5 border-l-4 border-l-brand-600" data-testid="coach-recommendation">
            <p className="label-mono text-brand-600 mb-1">AI Recommendation</p>
            <p className="text-sm font-medium leading-relaxed">{s.recommendation}</p>
          </div>

          {s.generated_at && <p className="label-mono text-muted-foreground">Updated {new Date(s.generated_at).toLocaleString()}</p>}
        </div>
      )}
    </div>
  );
}

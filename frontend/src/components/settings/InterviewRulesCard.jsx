import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle, NotePencil, ShieldCheck } from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";

/* Audit B-01 (2026-10-08) — WHAT THE INTERVIEW'S APPROVAL RULES BECAME.
   The founder told the sign-up interview who signs off on what ("Sales can
   confirm orders up to 5 lakh", "HR approves leave"). Those answers now
   become settings (services/ai/approval_rules.py); this card lists each rule
   in the founder's own words beside what it became, so the setup can be
   checked — and says plainly which rules are only notes, because nothing in
   the app can enforce them yet. "Apply again" re-reads them, e.g. after the
   teams or pipelines were changed. */
export function InterviewRulesCard() {
  const { user, refreshTenant } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ["approval-rules"], queryFn: () => api.get("/tenant/approval-rules").then((r) => r.data) });
  const rules = q.data?.rules || [];
  const applied = q.data?.applied || [];
  if (q.isLoading) return <div className="kr-bento ds-skeleton h-32" aria-hidden="true" />;
  if (!rules.length) return null;

  const byRule = Object.fromEntries(applied.map((a) => [a.rule, a]));
  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/tenant/approval-rules/apply");
      const n = (data.applied || []).filter((a) => a.setting).length;
      toast.success(n ? `${n} rule${n === 1 ? "" : "s"} set up as settings` : "Nothing here could become a setting yet");
      qc.invalidateQueries({ queryKey: ["approval-rules"] });
      await refreshTenant?.();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't apply the rules");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="interview-rules-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <ShieldCheck size={18} weight="bold" className="text-muted-foreground" aria-hidden="true" /> Approvals from your sign-up
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            What you told the interview about who signs off on what, and the setting each one became. Change any of them below.
          </p>
        </div>
        {isOwner && (
          <button type="button" onClick={apply} disabled={busy} data-testid="interview-rules-apply"
            className="kr-pop h-10 shrink-0 rounded-pill px-4 text-sm font-medium disabled:opacity-50">
            {busy ? "Applying…" : applied.length ? "Apply again" : "Set these up"}
          </button>
        )}
      </div>
      <ul className="mt-4 space-y-2">
        {rules.map((r) => {
          const a = byRule[r.name];
          return (
            <li key={r.name} className="rounded-2xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.05]" data-testid="interview-rule">
              <p className="text-sm font-semibold text-slate-900">{r.name}</p>
              {r.description && <p className="mt-0.5 text-xs text-slate-500">{r.description}</p>}
              <p className={`mt-1.5 flex items-start gap-1.5 text-xs ${a?.setting ? "text-emerald-800" : "text-slate-600"}`}>
                {a?.setting
                  ? <CheckCircle size={14} weight="fill" aria-hidden="true" className="mt-px shrink-0" />
                  : <NotePencil size={14} aria-hidden="true" className="mt-px shrink-0" />}
                <span>{a ? a.became : "Not set up yet."}</span>
              </p>
              {a?.still_a_note && (
                <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600" data-testid="interview-rule-note">
                  <NotePencil size={14} aria-hidden="true" className="mt-px shrink-0" />
                  <span>Not a setting yet: {a.still_a_note}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

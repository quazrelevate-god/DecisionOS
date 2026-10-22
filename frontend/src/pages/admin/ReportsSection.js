import { CARD_BASE, ADMIN_H3, ADMIN_INP } from "./adminStyle";
// Reports queue (2026-10-08; redesigned 2026-10-22). What people flagged from
// inside the app — AI answers, colleagues' content, people — for Google Play's
// AI-content and UGC policies. Triage here: read what was reported, say what
// was done, set a status. Every change is audited server-side (routers/reports.py).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { ArrowClockwise, Flag } from "@phosphor-icons/react";
import { useAdmin, useAdminGet, errText, fmtAgo, fmtDateTime, Btn, Chip, Segmented, AdminPage, Loading, Empty, LoadError, LinkOut } from "./adminUi";
import { reportStatusLabel, reportStatusTone, humanize } from "./adminLabels";

const STATUSES = ["open", "reviewing", "actioned", "dismissed"];
const KIND_LABEL = { ai_output: "AI answer", content: "Content", user: "A person" };
const REASON_LABEL = {
  offensive: "Offensive", harassment: "Harassment", sexual: "Sexual", violent: "Violent", hateful: "Hateful",
  self_harm: "Self-harm", misleading: "Misleading", spam: "Spam", privacy: "Privacy", other: "Other",
};
const NEXT = { open: ["reviewing", "actioned", "dismissed"], reviewing: ["actioned", "dismissed"], actioned: ["reviewing"], dismissed: ["reviewing"] };
const VERB = { reviewing: "Start reviewing", actioned: "Mark acted on", dismissed: "Dismiss", open: "Reopen" };

function ReportCard({ r, onSaved }) {
  const { go, canWrite } = useAdmin();
  const [note, setNote] = useState(r.admin_note || "");
  const [busy, setBusy] = useState("");
  const setStatus = async (status) => {
    setBusy(status);
    try {
      await api.patch(`/admin/reports/${r.id}`, { status, note: note.trim() || undefined });
      toast.success(`Marked ${reportStatusLabel(status).toLowerCase()}`);
      onSaved();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(""); }
  };
  return (
    <li className={`${CARD_BASE} p-5`} data-testid={`admin-report-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={reportStatusTone(r.status)}>{reportStatusLabel(r.status)}</Chip>
        <span className="text-sm font-medium text-slate-900">{KIND_LABEL[r.kind] || humanize(r.kind)} · {REASON_LABEL[r.reason] || humanize(r.reason)}</span>
        <span className="ml-auto text-xs text-slate-500" title={fmtDateTime(r.created_at)}>{fmtAgo(r.created_at)}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {r.tenant_id ? <LinkOut onClick={() => go(`workspaces/${r.tenant_id}`)}>{r.tenant_name || "Workspace"}</LinkOut> : <span>From sign-up, no workspace</span>}
        <span>· reported by {r.reporter_name || "someone anonymous"}</span>
      </div>
      {r.details && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800"><span className="text-slate-500">They said: </span>{r.details}</p>}
      {r.snapshot && (
        <div className="mt-3">
          <p className={ADMIN_H3}>What was reported</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/[0.04] p-3 font-sans text-sm text-slate-800">{r.snapshot}</pre>
        </div>
      )}
      {r.context && (
        <div className="mt-3">
          <p className={ADMIN_H3}>What led to it</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/[0.04] p-3 font-sans text-xs text-slate-700">{r.context}</pre>
        </div>
      )}
      {(r.history || []).length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-slate-500">
          {r.history.map((h, i) => <li key={i}>{fmtDateTime(h.at)} · {h.by} marked it {reportStatusLabel(h.status).toLowerCase()}{h.note ? `: ${h.note}` : ""}</li>)}
        </ul>
      )}
      {canWrite && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do about it?"
            className={`${ADMIN_INP} h-9 min-w-0 flex-1`} data-testid={`admin-report-note-${r.id}`} />
          {(NEXT[r.status] || STATUSES).map((s) => (
            <Btn key={s} size="sm" variant={s === "actioned" ? "primary" : "quiet"} busy={busy === s} disabled={!!busy}
              onClick={() => setStatus(s)} data-testid={`admin-report-${s}-${r.id}`}>{VERB[s]}</Btn>
          ))}
        </div>
      )}
    </li>
  );
}

export function ReportsSection() {
  const [filter, setFilter] = useState("open");
  const { data, error, reload } = useAdminGet(`/admin/reports${filter ? `?status=${filter}` : ""}`);
  const counts = useMemo(() => data?.counts || {}, [data]);
  const options = useMemo(() => [
    ...STATUSES.map((s) => ({ value: s, label: reportStatusLabel(s), count: counts[s] ?? 0 })),
    { value: "", label: "All" },
  ], [counts]);
  return (
    <AdminPage title="Reports" testid="admin-reports"
      subtitle="Flagged from inside the app. Google Play expects every report to be looked at and acted on."
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <div className="mb-4"><Segmented value={filter} onChange={setFilter} options={options} ariaLabel="Status" testid="admin-reports-filter" /></div>
      {error && !data ? <LoadError what="reports" onRetry={reload} /> : !data ? <Loading /> : data.reports.length === 0 ? (
        <div className={CARD_BASE}><Empty icon={Flag} title={filter ? `No ${reportStatusLabel(filter).toLowerCase()} reports.` : "No reports yet."}
          hint={filter === "open" ? "Nothing is waiting for review." : "Try another status."} /></div>
      ) : (
        <ul className="space-y-3">
          {data.reports.map((r) => <ReportCard key={`${r.id}-${r.status}`} r={r} onSaved={reload} />)}
        </ul>
      )}
    </AdminPage>
  );
}

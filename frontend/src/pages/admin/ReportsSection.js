import { ADMIN_BTN, ADMIN_H2, ADMIN_H3, ADMIN_INP, ADMIN_SEL, CARD_BASE } from "./adminStyle";
// Reports queue (2026-10-08). What people flagged from inside the app — AI
// answers, colleagues' content, people — for Google Play's AI-content and UGC
// policies. Triage here: read what was reported, set a status, leave a note.
// Every change is audited server-side (routers/reports.py).
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, Flag } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-4`;
const STATUSES = ["open", "reviewing", "actioned", "dismissed"];
const STATUS_COLOR = { open: "#cf222e", reviewing: "#7d4e00", actioned: "#1a7f37", dismissed: "#57606a" };
const KIND_LABEL = { ai_output: "AI output", content: "Content", user: "Person" };
const REASON_LABEL = {
  offensive: "Offensive", harassment: "Harassment", sexual: "Sexual", violent: "Violent", hateful: "Hateful",
  self_harm: "Self-harm", misleading: "Misleading", spam: "Spam", privacy: "Privacy", other: "Other",
};
const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

function ReportCard({ r, onSaved }) {
  const [note, setNote] = useState(r.admin_note || "");
  const [busy, setBusy] = useState(false);
  const setStatus = async (status) => {
    setBusy(true);
    try {
      await api.patch(`/admin/reports/${r.id}`, { status, note: note.trim() || undefined });
      toast.success(`Marked ${status}`);
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); } finally { setBusy(false); }
  };
  return (
    <div className={CARD} data-testid={`admin-report-${r.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[9px] uppercase px-2 py-1 border rounded"
          style={{ color: STATUS_COLOR[r.status], borderColor: `${STATUS_COLOR[r.status]}55` }}>{r.status}</span>
        <span className="text-sm font-medium text-slate-900">{KIND_LABEL[r.kind] || r.kind} · {REASON_LABEL[r.reason] || r.reason}</span>
        <span className="font-mono text-[11px] text-slate-600">{r.target_type}{r.target_id ? ` · ${r.target_id}` : ""}</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-slate-600">
        {r.tenant_name || (r.tenant_id ? r.tenant_id : "no workspace (signup)")} · by {r.reporter_name || r.reporter_id || "anonymous"} · {ts(r.created_at)}
      </div>
      {r.details && <p className="mt-2 text-sm text-slate-800 whitespace-pre-wrap"><span className="text-slate-500">Reporter says: </span>{r.details}</p>}
      {r.snapshot && (
        <div className="mt-2">
          <p className={ADMIN_H3}>Reported {r.kind === "user" ? "person" : "content"}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/[0.04] p-3 text-xs text-slate-800">{r.snapshot}</pre>
        </div>
      )}
      {r.context && (
        <div className="mt-2">
          <p className={ADMIN_H3}>Context / prompt</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-900/[0.04] p-3 text-xs text-slate-700">{r.context}</pre>
        </div>
      )}
      {(r.history || []).length > 0 && (
        <div className="mt-2 font-mono text-[10px] text-slate-500 space-y-0.5">
          {r.history.map((h, i) => <div key={i}>{ts(h.at)} · {h.by} → {h.status}{h.note ? ` — ${h.note}` : ""}</div>)}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (what was done)"
          className={`${ADMIN_INP} min-w-0 flex-1`} data-testid={`admin-report-note-${r.id}`} />
        {STATUSES.filter((s) => s !== r.status).map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => setStatus(s)}
            data-testid={`admin-report-${s}-${r.id}`}
            className={ADMIN_BTN + " border-slate-900/15 text-slate-700 hover:text-slate-900"}>
            {busy ? <Spinner size={12} className="animate-spin" /> : null} {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReportsSection() {
  const [filter, setFilter] = useState("open");
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/admin/reports${filter ? `?status=${filter}` : ""}`);
      setData(r.data);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;

  return (
    <div data-testid="admin-reports">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className={`${ADMIN_H2} flex items-center gap-2`}><Flag size={18} /> Reports</h2>
        <div className="flex gap-2 items-center">
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={ADMIN_SEL} data-testid="admin-reports-filter">
            <option value="">all</option>
            {STATUSES.map((s) => <option key={s} value={s}>{`${s} (${data.counts?.[s] ?? 0})`}</option>)}
          </select>
          <button onClick={load} className={ADMIN_BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}>
            <ArrowClockwise size={13} /> Refresh
          </button>
        </div>
      </div>
      <p className="mb-4 text-xs text-slate-600">
        Flagged from inside the app. Google Play expects every report to be looked at and acted on — mark what you did.
      </p>
      <div className="space-y-3">
        {data.reports.map((r) => <ReportCard key={`${r.id}-${r.status}`} r={r} onSaved={load} />)}
        {data.reports.length === 0 && <div className="font-mono text-xs text-slate-600 py-6 text-center">No reports{filter ? ` marked ${filter}` : ""}.</div>}
      </div>
    </div>
  );
}

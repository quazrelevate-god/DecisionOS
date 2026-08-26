// Observability & logs (Epic 10 Sprint 5).
// AI reliability (error/degraded rate, latency percentiles, by provider/task),
// recent-errors viewer, and the provider-outage timeline.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-4";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const H3 = "font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors";
const SEL = "bg-[#0a0a0b] border border-white/10 px-2 py-1 font-mono text-[11px] text-white outline-none";

export function ObservabilitySection() {
  const [range, setRange] = useState("24h");
  const [rel, setRel] = useState(null);
  const [errs, setErrs] = useState(null);
  const [out, setOut] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, e, o] = await Promise.all([
        api.get(`/admin/observability/reliability?range=${range}`),
        api.get(`/admin/observability/errors?range=${range}`),
        api.get("/admin/observability/outages"),
      ]);
      setRel(r.data); setErrs(e.data); setOut(o.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, [range]);
  useEffect(() => { load(); }, [load]);

  if (!rel || !errs || !out) return <div className="flex items-center gap-2 text-white/40 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");
  const errColor = rel.error_rate > 0.02 ? "#e5484d" : "#3fb950";

  const Table = ({ title, rows }) => (
    <div className={CARD}>
      <div className={H3}>{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/5">
              <td className="py-1 text-white/80">{r.key}</td>
              <td className="py-1 text-white/50 font-mono text-xs text-right">{r.calls}</td>
              <td className="py-1 font-mono text-xs text-right" style={{ color: r.errors ? "#e5484d" : "#6b6b75" }}>{r.errors} err</td>
              <td className="py-1 text-white/50 font-mono text-xs text-right">{r.avg_latency_ms}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div data-testid="admin-observability">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Observability</h2>
        <div className="flex gap-2 items-center">
          <select value={range} onChange={(e) => setRange(e.target.value)} className={SEL}>
            {["1h", "24h", "7d", "30d"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={load} className={BTN + " border-white/15 text-white/60 hover:text-white flex items-center gap-1.5"}>
            <ArrowClockwise size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD}><div className="font-heading text-3xl font-black text-white">{rel.calls}</div><div className={H3 + " mt-1 mb-0"}>AI calls</div></div>
        <div className={CARD}><div className="font-heading text-3xl font-black" style={{ color: errColor }}>{pct(rel.error_rate)}</div><div className={H3 + " mt-1 mb-0"}>Error rate ({rel.errors})</div></div>
        <div className={CARD}><div className="font-heading text-3xl font-black text-[#d29922]">{pct(rel.degraded_rate)}</div><div className={H3 + " mt-1 mb-0"}>Fallback rate</div></div>
        <div className={CARD}><div className="font-heading text-3xl font-black text-white">{rel.latency_ms.p95}<span className="text-white/30 text-sm">ms</span></div><div className={H3 + " mt-1 mb-0"}>Latency p95 (p50 {rel.latency_ms.p50})</div></div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <Table title="By provider" rows={rel.by_provider} />
        <Table title="By task" rows={rel.by_task.slice(0, 12)} />
      </div>

      {out.active_count > 0 && (
        <div className="border border-[#e5484d]/40 bg-[#e5484d]/10 p-3 mb-4 flex items-center gap-2">
          <WarningCircle size={16} className="text-[#e5484d]" weight="fill" />
          <span className="text-[#e5484d] font-mono text-xs">{out.active_count} active provider outage(s)</span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className={CARD}>
          <div className={H3}>Recent errors ({errs.count})</div>
          <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
            {errs.errors.map((e, i) => (
              <div key={i} className="py-2">
                <div className="text-white/85 text-xs">{e.task} · {e.engine}/{e.model}</div>
                <div className="font-mono text-[10px] text-[#e5484d] mt-0.5">{e.error || "(no message)"}</div>
                <div className="font-mono text-[9px] text-white/30">{ts(e.created_at)}</div>
              </div>
            ))}
            {errs.count === 0 && <div className="font-mono text-xs text-[#3fb950] py-3">No AI errors in this window 🎉</div>}
          </div>
        </div>
        <div className={CARD}>
          <div className={H3}>Provider-outage timeline</div>
          <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
            {out.outages.map((o, i) => (
              <div key={i} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-white/85 text-xs">{o.provider} · {o.status}</div>
                  <div className="font-mono text-[9px] text-white/30">{ts(o.created_at)}</div>
                </div>
                <span className="font-mono text-[9px] uppercase" style={{ color: o.resolved ? "#3fb950" : "#e5484d" }}>{o.resolved ? "resolved" : "active"}</span>
              </div>
            ))}
            {out.outages.length === 0 && <div className="font-mono text-xs text-white/30 py-3">No outages recorded.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

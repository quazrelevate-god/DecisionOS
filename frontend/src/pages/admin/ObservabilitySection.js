import { ADMIN_BTN, ADMIN_H2, ADMIN_H3, ADMIN_SEL, CARD_BASE } from "./adminStyle";
// Observability & logs (Epic 10 Sprint 5).
// AI reliability (error/degraded rate, latency percentiles, by provider/task),
// recent-errors viewer, and the provider-outage timeline.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-4`;
const H2 = ADMIN_H2;
const H3 = ADMIN_H3;
const BTN = ADMIN_BTN;
const SEL = ADMIN_SEL;

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

  if (!rel || !errs || !out) return <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const ts = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");
  const errColor = rel.error_rate > 0.02 ? "#cf222e" : "#116329";

  const Table = ({ title, rows }) => (
    <div className={CARD}>
      <div className={H3}>{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-900/5">
              <td className="py-1 text-slate-700">{r.key}</td>
              <td className="py-1 text-slate-600 font-mono text-xs text-right">{r.calls}</td>
              <td className="py-1 font-mono text-xs text-right" style={{ color: r.errors ? "#cf222e" : "#57606a" }}>{r.errors} err</td>
              <td className="py-1 text-slate-600 font-mono text-xs text-right">{r.avg_latency_ms}ms</td>
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
          <button onClick={load} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}>
            <ArrowClockwise size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD}><div className="font-display text-3xl text-slate-900">{rel.calls}</div><div className={H3 + " mt-1 mb-0"}>AI calls</div></div>
        <div className={CARD}><div className="font-display text-3xl" style={{ color: errColor }}>{pct(rel.error_rate)}</div><div className={H3 + " mt-1 mb-0"}>Error rate ({rel.errors})</div></div>
        <div className={CARD}><div className="font-display text-3xl text-[#7d4e00]">{pct(rel.degraded_rate)}</div><div className={H3 + " mt-1 mb-0"}>Fallback rate</div></div>
        <div className={CARD}><div className="font-display text-3xl text-slate-900">{rel.latency_ms.p95}<span className="text-slate-600 text-sm">ms</span></div><div className={H3 + " mt-1 mb-0"}>Latency p95 (p50 {rel.latency_ms.p50})</div></div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <Table title="By provider" rows={rel.by_provider} />
        <Table title="By task" rows={rel.by_task.slice(0, 12)} />
      </div>

      {out.active_count > 0 && (
        <div className="border border-[#cf222e]/40 bg-[#cf222e]/10 p-3 mb-4 flex items-center gap-2 rounded-xl">
          <WarningCircle size={16} className="text-[#b91c1c]" weight="fill" />
          <span className="text-[#b91c1c] font-mono text-xs">{out.active_count} active provider outage(s)</span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className={CARD}>
          <div className={H3}>Recent errors ({errs.count})</div>
          <div className="divide-y divide-slate-900/5 max-h-64 overflow-y-auto">
            {errs.errors.map((e, i) => (
              <div key={i} className="py-2">
                <div className="text-slate-600 text-xs">{e.task} · {e.engine}/{e.model}</div>
                <div className="font-mono text-[10px] text-[#b91c1c] mt-0.5">{e.error || "(no message)"}</div>
                <div className="font-mono text-[9px] text-slate-600">{ts(e.created_at)}</div>
              </div>
            ))}
            {errs.count === 0 && <div className="font-mono text-xs text-[#116329] py-3">No AI errors in this window 🎉</div>}
          </div>
        </div>
        <div className={CARD}>
          <div className={H3}>Provider-outage timeline</div>
          <div className="divide-y divide-slate-900/5 max-h-64 overflow-y-auto">
            {out.outages.map((o, i) => (
              <div key={i} className="py-2 flex items-center justify-between">
                <div>
                  <div className="text-slate-600 text-xs">{o.provider} · {o.status}</div>
                  <div className="font-mono text-[9px] text-slate-600">{ts(o.created_at)}</div>
                </div>
                <span className="font-mono text-[9px] uppercase" style={{ color: o.resolved ? "#116329" : "#cf222e" }}>{o.resolved ? "resolved" : "active"}</span>
              </div>
            ))}
            {out.outages.length === 0 && <div className="font-mono text-xs text-slate-600 py-3">No outages recorded.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

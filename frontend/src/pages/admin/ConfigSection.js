import { ADMIN_BTN, ADMIN_H2, ADMIN_H3, ADMIN_SEL, CARD_BASE } from "./adminStyle";
// Feature flags & runtime config (Epic 10 Sprint 6).
// No-redeploy: AI model per task, Sarvam voice stack, and global feature flags.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, Plus } from "@phosphor-icons/react";

const CARD = `${CARD_BASE} p-4`;
const H2 = ADMIN_H2;
const H3 = ADMIN_H3;
const BTN = ADMIN_BTN;
const SEL = ADMIN_SEL;

export function ConfigSection() {
  const [cfg, setCfg] = useState(null);
  const [newFlag, setNewFlag] = useState("");

  const load = useCallback(async () => {
    try { const r = await api.get("/admin/config"); setCfg(r.data); }
    catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setModel = async (task, model) => {
    const overrides = { ...cfg.models.overrides };
    if (model === "__default__") delete overrides[task]; else overrides[task] = model;
    try { await api.patch("/admin/config/models", { overrides }); toast.success("Model route updated"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const setSarvam = async (patch) => {
    try { await api.patch("/admin/config/sarvam", { ...cfg.sarvam.config, ...patch }); toast.success("Sarvam config updated"); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const setFlag = async (key, val) => {
    try { await api.patch("/admin/config/flags", { flags: { ...cfg.global_flags, [key]: val } }); load(); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  if (!cfg) return <div className="flex items-center gap-2 text-slate-600 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;
  const sc = cfg.sarvam.config || {};
  const routes = Object.entries(cfg.models.routes);

  return (
    <div data-testid="admin-config">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Config & Flags</h2>
        <button onClick={load} className={BTN + " border-slate-900/15 text-slate-600 hover:text-slate-900 flex items-center gap-1.5"}>
          <ArrowClockwise size={13} /> Refresh
        </button>
      </div>
      <p className="font-mono text-[11px] text-slate-600 mb-4">Changes apply with no redeploy (env still wins; other replicas converge within a minute).</p>

      <div className={CARD + " mb-4"}>
        <div className={H3}>Sarvam voice stack</div>
        <div className="flex flex-wrap gap-4">
          {[["model", cfg.sarvam.options.models], ["mode", cfg.sarvam.options.modes], ["voice", cfg.sarvam.options.voices]].map(([field, opts]) => (
            <label key={field} className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-slate-600 w-12">{field}</span>
              <select value={sc[field] || ""} onChange={(e) => setSarvam({ [field]: e.target.value })} className={SEL}>
                <option value="">(default)</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className={CARD + " mb-4"}>
        <div className={H3}>Global feature flags</div>
        <div className="space-y-1.5">
          {Object.entries(cfg.global_flags).map(([k, v]) => (
            <label key={k} className="flex items-center justify-between">
              <span className="text-slate-700 text-sm font-mono">{k}</span>
              <input type="checkbox" checked={!!v} onChange={(e) => setFlag(k, e.target.checked)} className="accent-[#cf222e]" />
            </label>
          ))}
          {Object.keys(cfg.global_flags).length === 0 && <div className="font-mono text-xs text-slate-600">No flags yet.</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (newFlag.trim()) { setFlag(newFlag.trim(), true); setNewFlag(""); } }} className="flex gap-2 mt-3">
          <input value={newFlag} onChange={(e) => setNewFlag(e.target.value)} placeholder="new_flag_key"
            className="flex-1 bg-white border border-slate-900/10 px-2 py-1.5 font-mono text-[11px] text-slate-900 placeholder:text-slate-400 outline-none rounded-xl" />
          <button type="submit" className={BTN + " border-[#116329]/50 text-[#116329] hover:bg-[#116329]/10 flex items-center gap-1"}><Plus size={12} /> Add</button>
        </form>
      </div>

      <div className={CARD}>
        <div className={H3}>AI model routes ({routes.length} tasks)</div>
        <div className="divide-y divide-slate-900/5 max-h-96 overflow-y-auto">
          {routes.map(([task, r]) => (
            <div key={task} className="flex items-center justify-between py-1.5">
              <div>
                <div className="font-mono text-[11px] text-slate-700">{task}</div>
                <div className="font-mono text-[9px] text-slate-600">effective: {r.effective}{r.override ? " (override)" : ""}</div>
              </div>
              <select value={r.override || "__default__"} onChange={(e) => setModel(task, e.target.value)} className={SEL} data-testid={`model-${task}`}>
                <option value="__default__">{`default (${r.default || "—"})`}</option>
                {cfg.models.available.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

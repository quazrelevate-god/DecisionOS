import { ADMIN_H3 } from "./adminStyle";
// Config (Epic 10 Sprint 6; redesigned 2026-10-22). Changes apply with no
// redeploy: the voice stack, feature flags, which AI model answers each task,
// and the rupee rate the console shows AI cost at. Every list is the app's
// own (GlassSelect), and tasks read as words, not keys.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { ArrowClockwise, Plus } from "@phosphor-icons/react";
import { useAdmin, useAdminGet, errText, Btn, Chip, Toggle, SearchField, AdminPage, Panel, Loading, Empty, LoadError, ADMIN_FIELD } from "./adminUi";
import { humanize } from "./adminLabels";

const DEFAULT_RATE = 84;

export function ConfigSection() {
  const { canWrite } = useAdmin();
  const { data: cfg, error, reload } = useAdminGet("/admin/config");
  const [newFlag, setNewFlag] = useState("");
  const [rate, setRate] = useState(null);
  const [q, setQ] = useState("");

  const save = async (url, body, done) => {
    try { await api.patch(url, body); toast.success(done); reload(); }
    catch (e) { toast.error(errText(e)); }
  };
  const setModel = (task, model) => {
    const overrides = { ...cfg.models.overrides };
    if (model === "__default__") delete overrides[task]; else overrides[task] = model;
    save("/admin/config/models", { overrides }, `${humanize(task)} now uses ${model === "__default__" ? "its default" : model}`);
  };
  const setSarvam = (patch) => save("/admin/config/sarvam", { ...cfg.sarvam.config, ...patch }, "Voice settings saved");
  const setFlag = (key, val) => save("/admin/config/flags", { flags: { ...cfg.global_flags, [key]: val } }, `${humanize(key)} is ${val ? "on" : "off"}`);
  const saveRate = (e) => {
    e.preventDefault();
    const v = Number(rate);
    if (!(v > 0 && v < 1000)) { toast.error("Enter rupees per dollar, for example 84"); return; }
    save("/admin/config/runtime", { usd_inr: v }, `AI cost now shows at ₹${v} to the dollar`);
    setRate(null);
  };

  const routes = useMemo(() => {
    const all = Object.entries(cfg?.models?.routes || {});
    const term = q.trim().toLowerCase();
    return term ? all.filter(([task]) => `${task} ${humanize(task)}`.toLowerCase().includes(term)) : all;
  }, [cfg, q]);

  if (error && !cfg) return <AdminPage title="Config"><LoadError what="the config" onRetry={reload} /></AdminPage>;
  if (!cfg) return <AdminPage title="Config"><Loading /></AdminPage>;
  const sc = cfg.sarvam.config || {};
  const currentRate = cfg.runtime?.usd_inr || DEFAULT_RATE;
  const overridden = Object.keys(cfg.models.overrides || {}).length;

  return (
    <AdminPage title="Config" testid="admin-config"
      subtitle="Applies without a redeploy. Server environment settings still win; other servers catch up within a minute."
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Voice (Sarvam)" hint="Speech to text and text to speech">
          <div className="grid gap-3 sm:grid-cols-3">
            {[["model", "Model", cfg.sarvam.options.models], ["mode", "Mode", cfg.sarvam.options.modes], ["voice", "Voice", cfg.sarvam.options.voices]].map(([field, label, opts]) => (
              <div key={field}>
                <span className={ADMIN_H3 + " block"}>{label}</span>
                <GlassSelect value={sc[field] || ""} onChange={(v) => setSarvam({ [field]: v })} disabled={!canWrite}
                  ariaLabel={`Voice ${label}`} testid={`sarvam-${field}`} triggerClassName="h-10 text-sm"
                  options={[{ value: "", label: "Default" }, ...opts.map((o) => ({ value: o, label: o }))]} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Currency" hint="How AI cost, billed in dollars, is shown here">
          <form onSubmit={saveRate} className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className={ADMIN_H3 + " block"}>Rupees per dollar</span>
              <input type="number" step="0.01" min="1" value={rate ?? currentRate} onChange={(e) => setRate(e.target.value)}
                disabled={!canWrite} data-testid="config-usd-inr" className={`${ADMIN_FIELD} !w-36`} />
            </label>
            {canWrite && rate != null && Number(rate) !== Number(currentRate) && <Btn type="submit" variant="primary">Save rate</Btn>}
          </form>
          <p className="mt-2 text-xs text-slate-500">Used on Overview, AI usage and each workspace. Default ₹{DEFAULT_RATE}.</p>
        </Panel>
      </div>

      <Panel title="Feature flags" hint="Switches that apply to every workspace" className="mb-4">
        {Object.keys(cfg.global_flags).length === 0 ? <Empty compact title="No flags yet." /> : (
          <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {Object.entries(cfg.global_flags).map(([k, v]) => (
              <li key={k}><Toggle checked={!!v} onChange={(val) => setFlag(k, val)} disabled={!canWrite} label={humanize(k)} hint={k} testid={`flag-${k}`} /></li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form onSubmit={(e) => { e.preventDefault(); const k = newFlag.trim(); if (k) { setFlag(k, true); setNewFlag(""); } }}
            className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-900/[0.06] pt-4">
            <input value={newFlag} onChange={(e) => setNewFlag(e.target.value.replace(/\s+/g, "_"))} placeholder="new_flag_name"
              className={`${ADMIN_FIELD} h-10 !w-64 max-w-full py-0 font-mono`} aria-label="New flag name" />
            <Btn type="submit" size="sm" icon={Plus} disabled={!newFlag.trim()}>Add flag, switched on</Btn>
          </form>
        )}
      </Panel>

      <Panel title="AI model per task" hint={`${Object.keys(cfg.models.routes).length} tasks${overridden ? ` · ${overridden} changed from the default` : ""}`}
        actions={<SearchField value={q} onChange={setQ} placeholder="Find a task" className="w-56" />}>
        <ul className="-mx-2 divide-y divide-slate-900/[0.05]">
          {routes.map(([task, r]) => (
            <li key={task} className="flex flex-wrap items-center justify-between gap-3 px-2 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-slate-900">{humanize(task)} {r.override && <Chip tone="info">Changed</Chip>}</div>
                <div className="font-mono text-[11px] text-slate-400">{task} · now {r.effective}</div>
              </div>
              <div className="w-64 max-w-full">
                <GlassSelect value={r.override || "__default__"} onChange={(v) => setModel(task, v)} disabled={!canWrite}
                  ariaLabel={`Model for ${humanize(task)}`} testid={`model-${task}`} triggerClassName="h-10 text-sm"
                  options={[{ value: "__default__", label: `Default (${r.default || "none"})` }, ...cfg.models.available.map((m) => ({ value: m, label: m }))]} />
              </div>
            </li>
          ))}
          {routes.length === 0 && <li className="px-2 py-6 text-center text-sm text-slate-500">No task matches.</li>}
        </ul>
      </Panel>
    </AdminPage>
  );
}

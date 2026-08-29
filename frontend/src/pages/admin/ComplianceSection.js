// Compliance & data ops (Epic 9 Sprint 9 -- DPDP / GDPR).
// Per-tenant data export, retention policy, consent export, and the
// structured export-before-delete workflow, plus a platform retention sweep.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import {
  Spinner, ArrowClockwise, MagnifyingGlass, DownloadSimple, Scales,
  Warning, Trash, Broom,
} from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-4";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const H3 = "font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors flex items-center gap-1.5";
const INP = "bg-[#0a0a0b] border border-white/10 px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-white/30 outline-none";

function downloadJSON(obj, name) {
  try {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast.error("Download failed: " + e.message); }
}

export function ComplianceSection() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(null);           // {id, name}
  const [ret, setRet] = useState(null);           // retention detail for sel
  const [busy, setBusy] = useState("");
  const [sweep, setSweep] = useState(null);       // retention/status

  const loadSweep = useCallback(async () => {
    try { const r = await api.get("/admin/retention/status"); setSweep(r.data); }
    catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { loadSweep(); }, [loadSweep]);

  const search = async (e) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try { const r = await api.get(`/admin/search?q=${encodeURIComponent(q.trim())}`); setResults(r.data); }
    catch (err) { toast.error(formatApiError(err)); }
    finally { setSearching(false); }
  };

  const pick = async (t) => {
    setSel({ id: t.id, name: t.name || t.company_name || t.id });
    setRet(null);
    try { const r = await api.get(`/admin/tenants/${t.id}/retention`); setRet(r.data); }
    catch (e) { toast.error(formatApiError(e)); }
  };

  const doExport = async () => {
    setBusy("export");
    try {
      const r = await api.get(`/admin/tenants/${sel.id}/export`);
      downloadJSON(r.data, `export_${sel.name}_${sel.id}.json`);
      toast.success(`Exported ${r.data.total_records} records`);
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
  };

  const doConsent = async () => {
    setBusy("consent");
    try {
      const r = await api.get(`/admin/tenants/${sel.id}/consent-export`);
      downloadJSON(r.data, `consent_${sel.name}_${sel.id}.json`);
      toast.success("Consent + audit trail exported");
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
  };

  const saveRetention = async () => {
    setBusy("retention");
    try {
      const p = ret.policy;
      await api.put(`/admin/tenants/${sel.id}/retention`, {
        enabled: p.enabled, ttl_days: p.ttl_days, collections: p.collections,
      });
      toast.success("Retention policy saved");
      const r = await api.get(`/admin/tenants/${sel.id}/retention`); setRet(r.data);
      loadSweep();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
  };

  const deleteWithExport = async () => {
    if (!window.confirm(`EXPORT then PERMANENTLY DELETE "${sel.name}"?\n\nA full JSON export downloads first, then every record is wiped. This cannot be undone.`)) return;
    setBusy("delete");
    try {
      const r = await api.post(`/admin/tenants/${sel.id}/delete-with-export`);
      downloadJSON(r.data.export, `erasure_receipt_${sel.name}_${sel.id}.json`);
      toast.success(`Deleted — ${r.data.deletion.total_removed} records wiped (receipt downloaded)`);
      setSel(null); setRet(null); setResults(null);
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
  };

  const runSweep = async (live) => {
    if (live && !window.confirm("Run a LIVE retention purge across all tenants with a policy? Expired transient rows will be permanently deleted.")) return;
    setBusy("sweep");
    try {
      const r = await api.post(`/admin/retention/run?dry_run=${live ? "false" : "true"}`);
      toast.success(`${live ? "Purged" : "Would purge"} ${r.data.total_purged} rows across ${r.data.tenants_with_policy} tenant(s)`);
      loadSweep();
    } catch (e) { toast.error(formatApiError(e)); } finally { setBusy(""); }
  };

  const setPol = (patch) => setRet((r) => ({ ...r, policy: { ...r.policy, ...patch } }));
  const toggleCol = (c) => setPol({
    collections: ret.policy.collections.includes(c)
      ? ret.policy.collections.filter((x) => x !== c)
      : [...ret.policy.collections, c],
  });

  return (
    <div data-testid="admin-compliance">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}><Scales size={18} className="inline mb-1 mr-1.5" />Compliance &amp; Data Ops</h2>
        <button onClick={loadSweep} className={BTN + " border-white/15 text-white/60 hover:text-white"}><ArrowClockwise size={13} /> Refresh</button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Left: find a workspace + act on it */}
        <div className="space-y-4">
          <form onSubmit={search} className={CARD}>
            <div className={H3}>Find a workspace</div>
            <div className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name / id / owner email" className={INP + " flex-1"} />
              <button type="submit" className={BTN + " border-[#3b82f6]/50 text-[#3b82f6]"}>{searching ? <Spinner size={13} className="animate-spin" /> : <MagnifyingGlass size={13} />} Search</button>
            </div>
            {results && (
              <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                {(results.tenants || []).map((t) => (
                  <button key={t.id} onClick={() => pick(t)} className={`w-full text-left px-2 py-1.5 font-mono text-[11px] border ${sel?.id === t.id ? "border-[#3b82f6] text-white" : "border-white/10 text-white/60 hover:text-white"}`}>
                    {t.name || t.company_name || t.id} <span className="text-white/30">· {t.id.slice(0, 8)}</span>
                  </button>
                ))}
                {(!results.tenants || results.tenants.length === 0) && <div className="font-mono text-[11px] text-white/30">No workspaces.</div>}
              </div>
            )}
          </form>

          {sel && (
            <div className={CARD}>
              <div className={H3}>{sel.name} — data subject rights</div>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} onClick={doExport} className={BTN + " border-[#3fb950]/50 text-[#3fb950] hover:bg-[#3fb950]/10"}>{busy === "export" ? <Spinner size={13} className="animate-spin" /> : <DownloadSimple size={13} />} Export data</button>
                <button disabled={busy} onClick={doConsent} className={BTN + " border-white/20 text-white/70 hover:text-white"}>{busy === "consent" ? <Spinner size={13} className="animate-spin" /> : <DownloadSimple size={13} />} Consent + audit</button>
              </div>
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="font-mono text-[10px] uppercase tracking-widest text-[#e5484d]/70 mb-2 flex items-center gap-1"><Warning size={12} weight="fill" /> Right to erasure</div>
                <button disabled={busy} onClick={deleteWithExport} className={BTN + " border-[#e5484d]/50 text-[#e5484d] hover:bg-[#e5484d]/10"}>{busy === "delete" ? <Spinner size={13} className="animate-spin" /> : <Trash size={13} />} Export &amp; delete workspace</button>
                <div className="font-mono text-[9px] text-white/30 mt-1.5">Downloads a full erasure receipt, then permanently wipes every record.</div>
              </div>
            </div>
          )}

          {sel && ret && (
            <div className={CARD}>
              <div className={H3}>Retention policy — {sel.name}</div>
              <label className="flex items-center gap-2 font-mono text-[11px] text-white/70 mb-2">
                <input type="checkbox" checked={ret.policy.enabled} onChange={(e) => setPol({ enabled: e.target.checked })} className="accent-[#e5484d]" />
                Enable automatic purge of transient data
              </label>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-[11px] text-white/50">Keep for</span>
                <input type="number" min={ret.min_ttl_days} value={ret.policy.ttl_days} onChange={(e) => setPol({ ttl_days: parseInt(e.target.value || "0", 10) })} className={INP + " w-20"} />
                <span className="font-mono text-[11px] text-white/50">days (min {ret.min_ttl_days})</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ret.eligible_collections.map((c) => (
                  <button key={c} onClick={() => toggleCol(c)} className={`font-mono text-[10px] px-2 py-1 border ${ret.policy.collections.includes(c) ? "border-[#3b82f6] text-[#3b82f6]" : "border-white/10 text-white/30"}`}>{c}</button>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-white/40">{ret.candidates} row(s) currently past TTL</span>
                <button disabled={busy} onClick={saveRetention} className={BTN + " border-[#3fb950]/50 text-[#3fb950] hover:bg-[#3fb950]/10"}>{busy === "retention" ? <Spinner size={13} className="animate-spin" /> : null} Save policy</button>
              </div>
            </div>
          )}
        </div>

        {/* Right: platform-wide retention sweep */}
        <div className={CARD + " h-fit"}>
          <div className="flex items-center justify-between mb-2">
            <div className={H3 + " mb-0"}>Retention sweep (all tenants)</div>
            <div className="flex gap-1.5">
              <button disabled={busy} onClick={() => runSweep(false)} className={BTN + " border-white/20 text-white/60 hover:text-white text-[10px] px-2 py-1"}>Dry run</button>
              <button disabled={busy} onClick={() => runSweep(true)} className={BTN + " border-[#e5484d]/50 text-[#e5484d] text-[10px] px-2 py-1"}><Broom size={12} /> Purge now</button>
            </div>
          </div>
          {!sweep ? (
            <div className="flex items-center gap-2 text-white/40 font-mono text-xs py-6 justify-center"><Spinner size={14} className="animate-spin" /> Loading…</div>
          ) : (
            <>
              <div className="font-mono text-[10px] text-white/40 mb-2">
                {sweep.enabled_count} of {sweep.policies.length} workspace(s) have a retention policy.
                {sweep.last_sweep?.last_run && <> Last sweep {String(sweep.last_sweep.last_run).slice(0, 16).replace("T", " ")} ({sweep.last_sweep.last_result?.total_purged ?? 0} purged).</>}
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {sweep.policies.filter((p) => p.enabled).map((p) => (
                  <div key={p.tenant_id} className="flex items-center justify-between font-mono text-[11px] border border-white/10 px-2 py-1.5">
                    <span className="text-white/70 truncate">{p.name}</span>
                    <span className="text-white/40 shrink-0 ml-2">{p.ttl_days}d · <span className={p.candidates ? "text-[#d29922]" : "text-white/30"}>{p.candidates ?? 0} due</span></span>
                  </div>
                ))}
                {sweep.enabled_count === 0 && <div className="font-mono text-[11px] text-white/30 py-4 text-center">No retention policies configured yet.</div>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

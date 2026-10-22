import { ADMIN_H3 } from "./adminStyle";
// Compliance (Epic 9 Sprint 9 — DPDP / GDPR; redesigned 2026-10-22).
// The data-rights desk: find a workspace or a person and hand over what we
// hold (access requests), or erase a workspace with a receipt (erasure). Plus
// the platform-wide retention sweep. Each workspace's own retention policy
// is set on its page.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { ConfirmAction } from "../../components/common";
import { ArrowClockwise, DownloadSimple, Trash, Broom, Buildings, User, Scales } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtNum, fmtDateTime, downloadJSON, Btn, Chip, SearchField, AdminPage, Panel, Loading,
  Empty, LoadError, LinkOut,
} from "./adminUi";
import { planLabel } from "./adminLabels";

const saved = (ok, what) => (ok ? toast.success(what) : toast.error("Couldn't save the file. The export was fetched; try again, or use another browser."));

export function ComplianceSection() {
  const { go, canWrite, isSuper } = useAdmin();
  const sweep = useAdminGet("/admin/retention/status");
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState(null);           // { kind: "workspace"|"person", id, name, tenant_id? }
  const [busy, setBusy] = useState("");
  /* 2026-10-02 — the wipe and the live sweep were guarded by window.confirm,
     an OS dialog that some embed contexts answer FALSE with nothing drawn:
     the most dangerous button in the product looked dead, and got pressed
     again. Asked in the app now, like everywhere else. */
  const [pending, setPending] = useState(null);   // "delete" | "sweep" | null

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return undefined; }
    let gone = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try { const r = await api.get(`/admin/search?q=${encodeURIComponent(term)}`); if (!gone) setResults(r.data); }
      catch (e) { if (!gone) toast.error(errText(e)); }
      finally { if (!gone) setSearching(false); }
    }, 250);
    return () => { gone = true; clearTimeout(t); };
  }, [q]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(errText(e)); } finally { setBusy(""); }
  };
  const exportWorkspace = () => run("export", async () => {
    const r = await api.get(`/admin/tenants/${sel.id}/export`);
    saved(await downloadJSON(r.data, `export_${sel.name}_${sel.id}.json`), `Downloaded ${fmtNum(r.data.total_records)} records`);
  });
  const exportConsent = () => run("consent", async () => {
    const r = await api.get(`/admin/tenants/${sel.id}/consent-export`);
    saved(await downloadJSON(r.data, `consent_${sel.name}_${sel.id}.json`), "Consent and audit records downloaded");
  });
  const exportPerson = () => run("dsar", async () => {
    const r = await api.get(`/admin/users/${sel.id}/dsar`);
    saved(await downloadJSON(r.data, `person_${sel.name}_${sel.id}.json`), `Downloaded ${fmtNum(r.data.total_records)} records about ${sel.name}`);
  });
  const deleteWithExport = () => run("delete", async () => {
    setPending(null);
    const r = await api.post(`/admin/tenants/${sel.id}/delete-with-export`);
    await downloadJSON(r.data.export, `erasure_receipt_${sel.name}_${sel.id}.json`);
    toast.success(`${sel.name} is erased (${fmtNum(r.data.deletion.total_removed)} records). The receipt downloaded.`);
    setSel(null); setResults(null); setQ("");
    sweep.reload();
  });
  const runSweep = (live) => {
    if (live && pending !== "sweep") { setPending("sweep"); return; }
    run("sweep", async () => {
      setPending(null);
      const r = await api.post(`/admin/retention/run?dry_run=${live ? "false" : "true"}`);
      toast.success(`${live ? "Deleted" : "Would delete"} ${fmtNum(r.data.total_purged)} rows across ${r.data.tenants_with_policy} workspace(s)`);
      sweep.reload();
    });
  };

  const s = sweep.data;
  const policies = (s?.policies || []).filter((p) => p.enabled);

  return (
    <AdminPage title="Compliance" testid="admin-compliance"
      subtitle="Data requests under India's DPDP Act (and GDPR), and automatic clean-up of old data">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Data requests" hint="Find the workspace or person the request is about">
            <SearchField value={q} onChange={setQ} placeholder="Workspace name, person's name, email or phone" testid="compliance-search" />
            {searching && <div className="mt-3 text-xs text-slate-500">Searching…</div>}
            {results && !searching && (
              <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                {results.tenants.map((t) => (
                  <li key={`t-${t.id}`}>
                    <button type="button" onClick={() => setSel({ kind: "workspace", id: t.id, name: t.name })}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${sel?.id === t.id ? "bg-slate-900/[0.07]" : "hover:bg-slate-900/[0.04]"}`}>
                      <Buildings size={16} className="text-slate-500" />
                      <span className="min-w-0 flex-1 truncate text-slate-900">{t.name}</span>
                      <span className="text-xs text-slate-500">{planLabel(t.plan)}</span>
                    </button>
                  </li>
                ))}
                {results.users.map((u) => (
                  <li key={`u-${u.id}`}>
                    <button type="button" onClick={() => setSel({ kind: "person", id: u.id, name: u.name || u.email || u.phone, tenant_id: u.tenant_id, tenant_name: u.tenant_name })}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm ${sel?.id === u.id ? "bg-slate-900/[0.07]" : "hover:bg-slate-900/[0.04]"}`}>
                      <User size={16} className="text-slate-500" />
                      <span className="min-w-0 flex-1 truncate text-slate-900">{u.name || u.email || u.phone}</span>
                      <span className="truncate text-xs text-slate-500">{u.tenant_name}</span>
                    </button>
                  </li>
                ))}
                {results.tenants.length + results.users.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Nothing matches.</li>}
              </ul>
            )}
          </Panel>

          {sel && sel.kind === "workspace" && (
            <Panel title={sel.name} hint="Workspace" actions={<LinkOut onClick={() => go(`workspaces/${sel.id}`)}>Open workspace</LinkOut>}>
              <div className="space-y-4">
                <div>
                  <div className={ADMIN_H3}>Access request</div>
                  <div className="flex flex-wrap gap-2">
                    <Btn size="sm" icon={DownloadSimple} busy={busy === "export"} disabled={!!busy} onClick={exportWorkspace}>Download all its data</Btn>
                    <Btn size="sm" icon={DownloadSimple} busy={busy === "consent"} disabled={!!busy} onClick={exportConsent}>Consent and audit records</Btn>
                  </div>
                </div>
                {isSuper && (
                  <div className="border-t border-slate-900/[0.06] pt-4">
                    <div className={ADMIN_H3}>Right to erasure</div>
                    <Btn size="sm" variant="danger" icon={Trash} busy={busy === "delete"} disabled={!!busy} onClick={() => setPending("delete")}>Erase this workspace…</Btn>
                    <p className="mt-1.5 text-xs text-slate-500">A full copy downloads first as the erasure receipt, then every record is deleted.</p>
                  </div>
                )}
              </div>
            </Panel>
          )}

          {sel && sel.kind === "person" && (
            <Panel title={sel.name} hint={`Person · ${sel.tenant_name || "no workspace"}`}
              actions={sel.tenant_id ? <LinkOut onClick={() => go(`workspaces/${sel.tenant_id}`)}>Open workspace</LinkOut> : null}>
              <div className={ADMIN_H3}>Access request</div>
              <Btn size="sm" icon={DownloadSimple} busy={busy === "dsar"} onClick={exportPerson}>Download everything about them</Btn>
              <p className="mt-1.5 text-xs text-slate-500">Every record that names this person, across the workspace. Logged in the audit log.</p>
            </Panel>
          )}
        </div>

        <Panel title="Automatic clean-up" hint="Short-lived data past each workspace's limit is deleted"
          actions={canWrite ? (
            <>
              <Btn size="sm" busy={busy === "sweep" && pending !== "sweep"} disabled={!!busy} onClick={() => runSweep(false)}>Preview</Btn>
              {isSuper && <Btn size="sm" variant="danger" icon={Broom} disabled={!!busy} onClick={() => runSweep(true)}>Clean up now…</Btn>}
            </>
          ) : null}
          className="h-fit">
          {sweep.error && !s ? <LoadError what="retention policies" onRetry={sweep.reload} /> : !s ? <Loading /> : (
            <>
              <p className="mb-3 text-sm text-slate-600">
                {s.enabled_count ? `${s.enabled_count} of ${s.policies.length} workspaces have a retention policy.` : "No workspace has a retention policy yet."}
                {s.last_sweep?.last_run && ` Last run ${fmtDateTime(s.last_sweep.last_run)}, ${fmtNum(s.last_sweep.last_result?.total_purged ?? 0)} rows deleted.`}
              </p>
              {policies.length === 0 ? (
                <Empty compact icon={Scales} title="Nothing to clean up." hint="Set a policy on a workspace's page, under Data retention." />
              ) : (
                <ul className="divide-y divide-slate-900/[0.05]">
                  {policies.map((p) => (
                    <li key={p.tenant_id} className="flex items-center justify-between gap-3 py-2.5">
                      <LinkOut onClick={() => go(`workspaces/${p.tenant_id}`)}>{p.name}</LinkOut>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        keeps {p.ttl_days} days {p.candidates ? <Chip tone="warn">{fmtNum(p.candidates)} due</Chip> : <Chip tone="good">Clean</Chip>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="mt-3 flex justify-end"><Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={sweep.reload}>Refresh</Btn></div>
        </Panel>
      </div>

      <ConfirmAction
        open={pending === "delete"}
        onOpenChange={() => setPending(null)}
        title={sel ? `Export, then permanently delete “${sel.name}”?` : ""}
        description="A full JSON export downloads first, then every record of this workspace is wiped. This cannot be undone."
        confirmLabel="Export and delete"
        busyLabel="Deleting…"
        cancelLabel="Keep the workspace"
        busy={busy === "delete"}
        onConfirm={deleteWithExport}
        testid="admin-delete-tenant-confirm" />

      <ConfirmAction
        open={pending === "sweep"}
        onOpenChange={() => setPending(null)}
        title="Clean up for real?"
        description="Every workspace with a policy is swept and its expired short-lived rows are permanently deleted. Run the preview first if you haven't."
        confirmLabel="Delete the old data"
        busyLabel="Cleaning up…"
        cancelLabel="Not now"
        busy={busy === "sweep"}
        onConfirm={() => runSweep(true)}
        testid="admin-retention-purge-confirm" />
    </AdminPage>
  );
}

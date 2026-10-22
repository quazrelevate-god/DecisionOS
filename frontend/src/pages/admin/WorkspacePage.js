import { ADMIN_H3 } from "./adminStyle";
import { roleLabel } from "../../lib/departments";
/* One workspace, on one page (2026-10-22, admin redesign).
 *
 * A workspace used to be in four places -- the Workspaces table, Tenant 360's
 * search, Billing's list and Compliance's search -- each with part of the
 * story and some of the buttons. This page has all of it: who is in it, what
 * it pays, what AI it used, its data and privacy tools, and what happened in
 * it. Suspend, delete and view-as live in the "⋯" menu, each asking why (or
 * for the name) first, and the answer goes into the audit log.
 *
 * The counts agree with each other now: "People" is everyone with a sign-in
 * (the list below it), and the address book is called Contacts. Tenant 360
 * showed "0 members", "4 users" and "6 people" for the same company. */
import { useState } from "react";
import { toast } from "sonner";
import api from "../../lib/api";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import {
  ArrowClockwise, Eye, CurrencyInr, Flask, Storefront, Prohibit, CheckCircle, Trash, DownloadSimple, ShieldCheck,
  Users, ClockCounterClockwise, Copy,
} from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, errText, fmtNum, fmtInr, fmtUsd, usdToInr, fmtDate, fmtDateTime, fmtAgo, downloadJSON,
  Btn, Chip, statusChip, planChip, RowMenu, AdminPage, Panel, Loading, Empty, LoadError, Stat, Toggle,
  ReasonDialog, TypedConfirmDialog,
} from "./adminUi";
import { PLAN_OPTIONS, planLabel, humanize } from "./adminLabels";

export function WorkspacePage({ id }) {
  const { go, canWrite, isSuper } = useAdmin();
  const { data: sel, error, reload, setData } = useAdminGet(`/admin/tenants/${id}/360`);
  const [dialog, setDialog] = useState(null);   // "viewas" | "plan" | "suspend" | "delete"
  const [busy, setBusy] = useState("");
  const [planDraft, setPlanDraft] = useState("");
  const [withCopy, setWithCopy] = useState(true);

  if (error && !sel) {
    const gone = error?.response?.status === 404;
    return (
      <AdminPage title={gone ? "Workspace not found" : "Workspace"} back={{ label: "Workspaces", onClick: () => go("workspaces") }} testid="tenant360-detail">
        {gone ? <Empty title="This workspace doesn't exist, or was deleted." action={<Btn onClick={() => go("workspaces")}>All workspaces</Btn>} />
          : <LoadError what="this workspace" onRetry={reload} />}
      </AdminPage>
    );
  }
  if (!sel) return <AdminPage title="Workspace" back={{ label: "Workspaces", onClick: () => go("workspaces") }}><Loading /></AdminPage>;

  const t = sel.tenant;
  const c = sel.counts;
  const rate = sel.usd_inr || 84;
  const suspendedPeople = sel.members.filter((m) => m.suspended).length;

  const setTenant = (patch) => setData((d) => ({ ...d, tenant: { ...d.tenant, ...patch } }));
  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(errText(e)); } finally { setBusy(""); }
  };

  const startViewAs = (reason) => run("viewas", async () => {
    const r = await api.post(`/admin/tenants/${t.id}/impersonate`, { reason, read_only: true, minutes: 30 });
    setDialog(null);
    toast.success(`Read-only session started as ${r.data.session.target_name}, for 30 minutes`, {
      action: { label: "See sessions", onClick: () => go("audit?view=sessions") },
    });
  });
  const changePlan = (reason) => run("plan", async () => {
    await api.patch(`/admin/billing/tenants/${t.id}/plan`, { plan: planDraft, reason });
    setTenant({ plan: planDraft });
    setDialog(null);
    toast.success(`${t.name} is on ${planLabel(planDraft)}`);
    reload();
  });
  const suspend = (reason) => run("suspend", async () => {
    await api.post(`/admin/tenants/${t.id}/suspend`, { reason });
    setTenant({ suspended: true });
    setDialog(null);
    toast.success(`${t.name} is suspended`);
    reload();
  });
  const reactivate = () => run("reactivate", async () => {
    await api.post(`/admin/tenants/${t.id}/reactivate`);
    setTenant({ suspended: false });
    toast.success(`${t.name} is active again`);
    reload();
  });
  const markTest = (isTest) => run("test", async () => {
    await api.post(`/admin/tenants/${t.id}/test-flag`, { is_test: isTest });
    setTenant({ is_test: isTest, test_reason: "Marked by an admin" });
    toast.success(isTest ? "Marked as a test workspace" : "Marked as a customer");
    reload();
  });
  const exportData = (kind) => run(kind, async () => {
    const r = await api.get(`/admin/tenants/${t.id}/${kind === "consent" ? "consent-export" : "export"}`);
    const ok = await downloadJSON(r.data, `${kind === "consent" ? "consent" : "export"}_${t.name}_${t.id}.json`);
    if (ok) toast.success(kind === "consent" ? "Consent and audit records downloaded" : `Downloaded ${fmtNum(r.data.total_records)} records`);
    else toast.error("Couldn't save the file. The export was fetched; try again, or use another browser.");
  });
  const personData = (m) => run(`dsar-${m.id}`, async () => {
    const r = await api.get(`/admin/users/${m.id}/dsar`);
    const ok = await downloadJSON(r.data, `person_${m.name || m.id}.json`);
    if (ok) toast.success(`Downloaded ${fmtNum(r.data.total_records)} records about ${m.name || "this person"}`);
    else toast.error("Couldn't save the file. Try again, or use another browser.");
  });
  const remove = () => run("delete", async () => {
    if (withCopy) {
      const r = await api.post(`/admin/tenants/${t.id}/delete-with-export`);
      await downloadJSON(r.data.export, `erasure_receipt_${t.name}_${t.id}.json`);
      toast.success(`${t.name} is deleted (${fmtNum(r.data.deletion.total_removed)} records). The receipt downloaded.`);
    } else {
      const r = await api.delete(`/admin/tenants/${t.id}`);
      toast.success(`${t.name} is deleted (${fmtNum(r.data.total_removed)} records)`);
    }
    setDialog(null);
    go("workspaces", { replace: true });
  });

  const copyId = () => {
    try { navigator.clipboard.writeText(t.id); toast.success("Workspace id copied"); } catch { /* no clipboard */ }
  };

  const menu = [
    { label: "View as this workspace…", icon: Eye, hidden: !canWrite, onSelect: () => setDialog("viewas"), testid: "start-impersonation" },
    { label: "Change plan…", icon: CurrencyInr, hidden: !canWrite, onSelect: () => { setPlanDraft(t.plan || "trial"); setDialog("plan"); }, testid: "workspace-change-plan" },
    { label: "Mark as test workspace", icon: Flask, hidden: !canWrite || t.is_test, onSelect: () => markTest(true) },
    { label: "Mark as customer", icon: Storefront, hidden: !canWrite || !t.is_test, onSelect: () => markTest(false) },
    { label: "Download all its data", icon: DownloadSimple, separatorBefore: true, onSelect: () => exportData("export") },
    { label: "Download consent and audit records", icon: ShieldCheck, onSelect: () => exportData("consent") },
    { label: "Reactivate", icon: CheckCircle, separatorBefore: true, hidden: !canWrite || !t.suspended, onSelect: reactivate, testid: "tenant-reactivate" },
    { label: "Suspend…", icon: Prohibit, danger: true, separatorBefore: true, hidden: !canWrite || t.suspended, onSelect: () => setDialog("suspend"), testid: "tenant-suspend" },
    { label: "Delete workspace…", icon: Trash, danger: true, hidden: !isSuper, onSelect: () => { setWithCopy(true); setDialog("delete"); }, testid: "tenant-delete" },
  ];

  return (
    <AdminPage testid="tenant360-detail"
      back={{ label: "Workspaces", onClick: () => go("workspaces") }}
      title={t.name}
      subtitle={(
        <div className="flex flex-wrap items-center gap-2">
          {statusChip(t.suspended)}{planChip(t.plan)}
          {t.is_test && <Chip title={t.test_reason}>Test workspace</Chip>}
          <span className="text-slate-500">{[t.industry, t.region, t.currency].filter(Boolean).join(" · ") || "No industry set"} · since {fmtDate(t.created_at)}</span>
        </div>
      )}
      actions={(
        <>
          <Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>
          {canWrite && <Btn size="sm" icon={CurrencyInr} onClick={() => { setPlanDraft(t.plan || "trial"); setDialog("plan"); }}>Change plan</Btn>}
          <RowMenu items={menu} testid="workspace-menu" label="Workspace actions"
            trigger={<button type="button" data-testid="workspace-menu" className="inline-flex h-8 items-center gap-1.5 rounded-pill bg-white/75 px-3 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-900/[0.05] hover:bg-white">More<span aria-hidden="true">⋯</span></button>} />
        </>
      )}>
      {t.suspended && (
        <div className="mb-4 rounded-2xl bg-[#cf222e]/[0.06] px-4 py-3 text-sm text-[#8f1620] ring-1 ring-inset ring-[#cf222e]/15">
          This workspace is suspended: nobody in it can sign in. {canWrite && <button type="button" onClick={reactivate} className="font-semibold underline underline-offset-2">Reactivate</button>}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="People" value={fmtNum(c.users)} sub={suspendedPeople ? `${suspendedPeople} suspended` : "with a sign-in"} />
        <Stat label="Tasks" value={fmtNum(c.tasks)} sub={`${fmtNum(c.tasks_done)} done`} />
        <Stat label="Decisions" value={fmtNum(c.decisions)} sub={`${fmtNum(c.workflows)} workflows`} />
        <Stat label="AI spend · 30 days" value={fmtInr(usdToInr(sel.spend.last_30d.cost, rate))} sub={`${fmtNum(sel.spend.last_30d.calls)} calls`} />
        <Stat label="Last active" value={<span className="text-[1.35rem]">{fmtAgo(sel.health.last_activity)}</span>} sub={fmtDateTime(sel.health.last_activity)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title={`People (${sel.members.length})`} hint="Everyone who can sign in to this workspace" testid="workspace-people">
            {sel.members.length === 0 ? <Empty compact icon={Users} title="No one has signed up here yet." /> : (
              <ul className="-mx-2 divide-y divide-slate-900/[0.05]">
                {sel.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{m.name || "No name"} <span className="font-normal text-slate-500">· {roleLabel(m.role, t.roles)}</span></div>
                      <div className="truncate text-xs text-slate-500">{m.email || "—"}</div>
                    </div>
                    {statusChip(m.suspended)}
                    <RowMenu testid={`person-menu-${m.id}`} items={[
                      { label: "Download this person's data", icon: DownloadSimple, onSelect: () => personData(m) },
                      { label: "Find in Users", icon: Users, onSelect: () => go("users") },
                    ]} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent activity" testid="workspace-activity">
            {sel.activity.length === 0 ? <Empty compact icon={ClockCounterClockwise} title="Nothing has happened here yet." /> : (
              <ul className="max-h-[26rem] divide-y divide-slate-900/[0.05] overflow-y-auto">
                {sel.activity.map((a, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0 text-sm text-slate-800 [overflow-wrap:anywhere]">{a.message}</div>
                    <div className="shrink-0 text-xs text-slate-500" title={fmtDateTime(a.created_at)}>{fmtAgo(a.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <BillingPanel tenant={t} canWrite={canWrite} onChangePlan={() => { setPlanDraft(t.plan || "trial"); setDialog("plan"); }} />

          <Panel title="AI" testid="workspace-ai">
            <dl className="space-y-2 text-sm">
              <Row k="Consent to AI processing" v={t.ai_consent ? <Chip tone="good">Given</Chip> : <Chip tone="warn">Not given</Chip>} />
              <Row k="Spend, 30 days" v={<span title={fmtUsd(sel.spend.last_30d.cost)}>{fmtInr(usdToInr(sel.spend.last_30d.cost, rate))}</span>} />
              <Row k="Spend, all time" v={<span title={fmtUsd(sel.spend.all_time.cost)}>{fmtInr(usdToInr(sel.spend.all_time.cost, rate))}</span>} />
              <Row k="Calls, all time" v={fmtNum(sel.spend.all_time.calls)} />
            </dl>
          </Panel>

          <RetentionPanel tenantId={t.id} canWrite={canWrite} />

          <Panel title="Details">
            <dl className="space-y-2 text-sm">
              <Row k="Contacts" v={fmtNum(c.contacts)} />
              <Row k="Invoices" v={fmtNum(c.invoices)} />
              <Row k="Open complaints" v={fmtNum(c.complaints)} />
              <Row k="GST number" v={t.gst || "—"} />
              <Row k="Workspace id" v={(
                <button type="button" onClick={copyId} title="Copy" className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 hover:text-slate-900">
                  {String(t.id).slice(0, 8)}… <Copy size={12} />
                </button>
              )} />
            </dl>
          </Panel>
        </div>
      </div>

      <ReasonDialog open={dialog === "viewas"} onOpenChange={(v) => !v && setDialog(null)} busy={busy === "viewas"}
        title={`View ${t.name} as its owner?`}
        description="A read-only session for 30 minutes: every change is blocked, and the session is listed in the Audit log for anyone to see."
        confirmLabel="Start the session" busyLabel="Starting…" placeholder="e.g. Ticket about a missing invoice" testid="viewas-dialog"
        onConfirm={startViewAs} />

      <ReasonDialog open={dialog === "plan"} onOpenChange={(v) => !v && setDialog(null)} busy={busy === "plan"}
        title={`Change ${t.name}'s plan`}
        description={`Now on ${planLabel(t.plan)}. The change takes effect at once and does not charge or refund anyone.`}
        confirmLabel={planDraft && planDraft !== t.plan ? `Move to ${planLabel(planDraft)}` : "Choose a new plan"}
        ready={!!planDraft && planDraft !== t.plan}
        busyLabel="Changing…" placeholder="e.g. Agreed a free month on the call" testid="plan-dialog"
        onConfirm={changePlan}>
        <div>
          <span className={ADMIN_H3 + " block"}>New plan</span>
          <GlassSelect value={planDraft} onChange={setPlanDraft} options={PLAN_OPTIONS} ariaLabel="New plan" testid="plan-select" />
        </div>
      </ReasonDialog>

      <ReasonDialog open={dialog === "suspend"} onOpenChange={(v) => !v && setDialog(null)} busy={busy === "suspend"} danger
        title={`Suspend ${t.name}?`}
        description="Everyone in it is signed out and can't sign back in until you reactivate it. Nothing is deleted."
        confirmLabel="Suspend the workspace" busyLabel="Suspending…" testid="suspend-dialog" onConfirm={suspend} />

      <TypedConfirmDialog open={dialog === "delete"} onOpenChange={(v) => !v && setDialog(null)} busy={busy === "delete"}
        title={`Delete ${t.name} for good?`}
        description={`Every record goes: ${count(c.users, "person", "people")}, ${count(c.tasks, "task")}, ${count(c.decisions, "decision")}, invoices and files. This cannot be undone.`}
        phrase={t.name} confirmLabel="Delete forever" busyLabel="Deleting…" onConfirm={remove} testid="tenant-delete-modal">
        <div className="rounded-xl bg-white/70 p-3 ring-1 ring-inset ring-slate-900/[0.06]">
          <Toggle checked={withCopy} onChange={setWithCopy} testid="delete-with-copy"
            label="Download a full copy first" hint="An erasure receipt for the company's records (DPDP). Recommended." />
        </div>
      </TypedConfirmDialog>
    </AdminPage>
  );
}

const count = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;

function Row({ k, v }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 truncate text-right text-slate-900">{v}</dd>
    </div>
  );
}

function BillingPanel({ tenant: t, canWrite, onChangePlan }) {
  const { data, error, reload } = useAdminGet(`/admin/billing/tenants/${t.id}/payments`);
  const pays = data?.payments || [];
  return (
    <Panel title="Billing" testid="workspace-billing"
      actions={canWrite ? <Btn size="sm" variant="ghost" onClick={onChangePlan}>Change</Btn> : null}>
      <dl className="space-y-2 text-sm">
        <Row k="Plan" v={planLabel(t.plan)} />
        {t.plan === "trial" && <Row k="Trial ends" v={t.trial_ends_at ? `${fmtDate(t.trial_ends_at)} (${fmtAgo(t.trial_ends_at).toLowerCase()})` : "—"} />}
        <Row k="Seat limit" v={t.seat_limit_override ?? t.seat_limit ?? "Plan default"} />
        <Row k="Paid so far" v={data ? fmtInr(data.lifetime_revenue_inr) : "…"} />
      </dl>
      <div className="mt-4">
        <div className={ADMIN_H3}>Payments</div>
        {error && !data ? <button type="button" onClick={reload} className="text-xs text-slate-500 underline">Couldn&apos;t load payments. Try again</button>
          : !data ? <div className="text-xs text-slate-500">Loading…</div>
          : pays.length === 0 ? <div className="text-xs text-slate-500">No payments recorded.</div> : (
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {pays.slice(0, 20).map((p, i) => (
                <li key={p.id || i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">{humanize(p.event)} · {fmtDate(p.created_at)}</span>
                  <span className="tabular-nums text-slate-900">{p.amount_inr ? fmtInr(p.amount_inr) : "—"}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </Panel>
  );
}

function RetentionPanel({ tenantId, canWrite }) {
  const { data, error, reload } = useAdminGet(`/admin/tenants/${tenantId}/retention`);
  const [pol, setPol] = useState(null);
  const [saving, setSaving] = useState(false);
  const p = pol || data?.policy;
  const set = (patch) => setPol({ ...(pol || data.policy), ...patch });
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/tenants/${tenantId}/retention`, { enabled: p.enabled, ttl_days: p.ttl_days, collections: p.collections });
      toast.success("Retention policy saved");
      setPol(null); reload();
    } catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };
  return (
    <Panel title="Data retention" hint="Delete short-lived data automatically after a while" testid="workspace-retention">
      {error && !data ? <button type="button" onClick={reload} className="text-xs text-slate-500 underline">Couldn&apos;t load the policy. Try again</button>
        : !p ? <div className="text-xs text-slate-500">Loading…</div> : (
          <div className="space-y-3">
            <Toggle checked={p.enabled} onChange={(v) => set({ enabled: v })} disabled={!canWrite}
              label="Delete old short-lived data" hint={`${fmtNum(data.candidates)} rows are past the limit now`} />
            {p.enabled && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  Keep for
                  <input type="number" min={data.min_ttl_days} value={p.ttl_days} disabled={!canWrite}
                    onChange={(e) => set({ ttl_days: parseInt(e.target.value || "0", 10) })}
                    className="h-9 w-20 rounded-xl bg-white px-2 text-sm ring-1 ring-inset ring-slate-900/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25" />
                  days <span className="text-xs text-slate-500">(at least {data.min_ttl_days})</span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {data.eligible_collections.map((col) => {
                    const on = p.collections.includes(col);
                    return (
                      <button key={col} type="button" disabled={!canWrite} aria-pressed={on}
                        onClick={() => set({ collections: on ? p.collections.filter((x) => x !== col) : [...p.collections, col] })}
                        className={`rounded-pill px-2.5 py-1 text-xs ring-1 ring-inset ${on ? "bg-ng-ink text-white ring-transparent" : "bg-white text-slate-600 ring-slate-900/10 hover:text-slate-900"}`}>
                        {humanize(col)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {canWrite && pol && <Btn size="sm" variant="primary" busy={saving} onClick={save}>Save policy</Btn>}
          </div>
        )}
    </Panel>
  );
}


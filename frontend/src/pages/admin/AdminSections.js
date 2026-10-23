import { CARD_BASE } from "./adminStyle";
import { roleLabel } from "../../lib/departments";
/* The admin console's own sections (2026-10-22, admin redesign): Overview,
 * Workspaces, Users, AI usage, AI keys, Audit log, Health. The Workspaces list
 * opens WorkspacePage; Health now carries what Observability did; the Audit
 * log carries the view-as sessions. Test workspaces are left out of lists and
 * totals by default (services/admin_workspaces on the server). */
import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import api from "../../lib/api";
import { ConfirmAction } from "../../components/common";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import {
  Users, ArrowClockwise, PencilSimple, Prohibit, ShieldCheck, Key as KeyIcon, WarningCircle,
  CheckCircle, Lifebuoy, Flag, CurrencyInr, Eye, Hourglass, Pulse, ClockCounterClockwise, ArrowSquareOut,
  ChartBar,
} from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, usePersisted, errText, fmtNum, fmtInr, fmtUsd, usdToInr, fmtDate, fmtDateTime, fmtAgo,
  Btn, Chip, statusChip, SearchField, Segmented, Toggle, RowMenu, AdminPage, Panel, Loading, Empty,
  LoadError, Stat, DataTable, ReasonDialog, LinkOut, ADMIN_FIELD,
} from "./adminUi";
import {
  providerLabel, keySourceLabel, keyStatus, healthOk, healthLabel, humanize,
  auditLabel, AUDIT_GROUPS,
} from "./adminLabels";
import { WorkspacePage } from "./WorkspacePage";
import { CustomersList } from "./CustomersList";
import { ImpersonationSection } from "./ImpersonationSection";

// --- Overview -----------------------------------------------------------------------------
const ATTENTION = [
  { key: "outages", one: "AI provider problem", many: "AI provider problems", to: "health", icon: WarningCircle, tone: "bad" },
  { key: "open_tickets", one: "support ticket waiting", many: "support tickets waiting", to: "support", icon: Lifebuoy },
  { key: "open_reports", one: "report to review", many: "reports to review", to: "reports", icon: Flag },
  { key: "failed_payments", one: "failed payment (30 days)", many: "failed payments (30 days)", to: "billing", icon: CurrencyInr, tone: "bad" },
  { key: "trials_ending", one: "trial ends this week", many: "trials end this week", to: "workspaces?plan=trial", icon: Hourglass },
  { key: "live_view_as", one: "live view-as session", many: "live view-as sessions", to: "audit?view=sessions", icon: Eye },
];

export function OverviewSection() {
  const { go } = useAdmin();
  const [includeTest, setIncludeTest] = usePersisted("overview_include_test", false);
  const { data: o, error, reload } = useAdminGet(`/admin/overview?include_test=${includeTest}`);

  if (error && !o) return <AdminPage title="Overview" testid="admin-overview"><LoadError what="the overview" onRetry={reload} /></AdminPage>;
  if (!o) return <AdminPage title="Overview" testid="admin-overview"><Loading /></AdminPage>;

  const w = o.last_7_days;
  const rate = o.usd_inr;
  const waiting = ATTENTION.filter((a) => (o.needs_attention[a.key] || 0) > 0);
  const subtitle = includeTest
    ? `${o.workspaces.total} workspaces, test workspaces included`
    : `${o.workspaces.total} customer workspaces${o.workspaces.test_hidden ? ` · ${o.workspaces.test_hidden} test workspaces left out` : ""}`;

  return (
    <AdminPage title="Overview" subtitle={subtitle} testid="admin-overview"
      actions={<Toggle checked={includeTest} onChange={setIncludeTest} label="Include test workspaces" testid="overview-include-test" />}>
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel title="Needs attention" className="lg:col-span-2" testid="overview-attention">
          {waiting.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-600/[0.06] px-4 py-4 text-sm text-[#116329]">
              <CheckCircle size={20} weight="fill" /> Nothing needs you right now.
            </div>
          ) : (
            <ul className="-mx-2 space-y-0.5">
              {waiting.map((a) => {
                const n = o.needs_attention[a.key];
                return (
                  <li key={a.key}>
                    <button type="button" onClick={() => go(a.to)} data-testid={`attention-${a.key}`}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-900/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${a.tone === "bad" ? "bg-[#cf222e]/[0.08] text-[#b91c1c]" : "bg-slate-500/[0.08] text-slate-600"}`}>
                        <a.icon size={16} weight="bold" />
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-slate-800">
                        <strong className="font-semibold tabular-nums text-slate-900">{n}</strong> {n === 1 ? a.one : a.many}
                      </span>
                      <span className="text-xs text-slate-400">Open</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-3">
          <Stat label="Active workspaces · 7 days" value={fmtNum(w.active_workspaces.now)} change={w.active_workspaces.change}
            sub={`vs ${w.active_workspaces.before} the week before`} onClick={() => go("workspaces")} testid="stat-active" />
          <Stat label="New sign-ups · 7 days" value={fmtNum(w.signups.now)} change={w.signups.change}
            sub={`vs ${w.signups.before} the week before`} onClick={() => go("workspaces")} testid="stat-signups" />
          <Stat label="AI spend · 7 days" value={fmtInr(usdToInr(w.ai_cost_usd.now, rate))} good="down"
            change={usdToInr(w.ai_cost_usd.change, rate)} formatChange={fmtInr}
            sub={`${fmtUsd(w.ai_cost_usd.now)} at ₹${rate}/$`} onClick={() => go("usage")} testid="stat-ai" />
          <Stat label="Monthly recurring revenue" value={fmtInr(o.mrr_inr)}
            sub={`${o.paying_workspaces} paying workspace${o.paying_workspaces === 1 ? "" : "s"}`} onClick={() => go("billing")} testid="stat-mrr" />
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Most active this week" hint="By actions recorded in the last 7 days">
          {o.most_active.length === 0 ? <Empty compact title="No activity this week." /> : (
            <ol className="-mx-2">
              {o.most_active.map((t, i) => (
                <li key={t.id}>
                  <button type="button" onClick={() => go(`workspaces/${t.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900/[0.04]">
                    <span className="w-4 text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.name}</span>
                    <span className="text-xs tabular-nums text-slate-500">{fmtNum(t.actions)} actions</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Gone quiet" hint="Active 2 to 8 weeks ago, nothing since">
          {o.gone_quiet.length === 0 ? <Empty compact title="No one has gone quiet." /> : (
            <ul className="-mx-2">
              {o.gone_quiet.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => go(`workspaces/${t.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900/[0.04]">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.name}</span>
                    <span className="text-xs text-slate-500">{fmtAgo(t.last_activity)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Trials ending this week">
          {o.trials_ending.length === 0 ? <Empty compact title="No trials end this week." /> : (
            <ul className="-mx-2">
              {o.trials_ending.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => go(`workspaces/${t.id}`)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900/[0.04]">
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.name}</span>
                    <span className="text-xs text-slate-500">{fmtAgo(t.trial_ends_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}

// --- Workspaces --------------------------------------------------------------------------
export function WorkspacesSection({ id, sub }) {
  if (id) return <WorkspacePage id={id} sub={sub} />;
  return <CustomersList />;
}

// --- Users ------------------------------------------------------------------------------
export function UsersSection() {
  const { go, canWrite } = useAdmin();
  const { data, error, reload } = useAdminGet("/admin/users");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [hideTest, setHideTest] = usePersisted("hide_test_people", true);
  const [suspending, setSuspending] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => data?.users || [], [data]);
  const testCount = rows.filter((u) => u.is_test).length;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((u) => (!hideTest || !u.is_test)
      && (status === "all" || (status === "suspended" ? u.suspended : !u.suspended))
      && (!term || `${u.name} ${u.email} ${u.phone} ${u.tenant_name}`.toLowerCase().includes(term)));
  }, [rows, q, status, hideTest]);

  const act = async (u, action, body, done) => {
    setBusy(true);
    try {
      await api.post(`/admin/users/${u.id}/${action}`, body);
      toast.success(done);
      setSuspending(null); setResetting(null);
      reload();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };

  const columns = [
    { key: "name", label: "Name", render: (u) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="truncate font-medium text-slate-900">{u.name || "No name"}</span>{u.is_test && <Chip>Test</Chip>}</div>
        <div className="truncate text-xs text-slate-500">{u.email || u.phone || "—"}</div>
      </div>
    ) },
    { key: "tenant_name", label: "Workspace", render: (u) => (u.tenant_id ? <LinkOut onClick={() => go(`workspaces/${u.tenant_id}`)}>{u.tenant_name}</LinkOut> : "—") },
    { key: "role", label: "Role", sortValue: (u) => roleLabel(u.role), render: (u) => roleLabel(u.role) },
    { key: "last_seen_at", label: "Last seen", render: (u) => (
      <span title={u.last_login_at ? `Last signed in ${fmtDateTime(u.last_login_at)}` : "No sign-in recorded yet"}>
        {u.last_seen_at ? fmtAgo(u.last_seen_at) : "Not yet"}
      </span>
    ) },
    { key: "created_at", label: "Joined", mobile: false, render: (u) => fmtDate(u.created_at) },
    { key: "suspended", label: "Status", sortValue: (u) => (u.suspended ? 1 : 0), render: (u) => statusChip(u.suspended) },
    { key: "_menu", label: "", sortable: false, className: "w-10", render: (u) => (
      <RowMenu testid={`user-menu-${u.id}`} items={[
        { label: "Open workspace", icon: ArrowSquareOut, hidden: !u.tenant_id, onSelect: () => go(`workspaces/${u.tenant_id}`) },
        { label: "Reset access to role defaults", icon: ArrowClockwise, hidden: !canWrite, onSelect: () => setResetting(u), testid: `reset-access-${u.id}` },
        { label: "Reactivate", icon: CheckCircle, hidden: !canWrite || !u.suspended, onSelect: () => act(u, "reactivate", undefined, `${u.name || u.email} can sign in again`), testid: `reactivate-${u.id}` },
        { label: "Suspend…", icon: Prohibit, danger: true, separatorBefore: true, hidden: !canWrite || u.suspended || u.role === "owner", onSelect: () => setSuspending(u), testid: `suspend-${u.id}` },
      ]} />
    ) },
  ];

  return (
    <AdminPage title="Users" testid="admin-users"
      subtitle={data ? `${shown.length} of ${rows.length} people with a sign-in${hideTest && testCount ? ` · ${testCount} test accounts hidden` : ""}` : null}
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchField value={q} onChange={setQ} placeholder="Search name, email, phone or workspace" testid="users-search" className="w-full sm:w-80" />
        <Segmented value={status} onChange={setStatus} ariaLabel="Status" testid="users-status"
          options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
        <div className="sm:ml-auto"><Toggle checked={hideTest} onChange={setHideTest} label="Hide test accounts" testid="users-hide-test" /></div>
      </div>
      {error && !data ? <LoadError what="users" onRetry={reload} /> : !data ? <Loading /> : (
        <div className={CARD_BASE}>
          <DataTable rows={shown} columns={columns} rowTestid={(u) => `user-row-${u.id}`}
            onRowClick={(u) => u.tenant_id && go(`workspaces/${u.tenant_id}`)} initialSort={{ key: "created_at", dir: "desc" }}
            empty={<Empty icon={Users} title="No one matches." hint="Clear the search or the filters to see more." />} />
        </div>
      )}
      <ReasonDialog open={!!suspending} onOpenChange={(v) => !v && setSuspending(null)} busy={busy} danger
        title={suspending ? `Suspend ${suspending.name || suspending.email}?` : ""}
        description="They are signed out and can't sign in until reactivated. Their work stays in the workspace."
        confirmLabel="Suspend" busyLabel="Suspending…" testid="user-suspend-dialog"
        onConfirm={(reason) => act(suspending, "suspend", { reason }, `${suspending.name || suspending.email} is suspended`)} />
      <ConfirmAction open={!!resetting} onOpenChange={() => setResetting(null)} busy={busy} danger={false}
        title={resetting ? `Reset ${resetting.name || resetting.email}'s access?` : ""}
        description="Any permissions set just for them are removed, and they get their role's defaults."
        confirmLabel="Reset access" busyLabel="Resetting…" cancelLabel="Keep as is"
        onConfirm={() => act(resetting, "reset-access", undefined, "Access reset to role defaults")} testid="user-reset-confirm" />
    </AdminPage>
  );
}

// --- AI usage -----------------------------------------------------------------------------
const RANGES = [
  { value: "today", label: "Today" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "all", label: "All time" },
];
const PROVIDER_FILTER = ["all", "sarvam", "anthropic", "emergent", "openai", "gemini"];

export function UsageSection() {
  const { go } = useAdmin();
  const [range, setRange] = useState("30d");
  const [provider, setProvider] = useState("all");
  const [hideTest, setHideTest] = usePersisted("hide_test_workspaces", true);
  const { data, error, reload } = useAdminGet(`/admin/usage?range=${range}&provider=${provider}&include_test=${!hideTest}`);
  const rate = data?.usd_inr || 84;
  const maxCost = Math.max(0.0001, ...(data?.by_provider || []).map((p) => p.cost_estimate));

  const columns = [
    { key: "tenant_name", label: "Workspace", render: (w) => (
      <div className="flex items-center gap-2">
        {w.tenant_id ? <LinkOut onClick={() => go(`workspaces/${w.tenant_id}`)}>{w.tenant_name}</LinkOut> : <span className="text-slate-600">{w.tenant_name}</span>}
        {w.is_test && <Chip>Test</Chip>}
      </div>
    ) },
    { key: "calls", label: "AI calls", align: "right", render: (w) => fmtNum(w.calls) },
    { key: "tokens_in", label: "Tokens in", align: "right", mobile: false, render: (w) => fmtNum(w.tokens_in) },
    { key: "tokens_out", label: "Tokens out", align: "right", mobile: false, render: (w) => fmtNum(w.tokens_out) },
    { key: "cost_estimate", label: "Cost", align: "right", render: (w) => <span title={fmtUsd(w.cost_estimate)}>{fmtInr(usdToInr(w.cost_estimate, rate))}</span> },
  ];

  return (
    <AdminPage title="AI usage" testid="admin-usage"
      subtitle="What AI cost us, by provider and by workspace">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented value={range} onChange={setRange} options={RANGES} ariaLabel="Period" testid="usage-range" />
        <div className="w-52">
          <GlassSelect value={provider} onChange={setProvider} ariaLabel="Provider" testid="usage-provider" triggerClassName="h-10 text-sm"
            options={PROVIDER_FILTER.map((p) => ({ value: p, label: p === "all" ? "Every provider" : providerLabel(p) }))} />
        </div>
        <div className="sm:ml-auto"><Toggle checked={hideTest} onChange={setHideTest} label="Hide test workspaces" testid="usage-hide-test" /></div>
      </div>
      {error && !data ? <LoadError what="AI usage" onRetry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="AI calls" value={fmtNum(data.totals.calls)} testid="usage-total-calls" />
            <Stat label="Tokens" value={fmtNum(data.totals.tokens_total)} testid="usage-total-tokens" />
            <Stat label="Estimated cost" value={fmtInr(usdToInr(data.totals.cost, rate))} sub={`${fmtUsd(data.totals.cost)} at ₹${rate}/$`} testid="usage-total-cost" />
          </div>
          {data.by_provider.length > 0 && (
            <Panel title="By provider" hint={hideTest ? "Test workspaces left out" : null} className="mb-4" testid="usage-by-provider">
              <ul className="space-y-3">
                {data.by_provider.map((p) => (
                  <li key={p.provider} data-testid={`usage-provider-card-${p.provider}`}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium text-slate-800">{providerLabel(p.provider)}</span>
                      <span className="tabular-nums text-slate-900">{fmtInr(usdToInr(p.cost_estimate, rate))}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-500/[0.1]">
                      <div className="h-full rounded-full bg-slate-800" style={{ width: `${Math.max(2, (p.cost_estimate / maxCost) * 100)}%` }} />
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-slate-500">{fmtNum(p.calls)} call{p.calls === 1 ? "" : "s"} · {fmtNum(p.tokens_total)} tokens</div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <div className={CARD_BASE}>
            <DataTable rows={data.workspaces} columns={columns} rowKey="tenant_id" initialSort={{ key: "cost_estimate", dir: "desc" }}
              rowTestid={(w) => `usage-row-${w.tenant_id || "system"}`}
              empty={<Empty icon={ChartBar} title="No AI use in this period." hint="Try a longer period." />} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Estimates, not invoices: text is counted at about four characters a token, voice by audio length. Providers bill in dollars;
            shown at ₹{rate} to the dollar (set it in <button type="button" onClick={() => go("config")} className="underline underline-offset-2">Config</button>).
          </p>
        </>
      )}
    </AdminPage>
  );
}

// --- AI keys ------------------------------------------------------------------------------
export function AiKeysSection() {
  const { isSuper } = useAdmin();
  const { data, error, reload } = useAdminGet("/admin/ai-keys");
  const [status, setStatus] = useState({});
  const [testing, setTesting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      const { data: s } = await api.get("/admin/ai-keys/status");
      setStatus({ sarvam: s.sarvam, anthropic: s.anthropic, openai: s.openai, gemini: s.gemini,
        wa_access_token: s.whatsapp, wa_phone_number_id: s.whatsapp });
    } catch (e) { toast.error(errText(e)); } finally { setTesting(false); }
  };

  const save = async (provider) => {
    setSaving(true);
    try {
      await api.put("/admin/ai-keys", { [provider]: draft });
      toast.success(draft ? "Key saved" : "Back on the server default");
      setEditing(null); setDraft(""); reload();
    } catch (e) { toast.error(errText(e)); } finally { setSaving(false); }
  };

  return (
    <AdminPage title="AI keys" testid="admin-ai-keys"
      subtitle="The keys the platform calls AI providers with. A key set here wins over the server default."
      actions={<Btn data-testid="test-all-keys" icon={ArrowClockwise} busy={testing} onClick={test}>{testing ? "Checking…" : "Check every key"}</Btn>}>
      {error && !data ? <LoadError what="the keys" onRetry={reload} /> : !data ? <Loading /> : (
        <div className={`${CARD_BASE} divide-y divide-slate-900/[0.06]`}>
          {data.keys.map((k) => {
            const st = status[k.provider] && keyStatus(status[k.provider].status);
            return (
              <div key={k.provider} className="p-5" data-testid={`ai-key-${k.provider}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-medium text-slate-900">{k.label}</span>
                      <Chip tone={k.source === "not_set" ? "neutral" : "info"}>{keySourceLabel(k.source)}</Chip>
                      {st && <Chip tone={st.tone} title={status[k.provider].detail}>{st.label}</Chip>}
                    </div>
                    <div className="mt-1.5 font-mono text-xs text-slate-500">{k.masked || "No key"}</div>
                    {k.note && <div className="mt-1 text-xs text-slate-500">{k.note}</div>}
                    {st && status[k.provider].detail && st.tone !== "good" && <div className="mt-1 text-xs text-[#b91c1c]">{status[k.provider].detail}</div>}
                  </div>
                  {isSuper && editing !== k.provider && (
                    <Btn size="sm" icon={PencilSimple} data-testid={`edit-key-${k.provider}`} onClick={() => { setEditing(k.provider); setDraft(""); }}>Replace</Btn>
                  )}
                </div>
                {editing === k.provider && (
                  <form onSubmit={(e) => { e.preventDefault(); save(k.provider); }} className="mt-4 space-y-3" data-testid={`edit-panel-${k.provider}`}>
                    <input data-testid={`key-input-${k.provider}`} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                      placeholder="Paste the new key" autoComplete="off" className={`${ADMIN_FIELD} font-mono`} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Btn type="submit" variant="primary" size="sm" busy={saving} disabled={!draft} data-testid={`save-key-${k.provider}`}>Save key</Btn>
                      {k.source === "custom" && <Btn size="sm" busy={saving} onClick={() => { setDraft(""); save(k.provider); }}>Use the server default</Btn>}
                      <Btn size="sm" variant="ghost" onClick={() => { setEditing(null); setDraft(""); }}>Cancel</Btn>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!isSuper && <p className="mt-3 text-xs text-slate-500">Only a super admin can replace a key.</p>}
    </AdminPage>
  );
}

// --- Audit log ------------------------------------------------------------------------------
export function AuditSection() {
  const { go } = useAdmin();
  const location = useLocation();
  const view = new URLSearchParams(location.search).get("view") === "sessions" ? "sessions" : "actions";
  return (
    <AdminPage title="Audit log" testid="admin-audit"
      subtitle="Everything an admin did, and every session where an admin looked through a customer's eyes"
      actions={<Segmented value={view} onChange={(v) => go(v === "sessions" ? "audit?view=sessions" : "audit", { replace: true })}
        options={[{ value: "actions", label: "Admin actions" }, { value: "sessions", label: "View-as sessions" }]} testid="audit-view" />}>
      {view === "sessions" ? <ImpersonationSection embedded /> : <AuditActions />}
    </AdminPage>
  );
}

function AuditActions() {
  const { data, error, reload } = useAdminGet("/admin/audit?limit=500");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const rows = useMemo(() => data?.entries || [], [data]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const g = AUDIT_GROUPS.find((x) => x.value === group);
    return rows.filter((e) => (!g?.match || g.match(e.action || ""))
      && (!term || `${e.message} ${e.admin_email} ${auditLabel(e.action)}`.toLowerCase().includes(term)));
  }, [rows, q, group]);
  const columns = [
    { key: "created_at", label: "When", className: "whitespace-nowrap", render: (e) => <span title={fmtDateTime(e.created_at)}>{fmtAgo(e.created_at)}</span> },
    { key: "action", label: "What", sortValue: (e) => auditLabel(e.action), render: (e) => (
      <div className="min-w-0">
        <div className="font-medium text-slate-900">{auditLabel(e.action)}</div>
        <div className="text-xs text-slate-500 [overflow-wrap:anywhere]">{e.message}</div>
      </div>
    ) },
    { key: "admin_email", label: "Who", mobile: false, render: (e) => <span className="text-slate-600">{e.admin_email || "—"}</span> },
  ];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchField value={q} onChange={setQ} placeholder="Search what happened or who did it" testid="audit-search" className="w-full sm:w-80" />
        <div className="w-52">
          <GlassSelect value={group} onChange={setGroup} ariaLabel="Kind of action" testid="audit-group" triggerClassName="h-10 text-sm"
            options={AUDIT_GROUPS.map(({ value, label }) => ({ value, label }))} />
        </div>
        <Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload} className="sm:ml-auto" data-testid="audit-refresh">Refresh</Btn>
      </div>
      {error && !data ? <LoadError what="the audit log" onRetry={reload} /> : !data ? <Loading /> : (
        <div className={CARD_BASE}>
          <DataTable rows={shown} columns={columns} pageSize={50} initialSort={{ key: "created_at", dir: "desc" }}
            rowTestid={(e) => `audit-row-${e.id}`}
            empty={<Empty icon={ClockCounterClockwise} title={rows.length ? "Nothing matches." : "No admin activity yet."} />} />
        </div>
      )}
      {rows.length >= 500 && <p className="mt-3 text-xs text-slate-500">Showing the latest 500 entries.</p>}
    </>
  );
}

// --- Health (with what Observability showed) ---------------------------------------------
const OBS_RANGES = [{ value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }];

export function HealthSection() {
  const { go } = useAdmin();
  const [range, setRange] = useState("24h");
  const health = useAdminGet("/admin/health");
  const alerts = useAdminGet("/admin/alerts");
  const rel = useAdminGet(`/admin/observability/reliability?range=${range}`);
  const errs = useAdminGet(`/admin/observability/errors?range=${range}`);
  const out = useAdminGet("/admin/observability/outages");
  const reloadAll = () => { health.reload(); alerts.reload(); rel.reload(); errs.reload(); out.reload(); };

  const h = health.data;
  const active = alerts.data?.active || [];
  const r = rel.data;
  const pct = (v) => `${((v || 0) * 100).toFixed(1)}%`;

  const tiles = h ? [
    { label: "Database", v: h.database.status },
    { label: "Scheduler", v: h.scheduler.status, detail: h.scheduler.detail },
    { label: "Emergent key", v: h.emergent_key },
    { label: "AI providers", v: active.length ? "problem" : "ok", detail: active.length ? `${active.length} problem${active.length > 1 ? "s" : ""}` : "No problems reported" },
  ] : [];

  const ProviderTable = ({ title, rows, label }) => (
    <Panel title={title}>
      {!rows?.length ? <Empty compact title="No AI calls in this window." /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-[0.1em] text-slate-500">
            <th className="pb-2 text-left font-semibold">Name</th><th className="pb-2 text-right font-semibold">Calls</th>
            <th className="pb-2 text-right font-semibold">Errors</th><th className="pb-2 text-right font-semibold">Avg time</th>
          </tr></thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.key} className="border-t border-slate-900/[0.05]">
                <td className="py-2 text-slate-800">{label(x.key)}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">{fmtNum(x.calls)}</td>
                <td className={`py-2 text-right tabular-nums ${x.errors ? "text-[#b91c1c]" : "text-slate-400"}`}>{x.errors}</td>
                <td className="py-2 text-right tabular-nums text-slate-600">{fmtNum(x.avg_latency_ms)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );

  return (
    <AdminPage title="Health" testid="admin-health" subtitle="Is the platform working, and is AI answering?"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reloadAll}>Refresh</Btn>}>
      {health.error && !h ? <LoadError what="health" onRetry={health.reload} /> : !h ? <Loading /> : (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => {
            const ok = healthOk(t.v);
            return (
              <div key={t.label} className={`${CARD_BASE} p-5`} data-testid={`health-${t.label}`}>
                <div className="flex items-center gap-2">
                  {ok ? <ShieldCheck size={18} weight="fill" className="text-[#116329]" /> : <WarningCircle size={18} weight="fill" className="text-[#b91c1c]" />}
                  <span className="text-sm font-medium text-slate-900">{t.label}</span>
                </div>
                <div className={`mt-2 text-sm ${ok ? "text-[#116329]" : "text-[#b91c1c]"}`}>{healthLabel(t.v)}</div>
                {t.detail && <div className="mt-0.5 text-xs text-slate-500">{t.detail}</div>}
              </div>
            );
          })}
        </div>
      )}

      {active.length > 0 && (
        <Panel title="AI provider problems" className="mb-4 ring-[#cf222e]/20" testid="health-alerts"
          actions={<Btn size="sm" icon={KeyIcon} onClick={() => go("ai-keys")}>Open AI keys</Btn>}>
          <ul className="space-y-2">
            {active.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Chip tone="bad">{providerLabel(a.provider)}</Chip>
                <span className="text-slate-800">{humanize(a.status)}</span>
                <span className="text-xs text-slate-500">since {fmtAgo(a.created_at)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">Replace or clear the key in AI keys to restore service. Customers may see AI features fail until then.</p>
        </Panel>
      )}

      {h && (
        <Panel title="Where each key comes from" className="mb-6">
          <div className="flex flex-wrap gap-2">
            {Object.entries(h.ai_providers).map(([k, v]) => (
              <Chip key={k} tone={v === "not_set" ? "neutral" : "info"}>{providerLabel(k)} · {keySourceLabel(v)}</Chip>
            ))}
          </div>
        </Panel>
      )}

      <AnalyticsDataPanel />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Pulse size={18} /> AI reliability</h2>
        <Segmented value={range} onChange={setRange} options={OBS_RANGES} ariaLabel="Window" testid="health-range" />
      </div>
      {rel.error && !r ? <LoadError what="AI reliability" onRetry={rel.reload} /> : !r ? <Loading /> : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="AI calls" value={fmtNum(r.calls)} />
            <Stat label="Failed" value={pct(r.error_rate)} sub={`${fmtNum(r.errors)} calls`} />
            <Stat label="Answered by a fallback" value={pct(r.degraded_rate)} />
            <Stat label="Slowest 5% take" value={`${fmtNum(r.latency_ms.p95)} ms`} sub={`Typical ${fmtNum(r.latency_ms.p50)} ms`} />
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <ProviderTable title="By provider" rows={r.by_provider} label={providerLabel} />
            <ProviderTable title="By task" rows={r.by_task.slice(0, 12)} label={humanize} />
          </div>
        </>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent AI errors">
          {!errs.data ? <Loading /> : errs.data.count === 0 ? (
            <div className="flex items-center gap-2 py-3 text-sm text-[#116329]"><CheckCircle size={18} weight="fill" /> No AI errors in this window.</div>
          ) : (
            <ul className="max-h-72 divide-y divide-slate-900/[0.05] overflow-y-auto">
              {errs.data.errors.map((e, i) => (
                <li key={i} className="py-2.5">
                  <div className="text-sm text-slate-800">{humanize(e.task)} <span className="text-xs text-slate-500">· {providerLabel(e.engine)} {e.model ? `· ${e.model}` : ""}</span></div>
                  <div className="mt-0.5 text-xs text-[#b91c1c] [overflow-wrap:anywhere]">{e.error || "No message recorded"}</div>
                  <div className="text-[11px] text-slate-400">{fmtDateTime(e.created_at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Provider outages">
          {!out.data ? <Loading /> : out.data.outages.length === 0 ? <Empty compact title="No outages recorded." /> : (
            <ul className="max-h-72 divide-y divide-slate-900/[0.05] overflow-y-auto">
              {out.data.outages.map((o, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <div className="text-sm text-slate-800">{providerLabel(o.provider)} · {humanize(o.status)}</div>
                    <div className="text-[11px] text-slate-400">{fmtDateTime(o.created_at)}</div>
                  </div>
                  {o.resolved ? <Chip tone="good">Resolved</Chip> : <Chip tone="bad">Ongoing</Chip>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}


/* 2026-10-23 (admin console v2 P1): the analytics foundations, so an operator
   can see they are filling before any chart is drawn on them -- sign-ins and
   presence, the daily roll-up kept for good, activation. */
function AnalyticsDataPanel() {
  const { isSuper } = useAdmin();
  const { data, error, reload } = useAdminGet("/admin/analytics/status");
  const [busy, setBusy] = useState(false);
  const rebuild = async () => {
    setBusy(true);
    try {
      const r = await api.post("/admin/analytics/rebuild");
      toast.success(r.data.started ? "Counting again. This takes a few minutes; Refresh shows when it's done."
        : "A count is already running.");
      reload();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const last = [data?.rollup?.last_run, data?.backfill?.last_run].filter(Boolean).sort().pop();
  const a = data?.activation;
  return (
    <Panel title="Analytics data" className="mb-6" testid="health-analytics"
      hint="Sign-ins, who was here each day, and a daily count per workspace, kept for good"
      actions={isSuper ? <Btn size="sm" icon={ArrowClockwise} busy={busy} onClick={rebuild} data-testid="analytics-rebuild">Count again</Btn> : null}>
      {error && !data ? <LoadError what="the analytics status" onRetry={reload} /> : !data ? <Loading /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">Daily count last ran</div>
            <div className="text-sm text-slate-900" title={fmtDateTime(last)}>{data.rebuilding ? "Counting now…" : last ? fmtAgo(last) : "Not yet"}</div>
            <div className="text-xs text-slate-500">{fmtNum(data.kept.daily_rows)} company-days kept</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">People here</div>
            <div className="text-sm tabular-nums text-slate-900">
              {fmtNum(data.active_people.today)} today · {fmtNum(data.active_people.last_7_days)} this week · {fmtNum(data.active_people.last_30_days)} this month
            </div>
            <div className="text-xs text-slate-500">Counted from sign-ins since 23 Oct 2026</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Activated workspaces</div>
            <div className="text-sm tabular-nums text-slate-900">{fmtNum(a.activated)} of {fmtNum(a.workspaces)}</div>
            <div className="text-xs text-slate-500">{fmtNum(a.activated_of_those)} of {fmtNum(a.signed_up_90_days)} signed up in 90 days</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Lifecycle events kept</div>
            <div className="text-sm tabular-nums text-slate-900">{fmtNum(data.kept.lifecycle_events)}</div>
            <div className="text-xs text-slate-500">Sign-ups, plan changes, payments, suspensions</div>
          </div>
        </div>
      )}
    </Panel>
  );
}

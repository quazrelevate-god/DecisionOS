import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
/* All customers (2026-10-23, admin console v2 P2; replaces the plain
 * Workspaces list). Health and stage for every company, the columns an
 * operator chooses, views the team saves and shares ("Paying and quiet"),
 * bulk tag / owner / test marks, and a CSV of whatever is on screen. */
import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import api from "../../lib/api";
import { saveFile } from "../../lib/native/files";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { GLASS_MENU, GLASS_MENU_ITEM, GLASS_MENU_LABEL } from "../../components/neuglass/glass";
import {
  ArrowClockwise, Buildings, Columns, DownloadSimple, Tag, UserCircle, Flask, Storefront, X, BookmarkSimple, Check,
} from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, usePersisted, errText, fmtNum, fmtInr, usdToInr, fmtDate, fmtDateTime, fmtAgo, Btn, Chip,
  planChip, SearchField, Toggle, AdminPage, Loading, Empty, LoadError, DataTable, AdminDialog, ADMIN_FIELD,
} from "./adminUi";
import { PLAN_OPTIONS, planLabel } from "./adminLabels";
import { HealthChip, StageChip, STAGE_OPTIONS, stageLabel } from "./customerKit";

const DAY = 86400000;
const ago = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / DAY : Infinity);

/* Views everyone has; saved views add to these. */
const BUILT_IN = [
  { id: "all", name: "All", test: () => true },
  { id: "at_risk", name: "At risk", test: (c) => c.stage === "at_risk" },
  { id: "trials_ending", name: "Trials ending", test: (c) => c.plan === "trial" && c.trial_ends_at && ago(c.trial_ends_at) > -7 && ago(c.trial_ends_at) <= 0 },
  { id: "paying_quiet", name: "Paying and quiet", test: (c) => c.mrr_inr > 0 && ago(c.last_seen_at) >= 7 },
  { id: "not_activated", name: "Not activated", test: (c) => !c.activated_at && ago(c.created_at) >= 14 && !["churned", "suspended"].includes(c.stage) },
  { id: "over_seats", name: "Over seat limit", test: (c) => c.seat_limit != null && c.seats > c.seat_limit },
  { id: "follow_up", name: "Follow up due", test: (c) => c.next_follow_up_at && c.next_follow_up_at <= new Date().toISOString().slice(0, 10) },
];

const COLUMNS = [
  { key: "health", label: "Health" }, { key: "stage", label: "Stage" }, { key: "plan", label: "Plan" },
  { key: "mrr", label: "MRR" }, { key: "seats", label: "Seats" }, { key: "active", label: "Active 7 days" },
  { key: "last_seen", label: "Last seen" }, { key: "ai_cost", label: "AI cost 30 days" }, { key: "owner", label: "Owner" },
  { key: "tags", label: "Tags" }, { key: "follow_up", label: "Follow up" }, { key: "created", label: "Signed up" },
];
const DEFAULT_COLUMNS = ["health", "stage", "plan", "mrr", "seats", "active", "last_seen", "owner"];

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function CustomersList() {
  const { go, canWrite } = useAdmin();
  const location = useLocation();
  const [hideTest, setHideTest] = usePersisted("hide_test_workspaces", true);
  const { data, error, reload } = useAdminGet(`/admin/customers?include_test=${!hideTest}`);
  const views = useAdminGet("/admin/views");
  const admins = useAdminGet("/admin/admin-names");
  const [columns, setColumns] = usePersisted("customer_columns", DEFAULT_COLUMNS);
  const [viewId, setViewId] = useState(() => (new URLSearchParams(location.search).get("plan") === "trial" ? "trials_ending" : "all"));
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [plan, setPlan] = useState("");
  const [owner, setOwner] = useState("");
  const [tag, setTag] = useState("");
  const [picked, setPicked] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);   // {kind: "tag"|"untag"|"owner"|"save"}
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const rate = data?.usd_inr || 84;
  const rows = useMemo(() => data?.customers || [], [data]);
  const saved = useMemo(() => views.data?.views || [], [views.data]);
  const allTags = useMemo(() => [...new Set(rows.flatMap((c) => c.tags || []))].sort(), [rows]);
  const adminOptions = (admins.data?.admins || []).map((a) => ({ value: a.id, label: a.name }));

  const builtIn = BUILT_IN.find((v) => v.id === viewId);
  const savedView = saved.find((v) => v.id === viewId);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = savedView?.filters || {};
    return rows.filter((c) => (builtIn ? builtIn.test(c) : true)
      && (!f.stage || c.stage === f.stage) && (!f.plan || c.plan === f.plan)
      && (!f.owner || c.owner_admin_id === f.owner) && (!f.tag || (c.tags || []).includes(f.tag))
      && (!stage || c.stage === stage) && (!plan || c.plan === plan)
      && (!owner || (owner === "none" ? !c.owner_admin_id : c.owner_admin_id === owner))
      && (!tag || (c.tags || []).includes(tag))
      && (!term || `${c.name} ${c.industry || ""} ${(c.tags || []).join(" ")} ${c.owner_name || ""}`.toLowerCase().includes(term)));
  }, [rows, builtIn, savedView, q, stage, plan, owner, tag]);
  const counts = useMemo(() => Object.fromEntries(BUILT_IN.map((v) => [v.id, rows.filter(v.test).length])), [rows]);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allPicked = shown.length > 0 && shown.every((c) => picked.has(c.id));
  const pickAll = () => setPicked(allPicked ? new Set() : new Set(shown.map((c) => c.id)));
  const visible = savedView?.columns?.length ? savedView.columns : columns;

  const runBulk = async (action, value) => {
    setBusy(true);
    try {
      const ids = [...picked];
      const r = await api.post("/admin/customers/bulk", { tenant_ids: ids, action, value });
      toast.success(`${fmtNum(r.data.changed)} workspace${r.data.changed === 1 ? "" : "s"} updated`);
      setDialog(null); setDraft(""); setPicked(new Set());
      reload();
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const saveView = async () => {
    setBusy(true);
    try {
      const r = await api.post("/admin/views", { name: draft, filters: { stage, plan, owner, tag }, columns });
      toast.success(`Saved the view "${r.data.view.name}" for the team`);
      setDialog(null); setDraft(""); views.reload(); setViewId(r.data.view.id);
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  };
  const deleteView = async (v) => {
    try { await api.delete(`/admin/views/${v.id}`); toast.success(`Deleted the view "${v.name}"`); views.reload(); setViewId("all"); }
    catch (e) { toast.error(errText(e)); }
  };
  const exportCsv = async () => {
    const list = picked.size ? shown.filter((c) => picked.has(c.id)) : shown;
    const head = ["Workspace", "Health", "Stage", "Plan", "MRR (INR)", "Seats", "Seat limit", "Active 7 days", "Last seen",
      "AI cost 30 days (USD)", "Owner", "Tags", "Follow up", "Signed up"];
    const lines = [head.join(",")].concat(list.map((c) => [c.name, c.health?.score, stageLabel(c.stage), planLabel(c.plan), c.mrr_inr,
      c.seats, c.seat_limit ?? "", c.active_7d, c.last_seen_at || "", c.ai_cost_30d_usd, c.owner_name || "", (c.tags || []).join("; "),
      c.next_follow_up_at || "", (c.created_at || "").slice(0, 10)].map(csvCell).join(",")));
    try {
      await saveFile(new Blob([lines.join("\n")], { type: "text/csv" }), `customers_${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${fmtNum(list.length)} customer${list.length === 1 ? "" : "s"}`);
    } catch { toast.error("Couldn't save the file. Try again, or use another browser."); }
  };

  const cols = [
    canWrite && { key: "_pick", sortable: false, className: "w-10",
      label: <input type="checkbox" aria-label="Pick every customer shown" checked={allPicked} onChange={pickAll} className="h-4 w-4 accent-slate-900" />,
      render: (c) => <input type="checkbox" aria-label={`Pick ${c.name}`} checked={picked.has(c.id)} onClick={(e) => e.stopPropagation()}
        onChange={() => toggle(c.id)} className="h-4 w-4 accent-slate-900" data-testid={`pick-${c.id}`} /> },
    { key: "name", label: "Customer", render: (c) => (
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="truncate font-medium text-slate-900">{c.name}</span>{c.is_test && <Chip>Test</Chip>}</div>
        <div className="truncate text-xs text-slate-500">{c.industry || "No industry set"}{c.tags?.length ? ` · ${c.tags.join(", ")}` : ""}</div>
      </div>
    ) },
    visible.includes("health") && { key: "health", label: "Health", sortValue: (c) => c.health?.score, render: (c) => <HealthChip health={c.health} testid={`health-${c.id}`} /> },
    visible.includes("stage") && { key: "stage", label: "Stage", sortValue: (c) => stageLabel(c.stage), render: (c) => <StageChip stage={c.stage} /> },
    visible.includes("plan") && { key: "plan", label: "Plan", sortValue: (c) => planLabel(c.plan), render: (c) => planChip(c.plan) },
    visible.includes("mrr") && { key: "mrr_inr", label: "MRR", align: "right", render: (c) => (c.mrr_inr ? fmtInr(c.mrr_inr) : "—") },
    visible.includes("seats") && { key: "seats", label: "Seats", align: "right", render: (c) => (
      <span className={c.seat_limit != null && c.seats > c.seat_limit ? "font-medium text-[#b91c1c]" : ""}>
        {c.seats}{c.seat_limit != null ? ` / ${c.seat_limit}` : ""}
      </span>
    ) },
    visible.includes("active") && { key: "active_7d", label: "Active 7 days", align: "right" },
    visible.includes("last_seen") && { key: "last_seen_at", label: "Last seen", render: (c) => <span title={fmtDateTime(c.last_seen_at)}>{fmtAgo(c.last_seen_at)}</span> },
    visible.includes("ai_cost") && { key: "ai_cost_30d_usd", label: "AI cost 30 days", align: "right", render: (c) => fmtInr(usdToInr(c.ai_cost_30d_usd, rate)) },
    visible.includes("owner") && { key: "owner_name", label: "Owner", render: (c) => c.owner_name || <span className="text-slate-400">—</span> },
    visible.includes("tags") && { key: "tags", label: "Tags", sortValue: (c) => (c.tags || []).join(","), render: (c) => (
      <div className="flex flex-wrap gap-1">{(c.tags || []).map((t) => <Chip key={t}>{t}</Chip>)}</div>
    ) },
    visible.includes("follow_up") && { key: "next_follow_up_at", label: "Follow up", render: (c) => (c.next_follow_up_at ? fmtDate(c.next_follow_up_at) : "—") },
    visible.includes("created") && { key: "created_at", label: "Signed up", mobile: false, render: (c) => fmtDate(c.created_at) },
  ].filter(Boolean);

  return (
    <AdminPage title="Customers" testid="admin-tenants"
      subtitle={data ? `${fmtNum(shown.length)} of ${fmtNum(rows.length)} customers${hideTest ? " · test workspaces hidden" : ""}` : null}
      actions={(
        <>
          <Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>
          <Btn size="sm" icon={DownloadSimple} onClick={exportCsv} disabled={!shown.length} data-testid="customers-export">
            Export CSV{picked.size ? ` (${picked.size})` : ""}
          </Btn>
        </>
      )}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Views">
        {BUILT_IN.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={viewId === v.id} onClick={() => setViewId(v.id)}
            data-testid={`view-${v.id}`}
            className={`inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-[13px] font-medium transition-colors ${viewId === v.id ? "bg-ng-ink text-white" : "text-slate-600 hover:bg-slate-900/[0.05]"}`}>
            {v.name}{data && <span className={`tabular-nums text-[11px] ${viewId === v.id ? "text-white/70" : "text-slate-400"}`}>{counts[v.id]}</span>}
          </button>
        ))}
        {saved.map((v) => (
          <span key={v.id} className={`inline-flex h-8 items-center rounded-pill text-[13px] font-medium ${viewId === v.id ? "bg-ng-ink text-white" : "text-slate-600 hover:bg-slate-900/[0.05]"}`}>
            <button type="button" role="tab" aria-selected={viewId === v.id} onClick={() => setViewId(v.id)} className="inline-flex items-center gap-1.5 pl-3 pr-1">
              <BookmarkSimple size={13} /> {v.name}
            </button>
            {canWrite && (
              <button type="button" aria-label={`Delete the view ${v.name}`} title="Delete this view" onClick={() => deleteView(v)}
                className="mr-1 grid h-6 w-6 place-items-center rounded-full opacity-60 hover:opacity-100"><X size={12} /></button>
            )}
          </span>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchField value={q} onChange={setQ} placeholder="Search name, industry, tag or owner" testid="tenants-search" className="w-full sm:w-72" />
        <div className="w-40"><GlassSelect value={stage} onChange={setStage} ariaLabel="Stage" testid="customers-stage" triggerClassName="h-10 text-sm"
          options={[{ value: "", label: "Every stage" }, ...STAGE_OPTIONS]} /></div>
        <div className="w-40"><GlassSelect value={plan} onChange={setPlan} ariaLabel="Plan" testid="tenants-plan" triggerClassName="h-10 text-sm"
          options={[{ value: "", label: "Every plan" }, ...PLAN_OPTIONS]} /></div>
        <div className="w-44"><GlassSelect value={owner} onChange={setOwner} ariaLabel="Owner" testid="customers-owner" triggerClassName="h-10 text-sm"
          options={[{ value: "", label: "Any owner" }, { value: "none", label: "No owner" }, ...adminOptions]} /></div>
        {allTags.length > 0 && (
          <div className="w-40"><GlassSelect value={tag} onChange={setTag} ariaLabel="Tag" testid="customers-tag" triggerClassName="h-10 text-sm"
            options={[{ value: "", label: "Any tag" }, ...allTags.map((t) => ({ value: t, label: t }))]} /></div>
        )}
        <ColumnChooser columns={columns} setColumns={setColumns} locked={!!savedView?.columns?.length} />
        {canWrite && (stage || plan || owner || tag) && !savedView && (
          <Btn size="sm" variant="ghost" icon={BookmarkSimple} onClick={() => { setDraft(""); setDialog({ kind: "save" }); }} data-testid="save-view">Save as a view</Btn>
        )}
        <div className="sm:ml-auto"><Toggle checked={hideTest} onChange={setHideTest} label="Hide test workspaces" testid="tenants-hide-test" /></div>
      </div>

      {canWrite && picked.size > 0 && (
        <div className={`${CARD_BASE} mb-3 flex flex-wrap items-center gap-2 px-4 py-2.5`} data-testid="bulk-bar">
          <span className="text-sm font-medium text-slate-900">{picked.size} picked</span>
          <Btn size="sm" icon={Tag} onClick={() => { setDraft(""); setDialog({ kind: "tag" }); }}>Tag</Btn>
          <Btn size="sm" onClick={() => { setDraft(""); setDialog({ kind: "untag" }); }}>Remove a tag</Btn>
          <Btn size="sm" icon={UserCircle} onClick={() => { setDraft(""); setDialog({ kind: "owner" }); }}>Assign owner</Btn>
          <Btn size="sm" icon={Flask} onClick={() => runBulk("test")} busy={busy}>Mark as test</Btn>
          <Btn size="sm" icon={Storefront} onClick={() => runBulk("customer")} busy={busy}>Mark as customer</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setPicked(new Set())} className="ml-auto">Clear</Btn>
        </div>
      )}

      {error && !data ? <LoadError what="customers" onRetry={reload} /> : !data ? <Loading label="Working out every customer's health…" /> : (
        <div className={CARD_BASE}>
          <DataTable rows={shown} columns={cols} onRowClick={(c) => go(`workspaces/${c.id}`)}
            rowTestid={(c) => `tenant-row-${c.id}`} initialSort={{ key: "health", dir: "asc" }}
            empty={<Empty icon={Buildings} title={rows.length ? "No customer matches." : "No customers yet."}
              hint={rows.length ? "Try another view, or clear the filters." : "Customers appear here when a company signs up."} />} />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Health is out of 100: activity, breadth, momentum, setup and friction. Open a customer to see why.</p>

      <AdminDialog open={!!dialog} onOpenChange={(v) => !v && setDialog(null)} busy={busy} testid="customers-dialog"
        title={dialog?.kind === "save" ? "Save this view for the team" : dialog?.kind === "owner" ? `Assign an owner to ${picked.size}` : dialog?.kind === "untag" ? `Remove a tag from ${picked.size}` : `Tag ${picked.size} customer${picked.size === 1 ? "" : "s"}`}>
        <form className="mt-1 space-y-4" onSubmit={(e) => {
          e.preventDefault();
          if (dialog?.kind === "save") saveView();
          else runBulk(dialog?.kind, draft);
        }}>
          {dialog?.kind === "owner" ? (
            <GlassSelect value={draft} onChange={setDraft} options={[{ value: "", label: "No owner" }, ...adminOptions]} ariaLabel="Owner" testid="bulk-owner" />
          ) : dialog?.kind === "untag" ? (
            <GlassSelect value={draft} onChange={setDraft} placeholder="Choose a tag" options={allTags.map((t) => ({ value: t, label: t }))} ariaLabel="Tag" />
          ) : (
            <label className="block">
              <span className={ADMIN_H3 + " block"}>{dialog?.kind === "save" ? "Name" : "Tag"}</span>
              <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
                placeholder={dialog?.kind === "save" ? "e.g. Paying textiles, no owner" : "e.g. textiles"} className={ADMIN_FIELD} data-testid="customers-dialog-input" />
              {dialog?.kind === "tag" && allTags.length > 0 && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {allTags.slice(0, 12).map((t) => (
                    <button key={t} type="button" onClick={() => setDraft(t)} className="rounded-pill bg-slate-500/[0.08] px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-500/[0.15]">{t}</button>
                  ))}
                </span>
              )}
            </label>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Btn variant="ghost" onClick={() => setDialog(null)}>Cancel</Btn>
            <Btn type="submit" variant="primary" busy={busy} disabled={dialog?.kind !== "owner" && !draft.trim()} data-testid="customers-dialog-go">
              {dialog?.kind === "save" ? "Save view" : dialog?.kind === "owner" ? "Assign" : dialog?.kind === "untag" ? "Remove tag" : "Add tag"}
            </Btn>
          </div>
        </form>
      </AdminDialog>
    </AdminPage>
  );
}

function ColumnChooser({ columns, setColumns, locked }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" disabled={locked} title={locked ? "This saved view chooses its own columns" : "Choose columns"}
          data-testid="column-chooser"
          className="inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-xs font-medium text-slate-600 hover:bg-slate-900/[0.05] hover:text-slate-900 disabled:opacity-50">
          <Columns size={13} /> Columns
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={`${GLASS_MENU} min-w-[13rem] p-1.5`}>
          <DropdownMenu.Label className={GLASS_MENU_LABEL}>Show columns</DropdownMenu.Label>
          {COLUMNS.map((c) => (
            <DropdownMenu.CheckboxItem key={c.key} checked={columns.includes(c.key)} className={GLASS_MENU_ITEM}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => setColumns((cur) => (on ? [...cur, c.key] : cur.filter((k) => k !== c.key)))}>
              <span className="grid h-4 w-4 place-items-center rounded ring-1 ring-inset ring-slate-400/60">
                <DropdownMenu.ItemIndicator><Check size={12} weight="bold" /></DropdownMenu.ItemIndicator>
              </span>
              {c.label}
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

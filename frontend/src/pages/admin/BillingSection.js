import { CARD_BASE } from "./adminStyle";
// Billing (Epic 10 Sprint 4; redesigned 2026-10-22). Razorpay, in rupees.
// What we earn, the plan mix, whether payments reconcile, and every
// workspace's plan. A plan used to change straight from a dropdown in this
// list -- one slip changed the wrong company. It changes on the workspace's
// own page now, with a reason that goes into the audit log.
import { useMemo, useState } from "react";
import { ArrowClockwise, CurrencyInr, WarningCircle } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, fmtInr, fmtNum, fmtDate, Btn, Chip, planChip, SearchField, AdminPage, Panel, Loading,
  Empty, LoadError, Stat, DataTable,
} from "./adminUi";
import { planLabel, humanize } from "./adminLabels";

export function BillingSection() {
  const { go } = useAdmin();
  const ov = useAdminGet("/admin/billing/overview");
  const tn = useAdminGet("/admin/billing/tenants");
  const rc = useAdminGet("/admin/billing/reconciliation");
  const [q, setQ] = useState("");
  const reload = () => { ov.reload(); tn.reload(); rc.reload(); };

  const rows = useMemo(() => tn.data?.tenants || [], [tn.data]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? rows.filter((t) => `${t.name} ${planLabel(t.plan)}`.toLowerCase().includes(term)) : rows;
  }, [rows, q]);

  const o = ov.data;
  const r = rc.data;
  const columns = [
    { key: "name", label: "Workspace", render: (t) => (
      <div className="flex items-center gap-2"><span className="font-medium text-slate-900">{t.name}</span>{t.suspended && <Chip tone="bad">Suspended</Chip>}</div>
    ) },
    { key: "plan", label: "Plan", sortValue: (t) => planLabel(t.plan), render: (t) => planChip(t.plan) },
    { key: "lifetime_revenue_inr", label: "Paid so far", align: "right", render: (t) => fmtInr(t.lifetime_revenue_inr) },
    { key: "payments", label: "Payments", align: "right", mobile: false },
    { key: "last_payment", label: "Last payment", mobile: false, render: (t) => fmtDate(t.last_payment) },
    { key: "seat_limit_override", label: "Seats", align: "right", mobile: false, render: (t) => t.seat_limit_override ?? "Plan" },
  ];

  return (
    <AdminPage title="Billing" subtitle="Revenue, plans and payments, in rupees" testid="admin-billing"
      actions={<Btn size="sm" variant="ghost" icon={ArrowClockwise} onClick={reload}>Refresh</Btn>}>
      {ov.error && !o ? <LoadError what="billing" onRetry={ov.reload} /> : !o ? <Loading /> : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Monthly recurring revenue" value={fmtInr(o.mrr_inr)} sub="List price of paying plans" />
            <Stat label="Annual run rate" value={fmtInr(o.arr_inr)} />
            <Stat label="Paying workspaces" value={`${fmtNum(o.paying_tenants)} of ${fmtNum(o.total_tenants)}`} />
            <Stat label="Collected" value={fmtInr(o.revenue.all_time.revenue_inr)} sub={`${fmtInr(o.revenue.last_30d.revenue_inr)} in the last 30 days`} />
          </div>
          {!o.razorpay_configured && (
            <p className="mb-4 flex items-center gap-2 text-xs text-[#7d4e00]"><WarningCircle size={14} weight="fill" /> Razorpay prices aren&apos;t configured, so revenue uses list prices only.</p>
          )}
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Plan mix">
              <table className="w-full text-sm">
                <tbody>
                  {o.by_plan.map((p) => (
                    <tr key={p.plan} className="border-t border-slate-900/[0.05] first:border-0">
                      <td className="py-2 text-slate-800">{planLabel(p.plan)}</td>
                      <td className="py-2 text-right text-xs tabular-nums text-slate-500">{p.tenants} × {fmtInr(p.price_inr)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-900">{fmtInr(p.mrr_inr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
            <Panel title="Do payments reconcile?">
              {!r ? <Loading /> : (
                <dl className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Payment events recorded</dt>
                    <dd className="text-right text-slate-900">{Object.keys(r.by_event).length ? Object.entries(r.by_event).map(([k, v]) => `${humanize(k)} ${v.count}`).join(" · ") : "None yet"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Payments with no workspace</dt>
                    <dd>{r.unmatched_count ? <Chip tone="bad">{r.unmatched_count}</Chip> : <Chip tone="good">None</Chip>}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-slate-500">Failed or halted</dt>
                    <dd>{r.failed_or_halted.length ? <Chip tone="bad">{r.failed_or_halted.length}</Chip> : <Chip tone="good">None</Chip>}</dd>
                  </div>
                </dl>
              )}
            </Panel>
          </div>
        </>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Every workspace</h2>
        <SearchField value={q} onChange={setQ} placeholder="Search workspaces" className="w-full sm:w-64" testid="billing-search" />
      </div>
      {tn.error && !tn.data ? <LoadError what="workspaces" onRetry={tn.reload} /> : !tn.data ? <Loading /> : (
        <div className={CARD_BASE}>
          <DataTable rows={shown} columns={columns} onRowClick={(t) => go(`workspaces/${t.id}`)} rowTestid={(t) => `billing-row-${t.id}`}
            initialSort={{ key: "lifetime_revenue_inr", dir: "desc" }}
            empty={<Empty icon={CurrencyInr} title="No workspace matches." />} />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">To change a plan, open the workspace and use Change plan.</p>
    </AdminPage>
  );
}

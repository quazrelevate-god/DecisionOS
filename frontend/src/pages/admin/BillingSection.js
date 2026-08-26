// Billing & subscriptions (Epic 10 Sprint 4). Razorpay / INR.
// MRR + revenue, plan mix, per-tenant plan with admin override/comp, reconciliation.
import { useState, useEffect, useCallback } from "react";
import api, { formatApiError } from "../../lib/api";
import { toast } from "sonner";
import { Spinner, ArrowClockwise, CurrencyInr } from "@phosphor-icons/react";

const CARD = "border border-white/10 bg-[#141418] p-4";
const H2 = "font-heading text-lg font-black uppercase tracking-tight text-white";
const H3 = "font-mono text-[10px] uppercase tracking-widest text-white/40 mb-2";
const BTN = "font-mono text-[11px] uppercase tracking-wider px-3 py-2 border transition-colors";
const SEL = "bg-[#0a0a0b] border border-white/10 px-2 py-1 font-mono text-[11px] text-white outline-none";
const PLANS = ["trial", "starter", "business", "enterprise", "grandfathered"];

function Money({ v }) { return <span className="font-heading font-black">₹{Number(v || 0).toLocaleString("en-IN")}</span>; }

export function BillingSection() {
  const [ov, setOv] = useState(null);
  const [tenants, setTenants] = useState(null);
  const [recon, setRecon] = useState(null);

  const load = useCallback(async () => {
    try {
      const [o, t, r] = await Promise.all([
        api.get("/admin/billing/overview"),
        api.get("/admin/billing/tenants"),
        api.get("/admin/billing/reconciliation"),
      ]);
      setOv(o.data); setTenants(t.data.tenants); setRecon(r.data);
    } catch (e) { toast.error(formatApiError(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setPlan = async (tid, plan) => {
    const reason = window.prompt(`Set plan to "${plan}" — reason (audited):`, "");
    if (reason === null) return;
    try {
      await api.patch(`/admin/billing/tenants/${tid}/plan`, { plan, reason });
      toast.success("Plan updated"); load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  if (!ov || !tenants || !recon) {
    return <div className="flex items-center gap-2 text-white/40 font-mono text-sm py-10 justify-center"><Spinner size={16} className="animate-spin" /> Loading…</div>;
  }
  const ts = (s) => (s ? String(s).slice(0, 10) : "—");

  return (
    <div data-testid="admin-billing">
      <div className="flex items-center justify-between mb-4">
        <h2 className={H2}>Billing & Subscriptions</h2>
        <button onClick={load} className={BTN + " border-white/15 text-white/60 hover:text-white flex items-center gap-1.5"}>
          <ArrowClockwise size={13} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className={CARD}><CurrencyInr size={18} className="text-[#3fb950] mb-2" weight="bold" /><div className="font-heading text-3xl font-black text-white"><Money v={ov.mrr_inr} /></div><div className={H3 + " mt-1 mb-0"}>MRR</div></div>
        <div className={CARD}><div className="font-heading text-3xl font-black text-white"><Money v={ov.arr_inr} /></div><div className={H3 + " mt-1 mb-0"}>ARR</div></div>
        <div className={CARD}><div className="font-heading text-3xl font-black text-white">{ov.paying_tenants}<span className="text-white/30 text-lg">/{ov.total_tenants}</span></div><div className={H3 + " mt-1 mb-0"}>Paying tenants</div></div>
        <div className={CARD}><div className="font-heading text-3xl font-black text-white"><Money v={ov.revenue.all_time.revenue_inr} /></div><div className={H3 + " mt-1 mb-0"}>Revenue (all-time)</div></div>
      </div>

      {!ov.razorpay_configured && (
        <p className="font-mono text-[11px] text-[#d29922] mb-4">Razorpay prices not configured — MRR uses plan list prices only.</p>
      )}

      <div className="grid md:grid-cols-2 gap-4 mb-5">
        <div className={CARD}>
          <div className={H3}>Plan mix</div>
          <table className="w-full text-sm">
            <tbody>
              {ov.by_plan.map((p) => (
                <tr key={p.plan} className="border-t border-white/5">
                  <td className="py-1.5 text-white/80">{p.plan}</td>
                  <td className="py-1.5 text-white/50 font-mono text-xs text-right">{p.tenants} × ₹{p.price_inr.toLocaleString("en-IN")}</td>
                  <td className="py-1.5 text-white text-right font-mono">₹{p.mrr_inr.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={CARD}>
          <div className={H3}>Reconciliation</div>
          <div className="text-white/70 text-sm">Events recorded: {Object.entries(recon.by_event).map(([k, v]) => `${k} (${v.count})`).join(", ") || "none yet"}</div>
          <div className="text-white/70 text-sm mt-1">Unmatched (no tenant): <span className={recon.unmatched_count ? "text-[#e5484d]" : "text-[#3fb950]"}>{recon.unmatched_count}</span></div>
          <div className="text-white/70 text-sm mt-1">Failed / halted: {recon.failed_or_halted.length}</div>
        </div>
      </div>

      <div className={H3}>Workspaces</div>
      <div className="border border-white/10 divide-y divide-white/5 max-h-[26rem] overflow-y-auto">
        {tenants.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-3 py-2 bg-[#141418]">
            <div>
              <div className="text-white text-sm">{t.name} {t.suspended && <span className="text-[#e5484d] text-xs">· suspended</span>}</div>
              <div className="font-mono text-[10px] text-white/40">
                lifetime ₹{t.lifetime_revenue_inr.toLocaleString("en-IN")} · {t.payments} payment(s) · last {ts(t.last_payment)}
                {t.seat_limit_override != null ? ` · seats ${t.seat_limit_override}` : ""}
              </div>
            </div>
            <select value={t.plan} onChange={(e) => setPlan(t.id, e.target.value)} className={SEL} data-testid={`plan-${t.id}`}>
              {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

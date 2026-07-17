import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import { toast } from "sonner";
import { CurrencyCircleDollar, ShieldCheck, FloppyDisk, Info } from "@phosphor-icons/react";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";

export default function Settings() {
  const { tenant, refreshTenant } = useAuth();
  const [threshold, setThreshold] = useState(String(tenant?.high_value_threshold ?? 50000));
  const [signoff, setSignoff] = useState(!!tenant?.require_owner_signoff);
  const [currency, setCurrency] = useState(tenant?.currency || "INR");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const t = parseFloat(threshold);
    if (isNaN(t) || t < 0) return toast.error("Enter a valid amount");
    setSaving(true);
    try {
      await api.patch("/tenant/settings", { high_value_threshold: t, require_owner_signoff: signoff, currency });
      if (refreshTenant) await refreshTenant();
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Workspace configuration" title="Settings" />

      <div className="max-w-2xl space-y-6">
        <div className="card-brutal p-5" data-testid="settings-money-card">
          <div className="flex items-center gap-2 mb-1">
            <CurrencyCircleDollar size={20} weight="bold" className="text-brand-red" />
            <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">Money & Approvals</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Controls how incoming invoices & payments (WhatsApp / uploads) are flagged and approved.</p>

          <div className="space-y-5">
            <div>
              <label className="label-mono text-muted-foreground">Default currency</label>
              <select data-testid="settings-currency" className={`${inp} mt-1 max-w-[200px]`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="label-mono text-muted-foreground">High-value threshold ({currency})</label>
              <input data-testid="settings-threshold" type="number" min="0" step="1000" className={`${inp} mt-1 max-w-[260px]`}
                value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5">
                <Info size={13} weight="bold" className="mt-0.5 shrink-0" />
                Payments/invoices at or above this amount are flagged <span className="font-semibold">"verify before approving"</span> in the Review Queue.
              </p>
            </div>

            <button type="button" onClick={() => setSignoff(!signoff)} data-testid="settings-signoff-toggle"
              className="flex items-start gap-3 w-full text-left border border-black p-3 hover:bg-black/5 transition-colors">
              <span className={`w-5 h-5 shrink-0 mt-0.5 border border-black flex items-center justify-center ${signoff ? "bg-brand-ink text-white" : "bg-white"}`}>
                {signoff && <ShieldCheck size={13} weight="bold" />}
              </span>
              <span>
                <span className="text-sm font-semibold block">Require owner sign-off above threshold</span>
                <span className="text-xs text-muted-foreground">When on, high-value payments are routed to the owner for approval (finance still sees them). When off, finance handles them directly with a verify flag.</span>
              </span>
            </button>
          </div>

          <button onClick={save} disabled={saving} data-testid="settings-save"
            className="mt-6 flex items-center gap-2 bg-brand-ink text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-60">
            <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">More settings (capture routing, leave types, notifications & escalation) are coming next.</p>
      </div>
    </div>
  );
}

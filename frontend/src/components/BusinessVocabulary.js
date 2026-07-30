import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import api from "../lib/api";
import { lex } from "../lib/lexicon";
import { toast } from "sonner";
import { Translate, FloppyDisk, Sparkle } from "@phosphor-icons/react";

const inp = "w-full border border-hairline rounded-lg px-3 py-2 text-sm text-label uppercase bg-surface focus:outline-none focus:ring-2 focus:ring-ring/40";

const WF_KEYS = [
  { key: "production", hint: "Core delivery / fulfilment pipeline" },
  { key: "distribution", hint: "Handover / dispatch to the customer" },
  { key: "purchase_payment", hint: "Procurement & paying vendors" },
];
const TT_KEYS = ["operational", "sales", "purchase", "production", "finance", "hr"];

function Row({ label, hint, value, onChange, testid }) {
  return (
    <label className="block">
      <span className="text-label uppercase text-text-secondary">{label}</span>
      <input data-testid={testid} className={`${inp} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="text-[11px] text-text-secondary">{hint}</span>}
    </label>
  );
}

export function BusinessVocabulary() {
  const { tenant, refreshTenant } = useAuth();
  const [form, setForm] = useState(() => lex(tenant));
  const [saving, setSaving] = useState(false);
  const [regen, setRegen] = useState(false);

  const setField = (k, v) => setForm((s) => ({ ...s, [k]: v }));
  const setWf = (k, field, v) => setForm((s) => ({ ...s, workflows: { ...s.workflows, [k]: { ...s.workflows[k], [field]: v } } }));
  const setTt = (k, v) => setForm((s) => ({ ...s, task_types: { ...s.task_types, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.patch("/tenant/lexicon", { lexicon: form });
      if (refreshTenant) await refreshTenant();
      toast.success("Vocabulary saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegen(true);
    try {
      const { data } = await api.post("/tenant/lexicon/regenerate");
      setForm(lex(data));
      if (refreshTenant) await refreshTenant();
      toast.success("AI regenerated your vocabulary");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not regenerate");
    } finally {
      setRegen(false);
    }
  };

  return (
    <div className="rounded-lg border border-hairline bg-surface p-5" data-testid="settings-vocabulary-card">
      <div className="flex items-center gap-2 mb-1">
        <Translate size={20} weight="bold" className="text-primary-text" />
        <h2 className="text-lg font-extrabold uppercase tracking-tight">Business Vocabulary</h2>
      </div>
      <p className="text-xs text-text-secondary mb-4">
        The words DecisionOS uses across the app, tailored to <span className="font-semibold">{tenant?.industry || "your industry"}</span>. Edit them to match how your team talks, or let AI regenerate from your industry.
      </p>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Row label="Customer (singular)" testid="vocab-customer-singular" value={form.customer_singular} onChange={(v) => setField("customer_singular", v)} />
          <Row label="Customers (plural)" testid="vocab-customer-plural" value={form.customer_plural} onChange={(v) => setField("customer_plural", v)} />
          <Row label="Vendor (singular)" testid="vocab-vendor-singular" value={form.vendor_singular} onChange={(v) => setField("vendor_singular", v)} />
          <Row label="Vendors (plural)" testid="vocab-vendor-plural" value={form.vendor_plural} onChange={(v) => setField("vendor_plural", v)} />
        </div>

        <div>
          <p className="text-label uppercase text-primary-text mb-2">Workflow pipelines</p>
          <div className="space-y-3">
            {WF_KEYS.map(({ key, hint }) => (
              <div key={key} className="grid grid-cols-2 gap-3">
                <Row label="Name" hint={hint} testid={`vocab-wf-${key}-label`} value={form.workflows[key].label} onChange={(v) => setWf(key, "label", v)} />
                <Row label="Subtitle" testid={`vocab-wf-${key}-sub`} value={form.workflows[key].sub} onChange={(v) => setWf(key, "sub", v)} />
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-label uppercase text-primary-text mb-2">Task type / department labels</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {TT_KEYS.map((k) => (
              <Row key={k} label={k} testid={`vocab-tt-${k}`} value={form.task_types[k]} onChange={(v) => setTt(k, v)} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={save} disabled={saving} data-testid="vocab-save"
          className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:shadow-xs transition-all disabled:opacity-60">
          <FloppyDisk size={16} weight="bold" /> {saving ? "Saving…" : "Save Vocabulary"}
        </button>
        <button onClick={regenerate} disabled={regen} data-testid="vocab-regenerate"
          className="flex items-center gap-2 border border-hairline px-5 py-2 text-sm font-semibold uppercase tracking-wider rounded-lg hover:bg-surface-hover transition-all disabled:opacity-60">
          <Sparkle size={16} weight="bold" /> {regen ? "Regenerating…" : "Regenerate with AI"}
        </button>
      </div>
    </div>
  );
}
